#!/bin/sh
set -eu
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
project_root=$(CDPATH= cd -- "$script_dir/.." && pwd)
exec "$project_root/.runtime/mineru-venv/bin/python" - "$project_root/.runtime/wenxi-service.pid" "$script_dir" <<'PY'
from pathlib import Path
import os, signal, subprocess, sys
path = Path(sys.argv[1])
if not path.exists():
    print('文析服务当前未运行。')
    raise SystemExit(0)
pid = int(path.read_text().strip())
command = subprocess.run(['ps', '-p', str(pid), '-o', 'command='], capture_output=True, text=True).stdout
if 'uvicorn service.app:app' not in command or sys.argv[2] not in command:
    print('记录的进程已失效，未停止其他程序。')
    raise SystemExit(0)
os.kill(pid, signal.SIGTERM)
print('已通知文析服务停止，并清理本次暂存材料。')
PY
