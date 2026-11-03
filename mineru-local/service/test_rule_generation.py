from copy import deepcopy
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import IsolatedAsyncioTestCase, TestCase
from unittest.mock import AsyncMock, patch

import httpx

from . import profiles, rule_generation
from .test_profiles import fake_sample, draft


def proposal():
    return {'fields': [{'name': '价税合计', 'key': 'total', 'kind': 'amount', 'required': True,
                        'evidence': [{'ref': 'value', 'quote': '123.45'}],
                        'anchor': {'ref': 'label', 'text': '价税合计', 'direction': 'right'}}], 'matchRefs': ['title']}


class RuleCompilationTests(TestCase):
    def test_generates_executable_rules_with_server_coordinates_and_pending_review(self):
        body = rule_generation.GenerationRequest(request='提取价税合计')
        generated = rule_generation.compile_proposal(proposal(), fake_sample(), body)
        rule = generated['rules'][0]
        self.assertEqual(rule['method'], 'anchor')
        self.assertEqual(rule['review'], 'pending')
        self.assertEqual(rule['origin'], 'ai')
        self.assertEqual(generated['checks'][0]['value'], '123.45')
        self.assertEqual(generated['matchTexts'], ['电子发票'])
        self.assertAlmostEqual(rule['region'][0], .398)
        result = profiles.extract(fake_sample(), fake_sample('new', '999.50'), {**draft()['templates'][0], 'fields': [rule]})
        self.assertEqual(result['fields'][0]['value'], '999.50', '规则执行读取新材料的值，不保存样例答案作为常量')

    def test_fabricated_reference_and_wrong_quotes_remain_unlocated(self):
        for evidence in [[{'ref': 'invented', 'quote': '123.45'}], [{'ref': 'value', 'quote': '999.50'}]]:
            data = proposal(); data['fields'][0].update(evidence=evidence, region=[0, 0, 1, 1])
            result = rule_generation.compile_proposal(data, fake_sample(), rule_generation.GenerationRequest(request='金额'))
            self.assertIsNone(result['rules'][0]['region'])
            self.assertEqual(result['checks'][0]['status'], 'unlocated')

    def test_cross_page_spans_and_omitted_requested_fields_are_not_silently_accepted(self):
        sample = fake_sample(); sample['pages'].append({'number': 2, 'width': 800, 'height': 600})
        sample['blocks'].append({'ref': 'page-2', 'text': '456', 'pageIndex': 1, 'bbox': [.4, .6, .6, .65]})
        data = proposal(); data['fields'][0]['evidence'].append({'ref': 'page-2', 'quote': '456'})
        body = rule_generation.GenerationRequest(request='按字段表提取', requirements={'fileName': '字段.xlsx', 'sheet': 'Sheet1', 'fields': [
            {'name': '价税合计', 'cell': 'A2'}, {'name': '开票日期', 'cell': 'A3'}]})
        generated = rule_generation.compile_proposal(data, sample, body)
        self.assertEqual([item['name'] for item in generated['rules']], ['价税合计', '开票日期'])
        self.assertTrue(all(item['region'] is None for item in generated['rules']))

    def test_reference_page_is_localized_without_losing_original_reference(self):
        sample = fake_sample(); sample['pages'].append({'number': 2, 'width': 800, 'height': 600})
        sample['blocks'] = [{**item, 'pageIndex': 1} for item in sample['blocks']]
        body = rule_generation.GenerationRequest(request='提取金额', referencePage=2)
        generated = rule_generation.compile_proposal(proposal(), sample, body)
        self.assertEqual(generated['rules'][0]['page'], 1)
        preview = rule_generation.preview_rule(sample, rule_generation.PreviewRequest(rule=generated['rules'][0], referencePage=2))
        self.assertEqual(preview['value'], '123.45')

    def test_review_blocks_publish_but_does_not_change_execution_fingerprint(self):
        with TemporaryDirectory() as temporary, patch.object(profiles, 'ROOT', Path(temporary)):
            profiles.atomic(profiles.ROOT / 'samples/sample-a/sample.json', fake_sample())
            value = draft(); before = profiles.fingerprint(value)
            value['templates'][0]['fields'][0].update(origin='ai', review='pending', note='请确认')
            self.assertEqual(before, profiles.fingerprint(value))
            profiles.save('profile-a', value); profiles.test('profile-a', 'sample-a', 'template-a')
            with self.assertRaisesRegex(ValueError, '确认'):
                profiles.publish('profile-a')
            value['templates'][0]['fields'][0]['review'] = 'confirmed'
            profiles.save('profile-a', value)
            self.assertEqual(profiles.publish('profile-a')['versions'], ['1.0.0'])


class RuleGenerationApiTests(IsolatedAsyncioTestCase):
    async def test_generation_and_preview_do_not_save_drafts_or_publish_automatically(self):
        from . import app
        with TemporaryDirectory() as temporary, patch.object(profiles, 'ROOT', Path(temporary)):
            profiles.atomic(profiles.ROOT / 'samples/sample-a/sample.json', fake_sample())
            saved = profiles.save('profile-a', draft())
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app.app), base_url='http://127.0.0.1:8768') as client:
                with patch.object(rule_generation, 'call_model', new_callable=AsyncMock, return_value=(proposal(), {'model': 'fixture', 'usage': {}})) as model:
                    response = await client.post('/api/profile-samples/sample-a/generate-rules', json={'request': '提取价税合计'})
                    self.assertEqual(response.status_code, 200)
                    self.assertTrue(response.json()['usesLlm'])
                    rule = response.json()['rules'][0]
                    preview = await client.post('/api/profile-samples/sample-a/preview-rule', json={'rule': rule})
                    self.assertEqual(preview.json()['value'], '123.45')
                    self.assertEqual(model.await_count, 1, '样例回放不调用模型')
                    self.assertEqual(profiles.read('profile-a'), saved)
                    self.assertEqual((await client.post('/api/profile-samples/sample-a/generate-rules', json={})).status_code, 422)
                    self.assertEqual(model.await_count, 1, '没有需求不发起模型调用')
                with patch.object(rule_generation, 'call_model', new_callable=AsyncMock, side_effect=ValueError('AI 配置生成超时')):
                    failure = await client.post('/api/profile-samples/sample-a/generate-rules', json={'request': '金额'})
                    self.assertEqual(failure.status_code, 422)
                    self.assertEqual(profiles.read('profile-a'), saved)

    async def test_missing_model_configuration_has_manual_fallback_error(self):
        with patch.object(rule_generation.semantic, 'enabled', return_value=False):
            with self.assertRaisesRegex(ValueError, '人工配置'):
                await rule_generation.call_model([])
