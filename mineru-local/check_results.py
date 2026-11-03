"""Check recognition and source geometry in the fictional installation test.

This checks known text in test documents; it is not a business-field extractor.
"""
from pathlib import Path
import json
import re

root = Path(__file__).resolve().parent
expected = [(0, '林晓'), (0, '上海市浦东新区示例路88号12层'),
            (0, '2026年10月29日'), (0, '138****0268'),
            (1, '张宁'), (1, '陈敏'), (1, '同意变更通讯地址')]

def text(value):
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        return ''.join(text(item) for item in value)
    if isinstance(value, dict):
        return text(value.get('content', ''))
    return ''

reports = []
for name in ['text', 'scan-basic', 'scan-standard']:
    source = root / 'output' / f'{name}.middle.json'
    if not source.exists():
        continue
    data = json.loads(source.read_text())
    assert data['schema'] == 'docvortex.middle'
    assert data['schema_version'] == '2.0'
    assert data['is_full_document'] is True
    assert len(data['pages']) == 2
    pages = {page['page_idx']: page['blocks'] for page in data['pages']}
    evidence = []
    for page_idx, value in expected:
        hits = [block for block in pages[page_idx]
                if value in re.sub(r'\s+', '', text(block.get('content', '')))]
        assert len(hits) == 1, f'{name}: expected one match for {value!r}, got {len(hits)}'
        block = hits[0]
        x0, y0, x1, y1 = block['bbox']
        assert 0 <= x0 < x1 <= 1 and 0 <= y0 < y1 <= 1
        evidence.append({'expected_text': value, 'recognized_block': text(block['content']),
                         'page': page_idx + 1, 'block_index': block['index'],
                         'bbox_normalized': block['bbox'], 'coordinate_origin': 'top-left',
                         'granularity': 'block'})
    reports.append({'test': name, 'parser': data['metadata']['producer'],
                    'actual_mode': data['extensions']['mineru'],
                    'pages': len(data['pages']), 'checks_passed': len(evidence),
                    'evidence': evidence})
assert {'text', 'scan-basic'} <= {item['test'] for item in reports}
(root / 'output' / 'recognition-check.json').write_text(
    json.dumps({'fictional_test_only': True, 'results': reports}, ensure_ascii=False, indent=2), encoding='utf-8')
for report in reports:
    print(f"{report['test']}: {report['checks_passed']}/7 known-text and page/bbox checks passed")
