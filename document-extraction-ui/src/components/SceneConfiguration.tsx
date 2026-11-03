import { Button, Drawer, Input, Select, Space, Switch, Tabs, Tag, Tooltip } from 'antd';
import { CodeOutlined, DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { defaultPreprocessing, profileId, type ProfileDraft } from '../profiles.ts';

export function SceneConfiguration({ open, draft, busy, error, onChange, onClose, onApply }: {
  open: boolean; draft: ProfileDraft; busy: boolean; error?: string;
  onChange: (draft: ProfileDraft) => void; onClose: () => void; onApply: () => void;
}) {
  const types = draft.materialTypes || [];
  const policy = draft.preprocessing || defaultPreprocessing;
  const setTypes = (next: typeof types) => onChange({ ...draft, materialTypes: next, output: draft.output || { mode: 'by_type' } });
  const shape = Object.fromEntries(types.map(kind => [kind.outputKey, [Object.fromEntries(draft.templates.filter(template => template.materialTypeId === kind.id).flatMap(template => template.fields.map(field => [field.key, field.kind === 'amount' ? '金额' : field.name])))]]));
  return <Drawer title="场景配置" placement="right" size={720} open={open} closable={{ placement: 'end' }} onClose={onClose} className="platform-drawer scene-configuration" footer={<Space><Button disabled={busy} onClick={onClose}>返回工作台</Button><Button type="primary" loading={busy} onClick={onApply}>确认分组并保存</Button></Space>}>
    <Tabs defaultActiveKey="types" tabBarExtraContent={<Tooltip title="扩展逻辑暂未开放，当前通过规则配置完成提取。"><span><Button size="small" icon={<CodeOutlined />} disabled aria-label="扩展逻辑，暂未开放">扩展逻辑</Button></span></Tooltip>} items={[
      { key: 'types', label: '材料与路由', children: <>
        <div className="scene-section-heading"><strong>材料类型</strong><Button icon={<PlusOutlined />} disabled={busy || types.length >= 20} onClick={() => { let index = types.length + 1; while (types.some(kind => kind.outputKey === `material_${index}`)) index++; setTypes([...types, { id: profileId(), name: `材料类型 ${index}`, outputKey: `material_${index}`, grouping: 'document', required: false }]); }}>添加类型</Button></div>
        {!types.length && <p className="scene-config-hint">可以先上传整包样例，再确认材料类型；也可以自行添加。</p>}
        <div className="scene-type-configs">{types.map(kind => <section key={kind.id}>
          <div className="scene-type-heading"><Input aria-label={`${kind.name}的类型名称`} value={kind.name} maxLength={60} disabled={busy} onChange={event => setTypes(types.map(item => item.id === kind.id ? { ...item, name: event.target.value } : item))} /><Button type="text" icon={<DeleteOutlined />} aria-label={`移除材料类型 ${kind.name}`} disabled={busy} onClick={() => onChange({ ...draft, materialTypes: types.filter(item => item.id !== kind.id), templates: draft.templates.map(item => item.materialTypeId === kind.id ? { ...item, materialTypeId: '', classification: 'suggested' } : item) })} /></div>
          <div className="scene-config-grid"><label>接口输出分组<Input value={kind.outputKey} aria-label={`${kind.name}的输出分组`} disabled={busy} onChange={event => setTypes(types.map(item => item.id === kind.id ? { ...item, outputKey: event.target.value } : item))} /></label>
            <label>文档组织<Select value={kind.grouping} aria-label={`${kind.name}的文档组织`} disabled={busy} onChange={grouping => onChange({ ...draft, materialTypes: types.map(item => item.id === kind.id ? { ...item, grouping } : item), templates: draft.templates.map(item => item.materialTypeId === kind.id ? { ...item, referencePage: grouping === 'per_page' ? item.referencePage || 1 : grouping === 'document' ? null : item.referencePage } : item) })} options={[{ value: 'document', label: '整份文档 · 如多页合同' }, { value: 'per_page', label: '每页一份 · 如独立发票' }, { value: 'auto', label: '自动识别独立发票' }]} /></label></div>
          <div className="profile-inline-control"><span>材料包必须包含此类有效材料</span><Switch size="small" aria-label={`${kind.name}是否必需`} checked={kind.required} disabled={busy} onChange={required => setTypes(types.map(item => item.id === kind.id ? { ...item, required } : item))} /></div>
        </section>)}</div>
        <div className="scene-section-heading"><strong>版式归属</strong><small>{draft.templates.length} 个版式</small></div>
        <p className="scene-config-hint">建议分组需人工确认。运行时根据已配置的版式特征匹配；无法唯一匹配的材料进入待处理。</p>
        <div className="scene-template-assignment">{draft.templates.map(template => <div key={template.id}><span><strong>{template.name}</strong><small>{template.classification === 'suggested' ? '分组建议 · 待确认' : `${template.fields.length} 个字段`}</small></span><Select aria-label={`${template.name}的材料类型`} placeholder="选择材料类型" value={template.materialTypeId || undefined} disabled={busy} onChange={id => { const kind = types.find(item => item.id === id)!; onChange({ ...draft, templates: draft.templates.map(item => item.id === template.id ? { ...item, materialTypeId: id, classification: 'confirmed', referencePage: kind.grouping === 'per_page' ? item.referencePage || 1 : kind.grouping === 'document' ? null : item.referencePage } : item) }); }} options={types.map(kind => ({ value: kind.id, label: kind.name }))} /></div>)}</div>
      </> },
      { key: 'processing', label: '公共处理策略', children: <div className="scene-policy-config">
        <Tag color="blue">按输入检测 · 固定规则执行</Tag>
        <label>页面方向<Select aria-label="场景页面方向" value={policy.orientation} disabled={busy} onChange={orientation => onChange({ ...draft, preprocessing: { ...policy, orientation } })} options={[{ value: 'auto', label: '自动检测，需要时转正' }, { value: 'off', label: '保持上传方向' }, { value: '90', label: '固定逆时针 90°' }, { value: '180', label: '固定 180°' }, { value: '270', label: '固定顺时针 90°' }]} /></label>
        <label>倾斜校正<Select aria-label="场景倾斜校正" value={policy.deskew} disabled={busy} onChange={deskew => onChange({ ...draft, preprocessing: { ...policy, deskew } })} options={[{ value: 'auto', label: '检测到小角度倾斜时校正' }, { value: 'off', label: '关闭' }]} /></label>
        <p className="scene-config-hint">优先读取可用 PDF 文字层，扫描件执行 OCR。材料类型决定整份处理或逐页处理，版式决定字段取值规则。方向或倾斜策略改变后，需重新处理基准样例并测试。</p>
      </div> },
      { key: 'output', label: '接口输出', children: <div className="scene-policy-config"><label>结果组织<Select aria-label="场景结果组织" value={draft.output?.mode || 'by_type'} disabled={busy} onChange={mode => onChange({ ...draft, output: { mode } })} options={[{ value: 'by_type', label: '按材料类型分组' }, { value: 'records', label: '按材料记录平铺' }]} /></label>
        <p className="scene-config-hint">多份同类材料保留为数组，不覆盖同名字段。来源文件、页码、原文位置和未匹配材料随结果返回。</p>
        <pre className="scene-output-shape">{JSON.stringify(draft.output?.mode === 'records' ? [{ sourceName: '材料.pdf', materialTypeName: '材料类型', data: {} }] : shape, null, 2)}</pre>
      </div> },
    ]} />
    {error && <p className="scene-config-error" role="alert">{error}</p>}
  </Drawer>;
}
