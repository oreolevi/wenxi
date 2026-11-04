import { Empty, Tag, Tooltip } from 'antd';
import { AuditOutlined, BulbOutlined, FileImageOutlined, FileSearchOutlined, ProfileOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import { capabilityUsage, usageCategories } from '../activity.ts';
import type { ProcessingTrace } from '../types.ts';
import { DashboardCard } from './DashboardCard.tsx';

export function CapabilityUsage({ demo, traces }: { demo: boolean; traces: ProcessingTrace[] }) {
  const entries = (demo ? usageCategories.map((item, index) => ({ ...item, count: [4, 3, 3, 3, 0, 0, 0][index] })) : capabilityUsage(traces))
    .filter(item => item.count > 0).sort((a, b) => b.count - a.count);
  const peak = Math.max(1, ...entries.map(item => item.count));
  const total = entries.reduce((sum, item) => sum + item.count, 0);
  const icons = { recognize: <FileSearchOutlined />, semantic: <BulbOutlined />, grounding: <SafetyCertificateOutlined />, preview: <FileImageOutlined />, match: <ProfileOutlined />, seal: <AuditOutlined />, 'region-ocr': <FileSearchOutlined /> };
  return <DashboardCard title="能力使用分布" extra={<Tooltip title="同一份材料在一轮提取中，同一能力只计一次；分批执行合并计数，包含失败或停止前已开始的处理。"><Tag>{demo ? '示例数据' : '当前会话'}</Tag></Tooltip>} className="activity-card">
    {entries.length ? <><div className="usage-overview"><strong>{total}<small>次能力使用</small></strong><span>{entries.length} 类能力</span></div>
      <div className="usage-ranking" role="list" aria-label="按能力分类的使用次数">{entries.map((item, index) => <div className={`usage-row ${index === 0 ? 'is-leading' : ''}`} role="listitem" key={item.id}>
        <span className="usage-icon" aria-hidden>{icons[item.id]}</span><div className="usage-row-body"><div className="usage-row-heading"><span><strong>{item.name}</strong><small>{item.engine}</small></span><span className="usage-value">{item.count}<small>次</small></span></div>
          <div className="usage-track" role="img" aria-label={`${item.name} ${item.count} 次`}><span style={{ width: `${item.count / peak * 100}%` }} /></div></div>
      </div>)}</div></> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前会话尚无能力使用记录" />}
  </DashboardCard>;
}
