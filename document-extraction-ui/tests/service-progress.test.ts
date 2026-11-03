import test from 'node:test';
import assert from 'node:assert/strict';
import { extractWithMinerU } from '../src/service.ts';
import type { ProcessingStep } from '../src/types.ts';

test('任务完成的最后一份步骤快照会传给对话，不遗漏轮询间完成的阶段', async () => {
  const originalFetch = globalThis.fetch;
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const oldLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { setTimeout: (callback: () => void) => setTimeout(callback, 0) } });
  Object.defineProperty(globalThis, 'location', { configurable: true, value: new URL('http://127.0.0.1:8768/') });
  const startedAt = '2026-10-30T00:00:00Z';
  const final: ProcessingStep[] = [
    { id: 'read', label: '已读取 8 页', status: 'done', startedAt },
    { id: 'complete', label: '已整理结果', status: 'done', startedAt },
  ];
  const responses = [
    { id: 'job', status: 'queued', phase: '等待处理', events: [] },
    { id: 'job', status: 'running', phase: '读取原文', events: [{ ...final[0], status: 'running' }] },
    { id: 'job', status: 'succeeded', phase: '已完成', events: final, result: { document: { id: 'job', pages: [] }, fields: [] } },
  ];
  let calls = 0;
  globalThis.fetch = async () => Response.json(responses[calls++]);
  const snapshots: ProcessingStep[][] = [];
  try {
    const result = await extractWithMinerU({ id: 'file', name: 'sample.pdf', kind: 'pdf', size: 4, results: null, sourceFile: new File(['test'], 'sample.pdf') },
      '提取合同名称', new AbortController().signal, () => {}, true, undefined, events => snapshots.push(events));
    assert.equal(result.processed, true);
    assert.equal(calls, 3);
    assert.deepEqual(snapshots.at(-1), final);
    assert(snapshots.some(events => events[0].id === 'submit' && events[0].status === 'done'));
  } finally {
    globalThis.fetch = originalFetch;
    if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow); else delete (globalThis as Record<string, unknown>).window;
    if (oldLocation) Object.defineProperty(globalThis, 'location', oldLocation); else delete (globalThis as Record<string, unknown>).location;
  }
});
