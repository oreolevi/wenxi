import base64
import unittest
from unittest.mock import patch

import httpx

from . import app as service


class CloudAccessTests(unittest.IsolatedAsyncioTestCase):
    async def test_live_routes_require_account_and_same_origin(self):
        env = {'WENXI_RECOGNITION_BACKEND': 'mineru-cloud', 'WENXI_ACCESS_USER': 'wenxi',
               'WENXI_ACCESS_PASSWORD': 'test-access-only'}
        auth = 'Basic ' + base64.b64encode(b'wenxi:test-access-only').decode()
        with patch.dict('os.environ', env):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=service.app), base_url='http://localhost') as client:
                self.assertEqual((await client.get('/healthz')).status_code, 200)
                self.assertEqual((await client.get('/api/health')).status_code, 401)
                self.assertEqual((await client.get('/api/extraction-profiles')).status_code, 401)
                self.assertEqual((await client.post('/api/tasks')).status_code, 401)
                response = await client.get('/api/health', headers={'authorization': auth})
                self.assertEqual(response.status_code, 200)
                self.assertIn('Content-Security-Policy', response.headers)
                self.assertNotIn('test-access-only', response.text)
                self.assertEqual((await client.get('/api/health', headers={'authorization': auth, 'origin': 'https://evil.example'})).status_code, 403)
                self.assertEqual((await client.get('/api/health', headers={'authorization': 'Basic wrong'})).status_code, 401)


if __name__ == '__main__':
    unittest.main()
