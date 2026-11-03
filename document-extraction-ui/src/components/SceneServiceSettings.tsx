import { useState, type ReactNode } from 'react';
import { Button, Drawer, Input, Popover, Select, Space, Switch, Tag } from 'antd';
import { QuestionCircleOutlined } from '@ant-design/icons';
import type { SceneBinding } from '../studio.ts';
import type { ProfileSummary } from '../profiles.ts';

export function ContextHelp({ label, children }: { label: string; children: ReactNode }) {
  return <Popover trigger="click" placement="bottomLeft" content={<div className="studio-context-help-content">{children}</div>}>
    <Button type="text" size="small" className="studio-context-help" aria-label={label} icon={<QuestionCircleOutlined />} />
  </Popover>;
}

export function SceneServiceSettings({ binding, parser, busy, onClose, onApply, onConfigure }: {
  binding: SceneBinding; parser?: ProfileSummary; busy: boolean;
  onClose: () => void; onApply: (binding: SceneBinding) => void; onConfigure: () => void;
}) {
  const [value, setValue] = useState(binding);
  return <Drawer title="服务引用设置" className="scene-service-settings" placement="right" open size={460} styles={{ wrapper: { maxWidth: '100vw' } }} onClose={onClose}
    footer={<Space><Button disabled={busy} onClick={onClose}>取消</Button><Button type="primary" disabled={busy || !value.name.trim()} onClick={() => onApply({ ...value, name: value.name.trim() })}>应用</Button></Space>}>
    <div className="scene-reference-settings">
      <div className="scene-reference-identity"><strong>{parser?.name || binding.name}</strong><small>当前场景引用的文档解析服务</small></div>
      <label><span>场景内名称 <ContextHelp label="场景内名称说明">用于区分这项服务在当前场景里的用途。例如，同一合同服务分别用于“采购合同”和“补充协议”。默认沿用服务名称，不改变服务本身。</ContextHelp></span><Input aria-label="场景内服务名称" maxLength={100} disabled={busy} value={value.name} onChange={event => setValue({ ...value, name: event.target.value })} /></label>
      <label><span>调用版本 <ContextHelp label="调用版本说明">调用版本是服务发布时保存的配置快照。场景固定使用选中的版本；服务后来发布新版本，此处不会自动切换。</ContextHelp></span>
        {parser?.versions.length || value.version ? <Select aria-label="服务调用版本" value={value.version || undefined} placeholder="选择已发布版本" disabled={busy} onChange={version => setValue({ ...value, version })} options={[...new Set([...(parser?.versions || []), ...(value.version ? [value.version] : [])])].map(version => ({ value: version, label: `v${version}` }))} />
          : <div className="scene-reference-unpublished"><Tag>尚未发布</Tag><Button type="link" disabled={busy} onClick={onConfigure}>前往配置并发布</Button></div>}
      </label>
      <div className="scene-reference-switch"><div><strong>必须上传此类材料</strong><small>缺少这类材料时，场景联调不能通过。</small></div><Switch aria-label="必须上传此类材料" disabled={busy} checked={value.required} onChange={required => setValue({ ...value, required })} /></div>
      <div className="scene-reference-switch"><div><strong>允许同类材料有多份</strong><small>例如，一次业务可以上传多张发票。</small></div><Switch aria-label="允许同类材料有多份" disabled={busy} checked={value.multiple} onChange={multiple => setValue({ ...value, multiple })} /></div>
    </div>
  </Drawer>;
}
