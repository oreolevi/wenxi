export type HelpGroup = '入门指南' | '文析' | '文析 Studio' | '参考';
export type HelpBlock =
  | { type: 'heading'; level: number; text: string; id: string }
  | { type: 'paragraph' | 'quote'; text: string }
  | { type: 'image'; src: string; text: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'code'; language: string; text: string };
export interface HelpArticle {
  id: string; path: string; title: string; description: string; group: HelpGroup;
  markdown: string; blocks: HelpBlock[];
}
export const helpGroups: HelpGroup[] = ['入门指南', '文析', '文析 Studio', '参考'];
export function headingId(text: string) {
  return text.toLocaleLowerCase().replace(/[`*]/g, '').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'section';
}
/** Supported authoring syntax is intentionally small; raw HTML is always rendered as text. */
export function parseHelpMarkdown(markdown: string): HelpBlock[] {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const blocks: HelpBlock[] = []; const ids = new Map<string, number>();
  for (let i = 0; i < lines.length;) {
    const line = lines[i].trim();
    if (!line) { i++; continue; }
    const illustration = line.match(/^!\[([^\]]*)\]\(([^\s)]+)\)$/);
    if (illustration) { blocks.push({ type: 'image', text: illustration[1], src: illustration[2] }); i++; continue; }
    if (line.startsWith('```')) {
      const language = line.slice(3).trim(); const content: string[] = []; i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) content.push(lines[i++]);
      blocks.push({ type: 'code', language, text: content.join('\n') }); i++; continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const base = headingId(heading[2]); const count = (ids.get(base) || 0) + 1; ids.set(base, count);
      blocks.push({ type: 'heading', level: heading[1].length, text: heading[2], id: count === 1 ? base : `${base}-${count}` }); i++; continue;
    }
    const list = line.match(/^(\d+\.|[-*])\s+(.+)$/);
    if (list) {
      const ordered = /^\d/.test(list[1]); const items: string[] = [];
      while (i < lines.length) {
        const item = lines[i].trim().match(/^(\d+\.|[-*])\s+(.+)$/);
        if (!item || /^\d/.test(item[1]) !== ordered) break;
        items.push(item[2]); i++;
      }
      blocks.push({ type: 'list', ordered, items }); continue;
    }
    if (line.startsWith('>')) {
      const content: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) content.push(lines[i++].trim().replace(/^>\s?/, ''));
      blocks.push({ type: 'quote', text: content.join('\n') }); continue;
    }
    const content = [line]; i++;
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|```|>|!\[|\d+\.\s|[-*]\s)/.test(lines[i].trim())) content.push(lines[i++].trim());
    blocks.push({ type: 'paragraph', text: content.join('\n') });
  }
  return blocks;
}
export function helpHref(id: string, anchor = '') {
  return `?page=help&doc=${encodeURIComponent(id)}${anchor ? `#${encodeURIComponent(anchor)}` : ''}`;
}
export function readHelpLocation(search: string, hash = '') {
  let anchor = ''; try { anchor = decodeURIComponent(hash.slice(1)); } catch { /* Invalid hashes do not prevent reading. */ }
  return { id: new URLSearchParams(search).get('doc') || 'welcome', anchor };
}
export function resolveHelpLink(href: string, article: HelpArticle, articles: HelpArticle[]) {
  if (/^[a-z][\w+.-]*:/i.test(href) || href.startsWith('//')) return undefined;
  const url = new URL(href, `https://help.local/${article.path}`);
  const target = articles.find(item => `/${item.path}` === url.pathname);
  if (!target) return undefined;
  let anchor = ''; try { anchor = decodeURIComponent(url.hash.slice(1)); } catch { /* Ignore invalid anchors. */ }
  return { id: target.id, anchor };
}
export function safeExternalHref(href: string) { return /^https?:\/\//i.test(href) ? href : undefined; }
export function resolveHelpImage(src: string, article: HelpArticle, images: Record<string, string>) {
  if (/^[a-z][\w+.-]*:/i.test(src) || src.startsWith('//')) return undefined;
  const url = new URL(src, `https://help.local/${article.path}`);
  return url.origin === 'https://help.local' ? images[url.pathname.slice(1)] : undefined;
}
export function plainHelpText(text: string) { return text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[`*#>]/g, '').trim(); }
export interface HelpSearchResult { article: HelpArticle; anchor: string; heading: string; excerpt: string; score: number }
export function searchHelp(articles: HelpArticle[], query: string): HelpSearchResult[] {
  const terms = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  return articles.flatMap(article => {
    let heading = ''; let anchor = ''; const sections = [{ text: article.title, heading: '', anchor: '' }];
    for (const block of article.blocks) {
      if (block.type === 'heading') { heading = block.text; anchor = block.id; continue; }
      const text = plainHelpText(block.type === 'list' ? block.items.join(' ') : block.text);
      sections.push({ text, heading, anchor });
    }
    const all = `${article.title} ${article.description} ${article.markdown}`.toLocaleLowerCase();
    if (!terms.every(term => all.includes(term))) return [];
    const best = sections.map(section => ({ ...section, score: terms.reduce((score, term) => score + (section.text.toLocaleLowerCase().includes(term) ? 1 : 0), 0) })).sort((a, b) => b.score - a.score)[0];
    const match = best.text.toLocaleLowerCase().indexOf(terms[0]); const start = Math.max(0, match - 28);
    return [{ article, anchor: best.anchor, heading: best.heading, excerpt: `${start ? '…' : ''}${best.text.slice(start, start + 110)}${best.text.length > start + 110 ? '…' : ''}`, score: best.score + terms.reduce((score, term) => score + (article.title.toLocaleLowerCase().includes(term) ? 5 : 0), 0) }];
  }).sort((a, b) => b.score - a.score).slice(0, 12);
}
