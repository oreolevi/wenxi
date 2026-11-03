"""Exercise the running loopback API with fictional input, then remove test jobs."""
from pathlib import Path
import json
import time
import httpx

sample = Path(__file__).resolve().parents[1] / 'testdata' / 'fictional-application-scan.pdf'
client = httpx.Client(base_url='http://127.0.0.1:8768', timeout=15, trust_env=False)
created = []

def submit(data, name, fields):
    response = client.post('/api/tasks', files={'file': (name, data, 'application/pdf')}, data={'fields': json.dumps(fields)})
    response.raise_for_status()
    job = response.json()
    created.append(job['id'])
    return job

def finished(job):
    deadline = time.monotonic() + 180
    while job['status'] in {'queued', 'running'}:
        assert time.monotonic() < deadline, 'job timed out'
        time.sleep(.5)
        response = client.get('/api/tasks/' + job['id'])
        response.raise_for_status()
        job = response.json()
    return job

try:
    health = client.get('/api/health').json()
    assert health['extractor'] in {'deepseek', 'label-match'}
    assert client.post('/api/tasks', headers={'Origin': 'https://unrelated.example'}).status_code == 403
    assert client.post('/api/tasks', files={'file': ('unsupported.zip', b'fake')}, data={'fields': '["提交人"]'}).status_code == 415
    job = finished(submit(sample.read_bytes(), sample.name, ['提交人', '通讯地址', '最终审核人员', '不存在字段']))
    assert job['status'] == 'succeeded', job
    result = job['result']
    fields = {field['name']: field for field in result['fields']}
    assert fields['提交人']['value'] == '林晓'
    assert fields['通讯地址']['value'] == '上海市浦东新区示例路88号12层'
    assert fields['最终审核人员']['value'] == '陈敏'
    assert fields['最终审核人员']['page'] == 2
    assert fields['最终审核人员']['evidence'][0]['pageIndex'] == 1
    assert fields['不存在字段']['status'] == 'missing'
    for page in result['document']['pages']:
        response = client.get(page['imageUrl'])
        assert response.status_code == 200 and response.content.startswith(b'\x89PNG\r\n\x1a\n')
    response = client.post('/api/documents/' + job['id'] + '/extract', json={'fields': ['初审人员', '联系电话']})
    response.raise_for_status()
    assert response.status_code == 202
    appended = finished(response.json())
    assert appended['status'] == 'succeeded', appended
    assert {item['name']: item['value'] for item in appended['result']['fields']} == {'初审人员': '张宁', '联系电话': '138****0268'}
    print('Actual scan -> OCR -> fields -> page previews -> cached additional fields: passed', flush=True)
    if health['semantic']:
        response = client.post('/api/documents/' + job['id'] + '/extract', json={'prompt': '帮我找最终批准这次变更的人，告诉我他的姓名。'})
        response.raise_for_status()
        semantic = finished(response.json())
        assert semantic['status'] == 'succeeded', semantic
        fields = semantic['result']['fields']
        assert len(fields) == 1 and fields[0]['value'] == '陈敏' and fields[0]['page'] == 2, fields
        call = semantic['result']['document']['modelCall']
        assert call['outcome'] == 'success' and call['usage']['total_tokens'] > 0
        print(json.dumps({'semantic_request': '最终批准人的姓名（未指定字段标签）',
                          'value': fields[0]['value'], 'page': fields[0]['page'],
                          'model': call['model'], 'usage': call['usage'], 'elapsedMs': call['elapsedMs']}, ensure_ascii=False), flush=True)
    pending = submit(sample.read_bytes(), 'cancel-test.pdf', ['提交人'])
    response = client.post('/api/tasks/' + pending['id'] + '/cancel')
    response.raise_for_status()
    assert response.json()['status'] == 'cancelled'
    print('Cancel a real parsing job: passed', flush=True)
    invalid = finished(submit(b'not a PDF', 'damaged.pdf', ['提交人']))
    assert invalid['status'] == 'failed' and not invalid['result']
    print('Invalid PDF fails without fake results; unsupported ZIP and cross-origin request rejected: passed', flush=True)
finally:
    for job_id in created:
        assert client.delete('/api/documents/' + job_id).status_code == 200
        assert client.get('/api/tasks/' + job_id).status_code == 404
    client.close()
