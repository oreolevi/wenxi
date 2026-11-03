import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Alert, Button, Card, Descriptions, Drawer, Empty, Form, Input, Segmented, Select, Space, Tabs, Tag, Tooltip, Typography } from 'antd';
import { ArrowRightOutlined, CopyOutlined, DownloadOutlined, InfoCircleOutlined, MinusCircleOutlined, PlusOutlined, SearchOutlined } from '@ant-design/icons';
import { capabilityComponents, initialSkills, type SkillDraft } from '../prototypeModel.ts';
import type { ExtractionTask } from '../useExtractionTask.ts';
import { PersonalHistory } from './PersonalHistory.tsx';
import { OperationsDashboard } from './OperationsDashboard.tsx';
import { ApplicationsWorkspace } from './ApplicationsWorkspace.tsx';
import { readDrafts, writeDrafts, skillMarkdown } from '../platformDrafts.ts';
import { ProductIcon } from './ProductIcon.tsx';

interface Props { page: string; task: ExtractionTask; onNavigate: (page: string) => void; onResume: (id: string, recordId?: string) => void; onComparison: () => void }
type WorkspacePanel = { kind: 'skill' | 'skill-edit' | 'component'; id: string };
function PageIntro({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="platform-intro"><h1 tabIndex={-1} data-page-heading>{title}</h1>{children && <Space wrap>{children}</Space>}</div>;
}

export function PlatformWorkspace({ page, task, onNavigate, onResume }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const drawerContent = useRef<HTMLDivElement>(null);
  const [skills, setSkills] = useState<SkillDraft[]>(() => readDrafts('wenxi-skill-drafts-v1', JSON.parse(JSON.stringify(initialSkills))));
  const [draftError, setDraftError] = useState('');
  const [copyNotice, setCopyNotice] = useState('');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('全部');
  const [panel, setPanel] = useState<WorkspacePanel | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [skillForm] = Form.useForm<SkillDraft>();
  const [componentFilter, setComponentFilter] = useState('全部');
  const skill = panel?.kind === 'skill' ? skills.find(item => item.id === panel.id) : undefined;
  const component = panel?.kind === 'component' ? capabilityComponents.find(item => item.id === panel.id) : undefined;
  useEffect(() => {
    if (page === 'history') void task.reloadHistory();
    if (page === 'business') {
      setDrawerOpen(false);
      return;
    }
    root.current?.scrollTo({ top: 0 });
    root.current?.querySelector<HTMLElement>('[data-page-heading]')?.focus({ preventScroll: true });
  }, [page]);
  useEffect(() => {
    drawerContent.current?.parentElement?.scrollTo({ top: 0 });
    if (panel?.kind === 'skill-edit') {
      skillForm.resetFields();
      skillForm.setFieldsValue(skills.find(item => item.id === panel.id) || { name: '', category: '合同', description: '', rules: [{ field: '', meaning: '' }] });
    }
  }, [panel, skillForm, skills]);

  function openPanel(next: WorkspacePanel) { setDraftError(''); setCopyNotice(''); setPanel(next); setDrawerOpen(true); }
  function closePanel() { setDrawerOpen(false); }
  function editSkill(id?: string) {
    openPanel({ kind: 'skill-edit', id: id || 'new' });
  }
  function saveSkill(value: SkillDraft) {
    const previous = panel?.kind === 'skill-edit' ? skills.find(item => item.id === panel.id) : undefined;
    const next: SkillDraft = { ...value, id: previous?.id || `draft-${Date.now()}`, version: previous?.version || 'v0.1', components: previous?.components || ['semantic', 'grounding'] };
    const all = previous ? skills.map(item => item.id === previous.id ? next : item) : [...skills, next];
    try { writeDrafts('wenxi-skill-drafts-v1', all); setSkills(all); openPanel({ kind: 'skill', id: next.id }); }
    catch (error) { setDraftError((error as Error).message); }
  }
  function exportSkill(item: SkillDraft) {
    const url = URL.createObjectURL(new Blob([skillMarkdown(item)], { type: 'text/markdown;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `${item.name.replace(/[\\/:*?"<>|]/g, '-')}.md`; link.click(); URL.revokeObjectURL(url);
  }
  async function copySkill(item: SkillDraft) {
    try { await navigator.clipboard.writeText(skillMarkdown(item)); setCopyNotice('已复制语义规则'); }
    catch { setDraftError('复制失败，可下载规则文件。'); }
  }

  const skillPage = <>
    <PageIntro title="Skill 库"><Tooltip title="沉淀合同条款、票面角色等业务语义，供 AI 理解与提取时复用。Studio 服务另行管理版式、字段定位和接口。"><InfoCircleOutlined tabIndex={0} aria-label="Skill 说明" /></Tooltip><Button type="primary" icon={<PlusOutlined />} onClick={() => editSkill()}>新建 Skill</Button></PageIntro>
    <div className="platform-toolbar"><Input aria-label="搜索 Skill" placeholder="搜索名称、材料类型或说明" prefix={<SearchOutlined />} value={query} onChange={event => setQuery(event.target.value)} allowClear />
      <Select aria-label="Skill 材料类型" value={category} onChange={setCategory} options={['全部', '合同', '发票', '申请表', '其他'].map(value => ({ value, label: value === '全部' ? '全部材料' : value }))} /></div>
    <p className="platform-context">业务语义规则 · 当前保存为草稿，尚未参与自动提取</p>
    <div className="capability-grid">{skills.filter(item => (category === '全部' || item.category === category) && `${item.name}${item.category}${item.description}`.includes(query)).map(item => <Card key={item.id} className="capability-card">
      <div className="capability-card-top"><div className="capability-card-heading"><ProductIcon name={item.category === '合同' ? 'skill-contract' : item.category === '发票' ? 'skill-invoice' : 'skill-application'} framed /><h2 title={item.name}>{item.name}</h2></div><Tag>草稿</Tag></div>
      <p title={item.description}>{item.description}</p><div className="capability-meta"><span>{item.category} · {item.version}</span><span>{item.rules.length} 条规则</span></div>
      <div className="capability-actions"><Button type="text" aria-label={`查看${item.name}详情`} onClick={() => openPanel({ kind: 'skill', id: item.id })}>查看详情 <ArrowRightOutlined /></Button><Button type="text" aria-label={`编辑${item.name}草稿`} onClick={() => editSkill(item.id)}>编辑草稿</Button></div>
    </Card>)}</div>
    {!skills.some(item => (category === '全部' || item.category === category) && `${item.name}${item.category}${item.description}`.includes(query)) && <Empty description="没有匹配的 Skill，可调整搜索条件或新建草稿" />}
  </>;
  const componentPage = <>
    <PageIntro title="能力组件"><Button onClick={() => onNavigate('profiles')}>前往 Studio</Button></PageIntro>
    <p className="platform-context">平台公共处理能力；使用策略在具体服务中配置。</p>
    <div className="platform-toolbar"><Segmented aria-label="组件分类" value={componentFilter} onChange={setComponentFilter} options={['全部', '预处理', '识别', '结构', '理解', '校验', '图像']} /></div>
    <div className="capability-grid">{capabilityComponents.filter(item => componentFilter === '全部' || item.category === componentFilter).map(item => {
      const state = item.id === 'semantic' && !task.serviceInfo?.semantic ? '需配置模型' : item.state;
      const available = state === '已接入';
      return <Card key={item.id} className="capability-card"><div className="capability-card-top"><div className="capability-card-heading"><ProductIcon name={item.id} framed /><h2 title={item.name}>{item.name}</h2></div>
        <Tag color={available ? 'success' : 'default'}>{available ? '可用' : state}</Tag></div>
        <p title={item.description}>{item.description}</p><div className="capability-meta"><span>{item.engine}</span><span>{available ? item.category : state}</span></div>
        <div className="capability-actions"><Button type="text" aria-label={`查看${item.name}详情`} onClick={() => openPanel({ kind: 'component', id: item.id })}>查看详情 <ArrowRightOutlined /></Button></div></Card>;
    })}</div>
  </>;
  const historyPage = <PersonalHistory task={task} onResume={onResume} onNavigate={onNavigate} />;
  const panelTitle = panel?.kind === 'skill' ? skill?.name || 'Skill 详情'
    : panel?.kind === 'skill-edit' ? panel.id === 'new' ? '新建 Skill 草稿' : '编辑 Skill 草稿'
    : component?.name || '组件详情';
  const drawerFooter = panel?.kind === 'skill-edit' ? <Space><Button onClick={closePanel}>取消</Button><Button type="primary" onClick={() => skillForm.submit()}>保存草稿</Button></Space>
    : panel?.kind === 'skill' && skill ? <Space><Button icon={<DownloadOutlined />} onClick={() => exportSkill(skill)}>下载规则</Button><Button type="primary" onClick={() => editSkill(skill.id)}>编辑草稿</Button></Space> : null;

  return <div className="platform-workspace" ref={root} hidden={page === 'business' || page === 'profiles'}>
    <div className="platform-page">{page === 'operations' ? <OperationsDashboard /> : page === 'resources' ? <ApplicationsWorkspace /> : { history: historyPage, skills: skillPage, components: componentPage }[page] || null}</div>
    <Drawer className="platform-drawer" title={panelTitle} placement="right" size={640} styles={{ wrapper: { maxWidth: '100vw' } }} closable={{ placement: 'end' }}
      open={drawerOpen} onClose={closePanel} footer={drawerFooter} forceRender>
      <div ref={drawerContent}>{draftError && <Alert type="error" showIcon title={draftError} />}{copyNotice && <Alert type="success" title={copyNotice} />}
      {skill && <><div className="drawer-intro"><Tag>语义规则草稿</Tag><Tag>{skill.category}</Tag><Typography.Text type="secondary">{skill.version}</Typography.Text><p>{skill.description}</p></div>
        <Tabs items={[{ key: 'rules', label: '字段语义与规则', children: <div className="skill-rules">{skill.rules.map((rule, i) => <article key={i}><h3>{rule.field}</h3><p>{rule.meaning}</p></article>)}</div> },
          { key: 'components', label: '引用组件', children: <div className="linked-components">{skill.components.map(id => { const item = capabilityComponents.find(item => item.id === id); return item ? <Button key={id} icon={<ProductIcon name={item.id} small />} onClick={() => { onNavigate('components'); openPanel({ kind: 'component', id }); }}>{item.name}</Button> : null; })}</div> },

        ]} /><div className="skill-use-note"><span>尚未接入自动选择，可复制规则用于编写提取要求。</span><Button icon={<CopyOutlined />} onClick={() => void copySkill(skill)}>复制规则</Button></div></>}
      {panel?.kind === 'skill-edit' && <><Form form={skillForm} name="skill-draft" layout="vertical" onFinish={saveSkill} preserve={false} scrollToFirstError>
        <div className="platform-form-two"><Form.Item name="name" label="Skill 名称" rules={[{ required: true, whitespace: true, message: '请输入名称' }]}><Input maxLength={40} /></Form.Item><Form.Item name="category" label="材料类型" rules={[{ required: true }]}><Select options={['合同', '发票', '申请表', '其他'].map(value => ({ value, label: value }))} /></Form.Item></div>
        <Form.Item name="description" label="适用范围" rules={[{ required: true, whitespace: true, message: '请说明适用范围' }]}><Input.TextArea rows={2} maxLength={300} /></Form.Item>
        <Form.List name="rules" rules={[{ validator: async (_, values) => { if (!values?.length) throw new Error('至少保留一条字段规则'); } }]}>{(fields, { add, remove }, { errors }) => <><div className="form-section-label">字段语义与提取规则</div>{fields.map((field, index) => <div className="skill-rule-editor" key={field.key}>
          <Form.Item name={[field.name, 'field']} rules={[{ required: true, whitespace: true, message: '请输入字段名' }]}><Input aria-label={`第${index + 1}个字段名`} placeholder="例如：付款条件" maxLength={40} /></Form.Item>
          <Form.Item name={[field.name, 'meaning']} rules={[{ required: true, whitespace: true, message: '请输入提取规则' }]}><Input.TextArea aria-label={`第${index + 1}条语义规则`} placeholder="说明需要在正文中查找什么、如何区分相似内容" autoSize={{ minRows: 2, maxRows: 6 }} maxLength={1000} /></Form.Item>
          <Button type="text" icon={<MinusCircleOutlined />} aria-label={`移除第${index + 1}条规则`} onClick={() => remove(field.name)} />
        </div>)}<Form.ErrorList errors={errors} /><Button type="dashed" icon={<PlusOutlined />} onClick={() => add({ field: '', meaning: '' })}>添加字段规则</Button></>}</Form.List>
      </Form><p className="platform-caption">草稿保存在当前浏览器。</p></>}
      {component && <><Tag>{component.engine}</Tag><p className="drawer-description">{component.description}</p><Descriptions column={1} bordered size="small" items={[{ key: 'input', label: '输入', children: component.input }, { key: 'output', label: '输出', children: component.output }]} />
        <Alert className="component-limit" showIcon type="info" title="使用边界" description={component.limit} /><h3 className="drawer-section-title">关联的语义规则</h3><div className="linked-components">{skills.filter(item => item.components.includes(component.id)).map(item => <Button key={item.id} onClick={() => { onNavigate('skills'); openPanel({ kind: 'skill', id: item.id }); }}>{item.name}</Button>)}</div></>}
      </div>
    </Drawer>
  </div>;
}
