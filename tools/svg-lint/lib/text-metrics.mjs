// tools/svg-lint/lib/text-metrics.mjs
// The character-width table is transcribed verbatim from SKILL.md
// "Estimating text width (overflow protection)".

// Must be a null-prototype object: a plain `{}` lets `CHAR_WIDTH_TABLE['constructor']`
// resolve to the Object function itself (not undefined, so the `??` fallback below cannot
// catch it), making `.latin` undefined, which silently turns the width into NaN, and NaN
// makes all downstream comparisons permanently false — a false negative with no visible
// trace.
const CHAR_WIDTH_TABLE = Object.assign(Object.create(null), {
  8: { latin: 4.5, cjk: 8 },
  9: { latin: 5.0, cjk: 9 },
  10: { latin: 5.5, cjk: 10 },
  11: { latin: 6.0, cjk: 11 },
  12: { latin: 7.0, cjk: 12 },
});

// The table only goes up to 12px; title text is 16px, so a rule is needed outside the table.
// CJK width always equals the font size (the 8→8 … 12→12 pattern in the table);
// Latin uses 0.58× the font size, derived from the largest table entry: 7.0/12 ≈ 0.583.
const LATIN_RATIO_FALLBACK = 0.58;

export const ASCENT_RATIO = 0.75;          // top-anchored positioning (title)
export const DESCENT_RATIO = 0.25;
export const BASELINE_CENTER_RATIO = 0.35; // vertically centred inside a box

// The "same visual line" criterion is defined in one place only: the box-height check uses
// it to count lines, and the box-alignment check uses it to recognise the "left label +
// right value" pattern of two segments on one line. Writing it twice would eventually cause
// the two checks to give different answers to "what counts as one line" — the hardest kind
// of inconsistency to track down.
// The font-size difference term in the threshold is not a safety margin: when two text
// segments on the same line have different font sizes and are placed with the box-centering
// formula (baseline = midline + 0.35 × font-size), their baselines **necessarily** differ
// by 0.35 × Δfont-size. The 0.5 accounts for pixel-level jitter (y="62" versus y="62.4").
// With a font-size difference of 3 the threshold is 1.55px, well below the height of one
// line (18px for a 12px line), so two genuinely separate lines will not be merged.
export const SAME_LINE_EPSILON = 0.5;
export const sameLine = (aY, aFontSize, bY, bFontSize) =>
  Math.abs(aY - bY) <= BASELINE_CENTER_RATIO * Math.abs(aFontSize - bFontSize) + SAME_LINE_EPSILON;

// Groups a set of text segments into lines by baseline, not by <text> element count —
// a left label and a right value sharing one baseline count as one line, not two.
// Each line's fontSize is the maximum in that line, because line height is determined by the
// largest font size; y is the minimum (the baseline that appears first).
export function groupIntoLines(texts) {
  const sorted = [...texts].sort((a, b) => a.y - b.y);
  const lines = [];
  for (const t of sorted) {
    const last = lines[lines.length - 1];
    if (last && sameLine(t.y, t.fontSize, last.y, last.fontSize)) {
      last.fontSize = Math.max(last.fontSize, t.fontSize);
      last.texts.push(t);
    } else {
      lines.push({ y: t.y, fontSize: t.fontSize, texts: [t] });
    }
  }
  return lines;
}

export function charWidths(fontSize) {
  const inTable = CHAR_WIDTH_TABLE[fontSize];
  if (inTable) return inTable;
  // Both fields must go through Number(). If only latin were converted via implicit
  // multiplication and cjk were passed through unchanged, a string font size would turn the
  // `width += cjk` in estimateTextWidth into string concatenation: with fontSize='16',
  // '中文' would produce "01616", which subsequent comparisons would coerce back to 1616 —
  // a plausible-looking wrong value, much harder to spot than NaN. After unified conversion,
  // numeric strings like '16' compute correctly, while '12px' / 'abc' cleanly become NaN
  // for the non-numeric diagnostic to report.
  const size = Number(fontSize);
  return { latin: size * LATIN_RATIO_FALLBACK, cjk: size };
}

export function isCjk(ch) {
  const cp = ch.codePointAt(0);
  return (cp >= 0x2e80 && cp <= 0x9fff)   // CJK Radicals Supplement → CJK Unified Ideographs
    || (cp >= 0xf900 && cp <= 0xfaff)     // CJK Compatibility Ideographs
    || (cp >= 0xfe30 && cp <= 0xfe4f)     // CJK Compatibility Forms
    || (cp >= 0xff00 && cp <= 0xff60)     // Fullwidth ASCII and fullwidth punctuation
    // CJK ideographs from Extension B onward are in the astral plane. Omitting them is not
    // a gap in coverage but an incorrect answer: the characters would be measured at the
    // Latin width (0.58×), under-estimating each character by 42%.
    // This block covers Extensions B–I, Extensions G/H, and the CJK Compatibility
    // Ideographs Supplement (U+2F800–2FA1F, the astral-plane counterpart of the U+F900
    // block above) — the range contains only CJK ideographs and will not over-collect.
    || (cp >= 0x20000 && cp <= 0x3ffff);  // CJK Unified Ideographs Extension (astral plane)
}

const NAMED_ENTITIES = Object.assign(Object.create(null), {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
});

// &amp; is 1 character wide, not 5, so the text must be decoded before width is measured.
// A single-pass scan is required: multiple `replace` calls would re-scan the output of the
// previous pass, so `&#38;lt;` (the literal string "&lt;") would first be decoded by the
// numeric pass into `&lt;`, then consumed by the named pass into `<` — 4 characters counted
// as 1, the width is under-counted, and the text-overflow check silently produces false
// negatives. Single-pass alternation does not backtrack, so double-decoding cannot occur.
export function decodeEntities(value) {
  return String(value).replace(
    /&(?:#x([0-9A-Fa-f]+)|#(\d+)|(amp|lt|gt|quot|apos));/g,
    (whole, hex, dec, name) => {
      if (hex !== undefined) return String.fromCodePoint(parseInt(hex, 16));
      if (dec !== undefined) return String.fromCodePoint(Number(dec));
      return NAMED_ENTITIES[name];
    },
  );
}

export function estimateTextWidth(content, fontSize) {
  const { latin, cjk } = charWidths(fontSize);
  let width = 0;
  for (const ch of String(content)) width += isCjk(ch) ? cjk : latin;
  return width;
}

export function textBBox({ x, y, content, fontSize, textAnchor = 'start' }) {
  const width = estimateTextWidth(content, fontSize);
  let minX = x;
  if (textAnchor === 'middle') minX = x - width / 2;
  else if (textAnchor === 'end') minX = x - width;
  return {
    minX,
    maxX: minX + width,
    minY: y - fontSize * ASCENT_RATIO,
    maxY: y + fontSize * DESCENT_RATIO,
  };
}
