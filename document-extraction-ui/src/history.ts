import type { SavedTaskSummary, TaskSnapshot } from './types.ts';

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(typeof error.detail === 'string' ? error.detail : '历史记录服务暂不可用，请稍后重试。');
  }
  return response.json();
}
export function listHistory(signal?: AbortSignal) { return json<SavedTaskSummary[]>('/api/history', { signal }); }
export function readHistory(id: string) {
  return json<{ id: string; snapshot: TaskSnapshot }>(`/api/history/${encodeURIComponent(id)}`);
}
export function saveHistory(id: string, snapshot: TaskSnapshot) {
  const files = snapshot.files.filter(file => file.processed || file.error || file.kind === 'spreadsheet').map(file => {
    const { sourceFile: _sourceFile, url: _url, ...saved } = file;
    return saved;
  });
  return json<{ id: string }>(`/api/history/${encodeURIComponent(id)}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...snapshot, files }),
  });
}
