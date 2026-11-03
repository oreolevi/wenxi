import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { MessageChannel } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';
import { act, createElement } from 'react';
import { Window } from 'happy-dom';
import { build, stop } from 'esbuild';

test('Studio 默认我的场景，目录并列、帮助侧栏和标题栏操作不影响配置、回放与发布', async () => {
  const temporary = await mkdtemp(path.join(process.cwd(), '.profile-qa-'));
  const output = path.join(temporary, 'workspace.mjs');
  const dom = new Window({ url: 'http://127.0.0.1:8768/?page=profiles' });
  const properties = ['window', 'document', 'location', 'navigator', 'HTMLElement', 'Element', 'SVGElement', 'ShadowRoot', 'Node', 'Document',
    'MutationObserver', 'ResizeObserver', 'MessageChannel', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'IS_REACT_ACT_ENVIRONMENT'];
  const originals = properties.map(key => Object.getOwnPropertyDescriptor(globalThis, key));
  const originalFetch = globalThis.fetch;
  const channels: MessageChannel[] = [];
  class TestMessageChannel extends MessageChannel { constructor() { super(); channels.push(this); } }
  let root: import('react-dom/client').Root | undefined;
  try {
    properties.forEach(key => {
      const value = key === 'window' ? dom : key === 'location' ? dom.location : key === 'IS_REACT_ACT_ENVIRONMENT' ? true : key === 'MessageChannel' ? TestMessageChannel
        : ['getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame'].includes(key) ? (dom as unknown as Record<string, Function>)[key].bind(dom)
        : (dom as unknown as Record<string, unknown>)[key];
      Object.defineProperty(globalThis, key, { configurable: true, value });
    });
    dom.localStorage.setItem('wenxi-studio-last-parser', 'profile-a');
    const sample = { id: 'sample-a', name: '虚构发票.pdf', engine: 'PDF 文字层', sourceHash: 'test',
      pages: [1, 2].map(number => ({ number, width: 800, height: 600, imageUrl: '/page.png', originalImageUrl: '/original.png', originalWidth: 600, originalHeight: 800, toOriginal: [[0, -1, 1], [1, 0, 0], [0, 0, 1]], steps: [{ tool: 'orientation', status: 'applied', label: '逆时针转正 90°' }] })),
      blocks: [{ ref: 'value', text: '123.45', bbox: [.4, .6, .6, .65], pageIndex: 0, blockIndex: 1 }] };
    let record: import('../src/profiles.ts').ProfileRecord = { draft: { id: 'profile-a', name: '发票服务', description: '', samples: [], templates: [{ id: 'template-a', name: '版式 A', sampleId: 'sample-a', matchTexts: ['电子发票'], fields: [
      { id: 'total', key: 'total', name: '价税合计', kind: 'amount', method: 'region', page: 1, region: null, anchor: '', direction: 'right', required: true },
    ] }] }, createdAt: '2026-10-30T00:00:00Z', updatedAt: '2026-10-30T00:00:00Z', versions: [] };
    const calls: string[] = [];
    let saveGate: Promise<void> | undefined; let failNextSave = false;
    let composition: import('../src/studio.ts').SceneRecord | undefined;
    let modelAttempts = 0; let releaseNote = '';
    const uploaded = new Map<string, typeof sample>(); let counter = 0;
    let publicEntries: import('../src/profiles.ts').SharedScene[] = [];
    let reviews: import('../src/profiles.ts').PublicationReview[] = [];
    let pendingEntry: import('../src/profiles.ts').SharedScene;
    let pendingDraft: import('../src/profiles.ts').ProfileDraft;
    const publicDrafts = new Map<string, import('../src/profiles.ts').ProfileDraft>();
    let reports: import('../src/profiles.ts').EvaluationReport[] = [];
    const resultFor = (sampleId: string): import('../src/profiles.ts').ProfileTest => ({ templateId: record.draft.templates[0].id, templateName: '版式 A', sampleId, scope: 'new-sample', testedAt: record.updatedAt, passed: true, usesLlm: false, engine: 'PDF 文字层', elapsedMs: 1,
      fields: [{ key: 'total', name: '价税合计', value: '123.45', raw: '123.45', status: 'matched', issue: '', page: 1, bbox: [.4, .6, .6, .65], evidence: [] }] });
    globalThis.fetch = async (input, init) => {
      const url = String(input); calls.push(`${init?.method || 'GET'} ${url}`);
      if (url === '/api/scene-publication-reviews') return Response.json(reviews);
      if (url.endsWith('/decision')) {
        const decision = JSON.parse(String(init!.body)); reviews = reviews.map(item => ({ ...item, status: decision.decision, reviewer: decision.reviewer, comment: decision.comment }));
        publicEntries = [pendingEntry, { ...pendingEntry, id: 'shared-other', profileId: 'other-profile', name: '其他发布人的场景', publisher: '另一测试发布人' }]; publicDrafts.set(pendingEntry.id, pendingDraft); return Response.json(reviews[0]);
      }
      if (url === '/api/scene-library') return Response.json(publicEntries);
      if (url.startsWith('/api/scene-library/')) { const entry = publicEntries.find(item => item.id === url.split('/').at(-1)); return Response.json({ ...entry, draft: publicDrafts.get(entry!.id) }); }
      if (url.endsWith('/share')) {
        const body = JSON.parse(String(init!.body)); const draft = structuredClone(record.publishedDraft!);
        const entry: import('../src/profiles.ts').SharedScene = { id: 'shared-1', profileId: draft.id, name: draft.name, description: draft.description, version: body.version, publisher: body.publisher, team: body.team, publishedAt: record.updatedAt, templates: draft.templates.length, fields: draft.templates.flatMap(item => item.fields.map(field => ({ key: field.key, name: field.name, kind: field.kind }))), inputs: ['PDF'], endpoint: `/api/extraction-profiles/${draft.id}/execute` };
        pendingEntry = entry; pendingDraft = draft; reviews = [{ id: 'review-1', profileId: draft.id, name: draft.name, description: draft.description, version: body.version, publisher: body.publisher, team: body.team, status: 'pending', submittedAt: record.updatedAt, reviewedAt: null, reviewer: '', comment: '', entryId: entry.id, mock: true }]; return Response.json(reviews[0]);
      }
      if (url === '/api/studio/scenes/scene-a' && init?.method === 'PUT') { composition = { draft: JSON.parse(String(init.body)), versions: composition?.versions || [], updatedAt: record.updatedAt }; return Response.json(composition); }
      if (url === '/api/studio/scenes/scene-a/debug-bundle') { const test = resultFor('sample-a'); const item = { ...test, sampleId: 'sample-a', sourceName: '业务发票.pdf', sourceIndex: 0, pages: [1], materialTypeId: 'invoices', materialTypeName: '发票', status: 'succeeded', data: { total: '123.45' } }; const result: import('../src/studio.ts').CompositionResult = { elapsedMs: 1, passed: true, usesLlm: false, totalElapsedMs: 12, items: [item], issues: [], missingTypes: [], summary: { files: 1, total: 1, succeeded: 1, failed: 0 }, files: [], data: { invoices: [{ total: '123.45' }] } }; composition!.lastTest = { passed: true, testedAt: record.updatedAt, result }; return Response.json(result); }
      if (url === '/api/studio/scenes/scene-a/release-check') return Response.json({ ready: !!composition?.lastTest?.passed, unchanged: false, nextVersion: '1.0.0', currentVersion: '', issues: composition?.lastTest?.passed ? [] : [{ code: 'test', title: '完成整包联调', detail: '请先完成当前组合的整包联调', target: { area: 'test' } }] });
      if (url === '/api/studio/scenes/scene-a/publish') { composition!.versions = ['1.0.0']; composition!.publishedDraft = structuredClone(composition!.draft); return Response.json(composition); }
      if (url === '/api/studio/scenes/scene-a') return Response.json(composition ||= { draft: { id: 'scene-a', name: '付款场景', description: '', bindings: [{ id: 'invoices', name: '发票', parserId: record.draft.id, version: record.versions.at(-1) || '', required: true, multiple: true }] }, versions: [], updatedAt: record.updatedAt });
      if (url === '/api/studio/catalog') return Response.json({ scenes: [{ id: 'scene-a', name: '付款场景', description: '', bindings: 1, versions: [], updatedAt: record.updatedAt, hasUnpublishedChanges: true }], parsers: [{ id: record.draft.id, name: record.draft.name, description: '', templates: record.draft.templates.length, fields: record.draft.templates[0]?.fields.length || 0, versions: record.versions, updatedAt: record.updatedAt, hasUnpublishedChanges: false }] });
      if (url === '/api/extraction-profiles') return Response.json([{ id: record.draft.id, name: record.draft.name, description: '', templates: record.draft.templates.length, fields: record.draft.templates.reduce((sum, item) => sum + item.fields.length, 0), versions: record.versions, updatedAt: record.updatedAt, hasUnpublishedChanges: false }]);
      if (url === '/api/profile-sample-bundles') {
        const recognized = ['电子发票', '采购合同'].map((title, index) => ({ ...structuredClone(sample), id: `bundle-${index}`, name: index ? '合同样例.pdf' : '发票样例.pdf', blocks: [{ ref: 'title', text: title, bbox: [.1, .04, .6, .1], pageIndex: 0, blockIndex: 0 }, ...sample.blocks] }));
        recognized.forEach(value => uploaded.set(value.id, value)); return Response.json({ samples: recognized, failures: [] });
      }
      if (url.endsWith('/debug-bundle')) {
        const items = record.draft.templates.map((template, index) => ({ ...resultFor(template.sampleId), templateId: template.id, templateName: template.name, sourceName: uploaded.get(template.sampleId)!.name, sourceIndex: index, sampleId: template.sampleId, materialTypeId: template.materialTypeId, materialTypeName: record.draft.materialTypes!.find(kind => kind.id === template.materialTypeId)!.name, pages: [1], status: 'succeeded', data: { total: '123.45' } }));
        return Response.json({ passed: true, usesLlm: false, totalElapsedMs: 10, elapsedMs: 1, items, missingTypes: [], data: { invoices: [{ total: '123.45' }], contracts: [{ total: '123.45' }] }, summary: { files: 2, total: 2, succeeded: 2, failed: 0 }, files: items.map(item => ({ name: item.sourceName, sampleId: item.sampleId, result: { ...item, items: [item] } })) });
      }
      if (/^\/api\/profile-samples\/[^/]+$/.test(url)) return Response.json(uploaded.get(url.split('/').at(-1)!) || sample);
      if (/^\/api\/extraction-profiles\/[^/]+$/.test(url)) {
        if (init?.method === 'PUT') {
          const gate = saveGate; saveGate = undefined;
          if (gate) await gate;
          if (failNextSave) { failNextSave = false; return Response.json({ detail: '保存服务暂时不可用' }, { status: 503 }); }
          const body = JSON.parse(String(init.body)) as import('../src/profiles.ts').ProfileDraft;
          body.templates.forEach(item => item.fields.forEach(field => { field.stripLabel ??= false; })); body.samples ??= [];
          record = body.id === record.draft.id ? { ...record, draft: body } : { ...record, draft: body, versions: [], lastTest: undefined, publishedDraft: undefined };
        }
        return Response.json(record);
      }
      if (url.endsWith('/test')) { const result = resultFor(JSON.parse(String(init!.body)).sampleId); record.lastTest = { hash: 'hash', templates: { [record.draft.templates[0].id]: result } }; return Response.json(result); }
      if (url.endsWith('/release-check')) {
        const issues: import('../src/release.ts').ReleaseReport['issues'] = [];
        for (const t of record.draft.templates) {
          const field = t.fields.find(f => !f.region || f.review === 'pending');
          if (field) issues.push({ code: 'field', title: `${t.name}：字段待处理`, detail: field.name, target: { area: 'fields', templateId: t.id, fieldId: field.id } });
          else if (!record.lastTest?.templates[t.id]?.passed) issues.push({ code: 'test', title: `${t.name}：完成测试`, detail: '请测试当前配置', target: { area: 'test', templateId: t.id } });
        }
        return Response.json({ ready: !issues.length, unchanged: false, currentVersion: record.versions.at(-1) || '', nextVersion: '1.0.0', issues });
      }
      if (url.endsWith('/publish')) { releaseNote = JSON.parse(String(init!.body)).note; record.versions = ['1.0.0']; record.publishedDraft = structuredClone(record.draft); return Response.json(record); }
      if (url.endsWith('/releases')) return Response.json(record.versions.map(version => ({ version, publishedAt: record.createdAt, templates: record.publishedDraft!.templates.length, fields: record.publishedDraft!.templates[0].fields.length, tests: { passed: 1, total: 1 }, note: releaseNote })));
      if (url.includes('/versions/')) return Response.json(record.publishedDraft);
      if (url.endsWith('/runs')) return Response.json([]);
      if (url.endsWith('/evaluations')) {
        if (init?.method === 'POST') {
          const ids: string[] = JSON.parse(String(init.body)).sampleIds;
          const report: import('../src/profiles.ts').EvaluationReport = { id: 'report-1', profileId: record.draft.id, createdAt: record.updatedAt, hash: 'hash', draft: structuredClone(record.draft), mode: 'rule_replay', usesLlm: false, passed: true,
            summary: { total: ids.length, passed: ids.length, failed: 0, totalFields: ids.length, matchedFields: ids.length, ruleP95Ms: 1, elapsedMs: 2 },
            rows: ids.map(id => ({ sampleId: id, name: uploaded.get(id)?.name || '样例.pdf', passed: true, result: resultFor(id), totalFields: 1, matchedFields: 1, elapsedMs: 1, error: '' })) };
          reports = [report]; record.lastEvaluation = report; record.lastTest = { hash: 'hash', templates: { [record.draft.templates[0].id]: resultFor(ids[0]) } }; return Response.json(report);
        }
        return Response.json(reports);
      }
      if (url.endsWith('/evaluations/report-1')) return Response.json(reports[0]);
      if (url === '/api/tasks') {
        assert.equal((init!.body as FormData).get('ocr_only'), 'true');
        const name = ((init!.body as FormData).get('file') as File).name;
        const id = `sample-${++counter}`; uploaded.set(id, { ...structuredClone(sample), id, name }); return Response.json({ id });
      }
      if (url.startsWith('/api/tasks/')) return Response.json({ status: 'succeeded', phase: '已准备原文' });
      if (url.startsWith('/api/profile-samples/from-task/')) return Response.json(uploaded.get(url.split('/').at(-1)!));
      if (url.startsWith('/api/documents/') && init?.method === 'DELETE') return Response.json({ deleted: true });
      if (url.endsWith('/assist-rules')) {
        modelAttempts++;
        const body = JSON.parse(String(init!.body));
        assert.equal(body.request, '提取价税合计');
        assert(Array.isArray(body.fields) && Array.isArray(body.history), '助手携带当前规则与对话上下文');
        if (modelAttempts === 1) return Response.json({ detail: 'AI 配置生成超时' }, { status: 422 });
        return Response.json({ message: '建议增加价税合计字段，请先预览位置再应用。', changes: [{ op: 'add', id: 'total', before: null, after: { id: 'total', key: 'total', name: '价税合计', kind: 'amount', method: 'region', page: 1, region: [.4, .6, .6, .65], anchor: '', direction: 'right', required: true, stripLabel: false, origin: 'ai', review: 'pending' }, check: { value: '123.45', status: 'matched', issue: '' } }], usesLlm: true, modelCall: { model: 'fixture', elapsedMs: 20 } });
      }
      if (url.endsWith('/preview-rule')) {
        if (!JSON.parse(String(init!.body)).rule.id) return Response.json({ detail: '字段标识缺失' }, { status: 422 });
        return Response.json({ key: 'total', name: '价税合计', value: '123.45', raw: '123.45', status: 'matched', issue: '', page: 1, bbox: [.4, .6, .6, .65], evidence: [] });
      }
      throw new Error(`Unexpected request: ${url}`);
    };
    await build({ entryPoints: ['src/components/ProfilesWorkspace.tsx'], outfile: output, bundle: true, packages: 'external', format: 'esm', platform: 'node', logLevel: 'silent', loader: { '.md': 'text', '.svg': 'dataurl' } });
    const { ProfilesWorkspace } = await import(pathToFileURL(output).href);
    const { createRoot } = await import('react-dom/client');
    const { App: AntApp, ConfigProvider } = await import('antd');
    const container = dom.document.createElement('div'); dom.document.body.append(container);
    root = createRoot(container as unknown as HTMLElement);
    const render = (visible: boolean, entryKey = 0) => createElement(ConfigProvider, { theme: { token: { motion: false } } }, createElement(AntApp, { message: { duration: 0 } }, createElement(ProfilesWorkspace, { visible, seed: null, entryKey })));
    await act(async () => { root!.render(render(true)); });
    assert(container.querySelector('.service-project-grid'), '默认直接显示我的场景列表');
    assert(!container.querySelector('.studio-home-entries'));
    assert(!calls.includes('GET /api/extraction-profiles/profile-a'), '进入目录不会自动打开自己的记录或样例');
    assert(!container.querySelector('.studio-stage-tabs'));
    const byText = (label: string) => Array.from(dom.document.querySelectorAll('button')).find(button => button.textContent.trim() === label);
    assert(!Array.from(container.querySelectorAll('.scene-directory .platform-toolbar button')).some(button => button.textContent.includes('AI 辅助创建')), '创建入口只保留在标题栏');
    const callsBeforeCreation = calls.length;
    await act(async () => { byText('新建场景')!.click(); });
    const creationModes = () => dom.document.querySelectorAll('.scene-creation-modes>button');
    assert.equal(creationModes()[0].getAttribute('aria-pressed'), 'true', '每次新建默认 AI 辅助');
    assert(dom.document.querySelector('.scene-creation-form')!.firstElementChild?.classList.contains('scene-creation-modes'), '方式选择位于表单顶部');
    const typeCreation = async (label: string, value: string) => { await act(async () => {
      const input = dom.document.querySelector(`[aria-label="${label}"]`)!;
      const prototype = input.tagName === 'TEXTAREA' ? dom.HTMLTextAreaElement.prototype : dom.HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(input, value);
      input.dispatchEvent(new dom.Event('input', { bubbles: true }));
    }); };
    await typeCreation('新场景名称', '保留的名称'); await typeCreation('新场景描述', '保留的需求');
    await act(async () => { (creationModes()[1] as unknown as HTMLButtonElement).click(); });
    assert.equal(creationModes()[1].getAttribute('aria-pressed'), 'true');
    assert.equal((dom.document.querySelector('[aria-label="新场景名称"]') as unknown as HTMLInputElement).value, '保留的名称');
    await act(async () => { (creationModes()[0] as unknown as HTMLButtonElement).click(); });
    assert.equal((dom.document.querySelector('[aria-label="新场景描述"]') as unknown as HTMLTextAreaElement).value, '保留的需求');
    assert.equal(calls.length, callsBeforeCreation, '打开创建和切换方式不自动调用 AI 或创建记录');
    await act(async () => { dom.document.querySelector('.ant-drawer-footer button')!.dispatchEvent(new dom.MouseEvent('click', { bubbles: true })); });
    await act(async () => { byText('新建场景')!.click(); });
    assert.equal(creationModes()[0].getAttribute('aria-pressed'), 'true');
    assert.equal((dom.document.querySelector('[aria-label="新场景名称"]') as unknown as HTMLInputElement).value, '', '重新新建清空上一次取消的内容');
    await act(async () => { dom.document.querySelector('.ant-drawer-footer button')!.dispatchEvent(new dom.MouseEvent('click', { bubbles: true })); });
    const directory = async (key: string) => { await act(async () => { container.querySelector(`.studio-directory-tabs [data-node-key="${key}"]`)?.dispatchEvent(new dom.MouseEvent('click', { bubbles: true })); }); };
    const back = async () => { await act(async () => { container.querySelector('[aria-label="返回我的服务"]')?.dispatchEvent(new dom.MouseEvent('click', { bubbles: true })); }); };
    assert.equal(container.querySelectorAll('.studio-directory-tabs [role="tab"]').length, 3, '场景、服务、公共服务库并列');
    assert(container.querySelector('.studio-directory-tabs [data-node-key="mine"] [aria-selected="true"]'));
    await act(async () => { container.querySelector('[aria-label="打开场景 付款场景"]')!.dispatchEvent(new dom.MouseEvent('click', { bubbles: true })); });
    assert(container.querySelector('.scene-composition'), '场景进入轻量组合页面');
    assert(!container.querySelector('.studio-editor-splitter'), '场景不直接编辑字段规则');
    assert(!container.querySelector('.scene-composition-page .scene-intro-copy'), '移除常驻说明文案');
    assert(!container.querySelector('.scene-binding input'), '场景卡片不常驻名称和版本表单');
    await act(async () => { container.querySelector('[aria-label="服务编排说明"]')!.dispatchEvent(new dom.MouseEvent('click', { bubbles: true })); });
    assert(dom.document.querySelector('.studio-context-help-content')?.textContent.includes('合同、发票和报关单'));
    await act(async () => { container.querySelector('[aria-label="服务编排说明"]')!.dispatchEvent(new dom.MouseEvent('click', { bubbles: true })); });
    const openReference = async () => { await act(async () => { container.querySelector('[aria-label="服务引用设置 发票"]')!.dispatchEvent(new dom.MouseEvent('click', { bubbles: true })); }); };
    const renameReference = async (value: string) => { await act(async () => {
      const input = dom.document.querySelector('[aria-label="场景内服务名称"]')!;
      Object.getOwnPropertyDescriptor(dom.HTMLInputElement.prototype, 'value')!.set!.call(input, value);
      input.dispatchEvent(new dom.Event('input', { bubbles: true }));
    }); };
    await openReference(); await renameReference('取消的名称');
    await act(async () => { dom.document.querySelectorAll('.scene-service-settings .ant-drawer-footer button')[0]!.dispatchEvent(new dom.MouseEvent('click', { bubbles: true })); });
    assert(!container.querySelector('.scene-binding')?.textContent.includes('取消的名称'), '取消引用设置不修改场景');
    await openReference(); await renameReference('业务发票');
    await act(async () => { dom.document.querySelectorAll('.scene-service-settings .ant-drawer-footer button')[1]!.dispatchEvent(new dom.MouseEvent('click', { bubbles: true })); });
    assert(container.querySelector('.scene-binding')?.textContent.includes('业务发票'));

    await act(async () => { byText('配置服务')!.click(); });
    assert(container.querySelector('[aria-label="返回场景组合"]'), '从场景编辑服务保留返回上下文');
    await act(async () => { container.querySelector('[aria-label="返回场景组合"]')!.dispatchEvent(new dom.MouseEvent('click', { bubbles: true })); });
    assert(container.querySelector('.scene-composition'));
    await act(async () => { byText('我的场景')!.click(); });
    await directory('parsers');
    assert.equal(Array.from(container.querySelectorAll('button')).find(button => button.textContent.trim() === '申请公开')?.disabled, true, '草稿先发布版本，才能申请公开');
    assert(!container.querySelector('button button'), '卡片操作保持独立按钮，不嵌套交互元素');
    await act(async () => { container.querySelector('[aria-label="Studio 帮助"]')?.dispatchEvent(new dom.MouseEvent('click', { bubbles: true })); });
    assert(dom.document.querySelector('.help-center'), '帮助单击即打开完整指南');
    assert.equal(dom.document.querySelector('[role="menu"]'), null, '只有一项帮助时不再经过菜单');
    assert(container.querySelector('.service-project-grid'), '指南在侧栏打开，保留目录上下文');
    const productAddress = dom.location.href; const callsBeforeReading = calls.length;
    await act(async () => { dom.document.querySelector('.help-navigation a[href="?page=help&doc=api"]')!.dispatchEvent(new dom.MouseEvent('click', { bubbles: true, cancelable: true })); });
    assert.equal(dom.document.querySelector('.help-article h1')?.textContent, 'API 接入');
    assert(dom.document.querySelector('.help-code')?.textContent.includes('YOUR_SERVICE_ID'), '接口示例从文档正文呈现');
    await act(async () => { dom.document.querySelector('.help-search-trigger')!.dispatchEvent(new dom.MouseEvent('click', { bubbles: true })); });
    await act(async () => {
      const input = dom.document.querySelector('[aria-label="搜索使用指南"]')!;
      Object.getOwnPropertyDescriptor(dom.HTMLInputElement.prototype, 'value')!.set!.call(input, '未定位');
      input.dispatchEvent(new dom.Event('input', { bubbles: true }));
    });
    assert(dom.document.querySelector('.help-search-results')?.textContent.includes('检查发布条件'));
    const releaseResultIndex = Array.from(dom.document.querySelectorAll('.help-search-results>a')).findIndex(link => link.getAttribute('href')?.includes('doc=testing'));
    assert(releaseResultIndex >= 0, '搜索包含发布条件文档');
    for (let index = 0; index < releaseResultIndex; index++) {
      await act(async () => { dom.document.querySelector('[aria-label="搜索使用指南"]')!.dispatchEvent(new dom.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); });
    }
    await act(async () => { dom.document.querySelector('[aria-label="搜索使用指南"]')!.dispatchEvent(new dom.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
    assert.equal(dom.document.querySelector('.help-article h1')?.textContent, '测试与发布', '键盘搜索跳转到对应指南');
    assert.equal(dom.location.href, productAddress, '内嵌阅读不覆盖产品当前地址');
    assert.equal(calls.length, callsBeforeReading, '查阅帮助不调用模型或修改用户记录');
    await act(async () => { dom.document.querySelector('.studio-guide-drawer .help-return')?.dispatchEvent(new dom.MouseEvent('click', { bubbles: true })); });
    await act(async () => { container.querySelector('[aria-label="编辑服务 发票服务"]')?.dispatchEvent(new dom.MouseEvent('click', { bubbles: true })); });
    assert(container.querySelector('.studio-scene-header')?.textContent.includes('发票服务'));
    assert(!container.querySelector('[aria-label="选择服务"]'));
    assert(!Array.from(container.querySelectorAll('.studio-workbench-toolbar button')).some(button => /新建|保存|发布/.test(button.textContent) && button.getAttribute('role') !== 'tab'));
    assert(container.querySelector('[aria-label="立即保存草稿"]'), '显示统一的草稿自动保存状态');
    assert(Array.from(container.querySelectorAll('.studio-scene-header button')).some(button => button.textContent.trim() === '发布'));
    assert.equal(container.querySelectorAll('.studio-stage-tabs>button').length, 5, '单份调试和批量测试独立导航，不增加第二行');
    assert.equal(container.querySelector('.studio-step-number'), null, '工作区导航不显示首次向导的步骤编号');
    const stage = async (key: string) => {
      await act(async () => { container.querySelector(`.studio-stage-tabs [data-node-key="${key}"]`)?.dispatchEvent(new dom.MouseEvent('click', { bubbles: true })); });
    };
    const saveDraft = async () => { await act(async () => { container.querySelector('[aria-label="立即保存草稿"]')?.dispatchEvent(new dom.MouseEvent('click', { bubbles: true })); }); };
    const confirmRelease = async () => { await act(async () => { Array.from(dom.document.querySelectorAll('.studio-release-check .ant-drawer-footer button')).find(button => button.textContent.startsWith('确认发布 v'))!.dispatchEvent(new dom.MouseEvent('click', { bubbles: true })); }); };
    await stage('api');
    assert(container.querySelector('.studio-first-release'), '未发布服务首先显示发布入口');
    assert(!container.querySelector('.studio-api-access'), '未发布时不展示虚构版本或可调用示例');
    assert(!container.querySelector('.studio-delivery-code'));
    assert(container.querySelector('.studio-readiness-issues')?.textContent.includes('价税合计'));
    await act(async () => { byText('发布首个版本')!.click(); });
    assert(dom.document.querySelector('.release-check-issues')?.textContent.includes('价税合计'), '未定位时仍能点击发布并看见具体缺项');
    assert(!calls.some(call => call.endsWith('/publish')), '发布检查不发布接口');
    await act(async () => { dom.document.querySelector('.release-check-issues button')!.dispatchEvent(new dom.MouseEvent('click', { bubbles: true })); });
    assert(container.querySelector('.profile-field-row.is-active')?.textContent.includes('价税合计'), '缺项直接跳转对应规则');
    assert(!container.querySelector('.profile-advanced-rule')?.hasAttribute('open'), '默认收起高级规则');
    assert(!container.querySelector('[aria-label="字段定位策略"]')!.closest('details'), '定位方式直接显示，不藏在高级规则中');
    assert(container.querySelector('[aria-label="字段样例取值"]')!.textContent.includes('尚未定位'));
    assert(byText('调整定位'), '未定位时也能直接开始原文定位');

    await stage('fields');
    assert(container.querySelector('.studio-editor-splitter'));
    assert.equal(container.querySelectorAll('.studio-editor-splitter>.ant-splitter-bar').length, 2, '原文左右两侧均提供可拖动分隔线');
    await act(async () => { container.querySelector('[aria-label="绑定原文：123.45"]')?.dispatchEvent(new dom.MouseEvent('click', { bubbles: true })); });
    assert(container.querySelector('.profile-region.is-selected'));
    const typeName = async (value: string) => { await act(async () => {
      const input = container.querySelector('[aria-label="字段名称"]')!;
      Object.getOwnPropertyDescriptor(dom.HTMLInputElement.prototype, 'value')!.set!.call(input, value);
      input.dispatchEvent(new dom.Event('input', { bubbles: true }));
    }); };
    let releaseSave!: () => void;
    saveGate = new Promise<void>(resolve => { releaseSave = resolve; });
    await typeName('旧的字段名');
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 1050)); });
    assert(container.querySelector('.studio-save-status')?.textContent.includes('保存中'));
    await typeName('新的字段名');
    await act(async () => { releaseSave(); });
    assert.equal((container.querySelector('[aria-label="字段名称"]') as unknown as HTMLInputElement).value, '新的字段名', '慢保存响应不覆盖后续输入');
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 1050)); });
    assert.equal(record.draft.templates[0].fields[0].name, '新的字段名');
    failNextSave = true;
    await typeName('待重试字段');
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 1050)); });
    assert(container.querySelector('.studio-save-status')?.textContent.includes('保存失败'));
    const failedWrites = calls.filter(call => call === 'PUT /api/extraction-profiles/profile-a').length;
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 1050)); });
    assert.equal(calls.filter(call => call === 'PUT /api/extraction-profiles/profile-a').length, failedWrites, '保存失败保留草稿，不循环请求');
    await saveDraft();
    assert.equal(record.draft.templates[0].fields[0].name, '待重试字段');
    await typeName('价税合计'); await saveDraft();
    const sourceMenu = async (label: string) => {
      await act(async () => { container.querySelector('[aria-label="原文更多操作"]')!.dispatchEvent(new dom.MouseEvent('click', { bubbles: true })); });
      await act(async () => { Array.from(dom.document.querySelectorAll('[role="menuitem"]')).find(item => item.textContent === label)!.dispatchEvent(new dom.MouseEvent('click', { bubbles: true })); });
    };
    await sourceMenu('查看上传原图');
    assert.equal(container.querySelector('.profile-page img')?.getAttribute('src'), '/original.png');
    assert(!container.querySelector('[aria-label="绑定原文：123.45"]'), '原图对照不修改转正坐标');
    assert(container.querySelector('.profile-region.is-selected'), '原图仍显示映射后的区域');
    const beforeLocate = JSON.stringify(record.draft);
    await act(async () => { byText('调整定位')!.click(); });
    assert.equal(container.querySelector('.profile-page img')?.getAttribute('src'), '/page.png');
    assert(container.querySelector('[aria-label="绑定原文：123.45"]'), '调整定位直接退出原图，恢复可选文字');
    assert(container.querySelector('.profile-page.is-locating'));
    assert.equal(JSON.stringify(record.draft), beforeLocate, '进入定位不会修改规则');
    await act(async () => { container.querySelector('[aria-label="绑定原文：123.45"]')!.dispatchEvent(new dom.MouseEvent('click', { bubbles: true })); await new Promise(resolve => setTimeout(resolve, 300)); });
    assert.equal(container.querySelector('.profile-page.is-locating'), null, '绑定后结束定位提示');
    assert(container.querySelector('[aria-label="字段样例取值"]')!.textContent.includes('123.45'));
    assert(container.querySelector('[aria-label="查看字段原文来源"]')!.textContent.includes('第 1 页'));
    await act(async () => { byText('确认此字段')!.click(); });
    await saveDraft();
    assert.equal(record.draft.templates[0].fields[0].review, 'confirmed', '人工配置也支持在原文核对后确认');
    await act(async () => { byText('调整定位')!.click(); container.querySelector('[aria-label="绑定原文：123.45"]')!.dispatchEvent(new dom.MouseEvent('click', { bubbles: true })); });
    await saveDraft();
    assert.equal(record.draft.templates[0].fields[0].review, 'pending', '修改已确认的定位后重新核对');
    await act(async () => { byText('确认此字段')!.click(); });
    await act(async () => { byText('试提取')!.click(); });
    assert(container.querySelector('.studio-stage-tabs [data-node-key="fields"][aria-selected="true"]'), '试提取不离开规则配置');
    assert(container.querySelector('[aria-label="当前样例试提取结果"]')?.textContent.includes('123.45'));
    await act(async () => { container.querySelector('.studio-trial-values button')!.dispatchEvent(new dom.MouseEvent('click', { bubbles: true })); });
    assert(container.querySelector('.profile-result-region'), '就地试提取保留原文高亮');
    assert.equal(container.querySelector('.studio-material-group h3'), null, '版式列表不重复展示服务名称');
    assert.equal(container.querySelector('.studio-property-tabs [data-node-key="fields"]')?.textContent, '规则配置');
    await back();
    assert(record.draft.templates[0].fields[0].region, '离开场景前保存未提交的定位');
    assert(!dom.location.search.includes('profile='));
    assert(container.querySelector('.service-project-grid'));
    await act(async () => { container.querySelector('[aria-label="编辑服务 发票服务"]')?.dispatchEvent(new dom.MouseEvent('click', { bubbles: true })); });
    await stage('test');
    await act(async () => { byText('用基准样例回放')!.click(); });
    assert(container.querySelector('.studio-debug-result')?.textContent.includes('123.45'));
    assert(!container.querySelector('[aria-label="绑定原文：123.45"]'), '调试结果不会重新绑定基准区域');
    const publish = byText('发布')!; assert.equal(publish.disabled, false);
    await act(async () => { publish.click(); });
    assert(dom.document.querySelector('.release-check-ready'));
    await act(async () => {
      const note = dom.document.querySelector('[aria-label="发布说明"]')!;
      Object.getOwnPropertyDescriptor(dom.HTMLTextAreaElement.prototype, 'value')!.set!.call(note, '验证发票金额定位');
      note.dispatchEvent(new dom.Event('input', { bubbles: true }));
    });
    await confirmRelease();
    assert(container.querySelector('.studio-api-access')?.textContent.includes('version=1.0.0'));
    assert(!container.querySelector('.studio-first-release'), '发布后切换为接口接入');
    assert(container.querySelector('.studio-version-history')?.textContent.includes('1/1 个版式通过'));
    assert.equal(releaseNote, '验证发票金额定位');
    assert(container.querySelector('.studio-version-history')?.textContent.includes('验证发票金额定位'), '发布说明随版本记录展示');
    assert(!container.querySelector('.studio-test-modes'), '移除第二行测试切换');
    assert(calls.includes('POST /api/extraction-profiles/profile-a/publish'));
    assert(!calls.some(call => call.includes('/api/tasks')), '已识别样例的定位、回放与发布不触发 OCR');
    assert.equal(publicEntries.length, 0, '发布接口版本不会自动进入公共目录');
    await back(); await directory('mine');
    await act(async () => { container.querySelector('[aria-label="打开场景 付款场景"]')!.dispatchEvent(new dom.MouseEvent('click', { bubbles: true })); });
    await act(async () => { byText('使用已发布版本')?.click(); });
    await act(async () => { container.querySelector('.scene-tabs [data-node-key="test"]')!.dispatchEvent(new dom.MouseEvent('click', { bubbles: true })); });
    const bundleInput = container.querySelector('.scene-composition input[type="file"]')!;
    Object.defineProperty(bundleInput, 'files', { configurable: true, value: [new File(['pdf-fixture'], '业务发票.pdf')] });
    await act(async () => { bundleInput.dispatchEvent(new dom.Event('change', { bubbles: true })); });
    await act(async () => { byText('开始联调')!.click(); });
    assert(container.querySelector('.scene-test-result')?.textContent.includes('组合通过'));
    await act(async () => { byText('查看原文与字段')!.click(); });
    await act(async () => { dom.document.querySelector('.studio-bundle-inspector .profile-test-values button')!.dispatchEvent(new dom.MouseEvent('click', { bubbles: true })); });
    assert(dom.document.querySelector('.profile-result-region'), '场景联调保留字段与原文高亮');
    await act(async () => { Array.from(dom.document.querySelectorAll('.ant-drawer-open .ant-drawer-close')).at(-1)?.dispatchEvent(new dom.MouseEvent('click', { bubbles: true })); });
    await act(async () => { container.querySelector('.scene-tabs [data-node-key="api"]')!.dispatchEvent(new dom.MouseEvent('click', { bubbles: true })); });
    await act(async () => { byText('发布')!.click(); });
    await confirmRelease();
    assert(container.textContent.includes('/api/studio/scenes/scene-a/execute'));
    assert(calls.includes('POST /api/studio/scenes/scene-a/publish'));
    await act(async () => { byText('我的场景')!.click(); });
    await directory('parsers');
    await act(async () => { container.querySelector('[aria-label="编辑服务 发票服务"]')!.dispatchEvent(new dom.MouseEvent('click', { bubbles: true })); });
    await stage('api');

    await act(async () => { Array.from(container.querySelectorAll('.studio-version-history button')).find(button => button.textContent.trim() === '申请公开')!.dispatchEvent(new dom.MouseEvent('click', { bubbles: true })); });
    await act(async () => {
      const input = dom.document.querySelector('[aria-label="场景发布人"]')!;
      Object.getOwnPropertyDescriptor(dom.HTMLInputElement.prototype, 'value')!.set!.call(input, '测试发布人');
      input.dispatchEvent(new dom.Event('input', { bubbles: true }));
    });
    await act(async () => { byText('提交审核')!.click(); });
    assert.equal(publicEntries.length, 0, '公开申请进入审核队列，不直接公开');
    assert.equal(reviews[0].status, 'pending');
    await stage('fields');
    await act(async () => { container.querySelector('[aria-label="服务设置"]')?.dispatchEvent(new dom.MouseEvent('click', { bubbles: true })); });
    assert(dom.document.querySelector('[aria-label="页面转正策略"]'));
    await act(async () => { root!.render(render(false)); });
    assert.equal(container.querySelector('.studio-workspace')?.hasAttribute('hidden'), true);
    await act(async () => { root!.render(render(true)); });
    assert(dom.document.querySelector('[aria-label="页面转正策略"]'), '设置统一在服务标题栏，避免与字段属性重复');
    await act(async () => { byText('应用设置')!.click(); });
    await back();
    assert(container.textContent.includes('公开审核中'));
    await act(async () => { byText('模拟审核 · 1')!.click(); });
    assert(dom.document.body.textContent.includes('模拟审核身份'));
    await act(async () => { byText('通过并公开')!.click(); });
    assert.equal(publicEntries.length, 2);
    assert.equal(reviews[0].status, 'approved');
    await act(async () => { dom.document.querySelector('.ant-drawer-open .ant-drawer-close')?.dispatchEvent(new dom.MouseEvent('click', { bubbles: true })); });
    await directory('library');
    assert(container.querySelector('.studio-library-card')?.textContent.includes('发票服务'));
    assert(container.querySelector('.studio-library')?.textContent.includes('其他发布人的场景'), '公共库数据独立于当前用户的场景列表');
    const originalId = record.draft.id;
    await act(async () => { byText('复制修改')!.click(); });
    await act(async () => { byText('创建并进入')!.click(); });
    assert.notEqual(record.draft.id, originalId);
    assert.equal(record.versions.length, 0, '复制配置作为新草稿，不继承发布状态');
    assert.equal(record.draft.templates[0].sampleId, 'sample-a');
    assert.equal(record.draft.templates[0].fields[0].key, 'total');
    assert(!calls.some(call => call.includes('/api/tasks')), '场景复用不重新 OCR 或调用模型');
    await back();
    await act(async () => { byText('新建服务')!.click(); });
    const create = byText('创建并进入')!; assert.equal(create.disabled, false, '名称与描述可留空');
    await act(async () => { create.click(); });
    assert.equal(record.draft.name, '未命名服务');
    assert.equal(record.draft.templates.length, 0, '新场景进入自己的工作台，不默认加载示例');
    assert(container.querySelector('.studio-onboarding'));
    assert(!container.querySelector('table'), '新场景先显示上传动作，不要求理解空的材料表');
    assert.equal(container.querySelector('.studio-stage-tabs [data-node-key="test"]')?.hasAttribute('disabled'), true);
    const upload = async (names: string[]) => {
      const input = container.querySelector('input[type="file"]')!;
      Object.defineProperty(input, 'files', { configurable: true, value: names.map(name => new File(['pdf-test-fixture'], name, { type: 'application/pdf' })) });
      await act(async () => { input.dispatchEvent(new dom.Event('change', { bubbles: true })); });
    };
    await act(async () => { container.querySelector('[aria-label="上传样例，开始配置"]')?.dispatchEvent(new dom.MouseEvent('click', { bubbles: true })); });
    await upload(['基准发票.pdf']);
    assert.equal(record.draft.templates.length, 1);
    assert.equal(record.draft.templates[0].fields.length, 0);
    assert.equal(container.querySelector('.studio-configuration-switch'), null, '字段编辑与 AI 助手不再是互斥执行模式');
    assert.equal(modelAttempts, 0, '上传样例不自动调用模型');
    const property = async (key: string) => { await act(async () => { container.querySelector(`.studio-property-tabs [data-node-key="${key}"]`)?.dispatchEvent(new dom.MouseEvent('click', { bubbles: true })); }); };
    await property('fields');
    await act(async () => { byText('AI 辅助配置')!.click(); });
    assert(container.querySelector('[aria-label="配置助手"]'));
    await act(async () => {
      const input = container.querySelector('[aria-label="配置助手输入"]')!;
      Object.getOwnPropertyDescriptor(dom.HTMLTextAreaElement.prototype, 'value')!.set!.call(input, '提取价税合计');
      input.dispatchEvent(new dom.Event('input', { bubbles: true }));
    });
    await property('fields'); await property('assistant');
    assert.equal((container.querySelector('[aria-label="配置助手输入"]') as unknown as HTMLTextAreaElement).value, '提取价税合计', '来回查看字段保留未提交需求');
    const send = async () => { await act(async () => { container.querySelector('[aria-label="发送给配置助手"]')!.dispatchEvent(new dom.MouseEvent('click', { bubbles: true })); }); };
    await send();
    assert(container.textContent.includes('AI 配置生成超时'));
    assert.equal(record.draft.templates[0].fields.length, 0, '失败不修改已有草稿');
    await send();
    assert.equal(modelAttempts, 2);
    assert.equal(record.draft.templates[0].fields.length, 0, '建议返回不直接修改配置');
    await act(async () => { byText('预览原文位置')!.click(); });
    assert(container.querySelector('.is-assistant-preview'), '建议位置高亮使用原文，不修改字段');
    await act(async () => { container.querySelector('[aria-label="下一页样例"]')!.dispatchEvent(new dom.MouseEvent('click', { bubbles: true })); });
    assert(!container.querySelector('.is-assistant-preview'), '翻到其他页面不显示错误的建议区域');
    await act(async () => { container.querySelector('[aria-label="上一页样例"]')!.dispatchEvent(new dom.MouseEvent('click', { bubbles: true })); });
    assert(container.querySelector('.is-assistant-preview'));
    await act(async () => { byText('应用修改（1）')!.click(); });
    assert(!container.querySelector('.is-assistant-preview'));
    await act(async () => { byText('撤销本次修改')!.click(); });
    await property('fields');
    assert(!container.querySelector('.profile-field-row'), '撤销返回应用前的空字段列表');
    await property('assistant');
    await act(async () => {
      const input = container.querySelector('[aria-label="配置助手输入"]')!;
      Object.getOwnPropertyDescriptor(dom.HTMLTextAreaElement.prototype, 'value')!.set!.call(input, '提取价税合计');
      input.dispatchEvent(new dom.Event('input', { bubbles: true }));
    });
    await send();
    await act(async () => { byText('应用修改（1）')!.click(); });
    await property('fields');
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 1050)); });
    assert.equal(record.draft.templates[0].fields[0].review, 'pending', '自动保存不替业务确认 AI 规则');
    assert(container.querySelector('.studio-save-status')?.textContent.includes('已保存'));
    assert.equal(record.versions.length, 0, '自动保存不发布接口版本');
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 300)); });
    assert(container.querySelector('[aria-label="字段样例取值"]')?.textContent.includes('123.45'));
    await act(async () => { byText('确认此字段')!.click(); });
    await saveDraft();
    assert.equal(record.draft.templates[0].fields.length, 1);
    assert.equal(record.draft.templates[0].fields[0].review, 'confirmed');
    await act(async () => { container.querySelector('.profile-advanced-rule>summary')!.dispatchEvent(new dom.MouseEvent('click', { bubbles: true })); });
    assert(container.querySelector('.profile-advanced-rule')!.hasAttribute('open'));
    await act(async () => { byText('规则配置 JSON')!.click(); });
    const setRuleSource = async (value: string) => {
      await act(async () => {
        const input = dom.document.querySelector('[aria-label="字段规则 JSON"]')!;
        Object.getOwnPropertyDescriptor(dom.HTMLTextAreaElement.prototype, 'value')!.set!.call(input, value);
        input.dispatchEvent(new dom.Event('input', { bubbles: true }));
      });
    };
    await setRuleSource('{"region":[-1,0,1,1],"stripLabel":false}');
    await act(async () => { byText('应用配置')!.click(); });
    assert(dom.document.querySelector('.studio-rule-source')?.textContent.includes('区域应为 0 到 1'));
    assert.deepEqual(record.draft.templates[0].fields[0].region, [.4, .6, .6, .65], '无效 JSON 配置不影响已保存规则');
    await setRuleSource('{"region":[0.39,0.59,0.61,0.66],"stripLabel":false}');
    await act(async () => { byText('应用配置')!.click(); });
    assert(container.textContent.includes('待确认'), '修改 AI 字段执行配置后需要重新确认');
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 300)); });
    await act(async () => { byText('确认此字段')!.click(); });
    await saveDraft();
    assert.deepEqual(record.draft.templates[0].fields[0].region, [.39, .59, .61, .66]);
    assert.equal(modelAttempts, 3, '修改、预览和确认规则不重复调用模型');
    const confirmedRules = JSON.stringify(record.draft.templates[0].fields);
    await property('assistant'); await property('fields');
    assert.equal(JSON.stringify(record.draft.templates[0].fields), confirmedRules, '字段与助手共用同一份规则');
    assert.equal(modelAttempts, 3);
    assert.equal(container.querySelector('.profile-selection-tools'), null, '原文不再占用第二行定位说明');
    assert(!container.querySelector('.studio-material-rail .studio-rail-bottom'), '移除左栏底部提示');
    await act(async () => { container.querySelector('[aria-label="材料更多操作"]')!.dispatchEvent(new dom.MouseEvent('click', { bubbles: true })); });
    await act(async () => { Array.from(dom.document.querySelectorAll('[role="menuitem"]')).find(item => item.textContent.includes('样例管理'))!.dispatchEvent(new dom.MouseEvent('click', { bubbles: true })); });
    await act(async () => { byText('添加测试样例')!.click(); });
    await upload(['测试发票一.pdf', '测试发票二.pdf']);
    assert.equal(record.draft.samples?.length, 2);
    await act(async () => { dom.document.querySelector('.studio-samples-drawer .ant-drawer-close')?.dispatchEvent(new dom.MouseEvent('click', { bubbles: true })); });
    await stage('evaluate');
    const run = Array.from(container.querySelectorAll('button')).find(button => button.textContent.includes('运行回放'))!;
    assert.equal(run.disabled, false);
    await act(async () => { run.click(); });
    assert.equal(reports[0].rows.length, 2);
    assert(container.querySelector('.studio-report-content')?.textContent.includes('规则回放 P95'));
    assert(container.textContent.includes('不含 OCR 与上传耗时'));
    await stage('runs');
    assert(container.textContent.includes('发布版本并调用 API 后'));
    assert(calls.some(call => call.endsWith('/runs')));
    await act(async () => {
      dom.history.replaceState(null, '', '?page=profiles');
      root!.render(render(true, 1));
    });
    assert(container.querySelector('.service-project-grid'), '再次点击主导航进入我的场景，不恢复为旧场景工作台');
    assert(!container.querySelector('.studio-stage-tabs'));
    const currentId = record.draft.id;
    await act(async () => {
      dom.history.replaceState(null, '', `?page=profiles&profile=${currentId}&studio=evaluate`);
      dom.dispatchEvent(new dom.PopStateEvent('popstate'));
    });
    assert(container.querySelector('.studio-stage-tabs [data-node-key="evaluate"][aria-selected="true"]'), '浏览器返回与深层链接恢复批量测试工作区');

    await back();
    await act(async () => { byText('新建服务')!.click(); });
    await act(async () => { byText('创建并进入')!.click(); });
    await act(async () => { container.querySelector('[aria-label="上传样例，开始配置"]')!.dispatchEvent(new dom.MouseEvent('click', { bubbles: true })); });
    await upload(['同版式样例一.pdf', '同版式样例二.pdf']);
    assert.equal(record.draft.templates.length, 1, '多份同版式文件共用一套规则');
    assert.equal(record.draft.samples?.length, 1, '第二份文件用于验证');
    assert.equal(record.draft.materialTypes, undefined, '服务不再嵌套材料分类');
    assert(!container.textContent.includes('场景配置'));
    await property('fields');
    await act(async () => { byText('手动添加字段')!.click(); });
    await saveDraft();
    await act(async () => { container.querySelector('[aria-label="添加版式样例"]')!.dispatchEvent(new dom.MouseEvent('click', { bubbles: true })); });
    await upload(['另一版式.pdf']);
    assert.equal(record.draft.templates.length, 2);
    assert.equal(record.draft.templates[1].fields[0].key, record.draft.templates[0].fields[0].key, '不同版式共享字段定义');
    assert.equal(record.draft.templates[1].fields[0].region, null, '新布局不会继承另一版式的坐标');

  } finally {
    if (root) await act(async () => { root!.unmount(); });
    await dom.happyDOM.close();
    globalThis.fetch = originalFetch;
    properties.forEach((key, index) => {
      if (originals[index]) Object.defineProperty(globalThis, key, originals[index]!);
      else Reflect.deleteProperty(globalThis, key);
    });
    await rm(temporary, { recursive: true, force: true });
    stop();
    channels.forEach(channel => { channel.port1.close(); channel.port2.close(); });
  }
});
