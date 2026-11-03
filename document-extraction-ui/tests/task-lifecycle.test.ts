import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { Window } from 'happy-dom';
import { useExtractionTask, type ExtractionTask } from '../src/useExtractionTask.ts';
import type { ParsedDocument, RequirementWorkbook, TaskSnapshot } from '../src/types.ts';

const workbook: RequirementWorkbook = { fileName: '字段.xlsx', sheets: [{ sheet: '字段', fields: [
  { name: '提交人', rule: '', cell: 'A2', ruleCell: null, group: '' },
] }] };
const parsed: ParsedDocument = { id: 'document-1', engine: 'mineru', tier: 'basic', extractor: 'deepseek', pages: [] };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(accept => { resolve = accept; });
  return { promise, resolve };
}

async function mountTask(run: (context: {
  task: () => ExtractionTask;
  notifications: string[];
  created: string[];
  revoked: string[];
  calls: Array<{ url: string; init?: RequestInit }>;
  respond: (handler: (url: string, init?: RequestInit) => Promise<Response>) => void;
}) => Promise<void>, autoSave = false) {
  const dom = new Window({ url: 'http://127.0.0.1:8768/' });
  const keys = ['window', 'document', 'location', 'IS_REACT_ACT_ENVIRONMENT'];
  const descriptors = keys.map(key => Object.getOwnPropertyDescriptor(globalThis, key));
  const originalFetch = globalThis.fetch;
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  const created: string[] = [], revoked: string[] = [], notifications: string[] = [];
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const history = new Map<string, TaskSnapshot>();
  const values = [dom, dom.document, new URL(dom.location.href), true];
  keys.forEach((key, index) => Object.defineProperty(globalThis, key, { configurable: true, value: values[index] }));
  URL.createObjectURL = () => { const url = `blob:test-${created.length + 1}`; created.push(url); return url; };
  URL.revokeObjectURL = url => { revoked.push(url); };
  let respond = async (url: string, _init?: RequestInit): Promise<Response> => {
    if (url === '/api/health') return Response.json({ semantic: true, extractor: 'deepseek', supportsHistory: autoSave });
    if (url === '/api/history') return Response.json([...history].map(([id, snapshot]) => ({ id, createdAt: '2026-10-30T00:00:00Z', updatedAt: '2026-10-30T00:00:00Z', files: snapshot.files })));
    if (url.startsWith('/api/history/')) {
      const id = url.split('/').at(-1)!;
      if (_init?.method === 'PUT') {
        history.set(id, JSON.parse(String(_init.body)));
        return Response.json({ id });
      }
      return Response.json({ id, snapshot: history.get(id) });
    }
    if (url === '/api/requirements/parse') return Response.json(workbook);
    if (url === '/api/tasks') return Response.json({ id: parsed.id, status: 'succeeded', phase: '完成', result: {
      document: parsed, fields: [{ key: 'submitter', name: '提交人', value: '测试人员', raw: '测试人员', page: 1,
        ref: 'p1', aliases: [], note: '', status: 'pending' }],
    } });
    if (url === `/api/documents/${parsed.id}` || url.endsWith('/cancel')) return Response.json({ ok: true });
    throw new Error(`Unexpected request: ${url}`);
  };
  globalThis.fetch = async (input, init) => {
    const url = String(input); calls.push({ url, init }); return respond(url, init);
  };
  let current!: ExtractionTask;
  function Probe() { current = useExtractionTask(text => notifications.push(text)); return null; }
  const root = createRoot(dom.document.createElement('div') as unknown as HTMLElement);
  try {
    await act(async () => { root.render(createElement(Probe)); });
    await run({ task: () => current, notifications, created, revoked, calls, respond: handler => { respond = handler; } });
  } finally {
    await act(async () => { root.unmount(); });
    await dom.happyDOM.close();
    globalThis.fetch = originalFetch;
    URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke;
    keys.forEach((key, index) => {
      if (descriptors[index]) Object.defineProperty(globalThis, key, descriptors[index]!);
      else Reflect.deleteProperty(globalThis, key);
    });
  }
}

test('移除三份附件再添加时只保留新附件，并允许重选同一文件', async () => {
  await mountTask(async ({ task, created, revoked }) => {
    const files = ['合同.pdf', '发票.pdf', '字段.xlsx'].map(name => new File(['test'], name));
    await act(async () => { await task().addFiles(files); });
    assert.deepEqual(task().files.map(file => file.name), files.map(file => file.name));
    await act(async () => { task().files.forEach(file => task().removeFile(file.id)); });
    assert.deepEqual(task().files, []);
    assert.deepEqual(revoked, created);
    await act(async () => { await task().addFiles([files[0]]); });
    assert.equal(task().files.length, 1);
    assert.equal(task().files[0].name, '合同.pdf');
    assert.equal(task().activeId, task().files[0].id);
    assert.equal(task().files[0].requirementWorkbook, undefined);
  });
});

test('删除中间附件后，新文件紧接剩余附件排列', async () => {
  await mountTask(async ({ task }) => {
    await act(async () => { await task().addFiles(['1.pdf', '2.pdf', '3.pdf'].map(name => new File(['test'], name))); });
    await act(async () => { task().removeFile(task().files[1].id); });
    await act(async () => { await task().addFiles([new File(['new'], '4.pdf')]); });
    assert.deepEqual(task().files.map(file => file.name), ['1.pdf', '3.pdf', '4.pdf']);
  });
});

test('结束任务清空附件、字段表、对话、结果、草稿和定位，同时释放材料', async () => {
  await mountTask(async ({ task, calls, created, revoked }) => {
    await act(async () => { await task().addFiles([new File(['test'], '合同.pdf'), new File(['test'], '字段.xlsx')]); });
    await act(async () => { task().setDraft('提取提交人'); });
    await act(async () => { await task().send(); });
    assert.equal(task().hasWorkspace, true);
    assert.equal(task().messages.length, 2);
    await act(async () => {
      task().selectField(task().activeFile!.results![0]); task().setPage(3); task().setDraft('未发送的修正');
    });
    await act(async () => { task().reset(); });
    assert.deepEqual(task().files, []);
    assert.deepEqual(task().messages, []);
    assert.equal(task().draft, '');
    assert.equal(task().started, false);
    assert.equal(task().hasWorkspace, false);
    assert.equal(task().busy, false);
    assert.equal(task().extracting, false);
    assert.equal(task().activeId, '');
    assert.equal(task().activeFile, undefined);
    assert.equal(task().selectedKey, null);
    assert.equal(task().selectedEvidence, null);
    assert.equal(task().page, 1);
    assert.equal(task().progress, '');
    assert.equal(task().processing, null);
    assert.deepEqual(revoked, created);
    assert(calls.some(call => call.url === '/api/documents/document-1' && call.init?.method === 'DELETE'));
  });
});

test('清空附件时使旧批次的异步文本读取失效，不回填旧附件或覆盖新上传', async () => {
  await mountTask(async ({ task }) => {
    const read = deferred<string>();
    const textFile = new File(['old'], '旧文本.txt');
    textFile.text = () => read.promise;
    let pending!: Promise<void>;
    await act(async () => { pending = task().addFiles([new File(['old'], '旧合同.pdf'), textFile, new File(['old'], '旧发票.pdf')]); });
    await act(async () => { task().removeFile(task().files[0].id); });
    await act(async () => { await task().addFiles([new File(['new'], '新合同.pdf')]); });
    await act(async () => { read.resolve('提交人：旧人员'); await pending; });
    assert.deepEqual(task().files.map(file => file.name), ['新合同.pdf']);
  });
});

test('移除其他附件不会中断保留的 Excel 字段表读取', async () => {
  await mountTask(async ({ task, respond }) => {
    const read = deferred<Response>();
    respond(async url => {
      assert.equal(url, '/api/requirements/parse'); return read.promise;
    });
    let pending!: Promise<void>;
    await act(async () => { pending = task().addFiles([new File(['test'], '合同.pdf'), new File(['test'], '字段.xlsx')]); });
    await act(async () => { task().removeFile(task().files.find(file => file.kind === 'pdf')!.id); });
    await act(async () => { read.resolve(Response.json(workbook)); await pending; });
    assert.equal(task().files.length, 1);
    assert.equal(task().files[0].requirementLoading, false);
    assert.equal(task().files[0].requirementWorkbook?.sheets[0].fields.length, 1);
  });
});

test('结束任务取消 Excel 读取，旧响应不会恢复字段表或旧批次后续附件', async () => {
  await mountTask(async ({ task, respond }) => {
    const read = deferred<Response>();
    let signal!: AbortSignal;
    respond(async (url, init) => {
      assert.equal(url, '/api/requirements/parse'); signal = init!.signal!; return read.promise;
    });
    let pending!: Promise<void>;
    await act(async () => { pending = task().addFiles([new File(['old'], '字段.xlsx'), new File(['old'], '旧合同.pdf')]); });
    await act(async () => { task().reset(); });
    assert.equal(signal.aborted, true);
    await act(async () => { await task().addFiles([new File(['new'], '新合同.pdf')]); });
    await act(async () => { read.resolve(Response.json(workbook)); await pending; });
    assert.deepEqual(task().files.map(file => file.name), ['新合同.pdf']);
  });
});

test('结束处理中任务取消请求，延迟进度与结果不会重新打开旧任务', async () => {
  await mountTask(async ({ task, respond, calls }) => {
    const submitted = deferred<Response>();
    let signal!: AbortSignal;
    respond(async (url, init) => {
      if (url === '/api/tasks') { signal = init!.signal!; return submitted.promise; }
      if (url.endsWith('/cancel')) return Response.json({ ok: true });
      throw new Error(`Unexpected request: ${url}`);
    });
    await act(async () => { await task().addFiles([new File(['test'], '合同.pdf')]); task().setDraft('提取提交人'); });
    let pending!: Promise<void>;
    await act(async () => { pending = task().send(); });
    assert.equal(task().busy, true);
    assert.equal(task().started, true);
    await act(async () => { task().reset(); });
    assert.equal(signal.aborted, true);
    await act(async () => { submitted.resolve(Response.json({ id: parsed.id, status: 'running', phase: '识别中' })); await pending; });
    assert.equal(task().busy, false);
    assert.equal(task().started, false);
    assert.equal(task().hasWorkspace, false);
    assert.deepEqual(task().files, []);
    assert.deepEqual(task().messages, []);
    assert.equal(task().progress, '');
    assert.equal(task().processing, null);
    assert(calls.some(call => call.url === '/api/tasks/document-1/cancel'));
  });
});

test('关闭仅清空首页，历史记录可重新打开原文依据、字段要求和核验值', async () => {
  await mountTask(async ({ task, calls }) => {
    await act(async () => { await task().addFiles([new File(['test'], '合同.pdf'), new File(['test'], '字段.xlsx')]); task().setDraft('提取提交人'); });
    await act(async () => { await task().send(); });
    await act(async () => {
      task().updateFields(fields => fields.map(field => ({ ...field, value: '人工修正人员', status: 'corrected', edited: true })));
      task().selectField(task().activeFile!.results![0]);
    });
    let closed = false;
    await act(async () => { closed = await task().closeTask(); });
    assert.equal(closed, true);
    assert.deepEqual(task().files, []);
    assert.equal(task().started, false);
    assert.equal(task().historyRecords.length, 1);
    const recordId = task().historyRecords[0].id;
    const callsBeforeOpen = calls.filter(call => call.url === '/api/tasks').length;
    await act(async () => { assert.equal(await task().openHistory(recordId), true); });
    assert.equal(task().hasWorkspace, true);
    assert.equal(task().messages.length, 2);
    assert.equal(task().files.find(file => file.kind === 'spreadsheet')?.requirementWorkbook?.sheets[0].fields.length, 1);
    assert.equal(task().activeFile?.results?.[0].value, '人工修正人员');
    assert.equal(task().activeFile?.results?.[0].raw, '测试人员');
    assert.equal(task().activeFile?.results?.[0].status, 'corrected');
    assert.equal(task().activeFile?.results?.[0].ref, 'p1');
    assert.equal(task().selectedKey, 'submitter');
    assert.equal(task().activeFile?.sourceFile, undefined);
    assert.equal(calls.filter(call => call.url === '/api/tasks').length, callsBeforeOpen);
    await act(async () => { task().updateFields(fields => fields.map(field => ({ ...field, value: '再次核验', status: 'confirmed' }))); });
    await act(async () => { assert.equal(await task().closeTask(), true); });
    assert.equal(task().historyRecords.length, 1, '继续核验更新同一条历史，不生成重复任务');
    await act(async () => { await task().openHistory(recordId); });
    assert.equal(task().activeFile?.results?.[0].value, '再次核验');
    assert.equal(task().activeFile?.results?.[0].status, 'confirmed');
  });
});

test('历史保存失败保留当前任务，不能清空结果后假装保存成功', async () => {
  await mountTask(async ({ task, respond, notifications }) => {
    await act(async () => { await task().addFiles([new File(['test'], '合同.pdf')]); task().setDraft('提取提交人'); });
    await act(async () => { await task().send(); });
    respond(async () => Response.json({ detail: '磁盘空间不足' }, { status: 500 }));
    await act(async () => { assert.equal(await task().closeTask(), false); });
    assert.equal(task().hasWorkspace, true);
    assert.equal(task().files.length, 1);
    assert.equal(task().messages.length, 2);
    assert.equal(task().activeFile?.results?.[0].value, '测试人员');
    assert(notifications.at(-1)?.includes('当前任务保留'));
  });
});

test('新任务单独归档，打开上一任务前先保存当前已完成结果', async () => {
  await mountTask(async ({ task }) => {
    await act(async () => { task().useSample('application'); });
    await act(async () => { await task().send(); });
    await act(async () => { await task().closeTask(); });
    const previous = task().historyRecords[0].id;
    await act(async () => { task().useSample('contract'); });
    await act(async () => { await task().send(); });
    await act(async () => { assert.equal(await task().openHistory(previous), true); });
    assert.equal(task().historyRecords.length, 2);
    assert.equal(task().activeFile?.scenario, 'application');
  });
});

test('完成提取后自动保存，后续核验自动更新同一历史记录', async () => {
  await mountTask(async ({ task, calls }) => {
    await act(async () => { await task().addFiles([new File(['test'], '合同.pdf')]); task().setDraft('提取提交人'); });
    await act(async () => { await task().send(); });
    assert.equal(task().historyRecords.length, 1);
    assert.equal(task().historyRecords[0].files[0].results?.[0].value, '测试人员');
    const originalId = task().historyRecords[0].id;
    await act(async () => { task().updateFields(fields => fields.map(field => ({ ...field, status: 'confirmed' }))); });
    assert.equal(task().historyRecords.length, 1);
    assert.equal(task().historyRecords[0].id, originalId);
    assert.equal(task().historyRecords[0].files[0].results?.[0].status, 'confirmed');
    assert.equal(calls.filter(call => call.init?.method === 'PUT').length, 2);
  }, true);
});
