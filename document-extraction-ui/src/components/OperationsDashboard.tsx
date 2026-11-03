import { useEffect, useState } from 'react';
import { Alert, Button, Empty, Segmented, Select, Skeleton, Space, Tooltip } from 'antd';
import { ApiOutlined, ArrowRightOutlined, CheckCircleOutlined, ClockCircleOutlined, FileSearchOutlined, InfoCircleOutlined, ReloadOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { DashboardCard } from './DashboardCard.tsx';
import { OperationsAnnualActivity } from './OperationsAnnualActivity.tsx';
import { OperationsResults } from './OperationsResults.tsx';
import { OperationsCallDetails, type OperationsDrilldown } from './OperationsCallDetails.tsx';
import { ProductIcon } from './ProductIcon.tsx';
import { elapsed, savedHours, type OperationsOverview } from '../operations.ts';
import { OperationsEfficiency } from './OperationsEfficiency.tsx';
import { mockOperationsOverview } from '../operationsMock.ts';
import { savedResultQuality, type OperationsQuality, type QualityTask } from '../operationsQuality.ts';

export function OperationsDashboard() {
  const [days, setDays] = useState(30);
  const [source, setSource] = useState<'actual' | 'mock'>('mock');
  const [kind, setKind] = useState('all');
  const [refresh, setRefresh] = useState(0);
  const [data, setData] = useState<OperationsOverview>();
  const [quality, setQuality] = useState<OperationsQuality>();
  const [qualityUnavailable, setQualityUnavailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [drilldown, setDrilldown] = useState<OperationsDrilldown>();
  const [efficiencyOpen, setEfficiencyOpen] = useState(false);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setData(undefined); setQuality(undefined); setError(''); setQualityUnavailable(false); setDrilldown(undefined);
    if (source === 'mock') { const value = mockOperationsOverview(days, kind); setData(value); setQuality(value.quality); setLoading(false); return; }
    const read = async <T,>(url: string): Promise<T> => {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error('运行数据暂时无法读取，请重试。');
      return response.json();
    };
    const history = ['api', 'service', 'scene'].includes(kind) ? Promise.resolve<QualityTask[]>([]) : read<QualityTask[]>('/api/history');
    Promise.allSettled([read<OperationsOverview>(`/api/operations/overview?days=${days}&kind=${kind}`), history]).then(([overview, saved]) => {
      if (controller.signal.aborted) return;
      if (overview.status === 'rejected') { setError(overview.reason instanceof Error ? overview.reason.message : '运行数据读取失败'); return; }
      setData(overview.value);
      if (saved.status === 'fulfilled') setQuality(savedResultQuality(saved.value, overview.value.from, overview.value.through));
      else setQualityUnavailable(true);
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [days, kind, refresh, source]);
  const summary = data?.summary;
  const rankingPeak = Math.max(1, ...(data?.ranking || []).map(item => item.count));
  const showCalls = () => setDrilldown({ tab: 'records' });
  return <div className="operations-overview">
    <div className="platform-intro"><h1 tabIndex={-1} data-page-heading>运行看板</h1><Space><Segmented aria-label="看板数据来源" value={source} onChange={setSource} options={[{ value: 'actual', label: '实际数据' }, { value: 'mock', label: 'Mock 数据' }]} /><Button icon={<ReloadOutlined />} loading={loading} onClick={() => setRefresh(value => value + 1)}>刷新</Button></Space></div>
    <div className="platform-toolbar operations-filter"><Select aria-label="使用入口" value={kind} onChange={setKind} options={[{ value: 'all', label: '全部入口' }, { value: 'document', label: '文析' }, { value: 'api', label: 'Studio API' }, { value: 'service', label: '服务接口' }, { value: 'scene', label: '场景接口' }]} /><Segmented aria-label="统计时间范围" value={days} onChange={setDays} options={[{ value: 7, label: '近 7 天' }, { value: 30, label: '近 30 天' }, { value: 365, label: '近一年' }]} /><Tooltip title={`文档解析按每份材料的一轮提取计数，API 按外部请求计数；内部识别、样例配置和调试不重复计数。${data?.legacyCount ? ` ${data.legacyCount} 条早期记录缺少调用来源，未纳入统计。` : ''}`}><span className="platform-scope-help" tabIndex={0}><InfoCircleOutlined /> 统计口径</span></Tooltip><Button onClick={showCalls} disabled={!data}>调用明细</Button></div>
    {error && <Alert type="error" showIcon title={error} action={<Button onClick={() => setRefresh(value => value + 1)}>重试</Button>} />}
    {loading ? <Skeleton active paragraph={{ rows: 8 }} /> : data && summary ? <>
      <div className="operations-period"><span>{data.from} — {data.through}</span><span>{source === 'mock' ? 'Mock 数据' : '本机已记录调用'} · 更新于 {new Date(data.generatedAt).toLocaleTimeString('zh-CN', { hour12: false })}</span></div>
      <div className="platform-metrics operations-headline-metrics">{[
        { name: '文析使用次数', value: summary.documentCalls.toLocaleString(), detail: '办公使用 · 次', icon: <FileSearchOutlined />, disabled: !['all', 'document'].includes(kind), action: () => setDrilldown({ tab: 'records', kind: 'document' }), help: '每份材料提交一轮提取计一次；一个对话中处理多份材料或追加提取会分别计数，不代表对话数或使用人数。' },
        { name: 'API 调用', value: summary.apiCalls.toLocaleString(), detail: 'Studio · 次', icon: <ApiOutlined />, disabled: kind === 'document', action: () => setDrilldown({ tab: 'records', kind: kind === 'all' ? 'api' : kind }), help: '已发布服务或场景的一次外部请求计一次；场景内部的服务调用和开发调试不重复累计。' },
        { name: '执行成功率', value: summary.completionRate === null ? '—' : `${summary.completionRate}%`, detail: `${summary.completed.toLocaleString()} 次成功执行`, icon: <CheckCircleOutlined />, action: showCalls, help: '成功执行 /（成功执行＋执行失败）。成功执行包含结果待核对；排除处理中和主动停止。不表示提取准确率或业务审核通过率。' },
        { name: '处理耗时 · P95', value: summary.p95Ms === null ? '—' : elapsed(summary.p95Ms), detail: `${summary.timedCalls.toLocaleString()} 次有耗时记录`, icon: <ClockCircleOutlined />, action: () => setDrilldown({ tab: 'phases' }), help: '95% 的已记录调用耗时不超过此值。包含已记录耗时的失败及停止调用；点击查看平均值与分段耗时。' },
        { name: '效能提升', value: data.efficiency.configuredCalls ? `${savedHours(data.efficiency.savedMinutes)} h` : '—', detail: '预估节约工时', icon: <ThunderboltOutlined />, action: () => setEfficiencyOpen(true), help: `按成功场景调用 × 每次记录的节约时长累加；非实测工时。${data.efficiency.unconfiguredCalls} 次成功场景调用未配置基准，不折算。点击查看明细。` },
      ].map(item => <Tooltip key={item.name} title={item.help}><button disabled={item.disabled} className="dashboard-card platform-metric operations-metric-button" onClick={item.action}><div className="metric-label"><span>{item.name}</span><span className="metric-icon">{item.icon}</span></div><strong>{item.value}</strong><small>{item.detail}</small></button></Tooltip>)}</div>
      <OperationsResults quality={quality} kind={kind} unavailable={qualityUnavailable} />
      <DashboardCard className="operations-ranking" title="服务与场景使用排行" extra={<span className="platform-caption">Top 5 · 外部调用</span>}>
        {data.ranking.length ? <div className="operations-rank-list">{data.ranking.map((item, index) => <button className="operations-rank-row" key={item.key} onClick={() => setDrilldown({ tab: 'records', target: item })}>
          <span className="operations-rank-number">{String(index + 1).padStart(2, '0')}</span><ProductIcon name={item.kind} framed small /><span className="operations-rank-name"><strong>{item.name}</strong><small>{item.kind === 'scene' ? '场景接口' : '服务接口'}</small></span><span className="operations-rank-bar"><i style={{ width: `${item.count / rankingPeak * 100}%` }} /></span><span className="operations-rank-count"><strong>{item.count.toLocaleString()}</strong><small>次</small></span><ArrowRightOutlined />
        </button>)}</div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={kind === 'document' ? '当前范围仅含通用文档解析' : '所选范围暂无服务或场景调用'} />}
      </DashboardCard>
      <OperationsAnnualActivity key={`${source}-${kind}`} source={source} kind={kind} refresh={refresh} />
    </> : !error && <Empty description="暂无调用记录" />}
    <OperationsCallDetails view={drilldown} onClose={() => setDrilldown(undefined)} source={source} days={days} kind={kind} overview={data} />
    <OperationsEfficiency open={efficiencyOpen} onClose={() => setEfficiencyOpen(false)} value={data?.efficiency} source={source} />
  </div>;
}
