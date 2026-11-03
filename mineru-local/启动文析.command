#!/bin/sh
set -eu
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
project_root=$(CDPATH= cd -- "$script_dir/.." && pwd)
export MINERU_HOME="$project_root/.runtime/mineru-data"
export HF_HOME="$MINERU_HOME/cache/huggingface"
export MODELSCOPE_CACHE="$MINERU_HOME/cache/modelscope"
export MINERU_MODEL_SOURCE=local
export GRADIO_ANALYTICS_ENABLED=false
export NO_PROXY="${NO_PROXY:+$NO_PROXY,}localhost,127.0.0.1,::1"
export no_proxy="$NO_PROXY"
printf '%s\n' '文析试用地址：http://127.0.0.1:8768' '在此窗口按 Control+C 停止服务并清理本次暂存材料。'
exec "$project_root/.runtime/mineru-venv/bin/python" -m uvicorn service.app:app \
  --app-dir "$script_dir" --host 127.0.0.1 --port 8768 --no-access-log
