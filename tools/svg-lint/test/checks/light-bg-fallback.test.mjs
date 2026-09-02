// tools/svg-lint/test/checks/light-bg-fallback.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lightBgFallback } from '../../lib/checks/light-bg-fallback.mjs';
import { runCheck, fixture, hasCode } from '../helpers/load.mjs';

const WRAP = (body, vb = '0 0 272 120', w = '272') => `<svg viewBox="${vb}" width="${w}">
  <style>text { font-family: 'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif; }</style>
  ${body}
</svg>`;

test('the clean fixture has a background rect and passes', () => {
  assert.deepEqual(runCheck(lightBgFallback, fixture('pass/minimal.svg')), []);
});

test('no background rect plus dark uncontained text is a warning', () => {
  const findings = runCheck(lightBgFallback, fixture('fail/no-background.svg'));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, 'warning');
  assert.equal(findings[0].code, 'no-light-background');
  assert.match(findings[0].repair.hint, /background rect/);
});

test('text inside a content box is not flagged even without a canvas background', () => {
  // The box fill is #dbeafe and the text sits on the box, not touching the canvas directly
  const src = WRAP(`<rect x="22" y="62" width="228" height="36" rx="6" fill="#dbeafe" stroke="#3b82f6"/>
  <text x="136" y="84" font-size="12" fill="#1e40af" text-anchor="middle">Ingest</text>`);
  assert.deepEqual(runCheck(lightBgFallback, src), []);
});

test('light-coloured uncontained text passes without a background rect', () => {
  // #94a3b8 has enough contrast on DARK_CANVAS and needs no background rectangle
  const src = WRAP(`<text x="136" y="32" font-size="16" fill="#94a3b8" text-anchor="middle">Light text</text>`);
  assert.equal(hasCode(runCheck(lightBgFallback, src), 'no-light-background'), false);
});

test('labels on an opaque strokeless panel are left alone', () => {
  // The panel is white and covers less than the viewBox, so it is not the canvas background, yet
  // it does paint behind both labels and they are legible. An implementation that only exempts
  // text inside a *stroked* box reports these two at 1.29:1 and 1.83:1 and tells the author to
  // add a background rect, with one already painted behind them. The 98% area rule lives in
  // document.mjs and is pinned there, so this case is about the fill, not the size.
  const src = WRAP(`<rect x="10" y="10" width="252" height="100" fill="#ffffff"/>
  <text x="136" y="40" font-size="14" fill="#1e293b" text-anchor="middle">on a white panel</text>
  <text x="136" y="70" font-size="14" fill="#334155" text-anchor="middle">also on white</text>`);
  assert.deepEqual(runCheck(lightBgFallback, src), []);
});

test('an unfilled box is not a shield, so its label is still measured', () => {
  // The canvas shows straight through a `fill="none"` box, so the label on it is as exposed as one
  // drawn on bare canvas. Exempting text merely for having a container misses this.
  const src = WRAP(`<rect x="22" y="14" width="228" height="36" fill="none" stroke="#3b82f6"/>
  <text x="136" y="36" font-size="16" fill="#1e293b" text-anchor="middle">Dark title</text>`);
  assert.equal(hasCode(runCheck(lightBgFallback, src), 'no-light-background'), true);
});

test('a full-canvas frame with no fill does not count as the background', () => {
  // House style draws a dashed full-diagram frame, which has no fill and therefore hides nothing.
  // Because the background rect is picked by area alone, taking its existence as proof of a light
  // background silences this check for the whole file.
  const src = WRAP(`<rect x="0" y="0" width="272" height="120" fill="none" stroke="#94a3b8" stroke-dasharray="4 3"/>
  <text x="136" y="32" font-size="16" fill="#1e293b" text-anchor="middle">Dark title</text>`);
  assert.equal(hasCode(runCheck(lightBgFallback, src), 'no-light-background'), true);
});

test('a full-canvas rect painted transparent does not count as the background', () => {
  // `transparent` paints nothing, exactly like `none`, so the canvas still reaches the glyphs.
  const src = WRAP(`<rect x="0" y="0" width="272" height="120" fill="transparent"/>
  <text x="136" y="32" font-size="16" fill="#1e293b" text-anchor="middle">Dark title</text>`);
  assert.equal(hasCode(runCheck(lightBgFallback, src), 'no-light-background'), true);
});

test('a group name on a filled dashed group box is left alone', () => {
  // A dashed rect is never a `container`, because dashed rects are held out of contentRects, so
  // without consulting group boxes the label on a filled one is reported although the fill is
  // painted right behind it.
  const src = WRAP(`<rect x="22" y="14" width="228" height="60" fill="#f8fafc" stroke="#94a3b8" stroke-dasharray="4 3"/>
  <text x="136" y="36" font-size="16" fill="#1e293b" text-anchor="middle">Group name</text>`);
  assert.deepEqual(runCheck(lightBgFallback, src), []);
});

test('a name that overflows its filled group box is still measured', () => {
  // A group name is bound to its box by the text centre, because a long name in a narrow box
  // overflows and would otherwise not be recognised as that box's name. Paint is a different
  // question: this name is centred in an 80px box and runs well past both edges, so most of it is
  // over bare canvas. Testing the centre for the shield reports nothing here.
  const src = WRAP(`<rect x="20" y="20" width="80" height="60" fill="#f8fafc" stroke="#94a3b8" stroke-dasharray="4 3"/>
  <text x="60" y="46" font-size="16" fill="#1e293b" text-anchor="middle">Employee instances and their owners</text>`, '0 0 400 120', '400');
  assert.equal(hasCode(runCheck(lightBgFallback, src), 'no-light-background'), true);
});

test('a filled group box shields only the text drawn on it', () => {
  // The group box paints, but this label is nowhere near it. An implementation that asks only
  // "does the file contain a painted group box" silences every text in the file, which is the
  // whole-file silencing the background-rect cases above guard against, arriving by another door.
  const src = WRAP(`<rect x="20" y="20" width="80" height="40" fill="#f8fafc" stroke="#94a3b8" stroke-dasharray="4 3"/>
  <text x="300" y="100" font-size="16" fill="#1e293b" text-anchor="middle">far away</text>`, '0 0 400 120', '400');
  assert.equal(hasCode(runCheck(lightBgFallback, src), 'no-light-background'), true);
});

test('an unfilled dashed group box does not shield its name', () => {
  // The house-style group box has no fill, so the same label is exposed. This is the other side of
  // the test above: an implementation that exempts text over any group box, painted or not, passes
  // that one and fails here.
  const src = WRAP(`<rect x="22" y="14" width="228" height="60" fill="none" stroke="#94a3b8" stroke-dasharray="4 3"/>
  <text x="136" y="36" font-size="16" fill="#1e293b" text-anchor="middle">Group name</text>`);
  assert.equal(hasCode(runCheck(lightBgFallback, src), 'no-light-background'), true);
});

test('a light background rect ends the question, whatever colour the text is', () => {
  // #94a3b8 is 7.38:1 on the dark canvas but only 2.56:1 on white. Measuring text against the
  // background's own fill would report this caption the moment the author followed the hint and
  // added the white rect, so a passing diagram would fail for having taken the advice. Contrast
  // against a box or background fill is the palette check's question, not this one's.
  const src = WRAP(`<rect x="0" y="0" width="272" height="120" fill="#ffffff"/>
  <text x="136" y="32" font-size="14" fill="#94a3b8" text-anchor="middle">caption</text>`);
  assert.deepEqual(runCheck(lightBgFallback, src), []);
});

test('a dark full-canvas rect exempts the file, a known gap', () => {
  // Pinned as a false negative on purpose. A background rect painted dark is the defect this check
  // describes, one layer up, but catching it here means measuring text against the background fill,
  // which reports palette colours on a white background. The colour of a background rect is the
  // palette check's business. If this test ever turns red, check which of the two problems the
  // change traded for the other.
  const src = WRAP(`<rect x="0" y="0" width="272" height="120" fill="#0f172a"/>
  <text x="136" y="32" font-size="16" fill="#1e293b" text-anchor="middle">Dark title</text>`);
  assert.deepEqual(runCheck(lightBgFallback, src), []);
});

test('text with no fill attribute is measured as black', () => {
  // SVG's initial fill is black, which is the worst case on a dark canvas. The check leans on
  // effectiveFill for this rather than repeating the default.
  const src = WRAP('<text x="136" y="32" font-size="16" text-anchor="middle">No fill</text>');
  const findings = runCheck(lightBgFallback, src);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].repair.actual, '1.11');
  assert.equal(findings[0].repair.expected, '4.5');
});

test('any rect at all is not enough to count as a background', () => {
  // The rect covers 228 × 28 of a 272 × 120 viewBox, a fifth of it, so it is not the canvas
  // background. It is drawn clear of
  // the label on purpose: a rect the label sits on would make the label its content, which the
  // test above exempts, and then this case could not tell "a partial rect is not a background"
  // apart from that exemption. An implementation that accepted any rect as the background would
  // return nothing here.
  const src = WRAP(`<rect x="22" y="70" width="228" height="28" fill="#ffffff"/>
  <text x="136" y="32" font-size="16" fill="#1e293b" text-anchor="middle">No full bg</text>`);
  assert.equal(hasCode(runCheck(lightBgFallback, src), 'no-light-background'), true);
});

test('the repair names the canvas colour, and NONE does not count as paint', () => {
  // Two things no other test here covers: the hint has to quote a real colour for the author to paste, and the
  // keyword check is case-insensitive — a `fill="NONE"` paints nothing, so treating it as a shield drops the
  // warning for every label behind it.
  const src = WRAP(`<rect x="0" y="0" width="272" height="120" fill="NONE"/>
  <text x="136" y="64" font-size="16" fill="#1e293b" text-anchor="middle">on nothing</text>`);
  const found = runCheck(lightBgFallback, src).find((f) => f.code === 'no-light-background');
  assert.equal(found !== undefined, true);
  assert.match(found.repair.hint, /fill="#ffffff"/);
});

test('a label on a filled circle is left alone', () => {
  // Nothing makes a circle a text's container, so before the shapes carried colours this legible caption
  // on a white disc was reported at 1.29:1 and the author was told to add a background rect.
  const src = WRAP(`<circle cx="136" cy="60" r="55" fill="#ffffff"/>
  <text x="136" y="64" font-size="16" fill="#1e293b" text-anchor="middle">on a disc</text>`);
  assert.deepEqual(runCheck(lightBgFallback, src), []);
});

test('an unfilled circle does not shield the label drawn on it', () => {
  // The other side of the test above: the canvas shows straight through a fill="none" outline, exactly as
  // it does through an unfilled box, so exempting text for merely overlapping a shape is wrong.
  const src = WRAP(`<circle cx="136" cy="60" r="55" fill="none" stroke="#94a3b8"/>
  <text x="136" y="64" font-size="16" fill="#1e293b" text-anchor="middle">on a ring</text>`);
  assert.equal(hasCode(runCheck(lightBgFallback, src), 'no-light-background'), true);
});

test('a filled polygon shields the label drawn on it', () => {
  // A polygon fills its outline like any closed shape. The diamond here is wide enough that the label's
  // whole box is inside its bounding box.
  const src = WRAP(`<polygon points="136,10 246,60 136,110 26,60" fill="#ffffff"/>
  <text x="136" y="64" font-size="14" fill="#1e293b" text-anchor="middle">decision</text>`);
  assert.deepEqual(runCheck(lightBgFallback, src), []);
});

test('a fill on a line shields nothing, because a line paints none of it', () => {
  // `fill` on a <line> is inert: the browser paints the stroke and nothing else, so the canvas still
  // reaches the glyphs. Treating all five shapes alike silences this label.
  const src = WRAP(`<line x1="26" y1="10" x2="246" y2="110" fill="#ffffff" stroke="#94a3b8"/>
  <text x="136" y="64" font-size="14" fill="#1e293b" text-anchor="middle">on a line</text>`);
  assert.equal(hasCode(runCheck(lightBgFallback, src), 'no-light-background'), true);
});

test('a filled circle shields only the text drawn on it', () => {
  // The same whole-file-silencing trap the group-box door guards against, arriving by the shape door:
  // asking only whether the file contains a painted shape exempts every label in it.
  const src = WRAP(`<circle cx="60" cy="60" r="40" fill="#ffffff"/>
  <text x="300" y="100" font-size="16" fill="#1e293b" text-anchor="middle">far away</text>`, '0 0 400 120', '400');
  assert.equal(hasCode(runCheck(lightBgFallback, src), 'no-light-background'), true);
});

// ---- a painted solid box shields the glyphs drawn over it ----
// A card painted white is a shield exactly as a background rect is. The label here is bound to the
// inner box, which is `fill="none"`, so the paint it sits on comes from the card behind it.
const OVER_CARD = (cardFill, innerFill = 'none') => WRAP(`<rect x="20" y="20" width="220" height="80" rx="10" fill="${cardFill}" stroke="#94a3b8"/>
  <rect x="55" y="42" width="150" height="36" rx="6" fill="${innerFill}" stroke="#3b82f6"/>
  <text x="130" y="64" font-size="12" fill="#1e40af" text-anchor="middle">Legible label</text>`, '0 0 260 120', '260');

test('a label over a painted card is left alone even where its own box is unfilled', () => {
  assert.deepEqual(runCheck(lightBgFallback, OVER_CARD('#ffffff')), []);
});

test('an unfilled card does not shield the label inside it', () => {
  // The control: the door opens on paint, not on the box existing. With both boxes unfilled the
  // canvas reaches the glyphs and the label is still reported.
  assert.equal(hasCode(runCheck(lightBgFallback, OVER_CARD('none')), 'no-light-background'), true);
});

test('a dark card shields the label over it, the same known gap as a dark canvas rect', () => {
  // Paint of any colour shields — deliberate, and shared with the group-box and shape doors. A
  // dark card hides a dark label just as well, and a non-house colour is the palette check's to
  // catch. If this ever becomes a contrast comparison it must change in all four doors at once.
  assert.deepEqual(runCheck(lightBgFallback, OVER_CARD('#1e293b')), []);
});

test('a painted box shields only the text drawn over it', () => {
  // The whole-file-silencing trap, arriving by the solid-box door: asking only whether the file
  // contains a painted box exempts every label in it.
  const src = WRAP(`<rect x="20" y="20" width="120" height="60" fill="#ffffff" stroke="#94a3b8"/>
  <text x="300" y="100" font-size="16" fill="#1e293b" text-anchor="middle">far away</text>`, '0 0 400 120', '400');
  assert.equal(hasCode(runCheck(lightBgFallback, src), 'no-light-background'), true);
});

test('a document with no text needs no background', () => {
  const src = WRAP('<rect x="22" y="40" width="120" height="36" fill="#dbeafe" stroke="#3b82f6"/>');
  assert.deepEqual(runCheck(lightBgFallback, src), []);
});
