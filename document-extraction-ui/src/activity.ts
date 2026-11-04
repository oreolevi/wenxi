import type { ProcessingTrace } from './types.ts';

export interface DailyActivity { date: string; count: number | null }
export interface ActivityData { trackingSince: string; through: string; scope: string; days: DailyActivity[] }

export function dateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function addDays(date: string, days: number) {
  const result = new Date(date + 'T00:00:00Z'); result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}
export function calendarCells(days: DailyActivity[]) {
  if (!days.length) return [];
  const first = days[0].date;
  const padding = new Date(first + 'T00:00:00Z').getUTCDay();
  const start = addDays(first, -padding);
  const count = Math.ceil((padding + days.length) / 7) * 7;
  const values = new Map(days.map(day => [day.date, day.count]));
  return Array.from({ length: count }, (_, i) => {
    const date = addDays(start, i);
    return { date, count: values.get(date) ?? null, inRange: values.has(date) };
  });
}
export function activityLevel(count: number | null, max: number) {
  if (count === null) return 'unknown';
  if (!count) return '0';
  return String(Math.min(4, Math.max(1, Math.ceil(count / Math.max(max, 1) * 4))));
}
export function exampleActivity(through = dateKey()): ActivityData {
  const start = addDays(through, -364);
  const days = Array.from({ length: 365 }, (_, i) => ({ date: addDays(start, i), count: i % 7 === 0 || i % 11 === 0 ? 0 : (i * 17 + i % 13 * 3) % 49 }));
  [18, 26, 22, 36, 31, 44, 38].forEach((count, i) => { days[358 + i].count = count; });
  return { trackingSince: start, through, scope: 'example', days };
}

export const usageCategories = [
  { id: 'recognize', name: '文档识别', engine: 'MinerU' },
  { id: 'semantic', name: '语义字段提取', engine: 'DeepSeek' },
  { id: 'grounding', name: '原文引用校验', engine: '文析' },
  { id: 'preview', name: '原文定位与预览', engine: 'PDFium' },
  { id: 'match', name: '字段标签匹配', engine: '本地规则' },
  { id: 'seal', name: '印章文字识别', engine: 'MinerU / PP-OCR' },
  { id: 'region-ocr', name: '局部文字补识别', engine: 'MinerU / PP-OCR' },
] as const;
export type UsageEntry = (typeof usageCategories)[number] & { count: number };

export function capabilityUsage(traces: ProcessingTrace[]): UsageEntry[] {
  const seen = new Set<string>();
  const counts: Record<string, number> = {};
  for (const trace of traces) for (const step of trace.steps) {
    const split = step.id.lastIndexOf(':');
    const material = split < 0 ? '' : step.id.slice(0, split);
    const stage = step.id.slice(split + 1);
    const category = /^(supplement-)?extract-\d+$/.test(stage) ? 'semantic' : /^(supplement-)?validate-\d+$/.test(stage) ? 'grounding'
      : stage === 'seal-ocr' ? 'seal' : ['recognize', 'preview', 'match', 'region-ocr'].includes(stage) ? stage : null;
    if (!category) continue;
    const key = `${trace.id}\0${material}\0${category}`;
    if (seen.has(key)) continue;
    seen.add(key); counts[category] = (counts[category] || 0) + 1;
  }
  return usageCategories.map(category => ({ ...category, count: counts[category.id] || 0 }));
}
