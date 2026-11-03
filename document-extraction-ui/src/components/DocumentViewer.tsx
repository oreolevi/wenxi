import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Alert, Button, Empty, Image, Select, Skeleton, Segmented, Space, Tooltip, Typography } from 'antd';
import { ExportOutlined, FileWordOutlined, FileZipOutlined, FullscreenOutlined, LeftOutlined, RightOutlined } from '@ant-design/icons';
import { fixtures } from '../fixtures.ts';
import type { ExtractedField, Material, Scenario } from '../types.ts';

interface Props {
  file?: Material;
  page: number;
  selected?: ExtractedField;
  busy: boolean;
  onPage: (page: number) => void;
  onSource: (key: string) => void;
  onExamples: () => void;
}

export function Evidence({ scenario, fieldKey, selectedKey, onSelect }: {
  scenario: Scenario; fieldKey: string; selectedKey?: string; onSelect: (key: string) => void;
}) {
  const field = fixtures[scenario].fields.find(item => item.key === fieldKey)!;
  return <button type="button" className={`source-mark ${selectedKey === fieldKey ? 'is-highlighted' : ''}`}
    data-source-ref={fieldKey} data-label={field.name} aria-label={`原文：${field.name}`} onClick={() => onSelect(fieldKey)}>{field.raw}</button>;
}

function DocLine({ label, children }: { label: string; children: ReactNode }) {
  return <div className="doc-line"><span className="doc-label">{label}</span><div className="doc-value">{children}</div></div>;
}

function DemoContent({ scenario, page, selectedKey, onSelect }: { scenario: Scenario; page: number; selectedKey?: string; onSelect: (key: string) => void }) {
  const evidence = (key: string) => <Evidence scenario={scenario} fieldKey={key} selectedKey={selectedKey} onSelect={onSelect} />;
  if (scenario === 'application' && page === 1) return <>
    <h3>企业资料变更申请表</h3><p className="doc-subtitle">客户信息维护 / 申请材料</p>
    <h4>一、申请主体信息</h4>
    <DocLine label="企业名称">{evidence('company')}</DocLine><DocLine label="申请事项">{evidence('subject')}</DocLine>
    <DocLine label="提交人">{evidence('submitter')}</DocLine><DocLine label="联系电话">{evidence('phone')}</DocLine>
    <h4>二、联系信息</h4>
    <DocLine label="注册地址">{evidence('registered')}</DocLine><DocLine label="通讯地址">{evidence('address')}</DocLine>
    <DocLine label="申请日期">{evidence('date')}</DocLine>
    <p className="doc-declaration">本单位确认上述信息真实、完整，并申请按本表所列事项进行资料更新。</p>
    <div className="doc-note">审核意见及最终审核人员见第 2 页。</div>
  </>;
  if (scenario === 'application') return <>
    <h3>资料变更审核记录</h3><p className="doc-subtitle">企业资料变更申请表 / 附页</p>
    <h4>三、初审意见</h4><p>申请材料齐全，主体信息与申请事项对应，请复核。</p>
    <DocLine label="初审人员">{evidence('firstReviewer')}</DocLine><DocLine label="初审日期">2026年10月27日</DocLine>
    <h4>四、最终审核意见</h4><p>经复核，同意按本次申请更新通讯地址及相关联系信息。</p>
    <DocLine label="最终审核人员">{evidence('reviewer')}</DocLine><DocLine label="审核日期">{evidence('reviewDate')}</DocLine>
    <div className="paper-stamp">示例材料</div><div className="doc-note">最终审核人员与初审人员分别列示。本页数据仅用于演示。</div>
  </>;
  if (page === 1) return <>
    <h3>设备采购合同</h3><p className="doc-subtitle">合同信息及采购内容</p>
    <DocLine label="合同编号">{evidence('number')}</DocLine><h4>一、合同主体</h4>
    <DocLine label="甲方（采购方）">{evidence('partyA')}</DocLine><DocLine label="乙方（供应商）">{evidence('partyB')}</DocLine>
    <p>甲乙双方经协商，就设备采购事项达成以下约定。</p><h4>二、采购内容与价款</h4>
    <table className="doc-table"><thead><tr><th>项目</th><th>数量</th><th>单价（元）</th><th>金额（元）</th></tr></thead>
      <tbody><tr><td>办公设备 A</td><td>2 台</td><td>32,000.00</td><td>64,000.00</td></tr><tr><td>办公设备 B</td><td>4 台</td><td>16,000.00</td><td>64,000.00</td></tr></tbody></table>
    <DocLine label="含税总金额">{evidence('amount')}</DocLine><p>上述金额包含设备价款、运输费用及税费。</p>
    <div className="doc-note">交付方式、签订日期及审核信息见第 2 页。</div>
  </>;
  return <><h3>设备采购合同</h3><p className="doc-subtitle">交付、签署及审核信息</p><h4>三、交付及验收</h4>
    <p>乙方应在合同生效后十五个工作日内，将采购设备送达指定地点，并配合完成验收。</p>
    <DocLine label="交付地址">{evidence('address')}</DocLine><h4>四、合同签署</h4>
    <DocLine label="签订日期">{evidence('date')}</DocLine><p>本合同经双方确认后生效，未尽事项由双方协商处理。</p>
    <h4>五、内部审核</h4><DocLine label="审核人员">{evidence('reviewer')}</DocLine>
    <div className="paper-stamp">示例材料</div><div className="doc-note">本材料仅用于提取与原文定位演示，不构成真实合同。</div>
  </>;
}

export function DocumentViewer({ file, page, selected, busy, onPage, onSource, onExamples }: Props) {
  const [zoom, setZoom] = useState(100);
  const [original, setOriginal] = useState(false);
  const [previewError, setPreviewError] = useState(false);
  useEffect(() => { setPreviewError(false); }, [file?.id, page, original]);
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => { setZoom(100); setOriginal(false); if (body.current) body.current.scrollTop = 0; }, [file?.id]);
  useEffect(() => { if (body.current && !selected?.ref) body.current.scrollTop = 0; }, [page, selected?.ref]);
  useEffect(() => {
    if (!selected?.ref || busy) return;
    const raf = requestAnimationFrame(() => {
      const container = body.current;
      const target = container ? Array.from(container.querySelectorAll<HTMLElement>('[data-source-ref]')).find(element => element.dataset.sourceRef === selected.ref) : null;
      if (container && target) container.scrollTo({ top: container.scrollTop + target.getBoundingClientRect().top - container.getBoundingClientRect().top - container.clientHeight / 2 + target.clientHeight / 2,
        behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    });
    return () => cancelAnimationFrame(raf);
  }, [file?.id, page, selected?.key, selected?.ref, busy, original]);

  const paper = file?.kind === 'demo' || file?.kind === 'text' || !!file?.parsed;
  const totalPages = file?.parsed?.pages.length || (file?.scenario ? fixtures[file.scenario].pages : 1);
  const renderedPage = file?.parsed?.pages.find(item => item.number === page);
  const pageEvidence = (selected?.evidence || []).filter(item => item.pageIndex === page - 1)
    .filter((item, index, all) => all.findIndex(other => other.bbox.join(',') === item.bbox.join(',')) === index);
  const shownEvidence = pageEvidence.map(item => original && item.originalBBox ? { ...item, bbox: item.originalBBox } : item);
  return <section className="source-panel" aria-label="原始文档">
    <div className="source-toolbar"><Typography.Text>原文</Typography.Text><Space size={4} className="source-controls">
      {renderedPage?.originalImageUrl && <Segmented size="small" aria-label="原图对照" value={original ? 'original' : 'processed'} onChange={value => setOriginal(value === 'original')} options={[{ label: '转正', value: 'processed' }, { label: '原图', value: 'original' }]} />}
      {(file?.kind === 'demo' || file?.parsed) && <div className="inline-page-nav"><Button type="text" size="small" icon={<LeftOutlined />} aria-label="上一页" disabled={page <= 1} onClick={() => onPage(page - 1)} /><span>{page}/{totalPages}</span><Button type="text" size="small" icon={<RightOutlined />} aria-label="下一页" disabled={page >= totalPages} onClick={() => onPage(page + 1)} /></div>}
      {paper && <><Select aria-label="缩放比例" size="small" variant="borderless" popupMatchSelectWidth={80} value={zoom} onChange={setZoom} options={[75, 100, 125, 150].map(value => ({ value, label: `${value}%` }))} />
        <Tooltip title="适合宽度"><Button type="text" size="small" icon={<FullscreenOutlined />} aria-label="恢复适合宽度" onClick={() => setZoom(100)} /></Tooltip></>}
      {file?.url && <Tooltip title="单独打开附件"><Button type="text" size="small" icon={<ExportOutlined />} aria-label="单独打开附件" href={file.url} target="_blank" rel="noopener" /></Tooltip>}
    </Space></div>
    <div className={`source-body ${file?.kind === 'pdf' && !file.parsed ? 'pdf-body' : ''}`} ref={body}>
      {busy ? <div className="document-loading"><Skeleton active paragraph={{ rows: 9 }} /></div>
        : renderedPage ? previewError ? <div className="preview-empty"><Empty description="本机原文预览已失效，请重新发送提取要求。" /></div>
        : <div className="parsed-page" style={{ width: `${zoom}%` }}>
          <img src={original ? renderedPage.originalImageUrl || renderedPage.imageUrl : renderedPage.imageUrl} width={original ? renderedPage.originalWidth || renderedPage.width : renderedPage.width} height={original ? renderedPage.originalHeight || renderedPage.height : renderedPage.height}
            alt={`${file?.name} 第 ${page} 页原文`} onError={() => setPreviewError(true)} />
          {shownEvidence.map(item => <button key={item.ref}
            type="button" className={`source-box${selected?.kind === 'visual' ? ' is-context' : ''}`} data-source-ref={item.ref} aria-label={`${selected?.name}的原文位置`}
            title={item.quote || item.text} onClick={() => selected && onSource(selected.key)}
            style={{ left: `${item.bbox[0] * 100}%`, top: `${item.bbox[1] * 100}%`, width: `${(item.bbox[2] - item.bbox[0]) * 100}%`, height: `${(item.bbox[3] - item.bbox[1]) * 100}%` }} />)}
        </div>
        : file?.kind === 'demo' && file.scenario ? <article className="paper" style={{ zoom: zoom / 100 }}>
          <div className="paper-topline"><span>DOCUMENT / 示例材料</span><span>业务文档 · {String(page).padStart(2, '0')}</span></div>
          <DemoContent scenario={file.scenario} page={page} selectedKey={selected?.key} onSelect={onSource} />
          <div className="paper-footer"><span>文析 · 内置示例</span><span>{page} / {totalPages}</span></div>
        </article>
        : file?.kind === 'text' ? <article className="paper text-paper" style={{ zoom: zoom / 100 }}>
          <div className="paper-topline"><span>{file.name}</span><span>本地文本</span></div>
          {(file.text || '').split(/\r?\n/).map((line, index) => <span key={index} className={`text-line ${selected?.ref === `line-${index}` ? 'is-highlighted' : ''}`} data-source-ref={`line-${index}`}>{line || ' '}</span>)}
        </article>
        : file?.kind === 'image' ? <Image className="original-image" src={file.url} alt={`${file.name} 原始图片`} />
        : file?.kind === 'pdf' ? <object className="original-pdf" data={file.url} type="application/pdf" aria-label={`${file.name} PDF 原文`}>
          <div className="preview-empty"><Empty description="当前阅读器未提供内嵌预览"><Button href={file.url} target="_blank" rel="noopener">单独打开 PDF</Button></Empty></div>
        </object>
        : file?.kind === 'archive' ? <div className="preview-empty"><FileZipOutlined className="empty-file-icon" /><h3>ZIP 已添加</h3><p>{file.name}</p><Typography.Text type="secondary">解包与批量识别待接入</Typography.Text></div>
        : <div className="preview-empty"><FileWordOutlined className="empty-file-icon" /><h3>附件已添加</h3><p>{file?.name}</p><Alert title="Word 预览待接入文档转换服务" description="可先使用内置示例体验提取和原文高亮。" type="info" showIcon /><Button onClick={onExamples}>使用示例材料</Button></div>}
    </div>

  </section>;
}
