import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createPixelAvatar, hashString } from '../src/pmdeskAvatar.ts';
import { accountAvatarOptions, avatarDataUrl, getAccountAvatarIndex, pixelAvatarSvg, PIXEL_AVATAR_COUNT, PIXEL_AVATAR_SIZE, saveAccountAvatar } from '../src/pixelAvatars.ts';

// Captured from the original PMDesk implementation, including cell order and all nine palette colors.
const fixtures = [
  ['董玉兰', 1082345123, 'e862cc1113e4506d2555bb4704a90005e40e4eedf600659f1df90c0109fb8e76'],
  ['张岚', 1827062145, '84665f42540ae9e6c2b4463313b62e651f3d0f0bc7d8d0a845125ce1face30b3'],
  ['王敏', 365419425, 'fe11c0578bc19efdd03633b5862205d018ebec8f6b223ec717f40c229e4aa953'],
  ['刘洋', 583549572, '643f7b37f8d9e471b156c0e986d59ec12f9bcab291b8aed4e47c939903a58793'],
  ['赵工', 2056341935, '5c066ef7f4cc99202f6c8cd190397750d5e4f2aa9344ba48c489023c6fa35950'],
  ['小郭', 1047043561, '9271fc5c8fbab3e771b9ad45c11f6602a96b678757f4c6d333628f86c7f94f5b'],
] as const;

test('保留 PMDesk 姓名与色板映射，使用更细的 32 px 人物绘制', () => {
  for (const [name, hash, digest] of fixtures) {
    assert.equal(hashString(name), hash);
    assert.equal(createHash('sha256').update(JSON.stringify(createPixelAvatar(name))).digest('hex'), digest);
    const svg = pixelAvatarSvg(name);
    assert(svg.includes('viewBox="0 0 32 32"'));
    assert(svg.includes('shape-rendering="geometricPrecision"'));
    assert(svg.includes(createPixelAvatar(name).palette.bg));
    assert(!/<(?:script|image|foreignObject)\b/.test(svg));
  }
  assert.equal(PIXEL_AVATAR_SIZE, 48);
});

test('默认按姓名生成，手动选择单独保存，恢复默认不保留覆盖数据', () => {
  const values = new Map<string, string>([['wenxi.avatar.v1:user-a', '8']]);
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
  const choices = accountAvatarOptions('小郭');
  assert.equal(choices.length, PIXEL_AVATAR_COUNT);
  assert.equal(new Set(choices).size, PIXEL_AVATAR_COUNT);
  assert.equal(choices[0], avatarDataUrl('小郭'));
  assert.equal(getAccountAvatarIndex('user-a', storage), 0);
  assert.equal(saveAccountAvatar('user-a', 6, '小郭', storage), choices[6]);
  assert.equal(getAccountAvatarIndex('user-a', storage), 6);
  assert.equal(getAccountAvatarIndex('user-b', storage), 0);
  assert.equal(saveAccountAvatar('user-a', 0, '小郭', storage), choices[0]);
  assert.equal(values.has('wenxi.avatar.pmdesk.v1:user-a'), false);
  const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
  assert.equal(getAccountAvatarIndex('user-a', blocked), 0);
  assert.throws(() => saveAccountAvatar('user-a', 3, '小郭', blocked));
  for (const index of [-1, 16, .5, NaN]) assert.throws(() => saveAccountAvatar('user-a', index, '小郭', storage));
});
