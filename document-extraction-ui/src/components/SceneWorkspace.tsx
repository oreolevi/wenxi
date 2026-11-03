import { CLOUD_MODE } from '../demoMode.ts';
import { ProductIcon } from './ProductIcon.tsx';
import { useEffect, useRef, useState } from 'react';
import { Alert, App, Button, Drawer, Empty, Input, Select, Space, Switch, Table, Tabs, Tag } from 'antd';
import { ArrowLeftOutlined, ArrowRightOutlined, CopyOutlined, DeleteOutlined, PlusOutlined, RocketOutlined, UploadOutlined } from '@ant-design/icons';
import { profileApi, profileId, type ProfileRule, type ProfileSample, type ProfileSummary } from '../profiles.ts';
import { sceneApi, type CompositionResult, type SceneDraft, type SceneRecord } from '../studio.ts';
import { StudioBundleDebug } from './StudioBundleDebug.tsx';
import { ContextHelp, SceneServiceSettings } from './SceneServiceSettings.tsx';
import { DraftSaveStatus, useDraftAutosave } from './DraftAutosave.tsx';
import { ReleaseChecklist } from './ReleaseChecklist.tsx';
import type { ReleaseTarget } from '../release.ts';
import { SceneEfficiencySettings } from './SceneEfficiencySettings.tsx';

export function SceneWorkspace({ id, parsers, onBack, onParser, onNewParser, onChanged }: { id: string; parsers: ProfileSummary[]; onBack: () => void; onParser: (id: string) => void; onNewParser: () => void; onChanged: () => void }) {
  const { message } = App.useApp();
  const [record, setRecord] = useState<SceneRecord>(); const [draft, setDraft] = useState<SceneDraft>();
  const [tab, setTab] = useState('parsers'); const [adding, setAdding] = useState(false); const [settings, setSettings] = useState(false);
  const [chosen, setChosen] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [files, setFiles] = useState<File[]>([]); const [assignments, setAssignments] = useState<Record<string, string>>({});
  const [result, setResult] = useState<CompositionResult>(); const [samples, setSamples] = useState<Record<string, ProfileSample>>({});
  const [inspect, setInspect] = useState(false); const [runs, setRuns] = useState<Awaited<ReturnType<typeof sceneApi.runs>>>([]);
  const [schemas, setSchemas] = useState<Record<string, ProfileRule[]>>({});
  const [editingBinding, setEditingBinding] = useState('');
  const [releaseOpen, setReleaseOpen] = useState(false);
  const upload = useRef<HTMLInputElement>(null); const abort = useRef<AbortController | null>(null);
  const draftRef = useRef(draft); draftRef.current = draft;
  useEffect(() => { let live = true; setBusy(true); setError(''); void sceneApi.read(id).then(value => { if (live) { setRecord(value); setDraft(value.draft); setResult(value.lastTest?.result); const ids = [...new Set(value.lastTest?.result.items.flatMap(item => item.sampleId ? [item.sampleId] : []) || [])]; void Promise.all(ids.map(sampleId => profileApi.sample(sampleId))).then(loaded => { if (live) setSamples(Object.fromEntries(loaded.map(s => [s.id, s]))); }).catch(() => { if (live) setError('历史联调原文读取失败，可以重新上传材料联调。'); }); } }).catch(e => { if (live) setError(e.message); }).finally(() => { if (live) setBusy(false); }); return () => { live = false; abort.current?.abort(); }; }, [id]);
  useEffect(() => { if (tab === 'runs') void sceneApi.runs(id).then(setRuns).catch(e => setError(e.message)); }, [id, tab]);
  const dirty = !!draft && JSON.stringify(draft) !== JSON.stringify(record?.draft);
  const ready = !!draft?.bindings.length && draft.bindings.every(b => !!b.version);
  const selectedBinding = draft?.bindings.find(binding => binding.id === editingBinding);
  const autosave = useDraftAutosave({ draft, saved: record, active: true, paused: busy, write: sceneApi.save, validate: value => !value.name.trim() ? '请填写场景名称' : undefined, onSaved: (saved, submitted) => {
    if (draftRef.current?.id !== submitted.id) return;
    setRecord(saved);
    if (JSON.stringify(draftRef.current) === JSON.stringify(submitted)) { draftRef.current = saved.draft; setDraft(saved.draft); }
    onChanged();
  } });
  async function action(run: () => Promise<void>) { if (busy) return; setBusy(true); setError(''); try { await run(); } catch (e) { setError(e instanceof Error ? e.message : '操作失败'); } finally { setBusy(false); } }
  function update(next: SceneDraft) { draftRef.current = next; setDraft(next); setResult(undefined); }
  async function save() { return autosave.flush(draftRef.current); }
  async function leave(next: () => void) { await action(async () => { if (dirty) await save(); next(); }); }
  function add() { if (!draft || !chosen) return; const parser = parsers.find(p => p.id === chosen)!; update({ ...draft, bindings: [...draft.bindings, { id: `material_${profileId().slice(0, 8)}`, name: parser.name, parserId: parser.id, version: parser.versions.at(-1) || '', required: true, multiple: true }] }); setAdding(false); setChosen(''); }
  async function debug() { await action(async () => { await save(); const controller = new AbortController(); abort.current = controller; const value = await sceneApi.debug(id, files, assignments, controller.signal); setResult(value); const ids = [...new Set(value.items.flatMap(item => item.sampleId ? [item.sampleId] : []))]; const loaded = await Promise.all(ids.map(sampleId => profileApi.sample(sampleId))); setSamples(Object.fromEntries(loaded.map(s => [s.id, s]))); const current = await sceneApi.read(id); setRecord(current); setDraft(current.draft); }); }
  const published = record?.publishedDraft;
  const version = record?.versions.at(-1);
  const exampleBindings = published?.bindings || draft?.bindings || [];
  const schemaKey = JSON.stringify(exampleBindings.map(b => [b.id, b.parserId, b.version]));
  useEffect(() => { let live = true; setSchemas({}); void Promise.all(exampleBindings.filter(b => b.version).map(async binding => {
    const frozen = await profileApi.version(binding.parserId, binding.version);
    return [binding.id, [...new Map(frozen.templates.flatMap(t => t.fields).map(field => [field.key, field])).values()]] as [string, ProfileRule[]];
  })).then(entries => { if (live) setSchemas(Object.fromEntries(entries)); }).catch(e => { if (live) setError(e.message); }); return () => { live = false; }; }, [schemaKey]);
  const authentication = CLOUD_MODE ? " \\\n  -u \"$WENXI_USER:$WENXI_PASSWORD\"" : '';
  const curl = `curl -X POST '${location.origin}/api/studio/scenes/${id}/execute'${authentication} \\\n  -F 'version=${version || '发布后生成'}' \\\n  -F 'files=@材料包.zip'`;
  const output = Object.fromEntries(exampleBindings.map(b => [b.id, schemas[b.id]?.length ? [Object.fromEntries(schemas[b.id].map(f => [f.key, `〈${f.name}〉`]))] : []]));
  return <div className="scene-composition">
    <header className="studio-scene-header"><div className="studio-scene-identity"><Button type="text" icon={<ArrowLeftOutlined />} disabled={busy} onClick={() => void leave(onBack)}>我的场景</Button><span className="studio-breadcrumb-divider">/</span><h1>{draft?.name || '正在打开场景'}</h1><Tag>{version ? `v${version}` : '草稿'}</Tag><DraftSaveStatus save={autosave} disabled={busy} /></div><Space><Button type="primary" icon={<RocketOutlined />} disabled={busy || !draft} onClick={() => setReleaseOpen(true)}>发布</Button><Button type="text" disabled={!draft || busy} onClick={() => setSettings(true)}>设置</Button></Space></header>
    <Tabs className="scene-tabs" activeKey={tab} onChange={setTab} items={[
      { key: 'parsers', label: '服务编排', children: <div className="platform-page scene-composition-page"><div className="platform-intro"><div className="scene-composition-title"><h2>已添加服务</h2><ContextHelp label="服务编排说明"><strong>服务编排</strong><p>为当前业务场景选择需要调用的文档解析服务，例如合同、发票和报关单。</p><p>每项服务独立配置提取字段；场景负责组合调用并汇总结果。添加后，进入整包联调。</p></ContextHelp></div><Button type="primary" icon={<PlusOutlined />} disabled={busy} onClick={() => setAdding(true)}>添加服务</Button></div>
        {!draft?.bindings.length ? <div className="scene-composition-empty"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无服务" /><Space><Button onClick={() => setAdding(true)}>添加已有服务</Button><Button type="text" onClick={() => void leave(onNewParser)}>新建服务 <ArrowRightOutlined /></Button></Space></div> : <div className="scene-binding-list">{draft.bindings.map(binding => { const parser = parsers.find(p => p.id === binding.parserId); return <article className="scene-binding is-compact" key={binding.id}>
          <div className="scene-binding-heading"><ProductIcon name="service" framed className="service-project-icon" /><div><strong>{binding.name}</strong><small>{binding.required ? '必需材料' : '可选材料'} · {binding.multiple ? '可上传多份' : '限一份'}</small></div>
            <Tag color={binding.version ? 'success' : 'default'}>{binding.version ? `v${binding.version}` : parser?.versions.length ? '待选择版本' : '待发布'}</Tag>
            {!binding.version && !!parser?.versions.length && <Button size="small" disabled={busy} onClick={() => update({ ...draft, bindings: draft.bindings.map(b => b.id === binding.id ? { ...b, version: parser.versions.at(-1)! } : b) })}>使用已发布版本</Button>}
            <Button type="text" disabled={busy} onClick={() => void leave(() => onParser(binding.parserId))}>配置服务 <ArrowRightOutlined /></Button>
            <Button type="text" aria-label={`服务引用设置 ${binding.name}`} disabled={busy} onClick={() => setEditingBinding(binding.id)}>设置</Button>
            <Button type="text" danger aria-label={`移除 ${binding.name}`} icon={<DeleteOutlined />} disabled={busy} onClick={() => update({ ...draft, bindings: draft.bindings.filter(b => b.id !== binding.id) })} />
          </div>
        </article>; })}</div>}
        {!!draft?.bindings.length && <div className="scene-next-action"><Button disabled={!ready || busy} onClick={() => setTab('test')}>整包联调 <ArrowRightOutlined /></Button></div>}
      </div> },
      { key: 'test', label: '整包联调', children: <div className="platform-page scene-composition-page"><div className="platform-intro"><h2>上传本次业务的完整材料</h2><Button icon={<UploadOutlined />} disabled={busy || !ready} onClick={() => upload.current?.click()}>添加文件或 ZIP</Button></div>{!ready && <Alert type="info" title="先在服务编排中，为每项材料选择已发布版本。" />}
        <input ref={upload} type="file" multiple hidden accept=".pdf,.png,.jpg,.jpeg,.webp,.zip" onChange={e => { const incoming = Array.from(e.target.files || []); e.target.value = ''; setFiles(incoming); setAssignments({}); setResult(undefined); }} />
        {!!files.length && <div className="scene-test-files">{files.map((file, index) => <div key={`${file.name}:${index}`}><span>{file.name}</span><Select aria-label={`材料用途 ${file.name}`} value={assignments[file.name] || ''} disabled={busy} onChange={value => setAssignments(old => ({ ...old, [file.name]: value }))} options={[{ value: '', label: '自动匹配服务' }, ...(draft?.bindings || []).map(b => ({ value: b.id, label: b.name }))]} /></div>)}</div>}
        <Space className="scene-debug-buttons"><Button type="primary" loading={busy} disabled={!ready || !files.length || busy} onClick={() => void debug()}>开始联调</Button>{busy && <Button onClick={() => abort.current?.abort()}>停止</Button>}</Space>
        {result && <section className="scene-test-result"><div className="studio-section-title"><h3>联调结果</h3><Tag color={result.passed ? 'success' : 'warning'}>{result.passed ? '组合通过' : '需要处理'}</Tag></div><p>{result.summary.succeeded}/{result.summary.total} 份通过 · {(result.totalElapsedMs / 1000).toFixed(2)} s</p>{!!result.missingTypes.length && <Alert type="warning" title={`缺少材料：${result.missingTypes.join('、')}`} />}{result.issues?.map(issue => <Alert key={issue} type="warning" title={issue} />)}
          <Table size="small" rowKey={row => `${row.sourceName}:${row.materialTypeId}:${row.templateId}:${row.pages.join(',')}`} pagination={false} dataSource={result.items} columns={[{ title: '材料', dataIndex: 'sourceName' }, { title: '交给服务', dataIndex: 'materialTypeName', render: v => v || '未匹配' }, { title: '结果', render: (_, row) => row.error || (row.passed ? '通过' : '字段需核对') }]} />
          <Space><Button disabled={!Object.keys(samples).length} onClick={() => setInspect(true)}>查看原文与字段</Button><Button type="text" disabled={!result.passed || dirty || busy} onClick={() => setTab('api')}>前往发布 <ArrowRightOutlined /></Button></Space><details><summary>查看组合返回结果</summary><pre>{JSON.stringify(result.data, null, 2)}</pre></details></section>}
      </div> },
      { key: 'api', label: '接口与版本', children: <div className="platform-page scene-composition-page"><div className="platform-intro"><h2>场景组合接口</h2></div><p className="scene-intro-copy">每次发布固定引用的服务版本；修改草稿后需要重新联调。</p>{version ? <><label className="studio-api-label">已发布接口<code>POST /api/studio/scenes/{id}/execute · v{version}</code></label>{CLOUD_MODE && <p className="scene-intro-copy">设置 WENXI_USER 和 WENXI_PASSWORD 为试用账号后调用。</p>}<label className="studio-api-label">调用示例<pre>{curl}</pre></label><Button icon={<CopyOutlined />} onClick={() => void navigator.clipboard.writeText(curl).then(() => message.success('已复制')).catch(() => setError('复制失败，请手动选择调用示例'))}>复制调用示例</Button></> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="整包联调通过后，发布此组合接口" />}<details className="scene-output-preview"><summary>返回结构示意</summary><pre>{JSON.stringify(output, null, 2)}</pre></details></div> },
      { key: 'runs', label: '运行记录', children: <div className="platform-page"><Table rowKey={row => `${row.createdAt}:${row.version}:${row.totalElapsedMs}`} dataSource={runs} locale={{ emptyText: '尚无场景接口调用记录' }} columns={[{ title: '调用时间', dataIndex: 'createdAt', render: v => new Date(v).toLocaleString('zh-CN') }, { title: '场景版本', dataIndex: 'version' }, { title: '材料数', render: (_, r) => r.summary.total }, { title: '耗时', dataIndex: 'totalElapsedMs', render: v => `${v} ms` }, { title: '状态', dataIndex: 'passed', render: v => <Tag color={v ? 'success' : 'warning'}>{v ? '通过' : '待处理'}</Tag> }]} /></div> },
    ]} />
    {error && <Alert className="studio-error" type="error" title={error} closable onClose={() => setError('')} />}
    <Drawer title="添加服务" open={adding} placement="right" size={480} onClose={() => setAdding(false)} footer={<Space><Button onClick={() => setAdding(false)}>取消</Button><Button type="primary" disabled={!chosen} onClick={add}>添加到场景</Button></Space>}><div className="profile-creation-form"><label>选择我的服务<Select showSearch optionFilterProp="label" aria-label="选择场景服务" value={chosen || undefined} placeholder="选择服务" onChange={setChosen} options={parsers.map(p => ({ value: p.id, label: `${p.name}${p.versions.length ? '' : ' · 草稿'}` }))} /></label><Button type="text" onClick={() => void leave(onNewParser)}>新建服务 <ArrowRightOutlined /></Button></div></Drawer>
    {selectedBinding && <SceneServiceSettings key={selectedBinding.id} binding={selectedBinding} parser={parsers.find(parser => parser.id === selectedBinding.parserId)} busy={busy} onClose={() => setEditingBinding('')} onApply={value => { if (draft) update({ ...draft, bindings: draft.bindings.map(binding => binding.id === value.id ? value : binding) }); setEditingBinding(''); }} onConfigure={() => { setEditingBinding(''); void leave(() => onParser(selectedBinding.parserId)); }} />}
    <Drawer title="场景设置" open={settings} onClose={() => setSettings(false)} size={480}>{draft && <div className="profile-creation-form"><label>场景名称<Input value={draft.name} maxLength={100} onChange={e => update({ ...draft, name: e.target.value })} /></label><label>描述<Input.TextArea value={draft.description} maxLength={1000} rows={4} onChange={e => update({ ...draft, description: e.target.value })} /></label><SceneEfficiencySettings id={id} baseline={record?.efficiency} onSaved={value => setRecord(current => current ? { ...current, efficiency: value } : current)} /></div>}</Drawer>
    <ReleaseChecklist open={releaseOpen} name={draft?.name || ''} onClose={() => setReleaseOpen(false)} onCheck={async () => { await save(); return sceneApi.releaseCheck(id); }} onPublish={async () => { const saved = await sceneApi.publish(id); setRecord(saved); setReleaseOpen(false); setTab('api'); onChanged(); }} onNavigate={(target: ReleaseTarget) => { setReleaseOpen(false); if (target.area === 'api') setTab('api'); else if (target.area === 'test') setTab('test'); else { setTab('parsers'); if (target.bindingId) setEditingBinding(target.bindingId); else setAdding(true); } }} />
    <Drawer title="整包联调 · 原文与字段" open={inspect} onClose={() => setInspect(false)} size="large" styles={{ wrapper: { width: 'min(1400px, 100vw)' }, body: { padding: 0 } }}>{result && inspect && <StudioBundleDebug result={result} samples={samples} busy={busy} onUpload={() => { setInspect(false); upload.current?.click(); }} onBack={() => setInspect(false)} />}</Drawer>
  </div>;
}
