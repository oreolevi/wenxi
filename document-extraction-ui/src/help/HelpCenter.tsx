import { Fragment, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { App, Button, Drawer, Image, Input, Modal, Tooltip, type InputRef } from 'antd';
import { ArrowLeftOutlined, ArrowRightOutlined, BookOutlined, CheckOutlined, CopyOutlined, ExportOutlined, FileTextOutlined, FullscreenOutlined, LinkOutlined, MenuOutlined, SearchOutlined } from '@ant-design/icons';
import { BrandMark } from '../components/BrandMark.tsx';
import { BrandName } from '../components/BrandName.tsx';
import { helpArticles } from './content.ts';
import { helpImages } from './images.ts';
import { helpGroups, helpHref, plainHelpText, readHelpLocation, resolveHelpImage, resolveHelpLink, safeExternalHref, searchHelp, type HelpArticle, type HelpBlock } from './model.ts';

type Props = { initialDoc?: string; onClose?: () => void };
const isPlainClick = (event: MouseEvent) => event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;

function CodeBlock({ language, text }: { language: string; text: string }) {
  const [copied, setCopied] = useState(false); const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const { message } = App.useApp();
  useEffect(() => () => clearTimeout(timer.current), []);
  async function copy() {
    try { await navigator.clipboard.writeText(text); setCopied(true); clearTimeout(timer.current); timer.current = setTimeout(() => setCopied(false), 1800); }
    catch { void message.info('无法自动复制，请选中代码复制'); }
  }
  return <div className="help-code"><div className="help-code-bar"><span>{language || '示例'}</span><Button type="text" size="small" icon={copied ? <CheckOutlined /> : <CopyOutlined />} onClick={copy} aria-label={copied ? '已复制代码' : '复制代码'}>{copied ? '已复制' : '复制'}</Button></div><pre><code>{text}</code></pre></div>;
}

export function HelpCenter({ initialDoc = 'welcome', onClose }: Props) {
  const embedded = !!onClose;
  const [current, setCurrent] = useState(() => embedded ? { id: initialDoc, anchor: '' } : readHelpLocation(location.search, location.hash));
  const article = helpArticles.find(item => item.id === current.id);
  const [menuOpen, setMenuOpen] = useState(false); const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState(''); const [selectedResult, setSelectedResult] = useState(0);
  const [activeHeading, setActiveHeading] = useState('');
  const [expandedDiagram, setExpandedDiagram] = useState<string>();
  const reading = useRef<HTMLDivElement>(null); const body = useRef<HTMLElement>(null); const searchInput = useRef<InputRef>(null);
  const resultRefs = useRef<Array<HTMLAnchorElement | null>>([]);
  const { message } = App.useApp();
  const results = useMemo(() => searchHelp(helpArticles, query), [query]);
  const visibleResults = query.trim() ? results : helpArticles.filter(item => ['extraction', 'quickstart', 'api'].includes(item.id)).map(article => ({ article, anchor: '', heading: '', excerpt: article.description, score: 0 }));
  const headings = article?.blocks.filter((block): block is Extract<HelpBlock, { type: 'heading' }> => block.type === 'heading') || [];
  const index = helpArticles.findIndex(item => item.id === current.id);
  const previous = helpArticles[index - 1]; const next = helpArticles[index + 1];

  function navigate(id: string, anchor = '', event?: MouseEvent) {
    if (event && !isPlainClick(event)) return;
    event?.preventDefault(); setCurrent({ id, anchor }); setMenuOpen(false); setSearchOpen(false);
    if (!embedded) window.history.pushState(null, '', helpHref(id, anchor));
  }
  function openSearch() { setSelectedResult(0); setSearchOpen(true); }
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); openSearch(); }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, []);
  useEffect(() => {
    if (embedded) return;
    const restore = () => setCurrent(readHelpLocation(location.search, location.hash));
    window.addEventListener('popstate', restore); window.addEventListener('hashchange', restore);
    return () => { window.removeEventListener('popstate', restore); window.removeEventListener('hashchange', restore); };
  }, [embedded]);
  useEffect(() => {
    if (!embedded) document.title = article?.id === 'welcome'
      ? '文析 · 帮助中心' : `文析 · 帮助中心 · ${article?.title || '未找到文章'}`;
    const frame = requestAnimationFrame(() => {
      const scroller = reading.current; if (!scroller) return;
      const target = current.anchor ? Array.from(body.current?.querySelectorAll<HTMLElement>('[id]') || []).find(node => node.id === current.anchor) : null;
      scroller.scrollTo({ top: target ? scroller.scrollTop + target.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 28 : 0, behavior: 'instant' });
      (target || body.current?.querySelector<HTMLElement>('h1'))?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [current, article, embedded]);
  useEffect(() => {
    const scroller = reading.current; if (!scroller) return;
    const update = () => {
      const elements = Array.from(body.current?.querySelectorAll<HTMLElement>('h2[id],h3[id]') || []);
      const boundary = scroller.getBoundingClientRect().top + 100;
      const visible = elements.filter(element => element.getBoundingClientRect().top <= boundary);
      setActiveHeading((visible.at(-1) || elements[0])?.id || '');
    };
    update(); scroller.addEventListener('scroll', update, { passive: true });
    return () => scroller.removeEventListener('scroll', update);
  }, [article]);
  useEffect(() => { resultRefs.current[selectedResult]?.scrollIntoView({ block: 'nearest' }); }, [selectedResult]);

  async function copyLink() {
    const url = new URL(helpHref(current.id, current.anchor), location.href);
    try { await navigator.clipboard.writeText(url.href); void message.success('文章链接已复制'); }
    catch { void message.info('可打开独立页面后，复制浏览器地址'); }
  }
  function internalLink(id: string, label: ReactNode, className = '', anchor = '') {
    return <a className={className} href={helpHref(id, anchor)} onClick={event => navigate(id, anchor, event)}>{label}</a>;
  }
  function inline(text: string, owner: HelpArticle): ReactNode[] {
    const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^\s)]+\))/g;
    return text.split(pattern).filter(Boolean).map((part, i) => {
      if (part.startsWith('`') && part.endsWith('`')) return <code key={i}>{part.slice(1, -1)}</code>;
      if (part.startsWith('**') && part.endsWith('**')) return <strong key={i}>{part.slice(2, -2)}</strong>;
      const link = part.match(/^\[([^\]]+)\]\(([^\s)]+)\)$/);
      if (link) {
        const target = resolveHelpLink(link[2], owner, helpArticles);
        if (target) return <Fragment key={i}>{internalLink(target.id, link[1], '', target.anchor)}</Fragment>;
        const href = safeExternalHref(link[2]);
        return href ? <a key={i} href={href} target="_blank" rel="noreferrer">{link[1]}</a> : <span key={i}>{link[1]}</span>;
      }
      return part;
    });
  }
  function renderBlock(block: HelpBlock, key: number) {
    if (!article) return null;
    if (block.type === 'heading') {
      const content = <>{inline(block.text, article)}<a className="help-heading-link" href={helpHref(article.id, block.id)} onClick={event => navigate(article.id, block.id, event)} aria-label={`链接到${block.text}`}><LinkOutlined /></a></>;
      return block.level <= 2 ? <h2 key={key} id={block.id} tabIndex={-1}>{content}</h2> : <h3 key={key} id={block.id} tabIndex={-1}>{content}</h3>;
    }
    if (block.type === 'code') return <CodeBlock key={key} language={block.language} text={block.text} />;
    if (block.type === 'image') {
      const src = resolveHelpImage(block.src, article, helpImages);
      return src ? <figure key={key} className="help-figure"><Image src={src} alt={block.text} preview={{ open: expandedDiagram === src, onOpenChange: open => setExpandedDiagram(open ? src : undefined) }} />
        <figcaption><span>{block.text}</span><Button type="text" size="small" icon={<FullscreenOutlined />} aria-label={`放大图示：${block.text}`} onClick={() => setExpandedDiagram(src)}>放大</Button></figcaption></figure> : null;
    }
    if (block.type === 'list') {
      const items = block.items.map((item, i) => <li key={i}>{inline(item, article)}</li>);
      return block.ordered ? <ol key={key}>{items}</ol> : <ul key={key}>{items}</ul>;
    }
    if (block.type === 'quote') return <blockquote key={key}><span className="help-example-label">示例</span><p>{inline(block.text, article)}</p></blockquote>;
    return <p key={key}>{inline(block.text, article)}</p>;
  }
  const navigation = <nav className="help-navigation" aria-label="帮助章节">{helpGroups.map(group => <div className="help-nav-group" key={group}><h2>{group}</h2>{helpArticles.filter(item => item.group === group).map(item =>
    <a key={item.id} href={helpHref(item.id)} aria-current={article?.id === item.id ? 'page' : undefined} onClick={event => navigate(item.id, '', event)}>{item.title}</a>)}</div>)}</nav>;
  const toc = <nav aria-label="本页目录">{headings.map(heading => <a key={heading.id} className={`${heading.level > 2 ? 'is-nested' : ''} ${activeHeading === heading.id ? 'is-active' : ''}`} href={helpHref(current.id, heading.id)} aria-current={activeHeading === heading.id ? 'location' : undefined} onClick={event => navigate(current.id, heading.id, event)}>{plainHelpText(heading.text)}</a>)}</nav>;

  return <div className="help-center">
    <a className="help-skip-link" href="#help-content" onClick={event => { event.preventDefault(); body.current?.querySelector<HTMLElement>('h1')?.focus(); }}>跳转到正文</a>
    <header className="help-header"><div className="help-brand"><Button type="text" className="help-mobile-menu" icon={<MenuOutlined />} aria-label="打开章节目录" onClick={() => setMenuOpen(true)} /><a href={helpHref('welcome')} onClick={event => navigate('welcome', '', event)} aria-label="文析帮助首页"><BrandMark /><BrandName /></a><span className="help-brand-divider" /><span>帮助中心</span></div>
      <button className="help-search-trigger" onClick={openSearch} aria-label="搜索帮助中心"><SearchOutlined /><span>搜索文档</span><kbd>⌘ K</kbd></button>
      {onClose ? <Button className="help-return" type="text" icon={<ArrowLeftOutlined />} onClick={onClose}>返回工作区</Button> : <Button className="help-return" type="text" href="?page=profiles" icon={<ArrowLeftOutlined />}>进入文析 Studio</Button>}
    </header>
    <div className="help-layout"><aside className="help-sidebar">{navigation}</aside>
      <div className="help-reading" ref={reading}><div className={`help-reading-inner ${article?.id === 'welcome' ? 'is-welcome' : ''}`}>
        <main className="help-article" ref={body} id="help-content"><div className="help-breadcrumb"><span>{article?.group || '帮助中心'}</span><span>/</span><span>{article?.id === 'welcome' ? '概览' : article?.title || '文章不存在'}</span></div>
          {article ? <><div className="help-article-title"><h1 tabIndex={-1}>{article.title}</h1><Tooltip title="复制文章链接"><Button type="text" icon={<LinkOutlined />} aria-label="复制文章链接" onClick={copyLink} /></Tooltip></div>
            <details className="help-mobile-toc"><summary>本页目录</summary>{toc}</details><div className="help-prose">{article.blocks.map(renderBlock)}</div>
            <footer className="help-article-footer"><span>文析 · 帮助中心</span>{embedded && <a href={helpHref(article.id)} target="_blank" rel="noreferrer"><ExportOutlined /> 在独立页面阅读</a>}</footer>
            <nav className="help-page-navigation" aria-label="前后章节">{previous ? internalLink(previous.id, <><small><ArrowLeftOutlined /> 上一篇</small><strong>{previous.title}</strong></>) : <span />}{next ? internalLink(next.id, <><small>下一篇 <ArrowRightOutlined /></small><strong>{next.title}</strong></>) : <span />}</nav>
          </> : <div className="help-not-found"><BookOutlined /><h1 tabIndex={-1}>未找到这篇指南</h1><p>链接可能已变更，请从章节目录或搜索中查找。</p>{internalLink('welcome', '返回帮助首页')}</div>}
        </main>
        <aside className="help-toc"><span className="help-toc-label">本页内容</span>{toc}<div className="help-toc-support"><span>相关文档</span>{internalLink('faq', <>常见问题 <ArrowRightOutlined /></>)}</div></aside>
      </div></div>
    </div>
    <Drawer title="章节目录" className="help-menu-drawer" placement="left" size={280} open={menuOpen} onClose={() => setMenuOpen(false)}>{navigation}</Drawer>
    <Modal title="搜索帮助中心" className="help-search-modal" open={searchOpen} onCancel={() => setSearchOpen(false)} footer={null} width={640} destroyOnHidden afterOpenChange={open => { if (open) searchInput.current?.focus(); }}>
      <Input ref={searchInput} prefix={<SearchOutlined />} size="large" placeholder="搜索，例如：Excel、原文高亮、发布" value={query} aria-label="搜索帮助中心" aria-controls="help-search-results" aria-activedescendant={visibleResults.length ? `help-search-result-${selectedResult}` : undefined} onChange={event => { setQuery(event.target.value); setSelectedResult(0); }} onKeyDown={event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setSelectedResult(value => visibleResults.length ? (value + (event.key === 'ArrowDown' ? 1 : visibleResults.length - 1)) % visibleResults.length : 0); }
        if (event.key === 'Enter' && visibleResults[selectedResult]) { event.preventDefault(); const result = visibleResults[selectedResult]; navigate(result.article.id, result.anchor); }
      }} allowClear />
      <div className="help-search-meta" role="status">{query.trim() ? `找到 ${results.length} 篇指南` : '常用指南'}</div>
      <div className="help-search-results" id="help-search-results">{visibleResults.map((result, i) =>
        <a key={result.article.id} id={`help-search-result-${i}`} ref={node => { resultRefs.current[i] = node; }} className={i === selectedResult ? 'is-selected' : ''} href={helpHref(result.article.id, result.anchor)} onMouseMove={() => setSelectedResult(i)} onClick={event => navigate(result.article.id, result.anchor, event)}><FileTextOutlined /><span><small>{result.article.group}{result.heading && ` / ${result.heading}`}</small><strong>{result.article.title}</strong><p>{result.excerpt}</p></span><ArrowRightOutlined /></a>)}
        {query.trim() && !results.length && <div className="help-search-empty"><SearchOutlined /><strong>无匹配文档</strong><p>请调整关键词，或使用左侧目录。</p></div>}
      </div><div className="help-search-hint"><span>↑ ↓ 选择 · Enter 打开</span><span>Esc 关闭</span></div>
    </Modal>
  </div>;
}
