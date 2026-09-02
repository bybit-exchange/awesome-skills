// tools/svg-lint/lib/color.mjs
// WCAG 2.1 relative luminance and contrast ratio. Dark-mode readability is therefore computable, no human eye required.

export const LIGHT_CANVAS = '#ffffff';
export const DARK_CANVAS = '#0d1117';   // actual page background colour of the GitHub dark theme
export const WCAG_AA_TEXT = 4.5;

export function parseHex(value) {
  const m = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(String(value ?? '').trim());
  if (!m) return null;
  const hex = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16),
  };
}

export function normalizeHex(value) {
  const rgb = parseHex(value);
  if (!rgb) return null;
  return `#${[rgb.r, rgb.g, rgb.b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

function channelLuminance(v) {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance({ r, g, b }) {
  return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b);
}

// Normalise "a hex string or an rgb object" into an rgb object; anything else returns null.
// A falsy check alone is not enough: truthy non-rgb inputs (42, [], {r:1}) would let
// relativeLuminance destructure missing components as undefined and propagate NaN all the
// way through. NaN makes every downstream comparison permanently false, silently suppressing
// warnings that should fire — much harder to diagnose than returning null directly.
function toRgb(value) {
  if (typeof value === 'string') return parseHex(value);
  if (value === null || typeof value !== 'object') return null;
  const { r, g, b } = value;
  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) return null;
  return { r, g, b };
}

export function contrastRatio(a, b) {
  const ca = toRgb(a);
  const cb = toRgb(b);
  if (!ca || !cb) return null;
  const la = relativeLuminance(ca);
  const lb = relativeLuminance(cb);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}
