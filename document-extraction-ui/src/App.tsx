import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Bubble } from '@ant-design/x';
import { App as AntApp, Alert, Button, Card, Descriptions, Drawer, Form, Grid, Input, Layout, Modal, Radio, Space, Splitter, Tag, Typography } from 'antd';
import { ArrowRightOutlined, AuditOutlined, BookOutlined, HistoryOutlined, MenuFoldOutlined, MenuUnfoldOutlined, FileSearchOutlined, FileTextOutlined, LockOutlined, PaperClipOutlined, ProfileOutlined } from '@ant-design/icons';
import { fixtures } from './fixtures.ts';
import { createExport, reviewField } from './model.ts';
import { useExtractionTask } from './useExtractionTask.ts';
import { Composer } from './components/Composer.tsx';
import { ReviewWorkspace } from './components/ReviewWorkspace.tsx';
import { Navigation } from './components/Navigation.tsx';
import { BrandMark } from './components/BrandMark.tsx';
import { BrandName } from './components/BrandName.tsx';
import { PlatformWorkspace } from './components/PlatformWorkspace.tsx';
import { ProcessingDetails } from './components/ProcessingDetails.tsx';
import { ProfilesWorkspace, type ProfileSeed } from './components/ProfilesWorkspace.tsx';
import { navigationKey, pageFromSearch, pageGroup, pageTitle } from './navigationModel.ts';
import { useColorMode } from './theme.tsx';
import { localServicePage } from './service.ts';
import type { ExtractedField, Scenario } from './types.ts';
import { HelpCenter } from './help/HelpCenter.tsx';

const sampleExamples: Array<{ id: string; title: string; scenario: Scenario; label: string; prompt: string; icon: ReactNode }> = [
  { id: 'application', title: '申请表要素', scenario: 'application', label: '提取申请表的提交人、通讯地址和电话',
    prompt: '提取提交人、通讯地址和联系电话，整理成表格。', icon: <ProfileOutlined /> },
  { id: 'contract', title: '合同关键信息', scenario: 'contract', label: '整理合同双方、合同金额和签订日期',
    prompt: '提取甲方名称、乙方名称、合同金额和签订日期，整理成表格。', icon: <FileTextOutlined /> },
  { id: 'review', title: '审核人员信息', scenario: 'application', label: '提取初审人员、最终审核人员和审核日期',
    prompt: '提取初审人员、最终审核人员和审核日期，整理成表格。', icon: <AuditOutlined /> },
];

const placeholderEntries = [
  { title: '常用提取', description: '复用已保存的提取要求，快速处理新材料', icon: <BookOutlined /> },
];

export default function App() {
  const { mode } = useColorMode();
  const { message, modal } = AntApp.useApp();
  const task = useExtractionTask(text => { void message.info(text); });
  const screens = Grid.useBreakpoint();
  const compact = !screens.md;
  const [page, setPage] = useState(() => pageFromSearch(location.search));
  const [studioEntry, setStudioEntry] = useState(0);
  const [sidebarPreference, setSidebarPreference] = useState<boolean | null>(null);
  const [navigationOpen, setNavigationOpen] = useState(false);
  const collapsed = sidebarPreference ?? !screens.lg;
  const navigate = useCallback((nextPage: string) => {
    const key = navigationKey(nextPage);
    setPage(key); setNavigationOpen(false);
    const url = new URL(location.href);
    url.searchParams.delete('profile'); url.searchParams.delete('studio');
    if (key === 'profiles') setStudioEntry(value => value + 1);
    if (key === 'business') url.searchParams.delete('page');
    else url.searchParams.set('page', key);
    try { if (url.href !== location.href) window.history.pushState(null, '', url); } catch { /* Navigation remains available in restricted file previews. */ }
  }, []);
  useEffect(() => {
    const restore = () => { setPage(pageFromSearch(location.search)); setNavigationOpen(false); };
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, []);
  useEffect(() => {
    const title = pageTitle(page);
    document.title = page === 'business' || page === 'profiles' ? title : `文析 · ${title}`;
  }, [page]);
  const [panel, setPanel] = useState<'examples' | 'help' | 'export' | 'comparison' | null>(() => localServicePage() && new URLSearchParams(location.search).get('view') === 'comparison' ? 'comparison' : null);
  const [conversationOpen, setConversationOpen] = useState(false);
  const [workspaceDismissed, setWorkspaceDismissed] = useState(false);
  const showLanding = !task.started || workspaceDismissed;
  const [editing, setEditing] = useState<ExtractedField | null>(null);
  const [editForm] = Form.useForm<{ value: string }>();
  const [exportFormat, setExportFormat] = useState<'csv' | 'json'>('csv');
  const [dragging, setDragging] = useState(false);
  const [sampleFocusToken, setSampleFocusToken] = useState(0);
  const [profileSeed, setProfileSeed] = useState<ProfileSeed | null>(null);

  function chooseSample(scenario: Scenario, prompt = fixtures[scenario].prompt) {
    if (task.busy) return;
    const openSample = async () => {
      if (!await task.closeTask()) return;
      task.useSample(scenario); task.setDraft(prompt);
      setWorkspaceDismissed(false); navigate('business'); setPanel(null);
      setSampleFocusToken(token => token + 1);
    };
    const hasWork = task.messages.length > 0 || task.files.some(file => file.kind !== 'demo' || file.processed)
      || (!!task.draft.trim() && !task.files.length);
    setPanel(null);
    if (hasWork) modal.confirm({ title: '打开新的示例任务？',
      content: '已完成的提取和核验结果会保存到历史记录，再打开新的示例任务。',
      okText: '打开示例', cancelText: '保留当前任务', onOk: openSample });
    else openSample();
  }
  async function closeWorkspace() {
    if (!await task.closeTask()) return;
    setWorkspaceDismissed(false); setConversationOpen(false); setEditing(null); setPanel(null); setDragging(false);
    editForm.resetFields(); navigate('business');
  }
  function confirmField(field: ExtractedField) { task.updateFields(fields => fields.map(item => item.key === field.key ? reviewField(item) : item)); }
  function confirmAll() {
    const pending = task.activeFile?.results?.filter(field => field.status === 'pending').length || 0;
    modal.confirm({ title: '确认已核对这些字段？', content: `将把当前文件中 ${pending} 个待核验字段标为“已确认”。未找到、依据待核对和待图像核验的字段继续保留原状态。`,
      okText: '确认已核对', cancelText: '继续核对', onOk: () => task.updateFields(fields => fields.map(field => field.status === 'pending' ? reviewField(field) : field)) });
  }
  function saveEdit({ value }: { value: string }) {
    if (!editing || !value.trim()) return;
    task.updateFields(fields => fields.map(field => field.key === editing.key ? reviewField(field, value.trim()) : field));
    setEditing(null); void message.success('核定值已保存，原始值仍保留');
  }
  function download() {
    const result = createExport(task.files, exportFormat);
    const url = URL.createObjectURL(new Blob([result.content], { type: result.type }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = result.name; anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setPanel(null); void message.success('结果已导出，原始值和核验状态一并保留');
  }

  const exampleCards = <div className="example-grid">{sampleExamples.map(sample => <Card key={sample.id} size="small" className="example-card" hoverable>
    <button type="button" className="example-button" onClick={() => chooseSample(sample.scenario, sample.prompt)}><span className="example-icon" aria-hidden>{sample.icon}</span><span className="example-copy"><strong>{sample.title}</strong><span>{sample.label}</span><small>{fixtures[sample.scenario].name} · 2 页</small></span><ArrowRightOutlined className="example-arrow" aria-hidden /></button>
  </Card>)}</div>;

  const conversation = <section className="conversation" aria-label="需求对话"><div className="conversation-heading"><h1>对话</h1>{!task.hasWorkspace && <Button type="text" size="small" onClick={() => setPanel('examples')}>试用示例</Button>}</div>
    <Bubble.List className="chat-bubbles" autoScroll role={{
      user: { placement: 'end', variant: 'filled', shape: 'round', className: 'user-bubble' },
      assistant: { placement: 'start', variant: 'borderless', className: 'assistant-bubble' },
    }} items={[
      ...task.messages.map(item => ({ key: item.id, role: item.role, content: <>{item.processing && <ProcessingDetails trace={item.processing} />}<div className="message-text">{item.text}</div></>,
        footer: item.files ? <span className="message-files"><PaperClipOutlined /> {item.files.join('、')}</span> : item.resultLink && compact
          ? <Button size="small" icon={<FileSearchOutlined />} onClick={() => setConversationOpen(false)}>查看结果</Button> : undefined })),
      ...(task.busy ? [{ key: 'loading', role: 'assistant', content: task.processing ? <ProcessingDetails trace={task.processing} /> : task.progress || '正在回复…', loading: !task.processing && !task.progress }] : []),
    ]} />
    <div className="conversation-composer"><Composer task={task} compact /></div></section>;

  const workspace = <ReviewWorkspace task={task} compact={compact} onEdit={field => { editForm.setFieldsValue({ value: field.value }); setEditing(field); }} onConfirm={confirmField} onConfirmAll={confirmAll}
    onExport={() => setPanel('export')} onExamples={() => setPanel('examples')} onConversation={() => setConversationOpen(true)}
    onClose={closeWorkspace}
    onCreateProfile={() => { if (task.activeFile) { setProfileSeed({ token: Date.now(), material: task.activeFile }); navigate('profiles'); } }}
    onNotify={text => { void message.info(text); }} />;

  const exportedFields = task.files.flatMap(file => file.results || []);
  const unreviewed = exportedFields.filter(field => !['confirmed', 'corrected'].includes(field.status)).length;

  const navigationProps = { page, sidebarCollapsed: collapsed, onNavigate: navigate, onHelp: () => setPanel('help' as const), onSidebarChange: setSidebarPreference };

  return <Layout className="application" onDragEnter={event => {
    if (page === 'business' && Array.from(event.dataTransfer.types).includes('Files') && !task.busy) { event.preventDefault(); setDragging(true); }
  }} onDragOver={event => { if (Array.from(event.dataTransfer.types).includes('Files')) event.preventDefault(); }}
    onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }}
    onDrop={event => { if (page === 'business' && event.dataTransfer.files.length) { event.preventDefault(); setDragging(false); void task.addFiles(Array.from(event.dataTransfer.files)); } }}>
    {!compact && <Layout.Sider className="application-sidebar" width={196} collapsedWidth={56} collapsed={collapsed} theme={mode}>
      <Navigation {...navigationProps} collapsed={collapsed} showCollapse />
    </Layout.Sider>}
    <Layout className={`main-layout ${page === 'business' ? 'extraction-layout' : ''} ${compact ? 'is-compact' : ''}`}>{page !== 'business' && page !== 'profiles' && <Layout.Header className="app-header platform-header"><div className="header-brand">{compact && <Button className="navigation-toggle" type="text" icon={<MenuUnfoldOutlined />} aria-label="打开功能导航" onClick={() => setNavigationOpen(true)} />}<span>{pageGroup(page)}</span><Typography.Text type="secondary" className="brand-caption">{pageTitle(page)}</Typography.Text></div>
      <Button className="header-new" type="text" icon={<FileSearchOutlined />} onClick={() => navigate('business')}>返回文析</Button></Layout.Header>}
      {compact && (page === 'business' || page === 'profiles') && <Button className="mobile-navigation-trigger" type="text" icon={<MenuUnfoldOutlined />} aria-label="打开功能导航" onClick={() => setNavigationOpen(true)} />}
      <Layout.Content className="main-content shell-content"><div className={`extraction-page ${!showLanding ? 'has-workspace' : ''}`} hidden={page !== 'business'}>
        {showLanding ? <div className="landing"><div className="landing-identity"><BrandMark className="landing-brand" /><BrandName className="landing-brand-name" /></div><h1 className="landing-title">Extract Anything</h1>
          <Composer task={task} focusToken={sampleFocusToken} onSend={() => setWorkspaceDismissed(false)} />
          <section className="landing-entries" aria-label="快捷入口">
            <div className="landing-entries-heading"><span>快捷入口</span>
              {task.hasWorkspace && <Button type="text" size="small" icon={<FileSearchOutlined />} onClick={() => setWorkspaceDismissed(false)}>查看提取结果</Button>}</div>
            <div className="landing-entry-list"><button type="button" className="landing-entry" aria-label="试用示例"
              disabled={task.busy} onClick={() => setPanel('examples')}>
              <span className="landing-entry-icon" aria-hidden><FileTextOutlined /></span>
              <span className="landing-entry-copy"><span className="landing-entry-label">试用示例</span><span className="landing-entry-description">查看样例材料，体验提取与原文核验</span></span>
              <ArrowRightOutlined className="landing-entry-arrow" aria-hidden />
            </button>
              {placeholderEntries.map(entry => <button key={entry.title} type="button" className="landing-entry is-placeholder"
                aria-label={`${entry.title}（占位，暂未开放）`} disabled>
                <span className="landing-entry-icon" aria-hidden>{entry.icon}</span>
                <span className="landing-entry-copy"><span className="landing-entry-label">{entry.title}</span><span className="landing-entry-description">{entry.description}</span></span>
                <span className="landing-entry-status" aria-hidden>占位</span>
              </button>)}
              {task.serviceInfo?.reviewAvailable ? <button type="button" className="landing-entry" onClick={() => setPanel('comparison')} aria-label="复测对照">
                <span className="landing-entry-icon" aria-hidden><FileSearchOutlined /></span>
                <span className="landing-entry-copy"><span className="landing-entry-label">复测对照</span><span className="landing-entry-description">查看本轮合同、发票的实际结果与原文</span></span>
                <ArrowRightOutlined className="landing-entry-arrow" aria-hidden />
              </button> : <button type="button" className="landing-entry" onClick={() => navigate('history')} aria-label="历史记录">
                <span className="landing-entry-icon" aria-hidden><HistoryOutlined /></span><span className="landing-entry-copy"><span className="landing-entry-label">历史记录</span><span className="landing-entry-description">重新打开解析结果，继续核验与导出</span></span><ArrowRightOutlined className="landing-entry-arrow" aria-hidden />
              </button>}
            </div>
          </section>
        </div> : !task.hasWorkspace ? <div className="conversation-only">{conversation}</div> : compact ? workspace : <Splitter className="main-splitter"><Splitter.Panel defaultSize={screens.xl ? 300 : 230} min={210} max="38%">{conversation}</Splitter.Panel><Splitter.Panel min={360}>{workspace}</Splitter.Panel></Splitter>}
      </div><PlatformWorkspace page={page} task={task} onNavigate={navigate}
        onResume={async (id, recordId) => {
          if (recordId) { if (!await task.openHistory(recordId, id)) return; }
          else task.selectFile(id);
          setWorkspaceDismissed(false); navigate('business');
        }} onComparison={() => setPanel('comparison')} /><ProfilesWorkspace visible={page === 'profiles'} seed={profileSeed} entryKey={studioEntry} onNavigate={navigate} /></Layout.Content>
    </Layout>

    <Drawer title="功能导航" open={compact && navigationOpen} onClose={() => setNavigationOpen(false)} placement="left" size={256} className="navigation-drawer"><Navigation {...navigationProps} collapsed={false} /></Drawer>
    <Drawer title="提取对话" open={compact && page === 'business' && conversationOpen} onClose={() => setConversationOpen(false)} placement="left" size={Math.min(390, window.innerWidth)} className="conversation-drawer" destroyOnHidden>{conversation}</Drawer>
    <Drawer title="真实样本复测对照 · 2026-10-30" open={panel === 'comparison'} onClose={() => setPanel(null)} placement="right" size="100%" className="comparison-drawer" destroyOnHidden
      extra={<Typography.Text type="secondary">已保存的复测记录</Typography.Text>}>
      {task.serviceInfo?.reviewAvailable ? <iframe title="合同与发票复测对照" src="/api/reviews/optimization-20261030" sandbox="allow-scripts" className="comparison-frame" />
        : <Typography.Paragraph>{task.serviceInfo ? '本机暂无这轮复测记录。' : '正在读取复测记录…'}</Typography.Paragraph>}
    </Drawer>

    <Modal title="试用示例" open={panel === 'examples'} onCancel={() => setPanel(null)} footer={null} width={550}>
      <Typography.Paragraph type="secondary">选择样例，带入虚构材料和提取要求，再发送体验。</Typography.Paragraph><div className="modal-examples">{exampleCards}</div>
      {task.serviceInfo?.reviewAvailable && <Button type="link" icon={<FileSearchOutlined />} onClick={() => setPanel('comparison')}>查看真实合同、发票复测对照</Button>}</Modal>
    <Drawer open={panel === 'help'} onClose={() => setPanel(null)} placement="right" size="100%" closable={false} destroyOnHidden className="help-center-drawer">
      <HelpCenter onClose={() => setPanel(null)} />
    </Drawer>

    <Drawer title="修改提取值" className="platform-drawer" placement="right" size={640} styles={{ wrapper: { maxWidth: '100vw' } }} closable={{ placement: 'end' }}
      open={!!editing} onClose={() => setEditing(null)} forceRender
      footer={<Space><Button onClick={() => setEditing(null)}>取消</Button><Button type="primary" onClick={() => editForm.submit()}>保存核定值</Button></Space>}>
      <Typography.Paragraph strong>{editing?.name}</Typography.Paragraph>
      <Descriptions size="small" column={1} items={[{ key: 'raw', label: '机器原始值', children: <span className="raw-value">{editing?.raw || '未找到'}</span> },
        { key: 'page', label: '原文依据', children: editing?.ref ? (task.activeFile?.kind === 'text' ? '对应文字行' : `第 ${editing.page} 页`) : '暂无依据，手动补充后保留此状态' }]} />
      <Form form={editForm} name="field-review" layout="vertical" onFinish={saveEdit} preserve={false} scrollToFirstError><Form.Item name="value" label="核定值" rules={[{ required: true, whitespace: true, message: '请输入核定值' }]}><Input.TextArea rows={3} aria-label="核定值" /></Form.Item></Form>
      <Typography.Text type="secondary">修改只更新核定值，保留机器原始值及原文依据。</Typography.Text></Drawer>

    <Modal title="导出提取结果" open={panel === 'export'} onCancel={() => setPanel(null)} okText="下载结果" cancelText="取消" onOk={download}>
      <Typography.Paragraph type="secondary">{task.files.filter(file => file.results?.length).length} 份材料 · {exportedFields.length} 个字段</Typography.Paragraph>
      {!!unreviewed && <Alert showIcon type="warning" title={`${unreviewed} 项尚未核验，导出时会保留状态`} />}
      <Radio.Group className="export-options" value={exportFormat} onChange={event => setExportFormat(event.target.value)}><Radio value="csv"><strong>Excel 可打开的 CSV</strong><span>按字段汇总，包含字段值、原始值、来源和核验状态</span></Radio><Radio value="json"><strong>JSON 结构化结果</strong><span>保留明细单元格、多段条款及各自的原文依据</span></Radio></Radio.Group>
    </Modal>
    {dragging && <div className="drop-overlay"><PaperClipOutlined /><h2>将附件拖到这里</h2><p>PDF / 图片 / Excel / Word / TXT / ZIP · 最多 6 份，字段表限 8 MB，其他每份 30 MB</p></div>}
  </Layout>;
}
