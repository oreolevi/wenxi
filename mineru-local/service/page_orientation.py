"""Small, local four-way document orientation classifier for hosted recognition.

PP-LCNet_x1_0_doc_ori, PaddlePaddle, Apache-2.0. Model provenance is pinned in
deploy/live/models/README.md. No document or model download occurs at runtime.
"""
from functools import lru_cache
import hashlib
import os
from pathlib import Path
import threading

import cv2
import numpy as np

MODEL_SHA256 = 'af9a0a4f317ff0709ce752067807f819cb15d883f8ecad89f28df1c6ee2d9c92'
LOCK = threading.Lock()


@lru_cache(maxsize=1)
def session():
    import onnxruntime as ort
    ort.disable_telemetry_events()
    model = Path(os.getenv('WENXI_ORIENTATION_MODEL', '/app/models/document-orientation.onnx'))
    if not model.is_file() or hashlib.sha256(model.read_bytes()).hexdigest() != MODEL_SHA256:
        raise ValueError('页面方向模型缺失或校验失败，请联系维护人员。')
    options = ort.SessionOptions()
    options.intra_op_num_threads = 1
    options.inter_op_num_threads = 1
    options.log_severity_level = 3
    options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
    return ort.InferenceSession(str(model), options, providers=['CPUExecutionProvider'])


def input_tensor(image):
    # Official inference.yml: RGB, resize short edge 256, center crop 224,
    # ImageNet normalization, NCHW. Keep the same rounding as PaddleX ResizeByShort.
    data = np.asarray(image.convert('RGB'))
    height, width = data.shape[:2]
    scale = 256 / min(height, width)
    data = cv2.resize(data, (round(width * scale), round(height * scale)), interpolation=cv2.INTER_LINEAR)
    height, width = data.shape[:2]
    data = data[(height - 224) // 2:(height - 224) // 2 + 224,
                (width - 224) // 2:(width - 224) // 2 + 224]
    data = (data.astype(np.float32) / 255 - np.array([.485, .456, .406], np.float32)) / np.array([.229, .224, .225], np.float32)
    return np.ascontiguousarray(data.transpose(2, 0, 1)[None])


def decide(scores):
    scores = np.asarray(scores).reshape(-1)
    if scores.size != 4 or not np.isfinite(scores).all() or np.any(scores < 0) or abs(float(scores.sum()) - 1) > .01:
        raise ValueError('页面方向判断返回无效结果，请重试。')
    order = np.argsort(scores)
    best = int(order[-1])
    confidence = float(scores[best])
    margin = confidence - float(scores[order[-2]])
    uncertain = confidence < .8 or margin < .25
    # Labels denote the counterclockwise correction: a CCW-90 upload predicts 270.
    return (0 if uncertain else best * 90), uncertain, round(margin, 3)


def predict(image):
    with image.copy() as probe:
        probe.thumbnail((256, 256))
        gray = np.asarray(probe.convert('L'))
    # White/near-blank scans have no trustworthy reading direction.
    if float(gray.std()) < 3 or float(np.mean(gray < 220)) < .003:
        return 0, True, 0.
    with LOCK:
        runner = session()
        values = runner.run(None, {runner.get_inputs()[0].name: input_tensor(image)})[0]
    return decide(values)
