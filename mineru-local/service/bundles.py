"""Bounded in-memory archive intake. Members are never extracted to user paths."""
from io import BytesIO
from pathlib import PurePosixPath
from stat import S_ISLNK
from zipfile import ZipFile, BadZipFile

ALLOWED = {'.pdf', '.png', '.jpg', '.jpeg', '.webp'}
MAX_FILE = 30 * 1024 * 1024
MAX_TOTAL = 100 * 1024 * 1024
MAX_FILES = 20


def unpack(files):
    entries, failures, total = [], [], 0
    if not 1 <= len(files) <= MAX_FILES:
        raise ValueError('每次请选择 1 到 20 个文件或一个 ZIP 材料包。')
    for filename, data in files:
        if not data or len(data) > MAX_FILE:
            raise ValueError('每个上传文件应非空且不超过 30 MB。')
        suffix = PurePosixPath(filename).suffix.lower()
        if suffix != '.zip':
            if suffix not in ALLOWED:
                failures.append({'name': filename, 'error': '此材料格式暂不支持，请提供 PDF 或图片。'})
                continue
            total += len(data); entries.append((PurePosixPath(filename).name, data))
        else:
            try:
                with ZipFile(BytesIO(data)) as archive:
                    members = archive.infolist()
                    if len(members) > 500:
                        raise ValueError('ZIP 中的文件过多，请减少材料。')
                    for member in members:
                        name = member.filename.replace('\\', '/')
                        path = PurePosixPath(name)
                        if path.is_absolute() or '..' in path.parts or ':' in name or S_ISLNK(member.external_attr >> 16):
                            raise ValueError('ZIP 包含无效路径或链接，请重新打包普通文件。')
                        if member.is_dir() or any(part.startswith('.') or part == '__MACOSX' for part in path.parts):
                            continue
                        if member.flag_bits & 1:
                            raise ValueError('暂不支持加密 ZIP，请先解密。')
                        if member.file_size > MAX_FILE or member.file_size > max(member.compress_size, 1) * 300:
                            raise ValueError('ZIP 中单个文件过大或压缩比例异常，请减少材料。')
                        total += member.file_size
                        if total > MAX_TOTAL:
                            raise ValueError('展开后的材料总大小不能超过 100 MB。')
                        if path.suffix.lower() not in ALLOWED:
                            failures.append({'name': name, 'error': '此文件未识别，仅支持 PDF 或图片；字段 Excel 请单独导入。'})
                            continue
                        if len(entries) >= MAX_FILES:
                            raise ValueError('一个材料包最多处理 20 份 PDF 或图片。')
                        content = archive.read(member)
                        if len(content) != member.file_size:
                            raise ValueError('ZIP 文件不完整，请重新打包。')
                        entries.append((name, content))
            except (BadZipFile, RuntimeError, NotImplementedError) as exc:
                raise ValueError('无法读取 ZIP，请检查是否完整、未加密且使用常规压缩格式。') from exc
        if total > MAX_TOTAL or len(entries) > MAX_FILES:
            raise ValueError('每批最多 20 份材料，展开后总大小不超过 100 MB。')
    if not entries:
        raise ValueError('没有可识别的 PDF 或图片材料。')
    return entries, failures
