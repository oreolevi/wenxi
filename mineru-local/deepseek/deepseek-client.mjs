// Server-only Node.js 22.13+ example. No SDK or Boside runtime dependency.
// Returns a JSON object; the caller must validate its business schema before use.
export class DeepSeekError extends Error {
  constructor(code, message, metadata = {}) {
    super(message);
    this.name = 'DeepSeekError';
    this.code = code;
    Object.assign(this, metadata);
  }
}

export async function completeDeepSeekJson({
  messages,
  apiKey = process.env.DEEPSEEK_API_KEY,
  model = process.env.DEEPSEEK_MODEL || 'deepseek-v4-pro',
  maxTokens = 2000,
  timeoutMs = 60000,
  thinking = false,
  signal,
}) {
  if (!apiKey?.trim()) throw new DeepSeekError('configuration', '请配置服务端 DEEPSEEK_API_KEY。');
  if (!Array.isArray(messages) || !messages.length || messages.some(message =>
    !message || !['system', 'user', 'assistant'].includes(message.role) || typeof message.content !== 'string'
  )) throw new DeepSeekError('input', 'messages 必须包含有效的 role 和文本 content。');
  if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 10000)
    throw new DeepSeekError('input', '示例的 maxTokens 需在 1 到 10000 之间。');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 240000)
    throw new DeepSeekError('input', '示例的超时需在 1 到 240000 毫秒之间。');
  if (Buffer.byteLength(JSON.stringify(messages), 'utf8') > 128000)
    throw new DeepSeekError('input', '示例输入超出 128000 字节，请缩小上下文。');

  const started = Date.now();
  const timeout = AbortSignal.timeout(timeoutMs);
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  // Keep only known transport codes. Raw fetch errors can contain proxy URLs or credentials.
  const transportCodes = new Set(['ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN',
    'ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT',
    'UND_ERR_BODY_TIMEOUT', 'UND_ERR_SOCKET', 'CERT_HAS_EXPIRED',
    'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'DEPTH_ZERO_SELF_SIGNED_CERT']);
  const connectionError = (error, phase) => new DeepSeekError(
    signal?.aborted ? 'cancelled' : timeout.aborted ? 'timeout' : 'network',
    signal?.aborted ? '请求已取消。' : timeout.aborted ? '模型回复超时。' : 'DeepSeek 连接失败或响应中断，请稍后重试。',
    { elapsedMs: Date.now() - started, phase,
      transportCode: transportCodes.has(error?.cause?.code || error?.code)
        ? (error.cause?.code || error.code) : 'UNKNOWN' },
  );
  let response;
  try {
    response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model, messages, max_tokens: maxTokens,
        response_format: { type: 'json_object' },
        thinking: { type: thinking ? 'enabled' : 'disabled' },
        ...(thinking ? { reasoning_effort: 'low' } : {}),
        stream: false,
      }),
      signal: requestSignal,
    });
  } catch (error) { throw connectionError(error, 'connect'); }

  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    const errors = {
      400: '模型请求格式错误。', 401: '模型密钥无效。', 402: '模型服务账户余额不足。',
      403: '模型服务拒绝访问。', 404: '模型或接口不存在。', 422: '模型参数无效。',
      429: '模型请求过于频繁，请稍后再试。', 500: '模型服务异常。', 503: '模型服务繁忙。',
    };
    throw new DeepSeekError('upstream', errors[response.status] || '模型请求失败。', {
      upstreamStatus: response.status,
    });
  }

  let completion;
  try { completion = await response.json(); }
  catch (error) {
    if (requestSignal.aborted || !(error instanceof SyntaxError)) throw connectionError(error, 'response');
    throw new DeepSeekError('response', '模型服务返回了无法解析的响应。');
  }
  if (requestSignal.aborted) throw connectionError(undefined, 'response');
  // Keep provider usage even when generated JSON is invalid. Missing usage is unknown, not zero.
  const metadata = {
    model: completion?.model || model,
    usage: completion?.usage ?? null,
    elapsedMs: Date.now() - started,
  };
  const choice = completion?.choices?.[0];
  if (choice?.finish_reason !== 'stop')
    throw new DeepSeekError('incomplete', '模型输出未正常完成，请勿应用。', metadata);
  const content = choice.message?.content;
  if (typeof content !== 'string' || !content.trim() || content.length > 60000)
    throw new DeepSeekError('content', '模型输出为空或超出示例长度限制。', metadata);
  let data;
  try { data = JSON.parse(content); }
  catch { throw new DeepSeekError('json', '模型输出不是有效 JSON。', metadata); }
  if (!data || typeof data !== 'object' || Array.isArray(data))
    throw new DeepSeekError('json', '模型输出必须是 JSON 对象。', metadata);
  return { data, ...metadata };
}
