import asyncio
from copy import deepcopy
import json
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, patch

from . import semantic
from .test_extraction import block


class SemanticValidationTests(unittest.TestCase):
    def setUp(self):
        self.blocks = [block('初审人员：张宁'), block('最终审核人员：陈敏', page=1, index=3)]
        self.data = {'fields': [{'name': '最终批准人', 'raw_value': '陈敏',
                                'evidence': [{'ref': 'p1-b3', 'quote': '最终审核人员：陈敏'}]}]}

    def test_value_links_to_actual_server_owned_page_and_box(self):
        result = semantic.validate_fields(self.data, self.blocks)[0]
        self.assertEqual((result['value'], result['raw'], result['page'], result['ref']), ('陈敏', '陈敏', 2, 'p1-b3'))
        self.assertEqual(result['evidence'], [{**self.blocks[1], 'quote': '最终审核人员：陈敏'}])
        self.assertEqual(result['status'], 'pending')

    def test_missing_value_has_no_fabricated_source(self):
        result = semantic.validate_fields({'fields': [{'name': '身份证号', 'raw_value': None, 'evidence': []}]}, self.blocks)[0]
        self.assertEqual((result['value'], result['ref'], result['status']), ('', None, 'missing'))

    def test_unknown_ref_forged_quote_and_value_not_in_quote_are_rejected(self):
        for field, value in [('ref', 'p999-b3'), ('quote', '最终审核人员：王明')]:
            data = deepcopy(self.data)
            data['fields'][0]['evidence'][0][field] = value
            self.assertEqual(semantic.validate_fields(data, self.blocks)[0]['status'], 'rejected')
        data = deepcopy(self.data)
        data['fields'][0]['raw_value'] = '张宁'
        self.assertEqual(semantic.validate_fields(data, self.blocks)[0]['status'], 'rejected')

    def test_schema_types_duplicate_names_and_model_coordinates_are_rejected(self):
        variants = []
        for change in [{'raw_value': 123}, {'bbox': [0, 0, 1, 1]}, {'raw_value': None}, {'raw_value': ''}]:
            data = deepcopy(self.data)
            data['fields'][0].update(change)
            variants.append(data)
        data = deepcopy(self.data)
        data['fields'] *= 2
        variants.append(data)
        for data in variants:
            self.assertEqual(semantic.validate_fields(data, self.blocks)[0]['status'], 'rejected')

    def test_whitespace_allowed_but_original_characters_cannot_be_normalized(self):
        blocks = [block('通讯地址：Ａ座\n１２层')]
        data = {'fields': [{'name': '通讯地址', 'raw_value': 'Ａ座１２层',
                            'evidence': [{'ref': 'p0-b0', 'quote': '通讯地址：Ａ座１２层'}]}]}
        self.assertEqual(semantic.validate_fields(data, blocks)[0]['raw'], 'Ａ座１２层')
        data['fields'][0]['raw_value'] = 'A座12层'
        self.assertEqual(semantic.validate_fields(data, blocks)[0]['status'], 'rejected')

    def test_context_budget_rejects_whole_request_without_silent_truncation(self):
        with self.assertRaisesRegex(ValueError, '预算'):
            semantic.messages_for([block('长' * 50000)], '提取提交人', [])
        messages = semantic.messages_for(self.blocks, '谁最终批准？', [])
        source = json.loads(messages[1]['content'])
        self.assertEqual(source['request'], '谁最终批准？')
        self.assertEqual(set(source['blocks'][0]), {'ref', 'page', 'text', 'type', 'bbox'})


class SemanticBridgeTests(unittest.IsolatedAsyncioTestCase):
    async def test_failed_source_validation_retains_received_usage_and_never_retries(self):
        usage = {'prompt_tokens': 100, 'completion_tokens': 10, 'total_tokens': 110}
        process = SimpleNamespace(returncode=0, communicate=AsyncMock(return_value=(json.dumps({
            'ok': True, 'model': 'test-model', 'usage': usage, 'elapsedMs': 5,
            'data': {'fields': [{'name': '批准人', 'raw_value': '伪造值', 'evidence': []}]}}).encode(), None)))
        job = SimpleNamespace(blocks=[block('最终审核人员：陈敏')], process=None, latest_call=None)
        with patch.object(semantic.asyncio, 'create_subprocess_exec', AsyncMock(return_value=process)) as spawn, patch.object(semantic, 'log_usage') as log:
            fields, _ = await semantic.extract_fields(job, '找批准人', [])
            self.assertEqual(fields[0]['status'], 'rejected')
            self.assertEqual(spawn.await_count, 1)
            self.assertEqual(job.latest_call['usage'], usage)
            self.assertEqual(job.latest_call['outcome'], 'partial')
            log.assert_called_once()

    async def test_cancel_terminates_upstream_worker_and_records_unknown_usage(self):
        ready = asyncio.Event()
        async def communicate(_):
            ready.set()
            await asyncio.Future()
        process = SimpleNamespace(returncode=None, communicate=communicate, terminate=lambda: setattr(process, 'returncode', -15), wait=AsyncMock())
        job = SimpleNamespace(blocks=[block('提交人：林晓')], process=None, latest_call=None)
        with patch.object(semantic.asyncio, 'create_subprocess_exec', AsyncMock(return_value=process)), patch.object(semantic, 'log_usage'):
            task = asyncio.create_task(semantic.extract_fields(job, '提取提交人', []))
            await ready.wait()
            task.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await task
            self.assertEqual(process.returncode, -15)
            self.assertEqual(job.latest_call['outcome'], 'cancelled')
            self.assertIsNone(job.latest_call['usage'])

    async def test_cached_job_failure_preserves_previous_result_and_ocr_for_retry(self):
        from . import app
        old = {'document': {'id': 'unit'}, 'fields': [{'name': '已核定字段', 'value': '人工值'}]}
        job = app.Job('unit', 'fictional.pdf', '.pdf', [], Path('/unused'), prompt='谁最终批准？',
                      result=old, blocks=[block('最终审核人员：陈敏')], document={'id': 'unit', 'pages': []})
        job.acknowledged.set()
        with patch.object(app, 'gate', asyncio.Semaphore(1)), patch.object(semantic, 'enabled', return_value=True), \
             patch.object(app.activity, 'start'), patch.object(app.activity, 'complete'), \
             patch.object(semantic, 'extract_fields', AsyncMock(side_effect=ValueError('模型密钥无效。'))), \
             patch.object(app, 'recognize_document', AsyncMock()) as recognize:
            await app.run_job(job, reuse=True)
            recognize.assert_not_awaited()
            self.assertEqual(job.status, 'failed')
            self.assertIs(job.result, old)
            self.assertEqual(app.metadata(job)['document']['id'], 'unit')
            self.assertIsNone(app.metadata(job)['result'])


if __name__ == '__main__':
    unittest.main()
