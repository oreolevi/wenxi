import test from 'node:test';
import assert from 'node:assert/strict';
import { readDrafts, writeDrafts, skillMarkdown } from '../src/platformDrafts.ts';
import { initialSkills } from '../src/prototypeModel.ts';

test('规则草稿重新加载后仍保留，存储失败时不能报告保存成功', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) || null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  } });
  try {
    const edited = { ...initialSkills[0], name: '测试语义规则', rules: [{ field: '付款进度', meaning: '区分累计比例与本次支付比例' }] };
    writeDrafts('skills', [edited]);
    assert.deepEqual(readDrafts('skills', initialSkills), [edited]);
    values.set('bad', '{');
    assert.deepEqual(readDrafts('bad', initialSkills), initialSkills);
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { setItem: () => { throw new Error('quota'); } } });
    assert.throws(() => writeDrafts('skills', [edited]), /未能保存草稿/);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});

test('规则导出包含业务语义，缺失耗时显示未记录而非零', async () => {
  const markdown = skillMarkdown(initialSkills[0]);
  assert(markdown.includes('付款进度'));
  assert(markdown.includes('不能将累计比例直接相加'));
  const { elapsed } = await import('../src/operations.ts');
  assert.equal(elapsed(undefined), '未记录');
  assert.equal(elapsed(0), '0 ms');
  assert.equal(elapsed(1250), '1.25 s');
});
