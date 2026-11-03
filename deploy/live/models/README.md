# 页面方向模型

使用 PaddlePaddle 官方 `PP-LCNet_x1_0_doc_ori_onnx`，许可证 Apache-2.0。它只判断页面的四个方向；OCR 和版面识别继续使用 MinerU 托管 API。

- 官方仓库：https://huggingface.co/PaddlePaddle/PP-LCNet_x1_0_doc_ori_onnx
- 固定版本：`7330ab7039123e46af2dc03154b9969aa412c61d`
- 权重：https://huggingface.co/PaddlePaddle/PP-LCNet_x1_0_doc_ori_onnx/resolve/7330ab7039123e46af2dc03154b9969aa412c61d/inference.onnx
- 文件大小：6,788,069 字节
- SHA-256：`af9a0a4f317ff0709ce752067807f819cb15d883f8ecad89f28df1c6ee2d9c92`

部署前下载并校验，放入构建上下文的 `models/document-orientation.onnx`，同时附带本说明和 `LICENSE`。权重不进入 Git，不在用户上传时下载。应用启动时再次校验权重哈希，仅启用 CPU 单线程推理。

预处理按该固定版本 `inference.yml`：RGB → 短边 256 → 中心裁剪 224 → ImageNet 均值与标准差归一化 → NCHW。输出类别为 `0/90/180/270`，表示逆时针校正角度；使用正向、横向和倒置材料验证过方向约定。

低置信度、类别接近或空白页面保留上传方向，并标记待核对；不把不确定判断写成“转正成功”。倾斜校正与原图坐标映射使用文析共用预处理代码。
