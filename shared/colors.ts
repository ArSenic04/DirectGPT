/**
 * Distinct participant colours for any number of collaborators. The first
 * eight come from a hand-picked palette with good contrast on white; after
 * that hues are spread with the golden angle so neighbours never look alike.
 */
export const BASE_PALETTE: readonly string[] = [
  '#e11d48', // rose
  '#2563eb', // blue
  '#16a34a', // green
  '#9333ea', // purple
  '#ea580c', // orange
  '#0891b2', // cyan
  '#ca8a04', // amber
  '#db2777', // pink
];

function hslToHex(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/** Colour of the n-th participant to join a room (0-based). */
export function colorForIndex(index: number): string {
  const i = Number.isFinite(index) && index >= 0 ? Math.floor(index) : 0;
  if (i < BASE_PALETTE.length) return BASE_PALETTE[i];
  const k = i - BASE_PALETTE.length;
  const hue = (17 + k * 137.508) % 360;
  const lightness = [0.42, 0.34, 0.5][k % 3];
  return hslToHex(hue, 0.7, lightness);
}

/** Stable fallback colour from an id, used before the room roster has synced. */
export function colorForId(id: string): string {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return BASE_PALETTE[h % BASE_PALETTE.length];
}
