import { useState } from 'react';
import { Button, Empty, Tag } from 'antd';
import { FileSearchOutlined } from '@ant-design/icons';
import type { BundleResult, ProfileRule, ProfileSample } from '../profiles.ts';
import { ProfileCanvas } from './ProfileCanvas.tsx';
import { StudioEditorLayout } from './StudioEditorLayout.tsx';

export function StudioBundleDebug({ result, samples, busy, onUpload, onBack }: { result: BundleResult; samples: Record<string, ProfileSample>; busy: boolean; onUpload: () => void; onBack: () => void }) {
  const [index, setIndex] = useState(0); const [selected, setSelected] = useState(''); const [page, setPage] = useState(1);
  const item = result.items[index]; const sample = item?.sampleId ? samples[item.sampleId] : undefined;
  const groups = [...new Set(result.items.map(item => item.materialTypeName || '待处理'))];
  const fields: ProfileRule[] = (item?.fields || []).map(field => ({ id: field.key, name: field.name, key: field.key, kind: 'text', method: 'region', region: field.bbox, page: field.page, anchor: '', direction: 'right', required: true }));
  return <StudioEditorLayout materials={<aside className="studio-material-rail studio-bundle-rail"><div className="studio-rail-heading"><strong>本次材料</strong><span>{result.summary.files} 份</span></div>
    {groups.map(group => <section className="studio-material-group" key={group}><h3>{group}</h3>{result.items.map((row, rowIndex) => (row.materialTypeName || '待处理') === group && <button type="button" key={rowIndex} disabled={busy} className={`studio-template-item ${rowIndex === index ? 'is-active' : ''}`} onClick={() => { setIndex(rowIndex); setSelected(row.fields[0]?.key || ''); setPage(row.pages[0] || 1); }}><FileSearchOutlined /><span><strong>{row.sourceName}</strong><small>{row.pages.length ? `第 ${row.pages.join('、')} 页` : '未识别'} · {row.status === 'succeeded' ? '已取值' : '待处理'}</small></span></button>)}</section>)}
    <div className="studio-rail-bottom"><Button block disabled={busy} onClick={onUpload}>重新上传材料包</Button><Button type="text" disabled={busy} onClick={onBack}>返回版式调试</Button></div>
  </aside>} source={sample ? <ProfileCanvas sample={sample} fields={fields} selectedId={selected} page={page} onPage={setPage} onSelect={id => { setSelected(id); const field = fields.find(item => item.id === id); if (field) setPage(field.page); }} onBind={() => {}} onUpload={onUpload} readOnly result={item} /> : <div className="studio-empty"><Empty description={item?.error || '此材料没有可用原文'} /></div>}
    inspector={<section className="studio-inspector studio-bundle-inspector"><div className="studio-inspector-heading"><strong>材料包结果</strong><Tag color={result.passed ? 'success' : 'warning'}>{result.passed ? '规则通过' : '有待处理材料'}</Tag></div>
      <div className="studio-bundle-summary"><span>{result.summary.succeeded}/{result.summary.total} 份通过</span><span>总耗时 {(result.totalElapsedMs / 1000).toFixed(2)} s</span><small>固定规则执行 · 未调用大模型</small></div>
      {!!result.missingTypes.length && <p className="scene-config-error">缺少有效材料：{result.missingTypes.join('、')}</p>}
      <div className="studio-bundle-current"><strong>{item?.materialTypeName || '待处理'}{item?.templateName ? ` · ${item.templateName}` : ''}</strong>{item?.error && <p className="scene-config-error">{item.error}</p>}</div>
      <div className="profile-test-values">{item?.fields.map(field => <button type="button" key={field.key} onClick={() => { setSelected(field.key); setPage(field.page); }}><span>{field.name}<Tag color={field.status === 'matched' ? 'success' : 'warning'}>{field.status === 'matched' ? '已取值' : '需调整'}</Tag></span><strong>{field.value || '—'}</strong>{field.issue && <small>{field.issue}</small>}</button>)}</div>
      <details className="studio-bundle-json"><summary>查看完整接口输出</summary><pre>{JSON.stringify(result.data, null, 2)}</pre></details>
    </section>} />;
}
