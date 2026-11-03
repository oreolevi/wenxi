"""Exercise real local MinerU conversion, archive and downloads on fictional fixtures."""
import asyncio
import json
from pathlib import Path
import shutil
from tempfile import TemporaryDirectory
from unittest.mock import patch

import httpx
from . import app, activity, history, semantic


async def main():
    fixture = Path(__file__).resolve().parents[1] / 'testdata' / 'fictional-application-text.pdf'
    with TemporaryDirectory() as temporary:
        root = Path(temporary)
        async def forbid_model(*args, **kwargs):
            raise AssertionError('全文转换不应调用 DeepSeek')
        with patch.object(app, 'STORAGE', root / 'jobs'), patch.object(app, 'jobs', {}), patch.object(activity, 'DATABASE', root / 'activity.sqlite3'), patch.object(history, 'ROOT', root / 'history'), patch.object(semantic, 'extract_fields', forbid_model):
            app.STORAGE.mkdir()
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app.app), base_url='http://127.0.0.1:8768', timeout=660) as client:
                submitted = await client.post('/api/tasks', data={'prompt': '把文档全文转换为 Markdown', 'output_mode': 'fulltext'}, files={'file': (fixture.name, fixture.read_bytes(), 'application/pdf')})
                assert submitted.status_code == 202, submitted.text
                job_id = submitted.json()['id']
                while True:
                    response = await client.get(f'/api/tasks/{job_id}')
                    job = response.json()
                    if job['status'] not in {'queued', 'running'}:
                        break
                    await asyncio.sleep(.3)
                assert job['status'] == 'succeeded', job.get('error')
                assert not job['result']['fields']
                descriptor = job['document']['fullText']
                markdown = (await client.get(descriptor['url'])).json()['markdown']
                assert '林晓' in markdown and len(markdown) > 100, '全文应保留真实样例文字'
                assert (await client.get(descriptor['packageUrl'])).status_code == 200
                record_id = 'd' * 32
                snapshot = {'files': [{'id': 'fictional', 'name': fixture.name, 'kind': 'pdf', 'size': fixture.stat().st_size, 'processed': True, 'outputMode': 'fulltext', 'parsed': job['document'], 'results': []}], 'messages': [{'id': 'request', 'role': 'user', 'text': '全文转 Markdown'}], 'draft': '', 'activeId': 'fictional', 'selectedKey': None, 'page': 1}
                saved = await client.put(f'/api/history/{record_id}', json=snapshot)
                assert saved.status_code == 200, saved.text
                await client.delete(f'/api/documents/{job_id}')
                restored = (await client.get(f'/api/history/{record_id}')).json()['snapshot']['files'][0]
                archived = (await client.get(restored['parsed']['fullText']['url'])).json()
                assert archived['markdown'] == markdown
                print(json.dumps({'status': 'passed', 'pages': len(job['document']['pages']), 'markdownCharacters': len(markdown), 'images': descriptor['imageCount'], 'deepseekCalls': 0, 'archiveAfterCleanup': True}, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    asyncio.run(main())
