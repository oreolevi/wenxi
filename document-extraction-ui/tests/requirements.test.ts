import test from 'node:test';
import assert from 'node:assert/strict';
import { selectedRequirements, refersToRequirements } from '../src/requirements.ts';
import { acceptedExtensions, createExport, extractMaterial, getFileKind } from '../src/model.ts';
import { runLocalTurn } from '../src/conversation.ts';
import type { Material } from '../src/types.ts';

const contract: Material = { id: 'contract', name: '合同.pdf', kind: 'pdf', size: 10, results: null };
const workbook = (): Material => ({ id: 'fields', name: '字段.xlsx', kind: 'spreadsheet', size: 10, results: null,
  requirementSheet: '合同', requirementWorkbook: { fileName: '字段.xlsx', sheets: [{ sheet: '合同', fields: [
    { name: '合同生效日期/合同签订日期', rule: '同时存在时取生效日', cell: 'B2', ruleCell: 'C2', group: '合同信息' },
    { name: '交易标的（品类、型号）', rule: '保留各行', cell: 'B3', ruleCell: 'C3', group: '合同信息' },
  ] }] } });

test('Excel作为字段要求附件，不能被误作Word或待识别合同', () => {
  const file = workbook();
  assert(acceptedExtensions.includes('xlsx'));
  assert.equal(getFileKind(file.name), 'spreadsheet');
  assert.equal(extractMaterial(file, '提取内容'), file);
  const turn = runLocalTurn('帮我按照Excel里面的字段内容要求提取一下合同里面的字段', [file, contract], file.id, null, true);
  assert.equal(turn.kind, 'extract');
  assert.equal(turn.activeId, contract.id);
  assert.equal(turn.materials[0].processed, undefined);
});

test('保留复合字段名、备注和来源，明确字段表指令才启用要求', () => {
  const file = workbook();
  const selected = selectedRequirements([contract, file], '帮我按照Excel里的字段要求提取合同');
  assert.deepEqual(selected?.fields, file.requirementWorkbook!.sheets[0].fields);
  assert.equal(selected?.fileName, '字段.xlsx');
  assert.equal(selectedRequirements([contract, file], '再提取购买方'), undefined);
  assert.equal(refersToRequirements('按字段表提取合同'), true);
});

test('要求表缺失、未读完、失败、多表未选择时不发起提取', () => {
  assert.throws(() => selectedRequirements([contract], '按Excel提取'), /先添加/);
  const file = workbook(); file.requirementLoading = true;
  assert.throws(() => selectedRequirements([contract, file], '按Excel提取'), /正在读取/);
  file.requirementLoading = false; file.requirementError = '未找到字段列';
  assert.throws(() => selectedRequirements([contract, file], '按Excel提取'), /未找到字段列/);
  file.requirementError = undefined; file.requirementSheet = undefined;
  assert.throws(() => selectedRequirements([contract, file], '按Excel提取'), /选择/);
  assert.equal(runLocalTurn('按Excel提取', [file], file.id, null, true).kind, 'chat');
  assert.throws(() => selectedRequirements([workbook()], '按Excel提取'), /再添加/);
});

test('字段表不会成为导出结果，真实字段保留要求来源', () => {
  const requirement = { ...workbook().requirementWorkbook!.sheets[0].fields[0], fileName: '字段.xlsx', sheet: '合同' };
  const result: Material = { ...contract, results: [{ key: 'date', name: requirement.name, value: '2026年1月1日', raw: '2026年1月1日',
    status: 'pending', aliases: [], ref: 'p0-b1', page: 1, note: '', requirement }] };
  const data = JSON.parse(createExport([workbook(), result], 'json').content);
  assert.equal(data.records.length, 1);
  assert.equal(data.records[0].extraction_requirement.rule, '同时存在时取生效日');
  assert.equal(data.records[0].extraction_requirement.cell, 'B2');
});
