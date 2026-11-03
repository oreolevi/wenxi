import { Button, Menu, Tooltip } from 'antd';
import { MenuFoldOutlined, MenuUnfoldOutlined } from '@ant-design/icons';
import { navigation, navigationGroups, navigationKey } from '../navigation.tsx';
import { AccountMenu } from './AccountMenu.tsx';
import { BrandMark } from './BrandMark.tsx';
import { BrandName } from './BrandName.tsx';

type Props = {
  page: string; collapsed: boolean; sidebarCollapsed: boolean;
  onNavigate: (page: string) => void; onHelp: () => void;
  onSidebarChange: (collapsed: boolean) => void; showCollapse?: boolean;
};

export function Navigation({ page, collapsed, sidebarCollapsed, onNavigate, onHelp, onSidebarChange, showCollapse = false }: Props) {
  return <div className={`navigation-inner ${collapsed ? 'is-collapsed' : ''}`}>
    <div className="navigation-brand"><BrandMark />{!collapsed && <div className="navigation-brand-copy"><BrandName className="navigation-brand-name" /><span className="navigation-tagline">Extract Anything</span></div>}</div>
    <nav aria-label="功能导航" className="navigation-menu"><Menu mode="inline" inlineCollapsed={collapsed} selectedKeys={[navigationKey(page)]} onClick={({ key }) => onNavigate(key)}
      items={navigationGroups.map(group => ({ type: 'group' as const, key: group, label: group, children: navigation.filter(item => item.group === group).map(({ key, label, icon }) => ({ key, label, icon })) }))} /></nav>
    <div className={`navigation-account ${showCollapse ? 'with-toggle' : ''}`}><AccountMenu collapsed={collapsed} sidebarCollapsed={sidebarCollapsed} onSidebarChange={onSidebarChange} onHelp={onHelp} />
      {showCollapse && <Tooltip title={collapsed ? '展开侧边栏' : '收起侧边栏'} placement="right"><Button className="sidebar-collapse-toggle" type="text" icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />} aria-label={collapsed ? '展开侧边栏' : '收起侧边栏'} onClick={() => onSidebarChange(!collapsed)} /></Tooltip>}
    </div>
  </div>;
}
