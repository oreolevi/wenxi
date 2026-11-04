"""Opt-in live probe of existing OCR adapters; never imported by ordinary tests.

`run` uses the configured official MinerU token and may consume its quota.
`--with-semantic` additionally calls DeepSeek on fictional OCR output.
Ground truth is used only after recognition, never included in model requests.
"""
from __future__ import annotations

import argparse
import asyncio
import base64
from collections import Counter
import hashlib
import html
import json
from pathlib import Path
import re
import sys
import time
from types import SimpleNamespace
import unicodedata
import uuid
import zipfile
from unittest.mock import patch

import httpx

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'mineru-local'))


def write_json(path, value):
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
    temporary.replace(path)


def compact(value):
    return re.sub(r'[\s,，]', '', unicodedata.normalize('NFKC', value or ''))


def content_text(node):
    if isinstance(node, list):
        return '\n'.join(content_text(item) for item in node)
    if not isinstance(node, dict):
        return ''
    direct = node.get('content', node.get('text', ''))
    values = [direct] if isinstance(direct, str) else []
    values += [content_text(node[key]) for key in ['blocks', 'lines', 'spans'] if key in node]
    return '\n'.join(value for value in values if value)


def cached(path, digest):
    if not path.exists():
        return None
    result = json.loads(path.read_text())
    if result.get('inputSha256') != digest:
        raise ValueError('Probe input changed; use a new output directory')
    # Never resubmit a possibly accepted paid request after interruption.
    if result.get('status') == 'started':
        raise ValueError('An earlier request was interrupted; inspect it before explicitly retrying in a new directory')
    return result


async def monitor(job, model):
    previous = ''
    while True:
        if job.phase != previous:
            previous = job.phase
            print(f'{model}: {job.phase}', flush=True)
        await asyncio.sleep(2)


async def resume_parse(adapter, job, batch_id):
    """Read an already submitted task; never allocate or upload another task."""
    import os
    headers = {'Authorization': 'Bearer ' + os.environ['MINERU_API_TOKEN']}
    async with httpx.AsyncClient(timeout=httpx.Timeout(45, connect=15), follow_redirects=False) as client:
        deadline = time.monotonic() + 600
        while time.monotonic() < deadline:
            data = adapter.require_success(await client.get(adapter.API + '/extract-results/batch/' + batch_id, headers=headers))
            rows = data.get('extract_result', [])
            if rows:
                row = rows[0]
                job.phase = 'MinerU: ' + str(row.get('state'))
                if row.get('state') == 'done':
                    target = job.directory / 'cloud-export.zip'
                    await adapter.download(client, row['full_zip_url'], target)
                    return target
                if row.get('state') == 'failed':
                    raise ValueError('MinerU 未能解析此材料')
            await asyncio.sleep(2)
    raise ValueError('等待已有任务超过 10 分钟；保留编号供继续查询')


async def run(args):
    import os
    from service import mineru_cloud
    from service.extraction import read_blocks
    manifest = json.loads((args.samples / 'manifest.json').read_text())
    pdf = Path(manifest['pdf'])
    digest = hashlib.sha256(pdf.read_bytes()).hexdigest()
    if digest != manifest['sha256'] or manifest.get('fictional') is not True:
        raise ValueError('Only unchanged fictional fixtures from the generator are accepted')
    if args.cloud_env:
        for line in args.cloud_env.read_text().splitlines():
            if line.startswith('MINERU_API_TOKEN='):
                os.environ.setdefault('MINERU_API_TOKEN', line.split('=', 1)[1].strip().strip('\"\''))
    if not os.getenv('MINERU_API_TOKEN'):
        raise ValueError('MINERU_API_TOKEN is required')
    args.output.mkdir(parents=True, exist_ok=True)
    for model in args.models:
        folder = args.output / model
        folder.mkdir(exist_ok=True)
        path = folder / 'result.json'
        old = json.loads(path.read_text()) if path.exists() else None
        if args.resume_pending and old is None:
            print(f'{model}: no recorded task; resume will not submit one', flush=True)
            continue
        resume = bool(old and args.resume_pending and old.get('batchId') and old.get('status') != 'completed')
        if old and old.get('inputSha256') != digest:
            raise ValueError('Probe input changed; use a new output directory')
        if old is not None and not resume:
            cached(path, digest)
            print(f'{model}: cached {old["status"]}; no new OCR request', flush=True)
            continue
        started = time.monotonic()
        result = old if resume else {'inputSha256': digest, 'model': model, 'jobId': uuid.uuid4().hex}
        result.update(status='started')
        result.pop('error', None)
        write_json(path, result)
        job = SimpleNamespace(id=result['jobId'], directory=folder, status='running', events=[], phase='继续查询' if resume else '准备提交')
        real_client = httpx.AsyncClient

        async def request_hook(request):
            # Never retain a storage URL/query or authorization header.
            stage = ('submit' if request.method == 'POST' else 'poll') if request.url.host == 'mineru.net' else ('upload' if request.method == 'PUT' else 'download')
            result['lastStage'] = stage
            write_json(path, result)

        async def response_hook(response):
            if response.request.url.host == 'mineru.net' and response.is_success:
                await response.aread()
                data = response.json().get('data') or {}
                if response.request.method == 'POST' and data.get('batch_id'):
                    result['batchId'] = data['batch_id']
                rows = data.get('extract_result') or []
                if rows:
                    result['providerState'] = rows[0].get('state')
                    result['providerResultKeys'] = sorted(rows[0])
                write_json(path, result)

        def traced_client(*positional, **kwargs):
            kwargs['event_hooks'] = {'request': [request_hook], 'response': [response_hook]}
            if args.direct_network:
                kwargs['trust_env'] = False
            return real_client(*positional, **kwargs)

        watcher = asyncio.create_task(monitor(job, model))
        try:
            with patch.object(httpx, 'AsyncClient', traced_client):
                archive = await resume_parse(mineru_cloud, job, result['batchId']) if resume else await mineru_cloud.parse(job, pdf, model=model)
            with zipfile.ZipFile(archive) as package:
                layout_names = [n for n in package.namelist() if Path(n).name == 'layout.json']
                if len(layout_names) != 1 or package.getinfo(layout_names[0]).file_size > mineru_cloud.MAX_JSON:
                    raise ValueError('Expected one bounded layout.json')
                layout = json.loads(package.read(layout_names[0]))
            write_json(folder / 'provider-layout.json', layout)
            data = mineru_cloud.unpack(archive, folder / 'fulltext')
            blocks = read_blocks(data)
            write_json(folder / 'blocks.json', blocks)
            cases = []
            if len(layout['pdf_info']) != len(manifest['cases']):
                raise ValueError('Provider page count differs from fixture')
            for case in manifest['cases']:
                page = case['page'] - 1
                source = layout['pdf_info'][page]
                raw = content_text(source.get('preproc_blocks', source.get('para_blocks', [])))
                local = [block for block in blocks if block['pageIndex'] == page]
                text = '\n'.join(block['text'] for block in local)
                fields = [{'name': name, 'expected': expected,
                           'rawFound': compact(expected) in compact(raw),
                           'adaptedFound': compact(expected) in compact(text)}
                          for name, expected in case['expectedFields'].items()]
                seal = [{'name': name, 'expected': expected,
                         'rawFound': compact(expected) in compact(raw),
                         'adaptedFound': compact(expected) in compact(text)}
                        for name, expected in case['expectedSeal'].items()]
                watermark = case['watermarkText']
                cases.append({'id': case['id'], 'page': case['page'], 'fields': fields, 'seal': seal,
                              'watermarkMentions': compact(text).count(compact(watermark)) if watermark else 0,
                              'blockTypes': dict(Counter(block.get('blockType', 'text') for block in local)),
                              'adaptedText': text, 'rawText': raw})
            result.pop('errorTypes', None)
            result.update(status='completed', providerVersion=layout.get('_version_name'), elapsedMs=round((time.monotonic() - started) * 1000), cases=cases)
            print(f'{model}: completed {len(cases)} pages', flush=True)
        except Exception as error:
            message = str(error) if isinstance(error, ValueError) else type(error).__name__
            causes, cause = [], error
            while cause is not None and len(causes) < 5:
                causes.append(type(cause).__name__)
                cause = cause.__cause__ or cause.__context__
            result.update(status='failed', error=message, errorTypes=causes, elapsedMs=round((time.monotonic() - started) * 1000))
            print(f'{model}: failed ({message})', flush=True)
        finally:
            watcher.cancel()
            await asyncio.gather(watcher, return_exceptions=True)
            write_json(path, result)
    if args.with_semantic:
        from service import semantic
        semantic.USAGE_FILE = args.output / 'model-usage.jsonl'
        if not semantic.enabled():
            raise ValueError('DeepSeek is not configured')
        primary = args.output / 'vlm'
        result = json.loads((primary / 'result.json').read_text())
        if result.get('status') != 'completed':
            raise ValueError('VLM OCR must complete before semantic probing')
        all_blocks = json.loads((primary / 'blocks.json').read_text())
        for case in manifest['cases']:
            destination = primary / f'semantic-{case["id"]}.json'
            if cached(destination, digest) is not None:
                continue
            names = list(case['expectedFields']) + (['印章名称'] if case['expectedSeal'] else [])
            # Only names are taken from the manifest, never expected values.
            job = SimpleNamespace(blocks=[b for b in all_blocks if b['pageIndex'] == case['page'] - 1],
                                  process=None, latest_call=None, events=[], requirements=None, phase='')
            record = {'inputSha256': digest, 'status': 'started', 'case': case['id']}
            write_json(destination, record)
            try:
                fields, call = await semantic.extract_fields(job, '提取所需字段。没有依据时标记缺失；印章需要图像核验。', names)
                record.update(status='completed', fields=fields, modelCall=call)
                print(f'DeepSeek: {case["id"]}, {len(call.get("calls", []))} model requests', flush=True)
            except Exception as error:
                record.update(status='failed', error=str(error) if isinstance(error, ValueError) else type(error).__name__)
                print(f'DeepSeek: {case["id"]} failed', flush=True)
            finally:
                write_json(destination, record)


def render(args):
    manifest = json.loads((args.samples / 'manifest.json').read_text())
    results = {model: json.loads((args.output / model / 'result.json').read_text()) for model in args.models}
    escape = lambda value: html.escape(str(value))
    statuses = {'pending': '引用通过 · 待人工核验', 'missing': '缺失', 'visual_required': '需图像核验', 'rejected': '引用未通过'}
    totals = []
    for model, result in results.items():
        if result.get('status') == 'completed':
            fields = [field for case in result['cases'] for field in case['fields']]
            seals = [field for case in result['cases'] for field in case['seal']]
            totals.append(f'<section><h3>{escape(model)}</h3><p><strong>{sum(field["adaptedFound"] for field in fields)} / {len(fields)}</strong> 正文字段文字命中</p><p>{sum(field["adaptedFound"] for field in seals)} / {len(seals)} 印文字段文字命中</p></section>')
    cards = []
    for case in manifest['cases']:
        image = base64.b64encode((args.samples / case['image']).read_bytes()).decode()
        engines = []
        for model, result in results.items():
            if result.get('status') != 'completed':
                engines.append(f'<section><h3>{escape(model)}</h3><p>未完成：{escape(result.get("error", result["status"]))}</p></section>')
                continue
            row = next(row for row in result['cases'] if row['id'] == case['id'])
            fields = row['fields'] + row['seal']
            lines = ''.join(f'<li><span>{escape(item["name"])}：{escape(item["expected"])}</span><b class="{"yes" if item["adaptedFound"] else "no"}">{"文字命中" if item["adaptedFound"] else "未命中"}</b></li>' for item in fields)
            engines.append(f'<section><h3>{escape(model)}</h3><ul>{lines}</ul><p class="note">水印词命中 {row["watermarkMentions"]} 次 · 数据块类型 {escape(row["blockTypes"])}</p><details><summary>查看 OCR 原始文字与适配后的文字</summary><h4>原始布局文字</h4><pre>{escape(row["rawText"])}</pre><h4>适配后</h4><pre>{escape(row["adaptedText"])}</pre></details></section>')
        semantic_path = args.output / 'vlm' / f'semantic-{case["id"]}.json'
        extraction = ''
        if semantic_path.exists():
            semantic = json.loads(semantic_path.read_text())
            if semantic.get('status') == 'completed':
                rows = ''.join(f'<li><span>{escape(field["name"])}：{escape(field.get("value") or "未取值")}</span><b>{escape(statuses.get(field["status"], field["status"]))}</b></li>' for field in semantic['fields'])
                call = semantic['modelCall']
                extraction = f'<section class="extraction"><h3>现有文析字段链路 / VLM 原文</h3><ul>{rows}</ul><p class="note">模型：{escape(call["model"])} · 请求 {len(call.get("calls", []))} 次 · 用量 {escape(call.get("usage"))}</p></section>'
            else:
                extraction = f'<p>字段提取未完成：{escape(semantic.get("error", semantic["status"]))}</p>'
        cards.append(f'<article><h2>{case["page"]:02d} · {escape(case["title"])}</h2><div class="case"><a href="data:image/png;base64,{image}" target="_blank"><img src="data:image/png;base64,{image}" alt="{escape(case["title"])}：虚构样例原图"></a><div><div class="engines">{"".join(engines)}</div>{extraction}</div></div></article>')
    style = 'body{margin:0;background:#f5f7fb;color:#203047;font:15px/1.7 system-ui,"PingFang SC",sans-serif}main{max-width:1280px;margin:auto;padding:40px 28px}h1{font-size:29px;line-height:1.4}h2{font-size:22px;margin:0 0 22px}h3{font-size:17px;color:#245bdb}article,.intro{background:white;border:1px solid #dce3ee;border-radius:14px;padding:26px;margin:24px 0}.case{display:grid;grid-template-columns:320px minmax(0,1fr);gap:26px}.case img{width:100%;border:1px solid #e2e7ee}.engines{display:grid;grid-template-columns:1fr 1fr;gap:20px}section{min-width:0}ul{padding:0;list-style:none}li{border-bottom:1px solid #edf0f5;padding:9px 0;display:flex;gap:12px;justify-content:space-between}b{font-size:12px;white-space:nowrap}.yes{color:#258155}.no{color:#b35f16}.note{color:#6d7a8d;font-size:12px}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f6f8fc;padding:12px;font-size:12px}.extraction{margin-top:24px;border-top:1px solid #e2e7ee;padding-top:12px}summary{cursor:pointer;color:#245bdb}@media(max-width:850px){.case,.engines{grid-template-columns:1fr}.case img{max-width:360px}}'
    intro = '<h1>水印、手写数字与印章：现有链路探测</h1><p>六个单页样例，全部业务内容虚构。比较现有 MinerU 两种模式，以及 VLM 文字进入文析后的实际结果。</p><div class="intro"><strong>如何解读</strong><p>“文字命中”仅表示答案出现在该页 OCR 文字中，去除空白、统一全半角与千分位后检查；它不等于字段定位正确或业务准确率。正文和印文分别计数。字段“引用通过”只证明引用与 OCR 文字一致，仍需业务核验。</p><p>水印词未出现在正文中，不代表已生成去水印图片，也不代表正文完全无漏识。未专项验证重复文字块去重。</p><p>手写数字取自 MNIST 测试集，按虚构金额与日期拼接。未验证自然整行书写、中文手写备注、潦草签名或印章真伪。印章由程序合成，不能代替真实扫描印章验收。</p><p>MNIST：Yann LeCun and Corinna Cortes，<a href="https://creativecommons.org/licenses/by-sa/3.0/">CC BY-SA 3.0</a>。<a href="https://keras.io/api/datasets/mnist/">数据来源与许可</a>。手写样例对原字形进行了裁切、缩放和拼接；其衍生图像依相同许可提供。本页为小样本技术探测，不提供生产准确率承诺。</p></div>'
    intro += '<div class="intro"><h2>本次样例命中概况</h2><div class="engines">' + ''.join(totals) + '</div><p class="note">本页由保存的真实响应离线生成，不会再次调用识别或模型服务。</p></div>'
    output = args.output / 'report.html'
    output.write_text(f'<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>文析 · 视觉识别探测</title><style>{style}</style><main>{intro}{"".join(cards)}</main></html>')
    print('Report written:', output)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['run', 'report'])
    parser.add_argument('--samples', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--cloud-env', type=Path)
    parser.add_argument('--models', nargs='+', choices=['vlm', 'pipeline'], default=['vlm', 'pipeline'])
    parser.add_argument('--with-semantic', action='store_true')
    parser.add_argument('--resume-pending', action='store_true', help='Only query/download existing recorded OCR tasks; do not submit them again')
    parser.add_argument('--direct-network', action='store_true', help='Bypass environment proxies for this probe only')
    args = parser.parse_args()
    if args.action == 'run':
        asyncio.run(run(args))
    else:
        render(args)
