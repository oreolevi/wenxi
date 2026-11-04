ARG NODE_BASE=node:24-bookworm-slim
FROM ${NODE_BASE}
USER root
ARG APT_MIRROR=deb.debian.org
ARG PIP_INDEX_URL=https://pypi.org/simple
RUN sed -i "s|http://deb.debian.org|http://${APT_MIRROR}|g" /etc/apt/sources.list.d/debian.sources \
    && apt-get -o Acquire::Retries=2 -o Acquire::https::Timeout=30 update \
    && apt-get -o Acquire::Retries=2 -o Acquire::https::Timeout=30 install -y --no-install-recommends python3 python3-venv ca-certificates libstdc++6 libglib2.0-0 libgomp1 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt ./requirements.txt
COPY seal-runtime.txt ./seal-runtime.txt
RUN python3 -m venv /opt/venv && /opt/venv/bin/pip install --only-binary=:all: --no-cache-dir -r requirements.txt \
    && /opt/venv/bin/pip install --no-deps --only-binary=:all: --no-cache-dir -r seal-runtime.txt \
    && useradd --uid 10001 --create-home wenxi \
    && mkdir /app/.runtime && chown wenxi:wenxi /app/.runtime
COPY --chown=wenxi:wenxi mineru-local/ ./mineru-local/
COPY --chown=wenxi:wenxi public/ ./public/
COPY --chown=wenxi:wenxi models/ ./models/
USER wenxi
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 WENXI_RECOGNITION_BACKEND=mineru-cloud \
    WENXI_UI_FILE=/app/public/index.html WENXI_SEAL_MODEL_DIR=/app/models/seal TZ=Asia/Shanghai OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 PATH=/opt/venv/bin:$PATH
RUN python ./mineru-local/service/seal_worker.py --prepare-cache /app/models/seal
EXPOSE 8080
CMD ["python", "-m", "uvicorn", "service.app:app", "--app-dir", "/app/mineru-local", "--host", "0.0.0.0", "--port", "8080", "--workers", "1", "--no-access-log"]
