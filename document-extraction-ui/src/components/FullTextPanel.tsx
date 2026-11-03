import { useEffect, useState } from 'react';
import { Alert, Button, Dropdown, Empty, Skeleton, Space, Tooltip } from 'antd';
import { CodeOutlined, CopyOutlined, DownloadOutlined, ReadOutlined } from '@ant-design/icons';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import type { Material } from '../types.ts';
import './full-text.css';

interface Content { markdown: string; assetBaseUrl: string }
export function FullTextDocument({ markdown, assetBaseUrl }: Content) {
  const localImage = (src?: string) => src && /^\/api\/(?:documents|history)\//.test(assetBaseUrl)
    && /^images\/[A-Za-z0-9_.-]+\.(?:png|jpe?g|webp|gif|svg)$/i.test(src) ? assetBaseUrl + src : undefined;
  return <article className="markdown-document"><Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw, rehypeSanitize]} components={{
    img: ({ src, alt }) => { const safe = localImage(src); return safe ? <img src={safe} alt={alt || '文档图片'} loading="lazy" /> : <span className="markdown-image-missing">{alt || '图片'}</span>; },
    a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>,
  }}>{markdown}</Markdown></article>;
}
export function FullTextPanel({ file, onNotify, onRequest }: { file?: Material; onNotify: (message: string) => void; onRequest: () => void }) {
  const [content, setContent] = useState<Content>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [source, setSource] = useState(false);
  const [retry, setRetry] = useState(0);
  const url = file?.parsed?.fullText?.url;
  useEffect(() => {
    setSource(false); setError(''); setContent(undefined);
    if (file?.fullText !== undefined) { setLoading(false); setContent({ markdown: file.fullText, assetBaseUrl: '' }); return; }
    if (!url) { setLoading(false); return; }
    if (!/^\/api\/(?:documents|history)\//.test(url)) { setError('全文地址无效，请重新解析。'); setLoading(false); return; }
    const controller = new AbortController();
    setLoading(true);
    void fetch(url, { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error('全文暂不可用，请重试。');
      const value = await response.json() as Content;
      if (typeof value.markdown !== 'string' || typeof value.assetBaseUrl !== 'string') throw new Error('全文结果无效，请重新解析。');
      if (!controller.signal.aborted) setContent(value);
    }).catch(error => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : '读取全文失败'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [file?.id, url, file?.fullText, retry]);
  const download = () => {
    if (!content) return;
    const url = URL.createObjectURL(new Blob([content.markdown], { type: 'text/markdown;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `${file?.name.replace(/\.[^.]+$/, '') || 'document'}.md`; link.click(); URL.revokeObjectURL(url);
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(content?.markdown || ''); onNotify('Markdown 已复制'); }
    catch { onNotify('复制失败，可以下载 Markdown 文件。'); }
  };
  return <section className="full-text-panel" aria-label="全文内容">
    {loading ? <div className="full-text-loading"><Skeleton active paragraph={{ rows: 9 }} /></div> : error ? <Alert type="error" title={error} action={<Button size="small" onClick={() => setRetry(value => value + 1)}>重试</Button>} /> : content ? <>
      <div className="full-text-actions"><Tooltip title={source ? '查看排版预览' : '查看 Markdown 源码'}><Button type="text" size="small" icon={source ? <ReadOutlined /> : <CodeOutlined />} aria-pressed={source} onClick={() => setSource(value => !value)}>{source ? '预览' : '源码'}</Button></Tooltip><Space size={3}><Tooltip title="复制 Markdown"><Button type="text" size="small" icon={<CopyOutlined />} aria-label="复制全文 Markdown" onClick={() => void copy()} /></Tooltip><Dropdown menu={{ items: [{ key: 'markdown', label: 'Markdown（.md）' }, ...(file?.parsed?.fullText?.packageUrl ? [{ key: 'package', label: 'Markdown 与图片（.zip）' }] : [])], onClick: ({ key }) => { if (key === 'markdown') download(); else if (file?.parsed?.fullText) { const link = document.createElement('a'); link.href = file.parsed.fullText.packageUrl; link.download = `${file.name.replace(/\.[^.]+$/, '')}.zip`; link.click(); } } }}><Button type="text" size="small" icon={<DownloadOutlined />}>下载</Button></Dropdown></Space></div>
      <div className="full-text-scroll">{source ? <pre className="markdown-source">{content.markdown}</pre> : <FullTextDocument {...content} />}</div>
    </> : <div className="full-text-empty"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="这份记录尚未生成全文"><Button onClick={onRequest}>转换为全文</Button></Empty></div>}
  </section>;
}
