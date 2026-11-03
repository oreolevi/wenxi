import { Drawer, Empty, Table } from 'antd';
import { savedHours, type EfficiencySummary } from '../operations.ts';

export function OperationsEfficiency({ open, onClose, value, source }: {
  open: boolean; onClose: () => void; value?: EfficiencySummary; source: 'actual' | 'mock';
}) {
  return <Drawer title="效能提升" open={open} onClose={onClose} size={760}>
    <div className="efficiency-total"><span>预估节约工时{source === 'mock' ? ' · Mock' : ''}</span><strong>{value?.configuredCalls ? savedHours(value.savedMinutes) : '—'}<small>小时</small></strong></div>
    <p className="platform-caption">按每次成功场景调用记录的节约时长累加。同一场景内部的服务不重复折算。</p>
    <div className="efficiency-coverage"><span>已折算 <strong>{value?.configuredCalls.toLocaleString() || 0}</strong> 次</span><span>未配置基准 <strong>{value?.unconfiguredCalls.toLocaleString() || 0}</strong> 次</span><span>未成功完成 <strong>{value?.excludedCalls.toLocaleString() || 0}</strong> 次，不折算</span></div>
    {value?.scenes.length ? <Table rowKey="id" size="small" pagination={false} dataSource={value.scenes} scroll={{ x: 580 }} columns={[
      { title: '场景', dataIndex: 'name', render: (name, row) => source === 'actual' ? <a href={`?page=profiles&scene=${encodeURIComponent(row.id)}`}>{name}</a> : name },
      { title: '已折算', dataIndex: 'configuredCalls', render: count => `${count.toLocaleString()} 次` },
      { title: '单次基准', key: 'baseline', render: (_, row) => row.minutesMin === null ? '未配置' : `${row.minutesMin}${row.minutesMax !== row.minutesMin ? `–${row.minutesMax}` : ''} 分钟` },
      { title: '预估节约', dataIndex: 'savedMinutes', render: (minutes, row) => row.configuredCalls ? `${savedHours(minutes)} 小时` : '—' },
      { title: '未配置', dataIndex: 'unconfiguredCalls', render: count => `${count} 次` },
    ]} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无可折算的场景调用" />}
    <p className="operations-card-note">在“我的场景 → 设置”中填写单次预计节约时长。保存后用于新调用，历史记录保留原基准；文档解析和独立服务调用暂不折算。</p>
  </Drawer>;
}
