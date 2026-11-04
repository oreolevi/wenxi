"""Offline routing checks: no real OCR, model calls, uploads or mutable user data."""
import asyncio
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, patch

from . import extraction_flow as flow, grounding, semantic
from .test_seals import seal_block


def call(identifier):
    return {'callId': identifier, 'model': 'offline', 'usage': {'total_tokens': 10}, 'elapsedMs': 1, 'outcome': 'success'}


def field(name, status='missing', **extra):
    return {**grounding.base_field(name), 'status': status, **extra}


def job(names=None, blocks=None):
    return SimpleNamespace(fields=names or [], prompt='本次用户提取要求', requirements=None,
        blocks=blocks if blocks is not None else [seal_block('', status='detected')],
        document={'pages': [{'number': 1}, {'number': 2}]}, events=[], latest_call=None,
        directory=Path('/unused'), process=None)


class FlowTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.env = patch.dict('os.environ', {'WENXI_SEAL_OCR': 'on'})
        self.env.start(); self.addCleanup(self.env.stop)

    async def test_good_amount_with_detected_stamp_skips_specialists(self):
        task = job(['申请金额'])
        task.prompt = '提取金额；文档正文提到印章也不代表需要印文'
        original = [field('申请金额', 'pending', value='12860.00', evidence=[{'ref': 'body'}])]
        base = AsyncMock(return_value=(original, call('first')))
        with patch.object(flow.seals, 'enrich', AsyncMock()) as stamp, patch.object(flow.regional_ocr, 'enrich', AsyncMock()) as roi:
            result, _ = await flow.extract(task, base)
        stamp.assert_not_awaited(); roi.assert_not_awaited()
        self.assertIs(result, original)
        self.assertEqual(task.document['capabilityPlan']['recoveryRounds'], 0)

    async def test_explicit_imprint_is_read_before_first_extraction(self):
        task = job(['印章单位'])
        order = []
        async def stamp(value):
            order.append('ocr')
            value.blocks[0]['sealRecognition']['status'] = 'recognized'
        async def base(value):
            order.append('extract')
            return [field('印章单位', 'pending', evidence=[{'ref': 'stamp'}])], call('first')
        with patch.object(flow.seals, 'enrich', AsyncMock(side_effect=stamp)) as specialist:
            await flow.extract(task, base)
        self.assertEqual(order, ['ocr', 'extract'])
        self.assertEqual(specialist.await_count, 1)

    async def test_request_change_reuses_imprint_cache_without_new_worker(self):
        task = job(['印章单位'], [seal_block('已识别的虚构公司')])
        with patch.object(flow.seals, 'enrich', AsyncMock()) as specialist:
            await flow.extract(task, AsyncMock(return_value=([field('印章单位', 'pending')], call('first'))))
        specialist.assert_not_awaited()
        self.assertEqual(task.document['capabilityPlan']['seal'], 'cached')

    async def test_imprint_requirement_without_detected_region_does_not_invent_crop(self):
        task = job(['印章单位'], [])
        with patch.object(flow.seals, 'enrich', AsyncMock()) as specialist:
            await flow.extract(task, AsyncMock(return_value=([field('印章单位', 'visual_required', sourceKind='seal')], call('first'))))
        specialist.assert_not_awaited()
        self.assertEqual(task.document['capabilityPlan']['seal'], 'no_region')

    async def test_generic_excel_field_can_request_seal_source_after_semantic_pass(self):
        task = job(['企业名称', '合同金额'])
        task.requirements = {'fields': [{'name': '企业名称', 'rule': '以公章印文为准'}]}
        originals = [field('企业名称', 'visual_required', sourceKind='seal'), field('合同金额', 'pending', value='20')]
        async def stamp(value, refs):
            self.assertEqual(refs, {task.blocks[0]['ref']})
            value.blocks[0]['sealRecognition']['status'] = 'recognized'
        recovered = field('企业名称', 'pending', value='虚构印章公司', evidence=[{'ref': task.blocks[0]['ref']}])
        with patch.object(flow.seals, 'enrich', AsyncMock(side_effect=stamp)) as specialist, \
                patch.object(semantic, 'extract_fields', AsyncMock(return_value=([recovered], call('second')))) as retry:
            result, meta = await flow.extract(task, AsyncMock(return_value=(originals, call('first'))))
        self.assertEqual(specialist.await_count, 1)
        self.assertEqual(retry.await_args.args[2], ['企业名称'])
        self.assertEqual(result[0]['value'], '虚构印章公司')
        self.assertEqual(result[1]['value'], '20')
        self.assertEqual(meta['usage']['total_tokens'], 20)

    async def test_missing_body_amount_uses_text_ocr_not_imprint_ocr(self):
        task = job(['申请金额', '申请日期'])
        ref = task.blocks[0]['ref']
        originals = [field('申请金额', recoveryRefs=[ref]), field('申请日期', 'pending', value='原有日期')]
        recovered = field('申请金额', 'pending', value='12860.00', evidence=[{'ref': 'actual-roi-text'}])
        with patch.object(flow.seals, 'enrich', AsyncMock()) as stamp, \
                patch.object(flow.regional_ocr, 'enrich', AsyncMock(return_value=True)) as roi, \
                patch.object(semantic, 'extract_fields', AsyncMock(return_value=([recovered], call('second')))) as retry:
            result, _ = await flow.extract(task, AsyncMock(return_value=(originals, call('first'))))
        stamp.assert_not_awaited(); roi.assert_awaited_once_with(task, {ref})
        self.assertEqual(retry.await_args.args[2], ['申请金额'])
        self.assertEqual(result[1]['value'], '原有日期')

    async def test_empty_ocr_and_failed_upfront_ocr_do_not_retry_in_a_loop(self):
        task = job(['印章单位'])
        async def failed(value):
            value.blocks[0]['sealRecognition']['status'] = 'unavailable'
        with patch.object(flow.seals, 'enrich', AsyncMock(side_effect=failed)) as stamp, \
                patch.object(semantic, 'extract_fields', AsyncMock()) as retry:
            await flow.extract(task, AsyncMock(return_value=([field('印章单位', 'visual_required', sourceKind='seal')], call('first'))))
        stamp.assert_awaited_once(); retry.assert_not_awaited()

    async def test_new_ocr_without_reliable_text_does_not_spend_another_model_call(self):
        task = job(['金额'])
        originals = [field('金额', recoveryRefs=[task.blocks[0]['ref']])]
        with patch.object(flow.regional_ocr, 'enrich', AsyncMock(return_value=False)), \
                patch.object(semantic, 'extract_fields', AsyncMock()) as retry:
            result, _ = await flow.extract(task, AsyncMock(return_value=(originals, call('first'))))
        retry.assert_not_awaited()
        self.assertIs(result, originals)

    async def test_body_occlusion_can_trigger_one_region_without_model_hint(self):
        stamp = seal_block('', 'detected')
        body = {**seal_block('金额：12860', index=2), 'blockType': 'text', 'bbox': [.1, .4, .5, .45]}
        task = job(['日期'], [stamp, body])
        with patch.object(flow.regional_ocr, 'enrich', AsyncMock(return_value=False)) as roi:
            await flow.extract(task, AsyncMock(return_value=([field('日期')], call('first'))))
        roi.assert_awaited_once()
        self.assertEqual(task.document['capabilityPlan']['recoveryReason'], 'body_overlap')

    async def test_isolated_stamp_is_not_a_reason_to_reread_unrelated_missing_fields(self):
        stamp = seal_block('', 'detected')
        body = {**seal_block('其他正文', index=2), 'blockType': 'text', 'bbox': [.1, .8, .5, .9]}
        task = job(['身份证号'], [stamp, body])
        with patch.object(flow.regional_ocr, 'enrich', AsyncMock()) as roi:
            await flow.extract(task, AsyncMock(return_value=([field('身份证号')], call('first'))))
        roi.assert_not_awaited()

    async def test_failed_supplement_keeps_first_results_and_received_usage(self):
        task = job(['金额'])
        originals = [field('金额', recoveryRefs=[task.blocks[0]['ref']]), field('单位', 'pending', value='原有单位')]
        async def failed(*_):
            task.latest_call = {**call('second'), 'outcome': 'timeout'}
            raise ValueError('模型超时')
        with patch.object(flow.regional_ocr, 'enrich', AsyncMock(return_value=True)), \
                patch.object(semantic, 'extract_fields', AsyncMock(side_effect=failed)) as retry:
            result, meta = await flow.extract(task, AsyncMock(return_value=(originals, call('first'))))
        self.assertEqual(result[1]['value'], '原有单位')
        self.assertEqual(meta['usage']['total_tokens'], 20)
        self.assertEqual(retry.await_count, 1)
        self.assertEqual(task.document['capabilityPlan']['recovery'], 'model_failed')

    async def test_one_round_limits_fields_regions_and_paid_model_batch(self):
        task = job(blocks=[seal_block('', status='detected', index=i) for i in range(4)])
        originals = [field(f'字段{i}', recoveryRefs=[b['ref'] for b in task.blocks]) for i in range(9)]
        retry_fields = [field(f'字段{i}', 'missing') for i in range(6)]
        with patch.object(flow.regional_ocr, 'enrich', AsyncMock(return_value=True)) as roi, \
                patch.object(semantic, 'extract_fields', AsyncMock(return_value=(retry_fields, call('second')))) as retry:
            await flow.extract(task, AsyncMock(return_value=(originals, call('first'))))
        self.assertEqual(len(roi.await_args.args[1]), 2)
        self.assertEqual(len(retry.await_args.args[2]), 6)
        self.assertEqual(retry.await_count, 1)
        self.assertEqual(task.document['capabilityPlan']['recoveryRounds'], 1)

    async def test_multi_material_recovery_never_mixes_pages_or_unit_keys(self):
        task = job(blocks=[seal_block('', 'detected', page=0), seal_block('', 'detected', page=1)])
        task.document['units'] = [{'id': 'first', 'pages': [1]}, {'id': 'second', 'pages': [2]}]
        a, b = task.blocks
        original = field('金额', recoveryRefs=[b['ref']], unitId='second', unitLabel='第二份', key='second-stable-key')
        async def retry(value, prompt, names):
            self.assertEqual({block['pageIndex'] for block in value.blocks}, {1})
            return [field('金额', 'pending', value='9', evidence=[{'ref': b['ref']}])], call('second')
        with patch.object(flow.regional_ocr, 'enrich', AsyncMock(return_value=True)), patch.object(semantic, 'extract_fields', AsyncMock(side_effect=retry)):
            result, _ = await flow.extract(task, AsyncMock(return_value=([original], call('first'))))
        self.assertEqual(result[0]['key'], 'second-stable-key')
        self.assertEqual(result[0]['unitId'], 'second')
        self.assertEqual(len(task.blocks), 2)

    async def test_initial_model_failure_is_not_an_ocr_retry_signal(self):
        task = job(['金额'])
        originals = [field('金额', 'rejected', recoveryRefs=[task.blocks[0]['ref']], issues=[{'code': 'unit_failed'}])]
        with patch.object(flow.regional_ocr, 'enrich', AsyncMock()) as roi:
            await flow.extract(task, AsyncMock(return_value=(originals, call('first'))))
        roi.assert_not_awaited()

    async def test_cancelled_supplement_restores_source_context_and_preserves_usage(self):
        task = job(['企业名称'])
        original_blocks = task.blocks
        async def stamp(value, refs):
            value.blocks[0]['sealRecognition']['status'] = 'recognized'
        async def cancel(value, prompt, names):
            self.assertEqual(value.seal_source_names, {'企业名称'})
            self.assertEqual(value.event_prefix, 'supplement-')
            value.latest_call = {**call('second'), 'outcome': 'cancelled'}
            raise asyncio.CancelledError()
        with patch.object(flow.seals, 'enrich', AsyncMock(side_effect=stamp)), \
                patch.object(semantic, 'extract_fields', AsyncMock(side_effect=cancel)):
            with self.assertRaises(asyncio.CancelledError):
                await flow.extract(task, AsyncMock(return_value=([field('企业名称', 'visual_required', sourceKind='seal')], call('first'))))
        self.assertIs(task.blocks, original_blocks)
        self.assertEqual(task.event_prefix, '')
        self.assertEqual(task.seal_source_names, set())
        self.assertEqual(task.latest_call['usage']['total_tokens'], 20)


class SourcePlanningTests(unittest.TestCase):
    def test_model_declared_seal_source_still_requires_real_imprint_quotes(self):
        stamp = seal_block('虚构公司')
        body = {**seal_block('虚构公司', index=2), 'blockType': 'text'}
        data = {'fields': [{'name': '企业名称', 'source_kind': 'seal', 'raw_value': '虚构公司',
            'evidence': [{'ref': body['ref'], 'quote': '虚构公司'}]}]}
        self.assertEqual(grounding.validate_fields(data, [body, stamp])[0]['status'], 'rejected')
        data['fields'][0]['evidence'][0]['ref'] = stamp['ref']
        result = grounding.validate_fields(data, [body, stamp])[0]
        self.assertEqual(result['status'], 'pending')
        self.assertEqual(result['sourceKind'], 'seal')
        data['fields'][0].pop('source_kind')
        data['fields'][0]['evidence'][0]['ref'] = body['ref']
        self.assertEqual(grounding.validate_fields(data, [body, stamp], seal_names={'企业名称'})[0]['status'], 'rejected')

    def test_unread_imprint_and_valid_region_proposals_are_not_value_evidence(self):
        stamp = seal_block('', 'detected')
        result = grounding.validate_fields({'fields': [{'name': '企业名称', 'source_kind': 'seal',
            'raw_value': None}]}, [stamp])[0]
        self.assertEqual((result['status'], result['value'], result['sourceKind']), ('visual_required', '', 'seal'))
        result = grounding.validate_fields({'fields': [{'name': '金额', 'raw_value': None,
            'recovery_refs': [stamp['ref'], 'invented-ref']}]}, [stamp])[0]
        self.assertEqual(result['recoveryRefs'], [stamp['ref']])
        self.assertEqual((result['status'], result['evidence']), ('missing', []))

    def test_valid_values_and_unsupported_claims_cannot_request_recovery(self):
        body = {**seal_block('123', index=2), 'blockType': 'text'}
        stamp = seal_block('', 'detected')
        data = {'fields': [{'name': '金额', 'raw_value': '123', 'recovery_refs': [stamp['ref']],
            'evidence': [{'ref': body['ref'], 'quote': '123'}]}]}
        self.assertNotIn('recoveryRefs', grounding.validate_fields(data, [body, stamp])[0])
        data = {'fields': [{'name': '印章是否真实', 'source_kind': 'seal', 'raw_value': None, 'recovery_refs': [stamp['ref']]}]}
        result = grounding.validate_fields(data, [stamp])[0]
        self.assertEqual(result['status'], 'visual_required')
        self.assertNotIn('sourceKind', result)
        self.assertNotIn('recoveryRefs', result)


if __name__ == '__main__':
    unittest.main()
