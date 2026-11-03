import { mockOperationsOverview } from '../operationsMock.ts';
import type { ProfileDraft, ProfileRecord, ProfileRule, ProfileSample, EvaluationReport, BundleResult, SharedScene } from '../profiles.ts';
import type { SceneRecord, CompositionResult, StudioPlan } from '../studio.ts';
import type { ReleaseReport } from '../release.ts';
import { demoDocument, demoFields, demoKind, demoMarkdown, demoRules, demoSample, demoTest, initialDemoState, type DemoState } from './data.ts';

const STORAGE_KEY = 'wenxi-public-demo-v1';
const now = () => new Date().toISOString();
const uid = () => crypto.randomUUID().replaceAll('-', '');
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const clone = <T,>(value: T): T => structuredClone(value);
const fieldsCount = (draft: ProfileDraft) => new Set(draft.templates.flatMap(t => t.fields.map(f => f.key))).size;
const summary = (record: ProfileRecord) => ({ id: record.draft.id, name: record.draft.name, description: record.draft.description,
  templates: record.draft.templates.length, fields: fieldsCount(record.draft), versions: record.versions, updatedAt: record.updatedAt,
  hasUnpublishedChanges: JSON.stringify(record.publishedDraft) !== JSON.stringify(record.draft) });

/** Entire API runs in the visitor's browser; no request bodies are sent to a server. */
export function createDemoApi(storage?: Pick<Storage, 'getItem' | 'setItem'>) {
  let state: DemoState;
  try { state = JSON.parse(storage?.getItem(STORAGE_KEY) || 'null') || initialDemoState(); }
  catch { state = initialDemoState(); }
  const persist = () => { try { storage?.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* The current in-memory demo remains usable if storage is full. */ } };
  const jobs = new Map<string, { polls: number; status: string; result: { document: ReturnType<typeof demoDocument>; fields: ReturnType<typeof demoFields> } }>();
  function addSample(fileName = '虚构票据.pdf') {
    const sample = demoSample(demoKind(fileName), `demo-upload-${uid()}`);
    state.samples[sample.id] = sample; persist(); return sample;
  }
  const sampleFor = (id: string) => state.samples[id] || demoSample();
  function releaseCheck(record: ProfileRecord): ReleaseReport {
    const issues: ReleaseReport['issues'] = [];
    if (!record.draft.templates.length) issues.push({ code: 'sample', title: '添加一个演示版式', detail: '上传样例，或使用内置演示服务。', target: { area: 'fields' } });
    for (const t of record.draft.templates) {
      if (!t.fields.length) issues.push({ code: 'fields', title: '尚未配置字段', detail: `${t.name}需要至少一个字段。`, target: { area: 'fields', templateId: t.id } });
      for (const f of t.fields) if (!f.region && !f.anchor || f.review === 'pending') issues.push({ code: 'localization', title: `确认字段：${f.name}`, detail: '确认定位与规则后再发布。', target: { area: 'fields', templateId: t.id, fieldId: f.id } });
    }
    if (!record.lastTest || !Object.values(record.lastTest.templates).length || Object.values(record.lastTest.templates).some(t => !t.passed)) issues.push({ code: 'test', title: '完成一次规则测试', detail: '在单份测试中运行当前演示规则。', target: { area: 'test' } });
    return { ready: !issues.length, unchanged: JSON.stringify(record.draft) === JSON.stringify(record.publishedDraft), currentVersion: record.versions.at(-1) || '',
      nextVersion: `1.0.${record.versions.length}`, issues };
  }
  function runTest(record: ProfileRecord, sampleId: string, templateId?: string) {
    const result = demoTest(record.draft, sampleFor(sampleId), templateId);
    record.lastTest = { hash: JSON.stringify(record.draft), templates: { ...record.lastTest?.templates, [result.templateId]: result } };
    persist(); return result;
  }
  function bundle(record: ProfileRecord, files: File[]): BundleResult {
    const items = (files.length ? files : [new File([''], sampleFor(record.draft.templates[0]?.sampleId || '').name)]).map((file, index) => {
      const template = record.draft.templates[0]; const sample = addSample(file.name);
      const result = runTest(record, sample.id, template?.id);
      return { sourceName: sample.name, sourceIndex: index, sampleId: sample.id, templateId: template?.id, templateName: template?.name,
        pages: [1], status: result.passed ? 'succeeded' : 'needs_review', passed: result.passed, fields: result.fields,
        data: Object.fromEntries(result.fields.map(f => [f.key, f.value])) };
    });
    return { passed: items.every(i => i.passed), usesLlm: false, totalElapsedMs: 36, elapsedMs: 18, items, missingTypes: [],
      data: items.map(i => i.data), summary: { files: items.length, total: items.length, succeeded: items.filter(i => i.passed).length, failed: items.filter(i => !i.passed).length },
      files: items.map(i => ({ name: i.sourceName, sampleId: i.sampleId, result: demoTest(record.draft, sampleFor(i.sampleId), i.templateId) })) };
  }
  function shared(record: ProfileRecord): SharedScene {
    return { id: `public-${record.draft.id}`, profileId: record.draft.id, name: record.draft.name, description: record.draft.description,
      version: record.versions.at(-1) || '1.0.0', publisher: '演示发布者', team: '演示研发团队', publishedAt: record.updatedAt,
      templates: record.draft.templates.length, fields: record.draft.templates[0]?.fields || [], inputs: ['PDF', '图片'], endpoint: '/demo-only/not-a-live-api' };
  }
  function sceneCheck(record: SceneRecord): ReleaseReport {
    const issues: ReleaseReport['issues'] = [];
    if (!record.draft.bindings.length) issues.push({ code: 'bindings', title: '添加一个服务', detail: '选择场景引用的演示服务。', target: { area: 'services' } });
    if (!record.lastTest?.passed) issues.push({ code: 'test', title: '完成整包联调', detail: '上传虚构样例，体验整包联调。', target: { area: 'test' } });
    return { ready: !issues.length, unchanged: JSON.stringify(record.draft) === JSON.stringify(record.publishedDraft), currentVersion: record.versions.at(-1) || '', nextVersion: `1.0.${record.versions.length}`, issues };
  }

  return async function respond(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, 'https://wx.tracex.fun');
    const path = url.pathname; const method = init?.method || (input instanceof Request ? input.method : 'GET');
    const signal = init?.signal || (input instanceof Request ? input.signal : undefined);
    if (signal?.aborted) throw new DOMException('已停止', 'AbortError');
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
    const form = init?.body instanceof FormData ? init.body : undefined;
    const uploaded = (form?.getAll('files') || []).filter((v): v is File => typeof v !== 'string');
    const file = form?.get('file') as File | null;
    if (path === '/api/health') return json({ semantic: true, extractor: 'label-match', model: '演示数据', supportsRequirements: true, supportsHistory: true, supportsFullText: true, reviewAvailable: false, demo: true });
    if (path === '/api/requirements/parse') {
      const rules = demoRules(demoSample());
      return json({ fileName: file?.name || '演示字段要求.xlsx', sheets: [{ sheet: '演示票据', fields: rules.map((r, i) => ({ name: r.name, rule: '内置演示字段，不读取上传工作簿内容。', cell: `A${i + 2}`, ruleCell: `B${i + 2}`, group: '演示票据' })) }] });
    }
    if (path === '/api/tasks' && method === 'POST') {
      const sample = addSample(file?.name); const id = sample.id;
      const document = demoDocument(sample);
      if (form?.get('output_mode') === 'fulltext') document.fullText = { url: `/api/documents/${id}/fulltext`, downloadUrl: '', packageUrl: '', pageCount: 1, imageCount: 0 };
      jobs.set(id, { polls: 0, status: 'running', result: { document, fields: demoFields(sample) } });
      return json({ id, status: 'queued', phase: '正在准备虚构示例' });
    }
    const jobRoute = path.match(/^\/api\/tasks\/([^/]+)(\/cancel)?$/);
    if (jobRoute) {
      const job = jobs.get(jobRoute[1]); if (!job) return json({ detail: '演示任务已结束，请重新打开样例。' }, 404);
      if (jobRoute[2]) job.status = 'cancelled';
      else if (job.status === 'running' && ++job.polls > 2) job.status = 'succeeded';
      return json({ id: jobRoute[1], status: job.status, phase: '正在展示虚构示例结果', result: job.status === 'succeeded' ? job.result : undefined,
        events: ['准备演示文档', '模拟字段整理', '演示原文定位'].slice(0, job.polls + 1).map((label, i) => ({ id: `step-${i}`, label, status: i < job.polls || job.status === 'succeeded' ? 'done' : 'running', startedAt: now() })) });
    }
    if (/^\/api\/documents\/.+\/extract$/.test(path)) { const sample = sampleFor(path.split('/')[3]); return json({ id: sample.id, status: 'succeeded', phase: '演示结果已就绪', result: { document: demoDocument(sample), fields: demoFields(sample) } }); }
    if (/^\/api\/documents\/.+\/fulltext$/.test(path)) return json({ markdown: demoMarkdown(sampleFor(path.split('/')[3])), assetBaseUrl: '' });
    if (/^\/api\/documents\/[^/]+$/.test(path) && method === 'DELETE') return json({ ok: true });
    if (path === '/api/history') return json(Object.values(state.history).map(({ snapshot, ...entry }) => ({ ...entry, files: snapshot.files })));
    const historyRoute = path.match(/^\/api\/history\/([^/]+)$/);
    if (historyRoute) {
      const id = decodeURIComponent(historyRoute[1]);
      if (method === 'PUT') { state.history[id] = { id, createdAt: state.history[id]?.createdAt || now(), updatedAt: now(), snapshot: body }; persist(); return json({ id }); }
      return state.history[id] ? json(state.history[id]) : json({ detail: '演示记录不存在' }, 404);
    }
    if (path === '/api/operations/overview') return json(mockOperationsOverview(Number(url.searchParams.get('days')) || 30, url.searchParams.get('kind') || 'all', undefined, { status: url.searchParams.get('status') || undefined, target: url.searchParams.get('target') || undefined }));
    if (path === '/api/operations/activity') return json(mockOperationsOverview(365).activity);
    if (path === '/api/studio/catalog') return json({ parsers: Object.values(state.profiles).map(summary), scenes: Object.values(state.scenes).map(r => ({ id: r.draft.id, name: r.draft.name, description: r.draft.description, bindings: r.draft.bindings.length, versions: r.versions, updatedAt: r.updatedAt, hasUnpublishedChanges: JSON.stringify(r.publishedDraft) !== JSON.stringify(r.draft) })) });
    if (path === '/api/extraction-profiles') return json(Object.values(state.profiles).map(summary));
    if (path === '/api/scene-library') return json([shared(state.profiles['demo-service-invoice']), ...state.reviews.filter(r => r.status === 'approved' && r.profileId !== 'demo-service-invoice').map(r => shared(state.profiles[r.profileId]))]);
    if (path.startsWith('/api/scene-library/')) { const id = path.split('/').at(-1)!.replace(/^public-/, ''); const record = state.profiles[id]; return record ? json({ ...shared(record), draft: state.versions[id]?.[record.versions.at(-1)!] || record.draft }) : json({ detail: '演示服务不存在' }, 404); }
    if (path === '/api/scene-publication-reviews') return json(state.reviews);
    if (path.startsWith('/api/scene-publication-reviews/') && method === 'POST') {
      const review = state.reviews.find(r => r.id === path.split('/')[3]);
      if (!review) return json({ detail: '演示审核记录不存在' }, 404);
      Object.assign(review, { status: body.decision, reviewer: '演示审核员', reviewedAt: now(), comment: body.comment }); persist(); return json(review);
    }
    if (path === '/api/profile-sample-bundles' && method === 'POST') return json({ samples: uploaded.flatMap(f => /\.zip$/i.test(f.name) ? [addSample('票据.pdf'), addSample('合同.pdf')] : [addSample(f.name)]), failures: [] });
    if (path === '/api/profile-samples' && method === 'POST') return json(addSample(file?.name));
    if (path === '/api/profile-samples/from-document' || /^\/api\/profile-samples\/from-task\//.test(path)) return json(sampleFor(body.documentId || path.split('/').at(-1)));
    const sampleRoute = path.match(/^\/api\/profile-samples\/([^/]+)(?:\/(.+))?$/);
    if (sampleRoute) {
      const sample = sampleFor(sampleRoute[1]); const action = sampleRoute[2];
      if (!action) return json(sample);
      if (action === 'source') return new Response(decodeURIComponent(sample.pages[0].imageUrl.split(',')[1]), { headers: { 'Content-Type': 'image/svg+xml' } });
      if (action === 'suggest') return json(demoRules(sample));
      if (action === 'generate-rules') return json({ rules: demoRules(sample, body.requirements?.fields.map((f: { name: string }) => f.name), true), matchTexts: ['虚构演示材料'], checks: [], usesLlm: true, modelCall: { model: '演示数据（未调用模型）', elapsedMs: 0 } });
      if (action === 'assist-rules') {
        const rules = demoRules(sample, body.requirements?.fields.map((f: { name: string }) => f.name), true);
        const existing: ProfileRule[] = body.fields || [];
        const suggestions = rules.filter(r => !existing.some(f => f.key === r.key));
        const changes = suggestions.length ? suggestions.map(after => ({ op: 'add', id: after.id, before: null, after, check: { value: sample.blocks.find(b => b.ref === after.key)?.text || '', status: 'matched', issue: '' } }))
          : existing.slice(0, 1).map(before => ({ op: 'update', id: before.id, before, after: { ...before, required: true, origin: 'ai', review: 'pending' }, check: { value: sample.blocks.find(b => b.ref === before.key)?.text || '', status: 'matched', issue: '' } }));
        return json({ message: '以下为固定演示建议，未调用大模型。可预览位置并应用到演示草稿。', changes, usesLlm: true, modelCall: { model: '演示数据（未调用模型）', elapsedMs: 0 } });
      }
      if (action === 'preview-rule') return json(demoTest({ id: '', name: '', description: '', templates: [{ id: '', name: '', sampleId: sample.id, matchTexts: [], fields: [body.rule] }] }, sample).fields[0]);
    }
    const profileRoute = path.match(/^\/api\/extraction-profiles\/([^/]+)(?:\/(.+))?$/);
    if (profileRoute) {
      const id = profileRoute[1], action = profileRoute[2];
      if (!action && method === 'PUT') {
        const previous = state.profiles[id];
        state.profiles[id] = { ...previous, draft: body, createdAt: previous?.createdAt || now(), updatedAt: now(), versions: previous?.versions || [] };
        persist(); return json(state.profiles[id]);
      }
      const record = state.profiles[id]; if (!record) return json({ detail: '演示服务不存在，请返回目录选择内置服务。' }, 404);
      if (!action) return json(record);
      if (action === 'release-check') return json(releaseCheck(record));
      if (action === 'test') return json(runTest(record, body.sampleId, body.templateId));
      if (action === 'debug-bundle') return json(bundle(record, uploaded));
      if (action === 'publish') {
        const report = releaseCheck(record); if (!report.ready) return json({ detail: report.issues[0].title }, 400);
        const version = report.nextVersion; record.versions.push(version); record.publishedDraft = clone(record.draft);
        (state.versions[id] ||= {})[version] = clone(record.draft); persist(); return json(record);
      }
      if (action.startsWith('versions/')) return json(state.versions[id]?.[action.slice(9)] || record.publishedDraft || record.draft);
      if (action === 'releases') return json(record.versions.map(version => ({ version, publishedAt: record.updatedAt, templates: record.draft.templates.length, fields: fieldsCount(record.draft), tests: { passed: record.draft.templates.length, total: record.draft.templates.length }, note: '演示发布记录 · 不提供真实接口' })));
      if (action === 'runs') return json([{ id: `run-${id}`, version: record.versions.at(-1) || '草稿', createdAt: record.updatedAt, name: '虚构票据_DEMO.pdf', status: 'succeeded', totalElapsedMs: 1200, ruleMs: 18, units: 1, error: '', usesLlm: false }]);
      if (action === 'share') {
        const review = { ...shared(record), id: uid(), profileId: id, publisher: '演示发布者', team: '演示研发团队', status: 'pending' as const, submittedAt: now(), reviewedAt: null, reviewer: '', comment: '', entryId: '', mock: true as const };
        state.reviews.push(review); persist(); return json(review);
      }
      if (action.startsWith('evaluations')) {
        if (method === 'POST') {
          const rows = (body.sampleIds as string[]).map(sampleId => { const sample = sampleFor(sampleId); const result = runTest(record, sampleId); return { sampleId, name: sample.name, passed: result.passed, result, totalFields: result.fields.length, matchedFields: result.fields.filter(f => f.status === 'matched').length, elapsedMs: 18, error: '' }; });
          const report: EvaluationReport = { id: uid(), profileId: id, createdAt: now(), hash: 'demo-rules', draft: clone(record.draft), mode: 'rule_replay', usesLlm: false, passed: rows.every(r => r.passed), rows,
            summary: { total: rows.length, passed: rows.filter(r => r.passed).length, failed: rows.filter(r => !r.passed).length, totalFields: rows.reduce((s, r) => s + r.totalFields, 0), matchedFields: rows.reduce((s, r) => s + r.matchedFields, 0), ruleP95Ms: 18, elapsedMs: rows.length * 18 } };
          (state.evaluations[id] ||= []).unshift(report); record.lastEvaluation = { id: report.id, hash: report.hash, summary: report.summary, passed: report.passed, createdAt: report.createdAt }; persist(); return json(report);
        }
        return json(action === 'evaluations' ? state.evaluations[id] || [] : state.evaluations[id]?.find(r => r.id === action.split('/')[1]));
      }
    }
    if (path === '/api/studio/plan') {
      const specs = (body.sampleIds?.length ? body.sampleIds : ['demo-sample-invoice']).map((id: string) => { const sample = sampleFor(id); return { name: `${sample.name.replace('.pdf', '')}提取服务`, description: '固定虚构示例，未执行 AI 分析。', reuseParserId: '', required: true, multiple: true, layouts: [{ name: '演示版式', sampleIds: [id] }], fields: demoRules(sample).map(r => ({ name: r.name, key: r.key, kind: r.kind, rule: '演示定位' })) }; });
      return json({ plan: { name: '采购材料核验演示', description: '由虚构样例生成的演示计划。', parsers: specs, questions: [] }, unassigned: [], usesLlm: true });
    }
    if (path === '/api/studio/plan/apply') {
      const plan: StudioPlan = body.plan; const parserIds: string[] = [];
      for (const spec of plan.parsers) {
        if (spec.reuseParserId && state.profiles[spec.reuseParserId]) { parserIds.push(spec.reuseParserId); continue; }
        const id = uid(); parserIds.push(id);
        const sample = sampleFor(spec.layouts[0]?.sampleIds[0] || '');
        const draft: ProfileDraft = { id, name: spec.name, description: spec.description, resourceKind: 'parser', templates: [{ id: uid(), name: spec.layouts[0]?.name || '演示版式', sampleId: sample.id, matchTexts: ['虚构演示材料'], fields: demoRules(sample) }] };
        state.samples[sample.id] = sample; state.profiles[id] = { draft, createdAt: now(), updatedAt: now(), versions: [] };
      }
      const id = uid(); const scene: SceneRecord = { draft: { id, name: plan.name, description: plan.description, bindings: parserIds.map((parserId, i) => ({ id: uid(), parserId, name: plan.parsers[i].name, version: state.profiles[parserId].versions.at(-1) || '', required: true, multiple: true })) }, versions: [], updatedAt: now() };
      state.scenes[id] = scene; persist(); return json({ scene, parserIds, unassigned: [], localizedFields: 0, warnings: ['演示数据：未执行真实样例分析。'] });
    }
    const sceneRoute = path.match(/^\/api\/studio\/scenes\/([^/]+)(?:\/(.+))?$/);
    if (sceneRoute) {
      const id = sceneRoute[1], action = sceneRoute[2];
      if (!action && method === 'PUT') { const previous = state.scenes[id]; state.scenes[id] = { ...previous, draft: body, versions: previous?.versions || [], updatedAt: now() }; persist(); return json(state.scenes[id]); }
      const record = state.scenes[id]; if (!record) return json({ detail: '演示场景不存在' }, 404);
      if (!action) return json(record);
      if (action === 'efficiency') { record.efficiency = { minutesPerRun: body.minutesPerRun, updatedAt: now() }; persist(); return json(record.efficiency); }
      if (action === 'release-check') return json(sceneCheck(record));
      if (action === 'publish') { const report = sceneCheck(record); if (!report.ready) return json({ detail: report.issues[0].title }, 400); record.versions.push(report.nextVersion); record.publishedDraft = clone(record.draft); persist(); return json(record); }
      if (action === 'runs') return json(record.lastTest ? [{ version: record.versions.at(-1) || '草稿', createdAt: record.lastTest.testedAt, passed: record.lastTest.passed, totalElapsedMs: 36, summary: record.lastTest.result.summary }] : []);
      if (action === 'debug-bundle') {
        const parts = record.draft.bindings.flatMap(binding => { const parser = state.profiles[binding.parserId]; return parser ? bundle(parser, []).items.map(item => ({ ...item, materialTypeId: binding.id, materialTypeName: binding.name })) : []; });
        const result: CompositionResult = { passed: !!parts.length && parts.every(p => p.passed), usesLlm: false, totalElapsedMs: 36, elapsedMs: 18, items: parts, missingTypes: [], issues: [],
          data: Object.fromEntries(record.draft.bindings.map((binding, i) => [binding.name, [parts[i]?.data]])), summary: { files: uploaded.length, total: parts.length, succeeded: parts.filter(p => p.passed).length, failed: parts.filter(p => !p.passed).length }, files: parts.map(p => ({ name: p.sourceName, sampleId: p.sampleId })) };
        record.lastTest = { passed: result.passed, testedAt: now(), result }; persist(); return json(result);
      }
    }
    return json({ detail: '此操作不在纯前端演示范围内，未发送网络请求。' }, 404);
  };
}

export function installDemoApi() {
  const original = window.fetch.bind(window);
  const respond = createDemoApi(window.localStorage);
  window.fetch = (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href);
    // Never fall through to any real API or external host from the demo.
    if (url.pathname.startsWith('/api/')) return respond(input, init);
    if (url.origin !== location.origin && !['blob:', 'data:'].includes(url.protocol)) return Promise.reject(new Error('演示环境不连接外部服务。'));
    return original(input, init);
  };
}
