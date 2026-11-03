import { Empty, Progress, Tooltip } from 'antd';
import { InfoCircleOutlined } from '@ant-design/icons';
import { DashboardCard } from './DashboardCard.tsx';
import type { OperationsQuality } from '../operationsQuality.ts';

export function OperationsResults({ quality, kind, unavailable }: { quality?: OperationsQuality; kind: string; unavailable: boolean }) {
  const automated = ['api', 'service', 'scene'].includes(kind);
  const hasResults = !automated && !!quality?.total;
  const empty = automated ? '接口调用尚未采集字段核验数据' : unavailable ? '核验数据暂时无法读取' : '所选范围暂无已保存的提取结果';
  const coverage = quality?.total ? Math.round(quality.reviewed / quality.total * 100) : 0;
  const rows = quality ? [
    { name: '原文引用通过', count: quality.passed, color: 'var(--accent)' },
    { name: '依据待核对', count: quality.partial, color: '#d99b36' },
    { name: '待图像核验', count: quality.visual, color: '#8798be' },
    { name: '未找到', count: quality.missing, color: '#b8bec9' },
    ...(quality.unknown ? [{ name: '未记录校验状态', count: quality.unknown, color: '#b8bec9' }] : []),
  ] : [];
  return <div className="platform-two operations-quality">
    <DashboardCard title="提取结果状态" extra={<Tooltip title="统计所选期间创建、已保存的文析任务结果。每个字段只计入一种原始引用状态；人工确认不会改写该状态。服务与场景接口未接入此口径。"><span className="operations-help" tabIndex={0}><InfoCircleOutlined /></span></Tooltip>}>
      {hasResults && quality ? <><div className="operations-quality-scope">已保存文档结果 · {quality.materials.toLocaleString()} 份材料 · {quality.total.toLocaleString()} 个字段</div><div className="distribution-list">{rows.map(row => <div className="distribution-row" key={row.name}><span>{row.name}</span><Progress percent={row.count / quality.total * 100} strokeColor={row.color} showInfo={false} /><strong>{row.count.toLocaleString()}</strong></div>)}</div></> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={empty} />}
    </DashboardCard>
    <DashboardCard title="人工核验" extra={<Tooltip title="已确认或已修改字段数 / 已保存通用解析字段数。这里反映核验覆盖率，业务准确率需要另行抽检或标准答案评测。自动接口调用不计入待人工核验。"><span className="operations-help" tabIndex={0}><InfoCircleOutlined /></span></Tooltip>}>
      {hasResults && quality ? <div className="review-donut-layout">
        <Progress className="review-donut" type="circle" percent={coverage} size={132} strokeWidth={9} strokeColor="var(--accent)" format={() => <span className="review-donut-center"><strong>{coverage}%</strong><small>核验覆盖率</small></span>} />
        <div className="review-donut-legend"><div><span><i className="is-reviewed" />已核验</span><strong>{quality.reviewed.toLocaleString()}<small>项</small></strong></div><div><span><i />未核验</span><strong>{(quality.total - quality.reviewed).toLocaleString()}<small>项</small></strong></div><span className="quality-definition">业务准确率：待评估<Tooltip title="人工点击确认、执行完成或引用通过，都不能直接当作业务准确率。"><InfoCircleOutlined tabIndex={0} /></Tooltip></span></div>
      </div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={automated ? '自动接口调用不纳入人工核验' : empty} />}
    </DashboardCard>
  </div>;
}
