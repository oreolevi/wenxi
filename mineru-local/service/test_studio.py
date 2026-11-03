from copy import deepcopy
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase, IsolatedAsyncioTestCase
from unittest.mock import patch
import httpx

from . import profiles, studio, library
from .test_profiles import draft, fake_sample


class StudioTests(TestCase):
    def setUp(self):
        self.temporary = TemporaryDirectory()
        self.root = patch.object(profiles, 'ROOT', Path(self.temporary.name))
        self.root.start()
        profiles.atomic(profiles.ROOT / 'samples/sample-a/sample.json', fake_sample())
        profiles.atomic(profiles.ROOT / 'samples/sample-b/sample.json', fake_sample('sample-b', '999.50'))
        bad = fake_sample('sample-bad')
        bad['blocks'][0]['text'] = '未知单据'
        profiles.atomic(profiles.ROOT / 'samples/sample-bad/sample.json', bad)
        config = draft()
        config['samples'] = [{'sampleId': 'sample-b', 'templateId': 'template-a', 'role': 'test'},
                             {'sampleId': 'sample-bad', 'templateId': '', 'role': 'test'}]
        profiles.save('profile-a', config)

    def tearDown(self):
        self.root.stop()
        self.temporary.cleanup()

    def test_dataset_change_does_not_invalidate_tested_runtime_configuration(self):
        profiles.test('profile-a', 'sample-a', 'template-a')
        before = profiles.read('profile-a')
        changed = deepcopy(before['draft'])
        changed['samples'][0]['role'] = 'calibration'
        saved = profiles.save('profile-a', changed)
        self.assertEqual(saved['lastTest'], before['lastTest'])
        self.assertEqual(profiles.fingerprint(saved['draft']), profiles.fingerprint(before['draft']))

    def test_replay_is_persistent_uses_real_new_values_and_never_runs_ocr(self):
        from . import preprocessing
        with patch.object(preprocessing, 'recognize', side_effect=AssertionError('Replay must not run OCR')):
            result = studio.evaluate('profile-a', ['sample-a', 'sample-b'])
        self.assertTrue(result['passed'])
        self.assertEqual([row['result']['data']['total'] for row in result['rows']], ['123.45', '999.50'])
        self.assertEqual(result['mode'], 'rule_replay')
        self.assertNotIn('accuracy', result['summary'])
        self.assertEqual(studio.report('profile-a', result['id']), result)
        self.assertEqual(studio.reports('profile-a')[0]['summary']['passed'], 2)
        self.assertEqual(profiles.publish('profile-a')['versions'], ['1.0.0'])

    def test_partial_failure_keeps_successes_and_prevents_publish_of_failed_config(self):
        profiles.test('profile-a', 'sample-a', 'template-a')
        result = studio.evaluate('profile-a', ['sample-b', 'sample-bad'])
        self.assertFalse(result['passed'])
        self.assertTrue(result['rows'][0]['passed'])
        self.assertIn('版式', result['rows'][1]['error'])
        self.assertEqual(result['summary']['failed'], 1)
        with self.assertRaisesRegex(ValueError, '批量回放未通过'):
            profiles.publish('profile-a')

    def test_report_uses_frozen_config_and_does_not_overwrite_concurrent_edits(self):
        original = profiles.extract_batch
        def changed(draft_snapshot, *args):
            live = deepcopy(profiles.read('profile-a')['draft'])
            live['templates'][0]['fields'][0]['key'] = 'new_total'
            profiles.save('profile-a', live)
            return original(draft_snapshot, *args)
        with patch.object(profiles, 'extract_batch', side_effect=changed):
            result = studio.evaluate('profile-a', ['sample-b'])
        self.assertIn('total', result['rows'][0]['result']['data'])
        self.assertEqual(result['draft']['templates'][0]['fields'][0]['key'], 'total')
        self.assertEqual(profiles.read('profile-a')['draft']['templates'][0]['fields'][0]['key'], 'new_total')
        self.assertNotIn('lastEvaluation', profiles.read('profile-a'))

    def test_foreign_samples_duplicate_ids_and_invalid_roles_are_rejected(self):
        for ids in ([], ['sample-b', 'sample-b'], ['unbound-sample']):
            with self.assertRaises(ValueError):
                studio.evaluate('profile-a', ids)
        changed = profiles.read('profile-a')['draft']
        changed['samples'][0]['role'] = 'anything'
        with self.assertRaises(ValueError):
            profiles.save('profile-a', changed)
        with self.assertRaises(ValueError):
            studio.report('profile-a', '../outside')

    def test_call_records_store_actual_outcome_but_no_extracted_values(self):
        studio.record_run('profile-a', '1.0.0', 'invoice.pdf', 42.3, {'passed': True, 'elapsedMs': .2, 'summary': {'total': 1}, 'data': {'secret': 'not-in-log'}})
        studio.record_run('profile-a', '1.0.0', 'unknown.pdf', 19, error='版式不匹配')
        values = studio.runs('profile-a')
        self.assertEqual(len(values), 2)
        self.assertEqual({row['status'] for row in values}, {'succeeded', 'failed'})
        self.assertNotIn('not-in-log', str(values))

    def test_public_catalog_is_explicit_and_keeps_independent_publisher_snapshots(self):
        profiles.test('profile-a', 'sample-a', 'template-a')
        profiles.publish('profile-a')
        self.assertEqual(library.listing(), [], 'Publishing a runtime version is independent of sharing it')
        first = library.share('profile-a', {'version': '1.0.0', 'publisher': '测试发布人甲', 'team': '测试团队甲'})
        other = deepcopy(profiles.read('profile-a')['draft'])
        other['id'] = 'profile-b'
        other['name'] = '另一个场景'
        profiles.save('profile-b', other)
        profiles.test('profile-b', 'sample-a', 'template-a')
        profiles.publish('profile-b')
        library.share('profile-b', {'version': '1.0.0', 'publisher': '测试发布人乙'})
        entries = library.listing()
        self.assertEqual({entry['publisher'] for entry in entries}, {'测试发布人甲', '测试发布人乙'})
        self.assertTrue(all('draft' not in entry for entry in entries))
        changed = profiles.read('profile-a')['draft']
        changed['name'] = '修改后的私有草稿'
        changed['templates'][0]['fields'][0]['key'] = 'changed_key'
        profiles.save('profile-a', changed)
        self.assertNotEqual(library.read(first['id'])['name'], changed['name'])
        self.assertEqual(library.read(first['id'])['draft']['templates'][0]['fields'][0]['key'], 'total')
        self.assertNotIn('123.45', str(library.listing()), 'Catalog summaries contain schema, never extracted values')

    def test_public_catalog_rejects_unpublished_versions_and_invalid_labels(self):
        with self.assertRaises(FileNotFoundError):
            library.share('profile-a', {'version': '1.0.0', 'publisher': '测试'})
        with self.assertRaises(ValueError):
            library.share('profile-a', {'version': '1.0.0', 'publisher': '   '})
        with self.assertRaises(ValueError):
            library.read('../outside')

    def test_publication_requires_review_and_uses_frozen_version(self):
        profiles.test('profile-a', 'sample-a', 'template-a')
        profiles.publish('profile-a')
        body = {'version': '1.0.0', 'publisher': '申请人'}
        request = library.submit('profile-a', body)
        self.assertEqual(request['status'], 'pending')
        self.assertTrue(request['mock'])
        self.assertNotIn('snapshot', request)
        self.assertEqual(library.listing(), [])
        self.assertEqual(library.submit('profile-a', body)['id'], request['id'])
        changed = profiles.read('profile-a')['draft']
        changed['name'] = '不能影响公开快照的新草稿'
        profiles.save('profile-a', changed)
        approved = library.decide(request['id'], {'decision': 'approved', 'reviewer': '审核员'})
        entry = library.read(approved['entryId'])
        self.assertNotEqual(entry['draft']['name'], changed['name'])
        self.assertEqual(profiles.read('profile-a')['draft']['name'], changed['name'])
        self.assertEqual(profiles.read('profile-a')['versions'], ['1.0.0'])
        self.assertEqual(library.reviews()[0]['status'], 'approved')
        self.assertNotIn('snapshot', library.reviews()[0])
        with self.assertRaisesRegex(ValueError, '已处理'):
            library.decide(request['id'], {'decision': 'rejected', 'reviewer': '审核员', 'comment': '重复操作'})

    def test_rejection_is_private_and_can_be_resubmitted(self):
        profiles.test('profile-a', 'sample-a', 'template-a')
        profiles.publish('profile-a')
        body = {'version': '1.0.0', 'publisher': '申请人'}
        first = library.submit('profile-a', body)
        with self.assertRaisesRegex(ValueError, '修改意见'):
            library.decide(first['id'], {'decision': 'rejected', 'reviewer': '审核员'})
        library.decide(first['id'], {'decision': 'rejected', 'reviewer': '审核员', 'comment': '补充场景描述'})
        self.assertEqual(library.listing(), [])
        self.assertEqual(profiles.read('profile-a')['versions'], ['1.0.0'])
        second = library.submit('profile-a', body)
        self.assertNotEqual(second['id'], first['id'])
        self.assertEqual(len(library.reviews()), 2)
        with self.assertRaises(ValueError):
            library.decide('../outside', {'decision': 'approved', 'reviewer': '审核员'})


class StudioApiTests(IsolatedAsyncioTestCase):
    async def test_dataset_report_version_and_actual_api_execution_log_routes(self):
        from . import app
        with TemporaryDirectory() as temporary, patch.object(profiles, 'ROOT', Path(temporary) / 'profiles'), patch.object(app, 'STORAGE', Path(temporary) / 'jobs'):
            app.STORAGE.mkdir()
            profiles.atomic(profiles.ROOT / 'samples/sample-a/sample.json', fake_sample())
            profiles.save('profile-a', draft())
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app.app), base_url='http://127.0.0.1:8768') as client:
                result = await client.post('/api/extraction-profiles/profile-a/evaluations', json={'sampleIds': ['sample-a']})
                self.assertEqual(result.status_code, 200)
                self.assertTrue(result.json()['passed'])
                report_id = result.json()['id']
                self.assertEqual((await client.get(f'/api/extraction-profiles/profile-a/evaluations/{report_id}')).json()['id'], report_id)
                self.assertEqual(len((await client.get('/api/extraction-profiles/profile-a/evaluations')).json()), 1)
                self.assertEqual((await client.post('/api/extraction-profiles/profile-a/publish')).status_code, 200)
                self.assertEqual((await client.get('/api/extraction-profiles/profile-a/versions/1.0.0')).json()['id'], 'profile-a')
                self.assertEqual((await client.get('/api/scene-library')).json(), [])
                shared = await client.post('/api/extraction-profiles/profile-a/share', json={'version': '1.0.0', 'publisher': '接口测试人'})
                self.assertEqual(shared.status_code, 200)
                self.assertEqual(shared.json()['status'], 'pending')
                self.assertEqual((await client.get('/api/scene-library')).json(), [])
                self.assertEqual(len((await client.get('/api/scene-publication-reviews')).json()), 1)
                approved = await client.post('/api/scene-publication-reviews/' + shared.json()['id'] + '/decision', json={'decision': 'approved', 'reviewer': '接口审核人'})
                self.assertEqual(approved.status_code, 200)
                self.assertEqual((await client.get('/api/scene-library')).json()[0]['publisher'], '接口测试人')
                self.assertEqual((await client.get('/api/scene-library/' + approved.json()['entryId'])).json()['draft']['id'], 'profile-a')
                def recognize(job):
                    fixture = fake_sample('incoming', '555.55')
                    job.blocks = fixture['blocks']
                    job.document = {'id': job.id, 'engine': 'test-fixture', 'pages': fixture['pages']}
                    return True
                with patch.object(app, 'recognize_text_pdf', side_effect=recognize), patch.object(app.activity, 'start'), patch.object(app.activity, 'complete'):
                    response = await client.post('/api/extraction-profiles/profile-a/execute', data={'version': '1.0.0'}, files={'file': ('invoice.pdf', b'%PDF-test', 'application/pdf')})
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json()['data']['total'], '555.55')
                runs = (await client.get('/api/extraction-profiles/profile-a/runs')).json()
                self.assertEqual(len(runs), 1)
                self.assertEqual(runs[0]['status'], 'succeeded')
                self.assertFalse(runs[0]['usesLlm'])
