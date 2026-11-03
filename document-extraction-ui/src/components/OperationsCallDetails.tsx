import { useEffect, useState } from 'react';
import { Alert, Button, Drawer, Empty, Progress, Select, Skeleton, Space, Table, Tabs, Tag, Tooltip } from 'antd';
import { ArrowLeftOutlined, InfoCircleOutlined } from '@ant-design/icons';
import { elapsed, operationStatus, type OperationRecord, type OperationsOverview } from '../operations.ts';
import { mockOperationsOverview } from '../operationsMock.ts';

export interface OperationsDrilldown { tab: 'records' | 'phases'; kind?: string; status?: string; target?: OperationsOverview['ranking'][number] }
const callStatus = (value: string) => <Tag color={operationStatus[value]?.color || 'default'}>{operationStatus[value]?.label || value}</Tag>;

export function OperationsCallDetails({ view, onClose, source, days, kind, overview }: {
  view?: OperationsDrilldown; onClose: () => void; source: 'actual' | 'mock'; days: number; kind: string; overview?: OperationsOverview;
}) {
  const [tab, setTab] = useState('records');
  const [status, setStatus] = useState('');
  const [target, setTarget] = useState<OperationsDrilldown['target']>();
  const [selected, setSelected] = useState<OperationRecord>();
  const [details, setDetails] = useState<OperationsOverview>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => { if (view) { setTab(view.tab); setStatus(view.status || ''); setTarget(view.target); setSelected(undefined); } }, [view]);
  useEffect(() => {
    if (!view || tab !== 'records') return;
    const controller = new AbortController(); setLoading(true); setDetails(undefined); setError('');
    const detailKind = view.kind || kind;
    if (source === 'mock') { setDetails(mockOperationsOverview(days, detailKind, overview?.through, { status, target: target?.key })); setLoading(false); return; }
    const query = new URLSearchParams({ days: String(days), kind: detailKind, record_status: status, record_target: target?.key || '' });
    fetch(`/api/operations/overview?${query}`, { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error('调用明细读取失败，请重试。');
      return response.json() as Promise<OperationsOverview>;
    }).then(value => { if (!controller.signal.aborted) setDetails(value); })
      .catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : '调用明细读取失败'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [view, tab, status, target, source, days, kind, overview?.through, retry]);
  const measured = overview?.phases.filter(item => item.averageMs !== null) || [];
  const peak = Math.max(1, ...measured.map(item => item.averageMs || 0));
  const link = selected?.targetId ? `?${new URLSearchParams(selected.kind === 'scene' ? { page: 'profiles', scene: selected.targetId } : { page: 'profiles', profile: selected.targetId, studio: 'runs' })}` : '?page=history';
  return <Drawer className="operations-details-drawer" title="调用明细" placement="right" size={880} open={!!view} onClose={onClose}>
    {selected ? <><Button type="text" icon={<ArrowLeftOutlined />} className="operations-detail-back" onClick={() => setSelected(undefined)}>返回调用列表</Button><div className="operations-detail-heading"><h2>{selected.name}</h2>{callStatus(selected.status)}</div><p className="platform-caption">{source === 'mock' ? 'Mock · ' : ''}{new Date(selected.createdAt).toLocaleString('zh-CN')} · {selected.version ? `v${selected.version}` : '通用解析'}</p>
      <dl className="operations-detail"><div><dt>总耗时</dt><dd>{elapsed(selected.totalElapsedMs)}</dd></div><div><dt>调用方</dt><dd>{selected.caller || '未采集'}</dd></div>{overview?.phases.map(phase => <div key={phase.id}><dt>{phase.name}</dt><dd>{elapsed(selected.phases?.[phase.id])}</dd></div>)}</dl>
      {selected.error && <Alert type="error" showIcon title="执行异常" description={selected.error} />}
      {source === 'actual' && <Button className="operations-detail-link" type="primary" href={link}>{selected.targetId ? '打开运行记录' : '查看解析历史'}</Button>}
    </> : <><p className="platform-caption">{overview?.from} — {overview?.through} · {source === 'mock' ? 'Mock 数据' : '实际数据'}</p><Tabs activeKey={tab} onChange={setTab} items={[
      { key: 'records', label: '调用记录', children: <>
        <div className="platform-toolbar"><Select aria-label="调用执行状态" value={status} onChange={setStatus} options={[{ value: '', label: '全部状态' }, ...Object.entries(operationStatus).map(([value, item]) => ({ value, label: item.label }))]} />{target && <Tag closable onClose={() => setTarget(undefined)}>{target.name}</Tag>}<span className="platform-caption">{details ? `共 ${details.recordsTotal.toLocaleString()} 次 · 展示最近 ${details.records.length} 次` : ''}</span></div>
        {error ? <Alert type="error" showIcon title={error} action={<Button onClick={() => setRetry(value => value + 1)}>重试</Button>} /> : loading ? <Skeleton active paragraph={{ rows: 6 }} /> : <Table<OperationRecord> rowKey="id" size="middle" dataSource={details?.records || []} pagination={{ pageSize: 8, hideOnSinglePage: true }} scroll={{ x: 660 }} locale={{ emptyText: '所选范围暂无调用记录' }} columns={[
          { title: '服务 / 入口', key: 'target', render: (_, row) => <div className="table-name"><strong>{row.name}</strong><small>{row.version ? `v${row.version} · ` : ''}{row.kind === 'scene' ? '场景接口' : row.kind === 'service' ? '服务接口' : '通用文档解析'}</small></div> },
          { title: '调用时间', dataIndex: 'createdAt', render: value => new Date(value).toLocaleString('zh-CN', { hour12: false }) },
          { title: '执行状态', dataIndex: 'status', render: callStatus }, { title: '耗时', dataIndex: 'totalElapsedMs', render: elapsed },
          { title: '', key: 'open', width: 65, render: (_, row) => <Button type="link" size="small" onClick={() => setSelected(row)}>详情</Button> },
        ]} />}
      </> },
      { key: 'phases', label: '分段耗时', children: <><div className="operations-phases-summary"><Space size={24}><span>平均总耗时 <strong>{elapsed(overview?.summary.averageMs)}</strong></span><span>P95 <strong>{elapsed(overview?.summary.p95Ms)}</strong></span></Space><Tooltip title="当前看板范围内，仅统计实际记录了该阶段耗时的调用。各阶段样本不同，均值不能相加为总耗时。"><InfoCircleOutlined tabIndex={0} /></Tooltip></div>
        {measured.length ? <div className="operations-phase-list">{measured.map(item => <div key={item.id}><span>{item.name}<small>{item.count.toLocaleString()} 次记录</small></span><Progress percent={(item.averageMs || 0) / peak * 100} showInfo={false} /><strong>{elapsed(item.averageMs)}</strong></div>)}</div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="所选范围暂无分段耗时记录" />}<p className="operations-card-note">统计范围与看板一致；未采集的阶段不补算为零。</p></> },
    ]} /></>}
  </Drawer>;
}
