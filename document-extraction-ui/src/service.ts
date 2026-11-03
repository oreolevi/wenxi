import { mergeFields, requestedNames } from './model.ts';
import { CLOUD_MODE, DEMO_MODE } from './demoMode.ts';
import type { ExtractedField, Material, ParsedDocument, ProcessingStep, RequirementDefinition, RequirementWorkbook } from './types.ts';

interface Result { document: ParsedDocument; fields: ExtractedField[] }
interface Job { id: string; status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'; phase: string; events?: ProcessingStep[]; error?: string; result?: Result; document?: ParsedDocument }
export interface ServiceInfo { semantic: boolean; model?: string; extractor: 'label-match' | 'deepseek'; supportsRequirements?: boolean; supportsHistory?: boolean; reviewAvailable?: boolean; supportsFullText?: boolean }

export const localServicePage = () => DEMO_MODE || CLOUD_MODE && location.protocol === 'https:' || location.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(location.hostname) && location.port === '8768';

async function responseJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw Object.assign(new Error(typeof error.detail === 'string' ? error.detail : `服务请求失败（${response.status}）`), { status: response.status });
  }
  return response.json() as Promise<T>;
}

function wait(signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const stop = () => { clearTimeout(timer); reject(new DOMException('已停止', 'AbortError')); };
    const timer = window.setTimeout(() => { signal.removeEventListener('abort', stop); resolve(); }, 750);
    signal.addEventListener('abort', stop, { once: true });
    if (signal.aborted) stop();
  });
}

export async function parseRequirementWorkbook(file: File, signal: AbortSignal): Promise<RequirementWorkbook> {
  if (!localServicePage()) throw new Error('读取 Excel 字段表请通过 http://127.0.0.1:8768 打开文析。');
  const body = new FormData(); body.append('file', file, file.name);
  return responseJson<RequirementWorkbook>(await fetch('/api/requirements/parse', { method: 'POST', body, signal }));
}

export async function extractWithMinerU(material: Material, prompt: string, signal: AbortSignal, progress: (value: string) => void, semantic = false, requirements?: RequirementDefinition, onEvents?: (events: ProcessingStep[]) => void, outputMode: 'fields' | 'fulltext' | 'both' = 'fields'): Promise<Material> {
  if (!localServicePage()) throw new Error('真实识别请通过 http://127.0.0.1:8768 打开文析本机试用页，并启动“启动文析.command”。');
  const fullTextOnly = outputMode === 'fulltext';
  const names = fullTextOnly ? [] : requirements ? requirements.fields.map(field => field.name) : requestedNames(prompt).filter(name => !/^(?:全文|所有.*|全部.*|关键信息|主要信息|信息|内容|字段)$/.test(name));
  if (!fullTextOnly && !names.length && !semantic) throw new Error('请明确字段名称，例如“提取提交人、通讯地址和最终审核人员”。');
  let id = material.parsed?.id || '';
  const cancel = () => { if (id) void fetch(`/api/tasks/${id}/cancel`, { method: 'POST' }).catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    const submittedAt = new Date().toISOString();
    onEvents?.([{ id: 'submit', label: material.parsed ? '正在复用原文' : '正在上传材料', detail: material.name, status: 'running', startedAt: submittedAt }]);
    let job: Job | undefined;
    if (material.parsed && !material.parsed.historyId) {
      try {
        job = await responseJson<Job>(await fetch(`/api/documents/${material.parsed.id}/extract`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: names, prompt, requirements, outputMode: fullTextOnly ? 'fulltext' : 'fields' }), signal,
        }));
      } catch (error) {
        if ((error as { status?: number }).status !== 404) throw error;
        id = '';
      }
    }
    if (!job) {
      let source = material.sourceFile;
      if (!source && material.sourceUrl?.startsWith('/api/history/')) {
        const response = await fetch(material.sourceUrl, { signal });
        if (!response.ok) throw new Error('历史原文暂不可用，请重新添加附件。');
        source = new File([await response.blob()], material.name);
      }
      if (!source) throw new Error('附件原始内容已丢失，请重新添加。');
      const body = new FormData();
      body.append('file', source, material.name);
      body.append('fields', JSON.stringify(names));
      body.append('prompt', prompt);
      body.append('output_mode', fullTextOnly ? 'fulltext' : 'fields');
      if (requirements) body.append('requirements', JSON.stringify(requirements));
      job = await responseJson<Job>(await fetch('/api/tasks', { method: 'POST', body, signal }));
    }
    id = job.id;
    onEvents?.([{ id: 'submit', label: material.parsed ? '原文复用请求已提交' : '材料已上传', detail: material.name, status: 'done', startedAt: submittedAt, finishedAt: new Date().toISOString() }]);
    if (signal.aborted) { cancel(); throw new DOMException('已停止', 'AbortError'); }
    while (job.status === 'queued' || job.status === 'running') {
      progress(`${material.name} · ${job.phase}`);
      onEvents?.(job.events?.length ? job.events : [{ id: job.status === 'queued' ? 'queue' : `phase-${job.phase}`, label: job.phase, status: 'running', startedAt: new Date().toISOString() }]);
      await wait(signal);
      job = await responseJson<Job>(await fetch(`/api/tasks/${id}`, { signal }));
    }
    if (job.events?.length) onEvents?.(job.events);
    if (job.status !== 'succeeded' || !job.result) throw Object.assign(new Error(job.error || '本次提取已停止，可重新发送要求再试。'), { document: job.document, taskId: id });
    const result = job.result;
    return { ...material, parsed: result.document, results: fullTextOnly ? material.results || [] : mergeFields(material.results || [], result.fields, prompt), processed: true, error: undefined, outputMode, taskId: id };
  } catch (error) {
    if (!(error instanceof Error && error.name === 'AbortError')) cancel();
    if (error instanceof Error) Object.assign(error, { taskId: id });
    throw error;
  } finally { signal.removeEventListener('abort', cancel); }
}

export function releaseDocument(file: Material) {
  if (file.parsed && !file.parsed.historyId && localServicePage()) void fetch(`/api/documents/${file.parsed.id}`, { method: 'DELETE', keepalive: true }).catch(() => {});
}
