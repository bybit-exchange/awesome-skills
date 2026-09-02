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

test('the check is wired into the registry, so lintSource reports it', () => {
  const { findings } = lintSource('right-angle-curve.svg', fixture('fail/right-angle-curve.svg'));
  assert.ok(findings.filter((f) => f.check === 'connector-geometry').length > 0);
});
