import { fixtures } from './fixtures.ts';
import { reviewLabels } from './types.ts';
import type { ExtractedField, Material, Scenario } from './types.ts';

export const acceptedExtensions = ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'doc', 'docx', 'txt', 'md', 'zip', 'xlsx'];
export const fileAccept = acceptedExtensions.map(ext => `.${ext}`).join(',');
export const MAX_FILES = 6;
export const MAX_SIZE = 30 * 1024 * 1024;

export function getFileKind(name: string): Material['kind'] {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  if (['txt', 'md'].includes(ext)) return 'text';
  if (['png', 'jpg', 'jpeg', 'webp'].includes(ext)) return 'image';
  if (ext === 'pdf') return 'pdf';
  if (ext === 'zip') return 'archive';
  if (ext === 'xlsx') return 'spreadsheet';
  return 'word';
}

export function requestedNames(prompt: string): string[] {
  const array = prompt.match(/\[[\s\S]*?\]/)?.[0];
  if (array) {
    try {
      const fields: unknown = JSON.parse(array);
      if (Array.isArray(fields) && fields.length > 0 && fields.length <= 30 && fields.every(field => typeof field === 'string' && field.trim().length > 0 && field.length <= 40)) return fields.map(field => (field as string).trim());
    } catch { /* Continue with natural-language parsing. */ }
  }
  const numbered = prompt.split(/\r?\n/).map(line => line.match(/^\s*\d+[.、．)]\s*(.+)$/)?.[1]?.trim()).filter((name): name is string => !!name && name.length <= 40);
  if (numbered.length) return numbered.slice(0, 30);
  let text = prompt
    .replace(/^(?:(?:请|帮我|帮忙|我需要|我想要|我要)\s*)+/, '')
    .replace(/^(?:再|另外|重新)?(?:提取|增加|加上|添加|补充|只保留|只要|仅提取|只提取|删除|去掉)\s*/, '')
    .split(/[。；;\n]/)[0];
  text = text.replace(/^(?:把|将)(.+?)(?:去掉|删除)$/, '$1')
    .replace(/^(?:这份|这张|这个|当前|该|本)[^、，,]{0,30}?(?:中|里|内)的?/, '')
    .replace(/(?:，|,)?(?:整理成|生成|导出|并|金额统一|统一为|统一成|结果).*$/, '')
    .replace(/以下字段[：:]?/, '').replace(/[“”"']/g, '').trim();
  if (/^(?:帮我找|找|查找|读取|抽取)/.test(text) || /谁|何时|哪个|多少|什么/.test(text)) return [];
  const parts: string[] = [];
  let current = '', depth = 0;
  for (const char of text.replace(/以及|还有/g, '、')) {
    if ('（('.includes(char)) depth++;
    if ('）)'.includes(char)) depth = Math.max(0, depth - 1);
    if (!depth && '、，,和及与'.includes(char)) { parts.push(current); current = ''; }
    else current += char;
  }
  parts.push(current);
  return parts.map(item => item.trim().replace(/[：:]$/, '')).filter(item => item && item.length <= 40 && !/^(?:合同|发票)?(?:信息|关键信息|主要信息|要素)$/.test(item));
}

export function mergeFields(previous: ExtractedField[], next: ExtractedField[], prompt: string): ExtractedField[] {
  const matches = (old: ExtractedField, field: ExtractedField) => (old.unitId || '') === (field.unitId || '') && (old.key === field.key || old.aliases.includes(field.name) || field.aliases.includes(old.name));
  if (previous.length && /去掉|删除|不要/.test(prompt)) {
    return previous.filter(field => !next.some(item => item.key === field.key || item.aliases.some(alias => field.aliases.includes(alias))));
  }
  if (previous.length && !/只要|只保留|仅提取|只提取|重新提取/.test(prompt)) {
    return [...previous.map(old => {
      const incoming = next.find(field => matches(old, field));
      if (!incoming || ['confirmed', 'corrected'].includes(old.status)) return old;
      if (['missing', 'rejected', 'visual_required'].includes(incoming.status) && ['pending', 'confirmed', 'corrected'].includes(old.status)) return old;
      return incoming;
    }), ...next.filter(field => !previous.some(old => matches(old, field)))];
  }
  return next.map(field => previous.find(old => ['confirmed', 'corrected'].includes(old.status) && matches(old, field)) || field);
}

function missingField(name: string): ExtractedField {
  return { key: `custom-${name}`, name, value: '', raw: '', page: null, ref: null,
    aliases: [name], note: '示例材料未包含这一字段，需人工补充或更换材料。', status: 'missing' };
}

export function matchDefinitions(prompt: string, scenario: Scenario): ExtractedField[] {
  const defs = fixtures[scenario].fields;
  const found = defs.filter(field => field.aliases.some(alias => prompt.includes(alias)));
  if (/地址/.test(prompt) && !found.some(field => ['address', 'registered'].includes(field.key))) {
    const address = defs.find(field => field.key === 'address');
    if (address) found.push(address);
  }
  for (const name of requestedNames(prompt)) {
    if (found.some(field => field.aliases.some(alias => name.includes(alias) || alias.includes(name)))) continue;
    if (/提取|所有|全部|信息|内容|表格|字段|表|元|核对|正确|保留/.test(name)) continue;
    found.push(missingField(name));
  }
  const result = !found.length && /全部|所有|关键信息/.test(prompt) ? defs.slice(0, 5) : found;
  return result.map(field => ({ ...field, aliases: [...field.aliases], status: field.ref ? 'pending' : 'missing' }));
}

export function extractText(material: Material, prompt: string): ExtractedField[] {
  const names = requestedNames(prompt);
  const lines = (material.text || '').split(/\r?\n/);
  const defs = [...fixtures.application.fields, ...fixtures.contract.fields];
  const requested = names.length ? names : defs.filter(field => field.aliases.some(alias => prompt.includes(alias))).map(field => field.name);
  return [...new Set(requested)].map(name => {
    const def = defs.find(field => field.aliases.some(alias => name.includes(alias) || alias === name));
    const aliases = [...new Set([name, ...(def?.aliases || [])])].sort((a, b) => b.length - a.length);
    for (let index = 0; index < lines.length; index++) {
      for (const alias of aliases) {
        const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const match = lines[index].match(new RegExp(`^\\s*${escaped}\\s*[：:]\\s*(.+?)\\s*$`));
        if (match) return { ...missingField(name), key: `text-${name}`, value: match[1], raw: match[1],
          page: 1, ref: `line-${index}`, status: 'pending' as const, note: '' };
      }
    }
    return { ...missingField(name), key: `text-${name}`, note: '未匹配到“字段名：内容”的文字行。' };
  });
}

/** Local prototype adapter. Replace this function with a real extraction API adapter later. */
export function extractMaterial(material: Material, prompt: string): Material {
  if (material.kind === 'spreadsheet') return material;
  if (material.kind !== 'demo' && material.kind !== 'text') return { ...material, results: [], processed: true };
  const previous = material.results || [];
  const next = material.kind === 'demo' && material.scenario ? matchDefinitions(prompt, material.scenario) : extractText(material, prompt);
  const results = mergeFields(previous, next, prompt);
  return { ...material, results, processed: true };
}

export function reviewField(field: ExtractedField, value?: string): ExtractedField {
  if (value !== undefined) return { ...field, value, edited: true, status: 'corrected' };
  return field.status !== 'pending' ? field : { ...field, status: field.edited ? 'corrected' : 'confirmed' };
}

export function exportRecords(materials: Material[]) {
  return materials.flatMap(material => (material.results || []).map(field => ({
    file_name: material.name,
    source_type: material.kind === 'demo' ? '内置示例（演示数据）' : material.parsed ? `${material.parsed.engine} · ${material.parsed.extractor === 'deepseek' ? (material.parsed.model || 'DeepSeek') + ' 语义提取' : '字段标签匹配'}` : material.kind === 'text' ? '本地文本标签匹配' : '真实附件',
    field: field.name, value: field.value, raw_value: field.raw,
    source_page: field.page, source_ref: field.ref, review_status: reviewLabels[field.status],
    has_evidence: !!field.ref && field.kind !== 'visual', note: field.note || '', source_boxes: field.evidence || [],
    evidence_role: field.kind === 'visual' ? 'image_context' : field.kind === 'judgment' ? 'reasoning_support' : 'value',
    model_call_id: field.modelCallId,
    result_kind: field.kind || 'text', validation_status: field.validationStatus || (field.ref ? 'passed' : 'missing'),
    extraction_requirement: field.requirement,
    source_items: field.items, table: field.table, decision: field.decision, validation_issues: field.issues || [],
    recognition_candidates: field.candidates || [],
  })));
}

export function csvCell(value: unknown): string {
  let text = String(value ?? '');
  if (/^\s*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function createExport(materials: Material[], format: 'csv' | 'json') {
  const records = exportRecords(materials);
  if (format === 'json') return { name: '文档提取结果.json', type: 'application/json;charset=utf-8',
    content: JSON.stringify({ schema_version: 2, prototype: materials.some(file => file.kind === 'demo'), created_at: new Date().toISOString(),
      documents: materials.flatMap(file => file.parsed ? [{ file_name: file.name, document_id: file.parsed.id,
        schema_version: file.parsed.schemaVersion, engine: file.parsed.engine, tier: file.parsed.tier,
        extractor: file.parsed.extractor, model: file.parsed.model, text_sources: file.parsed.textSources,
        requirements: file.parsed.requirements }] : []),
      model_calls: materials.flatMap(file => file.parsed?.modelCall ? [file.parsed.modelCall] : []), records }, null, 2) };
  const headings = ['文件名', '数据来源', '字段', '核定或提取值', '原始值', '来源页码', '原文定位标识', '核验状态', '有无原文依据', '说明'];
  const keys = ['file_name', 'source_type', 'field', 'value', 'raw_value', 'source_page', 'source_ref', 'review_status', 'has_evidence', 'note'] as const;
  return { name: '文档提取结果.csv', type: 'text/csv;charset=utf-8', content: '\ufeff' + [headings.map(csvCell).join(','),
    ...records.map(record => keys.map(key => csvCell(record[key])).join(','))].join('\r\n') };
}

export function assistantReply(materials: Material[]): string {
  const count = materials.reduce((sum, material) => sum + (material.results?.length || 0), 0);
  const pending = materials.filter(material => !['demo', 'text'].includes(material.kind)).length;
  const archives = materials.filter(material => material.kind === 'archive').length;
  if (!count) {
    if (archives) return archives === materials.length ? 'ZIP 已添加，解包与批量识别待接入。' : '附件已添加，OCR 提取与 ZIP 解包待接入。';
    return pending ? '附件可预览，当前未接入 OCR 提取。' : '未匹配到字段，可调整字段名称后重试。';
  }
  const demo = materials.some(material => material.kind === 'demo');
  let reply = `已整理 ${count} 项${demo ? '（示例）' : '（本地匹配）'}。`;
  if (pending > archives) reply += `另有 ${pending - archives} 份附件仅支持预览。`;
  if (archives) reply += `另有 ${archives} 个 ZIP 待解包。`;
  return reply;
}
