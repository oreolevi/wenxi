import { useEffect, useState } from 'react';
import { Alert, Button, Drawer, Empty, Form, Input, InputNumber, Select, Space, Table, Tag, Tooltip } from 'antd';
import { ApiOutlined, PlusOutlined, SearchOutlined, InfoCircleOutlined } from '@ant-design/icons';
import { readDrafts, writeDrafts, type ApplicationDraft } from '../platformDrafts.ts';
import { sceneApi } from '../studio.ts';
const STORAGE = 'wenxi-application-drafts-v1';
interface Target { value: string; label: string }

export function ApplicationsWorkspace() {
  const [applications, setApplications] = useState(() => readDrafts<ApplicationDraft>(STORAGE, []));
  const [targets, setTargets] = useState<Target[]>([]);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<ApplicationDraft | 'new'>();
  const [error, setError] = useState('');
  const [catalogError, setCatalogError] = useState('');
  const [form] = Form.useForm<ApplicationDraft>();
  useEffect(() => {
    let active = true;
    sceneApi.catalog().then(catalog => { if (active) setTargets([
      ...catalog.parsers.filter(item => item.versions.length).map(item => ({ value: `service:${item.id}`, label: `${item.name} · 服务` })),
      ...catalog.scenes.filter(item => item.versions.length).map(item => ({ value: `scene:${item.id}`, label: `${item.name} · 场景` })),
    ]); }).catch(() => { if (active) setCatalogError('已发布服务暂时无法读取，请稍后重新打开。'); });
    return () => { active = false; };
  }, []);
  function open(value: ApplicationDraft | 'new') {
    setError(''); setEditing(value); form.resetFields();
    form.setFieldsValue(value === 'new' ? { name: '', purpose: '', targets: [], dailyLimit: null } : value);
  }
  function save(values: ApplicationDraft) {
    const next = { ...values, targets: values.targets || [], dailyLimit: values.dailyLimit || null,
      id: editing && editing !== 'new' ? editing.id : `app-${crypto.randomUUID()}`, updatedAt: new Date().toISOString() };
    const all = applications.some(item => item.id === next.id) ? applications.map(item => item.id === next.id ? next : item) : [...applications, next];
    try { writeDrafts(STORAGE, all); setApplications(all); setEditing(undefined); setError(''); }
    catch (failure) { setError((failure as Error).message); }
  }
  const targetName = (key: string) => targets.find(item => item.value === key)?.label || key.replace(/^(service|scene):/, '');
  return <>
    <div className="platform-intro"><h1 tabIndex={-1} data-page-heading>应用接入</h1><Button type="primary" icon={<PlusOutlined />} onClick={() => open('new')}>登记应用</Button></div>
    <div className="platform-toolbar"><Input prefix={<SearchOutlined />} value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索应用名称或用途" allowClear /><Tooltip title="此处保存接入申请草稿。当前本机服务尚未接入统一鉴权，草稿不会授予或限制实际访问权限。"><span className="platform-scope-help" tabIndex={0}><InfoCircleOutlined /> 接入范围</span></Tooltip></div>
    <div className="application-flow" aria-label="应用接入流程"><span className="is-current">登记应用</span><i>→</i><span>申请调用范围</span><i>→</i><span>审核与凭证开通</span><Tag>待接入网关</Tag></div>
    <Table<ApplicationDraft> className="platform-data-table" rowKey="id" dataSource={applications.filter(item => `${item.name}${item.purpose}`.includes(query))} pagination={{ pageSize: 10, hideOnSinglePage: true }} scroll={{ x: 660 }} locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="登记调用方应用，整理需要接入的服务"><Button onClick={() => open('new')}>登记第一个应用</Button></Empty> }} columns={[
      { title: '调用方应用', key: 'name', render: (_, item) => <div className="table-name"><strong>{item.name}</strong><small>{item.purpose}</small></div> },
      { title: '申请调用范围', key: 'targets', render: (_, item) => item.targets.length ? <Tooltip title={item.targets.map(targetName).join('、')}><span>{item.targets.length} 项服务 / 场景</span></Tooltip> : '尚未选择' },
      { title: '日调用限额', key: 'limit', render: (_, item) => item.dailyLimit ? `${item.dailyLimit.toLocaleString()} 次（拟申请）` : '未设置' },
      { title: '接入状态', key: 'state', render: () => <Tag>待开通</Tag> },
      { title: '', key: 'edit', width: 90, render: (_, item) => <Button type="link" size="small" onClick={() => open(item)}>接入详情</Button> },
    ]} />
    <p className="platform-caption">接入草稿保存在当前浏览器。正式授权、凭证签发及限额执行尚未接入；接口地址和调用示例在 Studio 的“接口与版本”中查看。</p>
    <Drawer title={editing === 'new' ? '登记应用' : '应用接入详情'} placement="right" size={580} styles={{ wrapper: { maxWidth: '100vw' } }} open={!!editing} onClose={() => setEditing(undefined)} footer={<Space><Button onClick={() => setEditing(undefined)}>取消</Button><Button type="primary" onClick={() => form.submit()}>保存接入草稿</Button></Space>}>
      {error && <Alert type="error" showIcon title={error} />}
      <Form layout="vertical" form={form} onFinish={save} scrollToFirstError>
        <Form.Item name="name" label="应用名称" rules={[{ required: true, whitespace: true, message: '请输入调用方应用名称' }]}><Input placeholder="例如：企业付款审核系统" maxLength={60} /></Form.Item>
        <Form.Item name="purpose" label="接入用途" rules={[{ required: true, whitespace: true, message: '请填写接入用途' }]}><Input.TextArea placeholder="例如：付款申请时提取合同与发票要素" rows={2} maxLength={300} /></Form.Item>
        <Form.Item name="targets" label="申请调用的服务 / 场景"><Select mode="multiple" options={targets} optionFilterProp="label" placeholder="选择 Studio 中已发布的服务或场景" notFoundContent={catalogError || '暂无可选项，请先在 Studio 中发布服务'} /></Form.Item>
        <Form.Item name="dailyLimit" label="拟申请日调用限额"><InputNumber min={1} max={10000000} precision={0} placeholder="可选" style={{ width: '100%' }} /></Form.Item>
      </Form>
      <section className="application-credential"><ApiOutlined /><div><h3>接入凭证</h3><p>尚未签发。接入网关后，由管理员审核调用范围并开通。</p></div><Tag>未开通</Tag></section>
      <Button disabled block>提交接入申请（待接入）</Button>
    </Drawer>
  </>;
}
