"""Actual seal OCR fragments: independent confidence and stable source provenance."""
import math

ENGINE = 'MinerU / PP-OCR seal / ONNX CPU'
MIN_CONFIDENCE = .85
STATES = {'recognized', 'partial', 'low_confidence'}


def fragments(block):
    recognition = block.get('sealRecognition', {})
    if block.get('blockType') != 'seal' or recognition.get('engine') != ENGINE or recognition.get('status') not in STATES:
        return []
    if block.get('sealParentRef'):
        return [block]
    if 'lines' not in recognition:
        return [block] if recognition['status'] == 'recognized' and block.get('text') else []
    result = []
    for index, line in enumerate(recognition['lines']):
        score, text = line.get('confidence'), line.get('text')
        if not isinstance(score, (int, float)) or not math.isfinite(score) or not 0 <= score <= 1 or not isinstance(text, str) or not text.strip():
            continue
        item = {**block, 'ref': f'{block["ref"]}-s{index}', 'sealParentRef': block['ref'],
                'text': text, 'confidence': score,
                'sealRecognition': {'status': 'recognized' if score >= MIN_CONFIDENCE else 'low_confidence',
                                    'engine': ENGINE, 'confidence': score}}
        # Old cached results keep the real parent region until a page transform
        # is available; never pair a corrected fragment box with an original parent box.
        if 'originalBBox' in line and 'bbox' in line:
            item.update({key: line[key] for key in ('bbox', 'originalBBox', 'originalPolygon', 'originalPageIndex')})
        result.append(item)
    return result


def project(blocks):
    output = []
    for block in blocks:
        rows = fragments(block)
        output.extend(rows if rows else [block])
    return output


def sources(blocks):
    return [fragment for block in blocks for fragment in fragments(block)]


def attach_mapping(blocks, pages):
    from .preprocessing import map_box
    for block in blocks:
        if block.get('blockType') != 'seal' or not block.get('sealRecognition', {}).get('lines'):
            continue
        page = next((page for page in pages if page['number'] == block['pageIndex'] + 1), None)
        if page is None:
            continue
        for line in block['sealRecognition']['lines']:
            points = line['polygon']
            box = [min(p[0] for p in points), min(p[1] for p in points), max(p[0] for p in points), max(p[1] for p in points)]
            original, polygon = map_box(box, page.get('toOriginal', [[1, 0, 0], [0, 1, 0], [0, 0, 1]]))
            line.update(bbox=box, originalBBox=original, originalPolygon=polygon, originalPageIndex=page['number'] - 1)


def candidates(blocks, limit=8):
    return [{'value': block['text'], 'confidence': block['confidence'], 'evidence': [{**block, 'quote': block['text']}]}
            for block in sources(blocks) if block['sealRecognition']['status'] == 'low_confidence'][:limit]
