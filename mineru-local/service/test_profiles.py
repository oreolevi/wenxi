from copy import deepcopy
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest import TestCase, IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, patch

import httpx

from . import profiles


def fake_sample(sample_id='sample-a', value='123.45'):
    return {'id': sample_id, 'name': 'invoice.pdf', 'engine': 'PDF 文字层', 'sourceHash': sample_id,
            'pages': [{'number': 1, 'width': 800, 'height': 600, 'imageUrl': '/sample.png'}],
            'blocks': [
                {'ref': 'title', 'text': '电子发票', 'bbox': [.3, .04, .6, .09], 'pageIndex': 0, 'blockIndex': 0},
                {'ref': 'label', 'text': '价税合计：', 'bbox': [.1, .6, .3, .65], 'pageIndex': 0, 'blockIndex': 1},
                {'ref': 'value', 'text': value, 'bbox': [.4, .6, .6, .65], 'pageIndex': 0, 'blockIndex': 2},
            ]}


def draft():
    return {'id': 'profile-a', 'name': '发票固定提取', 'description': '测试用虚构样例', 'templates': [
        {'id': 'template-a', 'name': '电子发票 A', 'sampleId': 'sample-a', 'matchTexts': ['电子发票'], 'fields': [
            {'id': 'amount', 'key': 'total', 'name': '价税合计', 'kind': 'amount', 'method': 'region',
             'page': 1, 'region': [.38, .58, .63, .67], 'anchor': '', 'direction': 'right', 'required': True},
        ]},
    ]}


class ProfileTests(TestCase):
    def setUp(self):
        self.temporary = TemporaryDirectory()
        self.patch = patch.object(profiles, 'ROOT', Path(self.temporary.name))
        self.patch.start()
        profiles.atomic(profiles.ROOT / 'samples/sample-a/sample.json', fake_sample())
        profiles.atomic(profiles.ROOT / 'samples/sample-b/sample.json', fake_sample('sample-b', '¥999.50'))

    def tearDown(self):
        self.patch.stop()
        self.temporary.cleanup()

    def test_release_history_is_immutable_read_only_and_legacy_safe(self):
        profiles.save('profile-a', draft())
        self.assertEqual(profiles.releases('profile-a'), [])
        profiles.test('profile-a', 'sample-a', 'template-a')
        profiles.publish('profile-a', '首次发布')
        release = profiles.ROOT / 'versions/profile-a/1.0.0.json'
        original = release.read_bytes()
        history = profiles.releases('profile-a')
        self.assertEqual(history[0]['version'], '1.0.0')
        self.assertTrue(history[0]['publishedAt'])
        self.assertEqual(history[0]['tests'], {'passed': 1, 'total': 1})
        self.assertEqual(history[0]['note'], '首次发布')
        changed = draft(); changed['templates'][0]['fields'][0]['name'] = '新名称'
        profiles.save('profile-a', changed)
        self.assertEqual(profiles.releases('profile-a'), history)
        self.assertEqual(release.read_bytes(), original)
        profiles.test('profile-a', 'sample-a', 'template-a')
        profiles.publish('profile-a', '修改字段名称')
        self.assertEqual([row['version'] for row in profiles.releases('profile-a')], ['1.1.0', '1.0.0'])
        self.assertEqual(profiles.releases('profile-a')[1], history[0])
        import json
        legacy = json.loads(original); legacy.pop('tests'); legacy.pop('note')
        profiles.atomic(release, legacy)
        self.assertIsNone(profiles.releases('profile-a')[1]['tests'], '旧记录不使用当前草稿测试状态补写历史')
        self.assertEqual(profiles.releases('profile-a')[1]['note'], '')

    def test_region_rule_reads_new_values_and_retains_actual_evidence(self):
        value = draft()
        profiles.save('profile-a', value)
        result = profiles.test('profile-a', 'sample-b', 'template-a')
        self.assertTrue(result['passed'])
        self.assertFalse(result['usesLlm'])
        self.assertEqual(result['scope'], 'new-sample')
        self.assertEqual(result['fields'][0]['value'], '999.50')
        self.assertEqual(result['fields'][0]['raw'], '¥999.50')
        self.assertEqual(result['fields'][0]['evidence'][0]['ref'], 'value')
        self.assertEqual(result['fields'][0]['bbox'], [.4, .6, .6, .65])

    def test_anchor_rule_uses_label_position(self):
        value = draft()
        value['templates'][0]['fields'][0].update(method='anchor', anchor='价税合计')
        profiles.save('profile-a', value)
        self.assertEqual(profiles.test('profile-a', 'sample-b', 'template-a')['fields'][0]['value'], '999.50')

    def test_unknown_layout_is_rejected_without_guessing(self):
        reference, incoming = fake_sample(), fake_sample('other')
        incoming['blocks'][0]['text'] = '普通送货单'
        self.assertFalse(profiles.matches_layout(reference, incoming, draft()['templates'][0]))
        with self.assertRaisesRegex(ValueError, '版式不匹配'):
            profiles.extract(reference, incoming, draft()['templates'][0])
        incoming = fake_sample('shifted')
        incoming['blocks'][1]['bbox'] = [.5, .8, .7, .85]
        self.assertFalse(profiles.matches_layout(reference, incoming, draft()['templates'][0]))

    def test_publish_requires_tests_and_draft_edits_do_not_change_immutable_version(self):
        profiles.save('profile-a', draft())
        with self.assertRaisesRegex(ValueError, '先对当前配置'):
            profiles.publish('profile-a')
        profiles.test('profile-a', 'sample-b', 'template-a')
        self.assertEqual(profiles.publish('profile-a')['versions'], ['1.0.0'])
        self.assertEqual(profiles.publish('profile-a')['versions'], ['1.0.0'])
        changed = draft()
        changed['templates'][0]['fields'][0]['key'] = 'changed_total'
        profiles.save('profile-a', changed)
        result = profiles.execute('profile-a', '1.0.0', 'sample-b')
        self.assertEqual(result['data'], {'total': '999.50'})
        with self.assertRaisesRegex(ValueError, '先对当前配置'):
            profiles.publish('profile-a')
        profiles.test('profile-a', 'sample-b', 'template-a')
        self.assertEqual(profiles.publish('profile-a')['versions'], ['1.0.0', '1.1.0'])
        self.assertEqual(profiles.execute('profile-a', '1.0.0', 'sample-b')['data'], {'total': '999.50'})
        self.assertEqual(profiles.execute('profile-a', '1.1.0', 'sample-b')['data'], {'changed_total': '999.50'})

    def test_invalid_amount_and_missing_value_are_not_successful_results(self):
        incoming = fake_sample('bad', '¥123.00 ¥456.00')
        result = profiles.extract(fake_sample(), incoming, draft()['templates'][0])
        self.assertFalse(result['passed'])
        self.assertEqual(result['fields'][0]['status'], 'invalid')
        incoming['blocks'].pop()
        result = profiles.extract(fake_sample(), incoming, draft()['templates'][0])
        self.assertFalse(result['passed'])
        self.assertEqual(result['fields'][0]['status'], 'missing')

    def test_configuration_and_asset_paths_are_validated(self):
        with self.assertRaises(ValueError):
            profiles.read('../outside')
        value = draft()
        value['templates'][0]['fields'][0]['region'] = [.9, .1, .2, .5]
        with self.assertRaises(ValueError):
            profiles.save('profile-a', value)
        value = draft()
        value['templates'][0]['fields'].append(deepcopy(value['templates'][0]['fields'][0]))
        with self.assertRaisesRegex(ValueError, '不能重复'):
            profiles.save('profile-a', value)
        with self.assertRaises(FileNotFoundError):
            profiles.sample_asset('sample-a', 'sample.json')

    def test_ambiguous_templates_require_explicit_template_id(self):
        value = draft()
        duplicate = deepcopy(value['templates'][0]); duplicate['id'] = 'template-b'
        value['templates'].append(duplicate)
        profiles.save('profile-a', value)
        for template in value['templates']:
            profiles.test('profile-a', 'sample-b', template['id'])
        profiles.publish('profile-a')
        with self.assertRaisesRegex(ValueError, '唯一'):
            profiles.execute('profile-a', '1.0.0', 'sample-b')
        self.assertTrue(profiles.execute('profile-a', '1.0.0', 'sample-b', 'template-b')['passed'])


class ProfileRuntimeTests(IsolatedAsyncioTestCase):
    async def test_ocr_only_worker_never_calls_deepseek_even_when_configured(self):
        from . import app
        with TemporaryDirectory() as temporary:
            job = app.Job('test', 'test.pdf', '.pdf', [], Path(temporary), ocr_only=True)
            job.acknowledged.set()
            def recognize(value):
                value.blocks = fake_sample()['blocks']
                value.document = {'id': value.id, 'pages': [], 'extractor': 'label-match'}
                return True
            with patch.object(app, 'recognize_text_pdf', recognize), patch.object(app.semantic, 'enabled', return_value=True), \
                    patch.object(app.semantic, 'extract_fields', new_callable=AsyncMock) as semantic, \
                    patch.object(app.activity, 'start'), patch.object(app.activity, 'complete'):
                await app.run_job(job)
                self.assertEqual(job.status, 'succeeded')
                semantic.assert_not_called()
                self.assertEqual(job.document['extractor'], 'label-match')

    async def test_profile_api_persists_tests_and_published_versions(self):
        from . import app
        with TemporaryDirectory() as temporary, patch.object(profiles, 'ROOT', Path(temporary)):
            profiles.atomic(profiles.ROOT / 'samples/sample-a/sample.json', fake_sample())
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app.app), base_url='http://127.0.0.1:8768') as client:
                saved = await client.put('/api/extraction-profiles/profile-a', json=draft())
                self.assertEqual(saved.status_code, 200)
                self.assertEqual((await client.post('/api/extraction-profiles/profile-a/publish')).status_code, 422)
                tested = await client.post('/api/extraction-profiles/profile-a/test', json={'sampleId': 'sample-a', 'templateId': 'template-a'})
                self.assertTrue(tested.json()['passed'])
                self.assertEqual((await client.post('/api/extraction-profiles/profile-a/publish', json={'note': '首次发布'})).json()['versions'], ['1.0.0'])
                releases = await client.get('/api/extraction-profiles/profile-a/releases')
                self.assertEqual(releases.status_code, 200)
                self.assertEqual(releases.json()[0]['tests'], {'passed': 1, 'total': 1})
                self.assertEqual(releases.json()[0]['note'], '首次发布')
                frozen = (await client.get('/api/extraction-profiles/profile-a/versions/1.0.0')).json()
                self.assertEqual(frozen['templates'][0]['fields'][0]['key'], 'total')
                self.assertEqual((await client.get('/api/extraction-profiles')).json()[0]['fields'], 1)
                read = (await client.get('/api/extraction-profiles/profile-a')).json()
                self.assertEqual(read['publishedDraft']['templates'][0]['fields'][0]['key'], 'total')
