# 文析后端

FastAPI 提供文档识别、原文定位、字段提取、全文 Markdown、固定规则执行、Studio、历史和统计接口。

## 环境与启动

安装与模型准备见[项目 README](../README.md)。当前验证环境为 Python 3.11、Node.js 24、MinerU 4.1.0；默认使用 basic ONNX 模型。

```sh
./mineru-local/启动文析.command
```

页面与接口地址：<http://127.0.0.1:8768>。健康检查：`GET /api/health`。服务仅接受 localhost 同源请求，当前为单机试用环境。

## 服务端配置

复制 `.env.example` 为 `.env.local`，填入 `DEEPSEEK_API_KEY`。密钥只在后端加载，不进入前端构建。进程环境变量优先于文件配置。

- `DEEPSEEK_API_KEY`：服务端模型密钥。
- `DEEPSEEK_MODEL`：当前默认 `deepseek-v4-pro`。
- `WENXI_EXTRACTOR`：`deepseek` 或仅供诊断的 `label-match`。
- `WENXI_MINERU_TIER`：启动环境设置 `basic` / `standard`；standard 需要额外准备模型。
- `WENXI_MINERU_API_URL`：部分通用解析流程的远程 MinerU 地址，未覆盖全部 Studio 处理。

## 处理边界

- 通用解析：MinerU 识别 → 按页优选可用 PDF 文字层 → DeepSeek 提取 → 校验原文引用和结构。文字层过度碎片化时保留可用 OCR 段落。
- 字段每批最多 6 项，输入预算 115000 字节；超过预算会明确拒绝，不静默截断正文。
- 全文转换使用 MinerU 原生 Markdown 与图片，无字段要求时跳过 DeepSeek。
- Studio 运行接口执行已发布的固定规则，不调用大模型；AI 只在构建阶段生成建议，由用户确认。
- 预处理复用 MinerU 的本地 ONNX OCR，包含方向判断、倾斜校正和页面单元处理。
- 原文引用通过仅表示引用可验证，不代表业务正确；签名、盖章等内容仍有图像能力边界。
- 模型连接失败保留 OCR 与已有结果，付费请求不自动重试。安全连接诊断写入本机用量日志。

## 数据目录

所有运行数据位于仓库根目录 `.runtime`：临时任务 `wenxi-documents`、个人历史 `wenxi-history`、Studio `wenxi-profiles`、模型 `mineru-data`。这些目录不提交到 GitHub。

临时任务与已保存历史分别管理；停止服务不删除已保存历史。接口容量及页数限制以当前服务端校验为准。

## 测试

```sh
.runtime/mineru-venv/bin/python -m unittest discover -s mineru-local -p 'test_*.py'
node --test mineru-local/deepseek/client.test.mjs
```

`testdata` 仅包含两份明确标注虚构信息的 PDF。真实样本、识别结果及历史测试报告不随源码共享。

团队部署边界与迁移步骤见[协作与部署](../docs/development/collaboration.md)。
