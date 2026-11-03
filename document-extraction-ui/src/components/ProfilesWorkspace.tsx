import { ProductIcon } from './ProductIcon.tsx';
import { DEMO_ACCOUNT_NAME } from '../account.ts';
import { useEffect, useRef, useState } from 'react';
import { App, Alert, Button, Drawer, Dropdown, Empty, Input, InputNumber, Layout, Select, Space, Spin, Switch, Tabs, Tag, Tooltip, Typography } from 'antd';
import { ArrowLeftOutlined, CheckCircleOutlined, DeleteOutlined, EditOutlined, FileSearchOutlined, MoreOutlined, PlayCircleOutlined, PlusOutlined, RobotOutlined, RocketOutlined } from '@ant-design/icons';
import { defaultPreprocessing, materialGroups, newTemplate, prepareProfileBundle, prepareProfileSample, profileApi, profileId, rulesFromMaterial, type AssistantChange, type Box, type BundleResult, type EvaluationReport, type ProfileDraft, type ProfileRecord, type ProfileRule, type ProfileSample, type ProfileSummary, type ProfileTest, type StudioRun, type SharedScene, type PublicationReview } from '../profiles.ts';
import type { Material, RequirementDefinition, PreprocessingPolicy } from '../types.ts';
import { ProfileCanvas } from './ProfileCanvas.tsx';
import { PreprocessingSettings } from './PreprocessingSettings.tsx';
import { StudioEvaluation, StudioPreview, StudioRelease, StudioRuns, StudioSamples } from './StudioPanels.tsx';
import { StudioHelp, StudioHome, type StudioHomeView } from './StudioHome.tsx';
import { HelpCenter } from '../help/HelpCenter.tsx';
import { StudioEditorLayout } from './StudioEditorLayout.tsx';
import { RuleSamplePreview, RuleSourceEditor, StudioSetup } from './StudioSetup.tsx';
import { SceneWorkspace } from './SceneWorkspace.tsx';
import { parserDraft, sceneApi, synchronizeParserFields, type SceneSummary } from '../studio.ts';
import { PublicationReviews } from './PublicationReviews.tsx';
import { StudioBundleDebug } from './StudioBundleDebug.tsx';
import { StudioAssistant, type AssistantSession } from './StudioAssistant.tsx';
import { applyAssistantChanges, assistantSignature } from '../assistant.ts';
import { DraftSaveStatus, useDraftAutosave } from './DraftAutosave.tsx';
import { StudioTrialResult } from './StudioTrialResult.tsx';
import { ReleaseChecklist } from './ReleaseChecklist.tsx';
import type { ReleaseTarget } from '../release.ts';

export interface ProfileSeed { token: number; material: Material }
const sampleAccept = '.pdf,.png,.jpg,.jpeg,.webp,.zip';
const studioTabs = [{ key: 'fields', label: '提取配置' }, { key: 'test', label: '单份调试' }, { key: 'evaluate', label: '批量测试' }, { key: 'api', label: '接口与版本' }, { key: 'runs', label: '运行记录' }];
function draftIssue(value: ProfileDraft) {
  if (!value.name.trim()) return '请填写服务名称';
  for (const template of value.templates) {
    if (template.fields.some(field => !field.name.trim() || !/^[a-zA-Z][a-zA-Z0-9_]{0,59}$/.test(field.key))) return '请填写字段名称；接口字段名以英文字母开头，只含字母、数字和下划线。';
    if (new Set(template.fields.map(field => field.key)).size !== template.fields.length) return '接口字段名不能重复，请修改后保存。';
  }
}
const profileUrl = (id?: string, tab = 'fields') => {
  const url = new URL(location.href);
  url.searchParams.set('page', 'profiles');
  if (id) url.searchParams.set('profile', id); else url.searchParams.delete('profile');
  url.searchParams.delete('workspace');
  if (id || !['home', 'mine'].includes(tab)) url.searchParams.set('studio', tab); else url.searchParams.delete('studio');
  if (url.href !== location.href) window.history.pushState(null, '', url);
};

export function ProfilesWorkspace({ visible, seed, entryKey = 0, onNavigate }: { visible: boolean; seed: ProfileSeed | null; entryKey?: number; onNavigate?: (page: string) => void }) {
  const { message } = App.useApp();
  const [records, setRecords] = useState<ProfileSummary[]>([]);
  const [sceneRecords, setSceneRecords] = useState<SceneSummary[]>([]);
  const [sceneId, setSceneId] = useState(() => new URLSearchParams(location.search).get('scene') || '');
  const [returnScene, setReturnScene] = useState(() => new URLSearchParams(location.search).get('returnScene') || '');
  const [sceneCreateKey, setSceneCreateKey] = useState(0);
  const [library, setLibrary] = useState<SharedScene[]>([]);
  const [libraryError, setLibraryError] = useState('');
  const [reviews, setReviews] = useState<PublicationReview[]>([]);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [shareTarget, setShareTarget] = useState<{ id: string; name: string; versions: string[] }>();
  const assistantSessions = useRef(new Map<string, AssistantSession>());
  const [assistantPreview, setAssistantPreview] = useState<ProfileRule>();
  const [assistantPrompt, setAssistantPrompt] = useState<{ token: number; text: string; scope: string }>();
  const [shareVersion, setShareVersion] = useState('');
  const [publisherLabel, setPublisherLabel] = useState('');
  const [publisherTeam, setPublisherTeam] = useState('');
  const [record, setRecord] = useState<ProfileRecord | null>(null);
  const [draft, setDraft] = useState<ProfileDraft | null>(null);
  const [samples, setSamples] = useState<Record<string, ProfileSample>>({});
  const [templateId, setTemplateId] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [locateRequest, setLocateRequest] = useState<{ token: number; fieldId: string }>();
  const [page, setPage] = useState(1);
  const [tab, setTab] = useState('fields');
  const [propertyTab, setPropertyTab] = useState('fields');
  const [setupTemplateId, setSetupTemplateId] = useState('');
  const [testResult, setTestResult] = useState<ProfileTest>();
  const [trialOpen, setTrialOpen] = useState(false);
  const [releaseOpen, setReleaseOpen] = useState(false);
  const [testItem, setTestItem] = useState(0);
  const [bundleResult, setBundleResult] = useState<BundleResult>();
  const [reports, setReports] = useState<EvaluationReport[]>([]);
  const [evaluation, setEvaluation] = useState<EvaluationReport>();
  const [runs, setRuns] = useState<StudioRun[]>([]);
  const [preview, setPreview] = useState<{ id: string; result?: ProfileTest }>();
  const [query, setQuery] = useState(''); const [filter, setFilter] = useState('全部');
  const [phase, setPhase] = useState(''); const [error, setError] = useState(''); const [booting, setBooting] = useState(false);
  const [view, setView] = useState<StudioHomeView | 'workspace' | 'scene'>(() => new URLSearchParams(location.search).has('profile') ? 'workspace' : new URLSearchParams(location.search).has('scene') ? 'scene' : 'mine');
  const [guideOpen, setGuideOpen] = useState(false);
  const [routeTick, setRouteTick] = useState(0);
  const entryRequest = useRef('');
  const [drawer, setDrawer] = useState<'new' | 'settings' | 'samples' | 'share' | null>(null);
  const [copySource, setCopySource] = useState<ProfileDraft | null>(null);
  const [name, setName] = useState(''); const [request, setRequest] = useState('');
  const [settingsPolicy, setSettingsPolicy] = useState<PreprocessingPolicy>(defaultPreprocessing);
  const [templateName, setTemplateName] = useState(''); const [matchWords, setMatchWords] = useState<string[]>([]);
  const [prepared, setPrepared] = useState<ProfileSample | null>(null); const [seedRules, setSeedRules] = useState<ProfileRule[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const inputPurpose = useRef<'new' | 'replace' | 'test' | 'dataset' | 'bundle'>('new');
  const controller = useRef<AbortController | null>(null); const consumedSeed = useRef(0);
  const opening = useRef(false); const draftRef = useRef(draft); draftRef.current = draft;
  const active = draft?.templates.find(item => item.id === templateId) || draft?.templates[0];
  const sample = active ? samples[active.sampleId] : undefined;
  const selected = active?.fields.find(item => item.id === selectedId);
  const displayResult = testResult?.items?.[testItem] || testResult;
  const dirty = !!draft && JSON.stringify(draft) !== JSON.stringify(record?.draft);
  const busy = !!phase || booting;
  const autosave = useDraftAutosave({ draft, saved: record, active: visible && view === 'workspace', paused: busy, write: profileApi.save, validate: draftIssue, onSaved: (saved, submitted) => {
    if (draftRef.current?.id !== submitted.id) return;
    setRecord(saved);
    if (JSON.stringify(draftRef.current) === JSON.stringify(submitted)) { draftRef.current = saved.draft; setDraft(saved.draft); }
    void refresh().catch(() => {});
  } });

  async function refresh() {
    const [mine, shared, applications] = await Promise.allSettled([sceneApi.catalog(), profileApi.library(), profileApi.reviews()]);
    if (applications.status === 'fulfilled') setReviews(applications.value);
    else throw applications.reason;
    if (shared.status === 'fulfilled') { setLibrary(shared.value); setLibraryError(''); } else setLibraryError(shared.reason instanceof Error ? shared.reason.message : '公共场景目录读取失败');
    if (mine.status === 'rejected') throw mine.reason;
    setRecords(mine.value.parsers); setSceneRecords(mine.value.scenes); return mine.value.parsers;
  }
  async function action<T>(label: string, run: () => Promise<T>): Promise<T | undefined> {
    if (controller.current) return;
    const abort = new AbortController(); controller.current = abort; setPhase(label); setError('');
    try { return await run(); }
    catch (error) { if (!abort.signal.aborted) { const text = error instanceof Error ? error.message : '操作失败，请重试'; setError(text); void message.error(text); } }
    finally { if (controller.current === abort) { controller.current = null; setPhase(''); } }
  }
  function edit(next: ProfileDraft) { draftRef.current = next; setDraft(next); setAssistantPreview(undefined); setTestResult(undefined); setBundleResult(undefined); setTrialOpen(false); }
  function editTemplate(update: (value: NonNullable<typeof active>) => NonNullable<typeof active>) { if (draft && active) edit(synchronizeParserFields(draft, active, update(active))); }
  function editField(update: Partial<ProfileRule>) { if (selected) editTemplate(value => ({ ...value, fields: value.fields.map(field => field.id === selected.id ? { ...field, ...update, ...((field.origin === 'ai' || field.review === 'confirmed') && !('review' in update) ? { review: 'pending' as const } : {}) } : field) })); }
  function changeTab(value: string) { setAssistantPreview(undefined); setTab(value); if (draft) profileUrl(draft.id, value); }
  function selectField(id: string) { setLocateRequest(undefined); setSelectedId(id); if (tab !== 'test') { changeTab('fields'); setPropertyTab('fields'); } const field = active?.fields.find(item => item.id === id); if (field) setPage(tab === 'test' ? displayResult?.fields.find(item => item.key === field.key)?.page || field.page : active?.referencePage || field.page); }
  function selectTemplate(id: string, targetTab = tab) { setLocateRequest(undefined); setAssistantPreview(undefined); setSetupTemplateId(''); setPropertyTab('fields'); setTrialOpen(false); const value = draft?.templates.find(item => item.id === id); setTemplateId(id); setSelectedId(value?.fields[0]?.id || ''); setPage(value?.referencePage || 1); setTestItem(0); setTestResult(record?.lastTest?.templates[id]); changeTab(targetTab); }
  function locateField() { if (selected && !busy) { setAssistantPreview(undefined); setPage(active?.referencePage || selected.page); setLocateRequest({ token: Date.now(), fieldId: selected.id }); } }
  async function saveCurrent(value = draftRef.current) { return autosave.flush(value); }
  async function load(recordId: string, targetTab = 'fields') {
    await action('正在打开服务', async () => {
      if (draft && dirty) await saveCurrent();
      const value = await profileApi.read(recordId);
      if (value.draft.materialTypes?.length) { value.lastTest = undefined; value.lastEvaluation = undefined; }
      value.draft = parserDraft(value.draft);
      setBundleResult(undefined); setTrialOpen(false); setLocateRequest(undefined);
      const ids = [...new Set([...value.draft.templates.map(item => item.sampleId), ...(value.draft.samples || []).map(item => item.sampleId), ...Object.values(value.lastTest?.templates || {}).map(item => item.sampleId)])];
      const loaded = await Promise.all(ids.map(id => profileApi.sample(id)));
      setSamples(values => ({ ...values, ...Object.fromEntries(loaded.map(item => [item.id, item])) }));
      const first = value.draft.templates[0]; setRecord(value); setDraft(value.draft); setTemplateId(first?.id || ''); setSelectedId(first?.fields[0]?.id || ''); setPage(first?.referencePage || 1); setTestItem(0); setTestResult(first ? value.lastTest?.templates[first.id] : undefined);
      setSetupTemplateId(''); setPropertyTab(first?.fields.length ? 'fields' : 'assistant');
      const target = targetTab === 'samples' ? 'fields' : targetTab;
      setReports([]); setEvaluation(undefined); setRuns([]); setDrawer(targetTab === 'samples' && value.draft.templates.length ? 'samples' : null); setTab(target); setView('workspace'); profileUrl(recordId, target);
    });
  }
  useEffect(() => {
    if (!visible) { entryRequest.current = ''; return; }
    const signature = `${entryKey}:${routeTick}`;
    if (opening.current || controller.current || entryRequest.current === signature) return;
    entryRequest.current = signature;
    opening.current = true; setBooting(true);
    void refresh().then(async () => {
      if (seed && seed.token !== consumedSeed.current) return;
      const search = new URLSearchParams(location.search);
      const id = search.get('profile');
      const requested = search.get('studio');
      setReturnScene(search.get('returnScene') || '');
      if (id) {
        const target = requested === 'evaluate' || studioTabs.some(item => item.key === requested) ? requested! : 'fields';
        if (id !== draftRef.current?.id) await load(id, target);
        else { setView('workspace'); setTab(target); }
      } else if (search.get('scene')) {
        setSceneId(search.get('scene')!); setView('scene');
      } else {
        if (draftRef.current && JSON.stringify(draftRef.current) !== JSON.stringify(record?.draft)) await saveCurrent(draftRef.current);
        setView(requested === 'library' ? 'library' : requested === 'parsers' ? 'parsers' : 'mine');
        setGuideOpen(requested === 'guide');
      }
    }).catch(error => setError(error.message)).finally(() => { opening.current = false; setBooting(false); });
  }, [visible, entryKey, routeTick, phase]);
  useEffect(() => {
    const restore = () => setRouteTick(value => value + 1);
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, []);
  useEffect(() => () => { controller.current?.abort(); controller.current = null; }, []);
  useEffect(() => {
    if (!seed || seed.token === consumedSeed.current || controller.current) return;
    consumedSeed.current = seed.token;
    void action('正在复用原文与字段', async () => {
      if (draft && dirty) await saveCurrent();
      setName(`${seed.material.name.replace(/\.[^.]+$/, '')}服务`); setRequest(''); setSeedRules(rulesFromMaterial(seed.material)); setPrepared(null); setCopySource(null); setDrawer('new');
      let value: ProfileSample | undefined;
      if (seed.material.parsed && !seed.material.parsed.historyId) { try { value = await profileApi.fromDocument(seed.material.parsed.id); } catch { /* Re-read the durable original if the temporary job expired. */ } }
      if (!value) {
        let file = seed.material.sourceFile;
        if (!file && seed.material.sourceUrl) { const response = await fetch(seed.material.sourceUrl, { signal: controller.current?.signal }); if (!response.ok) throw new Error('原文读取失败，请重新上传样例。'); file = new File([await response.blob()], seed.material.name); }
        if (!file) throw new Error('请选择实际 PDF 或图片结果');
        value = await prepareProfileSample(file, setPhase, controller.current?.signal);
      }
      setPrepared(value);
    });
  }, [seed, phase]);
  useEffect(() => {
    if (!visible || view !== 'workspace' || !draft || !['evaluate', 'runs'].includes(tab)) return;
    const id = draft.id; let alive = true;
    if (tab === 'evaluate') void profileApi.reports(id).then(values => { if (alive) setReports(values); }).catch(error => { if (alive) setError(error.message); });
    if (tab === 'runs') void profileApi.runs(id).then(values => { if (alive) setRuns(values); }).catch(error => { if (alive) setError(error.message); });
    return () => { alive = false; };
  }, [visible, view, draft?.id, tab]);
  function newProfile() { setName(''); setRequest(''); setPrepared(null); setSeedRules([]); setCopySource(null); setGuideOpen(false); setDrawer('new'); }
  function showHome(target: StudioHomeView = 'mine') {
    const enter = () => { setView(target); setSceneId(''); setReturnScene(''); setDrawer(null); setError(''); profileUrl(undefined, target); const url = new URL(location.href); url.searchParams.delete('scene'); url.searchParams.delete('returnScene'); window.history.replaceState(null, '', url); void refresh().catch(error => setLibraryError(error.message)); };
    if (dirty) void action('正在保存服务', async () => { await saveCurrent(); enter(); });
    else enter();
  }
  function openScene(id: string) { const enter = () => { const url = new URL(location.href); url.searchParams.set('page', 'profiles'); url.searchParams.set('scene', id); ['profile', 'studio', 'returnScene'].forEach(key => url.searchParams.delete(key)); window.history.pushState(null, '', url); setSceneId(id); setView('scene'); setReturnScene(''); }; if (dirty) void action('正在保存服务', async () => { await saveCurrent(); enter(); }); else enter(); }
  function openSceneParser(id: string) { setReturnScene(sceneId); const url = new URL(location.href); url.searchParams.delete('scene'); url.searchParams.set('returnScene', sceneId); window.history.replaceState(null, '', url); void load(id); }
  async function referenceParser(item: SharedScene, target: string) {
    await action('正在引用服务版本', async () => {
      const value = target ? (await sceneApi.read(target)).draft : { id: profileId(), name: `${item.name}处理场景`.slice(0, 100), description: '', bindings: [] };
      const existing = value.bindings.find(b => b.parserId === item.profileId);
      if (existing && existing.version !== item.version) throw new Error('场景已引用此服务的其他版本，请进入场景选择需要使用的版本。');
      if (!existing) value.bindings.push({ id: `material_${profileId().slice(0, 8)}`, name: item.name, parserId: item.profileId, version: item.version, required: true, multiple: true });
      await sceneApi.save(value); await refresh(); openScene(value.id);
    });
  }
  async function reuseScene(item: SharedScene) {
    await action('正在读取场景配置', async () => {
      const value = (await profileApi.libraryEntry(item.id)).draft;
      const loaded = await Promise.all([...new Set(value.templates.map(template => template.sampleId))].map(id => profileApi.sample(id)));
      setSamples(values => ({ ...values, ...Object.fromEntries(loaded.map(sample => [sample.id, sample])) }));
      setCopySource(value); setPrepared(null); setSeedRules([]); setName(`${value.name} 副本`); setRequest(value.description); setDrawer('new');
    });
  }
  function openShare(target: { id: string; name: string; versions: string[] }, version = target.versions.at(-1) || '') {
    setShareTarget(target); setShareVersion(version); setPublisherLabel(DEMO_ACCOUNT_NAME); setPublisherTeam('智能应用二部'); setDrawer('share');
  }
  async function shareScene() {
    if (!shareTarget) return;
    await action('正在提交公开申请', async () => {
      const review = await profileApi.share(shareTarget.id, shareVersion, publisherLabel.trim(), publisherTeam.trim());
      await refresh(); setDrawer(null); void message.success(review.status === 'approved' ? '此版本已在公共服务库' : '已提交，等待审核');
    });
  }
  async function decidePublication(id: string, decision: 'approved' | 'rejected', reviewer: string, comment: string) {
    await action('正在处理公开申请', async () => {
      await profileApi.review(id, decision, reviewer.trim(), comment.trim()); await refresh();
      void message.success(decision === 'approved' ? '审核通过，已加入公共服务库' : '已退回，请按意见调整');
    });
  }
  async function createProfile() {
    await action('正在创建服务', async () => {
      if (draft && dirty) await saveCurrent();
      const template = prepared ? newTemplate(prepared, seedRules) : null;
      const templates = copySource ? copySource.templates.map(item => ({ ...structuredClone(item), id: profileId() })) : template ? [template] : [];
      const value: ProfileDraft = parserDraft({ id: profileId(), name: name.trim() || '未命名服务', description: request.trim(), templates, samples: [], ...(copySource ? { preprocessing: copySource.preprocessing } : {}) });
      const saved = await profileApi.save(value); if (prepared) setSamples(values => ({ ...values, [prepared.id]: prepared }));
      setBundleResult(undefined);
      const first = templates[0];
      setRecord(saved); setDraft(saved.draft); setTemplateId(first?.id || ''); setSelectedId(first?.fields[0]?.id || ''); setPage(first?.referencePage || 1); setTab('fields'); setView('workspace'); setTestResult(undefined); setReports([]); setEvaluation(undefined); setRuns([]); setDrawer(null); profileUrl(value.id, 'fields'); void refresh().catch(() => {});
      setSetupTemplateId(''); setPropertyTab('fields');
    });
  }
  function pick(purpose: typeof inputPurpose.current) { inputPurpose.current = purpose; if (fileInput.current) { fileInput.current.multiple = ['new', 'dataset', 'bundle'].includes(purpose); fileInput.current.click(); } }
  async function addSamples(files: File[]) {
    if (!draft || !files.length) return;
    const purpose = inputPurpose.current;
    await action('正在读取材料', async () => {
      if (purpose === 'bundle' || (purpose === 'test' && files.some(file => /\.zip$/i.test(file.name)))) {
        await saveCurrent(); setPhase('正在识别材料包并按类型匹配版式');
        const result = await profileApi.debugBundle(draft.id, files, controller.current!.signal);
        const loaded = await Promise.all([...new Set(result.files.flatMap(file => file.sampleId ? [file.sampleId] : []))].map(id => profileApi.sample(id)));
        setSamples(values => ({ ...values, ...Object.fromEntries(loaded.map(sample => [sample.id, sample])) }));
        const saved = await profileApi.read(draft.id); setRecord(saved); setDraft(saved.draft); setBundleResult(result); changeTab('test'); return;
      }
      if (purpose === 'dataset' && (draft.samples?.length || 0) + files.length > 50) throw new Error('每个服务最多保留 50 份附加样例。');
      let next = draft; let last: ProfileSample | undefined; const failures: string[] = [];
      let incoming: ProfileSample[];
      if (files.some(file => /\.zip$/i.test(file.name))) {
        setPhase('正在展开材料包并识别各份样例');
        const bundle = await prepareProfileBundle(files, draft.preprocessing || defaultPreprocessing, controller.current!.signal);
        incoming = bundle.samples; failures.push(...bundle.failures.map(item => `${item.name}：${item.error}`));
      } else {
        incoming = [];
        for (const file of files) {
          try { incoming.push(await prepareProfileSample(file, text => setPhase(`${file.name} · ${text}`), controller.current?.signal, draft.preprocessing || defaultPreprocessing)); }
          catch (error) { if (controller.current?.signal.aborted) throw error; failures.push(`${file.name}：${error instanceof Error ? error.message : '识别失败'}`); }
        }
      }
      if (purpose === 'replace' && incoming.length !== 1) throw new Error('更换基准样例时请选择一份 PDF 或图片；整包材料请使用添加样例。');
      if (purpose === 'dataset' && (draft.samples?.length || 0) + incoming.length > 50) throw new Error('每个服务最多保留 50 份附加样例。');
      if (purpose === 'new' && draft.templates.length + 1 > 10) throw new Error('每个服务最多 10 个版式，同版式材料请添加为测试样例。');
      let addedTemplateId = '';
      for (const value of incoming) {
        try {
          last = value; setSamples(values => ({ ...values, [value.id]: value }));
          if (purpose === 'dataset' || purpose === 'test') next = { ...next, samples: [...next.samples || [], { sampleId: value.id, templateId: purpose === 'dataset' ? '' : active?.id || '', role: 'test' }] };
          else if (purpose === 'replace' && active) next = { ...next, templates: next.templates.map(item => item.id === active.id ? { ...item, sampleId: value.id, fields: item.fields.map(field => ({ ...field, region: null })) } : item) };
          else if (purpose === 'new' && addedTemplateId) { next = { ...next, samples: [...next.samples || [], { sampleId: value.id, templateId: addedTemplateId, role: 'test' }] }; }
          else { const definitions = next.templates[0]?.fields || []; const template = newTemplate(value, definitions.map(field => ({ ...field, id: profileId(), region: null, anchor: '', method: 'region', page: 1 }))); next = { ...next, templates: [...next.templates, template] }; addedTemplateId = template.id; setTemplateId(template.id); setSelectedId(''); setSetupTemplateId(''); setPropertyTab(template.fields.length ? 'fields' : 'assistant'); }
        } catch (error) { if (controller.current?.signal.aborted) throw error; failures.push(`${value.name}：${error instanceof Error ? error.message : '识别失败'}`); }
      }
      if (next !== draft) { edit(next); await saveCurrent(next); }
      if (purpose === 'test' && last && active) { const result = await profileApi.test(draft.id, last.id, active.id); setTestResult(result); setTestItem(0); setPage(result.items?.[0]?.pages[0] || 1); setRecord(await profileApi.read(draft.id)); changeTab('test'); }
      else if (purpose === 'new' || purpose === 'replace') { setPage(1); setPropertyTab(next.templates.find(item => item.id === (addedTemplateId || active?.id))?.fields.length ? 'fields' : 'assistant'); changeTab('fields'); }
      if (failures.length) setError(failures.join('\n'));
    });
  }
  async function importFields(requirements?: RequirementDefinition) {
    if (!active || !draft) return;
    await action('正在导入字段配置', async () => {
      if (!requirements) throw new Error('请先上传 Excel 字段表。');
      const matchTexts = active.matchTexts;
      const suggestions: ProfileRule[] = requirements.fields.map((item, index) => ({ id: profileId(), key: `field_${index + 1}`, name: item.name, kind: 'text', method: 'region', page: 1, region: null, anchor: '', direction: 'right', required: true, stripLabel: false, origin: 'manual', review: 'confirmed', note: item.rule.slice(0, 400) }));
      const added: ProfileRule[] = [];
      for (const field of suggestions) {
        if (active.fields.some(old => old.name === field.name)) continue;
        let key = field.key; let suffix = 2;
        while ([...active.fields, ...added].some(old => old.key === key)) key = `${field.key.slice(0, 54)}_${suffix++}`;
        added.push({ ...field, key });
      }
      const next = synchronizeParserFields(draft, active, { ...active, matchTexts, fields: [...active.fields, ...added] });
      edit(next); await saveCurrent(next); setSetupTemplateId(''); setSelectedId(added[0]?.id || active.fields[0]?.id || ''); setPropertyTab('fields'); setPage(active.referencePage || added[0]?.page || 1);
      void message.success(added.length ? `已导入 ${added.length} 个字段，请在原文上定位` : '同名字段已保留');
    });
  }
  function applyAssistant(baseline: string, changes: AssistantChange[]) {
    const live = draftRef.current;
    const template = live?.templates.find(item => item.id === active?.id);
    if (!live || live.id !== draft?.id || !template) throw new Error('服务已切换，请在原服务重新生成建议。');
    const before = structuredClone(template); const previousSelected = selectedId;
    const after = applyAssistantChanges(template, baseline, changes);
    const applied = synchronizeParserFields(live, template, after);
    edit(applied);
    setAssistantPreview(undefined); setSelectedId(changes.find(change => change.after)?.id || after.fields[0]?.id || '');
    return () => {
      const current = draftRef.current;
      const target = current?.templates.find(item => item.id === template.id);
      if (!current || current.id !== live.id || !target || JSON.stringify(current.templates.map(assistantSignature)) !== JSON.stringify(applied.templates.map(assistantSignature))) throw new Error('字段已有后续修改，不能直接撤销这条旧建议。');
      edit({ ...current, templates: current.templates.map(item => ({ ...item, fields: live.templates.find(old => old.id === item.id)?.fields || item.fields })) });
      setAssistantPreview(undefined); setSelectedId(before.fields.some(field => field.id === previousSelected) ? previousSelected : before.fields[0]?.id || '');
    };
  }
  function addField() {
    if (!active) return; let index = active.fields.length + 1;
    while (active.fields.some(field => field.key === `field_${index}`)) index++;
    const field: ProfileRule = { id: profileId(), key: `field_${index}`, name: `字段 ${index}`, kind: 'text', method: 'region', page: active.referencePage ? 1 : page, region: null, anchor: '', direction: 'right', required: true };
    editTemplate(value => ({ ...value, fields: [...value.fields, field] })); setSelectedId(field.id); setPropertyTab('fields');
  }
  async function reprocessSample() {
    if (!sample || !draft || !active) return;
    await action('正在重新处理样例', async () => {
      const response = await fetch(`/api/profile-samples/${sample.id}/source`, { signal: controller.current?.signal }); if (!response.ok) throw new Error('样例原文读取失败，请重新上传。');
      const value = await prepareProfileSample(new File([await response.blob()], sample.name), setPhase, controller.current?.signal, draft.preprocessing || defaultPreprocessing);
      const before = sample.preprocessing?.policy || defaultPreprocessing; const after = draft.preprocessing || defaultPreprocessing;
      const changed = before.orientation !== after.orientation || before.deskew !== after.deskew;
      setSamples(values => ({ ...values, [value.id]: value })); editTemplate(item => ({ ...item, sampleId: value.id, fields: changed ? item.fields.map(field => ({ ...field, region: null })) : item.fields })); setPage(active.referencePage || 1);
      if (changed) void message.info('页面处理策略已改变，请重新定位字段。');
    });
  }
  async function referenceTest(inline = false) {
    if (!draft || !active) return;
    await action('正在按固定规则测试', async () => { await saveCurrent(); const result = await profileApi.test(draft.id, active.sampleId, active.id); setTestResult(result); setTestItem(0); setPage(result.items?.[0]?.pages[0] || 1); setRecord(await profileApi.read(draft.id)); setTrialOpen(inline); if (!inline) changeTab('test'); });
  }
  async function runEvaluation(ids: string[]) {
    if (!draft) return;
    await action('正在批量回放规则', async () => { await saveCurrent(); const value = await profileApi.evaluate(draft.id, ids); setEvaluation(value); setReports(await profileApi.reports(draft.id)); setRecord(await profileApi.read(draft.id)); });
  }
  async function openReport(id: string) { if (draft) await action('正在读取报告', async () => setEvaluation(await profileApi.report(draft.id, id))); }
  async function openPreview(id: string, result?: ProfileTest) { await action('正在读取材料', async () => { if (!samples[id]) { const value = await profileApi.sample(id); setSamples(values => ({ ...values, [id]: value })); } setPreview({ id, result }); }); }
  async function publish(note = '') { if (draft) { await saveCurrent(); const value = await profileApi.publish(draft.id, note); setRecord(value); setReleaseOpen(false); changeTab('api'); void refresh().catch(() => {}); void message.success(`已发布版本 ${value.versions.at(-1)}`); } }
  function handleReleaseTarget(target: ReleaseTarget) {
    setReleaseOpen(false);
    if (target.templateId) selectTemplate(target.templateId, target.area === 'test' ? 'test' : 'fields');
    if (target.fieldId) { setSelectedId(target.fieldId); const template = draft?.templates.find(item => item.id === target.templateId); const field = template?.fields.find(item => item.id === target.fieldId); if (field) setPage(template?.referencePage || field.page); }
    setPropertyTab('fields');
    if (target.area === 'settings') openSettings(target.templateId);
    else changeTab(target.area === 'test' || target.area === 'evaluate' || target.area === 'api' ? target.area : 'fields');
  }
  function openSettings(id?: string) { if (draft) { const template = draft.templates.find(item => item.id === id) || active; setName(draft.name); setRequest(draft.description); setSettingsPolicy(draft.preprocessing || defaultPreprocessing); setTemplateName(template?.name || ''); setMatchWords(template?.matchTexts || []); setDrawer('settings'); } }
  async function copy(text: string) { try { await navigator.clipboard.writeText(text); void message.success('已复制'); } catch { void message.info('复制失败，可以直接选中代码复制'); } }

  const body = <>
    <div className="profile-field-list" role="group" aria-label="提取字段列表">{active?.fields.map((field, index) => <button type="button" key={field.id} className={`profile-field-row ${field.id === selectedId ? 'is-active' : ''}`} aria-pressed={field.id === selectedId} onClick={() => selectField(field.id)}>
      <span className="profile-field-index">{index + 1}</span><span><strong>{field.name}</strong><small>{field.key}</small></span><span className={`profile-field-state ${field.review === 'pending' ? 'is-pending' : field.region ? 'is-bound' : ''}`}>{!field.region ? '待定位' : field.review === 'pending' ? '待确认' : <><CheckCircleOutlined /> 已定位</>}</span>
    </button>)}</div>
    {!active?.fields.length && <div className="studio-rule-start"><strong>开始配置提取规则</strong><p>描述提取要求，或上传 Excel 字段表。</p><Button type="primary" icon={<RobotOutlined />} disabled={!active || busy} onClick={() => setPropertyTab('assistant')}>AI 辅助配置</Button><Button type="text" disabled={!active || busy} onClick={addField}>手动添加字段</Button></div>}
    {!!active?.fields.length && <Button className="profile-add-field" type="dashed" block icon={<PlusOutlined />} onClick={addField} disabled={busy}>添加字段</Button>}
    {active && sample && sample.pages.length > 1 && <label className="profile-reference-selector">基准材料<Select aria-label="选择基准页" disabled={busy} value={active.referencePage || 0} onChange={value => { editTemplate(item => ({ ...item, referencePage: value || null, fields: item.fields.map(field => ({ ...field, page: value ? 1 : field.page })) })); setPage(value || 1); }} options={[{ value: 0, label: '整份多页文档' }, ...sample.pages.map(item => ({ value: item.number, label: `第 ${item.number} 页作为单张版式` }))]} /></label>}
    {selected && <div className="profile-rule-form" key={selected.id}>
      <div className="profile-section-heading"><label htmlFor={`profile-field-name-${selected.id}`}>字段名称</label><Button type="text" size="small" disabled={busy} onClick={() => { setAssistantPrompt(value => ({ token: (value?.token || 0) + 1, text: `帮我调整“${selected.name}”的提取规则：`, scope: `${draft!.id}:${active!.id}` })); setPropertyTab('assistant'); }}>让 AI 帮我调整</Button><Tooltip title="删除这个字段"><Button type="text" size="small" icon={<DeleteOutlined />} aria-label={`删除字段 ${selected.name}`} disabled={busy} onClick={() => { editTemplate(value => ({ ...value, fields: value.fields.filter(field => field.id !== selected.id) })); setSelectedId(active?.fields.find(field => field.id !== selected.id)?.id || ''); }} /></Tooltip></div>
      <Input id={`profile-field-name-${selected.id}`} aria-label="字段名称" value={selected.name} disabled={busy} onChange={event => editField({ name: event.target.value })} />
      {sample && <RuleSamplePreview sampleId={sample.id} rule={selected} referencePage={active?.referencePage || 0} busy={busy} locating={locateRequest?.fieldId === selected.id} onLocate={locateField} onConfirm={() => editField({ review: 'confirmed' })} />}
      <div className="profile-basic-options"><label>数据类型<Select aria-label="字段数据类型" value={selected.kind} disabled={busy} onChange={kind => editField({ kind })} options={[{ label: '文本', value: 'text' }, { label: '数字编号', value: 'number' }, { label: '金额', value: 'amount' }, { label: '日期', value: 'date' }]} /></label><label>必填字段<Switch size="small" checked={selected.required} aria-label="是否必填字段" disabled={busy} onChange={required => editField({ required })} /></label></div>
      <div className="profile-location-options"><label>定位方式<Select aria-label="字段定位策略" value={selected.method} disabled={busy} onChange={method => editField({ method })} options={[{ label: '区域取值', value: 'region' }, { label: '标签定位', value: 'anchor' }]} /></label>
      {selected.method === 'anchor' && <div className="profile-form-grid"><label>标签文字<Input aria-label="定位标签文字" placeholder="例如：发票号码" value={selected.anchor} disabled={busy} onChange={event => editField({ anchor: event.target.value })} /></label><label>取值方向<Select aria-label="标签取值方向" value={selected.direction} disabled={busy} onChange={direction => editField({ direction })} options={[{ label: '标签右侧', value: 'right' }, { label: '标签下方', value: 'below' }]} /></label></div>}
      </div>
      <details className="profile-advanced-rule"><summary>高级规则设置</summary><div className="profile-advanced-content">
      <label>接口字段名<Input aria-label="接口字段名" value={selected.key} disabled={busy} onChange={event => editField({ key: event.target.value })} /></label>
      <div className="profile-inline-control"><span>移除标签前缀（如“发票号码：”）</span><Switch size="small" aria-label="移除标签前缀" disabled={busy} checked={!!selected.stripLabel} onChange={stripLabel => editField({ stripLabel })} /></div>
      <details className="profile-coordinate-details"><summary>{selected.region ? `第 ${selected.page} 页 · 区域坐标` : '尚未定位 · 可在原文框选或输入坐标'}</summary>
        <div className="profile-coordinate-grid">{['左', '上', '右', '下'].map((label, index) => <label key={label}>{label}（%）<InputNumber size="small" min={0} max={100} step={.1} value={selected.region ? Math.round(selected.region[index] * 1000) / 10 : null} disabled={busy}
          aria-label={`区域${label}边界`} onChange={value => { const box: Box = [...selected.region || [0, 0, 1, 1]]; box[index] = Number(value || 0) / 100; editField({ region: box }); }} /></label>)}</div>
        {!active?.referencePage && <Select aria-label="字段所在页" disabled={busy} value={selected.page} onChange={value => { editField({ page: value }); setPage(value); }} options={sample?.pages.map(item => ({ value: item.number, label: `第 ${item.number} 页` }))} />}
      </details>
      <RuleSourceEditor key={selected.id} rule={selected} busy={busy} onApply={field => { if (active?.fields.some(item => item.id !== selected.id && (item.key === field.key || item.name === field.name))) throw new Error('字段名称或接口字段名已存在，请换一个名称。'); editField({ ...field, ...(field.origin === 'ai' ? { review: 'pending' as const } : {}) }); }} />
      </div></details>
    </div>}
  </>;

  if (view === 'scene' && sceneId) return <div className="profiles-workspace studio-workspace" hidden={!visible}><SceneWorkspace key={sceneId} id={sceneId} parsers={records} onBack={() => showHome('mine')} onParser={openSceneParser} onChanged={() => { void refresh().catch(e => setError(e.message)); }} onNewParser={() => { const url = new URL(location.href); url.searchParams.delete('scene'); url.searchParams.set('returnScene', sceneId); window.history.replaceState(null, '', url); setReturnScene(sceneId); setView('parsers'); newProfile(); }} /></div>;

  const canvasSample = tab === 'test' && testResult ? samples[testResult.sampleId] || sample : sample;
  const canvasFields = (active?.fields || []).map(field => ({ ...field, page: tab === 'test' ? displayResult?.fields.find(item => item.key === field.key)?.page || field.page : active?.referencePage || field.page }));
  return <div className="profiles-workspace studio-workspace" hidden={!visible}>
    <input ref={fileInput} type="file" hidden accept={sampleAccept} disabled={busy} onChange={event => { const files = Array.from(event.target.files || []); event.target.value = ''; void addSamples(files); }} />
    {view === 'workspace' ? <>
      <header className="studio-scene-header"><div className="studio-scene-identity"><Button type="text" icon={<ArrowLeftOutlined />} aria-label={returnScene ? '返回场景组合' : '返回我的服务'} disabled={busy} onClick={() => returnScene ? openScene(returnScene) : showHome('parsers')}>{returnScene ? '场景组合' : '我的服务'}</Button><span className="studio-breadcrumb-divider">/</span><h1 title={draft?.name}>{draft?.name || '正在打开服务'}</h1><Tag>{record?.versions.length ? `草稿 · v${record.versions.at(-1)} 已发布` : '草稿'}</Tag><DraftSaveStatus save={autosave} disabled={busy} /></div>
        <Space className="studio-context-actions" size={5}><Button type="primary" icon={<RocketOutlined />} disabled={!draft || busy} onClick={() => setReleaseOpen(true)}>发布</Button><Tooltip title="服务设置"><Button type="text" icon={<EditOutlined />} aria-label="服务设置" disabled={!draft || busy} onClick={() => openSettings()}>设置</Button></Tooltip><StudioHelp disabled={busy} onGuide={() => setGuideOpen(true)} /></Space>
      </header>
      <div className="studio-workbench-toolbar"><nav className="studio-stage-tabs" role="tablist" aria-label="服务工作区">{studioTabs.map(item => <button type="button" role="tab" key={item.key} data-node-key={item.key} aria-selected={tab === item.key} aria-controls="studio-panel" disabled={!draft || busy || (!draft.templates.length && ['test', 'evaluate'].includes(item.key))} onClick={() => changeTab(item.key)}>{item.label}</button>)}</nav></div>
    </> : <Layout.Header className="app-header platform-header studio-platform-header"><div className="header-brand"><span>工作空间</span><Typography.Text type="secondary" className="brand-caption">文析 Studio</Typography.Text></div><Space size={12}><StudioHelp disabled={busy} onGuide={() => setGuideOpen(true)} /><Button className="header-new" type="text" icon={<FileSearchOutlined />} onClick={() => onNavigate?.('business')}>返回文析</Button></Space></Layout.Header>}
    {error && <Alert type="error" showIcon title={error} closable onClose={() => setError('')} className="studio-error" />}
    {view !== 'workspace' ? <StudioHome reviews={reviews} onShare={openShare} onReview={() => setReviewOpen(true)} view={view === 'scene' ? 'mine' : view} records={records} library={library} libraryError={libraryError} busy={busy} query={query} filter={filter} onQuery={setQuery} onFilter={setFilter} onView={showHome} onReference={(item, sceneId) => void referenceParser(item, sceneId)} scenes={sceneRecords} createKey={sceneCreateKey} onScene={openScene} onSceneNew={() => setSceneCreateKey(v => v + 1)} onChanged={() => { void refresh().catch(e => setError(e.message)); }} onNew={newProfile} onOpen={id => void load(id, 'fields')} onReuse={item => void reuseScene(item)} onCopy={text => void copy(text)} /> : <>
    <div className="studio-stage-content" id="studio-panel" role="tabpanel" aria-label={studioTabs.find(item => item.key === tab)?.label}>
    {!draft ? <div className="studio-empty"><FileSearchOutlined /><h2>开始构建一个服务</h2><p>返回我的服务，新建或打开已有服务。</p><Button type="primary" icon={<PlusOutlined />} disabled={busy} onClick={newProfile}>新建服务</Button></div>
    : !draft.templates.length && !['api', 'runs'].includes(tab) ? <div className="studio-onboarding"><div className="studio-onboarding-inner"><span className="studio-onboarding-eyebrow">开始配置</span><h2>上传这类材料的一种版式样例</h2><p>上传同一版式的一份或多份样例。第一份用于定位，其余用于测试；其他版式可以随后添加。</p><button type="button" className="studio-first-upload" aria-label="上传样例，开始配置" disabled={busy} onClick={() => pick('new')}><PlusOutlined /><strong>选择文件或 ZIP 材料包</strong><span>PDF / PNG / JPEG / WebP / ZIP · 单个上传文件最大 30 MB</span></button><div className="studio-start-path"><span>上传同版式样例</span><span>→</span><span>生成或配置规则</span><span>→</span><span>测试并发布服务</span></div></div></div>
    : tab === 'test' && bundleResult ? <StudioBundleDebug result={bundleResult} samples={samples} busy={busy} onUpload={() => pick('bundle')} onBack={() => setBundleResult(undefined)} />
    : tab === 'evaluate' ? <StudioEvaluation draft={draft} samples={samples} reports={reports} report={evaluation} busy={busy} onAdd={() => pick('dataset')} onRun={ids => void runEvaluation(ids)} onReport={id => void openReport(id)} onResult={(id, result) => void openPreview(id, result)} />
    : tab === 'api' && record ? <StudioRelease draft={draft} record={record} dirty={dirty} busy={busy} onRelease={() => setReleaseOpen(true)} onNavigate={handleReleaseTarget} onShare={version => openShare({ id: draft.id, name: draft.name, versions: record.versions }, version)} onCopy={text => void copy(text)} />
    : tab === 'runs' ? <StudioRuns runs={runs} busy={busy} onRefresh={() => void action('正在读取运行记录', async () => setRuns(await profileApi.runs(draft.id)))} />
    : <StudioEditorLayout materials={<aside className="studio-material-rail"><div className="studio-rail-heading"><strong>版式与样例</strong><Space size={0}><Tooltip title="添加样例或 ZIP 材料包"><Button type="text" size="small" icon={<PlusOutlined />} aria-label="添加版式样例" disabled={busy || draft.templates.length >= 10} onClick={() => pick('new')}  /></Tooltip><Dropdown trigger={['click']} menu={{ items: [{ key: 'samples', label: '样例管理' }], onClick: ({ key }) => { setDrawer(key as 'samples'); setError(''); } }}><Button type="text" size="small" icon={<MoreOutlined />} aria-label="材料更多操作" disabled={busy} /></Dropdown></Space></div>
        {materialGroups(draft).map(group => <section className="studio-material-group" key={group.id}>{group.templates.map(item => <button type="button" key={item.id} disabled={busy} className={`studio-template-item ${active?.id === item.id ? 'is-active' : ''}`} onClick={() => selectTemplate(item.id)}><ProductIcon name="template" /><span><strong>{item.name}</strong><small>{samples[item.sampleId]?.name || '读取样例'}</small><small>{item.fields.length} 个字段{item.classification === 'suggested' ? ' · 分组待确认' : ''}</small></span></button>)}</section>)}
        {!draft.templates.length && <Button type="dashed" block disabled={busy} onClick={() => pick('new')}>添加第一份样例</Button>}
        {tab === 'test' && <div className="studio-debug-actions"><Button block type="primary" disabled={busy || !active} onClick={() => pick('bundle')}>上传材料包调试</Button><Button block disabled={busy || !active} onClick={() => pick('test')}>调试当前版式</Button><Button block disabled={busy || !active} onClick={() => void referenceTest()}>用基准样例回放</Button></div>}
      </aside>} source={<ProfileCanvas sample={canvasSample} fields={canvasFields} selectedId={selectedId} page={page} readOnly={tab === 'test'} locateRequest={locateRequest} preview={assistantPreview} previewPage={active?.referencePage || assistantPreview?.page} onClearPreview={() => setAssistantPreview(undefined)} result={tab === 'test' || trialOpen ? displayResult : undefined} onPage={setPage} onSelect={selectField} onBind={(region, selectedPage) => { if (!busy && tab !== 'test') { setLocateRequest(undefined); editField({ region, page: active?.referencePage ? 1 : selectedPage }); } }} onUpload={() => pick(active ? 'replace' : 'new')} onReprocess={() => void reprocessSample()} />} inspector={<section className="studio-inspector" aria-label={tab === 'test' ? '调试结果' : '字段与规则属性'}>{tab === 'test' ? <div className="studio-debug-result"><div className="studio-inspector-heading"><strong>提取结果</strong>{testResult && <Tag color={testResult.passed ? 'success' : 'warning'}>{testResult.passed ? '规则通过' : '需调整'}</Tag>}</div>
        {testResult ? <>{testResult.items && testResult.items.length > 1 && <Select className="studio-unit-select" aria-label="切换票据结果" value={testItem} onChange={index => { setTestItem(index); setPage(testResult.items![index].pages[0]); }} options={testResult.items.map((item, index) => ({ value: index, label: `${item.label} · 原文第 ${item.pages.join('、')} 页` }))} />}
          {displayResult && 'error' in displayResult && <Alert type="warning" title={String(displayResult.error)} />}
          <div className="studio-debug-timing"><span>{testResult.scope === 'reference' ? '基准样例回放' : '新材料调试'}</span><span>规则 {testResult.elapsedMs} ms</span>{testResult.recognitionMs !== undefined && <span>含读取 {(testResult.recognitionMs / 1000).toFixed(2)} s</span>}</div>
          <div className="profile-test-values">{displayResult?.fields.map(field => <button type="button" key={field.key} onClick={() => { const target = active?.fields.find(item => item.key === field.key); if (target) setSelectedId(target.id); setPage(field.page); }}><span>{field.name}<Tag color={field.status === 'matched' ? 'success' : 'warning'}>{field.status === 'matched' ? '已取值' : field.status === 'missing' ? '未找到' : '需调整'}</Tag></span><strong>{field.value || '—'}</strong>{field.issue && <small>{field.issue}</small>}</button>)}</div>
        </> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="上传新材料或回放基准样例，检查取值和原文位置" />}
      </div> : <>
        {active && <div className="studio-setup-container" hidden={setupTemplateId !== active.id}><StudioSetup key={active.id} busy={busy} initialRequest={draft.description} mode="manual" compact importOnly onModeChange={() => {}} hasFields onCancel={() => setSetupTemplateId('')} onStop={() => { controller.current?.abort(); }} onStart={(_mode, _request, requirements) => void importFields(requirements)} /></div>}
        <Tabs hidden={!!active && setupTemplateId === active.id} className="studio-property-tabs" activeKey={propertyTab} onChange={key => { setAssistantPreview(undefined); setPropertyTab(key); }} items={[
        { key: 'fields', label: '规则配置', children: <div className="studio-property-content">
          <div className="studio-rule-tools"><small>{active?.fields.length || 0} 个提取字段{active?.fields.some(field => field.review === 'pending') ? ` · ${active.fields.filter(field => field.review === 'pending').length} 项待确认` : ''}</small><Space size={4}><Button size="small" icon={<PlayCircleOutlined />} disabled={busy || !active?.fields.length} onClick={() => void referenceTest(true)}>试提取</Button><Dropdown trigger={['click']} menu={{ items: [{ key: 'import', label: '仅导入 Excel 字段定义' }], onClick: () => { if (active) setSetupTemplateId(active.id); } }}><Button size="small" type="text" icon={<MoreOutlined />} aria-label="规则更多操作" disabled={busy || !active} /></Dropdown></Space></div>
          {trialOpen && testResult && <StudioTrialResult result={testResult} index={testItem} pendingKeys={active?.fields.filter(field => field.review === 'pending').map(field => field.key) || []} onItem={index => { setTestItem(index); setPage(testResult.items![index].pages[0]); }} onSelect={(key, page) => { const field = active?.fields.find(field => field.key === key); if (field) setSelectedId(field.id); setPage(page); }} onClose={() => setTrialOpen(false)} onConfirm={keys => editTemplate(template => ({ ...template, fields: template.fields.map(field => keys.includes(field.key) && field.review === 'pending' ? { ...field, review: 'confirmed' } : field) }))} />}
          {body}</div> },
        { key: 'assistant', label: '配置助手', forceRender: true, children: active && <StudioAssistant key={`${draft.id}:${active.id}`} scope={`${draft.id}:${active.id}`} template={active} selectedId={selectedId} materialLabel={`${materialGroups(draft).find(group => group.templates.some(template => template.id === active.id))?.name || '材料'} / ${active.name}`} busy={busy} visible={visible} sessions={assistantSessions} prompt={assistantPrompt?.scope === `${draft.id}:${active.id}` ? assistantPrompt : undefined} onApply={applyAssistant} onPreview={rule => { setAssistantPreview(rule); setPage(active.referencePage || rule.page); }} onFields={() => { setAssistantPreview(undefined); setPropertyTab('fields'); }} /> },

      ]} /></>}</section>} />}
    </div>
    </>}
    {phase && <div className="profile-progress" role="status"><Spin size="small" /><span>{phase}</span></div>}
    <Drawer title={drawer === 'new' ? '新建服务' : '服务设置'} open={drawer === 'new' || drawer === 'settings'} placement="right" size={500} styles={{ wrapper: { maxWidth: '100vw' } }} closable={{ placement: 'end' }} onClose={() => { if (!busy) setDrawer(null); }} className="platform-drawer studio-settings-drawer" footer={<Space><Button disabled={busy} onClick={() => setDrawer(null)}>取消</Button><Button type="primary" loading={busy} disabled={drawer === 'settings' && !name.trim()} onClick={() => { if (drawer === 'new') void createProfile(); else if (draft) { edit({ ...draft, name: name.trim(), description: request, preprocessing: settingsPolicy, templates: draft.templates.map(item => item.id === active?.id ? { ...item, name: templateName.trim() || item.name, matchTexts: matchWords } : item) }); setDrawer(null); } }}>{drawer === 'new' ? '创建并进入' : '应用设置'}</Button></Space>}>
      <div className="profile-creation-form"><label><span>服务名称 <small>{drawer === 'new' ? '可选' : ''}</small></span><Input aria-label="服务名称" placeholder="例如：电子发票要素提取；留空后可再命名" value={name} disabled={busy} maxLength={100} onChange={event => setName(event.target.value)} /></label><label><span>服务说明 <small>可选</small></span><Input.TextArea aria-label="服务说明" rows={4} value={request} disabled={busy} placeholder="说明支持的材料、输出字段与适用版式，例如：提取发票票号、日期及金额，返回原文位置。" maxLength={1000} onChange={event => setRequest(event.target.value)} /></label>
        {drawer === 'new' && prepared && <div className="studio-seed-card"><FileSearchOutlined /><strong>{prepared.name}</strong><span>带入 {seedRules.length} 个字段及原文位置</span></div>}
        {drawer === 'settings' && <PreprocessingSettings draft={{ ...draft!, preprocessing: settingsPolicy }} busy={busy} onChange={value => setSettingsPolicy(value.preprocessing || defaultPreprocessing)} onPage={setPage} onReprocess={() => void reprocessSample()} />}
        {drawer === 'settings' && active && <><label>当前版式名称<Input aria-label="版式名称" disabled={busy} value={templateName} onChange={event => setTemplateName(event.target.value)} /></label><label>版式匹配关键词<Select mode="tags" aria-label="版式白名单关键词" disabled={busy} value={matchWords} onChange={setMatchWords} /></label><small>校验页数、页面比例、关键词及固定标签位置；不匹配时不执行提取。</small><Button type="text" danger disabled={busy} icon={<DeleteOutlined />} onClick={() => { edit({ ...draft!, templates: draft!.templates.filter(item => item.id !== active.id), samples: draft!.samples?.map(item => item.templateId === active.id ? { ...item, templateId: '' } : item) }); setTemplateId(''); setSelectedId(''); setDrawer(null); }}>从草稿中移除此版式</Button></>}
      </div>
    </Drawer>
    <Drawer title="申请加入公共服务库" open={drawer === 'share'} placement="right" size={500} styles={{ wrapper: { maxWidth: '100vw' } }} onClose={() => { if (!busy) setDrawer(null); }} footer={<Space><Button disabled={busy} onClick={() => setDrawer(null)}>取消</Button><Button type="primary" disabled={!publisherLabel.trim() || !shareVersion || busy} loading={busy} onClick={() => void shareScene()}>提交审核</Button></Space>}><div className="profile-creation-form"><strong>{shareTarget?.name}</strong><label>公开版本<Select aria-label="申请公开版本" value={shareVersion} disabled={busy} onChange={setShareVersion} options={shareTarget?.versions.map(version => ({ value: version, label: `v${version}` }))} /></label><label>申请人<Input aria-label="场景发布人" value={publisherLabel} maxLength={80} onChange={event => setPublisherLabel(event.target.value)} disabled={busy} /></label><label>所属团队（可选）<Input aria-label="发布团队" value={publisherTeam} maxLength={100} onChange={event => setPublisherTeam(event.target.value)} disabled={busy} /></label><small>审核通过后，公开此版本的接口说明与可复用配置。原始样例和提取结果不会显示在目录卡片中。</small></div></Drawer>
    <PublicationReviews open={reviewOpen && visible} reviews={reviews} busy={busy} onClose={() => setReviewOpen(false)} onDecision={(...args) => void decidePublication(...args)} />
    <Drawer title="样例管理" open={drawer === 'samples'} placement="right" size={960} styles={{ wrapper: { maxWidth: '100vw' }, body: { padding: 0 } }} onClose={() => { if (!busy) setDrawer(null); }} className="studio-samples-drawer">{draft && <StudioSamples draft={draft} samples={samples} busy={busy} onAddTemplate={() => { setDrawer(null); pick('new'); }} onAddTests={() => pick('dataset')} onOpen={id => void openPreview(id)} onChange={edit} onConfigure={id => { setDrawer(null); selectTemplate(id, 'fields'); }} />}</Drawer>
    <Drawer destroyOnHidden open={guideOpen && visible} placement="right" size="100%" closable={false} onClose={() => setGuideOpen(false)} className="studio-guide-drawer help-center-drawer"><HelpCenter initialDoc={view === 'workspace' ? 'services' : 'welcome'} onClose={() => setGuideOpen(false)} /></Drawer>
    <ReleaseChecklist allowNote open={releaseOpen && visible && view === 'workspace'} name={draft?.name || ''} onClose={() => setReleaseOpen(false)} onCheck={async () => { const saved = await saveCurrent(); return profileApi.releaseCheck(saved.draft.id); }} onPublish={publish} onNavigate={handleReleaseTarget} />
    <StudioPreview sample={preview ? samples[preview.id] : undefined} result={preview?.result} onClose={() => setPreview(undefined)} />
  </div>;
}
