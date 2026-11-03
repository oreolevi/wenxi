from copy import deepcopy
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase, IsolatedAsyncioTestCase
from unittest.mock import patch, AsyncMock
import json
import httpx
from . import profiles, scenes, studio_planning
from .test_profiles import fake_sample, draft


class SceneTests(TestCase):
    def setUp(self):
        self.tmp = TemporaryDirectory()
        self.root = patch.object(profiles, 'ROOT', Path(self.tmp.name))
        self.root.start()
        profiles.atomic(profiles.ROOT / 'samples/sample-a/sample.json', fake_sample())
        profiles.atomic(profiles.ROOT / 'samples/sample-b/sample.json', fake_sample('sample-b', '999.50'))

    def tearDown(self):
        self.root.stop()
        self.tmp.cleanup()

    def parser(self, parser_id='profile-a'):
        value = draft(); value['id'] = parser_id
        profiles.save(parser_id, value)
        profiles.test(parser_id, 'sample-b', 'template-a')
        return profiles.publish(parser_id)

    def scene(self):
        self.parser()
        return scenes.save('payment', {'id': 'payment', 'name': '付款材料', 'bindings': [
            {'id': 'invoices', 'parserId': 'profile-a', 'name': '发票', 'version': '1.0.0', 'required': True, 'multiple': True}]})

    def test_catalog_migration_is_idempotent_and_preserves_old_records(self):
        self.parser()
        originals = {p: p.read_bytes() for p in profiles.ROOT.rglob('*.json')}
        first = scenes.catalog(); second = scenes.catalog()
        self.assertEqual(first, second)
        self.assertEqual(first['scenes'][0]['bindings'], 1)
        self.assertEqual(first['parsers'][0]['id'], 'profile-a')
        self.assertTrue(all(p.read_bytes() == body for p, body in originals.items()))

    def test_multi_type_legacy_container_splits_independent_parsers(self):
        value = draft()
        second = deepcopy(value['templates'][0]); second.update(id='contract', name='合同', materialTypeId='contract')
        value['templates'][0].update(materialTypeId='invoice', classification='confirmed')
        value['templates'].append(second)
        value['materialTypes'] = [{'id': key, 'name': name, 'outputKey': key, 'required': True, 'grouping': 'document'} for key, name in [('invoice', '发票'), ('contract', '合同')]]
        profiles.save(value['id'], value)
        profiles.test(value['id'], 'sample-a', 'template-a')
        profiles.test(value['id'], 'sample-a', 'contract')
        profiles.publish(value['id'])
        path = profiles.ROOT / 'profiles/profile-a.json'; original = path.read_bytes()
        catalog = scenes.catalog()
        self.assertEqual(len(catalog['parsers']), 2)
        self.assertEqual(catalog['scenes'][0]['bindings'], 2)
        self.assertEqual(path.read_bytes(), original)
        for parser in catalog['parsers']:
            self.assertFalse(profiles.read(parser['id'])['draft'].get('materialTypes'))
            self.assertEqual(parser['versions'], ['1.0.0'])
            self.assertEqual(profiles.execute(parser['id'], '1.0.0', 'sample-b')['fields'][0]['value'], '999.50')
        self.assertEqual(len(scenes.catalog()['scenes']), 1)

    def test_scene_uses_pinned_version_after_parser_draft_changes(self):
        scene = self.scene()['draft']
        changed = profiles.read('profile-a')['draft']
        changed['templates'][0]['fields'][0]['region'] = [.1, .1, .2, .2]
        profiles.save('profile-a', changed)
        resolved = scenes.resolve(scene)
        rows = scenes.candidates(resolved, {'invoices': fake_sample('sample-b', '999.50')})
        self.assertEqual(rows[0]['data']['total'], '999.50')
        self.assertEqual(rows[0]['parserVersion'], '1.0.0')

    def test_ambiguous_parsers_require_explicit_assignment(self):
        scene = self.scene()['draft']; self.parser('profile-b')
        scene['bindings'].append({**scene['bindings'][0], 'id': 'other', 'parserId': 'profile-b', 'name': '另一发票'})
        resolved = scenes.resolve(scene)
        rows = scenes.candidates(resolved, {b['id']: fake_sample() for b, _ in resolved})
        self.assertEqual(len(rows), 1)
        self.assertIn('多个服务', rows[0]['error'])
        self.assertFalse(rows[0]['passed'])
        assigned = scenes.candidates(resolved, {'invoices': fake_sample()}, 'invoices')
        self.assertTrue(assigned[0]['passed'])

    def test_unknown_and_missing_materials_are_retained(self):
        scene = self.scene()['draft']
        sample = fake_sample(); sample['blocks'][0]['text'] = '未知材料'
        rows = scenes.candidates(scenes.resolve(scene), {'invoices': sample})
        value = scenes.result(scene, [{'name': '未知.pdf', 'items': rows}], 5)
        self.assertFalse(value['passed']); self.assertEqual(value['missingTypes'], ['发票'])
        self.assertTrue(value['items'][0]['error'])

    def test_single_material_limit_and_changed_composition_invalidate_publication(self):
        record = self.scene(); value = {'passed': True, 'summary': {}}
        scenes.remember_test('payment', record['draft'], value)
        published = scenes.publish('payment')
        self.assertEqual(published['versions'], ['1.0.0'])
        changed = deepcopy(record['draft']); changed['bindings'][0]['multiple'] = False
        scenes.save('payment', changed)
        with self.assertRaisesRegex(ValueError, '联调'):
            scenes.publish('payment')
        self.assertTrue(scenes.published('payment', '1.0.0')['bindings'][0]['multiple'])
        rows = [{'materialTypeId': 'invoices', 'passed': True, 'status': 'succeeded', 'data': {}, 'fields': []} for _ in range(2)]
        result = scenes.result(changed, [{'name': 'two.pdf', 'items': rows}], 1)
        self.assertFalse(result['passed']); self.assertEqual(len(result['issues']), 1)

    def test_reference_requires_real_published_version(self):
        record = self.scene()
        record['draft']['bindings'][0]['version'] = '9.0.0'
        with self.assertRaises(FileNotFoundError): scenes.save('payment', record['draft'])
        record['draft']['bindings'][0]['version'] = ''
        scenes.save('payment', record['draft'])
        with self.assertRaisesRegex(ValueError, '已发布版本'): scenes.resolve(record['draft'])

    def test_efficiency_is_operational_and_historical_runs_keep_their_basis(self):
        record = self.scene()
        scenes.remember_test('payment', record['draft'], {'passed': True, 'summary': {}})
        scenes.publish('payment')
        value = {'passed': True, 'summary': {'total': 1}, 'totalElapsedMs': 100}
        scenes.configure_efficiency('payment', {'minutesPerRun': 12})
        scenes.record_run('payment', '1.0.0', value)
        scenes.configure_efficiency('payment', {'minutesPerRun': 8})
        scenes.record_run('payment', '1.0.0', value)
        self.assertEqual(sorted(r['minutesSavedPerRun'] for r in scenes.runs('payment')), [8, 12])
        self.assertTrue(scenes.release_check('payment')['ready'])
        self.assertEqual(scenes.read('payment')['versions'], ['1.0.0'])
        self.assertEqual(scenes.published('payment', '1.0.0'), record['draft'])
        scenes.configure_efficiency('payment', {'minutesPerRun': None})
        scenes.record_run('payment', '1.0.0', value)
        self.assertIsNone(scenes.runs('payment')[0]['minutesSavedPerRun'])
        for invalid in [-1, 1441, float('inf'), float('nan')]:
            with self.assertRaises(ValueError): scenes.configure_efficiency('payment', {'minutesPerRun': invalid})

    def test_parser_schema_shared_across_layouts_at_publication(self):
        value = draft(); value['resourceKind'] = 'parser'
        second = deepcopy(value['templates'][0]); second['id'] = 'layout-b'; second['fields'][0]['name'] = '另一个定义'
        value['templates'].append(second)
        profiles.save(value['id'], value)
        with self.assertRaisesRegex(ValueError, '相同字段定义'): profiles.publish(value['id'])

    def test_planner_validates_grounded_sample_ids_and_creates_only_on_confirmation(self):
        source = {'request': '发票和金额', 'sampleIds': ['sample-a', 'sample-b']}
        plan = {'name': '转账', 'parsers': [{'name': '发票', 'layouts': [{'name': '同一版式', 'sampleIds': ['sample-a', 'sample-b']}], 'fields': [{'name': '金额', 'key': 'total', 'kind': 'amount'}]}]}
        response = studio_planning.apply({'source': source, 'plan': plan})
        parser = profiles.read(response['parserIds'][0])
        self.assertEqual(len(parser['draft']['templates']), 1)
        self.assertEqual(len(parser['draft']['samples']), 1)
        self.assertIsNone(parser['draft']['templates'][0]['fields'][0]['region'])
        self.assertEqual(parser['versions'], [])
        self.assertEqual(response['scene']['draft']['bindings'][0]['version'], '')
        plan['parsers'][0]['layouts'][0]['sampleIds'] = ['not-uploaded']
        with self.assertRaisesRegex(ValueError, '未上传'): studio_planning.apply({'source': source, 'plan': plan})


class CompositionApiTests(IsolatedAsyncioTestCase):
    async def test_initial_ai_localization_is_grounded_and_not_published(self):
        with TemporaryDirectory() as folder, patch.object(profiles, 'ROOT', Path(folder)):
            profiles.atomic(profiles.ROOT / 'samples/sample-a/sample.json', fake_sample())
            body = {'source': {'request': '提取金额', 'sampleIds': ['sample-a']},
                    'plan': {'name': '付款', 'parsers': [{'name': '发票', 'layouts': [{'name': 'A', 'sampleIds': ['sample-a']}], 'fields': [{'name': '价税合计', 'key': 'invoice_total', 'kind': 'amount'}]}]}}
            proposal = {'fields': [{'name': '价税合计', 'key': 'total', 'kind': 'amount', 'evidence': [{'ref': 'value', 'quote': '123.45'}]}]}
            with patch.object(studio_planning.rule_generation, 'call_model', AsyncMock(return_value=(proposal, {'model': 'fixture'}))):
                created = await studio_planning.apply_assisted(body)
            self.assertEqual(created['localizedFields'], 1)
            self.assertEqual(created['warnings'], [])
            parser = profiles.read(created['parserIds'][0])
            rule = parser['draft']['templates'][0]['fields'][0]
            self.assertEqual(rule['key'], 'invoice_total', '规划的公共字段名保留')
            self.assertEqual(rule['review'], 'pending')
            self.assertEqual(parser['versions'], [])
            self.assertTrue(rule['region'])

    async def test_cancelled_initial_localization_creates_no_partial_resources(self):
        import asyncio
        with TemporaryDirectory() as folder, patch.object(profiles, 'ROOT', Path(folder)):
            profiles.atomic(profiles.ROOT / 'samples/sample-a/sample.json', fake_sample())
            body = {'source': {'request': '提取金额', 'sampleIds': ['sample-a']},
                    'plan': {'name': '付款', 'parsers': [{'name': '发票', 'layouts': [{'name': 'A', 'sampleIds': ['sample-a']}], 'fields': [{'name': '金额', 'key': 'total'}]}]}}
            with patch.object(studio_planning.rule_generation, 'generate', AsyncMock(side_effect=asyncio.CancelledError)):
                with self.assertRaises(asyncio.CancelledError):
                    await studio_planning.apply_assisted(body)
            self.assertEqual(profiles.listing(), [])
            self.assertEqual(scenes.listing(), [])

    async def test_upload_runtime_runs_only_frozen_rules_and_deduplicates_ocr(self):
        from .app import app
        from . import app as module
        with TemporaryDirectory() as folder, patch.object(profiles, 'ROOT', Path(folder)):
            profiles.atomic(profiles.ROOT / 'samples/sample-a/sample.json', fake_sample())
            value = draft(); profiles.save('profile-a', value); profiles.test('profile-a', 'sample-a', 'template-a'); profiles.publish('profile-a')
            scenes.save('payment', {'id': 'payment', 'name': '付款', 'bindings': [{'id': 'invoice', 'name': '发票', 'parserId': 'profile-a', 'version': '1.0.0'}]})
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://127.0.0.1:8768') as client:
                with patch.object(module, 'prepare_bundle_member', AsyncMock(return_value=fake_sample('sample-a', '999.50'))) as prepare, patch('service.rule_generation.call_model', side_effect=AssertionError('runtime must not invoke LLM')):
                    response = await client.post('/api/studio/scenes/payment/debug-bundle', files={'files': ('new.pdf', b'%PDF-1.4')})
                    self.assertEqual(response.status_code, 200, response.text)
                    self.assertEqual(response.json()['data']['invoice'][0]['total'], '999.50')
                    self.assertFalse(response.json()['usesLlm']); self.assertEqual(prepare.await_count, 1)
                    self.assertEqual((await client.post('/api/studio/scenes/payment/publish')).status_code, 200)
                    runtime = await client.post('/api/studio/scenes/payment/execute', data={'version': '1.0.0'}, files={'files': ('new.pdf', b'%PDF-1.4')})
                    self.assertEqual(runtime.status_code, 200, runtime.text)
                    self.assertEqual(runtime.json()['data']['invoice'][0]['total'], '999.50')
                    self.assertEqual(len((await client.get('/api/studio/scenes/payment/runs')).json()), 1)

    async def test_ai_plan_is_a_proposal_and_uses_all_sheets(self):
        with TemporaryDirectory() as folder, patch.object(profiles, 'ROOT', Path(folder)):
            body = studio_planning.Request(request='按三个工作表创建', requirements=[{'fileName': 'fields.xlsx', 'sheet': str(i), 'fields': [{'name': '金额', 'rule': '', 'cell': 'A1', 'ruleCell': None, 'group': ''}]} for i in range(3)])
            proposal = {'name': '付款', 'parsers': [{'name': '发票', 'fields': [{'name': '金额', 'key': 'total'}]}]}
            with patch.object(studio_planning.rule_generation, 'call_model', AsyncMock(return_value=(proposal, {'model': 'fixture'}))) as model:
                value = await studio_planning.generate(body)
                context = json.loads(model.call_args.args[0][-1]['content'])
                self.assertEqual(len(context['requirements']), 3)
                self.assertTrue(value['usesLlm'])
                self.assertEqual(profiles.listing(), []); self.assertEqual(scenes.listing(), [])
