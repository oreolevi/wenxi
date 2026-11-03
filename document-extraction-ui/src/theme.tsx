import { createContext, useContext, useLayoutEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { theme as antTheme } from 'antd';
import { XProvider } from '@ant-design/x';
import zhCN from 'antd/locale/zh_CN';
import xZhCN from '@ant-design/x/locale/zh_CN';

export type ColorMode = 'light' | 'dark';
const STORAGE_KEY = 'document-extraction-color-mode';
const ColorModeContext = createContext<{ mode: ColorMode; setMode: (mode: ColorMode) => void } | null>(null);

function readMode(): ColorMode {
  try { return localStorage.getItem(STORAGE_KEY) === 'dark' ? 'dark' : 'light'; }
  catch { return 'light'; }
}

export function ProductThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ColorMode>(readMode);
  const dark = mode === 'dark';
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = mode;
    document.documentElement.style.colorScheme = mode;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#141414' : '#ffffff');
    try { localStorage.setItem(STORAGE_KEY, mode); } catch { /* Theme switching still works if storage is unavailable. */ }
  }, [mode]);
  const value = useMemo(() => ({ mode, setMode }), [mode]);

  return <ColorModeContext.Provider value={value}><XProvider locale={{ ...zhCN, ...xZhCN }} theme={{
    algorithm: dark ? antTheme.darkAlgorithm : antTheme.defaultAlgorithm,
    token: {
      colorPrimary: dark ? '#7897f5' : '#3564df',
      colorTextLightSolid: dark ? '#101010' : '#ffffff',
      colorLink: dark ? '#9bb3ff' : '#3564df',
      colorLinkHover: dark ? '#bdccff' : '#244fc1',
      colorLinkActive: dark ? '#b0c2ff' : '#244fc1',
      colorPrimaryText: dark ? '#9bb3ff' : '#3564df',
      colorPrimaryTextHover: dark ? '#bdccff' : '#244fc1',
      colorText: dark ? '#eeeeee' : '#242424',
      colorTextSecondary: dark ? '#b3b3b3' : '#686868',
      colorTextTertiary: dark ? '#a0a0a0' : '#747474',
      colorTextPlaceholder: dark ? '#949494' : '#777777',
      colorBorder: dark ? '#383838' : '#dedede',
      colorBorderSecondary: dark ? '#303030' : '#e9e9e9',
      colorBgBase: dark ? '#141414' : '#ffffff',
      colorBgLayout: dark ? '#141414' : '#ffffff',
      colorBgContainer: dark ? '#1b1b1b' : '#ffffff',
      colorBgElevated: dark ? '#232323' : '#ffffff',
      colorInfoBg: dark ? '#232323' : '#f7f7f7',
      colorInfoBorder: dark ? '#3a3a3a' : '#e0e0e0',
      colorFillAlter: dark ? '#252525' : '#f7f7f7',
      colorFillSecondary: dark ? '#2a2a2a' : '#f1f1f1',
      colorPrimaryBg: dark ? '#252525' : '#f5f5f5',
      colorPrimaryBgHover: dark ? '#303030' : '#eeeeee',
      colorSuccess: dark ? '#7cbb99' : '#237c5e',
      borderRadius: 9,
      fontSize: 13,
      fontFamily: '-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif',
      controlHeight: 36,
    },
    components: {
      Button: { primaryShadow: 'none', defaultShadow: 'none' },
      Tag: {
        colorSuccess: dark ? '#b7eb8f' : '#389e0d',
        colorSuccessBg: dark ? '#162312' : '#f6ffed',
        colorSuccessBorder: dark ? '#274916' : '#b7eb8f',
      },
      Card: { paddingLG: 18 },
      Tabs: { horizontalMargin: '0' },
      Splitter: { splitBarSize: 1, splitTriggerSize: 7 },
      Sender: { borderRadius: 16 },
    },
  }}>{children}</XProvider></ColorModeContext.Provider>;
}

export function useColorMode() {
  const context = useContext(ColorModeContext);
  if (!context) throw new Error('useColorMode requires ProductThemeProvider');
  return context;
}
