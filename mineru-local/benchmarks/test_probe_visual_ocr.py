"""Offline checks: a report/recovery operation must not create paid OCR tasks."""
import asyncio
import contextlib
import hashlib
import io
import json
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, Mock, patch

import probe_visual_ocr as probe


class RecoveryTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        samples = self.root / 'samples'
        samples.mkdir()
        pdf = samples / 'fixture.pdf'
        pdf.write_bytes(b'fictional fixture - no recognition requested')
        self.digest = hashlib.sha256(pdf.read_bytes()).hexdigest()
        (samples / 'manifest.json').write_text(json.dumps({
            'fictional': True, 'pdf': str(pdf), 'sha256': self.digest, 'cases': [],
        }))
        self.args = SimpleNamespace(samples=samples, output=self.root / 'results',
            cloud_env=None, models=['vlm'], with_semantic=False,
            resume_pending=False, direct_network=False)

    def invoke(self):
        with patch.dict(os.environ, {'MINERU_API_TOKEN': 'offline-fixture'}), \
                contextlib.redirect_stdout(io.StringIO()):
            asyncio.run(probe.run(self.args))

    def save_result(self, **fields):
        folder = self.args.output / 'vlm'
        folder.mkdir(parents=True)
        (folder / 'result.json').write_text(json.dumps({'inputSha256': self.digest, **fields}))

    def test_resume_with_no_checkpoint_does_not_create_task(self):
        self.args.resume_pending = True
        with patch.object(probe.httpx, 'AsyncClient') as client:
            self.invoke()
        client.assert_not_called()

    def test_unknown_submission_outcome_requires_manual_review(self):
        self.save_result(status='started')
        with patch.object(probe.httpx, 'AsyncClient') as client:
            with self.assertRaisesRegex(ValueError, 'interrupted'):
                self.invoke()
        client.assert_not_called()

    def test_completed_and_failed_results_do_not_automatically_resubmit(self):
        for status in ['completed', 'failed']:
            with self.subTest(status=status):
                path = self.args.output / 'vlm' / 'result.json'
                if path.exists():
                    path.unlink()
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(json.dumps({'inputSha256': self.digest, 'status': status}))
                with patch.object(probe.httpx, 'AsyncClient') as client:
                    self.invoke()
                client.assert_not_called()

    def test_input_change_cannot_reuse_old_result(self):
        self.save_result(status='completed', inputSha256='different')
        with self.assertRaisesRegex(ValueError, 'input changed'):
            self.invoke()

    def test_recovery_only_gets_existing_batch_and_downloads(self):
        client = Mock()
        response = Mock()
        client.get = AsyncMock(return_value=response)
        manager = AsyncMock()
        manager.__aenter__.return_value = client
        adapter = SimpleNamespace(API='https://mineru.net/api/v4',
            require_success=Mock(return_value={'extract_result': [
                {'state': 'done', 'full_zip_url': 'https://mineru.net/fixture.zip'}]}),
            download=AsyncMock())
        job = SimpleNamespace(directory=self.root, phase='')
        with patch.dict(os.environ, {'MINERU_API_TOKEN': 'offline-fixture'}), \
                patch.object(probe.httpx, 'AsyncClient', return_value=manager):
            result = asyncio.run(probe.resume_parse(adapter, job, 'existing-batch'))
        self.assertEqual(result, self.root / 'cloud-export.zip')
        self.assertEqual(client.get.await_args.args[0], adapter.API + '/extract-results/batch/existing-batch')
        client.post.assert_not_called()
        client.put.assert_not_called()
        adapter.download.assert_awaited_once()


if __name__ == '__main__':
    unittest.main()
