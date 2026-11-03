import test from 'node:test';
import assert from 'node:assert/strict';
import { documentOutputMode } from '../src/documentIntent.ts';
import { runLocalTurn } from '../src/conversation.ts';
import { personalHistory, needsReview } from '../src/personalHistory.ts';
import { extractWithMinerU } from '../src/service.ts';
import type { Material, SavedTaskSummary } from '../src/types.ts';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { build, stop } from 'esbuild';

test('全文转换是独立意图；字段、组合请求及普通问答不会混淆', () => {
  assert.equal(documentOutputMode('把这份 PDF 全文转成 Markdown'), 'fulltext');
  assert.equal(documentOutputMode('全文转写'), 'fulltext');
  assert.equal(documentOutputMode('提取金额，同时把全文导出为 Markdown'), 'both');
  assert.equal(documentOutputMode('提取金额，不需要 Markdown'), 'fields');
  assert.equal(documentOutputMode('怎么转换 Markdown？'), 'fields');
  assert.equal(runLocalTurn('全文转写', [], '', null).kind, 'chat');
  assert.equal(runLocalTurn('全文转 Markdown', [{ id: 'word', name: '文档.docx', kind: 'word', size: 1, results: null }], 'word', null).kind, 'chat');
  const file: Material = { id: 'text', name: 'test.txt', kind: 'text', size: 10, text: '# 测试\n全部原文', results: null };
  const turn = runLocalTurn('全文转成 Markdown', [file], 'text', null);
  assert.equal(turn.materials[0].fullText, file.text);
  assert.equal(turn.materials[0].results, null);
});

test('个人历史合并当前任务与保存记录，排除未提交附件，不带入API统计', () => {
  const completed: Material = { id: 'a', name: '合同.pdf', kind: 'pdf', size: 1, processed: true, results: [{ key: 'a', name: '金额', raw: '10', value: '10', status: 'pending', page: 1, ref: 'a', note: '', aliases: [] }] };
  const records: SavedTaskSummary[] = [{ id: 'saved', createdAt: '2026-11-02T00:00:00Z', updatedAt: '2026-11-02T01:00:00Z', files: [completed] }];
  const current = { ...completed, results: completed.results!.map(field => ({ ...field, status: 'confirmed' as const })) };
  const draft: Material = { id: 'b', name: '尚未提交.pdf', kind: 'pdf', size: 1, results: null };
  const rows = personalHistory(records, [current, draft], false, '', true);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].current, true);
  assert.equal(rows[0].timestamp, records[0].createdAt);
  assert.equal(needsReview(rows[0]), false);
  assert.equal(needsReview(personalHistory(records, [], false, '', false)[0]), true);
  const active = personalHistory(records, [draft], true, '尚未提交.pdf · 正在识别', true);
  assert.equal(active.length, 2);
  assert.equal(active[0].status, '处理中');
});

test('仅全文请求不要求字段或模型，已有原文可复用，并保留人工核定值', async () => {
  const fetchOriginal = globalThis.fetch;
  const locationOriginal = Object.getOwnPropertyDescriptor(globalThis, 'location');
  Object.defineProperty(globalThis, 'location', { configurable: true, value: new URL('http://127.0.0.1:8768/') });
  let body: Record<string, unknown> = {};
  const file: Material = { id: 'a', name: 'a.pdf', kind: 'pdf', size: 1, parsed: { id: 'document', engine: 'MinerU', tier: 'basic', extractor: 'deepseek', pages: [] }, results: [{ key: 'a', name: '金额', value: '20', raw: '10', status: 'corrected', page: 1, ref: 'a', note: '', aliases: [] }] };
  try {
    globalThis.fetch = async (url, init) => {
      assert.equal(String(url), '/api/documents/document/extract');
      body = JSON.parse(String(init?.body));
      return Response.json({ id: 'document', status: 'succeeded', result: { document: file.parsed, fields: [] } });
    };
    const converted = await extractWithMinerU(file, '全文转 Markdown', new AbortController().signal, () => {}, false, undefined, undefined, 'fulltext');
    assert.equal(body.outputMode, 'fulltext');
    assert.deepEqual(body.fields, []);
    assert.equal(converted.outputMode, 'fulltext');
    assert.equal(converted.results![0].value, '20');
    assert.equal(converted.results![0].status, 'corrected');
  } finally {
    globalThis.fetch = fetchOriginal;
    if (locationOriginal) Object.defineProperty(globalThis, 'location', locationOriginal); else Reflect.deleteProperty(globalThis, 'location');
  }
});

test('全文预览保留标题和合并表格，只加载归档图片并移除可执行内容', async () => {
  const temporary = await mkdtemp(path.join(process.cwd(), '.fulltext-qa-'));
  try {
    const output = path.join(temporary, 'preview.mjs');
    await build({ entryPoints: ['src/components/FullTextPanel.tsx'], outfile: output, bundle: true, packages: 'external', format: 'esm', platform: 'node', loader: { '.css': 'empty' }, logLevel: 'silent' });
    const { FullTextDocument } = await import(pathToFileURL(output).href);
    const markdown = '# 文档标题\n\n<table><tr><td rowspan="2" colspan="3">金额</td></tr></table>\n\n![附图](images/test.png)\n\n![外部图片](https://example.com/track.png)\n\n<script>alert(1)</script><img src="images/test.png" onerror="alert(1)"/><a href="javascript:alert(1)">恶意链接</a>';
    const html = renderToStaticMarkup(createElement(FullTextDocument, { markdown, assetBaseUrl: '/api/history/record/files/file/fulltext/' }));
    assert.match(html, /<h1>文档标题<\/h1>/);
    assert.match(html, /rowSpan="2"/i);
    assert.match(html, /colSpan="3"/i);
    assert.match(html, /src="\/api\/history\/record\/files\/file\/fulltext\/images\/test.png"/);
    assert.doesNotMatch(html, /<script|onerror|javascript:|https:\/\/example.com\/track/i);
    const untrusted = renderToStaticMarkup(createElement(FullTextDocument, { markdown: '![附图](images/test.png)', assetBaseUrl: 'https://example.com/' }));
    assert.doesNotMatch(untrusted, /<img/);
  } finally { await rm(temporary, { recursive: true, force: true }); stop(); }
});
