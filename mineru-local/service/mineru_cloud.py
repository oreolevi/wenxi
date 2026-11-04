"""Official hosted MinerU adapter. Credentials never leave server-side requests."""
from __future__ import annotations

import asyncio
import json
import math
import os
from pathlib import Path, PurePosixPath
import time
from urllib.parse import urlsplit
import zipfile

import httpx

from . import full_text
from .progress import report

API = 'https://mineru.net/api/v4'
MAX_ARCHIVE = 80 * 1024 * 1024
MAX_JSON = 25 * 1024 * 1024


def enabled():
    return os.getenv('WENXI_RECOGNITION_BACKEND', 'local') == 'mineru-cloud'


def checked_url(value):
    """Only follow HTTPS storage locations issued by the official provider."""
    parsed = urlsplit(value)
    host = (parsed.hostname or '').lower()
    if parsed.scheme != 'https' or parsed.username or parsed.password or parsed.port not in {None, 443}:
        raise ValueError('MinerU 返回了不支持的下载地址。')
    if not any(host == domain or host.endswith('.' + domain) for domain in ('openxlab.org.cn', 'aliyuncs.com', 'mineru.net')):
        raise ValueError('MinerU 返回了未授权的存储地址。')
    return value


def require_success(response):
    if not response.is_success:
        message = {401: 'MinerU Token 无效或已过期。', 403: 'MinerU 拒绝了本次访问。',
                   429: 'MinerU 请求过于频繁，请稍后重试。'}.get(response.status_code, 'MinerU 服务暂时不可用，请稍后重试。')
        raise ValueError(message)
    try:
        value = response.json()
    except ValueError:
        raise ValueError('MinerU 返回了无法读取的响应。') from None
    code = value.get('code')
    if code != 0:
        message = {'A0202': 'MinerU Token 无效。', 'A0211': 'MinerU Token 已过期。',
                   '-60018': 'MinerU 今日解析额度已用完，请明日重试。',
                   '-60009': 'MinerU 任务队列已满，请稍后重试。'}.get(str(code), 'MinerU 未能受理材料，请稍后重试。')
        raise ValueError(message)
    return value.get('data', {})


async def download(client, url, target):
    for _ in range(4):
        async with client.stream('GET', checked_url(url), timeout=60) as response:
            if response.is_redirect:
                url = response.headers.get('location', '')
                continue
            if not response.is_success:
                raise ValueError('MinerU 解析结果下载失败，请重新解析。')
            size = 0
            with target.open('wb') as stream:
                async for chunk in response.aiter_bytes():
                    size += len(chunk)
                    if size > MAX_ARCHIVE:
                        raise ValueError('解析结果过大，请减少材料页数。')
                    stream.write(chunk)
            return
    raise ValueError('MinerU 结果下载重定向过多。')


async def parse(job, canonical, *, model):
    token = os.getenv('MINERU_API_TOKEN', '').strip()
    if not token:
        raise ValueError('服务端尚未配置 MinerU Token。')
    # A separate header is used only for mineru.net, never for storage URLs.
    headers = {'Authorization': 'Bearer ' + token}
    timeout = httpx.Timeout(45, connect=15)
    try:
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=False) as client:
            allocated = require_success(await client.post(API + '/file-urls/batch', headers=headers,
                json={'files': [{'name': 'document.pdf', 'data_id': job.id}], 'model_version': model,
                      'enable_table': True, 'enable_formula': True, 'language': 'ch'}))
            upload_url = checked_url(allocated['file_urls'][0])
            async def body():
                with canonical.open('rb') as stream:
                    while chunk := stream.read(1024 * 1024):
                        yield chunk
            uploaded = await client.put(upload_url, content=body(), headers={'Content-Length': str(canonical.stat().st_size)})
            if not uploaded.is_success:
                raise ValueError('材料上传到 MinerU 失败，请重试。')
            report(job, 'recognize', 'MinerU 已接收材料，正在排队解析')
            deadline = time.monotonic() + 600
            while time.monotonic() < deadline:
                if job.status == 'cancelled':
                    raise asyncio.CancelledError()
                data = require_success(await client.get(API + '/extract-results/batch/' + allocated['batch_id'], headers=headers))
                rows = data.get('extract_result', [])
                if rows:
                    current = rows[0]
                    state = current.get('state')
                    if state == 'done':
                        target = job.directory / 'cloud-export.zip'
                        await download(client, current['full_zip_url'], target)
                        return target
                    if state == 'failed':
                        # Do not expose upstream error bodies, signed URLs or document content.
                        raise ValueError('MinerU 未能解析此材料，请检查文件是否损坏或加密后重试。')
                    progress = current.get('extract_progress') or {}
                    label = 'MinerU 正在识别文字与版面' if state == 'running' else 'MinerU 正在转换文档' if state == 'converting' else 'MinerU 正在排队解析'
                    detail = f"已识别 {progress.get('extracted_pages', 0)}/{progress['total_pages']} 页" if progress.get('total_pages') else ''
                    report(job, 'recognize', label, detail=detail)
                await asyncio.sleep(2)
        raise ValueError('MinerU 处理超过 10 分钟，请减少页数或稍后重试。')
    except (httpx.HTTPError, KeyError, TypeError, zipfile.BadZipFile):
        raise ValueError('MinerU 网络连接或响应异常，请稍后重试。') from None


def _box(value, width, height):
    if not isinstance(value, list) or len(value) != 4 or not all(isinstance(n, (int, float)) and math.isfinite(n) for n in value):
        return None
    box = [max(0., min(1., float(n) / size)) for n, size in zip(value, [width, height, width, height])]
    return box if box[0] < box[2] and box[1] < box[3] else None


def _spans(block):
    for line in block.get('lines', []):
        yield from line.get('spans', [])


def _text(block):
    return '\n'.join(''.join(str(span.get('content', '')) for span in line.get('spans', []) if span.get('content') is not None)
                     for line in block.get('lines', [])).strip()


def normalize_layout(layout):
    """Normalize point coordinates into Wenxi's source-grounded document schema."""
    pages, geometry = [], []
    for index, page in enumerate(layout.get('pdf_info', [])):
        size = page.get('page_size', [])
        if len(size) != 2 or not all(isinstance(n, (int, float)) and math.isfinite(n) and n > 0 for n in size):
            raise ValueError('云端解析结果缺少有效的页面尺寸。')
        width, height = size
        if page.get('page_idx', index) != index:
            raise ValueError('云端解析页码不完整，请重试。')
        output = []

        def visit(block):
            if block.get('sub_type') == 'seal' or block.get('type') == 'seal':
                box = _box(block.get('bbox'), width, height)
                if box:
                    # Keep the region even when hosted OCR provides no imprint text.
                    output.append({'index': len(output), 'type': 'image', 'sub_type': 'seal',
                                   'bbox': box, 'content': _text(block)})
                return
            # Image/table containers can hold body blocks and captions.
            if block.get('blocks'):
                for child in block['blocks']:
                    visit(child)
                return
            box = _box(block.get('bbox'), width, height)
            if not box:
                return
            html = next((span.get('html') or span.get('content', '') for span in _spans(block)
                         if span.get('type') == 'table' and (span.get('html') or span.get('content'))), '')
            text = html or _text(block)
            if not text:
                return
            kind = 'table' if html else block.get('type', 'text')
            if not html:
                # Layout paragraph boxes can include a full row separator. OCR span
                # boxes locate the actual label/value, as the local OCR path does.
                pieces = []
                valid = True
                for line in block.get('lines', []):
                    current = None
                    for span in line.get('spans', []):
                        value = str(span.get('content') or '')
                        if not value:
                            continue
                        bounds = _box(span.get('bbox'), width, height)
                        if not bounds:
                            valid = False
                            break
                        gap = bounds[0] - current['bbox'][2] if current else 0
                        if current and gap <= max(8/width, (bounds[3]-bounds[1])*height/width*.8):
                            current['content'] += value
                            current['bbox'] = [min(current['bbox'][0], bounds[0]), min(current['bbox'][1], bounds[1]),
                                               max(current['bbox'][2], bounds[2]), max(current['bbox'][3], bounds[3])]
                        else:
                            current = {'bbox': bounds, 'content': value}
                            pieces.append(current)
                    if not valid:
                        break
                if valid and pieces:
                    for piece in pieces:
                        output.append({'index': len(output), 'type': kind, **piece})
                    return
            output.append({'index': len(output), 'type': kind, 'bbox': box, 'content': [{'content': html}] if html else text})

        for block in page.get('preproc_blocks', page.get('para_blocks', [])):
            visit(block)
        pages.append({'page_idx': index, 'blocks': output})
        geometry.append({'page_idx': index, 'width_pt': width, 'height_pt': height})
    if not pages:
        raise ValueError('云端解析结果没有有效页面。')
    return {'schema': 'docvortex.middle', 'schema_version': '2.0', 'is_full_document': True,
            'pages': pages, 'metadata': {'producer': {'version': str(layout.get('_version_name', 'cloud'))}},
            'extensions': {'docvortex_layout': {'pages': geometry}, 'mineru': {'tier': 'cloud'}}}


def unpack(archive, directory):
    directory.mkdir(exist_ok=True)
    with zipfile.ZipFile(archive) as package:
        entries = package.infolist()
        if len(entries) > 2500 or sum(item.file_size for item in entries) > full_text.MAX_EXPORT:
            raise ValueError('解析结果过大，请减少页数。')
        paths = {item.filename: item for item in entries if not item.is_dir()}
        if len(paths) != sum(not item.is_dir() for item in entries):
            raise ValueError('云端解析结果包含重复文件。')
        for name in paths:
            if name.startswith('/') or '..' in PurePosixPath(name).parts or '\\' in name:
                raise ValueError('云端解析结果包含无效路径。')
        def unique(basename):
            matches = [name for name in paths if PurePosixPath(name).name == basename]
            if len(matches) != 1:
                raise ValueError('云端解析结果不完整，请重试。')
            return matches[0]
        layout_name, markdown_name = unique('layout.json'), unique('full.md')
        if paths[layout_name].file_size > MAX_JSON or paths[markdown_name].file_size > full_text.MAX_MARKDOWN:
            raise ValueError('云端解析文本过大，请减少页数。')
        data = normalize_layout(json.loads(package.read(layout_name)))
        (directory / 'markdown.md').write_bytes(package.read(markdown_name))
        for name in paths:
            parts = PurePosixPath(name).parts
            relative = '/'.join(parts[parts.index('images'):]) if 'images' in parts else ''
            if relative and full_text.ASSET.fullmatch(relative) and not relative.endswith('.svg'):
                target = directory / relative
                target.parent.mkdir(exist_ok=True)
                target.write_bytes(package.read(name))
    with zipfile.ZipFile(directory / 'document.zip', 'w', zipfile.ZIP_DEFLATED) as package:
        package.write(directory / 'markdown.md', 'document.md')
        for asset in sorted((directory / 'images').glob('*')):
            package.write(asset, 'images/' + asset.name)
    return data
