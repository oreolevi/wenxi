"""Prefer reliable positioned PDF text; retain OCR for scanned/rotated pages."""
from collections import defaultdict
import ctypes
import math
from statistics import median

import pypdfium2 as pdfium


def positioned_lines(chars: list[dict], page_index: int, width: float, height: float) -> list[dict]:
    groups = []
    for char in sorted(chars, key=lambda item: (-item.get('baseline', item['bottom']), item['left'])):
        baseline = char.get('baseline', char['bottom'])
        row = next((group for group in groups if abs(group['baseline'] - baseline) <= 2), None)
        if row is None:
            row = {'baseline': baseline, 'chars': []}
            groups.append(row)
        row['chars'].append(char)
    output = []
    for row_index, row in enumerate(groups):
        ordered = sorted(row['chars'], key=lambda item: item['left'])
        typical = median(item['height'] for item in ordered)
        segments = [[]]
        for char in ordered:
            different_object = (segments[-1] and char.get('objectRef') is not None
                                and char['objectRef'] != segments[-1][-1].get('objectRef'))
            if segments[-1] and (different_object or char['left'] - segments[-1][-1]['right'] > max(14, typical * 1.8)):
                segments.append([])
            segments[-1].append(char)
        for segment in segments:
            text = ''
            previous = None
            for char in segment:
                if previous and char['left'] - previous['right'] > typical * .65:
                    text += ' '
                text += char['text']
                previous = char
            text = text.strip()
            if not text:
                continue
            left = min(char['left'] for char in segment)
            right = max(char['right'] for char in segment)
            bottom = min(char['bottom'] for char in segment)
            top = max(char['top'] for char in segment)
            bbox = [max(0, left / width), max(0, 1 - top / height), min(1, right / width), min(1, 1 - bottom / height)]
            if not (bbox[0] < bbox[2] and bbox[1] < bbox[3]):
                continue
            output.append({'ref': f'p{page_index}-pdf-{len(output)}', 'text': text, 'bbox': bbox,
                           'pageIndex': page_index, 'blockIndex': len(output), 'source': 'pdf_text',
                           'blockType': 'pdf_text', 'lineRef': f'p{page_index}-line-{row_index}'})
    return output


def fragmented_text_layer(lines: list[dict], ocr_blocks: list[dict]) -> bool:
    """Per-glyph PDF objects can turn a short page into hundreds of model refs.

    Prefer the existing OCR paragraphs only when they retain enough text. Do
    not join neighboring cells blindly or discard the only available text.
    """
    readable = lambda text: sum(char.isalnum() for char in text)
    native_chars = sum(readable(line['text']) for line in lines)
    ocr = [block for block in ocr_blocks if block.get('blockType') != 'seal']
    return (len(lines) > max(80, len(ocr) * 3)
            and native_chars / len(lines) < 2.5
            and sum(readable(block['text']) for block in ocr) >= native_chars * .65)


def prefer_pdf_text(path, ocr_blocks: list[dict]) -> tuple[list[dict], dict]:
    by_page = defaultdict(list)
    for block in ocr_blocks:
        by_page[block['pageIndex']].append(block)
    preferred, fragmented = [], []
    with pdfium.PdfDocument(path) as pdf:
        for page_index in range(len(pdf)):
            page = pdf[page_index]
            try:
                # Rotated text needs a different coordinate transform. Retain verified OCR instead.
                if page.get_rotation() != 0:
                    continue
                left, bottom, right, top = page.get_bbox()
                width, height = page.get_size()
                if abs((right - left) / width - 1) > .01 or abs((top - bottom) / height - 1) > .01:
                    continue
                chars = []
                textpage = page.get_textpage()
                try:
                    count = textpage.count_chars()
                    if count > 40000:
                        continue
                    for index in range(count):
                        value = textpage.get_text_range(index, 1)
                        if not value.strip() or '\ufffd' in value or '\x00' in value:
                            continue
                        angle = pdfium.raw.FPDFText_GetCharAngle(textpage, index)
                        # Exclude diagonal upload watermarks, without deleting horizontal business text.
                        if min(abs(angle), abs(angle - 2 * math.pi)) > .08:
                            continue
                        x0, y0, x1, y1 = textpage.get_charbox(index)
                        if not (x0 < x1 and y0 < y1):
                            continue
                        origin_x, origin_y = ctypes.c_double(), ctypes.c_double()
                        if not pdfium.raw.FPDFText_GetCharOrigin(textpage, index, origin_x, origin_y):
                            raise ValueError('PDF character origin is unavailable')
                        text_object = textpage.get_textobj(index)
                        object_ref = ctypes.cast(text_object.raw, ctypes.c_void_p).value if text_object else None
                        chars.append({'text': value, 'left': x0 - left, 'bottom': y0 - bottom,
                                      'right': x1 - left, 'top': y1 - bottom, 'height': y1 - y0,
                                      'baseline': origin_y.value - bottom, 'objectRef': object_ref})
                finally:
                    textpage.close()
                lines = positioned_lines(chars, page_index, width, height)
                meaningful = sum(len(''.join(char for char in line['text'] if char.isalnum())) for line in lines)
                if meaningful < 100 or len(lines) < 8:
                    continue
                if fragmented_text_layer(lines, by_page[page_index]):
                    fragmented.append(page_index + 1)
                    continue
                preferred.append(page_index + 1)
                # Native body text must never replace dedicated seal regions/OCR.
                by_page[page_index] = lines + [block for block in by_page[page_index] if block.get('blockType') == 'seal']
            except (pdfium.PdfiumError, ValueError, IndexError):
                # An unusable text layer must not discard already available OCR.
                continue
            finally:
                page.close()
    merged = [block for page_index in sorted(by_page) for block in by_page[page_index]]
    return merged, {'pdfTextPages': preferred, 'fragmentedPdfTextPages': fragmented,
                    'ocrPages': [index + 1 for index in sorted(by_page) if index + 1 not in preferred]}
