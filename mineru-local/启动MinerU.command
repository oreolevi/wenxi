#!/bin/sh
set -eu
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
printf '%s\n' 'MinerU 本地工具：http://127.0.0.1:7860' '处理完成后，在这个终端窗口按 Control+C 停止服务。'
exec "$script_dir/mineru" webui --server-name 127.0.0.1 --server-port 7860 \
  --tier standard --api-server-concurrency 1 --no-enable-example \
  --output-dir "$script_dir/output/webui"
