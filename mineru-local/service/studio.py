"""Project datasets, immutable rule-replay reports, and actual API call metadata."""
from copy import deepcopy
import json
import math
import time
import uuid
from . import profiles


def reports(profile_id):
    profiles.read(profile_id)
    values = []
    for path in (profiles.ROOT / 'evaluations' / profiles.checked(profile_id)).glob('*.json'):
        value = json.loads(path.read_text())
        values.append({key: value[key] for key in ('id', 'createdAt', 'hash', 'summary', 'passed', 'mode')})
    return sorted(values, key=lambda item: item['createdAt'], reverse=True)[:30]


def report(profile_id, report_id):
    profiles.read(profile_id)
    path = profiles.ROOT / 'evaluations' / profiles.checked(profile_id) / (profiles.checked(report_id) + '.json')
    if not path.is_file():
        raise FileNotFoundError('评测报告不存在。')
    return json.loads(path.read_text())


def evaluate(profile_id, sample_ids):
    if not isinstance(sample_ids, list) or not 1 <= len(sample_ids) <= 50 or not all(isinstance(item, str) for item in sample_ids):
        raise ValueError('请选择 1 到 50 份测试材料。')
    if len(set(sample_ids)) != len(sample_ids):
        raise ValueError('测试材料不能重复。')
    with profiles.LOCK:
        draft = deepcopy(profiles.read(profile_id)['draft'])
    links = {item['sampleId']: item for item in draft.get('samples', [])}
    for template in draft['templates']:
        links.setdefault(template['sampleId'], {'sampleId': template['sampleId'], 'templateId': template['id'], 'role': 'calibration'})
    if any(sample_id not in links for sample_id in sample_ids):
        raise ValueError('请先把测试材料添加到当前解析器。')
    started, created, digest = time.perf_counter(), profiles.now(), profiles.fingerprint(draft)
    rows = []
    for sample_id in sample_ids:
        incoming = profiles.sample(sample_id)
        tick = time.perf_counter()
        try:
            result = profiles.extract_batch(draft, incoming, links[sample_id]['templateId'])
            result.update(sampleId=sample_id, testedAt=profiles.now(), scope='reference' if any(item['sampleId'] == sample_id for item in draft['templates']) else 'new-sample')
            fields = [field for item in result['items'] for field in item['fields']]
            rows.append({'sampleId': sample_id, 'name': incoming['name'], 'passed': result['passed'], 'result': result,
                         'totalFields': len(fields), 'matchedFields': sum(field['status'] == 'matched' for field in fields),
                         'elapsedMs': result['elapsedMs'], 'error': ''})
        except ValueError as exc:
            rows.append({'sampleId': sample_id, 'name': incoming['name'], 'passed': False, 'result': None,
                         'totalFields': 0, 'matchedFields': 0, 'elapsedMs': round((time.perf_counter() - tick) * 1000, 2), 'error': str(exc)})
    times = sorted(row['elapsedMs'] for row in rows)
    output = {'id': uuid.uuid4().hex, 'profileId': profile_id, 'createdAt': created, 'hash': digest, 'draft': draft,
              'mode': 'rule_replay', 'usesLlm': False, 'passed': all(row['passed'] for row in rows), 'rows': rows,
              'summary': {'total': len(rows), 'passed': sum(row['passed'] for row in rows),
                          'failed': sum(not row['passed'] for row in rows), 'totalFields': sum(row['totalFields'] for row in rows),
                          'matchedFields': sum(row['matchedFields'] for row in rows),
                          'ruleP95Ms': times[max(0, math.ceil(len(times) * .95) - 1)],
                          'elapsedMs': round((time.perf_counter() - started) * 1000, 2)}}
    profiles.atomic(profiles.ROOT / 'evaluations' / profiles.checked(profile_id) / (output['id'] + '.json'), output)
    with profiles.LOCK:
        current = profiles.read(profile_id)
        if profiles.fingerprint(current['draft']) == digest:
            current['lastEvaluation'] = {key: output[key] for key in ('id', 'hash', 'summary', 'passed', 'createdAt')}
            if output['passed']:
                tests = (current.get('lastTest') or {}).get('templates', {}) if (current.get('lastTest') or {}).get('hash') == digest else {}
                for row in rows:
                    for item in row['result']['items']:
                        tests[item['templateId']] = {**item, 'sampleId': row['sampleId'], 'testedAt': created, 'scope': row['result']['scope']}
                current['lastTest'] = {'hash': digest, 'templates': tests}
            profiles.atomic(profiles.ROOT / 'profiles' / (profile_id + '.json'), current)
    return output


def record_run(profile_id, version, name, elapsed_ms, result=None, error='', phases=None):
    value = {'id': uuid.uuid4().hex, 'profileId': profiles.checked(profile_id), 'version': version,
             'createdAt': profiles.now(), 'name': name, 'status': 'succeeded' if result and result.get('passed') else 'needs_review' if result else 'failed',
             'totalElapsedMs': elapsed_ms, 'ruleMs': result.get('elapsedMs') if result else None,
             'units': (result.get('summary') or {}).get('total', 0) if result else 0, 'usesLlm': False, 'error': error}
    value['phases'] = {**(phases or {}), **({'rule': result['elapsedMs']} if result else {})}
    profiles.atomic(profiles.ROOT / 'runs' / profile_id / (value['id'] + '.json'), value)
    return value


def runs(profile_id):
    profiles.read(profile_id)
    values = [json.loads(path.read_text()) for path in (profiles.ROOT / 'runs' / profiles.checked(profile_id)).glob('*.json')]
    return sorted(values, key=lambda item: item['createdAt'], reverse=True)[:100]
