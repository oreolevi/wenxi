import { useState } from 'react';
import { Alert, Button, Empty, Input, Table, Tag, Tooltip } from 'antd';
import { InfoCircleOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import type { ExtractionTask } from '../useExtractionTask.ts';
import { needsReview, personalHistory, type PersonalHistoryEntry } from '../personalHistory.ts';
import './personal-history.css';

type Filter = '全部记录' | '处理中' | '待核验' | '失败';
export function PersonalHistory({ task, onResume, onNavigate }: {
  task: ExtractionTask; onResume: (id: string, recordId?: string) => void; onNavigate: (page: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('全部记录');
  const rows = personalHistory(task.historyRecords, task.files, task.busy, task.progress, task.started);
  const matches = (row: PersonalHistoryEntry, value: Filter) => value === '全部记录' || (value === '处理中' ? ['处理中', '待处理'].includes(row.status) : value === '待核验' ? needsReview(row) : row.status === '失败');
  const filtered = rows.filter(row => matches(row, filter) && row.name.toLowerCase().includes(query.trim().toLowerCase()));
  return <section className="personal-history">
    <div className="platform-intro"><div className="personal-history-title"><h1 tabIndex={-1} data-page-heading>历史记录</h1><Tooltip trigger={['hover', 'click', 'focus']} title="个人文档解析记录。Studio 的服务与场景接口调用记录在各自的运行记录中查看，汇总指标在运行看板查看。"><Button type="text" size="small" icon={<InfoCircleOutlined />} aria-label="历史记录范围" /></Tooltip></div><Button icon={<ReloadOutlined />} loading={task.historyLoading} onClick={() => void task.reloadHistory()}>刷新</Button></div>
    {task.historyError && <Alert type="error" showIcon title={task.historyError} action={<Button size="small" onClick={() => void task.reloadHistory()}>重试</Button>} />}
    <div className="personal-history-toolbar"><div role="group" aria-label="历史记录状态" className="history-status-filters">{(['全部记录', '处理中', '待核验', '失败'] as Filter[]).map(value => <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>{value}<span>{rows.filter(row => matches(row, value)).length}</span></button>)}</div><Input aria-label="搜索历史记录" placeholder="搜索文件名" value={query} allowClear prefix={<SearchOutlined />} onChange={event => setQuery(event.target.value)} /></div>
    <Table<PersonalHistoryEntry> className="personal-history-table" size="middle" rowKey="id" dataSource={filtered} loading={task.historyLoading} scroll={{ x: 690 }} pagination={{ pageSize: 10, hideOnSinglePage: true }} locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={rows.length ? '没有符合条件的记录' : '暂无解析记录'}>{!rows.length && <Button onClick={() => onNavigate('business')}>前往文析</Button>}</Empty> }} columns={[
      { title: '材料', key: 'name', render: (_, row) => <div className="table-name"><strong>{row.name}</strong><small>{row.type}{row.current ? ' · 当前任务' : ''}</small></div> },
      { title: '提交时间', width: 148, key: 'time', render: (_, row) => row.timestamp ? new Date(row.timestamp).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : row.time },
      { title: '状态', width: 100, key: 'status', render: (_, row) => <Tag color={row.status === '已完成' ? 'success' : row.status === '失败' ? 'error' : row.status === '处理中' ? 'processing' : 'default'}>{row.status}</Tag> },
      { title: '解析结果', width: 145, key: 'result', render: (_, row) => <div className="history-result-summary"><span>{[row.total ? `${row.total} 个字段` : '', row.fullText ? '全文' : ''].filter(Boolean).join(' · ') || '—'}</span>{row.total > 0 && <small>{row.confirmed}/{row.total} 已核验</small>}</div> },
      { title: '', width: 96, key: 'action', render: (_, row) => <Button type="link" size="small" onClick={() => onResume(row.materialId!, row.current ? undefined : row.recordId)}>{row.status === '处理中' || row.status === '待处理' ? '查看进度' : row.status === '失败' ? '查看原因' : needsReview(row) ? '继续核验' : '查看结果'}</Button> },
    ]} />
  </section>;
}
