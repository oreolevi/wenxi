import { useEffect, useRef, useState } from 'react';
import { Button, Card, Empty, Segmented, Select, Skeleton, Space, Splitter, Tag, Tooltip, Typography } from 'antd';
import { AimOutlined, CheckOutlined, CloseOutlined, CommentOutlined, DownloadOutlined, EditOutlined, FileSearchOutlined, FileTextOutlined, InfoCircleOutlined, UndoOutlined, WarningOutlined } from '@ant-design/icons';
import { FullTextPanel } from './FullTextPanel.tsx';
import { DocumentViewer } from './DocumentViewer.tsx';
import { StructuredValue } from './StructuredValue.tsx';
import AnimatedContent from './react-bits/AnimatedContent.tsx';
import FadeContent from './react-bits/FadeContent.tsx';
import { reviewLabels } from '../types.ts';
import { DEMO_MODE } from '../demoMode.ts';
import type { ExtractedField, SourceEvidence } from '../types.ts';
import type { ExtractionTask } from '../useExtractionTask.ts';

interface Props {
  task: ExtractionTask;
  onEdit: (field: ExtractedField) => void;
  onConfirm: (field: ExtractedField) => void;
  onConfirmAll: () => void;
  onExport: () => void;
  onExamples: () => void;
  onConversation: () => void;
  onClose: () => void;
  onCreateProfile: () => void;
  onNotify: (text: string) => void;
  compact: boolean;
}

function FieldCard({ field, selected, onSelect, onEvidence, onEdit, onConfirm, onUndo }: {
  field: ExtractedField; selected: boolean; onSelect: () => void; onEvidence: (evidence: SourceEvidence[]) => void;
  onEdit: () => void; onConfirm: () => void; onUndo: () => void;
}) {
  const reviewed = ['confirmed', 'corrected'].includes(field.status);
  const colors = { pending: 'default', confirmed: 'success', corrected: 'processing', missing: 'warning', rejected: 'error', visual_required: 'warning' };
  const structured = !field.edited && !!(field.table || field.items?.length);
  const pages = [...new Set((field.evidence || []).map(item => item.pageIndex + 1))].sort((a, b) => a - b);
  return <Card size="small" className={`field-card ${selected ? 'selected' : ''}`} data-field-key={field.key}>
    <button type="button" className="field-primary" aria-label={`查看 ${field.name} 的原文依据`} aria-pressed={selected} onClick={onSelect}>
      <div className="field-card-heading"><span>{field.name}{field.unitLabel && <small className="field-unit-label">{field.unitLabel}</small>}</span><span className="field-indicators">
        {field.note && <Tooltip title={field.note}><InfoCircleOutlined aria-label={`${field.name}的处理说明`} /></Tooltip>}
        {field.status !== 'pending' && <Tag color={colors[field.status]} icon={reviewed ? <CheckOutlined /> : <WarningOutlined />}>{reviewLabels[field.status]}</Tag>}
      </span></div>
      {!structured && <div className={`field-value ${field.value ? '' : 'empty'}`}>{field.value || (field.candidates?.length ? '尚未填写字段值' : field.status === 'visual_required' ? '请核验原始图像' : field.status === 'rejected' ? '提取依据待核对' : '未找到')}</div>}
    </button>
    {structured && <StructuredValue field={field} onEvidence={onEvidence} />}
    {!!field.candidates?.length && !reviewed && <div className="seal-candidates" aria-label={`${field.name}的候选印文`}>
      <span className="seal-candidate-label">候选印文 · 需核对</span>
      {field.candidates.map((candidate, index) => <button key={index} type="button" className="seal-candidate"
        aria-label={`定位 ${field.name} 的候选印文 ${index + 1}`} onClick={() => onEvidence(candidate.evidence)}>
        <span>{candidate.value}</span><AimOutlined />
      </button>)}
      <small>候选片段未计入字段值，请对照原图核对后修改。</small>
    </div>}
    {['rejected', 'visual_required'].includes(field.status) && !(field.status === 'visual_required' && field.candidates?.length) && <p className="field-issue-note">{field.note}</p>}
    <div className="field-card-footer"><Tooltip title={field.ref ? '定位原文' : '暂无原文依据'}><Button className="field-evidence" type="text" size="small" icon={field.ref ? <AimOutlined /> : <WarningOutlined />} aria-label={`定位 ${field.name} 的原文`} onClick={onSelect}>
      {field.ref ? (field.kind === 'visual' ? '相关图像区域' : field.ref.startsWith('line-') ? '原文' : `第 ${field.page} 页`) : '无依据'}
    </Button></Tooltip>
      <div className="field-actions"><Button size="small" type="text" icon={<EditOutlined />} onClick={onEdit} aria-label={`修改 ${field.name}`}>修改</Button>
        {reviewed ? <Tooltip title="撤销核验"><Button size="small" type="text" icon={<UndoOutlined />} aria-label={`撤销 ${field.name} 的核验`} onClick={onUndo} /></Tooltip>
          : field.status === 'pending' && <Button size="small" type="text" className="confirm-button" icon={<CheckOutlined />} onClick={onConfirm} aria-label={`确认 ${field.name}`}>确认</Button>}
      </div>
    </div>
    {pages.length > 1 && <div className="field-source-pages" aria-label={`${field.name}来源页码`}>{pages.map(page => <Button key={page} type="text" size="small"
      aria-label={`查看 ${field.name} 第${page}页依据`} onClick={() => onEvidence((field.evidence || []).filter(item => item.pageIndex + 1 === page))}>第{page}页</Button>)}</div>}
  </Card>;
}

export function ReviewWorkspace(props: Props) {
  const { task, onEdit, onConfirm, onConfirmAll, onExport, onExamples, onConversation, onClose, onCreateProfile, onNotify, compact } = props;
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [tab, setTab] = useState<'source' | 'results'>('results');
  const [resultMode, setResultMode] = useState<'fields' | 'fulltext'>('fields');
  const file = task.activeFile;
  const documents = task.files.filter(file => file.kind !== 'spreadsheet');
  const fields = file?.results || [];
  const selected = fields.find(field => field.key === task.selectedKey);
  const done = fields.filter(field => ['confirmed', 'corrected'].includes(field.status)).length;
  const pending = fields.filter(field => field.status === 'pending').length;
  const sideBySide = width >= 560;
  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver(entries => setWidth(entries[0].contentRect.width));
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => { setTab('results'); setResultMode(file?.outputMode === 'fulltext' ? 'fulltext' : 'fields'); }, [file?.id, file?.outputMode, task.extracting]);

  const chooseField = (field: ExtractedField) => {
    task.selectField(field);
    if (field.ref) setTab('source');
    else onNotify('这个字段暂时没有原文依据，可手动补充');
  };
  const chooseSource = (key: string) => {
    const field = fields.find(item => item.key === key);
    if (!field) return onNotify('此项尚未提取，可以在对话里添加对应字段');
    task.selectField(field);
    setResultMode('fields'); setTab('results');
    requestAnimationFrame(() => Array.from(container.current?.querySelectorAll<HTMLElement>('[data-field-key]') || [])
      .find(element => element.dataset.fieldKey === key)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
  };

  const focused = selected && task.selectedEvidence?.length ? { ...selected, evidence: task.selectedEvidence,
    ref: task.selectedEvidence[0].ref, page: task.selectedEvidence[0].pageIndex + 1 } : selected;
  const source = <DocumentViewer file={file} page={task.page} selected={focused} busy={task.extracting}
    onPage={page => { task.setPage(page); task.setSelectedKey(null); }} onSource={chooseSource} onExamples={onExamples} />;
  const results = <section className="result-panel" aria-label="提取字段">
    <div className="results-heading results-mode-heading"><div className="result-mode-tabs" role="tablist" aria-label="解析结果视图"><button type="button" role="tab" id="result-fields-tab" aria-selected={resultMode === 'fields'} aria-controls="result-fields-panel" onClick={() => setResultMode('fields')}>字段结果</button><button type="button" role="tab" id="result-fulltext-tab" aria-selected={resultMode === 'fulltext'} aria-controls="result-fulltext-panel" onClick={() => setResultMode('fulltext')}>全文</button></div>{resultMode === 'fields' && !!fields.length && <Typography.Text type="secondary" className="review-count">{done}/{fields.length} 已核验</Typography.Text>}</div>
    {resultMode === 'fulltext' ? <div className="full-text-panel" role="tabpanel" id="result-fulltext-panel" aria-labelledby="result-fulltext-tab"><FullTextPanel file={file} onNotify={onNotify} onRequest={() => { task.setDraft('把这份文档全文转换为 Markdown'); onConversation(); }} /></div> : <div className="field-result-content" role="tabpanel" id="result-fields-panel" aria-labelledby="result-fields-tab">
    <div className="results-list">
      {task.extracting ? <div className="result-loading"><Skeleton active paragraph={{ rows: 7 }} /></div> : fields.length
        ? <FadeContent key={`${file?.id}:${fields.map(field => field.key).join(',')}`} className="result-reveal"
          trigger="mount" duration={0.32} initialOpacity={0.2} stagger={fields.length <= 12 ? 0.035 : 0}>
          {fields.map(field => <FieldCard key={field.key} field={field} selected={field.key === task.selectedKey}
          onSelect={() => chooseField(field)} onEvidence={evidence => { task.selectEvidence(field, evidence); setTab('source'); }} onEdit={() => onEdit(field)} onConfirm={() => onConfirm(field)}
          onUndo={() => task.updateFields(items => items.map(item => item.key === field.key ? { ...item, status: item.edited ? 'pending' : item.validationStatus === 'visual_required' ? 'visual_required' : ['partial', 'rejected'].includes(item.validationStatus || '') ? 'rejected' : item.ref ? 'pending' : 'missing' } : item))} />)}</FadeContent>
        : <div className="result-empty"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={<><strong>{file?.error ? file.parsed ? '字段提取未完成' : '识别失败' : file?.outputMode === 'fulltext' ? '尚未提取字段' : file?.kind === 'text' || file?.parsed ? '未匹配到字段' : file?.kind === 'archive' ? 'ZIP 待解包' : '等待识别'}</strong><p>{file?.error || (file?.outputMode === 'fulltext' ? '可在对话中说明需要提取哪些字段。' : file?.kind === 'text' || file?.parsed ? '可在对话中调整字段名称。' : file?.kind === 'archive' ? '解包与批量识别待接入。' : '请发送需要提取的字段。')}</p></>}><Button onClick={onExamples}>试用示例</Button></Empty></div>}
    </div>
    {!!pending && <div className="result-footer"><Button block icon={<CheckOutlined />} disabled={task.busy} onClick={onConfirmAll}>确认剩余项</Button></div>}
    </div>}
  </section>;

  return <section className="review-workspace" ref={container} aria-label="原文与结果核验">
    <AnimatedContent className="workspace-reveal" trigger="mount" direction="horizontal" distance={22}
      duration={0.44} initialOpacity={0.35}>
    <div className="workspace-header"><div className="workspace-file">
      <FileTextOutlined />{documents.length > 1
        ? <Select aria-label="选择文档" variant="borderless" popupMatchSelectWidth={300} value={task.activeId} onChange={task.selectFile} options={documents.map(material => ({ value: material.id, label: material.name }))} />
        : <span className="workspace-file-name" title={file?.name}>{file?.name || '文档'}</span>}
      <Tooltip title={file?.parsed?.modelCall ? `${file.parsed.modelCall.model} · 本次 ${file.parsed.modelCall.usage?.total_tokens ?? '未测得'} Tokens${file.parsed.textSources?.pdfTextPages.length ? ' · 含PDF原生文字层' : ''}` : undefined}>
        <Tag variant="filled">{DEMO_MODE ? '演示数据' : file?.kind === 'demo' ? '示例' : file?.parsed ? file.outputMode !== 'fulltext' && file.parsed.extractor === 'deepseek' ? 'DeepSeek' : 'MinerU' : file?.kind === 'text' ? '本地匹配' : file?.kind === 'archive' ? '待解包' : '仅预览'}</Tag>
      </Tooltip>
    </div><Space size={6}>{compact && <Tooltip title="对话"><Button type="text" icon={<CommentOutlined />} aria-label="查看对话与调整" onClick={onConversation} /></Tooltip>}
      <Button size="small" icon={<FileSearchOutlined />} disabled={task.busy || !file?.parsed || !['pdf', 'image'].includes(file.kind)} onClick={onCreateProfile}>创建场景</Button>
      <Button size="small" icon={<DownloadOutlined />} disabled={task.busy || !task.files.some(item => item.results?.length)} onClick={onExport}>导出</Button>
      <Tooltip title="保存到历史记录并返回首页"><Button className="workspace-close" type="text" size="small" icon={<CloseOutlined />} loading={task.historySaving} aria-label="关闭提取任务" onClick={onClose} /></Tooltip>
    </Space></div>
    {!sideBySide && <div className="review-view-tabs"><Segmented value={tab} onChange={value => setTab(value as 'source' | 'results')} options={[{ value: 'source', icon: <FileTextOutlined />, label: '原文' }, { value: 'results', icon: <FileSearchOutlined />, label: '解析结果' }]} /></div>}
    <div className="review-content">{sideBySide
      ? <Splitter className="review-splitter"><Splitter.Panel defaultSize="58%" min={250}>{source}</Splitter.Panel><Splitter.Panel min={240}>{results}</Splitter.Panel></Splitter>
      : tab === 'source' ? source : results}</div>
    </AnimatedContent>
  </section>;
}
