// tools/svg-lint/lib/palette.mjs
// The sole numeric source for the house palette, copied verbatim from SKILL.md "Colors" and "Arrowhead definitions".
// All check modules must read values from here; writing hex literals inline is not allowed.

export const BASE_TEXT = {
  primary: '#1e293b',
  secondary: '#64748b',
  muted: '#94a3b8',
};

export const SEMANTIC = [
  { name: 'input', fill: '#dbeafe', stroke: '#3b82f6', text: '#1e40af' },
  { name: 'processing', fill: '#fef3c7', stroke: '#f59e0b', text: '#b45309' },
  { name: 'output', fill: '#d1fae5', stroke: '#22c55e', text: '#166534' },
  { name: 'analysis', fill: '#f3e8ff', stroke: '#a855f7', text: '#6b21a8' },
  { name: 'warning', fill: '#fce7f3', stroke: '#ec4899', text: '#9d174d' },
];

export const ARROW_COLORS = {
  arrow: '#64748b',
  'arrow-blue': '#3b82f6',
  'arrow-orange': '#f59e0b',
  'arrow-green': '#22c55e',
  'arrow-purple': '#a855f7',
  'arrow-red': '#ef4444',
};

export const GROUP_BOX = {
  fill: '#f8fafc',
  stroke: '#94a3b8',
  dasharray: '6,4',
};

export const ALLOWED_COLORS = new Set([
  ...Object.values(BASE_TEXT),
  ...SEMANTIC.flatMap((s) => [s.fill, s.stroke, s.text]),
  ...Object.values(ARROW_COLORS),
  GROUP_BOX.fill,
  GROUP_BOX.stroke,
  'none',
  '#ffffff',
]);

export const semanticByFill = (hex) => SEMANTIC.find((s) => s.fill === hex);
export const semanticByStroke = (hex) => SEMANTIC.find((s) => s.stroke === hex);
