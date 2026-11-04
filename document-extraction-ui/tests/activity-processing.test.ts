import test from 'node:test';
import assert from 'node:assert/strict';
import { activityLevel, addDays, calendarCells, capabilityUsage, exampleActivity } from '../src/activity.ts';
import { durationLabel, finishProcessing, mergeProcessingSteps } from '../src/processing.ts';
import type { ProcessingStep, ProcessingTrace } from '../src/types.ts';

test('日历跨闰日仍按星期排列，区分尚未跟踪与零调用', () => {
  assert.equal(addDays('2024-02-28', 1), '2024-02-29');
  assert.equal(addDays('2024-02-29', 1), '2024-03-01');
  const days = [{ date: '2024-02-28', count: null }, { date: '2024-02-29', count: 0 }, { date: '2024-03-01', count: 8 }];
  const cells = calendarCells(days);
  assert.equal(cells[0].date, '2024-02-25');
  assert.equal(cells.length % 7, 0);
  assert.deepEqual(cells.filter(day => day.inRange).map(({ date, count }) => ({ date, count })), days);
  assert.notEqual(activityLevel(null, 8), activityLevel(0, 8));
  assert.equal(activityLevel(8, 8), '4');
  assert.deepEqual(calendarCells([]), []);
});

test('年度示例固定为365天，末七天沿用演示值且没有未来记录', () => {
  const data = exampleActivity('2026-10-30');
  assert.equal(data.days.length, 365);
  assert.equal(data.days.at(-1)?.date, '2026-10-30');
  assert.deepEqual(data.days.slice(-7).map(day => day.count), [18, 26, 22, 36, 31, 44, 38]);
  assert.equal(new Set(data.days.map(day => day.date)).size, 365);
});

test('重复轮询只更新已有步骤，多附件相同阶段分别保留', () => {
  const empty: ProcessingTrace = { id: 'turn1', status: 'running', startedAt: '2026-10-30T00:00:00Z', steps: [] };
  const step: ProcessingStep = { id: 'ocr', label: '识别文档', status: 'running', startedAt: empty.startedAt };
  let trace = mergeProcessingSteps(empty, [step], 'first:');
  trace = mergeProcessingSteps(trace, [{ ...step, label: '已识别8页', status: 'done' }], 'first:');
  trace = mergeProcessingSteps(trace, [step], 'second:');
  assert.equal(trace.steps.length, 2);
  assert.deepEqual(trace.steps.map(step => step.status), ['done', 'running']);
  assert.equal(empty.steps.length, 0);
});

test('停止与部分失败不会把未完成步骤标为成功，完成后保留耗时和历史', () => {
  const trace: ProcessingTrace = { id: 'turn1', status: 'running', startedAt: '2026-10-30T00:00:00Z', steps: [
    { id: 'read', label: '读取', status: 'done', startedAt: '2026-10-30T00:00:00Z' },
    { id: 'extract', label: '提取', status: 'running', startedAt: '2026-10-30T00:00:01Z' },
  ] };
  assert.deepEqual(finishProcessing(trace, 'cancelled').steps.map(step => step.status), ['done', 'cancelled']);
  assert.deepEqual(finishProcessing(trace, 'partial').steps.map(step => step.status), ['done', 'error']);
  const done = finishProcessing(trace, 'done', '2026-10-30T00:01:05Z');
  assert.equal(durationLabel(done.startedAt, done.finishedAt), '1 分 5 秒');
  assert.equal(trace.status, 'running');
  assert.equal(trace.steps[1].status, 'running');
});

test('能力分布按轮次和材料计数，同一材料的多批提取与轮询不重复累计', () => {
  const startedAt = '2026-10-30T00:00:00Z';
  const event = (id: string): ProcessingStep => ({ id, label: id, status: 'done', startedAt });
  const trace: ProcessingTrace = { id: 'turn1', status: 'done', startedAt, steps: [
    event('file1:recognize'), event('file1:preview'), event('file1:extract-0'), event('file1:extract-1'),
    event('file1:validate-0'), event('file1:validate-1'), event('file2:extract-0'), event('local'),
  ] };
  const counts = Object.fromEntries(capabilityUsage([trace, trace]).map(item => [item.id, item.count]));
  assert.deepEqual(counts, { recognize: 1, semantic: 2, grounding: 1, preview: 1, match: 0, seal: 0 });
  const repeated = capabilityUsage([trace, { ...trace, id: 'turn2', steps: [event('file1:extract-0')] }]);
  assert.equal(repeated.find(item => item.id === 'semantic')?.count, 3);
  assert(capabilityUsage([]).every(item => item.count === 0));
});

test('能力尝试与业务成功分开统计，停止前已开始的能力仍保留使用次数', () => {
  const startedAt = '2026-10-30T00:00:00Z';
  const trace: ProcessingTrace = { id: 'stopped-turn', status: 'cancelled', startedAt, steps: [
    { id: 'file1:recognize', label: '识别', status: 'done', startedAt },
    { id: 'file1:extract-0', label: '提取', status: 'cancelled', startedAt },
  ] };
  const usage = capabilityUsage([trace]);
  assert.equal(usage.find(item => item.id === 'semantic')?.count, 1);
  assert.equal(usage.find(item => item.id === 'grounding')?.count, 0);
});

test('印章OCR按每份材料和轮次计一次，失败尝试也保留记录', () => {
  const step = { id: 'file1:seal-ocr', label: '印文识别', status: 'error' as const, startedAt: '2026-11-04T00:00:00Z' };
  const trace = { id: 'seal-turn', startedAt: step.startedAt, status: 'done' as const, steps: [step, step] };
  assert.equal(capabilityUsage([trace, trace]).find(item => item.id === 'seal')?.count, 1);
  assert.equal(capabilityUsage([{ ...trace, steps: [step, { ...step, id: 'file2:seal-ocr' }] }]).find(item => item.id === 'seal')?.count, 2);
});
