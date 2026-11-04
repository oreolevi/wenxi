import test from 'node:test';
import assert from 'node:assert/strict';
import { fixtures } from '../src/fixtures.ts';
import { assistantReply, createExport, csvCell, extractMaterial, extractText, fileAccept, getFileKind, matchDefinitions, mergeFields, requestedNames, reviewField } from '../src/model.ts';
import type { Material } from '../src/types.ts';

const demo = (): Material => ({ id: 'demo', name: fixtures.application.name, kind: 'demo', scenario: 'application', size: 0, results: null });

test('实际上传请求去掉文档指代，保留字段名称，正确拆分以及', () => {
  assert.deepEqual(requestedNames('帮我提取这份申请表中的提交人、通讯地址和最终审核人员，整理成表格。'), ['提交人', '通讯地址', '最终审核人员']);
  assert.deepEqual(requestedNames('再加上初审人员以及审核日期'), ['初审人员', '审核日期']);
  assert.deepEqual(requestedNames('重新提取提交人和通讯地址'), ['提交人', '通讯地址']);
  assert.deepEqual(requestedNames('把联系电话去掉'), ['联系电话']);
});

test('真实解析字段追加保留核验与坐标，导出标明识别来源', () => {
  const source = { pageIndex: 1, blockIndex: 2, bbox: [.1, .2, .5, .3] as [number,number,number,number], text: '提交人：真实甲', ref: 'p1-b2' };
  const field = { ...fixtures.application.fields[0], key: 'mineru-提交人', name: '提交人', aliases: ['提交人'], value: '核定甲', raw: '真实甲', status: 'corrected' as const, ref: source.ref, page: 2, evidence: [source] };
  const next = mergeFields([field], [{ ...field, value: '真实甲', status: 'pending' }], '再加上提交人');
  assert.equal(next[0], field);
  const file: Material = { id: 'actual', name: '真实附件.pdf', kind: 'pdf', size: 1, results: next,
    parsed: { id: 'document-id', engine: 'MinerU 4.1.0', tier: 'basic', extractor: 'label-match', pages: [] } };
  const data = JSON.parse(createExport([file], 'json').content);
  assert.equal(data.prototype, false);
  assert.match(data.records[0].source_type, /MinerU/);
  assert.deepEqual(data.records[0].source_boxes, [source]);
});

test('申请日期不会因去除礼貌用语被截断，两个默认示例均提取五项', () => {
  assert.deepEqual(requestedNames(fixtures.application.prompt), ['提交人', '通讯地址', '最终审核人员', '申请日期', '联系电话']);
  assert.equal(matchDefinitions(fixtures.application.prompt, 'application').length, 5);
  assert.equal(matchDefinitions(fixtures.contract.prompt, 'contract').length, 5);
});

test('初审和最终审核人员分别定位，未知字段不会伪造值', () => {
  const fields = matchDefinitions('提取初审人员和最终审核人员以及身份证号', 'application');
  assert.equal(fields.find(field => field.key === 'reviewer')?.value, '陈敏');
  assert.equal(fields.find(field => field.key === 'firstReviewer')?.value, '张宁');
  assert.equal(matchDefinitions('提取提交人和身份证号', 'application').find(field => field.name === '身份证号')?.status, 'missing');
});

test('追加和移除字段保留先前核定值；只保留指令替换字段集合', () => {
  let material = extractMaterial(demo(), fixtures.application.prompt);
  material.results = material.results!.map(field => field.key === 'address' ? reviewField(field, '已核定地址') : field);
  material = extractMaterial(material, '再加上注册地址');
  assert.equal(material.results?.length, 6);
  assert.equal(material.results?.find(field => field.key === 'address')?.value, '已核定地址');
  material = extractMaterial(material, '去掉联系电话');
  assert.equal(material.results?.length, 5);
  assert.ok(!material.results?.some(field => field.key === 'phone'));
  material = extractMaterial(material, '只保留提交人和通讯地址');
  assert.equal(material.results?.length, 2);
});

test('真实文本只返回实际匹配值与行标识，PDF不会产生模拟字段', () => {
  const material: Material = { id: 'txt', name: '真实文本.txt', kind: 'text', size: 100, results: null,
    text: '提交人：王明\n通讯地址：上海市示例路18号\n申请日期：2026-10-29' };
  assert.deepEqual(extractText(material, '提取提交人、通讯地址和申请日期').map(field => [field.name, field.value, field.ref]),
    [['提交人', '王明', 'line-0'], ['通讯地址', '上海市示例路18号', 'line-1'], ['申请日期', '2026-10-29', 'line-2']]);
  const pdf = extractMaterial({ id: 'pdf', name: '真实.pdf', kind: 'pdf', size: 1, results: null }, '提取提交人');
  assert.deepEqual(pdf.results, []);
  assert.match(assistantReply([pdf]), /未接入 OCR/);
});

test('ZIP 可选择且正确分类，未解包时不伪造字段或声明可预览', () => {
  assert.ok(fileAccept.split(',').includes('.zip'));
  assert.equal(getFileKind('批量材料.ZIP'), 'archive');
  const archive = extractMaterial({ id: 'zip', name: '批量材料.zip', kind: 'archive', size: 100, results: null }, '提取提交人');
  assert.deepEqual(archive.results, []);
  assert.equal(archive.processed, true);
  assert.match(assistantReply([archive]), /解包/);
  assert.doesNotMatch(assistantReply([archive]), /可预览/);
  assert.match(assistantReply([extractMaterial(demo(), fixtures.application.prompt), archive]), /ZIP 待解包/);
});

test('核定和导出保留机器原始值、来源和状态，CSV防止公式执行', () => {
  const material = extractMaterial(demo(), fixtures.application.prompt);
  material.results = material.results!.map(field => field.key === 'address' ? reviewField(field, '人工核定地址') : field);
  const data = JSON.parse(createExport([material], 'json').content);
  const address = data.records.find((record: { field: string }) => record.field === '通讯地址');
  assert.equal(address.value, '人工核定地址');
  assert.equal(address.raw_value, '上海市浦东新区示例路88号\n12层');
  assert.equal(address.source_ref, 'address');
  assert.equal(address.review_status, '已修改');
  assert.equal(csvCell('=HYPERLINK(1)'), '"\'=HYPERLINK(1)"');
  assert.ok(createExport([material], 'csv').content.startsWith('\ufeff'));
});

test('DeepSeek 追加兼容原标签字段，导出记录真实模型和本次用量', () => {
  const field = reviewField(fixtures.application.fields[0], '人工核定值');
  const next = { ...field, key: 'ai-提交人', value: '林晓', status: 'pending' as const };
  const fields = mergeFields([field], [next], '再加上提交人');
  assert.equal(fields.length, 1);
  assert.equal(fields[0], field);
  const modelCall = { callId: 'test-call', model: 'deepseek-v4-pro', elapsedMs: 20, usage: { total_tokens: 321 }, outcome: 'success' };
  const file: Material = { id: 'real', name: '虚构测试.pdf', kind: 'pdf', size: 1, results: fields,
    parsed: { id: 'document-id', engine: 'MinerU 4.1.0', tier: 'basic', extractor: 'deepseek', model: modelCall.model, modelCall, pages: [] } };
  const data = JSON.parse(createExport([file], 'json').content);
  assert.equal(data.prototype, false);
  assert.deepEqual(data.model_calls, [modelCall]);
  assert.match(data.records[0].source_type, /deepseek-v4-pro 语义提取/);
  assert.equal(data.records[0].value, '人工核定值');
});

test('字段清单保留括号内顿号与JSON数组中的完整复合字段名', () => {
  assert.deepEqual(requestedNames('提取交易标的（品类、型号）、合同总金额。'), ['交易标的（品类、型号）', '合同总金额']);
  assert.deepEqual(requestedNames('请按这些字段提取：["合同单价、数量","生效条件，是否需签字盖章"]。'), ['合同单价、数量', '生效条件，是否需签字盖章']);
  assert.deepEqual(requestedNames('帮我找最终批准的人'), []);
});

test('重新提取可替换待核对字段，但不自动覆盖人工核定值', () => {
  const original = fixtures.application.fields[0];
  const rejected = { ...original, status: 'rejected' as const, validationStatus: 'rejected' as const, value: '' };
  const repaired = { ...original, value: '实际值', status: 'pending' as const };
  assert.equal(mergeFields([rejected], [repaired], '再提取提交人')[0], repaired);
  const reviewed = reviewField(original, '人工值');
  assert.equal(mergeFields([reviewed], [repaired], '重新提取提交人')[0], reviewed);
  assert.equal(reviewField(rejected), rejected);
});

test('结构化明细导出保留单元格依据，图像上下文不冒充印章值证据', () => {
  const evidence = { pageIndex: 0, blockIndex: 1, bbox: [.1,.1,.2,.2] as [number,number,number,number], text: '设备A', ref: 'p0-b1' };
  const table = { columns: ['品类'], rows: [{ status: 'pending' as const, cells: [{ label: '品类', value: '设备A', raw: '设备A', status: 'pending' as const, evidence: [evidence] }] }] };
  const field = { ...fixtures.application.fields[0], kind: 'table' as const, table, modelCallId: 'call-1' };
  const visual = { ...field, key: 'seal', kind: 'visual' as const, table: undefined, status: 'visual_required' as const };
  const exported = JSON.parse(createExport([{ ...demo(), results: [field, visual] }], 'json').content).records;
  assert.deepEqual(exported[0].table, table);
  assert.equal(exported[0].model_call_id, 'call-1');
  assert.equal(exported[1].has_evidence, false);
  assert.equal(exported[1].evidence_role, 'image_context');
});

test('低分印文候选独立导出，批量确认不会采纳，人工修改保留候选来源', () => {
  const evidence = { pageIndex: 0, blockIndex: 1, bbox: [.1,.1,.2,.2] as [number,number,number,number],
    text: '虚构候选公司', ref: 'p0-b1-s0', blockType: 'seal', confidence: .8 };
  const field = { ...fixtures.application.fields[0], name: '印章单位', kind: 'visual' as const,
    value: '', raw: '', status: 'visual_required' as const, validationStatus: 'visual_required' as const,
    ref: evidence.ref, evidence: [evidence], candidates: [{ value: evidence.text, confidence: .8, evidence: [evidence] }] };
  assert.equal(reviewField(field), field);
  const json = JSON.parse(createExport([{ ...demo(), results: [field] }], 'json').content).records[0];
  assert.equal(json.value, ''); assert.equal(json.raw_value, '');
  assert.equal(json.has_evidence, false); assert.equal(json.evidence_role, 'image_context');
  assert.equal(json.recognition_candidates[0].value, evidence.text);
  const csv = createExport([{ ...demo(), results: [field] }], 'csv').content;
  assert.doesNotMatch(csv, /虚构候选公司/);
  const corrected = reviewField(field, '人工核定名称');
  assert.equal(corrected.status, 'corrected'); assert.equal(corrected.raw, '');
  assert.equal(corrected.candidates, field.candidates);
});
