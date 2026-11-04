# DeepSeek 接入交接说明

核对日期：2026-11-04。适用于当前文析项目，按源码版本 `10506e5` 整理；后续调整模型、限额或部署方式时同步维护本文。

## 1. 接入概况

文析由服务端调用 DeepSeek 官方 Chat Completions API。前端上传材料或提交配置需求，FastAPI 组织识别文本与业务规则，通过 Node.js 子进程发起模型请求，再由后端校验结果。当前封装使用原生 `fetch`，没有引入 OpenAI SDK 或 DeepSeek SDK。

- 接口：`POST https://api.deepseek.com/chat/completions`。
- 鉴权：服务端请求头 `Authorization: Bearer <DEEPSEEK_API_KEY>`。
- 当前默认模型：`deepseek-v4-pro`；实际值由服务端 `DEEPSEEK_MODEL` 决定。
- 当前工作模式：关闭思考、非流式返回、要求 JSON 对象。
- 推荐运行环境：Node.js 24、Python 3.11。完整项目环境见[根目录 README](../../README.md)。

请求字段与模型参数以 [DeepSeek 官方 Chat Completions 文档](https://api-docs.deepseek.com/api/create-chat-completion/) 为准。本文的输入、输出限制是**项目自身的限制**，不能当作模型官方上下文上限。

MinerU 负责 OCR、版面与表格识别；DeepSeek 负责识别文本的语义提取和配置建议。两个服务使用各自的密钥。当前 DeepSeek 封装只接受 `system`、`user`、`assistant` 三种角色以及字符串 `content`；图片输入、文件上传、工具调用和 Responses API 尚未接入该封装。

## 2. 哪些操作会调用模型

- **文析字段提取**：识别完成后，将真实文字块、提取要求及 Excel 字段规则发送给 DeepSeek。对已识别材料追加或重新提取时可复用 OCR，但会产生新的模型请求。
- **Studio 生成字段规则**：根据样例和需求生成规则建议，由后端检查引用并生成定位信息。
- **Studio 配置助手**：根据当前字段、选中字段及对话历史提出新增、修改或移除建议，用户确认后应用。
- **AI 辅助创建场景**：需求规划调用一次模型；确认创建后的字段定位还可能逐版式调用模型，不能按一次点击估算为一次调用。

以下流程不调用 DeepSeek：只做全文 Markdown 转换、人工配置和确认、固定规则测试，以及已发布固定服务或场景的规则执行。它们仍可能使用 MinerU。纯前端演示版使用虚构数据，也不调用真实模型。

## 3. 配置与密钥管理

### 3.1 本机配置

首次配置可从空白示例创建文件；已有配置时直接编辑原文件，避免覆盖其他设置：

```sh
cp -n mineru-local/.env.example mineru-local/.env.local
chmod 600 mineru-local/.env.local
```

在 `mineru-local/.env.local` 填写：

```dotenv
DEEPSEEK_API_KEY=
DEEPSEEK_MODEL=deepseek-v4-pro
WENXI_EXTRACTOR=deepseek
```

`DEEPSEEK_API_KEY` 由项目负责人单独提供，填写在本机文件中。`WENXI_EXTRACTOR=label-match` 会关闭语义提取；密钥为空时也不会启用 DeepSeek。设置为 `deepseek` 且密钥非空，是当前启用条件。

`semantic.py` 在导入时读取本机文件，并通过 `os.environ.setdefault()` 注入配置：**进程已有环境变量优先于文件**。Node.js 子进程继承后端的环境变量。修改本机文件后，需要在没有活动任务时重新启动后端，文件变化不会自动重载。

```sh
sh mineru-local/启动文析.command
```

不要在已有服务运行时重复执行启动命令。重启前确认没有识别或配置助手请求进行中；重启会清理临时任务，持久化历史与配置另行保留。

### 3.2 公网配置

- 站点：[文析工作台](https://wx.tracex.fun/)。
- 容器：`wenxi-live-web`。
- 配置文件：`/opt/wenxi-live/app/.env.production`，由 Compose 的 `env_file` 注入，权限为 `600`。
- 本机文件与公网环境文件独立管理，不会随 Git 同步。

公网使用相同的三个 DeepSeek 变量；其他 MinerU、站点地址和访问凭证继续按[云端部署说明](../../deploy/live/README.md)配置。更新环境文件后，需重新创建容器来加载新值，单纯 `docker restart` 不会重新读取 Compose 的环境文件。

以下维护命令仅在服务器上、确认没有活动任务并保留原配置后执行：

```sh
cd /opt/wenxi-live/app
chmod 600 .env.production
APP_RELEASE="$(cat current-release)" docker compose -f compose.yml config --quiet
APP_RELEASE="$(cat current-release)" docker compose -f compose.yml up -d --force-recreate --wait
```

**凭证用途必须区分：**

- `DEEPSEEK_API_KEY`：后端向 DeepSeek 鉴权。
- `MINERU_API_TOKEN`：后端向 MinerU 鉴权。
- `WENXI_ACCESS_USER` / `WENXI_ACCESS_PASSWORD`：公网文析站点的 HTTPS Basic 访问凭证。

前端只能调用文析后端，不持有模型密钥。不要给密钥添加 `VITE_`、`NEXT_PUBLIC_` 等前端公开前缀，也不要放进源码、镜像、网址、Issue 或日志。密钥交接通过独立的受控渠道进行，本文不包含真实密钥和网站密码。

## 4. 调用链路与代码入口

普通文析链路：浏览器提交材料 → FastAPI 调度 OCR → Python 组织模型上下文 → Node.js 调用 DeepSeek → Python 校验原文依据 → 前端展示结果。

主要维护位置：

- [deepseek-client.mjs](../../mineru-local/deepseek/deepseek-client.mjs)：HTTP 请求、JSON 解析、超时、取消与错误分类。API 地址目前直接写在这里，没有可配置的 Base URL；增加企业代理网关需明确修改该文件。
- [extract-worker.mjs](../../mineru-local/deepseek/extract-worker.mjs)：子进程桥接，读取标准输入中的 `messages`，通过标准输出返回结果或经过筛选的错误。
- [semantic.py](../../mineru-local/service/semantic.py)：本机配置加载、字段分批、提示词与文字块组织、调用汇总及用量日志。
- [grounding.py](../../mineru-local/service/grounding.py)：校验字段结构、真实引用、逐字原文及对应位置。
- [rule_generation.py](../../mineru-local/service/rule_generation.py)、[rule_assistant.py](../../mineru-local/service/rule_assistant.py)：规则生成、对话建议与建议结构校验。
- [studio_planning.py](../../mineru-local/service/studio_planning.py)：需求规划、样例分组、复用建议及创建后的定位。
- [app.py](../../mineru-local/service/app.py)：业务 API、任务状态及请求断开后的取消处理。

前端使用的业务入口包括：

```text
POST /api/tasks
GET  /api/tasks/{job_id}
POST /api/tasks/{job_id}/cancel
POST /api/documents/{document_id}/extract
POST /api/profile-samples/{sample_id}/generate-rules
POST /api/profile-samples/{sample_id}/assist-rules
POST /api/studio/plan
POST /api/studio/plan/apply
```

`/api/tasks` 返回的是异步任务，前端需持续查询状态。首次状态查询会确认任务已被接收；后端等待确认最多 45 秒，避免上传断开后继续消耗识别或模型资源。业务页面可展示分阶段进度，模型响应本身仍为非流式返回。

## 5. 请求参数与返回校验

业务路径通过 `extract-worker.mjs` 发送的请求结构如下：

```json
{
  "model": "deepseek-v4-pro",
  "messages": [
    { "role": "system", "content": "只输出 JSON，并遵守业务结构与原文引用要求。" },
    { "role": "user", "content": "已序列化的提取要求、字段和真实文字块" }
  ],
  "max_tokens": 8000,
  "response_format": { "type": "json_object" },
  "thinking": { "type": "disabled" },
  "stream": false
}
```

JSON 模式同时要求提示词明确说明 JSON 格式和结构。官方配置说明见 [JSON Output](https://api-docs.deepseek.com/guides/json_mode/)。

通用客户端返回 `{ data, model, usage, elapsedMs }`；其中 `data` 已经过 JSON 解析，但仍需要调用方验证业务结构。当前校验顺序为：

1. HTTP 成功且 `choices[0].finish_reason === "stop"`。
2. `message.content` 非空、长度符合限制，并能解析为 JSON 对象。
3. Python 检查字段或建议结构、名称及引用是否有效。
4. 字段值与引用逐字匹配真实原文；坐标由后端已有文字块确定。

文析上下文会发送识别文本、页码、文字块位置、字段要求等信息。返回结果不能因为“是合法 JSON”就直接视为正确：未知引用、伪造原文、缺失金额、印章或签名等情况需要拒绝或明确标记待核验。配置助手的建议也不能直接变成已发布版本。

## 6. 输入预算、超时与调用次数

当前业务配置：

- 普通语义提取每批 **6 个文本字段**，按顺序调用；明确字段清单最多 30 项。同一批包含该材料单元的完整上下文，字段分批不会自动把长文档切成小段。
- 普通提取、规则生成、配置助手：序列化后的 `messages` 上限为 **115,000 UTF-8 字节**，定义在 `semantic.MAX_CONTEXT_BYTES`。
- 通用 Node.js 客户端：`messages` 上限 **128,000 字节**；`maxTokens` 可传 1～10,000，默认 2,000；超时参数可传 1～240,000 毫秒，默认 60,000。
- 当前子进程桥接固定使用 `maxTokens: 8000`、请求超时 **60 秒**；标准输入上限 **160,000 字节**。
- Python 等待子进程通信最多 **65 秒**，随后终止仍在运行的子进程。
- 模型生成的 `content` 最多 **60,000 个字符**，截断、空白或非法 JSON 不会应用。

以上分别限制不同层级，**字节、字符和 token 不能直接互换**。一轮材料提取可能包含多个字段批次、多份独立材料或多个版式定位请求，总时长和总费用不能按单次 60 秒、一次 HTTP 请求计算。

### 已知边界：场景规划预算不一致

`studio_planning.generate()` 对每份样例最多截取前 12,000 个字符来规划分组，外层预算为 280,000 字节，但后续共用客户端仍限制 `messages` 为 128,000 字节，桥接还限制标准输入为 160,000 字节。外层检查通过不保证能够发起模型请求。接手时应优先统一这一预算；目前先减少样例数量或分批规划。规划阶段的样例摘录也不能用来证明已完整提取全文。

遇到“文档识别文本超过本轮模型输入预算”时，先检查当前文字块、字段要求和对话长度；可减少材料页数、按业务边界拆分，Studio 可选择基准页或缩短历史对话。当前普通提取没有自动长文分块与跨块合并，不应静默截断正文后继续声称完整提取。

## 7. 错误、取消与用量记录

客户端不自动重试付费请求。用户主动重试或追加要求会产生新请求；网络超时和取消也不能证明上游没有受理或计费。

常见分类与排查方向：

- `configuration`：未配置服务端密钥。
- `input`：消息结构、输入字节数、超时或输出上限参数不符合客户端约束。
- `upstream` + `upstreamStatus`：401 检查模型密钥；402 检查模型账户余额；429 检查请求频率；500 / 503 检查上游服务。完整映射见客户端文件。
- `network`：检查 DNS、TLS、代理和连接状态；`phase=connect` 表示建立连接阶段，`phase=response` 表示读取响应阶段。连接失败可能早于总超时出现。
- `timeout` / `cancelled`：分别表示总超时或调用方取消。
- `incomplete`、`content`、`json`、`response`：输出未正常完成、内容不合规或响应无法解析，不能应用半份结果。
- Python 层的 `response_schema_error` / `bridge_error`：检查业务结构校验或子进程返回协议。

公网首页或 `/api/health` 直接返回 HTTP 401，首先检查**文析站点登录**。模型的 401 则出现在模型错误元数据中；这两层鉴权不能混为一谈。

Python 用 `node --use-env-proxy` 启动子进程。需要代理时，在后端进程或容器中配置 `HTTP_PROXY`、`HTTPS_PROXY`、`NO_PROXY`；本机 `127.0.0.1` 代理地址不能直接当作远程服务器的代理地址。禁止为排错输出带认证信息的代理 URL、完整上游错误正文或密钥。

用量日志位置：

- 本机：`.runtime/wenxi-model-usage.jsonl`。
- 公网宿主机：`/opt/wenxi-live/data/wenxi-model-usage.jsonl`。

日志包含调用编号、模型、耗时、token 用量、结果分类、上游状态及筛选后的网络错误码等信息，不记录提示词、识别正文和文件名。`usage: null` 表示用量未知，不能展示成零；汇总调用会保留批次信息，不能把一条汇总再计作额外的模型请求。日志写入失败不会触发模型重试。

模型调用成功与业务核验通过是不同口径。还需检查最终字段状态、原文依据和用户确认，不能用一条成功日志代表业务准确率。上传材料、历史和解析结果保存在其他运行目录中，不能因为用量日志不含正文就将整个数据目录公开。

## 8. 接手验证与最小复用示例

### 8.1 不产生模型费用的检查

从仓库根目录执行：

```sh
node --version
node --test mineru-local/deepseek/client.test.mjs
.runtime/mineru-venv/bin/python -m unittest discover -s mineru-local -t mineru-local -p 'test_semantic.py'
curl --fail http://127.0.0.1:8768/api/health
```

`/api/health` 中的 `semantic: true`、`extractor: "deepseek"` 和 `model` 可确认当前进程启用了哪个模型配置。该接口不会发起模型调用，**不能证明密钥、余额或上游连通性正常**。公网 `/healthz` 只用于进程健康检查。

公网配置检查需先取得站点账号；以下命令让 curl 交互式询问站点密码，避免把密码直接写进命令：

```sh
curl --fail --user "$WENXI_USER" https://wx.tracex.fun/api/health
```

### 8.2 最小真实调用示例

以下示例会调用真实模型并产生费用，本文编写时未执行。先在本机环境文件中填写项目专用密钥，再从仓库根目录运行。只使用虚构文本：

```sh
node --use-env-proxy --env-file=mineru-local/.env.local --input-type=module <<'JS'
import { completeDeepSeekJson, DeepSeekError } from './mineru-local/deepseek/deepseek-client.mjs';

try {
  const result = await completeDeepSeekJson({
    messages: [
      { role: 'system', content: '只输出 JSON 对象，格式为 {"ok":true}。' },
      { role: 'user', content: '这是虚构的接入连通性检查，请返回规定的 JSON。' },
    ],
    maxTokens: 64,
    timeoutMs: 60000,
    thinking: false,
  });
  if (result.data.ok !== true) throw new Error('示例响应不符合业务结构');
  console.log({ ok: true, model: result.model, elapsedMs: result.elapsedMs, usage: result.usage });
} catch (error) {
  console.error(error instanceof DeepSeekError
    ? { code: error.code, message: error.message, upstreamStatus: error.upstreamStatus }
    : { message: '示例执行失败，请检查本机配置与响应结构' });
  process.exitCode = 1;
}
JS
```

其他 Node.js 后端可以复用 `deepseek-client.mjs`，自行注入环境变量、组织消息并验证 `data`。该文件可独立工作；文析的原文引用校验、任务管理、用量日志和 Studio 确认流程由其他模块实现，复制客户端不会自动获得这些能力。

### 8.3 业务验收

需要验证完整链路时，使用仓库内的虚构样例或自行生成的虚构材料，分别核验字段提取、原文高亮、配置建议预览与停止操作。准备修改密钥或发布前先确认没有活动任务，保留原配置和可回退镜像。

费用与配额以实际账户和上游账单为准。密钥由谁保管、费用由谁承担、允许哪些环境使用，应在交接时由项目负责人单独确认；凭证及账户余额不写入公开仓库。

## 9. 接手维护要点

1. 调整模型或启用思考模式时，同时检查 JSON 约束、输出预算与超时；当前业务桥接固定关闭思考，修改环境变量不会改变这一行为。
2. 调整上下文上限时，同步检查业务层、Node.js 客户端和桥接层的限制，不能只改其中一处。
3. 扩展输出字段类型或规则能力时，先更新结构及原文校验，再接入界面；不要直接信任模型返回的坐标、字段或建议。
4. 失败和未知用量照实保留；保持取消传播及无自动重试约束。
5. 新增日志、监控或接入网关时，保留密钥和原文的访问边界，不把运行数据提交到 Git。

继续阅读：[协作与部署](collaboration.md)、[云端部署说明](../../deploy/live/README.md)、[编码协作指南](../../AGENTS.md)。
