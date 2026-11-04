"""Seal source boundaries, corrected/original mapping and worker failure isolation."""
import asyncio
from copy import deepcopy
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, patch

from PIL import Image

from . import grounding, mineru_cloud, seals, semantic
from .extraction import read_blocks


def seal_block(text='', status='recognized', page=0, index=1):
    return {'ref': f'p{page}-b{index}', 'pageIndex': page, 'blockIndex': index,
        'bbox': [.2, .3, .6, .7], 'text': text, 'source': 'mineru', 'blockType': 'seal',
        'sealRecognition': {'status': status, 'engine': seals.ENGINE}}


class SealTests(unittest.TestCase):
    def test_hosted_image_subtype_keeps_empty_seal_region(self):
        raw = {'pdf_info': [{'page_idx': 0, 'page_size': [600, 800], 'preproc_blocks': [
            {'type': 'image', 'sub_type': 'seal', 'bbox': [120, 240, 360, 560],
             'blocks': [{'type': 'image_body', 'bbox': [120, 240, 360, 560], 'lines': []}]},
            {'type': 'image', 'bbox': [0, 0, 60, 80], 'lines': []}]}]}
        blocks = read_blocks(mineru_cloud.normalize_layout(raw))
        self.assertEqual(len(blocks), 1)
        self.assertEqual((blocks[0]['text'], blocks[0]['blockType'], blocks[0]['bbox']), ('', 'seal', [.2, .3, .6, .7]))
        field = grounding.visual_field('印章名称', blocks)
        self.assertEqual(field['ref'], blocks[0]['ref'])
        self.assertEqual(field['status'], 'visual_required')

    def test_recognized_imprint_cannot_quote_same_company_in_body(self):
        body = {**seal_block('正文：星河演示科技有限公司', index=0), 'blockType': 'text'}
        stamp = seal_block('星河演示科技有限公司\n演示专用章')
        data = {'fields': [{'name': '印章单位', 'raw_value': '星河演示科技有限公司',
            'evidence': [{'ref': body['ref'], 'quote': '星河演示科技有限公司'}]}]}
        self.assertEqual(grounding.validate_fields(data, [body, stamp])[0]['status'], 'rejected')
        data['fields'][0]['evidence'][0]['ref'] = stamp['ref']
        field = grounding.validate_fields(data, [body, stamp])[0]
        self.assertEqual((field['value'], field['status'], field['validationStatus']), ('星河演示科技有限公司', 'pending', 'passed'))
        self.assertEqual(field['evidence'][0]['blockType'], 'seal')
        data['fields'][0]['name'] = '申请单位'
        self.assertEqual(grounding.validate_fields(data, [body, stamp])[0]['status'], 'rejected')

    def test_low_confidence_and_untrusted_imprint_remain_visual(self):
        for change in [{'status': 'low_confidence'}, {'status': 'unavailable'}, {'engine': 'untrusted'}]:
            block = seal_block('星河演示科技有限公司')
            block['sealRecognition'].update(change)
            field = grounding.validate_fields({'fields': [{'name': '印章名称', 'raw_value': block['text'],
                'evidence': [{'ref': block['ref'], 'quote': block['text']}]}]}, [block], ['印章名称'])[0]
            self.assertEqual((field['status'], field['value']), ('visual_required', ''))

    def test_signatures_authenticity_relationships_never_become_ocr_facts(self):
        block = seal_block('星河演示科技有限公司')
        for name in ['印章是否真实', '印章与正文名称是否一致', '签名姓名', '盖章位置', '印章是否有效', '盖章人名称', '法人印章名称']:
            field = grounding.validate_fields({'fields': [{'name': name, 'raw_value': '真实有效',
                'evidence': []}]}, [block], [name])[0]
            self.assertEqual(field['status'], 'visual_required', name)
        for name in ['公章名称', '合同章印文', '印鉴单位', '印章号码']:
            self.assertFalse(grounding.requires_image(name, [block]), name)
        self.assertFalse(grounding.seal_text_question('合同条款中的印章单位要求'))
        self.assertFalse(grounding.needs_visual('合同条款中的印章单位要求'))

    def test_partial_seal_reading_does_not_hide_unread_seals(self):
        stamp = seal_block('星河演示科技有限公司')
        unread = seal_block('', status='empty', index=2)
        field = grounding.validate_fields({'fields': [{'name': '印章单位', 'raw_value': stamp['text'],
            'evidence': [{'ref': stamp['ref'], 'quote': stamp['text']}]}]}, [stamp, unread])[0]
        self.assertEqual(field['validationStatus'], 'partial')
        self.assertIn('seal_incomplete', [item['code'] for item in field['issues']])

    def test_crop_geometry_maps_to_corrected_and_rotated_original_page(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            Image.new('RGB', (100, 100), 'white').save(folder / 'page-1.png')
            block = seal_block(); block.pop('sealRecognition')
            inverse = [[0, -1, 1], [1, 0, 0], [0, 0, 1]]
            job = SimpleNamespace(directory=folder, blocks=[block], document={'pages': [{'number': 1, 'toOriginal': inverse}]})
            payload, crops = seals.prepare(job)
            self.assertEqual(len(payload), 1)
            result = {'regions': [{'ref': block['ref'], 'lines': [{'text': '演示专用章', 'confidence': .95,
                'polygon': [[0, 0], [40, 0], [40, 40], [0, 40]]}]}]}
            seals.apply(job, result, crops)
            self.assertEqual(block['text'], '演示专用章')
            self.assertEqual(block['sealRecognition']['lines'][0]['polygon'][0], [.2, .3])
            for actual, expected in zip(block['originalBBox'], [.3, .2, .7, .6]):
                self.assertAlmostEqual(actual, expected)

    def test_bad_worker_output_does_not_partially_apply_text(self):
        block = seal_block(); block.pop('sealRecognition')
        job = SimpleNamespace(blocks=[block], document={'pages': [{'number': 1}]})
        crops = [{'block': block, 'bounds': [.2, .3, .6, .7], 'size': [40, 40]}]
        invalid = {'regions': [{'ref': block['ref'], 'lines': [{'text': '伪造结果', 'confidence': .99,
            'polygon': [[0, 0], [9999, 0], [40, 40]]}]}]}
        before = deepcopy(block)
        with self.assertRaises(ValueError):
            seals.apply(job, invalid, crops)
        self.assertEqual(block, before)


class SealAsyncTests(unittest.IsolatedAsyncioTestCase):
    async def test_disabled_recognition_does_not_start_worker(self):
        job = SimpleNamespace(document={'pages': []}, blocks=[seal_block('')])
        with patch.dict('os.environ', {'WENXI_SEAL_OCR': 'off'}), patch.object(seals.asyncio, 'create_subprocess_exec', AsyncMock()) as spawn:
            await seals.enrich(job)
        spawn.assert_not_awaited()

    async def test_cancel_stops_ocr_worker_without_applying_partial_text(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            Image.new('RGB', (100, 100), 'white').save(folder / 'page-1.png')
            stamp = seal_block(); stamp.pop('sealRecognition')
            job = SimpleNamespace(directory=folder, blocks=[stamp], document={'pages': [{'number': 1}]}, process=None, events=[])
            ready = asyncio.Event()
            async def communicate(_):
                ready.set()
                await asyncio.Future()
            process = SimpleNamespace(returncode=None, communicate=communicate,
                terminate=lambda: setattr(process, 'returncode', -15), wait=AsyncMock())
            with patch.object(seals.asyncio, 'create_subprocess_exec', AsyncMock(return_value=process)), patch.dict('os.environ', {'WENXI_SEAL_OCR': 'on'}):
                task = asyncio.create_task(seals.enrich(job))
                await ready.wait()
                task.cancel()
                with self.assertRaises(asyncio.CancelledError):
                    await task
            self.assertEqual(process.returncode, -15)
            self.assertEqual(stamp['text'], '')
            self.assertIsNone(job.process)

    async def test_worker_unavailable_preserves_region_and_body(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            Image.new('RGB', (100, 100), 'white').save(folder / 'page-1.png')
            stamp = seal_block(); stamp.pop('sealRecognition')
            body = {**seal_block('申请单位：示例公司', index=0), 'blockType': 'text'}
            job = SimpleNamespace(directory=folder, blocks=[body, stamp], document={'pages': [{'number': 1}]}, process=None, events=[])
            process = SimpleNamespace(returncode=1, communicate=AsyncMock(return_value=(b'{"error":"seal_ocr_unavailable"}', None)))
            with patch.object(seals.asyncio, 'create_subprocess_exec', AsyncMock(return_value=process)) as spawn, patch.dict('os.environ', {'WENXI_SEAL_OCR': 'on'}):
                await seals.enrich(job)
            self.assertFalse({'DEEPSEEK_API_KEY', 'MINERU_API_TOKEN', 'WENXI_ACCESS_PASSWORD'} & set(spawn.call_args.kwargs['env']))
            self.assertEqual(body['text'], '申请单位：示例公司')
            self.assertEqual(stamp['sealRecognition']['status'], 'unavailable')
            self.assertEqual(grounding.visual_field('印章名称', job.blocks)['ref'], stamp['ref'])
            self.assertIsNone(job.process)

    async def test_reliable_imprint_enters_existing_model_batch(self):
        stamp = seal_block('星河演示科技有限公司')
        job = SimpleNamespace(blocks=[stamp], latest_call=None)
        field = {'name': '印章名称', 'status': 'pending', 'value': stamp['text']}
        with patch.object(semantic, 'extract_batch', AsyncMock(return_value=([field], {'model': 'test', 'usage': None}))) as batch:
            fields, _ = await semantic.extract_fields(job, '提取印章名称', ['印章名称'])
        self.assertEqual(batch.await_args.args[2], ['印章名称'])
        self.assertEqual(fields[0]['value'], stamp['text'])
        context = json.loads(semantic.messages_for([stamp], '提取印章名称', ['印章名称'])[1]['content'])
        self.assertEqual(context['blocks'][0]['sealRecognition']['status'], 'recognized')


if __name__ == '__main__':
    unittest.main()
