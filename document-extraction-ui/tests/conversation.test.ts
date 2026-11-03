import test from 'node:test';
import assert from 'node:assert/strict';
import { runLocalTurn } from '../src/conversation.ts';
import { extractMaterial, reviewField } from '../src/model.ts';
import { fixtures } from '../src/fixtures.ts';
import type { Material } from '../src/types.ts';

const demo = (id = 'first') => extractMaterial({ id, name: '申请表示例.pdf', kind: 'demo', scenario: 'application', size: 0, results: null }, fixtures.application.prompt);

test('无附件可以对话；提取请求会提示上传，不生成字段', () => {
  const materials: Material[] = [];
  assert.equal(runLocalTurn('你好', materials, '', null).materials, materials);
  const turn = runLocalTurn('帮我提取提交人', materials, '', null);
  assert.equal(turn.kind, 'chat');
  assert.match(turn.reply, /添加文档/);
  assert.equal(turn.materials, materials);
});

test('问候、指导问题及提到提取的普通对话不会修改结果或核验状态', () => {
  const file = demo();
  file.results = file.results!.map(field => field.key === 'submitter' ? reviewField(field) : field);
  const materials = [file];
  const before = JSON.stringify(materials);
  for (const prompt of ['谢谢', '如何提取这些内容？', '我想聊聊提取这件事情', '为什么要把提交人改为王明？', '先不要提取']) {
    const turn = runLocalTurn(prompt, materials, file.id, 'reviewer');
    assert.equal(turn.kind, 'chat', prompt);
    assert.equal(turn.materials, materials, prompt);
    assert.equal(JSON.stringify(turn.materials), before, prompt);
  }
});

test('自然语言修正只更新当前文档的指定字段，并保留原始值和来源', () => {
  const materials = [demo('first'), demo('second')];
  const turn = runLocalTurn('把提交人改为王明', materials, 'second', 'reviewer');
  assert.equal(turn.kind, 'correct');
  assert.equal(turn.materials[0], materials[0]);
  const field = turn.materials[1].results!.find(field => field.key === 'submitter')!;
  assert.deepEqual([field.value, field.raw, field.ref, field.status], ['王明', '林晓', 'submitter', 'corrected']);
  assert.equal(turn.selectedKey, 'submitter');
  assert.equal(turn.page, 1);
});

test('含糊修改不会猜测字段，明确提取和追加仍可执行', () => {
  const materials = [demo()];
  assert.equal(runLocalTurn('把这个字段改成王明', materials, 'first', null).materials, materials);
  assert.equal(runLocalTurn('把不存在的字段改为王明', materials, 'first', null).materials, materials);
  const turn = runLocalTurn('再加上注册地址', materials, 'first', 'reviewer');
  assert.equal(turn.kind, 'extract');
  assert.equal(turn.materials[0].results!.length, 6);
  assert.equal(runLocalTurn('把这个字段改成测试值', materials, 'first', 'submitter').kind, 'correct');
});

test('DeepSeek 模式允许真实文档的语义提取与问句，问候和人工修正仍在本地', () => {
  const file: Material = { ...demo(), id: 'real', kind: 'pdf', scenario: undefined };
  const materials = [file];
  for (const prompt of ['帮我找最终批准这次变更的人，告诉我他的姓名。', '这次变更最终是谁同意的？', '提取最终审核人员？']) {
    assert.equal(runLocalTurn(prompt, materials, file.id, null, true).kind, 'extract', prompt);
  }
  assert.equal(runLocalTurn('这次变更最终是谁同意的？', materials, file.id, null, false).kind, 'chat');
  assert.equal(runLocalTurn('如何提取这些内容？', materials, file.id, null, true).kind, 'chat');
  assert.equal(runLocalTurn('你好', materials, file.id, null, true).kind, 'chat');
  assert.equal(runLocalTurn('把提交人改为王明', materials, file.id, null, true).kind, 'correct');
});
