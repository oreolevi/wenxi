import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoApi } from '../src/demo/api.ts';
import type { ProfileRecord } from '../src/profiles.ts';
const post = (value: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(value) });

test('demo uploads return fictional content, never parse or persist uploaded bytes', async () => {
  const saved = new Map<string, string>();
  const api = createDemoApi({ getItem: k => saved.get(k) || null, setItem: (k, v) => { saved.set(k, v); } });
  const form = new FormData(); form.append('file', new File(['SECRET-CUSTOMER-CONTENT'], '合同.pdf'));
  const job = await (await api('/api/tasks', { method: 'POST', body: form })).json();
  let result;
  for (let i = 0; i < 3; i++) result = await (await api(`/api/tasks/${job.id}`)).json();
  assert.equal(result.status, 'succeeded');
  assert.match(result.result.fields[0].value, /DEMO/);
  assert.ok(result.result.fields.every((f: { evidence: unknown[] }) => f.evidence.length));
  assert.ok(![...saved.values()].join('').includes('SECRET-CUSTOMER-CONTENT'));
  const fulltext = await (await api(result.result.document.fullText.url)).json();
  assert.match(fulltext.markdown, /虚构/);
});

test('demo service editing, test, release and version snapshot survive browser reload', async () => {
  const store = new Map<string, string>();
  const storage = { getItem: (k: string) => store.get(k) || null, setItem: (k: string, v: string) => { store.set(k, v); } };
  const api = createDemoApi(storage);
  const record: ProfileRecord = await (await api('/api/extraction-profiles/demo-service-invoice')).json();
  record.draft.name = '演示服务新名称';
  await api(`/api/extraction-profiles/${record.draft.id}`, { ...post(record.draft), method: 'PUT' });
  const t = record.draft.templates[0];
  const trial = await (await api(`/api/extraction-profiles/${record.draft.id}/test`, post({ sampleId: t.sampleId, templateId: t.id }))).json();
  assert.equal(trial.passed, true);
  const release = await (await api(`/api/extraction-profiles/${record.draft.id}/publish`, post({}))).json();
  assert.equal(release.versions.at(-1), '1.0.1');
  record.draft.name = '后续草稿';
  await api(`/api/extraction-profiles/${record.draft.id}`, { ...post(record.draft), method: 'PUT' });
  const reloaded = createDemoApi(storage);
  const snapshot = await (await reloaded(`/api/extraction-profiles/${record.draft.id}/versions/1.0.1`)).json();
  assert.equal(snapshot.name, '演示服务新名称');
  assert.equal((await (await reloaded(`/api/extraction-profiles/${record.draft.id}`)).json()).draft.name, '后续草稿');
});

test('empty demo service is blocked with an actionable release check', async () => {
  const api = createDemoApi();
  await api('/api/extraction-profiles/new', { ...post({ id: 'new', name: '新演示', description: '', templates: [] }), method: 'PUT' });
  const report = await (await api('/api/extraction-profiles/new/release-check')).json();
  assert.equal(report.ready, false);
  assert.ok(report.issues.some((i: { code: string }) => i.code === 'sample'));
  assert.equal((await api('/api/extraction-profiles/new/publish', post({}))).status, 400);
});

test('scene can simulate both contract and invoice in one bundle', async () => {
  const api = createDemoApi();
  const result = await (await api('/api/studio/scenes/demo-scene-payment/debug-bundle', { method: 'POST', body: new FormData() })).json();
  assert.equal(result.passed, true);
  assert.equal(result.items.length, 2);
  assert.equal((await (await api('/api/studio/scenes/demo-scene-payment/publish', post({}))).json()).versions.length, 1);
});

test('unknown demo API never reaches a real endpoint; cancelled jobs do not complete', async () => {
  const api = createDemoApi();
  assert.equal((await api('/api/reviews/optimization-20261030')).status, 404);
  const form = new FormData(); form.append('file', new File([''], 'demo.pdf'));
  const job = await (await api('/api/tasks', { method: 'POST', body: form })).json();
  await api(`/api/tasks/${job.id}/cancel`, post({}));
  for (let i = 0; i < 4; i++) assert.equal((await (await api(`/api/tasks/${job.id}`)).json()).status, 'cancelled');
});
