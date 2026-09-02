// tools/svg-lint/test/checks/palette-conformance.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paletteConformance } from '../../lib/checks/palette-conformance.mjs';
import { runCheck, fixture, hasCode } from '../helpers/load.mjs';

const WRAP = (body, vb = '0 0 272 120', w = '272') => `<svg viewBox="${vb}" width="${w}">
  <style>text { font-family: 'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif; }</style>
  ${body}
</svg>`;
const offPalette = (src) => runCheck(paletteConformance, src).filter((f) => f.code === 'off-palette-color');

test('the clean fixture uses only palette colours in matched pairs', () => {
  assert.deepEqual(runCheck(paletteConformance, fixture('pass/minimal.svg')), []);
});

test('a colour outside the palette is a warning', () => {
  const findings = runCheck(paletteConformance, fixture('fail/off-palette.svg'));
  const off = findings.find((f) => f.code === 'off-palette-color');
  assert.equal(off.severity, 'warning');
  assert.match(off.message, /#ff00ff/);
});

test('mixing fills and strokes from different semantic triples is a warning', () => {
  const findings = runCheck(paletteConformance, fixture('fail/off-palette.svg'));
  const mismatch = findings.find((f) => f.code === 'semantic-pair-mismatch');
  assert.equal(mismatch.severity, 'warning');
  assert.equal(mismatch.repair.actual, '#ec4899');
  assert.equal(mismatch.repair.expected, '#3b82f6');
});

test('the pairing message names the box fill and the stroke that fill calls for', () => {
  // What a command-line reader sees. The sibling above reads repair.actual / repair.expected only, so the
  // sentence could name the stroke as the fill and the fill as the required stroke without a test noticing --
  // and the author would go looking for #3b82f6 as a fill in a file that uses it nowhere.
  const src = WRAP('<rect x="22" y="62" width="228" height="36" rx="6" fill="#dbeafe" stroke="#ec4899"/>');
  const findings = runCheck(paletteConformance, src).filter((f) => f.code === 'semantic-pair-mismatch');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].message, 'Fill #dbeafe belongs to the "input" triple, whose stroke is #3b82f6');
});

test('a label using the wrong semantic text colour is a warning', () => {
  // The Output triple (#d1fae5/#22c55e) paired with the Input text color (#1e40af) → does not match
  const src = `<svg viewBox="0 0 272 120" width="272">
  <style>text { font-family: 'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif; }</style>
  <rect x="0" y="0" width="272" height="120" fill="#ffffff"/>
  <rect x="22" y="62" width="228" height="36" rx="6" fill="#d1fae5" stroke="#22c55e"/>
  <text x="136" y="84" font-size="12" fill="#1e40af" text-anchor="middle">Store</text>
</svg>`;
  const findings = runCheck(paletteConformance, src);
  const wrong = findings.find((f) => f.code === 'semantic-text-color-mismatch');
  assert.equal(wrong.repair.expected, '#166534');
});

test('the label-colour message names the colour the label uses, not the one it should use', () => {
  // The Output triple with an Input label colour, as in the test above. That test reads repair.expected, so the
  // sentence could quote the triple's own text colour instead of the label's: the author would then be shown
  // #166534 as the value to search for, which is the value they are supposed to end up with.
  const src = WRAP(`<rect x="22" y="62" width="228" height="36" rx="6" fill="#d1fae5" stroke="#22c55e"/>
  <text x="136" y="84" font-size="12" fill="#1e40af" text-anchor="middle">Store</text>`);
  const findings = runCheck(paletteConformance, src).filter((f) => f.code === 'semantic-text-color-mismatch');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].message, 'Label colour #1e40af does not match the "output" triple');
});

test('the label-colour repair names the fill attribute and offers the base text colours', () => {
  // Both halves of the repair beyond the expected value. The attribute is what the author has to edit, and a
  // label's colour is its fill -- naming stroke sends them to an attribute the text does not have. The hint
  // carries the second legal answer: a base text colour is accepted on a semantic box, which is what the test
  // named "a base text colour on a box label is accepted" pins, so a repair that offers only the triple's own
  // colour hides half the rule.
  const src = WRAP(`<rect x="22" y="62" width="228" height="36" rx="6" fill="#d1fae5" stroke="#22c55e"/>
  <text x="136" y="84" font-size="12" fill="#1e40af" text-anchor="middle">Store</text>`);
  const findings = runCheck(paletteConformance, src).filter((f) => f.code === 'semantic-text-color-mismatch');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].repair.attribute, 'fill');
  assert.equal(findings[0].repair.hint, 'or use a base text colour');
});

test('a base text colour on a box label is accepted', () => {
  // The Output triple + the base primary text color #1e293b → allowed
  const src = `<svg viewBox="0 0 272 120" width="272">
  <style>text { font-family: 'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif; }</style>
  <rect x="0" y="0" width="272" height="120" fill="#ffffff"/>
  <rect x="22" y="62" width="228" height="36" rx="6" fill="#d1fae5" stroke="#22c55e"/>
  <text x="136" y="84" font-size="12" fill="#1e293b" text-anchor="middle">Store</text>
</svg>`;
  assert.equal(hasCode(runCheck(paletteConformance, src), 'semantic-text-color-mismatch'), false);
});

test('a semantic-fill rect with no explicit stroke does not trigger semantic-pair-mismatch', () => {
  // effectiveStroke falls back to 'none' (truthy), so testing against effectiveStroke(rect) instead of
  // rect.stroke would fire a false positive on every semantic-fill rect that simply has no stroke attribute.
  const src = `<svg viewBox="0 0 272 120" width="272">
  <style>text { font-family: 'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif; }</style>
  <rect x="0" y="0" width="272" height="120" fill="#ffffff"/>
  <rect x="22" y="62" width="228" height="36" rx="6" fill="#dbeafe"/>
</svg>`;
  assert.equal(hasCode(runCheck(paletteConformance, src), 'semantic-pair-mismatch'), false);
});

test('dashed grouping boxes with different dasharray or radius are a warning', () => {
  const src = `<svg viewBox="0 0 340 200" width="340">
  <style>text { font-family: 'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif; }</style>
  <rect x="0" y="0" width="340" height="200" fill="#ffffff"/>
  <rect x="22" y="22" width="140" height="150" rx="10" fill="#f8fafc" stroke="#94a3b8" stroke-dasharray="6,4"/>
  <rect x="190" y="22" width="128" height="150" rx="4" fill="#f8fafc" stroke="#94a3b8" stroke-dasharray="3,3"/>
</svg>`;
  const findings = runCheck(paletteConformance, src);
  const inconsistent = findings.filter((f) => f.code === 'group-box-style-inconsistent');
  // Both dasharray and rx differ, so exactly 2 findings are expected.
  assert.equal(inconsistent.length, 2);
  assert.equal(inconsistent[0].severity, 'warning');
});

test('consistently styled grouping boxes pass', () => {
  const src = `<svg viewBox="0 0 340 200" width="340">
  <style>text { font-family: 'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif; }</style>
  <rect x="0" y="0" width="340" height="200" fill="#ffffff"/>
  <rect x="22" y="22" width="140" height="150" rx="10" fill="#f8fafc" stroke="#94a3b8" stroke-dasharray="6,4"/>
  <rect x="190" y="22" width="128" height="150" rx="10" fill="#f8fafc" stroke="#94a3b8" stroke-dasharray="6,4"/>
</svg>`;
  assert.equal(hasCode(runCheck(paletteConformance, src), 'group-box-style-inconsistent'), false);
});

test('the full-bleed background rect is exempt from semantic pairing', () => {
  // The background has to be painted in some triple's fill for this to say anything: a white one is not a
  // triple fill, so pairing could never fire on it whichever list the loop walks. #dbeafe is the Input
  // triple's fill and #22c55e is the Output triple's stroke, a combination that would be reported on any
  // ordinary box -- but a canvas-sized backdrop is not a semantic box, and asking the author to draw a
  // green border around the entire diagram is not a repair.
  const src = WRAP('<rect x="0" y="0" width="272" height="120" fill="#dbeafe" stroke="#22c55e"/>');
  assert.equal(hasCode(runCheck(paletteConformance, src), 'semantic-pair-mismatch'), false);
});

test('a semantic-fill box that explicitly declares no stroke is not a pairing error', () => {
  // Two different spellings reach this check as "no stroke": nothing declared anywhere, and stroke="none"
  // written on purpose. Only the first leaves rect.stroke null, so a truthiness test alone passes the
  // sibling test above and reports this box, quoting 'none' as the stroke colour to replace.
  const src = WRAP('<rect x="22" y="62" width="228" height="36" rx="6" fill="#dbeafe" stroke="none"/>');
  assert.equal(hasCode(runCheck(paletteConformance, src), 'semantic-pair-mismatch'), false);
});

test('one stroke="none" on a group does not turn every box under it into a pairing error', () => {
  // rect.stroke resolves the attribute cascade, so a single stroke="none" on an ancestor is inherited by
  // every descendant and each one reports 'none' as its stroke. The blast radius is the whole diagram,
  // and the two boxes here are both correctly paired.
  const src = WRAP(`<g stroke="none">
    <rect x="22" y="22" width="100" height="36" rx="6" fill="#dbeafe"/>
    <rect x="150" y="22" width="100" height="36" rx="6" fill="#d1fae5"/>
  </g>`);
  assert.equal(hasCode(runCheck(paletteConformance, src), 'semantic-pair-mismatch'), false);
});

test('a semantic-fill box whose stroke is transparent is not a pairing error', () => {
  // Differs from the stroke="none" case in the keyword alone. `transparent` paints no border either, and the
  // off-palette arm already lets it through as naming no colour, so reporting it here would have the module
  // calling the same value not-a-colour in one loop and the wrong colour in the next -- and the repair it
  // offered would be to draw a border the author deliberately suppressed.
  const src = WRAP('<rect x="22" y="62" width="228" height="36" rx="6" fill="#dbeafe" stroke="transparent"/>');
  assert.equal(hasCode(runCheck(paletteConformance, src), 'semantic-pair-mismatch'), false);
});

test('a semantic-fill box stroked with a gradient is not a pairing error', () => {
  // Same reasoning, one step further out: a gradient has no hex to compare against the triple's stroke, so
  // naming a replacement would be a guess about colours this check never resolves.
  const src = `<svg viewBox="0 0 272 120" width="272">
  <defs><linearGradient id="g"><stop offset="0" stop-color="#3b82f6"/></linearGradient></defs>
  <rect x="22" y="62" width="228" height="36" rx="6" fill="#dbeafe" stroke="url(#g)"/>
</svg>`;
  assert.equal(hasCode(runCheck(paletteConformance, src), 'semantic-pair-mismatch'), false);
});

test('an off-palette label colour is reported on the text element', () => {
  // Labels have to be walked as well as boxes. Reading colours off rects alone lets every piece of text in
  // a diagram pick any colour it likes, and the semantic-text loop below catches only labels that sit
  // inside a recognised box -- a free-floating title is seen by nothing.
  const findings = offPalette(WRAP('<text x="136" y="32" font-size="16" fill="#ff7f50" text-anchor="middle">coral</text>'));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].repair.attribute, 'fill');
  assert.equal(findings[0].repair.actual, '#ff7f50');
});

test('an off-palette connector colour is reported on the path element', () => {
  // Connectors have to be walked too, and their colour lives on stroke rather than fill, so this one case
  // needs both the path in the walk and the stroke arm of the pair loop.
  const findings = offPalette(WRAP('<path d="M22,40 L 200,40" fill="none" stroke="#8b4513" stroke-width="1.5"/>'));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].repair.attribute, 'stroke');
  assert.equal(findings[0].repair.actual, '#8b4513');
});

test('an off-palette border on a box is reported even when the fill is a palette colour', () => {
  // The stroke arm on its own: the fill is the house background grey, so only the border is wrong. A loop
  // that reads fill and stops sees a compliant box here.
  const findings = offPalette(WRAP('<rect x="22" y="62" width="228" height="36" rx="6" fill="#f8fafc" stroke="#daa520"/>'));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].repair.attribute, 'stroke');
  assert.equal(findings[0].repair.actual, '#daa520');
});

test('a connector with no fill is told to write fill="none"', () => {
  // With no fill written, the path's fill resolves to SVG's initial black, which is why the reported value is
  // #000000. This straight two-point path encloses no area, so nothing of that black is actually painted and
  // it renders exactly as fill="none" would -- the missing attribute is still missing, and a path that turned
  // would paint the area it encloses. Quoting the palette back sends the author looking for a colour they
  // never chose, so the advice has to name what is actually missing.
  const findings = offPalette(WRAP('<path d="M22,40 L 200,40" stroke="#64748b" stroke-width="1.5"/>'));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].repair.actual, '#000000');
  assert.match(findings[0].repair.hint, /fill="none"/);
});

test('an off-palette box colour is told to pick a palette colour', () => {
  // The other side of the test above: the connector advice is specific to connectors, and a box that chose
  // a colour freely still gets pointed at the palette.
  const findings = offPalette(WRAP('<rect x="22" y="62" width="228" height="36" rx="6" fill="#4b0082"/>'));
  assert.equal(findings.length, 1);
  assert.match(findings[0].repair.hint, /semantic triples/);
});

test('a box with no fill is not told it needs fill="none"', () => {
  // Differs from the connector case in the tag alone, both being elements with no fill declared, so it is
  // the tag that has to carry the difference. An undeclared fill on a box is a box painted solid black, and
  // the repair is a colour; `fill="none"` would make it vanish.
  const findings = offPalette(WRAP('<rect x="22" y="62" width="228" height="36" rx="6"/>'));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].repair.actual, '#000000');
  assert.match(findings[0].repair.hint, /semantic triples/);
});

test('a connector that chose an off-palette fill is told to pick a palette colour', () => {
  // Differs from the connector case in one variable the other way: still a path, but the fill is declared,
  // so the author did choose it and the advice to write fill="none" would be guessing at their intent.
  const findings = offPalette(WRAP('<path d="M22,40 L 200,40" fill="#4b0082" stroke="#64748b"/>'));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].repair.actual, '#4b0082');
  assert.match(findings[0].repair.hint, /semantic triples/);
});

test('a colour name is reported as a name, not as an off-palette choice', () => {
  // `white` renders exactly the allowed #ffffff, so telling the author to pick a palette colour sends them
  // hunting for a swatch problem that is not there. Only hex is compared, because the palette is hex.
  const findings = offPalette(WRAP('<rect x="22" y="62" width="228" height="36" rx="6" fill="white"/>'));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].repair.actual, 'white');
  assert.match(findings[0].message, /colour name/);
  assert.match(findings[0].repair.hint, /hex/);
});

test('a colour name is not promised that spelling it in hex makes it compliant', () => {
  // Differs from `white` in one variable: `black` is just as legal a name, but it renders #000000, which the
  // palette does not have. Advice that stops at "write the hex value" is complete for one and misleading for
  // the other, and following it earns a second finding on the same attribute.
  const findings = offPalette(WRAP('<rect x="22" y="62" width="228" height="36" rx="6" fill="black"/>'));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].repair.actual, 'black');
  assert.equal(findings[0].repair.expected, 'the hex form of a palette colour');
  assert.match(findings[0].repair.hint, /not necessarily a palette colour/);
});

test('a functional colour notation is not reported as a colour name', () => {
  // rgb() is non-hex without being a name, so a branch keyed on "does not start with #" calls it one and
  // tells the author their colour name should be written as hex. It is the palette that rejects this value.
  const findings = offPalette(WRAP('<rect x="22" y="62" width="228" height="36" rx="6" fill="rgb(75,0,130)"/>'));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].repair.actual, 'rgb(75,0,130)');
  assert.match(findings[0].message, /not in the house palette/);
  assert.match(findings[0].repair.hint, /semantic triples/);
});

test('paint values that name no colour are not reported at all', () => {
  // `none` and `transparent` paint nothing, and a gradient reference names an element rather than a colour,
  // so none of the three is a palette choice. Quoting "url(#g)" back with advice to pick a semantic triple
  // is wrong on both halves.
  const src = `<svg viewBox="0 0 340 200" width="340">
  <defs><linearGradient id="g"><stop offset="0" stop-color="#ffffff"/></linearGradient></defs>
  <rect x="12" y="22" width="90" height="60" fill="transparent"/>
  <rect x="120" y="22" width="90" height="60" fill="url(#g)"/>
  <rect x="228" y="22" width="90" height="60" fill="none" stroke="none"/>
</svg>`;
  assert.deepEqual(offPalette(src), []);
});

test('currentColor is not judged, naming a colour this model does not carry', () => {
  // It differs from none/transparent in that it does name a colour -- the `color` property, which is not part
  // of the model. Reporting it as a colour name tells the author to write the hex of a keyword that has none.
  const src = `<svg viewBox="0 0 340 200" width="340">
  <rect x="12" y="22" width="90" height="60" fill="#dbeafe" stroke="currentColor"/>
</svg>`;
  assert.deepEqual(offPalette(src), []);
});

test('a border written as inherit is judged as the colour it inherits', () => {
  // `inherit` is resolved by the cascade, so what arrives here is the ancestor's colour -- the one that
  // renders. Treating the keyword as unjudgeable instead lets a pink border under a semantic fill pass in
  // silence, while the identical colour written directly on the box is reported.
  const src = `<svg viewBox="0 0 340 200" width="340">
  <g stroke="#ec4899"><rect x="12" y="22" width="90" height="60" fill="#dbeafe" stroke="inherit"/></g>
</svg>`;
  const findings = runCheck(paletteConformance, src);
  assert.equal(hasCode(findings, 'semantic-pair-mismatch'), true);
  assert.equal(findings.find((f) => f.code === 'semantic-pair-mismatch').repair.actual, '#ec4899');
});

test('the keywords that name no colour are recognised whatever their case', () => {
  // SVG keywords are case-insensitive, so all three of these paint exactly what their lowercase spellings
  // paint. A case-sensitive skip reports them, and the name branch then advises writing the hex value of a
  // keyword that has none -- a change to a diagram that already renders correctly.
  const src = `<svg viewBox="0 0 340 200" width="340">
  <defs><linearGradient id="g"><stop offset="0" stop-color="#ffffff"/></linearGradient></defs>
  <rect x="12" y="22" width="90" height="60" fill="NONE" stroke="Transparent"/>
  <rect x="120" y="22" width="90" height="60" fill="URL(#g)"/>
</svg>`;
  assert.deepEqual(offPalette(src), []);
});

// The cases below pin that the arrow colour is checked too. Nothing else in the repository reads it: the
// arrow-marker check looks at the size, refX and markerUnits only, so before this check a #ff00ff arrow
// passed in silence.
const MARKER_DOC = (head, markerAttrs = '') => `<svg viewBox="0 0 272 120" width="272">
  <style>text { font-family: 'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif; }</style>
  <defs>
    <marker id="arrow" markerWidth="8" markerHeight="8" refX="2" refY="4" orient="auto" markerUnits="userSpaceOnUse"${markerAttrs}>
      ${head}
    </marker>
  </defs>
  <rect x="0" y="0" width="272" height="120" fill="#ffffff"/>
</svg>`;

test('an arrowhead is reported in the colour it inherits, not in black', () => {
  // The arrowhead renders magenta because fill is inherited and <defs> does not stop it. Resolving only the
  // marker and its children reads null here and the initial value turns that into #000000 -- so the finding
  // quotes a colour the file does not contain, and the author searching for it finds nothing to change.
  const src = `<svg viewBox="0 0 272 120" width="272" fill="#ff00ff">
  <defs>
    <marker id="arrow" markerWidth="8" markerHeight="8" refX="2" refY="4" orient="auto" markerUnits="userSpaceOnUse">
      <path d="M0,0 L8,4 L0,8 z"/>
    </marker>
  </defs>
</svg>`;
  const off = runCheck(paletteConformance, src).filter((f) => f.code === 'off-palette-color');
  assert.equal(off.length, 1);
  assert.equal(off[0].repair.actual, '#ff00ff');
});

test('an arrowhead filled with a colour outside the palette is a warning at the marker', () => {
  const findings = runCheck(paletteConformance, MARKER_DOC('<path d="M0,0 L8,4 L0,8 z" fill="#ff00ff"/>'));
  const off = findings.filter((f) => f.code === 'off-palette-color');
  assert.equal(off.length, 1);
  assert.equal(off[0].repair.actual, '#ff00ff');
  // Points at the <marker> line, not at the arrow line: what the author has to change is that marker's definition.
  assert.equal(off[0].line, 4);
  assert.equal(off[0].column, 5);
});

test('a house-style arrow colour on a marker is accepted', () => {
  assert.deepEqual(runCheck(paletteConformance, MARKER_DOC('<path d="M0,0 L8,4 L0,8 z" fill="#64748b"/>')), []);
});

test('an arrowhead that declares no fill is reported as black', () => {
  // An arrow with no fill written is pure black in the browser, and pure black is not in the palette. It should be reported
  // once effectiveFill falls back to #000000 — reporting null, or skipping it outright, lets this diagram pass silently.
  const findings = runCheck(paletteConformance, MARKER_DOC('<path d="M0,0 L8,4 L0,8 z"/>'));
  const off = findings.filter((f) => f.code === 'off-palette-color');
  assert.equal(off.length, 1);
  assert.equal(off[0].repair.actual, '#000000');
});

test('an arrowhead with no fill is pointed at the palette, not told to write fill="none"', () => {
  // The connector advice is keyed on the kind, and a marker reaches the same undeclared-fill branch a path does.
  // Widening that key to markers would tell the author of an arrowhead to write fill="none" on it, which is
  // advice to make the arrow invisible: a solid arrowhead is drawn by its fill and has no stroke to fall back on.
  const findings = offPalette(MARKER_DOC('<path d="M0,0 L8,4 L0,8 z"/>'));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].repair.actual, '#000000');
  assert.equal(findings[0].repair.hint, 'pick one of the five semantic triples, the base text colours, or an arrow colour');
});

test('a fill written on the marker element is the arrowhead colour', () => {
  // fill inherits, so this arrow renders slate and is perfectly in style. Looking only at the arrowhead's
  // own attribute finds nothing there, falls back to SVG's initial black, and reports #000000 -- a colour
  // that appears nowhere in the file, on an arrow that is already the right colour.
  assert.deepEqual(runCheck(paletteConformance, MARKER_DOC('<path d="M0,0 L8,4 L0,8 z"/>', ' fill="#64748b"')), []);
});

test('an arrowhead fill overrides an off-palette fill on the marker element', () => {
  // The reverse inheritance case: the arrowhead declares its own colour, so the marker's is not what
  // renders and reporting the marker's would name a colour the reader cannot see.
  const off = offPalette(MARKER_DOC('<path d="M0,0 L8,4 L0,8 z" fill="#64748b"/>', ' fill="#ff1493"'));
  assert.equal(off.length, 0);
});

test('an open arrowhead drawn in an off-palette stroke is a warning', () => {
  // Not every arrowhead is a solid triangle: an open V is drawn with a stroke and fill="none", and its
  // colour lives entirely on the stroke. A model that records only the fill sees none of it, and this
  // magenta arrow produces nothing at all.
  const findings = offPalette(MARKER_DOC('<path d="M0,0 L8,4 L0,8" fill="none" stroke="#ff1493"/>'));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].repair.attribute, 'stroke');
  assert.equal(findings[0].repair.actual, '#ff1493');
});

test('an open arrowhead in a house colour is accepted', () => {
  assert.deepEqual(runCheck(paletteConformance, MARKER_DOC('<path d="M0,0 L8,4 L0,8" fill="none" stroke="#64748b"/>')), []);
});

test('grouping boxes whose dash lists differ only in spacing are consistent', () => {
  // A dash list separates its numbers with commas, whitespace, or both, so these two boxes draw exactly
  // the same dashes. Comparing the raw attribute strings tells the author to change "6, 4" into "6,4".
  const src = WRAP(`<rect x="22" y="22" width="140" height="150" rx="10" fill="#f8fafc" stroke="#94a3b8" stroke-dasharray="6,4"/>
  <rect x="190" y="22" width="128" height="150" rx="10" fill="#f8fafc" stroke="#94a3b8" stroke-dasharray="6, 4"/>`, '0 0 340 200', '340');
  assert.equal(hasCode(runCheck(paletteConformance, src), 'group-box-style-inconsistent'), false);
});

test('the odd box out is the one flagged, not the two that agree', () => {
  // Two boxes at rx="10" and one at rx="4", with the odd one drawn first. Holding the diagram to whatever
  // its first box happens to use flags both correct boxes and tells them to become 4 -- following that
  // repair makes the diagram less consistent than it started.
  const src = WRAP(`<rect x="12" y="22" width="90" height="150" rx="4" fill="#f8fafc" stroke="#94a3b8" stroke-dasharray="6,4"/>
  <rect x="120" y="22" width="90" height="150" rx="10" fill="#f8fafc" stroke="#94a3b8" stroke-dasharray="6,4"/>
  <rect x="228" y="22" width="90" height="150" rx="10" fill="#f8fafc" stroke="#94a3b8" stroke-dasharray="6,4"/>`, '0 0 340 200', '340');
  const findings = runCheck(paletteConformance, src).filter((f) => f.code === 'group-box-style-inconsistent');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].repair.actual, '4');
  assert.equal(findings[0].repair.expected, '10');
  assert.equal(findings[0].line, 3);
});

test('two boxes disagreeing one to one are held to the earlier one', () => {
  // With no majority there is nothing to count, so whichever box is named is arbitrary; the earliest is the
  // choice that at least comes out the same on every run. One finding either way, so the only question this
  // pins is which box carries it.
  const src = WRAP(`<rect x="22" y="22" width="140" height="150" rx="10" fill="#f8fafc" stroke="#94a3b8" stroke-dasharray="6,4"/>
  <rect x="190" y="22" width="128" height="150" rx="4" fill="#f8fafc" stroke="#94a3b8" stroke-dasharray="6,4"/>`, '0 0 340 200', '340');
  const findings = runCheck(paletteConformance, src).filter((f) => f.code === 'group-box-style-inconsistent');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].repair.actual, '4');
  assert.equal(findings[0].repair.expected, '10');
});

test('grouping boxes differing only in fill are a warning', () => {
  // The third of the three attributes the rule promises, and the one the hint names last. Its two siblings
  // are covered by the cases above; without this the rule can lose a third of itself in silence.
  const src = WRAP(`<rect x="22" y="22" width="140" height="150" rx="10" fill="#f8fafc" stroke="#94a3b8" stroke-dasharray="6,4"/>
  <rect x="190" y="22" width="128" height="150" rx="10" fill="#ffffff" stroke="#94a3b8" stroke-dasharray="6,4"/>`, '0 0 340 200', '340');
  const findings = runCheck(paletteConformance, src).filter((f) => f.code === 'group-box-style-inconsistent');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].repair.attribute, 'fill');
  assert.equal(findings[0].repair.actual, '#ffffff');
  assert.equal(findings[0].repair.expected, '#f8fafc');
});

test('a grouping box with no corner radius is reported as not set, not as "null"', () => {
  // rx is optional and an absent one draws sharp corners. Echoing the model's null back at the author sends
  // them looking for the string "null" in a file that does not contain it.
  const src = WRAP(`<rect x="22" y="22" width="140" height="150" rx="10" fill="#f8fafc" stroke="#94a3b8" stroke-dasharray="6,4"/>
  <rect x="190" y="22" width="128" height="150" fill="#f8fafc" stroke="#94a3b8" stroke-dasharray="6,4"/>`, '0 0 340 200', '340');
  const findings = runCheck(paletteConformance, src).filter((f) => f.code === 'group-box-style-inconsistent');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].repair.actual, 'not set');
  assert.equal(findings[0].repair.expected, '10');
  assert.equal(findings[0].message, 'Dashed grouping box rx is not set but another one uses "10"');
});

test('the message names the offending value first and the expected one second', () => {
  // What a command-line reader actually sees. Reversing the two values in that sentence turns this test red
  // and the not-set case above it as well, that one asserting the whole message too.
  const src = WRAP(`<rect x="22" y="22" width="140" height="150" rx="10" fill="#f8fafc" stroke="#94a3b8" stroke-dasharray="6,4"/>
  <rect x="190" y="22" width="128" height="150" rx="4" fill="#f8fafc" stroke="#94a3b8" stroke-dasharray="6,4"/>`, '0 0 340 200', '340');
  const findings = runCheck(paletteConformance, src).filter((f) => f.code === 'group-box-style-inconsistent');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].message, 'Dashed grouping box rx is "4" but another one uses "10"');
});

test('the grouping-box repair names all three attributes the rule covers', () => {
  // The finding quotes one attribute, but the rule binds three and the loop runs once per attribute, so a box
  // differing in both its radius and its dash list gets two findings in the same run, both on its own line.
  // The message names only the one attribute, which leaves the hint as the only place the author is told the
  // other two are bound as well. No other grouping-box case in this file reads that hint, so replacing it
  // with null turns exactly this test red and nothing else.
  const src = WRAP(`<rect x="22" y="22" width="140" height="150" rx="10" fill="#f8fafc" stroke="#94a3b8" stroke-dasharray="6,4"/>
  <rect x="190" y="22" width="128" height="150" rx="4" fill="#f8fafc" stroke="#94a3b8" stroke-dasharray="6,4"/>`, '0 0 340 200', '340');
  const findings = runCheck(paletteConformance, src).filter((f) => f.code === 'group-box-style-inconsistent');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].repair.hint, 'every dashed grouping box in one diagram shares dasharray, corner radius and fill');
});

test('the reported dash list keeps the spelling the file uses', () => {
  // Normalising for the comparison must not normalise what is echoed back: the author has to find these
  // values in the file, and "3 3" is not a string that appears in it.
  const src = WRAP(`<rect x="22" y="22" width="140" height="150" rx="10" fill="#f8fafc" stroke="#94a3b8" stroke-dasharray="6,4"/>
  <rect x="190" y="22" width="128" height="150" rx="10" fill="#f8fafc" stroke="#94a3b8" stroke-dasharray="3, 3"/>`, '0 0 340 200', '340');
  const findings = runCheck(paletteConformance, src).filter((f) => f.code === 'group-box-style-inconsistent');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].repair.actual, '3, 3');
  assert.equal(findings[0].repair.expected, '6,4');
});
