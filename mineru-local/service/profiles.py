"""Versioned fixed-layout extraction. Runtime uses coordinates and text rules, never an LLM."""
from copy import deepcopy
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
import hashlib
import json
from pathlib import Path
import re
import shutil
import threading
import time
import uuid

from pydantic import BaseModel, Field, field_validator
from typing import Literal
from .preprocessing import Policy, group_pages, map_box
from . import layout_alignment

ROOT = Path(__file__).resolve().parents[2] / '.runtime' / 'wenxi-profiles'
LOCK = threading.RLock()
IDENTIFIER = re.compile(r'^[a-zA-Z0-9_-]{1,100}$')


def now():
    return datetime.now(timezone.utc).isoformat()


def checked(value):
    if not isinstance(value, str) or not IDENTIFIER.fullmatch(value):
        raise ValueError('方案或样例编号无效。')
    return value


def atomic(path, value):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = path.with_name(uuid.uuid4().hex + '.tmp')
    try:
        temporary.write_text(json.dumps(value, ensure_ascii=False), encoding='utf-8')
        temporary.chmod(0o600)
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


class Rule(BaseModel):
    id: str = Field(max_length=100)
    key: str = Field(min_length=1, max_length=60, pattern=r'^[a-zA-Z][a-zA-Z0-9_]*$')
    name: str = Field(min_length=1, max_length=60)
    kind: str = 'text'
    method: str = 'region'
    page: int = Field(default=1, ge=1, le=50)
    region: list[float] | None = None
    anchor: str = Field(default='', max_length=100)
    direction: str = 'right'
    required: bool = True
    stripLabel: bool = False
    origin: str = 'manual'
    review: str = 'confirmed'
    note: str = Field(default='', max_length=400)

    @field_validator('origin')
    @classmethod
    def origin_valid(cls, value):
        if value not in {'manual', 'ai'}:
            raise ValueError('不支持的规则来源')
        return value

    @field_validator('review')
    @classmethod
    def review_valid(cls, value):
        if value not in {'pending', 'confirmed'}:
            raise ValueError('不支持的确认状态')
        return value

    @field_validator('kind')
    @classmethod
    def kind_valid(cls, value):
        if value not in {'text', 'number', 'amount', 'date'}:
            raise ValueError('不支持的字段类型')
        return value

    @field_validator('method')
    @classmethod
    def method_valid(cls, value):
        if value not in {'region', 'anchor'}:
            raise ValueError('不支持的定位方法')
        return value

    @field_validator('direction')
    @classmethod
    def direction_valid(cls, value):
        if value not in {'right', 'below'}:
            raise ValueError('不支持的取值方向')
        return value

    @field_validator('region')
    @classmethod
    def region_valid(cls, box):
        if box is not None and (len(box) != 4 or not all(0 <= number <= 1 for number in box)
                                or not box[0] < box[2] or not box[1] < box[3]):
            raise ValueError('区域坐标应为 0 到 1 之间的有效矩形')
        return box


class Template(BaseModel):
    id: str = Field(min_length=1, max_length=100)
    name: str = Field(min_length=1, max_length=80)
    sampleId: str = Field(min_length=1, max_length=100)
    matchTexts: list[str] = Field(default_factory=list, max_length=10)
    fields: list[Rule] = Field(default_factory=list, max_length=40)
    referencePage: int | None = Field(default=None, ge=1, le=50)
    materialTypeId: str = Field(default='', max_length=100)
    classification: Literal['', 'suggested', 'confirmed'] = ''


class MaterialType(BaseModel):
    id: str = Field(min_length=1, max_length=100)
    name: str = Field(min_length=1, max_length=60)
    outputKey: str = Field(min_length=1, max_length=60, pattern=r'^[a-zA-Z][a-zA-Z0-9_]*$')
    required: bool = False
    grouping: Literal['auto', 'document', 'per_page'] = 'document'


class OutputPolicy(BaseModel):
    mode: Literal['by_type', 'records'] = 'by_type'


class Draft(BaseModel):
    id: str = Field(min_length=1, max_length=100)
    name: str = Field(min_length=1, max_length=100)
    description: str = Field(default='', max_length=1000)
    templates: list[Template] = Field(default_factory=list, max_length=10)
    preprocessing: Policy = Field(default_factory=Policy)
    samples: list['SampleLink'] = Field(default_factory=list, max_length=50)
    materialTypes: list[MaterialType] = Field(default_factory=list, max_length=20)
    output: OutputPolicy | None = None
    resourceKind: Literal['parser'] | None = None


class SampleLink(BaseModel):
    sampleId: str = Field(min_length=1, max_length=100)
    templateId: str = Field(default='', max_length=100)
    role: str = 'test'

    @field_validator('role')
    @classmethod
    def role_valid(cls, value):
        if value not in {'calibration', 'test'}:
            raise ValueError('样例用途无效')
        return value


def fingerprint(draft):
    config = deepcopy({key: value for key, value in draft.items() if key not in {'samples', 'resourceKind'}})
    for template in config.get('templates', []):
        if not template.get('materialTypeId'):
            template.pop('materialTypeId', None)
        if not template.get('classification'):
            template.pop('classification', None)
        for rule in template.get('fields', []):
            for key in ('origin', 'review', 'note'):
                rule.pop(key, None)
    if not config.get('materialTypes'):
        config.pop('materialTypes', None)
    if not config.get('output'):
        config.pop('output', None)
    return hashlib.sha256(json.dumps(config, ensure_ascii=False, sort_keys=True).encode()).hexdigest()


def read(profile_id):
    with LOCK:
        path = ROOT / 'profiles' / (checked(profile_id) + '.json')
        if not path.is_file():
            raise FileNotFoundError('服务不存在。')
        return json.loads(path.read_text())


def listing():
    with LOCK:
        result = []
        for path in (ROOT / 'profiles').glob('*.json'):
            record = json.loads(path.read_text())
            draft = record['draft']
            result.append({'id': draft['id'], 'name': draft['name'], 'description': draft['description'],
                           'templates': len(draft['templates']), 'fields': len({(item.get('materialTypeId', ''), field['key']) for item in draft['templates'] for field in item['fields']}),
                           'versions': record['versions'], 'updatedAt': record['updatedAt'],
                           'lastTest': record.get('lastTest'), 'hasUnpublishedChanges': record.get('publishedHash') != fingerprint(draft)})
        return sorted(result, key=lambda item: item['updatedAt'], reverse=True)


def save(profile_id, body):
    with LOCK:
        draft = Draft.model_validate(body).model_dump()
        if not draft['materialTypes']:
            draft.pop('materialTypes')
        if draft['output'] is None:
            draft.pop('output')
        if draft['resourceKind'] is None:
            draft.pop('resourceKind')
        if draft.get('resourceKind') == 'parser' and draft.get('materialTypes'):
            raise ValueError('独立服务不包含多种材料类型，请在场景中组合服务。')
        types = draft.get('materialTypes', [])
        type_ids = {item['id'] for item in types}
        if len(type_ids) != len(types) or len({item['outputKey'] for item in types}) != len(types) or len({item['name'] for item in types}) != len(types):
            raise ValueError('材料类型名称、编号和输出分组名不能重复。')
        # Keep existing manual configurations byte-compatible; review metadata does not alter execution.
        for template in draft['templates']:
            if template['materialTypeId'] and template['materialTypeId'] not in type_ids:
                raise ValueError('版式关联的材料类型不存在。')
            if not template['materialTypeId']:
                template.pop('materialTypeId')
            if not template['classification']:
                template.pop('classification')
            for rule in template['fields']:
                if rule['origin'] == 'manual' and rule['review'] == 'confirmed' and not rule['note']:
                    for key in ('origin', 'review', 'note'):
                        rule.pop(key)
        if draft['id'] != checked(profile_id):
            raise ValueError('方案编号不一致。')
        for template in draft['templates']:
            checked(template['id'])
            sample(template['sampleId'])
            keys = [item['key'] for item in template['fields']]
            if len(keys) != len(set(keys)):
                raise ValueError('同一版式中接口字段名不能重复。')
        if len({item['id'] for item in draft['templates']}) != len(draft['templates']):
            raise ValueError('版式编号不能重复。')
        if len({item['sampleId'] for item in draft['samples']}) != len(draft['samples']):
            raise ValueError('样例不能重复添加。')
        for link in draft['samples']:
            sample(link['sampleId'])
            if link['templateId'] and link['templateId'] not in {item['id'] for item in draft['templates']}:
                raise ValueError('样例关联的版式不存在。')
        try:
            previous = read(profile_id)
        except FileNotFoundError:
            previous = {'versions': [], 'createdAt': now()}
        record = {**previous, 'draft': draft, 'updatedAt': now()}
        if not previous.get('draft') or fingerprint(previous['draft']) != fingerprint(draft):
            record.pop('lastTest', None)
        atomic(ROOT / 'profiles' / (profile_id + '.json'), record)
        return record


def save_sample(job):
    with LOCK:
        sample_id = uuid.uuid4().hex
        target = ROOT / 'samples' / sample_id
        target.mkdir(parents=True, mode=0o700)
        try:
            shutil.copy2(job.directory / ('input' + job.suffix), target / ('source' + job.suffix))
            pages = deepcopy(job.document['pages'])
            for page in pages:
                shutil.copy2(job.directory / f'page-{page["number"]}.png', target / f'page-{page["number"]}.png')
                page['imageUrl'] = f'/api/profile-samples/{sample_id}/page-{page["number"]}.png'
                if page.get('originalImageUrl'):
                    shutil.copy2(job.directory / f'original-{page["number"]}.png', target / f'original-{page["number"]}.png')
                    page['originalImageUrl'] = f'/api/profile-samples/{sample_id}/original-{page["number"]}.png'
            data = {'id': sample_id, 'name': job.name, 'engine': 'PDF 文字层' if not job.document.get('textSources', {}).get('ocrPages') else 'MinerU OCR',
                    'pages': pages, 'blocks': job.blocks, 'suffix': job.suffix,
                    'sourceHash': hashlib.sha256((target / ('source' + job.suffix)).read_bytes()).hexdigest(), 'createdAt': now(),
                    'preprocessing': deepcopy(job.document.get('preprocessing')), 'units': deepcopy(job.document.get('units', []))}
            if job.document.get('preprocessing'):
                data['engine'] = 'PP-OCR / PDF 文字层' if job.document.get('textSources', {}).get('ocrPages') else 'PDF 文字层'
            if job.document.get('tier') == 'cloud':
                data['engine'] = job.document['engine']
            atomic(target / 'sample.json', data)
            return data
        except BaseException:
            shutil.rmtree(target, ignore_errors=True)
            raise


def sample(sample_id):
    path = ROOT / 'samples' / checked(sample_id) / 'sample.json'
    if not path.is_file():
        raise FileNotFoundError('样例不存在，请重新上传。')
    return json.loads(path.read_text())


def sample_asset(sample_id, filename):
    data = sample(sample_id)
    if filename == 'source':
        return ROOT / 'samples' / sample_id / ('source' + data['suffix'])
    if filename not in {f'{prefix}-{page["number"]}.png' for page in data['pages'] for prefix in ('page', 'original')}:
        raise FileNotFoundError('样例页不存在。')
    path = ROOT / 'samples' / sample_id / filename
    if not path.is_file():
        raise FileNotFoundError('样例页不存在。')
    return path


def normalize(text):
    return re.sub(r'\s+', '', text).replace('：', ':').replace('（', '(').replace('）', ')')


def union(blocks):
    return [min(item['bbox'][0] for item in blocks), min(item['bbox'][1] for item in blocks),
            max(item['bbox'][2] for item in blocks), max(item['bbox'][3] for item in blocks)]


def matches_layout(reference, incoming, template):
    transforms = layout_alignment.transforms(reference, incoming, template)
    if transforms is None:
        return False
    for index, (first, second) in enumerate(zip(reference['pages'], incoming['pages'])):
        if transforms[index] is None and abs((first['width'] / first['height']) / (second['width'] / second['height']) - 1) > .03:
            return False
    text = normalize(''.join(block['text'] for block in incoming['blocks']))
    if any(normalize(keyword) not in text for keyword in template['matchTexts']):
        return False
    # Static labels constrain geometry; values are deliberately excluded from the fingerprint.
    landmarks = [block for block in reference['blocks'] if normalize(block['text']).endswith(':') and 2 < len(normalize(block['text'])) < 35]
    if not landmarks and not template['matchTexts']:
        return False
    hits = 0
    for block in landmarks:
        box = layout_alignment.box_incoming(block['bbox'], transforms[block['pageIndex']])
        found = [other for other in incoming['blocks'] if other['pageIndex'] == block['pageIndex']
                 and normalize(other['text']) == normalize(block['text'])
                 and max(abs(other['bbox'][index] - box[index]) for index in (0, 1)) < .035]
        hits += bool(found)
    return not landmarks or hits / len(landmarks) >= .8


def inside_region(block, box):
    x0,y0,x1,y1=block['bbox']
    if not box[0] <= (x0+x1)/2 <= box[2]:
        return False
    center=(y0+y1)/2
    if box[1] <= center <= box[3]:
        return True
    # Native PDF glyph metrics and OCR rectangles differ by a few pixels.
    # Require actual vertical overlap as well as a tightly bounded center offset.
    overlap=max(0.,min(y1,box[3])-max(y0,box[1]))
    distance=max(box[1]-center,center-box[3],0.)
    return distance <= .006 and overlap >= .35*min(y1-y0,box[3]-box[1])


def extract(reference, incoming, template, *, verify_layout=True):
    started = time.perf_counter()
    if any(page.get('needsReview') for page in incoming['pages']):
        raise ValueError('页面方向或文字识别不确定，请核对原图并指定转正角度后重试。')
    if verify_layout and not matches_layout(reference, incoming, template):
        raise ValueError('版式不匹配，请使用已配置的版式或转通用提取。')
    transforms = layout_alignment.transforms(reference, incoming, template)
    if transforms is None:
        raise ValueError('校正后的版面位置无法可靠对应，请重新定位字段或转通用提取。')
    output = []
    for field in template['fields']:
        box = layout_alignment.box_incoming(field['region'], transforms[field['page']-1]) if field['region'] else None
        blocks = [block for block in incoming['blocks'] if block['pageIndex'] == field['page'] - 1 and block.get('text')]
        if field['method'] == 'anchor' and field['anchor'].strip():
            anchors = [block for block in blocks if normalize(field['anchor']) in normalize(block['text'])]
            if box and anchors:
                anchors.sort(key=lambda item: abs(item['bbox'][0] - box[0]) + abs(item['bbox'][1] - box[1]))
            if not anchors:
                blocks = []
            else:
                anchor = anchors[0]['bbox']
                if field['direction'] == 'right':
                    box = [anchor[2], max(0, anchor[1] - .008), min(1, anchor[2] + .4), min(1, anchor[3] + .008)]
                else:
                    box = [max(0, anchor[0] - .01), anchor[3], min(1, anchor[2] + .35), min(1, anchor[3] + .07)]
        if box:
            blocks = [block for block in blocks if inside_region(block,box)]
        else:
            blocks = []
        blocks.sort(key=lambda block: (round(block['bbox'][1] / .012), block['bbox'][0]))
        raw = ' '.join(block['text'] for block in blocks).strip()
        value = re.split(r'[:：]', raw, maxsplit=1)[-1].strip() if field.get('stripLabel') else raw
        issue = ''
        status = 'matched' if raw else 'missing'
        if field['kind'] == 'amount' and raw:
            numbers = re.findall(r'[-+]?\d[\d,]*(?:\.\d+)?', normalize(raw))
            try:
                if len(numbers) != 1:
                    raise InvalidOperation()
                value = str(Decimal(numbers[0].replace(',', '')))
            except InvalidOperation:
                status, issue = 'invalid', '区域内不是单一金额，请调整区域'
        elif field['kind'] == 'date' and raw:
            date = re.fullmatch(r'(\d{4})[年/.-](\d{1,2})[月/.-](\d{1,2})日?', normalize(value))
            if date:
                try:
                    from datetime import date as calendar_date
                    value = calendar_date(*map(int, date.groups())).isoformat()
                except ValueError:
                    status, issue = 'invalid', '日期格式不符合要求'
            else:
                status, issue = 'invalid', '日期格式不符合要求'
        elif field['kind'] == 'number' and raw:
            value = normalize(value)
            if not re.fullmatch(r'\d+', value):
                status, issue = 'invalid', '该字段应只包含数字'
        output.append({'key': field['key'], 'name': field['name'], 'value': value, 'raw': raw, 'status': status,
                       'required': field['required'], 'issue': issue, 'page': field['page'],
                       'bbox': union(blocks) if blocks else box, 'evidence': blocks})
    return {'templateId': template['id'], 'templateName': template['name'], 'fields': output,
            'passed': bool(output) and all(item['status'] == 'matched' or not item['required'] and item['status'] == 'missing' for item in output),
            'elapsedMs': round((time.perf_counter() - started) * 1000, 2), 'usesLlm': False, 'engine': incoming['engine']}


def test(profile_id, sample_id, template_id):
    with LOCK:
        record = read(profile_id)
        template = next((item for item in record['draft']['templates'] if item['id'] == template_id), None)
        if not template:
            raise ValueError('请先选择一个版式。')
        reference, incoming = sample(template['sampleId']), sample(sample_id)
        result = extract_batch(record['draft'], incoming, template_id)
        result.update(sampleId=sample_id, testedAt=now(), scope='reference' if reference['sourceHash'] == incoming['sourceHash'] else 'new-sample')
        tests = (record.get('lastTest') or {}).get('templates', {})
        tests[template_id] = result
        record['lastTest'] = {'hash': fingerprint(record['draft']), 'templates': tests}
        atomic(ROOT / 'profiles' / (checked(profile_id) + '.json'), record)
        return result


def release_check(profile_id):
    from .release_checks import service_check
    with LOCK:
        return service_check(read(profile_id))


def publish(profile_id, note=''):
    from .release_checks import service_check
    if not isinstance(note, str) or len(note) > 500:
        raise ValueError('发布说明最多 500 字。')
    with LOCK:
        record = read(profile_id)
        draft = record['draft']
        report = service_check(record)
        if not report['ready']:
            raise ValueError(report['issues'][0]['detail'])
        digest = fingerprint(draft)
        if record.get('publishedHash') == digest:
            return record
        version = f'1.{len(record["versions"])}.0'
        tests = record.get('lastTest', {}).get('templates', {})
        summary = {'passed': sum(bool(tests.get(t['id'], {}).get('passed')) for t in draft['templates']),
                   'total': len(draft['templates'])}
        atomic(ROOT / 'versions' / checked(profile_id) / (version + '.json'),
               {'draft': draft, 'version': version, 'publishedAt': now(), 'tests': summary, 'note': note.strip()})
        record['versions'].append(version)
        record['publishedHash'] = digest
        record['publishedDraft'] = deepcopy(draft)
        record['updatedAt'] = now()
        atomic(ROOT / 'profiles' / (profile_id + '.json'), record)
        return record


def published(profile_id, version):
    checked(profile_id)
    if not re.fullmatch(r'\d+\.\d+\.\d+', version):
        raise ValueError('请指定已发布版本，例如 1.0.0。')
    path = ROOT / 'versions' / profile_id / (version + '.json')
    if not path.is_file():
        raise FileNotFoundError('方案版本不存在或尚未发布。')
    return json.loads(path.read_text())['draft']


def releases(profile_id):
    """List immutable release metadata without consulting the mutable draft's tests."""
    with LOCK:
        record = read(profile_id)
        result = []
        for version in reversed(record['versions']):
            if not re.fullmatch(r'\d+\.\d+\.\d+', version):
                raise ValueError('发布版本号无效。')
            path = ROOT / 'versions' / checked(profile_id) / (version + '.json')
            if not path.is_file():
                raise FileNotFoundError(f'版本 {version} 的发布记录不存在。')
            entry = json.loads(path.read_text())
            templates = entry['draft']['templates']
            result.append({'version': version, 'publishedAt': entry.get('publishedAt', ''),
                           'templates': len(templates), 'fields': len({f['key'] for t in templates for f in t['fields']}),
                           'tests': entry.get('tests'), 'note': entry.get('note', '')})
        return result


def project(data, page_numbers):
    value = deepcopy(data)
    positions = {number - 1: index for index, number in enumerate(page_numbers)}
    value['pages'] = [deepcopy(data['pages'][number - 1]) for number in page_numbers]
    value['blocks'] = [deepcopy(block) for block in data['blocks'] if block['pageIndex'] in positions]
    for block in value['blocks']:
        block['sourcePageIndex'] = block['pageIndex']
        block['pageIndex'] = positions[block['pageIndex']]
    return value


def reference_for(template, policy):
    reference = sample(template['sampleId'])
    actual = (reference.get('preprocessing') or {}).get('policy', {})
    if any(actual.get(key, 'auto') != policy[key] for key in ('orientation', 'deskew')):
        raise ValueError('基准样例策略已变化，请按当前处理流程重新处理样例并定位字段。')
    page = template.get('referencePage')
    if page is None and policy['grouping'] == 'per_page':
        page = 1
    if page:
        if page > len(reference['pages']):
            raise ValueError('基准页不存在，请重新选择。')
        reference = project(reference, [page])
    if any(field['page'] > len(reference['pages']) for field in template['fields']):
        raise ValueError('字段页码超出基准材料范围，请调整字段所在页。')
    return reference


def extract_batch(draft, incoming, template_id=''):
    if draft.get('materialTypes'):
        from .routing import extract_typed
        return extract_typed(draft, incoming, template_id)
    return extract_legacy(draft, incoming, template_id)


def extract_legacy(draft, incoming, template_id=''):
    started = time.perf_counter()
    policy = Policy.model_validate(draft.get('preprocessing') or {}).model_dump()
    actual = (incoming.get('preprocessing') or {}).get('policy', {})
    if any(actual.get(key, 'auto') != policy[key] for key in ('orientation', 'deskew')):
        raise ValueError('样例处理策略与方案不一致，请先按当前处理流程重新处理样例。')
    candidates = [item for item in draft['templates'] if not template_id or item['id'] == template_id]
    references = {item['id']: reference_for(item, policy) for item in candidates}
    units = group_pages(incoming['pages'], incoming['blocks'], policy['grouping'])
    results = []
    for unit in units:
        local = project(incoming, unit['pages'])
        matched = [item for item in candidates if matches_layout(references[item['id']], local, item)]
        try:
            if len(matched) != 1:
                raise ValueError('未匹配到唯一的已支持版式，请明确版式或转通用提取。')
            result = extract(references[matched[0]['id']], local, matched[0])
            for field in result['fields']:
                field['page'] = unit['pages'][field['page'] - 1]
                for block in field['evidence']:
                    block['pageIndex'] = block.get('sourcePageIndex', block['pageIndex'])
                page = incoming['pages'][field['page'] - 1]
                if field['bbox']:
                    field['originalBBox'], field['originalPolygon'] = map_box(field['bbox'], page.get('toOriginal', [[1, 0, 0], [0, 1, 0], [0, 0, 1]]))
            result['data'] = {field['key']: field['value'] if field['status'] == 'matched' else None for field in result['fields']}
            results.append({**result, **unit, 'status': 'succeeded' if result['passed'] else 'needs_review'})
        except ValueError as exc:
            if len(units) == 1:
                raise
            results.append({**unit, 'passed': False, 'fields': [], 'data': {}, 'status': 'failed', 'error': str(exc)})
    first = results[0]
    return {**first, 'items': results, 'passed': all(item['passed'] for item in results), 'usesLlm': False,
            'engine': incoming['engine'], 'elapsedMs': round((time.perf_counter() - started) * 1000, 2),
            'preprocessing': incoming.get('preprocessing'),
            'summary': {'total': len(results), 'succeeded': sum(item['status'] == 'succeeded' for item in results),
                        'failed': sum(item['status'] == 'failed' for item in results)}}


def execute(profile_id, version, sample_id, template_id=''):
    draft = published(profile_id, version)
    incoming = sample(sample_id) if isinstance(sample_id, str) else sample_id
    result = extract_batch(draft, incoming, template_id)
    if draft.get('materialTypes') and not template_id:
        from .routing import grouped_output
        result.update(grouped_output(draft, result['items'], require_types=True))
        result['passed'] = result['passed'] and not result['missingTypes']
    return {**result, 'profileId': profile_id, 'version': version}


def suggest(sample_id, request='', reference_page=1):
    data = sample(sample_id)
    blocks = [block for block in data['blocks'] if block['pageIndex'] == reference_page - 1]
    suggestions = []
    definitions = [
        ('invoice_number', '发票号码', 'number', lambda block: bool(re.fullmatch(r'\d{20}', normalize(block['text']))) or bool(re.fullmatch(r'发票号码:\d{20}', normalize(block['text'])))),
        ('invoice_date', '开票日期', 'date', lambda block: bool(re.fullmatch(r'(?:开票日期:)?\d{4}年\d{1,2}月\d{1,2}日', normalize(block['text'])))),
        ('buyer_name', '购买方名称', 'text', lambda block: '公司' in block['text'] and block['bbox'][0] < .5),
        ('seller_name', '销售方名称', 'text', lambda block: '公司' in block['text'] and block['bbox'][0] >= .5),
        ('buyer_tax_id', '购买方识别号', 'text', lambda block: bool(re.fullmatch(r'[A-Z0-9]{18}', normalize(block['text']))) and block['bbox'][0] < .5),
        ('seller_tax_id', '销售方识别号', 'text', lambda block: bool(re.fullmatch(r'[A-Z0-9]{18}', normalize(block['text']))) and block['bbox'][0] >= .5),
        ('amount', '不含税金额', 'amount', lambda block: bool(re.fullmatch(r'\d+\.\d{2}', normalize(block['text']))) and .58 < block['bbox'][1] < .69 and .5 < block['bbox'][0] < .8),
        ('tax', '税额', 'amount', lambda block: bool(re.fullmatch(r'\d+\.\d{2}', normalize(block['text']))) and .58 < block['bbox'][1] < .69 and block['bbox'][0] > .85),
        ('total_amount', '价税合计', 'amount', lambda block: bool(re.fullmatch(r'\d+\.\d{2}', normalize(block['text']))) and .69 < block['bbox'][1] < .74),
    ]
    for key, name, kind, predicate in definitions:
        if request.strip() and name not in request and not (key in {'buyer_name', 'seller_name'} and name[:3] in request) and not (key == 'total_amount' and '总金额' in request):
            continue
        matches = [block for block in blocks if predicate(block)]
        if not matches:
            continue
        block = matches[0]
        box = block['bbox']
        suggestions.append({'id': uuid.uuid4().hex, 'key': key, 'name': name, 'kind': kind, 'method': 'region',
                            'page': block['pageIndex'] + 1, 'region': [max(0, box[0] - .006), max(0, box[1] - .008), min(1, box[2] + .006), min(1, box[3] + .008)],
                            'anchor': '', 'direction': 'right', 'required': True, 'stripLabel': ':' in normalize(block['text'])})
    return suggestions
