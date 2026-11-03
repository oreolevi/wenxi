import asyncio
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase, IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, patch
import zipfile

import httpx
from . import full_text, history
from .test_history import snapshot, make_job, RECORD, DOCUMENT

MARKDOWN = '# 测试文档\n\n正文 100.00 元。\n\n<table><tr><td rowspan="2">合计</td><td>100.00</td></tr></table>\n\n![图](images/test.png)\n'


def package(root):
    archive = root / 'export.zip'
    with zipfile.ZipFile(archive, 'w') as result:
        result.writestr('middle_json.json', json.dumps({'pages': [{'page_idx': 0}]}))
        result.writestr('markdown.md', MARKDOWN)
        result.writestr('images/test.png', b'image-bytes')
        result.writestr('../outside.txt', b'no')
        result.writestr('structured_content.json', '{}')
    full_text.unpack_export(archive, root / 'fulltext')
    return root / 'fulltext'


class FullTextTests(TestCase):
    def test_native_export_preserves_tables_and_assets_and_download_excludes_internal_json(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            output = package(root)
            result = full_text.content(output, '/api/documents/test/fulltext')
            self.assertEqual(result['markdown'], MARKDOWN)
            self.assertEqual(result['assetBaseUrl'], '/api/documents/test/fulltext/')
            self.assertFalse((root.parent / 'outside.txt').exists())
            with zipfile.ZipFile(output / 'document.zip') as download:
                self.assertEqual(set(download.namelist()), {'document.md', 'images/test.png'})
                self.assertEqual(download.read('document.md').decode(), MARKDOWN)
            for invalid in ('../../outside', 'images/../../outside', 'middle_json.json', 'images/script.js'):
                with self.assertRaises(FileNotFoundError):
                    full_text.asset_path(output, invalid)

    def test_fulltext_and_images_survive_history_and_temporary_cleanup(self):
        with TemporaryDirectory() as temporary, patch.object(history, 'ROOT', Path(temporary) / 'history'):
            root = Path(temporary)
            job = make_job(root)
            output = package(job.directory)
            value = snapshot()
            value['files'][0]['parsed']['fullText'] = full_text.descriptor(output, f'/api/documents/{DOCUMENT}/fulltext', 1)
            history.save(RECORD, value, {DOCUMENT: job})
            import shutil
            shutil.rmtree(job.directory)
            restored = history.snapshot(RECORD)['snapshot']
            descriptor = restored['files'][0]['parsed']['fullText']
            self.assertEqual(descriptor['url'], f'/api/history/{RECORD}/fulltext/file-1')
            self.assertEqual(history.asset_path(RECORD, 'file-1', 'fulltext/markdown.md').read_text(), MARKDOWN)
            self.assertEqual(history.asset_path(RECORD, 'file-1', 'fulltext/images/test.png').read_bytes(), b'image-bytes')
            history.save(RECORD, restored, {})
            self.assertTrue(history.listing()[0]['files'][0]['parsed']['fullText'])

    def test_failed_task_remains_in_personal_history_without_fabricated_results(self):
        with TemporaryDirectory() as temporary, patch.object(history, 'ROOT', Path(temporary) / 'history'):
            root = Path(temporary)
            job = make_job(root); job.document = None
            value = snapshot(); value['files'] = [value['files'][0]]
            value['files'][0].update(processed=False, parsed=None, results=None, error='解析失败', taskId=DOCUMENT)
            history.save(RECORD, value, {DOCUMENT: job})
            listing = history.listing()[0]['files'][0]
            self.assertEqual(listing['error'], '解析失败')
            self.assertEqual(listing['results'], [])
            self.assertIsNone(listing['parsed']['fullText'])
            self.assertTrue(history.asset_path(RECORD, 'file-1', 'source').is_file())


class FullTextApiTests(IsolatedAsyncioTestCase):
    async def test_fulltext_only_bypasses_deepseek_and_label_match(self):
        from . import app
        with TemporaryDirectory() as temporary:
            job = app.Job(DOCUMENT, 'sample.pdf', '.pdf', [], Path(temporary), prompt='全文转 Markdown', output_mode='fulltext')
            job.acknowledged.set()
            async def recognize(value):
                value.document = {'id': DOCUMENT, 'pages': [], 'extractor': 'label-match'}
            with patch.object(app, 'recognize_document', recognize), patch.object(app.semantic, 'extract_fields', AsyncMock(side_effect=AssertionError('must not call model'))), patch.object(app, 'match_fields', side_effect=AssertionError('must not match fields')), patch.object(app.activity, 'start'), patch.object(app.activity, 'complete'):
                await app.run_job(job)
            self.assertEqual(job.status, 'succeeded')
            self.assertEqual(job.result['fields'], [])
            self.assertEqual(job.result['summary']['total'], 0)

    async def test_saved_fulltext_preview_and_download_routes_work_without_live_jobs(self):
        from . import app
        with TemporaryDirectory() as temporary, patch.object(history, 'ROOT', Path(temporary) / 'history'):
            root = Path(temporary); job = make_job(root); output = package(job.directory)
            value = snapshot(); value['files'][0]['parsed']['fullText'] = full_text.descriptor(output, '/temporary', 1)
            history.save(RECORD, value, {DOCUMENT: job})
            with patch.object(app, 'jobs', {}):
                async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app.app), base_url='http://127.0.0.1:8768') as client:
                    descriptor = history.snapshot(RECORD)['snapshot']['files'][0]['parsed']['fullText']
                    preview = await client.get(descriptor['url'])
                    self.assertEqual(preview.status_code, 200)
                    self.assertEqual(preview.json()['markdown'], MARKDOWN)
                    self.assertEqual((await client.get(descriptor['downloadUrl'])).text, MARKDOWN)
                    self.assertEqual((await client.get(preview.json()['assetBaseUrl'] + 'images/test.png')).content, b'image-bytes')
                    self.assertEqual((await client.get(descriptor['packageUrl'])).status_code, 200)
