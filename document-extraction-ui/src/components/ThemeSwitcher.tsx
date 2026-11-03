import { Segmented } from 'antd';
import { MoonOutlined, SunOutlined } from '@ant-design/icons';
import { useColorMode } from '../theme.tsx';

export function ThemeSwitcher() {
  const { mode, setMode } = useColorMode();
  return <Segmented className="theme-switcher" aria-label="界面主题" value={mode} onChange={setMode}
    options={[
      { value: 'light' as const, title: '亮色主题', label: <span className="theme-option"><SunOutlined aria-hidden /><span className="theme-label">亮色</span></span> },
      { value: 'dark' as const, title: '深色主题', label: <span className="theme-option"><MoonOutlined aria-hidden /><span className="theme-label">深色</span></span> },
    ]} />;
}
