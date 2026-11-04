# 文析

文析提供自然语言文档解析与固定版式 API 开发，包含 React 工作台、FastAPI 后端、MinerU 识别适配和 DeepSeek 语义提取。

- **文析**：上传材料，描述提取要求或导入 Excel 字段表，对照原文核验，导出字段及 Markdown 全文。
- **文析 Studio**：配置版式和字段规则，经单份、批量测试后发布固定版本 API；场景组合一个或多个已发布服务。
- **历史与运营**：保存解析结果和原图，查看服务运行记录及运营汇总。

## 公网试用环境

**已部署，可直接访问：[文析工作台 · wx.tracex.fun](https://wx.tracex.fun/)。**

- 已接入 MinerU 官方解析 API 和 DeepSeek，支持真实文档识别、字段提取及 Markdown 全文。
- 文析与 Studio 的核心流程已验证：自动转正、倾斜校正、原图定位、历史恢复、服务发布与场景组合调用。
- 访问使用共享试用账户，凭证由项目负责人单独提供，不保存在仓库中。预置材料为虚构样例，体验和问题复现也请使用虚构材料。
- 本机与公网环境独立保存配置和历史。代码合并后由维护者单独发布，GitHub 不会自动更新网站。

部署方式为 Docker 业务后端加 HTTPS 入口，OCR 和语义提取调用云端 API。详细配置、持久化及回退方式见 [云端部署说明](deploy/live/README.md)。

DeepSeek 调用链路、环境配置、输入预算、错误处理与接手验证见 [DeepSeek 接入交接说明](docs/development/deepseek-handover.md)。

水印、手写数字与印章的现有能力及验证边界见 [视觉识别验证记录](docs/development/visual-ocr-evaluation.md)；可复现的虚构样例生成和独立接口探测见 [验证工具说明](mineru-local/benchmarks/README.md)。

## 运行模式

| 模式 | 识别与模型 | 适用用途 |
| --- | --- | --- |
| 纯前端演示 | 虚构数据，无真实模型调用 | UI 开发、交互评审 |
| 本机完整版本 | 本机 MinerU / OCR，服务端 DeepSeek | 本机识别与规则联调 |
| 云端 API 版本 | MinerU 官方 API，服务端 DeepSeek | 受控的统一试用环境 |

本机与云端共用页面校正、原图坐标映射和固定规则流程。识别引擎不同，具体结果与耗时可能不同。云端使用共享试用账户，尚无个人账户、角色权限和租户数据隔离。

## 快速体验前端

环境：Node.js 24。本模式不需要模型、API Key 或业务材料。

```sh
cd document-extraction-ui
npm ci
npm run build:demo
npm exec vite preview -- --outDir dist-demo --host 127.0.0.1 --port 4173
```

访问 <http://127.0.0.1:4173>。演示中的上传和提取使用虚构结果；真实接口通过另两种运行模式联调。

## 本机完整版本

环境：Node.js 24、Python 3.11。以下命令从仓库根目录执行。已有环境无需重复安装。

```sh
python3.11 -m venv .runtime/mineru-venv
.runtime/mineru-venv/bin/python -m pip install -r mineru-local/requirements.txt
cd document-extraction-ui
npm ci
npm run build
cd ..
./mineru-local/mineru models download --tier basic --small-backend onnx --source modelscope
./mineru-local/mineru models verify --tier basic --small-backend onnx
cp mineru-local/.env.example mineru-local/.env.local
```

在 `mineru-local/.env.local` 填写自己的服务端 DeepSeek 配置，然后启动：

```sh
sh mineru-local/启动文析.command
```

访问 <http://127.0.0.1:8768>。`npm run dev` 用于 UI 开发；真实识别在构建后通过后端同源入口使用。未配置 DeepSeek 时，部分固定规则功能可用，AI 辅助不可用。

本机依赖在 macOS 验证；完整本机 OCR 在其他操作系统上仍需验收。`requirements.lock.txt` 是原 macOS 环境记录。云端 Docker 使用独立的 Linux 依赖清单，不安装完整 MinerU 或 GPU 权重。

## 云端 API 版本

运行前端和轻量业务后端，OCR 调用 MinerU 官方托管服务，语义提取和配置助手调用 DeepSeek。页面方向判断使用固定版本的轻量 CPU 模型，原图、校正页面和坐标关系保存在服务端。

参见 [云端部署说明](deploy/live/README.md) 和 [方向模型来源与校验](deploy/live/models/README.md)。前端使用 `npm run build:live` 构建；密钥通过服务端环境文件注入。通用文析上传的材料会发送给 MinerU，识别文本及字段要求会发送给 DeepSeek。

## 验证

以下为不含真实凭证、不调用外部识别服务的检查：

```sh
node --test mineru-local/deepseek/client.test.mjs
.runtime/mineru-venv/bin/python -m unittest discover -s mineru-local -t mineru-local -p 'test_*.py'
cd document-extraction-ui
npm test
npm run build:live
npm run build:demo
```

后端单元测试可使用 `deploy/live/requirements.txt` 加 `reportlab==5.1.0` 安装测试依赖，无需下载 OCR 模型。仓库中的两个 PDF 样例均为生成的虚构材料。真实识别、模型调用和完整部署单独验收，不放入普通 CI。

## 目录

- `document-extraction-ui/`：React 前端、演示适配和前端测试。
- `mineru-local/service/`：识别、预处理、规则执行、Studio、历史及统计接口。
- `mineru-local/deepseek/`：服务端模型调用与错误分类。
- `mineru-local/testdata/`：虚构 PDF 回归样例。
- `deploy/`：纯前端演示与云端 API 版本的部署配置。
- `docs/`：业务使用及开发文档。

## 协作

源码公开地址：[oreolevi/wenxi](https://github.com/oreolevi/wenxi)。可以直接分享链接供同事阅读、克隆和参与协作；公网工作台仍使用试用账户登录。

外部参与者先 Fork 到自己的账号，创建功能分支并提交 Pull Request；受邀协作者也可在原仓库创建分支。写明行为变化和验证结果，通过检查后由维护者合并。参考 [贡献说明](CONTRIBUTING.md)、[协作与部署](docs/development/collaboration.md) 和 [产品文档](docs/README.md)。

代码更新、环境数据和线上发布分别管理。合并代码不会自动部署，也不会同步服务配置和历史记录。本机运行目录、密钥、真实材料、模型权重和生成结果不进入仓库。

### 使用大模型协作开发

使用支持 GitHub 仓库读取的编码工具打开本仓库，或先克隆到本机并将仓库作为工作目录打开。公开链接方便阅读；具体能否读取及修改，取决于工具的联网和工作目录访问能力。提交修改时，仍按 Fork／分支与 Pull Request 流程进行。

支持 `AGENTS.md` 的工具可自动读取根目录的 [编码协作指南](AGENTS.md)；其他工具可要求其先阅读该文件，再按当前任务查看相关源码。指南提供项目结构、关键约束和检查入口，安装、部署与产品说明继续以现有文档为准。

可使用以下任务开场：

> 先阅读根目录 AGENTS.md、README.md 和 CONTRIBUTING.md，再检查与任务相关的源码。先理解已有实现，保留未提交改动，按需求修改并完成相应验证。任务：……
