"""Conservative label matching over actual MinerU output; no generated values."""
from __future__ import annotations
import re
import unicodedata
from bs4 import BeautifulSoup

ALIASES = [
    ['提交人', '提交人员'], ['通讯地址', '通信地址', '联系地址'],
    ['最终审核人员', '最终审核人', '终审人员', '终审人'],
    ['初审人员', '初审人'], ['联系电话', '手机号码', '手机号', '电话'],
    ['申请日期', '申请时间'], ['审核日期', '审核时间'],
    ['甲方名称', '甲方（采购方）', '甲方'], ['乙方名称', '乙方（供应商）', '乙方'],
    ['合同金额', '含税总金额', '合同总金额'], ['签订日期', '签署日期'],
]

def normalize(value: str) -> str:
    return re.sub(r'\s+', '', unicodedata.normalize('NFKC', value))

def content_text(value) -> str:
    if isinstance(value, str):
        if '<table' in value.lower():
            soup = BeautifulSoup(value, 'html.parser')
            return '\n'.join('：'.join(cell.get_text(' ', strip=True) for cell in row.find_all(['td', 'th']))
                             for row in soup.find_all('tr'))
        return value
    if isinstance(value, list):
        return ''.join(content_text(item) for item in value)
    if isinstance(value, dict):
        return content_text(value.get('content', ''))
    return ''

def read_blocks(data: dict) -> list[dict]:
    if data.get('schema') != 'docvortex.middle' or data.get('schema_version') != '2.0':
        raise ValueError('MinerU 输出协议不兼容，当前支持 docvortex.middle 2.0。')
    if data.get('is_full_document') is not True:
        raise ValueError('文档尚未完整解析，未生成字段结果。')
    blocks = []
    for page in data.get('pages', []):
        idx = page['page_idx']
        if not isinstance(idx, int) or idx < 0:
            raise ValueError('无效的原文页码。')
        # MinerU omits blocks entirely when a page has no recognized content.
        page_blocks = page.get('blocks', [])
        if not isinstance(page_blocks, list):
            raise ValueError('MinerU 页面文字块格式异常，请重新识别。')
        for block in page_blocks:
            bbox = block.get('bbox')
            text = content_text(block.get('content', '')).strip()
            if not text or block.get('type') in ['footer', 'header', 'page_number']:
                continue
            if not isinstance(bbox, list) or len(bbox) != 4 or not all(isinstance(n, (float, int)) for n in bbox):
                continue
            x0, y0, x1, y1 = bbox
            if not (0 <= x0 < x1 <= 1 and 0 <= y0 < y1 <= 1):
                continue
            ref = f'p{idx}-b{block["index"]}'
            kind = 'seal' if block.get('sub_type') == 'seal' else block.get('type', 'text')
            parent = {'pageIndex': idx, 'blockIndex': block['index'], 'bbox': bbox,
                      'text': text, 'ref': ref, 'source': 'mineru', 'blockType': kind}
            if kind == 'table':
                html = ''.join(item.get('content', '') for item in block.get('content', []) if isinstance(item, dict) and isinstance(item.get('content'), str))
                soup = BeautifulSoup(html, 'html.parser')
                rows = []
                for row_index, row in enumerate(soup.find_all('tr')):
                    cells = []
                    for column_index, cell in enumerate(row.find_all(['td', 'th'], recursive=False)):
                        value = cell.get_text(' ', strip=True)
                        if not value:
                            continue
                        cell_ref = f'{ref}-r{row_index}-c{column_index}'
                        cells.append({'ref': cell_ref, 'text': value, 'columnIndex': column_index})
                        blocks.append({**parent, 'ref': cell_ref, 'text': value, 'blockType': 'table_cell',
                                       'tableRef': ref, 'rowRef': f'{ref}-r{row_index}', 'rowIndex': row_index,
                                       'columnIndex': column_index})
                    if cells:
                        rows.append({'rowRef': f'{ref}-r{row_index}', 'cells': cells})
                parent['tableRows'] = rows
            blocks.append(parent)
    return blocks

def match_fields(blocks: list[dict], names: list[str]) -> list[dict]:
    fields = []
    for name in dict.fromkeys(names):
        aliases = next((group for group in ALIASES if name in group), [name])
        aliases = sorted(aliases, key=len, reverse=True)
        hits = []
        for block in blocks:
            for line in block['text'].splitlines():
                parts = re.split(r'[:：]', line, maxsplit=1)
                if len(parts) == 2 and parts[1].strip() and normalize(parts[0]) in [normalize(alias) for alias in aliases]:
                    hits.append((parts[1].strip(), block))
            if normalize(block['text']).rstrip(':：') not in [normalize(alias) for alias in aliases]:
                continue
            x0, y0, x1, y1 = block['bbox']
            nearby = [item for item in blocks if item['pageIndex'] == block['pageIndex'] and item is not block]
            right = [item for item in nearby if item['bbox'][0] >= x1 - .005
                     and item['bbox'][0] - x1 < .4
                     and abs((item['bbox'][1] + item['bbox'][3] - y0 - y1) / 2) < max(y1 - y0, .015)]
            below = [item for item in nearby if 0 <= item['bbox'][1] - y1 <= .035
                     and abs(item['bbox'][0] - x0) < .04]
            candidates = right or below
            if candidates:
                closest = min(candidates, key=lambda item: item['bbox'][0] - x1 if right else item['bbox'][1] - y1)
                known_labels = [normalize(alias) for group in ALIASES for alias in group] + [normalize(item) for item in names]
                if not closest['text'].rstrip().endswith((':', '：')) and normalize(closest['text']) not in known_labels:
                    hits.append((closest['text'], closest))
        unique_values = {normalize(value) for value, _ in hits}
        field = {'key': f'mineru-{name}', 'name': name, 'value': '', 'raw': '', 'page': None,
                 'ref': None, 'aliases': aliases, 'status': 'missing', 'evidence': [],
                 'note': '未匹配到字段标签；可以调整字段名称，或手动补充。'}
        if len(unique_values) == 1:
            value, first = hits[0]
            evidence = {item['ref']: item for _, item in hits}
            field.update(value=value, raw=value, page=first['pageIndex'] + 1, ref=first['ref'],
                         evidence=list(evidence.values()), status='pending', note='按字段标签匹配；高亮对应原文内容块。')
        elif len(unique_values) > 1:
            field['note'] = '发现多个不同候选值，暂不自动选取，请缩小字段范围或人工核对。'
        fields.append(field)
    return fields
