"""Supplement MinerU-detected seal regions with its existing dedicated CPU OCR."""
from __future__ import annotations

import asyncio
import json
import math
import os
from pathlib import Path
import sys
import time

from PIL import Image

from . import preprocessing
from .progress import report

ENGINE = 'MinerU / PP-OCR seal / ONNX CPU'
MIN_CONFIDENCE = .85
MAX_REGIONS = 16
ROOT = Path(__file__).resolve().parents[2]


def model_directory():
    return Path(os.getenv('WENXI_SEAL_MODEL_DIR', str(preprocessing.MODEL_ROOT)))


def prepare(job, refs=None, *, mode='seal', limit=MAX_REGIONS):
    """Crop the displayed corrected page; retain the crop's exact page transform."""
    regions, crops = [], []
    for block in job.blocks:
        if block.get('blockType') != 'seal':
            continue
        if refs is not None and block['ref'] not in refs:
            continue
        key = 'sealRecognition' if mode == 'seal' else 'textRecovery'
        if block.get(key, {}).get('status') in {'recognized', 'low_confidence', 'empty'}:
            continue
        if len(regions) >= limit:
            if mode == 'seal':
                block[key] = {'status': 'limit', 'engine': ENGINE}
            continue
        page = job.document['pages'][block['pageIndex']]
        path = job.directory / f'page-{page["number"]}.png'
        with Image.open(path) as image:
            x0, y0, x1, y1 = block['bbox']
            if mode == 'text':
                # Recover surrounding label/value rows, not the imprint in the circle.
                x0, x1, y0, y1 = 0., 1., max(0., y0 - .025), min(1., y1 + .025)
            bounds = [max(0, math.floor(x0 * image.width)), max(0, math.floor(y0 * image.height)),
                      min(image.width, math.ceil(x1 * image.width)), min(image.height, math.ceil(y1 * image.height))]
            if bounds[0] >= bounds[2] or bounds[1] >= bounds[3]:
                continue
            crop = image.crop(bounds).convert('RGB')
            crop.thumbnail((1600, 1600))
            destination = job.directory / f'{mode}-crop-{len(regions)}.png'
            crop.save(destination)
            regions.append({'ref': block['ref'], 'image': str(destination.resolve())})
            crops.append({'block': block, 'bounds': [bounds[0] / image.width, bounds[1] / image.height,
                bounds[2] / image.width, bounds[3] / image.height], 'size': crop.size})
            crop.close()
    return regions, crops


def decode_regions(response, crops):
    """Validate all output before applying text; polygons refer to corrected pages."""
    if not isinstance(response, dict):
        raise ValueError('印章识别返回格式无效。')
    rows = response.get('regions', [])
    if not isinstance(rows, list) or len(rows) != len(crops):
        raise ValueError('印章识别返回格式无效。')
    by_ref = {row.get('ref'): row for row in rows if isinstance(row, dict)}
    if len(by_ref) != len(crops):
        raise ValueError('印章识别区域未能对应。')
    updates = []
    for crop in crops:
        block = crop['block']
        row = by_ref.get(block['ref'])
        if not row or not isinstance(row.get('lines'), list) or len(row['lines']) > 32:
            raise ValueError('印章识别区域未能对应。')
        lines = []
        for item in row['lines']:
            if not isinstance(item, dict):
                raise ValueError('印章识别文字格式无效。')
            text, score, polygon = item.get('text'), item.get('confidence'), item.get('polygon')
            if not isinstance(text, str) or len(text) > 1000 or not isinstance(score, (int, float)) or not math.isfinite(score) or not 0 <= score <= 1:
                raise ValueError('印章识别文字或置信度无效。')
            if not isinstance(polygon, list) or not 3 <= len(polygon) <= 1000:
                raise ValueError('印章识别坐标无效。')
            width, height = crop['size']
            x0, y0, x1, y1 = crop['bounds']
            points = []
            for point in polygon:
                if not isinstance(point, list) or len(point) != 2 or not all(isinstance(v, (int, float)) and math.isfinite(v) for v in point):
                    raise ValueError('印章识别坐标无效。')
                if not 0 <= point[0] <= width or not 0 <= point[1] <= height:
                    raise ValueError('印章识别坐标超出裁片。')
                points.append([x0 + point[0] / width * (x1 - x0), y0 + point[1] / height * (y1 - y0)])
            if text.strip():
                if min(p[0] for p in points) >= max(p[0] for p in points) or min(p[1] for p in points) >= max(p[1] for p in points):
                    raise ValueError('印章识别坐标退化。')
                lines.append({'text': text.strip(), 'confidence': score, 'polygon': points})
        state = 'empty' if not lines else 'recognized' if all(item['confidence'] >= MIN_CONFIDENCE for item in lines) else 'low_confidence'
        updates.append((block, {'status': state, 'engine': ENGINE, 'lines': lines,
            'confidence': min((line['confidence'] for line in lines), default=0)}))
    return updates


def apply(job, response, crops):
    """Only actual crop OCR can supply imprint text; no body-text fallback."""
    for block, result in decode_regions(response, crops):
        block['sealRecognition'] = result
        # Preserve low-score candidates for visual review; grounding will not accept them.
        block['text'] = '\n'.join(line['text'] for line in result['lines'])
    preprocessing.attach_mapping(job.blocks, job.document['pages'])


async def enrich(job, refs=None):
    if os.getenv('WENXI_SEAL_OCR', 'on') == 'off' or not job.document:
        return
    regions = [block for block in job.blocks if block.get('blockType') == 'seal' and (refs is None or block['ref'] in refs)]
    if not regions:
        return
    if all(block.get('sealRecognition', {}).get('status') in {'recognized', 'low_confidence', 'empty'} for block in regions):
        return
    started = time.monotonic()
    report(job, 'seal-ocr', '正在识别印章文字', detail=f'{len(regions)} 个印章区域')
    try:
        payload, crops = prepare(job, refs)
        if not payload:
            return
        response = await call_worker(job, payload)
        apply(job, response, crops)
        report(job, 'seal-ocr', '印章文字识别已完成', 'done', '识别结果仍需对照原图核验')
    except (ValueError, OSError, asyncio.TimeoutError, ImportError):
        for block in regions:
            if 'sealRecognition' not in block:
                block['sealRecognition'] = {'status': 'unavailable', 'engine': ENGINE}
        report(job, 'seal-ocr', '印章文字未完成识别', 'error', '已保留印章区域，请对照原图核验')
    finally:
        job.document['sealRecognition'] = {'engine': ENGINE, 'regions': len(regions),
            'recognized': sum(block.get('sealRecognition', {}).get('status') == 'recognized' for block in regions),
            'elapsedMs': round((time.monotonic() - started) * 1000)}


async def call_worker(job, payload, *, mode='seal'):
    """One offline worker; keep credentials out and release it on every exit path."""
    try:
        worker_env = {key: os.environ[key] for key in ('PATH', 'HOME', 'LANG', 'LC_ALL', 'TZ',
            'SYSTEMROOT', 'WINDIR', 'TMPDIR', 'TEMP', 'TMP', 'LD_LIBRARY_PATH') if key in os.environ}
        worker_env.update({'MINERU_HOME': str(ROOT / '.runtime/wenxi-seal-cache'),
            'MINERU_MODEL_BASE_DIR': str(ROOT / '.runtime/wenxi-seal-cache'),
            'MINERU_MODEL_SOURCE': 'local', 'HF_HUB_OFFLINE': '1',
            'OMP_NUM_THREADS': '1', 'OPENBLAS_NUM_THREADS': '1',
            'MINERU_INTRA_OP_NUM_THREADS': '1', 'MINERU_INTER_OP_NUM_THREADS': '1'})
        creation = asyncio.create_task(asyncio.create_subprocess_exec(sys.executable,
            str(Path(__file__).with_name('seal_worker.py')), stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
            env=worker_env))
        try:
            job.process = await asyncio.shield(creation)
        except asyncio.CancelledError:
            job.process = await creation
            raise
        content = json.dumps({'modelDir': str(model_directory()), 'cacheDir': str(ROOT / '.runtime/wenxi-seal-cache'), 'regions': payload, 'mode': mode}).encode()
        stdout, _ = await asyncio.wait_for(job.process.communicate(content), timeout=60)
        if job.process.returncode or len(stdout) > 1024 * 1024:
            raise ValueError('印章 OCR 暂不可用。')
        return json.loads(stdout)
    finally:
        if job.process and job.process.returncode is None:
            try:
                job.process.terminate()
            except ProcessLookupError:
                pass
            try:
                await asyncio.wait_for(job.process.wait(), 3)
            except asyncio.TimeoutError:
                job.process.kill()
                await job.process.wait()
        job.process = None
