// tools/svg-lint/test/text-metrics.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  charWidths, isCjk, decodeEntities, estimateTextWidth, textBBox,
  ASCENT_RATIO, DESCENT_RATIO, BASELINE_CENTER_RATIO,
  sameLine, groupIntoLines,
} from '../lib/text-metrics.mjs';

test('table font sizes come straight from the SKILL.md table', () => {
  assert.deepEqual(charWidths(8), { latin: 4.5, cjk: 8 });
  assert.deepEqual(charWidths(9), { latin: 5.0, cjk: 9 });
  assert.deepEqual(charWidths(10), { latin: 5.5, cjk: 10 });
  assert.deepEqual(charWidths(11), { latin: 6.0, cjk: 11 });
  assert.deepEqual(charWidths(12), { latin: 7.0, cjk: 12 });
});

test('off-table font sizes extrapolate: cjk equals the font size, latin is 0.58x', () => {
  // 16 and 7 multiplied by 0.58 are both exact in IEEE 754 (9.28 / 4.06), so equal can be used directly
  assert.deepEqual(charWidths(16), { latin: 9.28, cjk: 16 });   // above the table upper bound (heading font size)
  assert.deepEqual(charWidths(7), { latin: 4.06, cjk: 7 });     // below the table lower bound
});

// The width table must be a null-prototype object. With a plain `{}`, CHAR_WIDTH_TABLE['constructor']
// returns the Object function itself (not undefined, so `??` cannot catch it), causing charWidths to
// return a function, `.latin` to be undefined, and widths to silently become NaN. This pins
// "prototype members must not leak through the table lookup".
test('charWidths does not leak Object prototype members through the table lookup', () => {
  const w = charWidths('constructor');
  assert.equal(typeof w, 'object');
  assert.ok(Number.isNaN(w.latin), `latin was ${w.latin}, so the lookup did not fall through`);
});

test('isCjk separates han and latin', () => {
  assert.equal(isCjk('中'), true);        // U+4E2D unified CJK ideograph
  assert.equal(isCjk('，'), true);        // U+FF0C fullwidth comma
  // CJK compatibility ideographs must be constructed with String.fromCodePoint, not as literal characters:
  // U+F900 has a canonical decomposition and the literal form is folded to U+8C48 under NFC, which falls
  // in the unified CJK range — the assertion then silently drifts to testing range 1 instead, the
  // compatibility ideograph range can be deleted and the test still passes, while the comment still claims to test U+F900.
  assert.equal(isCjk(String.fromCodePoint(0xF900)), true);    // U+F900 CJK compatibility ideograph
  assert.equal(isCjk('︰'), true);        // U+FE30 CJK compatibility form (stable under NFC, safe as a literal)
  assert.equal(isCjk('A'), false);
  assert.equal(isCjk('&'), false);
  assert.equal(isCjk('｡'), false);       // U+FF61 halfwidth full stop, genuinely halfwidth, must not count as CJK
});

test('decodeEntities collapses the five predefined entities and numeric refs', () => {
  assert.equal(decodeEntities('Load &amp; Save'), 'Load & Save');
  assert.equal(decodeEntities('x &lt; 10 &gt; 2'), 'x < 10 > 2');
  assert.equal(decodeEntities('&#60;&#x3E;'), '<>');
  // the remaining two predefined entities — not testing them is equivalent to not implementing them
  assert.equal(decodeEntities('&quot;q&apos;a'), '"q\'a');
});

// Single-pass discrimination test: a decoded & must not be re-treated as the start of an entity.
// All three forms represent the literal text "&lt;" (4 characters); the decoded result must be preserved as-is.
// A multi-pass replace implementation would incorrectly decode the last two as "<" (1 character) → width undercount → overflow missed.
test('decodeEntities does not re-decode the output of an earlier substitution', () => {
  assert.equal(decodeEntities('&amp;lt;'), '&lt;');
  assert.equal(decodeEntities('&#38;lt;'), '&lt;');
  assert.equal(decodeEntities('&#x26;lt;'), '&lt;');
  assert.equal(decodeEntities('&#38;amp;'), '&amp;');
});

test('decodeEntities leaves unknown entities untouched', () => {
  assert.equal(decodeEntities('&foo;'), '&foo;');
  assert.equal(decodeEntities('&amp'), '&amp');
});

test('estimateTextWidth uses 7px per latin char at 12px', () => {
  assert.equal(estimateTextWidth('Ship', 12), 28);
});

test('estimateTextWidth uses full font size per cjk char', () => {
  assert.equal(estimateTextWidth('中文', 12), 24);
});

test('estimateTextWidth mixes scripts at 10px', () => {
  assert.equal(estimateTextWidth('中A', 10), 15.5);
});

test('estimateTextWidth of an empty string is 0, not a fallback width', () => {
  assert.equal(estimateTextWidth('', 12), 0);
});

// CJK Unified Ideographs Extension B is in the astral plane (U+20000) and occupies two UTF-16 code units.
// for...of iterates by code point so the character count is 1, but if isCjk does not recognise this range
// it is measured at the Latin width of 7.0 instead of 12 — a 42% underestimate for a single character.
// Constructed with String.fromCodePoint; do not write the literal character (see the U+F900 comment above for why).
test('estimateTextWidth measures an astral-plane CJK ideograph at full width', () => {
  const extB = String.fromCodePoint(0x20000);
  assert.equal(isCjk(extB), true);
  assert.equal(estimateTextWidth(extB, 12), 12);
});

// The largest entry in the table is 12px. The extrapolation branch must genuinely scale by font size
// and must not fall back to "use the nearest table entry". 13×0.58 = 7.539999999999999 is not exact
// in IEEE 754, so the property "strictly greater than the 12px entry" is pinned rather than a float
// literal — the property expresses "not clamped to the table upper bound" more clearly than any number.
test('charWidths does not clamp just above the top table row', () => {
  assert.ok(charWidths(13).latin > charWidths(12).latin,
    `13px latin ${charWidths(13).latin} must exceed 12px latin ${charWidths(12).latin}`);
  assert.equal(charWidths(13).cjk, 13);
});

// Attribute values are strings; a numeric string like '16' must produce the correct number, not a concatenated wrong value.
// If only the latin path coerces and cjk passes through as-is, the result here would be the string "01616" (which becomes 1616 on comparison).
test('estimateTextWidth coerces a numeric string font size instead of concatenating', () => {
  const width = estimateTextWidth('中文', '16');
  assert.equal(typeof width, 'number');
  assert.equal(width, 32);
});

test('textBBox for the house-style middle-anchored label stays inside its box', () => {
  // assets/house-style.svg Box A: rect x=77 width=140, text x=147 y=92 font-size=12
  const box = textBBox({ x: 147, y: 92, content: 'Markdown doc', fontSize: 12, textAnchor: 'middle' });
  assert.equal(box.minX, 105);
  assert.equal(box.maxX, 189);
  assert.equal(box.minY, 83);
  assert.equal(box.maxY, 95);
});

test('textBBox honours start and end anchors', () => {
  const start = textBBox({ x: 40, y: 60, content: 'abc', fontSize: 12, textAnchor: 'start' });
  assert.equal(start.minX, 40);
  assert.equal(start.maxX, 61);
  const end = textBBox({ x: 40, y: 60, content: 'abc', fontSize: 12, textAnchor: 'end' });
  assert.equal(end.minX, 19);
  assert.equal(end.maxX, 40);
});

// The SVG text-anchor default is start; when absent it must not be treated as middle (which would shift the entire box left by half the width).
test('textBBox defaults to the start anchor when text-anchor is absent', () => {
  const bare = textBBox({ x: 40, y: 60, content: 'abc', fontSize: 12 });
  assert.equal(bare.minX, 40);
  assert.equal(bare.maxX, 61);
});

test('the three ratios are the SKILL.md values and stay distinct', () => {
  assert.equal(ASCENT_RATIO, 0.75);
  assert.equal(DESCENT_RATIO, 0.25);
  assert.equal(BASELINE_CENTER_RATIO, 0.35);
});

// sameLine / groupIntoLines is the sole definition of "what counts as the same visual line"; both the
// box-height check and the in-box positioning check use it. All expected values are written as literals:
// threshold = 0.35 × font-size difference + 0.5.
test('two baselines within half a pixel are the same line', () => {
  assert.equal(sameLine(62, 12, 62.4, 12), true);
  assert.equal(sameLine(62, 12, 62.6, 12), false);
});

test('the allowance widens with the font-size difference, both orders', () => {
  // 11px and 14px at their respective centred baselines differ by 0.35 × 3 = 1.05, threshold 1.55.
  assert.equal(sameLine(74.85, 11, 75.9, 14), true);
  assert.equal(sameLine(75.9, 14, 74.85, 11), true);
  // a difference of 1.6 exceeds the threshold for this pair of font sizes.
  assert.equal(sameLine(74.85, 11, 76.45, 14), false);
});

test('the allowance follows the difference, not the smaller font size', () => {
  // with equal font sizes the difference is 0, so the threshold is just 0.5 — two tightly spaced lines are still two lines.
  assert.equal(sameLine(60, 12, 64, 12), false);
});

test('a real line gap is never merged, whatever the font sizes', () => {
  assert.equal(sameLine(60, 16, 80, 9), false);
});

test('groupIntoLines merges by baseline and keeps the largest font size', () => {
  const lines = groupIntoLines([
    { y: 62, fontSize: 11, content: 'left' },
    { y: 62.4, fontSize: 14, content: 'right' },
    { y: 80, fontSize: 12, content: 'second row' },
  ]);
  assert.equal(lines.length, 2);
  assert.equal(lines[0].fontSize, 14);
  assert.deepEqual(lines[0].texts.map((t) => t.content), ['left', 'right']);
  assert.equal(lines[1].y, 80);
  assert.deepEqual(lines[1].texts.map((t) => t.content), ['second row']);
});

test('groupIntoLines sorts by y instead of trusting document order', () => {
  const lines = groupIntoLines([
    { y: 80, fontSize: 12, content: 'second' },
    { y: 62, fontSize: 12, content: 'first' },
  ]);
  assert.deepEqual(lines.map((l) => l.texts[0].content), ['first', 'second']);
});

test('groupIntoLines does not mutate the array it was given', () => {
  const texts = [{ y: 80, fontSize: 12 }, { y: 62, fontSize: 12 }];
  groupIntoLines(texts);
  assert.deepEqual(texts.map((t) => t.y), [80, 62]);
});
