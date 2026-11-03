from copy import deepcopy
from io import BytesIO
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase, IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, patch
from zipfile import ZipFile, ZIP_DEFLATED

import httpx

from . import bundles, profiles, routing
from .test_profiles import fake_sample, draft


def contract(sample_id='contract-a', value='800.00'):
    data = fake_sample(sample_id, value)
    data['blocks'][0]['text'] = '采购合同'
    data['name'] = '合同.pdf'
    data['pages'].append({**data['pages'][0], 'number': 2})
    data['blocks'].append({'ref': 'signature', 'text': '双方签章', 'bbox': [.1, .8, .5, .85], 'pageIndex': 1, 'blockIndex': 0})
    return data


def scene():
    value = draft()
    invoice = value['templates'][0]
    invoice.update(materialTypeId='invoice', classification='confirmed', referencePage=1)
    other = deepcopy(invoice)
    other.update(id='contract-template', name='合同版式', materialTypeId='contract', sampleId='contract-a', matchTexts=['采购合同'], referencePage=None)
    value['templates'].append(other)
    value['materialTypes'] = [
        {'id': 'invoice', 'name': '发票', 'outputKey': 'invoices', 'required': False, 'grouping': 'per_page'},
        {'id': 'contract', 'name': '合同', 'outputKey': 'contracts', 'required': True, 'grouping': 'document'},
    ]
    value['output'] = {'mode': 'by_type'}
    return value


def archive(entries):
    stream = BytesIO()
    with ZipFile(stream, 'w', ZIP_DEFLATED) as package:
        for name, content in entries:
            package.writestr(name, content)
    return stream.getvalue()


class SceneRoutingTests(TestCase):
    def setUp(self):
        self.directory = TemporaryDirectory()
        self.patch = patch.object(profiles, 'ROOT', Path(self.directory.name)); self.patch.start()
        for sample in [fake_sample(), contract()]:
            profiles.atomic(profiles.ROOT / 'samples' / sample['id'] / 'sample.json', sample)

    def tearDown(self):
        self.patch.stop(); self.directory.cleanup()

    def test_contract_keeps_pages_in_one_unit_and_invoices_are_split_without_cross_applying_rules(self):
        value = scene()
        result = profiles.extract_batch(value, contract('new-contract', '900.00'))
        self.assertTrue(result['passed'])
        self.assertEqual(len(result['items']), 1)
        self.assertEqual(result['items'][0]['pages'], [1, 2])
        self.assertEqual(result['data']['contracts'][0]['total'], '900.00')
        invoice = fake_sample('new-invoice', '200.00'); invoice['name'] = '两张发票.pdf'
        invoice['pages'].append({**invoice['pages'][0], 'number': 2})
        for block in fake_sample(value='300.00')['blocks']:
            invoice['blocks'].append({**block, 'ref': 'second-' + block['ref'], 'pageIndex': 1})
        result = profiles.extract_batch(value, invoice)
        self.assertTrue(result['passed'])
        self.assertEqual([item['total'] for item in result['data']['invoices']], ['200.00', '300.00'])
        self.assertEqual(result['items'][1]['fields'][0]['page'], 2)
        complete = routing.bundle_result(value, [{'name': '合同.pdf', 'result': profiles.extract_batch(value, contract())}, {'name': '发票.pdf', 'result': result}], 100)
        self.assertTrue(complete['passed'])
        self.assertEqual(len(complete['data']['invoices']), 2)
        self.assertEqual(complete['missingTypes'], [])

    def test_unknown_ambiguous_and_missing_required_materials_are_visible(self):
        value = scene()
        unknown = fake_sample('unknown'); unknown['blocks'][0]['text'] = '未知表格'
        result = profiles.extract_batch(value, unknown)
        self.assertFalse(result['passed'])
        self.assertEqual(len(result['unmatched']), 1)
        self.assertIn('未匹配', result['items'][0]['error'])
        duplicate = deepcopy(value['templates'][0]); duplicate['id'] = 'duplicate'; duplicate['materialTypeId'] = 'contract'; duplicate['sampleId'] = 'sample-a'
        value['materialTypes'][1]['grouping'] = 'per_page'; value['templates'].append(duplicate)
        result = profiles.extract_batch(value, fake_sample())
        self.assertFalse(result['passed'])
        self.assertIn('多个', result['items'][0]['error'])
        incomplete = routing.bundle_result(scene(), [{'name': '发票.pdf', 'result': profiles.extract_batch(scene(), fake_sample())}, {'name': '坏文件.pdf', 'error': '识别失败'}], 10)
        self.assertFalse(incomplete['passed'])
        self.assertEqual(incomplete['missingTypes'], ['合同'])
        self.assertTrue(any(item.get('error') == '识别失败' for item in incomplete['unmatched']))

    def test_material_association_and_output_policy_are_versioned(self):
        value = scene(); profiles.save('profile-a', value)
        for template in value['templates']:
            profiles.test('profile-a', template['sampleId'], template['id'])
        profiles.publish('profile-a')
        value['output'] = {'mode': 'records'}
        profiles.save('profile-a', value)
        self.assertEqual(profiles.published('profile-a', '1.0.0')['output']['mode'], 'by_type')
        with self.assertRaisesRegex(ValueError, '重新测试'):
            profiles.publish('profile-a')
        value['templates'][0]['materialTypeId'] = 'missing'
        with self.assertRaisesRegex(ValueError, '类型不存在'):
            profiles.save('profile-a', value)

    def test_unconfirmed_grouping_cannot_be_published(self):
        value = scene(); value['templates'][0]['classification'] = 'suggested'
        profiles.save('profile-a', value)
        with self.assertRaisesRegex(ValueError, '确认'):
            profiles.publish('profile-a')

    def test_zip_preserves_files_reports_unsupported_members_and_rejects_unsafe_archives(self):
        content = archive([('合同/合同.pdf', b'pdf-fixture'), ('发票/票据.png', b'image'), ('字段.xlsx', b'excel'), ('__MACOSX/.DS_Store', b'meta')])
        entries, failures = bundles.unpack([('材料.zip', content)])
        self.assertEqual([entry[0] for entry in entries], ['合同/合同.pdf', '发票/票据.png'])
        self.assertEqual(len(failures), 1)
        for name in ['../outside.pdf', '/absolute.pdf', 'C:/outside.pdf']:
            with self.assertRaisesRegex(ValueError, '无效路径'):
                bundles.unpack([('bad.zip', archive([(name, b'fixture')]))])
        with self.assertRaises(ValueError):
            bundles.unpack([('bad.zip', b'incomplete')])
        with self.assertRaisesRegex(ValueError, '20'):
            bundles.unpack([('too-many.zip', archive([(f'{index}.pdf', b'fixture') for index in range(21)]))])


class SceneBundleApiTests(IsolatedAsyncioTestCase):
    async def test_zip_intake_debug_and_published_bundle_use_same_engine_without_llm(self):
        from . import app
        with TemporaryDirectory() as temporary, patch.object(profiles, 'ROOT', Path(temporary)):
            for sample in [fake_sample(), contract()]:
                profiles.atomic(profiles.ROOT / 'samples' / sample['id'] / 'sample.json', sample)
            profiles.save('profile-a', scene())
            for template in scene()['templates']:
                profiles.test('profile-a', template['sampleId'], template['id'])
            profiles.publish('profile-a')
            async def recognize(name, content, policy, request, *, persist):
                if 'bad' in name:
                    raise ValueError('文件损坏')
                data = contract() if 'contract' in name else fake_sample()
                data['name'] = name
                return deepcopy(data)
            payload = archive([('contract.pdf', b'contract'), ('invoice.pdf', b'invoice'), ('bad.pdf', b'bad')])
            with patch.object(app, 'prepare_bundle_member', side_effect=recognize), patch.object(app.semantic, 'extract_fields', new_callable=AsyncMock) as model:
                async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app.app), base_url='http://127.0.0.1:8768') as client:
                    intake = await client.post('/api/profile-sample-bundles', files=[('files', ('bundle.zip', payload))])
                    self.assertEqual(len(intake.json()['samples']), 2)
                    self.assertEqual(len(intake.json()['failures']), 1)
                    debug = await client.post('/api/extraction-profiles/profile-a/debug-bundle', files=[('files', ('bundle.zip', payload))])
                    self.assertEqual(debug.status_code, 200)
                    self.assertFalse(debug.json()['passed'])
                    self.assertEqual(len(debug.json()['data']['contracts']), 1)
                    self.assertEqual(len(debug.json()['data']['invoices']), 1)
                    runtime = await client.post('/api/extraction-profiles/profile-a/execute-bundle', data={'version': '1.0.0'}, files=[('files', ('bundle.zip', payload))])
                    self.assertEqual(runtime.status_code, 200)
                    self.assertEqual(runtime.json()['data'], debug.json()['data'])
                    self.assertFalse(runtime.json()['usesLlm'])
                    self.assertEqual(len(app.studio.runs('profile-a')), 1)
                    self.assertEqual(profiles.read('profile-a')['versions'], ['1.0.0'])
                    model.assert_not_called()
