import { detailedAvatarSvg } from './detailedAvatar.ts';
import { hashString } from './pmdeskAvatar.ts';
import { avatarLibrary } from './avatarLibrary.ts';

export const PIXEL_AVATAR_COUNT = avatarLibrary.length;
export const PIXEL_AVATAR_SIZE = 48;
// Retain the preference key and valid legacy indices when updating the artwork.
const preferenceKey = (userId: string) => `wenxi.avatar.pmdesk.v1:${userId}`;

// Kept for callers of the former deterministic SVG generator; the account UI uses the library below.
export function pixelAvatarSvg(name: string): string {
  return detailedAvatarSvg(name);
}

export function avatarDataUrl(name: string): string {
  return avatarLibrary[hashString(name) % PIXEL_AVATAR_COUNT].src;
}

function accountAvatarEntries(name: string) {
  const defaultIndex = hashString(name) % PIXEL_AVATAR_COUNT;
  return [avatarLibrary[defaultIndex], ...avatarLibrary.filter((_, index) => index !== defaultIndex)];
}

export function accountAvatarOptions(name: string): string[] {
  return accountAvatarEntries(name).map(entry => entry.src);
}

export function accountAvatarLabels(name: string): string[] {
  return accountAvatarEntries(name).map((entry, index) => index === 0 ? `默认头像：${entry.name}` : entry.name);
}

type AvatarStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function browserStorage(): AvatarStorage | undefined {
  try { return window.localStorage; } catch { return undefined; }
}

export function getAccountAvatarIndex(userId: string, storage = browserStorage()): number {
  try {
    const saved = storage?.getItem(preferenceKey(userId));
    if (saved === null || saved === undefined || !/^(?:0|[1-9]\d*)$/.test(saved)) return 0;
    const index = Number(saved);
    return Number.isSafeInteger(index) && index < PIXEL_AVATAR_COUNT ? index : 0;
  } catch { return 0; }
}

export function accountAvatar(userId: string, name: string): string {
  return accountAvatarOptions(name)[getAccountAvatarIndex(userId)];
}

export function saveAccountAvatar(userId: string, index: number, name: string, storage = browserStorage()): string {
  if (!Number.isInteger(index) || index < 0 || index >= PIXEL_AVATAR_COUNT) throw new RangeError('Invalid avatar');
  if (!storage) throw new Error('Storage unavailable');
  if (index === 0) storage.removeItem(preferenceKey(userId));
  else storage.setItem(preferenceKey(userId), String(index));
  return accountAvatarOptions(name)[index];
}
