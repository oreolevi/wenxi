import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAssistantChanges, assistantSignature, changeDescription } from '../src/assistant.ts';
import type { AssistantChange, ProfileTemplate } from '../src/profiles.ts';

const template: ProfileTemplate = { id: 'invoice', name: '发票', sampleId: 'sample-1', matchTexts: ['电子发票'], fields: [
  { id: 'total', key: 'total', name: '价税合计', kind: 'amount', method: 'region', region: [.4, .5, .6, .7], page: 1, required: false, anchor: '', direction: 'right' },
] };
const change = (): AssistantChange => ({ op: 'update', id: 'total', before: structuredClone(template.fields[0]), after: { ...template.fields[0], required: true, origin: 'ai', review: 'pending' }, check: null });

test('助手局部修改保留位置和其他属性，不变更输入对象', () => {
  const next = applyAssistantChanges(template, assistantSignature(template), [change()]);
  assert.equal(next.fields[0].required, true);
  assert.equal(next.fields[0].review, 'pending');
  assert.deepEqual(next.fields[0].region, template.fields[0].region);
  assert.equal(template.fields[0].required, false);
  const second = { ...template.fields[0], id: 'other', key: 'other', name: '其他字段' };
  const multiple = { ...template, fields: [...template.fields, second] };
  assert.deepEqual(applyAssistantChanges(multiple, assistantSignature(multiple), [change()]).fields[1], second, '局部修改不影响其他字段');
  assert.deepEqual(changeDescription(change()), [{ label: '必填', before: '否', after: '是' }]);
});

test('人工修改、替换样例或基准页变化后，过期建议不能覆盖当前配置', () => {
  for (const next of [{ ...template, sampleId: 'new-sample' }, { ...template, referencePage: 2 }, { ...template, name: '另一版式名称' }, { ...template, materialTypeId: 'another-type' }, { ...template, fields: [{ ...template.fields[0], name: '新字段名称' }] }]) {
    assert.throws(() => applyAssistantChanges(next, assistantSignature(template), [change()]), /已改变/);
  }
});

test('服务端默认属性规范化不制造假冲突，未知或重复字段建议仍被拦截', () => {
  const defaults = { ...template, fields: [{ ...template.fields[0], stripLabel: false, note: '', origin: 'manual' as const, review: 'confirmed' as const }] };
  assert.equal(assistantSignature(defaults), assistantSignature(template));
  assert.throws(() => applyAssistantChanges(template, assistantSignature(template), [change(), change()]), /重复/);
  assert.throws(() => applyAssistantChanges(template, assistantSignature(template), [{ ...change(), id: 'unknown' }]), /变化/);
  const added: AssistantChange = { op: 'add', id: 'duplicate', before: null, after: { ...template.fields[0], id: 'duplicate', name: '同名接口字段' }, check: null };
  assert.throws(() => applyAssistantChanges(template, assistantSignature(template), [added]), /重复/);
});

test('新增与移除仅改变对应字段，不改变材料分类、版式匹配与样例', () => {
  const added: AssistantChange = { op: 'add', id: 'invoice_number', before: null, after: { ...template.fields[0], id: 'invoice_number', key: 'invoice_number', name: '发票号码' }, check: null };
  const next = applyAssistantChanges(template, assistantSignature(template), [added]);
  assert.equal(next.fields.length, 2);
  const removed = applyAssistantChanges(next, assistantSignature(next), [{ op: 'remove', id: 'total', before: next.fields[0], after: null, check: null }]);
  assert.equal(removed.fields[0].key, 'invoice_number');
  assert.equal(removed.sampleId, template.sampleId);
  assert.deepEqual(removed.matchTexts, template.matchTexts);
});
