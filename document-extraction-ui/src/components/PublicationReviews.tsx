import { useState } from 'react';
import { Alert, Button, Drawer, Empty, Input, Segmented, Tag } from 'antd';
import { CheckOutlined, RollbackOutlined } from '@ant-design/icons';
import type { PublicationReview } from '../profiles.ts';

export function PublicationReviews({ open, reviews, busy, onClose, onDecision }: {
  open: boolean; reviews: PublicationReview[]; busy: boolean; onClose: () => void;
  onDecision: (id: string, decision: 'approved' | 'rejected', reviewer: string, comment: string) => void;
}) {
  const [filter, setFilter] = useState('pending');
  const [selectedId, setSelectedId] = useState('');
  const [reviewer, setReviewer] = useState('模拟审核员');
  const [comments, setComments] = useState<Record<string, string>>({});
  const rows = reviews.filter(item => filter === 'all' || item.status === filter);
  const selected = rows.find(item => item.id === selectedId) || rows[0];
  const labels = { pending: '待审核', approved: '已通过', rejected: '已退回' };
  return <Drawer title="公共服务审核" open={open} onClose={onClose} placement="right" size={640} className="platform-drawer" styles={{ wrapper: { maxWidth: '100vw' } }}>
    <Alert type="info" showIcon title="模拟审核身份" description="在此体验审核员的通过、退回操作。正式角色权限后续接入。" />
    <Segmented className="publication-review-filter" aria-label="公开申请状态" value={filter} onChange={setFilter} options={[{ value: 'pending', label: '待审核' }, { value: 'all', label: '全部申请' }]} />
    <div className="publication-review-list">{rows.map(item => <button type="button" key={item.id} aria-pressed={selected?.id === item.id} onClick={() => setSelectedId(item.id)}><span><strong>{item.name}</strong><small>v{item.version} · {item.publisher}{item.team ? ` · ${item.team}` : ''}</small></span><Tag color={item.status === 'approved' ? 'success' : item.status === 'pending' ? 'processing' : 'warning'}>{labels[item.status]}</Tag></button>)}</div>
    {!selected ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有待处理的申请" /> : <div className="publication-review-detail">
      <h3>{selected.name} <small>v{selected.version}</small></h3><p>{selected.description || '未填写场景描述'}</p><small>申请时间：{new Date(selected.submittedAt).toLocaleString('zh-CN')}</small>
      {selected.status === 'pending' ? <><label>审核人<Input aria-label="模拟审核人" value={reviewer} maxLength={80} disabled={busy} onChange={event => setReviewer(event.target.value)} /></label><label>审核意见<Input.TextArea aria-label="公开审核意见" placeholder="退回时请填写需要调整的内容" maxLength={1000} rows={3} disabled={busy} value={comments[selected.id] || ''} onChange={event => setComments(values => ({ ...values, [selected.id]: event.target.value }))} /></label><div className="publication-review-actions"><Button icon={<RollbackOutlined />} disabled={busy || !reviewer.trim() || !comments[selected.id]?.trim()} onClick={() => onDecision(selected.id, 'rejected', reviewer, comments[selected.id])}>退回修改</Button><Button type="primary" icon={<CheckOutlined />} disabled={busy || !reviewer.trim()} onClick={() => onDecision(selected.id, 'approved', reviewer, comments[selected.id] || '')}>通过并公开</Button></div></> : <p>审核人：{selected.reviewer}<br />{selected.comment || labels[selected.status]}</p>}
    </div>}
  </Drawer>;
}
