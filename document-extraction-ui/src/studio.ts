import { profileJson, type ProfileSummary, type BundleResult, type ProfileSample, type ProfileDraft, type ProfileRule } from './profiles.ts';
import type { RequirementDefinition } from './types.ts';
import type { ReleaseReport } from './release.ts';

export interface SceneBinding { id: string; parserId: string; version: string; name: string; required: boolean; multiple: boolean }
export interface SceneDraft { id: string; name: string; description: string; bindings: SceneBinding[] }
export interface EfficiencyBaseline { minutesPerRun: number | null; updatedAt?: string }
export interface SceneRecord { draft: SceneDraft; versions: string[]; updatedAt: string; publishedHash?: string; publishedDraft?: SceneDraft; efficiency?: EfficiencyBaseline; lastTest?: { passed: boolean; testedAt: string; result: CompositionResult } }
export interface SceneSummary { id: string; name: string; description: string; bindings: number; versions: string[]; updatedAt: string; hasUnpublishedChanges: boolean }
export interface CompositionResult extends BundleResult { issues: string[] }
export interface PlannerSource { request: string; sampleIds: string[]; requirements: RequirementDefinition[] }
export interface ParserSpec { name: string; description: string; reuseParserId: string; required: boolean; multiple: boolean; layouts: Array<{ name: string; sampleIds: string[] }>; fields: Array<{ name: string; key: string; kind: ProfileRule['kind']; rule: string }> }
export interface StudioPlan { name: string; description: string; parsers: ParserSpec[]; questions: string[] }
export interface PlanReply { plan: StudioPlan; unassigned: string[]; usesLlm: true }
const post = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
export const sceneApi = {
  catalog: () => profileJson<{ scenes: SceneSummary[]; parsers: ProfileSummary[] }>('/api/studio/catalog'),
  read: (id: string) => profileJson<SceneRecord>(`/api/studio/scenes/${id}`),
  save: (draft: SceneDraft) => profileJson<SceneRecord>(`/api/studio/scenes/${draft.id}`, { ...post(draft), method: 'PUT' }),
  efficiency: (id: string, minutesPerRun: number | null) => profileJson<EfficiencyBaseline>(`/api/studio/scenes/${id}/efficiency`, { ...post({ minutesPerRun }), method: 'PUT' }),
  publish: (id: string) => profileJson<SceneRecord>(`/api/studio/scenes/${id}/publish`, post({})),
  releaseCheck: (id: string) => profileJson<ReleaseReport>(`/api/studio/scenes/${id}/release-check`),
  runs: (id: string) => profileJson<Array<{ version: string; createdAt: string; passed: boolean; totalElapsedMs: number; summary: { total: number } }>>(`/api/studio/scenes/${id}/runs`),
  debug: (id: string, files: File[], assignments: Record<string, string>, signal: AbortSignal) => { const body = new FormData(); files.forEach(file => body.append('files', file, file.name)); body.append('assignments', JSON.stringify(assignments)); return profileJson<CompositionResult>(`/api/studio/scenes/${id}/debug-bundle`, { method: 'POST', body, signal }); },
  plan: (source: PlannerSource, signal: AbortSignal) => profileJson<PlanReply>('/api/studio/plan', { ...post(source), signal }),
  apply: (source: PlannerSource, plan: StudioPlan, signal?: AbortSignal) => profileJson<{ scene: SceneRecord; parserIds: string[]; unassigned: string[]; localizedFields: number; warnings: string[] }>('/api/studio/plan/apply', { ...post({ source, plan }), signal }),
};

/** Definition edits are shared; each layout retains its own localization. */
export function synchronizeParserFields(draft: ProfileDraft, previous: ProfileDraft['templates'][number], updated: ProfileDraft['templates'][number]): ProfileDraft {
  if (draft.resourceKind !== 'parser') return { ...draft, templates: draft.templates.map(t => t.id === updated.id ? updated : t) };
  return { ...draft, templates: draft.templates.map(template => {
    if (template.id === updated.id) return updated;
    const fields = updated.fields.map(field => {
      const original = previous.fields.find(f => f.id === field.id);
      const existing = template.fields.find(f => f.key === (original?.key || field.key));
      return existing ? { ...existing, name: field.name, key: field.key, kind: field.kind, required: field.required,
        ...(existing.origin === 'ai' && (existing.name !== field.name || existing.key !== field.key || existing.kind !== field.kind || existing.required !== field.required) ? { review: 'pending' as const } : {}) }
        : { ...field, id: crypto.randomUUID().replaceAll('-', ''), region: null, anchor: '', method: 'region' as const, page: 1, review: field.origin === 'ai' ? 'pending' as const : 'confirmed' as const };
    });
    return { ...template, fields };
  }) };
}

export function parserDraft(value: ProfileDraft): ProfileDraft {
  const kinds = value.materialTypes || [];
  if (kinds.length > 1) throw new Error('这是旧的多材料场景，请从 Studio 目录打开拆分后的服务。');
  const { materialTypes: _types, output: _output, ...rest } = value;
  return { ...rest, resourceKind: 'parser', preprocessing: { orientation: 'auto', deskew: 'auto', grouping: 'auto', ...value.preprocessing, ...(kinds.length ? { grouping: kinds[0].grouping } : {}) }, templates: value.templates.map(({ materialTypeId: _type, classification: _classification, ...template }) => template) };
}

export const sampleNames = (ids: string[], samples: ProfileSample[]) => ids.map(id => samples.find(s => s.id === id)?.name || id).join('、');
