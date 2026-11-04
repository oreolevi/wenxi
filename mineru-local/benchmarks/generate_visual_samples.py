"""Generate raster-only fictional probes; no credentials or external API calls.

Handwritten digits: MNIST, Yann LeCun and Corinna Cortes, CC BY-SA 3.0.
The composed lines are synthetic arrangements, not natural handwriting samples.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageOps
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader

WIDTH, HEIGHT = 1240, 1754
MNIST_HASH = '731c5ac602752760c8e48fbffcf8c3b850d9dc2a2aedcf2cc48468fc17b673d1'
VALUES = {'申请单位': '星河演示采购中心', '申请金额': '12860.00', '申请日期': '2026-11-04'}
SEAL = {'印章单位': '星河演示科技有限公司', '印章类别': '演示专用章'}
CASES = [
    ('clean', '清晰印刷对照'), ('watermark-light', '浅色水印'),
    ('watermark-dense', '密集水印覆盖'), ('handwritten-digits', '手写数字拼接'),
    ('seal-only', '独立虚构印章'), ('seal-overlap', '印章覆盖正文'),
]


def generate(output: Path, pdf_path: Path, dataset: Path, font_path: Path):
    if hashlib.sha256(dataset.read_bytes()).hexdigest() != MNIST_HASH:
        raise ValueError('MNIST checksum mismatch')
    output.mkdir(parents=True, exist_ok=True)
    pdf_path.parent.mkdir(parents=True, exist_ok=True)
    with np.load(dataset, allow_pickle=False) as data:
        images, labels = data['x_test'], data['y_test']
    rng = np.random.default_rng(20261104)
    chosen_digits = []

    def font(size):
        return ImageFont.truetype(str(font_path), size)

    def handwriting(page, text, x, y, field):
        draw = ImageDraw.Draw(page)
        indices = []
        for char in text:
            if char.isdigit():
                index = int(rng.choice(np.flatnonzero(labels == int(char))))
                indices.append({'digit': char, 'testIndex': index})
                glyph = Image.fromarray(255 - images[index])
                glyph = glyph.crop(ImageOps.invert(glyph).getbbox())
                height = 48 + int(rng.integers(-3, 4))
                width = max(12, round(glyph.width * height / glyph.height))
                glyph = glyph.resize((width, height), Image.Resampling.LANCZOS)
                page.paste(glyph, (x, y + int(rng.integers(-3, 4))))
                x += width + 7
            elif char == '.':
                draw.ellipse((x + 1, y + 44, x + 6, y + 49), fill='#172033')
                x += 13
            else:
                draw.line((x + 1, y + 26, x + 17, y + 25), fill='#172033', width=3)
                x += 26
        chosen_digits.append({'field': field, 'digits': indices})

    def stamp(size):
        image = Image.new('RGBA', (520, 520))
        draw = ImageDraw.Draw(image)
        red = (200, 34, 43, 230)
        draw.ellipse((25, 25, 495, 495), outline=red, width=9)
        draw.ellipse((38, 38, 482, 482), outline=red, width=2)
        text = SEAL['印章单位']
        for index, char in enumerate(text):
            angle = 158 - index * 136 / (len(text) - 1)
            radians = math.radians(angle)
            x, y = 260 + 194 * math.cos(radians), 260 - 194 * math.sin(radians)
            tile = Image.new('RGBA', (80, 80))
            ImageDraw.Draw(tile).text((40, 40), char, font=font(43), fill=red, anchor='mm')
            tile = tile.rotate(angle - 90, resample=Image.Resampling.BICUBIC, expand=True)
            image.alpha_composite(tile, (round(x - tile.width / 2), round(y - tile.height / 2)))
        points = []
        for index in range(10):
            angle = -math.pi / 2 + index * math.pi / 5
            radius = 61 if index % 2 == 0 else 25
            points.append((260 + radius * math.cos(angle), 260 + radius * math.sin(angle)))
        draw.polygon(points, fill=red)
        draw.text((260, 360), SEAL['印章类别'], font=font(43), fill=red, anchor='mm')
        return image.resize((size, size), Image.Resampling.LANCZOS)

    def watermark(page, dense):
        layer = Image.new('RGBA', page.size)
        draw = ImageDraw.Draw(layer)
        color = (88, 105, 130, 105 if dense else 28)
        for y in range(200, HEIGHT, 330 if dense else 600):
            for x in range(-120, WIDTH, 480 if dense else 700):
                tile = Image.new('RGBA', (500, 160))
                ImageDraw.Draw(tile).text((12, 15), '内部测试', font=font(106), fill=color)
                tile = tile.rotate(28, expand=True, resample=Image.Resampling.BICUBIC)
                layer.alpha_composite(tile, (x, y))
        page.alpha_composite(layer)

    rows = []
    pdf = canvas.Canvas(str(pdf_path), pagesize=(595.28, 841.89), invariant=1)
    pdf.setTitle('视觉识别验证样例（全部虚构）')
    for number, (case_id, title) in enumerate(CASES, 1):
        page = Image.new('RGBA', (WIDTH, HEIGHT), 'white')
        draw = ImageDraw.Draw(page)
        draw.text((100, 88), '材料识别验证样例', font=font(51), fill='#172033')
        draw.text((103, 171), f'{number:02d}  {title}  /  全部业务内容均为虚构', font=font(29), fill='#68758a')
        draw.line((100, 240, 1140, 240), fill='#d6deeb', width=3)
        fields = {} if case_id == 'seal-only' else dict(VALUES)
        if fields:
            for index, (name, value) in enumerate(fields.items()):
                y = 365 + index * 180
                draw.text((110, y), name + '：', font=font(39), fill='#172033')
                if case_id == 'handwritten-digits' and name != '申请单位':
                    handwriting(page, value, 430, y + 6, name)
                else:
                    draw.text((430, y), value, font=font(41), fill='#172033')
                draw.line((430, y + 68, 1110, y + 68), fill='#d6deeb', width=2)
            draw.text((110, 1000), '用途说明：虚构的物料采购申请。', font=font(33), fill='#172033')
        if case_id.startswith('watermark-'):
            watermark(page, case_id == 'watermark-dense')
        if case_id == 'seal-only':
            page.alpha_composite(stamp(620), (310, 490))
            draw.text((110, 1230), '仅识别印文及位置，不用于印章真伪或身份核验。', font=font(28), fill='#68758a')
        elif case_id == 'seal-overlap':
            page.alpha_composite(stamp(390), (490, 395))
        draw = ImageDraw.Draw(page)
        note = '数字字形取自 MNIST，按虚构金额与日期拼接；不代表中文手写或自然整行书写。' if case_id == 'handwritten-digits' else '本页用于技术探测，不能作为真实业务准确率或印章真伪的证明。'
        draw.text((100, 1535), note, font=font(23), fill='#68758a')
        draw.text((100, 1600), f'文析 / 虚构验证 / {number} of {len(CASES)}', font=font(24), fill='#68758a')
        raster = page.convert('RGB')
        png = output / f'{case_id}.png'
        raster.save(png)
        pdf.drawImage(ImageReader(raster), 0, 0, width=595.28, height=841.89)
        pdf.showPage()
        rows.append({'id': case_id, 'title': title, 'page': number, 'image': png.name,
                     'expectedFields': fields, 'expectedSeal': SEAL if case_id.startswith('seal-') else {},
                     'watermarkText': '内部测试' if case_id.startswith('watermark-') else ''})
    pdf.save()
    manifest = {'schemaVersion': 1, 'fictional': True, 'pdf': str(pdf_path.resolve()),
                'sha256': hashlib.sha256(pdf_path.read_bytes()).hexdigest(), 'cases': rows,
                'handwriting': {'dataset': 'MNIST test set', 'authors': 'Yann LeCun and Corinna Cortes',
                    'source': 'https://keras.io/api/datasets/mnist/', 'license': 'CC BY-SA 3.0',
                    'datasetSha256': MNIST_HASH, 'selection': chosen_digits,
                    'limitation': '单字数字拼接；未覆盖自然手写中文、连笔或签名身份核验。'}}
    (output / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    return manifest


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--pdf', type=Path, required=True)
    parser.add_argument('--mnist', type=Path, required=True)
    parser.add_argument('--font', type=Path, required=True)
    args = parser.parse_args()
    result = generate(args.output, args.pdf, args.mnist, args.font)
    print(json.dumps({'pages': len(result['cases']), 'sha256': result['sha256']}, ensure_ascii=False))
