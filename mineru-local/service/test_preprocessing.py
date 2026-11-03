from copy import deepcopy
from pathlib import Path
from tempfile import TemporaryDirectory
import threading
from types import SimpleNamespace
from unittest import TestCase, IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, patch

import numpy as np
from PIL import Image, ImageDraw
from pydantic import ValidationError

from . import preprocessing as prep, profiles
from .test_profiles import fake_sample, draft


class GeometryTests(TestCase):
    def test_rotation_maps_all_corners_back_to_original(self):
        expected = {0: [.1, .2, .4, .5], 90: [.5, .1, .8, .4],
                    180: [.6, .5, .9, .8], 270: [.2, .6, .5, .9]}
        for angle in expected:
            box, polygon = prep.map_box([.1, .2, .4, .5], prep.rotation_inverse(angle))
            np.testing.assert_allclose(box, expected[angle])
            self.assertEqual(len(polygon), 4)

    def test_orientation_uses_geometry_not_confidence_alone(self):
        horizontal = [[np.array([[0, 0], [100, 0], [100, 12], [0, 12]]), ('可信文字', .93)]]
        vertical = [[np.array([[0, 0], [12, 0], [12, 100], [0, 100]]), ('可信文字', .99)]]
        self.assertGreater(prep.orientation_score(horizontal), prep.orientation_score(vertical))
        with Image.new('RGB', (80, 120), 'white') as image:
            responses = iter([vertical, horizontal, [], []])
            result = prep.orient(image, 'auto', lambda _: next(responses))
            self.assertEqual(result[2], 90)
            self.assertFalse(result[3])
            ambiguous = prep.orient(image, 'auto', lambda _: horizontal)
            self.assertTrue(ambiguous[3])
            self.assertEqual(ambiguous[2], 0)

    def test_deskew_preserves_normal_page_and_maps_expanded_canvas(self):
        image = Image.new('RGB', (800, 500), 'white')
        draw = ImageDraw.Draw(image)
        for y in range(80, 430, 60):
            draw.line((50, y, 750, y), fill='black', width=2)
        unchanged, matrix, angle = prep.deskew(image)
        self.assertEqual(angle, 0)
        np.testing.assert_allclose(matrix, np.eye(3))
        tilted = image.rotate(2, expand=True, fillcolor='white')
        corrected, matrix, angle = prep.deskew(tilted)
        self.assertAlmostEqual(abs(angle), 2, delta=.3)
        self.assertGreater(corrected.width, tilted.width)
        self.assertTrue(np.isfinite(matrix).all())
        # A forward transform followed by the recorded inverse recovers a point.
        point = np.array([.3, .4, 1])
        np.testing.assert_allclose(matrix @ np.linalg.inv(matrix) @ point, point, atol=1e-10)

    def test_grouping_keeps_contracts_and_same_invoice_continuations_together(self):
        pages = [{'number': 1}, {'number': 2}]
        block = lambda page, text: {'pageIndex': page, 'text': text}
        contract = [block(0, '设备采购合同'), block(1, '付款与交付')]
        self.assertEqual(len(prep.group_pages(pages, contract, 'auto')), 1)
        same = [block(i, '电子发票 发票号码：12345678901234567890') for i in range(2)]
        self.assertEqual(len(prep.group_pages(pages, same, 'auto')), 1)
        unique = [block(i, f'电子发票 发票号码：1234567890123456789{i}') for i in range(2)]
        self.assertEqual(len(prep.group_pages(pages, unique, 'auto')), 2)
        self.assertEqual(len(prep.group_pages(pages[:1], unique[:1], 'per_page')), 1)
        self.assertEqual(len(prep.group_pages(pages, contract, 'document')), 1)

    def test_unknown_preprocessing_options_fail_validation(self):
        for policy in ({'grouping': 'split_everything'}, {'perspective': 'auto'}, {'orientation': '45'}):
            with self.assertRaises(ValidationError):
                prep.Policy.model_validate(policy)

    def test_native_text_skips_ocr_and_records_original_image(self):
        from reportlab.pdfgen import canvas
        with TemporaryDirectory() as folder:
            folder = Path(folder)
            source = folder / 'input.pdf'
            pdf = canvas.Canvas(str(source))
            for i in range(12):
                pdf.drawString(60, 780 - i * 40, f'Business reference field {i}: value test fixture')
            pdf.save()
            job = SimpleNamespace(id='fixture', directory=folder, status='running', events=[], preprocessing_policy=None)
            with patch.object(prep, 'recognize', side_effect=AssertionError('Native text must skip OCR')):
                result = prep.process(job, source, threading.Lock())
            self.assertEqual(result['textSources']['pdfTextPages'], [1])
            self.assertEqual(result['preprocessing']['unitCount'], 1)
            self.assertTrue((folder / 'original-1.png').is_file())
            self.assertEqual(result['pages'][0]['rotation'], 0)
            self.assertEqual(result['blocks'][0]['originalBBox'], result['blocks'][0]['bbox'])


class BatchProfileTests(TestCase):
    def setUp(self):
        self.temporary = TemporaryDirectory()
        self.root = patch.object(profiles, 'ROOT', Path(self.temporary.name))
        self.root.start()
        profiles.atomic(profiles.ROOT / 'samples/sample-a/sample.json', fake_sample())
        self.config = draft()
        self.config['preprocessing'] = {'grouping': 'per_page', 'orientation': 'auto', 'deskew': 'auto'}
        self.config['templates'][0]['referencePage'] = 1

    def tearDown(self):
        self.root.stop()
        self.temporary.cleanup()

    def incoming(self):
        first, second = fake_sample(), fake_sample('sample-b', '999.50')
        second['pages'][0]['number'] = 2
        second['pages'][0]['toOriginal'] = prep.rotation_inverse(90).tolist()
        for block in second['blocks']:
            block.update(pageIndex=1, ref='second-' + block['ref'])
        return {**first, 'pages': first['pages'] + second['pages'], 'blocks': first['blocks'] + second['blocks']}

    def test_each_invoice_uses_same_rules_and_keeps_source_page_mapping(self):
        result = profiles.extract_batch(self.config, self.incoming())
        self.assertEqual(result['summary'], {'total': 2, 'succeeded': 2, 'failed': 0})
        self.assertEqual([item['data']['total'] for item in result['items']], ['123.45', '999.50'])
        field = result['items'][1]['fields'][0]
        self.assertEqual(field['page'], 2)
        self.assertEqual(field['evidence'][0]['pageIndex'], 1)
        np.testing.assert_allclose(field['originalBBox'], [.35, .4, .4, .6])

    def test_one_unknown_page_does_not_discard_valid_invoice(self):
        incoming = self.incoming()
        incoming['blocks'] = [block for block in incoming['blocks'] if block['ref'] != 'second-title']
        result = profiles.extract_batch(self.config, incoming)
        self.assertEqual(result['items'][0]['status'], 'succeeded')
        self.assertEqual(result['items'][1]['status'], 'failed')
        self.assertEqual(result['items'][1]['data'], {})
        self.assertFalse(result['passed'])

    def test_uncertain_direction_and_mismatched_preparation_fail_closed(self):
        incoming = self.incoming()
        incoming['pages'][1]['needsReview'] = True
        result = profiles.extract_batch(self.config, incoming)
        self.assertEqual(result['items'][1]['status'], 'failed')
        incoming['preprocessing'] = {'policy': {'orientation': 'off'}}
        with self.assertRaisesRegex(ValueError, '策略与方案不一致'):
            profiles.extract_batch(self.config, incoming)

    def test_published_policy_does_not_change_when_draft_changes(self):
        saved = profiles.save('profile-a', self.config)
        profiles.test('profile-a', 'sample-a', 'template-a')
        profiles.publish('profile-a')
        changed = deepcopy(saved['draft'])
        changed['preprocessing']['grouping'] = 'document'
        profiles.save('profile-a', changed)
        self.assertEqual(profiles.published('profile-a', '1.0.0')['preprocessing']['grouping'], 'per_page')
        result = profiles.execute('profile-a', '1.0.0', self.incoming())
        self.assertEqual(len(result['items']), 2)


class SemanticUnitTests(IsolatedAsyncioTestCase):
    async def test_general_extraction_isolates_invoices_and_restores_original_blocks(self):
        from . import app
        blocks = [{'pageIndex': 0, 'text': 'first'}, {'pageIndex': 1, 'text': 'second'}]
        job = SimpleNamespace(document={'units': [{'id': 'u1', 'label': '第 1 份', 'pages': [1]}, {'id': 'u2', 'label': '第 2 份', 'pages': [2]}]},
                              blocks=blocks, prompt='提取票号', fields=['票号'], events=[], latest_call=None)
        seen = []
        async def extract(current, *args):
            seen.append(deepcopy(current.blocks))
            return [{'name': '票号', 'key': 'invoice', 'status': 'pending'}], {'model': 'fixture', 'usage': {'total_tokens': 5}}
        with patch.object(app.semantic, 'extract_fields', side_effect=extract):
            fields, call = await app.extract_semantic_units(job)
        self.assertEqual([items[0]['pageIndex'] for items in seen], [0, 1])
        self.assertIs(job.blocks, blocks)
        self.assertEqual(len({field['key'] for field in fields}), 2)
        self.assertEqual(call['usage']['total_tokens'], 10)
