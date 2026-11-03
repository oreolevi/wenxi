import type { AssistantChange, ProfileRule, ProfileTemplate } from './profiles.ts';

const normalized = (field: ProfileRule) => ({ id: field.id, key: field.key, name: field.name, kind: field.kind, method: field.method,
  page: field.page, region: field.region, anchor: field.anchor || '', direction: field.direction, required: field.required,
  stripLabel: !!field.stripLabel, origin: field.origin || 'manual', review: field.review || 'confirmed', note: field.note || '' });
export const ruleSignature = (field: ProfileRule) => JSON.stringify(normalized(field));
export const assistantSignature = (template: ProfileTemplate) => JSON.stringify({ id: template.id, name: template.name, sampleId: template.sampleId,
  materialTypeId: template.materialTypeId || '', classification: template.classification || '',
  referencePage: template.referencePage || 0, matchTexts: template.matchTexts, fields: template.fields.map(normalized) });

export function applyAssistantChanges(template: ProfileTemplate, baseline: string, changes: AssistantChange[]): ProfileTemplate {
  if (assistantSignature(template) !== baseline) throw new Error('当前规则或样例已改变，请基于最新配置重新生成建议。');
  if (!changes.length) throw new Error('请选择要应用的修改。');
  const fields = structuredClone(template.fields);
  const targets = new Set<string>();
  for (const change of changes) {
    if (targets.has(change.id)) throw new Error('建议包含重复的字段修改。');
    targets.add(change.id);
    const index = fields.findIndex(field => field.id === change.id);
    if (change.op === 'add') {
      if (index >= 0 || change.before || !change.after || change.after.id !== change.id) throw new Error('新增字段建议无效，请重新生成。');
      fields.push(structuredClone(change.after));
    } else {
      if (index < 0 || !change.before || ruleSignature(fields[index]) !== ruleSignature(change.before)) throw new Error('字段已发生变化，请重新生成建议。');
      if (change.op === 'remove' && !change.after) fields.splice(index, 1);
      else if (change.op === 'update' && change.after?.id === change.id) fields[index] = structuredClone(change.after);
      else throw new Error('字段修改建议无效。');
    }
  }
  if (fields.length > 40 || new Set(fields.map(field => field.key)).size !== fields.length || new Set(fields.map(field => field.name)).size !== fields.length) throw new Error('修改会造成字段重复或超出数量限制。');
  return { ...template, fields };
}

const propertyLabels = { name: '字段名称', key: '接口字段名', kind: '数据类型', method: '定位方式', page: '页码', region: '取值区域', anchor: '定位标签', direction: '取值方向', required: '必填', stripLabel: '移除标签', note: '说明' } as const;
export function changeDescription(change: AssistantChange) {
  const display = (key: keyof typeof propertyLabels, value: unknown): string => {
    if (value === null || value === undefined || value === '') return '未设置';
    if (typeof value === 'boolean') return value ? '是' : '否';
    if (key === 'region' && Array.isArray(value)) return value.map(number => `${Math.round(Number(number) * 1000) / 10}%`).join(' / ');
    const names: Record<string, string> = { text: '文本', number: '数字编号', amount: '金额', date: '日期', region: '区域取值', anchor: '标签定位', right: '右侧', below: '下方' };
    return names[String(value)] || String(value);
  };
  return Object.entries(propertyLabels).flatMap(([key, label]) => {
    const property = key as keyof typeof propertyLabels;
    const before = change.before ? normalized(change.before)[property] : undefined;
    const after = change.after ? normalized(change.after)[property] : undefined;
    if (JSON.stringify(before) === JSON.stringify(after)) return [];
    return [{ label, before: display(property, before), after: display(property, after) }];
  });
}
