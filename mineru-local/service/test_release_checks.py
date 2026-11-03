from copy import deepcopy
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase, IsolatedAsyncioTestCase
from unittest.mock import patch
import httpx
from . import profiles, scenes
from .test_profiles import draft, fake_sample


class ReleaseCheckTests(TestCase):
    def setUp(self):
        self.folder = TemporaryDirectory()
        self.storage = patch.object(profiles, 'ROOT', Path(self.folder.name))
        self.storage.start()
        profiles.atomic(profiles.ROOT / 'samples/sample-a/sample.json', fake_sample())

    def tearDown(self):
        self.storage.stop(); self.folder.cleanup()

    def test_check_is_read_only_and_points_to_unlocated_and_unreviewed_fields(self):
        value = draft()
        value['templates'][0]['fields'][0].update(region=None, origin='ai', review='pending')
        profiles.save('profile-a', value)
        path = profiles.ROOT / 'profiles/profile-a.json'; original = path.read_bytes()
        report = profiles.release_check('profile-a')
        self.assertFalse(report['ready'])
        self.assertEqual([i['code'] for i in report['issues']], ['location', 'review'])
        self.assertEqual(report['issues'][0]['target'], {'area': 'fields', 'templateId': 'template-a', 'fieldId': 'amount'})
        self.assertEqual(path.read_bytes(), original)
        with self.assertRaises(ValueError): profiles.publish('profile-a')

    def test_empty_service_has_one_clear_first_action(self):
        value = draft(); value['templates'] = []
        profiles.save('profile-a', value)
        report = profiles.release_check('profile-a')
        self.assertEqual(len(report['issues']), 1)
        self.assertEqual(report['issues'][0]['target']['area'], 'fields')

    def test_current_test_required_and_unchanged_version_not_republished(self):
        profiles.save('profile-a', draft())
        self.assertEqual(profiles.release_check('profile-a')['issues'][0]['target']['area'], 'test')
        profiles.test('profile-a', 'sample-a', 'template-a')
        report = profiles.release_check('profile-a')
        self.assertTrue(report['ready']); self.assertEqual(report['nextVersion'], '1.0.0')
        profiles.publish('profile-a')
        self.assertTrue(profiles.release_check('profile-a')['unchanged'])
        changed = profiles.read('profile-a')['draft']; changed['templates'][0]['fields'][0]['kind'] = 'text'
        profiles.save('profile-a', changed)
        self.assertFalse(profiles.release_check('profile-a')['ready'])
        with self.assertRaisesRegex(ValueError, '重新测试'): profiles.publish('profile-a')
        self.assertEqual(profiles.read('profile-a')['versions'], ['1.0.0'])

    def test_failed_batch_is_reported_and_cannot_be_bypassed(self):
        value = profiles.save('profile-a', draft()); profiles.test('profile-a', 'sample-a', 'template-a')
        value = profiles.read('profile-a'); value['lastEvaluation'] = {'hash': profiles.fingerprint(value['draft']), 'passed': False}
        profiles.atomic(profiles.ROOT / 'profiles/profile-a.json', value)
        report = profiles.release_check('profile-a')
        self.assertEqual(report['issues'][0]['target']['area'], 'evaluate')
        with self.assertRaisesRegex(ValueError, '批量回放未通过'): profiles.publish('profile-a')

    def test_scene_checks_missing_reference_then_current_bundle_test(self):
        profiles.save('profile-a', draft()); profiles.test('profile-a', 'sample-a', 'template-a'); profiles.publish('profile-a')
        value = {'id': 'scene-a', 'name': '转账', 'bindings': [{'id': 'invoice', 'parserId': 'profile-a', 'name': '发票', 'version': ''}]}
        scenes.save('scene-a', value)
        report = scenes.release_check('scene-a')
        self.assertEqual(report['issues'][0]['target'], {'area': 'services', 'bindingId': 'invoice'})
        value['bindings'][0]['version'] = '1.0.0'; scenes.save('scene-a', value)
        self.assertEqual(scenes.release_check('scene-a')['issues'][0]['target']['area'], 'test')
        record = scenes.read('scene-a'); scenes.remember_test('scene-a', record['draft'], {'passed': True})
        self.assertTrue(scenes.release_check('scene-a')['ready'])
        scenes.publish('scene-a')
        changed = deepcopy(record['draft']); changed['bindings'][0]['multiple'] = False; scenes.save('scene-a', changed)
        self.assertFalse(scenes.release_check('scene-a')['ready'])
        with self.assertRaisesRegex(ValueError, '联调'): scenes.publish('scene-a')


class ReleaseCheckApiTests(IsolatedAsyncioTestCase):
    async def test_both_read_only_routes_return_blockers_without_publication(self):
        from .app import app
        with TemporaryDirectory() as folder, patch.object(profiles, 'ROOT', Path(folder)):
            value = draft(); value['templates'] = []; profiles.save('profile-a', value)
            scenes.save('scene-a', {'id': 'scene-a', 'name': '转账', 'bindings': []})
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://127.0.0.1:8768') as client:
                for url in ['/api/extraction-profiles/profile-a/release-check', '/api/studio/scenes/scene-a/release-check']:
                    response = await client.get(url)
                    self.assertEqual(response.status_code, 200)
                    self.assertFalse(response.json()['ready']); self.assertTrue(response.json()['issues'])
            self.assertEqual(profiles.read('profile-a')['versions'], [])
            self.assertEqual(scenes.read('scene-a')['versions'], [])
