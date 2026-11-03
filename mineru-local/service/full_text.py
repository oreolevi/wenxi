"""Persist native MinerU Markdown and its image assets without another model call."""
from pathlib import Path, PurePosixPath
import re
import zipfile

MAX_EXPORT = 100 * 1024 * 1024
MAX_MARKDOWN = 8 * 1024 * 1024
ASSET = re.compile(r'^images/[A-Za-z0-9_.-]+\.(?:png|jpe?g|webp|gif|svg)$', re.I)


def unpack_export(archive: Path, directory: Path):
    directory.mkdir(exist_ok=True)
    with zipfile.ZipFile(archive) as package:
        entries = package.infolist()
        if len(entries) > 2500 or sum(item.file_size for item in entries) > MAX_EXPORT:
            raise ValueError('全文转换结果过大，请减少页数后重试。')
        names = [item.filename for item in entries]
        if len(names) != len(set(names)) or 'middle_json.json' not in names or 'markdown.md' not in names:
            raise ValueError('全文转换结果不完整，请重试。')
        for item in entries:
            if item.is_dir():
                continue
            name = item.filename
            if name == 'middle_json.json':
                if item.file_size > 25 * 1024 * 1024:
                    raise ValueError('解析结果过大，请缩小文档范围后重试。')
                (directory.parent / 'middle.json').write_bytes(package.read(item))
            elif name == 'markdown.md' or ASSET.fullmatch(name):
                if name == 'markdown.md' and item.file_size > MAX_MARKDOWN:
                    raise ValueError('全文过大，请减少页数后重试。')
                target = directory / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(package.read(item))
    # Only the user-facing Markdown and its assets go into the download package.
    with zipfile.ZipFile(directory / 'document.zip', 'w', zipfile.ZIP_DEFLATED) as package:
        package.write(directory / 'markdown.md', 'document.md')
        for asset in sorted((directory / 'images').glob('*')):
            if asset.is_file() and ASSET.fullmatch(asset.relative_to(directory).as_posix()):
                package.write(asset, asset.relative_to(directory).as_posix())


def descriptor(directory: Path, base: str, pages: int):
    if not (directory / 'markdown.md').is_file():
        return None
    return {'url': base, 'downloadUrl': base + '/markdown.md', 'packageUrl': base + '/document.zip',
            'pageCount': pages, 'imageCount': len(list((directory / 'images').glob('*')))}


def content(directory: Path, base: str):
    markdown = asset_path(directory, 'markdown.md').read_text(encoding='utf-8')
    return {'markdown': markdown, 'assetBaseUrl': base + '/', 'engine': 'MinerU'}


def asset_path(directory: Path, name: str):
    if name not in {'markdown.md', 'document.zip'} and not ASSET.fullmatch(name):
        raise FileNotFoundError('全文文件不存在。')
    if any(part in {'..', '.'} for part in PurePosixPath(name).parts):
        raise FileNotFoundError('全文文件不存在。')
    path = directory / name
    if not path.is_file():
        raise FileNotFoundError('全文尚未生成，请重新解析原文。')
    return path
