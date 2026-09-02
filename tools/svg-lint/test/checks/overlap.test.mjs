// tools/svg-lint/test/checks/overlap.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { overlap } from '../../lib/checks/overlap.mjs';
import { lintSource } from '../../lib/lint.mjs';
import { runCheck, fixture, hasCode } from '../helpers/load.mjs';

const WRAP = (body, vb, w) => `<svg viewBox="${vb}" width="${w}">
  <style>text { font-family: 'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif; }</style>
  ${body}
</svg>`;

test('the clean fixture has no overlaps', () => {
  assert.deepEqual(runCheck(overlap, fixture('pass/minimal.svg')), []);
});

test('a label sitting on a connector is an error', () => {
  const findings = runCheck(overlap, fixture('fail/text-over-line.svg'));
  // When sitting on the line, only this one finding is reported. A clearance of 0 is also
  // below every clearance threshold, so once it is judged an error the check must stop —
  // otherwise the same label gets an additional "too close to line" warning, reporting the
  // same problem twice and making the reader think two separate things need fixing.
  assert.equal(findings.length, 1);
  assert.equal(findings[0].code, 'text-over-line');
  assert.equal(findings[0].severity, 'error');
  assert.match(findings[0].repair.hint, /beside/);
});

test('a line crossing a box it does not connect to is an error', () => {
  const findings = runCheck(overlap, fixture('fail/line-cuts-box.svg'));
  const cuts = findings.filter((f) => f.code === 'line-cuts-box');
  assert.equal(cuts.length, 1);            // only the middle box; the two endpoint boxes are excluded
  assert.equal(cuts[0].severity, 'error');
});

test('text landing on top of a box that is not its container is an error', () => {
  const findings = runCheck(overlap, WRAP(`<rect x="22" y="40" width="80" height="36" fill="#dbeafe" stroke="#3b82f6"/>
  <rect x="130" y="40" width="80" height="36" fill="#d1fae5" stroke="#22c55e"/>
  <text x="140" y="62" font-size="12" fill="#1e40af" text-anchor="middle">wide label spilling over</text>`, '0 0 232 116', '232'));
  const over = findings.find((f) => f.code === 'text-over-box');
  // The severity is the point of this test as much as the code is. Two elements drawn on top of
  // each other is a defect the reader can see, not a matter of taste, and the tool's acceptance
  // bar of zero errors and zero warnings means a demotion to warning would not be noticed by
  // anyone reading a report — only by whoever branches on the exit code.
  assert.equal(over.severity, 'error');
  assert.match(over.repair.hint, /widen the box/);
});

test('a label 6px from a straight connector is a clearance warning', () => {
  // text bottom edge = 60 + 2.5 = 62.5; line at y=68.5 → clearance 6px
  const findings = runCheck(overlap, WRAP(`<text x="60" y="60" font-size="10" fill="#64748b">label</text>
  <path d="M22,68.5 L 180,68.5" fill="none" stroke="#94a3b8" stroke-width="1.5"/>`, '0 0 202 92', '202'));
  const clearance = findings.find((f) => f.code === 'text-line-clearance');
  assert.equal(clearance.severity, 'warning');
  assert.equal(clearance.repair.expected, '≥10');
});

test('a curve label needs 15px, not 10px', () => {
  // clearance 12px: sufficient for a straight connector, not for a curve
  const findings = runCheck(overlap, WRAP(`<text x="60" y="60" font-size="10" fill="#64748b">label</text>
  <path d="M22,74.5 C 60,74.5 140,74.5 180,74.5" fill="none" stroke="#94a3b8" stroke-width="1.5"/>`, '0 0 202 98', '202'));
  const curve = findings.find((f) => f.code === 'curve-label-clearance');
  assert.equal(curve.severity, 'warning');
  assert.equal(curve.repair.actual, '12');
  assert.equal(curve.repair.expected, '≥15');
});

test('a label exactly 10px from a straight connector is within house style', () => {
  // text bottom edge = 60 + 2.5 = 62.5; line at y=72.5 → clearance exactly 10px.
  // SKILL.md gives the interval as 10–20px, so 10 itself is within spec: the comparison
  // must be "report only when less than the threshold". Using "less than or equal" would
  // flag a diagram drawn exactly at the lower limit — a false positive.
  assert.deepEqual(runCheck(overlap, WRAP(`<text x="60" y="60" font-size="10" fill="#64748b">label</text>
  <path d="M22,72.5 L 180,72.5" fill="none" stroke="#94a3b8" stroke-width="1.5"/>`, '0 0 202 96', '202')), []);
});

test('a quadratic curve gets the same 15px label clearance as a cubic one', () => {
  // Same 12px clearance as the previous test, but with C replaced by Q. SKILL.md says
  // "curve", and both curve commands count; an implementation that only recognises C
  // treats Q as a straight line, so 12px passes — a false negative.
  const findings = runCheck(overlap, WRAP(`<text x="60" y="60" font-size="10" fill="#64748b">label</text>
  <path d="M22,74.5 Q 100,74.5 180,74.5" fill="none" stroke="#94a3b8" stroke-width="1.5"/>`, '0 0 202 98', '202'));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].code, 'curve-label-clearance');
});

test('a path with an empty d attribute is skipped instead of crashing the check', () => {
  // An empty d still ends up in doc.paths, just with no points. There must be a guard
  // before accessing the first and last points; without it the entire check throws and
  // the diagram produces no findings at all — worse than a false positive: a silent failure.
  assert.deepEqual(runCheck(overlap, WRAP(`<path d="" fill="none" stroke="#94a3b8" stroke-width="1.5"/>
  <rect x="22" y="40" width="60" height="36" fill="#dbeafe" stroke="#3b82f6"/>`, '0 0 104 116', '104')), []);
});

// A detour path consists of three boxes and one polyline: A and B are the two endpoints
// the connector joins (start/end points sit against their bottom edges), and C is the
// obstacle it routes around. The three tests below together pin the judgment of "which
// box is an endpoint, which is an obstacle" — without any one of them, an implementation
// that shrinks the endpoint radius below the detour clearance order of magnitude still
// passes all three, and that implementation would treat every box the connector itself
// connects as "an obstacle that is too close".
const DETOUR = (depth) => `<rect x="22" y="40" width="60" height="36" fill="#dbeafe" stroke="#3b82f6"/>
  <rect x="120" y="40" width="60" height="36" fill="#fef3c7" stroke="#f59e0b"/>
  <rect x="200" y="40" width="60" height="36" fill="#d1fae5" stroke="#22c55e"/>
  <path d="M52,76 L 52,${depth} L 230,${depth} L 230,76" fill="none" stroke="#94a3b8" stroke-width="1.5"/>`;

test('a detour passing 12px from the box it routes around is a warning', () => {
  // the polyline runs below C at y=88, 12px from C's bottom edge (y=76).
  const findings = runCheck(overlap, WRAP(DETOUR(88), '0 0 282 116', '282'));
  assert.equal(findings.length, 1);        // only obstacle C; the two endpoint boxes A and B are excluded
  assert.equal(findings[0].code, 'detour-too-close');
  assert.equal(findings[0].severity, 'warning');
  assert.equal(findings[0].repair.actual, '12');
  assert.equal(findings[0].repair.expected, '≥20');
});

test('the same detour is clean once it keeps 24px from the obstacle', () => {
  // Same shape, but the detour depth is moved to y=100 — 24px from C's bottom edge, enough.
  // This negative control guards against "report on any obstacle without comparing to the
  // threshold": without the comparison, the previous test still passes.
  assert.deepEqual(runCheck(overlap, WRAP(DETOUR(100), '0 0 282 128', '282')), []);
});

test('a box the connector terminates at is never treated as an obstacle', () => {
  // the start and end points are each 14px from the bottom edges of A and B — the same
  // order of magnitude as the arrow clearance in house style. If the endpoint radius is
  // set smaller than the detour clearance, this diagram would receive two detour-too-close
  // findings, yet those two boxes are exactly the ones the connector is joining.
  assert.deepEqual(runCheck(overlap, WRAP(`<rect x="22" y="40" width="60" height="36" fill="#dbeafe" stroke="#3b82f6"/>
  <rect x="200" y="40" width="60" height="36" fill="#d1fae5" stroke="#22c55e"/>
  <path d="M52,90 L 230,90" fill="none" stroke="#94a3b8" stroke-width="1.5"/>`, '0 0 282 116', '282')), []);
});

test('a connector crossing a dashed grouping box it does not connect to is not reported', () => {
  // A dashed grouping box lies between two boxes outside the group; the connector passes
  // straight through its centre, and both endpoints are 28px from the grouping box —
  // the endpoint exemption cannot reach it. Only the rule "dashed grouping boxes do not
  // participate in line-cuts-box detection" prevents a finding. SKILL.md explicitly
  // allows connectors to pass through grouping boxes; reporting it would be a false
  // positive on every diagram that uses a grouping box.
  assert.deepEqual(runCheck(overlap, WRAP(`<rect x="100" y="40" width="100" height="90" stroke-dasharray="6,4" fill="#f8fafc" stroke="#94a3b8"/>
  <rect x="22" y="67" width="50" height="36" fill="#dbeafe" stroke="#3b82f6"/>
  <rect x="228" y="67" width="50" height="36" fill="#d1fae5" stroke="#22c55e"/>
  <path d="M72,85 L 228,85" fill="none" stroke="#94a3b8" stroke-width="1.5"/>`, '0 0 300 170', '300')), []);
});

test('a dashed grouping box is never reported as cut by a line', () => {
  const grouped = WRAP(`<rect x="22" y="40" width="220" height="90" stroke-dasharray="6,4" fill="#f8fafc" stroke="#94a3b8"/>
  <rect x="37" y="65" width="70" height="36" fill="#dbeafe" stroke="#3b82f6"/>
  <rect x="157" y="65" width="70" height="36" fill="#d1fae5" stroke="#22c55e"/>
  <path d="M112,83 L 146,83" fill="none" stroke="#94a3b8" stroke-width="1.5"/>`, '0 0 264 170', '264');
  assert.equal(hasCode(runCheck(overlap, grouped), 'line-cuts-box'), false);
});

// ---- text lying across the outline of a dashed grouping box ----
// The two box kinds are obstacles of different shapes. A solid content box is an area: text has
// no business on top of it. A dashed grouping box is a container: its own title sits inside it
// and so does every member label, so its interior cannot be forbidden — that would report a
// finding on every group title and every box label in every diagram that uses a group. What is
// forbidden is the line that draws it, so each of the four edges is judged as a thin band. The
// group below spans x 120..300 and y 56..116 with an undeclared stroke-width, which SVG defaults
// to 1, so each band is half a pixel either side of its edge.
const GROUP_WALL = (label) => WRAP(`<rect x="120" y="56" width="180" height="60" rx="10" fill="#f8fafc" stroke="#94a3b8" stroke-dasharray="6,4"/>
  ${label}`, '0 0 420 160', '420');

test('a label lying across the wall of a dashed grouping box is a warning', () => {
  // "straddles" at font-size 10 spans x 96..145.5, so its glyph box covers the left wall at
  // x=120. Clearing the stroke costs 24.5px to the right (left edge reaching 120.5) against 26px
  // to the left, so the receipt asks for the cheaper of the two.
  const findings = runCheck(overlap, GROUP_WALL('<text x="96" y="100" font-size="10" fill="#64748b">straddles</text>'));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].code, 'text-on-group-wall');
  // A judgment that has never run before starts as a warning: the acceptance bar is zero errors
  // and zero warnings, so a warning already blocks, and nothing is gained by claiming more.
  assert.equal(findings[0].severity, 'warning');
  // The whole sentence, written out here rather than assembled from anything the check exports.
  // The side-word matches in the tests below cover the four sides cheaply, but a match cannot see a
  // reword of the words around it: this message was rewritten once with the entire suite staying
  // green. One exact assertion on one of the four sides is enough to catch that, and this is it.
  assert.equal(
    findings[0].message,
    'Label "straddles" sits across the left wall of a dashed grouping box',
  );
  assert.match(findings[0].message, /left wall/);
  assert.equal(findings[0].repair.actual, '96');
  assert.equal(findings[0].repair.expected, '≥120.5');
  assert.match(findings[0].repair.hint, /24\.5px right/);
});

test('a dashed wall and a solid wall are both judged, each by its own rule', () => {
  // The drawing that found this held one label geometry twice, once across a dashed group wall
  // and once across a solid box wall. The solid case was never silent — the label binds to the
  // box it lands in and other checks speak up about the fit — while the dashed case drew nothing
  // at all. Neither is silent now, and the group-wall code stays off the solid box: an area
  // obstacle and a line obstacle are different findings with different repairs.
  const wall = (attrs) => `<svg viewBox="0 0 420 160" width="420">
  <style>text { font-family: 'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif; }</style>
  <rect x="0" y="0" width="420" height="160" fill="#ffffff"/>
  <rect x="120" y="56" width="180" height="60" ${attrs}/>
  <text x="96" y="100" font-size="10" fill="#64748b">straddles</text>
</svg>`;
  const dashed = lintSource('dashed.svg', wall('rx="10" fill="#f8fafc" stroke="#94a3b8" stroke-dasharray="6,4"')).findings;
  const solid = lintSource('solid.svg', wall('rx="6" fill="#dbeafe" stroke="#3b82f6"')).findings;
  assert.equal(hasCode(dashed, 'text-on-group-wall'), true);
  assert.equal(hasCode(solid, 'text-on-group-wall'), false);
  assert.equal(hasCode(solid, 'text-overflows-box'), true);
});

// The group pattern as SKILL.md draws it, so the geometry this test pins comes from the frozen
// house style rather than from numbers a test invented. Box and title attributes are copied from the
// "Vertical-centering trap" snippet verbatim, line break included; the two inner boxes are the
// snippet's own rects with its `...` paint placeholder filled in with house colours.
//
// The pattern's tightest direction is vertical, not horizontal: the title baseline sits 14px below
// the box top, and at font-size 11 the glyph box reaches 8.25px above the baseline, so its top edge
// lands 5.75px inside a top wall at y=100 — against 10px between its left edge and the left wall.
// A band half a pixel either side of the line has to leave both alone, or the house group pattern
// becomes unlintable.
const HOUSE_GROUP = (titleBaseline) => `<svg viewBox="0 0 300 260" width="300">
  <style>text { font-family: 'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif; }</style>
  <rect x="50" y="100" width="200" height="120" rx="10"
      stroke="#94a3b8" stroke-dasharray="6,4" fill="#f8fafc"/>
  <text x="60" y="${titleBaseline}" font-size="11" fill="#64748b">Server</text>
  <rect x="65" y="125" width="170" height="36" rx="6" fill="#dbeafe" stroke="#3b82f6"/>
  <rect x="65" y="170" width="170" height="36" rx="6" fill="#dbeafe" stroke="#3b82f6"/>
</svg>`;

test('the house group title is left alone where SKILL.md places it', () => {
  // SKILL.md's title placement rule is `y = box y + 14`, so the box at y=100 gets baseline 114.
  assert.deepEqual(runCheck(overlap, HOUSE_GROUP(114)), []);
  // 6px higher the title is on the top band, which is what shows the clean verdict above is a
  // near miss in the vertical direction rather than a comfortable margin — and that the check is
  // watching the wall the pattern comes closest to. 5px higher (baseline 109) is still clean.
  const raised = runCheck(overlap, HOUSE_GROUP(108));
  assert.equal(raised.length, 1);
  assert.equal(raised[0].code, 'text-on-group-wall');
  assert.match(raised[0].message, /top wall/);
  assert.equal(raised[0].repair.expected, '≥100.5');
  assert.match(raised[0].repair.hint, /0\.8px down/);
  assert.deepEqual(runCheck(overlap, HOUSE_GROUP(109)), []);
});

test('a label whose edge stops at the outside of the stroke is not on it', () => {
  // The band is the drawn line, not the neighbourhood around it. "wall" is 22px wide at
  // font-size 10, so x=97.5 puts its right edge exactly on 119.5, the outer edge of a 1px stroke
  // centred on x=120: tangency does not count, the same convention the box-overlap test above
  // follows. Half a pixel further right and the glyph box is on the stroke.
  assert.deepEqual(runCheck(overlap, GROUP_WALL('<text x="97.5" y="100" font-size="10" fill="#64748b">wall</text>')), []);
  const on = runCheck(overlap, GROUP_WALL('<text x="98" y="100" font-size="10" fill="#64748b">wall</text>'));
  assert.equal(on.length, 1);
  assert.equal(on[0].code, 'text-on-group-wall');
  assert.equal(on[0].repair.expected, '≤119.5');
});

test('a label overhanging a wall from outside is told to step further out', () => {
  // The cheaper escape is the one reported, so the advice never proposes carrying a caption
  // across the container it merely sits beside: a label reaching 2px past the wall is told to
  // step back out by 2.5px, not to move its whole width inside the group.
  const findings = runCheck(overlap, GROUP_WALL('<text x="100" y="100" font-size="10" fill="#64748b">wall</text>'));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].repair.actual, '122');
  assert.equal(findings[0].repair.expected, '≤119.5');
  assert.match(findings[0].repair.hint, /2\.5px left/);
});

test('the horizontal walls are judged as well as the vertical ones', () => {
  // Each wall has its own axis, its own escape directions and its own words in the receipt, so
  // the top and bottom bands need their own assertions — the left-wall cases above cannot reach
  // them. "wall" at font-size 10 spans 7.5px above its baseline and 2.5px below it: baseline 58
  // puts the glyph box across the top wall at y=56, and baseline 120 puts it across the bottom
  // wall at y=116. The cheaper escape differs between the two, which is what the directions test.
  const across = (y) => runCheck(overlap, GROUP_WALL(`<text x="200" y="${y}" font-size="10" fill="#64748b">wall</text>`));
  const top = across(58);
  assert.equal(top.length, 1);
  assert.match(top[0].message, /top wall/);
  assert.equal(top[0].repair.expected, '≤55.5');
  assert.match(top[0].repair.hint, /5px up/);
  const bottom = across(120);
  assert.equal(bottom.length, 1);
  assert.match(bottom[0].message, /bottom wall/);
  assert.equal(bottom[0].repair.expected, '≥116.5');
  assert.match(bottom[0].repair.hint, /4px down/);
});

// A grouping box narrower than the label it holds, and a second one shorter than the label is tall.
// The widths and heights are deliberately unlike each other and unlike GROUP_WALL's, so an
// assertion below cannot pass by reading a number that came from the wrong box: 20px wide by 60 tall
// against 180 wide by 8 tall, with the roomy control at 40 wide.
const SLIM_GROUP = (width, x) => WRAP(`<rect x="100" y="56" width="${width}" height="60" rx="10" fill="#f8fafc" stroke="#94a3b8" stroke-dasharray="6,4"/>
  <text x="${x}" y="100" font-size="10" fill="#64748b">wall</text>`, '0 0 420 160', '420');

const FLAT_GROUP = (y) => WRAP(`<rect x="120" y="56" width="180" height="8" rx="4" fill="#f8fafc" stroke="#94a3b8" stroke-dasharray="6,4"/>
  <text x="200" y="${y}" font-size="10" fill="#64748b">wall</text>`, '0 0 420 160', '420');

// The receipt names a distance and a direction, so a test can move the label exactly as an author
// following it would and then ask the check again. Reading the printed number back is not the same
// question: a hint can print a number that is arithmetically right about the wall it names and
// still land the label on a different wall.
const follow = (hint) => {
  const named = /shift the label (\d+(?:\.\d+)?)px (left|right|up|down) /.exec(hint);
  assert.ok(named, `the hint does not name a move: ${hint}`);
  const px = Number(named[1]);
  const towards = { left: [-px, 0], right: [px, 0], up: [0, -px], down: [0, px] };
  return { dx: towards[named[2]][0], dy: towards[named[2]][1] };
};

test('a label wider than the grouping box is sent clear of the box, not from one wall to the other', () => {
  // A 20px-wide box spanning x 100..120 leaves 19px between the inner faces of its two walls, and
  // "wall" at font-size 10 is 22px wide, so no position inside the box clears both walls. The
  // shorter of "retreat behind this wall" and "advance past this wall" is then a move onto the
  // opposite wall, and the receipt printed from there sends the label back — the author is walked
  // in a circle and, with the bar at zero warnings, cannot leave it. The only escape that can be
  // satisfied is outward, clear of the box, on whichever side is nearer.
  //
  // x=90 puts the glyph box at 90..112, across the left wall and 7.5px short of the right one.
  // Stepping out to the left costs 12.5px; stepping in past the left wall costs 10.5px and lands
  // the box at 100.5..122.5, across the right wall.
  const fromLeft = runCheck(overlap, SLIM_GROUP(20, 90));
  assert.equal(fromLeft.length, 1);
  assert.equal(fromLeft[0].code, 'text-on-group-wall');
  assert.match(fromLeft[0].message, /left wall/);
  assert.equal(fromLeft[0].repair.actual, '112');
  assert.equal(fromLeft[0].repair.expected, '≤99.5');
  assert.match(fromLeft[0].repair.hint, /12\.5px left/);
  assert.deepEqual(runCheck(overlap, SLIM_GROUP(20, 90 + follow(fromLeft[0].repair.hint).dx)), []);

  // The mirror approach: x=105 puts the glyph box at 105..127, clear of the left wall and across
  // the right one. Retreating inward costs 7.5px and lands it at 97.5..119.5, across the left wall;
  // stepping out to the right costs 15.5px and clears the box.
  const fromRight = runCheck(overlap, SLIM_GROUP(20, 105));
  assert.equal(fromRight.length, 1);
  assert.match(fromRight[0].message, /right wall/);
  assert.equal(fromRight[0].repair.actual, '105');
  assert.equal(fromRight[0].repair.expected, '≥120.5');
  assert.match(fromRight[0].repair.hint, /15\.5px right/);
  assert.deepEqual(runCheck(overlap, SLIM_GROUP(20, 105 + follow(fromRight[0].repair.hint).dx)), []);

  // Widen the same box to 40px and the label fits between the walls again, so the cheaper inward
  // move is correct and is what comes back — the outward rule is confined to boxes that cannot
  // hold the label, and this is what says so.
  const roomy = runCheck(overlap, SLIM_GROUP(40, 90));
  assert.equal(roomy.length, 1);
  assert.equal(roomy[0].repair.actual, '90');
  assert.equal(roomy[0].repair.expected, '≥100.5');
  assert.match(roomy[0].repair.hint, /10\.5px right/);
  assert.deepEqual(runCheck(overlap, SLIM_GROUP(40, 90 + follow(roomy[0].repair.hint).dx)), []);
});

test('the outward escape starts exactly where the label stops fitting between the walls', () => {
  // The threshold is the span between the two walls' inner faces, which is the box's own extent less
  // one stroke — half a stroke taken off each side. Both halves of that arithmetic need holding, and
  // so does which way the comparison runs at exact equality, because a box that can hold the label
  // to the pixel still has one position that clears both walls and the inward move reaches it.
  //
  // 23px wide is that exact fit: 22 free between the inner faces for a 22px glyph box, so the
  // cheaper inward move stands, and following it puts the box's right edge on the right wall's inner
  // face — tangent to the stroke, which is not on it.
  const exact = runCheck(overlap, SLIM_GROUP(23, 90));
  assert.equal(exact.length, 1);
  assert.match(exact[0].message, /left wall/);
  assert.equal(exact[0].repair.actual, '90');
  assert.equal(exact[0].repair.expected, '≥100.5');
  assert.match(exact[0].repair.hint, /10\.5px right/);
  assert.deepEqual(runCheck(overlap, SLIM_GROUP(23, 90 + follow(exact[0].repair.hint).dx)), []);

  // A quarter of a pixel narrower and there is no such position: 21.75 free for the same 22px glyph
  // box. The inward move is still the cheaper one and is now the wrong one.
  const short = runCheck(overlap, SLIM_GROUP(22.75, 90));
  assert.equal(short.length, 1);
  assert.match(short[0].message, /left wall/);
  assert.equal(short[0].repair.actual, '112');
  assert.equal(short[0].repair.expected, '≤99.5');
  assert.match(short[0].repair.hint, /12\.5px left/);
  assert.deepEqual(runCheck(overlap, SLIM_GROUP(22.75, 90 + follow(short[0].repair.hint).dx)), []);
});

test('a label lying on both walls at once is told to leave past the wall the message names', () => {
  // x=100 puts the 22px glyph box at 100..122 inside a 20px box spanning 100..120, so it lies on
  // both bands: 0.5px of it is on the left one and 2.5px past the right one. Both walls then reach
  // the same pair of outward destinations and ask for the same move, so the larger-move rule cannot
  // choose between them. Naming the wall the label is leaving past is what keeps the sentence and
  // the number talking about the same edge — the alternative reads "sits across the left wall" with
  // `≥120.5` beside it, and the author cannot tell which edge 120.5 belongs to.
  const both = runCheck(overlap, SLIM_GROUP(20, 100));
  assert.equal(both.length, 1);
  assert.equal(
    both[0].message,
    'Label "wall" sits across the right wall of a dashed grouping box',
  );
  assert.equal(both[0].repair.actual, '100');
  assert.equal(both[0].repair.expected, '≥120.5');
  assert.match(both[0].repair.hint, /20\.5px right/);
  assert.deepEqual(runCheck(overlap, SLIM_GROUP(20, 100 + follow(both[0].repair.hint).dx)), []);
});

test('a label taller than the grouping box is sent clear of it as well', () => {
  // The horizontal pair of walls has its own span, its own directions and its own words, so the
  // vertical cases above cannot reach it. An 8px-tall box spanning y 56..64 leaves 7px between the
  // inner faces of its top and bottom walls, while "wall" at font-size 10 reaches 7.5px above its
  // baseline and 2.5px below, a glyph box 10px tall. Baseline 62 puts that box at y 54.5..64.5,
  // lying on both bands at once; the cheapest move past the top wall alone is 2px down, which
  // leaves it across the bottom wall, and 1px up from there crosses the top wall again.
  const across = runCheck(overlap, FLAT_GROUP(62));
  assert.equal(across.length, 1);
  assert.equal(across[0].code, 'text-on-group-wall');
  assert.match(across[0].message, /top wall/);
  assert.equal(across[0].repair.actual, '64.5');
  assert.equal(across[0].repair.expected, '≤55.5');
  assert.match(across[0].repair.hint, /9px up/);
  assert.deepEqual(runCheck(overlap, FLAT_GROUP(62 + follow(across[0].repair.hint).dy)), []);
});

test('a label draped over a corner is reported once, for the wall needing the larger move', () => {
  // A glyph box over a corner lies on two bands, and one finding is reported per label per box, so
  // one of the two walls has to be chosen. The choice is arbitrary on the merits — the two walls are
  // perpendicular, so neither escape clears the other and the author needs two edits whichever is
  // named first — but it has to be deterministic, and it is the larger of the two moves.
  //
  // "wall" at font-size 10 is 22px wide and reaches 7.5px above its baseline and 2.5px below, so
  // baseline 60 at x=112 gives a glyph box of x 112..134 by y 52.5..62.5, which lies on the left band
  // at x=120 and the top band at y=56 at once. The two escapes are deliberately different sizes: the
  // left wall costs 8.5px to the right, the top wall 4px down. Only one of those pairs of numbers can
  // be read off the receipt, so the assertion cannot pass by reading the wall that was not chosen.
  const corner = runCheck(overlap, GROUP_WALL('<text x="112" y="60" font-size="10" fill="#64748b">wall</text>'));
  assert.equal(corner.length, 1);
  assert.match(corner[0].message, /left wall/);
  assert.equal(corner[0].repair.actual, '112');
  assert.equal(corner[0].repair.expected, '≥120.5');
  assert.match(corner[0].repair.hint, /8\.5px right/);
  // The same glyph box moved clear of the left wall, keeping its baseline, still lands on the top
  // band and asks for the 4px move the corner case declined to report — which is what shows the
  // corner case really was on two bands and really did choose between them.
  const topOnly = runCheck(overlap, GROUP_WALL('<text x="200" y="60" font-size="10" fill="#64748b">wall</text>'));
  assert.equal(topOnly.length, 1);
  assert.match(topOnly[0].message, /top wall/);
  assert.equal(topOnly[0].repair.expected, '≥56.5');
  assert.match(topOnly[0].repair.hint, /4px down/);
});

test('a band reaches only along its own edge, so text beside or below the group is left alone', () => {
  // This is the invariant that keeps the judgment a line test rather than a region test, and it
  // is not the same thing as the nested-group case: both labels here **do** span a wall's
  // coordinate, and are clean only because they lie outside the length of that wall. The first is
  // a caption under the group whose x range covers the left wall's x; the second sits to the left
  // of the group with a y range covering the top wall's y. Both are ordinary annotations.
  assert.deepEqual(runCheck(overlap, GROUP_WALL('<text x="110" y="160" font-size="10" fill="#64748b">wall</text>')), []);
  assert.deepEqual(runCheck(overlap, GROUP_WALL('<text x="20" y="58" font-size="10" fill="#64748b">wall</text>')), []);
});

test('a grouping box whose geometry the model could not read is not judged', () => {
  // `width="180px"` is valid SVG that the model reads as NaN, leaving the box's own edges NaN.
  // Every comparison against NaN is false, the two that mean "nowhere near this wall" included,
  // so without a guard the check concludes there is a crossing and offers `≥NaN` to the author of
  // a label 100px clear of the box. document-model already reports the attribute it could not
  // read, so silence here does not make the file look clean.
  assert.deepEqual(runCheck(overlap, WRAP(`<rect x="120" y="56" width="180px" height="60" rx="10" fill="#f8fafc" stroke="#94a3b8" stroke-dasharray="6,4"/>
  <text x="20" y="100" font-size="10" fill="#64748b">far away</text>`, '0 0 420 200', '420')), []);
  // The vertical pair of edges needs its own case: an unreadable `y` leaves minY and maxY unusable
  // while minX and maxX stay perfectly readable, so a guard that only looked at the horizontal pair
  // would let this through and offer `≥NaN` to a label 33px above the box.
  assert.deepEqual(runCheck(overlap, WRAP(`<rect x="120" y="56px" width="180" height="60" rx="10" fill="#f8fafc" stroke="#94a3b8" stroke-dasharray="6,4"/>
  <text x="200" y="20" font-size="10" fill="#64748b">far above</text>`, '0 0 420 200', '420')), []);
});

test('a label whose own geometry the model could not read is not judged either', () => {
  // The mirror of the box case above, and the more dangerous of the two, because what it
  // fabricates is finite. `x="20px"` and `font-size="10px"` are both valid SVG that the model
  // reads as NaN, and a NaN glyph box walks through the same two comparisons — the ones that mean
  // "this label is nowhere near this wall" — that a NaN box walks through. With the unreadable
  // font size the arithmetic then runs to completion and reports the label at x=20, which is 100px
  // clear of the left wall, as straddling the *right* wall at x=300 with an instruction to move it
  // 280.5px right. Every number on that receipt is finite and plausible and none of it is true; an
  // author who follows it moves a correctly placed label into the middle of the diagram. `≥NaN` at
  // least announces itself. Silence is the only safe answer to geometry the check cannot read, and
  // document-model names the attribute it could not parse, so the file does not read as clean.
  assert.deepEqual(runCheck(overlap, GROUP_WALL('<text x="20px" y="100" font-size="10" fill="#64748b">far away</text>')), []);
  assert.deepEqual(runCheck(overlap, GROUP_WALL('<text x="20" y="100" font-size="10px" fill="#64748b">far away</text>')), []);
  // Both cases above leave the glyph box's right edge unusable along with its top and bottom, so
  // neither of them can tell whether the vertical pair is checked. An empty label with an unreadable
  // font size can: its width is zero, so both x edges are the readable x=120, while its height is
  // unusable. Unguarded that is a finite receipt too — "(no text) sits across the left wall", 0.5px
  // left — for an element with no height and nothing drawn.
  assert.deepEqual(runCheck(overlap, GROUP_WALL('<text x="120" y="100" font-size="10px" fill="#64748b"></text>')), []);
  // A label that really does lie across a wall is still reported, so the guard above cannot be
  // passing by silencing the judgment altogether.
  const straddling = runCheck(overlap, GROUP_WALL('<text x="96" y="100" font-size="10" fill="#64748b">straddles</text>'));
  assert.equal(straddling.length, 1);
  assert.equal(straddling[0].code, 'text-on-group-wall');
});

test('the band follows the declared stroke width, and an unreadable one falls back to the SVG default', () => {
  // "wall" ends at x=118.5, which clears a 1px stroke centred on 120 and lies inside a 4px one.
  // Same label, same wall, opposite verdicts — so the band is measured from the stroke the author
  // declared rather than from a constant. `stroke-width="4px"` is valid SVG that the model reads
  // as NaN; a NaN band would compare false everywhere and silently drop the wall, so it falls
  // back to SVG's default of 1 and the label at 122 is still reported.
  const wall = (sw, x) => WRAP(`<rect x="120" y="56" width="180" height="60" rx="10" fill="#f8fafc" stroke="#94a3b8" stroke-width="${sw}" stroke-dasharray="6,4"/>
  <text x="${x}" y="100" font-size="10" fill="#64748b">wall</text>`, '0 0 420 160', '420');
  assert.deepEqual(runCheck(overlap, wall(1, 96.5)), []);
  const wide = runCheck(overlap, wall(4, 96.5));
  assert.equal(wide.length, 1);
  assert.equal(wide[0].code, 'text-on-group-wall');
  assert.equal(wide[0].repair.expected, '≤118');
  const unreadable = runCheck(overlap, wall('4px', 100));
  assert.equal(unreadable.length, 1);
  assert.equal(unreadable[0].repair.expected, '≤119.5');
});

test('text inside an inner group is not judged against the outer group wall', () => {
  // One of the committed diagrams nests three groups inside one, so every label inside an inner
  // group is inside the outer group as well. A judgment on the interior would report all of them;
  // a band that follows the edge cannot reach them, because the outer walls are tens of pixels
  // away from anything drawn inside an inner group.
  const nested = WRAP(`<rect x="20" y="30" width="380" height="140" rx="10" fill="#f8fafc" stroke="#94a3b8" stroke-dasharray="6,4"/>
  <text x="26" y="48" font-size="11" fill="#64748b">outer</text>
  <rect x="120" y="56" width="180" height="60" rx="10" fill="#f8fafc" stroke="#94a3b8" stroke-dasharray="6,4"/>
  <text x="126" y="74" font-size="11" fill="#64748b">inner</text>
  <text x="140" y="100" font-size="10" fill="#64748b">member</text>`, '0 0 420 200', '420');
  assert.deepEqual(runCheck(overlap, nested), []);
});

test('a box exactly one clearance away from the connector endpoint is still its endpoint box', () => {
  // the start point (130,96) is exactly 20px from the box's bottom edge, but the line
  // body is only 12px away. If the endpoint exemption uses "less than radius", this box
  // no longer counts as an endpoint box, and the line is judged "too close to an obstacle
  // while detouring" — yet it is the very box the connector joins. 20 is the boundary
  // value of the exemption; the boundary itself must be included.
  assert.deepEqual(runCheck(overlap, WRAP(`<rect x="100" y="40" width="60" height="36" fill="#dbeafe" stroke="#3b82f6"/>
  <path d="M130,96 L 130,88 L 300,88" fill="none" stroke="#94a3b8" stroke-width="1.5"/>`, '0 0 320 140', '320')), []);
});

test('a path that is part straight and part curve counts as a curve', () => {
  // The polyline goes straight first and then becomes a C — that is exactly the shape of
  // a house-style detour. An implementation that requires every segment to be a curve
  // treats this as straight, so 12px passes against the 10px threshold — a false negative.
  const findings = runCheck(overlap, WRAP(`<text x="60" y="60" font-size="10" fill="#64748b">label</text>
  <path d="M22,74.5 L 60,74.5 C 100,74.5 140,74.5 180,74.5" fill="none" stroke="#94a3b8" stroke-width="1.5"/>`, '0 0 202 98', '202'));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].code, 'curve-label-clearance');
});

test('a label 6px to the left of a box it is not inside is not overlapping it', () => {
  // text right edge 123, box left edge 130 — close but not overlapping. The box-overlap
  // check requires a true intersection; adding a tolerance margin would flag "a label
  // placed beside a box" as overlapping — a false positive on every diagram.
  assert.deepEqual(runCheck(overlap, WRAP(`<rect x="130" y="40" width="80" height="36" fill="#dbeafe" stroke="#3b82f6"/>
  <text x="112" y="62" font-size="10" fill="#64748b">ab</text>`, '0 0 232 116', '232')), []);
});

test('a label half a pixel from a connector is a clearance warning, not an overlap', () => {
  // clearance between the text box and the line is 0.5px; the two do not intersect.
  // Relaxing the criterion to "less than 1px counts as overlapping" would escalate this
  // to an error, but the receipt says "sits on a connector". The model considers only the
  // geometric relationship between the text box and the line (ignoring stroke-width), so
  // the only defensible criterion for "sits on" in this model is a clearance of exactly 0.
  const findings = runCheck(overlap, WRAP(`<text x="60" y="60" font-size="10" fill="#64748b">label</text>
  <path d="M22,63 L 180,63" fill="none" stroke="#94a3b8" stroke-width="1.5"/>`, '0 0 202 96', '202'));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].code, 'text-line-clearance');
  assert.equal(findings[0].severity, 'warning');
  assert.equal(findings[0].repair.actual, '0.5');
});

test('a connector half a pixel from a box has not cut through it', () => {
  // The same reasoning applied to a line and a box: a clearance of 0.5px is a "too close"
  // warning, not a "passed through" error.
  const findings = runCheck(overlap, WRAP(`<rect x="100" y="40" width="60" height="36" fill="#dbeafe" stroke="#3b82f6"/>
  <path d="M22,76.5 L 300,76.5" fill="none" stroke="#94a3b8" stroke-width="1.5"/>`, '0 0 320 120', '320'));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].code, 'detour-too-close');
  assert.equal(findings[0].severity, 'warning');
});

test('a fractional clearance is rounded to one decimal place', () => {
  // The measured clearance is 12.299999999999997. Without normalisation the receipt
  // prints this long string, which the author cannot find by searching the file and which
  // looks like a calculation error; truncating to an integer would report 12.3 as 12.
  const findings = runCheck(overlap, WRAP(`<text x="60" y="60" font-size="10" fill="#64748b">label</text>
  <path d="M22,74.8 C 60,74.8 140,74.8 180,74.8" fill="none" stroke="#94a3b8" stroke-width="1.5"/>`, '0 0 202 100', '202'));
  const curve = findings.find((f) => f.code === 'curve-label-clearance');
  assert.equal(curve.repair.actual, '12.3');
});

test('a connector cutting a box is reported once, not also as too close', () => {
  // A clearance of 0 is also below the detour clearance threshold. If the two branches
  // are not mutually exclusive, the same line receives two findings, making the author
  // think two separate things need fixing. Cutting through and being too close are two
  // degrees of the same problem; only the more severe one is reported.
  const findings = runCheck(overlap, WRAP(`<rect x="100" y="40" width="60" height="36" fill="#dbeafe" stroke="#3b82f6"/>
  <path d="M22,58 L 300,58" fill="none" stroke="#94a3b8" stroke-width="1.5"/>`, '0 0 320 116', '320'));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].code, 'line-cuts-box');
});

test('a connector exactly 20px from an unrelated box is within house style', () => {
  // SKILL.md says a detour must be "at least 20px from the obstacle", so 20 itself is
  // within spec: the comparison must use "less than" to trigger. Using "less than or
  // equal" would flag a diagram drawn exactly at the lower limit.
  assert.deepEqual(runCheck(overlap, WRAP(`<rect x="100" y="40" width="60" height="36" fill="#dbeafe" stroke="#3b82f6"/>
  <path d="M22,96 L 300,96" fill="none" stroke="#94a3b8" stroke-width="1.5"/>`, '0 0 320 140', '320')), []);
});

test('every path is checked and the finding carries that path position', () => {
  // The first line is far from the box; only the second one cuts through it. An
  // implementation that only checks the first line passes here, but a diagram always
  // has more than one connector. The line and column are also pinned: which line is
  // reported determines whether the author can jump directly to the problem.
  const findings = runCheck(overlap, WRAP(`<rect x="100" y="40" width="60" height="36" fill="#dbeafe" stroke="#3b82f6"/>
  <path d="M22,150 L 60,150" fill="none" stroke="#94a3b8" stroke-width="1.5"/>
  <path d="M22,58 L 300,58" fill="none" stroke="#94a3b8" stroke-width="1.5"/>`, '0 0 320 180', '320'));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].code, 'line-cuts-box');
  assert.equal(findings[0].line, 5);
  assert.equal(findings[0].column, 3);
});

test('every text is checked and the finding carries that text position', () => {
  // Same as above, for the text pass: the first label is 42px from the line, the second
  // is only 6px.
  const findings = runCheck(overlap, WRAP(`<path d="M22,74.5 L 180,74.5" fill="none" stroke="#94a3b8" stroke-width="1.5"/>
  <text x="60" y="30" font-size="10" fill="#64748b">far</text>
  <text x="60" y="66" font-size="10" fill="#64748b">near</text>`, '0 0 202 100', '202'));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].code, 'text-line-clearance');
  assert.equal(findings[0].line, 5);
  assert.equal(findings[0].column, 3);
});

test('a solid panel holding labelled inner boxes does not report each label as overlapping it', () => {
  // The house-style layout where an outer box wraps inner boxes. The panel contains two
  // inner boxes and each inner label naturally falls inside the panel too — reporting each
  // would generate two errors on every diagram with a section panel, and the repair
  // ("move the label or widen the box") is impossible: the label is obviously the content
  // of its own box, and the only way to comply would be to delete the panel.
  assert.deepEqual(runCheck(overlap, WRAP(`<rect x="22" y="40" width="276" height="110" rx="8" fill="#f8fafc" stroke="#94a3b8"/>
  <rect x="42" y="80" width="110" height="50" rx="6" fill="#dbeafe" stroke="#3b82f6"/>
  <text x="97" y="109" font-size="14" text-anchor="middle" fill="#1e40af">API</text>
  <rect x="172" y="80" width="110" height="50" rx="6" fill="#d1fae5" stroke="#22c55e"/>
  <text x="227" y="109" font-size="14" text-anchor="middle" fill="#166534">Store</text>`, '0 0 320 190', '320')), []);
});

// Same label, same line — the only difference is whether the outer box is present. When
// the box is present, the clearance is measured through the box wall, and all the author
// can do is move the label outside the box — so nothing is reported. The two tests
// together pin that "not reported" is **because** the label is inside the box, not
// because the distance already meets the threshold.
const BOXED_LABEL = '<text x="117.85" y="57.5" font-size="10" fill="#64748b">queue</text>';
const NEAR_LINE = '<path d="M155,57.5 L 250,57.5" fill="none" stroke="#94a3b8" stroke-width="1.5"/>';

test('a label inside its own box is not measured against connectors outside the box', () => {
  assert.deepEqual(runCheck(overlap, WRAP(`<rect x="90" y="40" width="60" height="30" rx="6" fill="#dbeafe" stroke="#3b82f6"/>
  ${BOXED_LABEL}
  ${NEAR_LINE}`, '0 0 272 110', '272')), []);
});

test('the same label and connector are measured once the box is gone', () => {
  const findings = runCheck(overlap, WRAP(`${BOXED_LABEL}
  ${NEAR_LINE}`, '0 0 272 110', '272'));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].code, 'text-line-clearance');
  assert.equal(findings[0].repair.actual, '9.7');
});

test('the jump between two subpaths in one d is not treated as a line', () => {
  // Two subpaths in one d with a box in between. The jump caused by `M` does not exist on
  // screen; treating it as a line segment would produce a spurious "line cuts box" finding,
  // and the author following the repair to add a detour would have nothing to detour —
  // that line does not exist in the diagram.
  assert.deepEqual(runCheck(overlap, WRAP(`<rect x="100" y="40" width="60" height="36" fill="#dbeafe" stroke="#3b82f6"/>
  <path d="M22,58 L 60,58 M 240,58 L 280,58" fill="none" stroke="#94a3b8" stroke-width="1.5"/>`, '0 0 300 116', '300')), []);
});

test('a subpath jump that only moves vertically is also not treated as a line', () => {
  // Two vertical line segments, one above and one below; the jump caused by `M` changes
  // only y, not x. If the split criterion only compares x, the two segments are joined
  // into one continuous vertical line and the middle box receives a spurious error.
  // A new subpath begins whenever either coordinate is discontinuous.
  assert.deepEqual(runCheck(overlap, WRAP(`<rect x="80" y="70" width="60" height="40" fill="#dbeafe" stroke="#3b82f6"/>
  <path d="M100,30 L 100,60 M 100,120 L 100,150" fill="none" stroke="#94a3b8" stroke-width="1.5"/>`, '0 0 220 180', '220')), []);
});

test('the last subpath in a d is measured too', () => {
  // Subpath splitting is accumulated as the path is traversed; the last segment must be
  // flushed after the loop ends. A missing flush means the final segment of any d is
  // never checked — a silent false negative, and house-style detours often write the
  // last segment as a separate subpath.
  const findings = runCheck(overlap, WRAP(`<rect x="100" y="40" width="60" height="36" fill="#dbeafe" stroke="#3b82f6"/>
  <path d="M22,150 L 60,150 M 22,58 L 300,58" fill="none" stroke="#94a3b8" stroke-width="1.5"/>`, '0 0 320 180', '320'));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].code, 'line-cuts-box');
});

test('a label is measured against the nearest subpath, not the farthest', () => {
  // One d contains two line segments: the upper one is 6px from the label, the lower one
  // is 87.5px. An implementation that takes the maximum passes here, but would only ever
  // look at the farthest segment for every multi-subpath connector — a silent false
  // negative.
  const findings = runCheck(overlap, WRAP(`<text x="60" y="60" font-size="10" fill="#64748b">label</text>
  <path d="M22,68.5 L 180,68.5 M 22,150 L 180,150" fill="none" stroke="#94a3b8" stroke-width="1.5"/>`, '0 0 202 180', '202'));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].code, 'text-line-clearance');
  assert.equal(findings[0].repair.actual, '6');
});

test('a real crossing inside a multi-subpath d is still reported', () => {
  // The negative counterpart of the previous test: splitting into subpaths does not mean
  // the whole path is exempt. The first subpath genuinely cuts through the box. Without
  // this test, an implementation that skips any path with multiple subpaths still passes,
  // which is a silent false negative.
  const findings = runCheck(overlap, WRAP(`<rect x="100" y="40" width="60" height="36" fill="#dbeafe" stroke="#3b82f6"/>
  <path d="M22,58 L 300,58 M 22,150 L 60,150" fill="none" stroke="#94a3b8" stroke-width="1.5"/>`, '0 0 320 180', '320'));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].code, 'line-cuts-box');
});

test('a path containing an arc is not measured at all, in either direction', () => {
  // Arc segments are collapsed to zero length, leaving points that cannot reconstruct the
  // real trajectory. Errors occur in both directions: in the first diagram the arc
  // genuinely cuts through the box (false negative), and in the second diagram the
  // collapsed straight-line segment cuts through a box the arc never passes through
  // (false positive). The known trade-off is to skip the entire path — accepting a false
  // negative rather than producing a false error — so the 0-finding result for the first
  // diagram is deliberate, not an oversight.
  assert.deepEqual(runCheck(overlap, WRAP(`<rect x="100" y="40" width="60" height="36" fill="#dbeafe" stroke="#3b82f6"/>
  <path d="M22,58 A 80 80 0 0 1 280,58" fill="none" stroke="#94a3b8" stroke-width="1.5"/>`, '0 0 300 116', '300')), []);
  assert.deepEqual(runCheck(overlap, WRAP(`<rect x="40" y="90" width="40" height="30" fill="#dbeafe" stroke="#3b82f6"/>
  <path d="M22,150 A 60 60 0 0 1 140,40 L 200,40" fill="none" stroke="#94a3b8" stroke-width="1.5"/>`, '0 0 240 190', '240')), []);
});

test('a connector starting 20px from a box it passes straight through is still cutting it', () => {
  // A shape built from house-style numbers: minimum block spacing 25px + connector start
  // clearance 5px ⇒ the start point is exactly 20px from the adjacent box. If the endpoint
  // exemption also uses a 20px radius to skip lines that have already entered a box, this
  // line that runs straight through the middle box would be silently treated as "connecting
  // to the middle box". When clearance is 0, only a true interior endpoint counts as the
  // endpoint box.
  const findings = runCheck(overlap, WRAP(`<rect x="22" y="40" width="60" height="36" fill="#dbeafe" stroke="#3b82f6"/>
  <rect x="107" y="40" width="60" height="36" fill="#fef3c7" stroke="#f59e0b"/>
  <rect x="200" y="40" width="60" height="36" fill="#d1fae5" stroke="#22c55e"/>
  <path d="M87,58 L 250,58" fill="none" stroke="#94a3b8" stroke-width="1.5"/>`, '0 0 282 116', '282'));
  assert.equal(findings.length, 1);      // only the middle box
  assert.equal(findings[0].code, 'line-cuts-box');
});

// The three tests below pin that the author text inserted into messages has been
// normalised. The receipt format is one finding per line; inserting it verbatim would
// either split it across several lines or push the line to hundreds of characters wide.
test('a multi-line label is flattened to one line in the message', () => {
  const findings = runCheck(overlap, WRAP(`<path d="M22,62 L 250,62" fill="none" stroke="#94a3b8" stroke-width="1.5"/>
  <text x="136" y="62" font-size="12" fill="#64748b" text-anchor="middle">first line
    <tspan x="136" dy="14">second line</tspan></text>`, '0 0 272 130', '272'));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].message, 'Label "first line second line" sits on a connector');
});

test('a label longer than the message allows is truncated', () => {
  const findings = runCheck(overlap, WRAP(`<path d="M22,62 L 250,62" fill="none" stroke="#94a3b8" stroke-width="1.5"/>
  <text x="136" y="62" font-size="12" fill="#64748b" text-anchor="middle">an extremely long caption nobody should paste</text>`, '0 0 272 130', '272'));
  assert.equal(findings[0].message, 'Label "an extremely long caption nobody should…" sits on a connector');
});

test('a label of exactly the maximum length is printed in full', () => {
  // 40 characters is exactly the limit; it should not be truncated. Using "greater than
  // or equal triggers truncation" would silently drop the last character, and the author
  // would be unable to find the receipt string by searching the file.
  const findings = runCheck(overlap, WRAP(`<path d="M22,62 L 250,62" fill="none" stroke="#94a3b8" stroke-width="1.5"/>
  <text x="136" y="62" font-size="12" fill="#64748b" text-anchor="middle">0123456789012345678901234567890123456789</text>`, '0 0 272 130', '272'));
  assert.equal(findings[0].message, 'Label "0123456789012345678901234567890123456789" sits on a connector');
});

// The exemption for labels inside a box only applies to lines that do **not** enter that
// box. The two tests below are house-style shapes where the line genuinely enters the
// box — in that case the label itself is what is being cut through, `line-cuts-box` does
// not apply (the line's endpoints are also inside the box so `endsInside` would exempt
// them), and unconditionally skipping labels inside boxes means both paths are let through.
test('a divider line inside a card is reported as sitting on that card own label', () => {
  const findings = runCheck(overlap, WRAP(`<rect x="42" y="40" width="200" height="90" rx="6" fill="#dbeafe" stroke="#3b82f6"/>
  <text x="52" y="80" font-size="12" fill="#1e40af">Latency budget</text>
  <path d="M52,80 L 232,80" fill="none" stroke="#3b82f6" stroke-width="1"/>`, '0 0 284 172', '284'));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].code, 'text-over-line');
  assert.equal(findings[0].message, 'Label "Latency budget" sits on a connector');
});

test('a panel section name is reported when a connector inside the panel runs through it', () => {
  const findings = runCheck(overlap, WRAP(`<rect x="22" y="40" width="276" height="110" rx="8" fill="#f8fafc" stroke="#94a3b8"/>
  <text x="32" y="58" font-size="12" fill="#334155">Ingest stage</text>
  <rect x="42" y="80" width="110" height="50" rx="6" fill="#dbeafe" stroke="#3b82f6"/>
  <text x="97" y="109" font-size="14" text-anchor="middle" fill="#1e40af">API</text>
  <rect x="172" y="80" width="110" height="50" rx="6" fill="#d1fae5" stroke="#22c55e"/>
  <text x="227" y="109" font-size="14" text-anchor="middle" fill="#166534">Store</text>
  <path d="M60,54 L 260,54" fill="none" stroke="#94a3b8" stroke-width="1.5"/>`, '0 0 320 190', '320'));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].code, 'text-over-line');
  assert.equal(findings[0].message, 'Label "Ingest stage" sits on a connector');
});

test('a divider line inside a card is measured against the card label even when it misses it', () => {
  // The divider line is inside the card, 4px from the card label's bottom edge — not
  // overlapping, but too close. The test for whether a line has entered a box must measure
  // against the container box; if it measured the label's own text box instead, only lines
  // directly on top of the text would be measured, and lines grazing past would always be
  // let through.
  const findings = runCheck(overlap, WRAP(`<rect x="42" y="40" width="200" height="90" rx="6" fill="#dbeafe" stroke="#3b82f6"/>
  <text x="52" y="80" font-size="12" fill="#1e40af">Latency budget</text>
  <path d="M52,87 L 232,87" fill="none" stroke="#3b82f6" stroke-width="1"/>`, '0 0 284 172', '284'));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].code, 'text-line-clearance');
  assert.equal(findings[0].repair.actual, '4');
});

test('a label is not crashed by a path with no measurable trace', () => {
  // An empty d and a path containing unmodelled commands both produce no measurable trace.
  // There must be a guard before searching for the nearest subpath; without it the entire
  // check throws — the diagram produces no findings at all, which is worse than a false
  // positive: a silent failure.
  assert.deepEqual(runCheck(overlap, WRAP(`<text x="60" y="60" font-size="10" fill="#64748b">label</text>
  <path d="" fill="none" stroke="#94a3b8" stroke-width="1.5"/>
  <path d="M22,68.5 A 40 40 0 0 1 180,68.5" fill="none" stroke="#94a3b8" stroke-width="1.5"/>`, '0 0 202 120', '202')), []);
});

test('a caption overlapping a box that only holds a badge is still reported', () => {
  // A v2 badge sits inside the Service box — a common pattern, and panelRects identifies
  // it as a panel because it contains other diagram content. If the panel exemption ignores
  // where the text lives, this caption that genuinely overlaps the box (its bbox 14–140
  // enters the box at 120–280, and its centre 77 is outside so it is not the box's
  // content) would also be exempted.
  const findings = runCheck(overlap, WRAP(`<rect x="120" y="40" width="160" height="70" rx="6" fill="#dbeafe" stroke="#3b82f6"/>
  <text x="200" y="60" font-size="14" text-anchor="middle" fill="#1e40af">Service</text>
  <rect x="230" y="78" width="40" height="22" rx="4" fill="#fef3c7" stroke="#f59e0b"/>
  <text x="250" y="93" font-size="10" text-anchor="middle" fill="#92400e">v2</text>
  <text x="14" y="60" font-size="12" fill="#334155">upstream note here</text>`, '0 0 302 132', '302'));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].code, 'text-over-box');
  assert.equal(findings[0].severity, 'error');
  assert.equal(findings[0].message, 'Label "upstream note here" overlaps a box it does not belong to');
});

// Curvature is taken from the subpath **nearest to the label**, not from the whole path.
// The two tests below have the same shape; the only difference is which segment the
// label is closest to.
const MIXED = '<path d="M22,74.5 L 180,74.5 M 22,150.5 C 60,150.5 140,150.5 180,150.5" fill="none" stroke="#94a3b8" stroke-width="1.5"/>';

test('a straight subpath is judged by the straight clearance even when the path also has a curve', () => {
  // The nearest segment to the label is the straight one, clearance 12px — straight
  // requires 10px, so it passes. If curvature were computed over the whole path, this
  // would receive a 15px curve finding and the receipt would say "from a curve", even
  // though the nearest segment is clearly a straight line.
  assert.deepEqual(runCheck(overlap, WRAP(`<text x="60" y="60" font-size="10" fill="#64748b">label</text>
  ${MIXED}`, '0 0 202 180', '202')), []);
});

test('the curve clearance still applies when the curve is the nearest subpath', () => {
  // Negative counterpart: same path, but the label is moved to sit beside the curve
  // segment (same 12px clearance) → the curve threshold should fire. Without this test,
  // an implementation that always uses the straight threshold also passes the previous test.
  const findings = runCheck(overlap, WRAP(`<text x="60" y="136" font-size="10" fill="#64748b">label</text>
  ${MIXED}`, '0 0 202 180', '202'));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].code, 'curve-label-clearance');
  assert.equal(findings[0].repair.actual, '12');
  assert.match(findings[0].message, /from a curve$/);
});

// The four tests below pin the label formatting in receipts. A receipt is the author's
// only clue; failing to show the label boundary clearly or printing text the author
// cannot find in the file are both defects.
const ON_LINE = (label) => `<path d="M22,62 L 250,62" fill="none" stroke="#94a3b8" stroke-width="1.5"/>
  <text x="136" y="62" font-size="12" fill="#64748b" text-anchor="middle">${label}</text>`;

test('quotes inside a label are escaped so the label boundary stays readable', () => {
  // Without escaping, the receipt reads `Label "say "hi" now"` — three pairs of quotes
  // with two belonging to the content, leaving the reader unable to tell where the label
  // begins and ends.
  const findings = runCheck(overlap, WRAP(ON_LINE('say &quot;hi&quot; now'), '0 0 272 130', '272'));
  assert.equal(findings[0].message, 'Label "say \\"hi\\" now" sits on a connector');
});

test('a long label is truncated by characters, not by UTF-16 code units', () => {
  // 45 emojis = 90 code units, 90 display columns. The cut point follows code points, so
  // no half-character can appear in the receipt; cutting by code unit would split a
  // surrogate pair, leaving a lone high surrogate that terminals render as a replacement
  // character. One emoji occupies two columns, so a budget of 40 columns holds 19 plus `…`.
  const findings = runCheck(overlap, WRAP(ON_LINE('😀'.repeat(45)), '0 0 272 130', '272'));
  assert.equal(findings[0].message, `Label "${'😀'.repeat(19)}…" sits on a connector`);
});

test('an empty label is described without an empty pair of quotes', () => {
  // `Label ""` makes the reader think the tool found no text, and the author gets no
  // search hit from this receipt.
  const findings = runCheck(overlap, WRAP(ON_LINE('    '), '0 0 272 130', '272'));
  assert.equal(findings[0].message, 'Label (no text) sits on a connector');
});

test('whitespace around a label is trimmed out of the message', () => {
  // In a formatted SVG, content has leading and trailing newlines and indentation. Without
  // trimming, the receipt reads `Label " Padded label "`, but those spaces are not part
  // of the author's content.
  const findings = runCheck(overlap, WRAP(`<path d="M22,62 L 250,62" fill="none" stroke="#94a3b8" stroke-width="1.5"/>
  <text x="136" y="62" font-size="12" fill="#64748b" text-anchor="middle">
    Padded label
  </text>`, '0 0 272 130', '272'));
  assert.equal(findings[0].message, 'Label "Padded label" sits on a connector');
});

// The threshold itself: `bboxToPolylineDistance` treats a tangent as 0, so "the line has
// entered this box" cannot be determined by a clearance of 0 — a connector that starts
// exactly on the box boundary and stays entirely outside would be treated as having
// entered the box, breaking the label-inside-box exemption by a difference of just 1px
// that the author would never notice. NEAR_LINE above starts 5px from the box edge,
// safely on the right side of the threshold, so it cannot expose this behaviour.
const EDGE_LINE = '<path d="M150,57.5 L 250,57.5" fill="none" stroke="#94a3b8" stroke-width="1.5"/>';

const boxedWith = (line) => WRAP(`<rect x="90" y="40" width="60" height="30" rx="6" fill="#dbeafe" stroke="#3b82f6"/>
  ${BOXED_LABEL}
  ${line}`, '0 0 272 110', '272');

test('a connector starting on the box edge does not expose a label inside that box', () => {
  assert.deepEqual(runCheck(overlap, boxedWith(EDGE_LINE)), []);
});

test('a connector that crosses the wall does expose the label inside', () => {
  // Negative counterpart: moving the start 1px inside the box edge (from x=150 to x=149)
  // counts as crossing the wall, and this label should now be measured. Without this test,
  // an implementation with an inset wider than one stroke-width still passes the previous
  // test, and would also let through lines that genuinely enter the box.
  const findings = runCheck(overlap, boxedWith('<path d="M149,57.5 L 250,57.5" fill="none" stroke="#94a3b8" stroke-width="1.5"/>'));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].code, 'text-line-clearance');
  assert.equal(findings[0].repair.actual, '3.7');
});

// The other side of the threshold: the inset judges a line that grazes in by only one
// stroke-width as not having entered, and that criterion is valid only for the clearance
// tier. Using it to block overlap detection means a divider line inside a card that runs
// directly through a label is skipped entirely — the text is visually cut through but the
// tool reports 0 errors. The two tests share a box and a line; the only difference is
// whether the label is on the line.
const GRAZING_LINE = '<path d="M90.9,45 L 90.9,65" fill="none" stroke="#94a3b8" stroke-width="1.5"/>';
const FLUSH_LABEL = '<text x="90" y="57.5" font-size="10" fill="#64748b">queue</text>';
const OFFSET_LABEL = '<text x="95" y="57.5" font-size="10" fill="#64748b">queue</text>';
const boxedFlush = (label) => WRAP(`<rect x="90" y="40" width="60" height="30" rx="6" fill="#dbeafe" stroke="#3b82f6"/>
  ${label}
  ${GRAZING_LINE}`, '0 0 272 110', '272');

test('a connector grazing into the box is still reported when it sits on the label', () => {
  const findings = runCheck(overlap, boxedFlush(FLUSH_LABEL));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].code, 'text-over-line');
});

test('a connector grazing into the box does not expose a label it misses', () => {
  // Same line, but moving the label 5px to the right puts it out of reach: this tier
  // measures distance through the box wall, and this line has not crossed the wall yet.
  // This test also pins the wall thickness — an inset narrower than 0.9px would count
  // the line as having entered, giving this label a clearance warning.
  assert.deepEqual(runCheck(overlap, boxedFlush(OFFSET_LABEL)), []);
});

// The degenerate branch of the inset: a box thinner than two walls would inset past itself
// (minY > maxY) and invert, so insideOf clamps the inset region to the inset centreline and a
// line counts as entering only if it touches that. The reasoning is in the comment above
// insideOf in overlap.mjs. The next two tests pin the two sides of that rule, and they pin
// different things: touching the centreline reports, which is what fails if the y axis is not
// clamped; off the centreline does not report, which still holds without any clamp and fails
// only if the wall inset is dropped altogether. House style has no box this flat, so the
// shape is synthetic (1.5px tall, font-size 1).
const FLAT_BOX = '<rect x="90" y="57" width="60" height="1.5" fill="#dbeafe" stroke="#3b82f6"/>';
const TINY_LABEL = '<text x="110" y="58.6" font-size="1" fill="#64748b">i</text>';
const flatBoxWith = (line) => WRAP(`${FLAT_BOX}
  ${TINY_LABEL}
  ${line}`, '0 0 200 130', '200');

test('a label in a box thinner than two walls is measured against a line on the centreline', () => {
  const findings = runCheck(overlap, flatBoxWith('<path d="M95,57.75 L 145,57.75" fill="none" stroke="#94a3b8" stroke-width="1.5"/>'));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].code, 'text-line-clearance');
  assert.equal(findings[0].repair.actual, '0.1');
});

test('a label in a box thinner than two walls is still exempt from a line off the centreline', () => {
  assert.deepEqual(runCheck(overlap, flatBoxWith('<path d="M95,57.2 L 145,57.2" fill="none" stroke="#94a3b8" stroke-width="1.5"/>')), []);
});

// The box above is thin in y, so those tests only exercise the y-axis clamp: an implementation
// clamping y alone stays green on them, while leaving a label inside a narrow upright box
// invisible to this check. Hence the same pair again on a box thin in x.
const tallBoxWith = (line) => WRAP(`<rect x="100" y="50" width="1.5" height="30" fill="#dbeafe" stroke="#3b82f6"/>
  <text x="100.85" y="57.6" font-size="1" fill="#64748b">i</text>
  ${line}`, '0 0 200 130', '200');

test('a label in a box narrower than two walls is measured against a line on the centreline', () => {
  const findings = runCheck(overlap, tallBoxWith('<path d="M100.75,55 L 100.75,75" fill="none" stroke="#94a3b8" stroke-width="1.5"/>'));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].code, 'text-line-clearance');
  assert.equal(findings[0].repair.actual, '0.1');
});

test('a label in a box narrower than two walls is still exempt from a line off the centreline', () => {
  assert.deepEqual(runCheck(overlap, tallBoxWith('<path d="M100.2,55 L 100.2,75" fill="none" stroke="#94a3b8" stroke-width="1.5"/>')), []);
});

// Which subpath is selected is determined by **degree of violation**, not by distance:
// the straight threshold is 10 and the curve threshold is 15, so when a 12px straight
// segment is within spec and a 13px curve segment is not, picking the nearest segment
// would swallow the violating one entirely.
const LABEL_60 = '<text x="60" y="60" font-size="10" fill="#64748b">label</text>';
const STRAIGHT_12 = 'M22,40.5 L 180,40.5';
const CURVE_13 = 'M 22,75.5 C 60,75.5 140,75.5 180,75.5';
const withPaths = (...ds) => WRAP(`${LABEL_60}
  ${ds.map((d) => `<path d="${d}" fill="none" stroke="#94a3b8" stroke-width="1.5"/>`).join('\n  ')}`, '0 0 202 130', '202');

test('a farther curve subpath that breaks its own clearance is still reported', () => {
  const findings = runCheck(overlap, withPaths(`${STRAIGHT_12} ${CURVE_13}`));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].code, 'curve-label-clearance');
  assert.equal(findings[0].repair.actual, '13');
  assert.equal(findings[0].repair.expected, '≥15');
});

test('splitting those two subpaths into two paths reports the same finding', () => {
  // Negative control: without it, a "pick nearest" implementation produces a false
  // negative on the previous test, and the fact that "same geometry, two notations,
  // two different verdicts" goes unnoticed — the verdict should not depend on how many
  // `<path>` elements the author distributes subpaths across.
  const findings = runCheck(overlap, withPaths(STRAIGHT_12, CURVE_13));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].code, 'curve-label-clearance');
  assert.equal(findings[0].repair.actual, '13');
});

test('subpaths at the same distance are judged by the stricter clearance', () => {
  // Both at 12px. Taking by document order would pass the curve when the straight segment
  // comes first, and report it when they are swapped.
  const tie = 'M 22,74.5 C 60,74.5 140,74.5 180,74.5';
  const verdict = (d) => {
    const findings = runCheck(overlap, withPaths(d));
    assert.equal(findings.length, 1);
    return `${findings[0].code}:${findings[0].repair.actual}`;
  };
  assert.equal(verdict(`${STRAIGHT_12} ${tie}`), 'curve-label-clearance:12');
  assert.equal(verdict(`${tie} ${STRAIGHT_12}`), 'curve-label-clearance:12');
});

test('subpaths that break their clearance by the same amount report the nearer one', () => {
  // The straight segment at 7px is 3px short; the curve at 12px is also 3px short — the
  // deficit is tied. Only one finding per path is reported, taking the segment nearer to
  // the label; taking by document order would swap the receipt when the two segments are
  // reversed in d.
  const straight7 = 'M22,45.5 L 180,45.5';
  const curve12 = 'M 22,74.5 C 60,74.5 140,74.5 180,74.5';
  const verdict = (d) => {
    const findings = runCheck(overlap, withPaths(d));
    assert.equal(findings.length, 1);
    return `${findings[0].code}:${findings[0].repair.actual}`;
  };
  assert.equal(verdict(`${straight7} ${curve12}`), 'text-line-clearance:7');
  assert.equal(verdict(`${curve12} ${straight7}`), 'text-line-clearance:7');
});

// Each of the three message templates must normalise the author text. The four receipt
// tests above all exercise text-over-line; the clearance-insufficient message (which
// carries both a label and a number) has no assertions at all, so removing quote() from
// it leaves the suite green.
test('the clearance message normalises the label the same way', () => {
  const findings = runCheck(overlap, WRAP(`<path d="M22,62 L 250,62" fill="none" stroke="#94a3b8" stroke-width="1.5"/>
  <text x="136" y="77" font-size="12" fill="#64748b" text-anchor="middle">first line
    <tspan x="136" dy="14">second line</tspan></text>`, '0 0 272 130', '272'));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].code, 'text-line-clearance');
  assert.equal(findings[0].message, 'Label "first line second line" is 6px from a connector');
});

test('a truncated label still has its quotes escaped', () => {
  // Escaping and truncation are two separate branches. The quote test above uses a short
  // label that takes the non-truncation branch — the truncation branch also assembles
  // quotes, and missing the escape there means a long label with quotes still leaves the
  // label boundary unreadable.
  const findings = runCheck(overlap, WRAP(ON_LINE('say &quot;hi&quot; now and then a good deal more text past the limit'), '0 0 272 130', '272'));
  assert.equal(findings[0].message, 'Label "say \\"hi\\" now and then a good deal mor…" sits on a connector');
});

test('the column budget counts escapes, so a label of quotes is truncated', () => {
  // One quote prints as `\"`, occupying two columns. Counting by raw characters, 40
  // quotes would total 40 columns and pass, but they actually print to 80 columns —
  // the receipt line reaches 150 columns and still wraps.
  const findings = runCheck(overlap, WRAP(ON_LINE('&quot;'.repeat(40)), '0 0 272 130', '272'));
  assert.equal(findings[0].message, `Label "${'\\"'.repeat(19)}…" sits on a connector`);
});

test('a label of arrows is truncated like other wide characters', () => {
  // U+2B05 sits in the arrow block the wide table lists, and terminals draw it in two columns.
  // Without that block 40 arrows would total 40 columns and pass while printing to 80, and the
  // receipt line would still wrap. This case covers the arrow block; U+4E00-9FFF is covered by the
  // CJK case and U+2600-27BF by the heart in the reduction case. Every remaining block of the table
  // that a diagram can reach gets its own case in the loop below.
  const findings = runCheck(overlap, WRAP(ON_LINE('⬅'.repeat(40)), '0 0 272 130', '272'));
  assert.equal(findings[0].message, `Label "${'⬅'.repeat(19)}…" sits on a connector`);
});

// One representative from the middle of each remaining block the wide table lists, so that
// narrowing any single block is noticed. The characters are written as code points rather than
// literals because several of them are obscure enough that a reader could not tell one from
// another by eye, and the expected label is rebuilt from the same code point here in the test
// rather than read back out of the check. 40 wide characters come to 80 columns, so each label
// truncates after 19 of them and the 40th column is left for the ellipsis; narrowing a block
// makes its representative one column wide, and 40 of those fit the budget and print in full.
const WIDE_BLOCKS = [
  { block: 'Hangul Jamo', codePoint: 0x1112 },
  { block: 'CJK punctuation', codePoint: 0x3002 },
  { block: 'Hiragana', codePoint: 0x3042 },
  { block: 'CJK extension A', codePoint: 0x3456 },
  { block: 'Yi syllables', codePoint: 0xA123 },
  { block: 'Hangul syllables', codePoint: 0xB098 },
  { block: 'CJK compatibility ideographs', codePoint: 0xF900 },
  { block: 'CJK vertical presentation forms', codePoint: 0xFE30 },
  { block: 'fullwidth Latin', codePoint: 0xFF21 },
  { block: 'fullwidth currency signs', codePoint: 0xFFE5 },
];

for (const { block, codePoint } of WIDE_BLOCKS) {
  test(`a label of ${block} characters is charged two columns each`, () => {
    const ch = String.fromCodePoint(codePoint);
    const entity = `&#x${codePoint.toString(16)};`;
    const findings = runCheck(overlap, WRAP(ON_LINE(entity.repeat(40)), '0 0 272 130', '272'));
    assert.equal(findings.length, 1);
    assert.equal(findings[0].message, `Label "${ch.repeat(19)}…" sits on a connector`);
  });
}

test('a character with no short escape is charged for all six columns it prints', () => {
  // U+0001 has no short escape, so the receipt prints it in the six-character escape form — six
  // columns for one character. Charging it one column would let 20 of them measure as 20 columns and
  // print in full: 190 columns of receipt line, measured by raising the budget. A lone surrogate
  // escapes to six columns too.
  const escaped = `${String.fromCharCode(92)}u0001`;
  const findings = runCheck(overlap, WRAP(ON_LINE('&#1;'.repeat(20)), '0 0 272 130', '272'));
  assert.equal(findings[0].message, `Label "${escaped.repeat(6)}…" sits on a connector`);
});

test('an invisible character costs a column instead of being modelled exactly', () => {
  // The price of the reduction, pinned so it cannot drift back: an invisible character costs a
  // column instead of being measured. Each "wide character + variation selector" pair here counts
  // 2 + 1 = 3 columns, so 20 of them come to 60 columns and truncate; they used to merge into one
  // two-column cell each, come to 40 columns and print in full. Truncating early is the safe side —
  // an over-wide receipt line wraps, a short one only looks a little terse.
  const heart = String.fromCodePoint(0x2764, 0xFE0F);
  const findings = runCheck(overlap, WRAP(ON_LINE(heart.repeat(20)), '0 0 272 130', '272'));
  // 13 pairs is 39 columns, and the 14th base character would pass the budget: the cut point is
  // asserted, not just the presence of the `…`, so a model that truncates at some other width fails.
  assert.equal(findings[0].message, `Label "${heart.repeat(13)}…" sits on a connector`);
});

test('other invisible-only labels are described as having no text too', () => {
  // `\s` folds none of these five away, yet each prints as a seemingly empty pair of quotes in the
  // receipt: soft hyphen, Hangul filler, zero-width space, word joiner, and a variation selector with
  // nothing to attach to — one code point from each of the five ranges the invisible set lists beyond
  // whitespace. The byte order mark is not among them: JavaScript's `\s` does match U+FEFF (measured),
  // so collapsing and trimming removes it before the regex is reached, and the empty-label case above
  // is what covers it. Removing any one of the five from the set reddens this case; removing U+FEFF
  // does not, because nothing can reach it.
  for (const cp of [0x00AD, 0x3164, 0x200B, 0x2060, 0xFE0F]) {
    const findings = runCheck(overlap, WRAP(ON_LINE(String.fromCodePoint(cp)), '0 0 272 130', '272'));
    assert.equal(findings[0].message, 'Label (no text) sits on a connector');
  }
});

test('a zero-width character between two letters is kept, not folded away', () => {
  // Being invisible does not make a character foldable as whitespace: folding it rewrites the
  // author's text, and the author would get no search hit by searching the file for the receipt
  // text. The soft hyphen is the one in this family most likely to be folded away in passing.
  const shy = String.fromCodePoint(0x00AD);
  const findings = runCheck(overlap, WRAP(ON_LINE(`a${shy}b`), '0 0 272 130', '272'));
  assert.equal(findings[0].message, `Label "a${shy}b" sits on a connector`);
});

test('a CJK label is truncated by display columns, not by character count', () => {
  // 21 `中` characters = 42 display columns, over budget. Counting by character count
  // would print up to 40 as-is, putting the line at around 150 columns and wrapping on
  // 80 / 120 column terminals — yet the first reason quote() exists is one finding per line.
  const findings = runCheck(overlap, WRAP(ON_LINE('中'.repeat(21)), '0 0 272 130', '272'));
  assert.equal(findings[0].message, `Label "${'中'.repeat(19)}…" sits on a connector`);
});

test('a CJK label that exactly fills the column budget is printed in full', () => {
  // Negative counterpart: 20 `中` characters is exactly 40 columns and should not be
  // truncated — otherwise a wide-character label silently loses its last character.
  const findings = runCheck(overlap, WRAP(ON_LINE('中'.repeat(20)), '0 0 272 130', '272'));
  assert.equal(findings[0].message, `Label "${'中'.repeat(20)}" sits on a connector`);
});

test('the check is wired into the registry, so lintSource reports it', () => {
  // Without wiring, every other test in this file passes green while the CLI checks
  // nothing. Filtered by check name: this fixture also triggers other checks; without
  // the filter this test would need updating with every new check added. The filter
  // itself also pins the check name.
  const { findings } = lintSource('text-over-line.svg', fixture('fail/text-over-line.svg'));
  assert.ok(findings.filter((f) => f.check === 'overlap').length > 0);
});

// A card whose title baseline is 57.5 at font-size 10, so the title bbox is minY 50 / maxY 60 —
// the same 50 and 120 the card rect is drawn at. A connector snapped to the card's top wall
// therefore lands on the bbox top edge exactly.
const CARD = (line) => `<svg viewBox="0 0 320 160" width="320">
  <style>text { font-family: 'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif; }</style>
  <rect x="0" y="0" width="320" height="160" fill="#ffffff"/>
  <rect x="120" y="50" width="120" height="70" rx="6" fill="#dbeafe" stroke="#3b82f6"/>
  <text x="180" y="57.5" font-size="10" fill="#1e40af" text-anchor="middle">Title</text>
  ${line}
</svg>`;

// A caption bound to no box, so the clearance arm is not skipped by the "inside its own box" test.
const CAPTION = (line) => `<svg viewBox="0 0 320 160" width="320">
  <style>text { font-family: 'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif; }</style>
  <rect x="0" y="0" width="320" height="160" fill="#ffffff"/>
  <text x="180" y="107.5" font-size="10" fill="#1e293b" text-anchor="middle">Caption</text>
  ${line}
</svg>`;

test('a connector exactly on the label top edge is not sitting on the label', () => {
  const src = CARD('<path d="M140,50 L 300,50" fill="none" stroke="#64748b" stroke-width="1.5"/>');
  assert.equal(hasCode(runCheck(overlap, src), 'text-over-line'), false);
});

test('a connector exactly on the label bottom edge is not sitting on the label', () => {
  const src = CARD('<path d="M140,60 L 300,60" fill="none" stroke="#64748b" stroke-width="1.5"/>');
  assert.equal(hasCode(runCheck(overlap, src), 'text-over-line'), false);
});

test('a connector half a pixel into the label is sitting on it', () => {
  // Counterpart to the two edge tests above: same card, same direction, y moved half a pixel
  // inward, so only "exactly on the edge" versus "inside the box" differs.
  const src = CARD('<path d="M140,50.5 L 300,50.5" fill="none" stroke="#64748b" stroke-width="1.5"/>');
  assert.equal(hasCode(runCheck(overlap, src), 'text-over-line'), true);
});

// How far the horizontal edges are pulled in is a hundredth of a pixel, and the two tests below
// fix that width from both sides. It has to stay far smaller than anything an author could draw
// deliberately — it exists only so that a title positioned by the same arithmetic as the card wall
// does not read as sitting on the wall — and it has to stay wide enough to absorb the rounding of
// that arithmetic. The widths are written out here rather than derived from the check.
test('a connector a hundredth of a pixel into the label is sitting on it', () => {
  const src = CARD('<path d="M140,59.99 L 300,59.99" fill="none" stroke="#64748b" stroke-width="1.5"/>');
  assert.equal(hasCode(runCheck(overlap, src), 'text-over-line'), true);
});

test('a connector a two-hundredth of a pixel into the label is only near it', () => {
  // Half the distance of the previous test, on the same edge of the same label: still inside the
  // glyph box, so it is measured as a clearance of 0 rather than dismissed, but not close enough
  // to the middle of the glyphs to be called an overlap.
  const src = CARD('<path d="M140,59.995 L 300,59.995" fill="none" stroke="#64748b" stroke-width="1.5"/>');
  const findings = runCheck(overlap, src);
  assert.equal(hasCode(findings, 'text-over-line'), false);
  assert.equal(findings.find((f) => f.code === 'text-line-clearance').repair.actual, '0');
});

test('a connector exactly on the label left edge is still sitting on the label', () => {
  // Only the horizontal edges of the bbox are pulled in, so an exact match on the left edge
  // still measures distance 0.
  const src = CARD('<path d="M166.25,45 L 166.25,65" fill="none" stroke="#64748b" stroke-width="1.5"/>');
  assert.equal(hasCode(runCheck(overlap, src), 'text-over-line'), true);
});

test('the reported clearance is unchanged by the tangency exemption', () => {
  // The exemption must not be built by shrinking the distance that clearance findings quote. The
  // caption bbox starts at y=100, so these two connectors are 7.045px and 4.045px clear of it,
  // which the receipt rounds to 7 and 4. Both sit just under a rounding boundary: measuring the
  // distance on the bbox the exemption pulls in at top and bottom reports 7.1 and 4.1 instead.
  const seven = runCheck(overlap, CAPTION('<path d="M140,92.955 L 300,92.955" fill="none" stroke="#64748b" stroke-width="1.5"/>'));
  assert.equal(seven.find((f) => f.code === 'text-line-clearance').repair.actual, '7');
  const four = runCheck(overlap, CAPTION('<path d="M140,95.955 L 300,95.955" fill="none" stroke="#64748b" stroke-width="1.5"/>'));
  assert.equal(four.find((f) => f.code === 'text-line-clearance').repair.actual, '4');
});

// ---- a line resting on a wall is judged by one rule at every offset ----
// The rule the rest of this file honours: a line lying on a box's wall is connecting that box, not
// entering it, and calling it entry is a false positive turning on a difference of 1px nobody can
// see. The two arms used to disagree about it — the entry arm exempted an endpoint inside the box
// and the detour arm an endpoint within 20px of it — so a connector starting at the house-style 5px
// clearance was an error at exactly 0px of graze and completely clean half a pixel away.
// Box x=100 y=100 w=110 h=36 in every case below; only the path moves.
const GRAZE = (d) => WRAP(`<rect x="100" y="100" width="110" height="36" rx="6" fill="#dbeafe" stroke="#3b82f6"/>
  <path d="${d}" fill="none" stroke="#64748b"/>`, '0 0 320 180', '320');

test('a connector grazing a wall with both ends far away is reported at either offset', () => {
  // Both ends 60px clear, so no exemption applies at either offset and the connector really does
  // deserve a finding. What must not happen is the verdict changing across half a pixel.
  const on = runCheck(overlap, GRAZE('M40,100 L270,100'));
  const off = runCheck(overlap, GRAZE('M40,99.5 L270,99.5'));
  assert.equal(on.length, 1);
  assert.equal(off.length, 1);
  assert.equal(on[0].code, off[0].code);
  assert.equal(on[0].code, 'detour-too-close');
});

test('a connector starting 5px from the box it grazes is clean at either offset', () => {
  // The house-style start clearance is 5px, so this shape is what a compliant diagram looks like.
  // At 0px of graze it used to be an error and half a pixel away it was silent.
  assert.deepEqual(runCheck(overlap, GRAZE('M95,100 L270,100')), []);
  assert.deepEqual(runCheck(overlap, GRAZE('M95,99.5 L270,99.5')), []);
});

test('a connector crossing the wall into the box is still an error', () => {
  // The control: only tangency moves to the detour arm. This line runs through the interior, and
  // both ends are 60px outside, so it is the shape line-cuts-box exists for.
  const findings = runCheck(overlap, GRAZE('M40,118 L270,118'));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].code, 'line-cuts-box');
  assert.equal(findings[0].severity, 'error');
});
