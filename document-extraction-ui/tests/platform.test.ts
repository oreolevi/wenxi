import test from 'node:test';
import assert from 'node:assert/strict';
import { navigationGroups, navigationItems, navigationKey, pageFromSearch, pageGroup } from '../src/navigationModel.ts';
import { capabilityComponents, historyStats, initialSkills, sessionHistory } from '../src/prototypeModel.ts';
import type { Material } from '../src/types.ts';

test('三组导航不再包含场景目录，旧页面映射到新的职责入口', () => {
  assert.deepEqual(navigationGroups, ['工作空间', '能力中心', '运营管理']);
  assert.deepEqual(navigationItems.map(item => item.key), ['business', 'profiles', 'history', 'skills', 'components', 'operations', 'resources']);
  assert(!navigationItems.some(item => /场景目录|开发工作台/.test(item.label)));
  assert.equal(navigationKey('batch'), 'history');
  assert.equal(navigationKey('release'), 'profiles');
  assert.equal(navigationKey('scenes'), 'business');
  assert.equal(pageGroup('skills'), '能力中心');
  assert.equal(pageFromSearch('?page=skills&view=comparison'), 'skills');
  assert.equal(pageFromSearch('?page=unknown'), 'business');
});

test('当前会话统计排除字段要求表，未测得用量不会伪装成零', () => {
  const files: Material[] = [
    { id: 'excel', name: '字段.xlsx', kind: 'spreadsheet', size: 10, results: null },
    { id: 'pdf', name: '合同.pdf', kind: 'pdf', size: 10, processed: true, results: [
      { key: 'a', name: '金额', value: '100', raw: '100', page: 1, ref: 'p0-b1', status: 'confirmed', aliases: [], note: '', validationStatus: 'passed' },
      { key: 'b', name: '条款', value: '片段', raw: '片段', page: 1, ref: 'p0-b2', status: 'rejected', aliases: [], note: '', validationStatus: 'partial' },
      { key: 'c', name: '签名', value: '', raw: '', page: null, ref: null, status: 'visual_required', aliases: [], note: '', kind: 'visual', validationStatus: 'visual_required' },
    ] },
  ];
  const rows = sessionHistory(files, false, '');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].materialId, 'pdf');
  const stats = historyStats(rows);
  assert.deepEqual([stats.count, stats.complete, stats.fields, stats.passed, stats.review, stats.visual, stats.confirmed], [1, 1, 3, 1, 1, 1, 1]);
  assert.equal(stats.tokens, null);
  assert.equal(stats.unknownUsage, 1);
  assert(!('accuracy' in stats));
});

test('历史页保留实际失败与队列状态，不将附件上传当作提取完成', () => {
  const files: Material[] = [
    { id: 'a', name: '甲.pdf', kind: 'pdf', size: 1, results: null },
    { id: 'b', name: '乙.pdf', kind: 'pdf', size: 1, results: null },
    { id: 'c', name: '丙.pdf', kind: 'pdf', size: 1, results: null, processed: true, error: '模型超时' },
  ];
  assert.deepEqual(sessionHistory(files, true, '甲.pdf · 识别中').map(row => row.status), ['处理中', '待处理', '失败']);
  assert.equal(sessionHistory([{ id: 'zip', name: '材料.zip', kind: 'archive', size: 1, processed: true, results: [] }], false, '')[0].status, '待处理');
  assert.equal(historyStats([]).tokens, null);
});

test('Skill示例引用的组件均可找到，印章能力明确未接入', () => {
  for (const skill of initialSkills) for (const id of skill.components) assert(capabilityComponents.some(component => component.id === id));
  assert.equal(capabilityComponents.find(component => component.id === 'seal')!.state, '待接入');
  assert(initialSkills[0].rules.some(rule => rule.field === '付款条件'));
});
