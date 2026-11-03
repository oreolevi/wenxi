import test from 'node:test';
import assert from 'node:assert/strict';
import { synchronizeParserFields, parserDraft } from '../src/studio.ts';
import type { ProfileDraft, ProfileRule } from '../src/profiles.ts';
const field: ProfileRule = { id: 'f', name: '金额', key: 'amount', kind: 'amount', method: 'region', region: [.1, .1, .2, .2], page: 1, anchor: '', direction: 'right', required: true };

test('解析器共享字段定义，同时保留各版式独立定位', () => {
  const draft: ProfileDraft = { id: 'p', name: '发票', description: '', resourceKind: 'parser', templates: [
    { id: 'a', name: 'A', sampleId: 's-a', matchTexts: [], fields: [field] },
    { id: 'b', name: 'B', sampleId: 's-b', matchTexts: [], fields: [{ ...field, id: 'b-f', region: [.5, .5, .6, .6] }] },
  ] };
  const changed = synchronizeParserFields(draft, draft.templates[0], { ...draft.templates[0], fields: [{ ...field, key: 'total', name: '价税合计', required: false }, { ...field, id: 'date', key: 'date', name: '日期', region: [.3, .3, .4, .4] }] });
  assert.equal(changed.templates[1].fields[0].key, 'total');
  assert.equal(changed.templates[1].fields[0].required, false);
  assert.deepEqual(changed.templates[1].fields[0].region, [.5, .5, .6, .6]);
  assert.equal(changed.templates[1].fields[1].region, null);
  const removed = synchronizeParserFields(changed, changed.templates[0], { ...changed.templates[0], fields: [] });
  assert(removed.templates.every(t => t.fields.length === 0));
  assert.equal(draft.templates[1].fields.length, 1, '不修改输入快照');
});

test('旧的单材料配置可作为解析器继续编辑，多材料容器须拆分', () => {
  const value: ProfileDraft = { id: 'p', name: '发票', description: '', templates: [], materialTypes: [{ id: 'invoice', name: '发票', outputKey: 'invoices', required: true, grouping: 'per_page' }] };
  const migrated = parserDraft(value);
  assert.equal(migrated.resourceKind, 'parser'); assert.equal(migrated.preprocessing?.grouping, 'per_page');
  assert.equal(migrated.materialTypes, undefined);
  assert.throws(() => parserDraft({ ...value, materialTypes: [...value.materialTypes!, { ...value.materialTypes![0], id: 'contract' }] }), /拆分/);
});
