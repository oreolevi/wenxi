import { useEffect, useRef, useState } from 'react';
import { Button, Dropdown, Empty, Select, Tooltip } from 'antd';
import { FileSearchOutlined, LeftOutlined, MoreOutlined, RightOutlined } from '@ant-design/icons';
import { mapProfileBox, paddedBox, selectionBox, type Box, type ProfileRule, type ProfileSample, type ProfileTest } from '../profiles.ts';

export function ProfileCanvas({ sample, fields, selectedId, page, result, preview, previewPage, locateRequest, onClearPreview, readOnly = false, onPage, onSelect, onBind, onUpload, onReprocess }: {
  sample?: ProfileSample; fields: ProfileRule[]; selectedId: string; page: number; result?: Pick<ProfileTest, 'fields'>; readOnly?: boolean;
  locateRequest?: { token: number; fieldId: string };
  preview?: ProfileRule; previewPage?: number; onClearPreview?: () => void;
  onPage: (page: number) => void; onSelect: (id: string) => void; onBind: (box: Box, page: number) => void; onUpload: () => void;
  onReprocess?: () => void;
}) {
  const [tool, setTool] = useState<'text' | 'draw'>('text');
  const [zoom, setZoom] = useState(100);
  const [original, setOriginal] = useState(false);
  const [draftBox, setDraftBox] = useState<Box | null>(null);
  const [imageError, setImageError] = useState(false);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const pageElement = useRef<HTMLDivElement>(null);
  const selectedRegion = useRef<HTMLButtonElement>(null);
  const imagePage = sample?.pages.find(item => item.number === page);
  const selected = fields.find(field => field.id === selectedId);
  useEffect(() => {
    if (!locateRequest || locateRequest.fieldId !== selectedId || readOnly) return;
    setOriginal(false); setTool('text'); setDraftBox(null); origin.current = null;
    const frame = requestAnimationFrame(() => {
      pageElement.current?.focus({ preventScroll: true });
      (selectedRegion.current || pageElement.current)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
    return () => cancelAnimationFrame(frame);
  }, [locateRequest, selectedId, readOnly]);
  const resultField = result?.fields.find(field => field.key === selected?.key);
  const resultBox = original ? resultField?.originalBBox || resultField?.bbox : resultField?.bbox;
  const binding = !readOnly && !original && !preview;
  const shownBox = (box: Box) => original ? mapProfileBox(box, imagePage?.toOriginal) : box;
  const boxStyle = (box: Box) => ({ left: `${box[0] * 100}%`, top: `${box[1] * 100}%`, width: `${(box[2] - box[0]) * 100}%`, height: `${(box[3] - box[1]) * 100}%` });
  return <section className="profile-source" aria-label="版式原文与定位">
    <div className="profile-source-toolbar profile-source-toolbar-compact">
      <Tooltip title={sample?.engine || '原始材料'}><span className="profile-source-label">{preview ? '建议预览' : original ? '原图' : '原文'}</span></Tooltip>
      <div className="profile-source-controls">
        {sample && binding && <Tooltip title={selected ? `为“${selected.name}”定位：点击文字或拖动框选` : '先选择右侧字段，再定位原文'}><Select className="profile-location-select" size="small" variant="borderless" value={tool} onChange={value => setTool(value)} options={[{ label: '选取文字', value: 'text' }, { label: '框选区域', value: 'draw' }]} aria-label="字段定位方式" /></Tooltip>}
        {sample && <Select className="profile-zoom-select" size="small" variant="borderless" aria-label="样例缩放比例" value={zoom} onChange={setZoom} options={[100, 125, 150, 200].map(value => ({ value, label: `${value}%` }))} />}
        {sample && sample.pages.length > 1 && <div className="profile-source-pagination"><Button type="text" size="small" icon={<LeftOutlined />} aria-label="上一页样例" disabled={page <= 1} onClick={() => onPage(page - 1)} /><span>{page}/{sample.pages.length}</span><Button type="text" size="small" icon={<RightOutlined />} aria-label="下一页样例" disabled={page >= sample.pages.length} onClick={() => onPage(page + 1)} /></div>}
        {sample && <Dropdown trigger={['click']} menu={{ items: [
          ...(imagePage?.originalImageUrl ? [{ key: 'image', label: original ? '查看转正预览' : '查看上传原图' }] : []),
          ...(!readOnly ? [{ key: 'replace', label: '更换样例' }] : []),
          ...(!readOnly && onReprocess ? [{ key: 'reprocess', label: '按当前设置重新处理样例' }] : []),
          ...(preview ? [{ key: 'clear-preview', label: '退出建议预览' }] : []),
          { key: 'zoom', label: '缩放', children: [100, 125, 150, 200].map(value => ({ key: `zoom-${value}`, label: `${value}%` })) },
          ...(sample.pages.length > 1 ? [{ key: 'previous', label: '上一页', disabled: page <= 1 }, { key: 'next', label: '下一页', disabled: page >= sample.pages.length }] : []),
          { key: 'engine', label: sample.engine, disabled: true },
        ], onClick: ({ key }) => { if (key === 'image') setOriginal(value => !value); if (key === 'replace') onUpload(); if (key === 'reprocess') onReprocess?.(); if (key === 'clear-preview') onClearPreview?.(); if (key.startsWith('zoom-')) setZoom(Number(key.slice(5))); if (key === 'previous') onPage(page - 1); if (key === 'next') onPage(page + 1); } }}><Button type="text" size="small" icon={<MoreOutlined />} aria-label="原文更多操作" /></Dropdown>}
      </div>
    </div>
    <div className="profile-page-scroll">{sample && imagePage ? <>
      <div ref={pageElement} tabIndex={-1} aria-label={selected ? `原文定位：${selected.name}` : '样例原文'} className={`profile-page ${binding && tool === 'draw' ? 'is-drawing' : ''} ${binding && locateRequest?.fieldId === selectedId ? 'is-locating' : ''}`} key={`${sample.id}:${page}`} style={{ aspectRatio: `${original ? imagePage.originalWidth || imagePage.width : imagePage.width}/${original ? imagePage.originalHeight || imagePage.height : imagePage.height}`, width: `${zoom}%`, maxWidth: zoom > 100 ? 'none' : undefined }}
        onPointerDown={event => {
          if (!binding || tool !== 'draw' || !selected) return;
          event.preventDefault();
          const rect = event.currentTarget.getBoundingClientRect();
          origin.current = { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={event => {
          if (!origin.current) return;
          const rect = event.currentTarget.getBoundingClientRect();
          setDraftBox(selectionBox(origin.current, { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height }));
        }}
        onPointerUp={event => {
          if (!origin.current) return;
          const rect = event.currentTarget.getBoundingClientRect();
          const box = selectionBox(origin.current, { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height });
          origin.current = null; setDraftBox(null);
          if (box) onBind(box, page);
        }} onPointerCancel={() => { origin.current = null; setDraftBox(null); }}>
        <img src={original ? imagePage.originalImageUrl || imagePage.imageUrl : imagePage.imageUrl} alt={`${sample.name} 第 ${page} 页`} draggable={false} onLoad={() => setImageError(false)} onError={() => setImageError(true)} />
        {binding && tool === 'text' && sample.blocks.filter(block => block.pageIndex === page - 1).map(block => <button type="button" key={block.ref} className="profile-text-block" style={boxStyle(block.bbox)}
          title={block.text} aria-label={`绑定原文：${block.text}`} disabled={!selected} onClick={() => onBind(paddedBox(block.bbox), page)} />)}
        {!readOnly && !preview && fields.filter(field => field.region && field.page === page).map(field => <button type="button" ref={field.id === selectedId ? selectedRegion : undefined} key={field.id} className={`profile-region ${field.id === selectedId ? 'is-selected' : ''}`} style={boxStyle(shownBox(field.region!))}
          title={field.name} aria-label={`选择字段 ${field.name}`} onClick={() => onSelect(field.id)}><span>{field.id === selectedId ? field.name : fields.indexOf(field) + 1}</span></button>)}
        {resultBox && resultField?.page === page && <div className="profile-result-region" style={boxStyle(resultBox)} />}
        {preview?.region && page === (previewPage || preview.page) && <div className="profile-region is-selected is-assistant-preview" aria-label={`建议位置 ${preview.name}`} style={boxStyle(shownBox(preview.region))}><span>{preview.name} · 建议</span></div>}
        {draftBox && <div className="profile-region is-selected is-draft" style={boxStyle(draftBox)} />}
      </div>
      {imageError && <div role="alert" className="profile-image-error">原文页面加载失败，请重新打开方案或更换样例。</div>}
      <div className="profile-page-caption"><FileSearchOutlined /> {sample.name}<span>{sample.blocks.length} 个文字块</span></div>
    </> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="上传固定版式样例，定位需要提取的字段"><Button onClick={onUpload} type="primary">上传样例</Button></Empty>}</div>
  </section>;
}
