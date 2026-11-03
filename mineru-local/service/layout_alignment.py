"""Align fixed regions after deskew adds blank margins; evidence stays in input space."""
import math
import re
from statistics import median
import unicodedata


def normalized(text):
    return re.sub(r'\s+', '', unicodedata.normalize('NFKC', text))


def anchors(sample, page_index, keywords):
    found = {}
    for block in sample['blocks']:
        if block['pageIndex'] != page_index or block.get('blockType') in {'table', 'table_cell', 'seal'}:
            continue
        text = normalized(block['text'])
        # Use static labels and explicitly configured headings, never extracted values.
        prefix = text.split(':', 1)[0] if ':' in text else ''
        key = 'label:' + prefix if 2 <= len(prefix) <= 30 else 'heading:' + text if text in keywords else ''
        if key:
            found.setdefault(key, []).append(block['bbox'])
    return {key: boxes[0] for key, boxes in found.items() if len(boxes) == 1}


def box_incoming(box, transform):
    if transform is None:
        return list(box)
    sx, sy, tx, ty = transform
    return [max(0., min(1., x)) for x in [box[0]*sx+tx, box[1]*sy+ty, box[2]*sx+tx, box[3]*sy+ty]]


def transforms(reference, incoming, template):
    if len(reference['pages']) != len(incoming['pages']):
        return None
    output = []
    keywords = {normalized(k) for k in template.get('matchTexts', [])}
    for index, (first, second) in enumerate(zip(reference['pages'], incoming['pages'])):
        if abs(first.get('deskewAngle', 0) - second.get('deskewAngle', 0)) < .3:
            output.append(None)
            continue
        a, b = anchors(reference, index, keywords), anchors(incoming, index, keywords)
        pairs = [(a[key], b[key]) for key in a.keys() & b.keys()]
        if len(pairs) < 3:
            return None
        centers = [(sum(x[1::2])/2, sum(y[1::2])/2) for x,y in pairs]
        if max(x for x,_ in centers)-min(x for x,_ in centers) < .2:
            return None
        slopes = [(y1-y0)/(x1-x0) for x0,y0 in centers for x1,y1 in centers if x1-x0 > .15]
        if not slopes:
            return None
        sy = median(slopes)
        # Blank padding changes normalized X/Y scales differently; physical scale stays uniform.
        sx = sy * (first['width']/first['height']) / (second['width']/second['height'])
        ty = median(y-sy*x for x,y in centers)
        tx = median(y[0]-sx*x[0] for x,y in pairs)
        transform = [sx, sy, tx, ty]
        if not all(math.isfinite(v) for v in transform) or not (.85 <= sx <= 1.15 and .85 <= sy <= 1.15 and abs(tx) <= .08 and abs(ty) <= .08):
            return None
        if any(abs(y-sy*x-ty) > .015 for x,y in centers) or any(abs(y[0]-sx*x[0]-tx) > .02 for x,y in pairs):
            return None
        output.append(transform)
    return output
