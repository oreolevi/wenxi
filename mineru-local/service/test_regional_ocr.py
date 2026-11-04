import asyncio
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, patch

from PIL import Image

from . import grounding, regional_ocr, seals
from .test_seals import seal_block


class RegionalOCRTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory(); self.addCleanup(temp.cleanup)
        folder = Path(temp.name)
        Image.new('RGB', (100, 100), 'white').save(folder / 'page-1.png')
        stamp = seal_block('', 'detected')
        self.job = SimpleNamespace(directory=folder, blocks=[stamp], process=None, events=[],
            document={'pages': [{'number': 1, 'toOriginal': [[0, -1, 1], [1, 0, 0], [0, 0, 1]]}]})

    async def test_text_mode_recovers_actual_lines_with_original_mapping(self):
        stamp = self.job.blocks[0]
        async def worker(job, regions, *, mode):
            self.assertEqual(mode, 'text')
            with Image.open(regions[0]['image']) as image:
                self.assertEqual(image.width, 100)  # Full label/value row, not just the seal circle.
            return {'regions': [{'ref': stamp['ref'], 'lines': [
                {'text': '2026-11-04', 'confidence': .98, 'polygon': [[20, 10], [80, 10], [80, 20], [20, 20]]},
                {'text': '低置信度乱码', 'confidence': .2, 'polygon': [[10, 0], [50, 0], [50, 10], [10, 10]]}]}]}
        with patch.object(seals, 'call_worker', AsyncMock(side_effect=worker)) as call:
            changed = await regional_ocr.enrich(self.job, {stamp['ref']})
            self.assertTrue(changed)
            await regional_ocr.enrich(self.job, {stamp['ref']})
            self.assertEqual(call.await_count, 1)  # Completed region is cached.
        self.assertEqual(stamp['text'], '')  # Ordinary OCR never becomes imprint OCR.
        text = self.job.blocks[1]
        self.assertEqual((text['text'], text['blockType'], text['recoverySourceRef']), ('2026-11-04', 'ocr_recovery', stamp['ref']))
        self.assertTrue(all(0 <= value <= 1 for value in text['originalBBox']))
        data = {'fields': [{'name': '申请日期', 'raw_value': text['text'],
            'evidence': [{'ref': text['ref'], 'quote': text['text']}]}]}
        field = grounding.validate_fields(data, self.job.blocks)[0]
        self.assertEqual(field['status'], 'pending')
        self.assertIn('局部文字补识别', field['note'])

    async def test_failure_does_not_replace_or_fabricate_body_blocks(self):
        before = list(self.job.blocks)
        with patch.object(seals, 'call_worker', AsyncMock(side_effect=ValueError('offline failed'))):
            self.assertFalse(await regional_ocr.enrich(self.job, {before[0]['ref']}))
        self.assertEqual(self.job.blocks, before)

    async def test_cancel_propagates_without_partial_text(self):
        with patch.object(seals, 'call_worker', AsyncMock(side_effect=asyncio.CancelledError())):
            with self.assertRaises(asyncio.CancelledError):
                await regional_ocr.enrich(self.job, {self.job.blocks[0]['ref']})
        self.assertEqual(len(self.job.blocks), 1)

    async def test_unavailable_page_keeps_existing_results(self):
        with patch.object(seals, 'prepare', side_effect=OSError('page unavailable')):
            self.assertFalse(await regional_ocr.enrich(self.job, {self.job.blocks[0]['ref']}))
        self.assertEqual(len(self.job.blocks), 1)
