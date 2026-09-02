// tools/svg-lint/test/color.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseHex, normalizeHex, relativeLuminance, contrastRatio,
  LIGHT_CANVAS, DARK_CANVAS, WCAG_AA_TEXT,
} from '../lib/color.mjs';
import {
  SEMANTIC, ARROW_COLORS, BASE_TEXT, GROUP_BOX, ALLOWED_COLORS,
  semanticByFill, semanticByStroke,
} from '../lib/palette.mjs';

const near = (actual, expected, tol = 0.05) =>
  assert.ok(Math.abs(actual - expected) < tol, `expected ~${expected}, got ${actual}`);

test('parseHex handles three- and six-digit forms', () => {
  assert.deepEqual(parseHex('#fff'), { r: 255, g: 255, b: 255 });
  assert.deepEqual(parseHex('#1e40af'), { r: 30, g: 64, b: 175 });
  assert.equal(parseHex('none'), null);
});

test('normalizeHex lowercases and expands', () => {
  assert.equal(normalizeHex('#DBEAFE'), '#dbeafe');
  assert.equal(normalizeHex('#FFF'), '#ffffff');
});

// Both fixtures above have channels >= 16 (minimum 219), so the two-digit zero-padding logic has never been exercised.
// Without padding a channel below 16, one digit is dropped: #0d1117's r=13 becomes 'd', making the string a
// 6-character '#d1117'. It is then compared character-by-character against the palette and can never match —
// reporting a valid house-style colour as a violation, i.e. a false positive — the worst failure mode of this tool.
// The round-trip (input equals expected) pins it here.
test('normalizeHex pads a channel below 16 to two digits', () => {
  assert.equal(normalizeHex('#0d1117'), '#0d1117');
  assert.equal(normalizeHex('#0D1117'), '#0d1117');
});

// The contract of parseHex is "three or six digits". If relaxed to 3–6 digits, #abcd would not return null
// but instead compute channels [171, 205, NaN] — a silent NaN makes every downstream contrast comparison permanently false.
test('parseHex rejects four- and five-digit hex instead of yielding NaN', () => {
  assert.equal(parseHex('#abcd'), null);
  assert.equal(parseHex('#abcde'), null);
});

// The # prefix is part of the contract. Removing this requirement lets bare 'dbeafe' be parsed as a colour,
// but SVG has no hex colour notation without a leading #.
test('parseHex requires the leading hash', () => {
  assert.equal(parseHex('dbeafe'), null);
  assert.equal(parseHex('fff'), null);
});

test('relativeLuminance is 0 for black and 1 for white', () => {
  near(relativeLuminance({ r: 0, g: 0, b: 0 }), 0, 1e-9);
  near(relativeLuminance({ r: 255, g: 255, b: 255 }), 1, 1e-9);
});

// The WCAG channel function uses the linear segment c / 12.92 when c <= 0.03928, and the power function otherwise.
// Pure black cannot exercise this segment: 0/12.92 and 0/12 are both 0, so a wrong divisor still passes.
// A colour with a channel in (0, 0.03928×255] = (0, 10.02] is needed — using 5.
// The three luminance coefficients sum to 1, so a grey's relative luminance equals the linearised single-channel value,
// allowing the expected value to be written as the formula (5/255)/12.92 rather than transcribing a long decimal.
// With the divisor mistakenly written as 12, the result is 7.7% too high; the 1e-15 tolerance catches it.
test('relativeLuminance uses the 12.92 divisor on the linear segment', () => {
  const grey5 = relativeLuminance({ r: 5, g: 5, b: 5 });
  assert.ok(5 / 255 <= 0.03928, 'fixture must fall on the linear segment');
  assert.ok(Math.abs(grey5 - (5 / 255) / 12.92) < 1e-15,
    `expected (5/255)/12.92 = ${(5 / 255) / 12.92}, got ${grey5}`);
});

test('contrastRatio of black on white is the WCAG maximum 21', () => {
  near(contrastRatio('#000000', '#ffffff'), 21, 0.01);
});

test('the input semantic pair clears WCAG AA for body text', () => {
  // #1e40af text on #dbeafe fill
  near(contrastRatio('#1e40af', '#dbeafe'), 7.16);
});

test('primary text is readable on a white canvas', () => {
  near(contrastRatio('#1e293b', '#ffffff'), 14.64);
});

test('primary text is NOT readable on the GitHub dark canvas', () => {
  // this is the current deficiency in assets/house-style.svg: headings are nearly invisible on dark backgrounds
  near(contrastRatio('#1e293b', '#0d1117'), 1.30);
  assert.ok(contrastRatio('#1e293b', '#0d1117') < 4.5);
});

test('contrastRatio is symmetric and rejects unparseable input', () => {
  near(contrastRatio('#dbeafe', '#1e40af'), 7.16);
  assert.equal(contrastRatio('#1e40af', 'url(#grad)'), null);
});

test('the palette carries exactly the five semantic triples from SKILL.md', () => {
  assert.equal(SEMANTIC.length, 5);
  assert.deepEqual(
    SEMANTIC.map((s) => [s.fill, s.stroke, s.text]),
    [
      ['#dbeafe', '#3b82f6', '#1e40af'],
      ['#fef3c7', '#f59e0b', '#b45309'],
      ['#d1fae5', '#22c55e', '#166534'],
      ['#f3e8ff', '#a855f7', '#6b21a8'],
      ['#fce7f3', '#ec4899', '#9d174d'],
    ],
  );
});

test('the palette carries the six arrow colors', () => {
  assert.deepEqual(ARROW_COLORS, {
    arrow: '#64748b',
    'arrow-blue': '#3b82f6',
    'arrow-orange': '#f59e0b',
    'arrow-green': '#22c55e',
    'arrow-purple': '#a855f7',
    'arrow-red': '#ef4444',
  });
});

test('base text colors are the three SKILL.md values', () => {
  assert.deepEqual(BASE_TEXT, { primary: '#1e293b', secondary: '#64748b', muted: '#94a3b8' });
});

test('ALLOWED_COLORS covers palette members, none and white but not an arbitrary hex', () => {
  assert.equal(ALLOWED_COLORS.has('#f8fafc'), true);   // dashed grouping box fill
  assert.equal(ALLOWED_COLORS.has('#ef4444'), true);   // arrow-red
  assert.equal(ALLOWED_COLORS.has('none'), true);
  assert.equal(ALLOWED_COLORS.has('#ffffff'), true);
  assert.equal(ALLOWED_COLORS.has('#ff00ff'), false);
});

test('semanticByFill resolves a fill back to its triple', () => {
  assert.equal(semanticByFill('#d1fae5').stroke, '#22c55e');
  assert.equal(semanticByFill('#123456'), undefined);
});

// Looking up by stroke is an independent code path and cannot be covered by the semanticByFill test.
// The second assertion uses the **fill** of the input entry: it exists in the palette but does not appear
// as the stroke of any entry, so semanticByStroke must return undefined — this assertion distinguishes
// "genuinely looking up by stroke" from "substituting a fill value".
test('semanticByStroke resolves a stroke back to its triple', () => {
  assert.equal(semanticByStroke('#ec4899').name, 'warning');
  assert.equal(semanticByStroke('#dbeafe'), undefined);
});

// name is a **short slug chosen here**, not the literal string from SKILL.md (the SKILL.md table header uses
// human-readable labels with slashes like "Input / primary", "Data / output", "AI / analysis").
// Pinned because downstream checks use name in error messages; changing it silently replaces the error text.
test('the semantic entries carry their documented slugs in SKILL.md table order', () => {
  assert.deepEqual(SEMANTIC.map((s) => s.name),
    ['input', 'processing', 'output', 'analysis', 'warning']);
});

test('GROUP_BOX carries the dashed grouping-box style from SKILL.md', () => {
  assert.deepEqual(GROUP_BOX, { fill: '#f8fafc', stroke: '#94a3b8', dasharray: '6,4' });
});

test('the canvas and threshold constants are the documented values', () => {
  assert.equal(LIGHT_CANVAS, '#ffffff');
  assert.equal(DARK_CANVAS, '#0d1117');
  assert.equal(WCAG_AA_TEXT, 4.5);
});

// The interface promises parameters may be a hex string "or an rgb object", but every test above passes
// strings — the object code path has never been exercised. The second assertion deliberately mixes both
// forms, pinning that the typeof branch evaluates each argument independently (rather than deciding how
// to parse both based only on the first).
test('contrastRatio accepts rgb objects as well as hex strings', () => {
  near(contrastRatio({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 }), 21, 0.01);
  near(contrastRatio({ r: 30, g: 64, b: 175 }, '#dbeafe'), 7.16);   // rgb channels of #1e40af
});

// The contract is `number | null`, but a guard that only checks for falsy cannot stop **truthy** non-rgb input:
// it reaches relativeLuminance, missing channels are destructured as undefined, channelLuminance
// computes NaN, and NaN is returned. NaN is more dangerous than null — `NaN >= 4.5` is always false,
// so downstream silently reports no warning instead of surfacing "I could not parse this colour".
test('contrastRatio returns null (never NaN) for truthy non-rgb input', () => {
  // undefined / null are the most important here: downstream check modules read el.attrs.fill,
  // which is undefined when the attribute is absent. Without the object check, destructuring throws
  // TypeError and crashes the linter: remove that object check and the first input in the loop below throws rather than returning null.
  for (const bad of [undefined, null, 42, [], {}, { r: 1 }, { r: 1, g: 2 }, { r: '10', g: '10', b: '10' }]) {
    const got = contrastRatio(bad, '#ffffff');
    assert.equal(got, null, `contrastRatio(${JSON.stringify(bad)}, '#ffffff') should be null, got ${got}`);
  }
  // the second argument takes an independent branch and must be tested separately
  assert.equal(contrastRatio('#ffffff', { g: 5, b: 5 }), null);
  // counter-case: a valid boundary rgb (channel 0) must not be rejected by this guard
  near(contrastRatio({ r: 0, g: 0, b: 0 }, '#ffffff'), 21, 0.01);
});
