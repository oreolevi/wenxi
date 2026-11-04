"""Loopback-only trial service: MinerU subprocess, real page previews and evidence."""
from __future__ import annotations
import asyncio
import base64
import hmac
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from io import BytesIO
import json
import logging
import os
import re
from pathlib import Path
import shutil
import threading
import time
import uuid
from typing import Literal

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from PIL import Image, ImageOps
from pydantic import BaseModel, Field
from filelock import FileLock
import pypdfium2 as pdfium

from .extraction import read_blocks, match_fields
from .source_text import prefer_pdf_text
from .requirements import MAX_WORKBOOK_BYTES, RequirementDefinition, parse_workbook
from . import semantic, activity, history, profiles, preprocessing, studio, rule_generation, rule_assistant, bundles, routing, scenes, studio_planning, operations, full_text, mineru_cloud, seals, extraction_flow
from .progress import report, finish

logger = logging.getLogger('uvicorn.error')

ROOT = Path(__file__).resolve().parents[2]
STORAGE = ROOT / '.runtime' / 'wenxi-documents'
PID_FILE = ROOT / '.runtime' / 'wenxi-service.pid'
UI = Path(os.getenv('WENXI_UI_FILE', str(ROOT / '文档解析平台交互原型_V3.6.html')))
TIER = os.getenv('WENXI_MINERU_TIER', 'basic')
MAX_SIZE = 30 * 1024 * 1024
MAX_PAGES = 50
TTL = 3600
PDF_LOCK = threading.Lock()
ORIGINS = {'http://127.0.0.1:8768', 'http://localhost:8768'}
PUBLIC_ORIGIN = os.getenv('WENXI_PUBLIC_ORIGIN', '').rstrip('/')
if PUBLIC_ORIGIN:
    ORIGINS.add(PUBLIC_ORIGIN)

@dataclass
class Job:
    id: str
    name: str
    suffix: str
    fields: list[str]
    directory: Path
    prompt: str = ''
    status: str = 'queued'
    phase: str = '等待本机解析'
    error: str = ''
    result: dict | None = None
    blocks: list[dict] = field(default_factory=list)
    touched: float = field(default_factory=time.time)
    process: asyncio.subprocess.Process | None = None
    worker: asyncio.Task | None = None
    acknowledged: asyncio.Event = field(default_factory=asyncio.Event)
    document: dict | None = None
    latest_call: dict | None = None
    requirements: dict | None = None
    events: list[dict] = field(default_factory=list)
    invocation: str = field(default_factory=lambda: uuid.uuid4().hex)
    ocr_only: bool = False
    preprocessing_policy: dict | None = None
    output_mode: str = 'fields'

jobs: dict[str, Job] = {}
gate = asyncio.Semaphore(1)

class ExtractionRequest(BaseModel):
    fields: list[str] = Field(default_factory=list, max_length=30)
    prompt: str = Field(default='', max_length=4000)
    requirements: RequirementDefinition | None = None
    outputMode: Literal['fields', 'fulltext'] = 'fields'

def checked_fields(names) -> list[str]:
    if not isinstance(names, list) or not (0 if semantic.enabled() else 1) <= len(names) <= 30:
        raise HTTPException(422, '请明确需要提取的字段，例如提交人、通讯地址。')
    if any(not isinstance(name, str) or not name.strip() or len(name) > 40 for name in names):
        raise HTTPException(422, '字段名称应为 1 到 40 个字符。')
    return list(dict.fromkeys(name.strip() for name in names))

def find_job(job_id: str) -> Job:
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(404, '本机材料已清理，请重新添加附件。')
    job.touched = time.time()
    return job

def metadata(job: Job) -> dict:
    document = dict(job.document) if job.document else None
    if document and job.latest_call:
        document['modelCall'] = job.latest_call
    return {'id': job.id, 'status': job.status, 'phase': job.phase, 'events': job.events,
            'error': job.error or None, 'document': document,
            'result': job.result if job.status == 'succeeded' else None}

def prepare_pdf(job: Job) -> tuple[Path, int]:
    original = job.directory / ('input' + job.suffix)
    canonical = original
    if job.suffix != '.pdf':
        with Image.open(original) as image:
            if image.width * image.height > 40_000_000:
                raise ValueError('图片过大，请压缩到 4000 万像素以内。')
            canonical = job.directory / 'canonical.pdf'
            ImageOps.exif_transpose(image).convert('RGB').save(canonical, resolution=150)
    with PDF_LOCK, pdfium.PdfDocument(canonical) as pdf:
        count = len(pdf)
        if not 1 <= count <= MAX_PAGES:
            raise ValueError(f'本机试用每份最多 {MAX_PAGES} 页。')
    return canonical, count

def render_pages(job: Job, canonical: Path, data: dict, count: int) -> list[dict]:
    geometry = {page['page_idx']: page for page in data.get('extensions', {}).get('docvortex_layout', {}).get('pages', [])}
    pages = []
    with PDF_LOCK, pdfium.PdfDocument(canonical) as pdf:
        for index in range(count):
            if job.status == 'cancelled':
                return []
            page = pdf[index]
            bitmap = page.render(scale=1.5)
            image = bitmap.to_pil()
            try:
                declared = geometry.get(index)
                if not declared:
                    raise ValueError('解析结果缺少页面几何信息，暂不能可靠地高亮原文。')
                expected_ratio = declared['width_pt'] / declared['height_pt']
                if abs(image.width / image.height / expected_ratio - 1) > .02:
                    raise ValueError('页面方向与坐标不一致，暂不能可靠地高亮原文。')
                image.save(job.directory / f'page-{index + 1}.png')
                pages.append({'number': index + 1, 'width': image.width, 'height': image.height,
                              'imageUrl': f'/api/documents/{job.id}/pages/{index + 1}.png'})
            finally:
                image.close()
                bitmap.close()
                page.close()
    return pages

async def cancel(job: Job):
    if job.status in {'queued', 'running'}:
        job.status = 'cancelled'
        job.phase = '已停止'
        finish(job, 'cancelled')
        if job.process and job.process.returncode is None:
            try:
                job.process.terminate()
            except ProcessLookupError:
                pass
        if job.worker:
            job.worker.cancel()
            await asyncio.gather(job.worker, return_exceptions=True)

async def threaded(call, *args):
    work = asyncio.create_task(asyncio.to_thread(call, *args))
    try:
        return await asyncio.shield(work)
    except asyncio.CancelledError:
        await asyncio.gather(work, return_exceptions=True)
        raise

async def recognize_document(job: Job):
    if mineru_cloud.enabled():
        await recognize_cloud(job)
        return
    report(job, 'read', '正在检查文档')
    canonical, count = await threaded(prepare_pdf, job)
    report(job, 'read', f'已读取 {count} 页原文', 'done')
    prepared = await threaded(preprocessing.process, job, canonical, PDF_LOCK)
    canonical = prepared['canonical']
    report(job, 'recognize', 'MinerU 正在识别文字与版面', detail=f'{count} 页文档')
    output = job.directory / 'parse-export.zip'
    args = [str(ROOT / 'mineru-local' / 'mineru'), 'parse', str(canonical), '--tier', TIER,
            '--ocr-mode', 'auto', '--disable-image-analysis', '--format', 'zip', '-o', str(output)]
    remote_url = os.getenv('WENXI_MINERU_API_URL')
    if remote_url:
        args.extend(['--remote-url', remote_url])
    with (job.directory / 'parse.log').open('wb') as log:
        creation = asyncio.create_task(asyncio.create_subprocess_exec(*args, stdout=log, stderr=log))
        try:
            job.process = await asyncio.shield(creation)
        except asyncio.CancelledError:
            job.process = await creation
            raise
        await asyncio.wait_for(job.process.wait(), timeout=600)
    if job.process.returncode:
        raise ValueError('MinerU 解析失败，请检查文件是否加密或损坏。')
    await threaded(full_text.unpack_export, output, job.directory / 'fulltext')
    output.unlink(missing_ok=True)
    data = json.loads((job.directory / 'middle.json').read_text())
    job.blocks = read_blocks(data)
    if sorted(page['page_idx'] for page in data['pages']) != list(range(count)):
        raise ValueError('文档页面解析不完整，请重试。')
    empty_pages = sum(not page.get('blocks') for page in data['pages'])
    report(job, 'recognize', f'已识别 {len(job.blocks)} 个内容块', 'done', f'{count} 页' + (f'，{empty_pages} 页未识别到文字' if empty_pages else ''))
    report(job, 'preview', '正在准备原文页面与定位信息')
    def choose_text():
        with PDF_LOCK:
            return prefer_pdf_text(canonical, job.blocks)
    job.blocks, text_sources = await threaded(choose_text)
    if text_sources.get('fragmentedPdfTextPages'):
        report(job, 'text-source', '文字层碎片过多，已采用 OCR 段落', 'done',
               f'{len(text_sources["fragmentedPdfTextPages"])} 页 · 保留原文位置')
    pages = await threaded(render_pages, job, canonical, data, count)
    for page, source in zip(pages, prepared['pages']):
        page.update({key: value for key, value in source.items() if key not in {'width', 'height', 'imageUrl'}})
    preprocessing.attach_mapping(job.blocks, pages)
    report(job, 'preview', f'已准备 {len(pages)} 页原文预览', 'done')
    job.document = {'id': job.id, 'engine': f'MinerU {data["metadata"]["producer"]["version"]}',
                    'tier': data['extensions']['mineru']['tier'], 'pages': pages,
                    'extractor': 'deepseek' if semantic.enabled() and not job.ocr_only else 'label-match', 'textSources': text_sources,
                    'schemaVersion': 2, 'preprocessing': prepared['preprocessing'],
                    'fullText': full_text.descriptor(job.directory / 'fulltext', f'/api/documents/{job.id}/fulltext', count),
                    'units': preprocessing.group_pages(pages, job.blocks, prepared['preprocessing']['policy']['grouping'])}


async def recognize_cloud(job: Job):
    report(job, 'read', '正在检查文档')
    canonical, count = await threaded(prepare_pdf, job)
    report(job, 'read', f'已读取 {count} 页原文', 'done')
    prepared = await threaded(lambda: preprocessing.process(job, canonical, PDF_LOCK, cloud=True))
    canonical, pages = prepared['canonical'], prepared['pages']
    policy = prepared['preprocessing']['policy']
    native = job.ocr_only and len(prepared['textSources']['pdfTextPages']) == count
    model = 'pipeline' if job.ocr_only else os.getenv('MINERU_MODEL_VERSION', 'vlm')
    if native:
        job.blocks, sources = prepared['blocks'], prepared['textSources']
        report(job, 'recognize', f'已读取 {count} 页 PDF 文字层', 'done')
    else:
        report(job, 'recognize', 'MinerU 正在识别文字与版面', detail=f'{count} 页文档')
        archive = await mineru_cloud.parse(job, canonical, model=model)
        data = await threaded(mineru_cloud.unpack, archive, job.directory / 'fulltext')
        archive.unlink(missing_ok=True)
        if len(data['pages']) != count:
            raise ValueError('云端文档解析页数不完整，请重试。')
        # The displayed corrected page is exactly what was submitted to the provider.
        geometry = data['extensions']['docvortex_layout']['pages']
        for page, declared in zip(pages, geometry):
            expected = declared['width_pt'] / declared['height_pt']
            if abs(page['width'] / page['height'] / expected - 1) > .02:
                raise ValueError('页面方向与坐标不一致，暂不能可靠地高亮原文。')
        job.blocks = read_blocks(data)
        def choose_text():
            with PDF_LOCK:
                return prefer_pdf_text(canonical, job.blocks)
        job.blocks, sources = await threaded(choose_text)
    report(job, 'recognize', f'已识别 {len(job.blocks)} 个内容块', 'done')
    report(job, 'preview', '正在准备原文页面与定位信息')
    for page in pages:
        page_blocks = [block for block in job.blocks if block['pageIndex'] == page['number'] - 1]
        page['needsReview'] |= not bool(page_blocks)
        for step in page['steps']:
            if step['tool'] == 'ocr':
                step.update(status='used', label=f'MinerU 识别 {len(page_blocks)} 个文字块')
    preprocessing.attach_mapping(job.blocks, pages)
    units = preprocessing.group_pages(pages, job.blocks, policy['grouping'])
    prepared['preprocessing'].update(provider='mineru-cloud', unitCount=len(units), needsReview=any(page['needsReview'] for page in pages))
    job.document = {'id': job.id, 'engine': 'PDF 文字层 / PDFium' if native else f'MinerU Cloud / {model}', 'tier': 'cloud', 'pages': pages,
                    'extractor': 'deepseek' if semantic.enabled() and not job.ocr_only else 'label-match',
                    'textSources': sources, 'schemaVersion': 2,
                    'preprocessing': prepared['preprocessing'],
                    'units': units,
                    'fullText': full_text.descriptor(job.directory / 'fulltext', f'/api/documents/{job.id}/fulltext', count)}
    report(job, 'preview', f'已准备 {count} 页原文预览', 'done')


def recognize_text_pdf(job: Job):
    canonical, _ = prepare_pdf(job)
    prepared = preprocessing.process(job, canonical, PDF_LOCK)
    job.blocks = prepared['blocks']
    job.document = {'id': job.id, 'engine': 'PP-OCR / PDFium', 'tier': TIER, 'pages': prepared['pages'],
                    'extractor': 'label-match', 'textSources': prepared['textSources'], 'schemaVersion': 2,
                    'preprocessing': prepared['preprocessing'], 'units': prepared['units']}
    return True

async def extract_semantic_units(job):
    units = job.document.get('units', [])
    if len(units) <= 1:
        return await semantic.extract_fields(job, job.prompt, job.fields)
    started, original, output, calls = time.monotonic(), job.blocks, [], []
    try:
        for unit in units:
            report(job, f'unit-{unit["id"]}', f'正在提取{unit["label"]}', detail='原文第 ' + '、'.join(map(str, unit['pages'])) + ' 页')
            job.blocks = [block for block in original if block['pageIndex'] + 1 in unit['pages']]
            job.latest_call = None
            try:
                fields, call = await semantic.extract_fields(job, job.prompt, job.fields)
            except ValueError as exc:
                from .grounding import rejected
                fields = [rejected(name, str(exc), 'unit_failed') for name in job.fields or ['提取结果']]
                call = job.latest_call
            if call:
                calls.append(call)
            for field in fields:
                field.update(key=f'{unit["id"]}-{field["key"]}', unitId=unit['id'], unitLabel=unit['label'])
            output.extend(fields)
            report(job, f'unit-{unit["id"]}', f'{unit["label"]}已整理', 'done')
        call = semantic.aggregate_calls(calls, started, 'partial' if any(item['status'] == 'rejected' for item in output) else 'success')
        job.latest_call = call
        return output, call
    finally:
        job.blocks = original


async def run_job(job: Job, reuse: bool = False):
    invocation_started = time.perf_counter()
    try:
        # A disconnected upload must not silently start consuming model memory.
        await asyncio.wait_for(job.acknowledged.wait(), timeout=45)
        try:
            await threaded(activity.start, job.invocation, {'scope': 'preparation' if job.ocr_only else 'document'})
        except Exception:
            logger.warning('Invocation tracking unavailable; extraction continues', exc_info=True)
        report(job, 'queue', '等待本机处理资源')
        async with gate:
            job.status = 'running'
            report(job, 'queue', '已获得处理资源', 'done')
            if not reuse:
                text_ready = job.ocr_only and not mineru_cloud.enabled() and await threaded(recognize_text_pdf, job)
                if not text_ready:
                    await recognize_document(job)
            else:
                report(job, 'reuse', '复用已识别原文', 'done')
            if job.output_mode == 'fulltext' or job.ocr_only or not semantic.enabled():
                job.document = {key: value for key, value in job.document.items() if key != 'capabilityPlan'}
            if job.output_mode == 'fulltext':
                fields = []
                report(job, 'fulltext', '已生成全文与 Markdown', 'done')
            elif semantic.enabled() and not job.ocr_only:
                fields, call = await extraction_flow.extract(job, extract_semantic_units)
                job.document = {**job.document, 'extractor': 'deepseek', 'model': call['model'], 'modelCall': call}
            else:
                report(job, 'match', '正在按字段标签匹配')
                fields = match_fields(job.blocks, job.fields)
            if job.requirements:
                rules = {item['name']: item for item in job.requirements['fields']}
                for field in fields:
                    if field['name'] in rules:
                        field['requirement'] = {**rules[field['name']], 'fileName': job.requirements['fileName'],
                                                'sheet': job.requirements['sheet']}
            job.document = {**job.document, 'requirements': job.requirements}
            summary = {name: sum(field['status'] == status for field in fields) for name, status in
                       [('ready', 'pending'), ('missing', 'missing'), ('needsReview', 'rejected'), ('needsVisual', 'visual_required')]}
            summary['total'] = len(fields)
            job.result = {'document': job.document, 'fields': fields, 'summary': summary}
            job.status = 'succeeded'
            finish(job, 'done')
            report(job, 'complete', '全文转换已完成' if job.output_mode == 'fulltext' else f'已整理 {len(fields)} 项提取结果', 'done')
    except asyncio.CancelledError:
        if job.process and job.process.returncode is None:
            try:
                job.process.terminate()
            except ProcessLookupError:
                pass
            await job.process.wait()
        job.status = 'cancelled'
        finish(job, 'cancelled')
        raise
    except (ValueError, asyncio.TimeoutError) as exc:
        if job.process and job.process.returncode is None:
            job.process.kill()
            await job.process.wait()
        job.error = str(exc) if str(exc) else '识别超时，请减少页数后重试。'
        job.status = 'failed'
        finish(job, 'error')
    except Exception:
        logger.exception('Document processing failed: job=%s phase=%s', job.id, job.phase)
        job.error = f'“{job.phase}”步骤处理失败，已记录诊断信息。请重试或联系维护人员。'
        job.status = 'failed'
        finish(job, 'error')
    finally:
        job.touched = time.time()
        try:
            await threaded(activity.complete, job.invocation, job.status,
                           {'totalElapsedMs': round((time.perf_counter() - invocation_started) * 1000, 2),
                            'phases': operations.event_timings(job.events), 'error': job.error})
        except Exception:
            logger.warning('Invocation outcome tracking unavailable', exc_info=True)

async def collect_expired():
    while True:
        await asyncio.sleep(5)
        for job_id, job in list(jobs.items()):
            if job.status in {'queued', 'running'} and time.time() - job.touched > 45:
                await cancel(job)
            if job.status not in {'queued', 'running'} and time.time() - job.touched > TTL:
                jobs.pop(job_id, None)
                shutil.rmtree(job.directory, ignore_errors=True)

@asynccontextmanager
async def lifespan(_app):
    if TIER not in {'basic', 'standard'}:
        raise RuntimeError('WENXI_MINERU_TIER must be basic or standard')
    if mineru_cloud.enabled() and (not PUBLIC_ORIGIN.startswith('https://') or not os.getenv('WENXI_ACCESS_PASSWORD') or not os.getenv('MINERU_API_TOKEN')):
        raise RuntimeError('Cloud deployment requires HTTPS origin, access password and MinerU token')
    if mineru_cloud.enabled():
        from .page_orientation import session
        await threaded(session)
    STORAGE.mkdir(parents=True, exist_ok=True)
    lock = FileLock(str(STORAGE.parent / 'wenxi-service.lock'), timeout=0)
    lock.acquire()
    PID_FILE.write_text(str(os.getpid()))
    # Exclusive service lock makes crash leftovers safe to remove on restart.
    for directory in STORAGE.iterdir():
        if directory.is_dir() and len(directory.name) == 32 and all(c in '0123456789abcdef' for c in directory.name):
            shutil.rmtree(directory, ignore_errors=True)
    collector = asyncio.create_task(collect_expired())
    try:
        yield
    finally:
        collector.cancel()
        await asyncio.gather(collector, return_exceptions=True)
        for job in list(jobs.values()):
            await cancel(job)
            shutil.rmtree(job.directory, ignore_errors=True)
        jobs.clear()
        PID_FILE.unlink(missing_ok=True)
        lock.release()

app = FastAPI(title='文析服务', lifespan=lifespan, docs_url=None if mineru_cloud.enabled() else '/docs',
              redoc_url=None if mineru_cloud.enabled() else '/redoc',
              openapi_url=None if mineru_cloud.enabled() else '/openapi.json')

@app.middleware('http')
async def local_access(request: Request, call_next):
    if mineru_cloud.enabled() and request.url.path != '/healthz':
        try:
            scheme, token = request.headers.get('authorization', '').split(' ', 1)
            username, password = base64.b64decode(token, validate=True).decode().split(':', 1)
            allowed = scheme.lower() == 'basic' and hmac.compare_digest(username.encode(), os.getenv('WENXI_ACCESS_USER', 'wenxi').encode()) and hmac.compare_digest(password.encode(), os.environ['WENXI_ACCESS_PASSWORD'].encode())
        except (ValueError, UnicodeError, KeyError):
            allowed = False
        if not allowed:
            return JSONResponse({'detail': '请使用文析试用账户登录。'}, status_code=401,
                                headers={'WWW-Authenticate': 'Basic realm="Wenxi", charset="UTF-8"'})
    if request.headers.get('origin') and request.headers['origin'] not in ORIGINS:
        return JSONResponse({'detail': '请通过文析本机试用地址访问。'}, status_code=403)
    # Shared links navigate to the UI from another site; API requests still
    # require a same-origin context, even when the browser has saved credentials.
    public_navigation = (bool(PUBLIC_ORIGIN) and request.method == 'GET' and request.url.path == '/'
                         and request.headers.get('sec-fetch-mode') == 'navigate'
                         and request.headers.get('sec-fetch-dest') == 'document')
    if request.headers.get('sec-fetch-site') == 'cross-site' and not public_navigation:
        return JSONResponse({'detail': '仅允许本机页面访问。'}, status_code=403)
    from urllib.parse import urlsplit
    hosts = {'127.0.0.1', 'localhost'} | ({urlsplit(PUBLIC_ORIGIN).hostname} if PUBLIC_ORIGIN else set())
    if request.headers.get('host', '').split(':')[0] not in hosts:
        return JSONResponse({'detail': '仅允许本机地址。'}, status_code=403)
    try:
        bundle_path = request.url.path == '/api/profile-sample-bundles' or bool(re.fullmatch(r'/api/(extraction-profiles/[^/]+/(debug-bundle|execute-bundle)|studio/scenes/[^/]+/(debug-bundle|execute))', request.url.path))
        limit = bundles.MAX_TOTAL if bundle_path else MAX_SIZE
        if int(request.headers.get('content-length', '0')) > limit + 1024 * 1024:
            return JSONResponse({'detail': '材料包合计限 100 MB。' if bundle_path else '每份材料限 30 MB。'}, status_code=413)
    except ValueError:
        return JSONResponse({'detail': '无效请求。'}, status_code=400)
    response = await call_next(request)
    response.headers['Cache-Control'] = 'no-store'
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['Referrer-Policy'] = 'no-referrer'
    response.headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' data: blob:; frame-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'self'"
    return response

@app.get('/')
def home():
    return FileResponse(UI, media_type='text/html')

@app.get('/api/health')
def health():
    return {'status': 'ok', 'tier': TIER, 'extractor': 'deepseek' if semantic.enabled() else 'label-match',
            'semantic': semantic.enabled(), 'model': semantic.model_name() if semantic.enabled() else None,
            'maxPages': MAX_PAGES, 'schemaVersion': 2, 'supportsRequirements': True, 'supportsHistory': True, 'supportsFullText': True, 'supportsProfiles': True, 'supportsPreprocessing': True,
            'reviewAvailable': (ROOT / 'output/optimization-20261030/处理逻辑优化复测.html').is_file()}


@app.get('/healthz')
def healthz():
    return {'ok': True, 'mode': 'cloud-api' if mineru_cloud.enabled() else 'local'}

@app.get('/api/operations/activity')
async def operation_activity():
    return await threaded(activity.daily)

@app.get('/api/operations/overview')
async def operation_overview(days: int = 30, kind: str = 'all', record_status: str = '', record_target: str = ''):
    if days not in {7, 30, 365} or kind not in {'all', 'document', 'api', 'service', 'scene'}:
        raise HTTPException(422, '请选择支持的统计范围。')
    if record_status not in {'', 'succeeded', 'needs_review', 'failed', 'cancelled', 'running'} or len(record_target) > 160:
        raise HTTPException(422, '请选择支持的明细筛选条件。')
    return await threaded(operations.overview, days, kind, record_status, record_target)

@app.get('/api/history')
async def history_list():
    return await threaded(history.listing)

@app.put('/api/history/{record_id}')
async def history_save(record_id: str, body: dict):
    try:
        return await threaded(history.save, record_id, body, dict(jobs))
    except ValueError as exc:
        raise HTTPException(422, str(exc))
    except OSError:
        logger.warning('Could not save history', exc_info=True)
        raise HTTPException(500, '历史记录保存失败，请检查本机存储空间；当前任务仍保留。')

@app.get('/api/history/{record_id}')
async def history_snapshot(record_id: str):
    try:
        return await threaded(history.snapshot, record_id)
    except (ValueError, FileNotFoundError) as exc:
        raise HTTPException(404, str(exc))

@app.get('/api/history/{record_id}/fulltext/{material_id}')
async def history_full_text(record_id: str, material_id: str):
    try:
        path = await threaded(history.asset_path, record_id, material_id, 'fulltext/markdown.md')
        return full_text.content(path.parent, f'/api/history/{record_id}/files/{material_id}/fulltext')
    except (ValueError, FileNotFoundError) as exc:
        raise HTTPException(404, str(exc))

@app.get('/api/history/{record_id}/files/{material_id}/{filename:path}')
async def history_asset(record_id: str, material_id: str, filename: str):
    try:
        path = await threaded(history.asset_path, record_id, material_id, filename)
        return FileResponse(path)
    except (ValueError, FileNotFoundError) as exc:
        raise HTTPException(404, str(exc))

@app.post('/api/requirements/parse')
async def read_requirements(file: UploadFile = File()):
    try:
        content = await file.read(MAX_WORKBOOK_BYTES + 1)
        return await threaded(parse_workbook, content, file.filename or '')
    except ValueError as exc:
        raise HTTPException(422, str(exc))
    except Exception:
        raise HTTPException(422, '无法读取此 Excel，请确认是未加密的 .xlsx 文件。')
    finally:
        await file.close()

@app.get('/api/reviews/optimization-20261030')
def optimization_review():
    path = ROOT / 'output/optimization-20261030/处理逻辑优化复测.html'
    if not path.is_file():
        raise HTTPException(404, '本机暂无这轮复测记录。')
    return FileResponse(path, media_type='text/html', headers={
        'Content-Security-Policy': "default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'"})

@app.post('/api/tasks', status_code=202)
async def submit(file: UploadFile = File(), fields: str = Form(default='[]'), prompt: str = Form(default=''),
                 requirements: str = Form(default=''), ocr_only: bool = Form(default=False), preprocessing_config: str = Form(default=''), output_mode: Literal['fields', 'fulltext'] = Form(default='fields')):
    try:
        names = [] if ocr_only or output_mode == 'fulltext' else checked_fields(json.loads(fields))
        definition = RequirementDefinition.model_validate_json(requirements).model_dump() if requirements else None
        policy = preprocessing.Policy.model_validate_json(preprocessing_config).model_dump() if preprocessing_config else preprocessing.Policy().model_dump()
        if output_mode == 'fulltext':
            definition = None
        if definition:
            required_names = [item['name'] for item in definition['fields']]
            if names and names != required_names:
                raise HTTPException(422, '请求字段与Excel清单不一致，请重新选择字段表。')
            names = required_names
    except json.JSONDecodeError:
        raise HTTPException(422, '字段列表格式错误。')
    except ValueError:
        raise HTTPException(422, 'Excel字段要求结构不符合要求。')
    if len(prompt) > 4000 or (not prompt.strip() and not names):
        raise HTTPException(422, '请说明提取要求，长度限 4000 字符。')
    suffix = Path(file.filename or '').suffix.lower()
    if suffix not in {'.pdf', '.png', '.jpg', '.jpeg', '.webp'}:
        raise HTTPException(415, '本轮真实识别支持 PDF 和图片；Word、ZIP 后续接入。')
    if sum(job.status in {'queued', 'running'} for job in jobs.values()) >= 6:
        raise HTTPException(429, '本机正在处理多份材料，请稍后再试。')
    job_id = uuid.uuid4().hex
    directory = STORAGE / job_id
    directory.mkdir()
    size = 0
    try:
        with (directory / ('input' + suffix)).open('wb') as stream:
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > MAX_SIZE:
                    raise HTTPException(413, '每份材料限 30 MB。')
                stream.write(chunk)
        if not size:
            raise HTTPException(422, '附件为空。')
    except BaseException:
        shutil.rmtree(directory, ignore_errors=True)
        raise
    finally:
        await file.close()
    job = Job(job_id, Path(file.filename or '文档').name, suffix, names, directory,
              prompt=prompt.strip() or '提取' + '、'.join(names), requirements=definition, ocr_only=ocr_only, preprocessing_policy=policy, output_mode=output_mode)
    jobs[job_id] = job
    job.worker = asyncio.create_task(run_job(job))
    return metadata(job)

@app.get('/api/tasks/{job_id}')
async def status(job_id: str):
    job = find_job(job_id)
    job.acknowledged.set()
    return metadata(job)

@app.post('/api/tasks/{job_id}/cancel')
async def stop(job_id: str):
    job = find_job(job_id)
    await cancel(job)
    return metadata(job)

@app.post('/api/documents/{document_id}/extract', status_code=202)
async def extract(document_id: str, body: ExtractionRequest):
    job = find_job(document_id)
    if not job.document:
        raise HTTPException(409, '文档尚未识别完成。')
    if job.status in {'queued', 'running'}:
        raise HTTPException(409, '当前文档已有提取任务，请先等待或停止。')
    names = [] if body.outputMode == 'fulltext' else checked_fields(body.fields)
    definition = body.requirements.model_dump() if body.requirements and body.outputMode != 'fulltext' else None
    if definition:
        required_names = [item['name'] for item in definition['fields']]
        if names and names != required_names:
            raise HTTPException(422, '请求字段与Excel清单不一致，请重新选择字段表。')
        names = required_names
    if not body.prompt.strip() and not names:
        raise HTTPException(422, '请说明需要提取的内容。')
    job.fields = names
    job.output_mode = body.outputMode
    job.requirements = definition
    job.prompt = body.prompt.strip() or '提取' + '、'.join(names)
    job.status = 'queued'
    job.phase = '等待提取字段'
    job.events = []
    job.invocation = uuid.uuid4().hex
    job.error = ''
    job.latest_call = None
    job.acknowledged = asyncio.Event()
    job.worker = asyncio.create_task(run_job(job, reuse=True))
    return metadata(job)

@app.get('/api/documents/{document_id}/fulltext')
def document_full_text(document_id: str):
    job = find_job(document_id)
    try:
        return full_text.content(job.directory / 'fulltext', f'/api/documents/{job.id}/fulltext')
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc))

@app.get('/api/documents/{document_id}/fulltext/{filename:path}')
def document_full_text_file(document_id: str, filename: str):
    job = find_job(document_id)
    try:
        path = full_text.asset_path(job.directory / 'fulltext', filename)
        return FileResponse(path, filename='document.md' if filename == 'markdown.md' else 'document.zip' if filename == 'document.zip' else None,
                            media_type='text/markdown; charset=utf-8' if filename == 'markdown.md' else None)
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc))

@app.get('/api/documents/{document_id}/pages/{number}.png')
def page_image(document_id: str, number: int):
    job = find_job(document_id)
    if not job.document or not 1 <= number <= len(job.document['pages']):
        raise HTTPException(404, '原文页不存在。')
    return FileResponse(job.directory / f'page-{number}.png', media_type='image/png')

@app.get('/api/documents/{document_id}/original-pages/{number}.png')
def original_page_image(document_id: str, number: int):
    job = find_job(document_id)
    if not job.document or not 1 <= number <= len(job.document['pages']):
        raise HTTPException(404, '上传原图不存在。')
    path = job.directory / f'original-{number}.png'
    if not path.is_file():
        raise HTTPException(404, '上传原图不存在。')
    return FileResponse(path, media_type='image/png')

@app.delete('/api/documents/{document_id}')
async def remove(document_id: str):
    job = find_job(document_id)
    await cancel(job)
    jobs.pop(document_id, None)
    shutil.rmtree(job.directory, ignore_errors=True)
    return {'deleted': True}


def profile_error(exc):
    return HTTPException(404 if isinstance(exc, FileNotFoundError) else 422, str(exc))


@app.get('/api/extraction-profiles')
async def profile_list():
    return await threaded(profiles.listing)


@app.get('/api/scene-library')
async def scene_library_list():
    from . import library
    return await threaded(library.listing)


@app.get('/api/scene-library/{entry_id}')
async def scene_library_read(entry_id: str):
    from . import library
    try:
        return await threaded(library.read, entry_id)
    except (ValueError, FileNotFoundError) as exc:
        raise profile_error(exc)


@app.post('/api/extraction-profiles/{profile_id}/share')
async def scene_library_share(profile_id: str, body: dict):
    from . import library
    try:
        return await threaded(library.submit, profile_id, body)
    except (ValueError, FileNotFoundError) as exc:
        raise profile_error(exc)

@app.get('/api/scene-publication-reviews')
async def scene_publication_reviews():
    from . import library
    return await threaded(library.reviews)


@app.post('/api/scene-publication-reviews/{review_id}/decision')
async def scene_publication_decision(review_id: str, body: dict):
    from . import library
    try:
        return await threaded(library.decide, review_id, body)
    except (ValueError, FileNotFoundError) as exc:
        raise profile_error(exc)

@app.get('/api/extraction-profiles/{profile_id}')
async def profile_read(profile_id: str):
    try:
        return await threaded(profiles.read, profile_id)
    except (ValueError, FileNotFoundError) as exc:
        raise profile_error(exc)

@app.put('/api/extraction-profiles/{profile_id}')
async def profile_save(profile_id: str, body: dict):
    try:
        if body.get('resourceKind') == 'parser':
            await threaded(scenes.register_parser, profile_id)
        return await threaded(profiles.save, profile_id, body)
    except (ValueError, FileNotFoundError) as exc:
        raise profile_error(exc)

@app.post('/api/extraction-profiles/{profile_id}/test')
async def profile_test(profile_id: str, body: dict):
    try:
        return await threaded(profiles.test, profile_id, body.get('sampleId', ''), body.get('templateId', ''))
    except (ValueError, FileNotFoundError) as exc:
        raise profile_error(exc)

@app.get('/api/extraction-profiles/{profile_id}/evaluations')
async def studio_reports(profile_id: str):
    try:
        return await threaded(studio.reports, profile_id)
    except (ValueError, FileNotFoundError) as exc:
        raise profile_error(exc)

@app.post('/api/extraction-profiles/{profile_id}/evaluations')
async def studio_evaluate(profile_id: str, body: dict):
    try:
        return await threaded(studio.evaluate, profile_id, body.get('sampleIds', []))
    except (ValueError, FileNotFoundError) as exc:
        raise profile_error(exc)

@app.get('/api/extraction-profiles/{profile_id}/evaluations/{report_id}')
async def studio_report(profile_id: str, report_id: str):
    try:
        return await threaded(studio.report, profile_id, report_id)
    except (ValueError, FileNotFoundError) as exc:
        raise profile_error(exc)

@app.get('/api/extraction-profiles/{profile_id}/runs')
async def studio_runs(profile_id: str):
    try:
        return await threaded(studio.runs, profile_id)
    except (ValueError, FileNotFoundError) as exc:
        raise profile_error(exc)

@app.get('/api/extraction-profiles/{profile_id}/versions/{version}')
async def studio_version(profile_id: str, version: str):
    try:
        return await threaded(profiles.published, profile_id, version)
    except (ValueError, FileNotFoundError) as exc:
        raise profile_error(exc)


@app.get('/api/extraction-profiles/{profile_id}/releases')
async def profile_releases(profile_id: str):
    try:
        return await threaded(profiles.releases, profile_id)
    except (ValueError, FileNotFoundError) as exc:
        raise profile_error(exc)

@app.get('/api/extraction-profiles/{profile_id}/release-check')
async def profile_release_check(profile_id: str):
    try:
        return await threaded(profiles.release_check, profile_id)
    except (ValueError, FileNotFoundError) as exc:
        raise profile_error(exc)


@app.post('/api/extraction-profiles/{profile_id}/publish')
async def profile_publish(profile_id: str, body: dict | None = None):
    try:
        return await threaded(profiles.publish, profile_id, (body or {}).get('note', ''))
    except (ValueError, FileNotFoundError) as exc:
        raise profile_error(exc)

@app.post('/api/profile-samples/from-document')
async def profile_from_document(body: dict):
    job = find_job(body.get('documentId', ''))
    if not job.document or job.status in {'running', 'queued'}:
        raise HTTPException(409, '原文仍在识别，请完成后再创建方案。')
    return await threaded(profiles.save_sample, job)

@app.post('/api/profile-samples/from-task/{job_id}')
async def profile_from_task(job_id: str):
    job = find_job(job_id)
    if not job.document or job.status != 'succeeded':
        raise HTTPException(409, '请等待样例识别完成。')
    return await threaded(profiles.save_sample, job)

@app.get('/api/profile-samples/{sample_id}')
async def profile_sample(sample_id: str):
    try:
        return await threaded(profiles.sample, sample_id)
    except (ValueError, FileNotFoundError) as exc:
        raise profile_error(exc)

@app.get('/api/profile-samples/{sample_id}/{filename}')
async def profile_sample_image(sample_id: str, filename: str):
    try:
        return FileResponse(await threaded(profiles.sample_asset, sample_id, filename), media_type=None if filename == 'source' else 'image/png')
    except (ValueError, FileNotFoundError) as exc:
        raise profile_error(exc)

@app.post('/api/profile-samples/{sample_id}/suggest')
async def profile_suggest(sample_id: str, body: dict):
    try:
        return await threaded(profiles.suggest, sample_id, str(body.get('request', ''))[:2000], int(body.get('referencePage', 1)))
    except (ValueError, FileNotFoundError) as exc:
        raise profile_error(exc)

@app.post('/api/profile-samples/{sample_id}/generate-rules')
async def profile_generate_rules(sample_id: str, body: rule_generation.GenerationRequest, request: Request):
    task = None
    try:
        sample = await threaded(profiles.sample, sample_id)
        task = asyncio.create_task(rule_generation.generate(sample, body))
        while not task.done():
            await asyncio.wait({task}, timeout=.4)
            if await request.is_disconnected():
                task.cancel()
                raise HTTPException(499, '配置生成已取消，现有配置保持不变。')
        return await task
    except (ValueError, FileNotFoundError) as exc:
        raise profile_error(exc)
    finally:
        if task and not task.done():
            task.cancel()
        if task:
            await asyncio.gather(task, return_exceptions=True)

@app.post('/api/profile-samples/{sample_id}/preview-rule')
async def profile_preview_rule(sample_id: str, body: rule_generation.PreviewRequest):
    try:
        sample = await threaded(profiles.sample, sample_id)
        return await threaded(rule_generation.preview_rule, sample, body)
    except (ValueError, FileNotFoundError) as exc:
        raise profile_error(exc)


@app.post('/api/profile-samples/{sample_id}/assist-rules')
async def profile_assist_rules(sample_id: str, body: rule_assistant.AssistantRequest, request: Request):
    task = None
    try:
        sample = await threaded(profiles.sample, sample_id)
        task = asyncio.create_task(rule_assistant.assist(sample, body))
        while not task.done():
            await asyncio.wait({task}, timeout=.4)
            if await request.is_disconnected():
                task.cancel()
                raise HTTPException(499, '配置助手已停止，现有规则未改变。')
        return await task
    except (ValueError, FileNotFoundError) as exc:
        raise profile_error(exc)
    finally:
        if task and not task.done():
            task.cancel()
        if task:
            await asyncio.gather(task, return_exceptions=True)

@app.post('/api/extraction-profiles/{profile_id}/execute')
async def profile_execute(profile_id: str, file: UploadFile = File(), version: str = Form(), template_id: str = Form(default='')):
    # Validate the immutable published version before accepting expensive recognition work.
    try:
        published = await threaded(profiles.published, profile_id, version)
    except (ValueError, FileNotFoundError) as exc:
        await file.close()
        raise profile_error(exc)
    started = time.perf_counter()
    submitted = await submit(file=file, fields='[]', prompt='固定版式提取', requirements='', ocr_only=True,
                             preprocessing_config=json.dumps(published.get('preprocessing') or {}))
    job = find_job(submitted['id'])
    job.acknowledged.set()
    outcome = None
    failure = ''
    try:
        while not job.worker.done():
            await asyncio.wait([job.worker], timeout=10)
            job.touched = time.time()
        await job.worker
        if job.status != 'succeeded':
            raise ValueError(job.error or '材料识别未完成。')
        incoming = {'name': job.name, 'pages': job.document['pages'], 'blocks': job.blocks,
                    'preprocessing': job.document.get('preprocessing'), 'engine': job.document['engine']}
        result = await threaded(profiles.execute, profile_id, version, incoming, template_id)
        result['totalElapsedMs'] = round((time.perf_counter() - started) * 1000, 2)
        outcome = result
        return result
    except (ValueError, FileNotFoundError) as exc:
        failure = str(exc)
        raise profile_error(exc)
    finally:
        try:
            await threaded(studio.record_run, profile_id, version, job.name,
                           round((time.perf_counter() - started) * 1000, 2), outcome, failure or job.error,
                           operations.event_timings(job.events))
        except Exception:
            logger.warning('Studio invocation tracking unavailable', exc_info=True)
        await cancel(job)
        jobs.pop(job.id, None)
        shutil.rmtree(job.directory, ignore_errors=True)


async def bundle_uploads(files):
    contents = []
    try:
        if not 1 <= len(files) <= bundles.MAX_FILES:
            raise ValueError('每次最多上传 20 个文件或 ZIP。')
        total = 0
        for file in files:
            content = await file.read(bundles.MAX_FILE + 1)
            total += len(content)
            if total > bundles.MAX_TOTAL:
                raise ValueError('上传文件合计不能超过 100 MB。')
            contents.append((file.filename or '材料', content))
        return await threaded(bundles.unpack, contents)
    finally:
        for file in files:
            await file.close()


async def prepare_bundle_member(name, content, policy, request, *, persist):
    submitted = await submit(file=UploadFile(filename=Path(name).name, file=BytesIO(content)), fields='[]',
                             prompt='场景材料识别', requirements='', ocr_only=True,
                             preprocessing_config=json.dumps(policy or {}))
    job = find_job(submitted['id']); job.acknowledged.set()
    try:
        while not job.worker.done():
            await asyncio.wait({job.worker}, timeout=.4)
            job.touched = time.time()
            if await request.is_disconnected():
                raise HTTPException(499, '材料处理已停止。')
        await job.worker
        if job.status != 'succeeded':
            raise ValueError(job.error or '材料识别失败。')
        if persist:
            value = await threaded(profiles.save_sample, job)
            value['name'] = name
            await threaded(profiles.atomic, profiles.ROOT / 'samples' / value['id'] / 'sample.json', value)
            return value
        return {'name': name, 'pages': job.document['pages'], 'blocks': job.blocks,
                'preprocessing': job.document.get('preprocessing'), 'engine': job.document['engine']}
    finally:
        await cancel(job); jobs.pop(job.id, None)
        shutil.rmtree(job.directory, ignore_errors=True)


@app.post('/api/profile-sample-bundles')
async def profile_sample_bundle(request: Request, files: list[UploadFile] = File(), preprocessing_config: str = Form(default='')):
    try:
        policy = preprocessing.Policy.model_validate_json(preprocessing_config).model_dump() if preprocessing_config else preprocessing.Policy().model_dump()
        entries, failures = await bundle_uploads(files)
        samples = []
        for name, content in entries:
            try:
                samples.append(await prepare_bundle_member(name, content, policy, request, persist=True))
            except (ValueError, HTTPException) as exc:
                if isinstance(exc, HTTPException) and exc.status_code == 499:
                    raise
                failures.append({'name': name, 'error': str(exc.detail) if isinstance(exc, HTTPException) else str(exc)})
        return {'samples': samples, 'failures': failures, 'usesLlm': False}
    except ValueError as exc:
        raise profile_error(exc)


async def process_scene_bundle(profile_id, draft, entries, failures, request, *, debug):
    started = time.perf_counter()
    files = [dict(item) for item in failures]
    for name, content in entries:
        row = {'name': name}
        try:
            incoming = await prepare_bundle_member(name, content, draft.get('preprocessing'), request, persist=debug)
            if debug:
                row['sampleId'] = incoming['id']
            row['result'] = await threaded(profiles.extract_batch, draft, incoming)
        except (ValueError, FileNotFoundError, HTTPException) as exc:
            if isinstance(exc, HTTPException) and exc.status_code == 499:
                raise
            row['error'] = str(exc.detail) if isinstance(exc, HTTPException) else str(exc)
        files.append(row)
    result = routing.bundle_result(draft, files, round((time.perf_counter() - started) * 1000, 2))
    if debug:
        def remember():
            with profiles.LOCK:
                record = profiles.read(profile_id)
                # A concurrent configuration edit cannot inherit another snapshot's test state.
                if profiles.fingerprint(record['draft']) != profiles.fingerprint(draft):
                    return
                links = record['draft'].setdefault('samples', [])
                tests = record.get('lastTest', {}).get('templates', {}) if record.get('lastTest', {}).get('hash') == profiles.fingerprint(draft) else {}
                for file in files:
                    if not file.get('sampleId'):
                        continue
                    if len(links) < 50 and not any(link['sampleId'] == file['sampleId'] for link in links):
                        links.append({'sampleId': file['sampleId'], 'templateId': '', 'role': 'test'})
                    for item in file.get('result', {}).get('items', []):
                        if item.get('templateId') and item.get('passed'):
                            tests[item['templateId']] = {**item, 'sampleId': file['sampleId'], 'scope': 'new-sample', 'testedAt': profiles.now()}
                record['lastTest'] = {'hash': profiles.fingerprint(draft), 'templates': tests}
                profiles.atomic(profiles.ROOT / 'profiles' / (profile_id + '.json'), record)
        await threaded(remember)
    return result


@app.post('/api/extraction-profiles/{profile_id}/debug-bundle')
async def profile_debug_bundle(profile_id: str, request: Request, files: list[UploadFile] = File()):
    try:
        draft = (await threaded(profiles.read, profile_id))['draft']
        entries, failures = await bundle_uploads(files)
        if len(draft.get('samples', [])) + len(entries) > 50:
            raise ValueError('测试样例最多保留 50 份，请先在样例管理中移除不需要的测试记录。')
        return await process_scene_bundle(profile_id, draft, entries, failures, request, debug=True)
    except (ValueError, FileNotFoundError) as exc:
        raise profile_error(exc)
    finally:
        for file in files:
            await file.close()


@app.post('/api/extraction-profiles/{profile_id}/extensions/preview')
async def profile_extension_placeholder(profile_id: str):
    # Reserved contract only. No code, dependencies, workers or configuration are accepted here.
    try:
        await threaded(profiles.read, profile_id)
    except (ValueError, FileNotFoundError) as exc:
        raise profile_error(exc)
    return JSONResponse(status_code=501, content={'code': 'extensions_not_enabled', 'detail': '代码扩展暂未开放，请使用规则配置。'})


@app.post('/api/extraction-profiles/{profile_id}/execute-bundle')
async def profile_execute_bundle(profile_id: str, request: Request, files: list[UploadFile] = File(), version: str = Form()):
    started = time.perf_counter(); result = None; error = ''; draft = None
    try:
        draft = await threaded(profiles.published, profile_id, version)
        entries, failures = await bundle_uploads(files)
        result = await process_scene_bundle(profile_id, draft, entries, failures, request, debug=False)
        return {**result, 'profileId': profile_id, 'version': version}
    except (ValueError, FileNotFoundError) as exc:
        error = str(exc); raise profile_error(exc)
    finally:
        for file in files:
            await file.close()
        if draft:
            await threaded(studio.record_run, profile_id, version, '材料包', round((time.perf_counter() - started) * 1000, 2), result, error)


@app.get('/api/studio/catalog')
async def studio_catalog():
    return await threaded(scenes.catalog)


@app.get('/api/studio/scenes/{scene_id}')
async def composed_scene_read(scene_id: str):
    try:
        return await threaded(scenes.read, scene_id)
    except (ValueError, FileNotFoundError) as exc:
        raise profile_error(exc)


@app.put('/api/studio/scenes/{scene_id}')
async def composed_scene_save(scene_id: str, body: dict):
    try:
        return await threaded(scenes.save, scene_id, body)
    except (ValueError, FileNotFoundError) as exc:
        raise profile_error(exc)


@app.get('/api/studio/scenes/{scene_id}/release-check')
async def scene_release_check(scene_id: str):
    try:
        return await threaded(scenes.release_check, scene_id)
    except (ValueError, FileNotFoundError) as exc:
        raise profile_error(exc)


@app.put('/api/studio/scenes/{scene_id}/efficiency')
async def scene_efficiency_save(scene_id: str, body: dict):
    try:
        return await threaded(scenes.configure_efficiency, scene_id, body)
    except (ValueError, FileNotFoundError) as exc:
        raise profile_error(exc)


@app.post('/api/studio/scenes/{scene_id}/publish')
async def composed_scene_publish(scene_id: str):
    try:
        return await threaded(scenes.publish, scene_id)
    except (ValueError, FileNotFoundError) as exc:
        raise profile_error(exc)


@app.get('/api/studio/scenes/{scene_id}/runs')
async def composed_scene_runs(scene_id: str):
    try:
        return await threaded(scenes.runs, scene_id)
    except (ValueError, FileNotFoundError) as exc:
        raise profile_error(exc)


async def process_composition(draft, resolved, entries, failures, request, assignments, persist):
    started, files = time.perf_counter(), [dict(row) for row in failures]
    valid = {b['id'] for b, _ in resolved}
    if any(value not in valid for value in assignments.values()):
        raise ValueError('指定的材料用途不在当前场景中。')
    for name, content in entries:
        row, prepared, cache = {'name': name}, {}, {}
        try:
            assignment = assignments.get(name, '')
            for binding, parser in resolved:
                if assignment and binding['id'] != assignment:
                    continue
                policy = preprocessing.Policy.model_validate(parser.get('preprocessing') or {}).model_dump()
                # Grouping doesn't affect OCR. Different orientation policies
                # get separate preparations; rules never reuse wrong coordinates.
                key = json.dumps({k: policy[k] for k in ('orientation', 'deskew')}, sort_keys=True)
                if key not in cache:
                    cache[key] = await prepare_bundle_member(name, content, policy, request, persist=persist)
                prepared[binding['id']] = cache[key]
            row['items'] = await threaded(scenes.candidates, resolved, prepared, assignment)
        except (ValueError, FileNotFoundError, HTTPException) as exc:
            if isinstance(exc, HTTPException) and exc.status_code == 499:
                raise
            row['error'] = str(exc.detail) if isinstance(exc, HTTPException) else str(exc)
        files.append(row)
    return scenes.result(draft, files, round((time.perf_counter() - started) * 1000, 2))


@app.post('/api/studio/scenes/{scene_id}/debug-bundle')
async def composed_scene_debug(scene_id: str, request: Request, files: list[UploadFile] = File(), assignments: str = Form(default='{}')):
    try:
        draft = (await threaded(scenes.read, scene_id))['draft']
        resolved = await threaded(scenes.resolve, draft)
        mapping = json.loads(assignments)
        if not isinstance(mapping, dict) or any(not isinstance(k, str) or not isinstance(v, str) for k, v in mapping.items()):
            raise ValueError('材料用途映射无效。')
        entries, failures = await bundle_uploads(files)
        value = await process_composition(draft, resolved, entries, failures, request, mapping, True)
        await threaded(scenes.remember_test, scene_id, draft, value)
        return value
    except (ValueError, FileNotFoundError) as exc:
        raise profile_error(exc)
    finally:
        for file in files:
            await file.close()


@app.post('/api/studio/scenes/{scene_id}/execute')
async def composed_scene_execute(scene_id: str, request: Request, files: list[UploadFile] = File(), version: str = Form(), assignments: str = Form(default='{}')):
    try:
        draft = await threaded(scenes.published, scene_id, version)
        resolved = await threaded(scenes.resolve, draft)
        mapping = json.loads(assignments)
        if not isinstance(mapping, dict) or any(not isinstance(k, str) or not isinstance(v, str) for k, v in mapping.items()):
            raise ValueError('材料用途映射无效。')
        entries, failures = await bundle_uploads(files)
        value = await process_composition(draft, resolved, entries, failures, request, mapping, False)
        await threaded(scenes.record_run, scene_id, version, value)
        return {**value, 'sceneId': scene_id, 'version': version}
    except (ValueError, FileNotFoundError) as exc:
        raise profile_error(exc)
    finally:
        for file in files:
            await file.close()


@app.post('/api/studio/plan')
async def studio_plan(body: studio_planning.Request, request: Request):
    task = asyncio.create_task(studio_planning.generate(body))
    try:
        while not task.done():
            await asyncio.wait({task}, timeout=.4)
            if await request.is_disconnected():
                raise HTTPException(499, '需求分析已停止，尚未创建配置。')
        return await task
    except (ValueError, FileNotFoundError) as exc:
        raise profile_error(exc)
    finally:
        if not task.done():
            task.cancel()
        await asyncio.gather(task, return_exceptions=True)


@app.post('/api/studio/plan/apply')
async def studio_plan_apply(body: dict, request: Request):
    task = asyncio.create_task(studio_planning.apply_assisted(body))
    try:
        while not task.done():
            await asyncio.wait({task}, timeout=.4)
            if await request.is_disconnected():
                raise HTTPException(499, '已停止创建，尚未提交的配置不会保存。')
        return await task
    except (ValueError, FileNotFoundError, KeyError) as exc:
        raise profile_error(ValueError(str(exc)))
    finally:
        if not task.done():
            task.cancel()
        await asyncio.gather(task, return_exceptions=True)
