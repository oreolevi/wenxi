from copy import deepcopy
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase, IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, patch

import httpx

from . import profiles, rule_assistant as assistant, rule_generation
from .test_profiles import fake_sample, draft


def body(**updates):
    return assistant.AssistantRequest.model_validate({'request': '把价税合计改为非必填', 'fields': draft()['templates'][0]['fields'], **updates})


def plan(**updates):
    return {'message': '建议只调整必填属性。', 'changes': [{'op': 'update', 'id': 'amount', 'properties': {'required': False}}], **updates}


class AssistantPlanTests(TestCase):
    def test_metadata_patch_preserves_position_and_marks_review_without_changing_input(self):
        source = fake_sample(); request = body(); original = deepcopy(request.model_dump())
        result = assistant.compile_plan(plan(), source, request)
        change = result['changes'][0]
        before, after = change['before'], change['after']
        self.assertFalse(after['required'])
        for key in ('id', 'key', 'name', 'region', 'page', 'method', 'anchor', 'direction'):
            self.assertEqual(after[key], before[key])
        self.assertEqual(after['review'], 'pending')
        self.assertEqual(change['check']['value'], '123.45')
        self.assertEqual(request.model_dump(), original)

    def test_explanation_has_no_changes_and_current_fields_are_authoritative(self):
        request = body(history=[{'role': 'assistant', 'content': '之前建议改成可选，尚未应用'}])
        result = assistant.compile_plan(plan(changes=[]), fake_sample(), request)
        self.assertEqual(result['changes'], [])
        messages = assistant.messages_for(fake_sample(), request)
        self.assertIn('current_fields', messages[1]['content'])
        self.assertIn('conversation', messages[1]['content'])
        self.assertNotIn('之前建议', messages[0]['content'])

    def test_unknown_duplicate_targets_and_arbitrary_coordinates_are_rejected(self):
        for changes in ([{'op': 'update', 'id': 'unknown', 'properties': {'required': False}}],
                        [{'op': 'update', 'id': 'amount', 'properties': {'required': False}}] * 2,
                        [{'op': 'update', 'id': 'amount', 'properties': {'region': [0, 0, 1, 1]}}]):
            with self.assertRaises(ValueError):
                assistant.compile_plan(plan(changes=changes), fake_sample(), body())

    def test_added_and_relocated_rules_require_real_evidence(self):
        added = {'op': 'add', 'field': {'name': '补充金额', 'key': 'extra_amount', 'kind': 'amount', 'evidence': [{'ref': 'value', 'quote': '123.45'}]}}
        result = assistant.compile_plan(plan(changes=[added]), fake_sample(), body())
        self.assertEqual(result['changes'][0]['check']['value'], '123.45')
        self.assertEqual(result['changes'][0]['after']['review'], 'pending')
        moved = {'op': 'update', 'id': 'amount', 'localization': {'evidence': [{'ref': 'invented', 'quote': '999'}]}}
        missing = assistant.compile_plan(plan(changes=[moved]), fake_sample(), body())['changes'][0]
        self.assertIsNone(missing['after']['region'])
        self.assertEqual(missing['check']['status'], 'unlocated')

    def test_duplicate_keys_and_foreign_selected_field_are_rejected(self):
        with self.assertRaises(ValueError):
            assistant.compile_plan(plan(changes=[{'op': 'add', 'field': {'name': '重复金额', 'key': 'total'}}]), fake_sample(), body())
        with self.assertRaises(ValueError):
            assistant.messages_for(fake_sample(), body(selectedId='nonexistent'))

    def test_remove_is_only_a_proposal(self):
        request = body(request='移除金额字段')
        result = assistant.compile_plan(plan(changes=[{'op': 'remove', 'id': 'amount'}]), fake_sample(), request)
        self.assertIsNone(result['changes'][0]['after'])
        self.assertEqual(len(request.fields), 1)


class AssistantApiTests(IsolatedAsyncioTestCase):
    async def test_assistance_never_saves_or_publishes_and_errors_keep_draft(self):
        from . import app
        with TemporaryDirectory() as temporary, patch.object(profiles, 'ROOT', Path(temporary)):
            profiles.atomic(profiles.ROOT / 'samples/sample-a/sample.json', fake_sample())
            saved = profiles.save('profile-a', draft())
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app.app), base_url='http://127.0.0.1') as client:
                with patch.object(rule_generation, 'call_model', new_callable=AsyncMock, return_value=(plan(), {'model': 'fixture', 'elapsedMs': 1})) as model:
                    response = await client.post('/api/profile-samples/sample-a/assist-rules', json=body().model_dump())
                    self.assertEqual(response.status_code, 200, response.text)
                    self.assertFalse(response.json()['changes'][0]['after']['required'])
                    self.assertEqual(model.await_count, 1)
                    self.assertEqual(profiles.read('profile-a'), saved)
                with patch.object(rule_generation, 'call_model', new_callable=AsyncMock, side_effect=ValueError('生成超时')):
                    failure = await client.post('/api/profile-samples/sample-a/assist-rules', json=body().model_dump())
                    self.assertEqual(failure.status_code, 422)
                    self.assertEqual(profiles.read('profile-a'), saved)
