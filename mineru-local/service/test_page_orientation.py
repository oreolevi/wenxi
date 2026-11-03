from pathlib import Path
from tempfile import TemporaryDirectory
import threading
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import patch

import numpy as np
from PIL import Image, ImageDraw
import pypdfium2 as pdfium

from . import page_orientation as orientation, preprocessing as prep


class DirectionTests(TestCase):
    def test_confident_predictions_and_ambiguous_predictions(self):
        for i in range(4):
            scores = np.full(4, .025); scores[i] = .925
            self.assertEqual(orientation.decide(scores), (i * 90, False, .9))
        self.assertEqual(orientation.decide([.1, .45, .4, .05])[0:2], (0, True))
        for invalid in ([1, 0, 0], [1, 1, 0, 0], [float('nan'), 0, 0, 0], [-1, 1, 1, 0]):
            with self.assertRaises(ValueError):
                orientation.decide(invalid)

    def test_blank_pages_do_not_invoke_or_trust_a_classifier(self):
        with patch.object(orientation, 'session', side_effect=AssertionError('blank page')):
            self.assertEqual(orientation.predict(Image.new('RGB', (300, 500), 'white')), (0, True, 0.))

    def test_input_follows_rgb_normalization_and_fixed_shape(self):
        image = Image.new('RGB', (300, 500), (255, 0, 0))
        tensor = orientation.input_tensor(image)
        self.assertEqual(tensor.shape, (1, 3, 224, 224))
        self.assertEqual(tensor.dtype, np.float32)
        np.testing.assert_allclose(tensor[0, :, 100, 100], [(1-.485)/.229, -.456/.224, -.406/.225], atol=1e-6)


class PreparedPageTests(TestCase):
    def fixture(self, folder, tilt=0, turn=0):
        image = Image.new('RGB', (800, 1000), 'white')
        draw = ImageDraw.Draw(image)
        for y in range(100, 900, 70):
            draw.line((55, y, 740, y), fill='black', width=3)
        draw.rectangle((160, 240, 280, 290), fill='red')
        if tilt:
            image = image.rotate(tilt, expand=True, fillcolor='white')
        if turn:
            image = image.rotate(turn, expand=True)
        source = folder / 'input.pdf'
        image.save(source, 'PDF', resolution=108)
        return source

    def marker(self, path):
        data = np.asarray(Image.open(path).convert('RGB'))
        ys, xs = np.where((data[:, :, 0] > 180) & (data[:, :, 1] < 100) & (data[:, :, 2] < 100))
        self.assertGreater(len(xs), 50)
        h, w = data.shape[:2]
        return [(xs.min()+xs.max())/2/w, (ys.min()+ys.max())/2/h]

    def test_all_rotations_and_deskew_preserve_marker_mapping_to_actual_original(self):
        for angle in [0, 90, 180, 270]:
            for tilt in [0, 2, -2]:
                with self.subTest(angle=angle, tilt=tilt), TemporaryDirectory() as tmp:
                    folder = Path(tmp); source = self.fixture(folder, tilt, -angle)
                    job = SimpleNamespace(id='fixture', directory=folder, status='running', events=[], preprocessing_policy={'orientation': str(angle) if angle else 'off'})
                    with patch.object(prep, 'recognize', side_effect=AssertionError('Cloud must not run local OCR')):
                        result = prep.process(job, source, threading.Lock(), cloud=True)
                    page = result['pages'][0]
                    self.assertEqual(page['rotation'], angle)
                    if tilt: self.assertAlmostEqual(abs(page['deskewAngle']), 2, delta=.3)
                    center = np.array([*self.marker(folder/'page-1.png'), 1.])
                    original = np.asarray(page['toOriginal']) @ center
                    np.testing.assert_allclose(original[:2], self.marker(folder/'original-1.png'), atol=.003)
                    self.assertEqual(page['originalImageUrl'], '/api/documents/fixture/original-pages/1.png')
                    with pdfium.PdfDocument(result['canonical']) as pdf:
                        width, height = pdf[0].get_size()
                    self.assertAlmostEqual(width/height, page['width']/page['height'], delta=.002)

    def test_uncertain_direction_is_retained_and_fixed_rules_require_review(self):
        with TemporaryDirectory() as tmp:
            folder=Path(tmp); source=self.fixture(folder)
            job=SimpleNamespace(id='fixture', directory=folder, status='running', events=[], preprocessing_policy={'orientation':'auto', 'deskew':'off'})
            with patch.object(orientation, 'predict', return_value=(0, True, .01)):
                prepared=prep.process(job, source, threading.Lock(), cloud=True)
            self.assertTrue(prepared['preprocessing']['needsReview'])
            self.assertTrue(prepared['units'][0]['needsReview'])
            self.assertEqual(prepared['canonical'], source)
            self.assertEqual(prepared['pages'][0]['steps'][0]['status'], 'review')

    def test_native_pdf_keeps_text_layer_without_direction_model_or_ocr(self):
        from reportlab.pdfgen import canvas
        with TemporaryDirectory() as tmp:
            folder=Path(tmp); source=folder/'input.pdf'
            pdf=canvas.Canvas(str(source))
            for i in range(12): pdf.drawString(60,780-i*40,f'Business field {i}: fictional text for a complete native text page')
            pdf.save()
            job=SimpleNamespace(id='native',directory=folder,status='running',events=[],preprocessing_policy=None)
            with patch.object(orientation,'predict',side_effect=AssertionError('native text')), patch.object(prep,'recognize',side_effect=AssertionError('native text')):
                prepared=prep.process(job,source,threading.Lock(),cloud=True)
            self.assertEqual(prepared['canonical'],source)
            self.assertEqual(prepared['textSources']['pdfTextPages'],[1])
            self.assertFalse(prepared['preprocessing']['needsReview'])
            self.assertGreater(len(prepared['blocks']),8)
