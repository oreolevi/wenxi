import { Button, Select, Tag } from 'antd';
import { CloseOutlined } from '@ant-design/icons';
import type { ProfileTest } from '../profiles.ts';

export function StudioTrialResult({ result, index, pendingKeys, onItem, onSelect, onClose, onConfirm }: {
  result: ProfileTest; index: number; pendingKeys: string[]; onItem: (index: number) => void;
  onSelect: (key: string, page: number) => void; onClose: () => void;
  onConfirm: (keys: string[]) => void;
}) {
  const item = result.items?.[index] || result;
  const matched = item.fields.filter(field => field.status === 'matched');
  const confirmable = matched.filter(field => pendingKeys.includes(field.key));
  return <section className="studio-trial-result" aria-label="当前样例试提取结果">
    <div className="studio-trial-heading"><strong>样例试提取</strong><Tag color={result.passed ? 'success' : 'warning'}>{matched.length}/{item.fields.length} 项已取值</Tag><Button size="small" type="text" icon={<CloseOutlined />} aria-label="收起试提取结果" onClick={onClose} /></div>
    {result.items && result.items.length > 1 && <Select size="small" aria-label="切换试提取票据" value={index} onChange={onItem} options={result.items.map((unit, value) => ({ value, label: `${unit.label} · 第 ${unit.pages.join('、')} 页` }))} />}
    <div className="studio-trial-values">{item.fields.map(field => <button type="button" key={field.key} onClick={() => onSelect(field.key, field.page)}><span>{field.name}</span><strong>{field.value || '—'}</strong>{field.status !== 'matched' && <small>{field.issue || '需调整'}</small>}</button>)}</div>
    <div className="studio-trial-footer"><small>当前样例 · 规则 {result.elapsedMs} ms</small>{confirmable.length > 0 && <Button type="text" size="small" onClick={() => onConfirm(confirmable.map(field => field.key))}>确认已取值项（{confirmable.length}）</Button>}</div>
  </section>;
}
