import { CLOUD_MODE } from '../demoMode.ts';
import { ProductIcon } from './ProductIcon.tsx';
import { useEffect, useState } from 'react';
import { Alert, Button, Drawer, Empty, Select, Space, Spin, Table, Tag } from 'antd';
import { ApiOutlined, ArrowRightOutlined, CheckCircleOutlined, CopyOutlined, DownloadOutlined, PlayCircleOutlined, PlusOutlined, ReloadOutlined, RocketOutlined } from '@ant-design/icons';
import { profileApi, type EvaluationReport, type ProfileDraft, type ProfileRecord, type ProfileRelease, type ProfileRule, type ProfileSample, type ProfileTest, type StudioRun } from '../profiles.ts';
import type { ReleaseReport, ReleaseTarget } from '../release.ts';
import { ProfileCanvas } from './ProfileCanvas.tsx';

export interface StudioMaterialRow { id: string; name: string; templateId: string; templateName: string; role: string; pages: number; baseline: boolean }
export function studioMaterials(draft: ProfileDraft, samples: Record<string, ProfileSample>): StudioMaterialRow[] {
  const links = new Map<string, StudioMaterialRow>();
  for (const template of draft.templates) links.set(template.sampleId, { id: template.sampleId, name: samples[template.sampleId]?.name || '正在读取材料', templateId: template.id, templateName: template.name, role: '基准样例', pages: samples[template.sampleId]?.pages.length || 0, baseline: true });
  for (const link of draft.samples || []) if (!links.has(link.sampleId)) links.set(link.sampleId, { id: link.sampleId, name: samples[link.sampleId]?.name || '正在读取材料', templateId: link.templateId, templateName: draft.templates.find(item => item.id === link.templateId)?.name || '自动匹配版式', role: link.role === 'test' ? '测试样例' : '校准样例', pages: samples[link.sampleId]?.pages.length || 0, baseline: false });
  return [...links.values()];
}
const date = (value: string) => new Date(value).toLocaleString('zh-CN', { hour12: false });
function downloadReport(report: EvaluationReport) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = `文析-规则回放-${report.id.slice(0, 8)}.json`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function StudioSamples({ draft, samples, busy, onAddTemplate, onAddTests, onOpen, onChange, onConfigure }: {
  draft: ProfileDraft; samples: Record<string, ProfileSample>; busy: boolean; onAddTemplate: () => void; onAddTests: () => void;
  onOpen: (id: string) => void; onChange: (draft: ProfileDraft) => void; onConfigure: (id: string) => void;
}) {
  return <div className="studio-page"><div className="studio-page-heading"><div><h2>样例管理</h2><span>{draft.templates.length} 个版式 · {studioMaterials(draft, samples).length} 份材料</span></div><Space><Button icon={<PlusOutlined />} disabled={busy || !draft.templates.length} onClick={onAddTests}>添加测试样例</Button><Button type="primary" icon={<PlusOutlined />} disabled={busy || draft.templates.length >= 10} onClick={onAddTemplate}>添加版式</Button></Space></div>
    <div className="studio-template-list">{draft.templates.map(template => <button type="button" key={template.id} disabled={busy} onClick={() => onConfigure(template.id)}><ProductIcon name="template" /><div><strong>{template.name}</strong><span>{template.fields.length} 个字段 · {template.fields.filter(field => field.region).length} 个已定位</span></div><span>配置</span></button>)}</div>
    <Table<StudioMaterialRow> rowKey="id" size="middle" dataSource={studioMaterials(draft, samples)} pagination={false} scroll={{ x: 650 }} locale={{ emptyText: <Empty description="添加第一份样例，建立一个固定版式"><Button type="primary" onClick={onAddTemplate}>上传样例</Button></Empty> }} columns={[
      { title: '样例材料', dataIndex: 'name', render: (name, row) => <Button type="link" className="studio-material-name" onClick={() => onOpen(row.id)}>{name}</Button> },
      { title: '用途', key: 'role', width: 130, render: (_, row) => row.baseline ? <Tag>基准样例</Tag> : <Select size="small" value={row.role === '测试样例' ? 'test' : 'calibration'} aria-label={`${row.name}的用途`} disabled={busy} onChange={(role: 'test' | 'calibration') => onChange({ ...draft, samples: draft.samples?.map(item => item.sampleId === row.id ? { ...item, role } : item) })} options={[{ value: 'test', label: '测试样例' }, { value: 'calibration', label: '校准样例' }]} /> },
      { title: '关联版式', key: 'template', width: 180, render: (_, row) => row.baseline ? row.templateName : <Select size="small" value={row.templateId} disabled={busy} aria-label={`${row.name}的版式`} onChange={templateId => onChange({ ...draft, samples: draft.samples?.map(item => item.sampleId === row.id ? { ...item, templateId } : item) })} options={[{ value: '', label: '自动匹配版式' }, ...draft.templates.map(item => ({ value: item.id, label: item.name }))]} /> },
      { title: '页数', dataIndex: 'pages', width: 65 },
      { title: '', key: 'remove', width: 70, render: (_, row) => !row.baseline && <Button type="text" disabled={busy} onClick={() => onChange({ ...draft, samples: draft.samples?.filter(item => item.sampleId !== row.id) })}>移除</Button> },
    ]} />
  </div>;
}

export function StudioEvaluation({ draft, samples, reports, report, busy, onAdd, onRun, onReport, onResult }: {
  draft: ProfileDraft; samples: Record<string, ProfileSample>; reports: EvaluationReport[]; report?: EvaluationReport;
  busy: boolean; onAdd: () => void; onRun: (ids: string[]) => void; onReport: (id: string) => void; onResult: (sampleId: string, result: ProfileTest) => void;
}) {
  const materials = studioMaterials(draft, samples);
  const [selected, setSelected] = useState<string[]>([]);
  const ids = materials.map(item => item.id).join(',');
  useEffect(() => { setSelected(materials.filter(item => !item.baseline && item.role === '测试样例').map(item => item.id)); }, [draft.id, ids]);
  return <div className="studio-page"><div className="studio-page-heading"><div><h2>批量测试</h2><span>规则回放 · 使用已识别样例，不重复执行 OCR</span></div><Space><Button icon={<PlusOutlined />} disabled={busy || !draft.templates.length} onClick={onAdd}>添加测试材料</Button><Button type="primary" icon={<PlayCircleOutlined />} disabled={busy || !selected.length} onClick={() => onRun(selected)}>运行回放{selected.length ? ` · ${selected.length} 份` : ''}</Button></Space></div>
    <div className="studio-evaluation-grid"><section><div className="studio-subheading"><strong>测试材料</strong><span>{selected.length} 份已选</span></div>
      <Table<StudioMaterialRow> rowKey="id" size="small" pagination={false} dataSource={materials} rowSelection={{ selectedRowKeys: selected, onChange: keys => setSelected(keys.map(String)), getCheckboxProps: () => ({ disabled: busy }) }} columns={[{ title: '材料', dataIndex: 'name' }, { title: '用途', dataIndex: 'role', width: 85 }]} locale={{ emptyText: '先添加测试材料' }} />
      <div className="studio-subheading studio-report-heading"><strong>历史报告</strong></div><div className="studio-report-list">{reports.map(item => <button type="button" key={item.id} disabled={busy} className={report?.id === item.id ? 'is-active' : ''} onClick={() => onReport(item.id)}><span>{date(item.createdAt)}</span><small>{item.summary.passed}/{item.summary.total} 份通过 · {item.hash.slice(0, 8)}</small></button>)}{!reports.length && <span className="studio-muted">还没有回放记录</span>}</div>
    </section><section className="studio-report-content">{report ? <><div className="studio-subheading"><strong>报告 · {report.hash.slice(0, 8)}</strong><Button size="small" icon={<DownloadOutlined />} onClick={() => downloadReport(report)}>下载报告</Button></div><div className="studio-report-metrics"><div><span>材料通过</span><strong>{report.summary.passed}<small> / {report.summary.total}</small></strong></div><div><span>已取值字段</span><strong>{report.summary.matchedFields}</strong></div><div><span>规则回放 P95</span><strong>{report.summary.ruleP95Ms}<small> ms</small></strong></div></div>
      <div className="studio-report-scope">{date(report.createdAt)} · 草稿快照 · 不含 OCR 与上传耗时</div>
      <Table<EvaluationReport['rows'][number]> size="small" rowKey="sampleId" dataSource={report.rows} pagination={false} scroll={{ x: 440 }} columns={[{ title: '材料 / 结果', key: 'name', render: (_, row) => <><strong>{row.name}</strong>{row.error && <div className="studio-error-detail">{row.error}</div>}</> }, { title: '状态', key: 'status', width: 100, render: (_, row) => <Tag color={row.passed ? 'success' : 'warning'}>{row.passed ? '回放通过' : '需调整'}</Tag> }, { title: '', key: 'open', width: 65, render: (_, row) => row.result && <Button type="link" size="small" onClick={() => onResult(row.sampleId, row.result!)}>查看</Button> }]} />
      <p className="studio-footnote">通过表示当前规则取值及格式校验通过。未提供人工标准答案，不计算业务准确率。</p>
    </> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="选择材料运行回放，或打开已有报告" />}</section></div>
  </div>;
}

export function StudioRelease({ draft, record, dirty, busy, onRelease, onNavigate, onShare, onCopy }: {
  draft: ProfileDraft; record: ProfileRecord; dirty: boolean; busy: boolean;
  onRelease: () => void; onNavigate: (target: ReleaseTarget) => void; onShare: (version: string) => void; onCopy: (value: string) => void;
}) {
  const versionsKey = record.versions.join(',');
  const latest = record.versions.at(-1) || '';
  const [selectedVersion, setVersion] = useState(latest);
  const version = record.versions.includes(selectedVersion) ? selectedVersion : latest;
  const [loaded, setLoaded] = useState<{ id: string; version: string; draft: ProfileDraft }>();
  const snapshot = loaded?.id === draft.id && loaded.version === version ? loaded.draft : undefined;
  const [error, setError] = useState('');
  const [history, setHistory] = useState<ProfileRelease[]>([]);
  const [historyError, setHistoryError] = useState('');
  const [historyLoading, setHistoryLoading] = useState(false);
  const [report, setReport] = useState<ReleaseReport>();
  const [checkError, setCheckError] = useState('');
  const [checking, setChecking] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [configOpen, setConfigOpen] = useState(false);
  useEffect(() => { setVersion(latest); setConfigOpen(false); }, [draft.id, versionsKey]);
  useEffect(() => {
    let alive = true; setLoaded(undefined); setError('');
    if (version) void profileApi.version(draft.id, version).then(value => { if (alive) setLoaded({ id: draft.id, version, draft: value }); }).catch(e => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, [draft.id, version, attempt]);
  useEffect(() => {
    let alive = true; setHistory([]); setHistoryError(''); setHistoryLoading(!!latest);
    if (latest) void profileApi.releases(draft.id).then(value => { if (alive) setHistory(value); }).catch(e => { if (alive) setHistoryError(e.message); }).finally(() => { if (alive) setHistoryLoading(false); });
    return () => { alive = false; };
  }, [draft.id, versionsKey, attempt]);
  useEffect(() => {
    let alive = true; setReport(undefined); setCheckError(''); setChecking(!dirty);
    if (!dirty) void profileApi.releaseCheck(draft.id).then(value => { if (alive) setReport(value); }).catch(e => { if (alive) setCheckError(e.message); }).finally(() => { if (alive) setChecking(false); });
    return () => { alive = false; };
  }, [draft.id, record.draft, record.lastTest, record.lastEvaluation, dirty, attempt]);
  const isBundle = !!snapshot?.materialTypes?.length;
  const endpoint = `/api/extraction-profiles/${draft.id}/${isBundle ? 'execute-bundle' : 'execute'}`;
  const authentication = CLOUD_MODE ? " \\\n  -u \"$WENXI_USER:$WENXI_PASSWORD\"" : '';
  const curl = snapshot ? `curl -X POST '${location.origin}${endpoint}'${authentication} \\\n  -F 'version=${version}' \\\n  -F '${isBundle ? 'files=@材料包.zip' : 'file=@新的业务材料.pdf'}'` : '';
  const exampleFields = (snapshot?.templates[0]?.fields || []).slice(0, 2).map(field => ({ key: field.key, name: field.name, value: '<提取值>', page: 1, bbox: [0.1, 0.2, 0.4, 0.24] }));
  const responseExample = { profileId: draft.id, version, usesLlm: false, ...(isBundle ? { items: [{ fields: exampleFields }] } : { fields: exampleFields }) };
  const checkState = dirty ? '草稿正在保存，保存后更新检查' : checking ? '正在检查发布条件' : checkError ? '发布检查未完成' : report?.unchanged ? '草稿与已发布版本一致' : report?.ready ? '草稿已通过检查，可发布新版本' : report ? `${report.issues.length} 项待处理` : '等待发布检查';
  return <div className="studio-page studio-delivery-page">
    <div className="studio-page-heading"><h2>接口与版本</h2><Tag color={latest ? 'success' : 'default'}>{latest ? `已发布 · ${record.versions.length} 个版本` : '尚未发布'}</Tag></div>
    {!latest ? <>
      <section className="studio-first-release"><span className="studio-delivery-icon"><ApiOutlined /></span><div><h3>发布首个版本</h3><p>通过发布检查后，生成可调用的固定版本。</p><small>{draft.templates.length} 个版式 · {new Set(draft.templates.flatMap(item => item.fields.map(field => field.key))).size} 个字段</small></div><Button type="primary" icon={<RocketOutlined />} disabled={busy} onClick={onRelease}>发布首个版本</Button></section>
      <section className="studio-delivery-section studio-readiness"><div className="studio-delivery-heading"><h3>发布前检查</h3><Button type="text" size="small" icon={<ReloadOutlined />} disabled={busy || dirty} loading={checking} onClick={() => setAttempt(value => value + 1)}>重新检查</Button></div>
        {checkError ? <Alert type="error" showIcon title={checkError} /> : checking || dirty ? <div className="studio-delivery-loading" role="status"><Spin size="small" /><span>{checkState}</span></div> : report?.ready ? <div className="studio-readiness-ready"><CheckCircleOutlined /><strong>发布条件已满足</strong><span>可发布 v{report.nextVersion}</span></div> : report ? <div className="studio-readiness-issues">{report.issues.map((issue, index) => <article key={`${issue.code}:${index}`}><div><strong>{issue.title}</strong><p>{issue.detail}</p></div><Button type="link" size="small" disabled={busy} aria-label={`前往处理：${issue.title}`} icon={<ArrowRightOutlined />} iconPlacement="end" onClick={() => onNavigate(issue.target)}>去处理</Button></article>)}</div> : null}
      </section>
    </> : <>
      <div className="studio-draft-checkline" role="status"><span>{report?.ready && <CheckCircleOutlined />} {checkState}</span><Button type="link" size="small" disabled={busy} onClick={onRelease}>{report?.ready && !report.unchanged ? '发布新版本' : '查看发布检查'}</Button></div>
      <section className="studio-delivery-section studio-api-access"><div className="studio-delivery-heading"><h3>接口接入</h3><Select aria-label="查看发布版本" value={version} onChange={setVersion} options={[...record.versions].reverse().map(value => ({ value, label: `v${value}${value === latest ? ' · 最新' : ''}` }))} /></div>
        {error ? <Alert type="error" showIcon title={error} action={<Button size="small" onClick={() => setAttempt(value => value + 1)}>重试</Button>} /> : !snapshot ? <div className="studio-delivery-loading" role="status"><Spin size="small" /><span>正在读取版本配置</span></div> : <>
          <div className="studio-endpoint"><span>POST</span><code>{endpoint}</code><Button type="text" size="small" icon={<CopyOutlined />} aria-label="复制接口地址" onClick={() => onCopy(`${location.origin}${endpoint}`)} /></div>
          <div className="studio-api-identity"><span>服务 ID <code>{draft.id}</code></span><span>固定版本 v{version}</span></div>
          {CLOUD_MODE && <p className="studio-footnote">设置 WENXI_USER 和 WENXI_PASSWORD 为试用账号后调用。</p>}<div className="studio-code-heading"><strong>调用示例</strong><Button size="small" type="text" icon={<CopyOutlined />} onClick={() => onCopy(curl)}>复制调用示例</Button></div><pre className="studio-delivery-code">{curl}</pre>
          <div className="studio-api-contract"><details><summary>请求参数</summary><Table size="small" rowKey="name" pagination={false} dataSource={[{ name: 'version', type: 'string', description: `必填 · 固定版本号 ${version}` }, { name: isBundle ? 'files' : 'file', type: 'file', description: isBundle ? '必填 · 文件或 ZIP 材料包，可提交多份' : '必填 · 待提取材料，PDF 或图片' }]} columns={[{ title: '参数', dataIndex: 'name', width: 100 }, { title: '类型', dataIndex: 'type', width: 90 }, { title: '说明', dataIndex: 'description' }]} /></details><details><summary>响应示意</summary><pre className="studio-delivery-code">{JSON.stringify(responseExample, null, 2)}</pre><p className="studio-footnote">字段值与页码以实际结果为准；bbox 为归一化原文坐标。</p></details></div>
        </>}
      </section>
      <section className="studio-delivery-section studio-version-history"><div className="studio-delivery-heading"><h3>版本记录</h3><Button type="text" size="small" icon={<ReloadOutlined />} loading={historyLoading} onClick={() => setAttempt(value => value + 1)}>刷新</Button></div>
        {historyError ? <Alert type="error" showIcon title={historyError} action={<Button size="small" onClick={() => setAttempt(value => value + 1)}>重试</Button>} /> : <Table<ProfileRelease> rowKey="version" size="middle" loading={historyLoading} dataSource={history} pagination={false} scroll={{ x: 630 }} columns={[
          { title: '版本', dataIndex: 'version', width: 140, render: value => <span className="studio-version-label"><strong>v{value}</strong>{value === latest && <Tag>最新</Tag>}</span> },
          { title: '发布时间', dataIndex: 'publishedAt', width: 170, render: value => value ? date(value) : '未记录' },
          { title: '发布内容', key: 'config', render: (_, row) => <div className="studio-release-contents">{row.note && <strong title={row.note}>{row.note}</strong>}<span>{row.templates} 个版式 · {row.fields} 个字段</span></div> },
          { title: '发布时测试', dataIndex: 'tests', width: 130, render: value => value ? `${value.passed}/${value.total} 个版式通过` : <span className="studio-muted">未记录</span> },
          { title: '操作', key: 'actions', width: 165, render: (_, row) => <Space size={0}><Button type="link" size="small" onClick={() => { setVersion(row.version); setConfigOpen(true); }}>查看配置</Button><Button type="text" size="small" disabled={busy} onClick={() => onShare(row.version)}>申请公开</Button></Space> },
        ]} />}
        <p className="studio-footnote">调用方通过 version 指定固定配置。发布新版本不改变原版本；申请公开需另行审核。</p>
      </section>
    </>}
    <Drawer title={`版本配置 · v${version}`} open={configOpen} onClose={() => setConfigOpen(false)} size={720} styles={{ wrapper: { maxWidth: '100vw' } }} footer={<Button disabled={!snapshot} icon={<CopyOutlined />} onClick={() => snapshot && onCopy(JSON.stringify(snapshot, null, 2))}>复制版本配置</Button>}>
      {history.find(row => row.version === version)?.note && <div className="studio-version-note"><strong>发布说明</strong><p>{history.find(row => row.version === version)!.note}</p></div>}
      {error ? <Alert type="error" title={error} /> : snapshot ? <pre className="studio-delivery-code">{JSON.stringify(snapshot, null, 2)}</pre> : <Spin />}
    </Drawer>
  </div>;
}

export function StudioRuns({ runs, busy, onRefresh }: { runs: StudioRun[]; busy: boolean; onRefresh: () => void }) {
  return <div className="studio-page"><div className="studio-page-heading"><div><h2>运行记录</h2><span>当前场景的实际 API 调用 · 最近 100 条</span></div><Button icon={<ReloadOutlined />} disabled={busy} onClick={onRefresh}>刷新</Button></div>
    <Table<StudioRun> rowKey="id" size="middle" dataSource={runs} pagination={{ pageSize: 10, hideOnSinglePage: true }} scroll={{ x: 750 }} locale={{ emptyText: '发布版本并调用 API 后，运行记录会显示在这里' }} columns={[
      { title: '材料 / 请求 ID', key: 'name', render: (_, row) => <div className="studio-run-name"><strong>{row.name}</strong><small>{row.id.slice(0, 12)}</small>{row.error && <small className="studio-error-detail">{row.error}</small>}</div> },
      { title: '版本', dataIndex: 'version', width: 90 }, { title: '状态', key: 'status', width: 100, render: (_, row) => <Tag color={row.status === 'succeeded' ? 'success' : row.status === 'failed' ? 'error' : 'warning'}>{row.status === 'succeeded' ? '执行完成' : row.status === 'failed' ? '失败' : '需核对'}</Tag> },
      { title: '总耗时', key: 'elapsed', width: 100, render: (_, row) => `${(row.totalElapsedMs / 1000).toFixed(2)} s` }, { title: '调用时间', dataIndex: 'createdAt', width: 170, render: date },
    ]} />
  </div>;
}

export function StudioPreview({ sample, result, onClose }: { sample?: ProfileSample; result?: ProfileTest; onClose: () => void }) {
  const [selected, setSelected] = useState(''); const [page, setPage] = useState(1); const [item, setItem] = useState(0);
  useEffect(() => { setItem(0); setSelected(result?.fields[0]?.key || ''); setPage(result?.fields[0]?.page || 1); }, [sample?.id, result]);
  const current = result?.items?.[item] || result;
  const fields: ProfileRule[] = (current?.fields || []).map(field => ({ id: field.key, key: field.key, name: field.name, kind: 'text', method: 'region', page: field.page, region: field.bbox, required: true, anchor: '', direction: 'right' }));
  return <Drawer title={sample?.name || '材料预览'} open={!!sample} placement="right" size={1060} styles={{ wrapper: { maxWidth: '100vw' }, body: { padding: 0 } }} onClose={onClose} className="studio-preview-drawer">
    <div className="studio-preview-grid"><ProfileCanvas sample={sample} fields={fields} selectedId={selected} page={page} onPage={setPage} onSelect={setSelected} onBind={() => {}} onUpload={() => {}} readOnly result={current} /><aside className="studio-preview-values">{result?.items && result.items.length > 1 && <Select aria-label="报告内的票据" value={item} onChange={value => { setItem(value); setPage(result.items![value].pages[0]); setSelected(result.items![value].fields[0]?.key || ''); }} options={result.items.map((entry, index) => ({ value: index, label: `第 ${index + 1} 份 · 原文第 ${entry.pages.join('、')} 页` }))} />}{current?.fields.map(field => <button type="button" key={field.key} className={selected === field.key ? 'is-active' : ''} onClick={() => { setSelected(field.key); setPage(field.page); }}><span>{field.name}<Tag color={field.status === 'matched' ? 'success' : 'warning'}>{field.status === 'matched' ? '已取值' : '需调整'}</Tag></span><strong>{field.value || '—'}</strong>{field.issue && <small>{field.issue}</small>}</button>)}{!result && <><h3>识别与预处理</h3>{sample?.pages.map(entry => <div key={entry.number} className="studio-preview-meta"><strong>第 {entry.number} 页</strong><p>{entry.steps?.map(step => step.label).join(' · ') || sample.engine}</p></div>)}</>}</aside></div>
  </Drawer>;
}
