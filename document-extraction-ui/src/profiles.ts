import type { Material, SourceEvidence, DocumentPage, PreprocessingPolicy, PreprocessingReport, RequirementDefinition } from './types.ts';
import type { ReleaseReport } from './release.ts';
export const defaultPreprocessing: PreprocessingPolicy = { orientation: 'auto', deskew: 'auto', grouping: 'auto' };

export type Box = [number, number, number, number];
export interface ProfileRule {
  id: string; key: string; name: string; kind: 'text' | 'number' | 'amount' | 'date';
  method: 'region' | 'anchor'; page: number; region: Box | null; anchor: string;
  direction: 'right' | 'below'; required: boolean; stripLabel?: boolean;
  origin?: 'manual' | 'ai'; review?: 'pending' | 'confirmed'; note?: string;
}
export interface GeneratedRules { rules: ProfileRule[]; matchTexts: string[]; usesLlm: true; checks: Array<{ key: string; value: string; status: string; issue: string }>; modelCall: { model: string; elapsedMs: number; usage?: { total_tokens?: number } } }
export interface AssistantChange { op: 'add' | 'update' | 'remove'; id: string; before: ProfileRule | null; after: ProfileRule | null; check: { value: string; status: string; issue: string } | null }
export interface AssistantReply { message: string; changes: AssistantChange[]; usesLlm: true; modelCall: { model: string; elapsedMs: number; usage?: { total_tokens?: number } } }
export interface AssistantMessage { role: 'user' | 'assistant'; content: string }
export type RulePreview = ProfileTest['fields'][number];
export interface ProfileSample {
  id: string; name: string; engine: string; sourceHash: string;
  pages: DocumentPage[];
  preprocessing?: PreprocessingReport;
  units?: Array<{ id: string; label: string; pages: number[]; needsReview: boolean }>;
  blocks: SourceEvidence[];
}
export interface ProfileTemplate { id: string; name: string; sampleId: string; matchTexts: string[]; fields: ProfileRule[]; referencePage?: number | null; materialTypeId?: string; classification?: '' | 'suggested' | 'confirmed' }
export interface MaterialType { id: string; name: string; outputKey: string; required: boolean; grouping: 'auto' | 'document' | 'per_page' }
export interface StudioSampleLink { sampleId: string; templateId: string; role: 'calibration' | 'test' }
export interface ProfileDraft { id: string; name: string; description: string; templates: ProfileTemplate[]; preprocessing?: PreprocessingPolicy; samples?: StudioSampleLink[]; materialTypes?: MaterialType[]; output?: { mode: 'by_type' | 'records' }; resourceKind?: 'parser' }
export interface BundleItem { sourceName: string; sourceIndex: number; sampleId?: string; materialTypeId?: string; materialTypeName?: string; templateId?: string; templateName?: string; pages: number[]; status: string; passed: boolean; fields: ProfileTest['fields']; data?: Record<string, string | null> | null; error?: string; id?: string; label?: string }
export interface BundleResult { passed: boolean; usesLlm: false; totalElapsedMs: number; elapsedMs: number; items: BundleItem[]; missingTypes: string[]; data: unknown; summary: { files: number; total: number; succeeded: number; failed: number }; files: Array<{ name: string; sampleId?: string; error?: string; result?: ProfileTest }> }
export interface ProfileTest {
  templateId: string; templateName: string; sampleId: string; testedAt: string; scope: 'reference' | 'new-sample';
  engine: string; elapsedMs: number; recognitionMs?: number; passed: boolean; usesLlm: false;
  preprocessing?: PreprocessingReport;
  items?: Array<ProfileTest & { id: string; label: string; pages: number[]; error?: string; status: string }>;
  summary?: { total: number; succeeded: number; failed: number };
  fields: Array<{ key: string; name: string; value: string; raw: string; status: 'matched' | 'missing' | 'invalid'; issue: string; page: number; bbox: Box | null; originalBBox?: Box; evidence: SourceEvidence[] }>;
}
export interface ProfileRecord {
  draft: ProfileDraft; createdAt: string; updatedAt: string; versions: string[];
  publishedDraft?: ProfileDraft;
  lastTest?: { hash: string; templates: Record<string, ProfileTest> };
  lastEvaluation?: { id: string; hash: string; summary: EvaluationSummary; passed: boolean; createdAt: string };
}
export interface ProfileRelease {
  version: string; publishedAt: string; templates: number; fields: number;
  tests: { passed: number; total: number } | null; note: string;
}
export interface EvaluationSummary { total: number; passed: number; failed: number; totalFields: number; matchedFields: number; ruleP95Ms: number; elapsedMs: number }
export interface EvaluationReport {
  id: string; profileId: string; createdAt: string; hash: string; draft: ProfileDraft;
  mode: 'rule_replay'; usesLlm: false; passed: boolean; summary: EvaluationSummary;
  rows: Array<{ sampleId: string; name: string; passed: boolean; result: ProfileTest | null; totalFields: number; matchedFields: number; elapsedMs: number; error: string }>;
}
export interface StudioRun { id: string; version: string; createdAt: string; name: string; status: 'succeeded' | 'needs_review' | 'failed'; totalElapsedMs: number; ruleMs: number | null; units: number; error: string; usesLlm: false }
export interface ProfileSummary {
  id: string; name: string; description: string; templates: number; fields: number;
  versions: string[]; updatedAt: string; hasUnpublishedChanges: boolean;
}
export interface SharedScene {
  id: string; profileId: string; name: string; description: string; version: string;
  publisher: string; team: string; publishedAt: string; templates: number;
  fields: Array<{ key: string; name: string; kind: string }>; inputs: string[]; endpoint: string;
}
export interface PublicationReview {
  id: string; profileId: string; name: string; description: string; version: string; publisher: string; team: string;
  status: 'pending' | 'approved' | 'rejected'; submittedAt: string; reviewedAt: string | null;
  reviewer: string; comment: string; entryId: string; mock: true;
}
export const profileId = () => crypto.randomUUID().replaceAll('-', '');

export async function profileJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(typeof error.detail === 'string' ? error.detail : '操作失败，请检查配置后重试。');
  }
  return response.json();
}
const post = (body?: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
export const profileApi = {
  list: () => profileJson<ProfileSummary[]>('/api/extraction-profiles'),
  library: () => profileJson<SharedScene[]>('/api/scene-library'),
  libraryEntry: (id: string) => profileJson<SharedScene & { draft: ProfileDraft }>(`/api/scene-library/${encodeURIComponent(id)}`),
  share: (id: string, version: string, publisher: string, team: string) => profileJson<PublicationReview>(`/api/extraction-profiles/${id}/share`, post({ version, publisher, team })),
  reviews: () => profileJson<PublicationReview[]>('/api/scene-publication-reviews'),
  review: (id: string, decision: 'approved' | 'rejected', reviewer: string, comment: string) => profileJson<PublicationReview>(`/api/scene-publication-reviews/${id}/decision`, post({ decision, reviewer, comment })),
  read: (id: string) => profileJson<ProfileRecord>(`/api/extraction-profiles/${encodeURIComponent(id)}`),
  releaseCheck: (id: string) => profileJson<ReleaseReport>(`/api/extraction-profiles/${encodeURIComponent(id)}/release-check`),
  save: (draft: ProfileDraft) => profileJson<ProfileRecord>(`/api/extraction-profiles/${draft.id}`, { ...post(draft), method: 'PUT' }),
  sample: (id: string) => profileJson<ProfileSample>(`/api/profile-samples/${encodeURIComponent(id)}`),
  suggest: (id: string, request: string, referencePage = 1) => profileJson<ProfileRule[]>(`/api/profile-samples/${id}/suggest`, post({ request, referencePage })),
  generate: (id: string, request: string, requirements: RequirementDefinition | undefined, referencePage: number, signal: AbortSignal) => profileJson<GeneratedRules>(`/api/profile-samples/${id}/generate-rules`, { ...post({ request, requirements, referencePage }), signal }),
  assist: (id: string, request: string, fields: ProfileRule[], selectedId: string, referencePage: number, requirements: RequirementDefinition | undefined, history: AssistantMessage[], signal: AbortSignal) => profileJson<AssistantReply>(`/api/profile-samples/${id}/assist-rules`, { ...post({ request, fields, selectedId, referencePage, requirements, history }), signal }),
  previewRule: (id: string, rule: ProfileRule, referencePage: number, signal: AbortSignal) => profileJson<RulePreview>(`/api/profile-samples/${id}/preview-rule`, { ...post({ rule, referencePage }), signal }),
  fromDocument: (id: string) => profileJson<ProfileSample>('/api/profile-samples/from-document', post({ documentId: id })),
  test: (id: string, sampleId: string, templateId: string) => profileJson<ProfileTest>(`/api/extraction-profiles/${id}/test`, post({ sampleId, templateId })),
  publish: (id: string, note = '') => profileJson<ProfileRecord>(`/api/extraction-profiles/${id}/publish`, post({ note })),
  reports: (id: string) => profileJson<EvaluationReport[]>(`/api/extraction-profiles/${id}/evaluations`),
  report: (id: string, report: string) => profileJson<EvaluationReport>(`/api/extraction-profiles/${id}/evaluations/${report}`),
  evaluate: (id: string, sampleIds: string[]) => profileJson<EvaluationReport>(`/api/extraction-profiles/${id}/evaluations`, post({ sampleIds })),
  runs: (id: string) => profileJson<StudioRun[]>(`/api/extraction-profiles/${id}/runs`),
  version: (id: string, version: string) => profileJson<ProfileDraft>(`/api/extraction-profiles/${id}/versions/${version}`),
  releases: (id: string) => profileJson<ProfileRelease[]>(`/api/extraction-profiles/${encodeURIComponent(id)}/releases`),
  debugBundle: (id: string, files: File[], signal: AbortSignal) => { const body = new FormData(); files.forEach(file => body.append('files', file, file.name)); return profileJson<BundleResult>(`/api/extraction-profiles/${id}/debug-bundle`, { method: 'POST', body, signal }); },
};

export async function prepareProfileBundle(files: File[], policy: PreprocessingPolicy, signal: AbortSignal) {
  const body = new FormData(); files.forEach(file => body.append('files', file, file.name)); body.append('preprocessing_config', JSON.stringify(policy));
  return profileJson<{ samples: ProfileSample[]; failures: Array<{ name: string; error: string }> }>('/api/profile-sample-bundles', { method: 'POST', body, signal });
}

export function suggestMaterialType(draft: ProfileDraft, template: ProfileTemplate, sample: ProfileSample): ProfileDraft {
  const text = sample.blocks.map(block => block.text).join('');
  const title = sample.blocks.filter(block => block.pageIndex === 0 && block.bbox[1] < .3).map(block => block.text).join('');
  const suggestion = /合同|协议书/.test(title) ? { name: '合同', outputKey: 'contracts', grouping: 'document' as const }
    : /电子发票|增值税.{0,10}发票|发票号码/.test(title) ? { name: '发票', outputKey: 'invoices', grouping: 'per_page' as const }
    : /合同|协议书/.test(text) ? { name: '合同', outputKey: 'contracts', grouping: 'document' as const }
    : /送货单|收据|付款单|结算单|回单/.test(text) ? { name: '单据', outputKey: 'vouchers', grouping: 'document' as const } : undefined;
  const types = [...draft.materialTypes || []];
  let kind = suggestion ? types.find(item => item.name === suggestion.name) : undefined;
  if (suggestion && !kind) { const used = new Set(types.map(item => item.outputKey)); let key = suggestion.outputKey; let index = 2; while (used.has(key)) key = `${suggestion.outputKey}_${index++}`; kind = { id: profileId(), ...suggestion, outputKey: key, required: false }; types.push(kind); }
  return { ...draft, ...(types.length ? { materialTypes: types, output: draft.output || { mode: 'by_type' } } : {}), templates: draft.templates.map(item => item.id === template.id ? { ...item, materialTypeId: kind?.id || '', classification: 'suggested' } : item) };
}

export function materialGroups(draft: ProfileDraft) {
  const groups = (draft.materialTypes || []).map(kind => ({ ...kind, templates: draft.templates.filter(item => item.materialTypeId === kind.id) }));
  const unassigned = draft.templates.filter(item => !item.materialTypeId || !draft.materialTypes?.some(kind => kind.id === item.materialTypeId));
  if (unassigned.length) groups.push({ id: '', name: draft.materialTypes?.length || unassigned.some(item => item.classification === 'suggested') ? '待分类' : '材料版式', outputKey: '', required: false, grouping: 'document', templates: unassigned });
  return groups;
}

export async function prepareProfileSample(file: File, onProgress: (text: string) => void, signal?: AbortSignal, policy = defaultPreprocessing): Promise<ProfileSample> {
  if (file.size > 30 * 1024 * 1024) throw new Error('样例限 30 MB，请压缩后重试。');
  if (!/\.(pdf|png|jpe?g|webp)$/i.test(file.name)) throw new Error('请选择 PDF、PNG、JPEG 或 WebP 样例。');
  const data = new FormData(); data.append('file', file); data.append('fields', '[]'); data.append('prompt', '固定版式样例识别'); data.append('ocr_only', 'true');
  data.append('preprocessing_config', JSON.stringify(policy));
  onProgress('正在读取样例');
  const job = await profileJson<{ id: string }>('/api/tasks', { method: 'POST', body: data, signal });
  try {
    while (true) {
      const state = await profileJson<{ status: string; phase: string; error?: string }>(`/api/tasks/${job.id}`, { signal });
      onProgress(state.phase);
      if (state.status === 'succeeded') return await profileJson<ProfileSample>(`/api/profile-samples/from-task/${job.id}`, { ...post(), signal });
      if (state.status === 'failed' || state.status === 'cancelled') throw new Error(state.error || '样例识别已停止，请重试。');
      await new Promise<void>((resolve, reject) => {
        const stop = () => { clearTimeout(timer); reject(new DOMException('已取消', 'AbortError')); };
        const timer = setTimeout(() => { signal?.removeEventListener('abort', stop); resolve(); }, 600);
        signal?.addEventListener('abort', stop, { once: true });
        if (signal?.aborted) stop();
      });
    }
  } finally { void fetch(`/api/documents/${job.id}`, { method: 'DELETE' }).catch(() => {}); }
}

export function paddedBox(box: Box): Box { return [Math.max(0, box[0] - .005), Math.max(0, box[1] - .006), Math.min(1, box[2] + .005), Math.min(1, box[3] + .006)]; }
export function selectionBox(first: { x: number; y: number }, last: { x: number; y: number }): Box | null {
  const limit = (value: number) => Math.max(0, Math.min(1, value));
  const box: Box = [limit(Math.min(first.x, last.x)), limit(Math.min(first.y, last.y)), limit(Math.max(first.x, last.x)), limit(Math.max(first.y, last.y))];
  return box[2] - box[0] < .004 || box[3] - box[1] < .004 ? null : box;
}
export function rulesFromMaterial(material: Material): ProfileRule[] {
  const firstUnit = (material.parsed?.units?.length || 0) > 1 ? material.parsed!.units![0] : undefined;
  const results = firstUnit ? (material.results || []).filter(field => field.unitId ? field.unitId === firstUnit.id : field.page && firstUnit.pages.includes(field.page)) : material.results || [];
  return results.map((field, index) => {
    const evidence = field.evidence?.filter(item => item.pageIndex === (field.page || 1) - 1) || [];
    const region: Box | null = evidence.length ? [Math.min(...evidence.map(item => item.bbox[0])), Math.min(...evidence.map(item => item.bbox[1])), Math.max(...evidence.map(item => item.bbox[2])), Math.max(...evidence.map(item => item.bbox[3]))] : null;
    return { id: profileId(), key: `field_${index + 1}`, name: field.name, kind: 'text', method: 'region', page: field.page || 1,
      region: region ? paddedBox(region) : null, anchor: '', direction: 'right', required: true };
  });
}
export function newTemplate(sample: ProfileSample, fields: ProfileRule[] = []): ProfileTemplate {
  const invoice = sample.blocks.some(block => block.text.includes('电子发票'));
  return { id: profileId(), name: invoice ? '电子发票版式' : sample.name.replace(/\.[^.]+$/, ''), sampleId: sample.id,
    matchTexts: invoice ? ['电子发票', '发票号码'] : [], fields, referencePage: (sample.units?.length || 0) > 1 ? 1 : null };
}

export function mapProfileBox(box: Box, inverse?: number[][]): Box {
  if (!inverse) return box;
  const corners = [[box[0], box[1]], [box[2], box[1]], [box[2], box[3]], [box[0], box[3]]].map(([x, y]) => {
    const w = inverse[2][0] * x + inverse[2][1] * y + inverse[2][2];
    return [(inverse[0][0] * x + inverse[0][1] * y + inverse[0][2]) / w, (inverse[1][0] * x + inverse[1][1] * y + inverse[1][2]) / w];
  });
  return [Math.max(0, Math.min(...corners.map(p => p[0]))), Math.max(0, Math.min(...corners.map(p => p[1]))), Math.min(1, Math.max(...corners.map(p => p[0]))), Math.min(1, Math.max(...corners.map(p => p[1])))];
}
