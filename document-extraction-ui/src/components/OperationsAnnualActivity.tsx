import { useEffect, useState } from 'react';
import { Alert, Button, Skeleton } from 'antd';
import type { ActivityData } from '../activity.ts';
import type { OperationsOverview } from '../operations.ts';
import { mockOperationsOverview } from '../operationsMock.ts';
import { DashboardCard } from './DashboardCard.tsx';
import { OperationsActivity } from './OperationsActivity.tsx';

/** The annual calendar has its own fixed time range; entry/source filters still apply. */
export function OperationsAnnualActivity({ source, kind, refresh }: { source: 'actual' | 'mock'; kind: string; refresh: number }) {
  const [data, setData] = useState<ActivityData>();
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); setData(undefined); setError('');
    if (source === 'mock') { setData(mockOperationsOverview(365, kind).activity); return; }
    fetch(`/api/operations/overview?days=365&kind=${kind}`, { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error('全年调用记录暂时无法读取。');
      return response.json() as Promise<OperationsOverview>;
    }).then(value => { if (!controller.signal.aborted) setData(value.activity); })
      .catch(failure => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : '全年调用记录读取失败'); });
    return () => controller.abort();
  }, [source, kind, refresh, retry]);
  if (data) return <OperationsActivity key={`${source}-${kind}`} demo={source === 'mock'} supplied={data} />;
  return <DashboardCard title="每日调用" className="activity-card">{error ? <Alert type="error" title={error} action={<Button onClick={() => setRetry(value => value + 1)}>重试</Button>} /> : <Skeleton active paragraph={{ rows: 3 }} />}</DashboardCard>;
}
