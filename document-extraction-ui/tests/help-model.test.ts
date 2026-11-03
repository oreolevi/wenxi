import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { helpHref, parseHelpMarkdown, readHelpLocation, resolveHelpImage, resolveHelpLink, safeExternalHref, searchHelp, type HelpArticle } from '../src/help/model.ts';

function article(id: string, path: string, markdown: string): HelpArticle {
  return { id, path, markdown, title: markdown.match(/^# (.+)/m)![1], description: '', group: '文析 Studio',
    blocks: parseHelpMarkdown(markdown).filter(block => block.type !== 'heading' || block.level !== 1) };
}

test('帮助中心直接读取本地 Markdown；目录和正文链接均指向有效文章或小节', async () => {
  const summary = await readFile(new URL('../../docs/SUMMARY.md', import.meta.url), 'utf8');
  const paths = [...summary.matchAll(/\]\(([^)]+\.md)\)/g)].map(match => match[1]);
  assert.equal(paths.length, 13);
  assert.equal(new Set(paths).size, paths.length);
  const articles = await Promise.all(paths.map(async (path, i) => article(`doc-${i}`, path, await readFile(new URL(`../../docs/${path}`, import.meta.url), 'utf8'))));
  for (const doc of articles) {
    assert.equal(doc.markdown.split('```').length % 2, 1, `代码围栏完整：${doc.path}`);
    const ids = doc.blocks.filter(block => block.type === 'heading').map(block => block.id);
    assert.equal(new Set(ids).size, ids.length, `章节锚点唯一：${doc.path}`);
    for (const link of doc.markdown.matchAll(/(?<!!)\[([^\]]+)\]\(([^)]+)\)/g)) {
      const resolved = resolveHelpLink(link[2], doc, articles);
      assert(resolved, `文档链接有效：${doc.path} → ${link[2]}`);
      if (resolved.anchor) assert(articles.find(item => item.id === resolved.id)!.blocks.some(block => block.type === 'heading' && block.id === resolved.anchor));
    }
    for (const image of doc.blocks.filter(block => block.type === 'image')) {
      const source = await readFile(new URL(image.src, new URL(`../../docs/${doc.path}`, import.meta.url)), 'utf8');
      assert(source.includes('<svg') && source.includes('<title>'), `图示存在且有文字说明：${image.src}`);
      assert(!source.includes('<script'), '图示不包含执行脚本');
    }
  }
});

test('Markdown 图示保留替代文本，仅允许读取已打包的本地图示', () => {
  const doc = article('concepts', 'getting-started/choose.md', '# 核心概念\n\n![服务、版式与样例关系](../assets/service-model.svg)');
  assert.deepEqual(doc.blocks[0], { type: 'image', src: '../assets/service-model.svg', text: '服务、版式与样例关系' });
  const images = { 'assets/service-model.svg': 'bundled-svg' };
  assert.equal(resolveHelpImage('../assets/service-model.svg', doc, images), 'bundled-svg');
  assert.equal(resolveHelpImage('../assets/missing.svg', doc, images), undefined);
  assert.equal(resolveHelpImage('https://example.com/asset.svg', doc, images), undefined);
  assert.equal(resolveHelpImage('data:image/svg+xml,test', doc, images), undefined);
});

test('Markdown 保留步骤、示例和可复制代码，标题不会从代码块里误提取', () => {
  const blocks = parseHelpMarkdown('# 文析\n\n## 配置字段\n\n1. 上传\n2. 校准\n\n> 提取号码\n\n```bash\n# 这是代码\ncurl -F version=1.0.0\n```\n\n## 配置字段\n\n<script>alert(1)</script>');
  assert.deepEqual(blocks.filter(block => block.type === 'heading').map(block => block.id), ['文析', '配置字段', '配置字段-2']);
  assert.deepEqual(blocks.find(block => block.type === 'list'), { type: 'list', ordered: true, items: ['上传', '校准'] });
  assert.deepEqual(blocks.find(block => block.type === 'code'), { type: 'code', language: 'bash', text: '# 这是代码\ncurl -F version=1.0.0' });
  assert.deepEqual(blocks.at(-1), { type: 'paragraph', text: '<script>alert(1)</script>' }, 'HTML 仅作为普通文本交给 React，不使用 innerHTML');
});

test('中文和英文全文检索可以定位小节，标题命中优先，无结果时不造答案', () => {
  const docs = [article('a', 'a.md', '# 创建服务\n\n## 发布前检查\n\n字段未定位，需要校准。\n\n## 字段表\n\nExcel 可以提供要求。'), article('b', 'b.md', '# Excel 字段表\n\n## 读取字段\n\n上传字段表后查看字段。')];
  assert.equal(searchHelp(docs, '  excel  ')[0].article.id, 'b');
  assert.equal(searchHelp(docs, '未定位')[0].anchor, '发布前检查');
  assert.equal(searchHelp(docs, 'Excel 要求')[0].article.id, 'a');
  assert.deepEqual(searchHelp(docs, '不存在的关键词'), []);
  assert.deepEqual(searchHelp(docs, '  '), []);
});

test('文章和锚点支持独立链接；链接不会执行任意协议', () => {
  const docs = [article('service', 'studio/services.md', '# 服务\n\n## 配置字段'), article('review', 'business/review.md', '# 核验\n\n## 来源')];
  assert.deepEqual(resolveHelpLink('../business/review.md#来源', docs[0], docs), { id: 'review', anchor: '来源' });
  assert.deepEqual(resolveHelpLink('#配置字段', docs[0], docs), { id: 'service', anchor: '配置字段' });
  assert.equal(resolveHelpLink('javascript:alert(1)', docs[0], docs), undefined);
  assert.equal(safeExternalHref('javascript:alert(1)'), undefined);
  assert.equal(safeExternalHref('data:text/html,test'), undefined);
  assert.equal(safeExternalHref('https://example.com/help'), 'https://example.com/help');
  assert.equal(helpHref('services', '配置字段'), '?page=help&doc=services#%E9%85%8D%E7%BD%AE%E5%AD%97%E6%AE%B5');
  assert.deepEqual(readHelpLocation('?page=help&doc=services', '#%E9%85%8D%E7%BD%AE%E5%AD%97%E6%AE%B5'), { id: 'services', anchor: '配置字段' });
  assert.deepEqual(readHelpLocation('?page=help', '#%broken'), { id: 'welcome', anchor: '' });
});
