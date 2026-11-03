// Server-only bridge. Reuses the migration package's fetch client unchanged.
import { completeDeepSeekJson, DeepSeekError } from './deepseek-client.mjs';
const controller = new AbortController();
process.on('SIGTERM', () => controller.abort());
process.on('SIGINT', () => controller.abort());
try {
  process.stdin.setEncoding('utf8');
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
    if (Buffer.byteLength(input) > 160000) throw new Error('input-limit');
  }
  const request = JSON.parse(input);
  const result = await completeDeepSeekJson({ messages: request.messages, maxTokens: 8000,
    timeoutMs: 60000, thinking: false, signal: controller.signal });
  process.stdout.write(JSON.stringify({ ok: true, ...result }));
} catch (error) {
  const known = error instanceof DeepSeekError;
  process.stdout.write(JSON.stringify({ ok: false, error: {
    code: known ? error.code : 'bridge', message: known ? error.message : '模型接入处理失败。',
    upstreamStatus: known ? error.upstreamStatus : undefined,
    transportCode: known ? error.transportCode : undefined,
    phase: known ? error.phase : undefined,
  }, model: error.model || process.env.DEEPSEEK_MODEL || 'deepseek-v4-pro',
  usage: error.usage ?? null, elapsedMs: error.elapsedMs ?? null }));
  process.exitCode = 1;
}
