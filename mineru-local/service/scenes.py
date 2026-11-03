"""Scene composition over independently versioned extraction profiles.

Profiles are parsers; scenes only hold references. Legacy files and endpoints
remain unchanged. The catalog migrates old containers once, without overwriting
their published snapshots.
"""
from copy import deepcopy
import hashlib
import json
import re
import uuid
from pydantic import BaseModel, ConfigDict, Field
from . import profiles


class Binding(BaseModel):
    model_config = ConfigDict(extra='forbid')
    id: str = Field(min_length=1, max_length=100, pattern=r'^[a-zA-Z][a-zA-Z0-9_]*$')
    parserId: str = Field(min_length=1, max_length=100)
    version: str = Field(default='', max_length=30)
    name: str = Field(min_length=1, max_length=100)
    required: bool = True
    multiple: bool = True


class Scene(BaseModel):
    model_config = ConfigDict(extra='forbid')
    id: str = Field(min_length=1, max_length=100)
    name: str = Field(min_length=1, max_length=100)
    description: str = Field(default='', max_length=1000)
    bindings: list[Binding] = Field(default_factory=list, max_length=20)


class EfficiencyBaseline(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)
    minutesPerRun: float | None = Field(default=None, ge=0, le=1440)


def configure_efficiency(scene_id, body):
    """Operational estimate, independent of the frozen extraction configuration."""
    baseline = EfficiencyBaseline.model_validate(body).model_dump()
    with profiles.LOCK:
        record = read(scene_id)
        record['efficiency'] = {**baseline, 'updatedAt': profiles.now()}
        profiles.atomic(_path(scene_id), record)
    return record['efficiency']


def digest(draft):
    return hashlib.sha256(json.dumps(draft, ensure_ascii=False, sort_keys=True).encode()).hexdigest()


def _path(scene_id):
    return profiles.ROOT / 'scenes' / (profiles.checked(scene_id) + '.json')


def read(scene_id):
    with profiles.LOCK:
        path = _path(scene_id)
        if not path.is_file():
            raise FileNotFoundError('场景不存在。')
        return json.loads(path.read_text())


def save(scene_id, body):
    draft = Scene.model_validate(body).model_dump()
    if draft['id'] != profiles.checked(scene_id):
        raise ValueError('场景编号不一致。')
    if len({b['id'] for b in draft['bindings']}) != len(draft['bindings']):
        raise ValueError('材料标识不能重复。')
    for binding in draft['bindings']:
        profiles.read(binding['parserId'])
        if binding['version']:
            profiles.published(binding['parserId'], binding['version'])
    with profiles.LOCK:
        previous = read(scene_id) if _path(scene_id).is_file() else {'createdAt': profiles.now(), 'versions': []}
        record = {**previous, 'draft': draft, 'updatedAt': profiles.now()}
        if digest(previous.get('draft')) != digest(draft):
            record.pop('lastTest', None)
        profiles.atomic(_path(scene_id), record)
        return record


def listing():
    with profiles.LOCK:
        rows = [json.loads(p.read_text()) for p in (profiles.ROOT / 'scenes').glob('*.json')]
    return sorted([{'id': r['draft']['id'], 'name': r['draft']['name'], 'description': r['draft']['description'],
                    'bindings': len(r['draft']['bindings']), 'versions': r['versions'], 'updatedAt': r['updatedAt'],
                    'hasUnpublishedChanges': r.get('publishedHash') != digest(r['draft'])} for r in rows],
                  key=lambda r: r['updatedAt'], reverse=True)


def _single(draft, parser_id, kind=None):
    value = deepcopy(draft)
    value['id'] = parser_id
    if kind:
        value['name'] = f"{draft['name']} · {kind['name']}"
        value['templates'] = [t for t in value['templates'] if t.get('materialTypeId') == kind['id']]
        value.setdefault('preprocessing', {})['grouping'] = kind['grouping']
    value.pop('materialTypes', None)
    value.pop('output', None)
    value['resourceKind'] = 'parser'
    ids = {t['id'] for t in value['templates']}
    value['samples'] = [s for s in value.get('samples', []) if s.get('templateId') in ids]
    for template in value['templates']:
        template.pop('materialTypeId', None)
        template.pop('classification', None)
    return value


def catalog():
    with profiles.LOCK:
        path = profiles.ROOT / 'studio-catalog.json'
        index = json.loads(path.read_text()) if path.is_file() else {'migrated': {}, 'hidden': []}
        # Only pre-refactor records become legacy scenes; new parser records are
        # registered by the catalog route immediately after creation.
        for summary in profiles.listing():
            old_id = summary['id']
            if old_id in index['migrated'] or old_id in index['hidden'] or old_id in index.get('parsers', []):
                continue
            record = profiles.read(old_id)
            draft = record['draft']
            kinds = draft.get('materialTypes') or []
            bindings = []
            if len(kinds) > 1:
                for kind in kinds:
                    if not any(t.get('materialTypeId') == kind['id'] for t in draft['templates']):
                        continue
                    parser_id = 'parser-' + hashlib.sha256(f"{old_id}:{kind['id']}".encode()).hexdigest()[:24]
                    child = profiles.save(parser_id, _single(draft, parser_id, kind))
                    # Derive supported immutable versions from the old published
                    # snapshots. This is migration, not a new publication/test.
                    for version in record['versions']:
                        snapshot = profiles.published(old_id, version)
                        old_kind = next((k for k in snapshot.get('materialTypes', []) if k['id'] == kind['id']), None)
                        if old_kind and any(t.get('materialTypeId') == kind['id'] for t in snapshot['templates']):
                            frozen = _single(snapshot, parser_id, old_kind)
                            profiles.atomic(profiles.ROOT / 'versions' / parser_id / (version + '.json'),
                                            {'draft': frozen, 'version': version, 'publishedAt': record['updatedAt'], 'migratedFrom': old_id})
                            child['versions'].append(version)
                            child['publishedDraft'] = frozen
                            child['publishedHash'] = profiles.fingerprint(frozen)
                    profiles.atomic(profiles.ROOT / 'profiles' / (parser_id + '.json'), child)
                    index.setdefault('parsers', []).append(parser_id)
                    bindings.append({'id': kind['outputKey'], 'parserId': parser_id, 'version': child['versions'][-1] if child['versions'] else '',
                                     'name': kind['name'], 'required': kind['required'], 'multiple': True})
                index['hidden'].append(old_id)
            else:
                index.setdefault('parsers', []).append(old_id)
                bindings.append({'id': kinds[0]['outputKey'] if kinds else 'documents', 'parserId': old_id,
                                 'version': record['versions'][-1] if record['versions'] else '', 'name': draft['name'],
                                 'required': True, 'multiple': True})
            scene_id = 'scene-' + old_id
            save(scene_id, {'id': scene_id, 'name': draft['name'], 'description': draft.get('description', ''), 'bindings': bindings})
            index['migrated'][old_id] = scene_id
        profiles.atomic(path, index)
        return {'parsers': [p for p in profiles.listing() if p['id'] not in index['hidden']], 'scenes': listing()}


def register_parser(parser_id):
    with profiles.LOCK:
        path = profiles.ROOT / 'studio-catalog.json'
        if not path.exists():
            catalog()
        index = json.loads(path.read_text())
        if parser_id not in index.setdefault('parsers', []):
            index['parsers'].append(parser_id)
            profiles.atomic(path, index)


def resolve(draft):
    if not draft['bindings']:
        raise ValueError('请先添加解析器。')
    result = []
    for binding in draft['bindings']:
        if not binding['version']:
            raise ValueError(f"请为“{binding['name']}”选择已发布版本。未发布解析器可以先配置，再回到此处选择版本。")
        frozen = profiles.published(binding['parserId'], binding['version'])
        if len(frozen.get('materialTypes', [])) > 1:
            raise ValueError('请使用拆分后的独立解析器。')
        result.append((binding, frozen))
    return result


def candidates(resolved, prepared, assignment=''):
    """All inputs are processed using each parser's policy by the caller."""
    items, errors, ambiguous_pages = [], [], set()
    for binding, parser in resolved:
        if assignment and binding['id'] != assignment:
            continue
        sample = prepared[binding['id']]
        try:
            result = profiles.extract_batch(parser, sample)
            for item in result.get('items', []):
                if item.get('templateId'):
                    items.append({**item, 'sampleId': sample.get('id'), 'sourceName': sample['name'],
                                  'materialTypeId': binding['id'], 'materialTypeName': binding['name'],
                                  'parserId': binding['parserId'], 'parserVersion': binding['version']})
        except ValueError as exc:
            errors.append(str(exc))
    for i, item in enumerate(items):
        if any(set(item['pages']) & set(other['pages']) for j, other in enumerate(items) if i != j):
            ambiguous_pages.update(item['pages'])
    covered = {p for item in items for p in item['pages']}
    first = next(iter(prepared.values()))
    items = [item for item in items if not set(item['pages']) & ambiguous_pages]
    for pages, reason in [(sorted(ambiguous_pages), '同一材料匹配多个解析器，请在联调时指定材料用途或调整版式。'),
                          ([p['number'] for p in first['pages'] if p['number'] not in covered], '未匹配到场景内的解析器。')]:
        if pages:
            items.append({'pages': pages, 'fields': [], 'passed': False, 'status': 'needs_review', 'data': None,
                          'sampleId': first.get('id'), 'sourceName': first['name'], 'error': reason})
    return sorted(items, key=lambda r: r['pages'][0])


def result(draft, files, elapsed_ms):
    items = [{**item, 'sourceIndex': index} for index, file in enumerate(files) for item in file.get('items', [])]
    for index, file in enumerate(files):
        if file.get('error'):
            items.append({'sourceName': file['name'], 'sourceIndex': index, 'pages': [], 'fields': [], 'passed': False, 'status': 'failed', 'data': None, 'error': file['error']})
    missing, issues, data = [], [], {}
    for binding in draft['bindings']:
        rows = [item for item in items if item.get('materialTypeId') == binding['id']]
        data[binding['id']] = [item['data'] for item in rows if item.get('data') is not None]
        if binding['required'] and not rows:
            missing.append(binding['name'])
        if not binding['multiple'] and len(rows) > 1:
            issues.append(f"“{binding['name']}”只允许一份，本次识别到 {len(rows)} 份。")
    return {'passed': bool(items) and all(item['passed'] for item in items) and not missing and not issues,
            'items': items, 'files': files, 'data': data, 'missingTypes': missing, 'issues': issues, 'usesLlm': False,
            'elapsedMs': round(sum(item.get('elapsedMs', 0) for item in items), 2), 'totalElapsedMs': elapsed_ms, 'summary': {'files': len(files), 'total': len(items),
            'succeeded': sum(item['passed'] for item in items), 'failed': sum(not item['passed'] for item in items)}}


def remember_test(scene_id, tested_draft, value):
    with profiles.LOCK:
        record = read(scene_id)
        if digest(record['draft']) == digest(tested_draft):
            record['lastTest'] = {'hash': digest(tested_draft), 'passed': value['passed'], 'testedAt': profiles.now(), 'result': value}
            profiles.atomic(_path(scene_id), record)


def release_check(scene_id):
    from .release_checks import scene_check
    with profiles.LOCK:
        return scene_check(read(scene_id))


def publish(scene_id):
    from .release_checks import scene_check
    with profiles.LOCK:
        record = read(scene_id)
        report = scene_check(record)
        if not report['ready']:
            raise ValueError(report['issues'][0]['detail'])
        fingerprint = digest(record['draft'])
        if record.get('publishedHash') == fingerprint:
            return record
        version = f"1.{len(record['versions'])}.0"
        profiles.atomic(profiles.ROOT / 'scene-versions' / scene_id / (version + '.json'),
                        {'draft': record['draft'], 'publishedAt': profiles.now()})
        record['versions'].append(version)
        record['publishedHash'] = fingerprint
        record['publishedDraft'] = deepcopy(record['draft'])
        profiles.atomic(_path(scene_id), record)
        return record


def published(scene_id, version):
    profiles.checked(scene_id)
    if not re.fullmatch(r'\d+\.\d+\.\d+', version):
        raise ValueError('请指定已发布场景版本。')
    path = profiles.ROOT / 'scene-versions' / scene_id / (version + '.json')
    if not path.is_file():
        raise FileNotFoundError('场景版本尚未发布。')
    return json.loads(path.read_text())['draft']


def record_run(scene_id, version, value):
    with profiles.LOCK:
        # Snapshot the baseline so later changes never rewrite historical savings.
        minutes = read(scene_id).get('efficiency', {}).get('minutesPerRun')
        profiles.atomic(profiles.ROOT / 'scene-runs' / profiles.checked(scene_id) / (uuid.uuid4().hex + '.json'),
                        {'version': version, 'createdAt': profiles.now(), 'passed': value['passed'], 'summary': value['summary'],
                         'totalElapsedMs': value['totalElapsedMs'], 'usesLlm': False, 'minutesSavedPerRun': minutes})


def runs(scene_id):
    read(scene_id)
    return sorted([json.loads(p.read_text()) for p in (profiles.ROOT / 'scene-runs' / profiles.checked(scene_id)).glob('*.json')],
                  key=lambda r: r['createdAt'], reverse=True)[:50]
