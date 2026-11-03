"""Shared, deterministic page preparation. Coordinates refer to displayed upload pages.

The OCR sessions are reused from MinerU's installed PP-OCR models; no remote calls or
model downloads occur here. Each inverse transform is retained for source grounding.
"""
from copy import deepcopy
from io import BytesIO
from pathlib import Path
import re
import threading
import time
from typing import Literal

import cv2
import numpy as np
from PIL import Image
import pypdfium2 as pdfium
from pydantic import BaseModel, ConfigDict

from .source_text import prefer_pdf_text
from .progress import report


class Policy(BaseModel):
    model_config = ConfigDict(extra='forbid')
    orientation: Literal['auto', 'off', '90', '180', '270'] = 'auto'
    deskew: Literal['auto', 'off'] = 'auto'
    grouping: Literal['auto', 'document', 'per_page'] = 'auto'


OCR_LOCK = threading.RLock()
_ocr = None
MODEL_ROOT = Path(__file__).resolve().parents[2] / '.runtime/mineru-data/models/MinerU-4_models_onnx/OCR/paddleocr'


def recognize(image):
    global _ocr
    with OCR_LOCK:
        if _ocr is None:
            from mineru.model.ocr.pp_ocr_v6_onnx import PPOCRv6ONNX
            det, rec = MODEL_ROOT / 'ch_PP-OCRv6_tiny_det_infer.onnx', MODEL_ROOT / 'ch_PP-OCRv6_small_rec_infer.onnx'
            if not det.is_file() or not rec.is_file():
                raise ValueError('本机缺少 PP-OCR 识别模型，请先完成 MinerU 模型配置。')
            _ocr = PPOCRv6ONNX(det_model_path=str(det), rec_model_path=str(rec), device='cpu', intra_op_num_threads=4)
        return _ocr.ocr(np.asarray(image.convert('RGB'))[:, :, ::-1].copy())[0] or []


def rotation_inverse(angle):
    # PIL positive angles are counterclockwise. Normalized processed -> original.
    return np.array({0: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
                     90: [[0, -1, 1], [1, 0, 0], [0, 0, 1]],
                     180: [[-1, 0, 1], [0, -1, 1], [0, 0, 1]],
                     270: [[0, 1, 0], [-1, 0, 1], [0, 0, 1]]}[angle], dtype=float)


def map_box(box, inverse):
    points = np.array([[box[0], box[1], 1], [box[2], box[1], 1],
                       [box[2], box[3], 1], [box[0], box[3], 1]]) @ np.array(inverse).T
    points = points[:, :2] / points[:, 2:]
    points = np.clip(points, 0, 1)
    return [float(points[:, 0].min()), float(points[:, 1].min()), float(points[:, 0].max()), float(points[:, 1].max())], points.tolist()


def orientation_score(lines):
    # Recognizers can turn *individual* vertical crops; confidence alone would pick
    # the sideways page. Reward legible horizontal lines, penalize vertical ones.
    score = 0.
    for quad, (text, confidence) in lines:
        points = np.asarray(quad)
        width, height = np.ptp(points[:, 0]), np.ptp(points[:, 1])
        weight = min(30, len(re.sub(r'\W', '', text)))
        score += weight * float(confidence) ** 3 * (1 if width > height * 1.3 else -.65)
    return score


def orient(image, mode, recognize_fn=recognize):
    probe = image.copy()
    probe.thumbnail((1500, 1500))
    angles = [0] if mode == 'off' else [int(mode)] if mode != 'auto' else [0, 90, 180, 270]
    candidates = []
    for angle in angles:
        turned = probe.rotate(angle, expand=True)
        lines = recognize_fn(turned)
        candidates.append((orientation_score(lines), angle, turned, lines))
    candidates.sort(key=lambda item: item[0], reverse=True)
    best = candidates[0]
    margin = (best[0] - candidates[1][0]) / max(abs(best[0]), 1) if len(candidates) > 1 else 1.
    uncertain = not best[3] or best[0] <= 0 or mode == 'auto' and margin < .12
    # Ambiguous pages stay unchanged; fixed rules must ask for review instead.
    if uncertain and mode == 'auto':
        best = next(item for item in candidates if item[1] == 0)
    return best[2], best[3], best[1], uncertain, round(margin, 3)


def text_tilt(image):
    """Fallback for text pages with too few long edges to estimate with Hough lines."""
    gray = np.asarray(image.convert('L'))
    height, width = gray.shape
    scale = min(1., 1000 / max(height, width))
    gray = cv2.resize(gray, (round(width * scale), round(height * scale)))
    height, width = gray.shape
    _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV | cv2.THRESH_OTSU)
    if np.count_nonzero(binary) < 200 or np.count_nonzero(np.sum(binary > 0, axis=1) > 3) < 40:
        return 0.

    def score(angle):
        matrix = cv2.getRotationMatrix2D((width / 2, height / 2), float(angle), 1)
        rotated = cv2.warpAffine(binary, matrix, (width, height), flags=cv2.INTER_NEAREST, borderValue=0)
        rows = np.sum(rotated > 0, axis=1).astype(float)
        return float(np.sum(rows * rows) / max(1., rows.sum()))

    baseline = score(0)
    coarse = max(np.arange(-5.5, 5.6, .5), key=score)
    angle = float(max(np.arange(coarse - .4, coarse + .41, .1), key=score))
    # Require a meaningful improvement; normal or weakly structured pages stay unchanged.
    return angle if .4 <= abs(angle) < 5.8 and score(angle) >= baseline * 1.06 else 0.


def deskew(image):
    gray = cv2.cvtColor(np.asarray(image), cv2.COLOR_RGB2GRAY)
    edges = cv2.Canny(gray, 70, 180)
    lines = cv2.HoughLinesP(edges, 1, np.pi / 1800, 80, minLineLength=max(100, image.width // 5), maxLineGap=12)
    slopes = []
    if lines is not None:
        for x1, y1, x2, y2 in np.asarray(lines).reshape(-1, 4):
            angle = np.degrees(np.arctan2(float(y2 - y1), float(x2 - x1)))
            angle = (angle + 45) % 90 - 45
            if abs(angle) < 6:
                slopes.append(angle)
    angle = text_tilt(image)
    if not angle and len(slopes) >= 4:
        candidate = float(np.median(slopes))
        if np.median(np.abs(np.array(slopes) - candidate)) <= .65:
            angle = candidate
    if abs(angle) < .4:
        return image, np.eye(3), 0.
    # Positive OpenCV angle corrects positive downward image slopes.
    width, height = image.size
    affine = cv2.getRotationMatrix2D((width / 2, height / 2), angle, 1)
    # Expand the canvas so corner text is not clipped during correction.
    cos, sin = abs(affine[0, 0]), abs(affine[0, 1])
    new_w, new_h = int(np.ceil(height * sin + width * cos)), int(np.ceil(height * cos + width * sin))
    affine[:, 2] += [(new_w - width) / 2, (new_h - height) / 2]
    corrected = cv2.warpAffine(np.asarray(image), affine, (new_w, new_h), borderValue=(255, 255, 255))
    forward = np.vstack([affine, [0, 0, 1]])
    inverse = np.diag([1 / width, 1 / height, 1]) @ np.linalg.inv(forward) @ np.diag([new_w, new_h, 1])
    return Image.fromarray(corrected), inverse, round(angle, 3)


def group_pages(pages, blocks, strategy):
    if strategy == 'per_page':
        groups = [[page['number']] for page in pages]
    elif strategy == 'auto':
        identities = []
        for page in pages:
            text = ''.join(block['text'] for block in blocks if block['pageIndex'] == page['number'] - 1)
            is_invoice = '发票' in text and ('增值税' in text or '电子发票' in text)
            number = re.search(r'(?:发票号码|发票号)[：:\s]*(\d{8,20})', text)
            identities.append(number.group(1) if is_invoice and number else None)
        # A heading alone is insufficient to split a contract or an invoice annex.
        if identities and all(identities) and len(set(identities)) == len(identities):
            groups = [[page['number']] for page in pages]
        else:
            groups = [[page['number'] for page in pages]]
    else:
        groups = [[page['number'] for page in pages]]
    return [{'id': f'unit-{index + 1}', 'pages': group, 'label': f'第 {index + 1} 份',
             'needsReview': any(page.get('needsReview') for page in pages if page['number'] in group)} for index, group in enumerate(groups)]


def attach_mapping(blocks, pages):
    for block in blocks:
        page = pages[block['pageIndex']]
        box, polygon = map_box(block['bbox'], page.get('toOriginal', np.eye(3)))
        block.update(originalPageIndex=page['number'] - 1, originalBBox=box, originalPolygon=polygon)
    return blocks


def process(job, canonical, pdf_lock, *, cloud=False):
    """Recognize once for fixed rules; prepare a canonical PDF for layout parsing."""
    started = time.perf_counter()
    policy = Policy.model_validate(getattr(job, 'preprocessing_policy', None) or {}).model_dump()
    with pdf_lock:
        text_blocks, text_sources = prefer_pdf_text(canonical, [])
        with pdfium.PdfDocument(canonical) as pdf:
            count = len(pdf)
    pages, blocks, changed = [], [], set()
    for index in range(count):
        if job.status == 'cancelled':
            raise ValueError('处理已停止。')
        number = index + 1
        tick = time.perf_counter()
        report(job, f'prepare-{number}', f'正在处理第 {number}/{count} 页', detail='检查文字层、方向与倾斜')
        with pdf_lock, pdfium.PdfDocument(canonical) as pdf:
            page = pdf[index]
            bitmap = page.render(scale=min(1.8, 2000 / max(page.get_size())))
            image = bitmap.to_pil().convert('RGB').copy()
            bitmap.close()
            page.close()
        image.save(job.directory / f'original-{number}.png')
        original_size = image.size
        inverse = np.eye(3)
        steps = []
        page_blocks = [deepcopy(block) for block in text_blocks if block['pageIndex'] == index]
        usable_text = number in text_sources['pdfTextPages'] and policy['orientation'] in {'auto', 'off'}
        if usable_text:
            steps.append({'tool': 'text_layer', 'status': 'used', 'label': '使用 PDF 文字层'})
            angle, tilt, uncertain, margin = 0, 0, False, 1
        else:
            if cloud:
                from .page_orientation import predict
                angle, uncertain, margin = predict(image) if policy['orientation'] == 'auto' else (0 if policy['orientation'] == 'off' else int(policy['orientation']), False, 1.)
                if angle:
                    image = image.rotate(angle, expand=True)
                lines = []
            else:
                image, lines, angle, uncertain, margin = orient(image, policy['orientation'])
            inverse = rotation_inverse(angle)
            steps.append({'tool': 'orientation', 'status': 'review' if uncertain else 'applied' if angle else 'skipped', 'angle': angle,
                          'label': '方向待核对' if uncertain else f'逆时针转正 {angle}°' if angle else '方向正常'})
            tilt = 0
            if policy['deskew'] == 'auto':
                image, deskew_inverse, tilt = deskew(image)
                inverse = inverse @ deskew_inverse
                if tilt and not cloud:
                    lines = recognize(image)
            steps.append({'tool': 'deskew', 'status': 'applied' if tilt else 'skipped', 'angle': tilt,
                          'label': f'校正倾斜 {tilt}°' if tilt else '无需倾斜校正'})
            page_blocks = []
            for quad, (text, confidence) in lines:
                if not text.strip():
                    continue
                points = np.asarray(quad)
                box = [max(0., float(points[:, 0].min() / image.width)), max(0., float(points[:, 1].min() / image.height)),
                       min(1., float(points[:, 0].max() / image.width)), min(1., float(points[:, 1].max() / image.height))]
                if box[0] >= box[2] or box[1] >= box[3]:
                    continue
                page_blocks.append({'ref': f'p{index}-ocr-{len(page_blocks)}', 'pageIndex': index, 'blockIndex': len(page_blocks),
                                    'text': text.strip(), 'bbox': box, 'confidence': float(confidence), 'source': 'mineru', 'blockType': 'text'})
            steps.append({'tool': 'ocr', 'status': 'pending' if cloud else 'used', 'label': '等待 MinerU 云端识别' if cloud else f'PP-OCR 识别 {len(page_blocks)} 个文字块'})
            if not page_blocks and not cloud:
                uncertain = True
            if angle or tilt:
                changed.add(index)
        image.save(job.directory / f'page-{number}.png')
        pages.append({'number': number, 'width': image.width, 'height': image.height,
                      'imageUrl': f'/api/documents/{job.id}/pages/{number}.png',
                      'originalImageUrl': f'/api/documents/{job.id}/original-pages/{number}.png',
                      'originalWidth': original_size[0], 'originalHeight': original_size[1],
                      'toOriginal': inverse.tolist(), 'rotation': angle, 'deskewAngle': tilt, 'directionMargin': margin,
                      'needsReview': uncertain, 'steps': steps, 'elapsedMs': round((time.perf_counter() - tick) * 1000, 1)})
        blocks.extend(page_blocks)
        image.close()
        report(job, f'prepare-{number}', f'第 {number} 页已处理', 'done', ' · '.join(step['label'] for step in steps))
    # Retain native text/vector pages unchanged. Only transformed scans are rasterized.
    if changed:
        from pypdf import PdfReader, PdfWriter
        writer, reader = PdfWriter(), PdfReader(canonical)
        buffers = []
        for index in range(count):
            if index in changed:
                buffer = BytesIO()
                with Image.open(job.directory / f'page-{index + 1}.png') as image:
                    image.save(buffer, format='PDF', resolution=108)
                buffers.append(buffer)
                writer.add_page(PdfReader(buffer).pages[0])
            else:
                writer.add_page(reader.pages[index])
        canonical = job.directory / 'prepared.pdf'
        with canonical.open('wb') as stream:
            writer.write(stream)
    sources = {'pdfTextPages': [page['number'] for page in pages if page['steps'][0]['tool'] == 'text_layer'],
               'ocrPages': [page['number'] for page in pages if page['steps'][0]['tool'] != 'text_layer']}
    units = group_pages(pages, blocks, policy['grouping'])
    return {'canonical': canonical, 'pages': pages, 'blocks': attach_mapping(blocks, pages), 'textSources': sources, 'units': units,
            'preprocessing': {'version': 1, 'policy': policy, 'elapsedMs': round((time.perf_counter() - started) * 1000, 1),
                              'pageCount': count, 'unitCount': len(units), 'needsReview': any(page['needsReview'] for page in pages)}}
