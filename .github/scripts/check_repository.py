"""Check tracked files only; never print potential credential contents."""
from pathlib import Path
import re
import subprocess
import sys

root = Path(__file__).resolve().parents[2]
files = subprocess.check_output(['git', 'ls-files', '-z'], cwd=root).split(b'\0')
blocked_dirs = {'.runtime', '.venv', 'venv', 'node_modules', '__pycache__', 'output', 'tmp', 'dist', 'dist-live', 'dist-demo'}
blocked_types = {'.sqlite', '.sqlite3', '.db', '.onnx', '.gguf', '.pt', '.pth', '.safetensors', '.pem', '.key', '.p12', '.pfx', '.kdbx', '.zip', '.xlsx', '.xls', '.csv', '.pdf', '.docx'}
fixtures = {'mineru-local/testdata/fictional-application-text.pdf', 'mineru-local/testdata/fictional-application-scan.pdf'}
patterns = [re.compile(r'sk-[A-Za-z0-9_-]{24,}'), re.compile(r'gh[pousr]_[A-Za-z0-9]{20,}'),
            re.compile(r'github_pat_[A-Za-z0-9_]{30,}'), re.compile(r'AKIA[A-Z0-9]{16}'),
            re.compile(r'-----BEGIN [A-Z ]*PRIVATE KEY-----')]
errors = []
for raw in files:
    if not raw:
        continue
    name = raw.decode('utf-8')
    path = Path(name)
    full = root / path
    if blocked_dirs.intersection(path.parts) or (path.name.startswith('.env') and path.name != '.env.example'):
        errors.append(f'不应提交运行目录或环境文件：{name}')
    if path.suffix.lower() in blocked_types and name not in fixtures:
        errors.append(f'不应提交数据、权重或证书：{name}')
    if full.is_symlink():
        errors.append(f'请使用明确的项目文件，勿提交符号链接：{name}')
        continue
    if not full.is_file():
        errors.append(f'已跟踪文件不存在：{name}')
        continue
    try:
        text = full.read_text(encoding='utf-8')
    except UnicodeError:
        continue
    for line, value in enumerate(text.splitlines(), 1):
        if any(pattern.search(value) for pattern in patterns):
            errors.append(f'发现疑似凭证，请在本机检查：{name}:{line}')
if errors:
    print('\n'.join(errors), file=sys.stderr)
    sys.exit(1)
print(f'仓库文件检查通过：{sum(bool(name) for name in files)} 个文件；未发现受限文件或疑似凭证。')
