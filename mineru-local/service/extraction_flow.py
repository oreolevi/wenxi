"""Stable base parsing, request-scoped enhancements and one bounded recovery round."""
import asyncio
import os
import time

from . import grounding, regional_ocr, seals, semantic, seal_evidence
from .progress import report

MAX_RECOVERY_FIELDS = min(6, semantic.BATCH_SIZE)
MAX_RECOVERY_REGIONS = 2
COMPLETE = {'recognized', 'partial', 'low_confidence', 'empty'}


def regions(job, pages=None):
    return [block for block in job.blocks if block.get('blockType') == 'seal'
            and (pages is None or block['pageIndex'] + 1 in pages)]


def available(block, capability):
    key = 'sealRecognition' if capability == 'seal' else 'textRecovery'
    return block.get(key, {}).get('status') not in COMPLETE


def leaf_calls(meta):
    if not meta:
        return []
    if 'calls' in meta:
        return [call for child in meta['calls'] for call in leaf_calls(child)]
    return [meta]


def recoverable(field):
    if field.get('status') not in {'missing', 'visual_required', 'rejected'}:
        return False
    if field.get('evidence') and field.get('status') == 'rejected':
        return False  # Never replace already grounded partial facts wholesale.
    if any(issue.get('code') in {'batch_failed', 'unit_failed', 'schema', 'omitted', 'duplicate'} for issue in field.get('issues', [])):
        return False  # API/model failures are not a reason for automatic paid retries.
    return True


def text_candidates(field, detected, blocks):
    if field.get('recoveryRefs'):
        return set(field['recoveryRefs'])
    if field.get('status') != 'missing' or field.get('kind', 'text') != 'text' or grounding.needs_visual(field['name']):
        return set()
    # A geometric overlap is an independent quality signal. Do not rely solely on
    # the model remembering to request recovery, or treat an isolated stamp as one.
    candidates = set()
    for region in detected:
        a = region['bbox']
        for block in blocks:
            if block['pageIndex'] != region['pageIndex'] or block.get('blockType') == 'seal' or not block.get('text'):
                continue
            b = block['bbox']
            if max(a[0], b[0]) < min(a[2], b[2]) and max(a[1], b[1]) < min(a[3], b[3]):
                candidates.add(region['ref'])
                break
    return candidates


def recovery_target(job, fields, attempted):
    units = {unit['id']: set(unit['pages']) for unit in job.document.get('units', [])}
    for first in fields:
        if not recoverable(first):
            continue
        unit = first.get('unitId')
        if unit and unit not in units:
            continue
        pages = units.get(unit) if unit else None
        detected = regions(job, pages)
        is_seal = first.get('sourceKind') == 'seal' or grounding.seal_text_question(first['name'])
        capability = 'seal' if is_seal else 'text'
        if capability == 'seal' and os.getenv('WENXI_SEAL_OCR', 'on') == 'off':
            continue
        permitted = {block['ref'] for block in detected if available(block, capability)
                     and (capability, block['ref']) not in attempted}
        requested_refs = permitted if is_seal else text_candidates(first, detected, job.blocks) & permitted
        if not requested_refs:
            continue
        refs = [block['ref'] for block in detected if block['ref'] in requested_refs][:MAX_RECOVERY_REGIONS]
        targets = []
        for field in fields:
            if field.get('unitId') != unit or not recoverable(field):
                continue
            same_source = field.get('sourceKind') == 'seal' or grounding.seal_text_question(field['name'])
            if same_source != is_seal:
                continue
            if is_seal or text_candidates(field, detected, job.blocks) & set(refs):
                targets.append(field)
        return {'capability': capability, 'refs': refs, 'fields': targets[:MAX_RECOVERY_FIELDS], 'pages': pages,
                'reason': 'requested_imprint' if is_seal else 'model_region' if first.get('recoveryRefs') else 'body_overlap'}
    return None


async def extract(job, base_extract):
    started = time.monotonic()
    attempted = set()
    # A new invocation gets a fresh plan; recognized source blocks stay cached.
    job.document = {**job.document, 'capabilityPlan': {'schemaVersion': 1,
        'base': 'stable', 'maxRecoveryRounds': 1, 'maxRecoveryFields': MAX_RECOVERY_FIELDS,
        'maxRecoveryRegions': MAX_RECOVERY_REGIONS, 'recoveryRounds': 0}}
    plan = job.document['capabilityPlan']
    detected = regions(job)
    explicit = any(grounding.seal_text_question(name) for name in job.fields)
    if not detected:
        plan['seal'] = 'no_region'
        report(job, 'seal-plan', '未检测到印章区域，跳过印文识别', 'done')
    elif os.getenv('WENXI_SEAL_OCR', 'on') == 'off':
        plan['seal'] = 'disabled'
        report(job, 'seal-plan', '印文识别已关闭，保留图像核验', 'done')
    elif explicit:
        pending = [block for block in detected if available(block, 'seal')]
        if pending:
            attempted.update(('seal', block['ref']) for block in pending)
            plan['seal'] = 'requested'
            await seals.enrich(job)
        else:
            plan['seal'] = 'cached'
            report(job, 'seal-plan', '复用已有印文识别结果', 'done')
    else:
        plan['seal'] = 'not_requested'
        report(job, 'seal-plan', '本次未明确要求印文，先提取已有内容', 'done')

    fields, initial_call = await base_extract(job)
    if initial_call and initial_call.get('outcome') in {'failed', 'cancelled'}:
        plan['recovery'] = 'model_failed'
        return fields, initial_call
    target = recovery_target(job, fields, attempted)
    if not target:
        plan['recovery'] = 'not_needed_or_no_supported_region'
        return fields, initial_call

    plan.update(recoveryRounds=1, recovery='attempted', recoveryCapability=target['capability'],
                recoveryFields=[field['name'] for field in target['fields']], recoveryRefs=target['refs'], recoveryReason=target['reason'])
    report(job, 'supplement-plan', '正在补充缺失字段的识别依据', detail='最多一轮，仅处理相关区域与字段')
    attempted.update((target['capability'], ref) for ref in target['refs'])
    if target['capability'] == 'seal':
        plan['seal'] = 'supplemental_requested'
        await seals.enrich(job, set(target['refs']))
        changed = bool(seal_evidence.sources([block for block in regions(job) if block['ref'] in target['refs']]))
    else:
        changed = await regional_ocr.enrich(job, set(target['refs']))
    if not changed:
        plan['recovery'] = 'no_new_evidence'
        report(job, 'supplement-plan', '未获得新的可靠依据，保留待核验项', 'done')
        return fields, initial_call

    original = job.blocks
    previous_prefix = getattr(job, 'event_prefix', '')
    previous_seal_names = getattr(job, 'seal_source_names', set())
    job.blocks = [block for block in original if target['pages'] is None or block['pageIndex'] + 1 in target['pages']]
    job.event_prefix = 'supplement-'
    calls = leaf_calls(initial_call)
    names = [field['name'] for field in target['fields']]
    if target['capability'] == 'seal':
        job.seal_source_names = set(names)
    try:
        retry, meta = await semantic.extract_fields(job, job.prompt, names)
        calls.extend(leaf_calls(meta))
        by_name = {field['name']: field for field in retry}
        for before in target['fields']:
            after = by_name.get(before['name'])
            if after and ((after['status'] == 'pending' and after.get('evidence')) or after.get('candidates')):
                # Keep original unit identity and stable field key for client merges.
                before.update({key: value for key, value in after.items() if key not in {'key', 'unitId', 'unitLabel'}})
                before.pop('recoveryRefs', None)
        plan['recovery'] = 'completed'
        report(job, 'supplement-plan', '补充提取已完成，未解决项保留待核验', 'done')
    except ValueError:
        calls.extend(leaf_calls(job.latest_call))
        plan['recovery'] = 'model_failed'
        report(job, 'supplement-plan', '补充提取未完成，已保留首次结果', 'error')
    except asyncio.CancelledError:
        calls.extend(leaf_calls(job.latest_call))
        job.latest_call = semantic.aggregate_calls(list({call['callId']: call for call in calls}.values()), started, 'cancelled')
        raise
    finally:
        job.blocks = original
        job.event_prefix = previous_prefix
        job.seal_source_names = previous_seal_names
    unique = list({call.get('callId', str(i)): call for i, call in enumerate(calls)}.values())
    meta = semantic.aggregate_calls(unique, started, 'partial' if any(field['status'] != 'pending' for field in fields) else 'success')
    job.latest_call = meta
    return fields, meta
