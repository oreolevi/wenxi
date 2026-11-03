"""Field/cell-level source validation. Derived conclusions never masquerade as quotes."""
import re
import json
import unicodedata
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, StrictStr

from .extraction import ALIASES


class Quote(BaseModel):
    model_config = ConfigDict(extra='forbid')
    ref: StrictStr = Field(min_length=1, max_length=80)
    quote: StrictStr = Field(min_length=1, max_length=4000)


class Fact(BaseModel):
    model_config = ConfigDict(extra='forbid')
    label: StrictStr = Field(default='', max_length=60)
    raw_value: StrictStr | None = Field(max_length=4000)
    evidence: list[Quote] = Field(default_factory=list, max_length=10)


class Table(BaseModel):
    model_config = ConfigDict(extra='forbid')
    columns: list[StrictStr] = Field(min_length=1, max_length=12)
    rows: list[dict] = Field(min_length=1, max_length=50)


class SemanticField(BaseModel):
    model_config = ConfigDict(extra='forbid')
    name: StrictStr = Field(min_length=1, max_length=40)
    kind: Literal['text', 'list', 'table', 'judgment', 'visual'] = 'text'
    raw_value: StrictStr | None = Field(default=None, max_length=4000)
    evidence: list[Quote] = Field(default_factory=list, max_length=10)
    items: list[dict] = Field(default_factory=list, max_length=50)
    table: Table | None = None
    decision: Literal['yes', 'no', 'uncertain'] | None = None
    note: StrictStr = Field(default='', max_length=400)


def verbatim(value: str) -> str:
    return re.sub(r'\s+', '', value)


def source_quote(source: str, quote: str) -> str | None:
    """Resolve whitespace/fullwidth punctuation variations back to actual source characters."""
    normalized, positions = '', []
    for index, char in enumerate(source):
        for canonical in unicodedata.normalize('NFKC', char):
            if not canonical.isspace():
                normalized += canonical
                positions.append(index)
    target = verbatim(unicodedata.normalize('NFKC', quote))
    start = normalized.find(target) if target else -1
    return source[positions[start]:positions[start + len(target) - 1] + 1] if start >= 0 else None


def needs_visual(name: str) -> bool:
    # Clause requirements are text questions; actual marks/signatures/locations need images.
    return not re.search(r'条件|要求|条款|生效', name) and bool(re.search(r'签章|印章|名章|签名|手写|签字', name))


def base_field(name: str) -> dict:
    aliases = next((group for group in ALIASES if name in group), [name])
    return {'key': f'ai-{name}', 'name': name, 'kind': 'text', 'value': '', 'raw': '',
            'page': None, 'ref': None, 'aliases': aliases, 'status': 'missing',
            'validationStatus': 'missing', 'evidence': [], 'issues': [], 'note': ''}


def rejected(name: str, message: str, code='invalid_field') -> dict:
    return {**base_field(name), 'status': 'rejected', 'validationStatus': 'rejected',
            'note': message, 'issues': [{'path': name, 'code': code, 'message': message}]}


def checked_fact(data: dict, source: dict, label='') -> dict:
    output = {'label': label, 'value': '', 'raw': '', 'status': 'missing', 'evidence': []}
    try:
        item = Fact.model_validate(data)
        output['label'] = item.label or label
        if item.raw_value is None:
            if item.evidence:
                raise ValueError('缺失值不应包含引用。')
            return output
        if not item.raw_value.strip() or not item.evidence:
            raise ValueError('提取值缺少原文依据。')
        found = []
        supported = False
        for quote in item.evidence:
            block = source.get(quote.ref)
            canonical = source_quote(block['text'], quote.quote) if block else None
            if canonical is None:
                raise ValueError('原文引用或摘录未通过校验。')
            # Preserve letters/numbers exactly, even when punctuation in the model quote differed.
            supported |= verbatim(item.raw_value) in verbatim(canonical)
            if not any(evidence['ref'] == block['ref'] for evidence in found):
                found.append({**block, 'quote': canonical})
        if not supported:
            raise ValueError('字段值不在单个原文摘录中；多段内容需分别引用。')
        return {**output, 'value': item.raw_value, 'raw': item.raw_value, 'status': 'pending', 'evidence': found}
    except ValueError as exc:
        message = str(exc) if not hasattr(exc, 'errors') else '单元格或摘录的数据结构不符合要求。'
        return {**output, 'status': 'rejected', 'issue': message}


def attach_evidence(output: dict, facts: list[dict]):
    evidence = {}
    for fact in facts:
        if fact['status'] == 'pending':
            for block in fact['evidence']:
                evidence.setdefault(block['ref'], block)
    output['evidence'] = list(evidence.values())
    if evidence:
        first = next(iter(evidence.values()))
        output.update(ref=first['ref'], page=first['pageIndex'] + 1)


def visual_field(name: str, blocks: list[dict]) -> dict:
    output = base_field(name)
    signature_pages = {block['pageIndex'] for block in blocks if '委托代理' in block['text'] and ('甲方' in block['text'] or '单位名称' in block['text'])}
    contexts = sorted([block for block in blocks if block.get('blockType') == 'seal'],
                      key=lambda block: (block['pageIndex'] not in signature_pages, block['pageIndex']))[:4]
    if not contexts:
        contexts = [block for block in blocks if block['pageIndex'] in signature_pages][:2]
    if contexts:
        output.update(ref=contexts[0]['ref'], page=contexts[0]['pageIndex'] + 1, evidence=contexts)
    output.update(kind='visual', status='visual_required', validationStatus='visual_required',
                  note='当前文字链路不能核验实际印章、签名或盖章位置。相关区域仅供人工查看，不以正文公司名代替印文。')
    return output


def check_field(data: dict, name: str, blocks: list[dict]) -> dict:
    if needs_visual(name):
        return visual_field(name, blocks)
    try:
        item = SemanticField.model_validate(data)
    except ValueError:
        return rejected(name, '字段返回结构不符合要求，其他字段继续保留。', 'schema')
    if item.kind == 'visual':
        return visual_field(name, blocks)
    output = base_field(name)
    output.update(kind=item.kind, note=item.note)
    source = {block['ref']: block for block in blocks}
    facts, row_issues = [], []
    if item.kind == 'text':
        if item.items or item.table or item.decision:
            return rejected(name, '文本字段混入了明细或判断结构。', 'schema')
        fact = checked_fact({'raw_value': item.raw_value, 'evidence': [quote.model_dump() for quote in item.evidence]}, source)
        facts = [fact]
        output.update(value=fact['value'], raw=fact['raw'])
    elif item.kind in {'list', 'judgment'}:
        if not item.items or item.raw_value is not None or item.table or (item.kind == 'judgment' and not item.decision):
            return rejected(name, '多段摘录或判断需要分别提供带依据的 items。', 'schema')
        facts = [checked_fact(data, source, f'摘录{index + 1}') for index, data in enumerate(item.items)]
        output['items'] = facts
        output['raw'] = '\n'.join(fact['raw'] for fact in facts if fact['status'] == 'pending')
        if item.kind == 'judgment':
            output['decision'] = item.decision
            output['value'] = {'yes': '是', 'no': '否', 'uncertain': '无法确定'}[item.decision]
            output['note'] = '模型基于下列原文作出的判断，需人工核验。' + item.note
        else:
            output['value'] = '\n'.join((fact['label'] + '：' if fact['label'] else '') + fact['value'] for fact in facts if fact['status'] == 'pending')
    elif item.kind == 'table':
        if not item.table or item.raw_value is not None or item.items or item.decision:
            return rejected(name, '表格字段需要 columns 和 rows。', 'schema')
        columns = [value.strip() for value in item.table.columns]
        if any(not value or len(value) > 40 for value in columns) or len(set(columns)) != len(columns):
            return rejected(name, '表格列名为空或重复。', 'schema')
        rows = []
        for row_index, row in enumerate(item.table.rows):
            cells = row.get('cells')
            if not isinstance(cells, list) or len(cells) != len(columns):
                cells = [{} for _ in columns]
                row_issues.append(f'第{row_index + 1}行的列数不完整。')
                validated = [{**checked_fact({}, source, column), 'status': 'rejected', 'issue': '明细行列数不完整。'} for column in columns]
            else:
                validated = [checked_fact(cell, source, columns[index]) for index, cell in enumerate(cells)]
            row_refs = {evidence['rowRef'] for fact in validated for evidence in fact['evidence'] if evidence.get('rowRef')}
            issue = ''
            if len(row_refs) > 1:
                issue = f'第{row_index + 1}行混用了不同原文行的单元格，行关联待核对。'
            elif any(evidence.get('tableRows') for fact in validated for evidence in fact['evidence']):
                issue = f'第{row_index + 1}行仅引用整表，尚未核对原文单元格关联。'
            if issue:
                row_issues.append(issue)
            facts.extend(validated)
            rows.append({'cells': validated, 'status': 'rejected' if issue or any(fact['status'] == 'rejected' for fact in validated) else 'pending', 'issue': issue})
        output['table'] = {'columns': columns, 'rows': rows}
        output['raw'] = json.dumps([{column: cell['raw'] for column, cell in zip(columns, row['cells'])} for row in rows], ensure_ascii=False)
        output['value'] = '\n'.join('；'.join(f'{column}：{cell["value"] or ("待核对" if cell["status"] == "rejected" else "未列明")}' for column, cell in zip(columns, row['cells'])) for row in rows)
    for index, fact in enumerate(facts):
        if fact['status'] == 'rejected':
            output['issues'].append({'path': f'{name}[{index + 1}]', 'code': 'evidence', 'message': fact['issue']})
    output['issues'].extend({'path': name, 'code': 'row_association', 'message': message} for message in row_issues)
    attach_evidence(output, facts)
    for block in output['evidence']:
        if block.get('source') == 'mineru' and re.search(r'(?:结算|审核|合同|当批)金额的\s*\d{1,2}(?:\.\d+)?\s*$', block['text']):
            message = '原文 OCR 在金额比例处截断，请对照页面核对完整条款。'
            output['issues'].append({'path': name, 'code': 'ocr_incomplete', 'message': message})
            output['note'] = message + output['note']
    if output['issues']:
        output.update(status='rejected', validationStatus='partial' if output['evidence'] else 'rejected')
        if item.kind == 'judgment':
            output.update(value='', decision='uncertain')
        output['note'] = f'{len(output["issues"])} 项依据或结构待核对；已通过的摘录保留。' + output['note']
    elif output['evidence']:
        output.update(status='pending', validationStatus='passed')
    else:
        output.update(value='', status='missing', validationStatus='missing')
        output['note'] = output['note'] or '未找到有原文依据的内容。'
    return output


def validate_fields(data: dict, blocks: list[dict], expected_names: list[str] | None = None) -> list[dict]:
    if not isinstance(data, dict) or set(data) != {'fields'} or not isinstance(data['fields'], list) or not 1 <= len(data['fields']) <= 30:
        raise ValueError('模型响应缺少有效的 fields 数组。')
    requested = list(dict.fromkeys(expected_names or []))
    by_name = {}
    for index, item in enumerate(data['fields']):
        raw_name = item.get('name') if isinstance(item, dict) else None
        name = raw_name.strip() if isinstance(raw_name, str) and 0 < len(raw_name.strip()) <= 40 else f'未命名字段{index + 1}'
        if requested and name not in requested:
            aliases = next((group for group in ALIASES if name in group), [])
            name = next((candidate for candidate in requested if candidate in aliases), name)
        by_name.setdefault(name, []).append(item)
    output = []
    for name in requested or list(by_name):
        if needs_visual(name):
            output.append(visual_field(name, blocks))
        elif name not in by_name:
            output.append(rejected(name, '模型未返回此字段，请调整要求或单独重试。', 'omitted'))
        elif len(by_name[name]) > 1:
            output.append(rejected(name, '模型返回重复字段名称，未自动选择。', 'duplicate'))
        elif name.startswith('未命名字段'):
            output.append(rejected(name, '模型未提供有效字段名称。', 'schema'))
        else:
            output.append(check_field(by_name[name][0], name, blocks))
    return output
