import { detailedAvatarSvg } from './detailedAvatar.ts';

export const PIXEL_AVATAR_COUNT = 16;
export const PIXEL_AVATAR_SIZE = 48;
const preferenceKey = (userId: string) => `wenxi.avatar.pmdesk.v1:${userId}`;
// Fixed seeds are only used for opt-in alternatives. The default always uses the display name.
const alternativeNames = Array.from({ length: PIXEL_AVATAR_COUNT - 1 }, (_, index) => `文析头像${String(index + 1).padStart(2, '0')}`);

export function pixelAvatarSvg(name: string): string {
  return detailedAvatarSvg(name);
}

export function avatarDataUrl(name: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(pixelAvatarSvg(name))}`;
}

export function accountAvatarOptions(name: string): string[] {
  return [name, ...alternativeNames].map(avatarDataUrl);
}

type AvatarStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function browserStorage(): AvatarStorage | undefined {
  try { return window.localStorage; } catch { return undefined; }
}

export function getAccountAvatarIndex(userId: string, storage = browserStorage()): number {
  try {
    const saved = storage?.getItem(preferenceKey(userId));
    return saved !== null && saved !== undefined && /^(?:[0-9]|1[0-5])$/.test(saved) ? Number(saved) : 0;
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
