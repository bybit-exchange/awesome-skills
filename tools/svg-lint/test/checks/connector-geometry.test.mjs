// tools/svg-lint/test/checks/connector-geometry.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connectorGeometry } from '../../lib/checks/connector-geometry.mjs';
import { lintSource } from '../../lib/lint.mjs';
import { runCheck, fixture, hasCode } from '../helpers/load.mjs';

const WRAP = (body) => `<svg viewBox="0 0 320 160" width="320">
  <style>text { font-family: 'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif; }</style>
  <rect x="0" y="0" width="320" height="160" fill="#ffffff"/>
  ${body}
</svg>`;

const CONNECTOR = (d, extra = '') =>
  WRAP(`<path d="${d}" fill="none" stroke="#64748b" stroke-width="1.5"${extra}/>`);
const ARROW = (d) => CONNECTOR(d, ' marker-end="url(#arrow)"');

test('the clean fixture has compliant connector geometry', () => {
  assert.deepEqual(runCheck(connectorGeometry, fixture('pass/minimal.svg')), []);
});

test('a cp2 that is not tangent to the arrow direction is an error', () => {
  const findings = runCheck(connectorGeometry, fixture('fail/right-angle-curve.svg'));
  const tangent = findings.find((f) => f.code === 'curve-tangent-not-aligned');
  assert.equal(tangent.severity, 'error');
  // The curve travels right, so cp2.y has to equal the endpoint y. The fixture's four points share
  // no coordinate with one another, so among their eight coordinates 40 is its endpoint y alone and 52
  // its cp2.y alone.
  assert.equal(tangent.repair.actual, '52');
  assert.equal(tangent.repair.expected, '40');
});

test('a diagonal straight segment is an error', () => {
  const findings = runCheck(connectorGeometry, fixture('fail/right-angle-curve.svg'));
  const diagonal = findings.find((f) => f.code === 'diagonal-straight-line');
  assert.equal(diagonal.severity, 'error');
  assert.match(diagonal.repair.hint, /C|Q/);
});

test('a horizontal then vertical elbow is a right angle error', () => {
  const findings = runCheck(connectorGeometry, CONNECTOR('M40,40 L 160,40 L 160,120'));
  const angle = findings.find((f) => f.code === 'curve-has-right-angle');
  assert.equal(angle.severity, 'error');
  assert.equal(Math.round(Number(angle.repair.actual)), 90);
  // The corner is where the two segments meet, not where the second one ends
  assert.match(angle.message, /\(160, 40\)/);
});

test('a smooth cubic curve produces no right-angle finding', () => {
  const findings = runCheck(connectorGeometry, CONNECTOR('M40,40 C90,40 110,120 160,120'));
  assert.equal(hasCode(findings, 'curve-has-right-angle'), false);
});

test('a 45 degree turn is not reported as a right angle', () => {
  // Counterpart to the 90 degree elbow: the same two segments with the last x moved from 160 to 240,
  // which turns the 90 degree drop into a 45 degree one. That segment is off both axes, so this
  // asserts on the corner code alone.
  const findings = runCheck(connectorGeometry, CONNECTOR('M40,40 L 160,40 L 240,120'));
  assert.equal(hasCode(findings, 'curve-has-right-angle'), false);
});

test('two quarter turns meeting with the same tangent are not a right angle', () => {
  // A U-turn built from two quarter turns: at (200,150) the first curve arrives straight down
  // (from its control point at (200,100)) and the second leaves straight down (towards its
  // control point at (200,200)), so nothing turns there. The straight line between each curve's
  // own endpoints differs by 126.87° across the join.
  assert.deepEqual(runCheck(connectorGeometry, CONNECTOR('M100,100 Q 200,100 200,150 Q 200,200 100,200')), []);
});

test('a cubic U-turn whose halves share a tangent is not a right angle', () => {
  assert.deepEqual(runCheck(connectorGeometry, CONNECTOR('M100,100 C 180,100 200,120 200,150 C 200,180 180,200 100,200')), []);
});

test('a detour of three smooth quarter turns is not a right angle', () => {
  // A detour of the kind SKILL.md draws for routing around an obstacle, here as three quarter
  // turns: every join has the two tangents pointing the same way.
  assert.deepEqual(runCheck(connectorGeometry, CONNECTOR('M100,300 Q 100,200 200,200 Q 300,200 300,300 Q 300,400 200,400')), []);
});

test('a control point a twentieth of a pixel off the join is not a corner', () => {
  // The curve's first control point is 0.05px below the point it starts from. Read as a direction
  // that arm points straight down, at 90 degrees to the straight segment arriving from the left,
  // while the curve it describes leaves the join rightwards.
  assert.deepEqual(runCheck(connectorGeometry, CONNECTOR('M100,100 L 200,100 C 200,100.05 260,100 260,160')), []);
});

test('a control point half a pixel off the join is not a corner', () => {
  // Counterpart to the case below: the same curve with the arm at the coincidence tolerance.
  assert.deepEqual(runCheck(connectorGeometry, CONNECTOR('M100,100 L 200,100 C 200,100.5 260,100 260,160')), []);
});

test('a control point over half a pixel off the join carries a direction', () => {
  // The same curve with the arm 0.6px long, which is past the tolerance, so the curve leaves the
  // join straight down and the turn from the segment arriving from the left is a right angle.
  const findings = runCheck(connectorGeometry, CONNECTOR('M100,100 L 200,100 C 200,100.6 260,100 260,160'));
  const angle = findings.find((f) => f.code === 'curve-has-right-angle');
  assert.equal(Math.round(Number(angle.repair.actual)), 90);
});

test('a kink between two curves whose endpoints line up is a right angle', () => {
  // Both curves run from their own start to their own end in the same direction (80 across,
  // 40 down), so the straight line between the endpoints does not turn at (120,80) at all.
  // The tangents do: the first curve arrives straight down and the second leaves due east.
  const findings = runCheck(connectorGeometry, CONNECTOR('M40,40 C 80,40 120,40 120,80 C 200,80 200,80 200,120'));
  const angle = findings.find((f) => f.code === 'curve-has-right-angle');
  assert.equal(angle.severity, 'error');
  assert.equal(Math.round(Number(angle.repair.actual)), 90);
});

// Every corner case above turns by about 90 degrees, and the rule fires well below that — it starts
// at 60. The pair below sits either side of that, so the threshold cannot be raised towards 90, which
// would let visible kinks through, and cannot be lowered towards a gentle bend, which would report
// smooth curves. The first curve arrives due east in both, so only the direction the second one
// leaves in differs.
test('a bend of 63 degrees between two curves is a corner, well short of square', () => {
  const findings = runCheck(connectorGeometry, CONNECTOR('M40,80 C 60,80 80,80 100,80 C 110,100 140,130 160,140'));
  const angle = findings.find((f) => f.code === 'curve-has-right-angle');
  assert.equal(angle.severity, 'error');
  assert.equal(angle.repair.actual, '63.43');
  // The receipt names the threshold, so the number is held here as well as by the pair of outcomes.
  assert.equal(angle.repair.expected, '< 60');
});

test('a bend of 56 degrees between the same two curves reads as smooth', () => {
  // The second curve leaves the join 20 across and 30 down instead of 10 and 20, which is four
  // degrees under the threshold rather than three over it.
  assert.deepEqual(runCheck(connectorGeometry, CONNECTOR('M40,80 C 60,80 80,80 100,80 C 120,110 140,130 160,140')), []);
});

test('a duplicated coordinate does not turn a straight line into a corner', () => {
  // The second segment starts and ends at the same point, so it travels in no direction and
  // there is no angle between it and the segment before it.
  assert.deepEqual(runCheck(connectorGeometry, CONNECTOR('M40,120 L 40,40 L 40,40')), []);
});

test('an elbow with a duplicated coordinate at the corner is still a right angle', () => {
  const findings = runCheck(connectorGeometry, CONNECTOR('M40,40 L 160,40 L 160,40 L 160,120'));
  const angle = findings.find((f) => f.code === 'curve-has-right-angle');
  assert.equal(Math.round(Number(angle.repair.actual)), 90);
});

test('a sub-pixel wedge at the corner does not hide the right angle behind it', () => {
  // The Q segment spans 0.4px: its control point is far enough from the start to set a direction
  // there, and close enough to the end for every point to sit on the end, so the segment arrives in
  // no direction. The elbow is between the segment before it and the segment after it, which run
  // 90 degrees apart, and the corner is reported at the point the last segment starts from.
  const findings = runCheck(connectorGeometry, CONNECTOR('M40,40 L 160,40 Q 160.4,40.6 160,40.4 L 160,120'));
  const angle = findings.find((f) => f.code === 'curve-has-right-angle');
  assert.equal(angle.severity, 'error');
  assert.equal(Math.round(Number(angle.repair.actual)), 90);
  assert.match(angle.message, /\(160, 40\.4\)/);
});

test('only one right-angle finding is reported for a connector with two elbows', () => {
  const findings = runCheck(connectorGeometry, CONNECTOR('M40,40 L 160,40 L 160,120 L 260,120'));
  assert.equal(findings.filter((f) => f.code === 'curve-has-right-angle').length, 1);
});

test('segments in two different subpaths do not meet, so they form no corner', () => {
  // A horizontal segment and a vertical one whose directions differ by 90 degrees, but the second
  // starts where nothing ended: the `M` moved the cursor without drawing, so there is no vertex
  // between them to turn at.
  assert.deepEqual(runCheck(connectorGeometry, CONNECTOR('M40,40 L 160,40 M40,100 L 40,150')), []);
});

test('a connector shorter than the minimum visible length is an error', () => {
  const findings = runCheck(connectorGeometry, CONNECTOR('M40,40 L 44,40'));
  const short = findings.find((f) => f.code === 'visible-line-too-short');
  assert.equal(short.repair.actual, '4');
  assert.equal(short.repair.expected, '>= 6');
});

test('a connector exactly at the minimum visible length is accepted', () => {
  // Counterpart to the 4px connector: same shape, 6px long.
  assert.deepEqual(runCheck(connectorGeometry, CONNECTOR('M40,40 L 46,40')), []);
});

test('each subpath is measured for visible length on its own', () => {
  // The first subpath is 160px long and the second 4px. Measured over the whole `d` the two would be
  // joined by the undrawn jump between them and nothing would be reported.
  const findings = runCheck(connectorGeometry, CONNECTOR('M40,40 L 200,40 M40,100 L 44,100'));
  const short = findings.filter((f) => f.code === 'visible-line-too-short');
  assert.equal(short.length, 1);
  assert.equal(short[0].repair.actual, '4');
});

test('a connector with two short subpaths is reported once', () => {
  const findings = runCheck(connectorGeometry, CONNECTOR('M40,40 L 43,40 M40,100 L 44,100'));
  assert.equal(findings.filter((f) => f.code === 'visible-line-too-short').length, 1);
});

test('a subpath carrying an unmodelled command is not measured for visible length', () => {
  // The arc draws an 80px wide half turn, so this connector is far longer than the minimum on
  // screen. Measuring only the modelled part reports "runs only 3px" at error severity — a
  // specific, actionable-looking number that is not in the diagram.
  assert.equal(hasCode(runCheck(connectorGeometry, CONNECTOR('M50,100 L53,100 A 40,40 0 0 1 133,100')), 'visible-line-too-short'), false);
});

test('an unmodelled command silences the length of its own subpath only', () => {
  // The second subpath is 3px of modelled line and nothing else, so it is genuinely too short
  // and is still reported; the first carries the arc and is left unmeasured. Distinct lengths
  // so the reported number names which subpath it came from.
  const findings = runCheck(connectorGeometry, CONNECTOR('M50,100 L54,100 A 40,40 0 0 1 134,100 M50,140 L53,140'));
  const short = findings.filter((f) => f.code === 'visible-line-too-short');
  assert.equal(short.length, 1);
  assert.equal(short[0].repair.actual, '3');
});

test('an unmodelled command silences the length but not the other connector judgments', () => {
  // The precedent is the clearance guard in arrow-marker: decline the measurement that needs
  // real geometry, keep the judgments that read what the author wrote. The diagonal L here is
  // written in the file and stays reported.
  const findings = runCheck(connectorGeometry, CONNECTOR('M50,100 L90,140 A 40,40 0 0 1 170,140'));
  assert.equal(hasCode(findings, 'diagonal-straight-line'), true);
  assert.equal(hasCode(findings, 'visible-line-too-short'), false);
});

test('declining to measure the length does not make the file look clean', () => {
  const { findings } = lintSource('arc.svg', CONNECTOR('M50,100 L53,100 A 40,40 0 0 1 133,100'));
  assert.equal(hasCode(findings, 'visible-line-too-short'), false);
  const note = findings.find((f) => f.code === 'unsupported-path-command');
  assert.equal(note.check, 'document-model');
  assert.match(note.message, /"A"/);
});

test('an axis-aligned straight segment is accepted', () => {
  assert.deepEqual(runCheck(connectorGeometry, CONNECTOR('M40,40 L 200,40')), []);
});

test('a segment half a pixel off axis is accepted', () => {
  assert.deepEqual(runCheck(connectorGeometry, CONNECTOR('M40,40 L 200,40.5')), []);
});

test('a segment a pixel off axis is a diagonal error', () => {
  // Counterpart to the half-pixel segment: same segment, the drop doubled.
  const findings = runCheck(connectorGeometry, CONNECTOR('M40,40 L 200,41'));
  assert.equal(hasCode(findings, 'diagonal-straight-line'), true);
});

test('filled shapes are not treated as connectors', () => {
  // A path with a fill is a shape, not a connector, so its diagonal edges must not be judged
  // diagonal-straight-line
  const src = WRAP('<path d="M40,40 L 120,40 L 80,110 z" fill="#dbeafe" stroke="#3b82f6" stroke-width="1.5"/>');
  assert.deepEqual(runCheck(connectorGeometry, src), []);
});

test('a rightward arrow whose cp2 shares the endpoint y is accepted', () => {
  // Counterpart to the fail/right-angle-curve.svg curve read at the top of this file: the same four
  // points with cp2.y moved from 52 onto the endpoint y, which is the only value the eight
  // coordinates now repeat.
  assert.deepEqual(runCheck(connectorGeometry, ARROW('M45,40.3 C80,44 110,40 160,40')), []);
});

test('a rightward arrow whose cp2 is half a pixel off the endpoint y is accepted', () => {
  // Sub-pixel error is let through. cp2.y is half a pixel from the endpoint y and the start y half a
  // pixel from it the other way, so cp2.y sits a whole pixel from the start y: an arm comparing cp2.y
  // against the start y reports here, and this one does not.
  assert.deepEqual(runCheck(connectorGeometry, ARROW('M45,39.5 C80,44 110,40.5 160,40')), []);
});

test('a rightward arrow whose cp2 is six tenths of a pixel off the endpoint y is an error', () => {
  // The far side of the tolerance the half-pixel case above sits exactly on: cp2.y is 0.6 from the
  // endpoint y and is reported, so a tolerance wide enough to accept a whole pixel would go silent
  // here. The start y is 0.2 from the endpoint y, inside the axis tolerance, so the chord does not
  // read as diagonal and the level-arrowhead comparison runs at all. The four points share no
  // coordinate with one another: among their eight coordinates 40 is the endpoint y alone and 40.6
  // the cp2.y alone.
  const findings = runCheck(connectorGeometry, ARROW('M45,40.2 C80,44 110,40.6 160,40'));
  const tangent = findings.find((f) => f.code === 'curve-tangent-not-aligned');
  assert.equal(tangent.severity, 'error');
  assert.equal(tangent.repair.actual, '40.6');
  assert.equal(tangent.repair.expected, '40');
});

test('a downward arrow needs its cp2 on the endpoint x', () => {
  // The curve starts at x=40.3 and ends at x=40, a drop within the axis tolerance of straight down.
  // Its four points share no coordinate with one another, on either axis, so among their eight
  // coordinates 40 is its endpoint x alone and 55 its cp2.x alone.
  const findings = runCheck(connectorGeometry, ARROW('M40.3,45 C 44,80 55,120 40,160'));
  const tangent = findings.find((f) => f.code === 'curve-tangent-not-aligned');
  assert.equal(tangent.severity, 'error');
  assert.equal(tangent.repair.actual, '55');
  assert.equal(tangent.repair.expected, '40');
});

test('a downward arrow whose cp2 shares the endpoint x is accepted', () => {
  // Counterpart to the case above: same curve with cp2.x moved onto the endpoint x.
  assert.deepEqual(runCheck(connectorGeometry, ARROW('M40.3,45 C 44,80 40,120 40,160')), []);
});

test('a downward arrow whose cp2 is half a pixel off the endpoint x is accepted', () => {
  // Sub-pixel error is let through. The counterpart on x of the rightward half-pixel case above:
  // cp2.x is half a pixel from the endpoint x and the start x four tenths from it the other way, so
  // cp2.x sits 0.9 from the start x and an arm comparing cp2.x against the start x reports here. Four
  // tenths keeps the chord's x component inside the axis tolerance, so the comparison runs rather
  // than being skipped as diagonal.
  assert.deepEqual(runCheck(connectorGeometry, ARROW('M39.6,45 C 44,80 40.5,120 40,160')), []);
});

test('a cp2 past the tip of a rightward arrow is an error', () => {
  const findings = runCheck(connectorGeometry, ARROW('M40,40 C 80,40 200,40 160,40'));
  const tangent = findings.find((f) => f.code === 'curve-tangent-not-aligned');
  assert.equal(tangent.repair.actual, '200');
  assert.equal(tangent.repair.expected, '< 160');
});

test('a cp2 past the tip of a downward arrow is an error', () => {
  const findings = runCheck(connectorGeometry, ARROW('M40,40 C 40,80 40,200 40,160'));
  const tangent = findings.find((f) => f.code === 'curve-tangent-not-aligned');
  assert.equal(tangent.repair.actual, '200');
  assert.equal(tangent.repair.expected, '< 160');
});

test('a cp2 past the tip of a leftward arrow is an error', () => {
  const findings = runCheck(connectorGeometry, ARROW('M200,40 C 160,40 20,40 60,40'));
  const tangent = findings.find((f) => f.code === 'curve-tangent-not-aligned');
  assert.equal(tangent.repair.actual, '20');
  assert.equal(tangent.repair.expected, '> 60');
});

test('a cp2 past the tip of an upward arrow is an error', () => {
  const findings = runCheck(connectorGeometry, ARROW('M40,200 C 40,160 40,20 40,60'));
  const tangent = findings.find((f) => f.code === 'curve-tangent-not-aligned');
  assert.equal(tangent.repair.actual, '20');
  assert.equal(tangent.repair.expected, '> 60');
});

test('a detour that doubles back is judged on the direction of its final segment', () => {
  // The connector leaves rightward and comes back leftward, so the straight line from the first
  // point to the last points right while the arrow points left. cp2 at x=300 is behind the tip at
  // x=200 for a leftward arrow.
  assert.deepEqual(runCheck(connectorGeometry, ARROW('M100,300 Q 100,200 200,200 Q 300,200 300,300 Q 300,400 200,400')), []);
});

test('a U-turn arriving leftward is not asked to keep cp2 level with the endpoint', () => {
  // Start (40,40) and end (40,120) share an x, so the straight line between them runs straight
  // down; the final segment travels left and down, which is a diagonal, and a diagonal has no axis
  // for cp2 to be level with.
  assert.deepEqual(runCheck(connectorGeometry, ARROW('M40,40 Q 200,40 200,80 Q 200,120 40,120')), []);
});

test('a cp2 past the tip of the final segment is an error even where the whole path travels the other way', () => {
  // The same detour as above with the last control point moved to x=170: the arrow arrives leftward
  // at x=200, so a control point at x=170 sits past the tip. Measured against the straight line
  // from the first point to the last, which points right and down, nothing would be reported.
  const findings = runCheck(connectorGeometry, ARROW('M100,300 Q 100,200 200,200 Q 300,200 300,300 Q 170,400 200,400'));
  const tangent = findings.find((f) => f.code === 'curve-tangent-not-aligned');
  assert.equal(tangent.severity, 'error');
  assert.equal(tangent.repair.actual, '170');
  assert.equal(tangent.repair.expected, '> 200');
});

test('a curve returning to its own start is not judged for tangency', () => {
  // The final segment ends where it starts, so its chord names no axis for cp2 to be judged against.
  // The curve does have an end tangent — from (60,60) to the endpoint, at 45 degrees.
  assert.deepEqual(runCheck(connectorGeometry, ARROW('M100,100 C 140,60 60,60 100,100')), []);
});

test('a curve returning to within half a pixel of its own start is not judged for tangency', () => {
  // The same loop as above with the endpoint moved 0.2px right of the start. The rule picks its axis
  // from the chord, and two tenths of a pixel names neither x nor y. Moving the endpoint takes the end
  // tangent with it — from (60,60) to the endpoint, now at 44.86 degrees — and reporting that as a
  // horizontal arrow whose cp2 is not level was the false positive this guard removes.
  assert.deepEqual(runCheck(connectorGeometry, ARROW('M100,100 C 140,60 60,60 100.2,100')), []);
});

test('a curve returning six tenths of a pixel from its own start is judged for tangency', () => {
  // Counterpart to the case above at the far side of the coincidence tolerance: a 0.6px chord is
  // enough for the rule to pick an axis, and cp2 at x=200 lies past the tip at x=100.6 along it. The
  // curve's end tangent runs at 158 degrees, back along that chord, which is what the finding says.
  const findings = runCheck(connectorGeometry, ARROW('M100,100 C 140,55 200,60 100.6,100'));
  const tangent = findings.find((f) => f.code === 'curve-tangent-not-aligned');
  assert.equal(tangent.severity, 'error');
  assert.equal(tangent.repair.actual, '200');
  assert.equal(tangent.repair.expected, '< 100.6');
});

test('a curve travelling diagonally is judged on direction alone', () => {
  // cp2 is 45px off the endpoint y, which on a rightward arrow would be reported. Here the curve
  // travels both right and down, so there is no axis for the perpendicular component to be 0 in,
  // and only "cp2 lies behind the tip" is asked.
  const findings = runCheck(connectorGeometry, ARROW('M40,40 C 80,40 120,55 160,100'));
  assert.equal(hasCode(findings, 'curve-tangent-not-aligned'), false);
});

test('a curve with no marker-end is not judged for tangency', () => {
  // The same curve as the first connector of fail/right-angle-curve.svg, with the marker dropped:
  // with no arrowhead there is no arrow direction for cp2 to be tangent to.
  assert.deepEqual(runCheck(connectorGeometry, CONNECTOR('M45,40.3 C80,44 110,52 160,40')), []);
});

test('a curve followed by a straight segment is not judged for tangency', () => {
  // The same off-axis cp2 that is reported when the curve ends the path. Here a vertical segment
  // follows it, so the arrowhead sits at the end of that segment and takes its angle from it.
  const findings = runCheck(connectorGeometry, ARROW('M40,40 C80,40 110,52 160,40 L 160,120'));
  assert.equal(hasCode(findings, 'curve-tangent-not-aligned'), false);
});

// ── Self-messages returning to a lifeline ───────────────────────────────────
// A slice of a sequence diagram: one dashed lifeline at x=368, the white canvas rect house style
// puts under every diagram, and one arrowed connector. `extra` carries the obstacle a detour
// arrives at, so the buggy self-return and a legitimate detour can be written as the same `d`.
const SEQ = (d, extra = '') => `<svg viewBox="0 0 736 547" width="736">
  <style>text { font-family: 'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif; }</style>
  <rect x="0" y="0" width="736" height="547" fill="#ffffff"/>
  <path d="M368,99 L 368,525" fill="none" stroke="#94a3b8" stroke-width="1" stroke-dasharray="4,4"/>
  ${extra}
  <path d="${d}" fill="none" stroke="#a855f7" stroke-width="1.5" marker-end="url(#arrow-purple)"/>
</svg>`;

// The obstacle a detour terminates on: a solid content box whose top edge carries the end point of
// the curve below, at y=300 spanning the lifeline.
const OBSTACLE = '<rect x="268" y="300" width="200" height="36" rx="6" fill="#dbeafe" stroke="#3b82f6"/>';

test('a self-message whose closing tangent runs along its own lifeline is an error', () => {
  // The shape gallery/03 shipped with. Both endpoints sit on the lifeline and cp2 shares the
  // endpoint x, so the arrowhead points straight down the dashed line instead of back into it.
  const findings = runCheck(connectorGeometry, SEQ('M368,250 C 408,255 368,290 368,300'));
  const parallel = findings.find((f) => f.code === 'self-return-tangent-parallel');
  assert.equal(parallel.check, 'connector-geometry');
  assert.equal(parallel.severity, 'error');
  assert.match(parallel.message, /self-message/);
  assert.equal(parallel.repair.attribute, 'd');
  // The receipt is the distance the closing tangent travels across the lifeline: cp2 and the endpoint
  // share x, so it is 0, and the expected has to be an assertion 0 fails.
  assert.equal(parallel.repair.actual, '0');
  assert.equal(parallel.repair.expected, '> 0.5');
  assert.match(parallel.repair.hint, /control point/);
  // The old rule takes its axis from the chord, which for this curve runs down the lifeline, so it
  // asked for exactly the tangent that is wrong here and said nothing.
  assert.equal(hasCode(findings, 'curve-tangent-not-aligned'), false);
});

test('the self-return receipt states a quantity that fails its own expected', () => {
  // cp2 three tenths of a pixel off the endpoint x: still a tangent along the lifeline. Quoting the
  // coordinate would print `368.3` against `!= 368`, which 368.3 already satisfies — a receipt that
  // asks for nothing. Quoting how far the tangent crosses prints 0.3 against `> 0.5`, which it fails.
  const findings = runCheck(connectorGeometry, SEQ('M368,250 C 408,255 368.3,290 368,300'));
  const parallel = findings.find((f) => f.code === 'self-return-tangent-parallel');
  assert.equal(parallel.repair.actual, '0.3');
  assert.equal(parallel.repair.expected, '> 0.5');
});

test('the defect in the shape the repair hint asks for is caught', () => {
  // The house rule holds the start 5px clear of the lifeline and lands the tip at lifeline + 11, so a
  // correct self-call never touches the line it returns to. Here the author followed that and still
  // aimed the head down the lifeline: cp2 (379,280) and the endpoint (379,290) share x. Requiring an
  // endpoint *on* the lifeline would leave the prescribed shape unguarded while guarding the
  // forbidden one, which is the wrong way round.
  const findings = runCheck(connectorGeometry, SEQ('M373,250 C 408,252 379,280 379,290'));
  const parallel = findings.find((f) => f.code === 'self-return-tangent-parallel');
  assert.equal(parallel.severity, 'error');
  assert.equal(parallel.repair.actual, '0');
});

test('a correct self-return drawn against an activation bar is clean', () => {
  // An activation bar straddles its lifeline and runs the length of the message drawn against it, so
  // it is within arrival range of the tip *and* of the start. Treating it as the box the arrowhead
  // arrived at hands this curve to the chord-based arm, whose receipt (`408 → 368`) is the original
  // defect written out as a repair instruction.
  const bar = '<rect x="362" y="240" width="12" height="80" fill="#dbeafe" stroke="#3b82f6"/>';
  assert.deepEqual(runCheck(connectorGeometry, SEQ('M368,250 C 408,252 408,300 368,300', bar)), []);
});

test('an activation bar opened at the message start silences the defect', () => {
  // Not a verdict worth having: the defect of the first test in this group, byte for byte, going
  // unreported. A bar opened where the message starts, and a nested bar opened where it lands, are
  // both nearer the tip than the start, so each reads as the thing the arrowhead arrived at. Telling
  // them from a destination box would mean judging a rect by its width, which no house rule states.
  // Recorded under Known limits and asserted here so the silence cannot widen without a test failing.
  const opened = '<rect x="362" y="255" width="12" height="80" fill="#dbeafe" stroke="#3b82f6"/>';
  const nested = '<rect x="362" y="300" width="12" height="60" fill="#dbeafe" stroke="#3b82f6"/>';
  assert.deepEqual(runCheck(connectorGeometry, SEQ('M368,250 C 408,255 368,290 368,300', opened)), []);
  assert.deepEqual(runCheck(connectorGeometry, SEQ('M368,250 C 408,255 368,290 368,300', nested)), []);
});

test('an endpoint 12px off its lifeline still belongs to it, 13px does not', () => {
  // Both sides of the clearance band, one pixel apart, on the same defect: the band has to reach the
  // 11px the house rule mandates and must not reach the neighbouring column.
  const inBand = runCheck(connectorGeometry, SEQ('M380,250 C 408,252 380,280 380,290'));
  assert.equal(hasCode(inBand, 'self-return-tangent-parallel'), true);
  assert.deepEqual(runCheck(connectorGeometry, SEQ('M381,250 C 408,252 381,280 381,290')), []);
});

test('a self-return whose cp2 clears the lifeline by six tenths of a pixel is accepted', () => {
  // The far side of the tangent tolerance the case above sits inside: 0.6px of horizontal component
  // is a tangent that crosses the lifeline, so a tolerance wide enough to accept a whole pixel
  // would go silent on a visibly vertical arrowhead.
  assert.deepEqual(runCheck(connectorGeometry, SEQ('M368,250 C 408,255 368.6,290 368,300')), []);
});

test('the repaired self-message of gallery/03 is clean', () => {
  // Leaves the lifeline 5px clear at 373, bulges right to 408 and returns to 379 = lifeline + 11,
  // with cp2.y on the endpoint y so the head closes level, pointing west into the lifeline.
  assert.deepEqual(runCheck(connectorGeometry, SEQ('M373,250 C 408,252 408,290 379,290')), []);
});

test('an obstacle detour with the same chord and bulge is not a self-return', () => {
  // Byte for byte the `d` of the flagged case above, and correct: the end point lands on the top
  // edge of a box, so the arrowhead arrives at that box rather than pointing down a dashed line at
  // nothing. What the two cases differ in is the document around the path, not the path.
  assert.deepEqual(runCheck(connectorGeometry, SEQ('M368,250 C 408,255 368,290 368,300', OBSTACLE)), []);
});

test('a box 20px from the tip is what the arrowhead arrived at', () => {
  // The obstacle moved down so its top edge is exactly the arrival radius below the end point. The
  // radius is the whole false-positive guard, so it is held from both sides: this case and the next
  // differ by one pixel of box y and nothing else.
  const near = '<rect x="268" y="320" width="200" height="36" rx="6" fill="#dbeafe" stroke="#3b82f6"/>';
  assert.deepEqual(runCheck(connectorGeometry, SEQ('M368,250 C 408,255 368,290 368,300', near)), []);
});

test('a box 21px from the tip is too far to be what the arrowhead arrived at', () => {
  const far = '<rect x="268" y="321" width="200" height="36" rx="6" fill="#dbeafe" stroke="#3b82f6"/>';
  const findings = runCheck(connectorGeometry, SEQ('M368,250 C 408,255 368,290 368,300', far));
  assert.equal(hasCode(findings, 'self-return-tangent-parallel'), true);
});

// Which of the two endpoints a box belongs to is decided by comparing the two distances, not by a
// flat radius on each. The three cases below are the same box moved a pixel at a time across the
// point where the two distances are equal, so both directions and the tie are held.
const SIDE = (boxY) => `<rect x="380" y="${boxY}" width="60" height="20" rx="6" fill="#dbeafe" stroke="#3b82f6"/>`;

test('a box nearer the tip than the start is what the arrowhead arrived at', () => {
  // 18.4px from the tip against 20px from the start.
  assert.deepEqual(runCheck(connectorGeometry, SEQ('M368,250 C 408,255 368,290 368,300', SIDE(266))), []);
});

test('a box the same distance from both ends is not an arrival', () => {
  // 19.2px from each: a box the curve ran alongside rather than travelled to, which is the shape of
  // an activation bar. Equal has to fall on the not-an-arrival side or the bar counts again.
  const findings = runCheck(connectorGeometry, SEQ('M368,250 C 408,255 368,290 368,300', SIDE(265)));
  assert.equal(hasCode(findings, 'self-return-tangent-parallel'), true);
});

test('a box nearer the start than the tip is not what the arrowhead arrived at', () => {
  // 20px from the tip against 18.4px from the start: inside the radius, but the curve was leaving it.
  const findings = runCheck(connectorGeometry, SEQ('M368,250 C 408,255 368,290 368,300', SIDE(264)));
  assert.equal(hasCode(findings, 'self-return-tangent-parallel'), true);
});

// Two solid boxes at the house minimum block spacing of 25px, a dashed stub in the gap 11px to the
// right of the connector, and a downward arrow drawn the way the cp2 table asks for: 5px clear of the
// upper box, its painted tip 5px clear of the lower one. Both boxes are within the arrival radius of
// both endpoints, so a flat radius on each end left the connector with no arrival at all.
const GAP = (d, lowerY = 201) => `<svg viewBox="243 115 250 147" width="250">
  <rect x="243" y="115" width="250" height="147" fill="#ffffff"/>
  <rect x="268" y="140" width="200" height="36" rx="6" fill="#dbeafe" stroke="#3b82f6"/>
  <rect x="268" y="${lowerY}" width="200" height="36" rx="6" fill="#dbeafe" stroke="#3b82f6"/>
  <path d="M379,178 L 379,199" fill="none" stroke="#94a3b8" stroke-width="1" stroke-dasharray="4,4"/>
  <path d="${d}" fill="none" stroke="#3b82f6" stroke-width="1.5" marker-end="url(#arrow-blue)"/>
</svg>`;

test('a correct connector between boxes at the minimum spacing is not a self-message', () => {
  // 11px from the tip to the lower box against 20px from the start, so the lower box is what this
  // arrowhead arrived at. Reported, this error would ask the author to bend a curve that is right.
  assert.deepEqual(runCheck(connectorGeometry, GAP('M368,181 C 368,184 368,187 368,190')), []);
});

test('the same connector with no box below it is still judged', () => {
  // The lower box pushed out of arrival range, leaving the dashed stub as the only thing either
  // endpoint belongs to. Without this the case above could pass by never reaching the rule.
  const findings = runCheck(connectorGeometry, GAP('M368,181 C 368,184 368,187 368,190', 215));
  assert.equal(hasCode(findings, 'self-return-tangent-parallel'), true);
});

test('a dashed grouping box around the message does not stand in for an arrival', () => {
  // A sequence diagram wraps its messages in `alt` frames, so a self-message is routinely drawn
  // inside a dashed box. Counting the box would silence the rule for every message in the frame,
  // which is the shape it was written for.
  // Positioned so its top edge is 10px below the tip and 60px below the start: near the end point
  // only, which is what an arrival looks like. Were it a solid content box it would count as one, so
  // this pins the grouping-box exclusion rather than the start-clearance rule below.
  const frame = '<rect x="22" y="310" width="692" height="102" rx="10" fill="#f8fafc" stroke="#94a3b8" stroke-dasharray="6,4"/>';
  const findings = runCheck(connectorGeometry, SEQ('M368,250 C 408,255 368,290 368,300', frame));
  assert.equal(hasCode(findings, 'self-return-tangent-parallel'), true);
});

test('a message arriving at a lifeline from elsewhere is not a self-return', () => {
  // Only the end point is on the lifeline; the curve comes from x=300, so it is an ordinary message
  // between two participants and its arrowhead is judged against its own chord. Reading the end point
  // alone would call every message that lands on a lifeline a self-message.
  assert.deepEqual(runCheck(connectorGeometry, SEQ('M300,200 C 340,210 368,280 368,300')), []);
});

test('a message leaving a lifeline for somewhere else is not a self-return', () => {
  // The mirror of the case above, and the one that needs the *end* point tested: this message starts
  // 5px clear of the lifeline the way every outbound message does, so reading the start alone would
  // call it a self-message. Its cp2 shares the endpoint x, which is what the parallel arm looks for,
  // so the shape is there — only the destination is 217px away from any dashed line.
  assert.deepEqual(runCheck(connectorGeometry, SEQ('M373,250 C 450,252 585,280 585,300')), []);
});

test('an endpoint half a pixel past the end of its lifeline still belongs to it', () => {
  // The lifeline stops just short of the arrowhead in both cases, half a pixel apart. The slack is
  // there because a lifeline is drawn to a round number and a message is not, so demanding the endpoint
  // be level with the drawn stretch would drop a self-call that overshoots its lifeline by a hair.
  const LIFE = (end) => `<svg viewBox="0 0 736 547" width="736">
  <rect x="0" y="0" width="736" height="547" fill="#ffffff"/>
  <path d="M368,99 L 368,${end}" fill="none" stroke="#94a3b8" stroke-width="1" stroke-dasharray="4,4"/>
  <path d="M368,250 C 408,255 368,290 368,300" fill="none" stroke="#a855f7" stroke-width="1.5" marker-end="url(#arrow-purple)"/>
</svg>`;
  assert.equal(hasCode(runCheck(connectorGeometry, LIFE(299.5)), 'self-return-tangent-parallel'), true);
  assert.deepEqual(runCheck(connectorGeometry, LIFE(299.4)), []);
});

test('a self-return whose cp2 lies past its own tip is still reported', () => {
  // The perpendicular arm is the only one a self-return is excused: cp2 at y=320 sits past the tip at
  // y=300, so the tangent points back up the connector, and that is as wrong on a self-message as on
  // any other arrow. Its horizontal component is 40px, so the parallel arm has nothing to say here.
  const findings = runCheck(connectorGeometry, SEQ('M368,250 C 408,255 408,320 368,300'));
  const tangent = findings.find((f) => f.code === 'curve-tangent-not-aligned');
  assert.equal(tangent.severity, 'error');
  assert.equal(tangent.repair.actual, '320');
  assert.equal(tangent.repair.expected, '< 300');
  assert.equal(hasCode(findings, 'self-return-tangent-parallel'), false);
});

test('a self-return written as a Q is judged on its single control point', () => {
  // `Q` carries one control point and it plays the part cp2 plays in a `C`. Two tenths off the
  // endpoint x, so the tangent still runs down the lifeline and crosses it by 0.2px.
  const findings = runCheck(connectorGeometry, SEQ('M368,250 Q 368.2,290 368,300'));
  const parallel = findings.find((f) => f.code === 'self-return-tangent-parallel');
  assert.equal(parallel.repair.actual, '0.2');
});

// A dasharray is only a lifeline when it renders dashed. Each of these values draws a solid line —
// `none` and a blank value are no declaration at all, an all-zero list has no dash to draw, and a
// negative length makes the whole list invalid — so the connector landing on it is not a self-message.
for (const value of ['none', '', '  ', '0', '0,0', '0 0', '-4,4']) {
  test(`a line whose dasharray is ${JSON.stringify(value)} is solid, not a lifeline`, () => {
    const spelled = `<svg viewBox="0 0 736 547" width="736">
  <rect x="0" y="0" width="736" height="547" fill="#ffffff"/>
  <path d="M368,99 L 368,525" fill="none" stroke="#94a3b8" stroke-width="1" stroke-dasharray="${value}"/>
  <path d="M368,250 C 408,255 368,290 368,300" fill="none" stroke="#a855f7" stroke-width="1.5" marker-end="url(#arrow-purple)"/>
</svg>`;
    assert.deepEqual(runCheck(connectorGeometry, spelled), []);
  });
}

test('a dashed connector does not become its own lifeline', () => {
  // A lifeline carries no arrowhead. Without that exclusion this dashed curve is a straight vertical
  // dashed line by its own bounding box, so it would be read as the lifeline its own endpoints rest
  // on and report itself.
  const selfGuide = `<svg viewBox="0 0 736 547" width="736">
  <rect x="0" y="0" width="736" height="547" fill="#ffffff"/>
  <path d="M368,250 C 368,270 368,280 368,300" fill="none" stroke="#a855f7" stroke-width="1.5" stroke-dasharray="6,4" marker-end="url(#arrow-purple)"/>
</svg>`;
  assert.deepEqual(runCheck(connectorGeometry, selfGuide), []);
});

test('a self-message drawn as two curves is judged from where the message began', () => {
  // The same defect as the one-curve case, spelled as a bulge and a return: the last curve starts at
  // the apex 40px off the lifeline, so asking whether *that* point belongs to the lifeline answers no
  // and the defect escapes. The message began at 373, 5px clear, which is what belongs to it. The two
  // curves meet with one tangent, so no corner is reported and this finding stands alone.
  const findings = runCheck(connectorGeometry, SEQ('M373,250 C 395,252 408,265 408,275 C 408,285 379,280 379,290'));
  const parallel = findings.find((f) => f.code === 'self-return-tangent-parallel');
  assert.equal(parallel.severity, 'error');
  assert.equal(parallel.repair.actual, '0');
});

test('a lifeline drawn as a line element with an arrowhead is a connector, not a lifeline', () => {
  // The model resolves `markerEnd` for paths only, so a shape has to be asked for the raw attribute.
  // Reading the resolved key instead let this `<line>` through as a lifeline while the identical
  // `<path>` was excluded — a rule that depended on which element the author reached for.
  const arrowed = `<svg viewBox="0 0 736 547" width="736">
  <rect x="0" y="0" width="736" height="547" fill="#ffffff"/>
  <line x1="368" y1="99" x2="368" y2="525" stroke="#94a3b8" stroke-width="1" stroke-dasharray="4,4" marker-end="url(#arrow-purple)"/>
  <path d="M368,250 C 408,255 368,290 368,300" fill="none" stroke="#a855f7" stroke-width="1.5" marker-end="url(#arrow-purple)"/>
</svg>`;
  assert.deepEqual(runCheck(connectorGeometry, arrowed), []);
});

test('a lifeline carrying only a marker-start is a connector too', () => {
  const arrowed = `<svg viewBox="0 0 736 547" width="736">
  <rect x="0" y="0" width="736" height="547" fill="#ffffff"/>
  <path d="M368,99 L 368,525" fill="none" stroke="#94a3b8" stroke-width="1" stroke-dasharray="4,4" marker-start="url(#arrow-purple)"/>
  <path d="M368,250 C 408,255 368,290 368,300" fill="none" stroke="#a855f7" stroke-width="1.5" marker-end="url(#arrow-purple)"/>
</svg>`;
  assert.deepEqual(runCheck(connectorGeometry, arrowed), []);
});

test('a circle is something an arrowhead can arrive at', () => {
  // A shape with an area is drawn content a connector can point at, so a tip that stops the house 11px
  // short of this circle has arrived at it, exactly as it would at a box. Without shapes in the
  // arrival set this correct arrow was reported, and the hint would have bent it sideways.
  const circle = '<circle cx="368" cy="330" r="19" fill="#dbeafe" stroke="#3b82f6"/>';
  assert.deepEqual(runCheck(connectorGeometry, SEQ('M368,250 C 408,255 368,290 368,300', circle)), []);
});

test('a straight line is not something an arrowhead can arrive at', () => {
  // The counterpart to the circle. This rule sits 5px under the tip and 55px from the start, so if
  // shapes without an area were arrival targets it would read as the thing the arrow aimed at and
  // silence the defect. A line is not an area, and admitting them would also let a lifeline drawn as
  // a `<line>` stand in as the target of the very self-message being judged.
  const rule = '<line x1="300" y1="305" x2="440" y2="305" stroke="#94a3b8" stroke-width="1"/>';
  const findings = runCheck(connectorGeometry, SEQ('M368,250 C 408,255 368,290 368,300', rule));
  assert.equal(hasCode(findings, 'self-return-tangent-parallel'), true);
});

test('a box whose geometry cannot be read silences the self-return judgment', () => {
  // `width="180px"` is valid SVG that the model reads as NaN, so this diagram's boxes cannot be
  // placed and no arrival can be ruled in or out. Reporting a self-message from geometry that could
  // not be read is the outcome to avoid; the file still carries the model's own note about the
  // attribute, so it does not read as clean.
  const unreadable = '<rect x="268" y="320" width="180px" height="36" fill="#dbeafe" stroke="#3b82f6"/>';
  const findings = runCheck(connectorGeometry, SEQ('M368,250 C 408,255 368,290 368,300', unreadable));
  assert.equal(hasCode(findings, 'self-return-tangent-parallel'), false);
});

test('an unreadable box silences the whole arrowhead judgment, not only the self-message arm', () => {
  // The self-return here is correct: it closes 40px across the lifeline. Dropping the lifeline and
  // handing the curve to the chord arm instead reported it, because the chord of a self-return runs
  // along the lifeline and that arm asks cp2 to match the chord — the receipt read `408 → 368`, the
  // defect above written out as an instruction. Silence is the only defensible answer from geometry
  // the model could not place.
  const unreadable = '<rect x="268" y="320" width="180px" height="36" fill="#dbeafe" stroke="#3b82f6"/>';
  assert.deepEqual(runCheck(connectorGeometry, SEQ('M368,250 C 408,252 408,300 368,300', unreadable)), []);
});

test('a shape whose geometry cannot be read leaves the judgment running', () => {
  // `r="19px"` is not among the attributes the model reports as non-numeric, so a file carrying it
  // has nothing in its output to explain a silence — and it still lints as 0 errors, 0 warnings, which
  // a file with an unreadable *rect* cannot. So an unreadable shape is simply not an arrival target:
  // the correct self-return stays clean, and the defect beside the same circle is still reported.
  // Treating it as an arrival, as this check once did, hid both verdicts behind nothing at all.
  const unreadable = '<circle cx="550" cy="420" r="19px" fill="#dbeafe" stroke="#3b82f6"/>';
  assert.deepEqual(runCheck(connectorGeometry, SEQ('M368,250 C 408,252 408,300 368,300', unreadable)), []);
  const findings = runCheck(connectorGeometry, SEQ('M368,250 C 408,255 368,290 368,300', unreadable));
  assert.equal(hasCode(findings, 'self-return-tangent-parallel'), true);
});

test('a solid box with no height is not something an arrowhead can arrive at', () => {
  // The rect counterpart of the `<line>` above, and the reason both sides of the arrival set are
  // filtered the same way: a rect drawn 200px wide and 0px tall paints the same mark as that line, so
  // admitting it while excluding the line would decide a diagram by which element spelled the rule.
  const flat = '<rect x="268" y="311" width="200" height="0" fill="#dbeafe" stroke="#3b82f6"/>';
  const findings = runCheck(connectorGeometry, SEQ('M368,250 C 408,255 368,290 368,300', flat));
  assert.equal(hasCode(findings, 'self-return-tangent-parallel'), true);
});

test('a vertical mark beside the lifeline is not something an arrowhead can arrive at', () => {
  // The width half of the area test, which the flat rect and the 0.5px circle above cannot reach: this
  // mark is 30px tall, so judging height alone would admit it, and it sits 12px across from the tip
  // and 42px from the start — an arrival by every other term, silencing the defect. A lifeline drawn
  // as a `<line>` has exactly this shape, which is the one thing this arm can never let stand in.
  const mark = '<line x1="380" y1="290" x2="380" y2="320" stroke="#94a3b8" stroke-width="1"/>';
  const findings = runCheck(connectorGeometry, SEQ('M368,250 C 408,255 368,290 368,300', mark));
  assert.equal(hasCode(findings, 'self-return-tangent-parallel'), true);
});

test('half a pixel of height is not an area, six tenths is', () => {
  // Both sides of the threshold that separates a shape from a mark, one tenth of a pixel apart, on
  // the same defect: a circle 0.5px tall under the tip does not stand in for a destination, and one
  // 0.6px tall does. Without this the threshold could be read as any small number.
  const mark = '<circle cx="368" cy="311.25" r="0.25" fill="#dbeafe" stroke="#3b82f6"/>';
  const shape = '<circle cx="368" cy="311.3" r="0.3" fill="#dbeafe" stroke="#3b82f6"/>';
  const findings = runCheck(connectorGeometry, SEQ('M368,250 C 408,255 368,290 368,300', mark));
  assert.equal(hasCode(findings, 'self-return-tangent-parallel'), true);
  assert.deepEqual(runCheck(connectorGeometry, SEQ('M368,250 C 408,255 368,290 368,300', shape)), []);
});

test('a self-return that covers no ground carries no arrowhead angle', () => {
  // Every point of the curve sits on its end point, so it arrives in no direction and there is
  // nothing to compare against the lifeline. Its length is still reported, which is what shows the
  // path was judged rather than skipped.
  const findings = runCheck(connectorGeometry, SEQ('M368,300 C 368,300 368,300 368,300'));
  assert.equal(hasCode(findings, 'self-return-tangent-parallel'), false);
  assert.equal(hasCode(findings, 'visible-line-too-short'), true);
});

test('past the tip is measured along the lifeline, not along the chord', () => {
  // A squat self-return: the chord runs 6px across and 4px down, so read as a chord it is a
  // *horizontal* arrow and cp2 at x=379 is not past a tip at x=379. Along the lifeline it plainly is:
  // cp2 sits at y=260, past the tip at y=254, so the tangent points back up the connector.
  const findings = runCheck(connectorGeometry, SEQ('M373,250 C 408,252 379,260 379,254'));
  const tangent = findings.find((f) => f.code === 'curve-tangent-not-aligned');
  assert.equal(tangent.severity, 'error');
  assert.equal(tangent.repair.actual, '260');
  assert.equal(tangent.repair.expected, '< 254');
});

test('a tangent crossing the lifeline by exactly half a pixel is still parallel', () => {
  // The boundary itself: the tolerance is exclusive, so 0.5px of crossing is reported and 0.6px (the
  // case below) is not. Without this pair the comparison could be loosened to `>=` unnoticed.
  const findings = runCheck(connectorGeometry, SEQ('M368,250 C 408,255 368.5,290 368,300'));
  const parallel = findings.find((f) => f.code === 'self-return-tangent-parallel');
  assert.equal(parallel.repair.actual, '0.5');
  assert.equal(parallel.repair.expected, '> 0.5');
});

test('a dashed line half a pixel out of true is still a lifeline, six tenths is not', () => {
  // Both sides of the tolerance that decides a dashed line is straight enough to be an axis. The
  // 0.6px line is also a diagonal `L`, which is reported on its own, so only the self-return verdict
  // is compared here.
  const bent = (x2) => `<svg viewBox="0 0 736 547" width="736">
  <rect x="0" y="0" width="736" height="547" fill="#ffffff"/>
  <path d="M368,99 L ${x2},525" fill="none" stroke="#94a3b8" stroke-width="1" stroke-dasharray="4,4"/>
  <path d="M368,250 C 408,255 368,290 368,300" fill="none" stroke="#a855f7" stroke-width="1.5" marker-end="url(#arrow-purple)"/>
</svg>`;
  assert.equal(hasCode(runCheck(connectorGeometry, bent(368.5)), 'self-return-tangent-parallel'), true);
  assert.equal(hasCode(runCheck(connectorGeometry, bent(368.6)), 'self-return-tangent-parallel'), false);
});

test('a self-return whose closing tangent is already perpendicular is clean', () => {
  // cp2 sits at the far side of the bulge, level with the endpoint, so the tangent arrives due west
  // across the lifeline. The chord-based rule reads this as a downward arrow whose cp2.x is 40px off
  // the endpoint x and reports it — the verdict this carve-out inverts.
  assert.deepEqual(runCheck(connectorGeometry, SEQ('M368,250 C 408,252 408,300 368,300')), []);
});

test('a straight run along a lifeline is not judged as a self-return', () => {
  // An `L` carries no control point, so there is no cp2 to aim anywhere; the arrowhead takes its
  // angle from the segment itself. Both an axis-aligned run down the lifeline and one across it stay
  // clean.
  assert.deepEqual(runCheck(connectorGeometry, SEQ('M368,250 L 368,300')), []);
  assert.deepEqual(runCheck(connectorGeometry, SEQ('M373,222 L 585,222')), []);
});

test('a self-return onto a solid line is not reported', () => {
  // The dashed stroke is what makes a vertical line a lifeline. A solid one is ordinary diagram
  // content, and a connector ending on it is not a self-message.
  const solid = `<svg viewBox="0 0 736 547" width="736">
  <rect x="0" y="0" width="736" height="547" fill="#ffffff"/>
  <path d="M368,99 L 368,525" fill="none" stroke="#94a3b8" stroke-width="1"/>
  <path d="M368,250 C 408,255 368,290 368,300" fill="none" stroke="#a855f7" stroke-width="1.5" marker-end="url(#arrow-purple)"/>
</svg>`;
  assert.deepEqual(runCheck(connectorGeometry, solid), []);
});

test('a lifeline drawn as a dashed line element is read the same way', () => {
  // House style draws lifelines as `<path>`, but the model records a `<line>` too, and which element
  // the author reached for does not change what the arrowhead points at.
  const asLine = `<svg viewBox="0 0 736 547" width="736">
  <rect x="0" y="0" width="736" height="547" fill="#ffffff"/>
  <line x1="368" y1="99" x2="368" y2="525" stroke="#94a3b8" stroke-width="1" stroke-dasharray="4,4"/>
  <path d="M368,250 C 408,255 368,290 368,300" fill="none" stroke="#a855f7" stroke-width="1.5" marker-end="url(#arrow-purple)"/>
</svg>`;
  const parallel = runCheck(connectorGeometry, asLine).find((f) => f.code === 'self-return-tangent-parallel');
  assert.equal(parallel.severity, 'error');
});

test('a dashed line that stops short of the curve is not the lifeline it returns to', () => {
  // Collinear with both endpoints but spanning y 400..525, while the curve runs 250..300. A dashed
  // line elsewhere on the same x is not what this arrowhead arrives at.
  const short = `<svg viewBox="0 0 736 547" width="736">
  <rect x="0" y="0" width="736" height="547" fill="#ffffff"/>
  <path d="M368,400 L 368,525" fill="none" stroke="#94a3b8" stroke-width="1" stroke-dasharray="4,4"/>
  <path d="M368,250 C 408,255 368,290 368,300" fill="none" stroke="#a855f7" stroke-width="1.5" marker-end="url(#arrow-purple)"/>
</svg>`;
  assert.deepEqual(runCheck(connectorGeometry, short), []);
});

test('the axis a self-return is judged on comes from the lifeline, not from x', () => {
  // A horizontal dashed guide at y=280. The closing tangent runs from cp2 (290,280.3) to the endpoint
  // (300,280), so it crosses the guide by 0.3px and runs 10px along it. Reading the wrong axis finds a
  // 10px crossing, well past the tolerance, and reports nothing at all.
  const horizontal = `<svg viewBox="0 0 736 547" width="736">
  <rect x="0" y="0" width="736" height="547" fill="#ffffff"/>
  <path d="M120,280 L 620,280" fill="none" stroke="#94a3b8" stroke-width="1" stroke-dasharray="4,4"/>
  <path d="M250,280 C 255,320 290,280.3 300,280" fill="none" stroke="#a855f7" stroke-width="1.5" marker-end="url(#arrow-purple)"/>
</svg>`;
  const parallel = runCheck(connectorGeometry, horizontal).find((f) => f.code === 'self-return-tangent-parallel');
  assert.equal(parallel.repair.actual, '0.3');
  assert.match(parallel.repair.hint, /control point y/);
});

test('the check is wired into the registry, so lintSource reports it', () => {
  const { findings } = lintSource('right-angle-curve.svg', fixture('fail/right-angle-curve.svg'));
  assert.ok(findings.filter((f) => f.check === 'connector-geometry').length > 0);
});
