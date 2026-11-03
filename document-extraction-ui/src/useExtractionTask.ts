import { useEffect, useRef, useState } from 'react';
import { DEMO_MODE } from './demoMode.ts';
import { documentOutputMode } from './documentIntent.ts';
import { fixtures } from './fixtures.ts';
import { acceptedExtensions, getFileKind, MAX_FILES, MAX_SIZE } from './model.ts';
import { runLocalTurn } from './conversation.ts';
import { extractWithMinerU, localServicePage, parseRequirementWorkbook, releaseDocument, type ServiceInfo } from './service.ts';
import { selectedRequirements } from './requirements.ts';
import { finishProcessing, mergeProcessingSteps } from './processing.ts';
import { listHistory, readHistory, saveHistory } from './history.ts';
import type { ChatMessage, ExtractedField, Material, ParsedDocument, ProcessingStep, ProcessingTrace, RequirementDefinition, SavedTaskSummary, Scenario, SourceEvidence, TaskSnapshot } from './types.ts';

let sequence = 0;
const uid = () => `item-${Date.now()}-${++sequence}`;

export function useExtractionTask(notify: (message: string) => void) {
  const [files, setFiles] = useState<Material[]>([]);
  const filesRef = useRef<Material[]>([]);
  const urls = useRef(new Set<string>());
  const requirementRequests = useRef(new Map<string, AbortController>());
  const generation = useRef(0);
  const uploadGeneration = useRef(0);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [started, setStarted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const busyRef = useRef(false);
  const [activeId, setActiveId] = useState('');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [selectedEvidence, setSelectedEvidence] = useState<SourceEvidence[] | null>(null);
  const [page, setPage] = useState(1);
  const [progress, setProgress] = useState('');
  const [processing, setProcessing] = useState<ProcessingTrace | null>(null);
  const processingRef = useRef<ProcessingTrace | null>(null);
  const request = useRef<AbortController | null>(null);
  const [serviceInfo, setServiceInfo] = useState<ServiceInfo | null>(null);
  const [historyRecords, setHistoryRecords] = useState<SavedTaskSummary[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [historySaving, setHistorySaving] = useState(false);
  const historyId = useRef<string | null>(null);
  const historyQueue = useRef<Promise<unknown>>(Promise.resolve());
  const transitioning = useRef(false);
  const mounted = useRef(true);
  const snapshotRef = useRef<TaskSnapshot>({ files, messages, draft, activeId, selectedKey, page });
  snapshotRef.current = { files, messages, draft, activeId, selectedKey, page };
  async function reloadHistory() {
    if (!localServicePage()) return;
    setHistoryLoading(true);
    try {
      const records = await listHistory();
      if (mounted.current) { setHistoryRecords(records); setHistoryError(''); }
    } catch (error) {
      if (mounted.current) setHistoryError(error instanceof Error ? error.message : '历史记录暂不可用');
    } finally { if (mounted.current) setHistoryLoading(false); }
  }
  async function persistHistory(): Promise<boolean> {
    const snapshot = { ...snapshotRef.current, files: filesRef.current };
    if (!snapshot.files.some(file => file.processed || file.error)) return true;
    if (!localServicePage()) { notify('保存历史记录请通过 http://127.0.0.1:8768 打开文析。'); return false; }
    const id = historyId.current ||= crypto.randomUUID().replaceAll('-', '');
    const work = historyQueue.current.catch(() => {}).then(async () => {
      if (mounted.current) setHistorySaving(true);
      try {
        await saveHistory(id, snapshot);
        await reloadHistory();
        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : '历史记录保存失败';
        if (mounted.current) { setHistoryError(message); notify(`${message}，当前任务保留，请重试。`); }
        return false;
      } finally { if (mounted.current) setHistorySaving(false); }
    });
    historyQueue.current = work;
    return work;
  }
  useEffect(() => {
    mounted.current = true;
    void reloadHistory();
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    if (!serviceInfo?.supportsHistory || busy || !files.some(file => file.processed || file.error)) return;
    void persistHistory();
  }, [files, messages, busy, serviceInfo?.supportsHistory]);
  useEffect(() => {
    if (!localServicePage()) return;
    const controller = new AbortController();
    void fetch('/api/health', { signal: controller.signal }).then(response => response.ok ? response.json() : null)
      .then(info => { if (!controller.signal.aborted && info) setServiceInfo(info); }).catch(() => {});
    return () => controller.abort();
  }, []);

  function publish(next: Material[]) { filesRef.current = next; setFiles(next); }
  function resetLocation() { setSelectedKey(null); setSelectedEvidence(null); setPage(1); }
  function publishProcessing(value: ProcessingTrace | null) { processingRef.current = value; setProcessing(value); }
  function processingEvents(events: ProcessingStep[], prefix = '') {
    if (processingRef.current) publishProcessing(mergeProcessingSteps(processingRef.current, events, prefix));
  }

  useEffect(() => () => {
    generation.current++;
    request.current?.abort();
    requirementRequests.current.forEach(controller => controller.abort());
    requirementRequests.current.clear();
    filesRef.current.forEach(releaseDocument);
    for (const url of urls.current) URL.revokeObjectURL(url);
    urls.current.clear();
  }, []);

  async function addFiles(incoming: File[]) {
    if (busyRef.current || transitioning.current) return;
    const token = generation.current;
    const uploadToken = uploadGeneration.current;
    const isCurrentUpload = () => token === generation.current && uploadToken === uploadGeneration.current && !busyRef.current;
    const errors: string[] = [];
    let added = 0;
    for (const file of incoming) {
      if (!isCurrentUpload()) return;
      const ext = file.name.split('.').pop()?.toLowerCase() || '';
      if (!acceptedExtensions.includes(ext)) { errors.push(`${file.name}：暂不支持此格式`); continue; }
      if (file.size > MAX_SIZE) { errors.push(`${file.name}：请使用 30 MB 以内的文件`); continue; }
      if (filesRef.current.length >= MAX_FILES) { errors.push('每次最多添加 6 份材料'); break; }
      if (filesRef.current.some(item => item.name === file.name && item.size === file.size)) { errors.push(`${file.name}：已添加`); continue; }
      const kind = getFileKind(file.name);
      if (kind === 'spreadsheet' && filesRef.current.some(item => item.kind === 'spreadsheet')) { errors.push('每次使用一份字段要求表，请先移除原来的 Excel'); continue; }
      if (kind === 'spreadsheet' && file.size > 8 * 1024 * 1024) { errors.push(`${file.name}：字段表限8 MB`); continue; }
      let text: string | undefined;
      if (kind === 'text') {
        try { text = await file.text(); } catch { errors.push(`${file.name}：读取失败`); continue; }
      }
      if (!isCurrentUpload()) return;
      // Recheck after awaiting a read: another upload may have completed meanwhile.
      if (filesRef.current.length >= MAX_FILES || filesRef.current.some(item => item.name === file.name && item.size === file.size)) continue;
      const url = URL.createObjectURL(file);
      urls.current.add(url);
      const item: Material = { id: uid(), name: file.name, kind, size: file.size, url, text, sourceFile: file, results: null,
        requirementLoading: kind === 'spreadsheet' };
      if (kind !== 'spreadsheet' && !filesRef.current.some(file => file.kind !== 'spreadsheet')) setActiveId(item.id);
      publish([...filesRef.current, item]);
      added++;
      if (kind === 'spreadsheet') {
        const controller = new AbortController(); requirementRequests.current.set(item.id, controller);
        try {
          const workbook = await parseRequirementWorkbook(file, controller.signal);
          if (!isCurrentUpload() || controller.signal.aborted) return;
          publish(filesRef.current.map(current => current.id === item.id ? { ...current, requirementLoading: false,
            requirementWorkbook: workbook, requirementSheet: workbook.sheets.length === 1 ? workbook.sheets[0].sheet : undefined } : current));
        } catch (error) {
          if (!isCurrentUpload() || controller.signal.aborted) return;
          const text = error instanceof Error ? error.message : '字段表读取失败，请检查格式';
          errors.push(`${file.name}：${text}`);
          publish(filesRef.current.map(current => current.id === item.id ? { ...current, requirementLoading: false, requirementError: text } : current));
        } finally { requirementRequests.current.delete(item.id); }
      }
    }
    if (!isCurrentUpload()) return;
    if (errors.length) notify(errors.join('；'));
    else if (added) notify('附件已添加，请描述需要提取的内容');
  }

  function useSample(scenario: Scenario) {
    if (busyRef.current || transitioning.current) return;
    const fixture = fixtures[scenario];
    let material = filesRef.current.find(file => file.scenario === scenario);
    if (!material) {
      if (filesRef.current.length >= MAX_FILES) return notify('每次最多添加 6 份材料，请先移除一个附件');
      material = { id: uid(), name: fixture.name, kind: 'demo', scenario, size: 0, results: null };
      publish([...filesRef.current, material]);
    }
    setActiveId(material.id);
    setDraft(fixture.prompt);
    resetLocation();
  }

  function removeFile(id: string) {
    if (busyRef.current || transitioning.current) return;
    const removed = filesRef.current.find(file => file.id === id);
    requirementRequests.current.get(id)?.abort(); requirementRequests.current.delete(id);
    if (removed) releaseDocument(removed);
    if (removed?.url) { URL.revokeObjectURL(removed.url); urls.current.delete(removed.url); }
    const next = filesRef.current.filter(file => file.id !== id);
    if (!next.length) uploadGeneration.current++;
    publish(next);
    if (activeId === id) setActiveId(next.find(file => file.kind !== 'spreadsheet')?.id || '');
    resetLocation();
  }

  async function send() {
    const prompt = draft.trim();
    if (!prompt || busyRef.current || transitioning.current) return;
    const outputMode = documentOutputMode(prompt);
    const turn = runLocalTurn(prompt, filesRef.current, activeId, selectedKey, serviceInfo?.semantic);
    let requirements: RequirementDefinition | undefined;
    if (turn.kind === 'extract' && outputMode !== 'fulltext') {
      try { requirements = selectedRequirements(filesRef.current, prompt); }
      catch (error) { notify(error instanceof Error ? error.message : '请检查字段要求表'); return; }
    }
    const token = ++generation.current;
    if (turn.kind === 'extract') {
      publishProcessing({ id: uid(), status: 'running', startedAt: new Date().toISOString(), steps: [] });
      if (requirements) processingEvents([{ id: 'requirements', label: `已读取 ${requirements.fields.length} 项字段要求`, detail: `${requirements.fileName} · ${requirements.sheet}`, status: 'done', startedAt: new Date().toISOString() }]);
    }
    busyRef.current = true; setBusy(true); setExtracting(turn.kind === 'extract'); setStarted(true); setDraft('');
    setMessages(previous => [...previous, { id: uid(), role: 'user', text: prompt, files: turn.kind === 'extract' ? filesRef.current.map(file => file.name) : undefined }]);
    let serviceReply = '';
    let failedFiles = 0;
    let successfulFiles = 0;
    if (turn.kind === 'extract' && filesRef.current.some(file => ['pdf', 'image'].includes(file.kind))) {
      const controller = new AbortController();
      request.current = controller;
      const original = [...filesRef.current];
      const next = original.map((file, index) => ['pdf', 'image'].includes(file.kind) ? file : turn.materials[index]);
      const errors: string[] = [];
      for (let index = 0; index < original.length; index++) {
        const file = original[index];
        if (!['pdf', 'image'].includes(file.kind)) continue;
        try {
          next[index] = await extractWithMinerU(file, prompt, controller.signal, value => { if (token === generation.current) setProgress(value); }, serviceInfo?.semantic, requirements,
            events => { if (token === generation.current) processingEvents(events.map(event => ({ ...event, detail: event.detail === file.name ? file.name : [file.name, event.detail].filter(Boolean).join(' · ') })), file.id + ':'); }, outputMode);
          successfulFiles++;
        }
        catch (error) {
          if (token !== generation.current || controller.signal.aborted) return;
          const text = error instanceof TypeError ? '本机服务暂不可用，请确认已启动“启动文析.command”。'
            : error instanceof Error ? error.message : '识别失败，请重新发送要求再试。';
          errors.push(`${file.name}：${text}`);
          failedFiles++;
          if (processingRef.current) publishProcessing({ ...processingRef.current, steps: processingRef.current.steps.map(step => step.id.startsWith(file.id + ':') && step.status === 'running' ? { ...step, status: 'error', detail: text, finishedAt: new Date().toISOString() } : step) });
          const parsed = (error as { document?: ParsedDocument }).document || file.parsed;
          next[index] = { ...file, parsed, processed: !!parsed || file.processed, error: text, taskId: (error as { taskId?: string }).taskId || file.taskId, outputMode };
        }
        if (token !== generation.current) return;
        publish([...next]);
      }
      const real = next.filter(file => file.parsed);
      const matched = real.reduce((sum, file) => sum + (file.results?.filter(field => ['pending', 'confirmed', 'corrected'].includes(field.status) && field.value).length || 0), 0);
      const missing = real.reduce((sum, file) => sum + (file.results?.filter(field => field.status === 'missing').length || 0), 0);
      const rejected = real.reduce((sum, file) => sum + (file.results?.filter(field => field.status === 'rejected').length || 0), 0);
      const visual = real.reduce((sum, file) => sum + (file.results?.filter(field => field.status === 'visual_required').length || 0), 0);
      const semanticResult = real.some(file => file.parsed?.extractor === 'deepseek');
      serviceReply = [outputMode === 'fulltext' && successfulFiles ? `已转换 ${successfulFiles} 份材料的全文，可在右侧预览、复制或下载 Markdown。` : '', requirements ? `已按“${requirements.fileName}”的“${requirements.sheet}”工作表读取 ${requirements.fields.length} 项字段要求。` : '', outputMode !== 'fulltext' && real.length && !errors.length ? semanticResult
        ? `已整理结果：${matched} 项有原文依据${rejected ? `，${rejected} 项依据待核对` : ''}${visual ? `，${visual} 项待图像核验` : ''}${missing ? `，${missing} 项未找到` : ''}。`
        : `MinerU 已识别 ${real.length} 份材料，按字段标签匹配出 ${matched} 项${missing ? `，${missing} 项待补充` : ''}。` : '',
        next.some(file => file.kind === 'demo') ? '内置示例仍为演示数据。' : '',
        next.some(file => ['word', 'archive'].includes(file.kind)) ? 'Word 转换、ZIP 解包后续接入。' : '', ...errors].filter(Boolean).join('\n');
      if (DEMO_MODE) serviceReply = '已展示内置虚构材料的演示结果，未识别上传文件内容。可点击字段核对示例原文，或切换至全文查看 Markdown。';
      turn.materials = next;
      turn.activeId = next.find(file => file.id === activeId && file.processed)?.id || next.find(file => file.processed)?.id || activeId;
    } else {
      if (turn.kind === 'extract') processingEvents([{ id: 'local', label: filesRef.current.some(file => file.kind === 'demo') ? '正在处理内置示例' : '正在匹配文本字段', status: 'running', startedAt: new Date().toISOString() }]);
      await new Promise(resolve => window.setTimeout(resolve, turn.kind === 'extract' ? 800 : 220));
    }
    if (token !== generation.current) return;
    if (turn.kind !== 'chat') {
      publish(turn.materials);
      if (turn.activeId) setActiveId(turn.activeId);
      if (turn.kind === 'extract') resetLocation();
      else { setSelectedKey(turn.selectedKey || null); setSelectedEvidence(null); if (turn.page) setPage(turn.page); }
    }
    const trace = processingRef.current ? finishProcessing(processingRef.current, failedFiles ? successfulFiles ? 'partial' : 'failed' : 'done') : undefined;
    setMessages(previous => [...previous, { id: uid(), role: 'assistant', text: serviceReply || turn.reply, processing: trace, resultLink: turn.kind !== 'chat' && turn.materials.some(file => file.processed) }]);
    publishProcessing(null);
    request.current = null; setProgress('');
    busyRef.current = false; setBusy(false); setExtracting(false);
  }

  function stop() {
    generation.current++;
    request.current?.abort(); request.current = null; setProgress('');
    busyRef.current = false; setBusy(false); setExtracting(false);
    const trace = processingRef.current ? finishProcessing(processingRef.current, 'cancelled') : undefined;
    setMessages(previous => [...previous, { id: uid(), role: 'assistant', text: '已停止，当前结果保留。', processing: trace }]);
    publishProcessing(null);
  }

  function selectFile(id: string) { setActiveId(id); resetLocation(); }
  function selectRequirementSheet(id: string, sheet: string) {
    if (busyRef.current) return;
    publish(filesRef.current.map(file => file.id === id && file.requirementWorkbook?.sheets.some(item => item.sheet === sheet)
      ? { ...file, requirementSheet: sheet } : file));
  }
  function selectField(field: ExtractedField) { setSelectedKey(field.key); setSelectedEvidence(null); if (field.page) setPage(field.page); }
  function selectEvidence(field: ExtractedField, evidence: SourceEvidence[]) {
    setSelectedKey(field.key); setSelectedEvidence(evidence);
    if (evidence[0]) setPage(evidence[0].pageIndex + 1);
  }
  function updateFields(update: (fields: ExtractedField[]) => ExtractedField[]) {
    if (transitioning.current) return;
    publish(filesRef.current.map(file => file.id === activeId ? { ...file, results: update(file.results || []) } : file));
  }
  function reset() {
    generation.current++;
    uploadGeneration.current++;
    request.current?.abort(); request.current = null; setProgress('');
    requirementRequests.current.forEach(controller => controller.abort()); requirementRequests.current.clear();
    filesRef.current.forEach(releaseDocument);
    for (const url of urls.current) URL.revokeObjectURL(url);
    urls.current.clear();
    busyRef.current = false; setBusy(false); setExtracting(false); publish([]); setMessages([]); setDraft('');
    publishProcessing(null);
    setStarted(false); setActiveId(''); resetLocation();
    historyId.current = null;
  }

  async function closeTask(): Promise<boolean> {
    if (transitioning.current) return false;
    transitioning.current = true;
    try {
      if (busyRef.current) stop();
      if (!await persistHistory()) return false;
      reset();
      return true;
    } finally { transitioning.current = false; }
  }
  async function openHistory(id: string, materialId?: string): Promise<boolean> {
    if (busyRef.current || transitioning.current) { notify('请先等待或停止当前提取'); return false; }
    transitioning.current = true;
    try {
      if (!await persistHistory()) return false;
      const record = await readHistory(id);
      reset();
      historyId.current = record.id;
      publish(record.snapshot.files);
      setMessages(record.snapshot.messages); setDraft(record.snapshot.draft || ''); setStarted(true);
      setActiveId(materialId || record.snapshot.activeId);
      setSelectedKey(record.snapshot.selectedKey); setPage(record.snapshot.page || 1);
      return true;
    } catch (error) {
      notify(error instanceof Error ? error.message : '历史记录打开失败，请重试。');
      return false;
    } finally { transitioning.current = false; }
  }

  const activeFile = files.find(file => file.id === activeId && file.kind !== 'spreadsheet') || files.find(file => file.kind !== 'spreadsheet');
  const hasWorkspace = files.some(file => file.processed);
  return { files, messages, draft, setDraft, started, hasWorkspace, busy, extracting, progress, processing, serviceInfo, activeId: activeFile?.id || '', activeFile,
    selectedKey, selectedEvidence, setSelectedKey, page, setPage, addFiles, useSample, removeFile, send, stop,
    selectFile, selectRequirementSheet, selectField, selectEvidence, updateFields, reset, closeTask,
    historyRecords, historyLoading, historyError, historySaving, reloadHistory, openHistory };
}

export type ExtractionTask = ReturnType<typeof useExtractionTask>;
