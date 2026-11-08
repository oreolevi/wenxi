import { useState } from 'react';
import { App, Avatar, Button, Descriptions, Dropdown, Modal, Segmented, Space, Switch, Typography } from 'antd';
import { CheckOutlined, DownOutlined, InfoCircleOutlined, LoginOutlined, LogoutOutlined, SettingOutlined, UserOutlined } from '@ant-design/icons';
import type { MenuProps } from 'antd';
import { ThemeSwitcher } from './ThemeSwitcher.tsx';
import { accountAvatar, accountAvatarLabels, accountAvatarOptions, accountAvatarPresentation, saveAccountAvatar } from '../pixelAvatars.ts';
import { DEMO_ACCOUNT_NAME } from '../account.ts';
import { DEMO_MODE } from '../demoMode.ts';

const userId = DEMO_MODE ? 'public-demo-user' : 'demo-xiaoguo';
const department = DEMO_MODE ? '演示团队' : '智能应用二部';
const displayName = DEMO_ACCOUNT_NAME;
// Keep the default avatar stable when only the account's display name changes.
const avatarSeed = DEMO_MODE ? '演示用户' : '小郭';
const avatarOptions = accountAvatarOptions(avatarSeed);
const avatarLabels = accountAvatarLabels(avatarSeed);

type Props = { collapsed: boolean; onHelp: () => void; sidebarCollapsed: boolean; onSidebarChange: (value: boolean) => void };

export function AccountMenu({ collapsed, onHelp, sidebarCollapsed, onSidebarChange }: Props) {
  const { message } = App.useApp();
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState<'settings' | 'account' | 'login' | null>(null);
  const [signedIn, setSignedIn] = useState(true);
  const [section, setSection] = useState('general');
  const [avatar, setAvatar] = useState(() => accountAvatar(userId, avatarSeed));
  const [pickingAvatar, setPickingAvatar] = useState(false);
  const [selectedAvatar, setSelectedAvatar] = useState(0);

  function closePanel() { setPanel(null); setPickingAvatar(false); }
  function startAvatarSelection() {
    setSelectedAvatar(Math.max(0, avatarOptions.indexOf(avatar)));
    setPickingAvatar(true);
  }
  function saveAvatarSelection() {
    try {
      setAvatar(saveAccountAvatar(userId, selectedAvatar, avatarSeed));
      setPickingAvatar(false);
      message.success('头像已更新');
    } catch {
      message.error('头像未保存，请检查浏览器存储设置后重试');
    }
  }

  const profile = <>
    <div className="account-profile">
      <span className="account-profile-avatar" role="img" aria-label={`${displayName} 的头像`} title={displayName}><Avatar className="account-avatar" size={48} src={pickingAvatar ? avatarOptions[selectedAvatar] : avatar} style={accountAvatarPresentation(pickingAvatar ? avatarOptions[selectedAvatar] : avatar)} aria-hidden="true" alt="" /></span>
      <div><strong>{displayName}</strong><Typography.Text type="secondary">{department}</Typography.Text></div>
      {!pickingAvatar && <Button type="link" onClick={startAvatarSelection}>更换头像</Button>}
    </div>
    {pickingAvatar && <section className="avatar-picker" aria-label="选择头像">
      <div className="avatar-picker-heading"><h3>选择头像</h3><Button type="link" size="small" onClick={() => setSelectedAvatar(0)} disabled={selectedAvatar === 0}>恢复默认</Button></div>
      <div className="avatar-picker-grid">
        {avatarOptions.map((src, index) => <button key={index} type="button" className="avatar-option"
          aria-label={avatarLabels[index]} title={avatarLabels[index]} aria-pressed={selectedAvatar === index} onClick={() => setSelectedAvatar(index)}>
          <Avatar className="account-avatar" size={44} src={src} style={accountAvatarPresentation(src)} aria-hidden="true" alt="" />
          {selectedAvatar === index && <CheckOutlined className="avatar-option-check" />}
        </button>)}
      </div>
      <div className="avatar-picker-actions"><Button onClick={() => setPickingAvatar(false)}>取消</Button><Button type="primary" onClick={saveAvatarSelection}>保存头像</Button></div>
    </section>}
  </>;

  const accountInfo = <Descriptions column={1} size="small" items={[
    { key: 'name', label: '当前用户', children: displayName },
    { key: 'org', label: '所属部门', children: department },
    { key: 'role', label: '工作身份', children: '场景维护人' },
    { key: 'status', label: '账户状态', children: '演示账户' },
  ]} />;
  const items: MenuProps['items'] = [
    { key: 'identity', disabled: true, label: <div className="account-menu-identity"><strong>{displayName}</strong><span>{department} · 演示账户</span></div> },
    { type: 'divider' },
    { key: 'settings', icon: <SettingOutlined />, label: '设置' },
    { key: 'account', icon: <UserOutlined />, label: '账户信息' },
    { type: 'divider' },
    { key: 'help', icon: <InfoCircleOutlined />, label: '帮助中心' },
    { key: 'logout', icon: <LogoutOutlined />, label: '退出演示账户' },
  ];
  function select(key: string) {
    setOpen(false);
    setPickingAvatar(false);
    if (key === 'settings' || key === 'account') { setSection('general'); setPanel(key); }
    else if (key === 'help') onHelp();
    else if (key === 'logout') setSignedIn(false);
  }
  const trigger = <Button type="text" className={`account-trigger ${collapsed ? 'is-collapsed' : ''}`} aria-label={signedIn ? '账户与设置' : '登录'}
    aria-expanded={signedIn ? open : undefined} onClick={!signedIn ? () => setPanel('login') : undefined}>
    <Avatar className="account-avatar" size={32} src={signedIn ? avatar : undefined} style={accountAvatarPresentation(signedIn ? avatar : undefined)} icon={!signedIn ? <UserOutlined /> : undefined} aria-hidden="true" alt="" />
    {!collapsed && <><span className="account-trigger-copy"><strong>{signedIn ? displayName : '登录账户'}</strong><span>{signedIn ? department : '进入个人工作空间'}</span></span><DownOutlined className="account-chevron" /></>}
  </Button>;
  return <>
    {signedIn ? <Dropdown open={open} onOpenChange={setOpen} trigger={['click']} placement="topLeft" menu={{ items, onClick: ({ key }) => select(key) }} classNames={{ root: 'account-dropdown' }}>{trigger}</Dropdown> : trigger}
    <Modal title="设置" open={panel === 'settings'} onCancel={closePanel} footer={null} width={620} className="settings-modal">
      <div className="settings-layout"><Segmented vertical value={section} onChange={value => { setSection(value); setPickingAvatar(false); }} options={[{ value: 'general', label: <><SettingOutlined /> 通用</> }, { value: 'account', label: <><UserOutlined /> 账户</> }]} />
        <div className="settings-content">{section === 'account' ? <><h3>账户信息</h3>{profile}{accountInfo}</> : <><div className="settings-heading"><h3>通用设置</h3><ThemeSwitcher /></div><div className="setting-row"><div><strong>收起侧边栏</strong><span>仅显示图标，给文档留出更多空间</span></div><Switch aria-label="收起侧边栏" checked={sidebarCollapsed} onChange={onSidebarChange} /></div></>}</div>
      </div>
    </Modal>
    <Modal title="账户信息" open={panel === 'account'} onCancel={closePanel} footer={pickingAvatar ? null : <Button onClick={closePanel}>关闭</Button>}>
      {profile}{accountInfo}
    </Modal>
    <Modal title="登录" open={panel === 'login'} onCancel={() => setPanel(null)} footer={<Space><Button onClick={() => setPanel(null)}>取消</Button><Button type="primary" icon={<LoginOutlined />} onClick={() => { setSignedIn(true); setPanel(null); }}>使用演示账户</Button></Space>}>
      <Typography.Paragraph>当前可使用“{displayName} · {department}”演示账户体验界面。</Typography.Paragraph><Typography.Paragraph type="secondary">正式登录需要接入行内统一认证。本原型不收集账号和密码。</Typography.Paragraph>
    </Modal>
  </>;
}
