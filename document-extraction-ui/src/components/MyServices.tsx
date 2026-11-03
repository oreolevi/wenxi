import { ProductIcon } from './ProductIcon.tsx';
import { useState } from 'react';
import { Button, Empty, Input, Segmented, Table, Tag, Tooltip } from 'antd';
import { AppstoreOutlined, ArrowRightOutlined, GlobalOutlined, SearchOutlined, UnorderedListOutlined } from '@ant-design/icons';
import type { ProfileSummary, PublicationReview } from '../profiles.ts';

export function MyServices({ records, reviews, onShare, query, filter, busy, onQuery, onFilter, onOpen, onNew }: {
  records: ProfileSummary[]; query: string; filter: string; busy: boolean;
  reviews: PublicationReview[]; onShare: (item: ProfileSummary) => void;
  onQuery: (query: string) => void; onFilter: (filter: string) => void; onOpen: (id: string) => void; onNew: () => void;
}) {
  const [layout, setLayout] = useState<'cards' | 'list'>('cards');
  const list = records.filter(item => `${item.name}${item.description}`.toLowerCase().includes(query.toLowerCase()) && (filter === '全部' || (filter === '已发布' ? item.versions.length > 0 : item.hasUnpublishedChanges || !item.versions.length)));
  const status = (item: ProfileSummary) => <Tag color={item.versions.length ? 'success' : 'default'}>{item.versions.length ? `v${item.versions.at(-1)}` : '草稿'}</Tag>;
  const publication = (item: ProfileSummary) => {
    const review = reviews.find(row => row.profileId === item.id && row.version === item.versions.at(-1));
    const label = review?.status === 'pending' ? '公开审核中' : review?.status === 'approved' ? '已公开' : review?.status === 'rejected' ? '重新申请' : '申请公开';
    return <Tooltip title={!item.versions.length ? '先测试并发布接口版本' : review?.comment || '申请加入公共服务库'}><Button type="text" size="small" icon={<GlobalOutlined />} disabled={busy || !item.versions.length || review?.status === 'approved' || review?.status === 'pending'} onClick={event => { event.stopPropagation(); onShare(item); }}>{label}</Button></Tooltip>;
  };
  const empty = <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={query || filter !== '全部' ? '没有匹配的服务' : '还没有创建服务'}><Button type="primary" disabled={busy} onClick={onNew}>新建服务</Button></Empty>;
  return <section className="my-services" aria-label="我的服务">
    <div className="platform-toolbar"><Input placeholder="搜索服务名称" prefix={<SearchOutlined />} value={query} onChange={event => onQuery(event.target.value)} allowClear aria-label="搜索服务" /><Segmented value={filter} onChange={onFilter} options={['全部', '草稿', '已发布']} aria-label="服务状态" /><div className="studio-view-toggle"><Tooltip title="卡片视图"><Button type="text" icon={<AppstoreOutlined />} aria-label="卡片视图" aria-pressed={layout === 'cards'} onClick={() => setLayout('cards')} /></Tooltip><Tooltip title="列表视图"><Button type="text" icon={<UnorderedListOutlined />} aria-label="列表视图" aria-pressed={layout === 'list'} onClick={() => setLayout('list')} /></Tooltip></div></div>
    {layout === 'cards' ? list.length ? <div className="service-project-grid">{list.map(item => <article className="studio-scene-card" key={item.id}><button type="button" className="studio-scene-card-main" aria-label={`编辑服务 ${item.name}`} disabled={busy} onClick={() => onOpen(item.id)}><div className="studio-scene-card-top"><ProductIcon name="service" framed className="service-project-icon" /><h2>{item.name}</h2>{status(item)}</div><p>{item.description || (item.templates ? `${item.templates} 个材料版式 · ${item.fields} 个提取字段` : '上传第一份样例，开始配置提取字段')}</p></button><div className="studio-scene-card-bottom"><time>{new Date(item.updatedAt).toLocaleDateString('zh-CN')} 更新</time>{publication(item)}</div><Button className="studio-scene-continue" type="text" size="small" disabled={busy} onClick={() => onOpen(item.id)}>{item.templates ? '继续配置' : '上传样例'} <ArrowRightOutlined /></Button></article>)}</div> : empty
      : <Table<ProfileSummary> className="service-project-table" rowKey="id" dataSource={list} size="middle" scroll={{ x: 620 }} pagination={{ pageSize: 8, hideOnSinglePage: true }}
        onRow={item => ({ onClick: () => { if (!busy) onOpen(item.id); } })} locale={{ emptyText: empty }} columns={[
          { title: '服务名称', dataIndex: 'name', key: 'name', render: (_, item) => <div className="service-project-name"><ProductIcon name="service" framed className="service-project-icon" /><div><strong>{item.name}</strong><small>{item.templates} 个版式 · {item.fields} 个字段</small></div></div> },
          { title: '状态', key: 'status', width: 135, render: (_, item) => <div className="service-project-state">{status(item)}{item.versions.length > 0 && item.hasUnpublishedChanges && <small>有新草稿</small>}</div> },
          { title: '最近更新', key: 'updated', width: 125, render: (_, item) => new Date(item.updatedAt).toLocaleDateString('zh-CN') },
          { title: '', key: 'open', width: 195, render: (_, item) => <>{publication(item)}<Button type="text" disabled={busy} aria-label={`编辑服务 ${item.name}`} onClick={event => { event.stopPropagation(); onOpen(item.id); }} icon={<ArrowRightOutlined />}>编辑</Button></> },
        ]} />}
  </section>;
}
