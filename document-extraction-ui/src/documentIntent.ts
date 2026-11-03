export type OutputMode = 'fields' | 'fulltext' | 'both';
/** Explicit conversion requests stay local; semantic field selection still uses the configured extractor. */
export function documentOutputMode(prompt: string): OutputMode {
  const text = prompt.trim();
  const fullText = !/(?:不要|不用|无需|不需要)[^，。；\n]{0,10}(?:全文|markdown)/i.test(text)
    && !/(?:怎么|如何|什么是|能不能|可不可以|支持|是否).*(?:markdown|全文转换)/i.test(text)
    && /markdown|(?:全文|整份|全部内容).*(?:转换|转成|转为|转写|导出|转录)|(?:转换|转写|转录|导出).*(?:全文|整份|全部内容)/i.test(text);
  if (!fullText) return 'fields';
  return /提取|抽取|字段|要素/.test(text) ? 'both' : 'fulltext';
}
