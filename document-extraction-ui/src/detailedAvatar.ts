import { createPixelAvatar, hashString } from './pmdeskAvatar.ts';

// Higher-detail rendering of the PMDesk palette and name-derived variants.
// The original 12 px renderer remains unchanged for cross-app regression checks.
export function detailedAvatarSvg(name: string): string {
  const hash = hashString(name);
  const { palette: p } = createPixelAvatar(name);
  const hair = hash % 8;
  const face = Math.floor(hash / 11) % 4;
  const outfit = Math.floor(hash / 7) % 6;
  const accessory = Math.floor(hash / 17) % 7;
  const background = Math.floor(hash / 3) % 5;
  const shapes: string[] = [];
  const rect = (x: number, y: number, width: number, height: number, color: string) => shapes.push(`<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${color}"/>`);
  const mix = (a: string, b: string, weight: number) => '#' + [1, 3, 5].map(offset => Math.round(parseInt(a.slice(offset, offset + 2), 16) * (1 - weight) + parseInt(b.slice(offset, offset + 2), 16) * weight).toString(16).padStart(2, '0')).join('');
  const hairLight = mix(p.hair, p.bg, .16);
  const shirtShade = mix(p.shirt, p.ink, .15);
  const softShade = mix(p.skin, p.shade, .45);
  const blush = mix(p.skin, p.cheek, .38);
  const white = '#fffaf2';

  rect(0, 0, 32, 32, p.bg);
  const corners = [[[4, 5], [5, 4]], [[26, 4], [27, 5]], [[4, 26], [5, 27]], [[26, 27], [27, 26]]];
  (background === 4 ? corners : [corners[background]]).flat().forEach(([x, y]) => rect(x, y, 1, 1, mix(p.bg, p.mark, .65)));

  if (hair === 2 || hair === 7) { rect(7, 10, 18, 14, p.hair); rect(8, 22, 16, 3, p.hair); }
  // Shoulders, neck and collar.
  rect(11, 25, 10, 7, p.shirt); rect(8, 27, 16, 5, p.shirt); rect(6, 29, 20, 3, p.shirt);
  rect(6, 30, 2, 2, shirtShade); rect(24, 30, 2, 2, shirtShade);
  rect(14, 22, 4, 5, p.skin); rect(14, 22, 4, 2, softShade);
  if (outfit === 0) { rect(12, 25, 2, 2, p.accent); rect(18, 25, 2, 2, p.accent); rect(14, 27, 4, 1, p.accent); }
  if (outfit === 1) { rect(9, 28, 3, 1, p.accent); rect(20, 28, 3, 1, p.accent); }
  if (outfit === 2) { rect(11, 27, 1, 5, p.accent); rect(20, 27, 1, 5, p.accent); }
  if (outfit === 3) { rect(12, 26, 2, 2, p.accent); rect(18, 26, 2, 2, p.accent); rect(15, 29, 2, 1, p.accent); }
  if (outfit === 4) { rect(13, 26, 2, 1, p.accent); rect(17, 26, 2, 1, p.accent); rect(15, 27, 2, 1, p.accent); }
  if (outfit === 5) { rect(17, 27, 1, 5, p.accent); rect(10, 30, 3, 1, p.accent); }
  // Face silhouette, ears and subtle dimensional shading.
  rect(8, 13, 2, 6, p.skin); rect(22, 13, 2, 6, p.skin);
  rect(8, 15, 1, 3, softShade); rect(23, 15, 1, 3, softShade);
  rect(11, 8, 10, 2, p.skin); rect(10, 10, 12, 1, p.skin); rect(9, 11, 14, 9, p.skin);
  rect(10, 20, 12, 2, p.skin); rect(12, 22, 8, 1, p.skin);
  rect(9, 15, 1, 5, softShade); rect(22, 15, 1, 5, softShade); rect(20, 21, 2, 1, softShade); rect(18, 22, 2, 1, softShade);
  // Shared hair silhouette with eight distinct fringe and side profiles.
  rect(12, 4, 8, 1, p.hair); rect(10, 5, 12, 1, p.hair); rect(9, 6, 14, 2, p.hair);
  rect(8, 8, 16, 3, p.hair); rect(8, 10, 2, 5, p.hair); rect(22, 10, 2, 5, p.hair);
  rect(11, 6, 5, 1, hairLight); rect(10, 7, 2, 1, hairLight);
  if (hair === 0) { rect(10, 10, 5, 2, p.hair); rect(10, 12, 2, 1, p.hair); }
  if (hair === 1) { rect(17, 10, 5, 2, p.hair); rect(20, 12, 2, 1, p.hair); }
  if (hair === 2) { rect(7, 11, 2, 12, p.hair); rect(23, 11, 2, 12, p.hair); rect(8, 17, 1, 5, hairLight); }
  if (hair === 3) { rect(14, 2, 5, 2, p.hair); rect(15, 2, 2, 1, hairLight); rect(10, 10, 3, 1, p.hair); rect(19, 10, 3, 1, p.hair); }
  if (hair === 4) { rect(10, 3, 6, 2, p.hair); rect(11, 3, 3, 1, hairLight); rect(20, 10, 2, 3, p.hair); }
  if (hair === 5) { rect(7, 7, 2, 4, p.hair); rect(23, 9, 2, 3, p.hair); rect(16, 10, 6, 1, p.hair); }
  if (hair === 6) { rect(10, 10, 12, 2, p.hair); rect(11, 11, 3, 1, hairLight); }
  if (hair === 7) { rect(9, 3, 5, 2, p.hair); rect(10, 3, 2, 1, hairLight); rect(18, 10, 4, 2, p.hair); rect(23, 12, 2, 8, p.hair); }
  // Fine eyes, brows, nose, cheeks and expression, rather than enlarged single pixels.
  const brow = mix(p.hair, p.skin, .2);
  rect(11, 12, 3, 1, brow); rect(18, 12, 3, 1, brow);
  rect(11, 14, 3, face === 1 ? 2 : 3, white); rect(18, 14, 3, face === 1 ? 2 : 3, white);
  rect(face === 2 ? 13 : 12, 14, 1, 2, p.ink); rect(face === 2 ? 20 : 19, 14, 1, 2, p.ink);
  rect(16, 16, 1, 2, softShade); rect(15, 18, 2, 1, softShade);
  rect(10, 18, 2, 1, blush); rect(20, 18, 2, 1, blush);
  const lip = mix(p.shade, p.ink, .35);
  rect(14, 20, 4, 1, lip);
  if (face === 0 || face === 3) { rect(15, 20, 2, 1, white); rect(15, 21, 2, 1, lip); }
  if (face === 1) rect(18, 19, 1, 1, lip);
  // Small accessories remain legible without covering the entire face.
  if (accessory === 0) { rect(9, 8, 14, 1, p.accent); rect(10, 8, 3, 1, mix(p.accent, white, .3)); }
  if (accessory === 1) {
    for (const x of [10, 18]) { rect(x, 13, 5, 1, p.ink); rect(x, 16, 5, 1, p.ink); rect(x, 14, 1, 2, p.ink); rect(x + 4, 14, 1, 2, p.ink); }
    rect(15, 14, 3, 1, p.ink);
  }
  if (accessory === 2) { rect(8, 19, 1, 2, p.accent); rect(8, 21, 2, 1, p.accent); }
  if (accessory === 3) { rect(23, 19, 1, 2, p.accent); rect(22, 21, 2, 1, p.accent); }
  if (accessory === 4) { rect(12, 26, 3, 2, p.accent); rect(17, 26, 3, 2, p.accent); rect(15, 27, 2, 1, shirtShade); }
  if (accessory === 5) { rect(15, 15, 1, 1, softShade); rect(17, 15, 1, 1, softShade); }
  if (accessory === 6) { rect(22, 9, 3, 1, p.accent); rect(23, 10, 2, 1, p.accent); }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="48" height="48" shape-rendering="geometricPrecision" aria-hidden="true">${shapes.join('')}</svg>`;
}
