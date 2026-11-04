"""Download three pinned public MinerU regional OCR weights; verify before installation."""
import argparse
import hashlib
from pathlib import Path
import sys

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'mineru-local' / 'service'))
from seal_worker import MODEL_HASHES, TEXT_HASHES

REVISION = '358310b4f64b95f9fefc372ad899356e4111f376'
BASE = f'https://huggingface.co/opendatalab/MinerU-4_models_onnx/resolve/{REVISION}/OCR/paddleocr/'


def prepare(folder):
    folder.mkdir(parents=True, exist_ok=True)
    with httpx.Client(follow_redirects=True, timeout=60) as client:
        for name, expected in {**MODEL_HASHES, **TEXT_HASHES}.items():
            target = folder / name
            if target.is_file() and hashlib.sha256(target.read_bytes()).hexdigest() == expected:
                print(name, 'verified')
                continue
            temporary = target.with_suffix('.download')
            try:
                digest, size = hashlib.sha256(), 0
                with client.stream('GET', BASE + name) as response:
                    response.raise_for_status()
                    with temporary.open('wb') as stream:
                        for chunk in response.iter_bytes():
                            size += len(chunk)
                            if size > 40 * 1024 * 1024:
                                raise ValueError('Model exceeds expected bound')
                            digest.update(chunk)
                            stream.write(chunk)
                if digest.hexdigest() != expected:
                    raise ValueError('Model checksum mismatch')
                temporary.replace(target)
                print(name, 'downloaded and verified')
            finally:
                temporary.unlink(missing_ok=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    prepare(args.output)
