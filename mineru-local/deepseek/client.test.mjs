import test from 'node:test';
import assert from 'node:assert/strict';
import { completeDeepSeekJson } from './deepseek-client.mjs';

const request = { apiKey: 'fictional-unit-test-key', model: 'unit-model', messages: [{ role: 'user', content: 'JSON' }] };
const completion = (content, finish_reason = 'stop') => new Response(JSON.stringify({
  model: 'unit-model', usage: { total_tokens: 42 }, choices: [{ finish_reason, message: { content } }],
}));

test('HTTP errors are classified and never expose upstream response bodies or retry', async t => {
  for (const status of [401, 402, 429, 503]) {
    const fetch = t.mock.method(globalThis, 'fetch', async () => new Response('private upstream detail', { status }));
    await assert.rejects(completeDeepSeekJson(request), error => error.upstreamStatus === status && !error.message.includes('private'));
    assert.equal(fetch.mock.callCount(), 1);
    fetch.mock.restore();
  }
});

test('truncated or malformed model JSON preserves usage and is never applied', async t => {
  for (const [content, finish, code] of [['{}', 'length', 'incomplete'], ['{invalid', 'stop', 'json'], ['', 'stop', 'content']]) {
    const fetch = t.mock.method(globalThis, 'fetch', async () => completion(content, finish));
    await assert.rejects(completeDeepSeekJson(request), error => error.code === code && error.usage.total_tokens === 42);
    fetch.mock.restore();
  }
});

test('cancellation reaches fetch and is distinct from a timeout', async t => {
  const controller = new AbortController();
  const fetch = t.mock.method(globalThis, 'fetch', async (_, options) => {
    controller.abort();
    assert.equal(options.signal.aborted, true);
    throw new Error('aborted');
  });
  await assert.rejects(completeDeepSeekJson({ ...request, signal: controller.signal }), error => error.code === 'cancelled');
  assert.equal(fetch.mock.callCount(), 1);
});

test('connection failure keeps safe diagnostics without leaking proxy details or retrying', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => {
    throw new TypeError('fetch failed: https://private-user:private-password@proxy',
      { cause: Object.assign(new Error('private certificate or hostname'), { code: 'ECONNRESET' }) });
  });
  await assert.rejects(completeDeepSeekJson(request), error => {
    assert.equal(error.code, 'network');
    assert.equal(error.transportCode, 'ECONNRESET');
    assert.equal(error.phase, 'connect');
    assert.equal(typeof error.elapsedMs, 'number');
    assert.ok(!JSON.stringify(error).includes('private'));
    return true;
  });
  assert.equal(fetch.mock.callCount(), 1);
});

test('interrupted response is distinct from initial connection and unknown codes are redacted', async t => {
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => {
    throw Object.assign(new Error('private detail'), { code: 'PRIVATE_HOSTNAME' });
  } }));
  await assert.rejects(completeDeepSeekJson(request), error =>
    error.code === 'network' && error.phase === 'response' && error.transportCode === 'UNKNOWN');
});
