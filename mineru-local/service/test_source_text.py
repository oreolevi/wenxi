from pathlib import Path
import unittest
from unittest.mock import patch

from .source_text import positioned_lines, prefer_pdf_text, fragmented_text_layer


class PositionedPDFTextTests(unittest.TestCase):
    def test_two_columns_on_same_baseline_do_not_merge(self):
        chars = [{'text': text, 'left': x, 'right': x + 5, 'bottom': 100, 'top': 110, 'height': 10}
                 for text, x in [('甲', 10), ('方', 16), ('乙', 160), ('方', 166)]]
        blocks = positioned_lines(chars, 0, 200, 200)
        self.assertEqual([block['text'] for block in blocks], ['甲方', '乙方'])
        for actual, expected in zip(blocks[0]['bbox'], [.05, .45, .105, .5]):
            self.assertAlmostEqual(actual, expected)

    def test_real_text_fixture_uses_native_text_but_scan_retains_ocr(self):
        root = Path(__file__).resolve().parents[1] / 'testdata'
        blocks, sources = prefer_pdf_text(root / 'fictional-application-text.pdf', [])
        self.assertTrue(sources['pdfTextPages'])
        self.assertTrue(any('林晓' in block['text'] for block in blocks))
        original = [{'pageIndex': 0, 'text': '扫描识别值', 'ref': 'ocr'}]
        blocks, sources = prefer_pdf_text(root / 'fictional-application-scan.pdf', original)
        self.assertEqual(blocks, original)
        self.assertEqual(sources['pdfTextPages'], [])

    def test_glyph_ink_bottom_does_not_split_name_or_join_neighboring_column(self):
        chars = [
            {'text': '名', 'left': 0, 'right': 8, 'bottom': 102, 'top': 110, 'height': 8, 'baseline': 102, 'objectRef': 1},
            {'text': '上', 'left': 12, 'right': 20, 'bottom': 101, 'top': 109, 'height': 8, 'baseline': 100, 'objectRef': 2},
            {'text': '海', 'left': 21, 'right': 29, 'bottom': 100, 'top': 109, 'height': 9, 'baseline': 100, 'objectRef': 2},
            {'text': '项', 'left': 34, 'right': 42, 'bottom': 100, 'top': 109, 'height': 9, 'baseline': 100, 'objectRef': 3},
        ]
        self.assertEqual([block['text'] for block in positioned_lines(chars, 0, 100, 200)], ['名', '上海', '项'])

    def test_fragmented_pdf_objects_use_available_ocr_without_merging_cells_or_losing_coordinates(self):
        original = [{'pageIndex': page, 'text': '测试合同条款' * 60, 'ref': f'p{page}-ocr',
                     'bbox': [.1, .1, .8, .8], 'blockType': 'text', 'source': 'mineru'} for page in [0, 1]]
        glyphs = [{'text': '字', 'ref': f'glyph-{i}'} for i in range(300)]
        fixture = Path(__file__).resolve().parents[1] / 'testdata/fictional-application-text.pdf'
        with patch('service.source_text.positioned_lines', return_value=glyphs):
            blocks, sources = prefer_pdf_text(fixture, original)
        self.assertEqual(blocks, original)
        self.assertEqual(sources['pdfTextPages'], [])
        self.assertEqual(sources['fragmentedPdfTextPages'], [1, 2])
        self.assertEqual(sources['ocrPages'], [1, 2])
        self.assertEqual(blocks[0]['bbox'], [.1, .1, .8, .8])

    def test_fragmentation_fallback_never_discards_only_text_or_prefers_incomplete_ocr(self):
        glyphs = [{'text': '字'} for _ in range(300)]
        self.assertFalse(fragmented_text_layer(glyphs, []))
        self.assertFalse(fragmented_text_layer(glyphs, [{'text': '仅三个字'}]))
        self.assertFalse(fragmented_text_layer([{'text': '完整原文段落' * 30} for _ in range(100)], [{'text': '原文' * 20000}]))
