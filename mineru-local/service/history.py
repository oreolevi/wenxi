"""Durable local task snapshots and immutable source previews, separate from temporary jobs."""
from copy import deepcopy
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import shutil
import threading
import uuid

from . import full_text

ROOT = Path(__file__).resolve().parents[2] / '.runtime' / 'wenxi-history'
LOCK = threading.RLock()
HEX_ID = re.compile(r'^[0-9a-f]{32}$')
FILE_ID = re.compile(r'^[A-Za-z0-9_-]{1,100}$')


def directory(record_id):
    if not HEX_ID.fullmatch(record_id):
        raise ValueError('历史记录编号无效。')
    return ROOT / record_id


def read(record_id):
    with LOCK:
        path = directory(record_id) / 'record.json'
        if not path.is_file():
            raise FileNotFoundError('历史记录不存在。')
        return json.loads(path.read_text(encoding='utf-8'))


def listing():
    with LOCK:
        result = []
        if not ROOT.exists():
            return result
        for path in ROOT.glob('*/record.json'):
            record = json.loads(path.read_text(encoding='utf-8'))
            files = []
            for material in record['snapshot']['files']:
                if material['kind'] == 'spreadsheet':
                    continue
                fields = [{key: field.get(key) for key in ('status', 'validationStatus', 'kind')} for field in material.get('results') or []]
                files.append({**{key: material.get(key) for key in ('id', 'name', 'kind', 'size', 'processed', 'error', 'outputMode')},
                              'results': fields, 'parsed': {key: (material.get('parsed') or {}).get(key) for key in ('modelCall', 'fullText')}, 'fullText': bool(material.get('fullText'))})
            result.append({'id': record['id'], 'createdAt': record['createdAt'], 'updatedAt': record['updatedAt'], 'files': files})
        return sorted(result, key=lambda item: item['updatedAt'], reverse=True)


def save(record_id, snapshot, jobs):
    with LOCK:
        target = directory(record_id)
        if not isinstance(snapshot, dict) or not isinstance(snapshot.get('files'), list) or not 1 <= len(snapshot['files']) <= 6:
            raise ValueError('历史记录材料结构无效。')
        if len(json.dumps(snapshot, ensure_ascii=False).encode()) > 8 * 1024 * 1024:
            raise ValueError('历史记录内容过大。')
        snapshot = deepcopy(snapshot)
        if not isinstance(snapshot.get('messages'), list) or not isinstance(snapshot.get('draft', ''), str):
            raise ValueError('历史记录对话结构无效。')
        files = snapshot['files']
        if not all(isinstance(file, dict) and isinstance(file.get('id'), str) and FILE_ID.fullmatch(file['id']) and isinstance(file.get('name'), str)
                   and file.get('kind') in {'pdf', 'image', 'text', 'demo', 'spreadsheet'} for file in files):
            raise ValueError('历史记录材料格式无效。')
        if len({file['id'] for file in files}) != len(files):
            raise ValueError('历史记录存在重复材料。')
        if not any(file.get('processed') or file.get('error') for file in files):
            raise ValueError('尚无可保存的提取结果。')
        ROOT.mkdir(parents=True, exist_ok=True, mode=0o700)
        target.mkdir(exist_ok=True, mode=0o700)
        try:
            previous = read(record_id)
        except FileNotFoundError:
            previous = None
        assets = {}
        for material in files:
            # Browser object URLs and File objects cannot survive a closed tab.
            material.pop('url', None)
            material.pop('sourceFile', None)
            material.pop('sourceUrl', None)
            if material['kind'] not in {'pdf', 'image'}:
                continue
            document = material.get('parsed')
            if not isinstance(document, dict) and not material.get('error'):
                raise ValueError('原文尚未准备完成，暂不能保存历史。')
            document_id = (document or {}).get('id') or material.get('taskId', '')
            pages = (document or {}).get('pages', [])
            if not isinstance(pages, list):
                raise ValueError('原文页面结构无效。')
            if not isinstance(document_id, str) or not HEX_ID.fullmatch(document_id):
                if material.get('error') and not document:
                    continue  # Upload failures have a record but no server-side original.
                raise ValueError('原文编号无效。')
            existing = (previous or {}).get('assets', {}).get(material['id'])
            if existing and existing['documentId'] == document_id:
                asset = existing
            else:
                job = jobs.get(document_id)
                if not job and material.get('error') and not document:
                    continue
                if not job or (not job.document and not material.get('error')):
                    raise ValueError('原文暂存已失效，无法保存完整历史；当前页面内容仍保留。')
                folder = uuid.uuid4().hex
                staged = target / ('pending-' + folder)
                staged.mkdir(mode=0o700)
                try:
                    shutil.copy2(job.directory / ('input' + job.suffix), staged / ('source' + job.suffix))
                    for page in pages:
                        number = page.get('number')
                        if type(number) is not int or not 1 <= number <= 50:
                            raise ValueError('原文页码无效。')
                        shutil.copy2(job.directory / f'page-{number}.png', staged / f'page-{number}.png')
                        if page.get('originalImageUrl'):
                            shutil.copy2(job.directory / f'original-{number}.png', staged / f'original-{number}.png')
                    if (job.directory / 'fulltext' / 'markdown.md').is_file():
                        shutil.copytree(job.directory / 'fulltext', staged / 'fulltext')
                    staged.rename(target / folder)
                finally:
                    if staged.exists():
                        shutil.rmtree(staged)
                asset = {'folder': folder, 'documentId': document_id, 'suffix': job.suffix,
                         'pages': [page['number'] for page in pages],
                         'originalPages': [page['number'] for page in pages if page.get('originalImageUrl')]}
            assets[material['id']] = asset
            base = f'/api/history/{record_id}/files/{material["id"]}'
            material['sourceUrl'] = base + '/source'
            material['url'] = material['sourceUrl']
            if not document:
                continue
            document['historyId'] = record_id
            if (target / asset['folder'] / 'fulltext' / 'markdown.md').is_file():
                document['fullText'] = full_text.descriptor(target / asset['folder'] / 'fulltext', f'/api/history/{record_id}/fulltext/{material["id"]}', len(pages))
                document['fullText']['downloadUrl'] = base + '/fulltext/markdown.md'
                document['fullText']['packageUrl'] = base + '/fulltext/document.zip'
            else:
                document.pop('fullText', None)
            for page in pages:
                page['imageUrl'] = base + f'/page-{page["number"]}.png'
                if page.get('originalImageUrl'):
                    page['originalImageUrl'] = base + f'/original-{page["number"]}.png'
        now = datetime.now(timezone.utc).isoformat()
        record = {'id': record_id, 'createdAt': previous['createdAt'] if previous else now,
                  'updatedAt': now, 'snapshot': snapshot, 'assets': assets}
        temporary = target / ('record-' + uuid.uuid4().hex + '.tmp')
        try:
            temporary.write_text(json.dumps(record, ensure_ascii=False), encoding='utf-8')
            temporary.chmod(0o600)
            temporary.replace(target / 'record.json')
        finally:
            temporary.unlink(missing_ok=True)
        return {key: record[key] for key in ('id', 'createdAt', 'updatedAt')}


def snapshot(record_id):
    record = read(record_id)
    return {key: record[key] for key in ('id', 'createdAt', 'updatedAt', 'snapshot')}


def asset_path(record_id, material_id, filename):
    record = read(record_id)
    asset = record['assets'].get(material_id)
    if not asset:
        raise FileNotFoundError('历史原文不存在。')
    if filename.startswith('fulltext/'):
        return full_text.asset_path(directory(record_id) / asset['folder'] / 'fulltext', filename[len('fulltext/'):])
    if filename == 'source':
        name = 'source' + asset['suffix']
    elif filename in {f'page-{number}.png' for number in asset['pages']}:
        name = filename
    elif filename in {f'original-{number}.png' for number in asset.get('originalPages', [])}:
        name = filename
    else:
        raise FileNotFoundError('历史原文页不存在。')
    path = directory(record_id) / asset['folder'] / name
    if not path.is_file():
        raise FileNotFoundError('历史原文文件不存在。')
    return path
