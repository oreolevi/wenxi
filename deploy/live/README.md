# 文析云端接入

网页与业务后端运行在轻量服务器；文档识别调用 MinerU 官方托管 API，语义提取与配置助手调用 DeepSeek。服务器使用轻量 CPU 模型进行页面方向判断及印章区域的专用 OCR，不运行整份文档 OCR 或大模型。

页面预处理与本机共用转正、倾斜校正及坐标映射流程。云端使用固定版本的约 6.8 MB 页面方向分类模型，CPU 单线程运行；保存上传原图与处理后页面，将校正后的 PDF 交给 MinerU。方向判断不确定时保持原图并标记待核对，固定版式提取会阻止使用不确定的页面。

文析字段提取时，已定位的印章区域可调用同一 MinerU 引擎的专用 CPU OCR，三份权重共约 27.7 MB，包含局部正文补识别的轻量检测模型；无需新增云端识别账户。工作进程单线程、限制区域数量与时长，完成后释放。模型准备、依赖边界、哈希及验证记录见 [印章文字识别接入](../../docs/development/seal-recognition.md)。专项 OCR 按需求启用，缺失字段最多补识别一轮、两个区域和六个字段，基础解析不变。共享服务器发布前须单独验证容量；`WENXI_SEAL_OCR=off` 可保留区域而关闭专用印文识别，普通局部文字补识别仍可使用。

固定规则保留原有发布版本。校正新增留白时，依据至少三个静态标题或字段标签校准区域；位置无法可靠对应时返回待核对，不猜测取值。云端 OCR 优先使用实际文字区域的坐标，避免用段落或整行边框代替字段位置。

## 运行版本

- 站点：`https://wx.tracex.fun`
- 容器：`wenxi-live-web`，只在 Docker 网络内开放 8080。
- 数据：`/opt/wenxi-live/data`，保存服务、场景、历史记录和统计。
- 密钥：`/opt/wenxi-live/app/.env.production`，权限 600，不进入代码、镜像或网页。
- Caddy：`/opt/trace/app/deploy/Caddyfile`，仅文析域名转发到 `wenxi-live-web:8080`。
- 应用限制：PDF / 图片，每份 30 MB、50 页；字段要求支持 Excel。普通文析输出字段与 Markdown，Studio 支持固定规则、AI 辅助配置及场景组合。

## 配置

参考 `.env.example` 填写服务端环境变量。`MINERU_API_TOKEN` 是 MinerU API Token；`DEEPSEEK_API_KEY` 是 DeepSeek API Key，两者互不通用。

`WENXI_ACCESS_USER` 与 `WENXI_ACCESS_PASSWORD` 是本站访问凭证。网页及业务 API 统一使用 HTTPS Basic 验证，公开健康检查 `/healthz` 不返回配置。

分享站点或带 `?page=...` 的工作台链接时，允许从其他网站跳转打开首页，仍需账户登录；跨站接口请求和嵌入访问继续拦截。

本版使用共享试用账户，尚未实现个人账户、角色权限及租户数据隔离。多人正式使用前需接入统一身份认证；共享账号下的服务、场景及服务端历史是共享数据。

上传的 PDF / 图片由 MinerU 处理，识别文本及字段要求由 DeepSeek 处理。解析结果自动保存到历史记录；临时识别任务过期或容器重启后清理。用于验收和预置的材料必须为虚构数据。

## 构建与启动

先在 `document-extraction-ui` 执行 `npm ci` 和 `npm run build:live`。`dist-live/index.html` 为线上构建，不覆盖本机版，也不启用 Mock 拦截。

构建上下文必须使用白名单：

```text
Dockerfile                  ← deploy/live/Dockerfile
requirements.txt            ← deploy/live/requirements.txt
seal-runtime.txt            ← deploy/live/seal-runtime.txt（仅 --no-deps 安装）
public/index.html           ← document-extraction-ui/dist-live/index.html
mineru-local/service/*.py    ← 排除 test_* 与 smoke_*
mineru-local/deepseek/deepseek-client.mjs
mineru-local/deepseek/extract-worker.mjs
models/document-orientation.onnx  ← 经哈希校验的方向模型，见 models/README.md
models/seal/seal_PP-OCRv4_det_infer.onnx  ← 经哈希校验的专用印章文字检测模型
models/seal/ch_PP-OCRv6_tiny_det_infer.onnx ← 经哈希校验的局部正文检测模型
models/seal/ch_PP-OCRv6_small_rec_infer.onnx ← 经哈希校验的共享文字识别模型
models/README.md
models/LICENSE
```

不得复制本机 `.runtime`、`.env.local`、真实业务样本或历史记录。只将上述上下文传到服务器的独立发布目录。

三份区域 OCR 权重在构建前运行 `prepare-seal-models.py` 下载并校验，按上表复制指定文件；不要复制完整本机模型目录。`seal-runtime.txt` 的两个包使用 `--no-deps` 安装，轻量依赖在 `requirements.txt` 中明确列出，避免引入完整解析器和 VLM 运行栈。Dockerfile 在构建阶段生成紧凑识别图；保留这一步，以降低首笔印文识别时的内存压力。

```sh
docker build -t wenxi-live:RELEASE BUILD_CONTEXT
APP_RELEASE=RELEASE docker compose -f compose.yml config --quiet
APP_RELEASE=RELEASE docker compose -f compose.yml up -d --wait
```

默认从官方 Node 24 基础镜像构建。网络较慢时，可通过 `APT_MIRROR`、`PIP_INDEX_URL` 选择镜像源；Debian 包继续校验官方签名。`NODE_BASE` 可指定已缓存的同版本可信基础镜像。

首次切换需先验证新容器的业务链路，再修改文析域名的 upstream；Caddy 配置先校验后热加载，保留原配置。后续更新保持同一容器名和数据卷，无需修改其他产品的代理。

## 调用

Studio「接口与版本」提供固定版本调用示例。在调用环境设置 `WENXI_USER` 和 `WENXI_PASSWORD` 后使用；服务 ID、版本号取自页面。不要将本站密码放到对外发布的前端代码中。

```sh
curl --fail-with-body -u "$WENXI_USER:$WENXI_PASSWORD" \
  'https://wx.tracex.fun/api/health'

curl --fail-with-body -u "$WENXI_USER:$WENXI_PASSWORD" \
  'https://wx.tracex.fun/api/extraction-profiles/SERVICE_ID/execute' \
  -F 'version=1.0.0' \
  -F 'file=@fictional-sample.pdf'
```

普通文析：MinerU 识别 → DeepSeek 提取 → 后端核对原文依据。Studio 固定规则：有可靠文字层的 PDF 直接读文字；扫描件由 MinerU `pipeline` 识别，然后按已发布规则提取，运行时不调用 DeepSeek。配置助手生成规则会调用 DeepSeek，结果需确认后应用。

## 验收与回退

发布前后验证：匿名业务请求返回 401；登录后上传虚构扫描件，核对跨页字段、高亮与 Markdown；保存并恢复历史记录；测试 Studio 服务发布、固定版本调用及整包场景。检查同机其他产品健康状态。

当前保留旧静态演示镜像与容器 `wenxi-demo-web`。应用版本回退时，使用上一个已验证的 `APP_RELEASE` 重新启动相同 Compose；数据卷继续保留。应急切回纯演示站时，只将文析域名 upstream 改回 `wenxi-demo-web:8080`，校验后热加载 Caddy，不删除真实后端数据。

密钥更新后使用 `docker compose up -d --force-recreate` 重新载入环境。排错只记录任务 ID、错误阶段、耗时及用量，禁止输出密钥、原文或模型请求正文。
