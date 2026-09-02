// tools/svg-lint/test/checks/box-height.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boxHeight } from '../../lib/checks/box-height.mjs';
import { lintSource } from '../../lib/lint.mjs';
import { runCheck, fixture, codes } from '../helpers/load.mjs';

const WRAP = (body) => `<svg viewBox="0 0 272 160" width="272">
  <style>text { font-family: 'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif; }</style>
  ${body}
</svg>`;

test('the clean fixture uses 36px boxes for 12px text and passes', () => {
  assert.deepEqual(runCheck(boxHeight, fixture('pass/minimal.svg')), []);
});

test('a 26px box holding 12px text is an error naming the 36px target', () => {
  const findings = runCheck(boxHeight, fixture('fail/short-box.svg'));
  const short = findings.find((f) => f.code === 'box-too-short');
  assert.equal(short.severity, 'error');
  assert.equal(short.repair.attribute, 'height');
  assert.equal(short.repair.actual, '26');
  assert.equal(short.repair.expected, '36');
  // a single line takes the other arm of the hint; without this line, swapping the two arms
  // of the ternary would still pass.
  assert.equal(short.repair.hint, 'font-size × 3');
  assert.equal(short.line, 5);
  assert.equal(short.column, 3);
});

test('a two-line box needs 36 + 18 = 54px', () => {
  const tooShort = WRAP(`<rect x="22" y="40" width="120" height="48" fill="#dbeafe" stroke="#3b82f6"/>
  <text x="82" y="58" font-size="12" text-anchor="middle" fill="#1e40af">First line</text>
  <text x="82" y="76" font-size="12" text-anchor="middle" fill="#1e40af">Second line</text>`);
  const findings = runCheck(boxHeight, tooShort);
  assert.deepEqual(codes(findings), ['box-too-short']);
  assert.equal(findings[0].repair.expected, '54');
  assert.equal(findings[0].repair.hint, 'font-size × 3 + 1 × 18px line height');
});

test('a correctly sized two-line box passes', () => {
  const ok = WRAP(`<rect x="22" y="40" width="120" height="54" fill="#dbeafe" stroke="#3b82f6"/>
  <text x="82" y="61" font-size="12" text-anchor="middle" fill="#1e40af">First line</text>
  <text x="82" y="79" font-size="12" text-anchor="middle" fill="#1e40af">Second line</text>`);
  assert.deepEqual(runCheck(boxHeight, ok), []);
});

test('line spacing away from font-size x 1.5 is a warning', () => {
  const tight = WRAP(`<rect x="22" y="40" width="120" height="54" fill="#dbeafe" stroke="#3b82f6"/>
  <text x="82" y="61" font-size="12" text-anchor="middle" fill="#1e40af">First line</text>
  <text x="82" y="74" font-size="12" text-anchor="middle" fill="#1e40af">Second line</text>`);
  const findings = runCheck(boxHeight, tight);
  const off = findings.find((f) => f.code === 'line-height-off');
  assert.equal(off.severity, 'warning');
  // line spacing is a relationship between two baselines, not a property of any single attribute, so attribute is intentionally omitted.
  assert.equal(off.repair.attribute, undefined);
  assert.equal(off.repair.actual, '13');
  assert.equal(off.repair.expected, '18');
});

test('boxes with no text are not measured', () => {
  assert.deepEqual(runCheck(boxHeight, WRAP('<rect x="22" y="40" width="120" height="9" fill="#dbeafe" stroke="#3b82f6"/>')), []);
});

test('a 16px single line needs 48px', () => {
  const findings = runCheck(boxHeight, WRAP(`<rect x="22" y="40" width="160" height="40" fill="#fef3c7" stroke="#f59e0b"/>
  <text x="102" y="65" font-size="16" text-anchor="middle" fill="#b45309">Big label</text>`));
  assert.equal(findings.find((f) => f.code === 'box-too-short').repair.expected, '48');
});

// note: this pins "a dashed grouping box produces no findings", **not** "the `contentRects` filter is doing the work" —
// replacing the iterable with `doc.rects` still passes. The real exemption happens upstream:
// `document.mjs` never binds any text to a dashed box (`dashed.texts.length` is always 0),
// and likewise for the background box. So `contentRects` and `rects` are currently equivalent in this check;
// `contentRects` is used for semantic correctness, and to stay correct if `document.mjs` changes.
test('a dashed grouping box is exempt from the body-box formula', () => {
  const grouped = WRAP(`<rect x="22" y="40" width="200" height="30" stroke-dasharray="6,4" fill="#f8fafc" stroke="#94a3b8"/>
  <text x="32" y="54" font-size="11" fill="#64748b">Server</text>`);
  assert.deepEqual(runCheck(boxHeight, grouped), []);
});

// A positive example of calibration 1. This is the most common false positive from this check: two text
// segments sharing one baseline (left label + right value), box height 36 is entirely correct. An
// implementation that counts lines by element count would report box-too-short 36→54 plus a line-height-off of 0px.
test('two labels sharing one baseline count as a single line', () => {
  const row = WRAP(`<rect x="22" y="40" width="200" height="36" fill="#dbeafe" stroke="#3b82f6"/>
  <text x="32" y="62" font-size="12" fill="#1e40af">Latency</text>
  <text x="212" y="62" font-size="12" text-anchor="end" fill="#1e40af">42 ms</text>`);
  assert.deepEqual(runCheck(boxHeight, row), []);
});

// The counter-case: two genuine lines are still reported. Without this, an implementation where line count is always 1 still passes.
test('two baselines still require the two-line height even when a row has two labels', () => {
  const rows = WRAP(`<rect x="22" y="40" width="200" height="36" fill="#dbeafe" stroke="#3b82f6"/>
  <text x="32" y="58" font-size="12" fill="#1e40af">Latency</text>
  <text x="212" y="58" font-size="12" text-anchor="end" fill="#1e40af">42 ms</text>
  <text x="32" y="76" font-size="12" fill="#1e40af">Second row</text>`);
  const findings = runCheck(boxHeight, rows);
  assert.equal(findings.find((f) => f.code === 'box-too-short').repair.expected, '54');
});

// Why BASELINE_EPSILON exists: a half-pixel y difference between two text segments on the same line is normal
// in hand-drawn diagrams. With the threshold at zero, that half pixel splits one line into two — a correct
// 36px box gets a box-too-short (claiming 54 is needed) plus a line-height-off of 0.4px, exactly the worst kind of false positive.
test('a sub-pixel difference in baseline still counts as one line', () => {
  const jitter = WRAP(`<rect x="22" y="40" width="200" height="36" fill="#dbeafe" stroke="#3b82f6"/>
  <text x="32" y="62" font-size="12" fill="#1e40af">Latency</text>
  <text x="212" y="62.4" font-size="12" text-anchor="end" fill="#1e40af">42 ms</text>`);
  assert.deepEqual(runCheck(boxHeight, jitter), []);
});

// An 11px label and 14px value on the same line, placed by the SKILL.md centring formula: mid-line 71,
// baselines are 71 + 0.35×11 = 74.85 and 71 + 0.35×14 = 75.9, difference 1.05px. Without accounting
// for this difference in the merge threshold, they are judged as two lines requiring 63px — an error-level
// false positive. 42px is the correct box height for 14px text.
test('a row mixing 11px and 14px at their centred baselines is one line', () => {
  const row = WRAP(`<rect x="22" y="50" width="220" height="42" rx="6" fill="#dbeafe" stroke="#3b82f6"/>
  <text x="32" y="74.85" font-size="11" fill="#1e40af">Latency</text>
  <text x="232" y="75.9" font-size="14" text-anchor="end" fill="#1e40af">42 ms</text>`);
  assert.deepEqual(runCheck(boxHeight, row), []);
});

// In the test above the smaller font sits higher, so the font-size difference is positive and the absolute
// value makes no difference. In hand-adjusted diagrams the larger font can easily sit higher (here 14px at
// y=75, 11px at y=76, difference 1px already exceeds the 0.5 base threshold): without the absolute value,
// the font-size difference becomes −3 and the threshold shrinks to −0.55, causing the same line to be judged as two.
test('the mixed-size allowance holds when the larger font sits higher', () => {
  const row = WRAP(`<rect x="22" y="50" width="220" height="42" rx="6" fill="#dbeafe" stroke="#3b82f6"/>
  <text x="32" y="75" font-size="14" fill="#1e40af">Latency</text>
  <text x="232" y="76" font-size="11" text-anchor="end" fill="#1e40af">42 ms</text>`);
  assert.deepEqual(runCheck(boxHeight, row), []);
});

// The floating-point tail from subtracting two y values must not appear in the report: 82.4 − 60.2 is 22.200000000000003 in IEEE 754.
test('the reported gap is rounded, not raw floating point', () => {
  const drifted = WRAP(`<rect x="22" y="40" width="160" height="60" fill="#dbeafe" stroke="#3b82f6"/>
  <text x="102" y="60.2" font-size="12" text-anchor="middle" fill="#1e40af">First</text>
  <text x="102" y="82.4" font-size="12" text-anchor="middle" fill="#1e40af">Second</text>`);
  const findings = runCheck(boxHeight, drifted);
  assert.deepEqual(codes(findings), ['line-height-off']);
  assert.equal(findings[0].repair.actual, '22.2');
  assert.match(findings[0].message, /22\.2px apart/);
});

// When a line has two text segments with different font sizes, the line is measured by the largest — the
// recommended line spacing is determined by the larger font. Taking the first or last seen makes this line
// 12px, which then collides with the "mixed font sizes, skip spacing check" exemption for the following
// 16px line, silently dropping a line-height-off that should be reported. Both writing orders are pinned
// once each: pinning only one order leaves the other variant fully green.
test('a line mixing font sizes takes the larger one when checking spacing', () => {
  const box = (first, second) => WRAP(`<rect x="22" y="40" width="220" height="90" fill="#dbeafe" stroke="#3b82f6"/>
  <text x="32" y="60" font-size="${first}" fill="#1e40af">Latency</text>
  <text x="212" y="60" font-size="${second}" text-anchor="end" fill="#1e40af">42</text>
  <text x="32" y="78" font-size="16" fill="#1e40af">Second row</text>`);
  for (const findings of [runCheck(boxHeight, box('12', '16')), runCheck(boxHeight, box('16', '12'))]) {
    assert.deepEqual(codes(findings), ['line-height-off']);
    assert.equal(findings[0].repair.actual, '18');
    assert.equal(findings[0].repair.expected, '24');
  }
});

// Both sides of HEIGHT_TOLERANCE must be pinned: testing only one side leaves a variant that changes 0.5 to 5 or removes the tolerance term entirely still passing.
test('the height tolerance forgives 0.5px but not 0.6px', () => {
  const box = (h) => WRAP(`<rect x="22" y="40" width="120" height="${h}" fill="#dbeafe" stroke="#3b82f6"/>
  <text x="82" y="62" font-size="12" text-anchor="middle" fill="#1e40af">Edge</text>`);
  assert.deepEqual(runCheck(boxHeight, box('35.5')), []);
  const findings = runCheck(boxHeight, box('35.4'));
  assert.deepEqual(codes(findings), ['box-too-short']);
  assert.equal(findings[0].repair.actual, '35.4');
});

// The recommended line height's expected value must scale with the font size. Hard-coding `String(rowHeight)`
// as `'18'` still passes every spacing test above because they all use 12px text (18 happens to be its
// line height). This test uses 16px text (line height 24) to distinguish the two implementations.
test('the recommended line height scales with the font size', () => {
  const box = (y2) => WRAP(`<rect x="22" y="40" width="160" height="72" fill="#fef3c7" stroke="#f59e0b"/>
  <text x="102" y="62" font-size="16" text-anchor="middle" fill="#b45309">First</text>
  <text x="102" y="${y2}" font-size="16" text-anchor="middle" fill="#b45309">Second</text>`);
  assert.deepEqual(runCheck(boxHeight, box('86')), []);
  const findings = runCheck(boxHeight, box('90'));
  assert.deepEqual(codes(findings), ['line-height-off']);
  assert.equal(findings[0].repair.actual, '28');
  assert.equal(findings[0].repair.expected, '24');
});

// Baselines must be sorted by y before merging; document order cannot be relied upon — in hand-drawn
// diagrams writing the second line first is entirely normal. Removing `sort` causes **silent false negatives**
// rather than false positives: the merge condition is `t.y - last.y <= BASELINE_EPSILON`, so in reverse
// order the difference is negative, two genuine lines are merged into one, line count is 1, and a two-line
// box with only 48px passes. The two assertions each pin one half (missing box-too-short / missing
// line-height-off) — asserting only "a tall enough reversed box returns []" cannot pin it: with or without
// sort, both implementations return [].
test('baselines are ordered by y, not by document order', () => {
  const reversed = (h, y2) => WRAP(`<rect x="22" y="40" width="120" height="${h}" fill="#dbeafe" stroke="#3b82f6"/>
  <text x="82" y="${y2}" font-size="12" text-anchor="middle" fill="#1e40af">Second line</text>
  <text x="82" y="61" font-size="12" text-anchor="middle" fill="#1e40af">First line</text>`);
  const short = runCheck(boxHeight, reversed('48', '79'));
  assert.deepEqual(codes(short), ['box-too-short']);
  assert.equal(short[0].repair.expected, '54');
  const tight = runCheck(boxHeight, reversed('54', '74'));
  assert.deepEqual(codes(tight), ['line-height-off']);
  assert.equal(tight[0].repair.actual, '13');
});

// LINE_SPACING_TOLERANCE follows the same pattern; one test per side.
test('the line spacing tolerance forgives 1px but not 1.5px', () => {
  const pair = (y2) => WRAP(`<rect x="22" y="40" width="120" height="60" fill="#dbeafe" stroke="#3b82f6"/>
  <text x="82" y="60" font-size="12" text-anchor="middle" fill="#1e40af">One</text>
  <text x="82" y="${y2}" font-size="12" text-anchor="middle" fill="#1e40af">Two</text>`);
  assert.deepEqual(runCheck(boxHeight, pair('79')), []);
  const findings = runCheck(boxHeight, pair('79.5'));
  assert.deepEqual(codes(findings), ['line-height-off']);
  assert.equal(findings[0].repair.actual, '19.5');
});

// Calibration 2. Box height is measured by max=14 (14×3 + 21 = 63), deliberately conservative; the
// spacing check is not reported because SKILL.md gives no recommended line height for mixed font sizes,
// so any expected value would be fabricated.
test('a box mixing font sizes is measured by the largest one and skips the spacing check', () => {
  const mixed = WRAP(`<rect x="22" y="40" width="160" height="54" fill="#dbeafe" stroke="#3b82f6"/>
  <text x="102" y="60" font-size="14" text-anchor="middle" fill="#1e40af">Title</text>
  <text x="102" y="78" font-size="11" text-anchor="middle" fill="#1e40af">caption</text>`);
  const findings = runCheck(boxHeight, mixed);
  assert.deepEqual(codes(findings), ['box-too-short']);
  assert.equal(findings[0].repair.expected, '63');
});

// The threshold allowance is widened by the **font-size difference**, not by the font size itself — the
// difference comes from 0.35 × Δfont-size in the centring formula. Same-size lines have no reason for any
// widening at all. Using `0.35 × smaller font size` (4.7 at 12px) would merge these two tightly-spaced
// baselines into one line, and a diagram with overlapping text would pass.
test('two same-size baselines 4px apart are two lines, not one', () => {
  const overlapping = WRAP(`<rect x="22" y="40" width="120" height="54" fill="#dbeafe" stroke="#3b82f6"/>
  <text x="82" y="60" font-size="12" text-anchor="middle" fill="#1e40af">One</text>
  <text x="82" y="64" font-size="12" text-anchor="middle" fill="#1e40af">Two</text>`);
  const findings = runCheck(boxHeight, overlapping);
  assert.deepEqual(codes(findings), ['line-height-off']);
  assert.equal(findings[0].repair.actual, '4');
});

// The **widening** side of the merge threshold: with a font-size difference of 7 (16px + 9px), the threshold
// is 0.35×7 + 0.5 = 2.95; a baseline separation of 20px far exceeds it, so two lines remain two lines. If
// the proportional term is enlarged (above 3.5), these two lines would be merged into one, and a two-line
// box with only 60px would silently pass — the tests above only pinned the tightening side.
test('a genuine two-line box with very different font sizes stays two lines', () => {
  const rows = WRAP(`<rect x="22" y="40" width="160" height="60" fill="#dbeafe" stroke="#3b82f6"/>
  <text x="102" y="60" font-size="16" text-anchor="middle" fill="#1e40af">Headline</text>
  <text x="102" y="80" font-size="9" text-anchor="middle" fill="#1e40af">footnote</text>`);
  const findings = runCheck(boxHeight, rows);
  assert.deepEqual(codes(findings), ['box-too-short']);
  assert.equal(findings[0].repair.expected, '72');
});

// The test above writes the larger font size first, so "take the font size of the first text segment" also passes.
// This test writes the smaller one first: using the first segment (11px) computes a required height of only
// 49.5px, letting the 54px box pass — a silent false negative.
test('the largest font wins even when the small one is written first', () => {
  const mixed = WRAP(`<rect x="22" y="40" width="160" height="54" fill="#dbeafe" stroke="#3b82f6"/>
  <text x="102" y="60" font-size="11" text-anchor="middle" fill="#1e40af">caption</text>
  <text x="102" y="81" font-size="14" text-anchor="middle" fill="#1e40af">Title</text>`);
  const findings = runCheck(boxHeight, mixed);
  assert.deepEqual(codes(findings), ['box-too-short']);
  assert.equal(findings[0].repair.expected, '63');
});

test('a mixed-font-size box tall enough for the largest font passes', () => {
  const mixed = WRAP(`<rect x="22" y="40" width="160" height="63" fill="#dbeafe" stroke="#3b82f6"/>
  <text x="102" y="62" font-size="14" text-anchor="middle" fill="#1e40af">Title</text>
  <text x="102" y="83" font-size="11" text-anchor="middle" fill="#1e40af">caption</text>`);
  assert.deepEqual(runCheck(boxHeight, mixed), []);
});

// ---- a card's height does not come from the font size ----
// The formula in the style guide sizes a labelled box around its own text. A card holds boxes, and
// the texts that fall inside it — its heading, and any annotation that happens to sit in the same
// area — are not lines of one label, so the distance between them is not a line height.
const CARD = (body) => `<svg viewBox="0 0 320 200" width="320">
  <style>text { font-family: 'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif; }</style>
  <rect x="25" y="25" width="270" height="150" rx="10" fill="#f3e8ff" stroke="#a855f7"/>
  <text x="160" y="45" font-size="12" fill="#6b21a8" text-anchor="middle">Card heading</text>
  <rect x="45" y="65" width="110" height="36" rx="6" fill="#dbeafe" stroke="#3b82f6"/>
  <text x="100" y="87" font-size="12" fill="#1e40af" text-anchor="middle">A</text>
  <rect x="45" y="126" width="110" height="36" rx="6" fill="#d1fae5" stroke="#22c55e"/>
  <text x="100" y="148" font-size="12" fill="#166534" text-anchor="middle">B</text>
  ${body}
</svg>`;

test('a card is not measured against the font-size height formula', () => {
  // The heading at y=45 and the annotation at y=118 both fall inside the card at the same font
  // size, and their 73px separation was reported as a line height that should have been 18px.
  const src = CARD('<text x="215" y="118" font-size="12" fill="#64748b" text-anchor="middle">flow</text>');
  assert.deepEqual(codes(runCheck(boxHeight, src)), []);
});

test('a box inside a card is still measured against the formula', () => {
  // The control: only the card leaves the check. Shrinking one member to 20px must still be
  // reported as too short for a single 12px line, which needs 36px.
  const src = CARD('').replace('y="126" width="110" height="36"', 'y="126" width="110" height="20"');
  const findings = runCheck(boxHeight, src);
  assert.deepEqual(codes(findings), ['box-too-short']);
  assert.equal(findings[0].repair.actual, '20');
  assert.equal(findings[0].repair.expected, '36');
});

test('a labelled box carrying a small badge is still measured for height', () => {
  // "Encloses a labelled box" is a wide net: an ordinary box with a `v2` badge in the corner meets
  // it. That is deliberate elsewhere, so the exemption here is confined to the line-height rule and
  // the height formula keeps running — otherwise one badge silences the commonest defect there is.
  // Outer box 30px tall for a 12px label needs 36px; the badge is 24px for its own 8px label, which
  // is exactly right, so the only finding belongs to the outer box.
  const src = WRAP(`<rect x="22" y="40" width="210" height="30" fill="#dbeafe" stroke="#3b82f6"/>
  <text x="90" y="59" font-size="12" fill="#1e40af" text-anchor="middle">Ingest service</text>
  <rect x="196" y="43" width="28" height="24" fill="#fef3c7" stroke="#f59e0b"/>
  <text x="210" y="58" font-size="8" fill="#92400e" text-anchor="middle">v2</text>`);
  const findings = runCheck(boxHeight, src);
  assert.deepEqual(codes(findings), ['box-too-short']);
  assert.equal(findings[0].repair.actual, '30');
  assert.equal(findings[0].repair.expected, '36');
});

// Wiring test: every test above calls check.run() directly, so removing this check from the registry still passes.
// Filter is needed — short-box.svg has a 62px top margin, so viewbox-clipping also reports findings for it.
test('the check is wired into the registry, so lintSource reports it', () => {
  const { findings } = lintSource('short-box.svg', fixture('fail/short-box.svg'));
  assert.deepEqual(
    findings.filter((f) => f.check === 'box-height').map((f) => f.code),
    ['box-too-short'],
  );
});
