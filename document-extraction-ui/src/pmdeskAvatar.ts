// Ported from PMDesk member-avatar.tsx. Keep palettes, coordinates and layer order unchanged.
type PixelCell = {
  x: number
  y: number
  fill: string
}

type PixelPoint = [number, number]

const pixelPalettes = [
  { bg: "#f7efe3", skin: "#f2c58f", shade: "#d89c62", hair: "#4d3327", shirt: "#1aae39", accent: "#f5d75e", ink: "#241b16", cheek: "#dd7a6d", mark: "#d8c6aa" },
  { bg: "#edf4ff", skin: "#efba82", shade: "#c9804f", hair: "#26384d", shirt: "#0075de", accent: "#ff64c8", ink: "#17202b", cheek: "#e88485", mark: "#bfd7f4" },
  { bg: "#f7f1ff", skin: "#f1c894", shade: "#cf9360", hair: "#391c57", shirt: "#7b3ff2", accent: "#2a9d99", ink: "#24142f", cheek: "#df83b7", mark: "#d9c4f3" },
  { bg: "#fff3f8", skin: "#f0bd83", shade: "#ca8452", hair: "#523410", shirt: "#ff64c8", accent: "#1aae39", ink: "#2b1b10", cheek: "#dc745d", mark: "#f1c7dc" },
  { bg: "#fff9dc", skin: "#eec08a", shade: "#cd8a55", hair: "#2f2f29", shirt: "#dd5b00", accent: "#0075de", ink: "#1f201d", cheek: "#dc7868", mark: "#e5d57c" },
  { bg: "#eef8f0", skin: "#f3c99b", shade: "#d4935f", hair: "#233f30", shirt: "#2a9d99", accent: "#f5d75e", ink: "#13251c", cheek: "#d97669", mark: "#bddfcb" },
  { bg: "#f6f5f4", skin: "#e7b07d", shade: "#bf754b", hair: "#1f2d2f", shirt: "#391c57", accent: "#dd5b00", ink: "#151a1b", cheek: "#cc6c66", mark: "#d7d2cc" },
  { bg: "#eef6fb", skin: "#f4cda0", shade: "#d69963", hair: "#6b2d34", shirt: "#1aae39", accent: "#7b3ff2", ink: "#291316", cheek: "#db8179", mark: "#c5dce7" },
  { bg: "#f8f0e7", skin: "#d99768", shade: "#aa6844", hair: "#312018", shirt: "#f5d75e", accent: "#0075de", ink: "#201510", cheek: "#bd6d60", mark: "#dfc9b5" },
  { bg: "#eef2ff", skin: "#edbd92", shade: "#c58258", hair: "#18213d", shirt: "#ff64c8", accent: "#f5d75e", ink: "#12172a", cheek: "#d97977", mark: "#c8d0ee" },
  { bg: "#f0fbf8", skin: "#ecc08f", shade: "#cb8b5a", hair: "#29413f", shirt: "#dd5b00", accent: "#ff64c8", ink: "#152422", cheek: "#ce726a", mark: "#b9ded7" },
  { bg: "#fbf2dc", skin: "#f0c392", shade: "#cf8d5b", hair: "#3a281c", shirt: "#0075de", accent: "#1aae39", ink: "#21170f", cheek: "#d67870", mark: "#e5d0a5" },
]

export function createPixelAvatar(name: string) {
  const hash = hashString(name)
  const palette = pixelPalettes[hash % pixelPalettes.length]
  const cells: PixelCell[] = []
  const push = (fill: string, points: PixelPoint[]) => {
    points.forEach(([x, y]) => cells.push({ x, y, fill }))
  }

  addBackgroundPattern(push, palette, Math.floor(hash / 3) % 5)
  addOutfit(push, palette, Math.floor(hash / 7) % 6)
  push(palette.skin, [
    [4, 3], [5, 3], [6, 3], [7, 3],
    [3, 4], [4, 4], [5, 4], [6, 4], [7, 4], [8, 4],
    [3, 5], [4, 5], [5, 5], [6, 5], [7, 5], [8, 5],
    [3, 6], [4, 6], [5, 6], [6, 6], [7, 6], [8, 6],
    [4, 7], [5, 7], [6, 7], [7, 7],
  ])
  push(palette.shade, [[3, 6], [8, 6], [7, 7]])
  addHair(push, palette, hash % 8)
  addFace(push, palette, Math.floor(hash / 11) % 4)
  addAccessory(push, palette, Math.floor(hash / 17) % 7)

  return { palette, cells }
}

function addBackgroundPattern(
  push: (fill: string, points: PixelPoint[]) => void,
  palette: (typeof pixelPalettes)[number],
  style: number,
) {
  if (style === 0) push(palette.mark, [[1, 1], [2, 1], [1, 2]])
  if (style === 1) push(palette.mark, [[9, 1], [10, 1], [10, 2]])
  if (style === 2) push(palette.mark, [[1, 9], [1, 10], [2, 10]])
  if (style === 3) push(palette.mark, [[10, 9], [9, 10], [10, 10]])
  if (style === 4) push(palette.mark, [[1, 1], [10, 1], [1, 10], [10, 10]])
}

function addOutfit(
  push: (fill: string, points: PixelPoint[]) => void,
  palette: (typeof pixelPalettes)[number],
  style: number,
) {
  const torso: PixelPoint[] = [
    [4, 8], [5, 8], [6, 8], [7, 8],
    [3, 9], [4, 9], [5, 9], [6, 9], [7, 9], [8, 9],
    [2, 10], [3, 10], [4, 10], [5, 10], [6, 10], [7, 10], [8, 10], [9, 10],
    [2, 11], [3, 11], [4, 11], [5, 11], [6, 11], [7, 11], [8, 11], [9, 11],
  ]
  push(palette.shirt, torso)
  if (style === 0) push(palette.accent, [[5, 8], [6, 8], [5, 9], [6, 9], [5, 10], [6, 10]])
  if (style === 1) push(palette.accent, [[3, 9], [4, 9], [7, 9], [8, 9], [2, 10], [9, 10]])
  if (style === 2) push(palette.accent, [[4, 8], [7, 8], [4, 9], [7, 9], [4, 10], [7, 10]])
  if (style === 3) push(palette.accent, [[3, 8], [8, 8], [3, 9], [8, 9], [4, 10], [7, 10]])
  if (style === 4) push(palette.accent, [[5, 9], [6, 9], [4, 10], [7, 10], [3, 11], [8, 11]])
  if (style === 5) push(palette.accent, [[6, 8], [6, 9], [6, 10], [4, 11], [5, 11], [6, 11], [7, 11]])
}

function addHair(
  push: (fill: string, points: PixelPoint[]) => void,
  palette: (typeof pixelPalettes)[number],
  style: number,
) {
  const base: PixelPoint[] = [
    [4, 1], [5, 1], [6, 1], [7, 1],
    [3, 2], [4, 2], [5, 2], [6, 2], [7, 2], [8, 2],
    [3, 3], [8, 3],
  ]
  const variants: PixelPoint[][] = [
    [[3, 4], [4, 3], [5, 3]],
    [[6, 3], [7, 3], [8, 4]],
    [[2, 3], [2, 4], [3, 5], [8, 5], [9, 4], [9, 3]],
    [[5, 0], [6, 0], [4, 3], [7, 3]],
    [[3, 1], [4, 0], [5, 0], [8, 3], [8, 4]],
    [[2, 2], [2, 3], [3, 4], [7, 3], [8, 3], [9, 3]],
    [[4, 3], [5, 3], [6, 3], [7, 3], [3, 4], [8, 4]],
    [[3, 0], [4, 0], [7, 3], [8, 3], [9, 4]],
  ]
  push(palette.hair, [...base, ...variants[style]])
}

function addFace(
  push: (fill: string, points: PixelPoint[]) => void,
  palette: (typeof pixelPalettes)[number],
  style: number,
) {
  push(palette.ink, [[4, 5], [7, 5]])
  if (style === 1) push(palette.ink, [[4, 6], [7, 6]])
  if (style === 2) push(palette.ink, [[5, 5], [6, 5]])
  if (style === 3) push(palette.accent, [[4, 4], [7, 4]])
  push(palette.ink, style % 2 === 0 ? [[5, 7], [6, 7]] : [[5, 6], [6, 7]])
  push(palette.cheek, [[3, 6], [8, 6]])
}

function addAccessory(
  push: (fill: string, points: PixelPoint[]) => void,
  palette: (typeof pixelPalettes)[number],
  style: number,
) {
  if (style === 0) push(palette.accent, [[4, 1], [5, 1], [6, 1], [7, 1]])
  if (style === 1) push(palette.ink, [[3, 5], [4, 5], [6, 5], [7, 5], [5, 5]])
  if (style === 2) push(palette.accent, [[2, 6], [2, 7], [3, 7]])
  if (style === 3) push(palette.accent, [[8, 7], [9, 7], [9, 8]])
  if (style === 4) push(palette.accent, [[5, 8], [6, 8], [4, 9], [7, 9]])
  if (style === 5) push(palette.ink, [[5, 4], [6, 4]])
  if (style === 6) push(palette.accent, [[9, 2], [10, 2], [9, 3]])
}

export function hashString(value: string) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return Math.abs(hash)
}
