from copy import deepcopy
import json
from pathlib import Path
import shutil
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest import TestCase, IsolatedAsyncioTestCase
from unittest.mock import patch

import httpx

from . import history


RECORD = 'a' * 32
DOCUMENT = 'b' * 32


def snapshot():
    return {'files': [
        {'id': 'file-1', 'name': '合同.pdf', 'kind': 'pdf', 'size': 20, 'processed': True, 'url': 'blob:temporary',
         'parsed': {'id': DOCUMENT, 'engine': 'MinerU', 'tier': 'basic', 'extractor': 'deepseek',
                    'pages': [{'number': 1, 'width': 300, 'height': 400, 'imageUrl': '/api/documents/temporary/pages/1.png'}]},
         'results': [{'key': 'pay', 'name': '付款条件', 'raw': '验收后付款', 'value': '验收后付款', 'status': 'pending',
                      'evidence': [{'pageIndex': 0, 'blockIndex': 1, 'bbox': [.1, .2, .8, .4], 'text': '验收后付款', 'ref': 'p1-b1'}]}]},
        {'id': 'file-2', 'name': '字段.xlsx', 'kind': 'spreadsheet', 'results': None,
         'requirementWorkbook': {'sheets': [{'sheet': '字段', 'fields': [{'name': '付款条件', 'rule': '保留原文'}]}]}},
    ], 'messages': [{'id': 'chat-1', 'role': 'user', 'text': '按 Excel 提取合同'}],
        'draft': '', 'activeId': 'file-1', 'selectedKey': 'pay', 'page': 1}


def make_job(root):
    directory = root / 'temporary-job'
    directory.mkdir()
    (directory / 'input.pdf').write_bytes(b'%PDF-test-original')
    (directory / 'page-1.png').write_bytes(b'page-image')
    (directory / 'parse.log').write_text('temporary log')
    return SimpleNamespace(directory=directory, suffix='.pdf', document=snapshot()['files'][0]['parsed'])


class HistoryTests(TestCase):
    def setUp(self):
        self.temporary = TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.patch = patch.object(history, 'ROOT', self.root / 'history')
        self.patch.start()
        self.job = make_job(self.root)

    def tearDown(self):
        self.patch.stop()
        self.temporary.cleanup()

    def test_archive_survives_temporary_cleanup_and_keeps_source_and_evidence(self):
        history.save(RECORD, snapshot(), {DOCUMENT: self.job})
        shutil.rmtree(self.job.directory)
        restored = history.snapshot(RECORD)['snapshot']
        self.assertNotIn('blob:', json.dumps(restored))
        self.assertEqual(restored['files'][0]['results'][0]['evidence'][0]['bbox'], [.1, .2, .8, .4])
        self.assertEqual(restored['files'][0]['parsed']['historyId'], RECORD)
        self.assertEqual(restored['files'][0]['parsed']['pages'][0]['imageUrl'], f'/api/history/{RECORD}/files/file-1/page-1.png')
        self.assertEqual(history.asset_path(RECORD, 'file-1', 'source').read_bytes(), b'%PDF-test-original')
        self.assertEqual(history.asset_path(RECORD, 'file-1', 'page-1.png').read_bytes(), b'page-image')
        self.assertEqual(len(history.listing()), 1)
        self.assertEqual(len(history.listing()[0]['files']), 1, '字段表不作为提取材料计数')

    def test_review_updates_same_record_without_live_job_or_losing_raw_evidence(self):
        history.save(RECORD, snapshot(), {DOCUMENT: self.job})
        shutil.rmtree(self.job.directory)
        record = history.snapshot(RECORD)
        original_time = record['createdAt']
        changed = record['snapshot']
        changed['files'][0]['results'][0].update(value='业务核定值', status='corrected')
        history.save(RECORD, changed, {})
        restored = history.snapshot(RECORD)
        field = restored['snapshot']['files'][0]['results'][0]
        self.assertEqual(restored['createdAt'], original_time)
        self.assertEqual(field['value'], '业务核定值')
        self.assertEqual(field['raw'], '验收后付款')
        self.assertEqual(field['evidence'][0]['ref'], 'p1-b1')
        self.assertEqual(history.listing()[0]['files'][0]['results'][0]['status'], 'corrected')
        self.assertEqual(len(history.listing()), 1)

    def test_original_preview_and_inverse_coordinates_survive_closing_task(self):
        value = snapshot()
        page = value['files'][0]['parsed']['pages'][0]
        page.update(originalImageUrl='/api/documents/temporary/original-pages/1.png', originalWidth=400,
                    originalHeight=300, toOriginal=[[0, -1, 1], [1, 0, 0], [0, 0, 1]])
        (self.job.directory / 'original-1.png').write_bytes(b'upload-image')
        history.save(RECORD, value, {DOCUMENT: self.job})
        shutil.rmtree(self.job.directory)
        restored = history.snapshot(RECORD)['snapshot']['files'][0]['parsed']['pages'][0]
        self.assertEqual(restored['originalImageUrl'], f'/api/history/{RECORD}/files/file-1/original-1.png')
        self.assertEqual(restored['toOriginal'], page['toOriginal'])
        self.assertEqual(history.asset_path(RECORD, 'file-1', 'original-1.png').read_bytes(), b'upload-image')

    def test_failed_update_keeps_previous_snapshot(self):
        history.save(RECORD, snapshot(), {DOCUMENT: self.job})
        changed = snapshot()
        changed['files'][0]['parsed']['id'] = 'c' * 32
        changed['files'][0]['results'][0]['value'] = '未保存值'
        with self.assertRaises(ValueError):
            history.save(RECORD, changed, {})
        self.assertEqual(history.snapshot(RECORD)['snapshot']['files'][0]['results'][0]['value'], '验收后付款')

    def test_paths_and_unfinished_documents_are_rejected(self):
        with self.assertRaises(ValueError):
            history.save('../../outside', snapshot(), {DOCUMENT: self.job})
        invalid = snapshot()
        invalid['files'][0]['id'] = '../outside'
        with self.assertRaises(ValueError):
            history.save(RECORD, invalid, {DOCUMENT: self.job})
        invalid = snapshot()
        invalid['files'][0]['processed'] = False
        with self.assertRaises(ValueError):
            history.save(RECORD, invalid, {DOCUMENT: self.job})
        history.save(RECORD, snapshot(), {DOCUMENT: self.job})
        for filename in ('parse.log', 'record.json', '../record.json', 'page-2.png'):
            with self.assertRaises(FileNotFoundError):
                history.asset_path(RECORD, 'file-1', filename)


class HistoryApiTests(IsolatedAsyncioTestCase):
    async def test_save_reopen_and_review_through_api_without_recognition(self):
        from . import app
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            job = make_job(root)
            with patch.object(history, 'ROOT', root / 'history'), patch.object(app, 'jobs', {DOCUMENT: job}):
                async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app.app), base_url='http://127.0.0.1:8768') as client:
                    self.assertEqual((await client.put(f'/api/history/{RECORD}', json=snapshot())).status_code, 200)
                    app.jobs.clear()
                    shutil.rmtree(job.directory)
                    opened = await client.get(f'/api/history/{RECORD}')
                    self.assertEqual(opened.status_code, 200)
                    restored = opened.json()['snapshot']
                    page = await client.get(restored['files'][0]['parsed']['pages'][0]['imageUrl'])
                    self.assertEqual(page.status_code, 200)
                    self.assertEqual(page.content, b'page-image')
                    self.assertEqual((await client.get(restored['files'][0]['url'])).content, b'%PDF-test-original')
                    restored['files'][0]['results'][0]['status'] = 'confirmed'
                    self.assertEqual((await client.put(f'/api/history/{RECORD}', json=restored)).status_code, 200)
                    listing = (await client.get('/api/history')).json()
                    self.assertEqual(len(listing), 1)
                    self.assertEqual(listing[0]['files'][0]['results'][0]['status'], 'confirmed')
                    self.assertEqual(app.jobs, {}, '打开与核验历史不会创建识别任务或调用模型')
