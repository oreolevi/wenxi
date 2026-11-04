"""Bounded, offline CPU seal OCR worker. No API clients or model downloads."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import shutil
import sys

MODEL_HASHES = {
    'seal_PP-OCRv4_det_infer.onnx': '3e190df84542c2756975febe8f73603b587a23c7f7badfdd3fc8a986540d5bc0',
    'ch_PP-OCRv6_small_rec_infer.onnx': '5435fd747c9e0efe15a96d0b378d5bd157e9492ed8fd80edf08f30d02fa24634',
}


def file_hash(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def check_models(root):
    for name, expected in MODEL_HASHES.items():
        if file_hash(root / name) != expected:
            raise ValueError('Seal model checksum mismatch')


def seed_cache(root, cache):
    """Seed an image-built graph so a small server need not convert it on upload."""
    from filelock import FileLock
    from mineru.model.runtime.onnx_rec import REC_OUTPUT_FORMAT
    prefix = REC_OUTPUT_FORMAT + '-' + MODEL_HASHES['ch_PP-OCRv6_small_rec_infer.onnx']
    source = root / 'derived'
    if not source.is_dir():
        return  # Local complete installations can prepare their own persistent cache.
    cache.mkdir(parents=True, exist_ok=True)
    with FileLock(str(cache / '.seed.lock'), timeout=10):
        for suffix in ['.onnx', '.json']:
            destination = cache / (prefix + suffix)
            if not destination.is_file() or file_hash(destination) != file_hash(source / destination.name):
                temporary = destination.with_suffix(suffix + '.seed')
                shutil.copyfile(source / destination.name, temporary)
                temporary.replace(destination)


def recognize(payload):
    # Import only the existing MinerU ONNX OCR path, never its full parser/LLM stack.
    import numpy as np
    import onnxruntime as ort
    from PIL import Image
    from mineru.config import get_config
    from mineru.model.ocr.pp_ocr_v6_onnx import PPOCRv6ONNX

    ort.disable_telemetry_events()

    root = Path(payload['modelDir'])
    check_models(root)
    seed_cache(root, Path(payload['cacheDir']) / '.derived' / 'ocr-rec')
    # Derived compact recognition graph is cached in our writable runtime directory.
    get_config().model.base_dir = str(Path(payload['cacheDir']))
    model = PPOCRv6ONNX(det_model_path=str(root / 'seal_PP-OCRv4_det_infer.onnx'),
        rec_model_path=str(root / 'ch_PP-OCRv6_small_rec_infer.onnx'),
        lang='seal', device='cpu', intra_op_num_threads=1, rec_batch_num=1)
    regions = payload['regions']
    if not isinstance(regions, list) or len(regions) > 16:
        raise ValueError('Too many seal regions')
    output = []
    for region in regions:
        with Image.open(region['image']) as image:
            if image.width * image.height > 1600 * 1600:
                raise ValueError('Seal crop exceeds limit')
            pixels = np.asarray(image.convert('RGB'))[:, :, ::-1].copy()
        result = model.ocr(pixels)[0] or []
        output.append({'ref': region['ref'], 'lines': [
            {'polygon': item[0], 'text': item[1][0], 'confidence': float(item[1][1])}
            for item in result[:32]]})
    return {'regions': output}


if __name__ == '__main__':
    try:
        if len(sys.argv) == 3 and sys.argv[1] == '--prepare-cache':
            from mineru.model.runtime.onnx_rec import prepare_rec_model
            root = Path(sys.argv[2])
            check_models(root)
            prepare_rec_model(str(root / 'ch_PP-OCRv6_small_rec_infer.onnx'), cache_dir=root / 'derived')
            print('Prepared and checked compact seal recognition graph')
            sys.exit(0)
        payload = json.loads(sys.stdin.buffer.read(64 * 1024))
        result = recognize(payload)
        sys.stdout.write(json.dumps(result, ensure_ascii=False, allow_nan=False))
    except Exception:
        # Errors must never echo filesystem paths, document text or environment data.
        sys.stdout.write(json.dumps({'error': 'seal_ocr_unavailable'}))
        sys.exit(1)
