// tools/svg-lint/test/checks/baseline-offset.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { baselineOffset } from '../../lib/checks/baseline-offset.mjs';
import { lintSource } from '../../lib/lint.mjs';
import { runCheck, fixture, codes } from '../helpers/load.mjs';

const WRAP = (body, viewBox = '0 0 272 160', width = '272') => `<svg viewBox="${viewBox}" width="${width}">
  <style>text { font-family: 'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif; }</style>
  ${body}
</svg>`;

// box x=22 y=40 w=120 h=36 → centre x=82, expected baseline for 12px: 40 + 18 + 4.2 = 62.2.
const oneBox = (textAttrs, label = 'Edge') => WRAP(`<rect x="22" y="40" width="120" height="36" fill="#dbeafe" stroke="#3b82f6"/>
  <text ${textAttrs} font-size="12" fill="#1e40af">${label}</text>`);

test('the clean fixture puts baselines at box centre + font-size x 0.35', () => {
  assert.deepEqual(runCheck(baselineOffset, fixture('pass/minimal.svg')), []);
});

test('using the plain box centre as the baseline is a warning naming 84.2', () => {
  const findings = runCheck(baselineOffset, fixture('fail/baseline-off.svg'));
  // deepEqual rather than find: this diagram should have exactly one finding; find would hide any extras.
  assert.deepEqual(codes(findings), ['baseline-off-center']);
  assert.equal(findings[0].severity, 'warning');
  assert.equal(findings[0].repair.attribute, 'y');
  assert.equal(findings[0].repair.actual, '80');
  assert.equal(findings[0].repair.expected, '84.2');
  assert.equal(findings[0].line, 6);
  assert.equal(findings[0].column, 3);
});

test('a label inside a box without text-anchor reports the attribute as absent', () => {
  // y=62 is within tolerance of the expected 62.2 (difference 0.2), so only the anchor finding appears here.
  const findings = runCheck(baselineOffset, oneBox('x="30" y="62"', 'Left aligned'));
  assert.deepEqual(codes(findings), ['label-not-centered']);
  assert.equal(findings[0].severity, 'error');
  assert.equal(findings[0].repair.attribute, 'text-anchor');
  assert.equal(findings[0].repair.expected, 'middle');
  // "attribute not written at all" and "written as end" are two different problems; repair.actual must
  // distinguish them: reporting the resolved value start would send the author searching for a
  // text-anchor="start" that does not exist.
  assert.equal(findings[0].repair.actual, 'absent');
});

test('an explicitly end-anchored label reports end, not the resolved default', () => {
  const findings = runCheck(baselineOffset, oneBox('x="130" y="62" text-anchor="end"', 'Right'));
  assert.deepEqual(codes(findings), ['label-not-centered']);
  assert.equal(findings[0].repair.actual, 'end');
});

test('a middle-anchored label whose x misses the box centre is a warning', () => {
  const findings = runCheck(baselineOffset, oneBox('x="95" y="62" text-anchor="middle"', 'Shifted'));
  assert.deepEqual(codes(findings), ['label-off-box-center']);
  assert.equal(findings[0].severity, 'warning');
  assert.equal(findings[0].repair.attribute, 'x');
  assert.equal(findings[0].repair.actual, '95');
  assert.equal(findings[0].repair.expected, '82');
});

test('one box can report both a bad baseline and a bad anchor', () => {
  // this is the case where two findings appear simultaneously. the old pattern used find(...) to pick
  // one, making "the other finding is missing" and "both findings are present" look identical in the assertion.
  const findings = runCheck(baselineOffset, oneBox('x="30" y="50"', 'Left and high'));
  assert.deepEqual(codes(findings), ['baseline-off-center', 'label-not-centered']);
});

test('text outside any box is not measured against a baseline', () => {
  assert.deepEqual(runCheck(baselineOffset, WRAP('<text x="136" y="32" font-size="16" fill="#1e293b" text-anchor="middle">Title</text>')), []);
});

test('a left-aligned label on a dashed grouping box is not an anchor error', () => {
  // SKILL.md's own example draws grouping this way: a dashed box with a left-aligned group name in the
  // top-left corner. reporting it as label-not-centered is a false positive, and the most glaring kind —
  // following the skill exactly earns an error. the exemption happens upstream: document.mjs does not
  // treat dashed boxes as containers, so the group name's container is null.
  assert.deepEqual(runCheck(baselineOffset, WRAP(`<rect x="22" y="40" width="200" height="90" stroke-dasharray="6,4" fill="#f8fafc" stroke="#94a3b8"/>
  <text x="32" y="56" font-size="11" fill="#64748b">Server</text>
  <rect x="40" y="70" width="120" height="36" rx="6" fill="#dbeafe" stroke="#3b82f6"/>
  <text x="100" y="92" font-size="12" text-anchor="middle" fill="#1e40af">Ingest</text>`)), []);
});

test('a left-aligned title over a full-canvas background rect is not an anchor error', () => {
  // the background rect covers the full canvas and geometrically "encloses" the title. if it counts
  // as a container, every diagram's left-aligned title gets one report — also a false positive.
  assert.deepEqual(runCheck(baselineOffset, `<svg viewBox="0 0 272 120" width="272">
  <style>text { font-family: 'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif; }</style>
  <rect x="0" y="0" width="272" height="120" fill="#ffffff"/>
  <text x="20" y="32" font-size="16" fill="#1e293b">Left aligned title</text>
  <rect x="22" y="62" width="228" height="36" rx="6" fill="#dbeafe" stroke="#3b82f6"/>
  <text x="136" y="84" font-size="12" text-anchor="middle" fill="#1e40af">Ingest</text>
</svg>`), []);
});

test('a multi-line box is left to the box-height line spacing check', () => {
  // deepEqual([]) rather than "no baseline-off-center": the whole diagram is compliant; asserting zero
  // findings also pins that the anchor branch does not fire spuriously on multi-line boxes.
  assert.deepEqual(runCheck(baselineOffset, WRAP(`<rect x="22" y="40" width="120" height="54" fill="#dbeafe" stroke="#3b82f6"/>
  <text x="82" y="61" font-size="12" text-anchor="middle" fill="#1e40af">One</text>
  <text x="82" y="79" font-size="12" text-anchor="middle" fill="#1e40af">Two</text>`)), []);
});

test('a 16px label in a 48px box centres at y = box.y + 24 + 5.6', () => {
  // box y=40 h=48 → expected baseline 40 + 24 + 5.6 = 69.6, given 70 here, within tolerance
  assert.deepEqual(runCheck(baselineOffset, WRAP(`<rect x="22" y="40" width="160" height="48" fill="#fef3c7" stroke="#f59e0b"/>
  <text x="102" y="70" font-size="16" text-anchor="middle" fill="#b45309">Big</text>`)), []);
});

test('the baseline tolerance is 1 unit in both directions', () => {
  // expected 62.2. a difference of 1.0 passes, 1.2 reports; changing the tolerance in either
  // direction turns the test red.
  // both low and high are tested: without taking the absolute value before comparing, the "text too
  // high" half is silently missed.
  assert.deepEqual(runCheck(baselineOffset, oneBox('x="82" y="63.2" text-anchor="middle"')), []);
  assert.deepEqual(runCheck(baselineOffset, oneBox('x="82" y="61.2" text-anchor="middle"')), []);
  const low = runCheck(baselineOffset, oneBox('x="82" y="63.4" text-anchor="middle"'));
  assert.deepEqual(codes(low), ['baseline-off-center']);
  assert.equal(low[0].repair.actual, '63.4');
  assert.equal(low[0].repair.expected, '62.2');
  const high = runCheck(baselineOffset, oneBox('x="82" y="61" text-anchor="middle"'));
  assert.deepEqual(codes(high), ['baseline-off-center']);
  assert.equal(high[0].repair.actual, '61');
});

test('the horizontal centring tolerance is 1 unit in both directions', () => {
  // box centre 82. a difference of 1 passes, 1.5 reports; both left and right offsets are tested —
  // same as above: without the absolute value, a label shifted left is never caught.
  assert.deepEqual(runCheck(baselineOffset, oneBox('x="83" y="62" text-anchor="middle"')), []);
  assert.deepEqual(runCheck(baselineOffset, oneBox('x="81" y="62" text-anchor="middle"')), []);
  const right = runCheck(baselineOffset, oneBox('x="83.5" y="62" text-anchor="middle"'));
  assert.deepEqual(codes(right), ['label-off-box-center']);
  assert.equal(right[0].repair.actual, '83.5');
  assert.equal(right[0].repair.expected, '82');
  const left = runCheck(baselineOffset, oneBox('x="80.5" y="62" text-anchor="middle"'));
  assert.deepEqual(codes(left), ['label-off-box-center']);
  assert.equal(left[0].repair.actual, '80.5');
});

test('the suggested y carries at most one decimal', () => {
  // the exact baseline for 13px is 40 + 18 + 4.55 = 62.55. repair is a value meant to be copied
  // directly into the SVG and promises one decimal place; without normalisation, odd font sizes
  // produce more digits than promised.
  const findings = runCheck(baselineOffset, WRAP(`<rect x="22" y="40" width="120" height="36" fill="#dbeafe" stroke="#3b82f6"/>
  <text x="82" y="70" font-size="13" text-anchor="middle" fill="#1e40af">Odd</text>`));
  assert.deepEqual(codes(findings), ['baseline-off-center']);
  assert.equal(findings[0].repair.expected, '62.5');
});

test('the check is wired into the registry, so lintSource reports it', () => {
  // without wiring, all 14 tests above pass but the CLI checks nothing. the fixture also trips
  // viewbox-clipping (top margin 62px), so filter by check name — without the filter this test
  // would need updating each time a new check is added.
  const { findings } = lintSource('baseline-off.svg', fixture('fail/baseline-off.svg'));
  assert.deepEqual(
    findings.filter((f) => f.check === 'baseline-offset').map((f) => f.code),
    ['baseline-off-center'],
  );
});

// ---- a label row sharing a baseline (left label + right value) ----
// box-height explicitly treats this shape as a valid single line; judging horizontal centring here
// would be two error-level false positives, and following the repair would stack both texts at the
// same x. the criterion is tightened to "the only text on this baseline".
test('two labels sharing a baseline are not judged for anchoring', () => {
  const row = WRAP(`<rect x="22" y="40" width="200" height="36" fill="#dbeafe" stroke="#3b82f6"/>
  <text x="32" y="62.2" font-size="12" fill="#1e40af">Latency</text>
  <text x="212" y="62.2" font-size="12" text-anchor="end" fill="#1e40af">42 ms</text>`);
  assert.deepEqual(runCheck(baselineOffset, row), []);
});

// a mixed-size label row: 11px and 14px each land at their own optical centre (58 + 3.85 and
// 58 + 4.9), baseline difference 1.05px, still one row. applying the largest font size uniformly
// would give the 11px segment a false positive of 1.05px.
test('a mixed-size label row is centred per text, not per line', () => {
  const row = WRAP(`<rect x="22" y="40" width="200" height="36" fill="#dbeafe" stroke="#3b82f6"/>
  <text x="32" y="61.85" font-size="11" fill="#1e40af">Latency</text>
  <text x="212" y="62.9" font-size="14" text-anchor="end" fill="#1e40af">42</text>`);
  assert.deepEqual(runCheck(baselineOffset, row), []);
});

// the exemption applies only to the horizontal branch: when the whole label row is in the wrong
// position, every segment must be reported.
test('a label row sitting too low still reports each baseline', () => {
  const row = WRAP(`<rect x="22" y="40" width="200" height="36" fill="#dbeafe" stroke="#3b82f6"/>
  <text x="32" y="70" font-size="12" fill="#1e40af">Latency</text>
  <text x="212" y="70" font-size="12" text-anchor="end" fill="#1e40af">42 ms</text>`);
  const findings = runCheck(baselineOffset, row);
  assert.deepEqual(codes(findings), ['baseline-off-center', 'baseline-off-center']);
  assert.equal(findings[0].repair.expected, '62.2');
});

// ---- solid outer frame / panel ----
// SKILL.md's "An outer box fully encloses the inner boxes" is the house style; the section name
// is placed in the top-left corner per house style. judging it for centring would suggest moving
// the name to the panel's centre, on top of the inner boxes — following that suggestion ruins the layout.
test('a section name on a solid outer panel is not judged', () => {
  const panel = `<svg viewBox="0 0 366 176" width="366">
  <style>text { font-family: 'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif; }</style>
  <rect x="22" y="40" width="322" height="112" rx="10" fill="#f8fafc" stroke="#94a3b8"/>
  <text x="32" y="58" font-size="11" fill="#64748b">Server</text>
  <rect x="42" y="70" width="120" height="36" rx="6" fill="#dbeafe" stroke="#3b82f6"/>
  <text x="102" y="92.2" font-size="12" text-anchor="middle" fill="#1e40af">Ingest</text>
  <rect x="202" y="70" width="120" height="36" rx="6" fill="#d1fae5" stroke="#22c55e"/>
  <text x="262" y="92.2" font-size="12" text-anchor="middle" fill="#065f46">Store</text>
</svg>`;
  assert.deepEqual(runCheck(baselineOffset, panel), []);
});

// guard against over-correction: the panel exemption covers only the panel itself; boxes inside
// it are still judged.
test('boxes inside a panel are still judged', () => {
  const panel = `<svg viewBox="0 0 366 176" width="366">
  <style>text { font-family: 'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif; }</style>
  <rect x="22" y="40" width="322" height="112" rx="10" fill="#f8fafc" stroke="#94a3b8"/>
  <text x="32" y="58" font-size="11" fill="#64748b">Server</text>
  <rect x="42" y="70" width="120" height="36" rx="6" fill="#dbeafe" stroke="#3b82f6"/>
  <text x="52" y="92.2" font-size="12" fill="#1e40af">Ingest</text>
</svg>`;
  assert.deepEqual(codes(runCheck(baselineOffset, panel)), ['label-not-centered']);
});

// ---- overall position of a multi-line content block ----
// a 54px box (y=40, centre 67) with two 12px lines: line centres 58 / 76, each plus 4.2 →
// baselines 62.2 / 80.2, midpoint 71.2 = box centre + 4.2. spacing between adjacent lines belongs
// to box-height; this check covers only the block's position —
// without this branch, no check in the repository fires when two lines are shifted together.
const twoLineBox = (y1, y2) => WRAP(`<rect x="22" y="40" width="120" height="54" fill="#dbeafe" stroke="#3b82f6"/>
  <text x="82" y="${y1}" font-size="12" text-anchor="middle" fill="#1e40af">First line</text>
  <text x="82" y="${y2}" font-size="12" text-anchor="middle" fill="#1e40af">Second line</text>`);

test('a correctly placed two-line block reports nothing', () => {
  assert.deepEqual(runCheck(baselineOffset, twoLineBox('62.2', '80.2')), []);
  // hand-drawn diagrams often write baselines as whole numbers, making the midpoint naturally off by
  // 1.2px — the tolerance must accommodate this.
  assert.deepEqual(runCheck(baselineOffset, twoLineBox('61', '79')), []);
});

test('a two-line block shifted up is a warning naming the wanted centre', () => {
  const findings = runCheck(baselineOffset, twoLineBox('56.2', '74.2'));
  assert.deepEqual(codes(findings), ['block-off-center']);
  assert.equal(findings[0].severity, 'warning');
  assert.equal(findings[0].repair.actual, '65.2');
  assert.equal(findings[0].repair.expected, '71.2');
  // what needs changing is each line's y, not any attribute on the box, so attribute is deliberately omitted.
  assert.equal(findings[0].repair.attribute, undefined);
  // actual / expected are the midpoint; what the author must actually do is "shift every line +6". the sign
  // is the easiest thing to get backwards, so the "shifted high" side pins the signed form.
  assert.match(findings[0].repair.hint, /shift every line's y by \+6\b/);
});

// both directions are tested once each: without taking the absolute value, the "block shifted low" half is silently missed.
test('a two-line block shifted down is reported too', () => {
  const findings = runCheck(baselineOffset, twoLineBox('68.2', '86.2'));
  assert.deepEqual(codes(findings), ['block-off-center']);
  assert.equal(findings[0].repair.actual, '77.2');
  // the sign in the other direction must also be pinned: if only the `+6` case is pinned, writing the shift as `Math.abs(...)` still passes.
  assert.match(findings[0].repair.hint, /shift every line's y by -6\b/);
});

test('the block tolerance forgives 1.5px but not 1.6px', () => {
  assert.deepEqual(runCheck(baselineOffset, twoLineBox('60.7', '78.7')), []);
  const findings = runCheck(baselineOffset, twoLineBox('60.6', '78.6'));
  assert.deepEqual(codes(findings), ['block-off-center']);
  assert.equal(findings[0].repair.actual, '69.6');
});

// the suggested x likewise promises one decimal place: when the box width is fractional, the centre
// comes out longer (22 + 121.3/2 = 82.65).
test('the suggested x carries at most one decimal', () => {
  const findings = runCheck(baselineOffset, WRAP(`<rect x="22" y="40" width="121.3" height="36" fill="#dbeafe" stroke="#3b82f6"/>
  <text x="90" y="62.2" font-size="12" text-anchor="middle" fill="#1e40af">Shifted</text>`));
  assert.deepEqual(codes(findings), ['label-off-box-center']);
  assert.equal(findings[0].repair.expected, '82.7');
});

// when the suggested y is a whole number it must not carry ".0": `toFixed(1)` alone produces "65.0",
// and the tests above all have fractional expected values, so the two implementations are indistinguishable.
test('a whole-number suggested y has no trailing zero', () => {
  const findings = runCheck(baselineOffset, WRAP(`<rect x="22" y="40" width="160" height="36" fill="#dbeafe" stroke="#3b82f6"/>
  <text x="102" y="70" font-size="20" text-anchor="middle" fill="#1e40af">Big</text>`));
  assert.deepEqual(codes(findings), ['baseline-off-center']);
  assert.equal(findings[0].repair.expected, '65');
});

// empty box: `groupIntoLines([])` returns an empty array and the multi-line branch would read
// `lines[0].y` — the `texts.length === 0` guard is genuinely blocking a TypeError (removing it
// causes this test to throw), not just decoration.
test('a box with no text at all is not measured', () => {
  assert.deepEqual(runCheck(baselineOffset, WRAP('<rect x="22" y="40" width="120" height="36" fill="#dbeafe" stroke="#3b82f6"/>')), []);
});

// the panel exemption only recognises "contains other diagram content". decorative swatches (icon
// squares, accent bars) do not count: using geometric containment alone lets a card with one icon
// escape the check entirely — which removes the most frequently mis-drawn type of box from checking.
test('a decorative swatch inside a card does not make the card a panel', () => {
  const withSwatch = WRAP(`<rect x="22" y="40" width="228" height="36" fill="#dbeafe" stroke="#3b82f6"/>
  <rect x="30" y="48" width="20" height="20" fill="#3b82f6" stroke="none"/>
  <text x="60" y="75" font-size="12" fill="#1e40af">Latency</text>`);
  assert.deepEqual(codes(runCheck(baselineOffset, withSwatch)), ['baseline-off-center', 'label-not-centered']);
});

// an empty dashed placeholder and the decorative swatch above are the same kind of thing: both
// candidate types need the same "box actually contains something" threshold, otherwise a card with
// one dashed placeholder can again exempt the whole card.
test('an empty dashed placeholder inside a card does not make the card a panel', () => {
  const withPlaceholder = WRAP(`<rect x="22" y="40" width="228" height="36" fill="#dbeafe" stroke="#3b82f6"/>
  <rect x="30" y="48" width="20" height="20" fill="none" stroke="#94a3b8" stroke-dasharray="3 3"/>
  <text x="60" y="75" font-size="12" fill="#1e40af">Latency</text>`);
  assert.deepEqual(codes(runCheck(baselineOffset, withPlaceholder)), ['baseline-off-center', 'label-not-centered']);
});

// each of the two "contains something" criteria is pinned once. this test pins the "encloses a
// content box" half: the dashed box contains **unlabelled** content boxes (a queue drawn as a
// dashed box with several empty slots has this shape); there are no text centres inside the box,
// only content boxes — without this half of the criterion, the outer box is not recognised as a
// panel, and the section name gets one error and one warning suggesting it be moved to the panel centre.
test('a dashed group holding unlabelled boxes still marks its outer box a panel', () => {
  const panel = WRAP(`<rect x="22" y="40" width="228" height="100" fill="#f8fafc" stroke="#94a3b8"/>
  <text x="32" y="58" font-size="11" fill="#64748b">Queue</text>
  <rect x="42" y="72" width="188" height="56" fill="none" stroke="#94a3b8" stroke-dasharray="4 4"/>
  <rect x="52" y="86" width="40" height="28" fill="#dbeafe" stroke="#3b82f6"/>
  <rect x="102" y="86" width="40" height="28" fill="#dbeafe" stroke="#3b82f6"/>
  <rect x="152" y="86" width="40" height="28" fill="#dbeafe" stroke="#3b82f6"/>`, '0 0 272 180', '272');
  assert.deepEqual(runCheck(baselineOffset, panel), []);
});

// a dashed grouping box must be counted as a separate kind of content: upstream it has no text
// bound to it, and the section name is instead bound to this outer solid box; looking only at texts
// does not identify this as a panel. the cost of failing to recognise it is two errors and one
// warning suggesting "move the section name to the panel centre, on top of the dashed box" —
// which is the house style shape described in SKILL.md.
test('a solid outer box enclosing only a dashed group box is a panel', () => {
  const panel = WRAP(`<rect x="22" y="40" width="228" height="100" fill="#f8fafc" stroke="#94a3b8"/>
  <text x="32" y="58" font-size="11" fill="#64748b">Server</text>
  <rect x="42" y="70" width="188" height="60" fill="none" stroke="#94a3b8" stroke-dasharray="4 4"/>
  <text x="52" y="86" font-size="11" fill="#64748b">Workers</text>`, '0 0 272 180', '272');
  assert.deepEqual(runCheck(baselineOffset, panel), []);
});

// the panel criterion must compare area: when two equally-sized boxes are drawn at the same position
// (a common layering technique separating fill from stroke), each "contains" the other; without the
// area comparison both are treated as panels and the left-aligned label inside them silently passes.
test('two identical stacked rects are not treated as panels', () => {
  const stacked = WRAP(`<rect x="22" y="40" width="120" height="36" fill="#dbeafe" stroke="none"/>
  <rect x="22" y="40" width="120" height="36" fill="none" stroke="#3b82f6"/>
  <text x="30" y="62.2" font-size="12" fill="#1e40af">Left</text>`);
  assert.deepEqual(codes(runCheck(baselineOffset, stacked)), ['label-not-centered']);
});

// the previous test blocked the "two equal solid boxes" case, but after tightening the candidate
// set the stroke layer is already excluded for having no text, so what truly pins the area
// comparison is this test: when the fill layer and stroke layer are written separately and the
// stroke layer is dashed, the dashed box enters the candidate set via "a text centre falls inside
// it"; without the area comparison, the solid box "contains" the equal-sized dashed box and becomes
// a panel, letting the left-aligned label silently pass.
test('a same-size dashed overlay does not turn its solid box into a panel', () => {
  const overlay = WRAP(`<rect x="22" y="40" width="120" height="36" fill="#dbeafe" stroke="none"/>
  <rect x="22" y="40" width="120" height="36" fill="none" stroke="#3b82f6" stroke-dasharray="4 4"/>
  <text x="30" y="62.2" font-size="12" fill="#1e40af">Planned</text>`);
  assert.deepEqual(codes(runCheck(baselineOffset, overlay)), ['label-not-centered']);
});

// both dimensions of the panel criterion must be checked: if only x is compared, the vertically
// offset box below is treated as "enclosed", making the box above a panel and letting its
// left-aligned label silently pass.
test('a box that only shares the x range is not enclosed', () => {
  const offset = WRAP(`<rect x="22" y="40" width="120" height="36" fill="#dbeafe" stroke="#3b82f6"/>
  <text x="30" y="62.2" font-size="12" fill="#1e40af">Left</text>
  <rect x="42" y="100" width="60" height="36" fill="#d1fae5" stroke="#22c55e"/>
  <text x="72" y="122.2" font-size="12" text-anchor="middle" fill="#065f46">In</text>`, '0 0 272 176', '272');
  assert.deepEqual(codes(runCheck(baselineOffset, offset)), ['label-not-centered']);
});

// a mixed-size two-line block: 20px heading + 9px note, line height computed from the largest
// font size 20 (line centres = box centre ± 15), baseline = line centre + 0.35 × each line's
// font size → midpoint = box centre + 0.35 × 14.5 = box centre + 5.075.
// using the largest font size (0.35 × 20 = 7) or the smallest (3.15) would flag this correctly
// placed card.
test('a mixed-size two-line block is centred on the average of first and last font sizes', () => {
  // box y=40 h=90 → centre 85; line centres 70 / 100; baselines 70+7=77 and 100+3.15=103.15.
  const mixed = WRAP(`<rect x="22" y="40" width="200" height="90" fill="#dbeafe" stroke="#3b82f6"/>
  <text x="122" y="77" font-size="20" text-anchor="middle" fill="#1e40af">42 ms</text>
  <text x="122" y="103.15" font-size="9" text-anchor="middle" fill="#1e40af">p99 latency</text>`, '0 0 244 170', '244');
  assert.deepEqual(runCheck(baselineOffset, mixed), []);
});
