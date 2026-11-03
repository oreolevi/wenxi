import test from 'node:test';
import assert from 'node:assert/strict';
import { materialGroups, newTemplate, rulesFromMaterial, selectionBox, suggestMaterialType, type ProfileDraft, type ProfileSample } from '../src/profiles.ts';
import { navigationItems, pageGroup } from '../src/navigationModel.ts';

test('提取方案是工作空间的独立入口，保留文档提取、历史和能力中心', () => {
  assert.deepEqual(navigationItems.filter(item => item.group === '工作空间').map(item => item.label), ['文析', '文析 Studio', '历史记录']);
  assert.equal(pageGroup('profiles'), '工作空间');
  assert.equal(pageGroup('skills'), '能力中心');
});

test('框选支持反向拖拽并限制在原文范围，忽略过小的区域', () => {
  assert.deepEqual(selectionBox({ x: .8, y: .6 }, { x: .2, y: .1 }), [.2, .1, .8, .6]);
  assert.deepEqual(selectionBox({ x: -.1, y: .1 }, { x: 1.2, y: .9 }), [0, .1, 1, .9]);
  assert.equal(selectionBox({ x: .2, y: .1 }, { x: .201, y: .3 }), null);
});

test('从通用结果创建规则仅带入名称和位置，不把校准值固化为常量', () => {
  const fields = rulesFromMaterial({ id: 'invoice', name: 'invoice.pdf', kind: 'pdf', size: 10, results: [
    { key: 'sum', name: '总金额', value: '人工修正的金额', raw: '原始金额', page: 2, ref: 'p1-b1', status: 'corrected', aliases: [], note: '', evidence: [
      { pageIndex: 1, blockIndex: 1, bbox: [.4, .2, .8, .3], text: '原始金额', ref: 'p1-b1' },
      { pageIndex: 0, blockIndex: 2, bbox: [.1, .8, .2, .9], text: '其他页', ref: 'p0-b2' },
    ] },
    { key: 'missing', name: '缺失字段', value: '', raw: '', page: null, ref: null, status: 'missing', aliases: [], note: '' },
  ] });
  assert.equal(fields[0].page, 2);
  assert.deepEqual(fields[0].region, [.395, .194, .805, .306]);
  assert.equal(fields[1].region, null);
  assert(!JSON.stringify(fields).includes('人工修正'));
  assert(!JSON.stringify(fields).includes('原始金额'));
  assert.equal(fields[0].key, 'field_1');
});

test('新建版式保留独立样例ID和关键词，不包含样例字段值', () => {
  const value = newTemplate({ id: 'sample', name: '发票.pdf', engine: 'PDF 文字层', sourceHash: 'hash', pages: [], blocks: [
    { ref: 'title', text: '电子发票', pageIndex: 0, blockIndex: 0, bbox: [0, 0, 1, .1] },
  ] });
  assert.equal(value.sampleId, 'sample');
  assert.deepEqual(value.matchTexts, ['电子发票', '发票号码']);
  assert.deepEqual(value.fields, []);
});

test('同名字段按独立票据保留核验，重新提取不会串用第一张的确认值', async () => {
  const { mergeFields } = await import('../src/model.ts');
  const field = { key: 'one-total', unitId: 'one', name: '价税合计', aliases: ['价税合计'], value: '123', raw: '123', page: 1, ref: 'one', note: '', status: 'confirmed' as const };
  const second = { ...field, key: 'two-total', unitId: 'two', status: 'pending' as const, value: '999', raw: '999', page: 2, ref: 'two' };
  const result = mergeFields([field], [field, second], '重新提取');
  assert.deepEqual(result.map(item => item.value), ['123', '999']);
  const updated = mergeFields([field, second], [{ ...second, value: '888' }], '追加提取');
  assert.deepEqual(updated.map(item => item.value), ['123', '888']);
});

test('处理后区域能映射回横放的上传原图', async () => {
  const { mapProfileBox } = await import('../src/profiles.ts');
  assert.deepEqual(mapProfileBox([.1, .2, .4, .5], [[0, -1, 1], [1, 0, 0], [0, 0, 1]]), [.5, .1, .8, .4]);
});

test('材料分组根据样例标题建议，合同提到发票不会变成发票，未知材料保留待分类', () => {
  let value: ProfileDraft = { id: 'scene', name: '转账材料', description: '', templates: [] };
  for (const [name, text, body] of [['合同.pdf', '采购合同', '付款时需开具发票'], ['发票.pdf', '电子发票', '购买方'], ['未知.pdf', '其他材料', '备注']]) {
    const sample: ProfileSample = { id: name, name, engine: 'fixture', sourceHash: name, pages: [], blocks: [
      { ref: 'title', pageIndex: 0, blockIndex: 0, bbox: [0, 0, 1, .1], text },
      { ref: 'body', pageIndex: 0, blockIndex: 1, bbox: [0, .5, 1, .6], text: body },
    ] };
    const template = newTemplate(sample); value = suggestMaterialType({ ...value, templates: [...value.templates, template] }, template, sample);
  }
  assert.deepEqual(materialGroups(value).map(group => group.name), ['合同', '发票', '待分类']);
  assert(value.templates.every(item => item.classification === 'suggested'));
  assert.equal(value.materialTypes?.find(item => item.name === '合同')?.grouping, 'document');
  assert.equal(value.materialTypes?.find(item => item.name === '发票')?.grouping, 'per_page');
  assert(!JSON.stringify(value.materialTypes).includes('购买方'));
});
