import asyncio
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from .grounding import validate_fields, needs_visual
from .test_extraction import block
from . import semantic


def fact(value, ref, label=''):
    return {'raw_value': value, 'evidence': [{'ref': ref, 'quote': value}], **({'label': label} if label else {})}


class IsolatedGroundingTests(unittest.TestCase):
    def test_one_invalid_field_does_not_discard_valid_or_missing_fields(self):
        fields = validate_fields({'fields': [
            {'name': '提交人', **fact('林晓', 'p0-b0')},
            {'name': '审核人', **fact('伪造人', 'p8-b9')},
            {'name': '证件号', 'raw_value': None, 'evidence': []},
        ]}, [block('提交人：林晓')])
        self.assertEqual([field['status'] for field in fields], ['pending', 'rejected', 'missing'])
        self.assertEqual(fields[0]['value'], '林晓')
        self.assertEqual((fields[1]['value'], fields[1]['ref']), ('', None))

    def test_requested_but_omitted_and_duplicate_fields_are_visible_errors(self):
        good = {'name': '提交人', **fact('林晓', 'p0-b0')}
        fields = validate_fields({'fields': [good]}, [block('提交人：林晓')], ['提交人', '通讯地址'])
        self.assertEqual([field['status'] for field in fields], ['pending', 'rejected'])
        fields = validate_fields({'fields': [good, good]}, [block('提交人：林晓')], ['提交人'])
        self.assertEqual(fields[0]['issues'][0]['code'], 'duplicate')

    def test_noncontiguous_clauses_keep_separate_actual_sources(self):
        fields = validate_fields({'fields': [{'name': '付款条件', 'kind': 'list', 'items': [
            fact('验收合格后付款', 'p0-b0', '验收'), fact('付款前提供发票', 'p1-b1', '发票'),
        ]}]}, [block('验收合格后付款'), block('付款前提供发票', page=1, index=1)])
        field = fields[0]
        self.assertEqual(field['status'], 'pending')
        self.assertEqual([item['raw'] for item in field['items']], ['验收合格后付款', '付款前提供发票'])
        self.assertEqual([item['pageIndex'] for item in field['evidence']], [0, 1])

    def test_table_cell_failure_retains_other_cells_and_rows(self):
        blocks = [{**block('设备A', index=1), 'rowRef': 'r1'}, {**block('2', index=2), 'rowRef': 'r1'}]
        data = {'fields': [{'name': '单价数量', 'kind': 'table', 'table': {'columns': ['品类', '数量'],
                          'rows': [{'cells': [fact('设备A', 'p0-b1'), {'raw_value': 2, 'evidence': []}]}]}}]}
        field = validate_fields(data, blocks)[0]
        self.assertEqual((field['status'], field['validationStatus']), ('rejected', 'partial'))
        self.assertEqual(field['table']['rows'][0]['cells'][0]['value'], '设备A')
        self.assertEqual(field['table']['rows'][0]['cells'][1]['value'], '')
        data['fields'][0]['table']['rows'][0]['cells'][1] = fact('2', 'p0-b2')
        field = validate_fields(data, blocks)[0]
        self.assertEqual(field['status'], 'pending')
        blocks[1]['rowRef'] = 'r2'
        self.assertEqual(validate_fields(data, blocks)[0]['issues'][0]['code'], 'row_association')

    def test_judgment_is_separate_from_its_raw_evidence(self):
        data = {'fields': [{'name': '是否有质保金', 'kind': 'judgment', 'decision': 'yes',
                            'items': [fact('质保金5%', 'p0-b0')]}]}
        field = validate_fields(data, [block('本合同质保金5%')])[0]
        self.assertEqual((field['value'], field['raw'], field['decision'], field['status']), ('是', '质保金5%', 'yes', 'pending'))
        data['fields'][0]['items'][0] = fact('质保金5%', 'p9-b9')
        field = validate_fields(data, [block('本合同质保金5%')])[0]
        self.assertEqual((field['status'], field['value']), ('rejected', ''))

    def test_seal_names_cannot_be_replaced_by_header_company_names(self):
        field = validate_fields({'fields': [{'name': '购买方合同签章名称', **fact('示例公司', 'p0-b0')}]}, [block('甲方：示例公司')])[0]
        self.assertEqual((field['kind'], field['status'], field['value']), ('visual', 'visual_required', ''))
        self.assertFalse(needs_visual('生效条件，是否需法人/授权人签字或盖章'))

    def test_quote_punctuation_can_align_but_raw_numbers_cannot_be_normalized(self):
        data = {'fields': [{'name': '提交人', 'raw_value': '林晓', 'evidence': [{'ref': 'p0-b0', 'quote': '提交人：林晓'}]}]}
        field = validate_fields(data, [block('提交人:林晓')])[0]
        self.assertEqual(field['evidence'][0]['quote'], '提交人:林晓')

    def test_incomplete_ocr_percentage_retains_quote_but_cannot_be_confirmed(self):
        text = '结算完成后90天付至结算金额的9'
        data = {'fields': [{'name': '付款进度', 'kind': 'list', 'items': [fact(text, 'p0-b0')]}]}
        field = validate_fields(data, [{**block(text), 'source': 'mineru'}])[0]
        self.assertEqual((field['status'], field['validationStatus']), ('rejected', 'partial'))
        self.assertEqual(field['items'][0]['raw'], text)
        self.assertEqual(field['issues'][0]['code'], 'ocr_incomplete')
        complete = text + '5%'
        data['fields'][0]['items'] = [fact(complete, 'p0-b0')]
        self.assertEqual(validate_fields(data, [{**block(complete), 'source': 'mineru'}])[0]['status'], 'pending')


class BatchTests(unittest.IsolatedAsyncioTestCase):
    async def test_visual_only_request_does_not_call_text_model(self):
        job = SimpleNamespace(blocks=[block('甲方：示例公司')], latest_call=None)
        with patch.object(semantic, 'extract_batch', AsyncMock()) as call:
            fields, meta = await semantic.extract_fields(job, '看印章', ['购买方合同签章名称'])
            call.assert_not_awaited()
            self.assertEqual(fields[0]['status'], 'visual_required')
            self.assertEqual(meta['calls'], [])

    async def test_later_provider_failure_preserves_completed_batch_without_retry(self):
        names = [f'字段{i}' for i in range(8)]
        job = SimpleNamespace(blocks=[], latest_call=None)
        calls = []
        async def extract(job, prompt, batch):
            calls.append(batch)
            job.latest_call = {'callId': str(len(calls)), 'model': 'test', 'elapsedMs': 1,
                               'usage': {'total_tokens': 10}, 'outcome': 'success'}
            if len(calls) == 2:
                raise ValueError('账户余额不足')
            return ([{'name': name, 'status': 'pending', 'value': '真实值'} for name in batch], job.latest_call)
        with patch.object(semantic, 'extract_batch', extract):
            fields, meta = await semantic.extract_fields(job, '提取全部字段', names)
            self.assertEqual(len(calls), 2)
            self.assertEqual([field['status'] for field in fields], ['pending'] * 6 + ['rejected'] * 2)
            self.assertEqual(meta['usage']['total_tokens'], 20)
