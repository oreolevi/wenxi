"""Bounded ordinary text OCR around detected image regions; never imprint inference."""
import asyncio
import time

from . import preprocessing, seals
from .progress import report


async def enrich(job, refs):
    started = time.monotonic()
    payload = []
    try:
        payload, crops = seals.prepare(job, refs, mode='text', limit=2)
        if not payload:
            return False
        report(job, 'region-ocr', '正在补充识别局部正文', detail=f'{len(payload)} 个候选区域')
        response = await seals.call_worker(job, payload, mode='text')
        updates = seals.decode_regions(response, crops)
        additions = []
        for block, result in updates:
            lines = [line for line in result['lines'] if line['confidence'] >= seals.MIN_CONFIDENCE]
            for line in lines:
                points = line['polygon']
                index = max((item['blockIndex'] for item in job.blocks + additions if item['pageIndex'] == block['pageIndex']), default=-1) + 1
                additions.append({'ref': f'p{block["pageIndex"]}-recovery-{index}', 'pageIndex': block['pageIndex'],
                    'blockIndex': index, 'bbox': [min(p[0] for p in points), min(p[1] for p in points),
                                                max(p[0] for p in points), max(p[1] for p in points)],
                    'text': line['text'], 'source': 'mineru', 'blockType': 'ocr_recovery',
                    'confidence': line['confidence'], 'recoverySourceRef': block['ref']})
            block['textRecovery'] = {'status': 'recognized' if lines else 'empty'}
        job.blocks.extend(additions)
        preprocessing.attach_mapping(job.blocks, job.document['pages'])
        report(job, 'region-ocr', '局部正文补识别已完成', 'done', f'新增 {len(additions)} 个可核对文字块')
        return bool(additions)
    except (ValueError, OSError, asyncio.TimeoutError, ImportError):
        report(job, 'region-ocr', '局部正文补识别未完成', 'error', '已有结果保留，缺失项仍需核对')
        return False
    finally:
        job.document['regionalRecognition'] = {'regions': len(payload), 'elapsedMs': round((time.monotonic() - started) * 1000)}
