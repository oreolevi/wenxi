# 视觉识别小样本验证

本目录用于独立验证现有识别链路，**不会启用新的产品功能**。普通测试和 CI 不执行真实 API 探测。

## 样例生成

六页材料依次为印刷对照、浅色水印、密集水印、手写数字拼接、独立虚构印章和印章覆盖正文。全部业务名称、金额、日期及印章均为虚构内容。PDF 仅含栅格图片，不嵌入文字答案。

依赖：项目 Python 环境、Pillow、NumPy、ReportLab，以及支持中文的本机字体。MNIST 数据集需自行从 [Keras 官方来源](https://keras.io/api/datasets/mnist/) 下载，保存在忽略目录中；生成器验证 SHA-256，不自行联网下载。

```sh
mkdir -p .runtime/visual-probe/cache
curl --fail --location \
  https://storage.googleapis.com/tensorflow/tf-keras-datasets/mnist.npz \
  --output .runtime/visual-probe/cache/mnist.npz

.runtime/mineru-venv/bin/python mineru-local/benchmarks/generate_visual_samples.py \
  --output .runtime/visual-probe/samples \
  --pdf output/pdf/visual-probe/samples.pdf \
  --mnist .runtime/visual-probe/cache/mnist.npz \
  --font /System/Library/Fonts/Supplemental/Songti.ttc
```

其他系统需替换字体路径。生成的 `manifest.json` 保存 PDF 摘要、字段评分基准及手写数字的样本索引。

手写数字来自 MNIST 测试集，作者为 Yann LeCun 和 Corinna Cortes，许可为 [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/)。生成器对字形进行裁切、缩放、拼接，不代表自然整行书写或中文手写。衍生的手写图像沿用相同许可；分发时保留作者、来源、许可和修改说明。字体文件不随仓库分发。

## 真实接口验证：会使用额度

一次完整新运行向 MinerU 提交两个六页任务，分别使用 `vlm` 和 `pipeline`；共计 12 页。可用 `--models vlm` 限定只提交一种模式。请自行核对账户额度和计费规则。

```sh
export MINERU_API_TOKEN='由使用者在本机安全配置'
.runtime/mineru-venv/bin/python mineru-local/benchmarks/probe_visual_ocr.py run \
  --samples .runtime/visual-probe/samples \
  --output .runtime/visual-probe/results
```

也可通过 `--cloud-env /path/to/private.env` 读取当前任务授权的环境文件。脚本只从该文件读取 MinerU Token，不打印内容。不要使用其他应用的配置或提交该文件。

加 `--with-semantic` 会使用现有文析字段链路和服务端 DeepSeek 配置，在 VLM 结果上额外执行模型提取；本组样例预计五次请求，纯印章页不调用文字模型。未配置 DeepSeek 时报告配置缺失，不调用模型。评分答案不传给识别或模型服务，字段名称会作为用户要求传入。

## 中断恢复

任务提交后立即记录提供方批次编号；不会把签名上传或下载地址写入检查点。失败和完成的记录默认复用，不自动重新提交。

```sh
.runtime/mineru-venv/bin/python mineru-local/benchmarks/probe_visual_ocr.py run \
  --samples .runtime/visual-probe/samples \
  --output .runtime/visual-probe/results \
  --resume-pending
```

`--resume-pending` 只查询已有编号并下载结果，不创建缺失任务。提交响应丢失且没有编号时，先在提供方确认是否已受理；不要直接换目录反复提交。DeepSeek 阶段若处于 `started`，同样拒绝自动重跑，需人工确认是否已执行或计费。

若已确认是本机代理导致下载连接失败，可加 `--direct-network`，仅让本次 OCR 探测绕过环境代理；不修改运行中的应用或 DeepSeek 网络配置。报告生成、缓存重用均不消耗识别额度。

## 离线报告与检查

```sh
.runtime/mineru-venv/bin/python mineru-local/benchmarks/probe_visual_ocr.py report \
  --samples .runtime/visual-probe/samples \
  --output .runtime/visual-probe/results

.runtime/mineru-venv/bin/python mineru-local/benchmarks/test_probe_visual_ocr.py
```

在浏览器打开结果目录下的 `report.html`，查看样例、两种模式的文字命中、原始布局文字和字段提取状态。报告自包含样例图片；不提交报告、原始响应、数据集或任务检查点。

“文字命中”按页对 OCR 结果检查，统一全半角并去除空白和千分位逗号，不计算编辑距离，不代表字段定位准确率。原始布局文字仅指提供方保留的正文布局块，不含页眉页脚等 `discarded_blocks`。水印词未命中不代表图片已去水印。样例未覆盖重复文字块去重、自然中文手写、真实印章和签名身份核验。

首次验证的实测结果和产品建议见 [视觉识别验证记录](../../docs/development/visual-ocr-evaluation.md)。
