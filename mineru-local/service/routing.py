"""Deterministic material/layout routing and scene-shaped output; no model calls."""
import time
from . import profiles
from .preprocessing import Policy, group_pages, map_box


def grouped_output(draft, items, *, require_types=False):
    groups = []
    for kind in draft.get('materialTypes', []):
        rows = [item for item in items if item.get('materialTypeId') == kind['id']]
        groups.append({**kind, 'items': rows})
    missing = [kind['name'] for kind in draft.get('materialTypes', []) if require_types and kind['required'] and
               not any(item.get('materialTypeId') == kind['id'] and item.get('status') == 'succeeded' for item in items)]
    records = [{key: item.get(key) for key in ('sourceName', 'pages', 'materialTypeId', 'materialTypeName', 'templateId', 'status', 'data', 'error')} for item in items]
    if not draft.get('materialTypes') or (draft.get('output') or {}).get('mode') == 'records':
        data = records
    else:
        data = {kind['outputKey']: [item['data'] for item in kind['items'] if item.get('data') is not None] for kind in groups}
    return {'byType': groups, 'data': data, 'missingTypes': missing,
            'unmatched': [item for item in items if not item.get('materialTypeId')]}


def extract_typed(draft, incoming, template_id=''):
    started = time.perf_counter()
    policy = Policy.model_validate(draft.get('preprocessing') or {}).model_dump()
    actual = (incoming.get('preprocessing') or {}).get('policy', {})
    if any(actual.get(key, 'auto') != policy[key] for key in ('orientation', 'deskew')):
        raise ValueError('样例与当前处理策略不一致，请重新处理后测试。')
    candidates = []
    for kind in draft['materialTypes']:
        templates = [item for item in draft['templates'] if item.get('materialTypeId') == kind['id'] and (not template_id or item['id'] == template_id)]
        if not templates:
            continue
        local_policy = {**policy, 'grouping': kind['grouping']}
        references = {item['id']: profiles.reference_for(item, local_policy) for item in templates}
        for unit in group_pages(incoming['pages'], incoming['blocks'], kind['grouping']):
            local = profiles.project(incoming, unit['pages'])
            for template in templates:
                if profiles.matches_layout(references[template['id']], local, template):
                    candidates.append((kind, template, references[template['id']], unit, local))
    items, covered = [], set()
    ambiguous = set()
    for index, (_, _, _, unit, _) in enumerate(candidates):
        if any(set(unit['pages']) & set(other[3]['pages']) for other_index, other in enumerate(candidates) if other_index != index):
            ambiguous.update(unit['pages'])
    for kind, template, reference, unit, local in candidates:
        if set(unit['pages']) & ambiguous:
            continue
        covered.update(unit['pages'])
        try:
            result = profiles.extract(reference, local, template)
            for field in result['fields']:
                field['page'] = unit['pages'][field['page'] - 1]
                for block in field['evidence']:
                    block['pageIndex'] = block.get('sourcePageIndex', block['pageIndex'])
                page = incoming['pages'][field['page'] - 1]
                if field['bbox']:
                    field['originalBBox'], field['originalPolygon'] = map_box(field['bbox'], page.get('toOriginal', [[1, 0, 0], [0, 1, 0], [0, 0, 1]]))
            result['data'] = {field['key']: field['value'] if field['status'] == 'matched' else None for field in result['fields']}
            status = 'succeeded' if result['passed'] else 'needs_review'
        except ValueError as exc:
            result = {'fields': [], 'data': None, 'passed': False, 'error': str(exc), 'templateId': template['id'], 'templateName': template['name']}
            status = 'needs_review'
        items.append({**result, **unit, 'materialTypeId': kind['id'], 'materialTypeName': kind['name'], 'outputKey': kind['outputKey'],
                      'sourceName': incoming.get('name', ''), 'status': status, 'sampleId': incoming.get('id')})
    if ambiguous:
        covered.update(ambiguous)
        items.append({'pages': sorted(ambiguous), 'status': 'needs_review', 'passed': False, 'fields': [], 'data': None,
                      'sourceName': incoming.get('name', ''), 'sampleId': incoming.get('id'), 'error': '同一材料匹配多个版式或类型，请调整匹配关键词或明确指定版式。'})
    unknown = [page['number'] for page in incoming['pages'] if page['number'] not in covered]
    if unknown:
        items.append({'pages': unknown, 'status': 'needs_review', 'passed': False, 'fields': [], 'data': None,
                      'sourceName': incoming.get('name', ''), 'sampleId': incoming.get('id'), 'error': '未匹配到已支持的材料版式，请确认类别或补充版式配置。'})
    if not items:
        raise ValueError('场景没有可执行的材料类型与版式。')
    items.sort(key=lambda item: item['pages'][0])
    for index, item in enumerate(items):
        item.update(id=f'unit-{index + 1}', label=f'第 {index + 1} 份')
    return {**items[0], **grouped_output(draft, items), 'items': items, 'passed': all(item['passed'] for item in items),
            'usesLlm': False, 'engine': incoming['engine'], 'elapsedMs': round((time.perf_counter() - started) * 1000, 2),
            'preprocessing': incoming.get('preprocessing'),
            'summary': {'total': len(items), 'succeeded': sum(item['status'] == 'succeeded' for item in items),
                        'failed': sum(item['status'] != 'succeeded' for item in items)}}


def bundle_result(draft, files, elapsed_ms):
    items = []
    for index, file in enumerate(files):
        for item in file.get('result', {}).get('items', []):
            items.append({**item, 'sourceName': file['name'], 'sourceIndex': index, 'sampleId': file.get('sampleId')})
        if file.get('error'):
            items.append({'sourceName': file['name'], 'sourceIndex': index, 'sampleId': file.get('sampleId'), 'pages': [],
                          'status': 'failed', 'passed': False, 'fields': [], 'data': None, 'error': file['error']})
    output = grouped_output(draft, items, require_types=True)
    return {**output, 'files': files, 'items': items, 'usesLlm': False,
            'passed': bool(items) and all(item.get('passed') for item in items) and not output['missingTypes'],
            'elapsedMs': round(sum(file.get('result', {}).get('elapsedMs', 0) for file in files), 2),
            'totalElapsedMs': elapsed_ms,
            'summary': {'files': len(files), 'total': len(items), 'succeeded': sum(item.get('status') == 'succeeded' for item in items),
                        'failed': sum(item.get('status') != 'succeeded' for item in items)}}
