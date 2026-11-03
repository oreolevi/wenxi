import test from 'node:test';
import assert from 'node:assert/strict';
import { mockOperationsOverview } from '../src/operationsMock.ts';
import { savedResultQuality, type QualityTask } from '../src/operationsQuality.ts';
import { efficiencySummary, type OperationRecord } from '../src/operations.ts';

test('节约工时只累计有基准且成功的场景外部调用，不重复计算内部服务或待核对结果', () => {
  const row: OperationRecord = { id: 'one', kind: 'scene', targetId: 'payment', name: '付款',
    version: '1.0.0', createdAt: '2026-11-02', status: 'succeeded', minutesSavedPerRun: 12 };
  const value = efficiencySummary([row, { ...row, id: 'two', minutesSavedPerRun: 15 },
    { ...row, id: 'old', minutesSavedPerRun: undefined }, { ...row, kind: 'service' },
    { ...row, kind: 'document' }, { ...row, status: 'needs_review' }, { ...row, status: 'failed' },
    { ...row, status: 'cancelled' }, { ...row, status: 'running' }]);
  assert.equal(value.savedMinutes, 27);
  assert.equal(value.configuredCalls, 2);
  assert.equal(value.unconfiguredCalls, 1);
  assert.equal(value.excludedCalls, 4);
  assert.equal(value.scenes[0].minutesMin, 12);
  assert.equal(value.scenes[0].minutesMax, 15);
});

test('全年 Mock 包含未调用日和业务起伏，入口分类与主指标相加一致', () => {
  const year = mockOperationsOverview(365, 'all', '2026-11-02');
  const api = mockOperationsOverview(365, 'api', '2026-11-02');
  assert.equal(year.activity.days.length, 365);
  assert.ok(year.activity.days.filter(day => day.count === 0).length > 60);
  assert.ok(new Set(year.activity.days.map(day => day.count)).size > 20);
  assert.equal(year.summary.documentCalls + year.summary.apiCalls, year.summary.calls);
  assert.equal(api.summary.calls, year.summary.apiCalls);
  assert.equal(api.summary.documentCalls, 0);
  assert.equal(api.quality.total, 0);
  assert.deepEqual(api.efficiency, year.efficiency);
  assert.equal(year.activity.days.reduce((sum, day) => sum + (day.count || 0), 0), year.summary.calls);
  assert.equal(year.summary.completionRate, Math.round(year.summary.completed / (year.summary.completed + year.summary.failed) * 100));
});

test('排行与失败筛选使用完整调用集，不受最近100条限制，也不改变总指标', () => {
  const all = mockOperationsOverview(30, 'all', '2026-11-02');
  assert.ok(all.summary.calls > 100);
  assert.equal(all.records.length, 100);
  const failures = mockOperationsOverview(30, 'all', '2026-11-02', { status: 'failed' });
  assert.deepEqual(failures.summary, all.summary);
  assert.equal(failures.recordsTotal, all.summary.failed);
  assert.ok(failures.records.every(row => row.status === 'failed'));
  const first = all.ranking[0];
  assert.ok(first.count > 100);
  const target = mockOperationsOverview(30, 'all', '2026-11-02', { target: first.key });
  assert.equal(target.recordsTotal, first.count);
  assert.ok(target.records.every(row => `${row.kind}:${row.targetId}` === first.key));
  assert.deepEqual(target.ranking, all.ranking);
});

test('Mock日期范围和入口筛选一致，自动接口不产生人工核验任务', () => {
  const month = mockOperationsOverview(30, 'all', '2026-11-02');
  const week = mockOperationsOverview(7, 'all', '2026-11-02');
  assert.deepEqual(month.activity.days.slice(-7), week.activity.days);
  const kinds = ['document', 'service', 'scene'].map(kind => mockOperationsOverview(30, kind, '2026-11-02'));
  assert.equal(kinds.reduce((sum, item) => sum + item.summary.calls, 0), month.summary.calls);
  assert.equal(kinds[0].quality.total, month.quality.total);
  assert.equal(kinds[1].quality.total, 0);
  assert.equal(kinds[2].quality.total, 0);
  assert.equal(month.quality.passed + month.quality.partial + month.quality.visual + month.quality.missing + month.quality.unknown, month.quality.total);
  assert.ok(month.quality.reviewed <= month.quality.total);
});

test('历史核验按任务创建期间和最新快照去重，原始引用与人工核验分别统计', () => {
  const task: QualityTask = { id: 'a', createdAt: '2026-10-30T09:00:00+08:00', updatedAt: '2026-11-01', files: [
    { id: 'one', kind: 'pdf', processed: true, results: [
      { validationStatus: 'passed', status: 'confirmed' },
      { validationStatus: 'rejected', status: 'corrected' },
      { kind: 'visual', validationStatus: 'passed', status: 'pending' },
      { validationStatus: 'missing', status: 'confirmed' },
      { status: 'pending' },
    ] },
    { id: 'one', kind: 'pdf', processed: true, results: [{ validationStatus: 'passed' }] },
    { id: 'demo', kind: 'demo', processed: true, results: [{ validationStatus: 'passed' }] },
    { id: 'excel', kind: 'spreadsheet', processed: true, results: [{ validationStatus: 'passed' }] },
    { id: 'unprocessed', kind: 'pdf', processed: false, results: [{ validationStatus: 'passed' }] },
  ] };
  const older = { ...task, updatedAt: '2026-10-30', files: [] };
  const outside = { ...task, id: 'old', createdAt: '2026-09-29' };
  const invalid = { ...task, id: 'invalid', createdAt: 'invalid' };
  assert.deepEqual(savedResultQuality([task, older, outside, invalid], '2026-10-01', '2026-11-02'), {
    materials: 1, total: 5, reviewed: 3, passed: 1, partial: 1, visual: 1, missing: 1, unknown: 1,
  });
});
