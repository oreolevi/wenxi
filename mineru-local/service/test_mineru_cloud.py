"""Cloud protocol and credential-boundary checks without external requests."""
import asyncio
from io import BytesIO
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import zipfile

import httpx

from . import mineru_cloud
from .extraction import read_blocks


def layout():
    return {'_version_name': 'cloud-test', 'pdf_info': [{'page_idx': 0, 'page_size': [600, 800],
        'preproc_blocks': [{'type': 'text', 'bbox': [60, 80, 300, 120],
            'lines': [{'spans': [{'type': 'text', 'content': '提交人：演示经办人'}]}]},
            {'type': 'table', 'bbox': [60, 200, 540, 400], 'blocks': [{'type': 'table_body', 'bbox': [60, 200, 540, 400],
              'lines': [{'spans': [{'type': 'table', 'html': '<table><tr><td>设备A</td><td>2</td></tr></table>'}]}]}]}]}]}


class CloudTests(unittest.TestCase):
    def test_column_spans_keep_real_value_coordinates_instead_of_row_padding(self):
        data=layout()
        data['pdf_info'][0]['preproc_blocks']=[{'type':'text','bbox':[60,100,580,140], 'lines':[{'spans':[
            {'type':'text','bbox':[60,100,140,120],'content':'价税合计：'},
            {'type':'text','bbox':[250,102,310,120],'content':'11300.00'}]}]}]
        blocks=read_blocks(mineru_cloud.normalize_layout(data))
        self.assertEqual([b['text'] for b in blocks],['价税合计：','11300.00'])
        self.assertEqual(blocks[1]['bbox'],[250/600,102/800,310/600,120/800])

    def test_adjacent_inline_spans_are_not_split_or_discarded(self):
        data=layout()
        data['pdf_info'][0]['preproc_blocks']=[{'type':'text','bbox':[60,100,300,120], 'lines':[{'spans':[
            {'bbox':[60,100,90,120],'content':'合同'}, {'bbox':[92,100,160,120],'content':'条款'}]}]}]
        blocks=read_blocks(mineru_cloud.normalize_layout(data))
        self.assertEqual([b['text'] for b in blocks],['合同条款'])

    def test_coordinate_and_table_adapter(self):
        blocks = read_blocks(mineru_cloud.normalize_layout(layout()))
        self.assertEqual(blocks[0]['bbox'], [.1, .1, .5, .15])
        self.assertEqual(blocks[0]['text'], '提交人：演示经办人')
        self.assertEqual([b['text'] for b in blocks if b.get('blockType') == 'table_cell'], ['设备A', '2'])

    def test_untrusted_download_addresses_rejected(self):
        for url in ['http://mineru.net/a', 'https://mineru.net.evil.test/a', 'https://127.0.0.1/a',
                    'https://u:p@mineru.net/a', 'https://mineru.net:8080/a']:
            with self.assertRaises(ValueError):
                mineru_cloud.checked_url(url)
        self.assertEqual(mineru_cloud.checked_url('https://cdn-mineru.openxlab.org.cn/a'), 'https://cdn-mineru.openxlab.org.cn/a')

    def test_invalid_geometry_fails_closed(self):
        data = layout(); data['pdf_info'][0]['page_size'] = [0, 800]
        with self.assertRaises(ValueError):
            mineru_cloud.normalize_layout(data)

    def test_archive_only_exports_markdown_and_images(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); source = root / 'data.zip'
            with zipfile.ZipFile(source, 'w') as z:
                z.writestr('layout.json', json.dumps(layout()))
                z.writestr('full.md', '# 演示材料\n![图](images/a.png)')
                z.writestr('images/a.png', b'fake-image')
                z.writestr('arbitrary.py', 'malicious')
                z.writestr('images/x.svg', '<script>bad</script>')
            mineru_cloud.unpack(source, root / 'fulltext')
            with zipfile.ZipFile(root / 'fulltext/document.zip') as z:
                self.assertEqual(set(z.namelist()), {'document.md', 'images/a.png'})

    def test_archive_traversal_and_duplicates_rejected(self):
        for names in [('layout.json', 'full.md', '../outside'), ('layout.json', 'full.md', 'other/layout.json')]:
            with tempfile.TemporaryDirectory() as temp:
                root = Path(temp); archive = root / 'a.zip'
                with zipfile.ZipFile(archive, 'w') as z:
                    for name in names:
                        z.writestr(name, json.dumps(layout()) if name.endswith('json') else '')
                with self.assertRaises(ValueError):
                    mineru_cloud.unpack(archive, root / 'fulltext')

    def test_upstream_errors_do_not_echo_secret_body(self):
        r = httpx.Response(200, json={'code': 'A0202', 'msg': 'private-token-private-url'})
        with self.assertRaisesRegex(ValueError, 'Token 无效') as error:
            mineru_cloud.require_success(r)
        self.assertNotIn('private-token', str(error.exception))


class CloudRequestTests(unittest.IsolatedAsyncioTestCase):
    async def test_provider_token_never_sent_to_storage(self):
        calls = []
        async def handler(request):
            calls.append(request)
            if request.url.path.endswith('/file-urls/batch'):
                return httpx.Response(200, json={'code': 0, 'data': {'batch_id': 'test', 'file_urls': ['https://mineru.oss-cn-shanghai.aliyuncs.com/file']}})
            if request.method == 'PUT':
                await request.aread()
                return httpx.Response(200)
            if request.url.host == 'mineru.net':
                return httpx.Response(200, json={'code': 0, 'data': {'extract_result': [{'state': 'done', 'full_zip_url': 'https://cdn-mineru.openxlab.org.cn/output.zip'}]}})
            return httpx.Response(200, content=b'zip-fixture')
        client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        with tempfile.TemporaryDirectory() as temp, patch.dict('os.environ', {'MINERU_API_TOKEN': 'secret-test-token'}), patch.object(mineru_cloud.httpx, 'AsyncClient', return_value=client):
            root = Path(temp); pdf = root / 'input.pdf'; pdf.write_bytes(b'pdf')
            job = SimpleNamespace(id='test', directory=root, status='running', events=[], phase='')
            await mineru_cloud.parse(job, pdf, model='vlm')
        for request in calls:
            self.assertEqual('authorization' in request.headers, request.url.host == 'mineru.net')


if __name__ == '__main__':
    unittest.main()
