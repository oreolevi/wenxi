import { useEffect, useMemo, useRef, useState } from 'react';
import { Empty, Tag, Tooltip } from 'antd';
import { activityLevel, calendarCells, exampleActivity, type ActivityData } from '../activity.ts';
import { localServicePage } from '../service.ts';
import { DashboardCard } from './DashboardCard.tsx';

export function OperationsActivity({ demo, supplied }: { demo: boolean; supplied?: ActivityData }) {
  const [actual, setActual] = useState<ActivityData | null>(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState('');
  const [focused, setFocused] = useState('');
  const grid = useRef<HTMLDivElement>(null);
  const examples = useMemo(() => exampleActivity(), []);
  useEffect(() => {
    if (demo || supplied) return;
    if (!localServicePage()) { setError('通过本机试用地址查看真实调用记录'); return; }
    const controller = new AbortController();
    const refresh = async () => {
      try {
        const response = await fetch('/api/operations/activity', { signal: controller.signal });
        if (!response.ok) throw new Error('暂时无法读取调用记录');
        const data = await response.json() as ActivityData;
        if (!controller.signal.aborted) { setActual(data); setError(''); }
      } catch (failure) { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : '暂时无法读取调用记录'); }
    };
    void refresh();
    const timer = window.setInterval(() => { if (!document.hidden) void refresh(); }, 15000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [demo, supplied]);
  const data = supplied || (demo ? examples : actual);
  const days = data?.days || [];
  const shortRange = days.length <= 31;
  const cells = useMemo(() => shortRange ? days.map(day => ({ ...day, inRange: true })) : calendarCells(days), [days, shortRange]);
  const months = cells.flatMap((cell, i) => cell.inRange && cell.date.endsWith('-01') ? [{ key: cell.date, month: Number(cell.date.slice(5, 7)), column: Math.floor(i / 7) + 1 }] : []);
  if (days.length && (!months.length || months[0].column > 3)) months.unshift({ key: days[0].date, month: Number(days[0].date.slice(5, 7)), column: 1 });
  const max = Math.max(1, ...days.map(day => day.count || 0));
  const activeDays = days.filter(day => day.count !== null && day.count > 0).length;
  const untracked = days.some(day => day.count === null);
  const yearlyTotal = days.reduce((sum, day) => sum + (day.count || 0), 0);
  const selectedDay = days.find(day => day.date === selected);
  const columns = `repeat(${shortRange ? cells.length : cells.length / 7}, minmax(0, 1fr))`;
  const source = <span className="activity-source">{!shortRange && <small>近一年</small>}<Tag>{demo ? 'Mock 数据' : '已记录调用'}</Tag></span>;
  const label = (date: string, count: number | null) => `${date} · ${count === null ? '尚未跟踪' : `${count} 次调用`}`;
  return <DashboardCard title="每日调用" extra={source} className="activity-card">
      {data ? <><div className="heatmap-summary"><div><span>{shortRange ? '统计期内调用' : '近一年调用'}</span><strong>{yearlyTotal.toLocaleString()}<small>次</small></strong></div><div><span>活跃天数</span><strong>{activeDays}<small>天</small></strong></div><div><span>单日峰值</span><strong>{max === 1 && !yearlyTotal ? 0 : max}<small>次</small></strong></div></div>
        <div className={`heatmap-scroll ${shortRange ? 'is-short-range' : ''}`} tabIndex={-1}><div className="heatmap-layout">
          <div className="heatmap-weekdays" aria-hidden><span>一</span><span>三</span><span>五</span></div>
          <div><div className="heatmap-months" aria-hidden style={{ gridTemplateColumns: columns }}>{shortRange ? cells.map((cell, i) => i % 7 === 0 ? <span key={cell.date} style={{ gridColumn: i + 1 }}>{Number(cell.date.slice(5, 7))}/{Number(cell.date.slice(8))}</span> : null) : months.map(month => <span key={month.key} style={{ gridColumn: month.column }}>{month.month}月</span>)}</div>
          <div ref={grid} className="heatmap-grid" style={{ gridTemplateColumns: columns }} role="group" aria-label="每日提取调用热力图">{cells.map((cell, index) => cell.inRange ? <Tooltip key={cell.date} title={label(cell.date, cell.count)}><button type="button" data-index={index}
            className={`heatmap-cell level-${activityLevel(cell.count, max)} ${selected === cell.date ? 'is-selected' : ''}`} aria-label={label(cell.date, cell.count)} aria-pressed={selected === cell.date}
            tabIndex={(focused || data.through) === cell.date ? 0 : -1} onFocus={() => setFocused(cell.date)} onClick={() => setSelected(cell.date)} onKeyDown={event => {
              const offset = ({ ArrowRight: shortRange ? 1 : 7, ArrowLeft: shortRange ? -1 : -7, ArrowDown: 1, ArrowUp: -1 } as Record<string, number>)[event.key];
              if (!offset) return; event.preventDefault(); const next = index + offset;
              if (cells[next]?.inRange) grid.current?.querySelector<HTMLButtonElement>(`[data-index="${next}"]`)?.focus();
            }} /></Tooltip> : <span key={cell.date} className="heatmap-padding" aria-hidden />)}</div></div>
        </div></div>
        <div className="heatmap-footer"><span aria-live="polite">{selectedDay ? label(selectedDay.date, selectedDay.count) : demo ? '示例调用分布' : untracked ? `统计追踪始于 ${data.trackingSince}；斜纹表示尚未跟踪` : `${days[0]?.date} — ${data.through}`}</span><div className="heatmap-legend" aria-label="颜色越深调用越多"><span>少</span>{[0, 1, 2, 3, 4].map(level => <i key={level} className={`heatmap-cell level-${level}`} />)}<span>多</span></div></div>
      </> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={error || '正在读取调用记录…'} />}
    </DashboardCard>;
}
