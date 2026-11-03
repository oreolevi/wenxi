import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Splitter } from 'antd';
import { HolderOutlined } from '@ant-design/icons';

const storageKey = 'wenxi-studio-panel-ratios';
const defaults = [16, 46, 38];
export function readStudioRatios(): number[] {
  try {
    const values = JSON.parse(window.localStorage.getItem(storageKey) || 'null');
    if (Array.isArray(values) && values.length === 3 && values.every(value => typeof value === 'number' && Number.isFinite(value) && value > 0 && value < 100) && Math.abs(values.reduce((a, b) => a + b, 0) - 100) < 1) return values;
  } catch { /* Layout preferences are optional. */ }
  return defaults;
}

export function StudioEditorLayout({ materials, source, inspector }: { materials: ReactNode; source: ReactNode; inspector: ReactNode }) {
  const container = useRef<HTMLDivElement>(null);
  const [stacked, setStacked] = useState(() => window.innerWidth < 768);
  const [ratios, setRatios] = useState(readStudioRatios);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const resize = new ResizeObserver(entries => { const width = entries[0]?.contentRect.width; if (width) setStacked(width < 620); });
    resize.observe(element);
    return () => resize.disconnect();
  }, []);
  function remember(sizes: number[]) {
    const sum = sizes.reduce((a, b) => a + b, 0);
    if (!sum || sizes.some(size => !Number.isFinite(size) || size <= 0)) return;
    const next = sizes.map(size => size / sum * 100);
    setRatios(next);
    try { window.localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* Layout remains draggable without storage. */ }
  }
  return <div ref={container} className={`studio-editor-grid ${stacked ? 'is-stacked' : ''}`}>
    {stacked ? <>{materials}{source}{inspector}</> : <Splitter className="studio-editor-splitter" onResizeEnd={remember} draggerIcon={<span title="拖动调整面板宽度" aria-hidden><HolderOutlined /></span>}>
      <Splitter.Panel className="studio-rail-panel" defaultSize={`${ratios[0]}%`} min={110} max="30%">{materials}</Splitter.Panel>
      <Splitter.Panel className="studio-source-panel" defaultSize={`${ratios[1]}%`} min={210}>{source}</Splitter.Panel>
      <Splitter.Panel className="studio-inspector-panel" defaultSize={`${ratios[2]}%`} min={240} max="60%">{inspector}</Splitter.Panel>
    </Splitter>}
  </div>;
}
