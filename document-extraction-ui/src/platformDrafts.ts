import type { SkillDraft } from './prototypeModel.ts';

export interface ApplicationDraft {
  id: string; name: string; purpose: string; targets: string[]; dailyLimit: number | null; updatedAt: string;
}
export function readDrafts<T>(key: string, initial: T[]): T[] {
  try { const value = JSON.parse(localStorage.getItem(key) || 'null'); return Array.isArray(value) ? value : initial; }
  catch { return initial; }
}
export function writeDrafts<T>(key: string, value: T[]) {
  try { localStorage.setItem(key, JSON.stringify(value)); }
  catch { throw new Error('浏览器未能保存草稿，请检查存储空间或浏览器设置。'); }
}
export function skillMarkdown(skill: SkillDraft) {
  return `# ${skill.name}\n\n适用材料：${skill.category}\n\n${skill.description}\n\n## 字段语义与提取要求\n\n${skill.rules.map(rule => `### ${rule.field}\n\n${rule.meaning}`).join('\n\n')}\n`;
}
