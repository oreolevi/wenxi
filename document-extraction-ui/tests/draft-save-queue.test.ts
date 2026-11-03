import assert from 'node:assert/strict';
import test from 'node:test';
import { DraftSaveQueue } from '../src/draftSaveQueue.ts';

test('slow older draft saves finish before newer edits; explicit flush joins the latest request', async () => {
  let release!: () => void;
  const blocker = new Promise<void>(resolve => { release = resolve; });
  const writes: number[] = []; const acknowledged: number[] = [];
  const queue = new DraftSaveQueue(async (draft: { revision: number }) => {
    writes.push(draft.revision);
    if (draft.revision === 1) await blocker;
    return draft;
  }, value => acknowledged.push(value.revision));
  const original = { revision: 1 };
  const first = queue.save(original); original.revision = 100;
  const second = queue.save({ revision: 2 });
  assert.equal(queue.save({ revision: 2 }), second);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(writes, [1], 'newer writes cannot overtake the in-flight snapshot');
  release();
  await Promise.all([first, second]);
  assert.deepEqual(writes, [1, 2]);
  assert.deepEqual(acknowledged, [1, 2]);
});

test('a failed save does not lose subsequent edits and can be retried', async () => {
  let failed = true; let persisted = '';
  const queue = new DraftSaveQueue(async (draft: { text: string }) => {
    if (failed) { failed = false; throw new Error('network unavailable'); }
    persisted = draft.text;
    return draft;
  }, () => {});
  const failure = assert.rejects(queue.save({ text: 'first' }), /network unavailable/);
  const latest = queue.save({ text: 'latest' });
  await failure; await latest;
  assert.equal(persisted, 'latest');
  await new Promise(resolve => setTimeout(resolve, 0));
  await queue.save({ text: 'retry' });
  assert.equal(persisted, 'retry');
});
