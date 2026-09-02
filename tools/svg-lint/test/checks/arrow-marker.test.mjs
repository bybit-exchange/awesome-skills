// tools/svg-lint/test/checks/arrow-marker.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { arrowMarker, MARKER_SPECS } from '../../lib/checks/arrow-marker.mjs';
import { lintSource } from '../../lib/lint.mjs';
import { runCheck, fixture, hasCode, codes } from '../helpers/load.mjs';

const DEFS = (marker) => `<svg viewBox="0 0 272 120" width="272">
  <style>text { font-family: 'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif; }</style>
  <defs>${marker}</defs>
  <path d="M117,80 L 129,80" fill="none" stroke="#64748b" stroke-width="1.5" marker-end="url(#a)"/>
  <rect x="22" y="62" width="90" height="36" fill="#dbeafe" stroke="#3b82f6"/>
  <rect x="140" y="62" width="110" height="36" fill="#d1fae5" stroke="#22c55e"/>
</svg>`;

const GOOD_8 = '<marker id="a" markerWidth="8" markerHeight="8" refX="2" refY="4" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,0 L8,4 L0,8 L2,4 z" fill="#64748b"/></marker>';

test('the clean fixture passes', () => {
  assert.deepEqual(runCheck(arrowMarker, fixture('pass/minimal.svg')), []);
});

test('a missing markerUnits is an error explaining the strokeWidth scaling', () => {
  const findings = runCheck(arrowMarker, fixture('fail/marker-units-missing.svg'));
  const units = findings.find((f) => f.code === 'marker-units-missing');
  assert.equal(units.severity, 'error');
  assert.equal(units.repair.expected, 'userSpaceOnUse');
  assert.match(units.repair.hint, /stroke-width/);
});

test('refX must match the marker size: 8x8 wants 2', () => {
  const findings = runCheck(arrowMarker, fixture('fail/marker-units-missing.svg'));
  const refx = findings.find((f) => f.code === 'marker-refx-mismatch');
  assert.equal(refx.severity, 'error');
  assert.equal(refx.repair.actual, '0');
  assert.equal(refx.repair.expected, '2');
});

test('a 12x12 marker legitimately uses refX 3', () => {
  const marker = '<marker id="a" markerWidth="12" markerHeight="12" refX="3" refY="6" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,0 L12,6 L0,12 L3,6 z" fill="#ef4444"/></marker>';
  assert.equal(hasCode(runCheck(arrowMarker, DEFS(marker)), 'marker-refx-mismatch'), false);
});

test('a 12x12 marker with refX 2 is an error', () => {
  const marker = '<marker id="a" markerWidth="12" markerHeight="12" refX="2" refY="6" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,0 L12,6 L0,12 L3,6 z" fill="#ef4444"/></marker>';
  const findings = runCheck(arrowMarker, DEFS(marker));
  assert.equal(findings.find((f) => f.code === 'marker-refx-mismatch').repair.expected, '3');
});

test('a thick line with an 8x8 marker is an error, and only that', () => {
  // deepEqual rather than find: if the tip advance is computed against "the 12×12 that
  // should be used" rather than the 8×8 that was drawn, the tip position is also wrong
  // and the diagram emits an extra arrow-tip-clearance — which find would not catch.
  const thick = DEFS(GOOD_8).replace('stroke-width="1.5"', 'stroke-width="2"');
  const findings = runCheck(arrowMarker, thick);
  assert.deepEqual(codes(findings), ['marker-too-small-for-stroke']);
  assert.equal(findings[0].severity, 'error');
  assert.equal(findings[0].repair.actual, '8');
  assert.equal(findings[0].repair.expected, '12');
});

test('stroke-width 3 needs the 16x16 marker, so a 12x12 is an error', () => {
  // When only the boundary between the 8 and 12 tiers is pinned, the upper bound of the
  // 12 tier (2.5) can be moved freely with no one noticing.
  const marker = '<marker id="a" markerWidth="12" markerHeight="12" refX="3" refY="6" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,0 L12,6 L0,12 L3,6 z" fill="#64748b"/></marker>';
  const findings = runCheck(arrowMarker, DEFS(marker).replace('stroke-width="1.5"', 'stroke-width="3"').replace('L 129,80', 'L 126,80'));
  const tooSmall = findings.find((f) => f.code === 'marker-too-small-for-stroke');
  assert.equal(tooSmall.repair.actual, '12');
  assert.equal(tooSmall.repair.expected, '16');
  // The hint must follow the size actually drawn in the diagram. If it were hardcoded as
  // "8×8 arrowheads look too small", that sentence would contradict the message on the
  // same finding (`not 12×12`) — leaving the reader to wonder whether the tool calculated
  // the size wrong.
  assert.equal(tooSmall.repair.hint, '12×12 arrowheads look too small at stroke-width 3');
});

test('markerUnits written as strokeWidth is reported by name', () => {
  // Checking only "whether markerUnits is present" would let an explicit wrong value of
  // strokeWidth pass — and that is exactly the value that causes arrowheads to scale with
  // stroke-width.
  const marker = GOOD_8.replace('markerUnits="userSpaceOnUse"', 'markerUnits="strokeWidth"');
  const findings = runCheck(arrowMarker, DEFS(marker));
  assert.deepEqual(codes(findings), ['marker-units-missing']);
  assert.equal(findings[0].repair.actual, 'strokeWidth');
  assert.equal(findings[0].repair.attribute, 'markerUnits');
});

test('a marker taller than it is wide is a warning', () => {
  const marker = '<marker id="a" markerWidth="8" markerHeight="12" refX="2" refY="4" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,0 L8,4 L0,8 L2,4 z" fill="#64748b"/></marker>';
  const findings = runCheck(arrowMarker, DEFS(marker));
  assert.deepEqual(codes(findings), ['marker-not-square']);
  assert.equal(findings[0].severity, 'warning');
  assert.equal(findings[0].repair.actual, '12');
  assert.equal(findings[0].repair.expected, '8');
});

test('a dangling marker-start is an error too', () => {
  // When only the marker-end half is pinned, marker-start can go entirely unchecked and
  // the suite stays green.
  const src = DEFS(GOOD_8).replace('marker-end="url(#a)"', 'marker-start="url(#nope)" marker-end="url(#a)"');
  const findings = runCheck(arrowMarker, src);
  assert.deepEqual(codes(findings), ['marker-reference-dangling']);
  assert.equal(findings[0].severity, 'error');
  assert.equal(findings[0].repair.attribute, 'marker-start');
  assert.equal(findings[0].repair.actual, 'url(#nope)');
});

test('a missing orient="auto" is an error', () => {
  const marker = '<marker id="a" markerWidth="8" markerHeight="8" refX="2" refY="4" markerUnits="userSpaceOnUse"><path d="M0,0 L8,4 L0,8 L2,4 z" fill="#64748b"/></marker>';
  const findings = runCheck(arrowMarker, DEFS(marker));
  assert.ok(hasCode(findings, 'marker-orient-missing'));
  // Without pinning the severity, this finding could be silently downgraded to a warning
  // — but an arrowhead that does not follow the path direction is a drawing error, not a
  // style issue.
  assert.equal(findings.find((f) => f.code === 'marker-orient-missing').severity, 'error');
});

test('an off-spec marker size is a warning', () => {
  const marker = '<marker id="a" markerWidth="10" markerHeight="10" refX="2" refY="5" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,0 L10,5 L0,10 L2,5 z" fill="#64748b"/></marker>';
  const findings = runCheck(arrowMarker, DEFS(marker));
  assert.equal(findings.find((f) => f.code === 'marker-size-off-spec').severity, 'warning');
});

test('a dangling marker reference is an error', () => {
  const src = `<svg viewBox="0 0 272 120" width="272">
  <path d="M117,80 L 129,80" stroke="#64748b" marker-end="url(#nope)"/>
  <rect x="22" y="62" width="90" height="36" fill="#dbeafe" stroke="#3b82f6"/>
  <rect x="140" y="62" width="110" height="36" fill="#d1fae5" stroke="#22c55e"/>
</svg>`;
  assert.ok(hasCode(runCheck(arrowMarker, src), 'marker-reference-dangling'));
});

test('a 3px start clearance is flagged: house style wants 5px', () => {
  const near = DEFS(GOOD_8).replace('d="M117,80 L 129,80"', 'd="M115,80 L 129,80"');
  const findings = runCheck(arrowMarker, near);
  const clearance = findings.find((f) => f.code === 'arrow-start-clearance');
  assert.equal(clearance.severity, 'warning');
  assert.equal(clearance.repair.expected, '5');
  assert.equal(clearance.repair.actual, '3');
  // attribute says which attribute to fix: start clearance is fixed by editing d, not x;
  // without pinning it, any value could be written there.
  assert.equal(clearance.repair.attribute, 'd');
});

test('the arrow tip follows the last segment of an elbow, not the overall direction', () => {
  // House-style connectors are all right-angle polylines. If the tip direction is computed
  // as "start to end", the arrow judgment for an elbow connector would place the tip 10px
  // from the target box instead of 5, and the clearance check flags a tip that is too far
  // just as it flags one that is too close, so a compliant diagram would receive an
  // arrow-tip-clearance finding.
  const elbow = `<svg viewBox="0 0 320 130" width="320">
  <defs>${GOOD_8}</defs>
  <path d="M22,100 L 250,100 L 250,60" fill="none" stroke="#64748b" stroke-width="1.5" marker-end="url(#a)"/>
  <rect x="22" y="62" width="90" height="33" fill="#dbeafe" stroke="#3b82f6"/>
  <rect x="205" y="14" width="90" height="35" fill="#d1fae5" stroke="#22c55e"/>
</svg>`;
  assert.deepEqual(runCheck(arrowMarker, elbow), []);
});

test('an arrow tip that lands 1px from the target box is flagged', () => {
  // end 133 → tip 139 → only 1px to 140
  const deep = DEFS(GOOD_8).replace('d="M117,80 L 129,80"', 'd="M117,80 L 133,80"');
  const findings = runCheck(arrowMarker, deep);
  assert.deepEqual(codes(findings), ['arrow-tip-clearance']);
  // Insufficient clearance means "looks crowded", not "drawn wrong", so it is a warning;
  // without pinning, the severity could be silently upgraded to an error, and a diagram
  // that merely has arrows placed close would cause the CLI exit code to become a failure.
  assert.equal(findings[0].severity, 'warning');
  assert.equal(findings[0].repair.actual, '1');
  // Both expected and hint must be pinned verbatim: without pinning expected, the 5px
  // target can be changed to any number; without pinning 11 in the hint, the actual
  // pull-back distance the author can act on goes unverified.
  assert.equal(findings[0].repair.expected, '5');
  assert.equal(findings[0].repair.attribute, 'd');
  assert.equal(
    findings[0].repair.hint,
    'end the line at target edge ∓ 11 so the tip stops 5px short',
  );
});

// ---- the tip direction is the tangent the arrowhead is actually painted along ----
// A loop-back connector is drawn as one wide, shallow cubic. `orient="auto"` rotates the head
// by the curve's tangent at its end point, which for a cubic runs from the second control point
// to the end point: with cp2 directly below the end the head points straight up, and the tip
// sits one tip-advance above the end. The last chord of the flattened polyline points up **and
// to the left** on a curve 420px across and 43px tall — some 36° off — so a tip taken from it
// lands where no arrowhead was ever drawn, and a compliant drawing gets a finding it cannot act
// on. The two shapes below share a tangent and differ only in width; they must be judged alike.
const WIDE_LOOPBACK = (endY) => `<svg viewBox="0 0 620 200" width="620">
  <defs>${GOOD_8}</defs>
  <rect x="40" y="76" width="112" height="36" fill="#dbeafe" stroke="#3b82f6"/>
  <rect x="460" y="76" width="112" height="36" fill="#d1fae5" stroke="#22c55e"/>
  <path d="M516,117 C 516,160 96,160 96,${endY}" fill="none" stroke="#a855f7" stroke-width="1.5" marker-end="url(#a)"/>
</svg>`;

const NARROW_LOOPBACK = (endY) => `<svg viewBox="0 0 260 200" width="260">
  <defs>${GOOD_8}</defs>
  <rect x="76" y="76" width="40" height="36" fill="#dbeafe" stroke="#3b82f6"/>
  <rect x="136" y="76" width="40" height="36" fill="#d1fae5" stroke="#22c55e"/>
  <path d="M156,117 C 156,160 96,160 96,${endY}" fill="none" stroke="#a855f7" stroke-width="1.5" marker-end="url(#a)"/>
</svg>`;

test('a wide shallow loop-back with the house 5px tip clearance reports nothing', () => {
  // End 123 is 11px below the target box's bottom edge 112, the house pull-back for an 8×8
  // head, so the head advances 6px straight up to 117 and stops exactly 5px clear.
  assert.deepEqual(codes(runCheck(arrowMarker, WIDE_LOOPBACK(123))), []);
});

test('a narrow curve of the same shape reaches the same verdict as the wide one', () => {
  // 60px across against the wide shape's 420px, everything else identical. The two directions
  // very nearly coincide here, which is why the wide shape was the one that misbehaved.
  assert.deepEqual(codes(runCheck(arrowMarker, NARROW_LOOPBACK(123))), []);
});

test('a loop-back ending 2px too far reports 7px at either curve width', () => {
  // The clean pair above cannot distinguish "measured correctly" from "measured wrongly and
  // rounded back inside the ±1px band", so the same pair is repeated off-target: end 125
  // leaves the tip at 119, 7px above the box edge at 112. Both widths must say 7.
  for (const source of [WIDE_LOOPBACK(125), NARROW_LOOPBACK(125)]) {
    const findings = runCheck(arrowMarker, source);
    assert.deepEqual(codes(findings), ['arrow-tip-clearance']);
    assert.equal(findings[0].repair.actual, '7');
    assert.equal(findings[0].repair.expected, '5');
  }
});

test('an arrow that overshoots into the target box reports a 0px clearance', () => {
  // An endpoint that lands **inside** a content box is not subject to the direction gate:
  // the distance is already 0 and moving further forward cannot make it smaller; handing
  // it to the gate would swallow it entirely — an arrow that has stabbed into the target
  // box is the most obvious drawing error, and silently missing it is hardest to justify.
  const inside = DEFS(GOOD_8).replace('d="M117,80 L 129,80"', 'd="M117,80 L 145,80"');
  const findings = runCheck(arrowMarker, inside);
  assert.deepEqual(codes(findings), ['arrow-tip-clearance']);
  assert.equal(findings[0].repair.actual, '0');
});

test('an endpoint resting exactly on a content box edge is a 0px clearance', () => {
  // "Inside the box" on the content-box side must **include** the boundary: landing on
  // the edge is zero clearance, and must be reported just like stabbing inside. The
  // grouping-box side is the opposite (only strictly interior is skipped); the two
  // criteria look alike but mean the opposite — without this pin, changing the content
  // box to also use the strict-interior test (which looks like "unifying the two") would
  // silently swallow the edge case.
  const tipOnEdge = runCheck(arrowMarker, DEFS(GOOD_8).replace('d="M117,80 L 129,80"', 'd="M117,80 L 134,80"'));
  assert.deepEqual(codes(tipOnEdge), ['arrow-tip-clearance']);
  assert.equal(tipOnEdge[0].repair.actual, '0');   // tip 140 = target box left edge
  const startOnEdge = runCheck(arrowMarker, DEFS(GOOD_8).replace('d="M117,80 L 129,80"', 'd="M112,80 L 129,80"'));
  assert.deepEqual(codes(startOnEdge), ['arrow-start-clearance']);
  assert.equal(startOnEdge[0].repair.actual, '0');   // start 112 = source box right edge
});

test('the 5px clearance is a band: 4px and 6px pass, 3px and 7px do not', () => {
  // Testing only "1px should report" allows tolerance and the target value to shift
  // together without being caught.
  const at = (endX) => codes(runCheck(arrowMarker, DEFS(GOOD_8).replace('d="M117,80 L 129,80"', `d="M117,80 L ${endX},80"`)));
  assert.deepEqual(at(130), []);                          // tip 136 → clearance 4
  assert.deepEqual(at(128), []);                          // tip 134 → clearance 6
  assert.deepEqual(at(131), ['arrow-tip-clearance']);     // clearance 3
  assert.deepEqual(at(127), ['arrow-tip-clearance']);     // clearance 7
});

test('the band is the same at the start end: 4px and 6px pass, 3px and 7px do not', () => {
  // The two ends are judged by two separate comparisons, and only the tip end had a test that
  // reached the edges of the band. The tip stays at the compliant 5px in every case here, so the
  // start clearance is the only thing that varies: the source box's right edge is at x=112.
  const at = (startX) => codes(runCheck(arrowMarker, DEFS(GOOD_8).replace('d="M117,80 L 129,80"', `d="M${startX},80 L 129,80"`)));
  assert.deepEqual(at(116), []);                            // clearance 4
  assert.deepEqual(at(118), []);                            // clearance 6
  assert.deepEqual(at(115), ['arrow-start-clearance']);      // clearance 3
  assert.deepEqual(at(119), ['arrow-start-clearance']);      // clearance 7
});

// The far edge of the search radius: within 40px of a box the endpoint is treated as connecting it
// and the clearance is judged, beyond that the path is taken to be an annotation or a divider and is
// left alone. The tests that already existed sat 150px or more outside the radius, so the radius
// could be moved a long way in either direction without being noticed — and moving it inward is the
// dangerous direction, because a genuinely misplaced endpoint then goes unreported. Both ends have
// their own comparison, so both get a pair. Each diagram has a box on one side of the path only, so
// the other end measures no distance at all and contributes no finding.
const TIP_TOWARD_BOX = (endX) => `<svg viewBox="0 0 500 160" width="500">
  <defs>${GOOD_8}</defs>
  <path d="M100,80 L ${endX},80" fill="none" stroke="#64748b" stroke-width="1.5" marker-end="url(#a)"/>
  <rect x="300" y="60" width="100" height="40" rx="6" fill="#d1fae5" stroke="#22c55e"/>
</svg>`;

test('an arrow tip exactly 40px short of the box ahead is still measured', () => {
  // end 254, tip 254 + 6 = 260, box left edge 300 → 40px.
  const findings = runCheck(arrowMarker, TIP_TOWARD_BOX(254));
  assert.deepEqual(codes(findings), ['arrow-tip-clearance']);
  assert.equal(findings[0].repair.actual, '40');
});

test('an arrow tip 41px short of the box ahead is out of range', () => {
  // One pixel further back than the previous case: the tip lands at 259 instead of 260.
  assert.deepEqual(runCheck(arrowMarker, TIP_TOWARD_BOX(253)), []);
});

const START_BEHIND_BOX = (startX) => `<svg viewBox="0 0 700 160" width="700">
  <defs>${GOOD_8}</defs>
  <path d="M${startX},80 L 600,80" fill="none" stroke="#64748b" stroke-width="1.5" marker-end="url(#a)"/>
  <rect x="100" y="60" width="100" height="40" rx="6" fill="#dbeafe" stroke="#3b82f6"/>
</svg>`;

test('a path starting exactly 40px from the box behind it is still measured', () => {
  // start 240, box right edge 200 → 40px.
  const findings = runCheck(arrowMarker, START_BEHIND_BOX(240));
  assert.deepEqual(codes(findings), ['arrow-start-clearance']);
  assert.equal(findings[0].repair.actual, '40');
});

test('a path starting 41px from the box behind it is out of range', () => {
  assert.deepEqual(runCheck(arrowMarker, START_BEHIND_BOX(241)), []);
});

test('a start 20px away from the source box is still flagged', () => {
  // If the search radius were set to 4, only diagrams that are almost within clearance
  // would be checked; diagrams truly far away would instead be silently skipped.
  const far = DEFS(GOOD_8).replace('d="M117,80 L 129,80"', 'd="M132,80 L 129,80"');
  const findings = runCheck(arrowMarker, far);
  const start = findings.find((f) => f.code === 'arrow-start-clearance');
  assert.equal(start.repair.actual, '8');
  assert.equal(start.repair.expected, '5');
});

test('a path aimed at a box 194px away is still out of range', () => {
  // The direction gate controls "whether the path is aimed at the box"; the search radius
  // controls "how far still counts as connected" — each handles one half. This vertical
  // line is aimed at the box above, and only the radius stops it. Without the radius, a
  // caption line would receive advice like "clearance insufficient 194px".
  const far = `<svg viewBox="0 0 400 400" width="400">
  <defs>${GOOD_8}</defs>
  <path d="M250,380 L 250,300" fill="none" stroke="#64748b" stroke-width="1.5" marker-end="url(#a)"/>
  <rect x="150" y="60" width="200" height="40" rx="6" fill="#dbeafe" stroke="#3b82f6"/>
</svg>`;
  assert.deepEqual(runCheck(arrowMarker, far), []);
});

test('two boxes in the same direction: the nearer one is the target', () => {
  // In a house-style chain (A → B → C), the A→B line is aimed at both B and the more
  // distant C. Taking the farthest box would report 30px, yet the author's arrow
  // correctly stops 5px short of B.
  const chain = `<svg viewBox="0 0 460 140" width="460">
  <defs>${GOOD_8}</defs>
  <path d="M117,80 L 129,80" fill="none" stroke="#64748b" stroke-width="1.5" marker-end="url(#a)"/>
  <rect x="22" y="62" width="90" height="36" fill="#dbeafe" stroke="#3b82f6"/>
  <rect x="140" y="62" width="30" height="36" fill="#d1fae5" stroke="#22c55e"/>
  <rect x="165" y="62" width="110" height="36" fill="#d1fae5" stroke="#22c55e"/>
</svg>`;
  assert.deepEqual(runCheck(arrowMarker, chain), []);
});

test('a marker-bearing path far from every box is not measured for clearance', () => {
  // Caption lines and divider lines can also carry arrowheads. Without a search radius
  // limit, they would be more than 200px from the nearest box but still receive advice
  // such as "clearance 202px → should be 5px"; this kind of false positive discourages
  // users more than a false negative.
  const aside = `<svg viewBox="0 0 272 340" width="272">
  <defs>${GOOD_8}</defs>
  <path d="M22,300 L 200,300" fill="none" stroke="#64748b" stroke-width="1.5" marker-end="url(#a)"/>
  <rect x="22" y="62" width="90" height="36" fill="#dbeafe" stroke="#3b82f6"/>
  <rect x="140" y="62" width="110" height="36" fill="#d1fae5" stroke="#22c55e"/>
</svg>`;
  assert.deepEqual(runCheck(arrowMarker, aside), []);
});

// ---- arrow terminating on a dashed group box boundary (explicitly permitted by SKILL.md:127) ----
// group box x 150..350, inset 15px per house style, two member boxes starting at x=165.
// connector starts 5px from the left box's right edge (117), endpoint endX, tip advances 6px.
const GROUPED = (endX) => `<svg viewBox="0 0 380 200" width="380">
  <defs>${GOOD_8}</defs>
  <path d="M117,100 L ${endX},100" fill="none" stroke="#64748b" stroke-width="1.5" marker-end="url(#a)"/>
  <rect x="22" y="82" width="90" height="36" fill="#dbeafe" stroke="#3b82f6"/>
  <rect x="150" y="60" width="200" height="120" rx="10" stroke="#94a3b8" stroke-dasharray="6,4" fill="#f8fafc"/>
  <text x="160" y="74" font-size="11" fill="#64748b">Server</text>
  <rect x="165" y="85" width="170" height="36" rx="6" fill="#dbeafe" stroke="#3b82f6"/>
  <rect x="165" y="130" width="170" height="36" rx="6" fill="#dbeafe" stroke="#3b82f6"/>
</svg>`;

test('an arrow terminating 5px off a dashed group box passes', () => {
  // Measuring only non-dashed content boxes would find the member box **inside** the
  // grouping box (x=165) → a 20px false positive, and its hint would tell the author to
  // push the endpoint another 15px, crossing the dashed boundary into the inset gap —
  // the suggestion itself would corrupt the diagram.
  assert.deepEqual(runCheck(arrowMarker, GROUPED(139)), []);
});

test('a tip resting exactly on the group box boundary is a 0px clearance, not 15', () => {
  // The boundary case of "endpoint inside the group box means group box is skipped":
  // landing exactly on the boundary does **not** count as inside. Using a pointInBBox
  // test with equality would treat this as inside and skip the whole box, reporting the
  // 15px from the inner member box instead — which does not match what the author sees in
  // the diagram. SKILL.md:127 permits terminating on the group box boundary; SKILL.md:207
  // still requires 5px clearance, so landing on the edge is 0px clearance.
  const onEdge = runCheck(arrowMarker, GROUPED(144));   // endpoint 144 → tip 150 = group box left edge
  assert.deepEqual(codes(onEdge), ['arrow-tip-clearance']);
  assert.equal(onEdge[0].repair.actual, '0');
  // The 1px-outside case is also pinned: only when the two numbers differ can we be sure
  // the measurement is the distance to the boundary rather than some constant.
  const justOutside = runCheck(arrowMarker, GROUPED(143));
  assert.equal(justOutside[0].repair.actual, '1');
});

test('an arrow that stops far short of the group box boundary is still flagged', () => {
  // The "pass" side cannot be pinned alone: treating the grouping box as entirely
  // unmeasured would also keep the previous test green. endpoint 129 → tip 135 → 15px
  // from the group box boundary 150, while 23px from the left box and 30px from the
  // member box — the reported 15 can only come from the group box boundary.
  const findings = runCheck(arrowMarker, GROUPED(129));
  assert.deepEqual(codes(findings), ['arrow-tip-clearance']);
  assert.equal(findings[0].repair.actual, '15');
  assert.equal(findings[0].repair.expected, '5');
});

// ---- direction gate: only measure the box the endpoint is actually aimed at ----
// caption line runs horizontally, entirely 25px below the box above it (205 - 180 = 25).
const ASIDE = (box) => `<svg viewBox="0 0 400 300" width="400">
  <defs>${GOOD_8}</defs>
  <path d="M170,205 L 300,205" fill="none" stroke="#64748b" stroke-width="1.5" marker-end="url(#a)"/>
  ${box}
</svg>`;
const DASHED_GROUP = '<rect x="150" y="60" width="200" height="120" rx="10" stroke="#94a3b8" stroke-dasharray="6,4" fill="#f8fafc"/><rect x="165" y="85" width="170" height="36" rx="6" fill="#dbeafe" stroke="#3b82f6"/>';
const SOLID_BOX = '<rect x="150" y="60" width="200" height="120" rx="6" fill="#dbeafe" stroke="#3b82f6"/>';

test('a line running past a box 25px below it is not measured against that box', () => {
  // 25px is exactly the house-style block spacing. With "nearest within 40px" as the only
  // criterion, both ends of this horizontal caption line would be claimed by the box above,
  // generating two `25 → 5` findings — and the CLI acceptance bar is 0 errors and 0
  // warnings, so even one finding fails an otherwise compliant diagram (measured: gaps
  // 20–40 all reported, 41 and above clean; house-style spacing falls squarely in that
  // range). Both the dashed grouping box and the solid content box must be pinned: this
  // is not a grouping-box problem, it is a problem with "distance only" logic.
  assert.deepEqual(runCheck(arrowMarker, ASIDE(DASHED_GROUP)), []);
  assert.deepEqual(runCheck(arrowMarker, ASIDE(SOLID_BOX)), []);
});

test('a line that does point at a box 25px away is still measured', () => {
  // The "pass" side cannot be pinned alone: disabling both-end clearance checks entirely
  // would also keep the previous test green. Same 25px geometry, but the connector is
  // aimed at the box (upward); tip 199 is 19px from the box's bottom edge 180 — should
  // report.
  const upward = ASIDE(SOLID_BOX).replace('d="M170,205 L 300,205"', 'd="M250,240 L 250,205"');
  const findings = runCheck(arrowMarker, upward);
  assert.deepEqual(codes(findings), ['arrow-tip-clearance']);
  assert.equal(findings[0].repair.actual, '19');
});

// ---- the group box participates in measurement only when the endpoint is **outside** it ----
// group box x 50..350 / y 60..200 (dashed), inset 15px per house style, two member boxes
// at 65..165 and 235..335. The connector is entirely **inside** the group box: start 170
// (5px from the left member's right edge), endpoint endX, tip advances 6px.
const INSIDE_GROUP = (endX) => `<svg viewBox="0 0 380 260" width="380">
  <defs>${GOOD_8}</defs>
  <path d="M170,120 L ${endX},120" fill="none" stroke="#64748b" stroke-width="1.5" marker-end="url(#a)"/>
  <rect x="50" y="60" width="300" height="140" rx="10" stroke="#94a3b8" stroke-dasharray="6,4" fill="#f8fafc"/>
  <rect x="65" y="100" width="100" height="40" rx="6" fill="#dbeafe" stroke="#3b82f6"/>
  <rect x="235" y="100" width="100" height="40" rx="6" fill="#dbeafe" stroke="#3b82f6"/>
</svg>`;

test('a connector between two members of the same group is measured against the members', () => {
  // If the grouping box were unconditionally included in the measurement set, the distance
  // from a point **inside** the box to it would be 0, and this diagram drawn to house
  // style would receive a `d: 0 → 5` finding on each end — with no indication of where
  // to move.
  assert.deepEqual(runCheck(arrowMarker, INSIDE_GROUP(224)), []);
});

test('a connector inside a group is still flagged when it really crowds a member', () => {
  // The "pass" side cannot be pinned alone: treating endpoints inside the group box as
  // entirely unmeasured would also keep the previous test green. endpoint 228 → tip 234
  // → only 1px from the right member box 235; the start side is still the compliant 5px.
  const findings = runCheck(arrowMarker, INSIDE_GROUP(228));
  assert.deepEqual(codes(findings), ['arrow-tip-clearance']);
  assert.equal(findings[0].repair.actual, '1');
});

// ---- the start side must also recognise the group box boundary (connectors can leave a group) ----
// group box x 150..390 / y 40..160, inset → member boxes 165..375; one standalone content
// box 22..112 on the left. connector points left: start startX, endpoint 123, tip advances
// 6 → 117, exactly 5px from the left box's right edge 112.
const FROM_GROUP = (startX) => `<svg viewBox="0 0 420 200" width="420">
  <defs>${GOOD_8}</defs>
  <path d="M${startX},100 L 123,100" fill="none" stroke="#64748b" stroke-width="1.5" marker-end="url(#a)"/>
  <rect x="22" y="82" width="90" height="36" fill="#dbeafe" stroke="#3b82f6"/>
  <rect x="150" y="40" width="240" height="120" rx="10" stroke="#94a3b8" stroke-dasharray="6,4" fill="#f8fafc"/>
  <rect x="165" y="82" width="210" height="36" rx="6" fill="#dbeafe" stroke="#3b82f6"/>
</svg>`;

test('an arrow leaving a dashed group box 5px off its boundary passes', () => {
  // The start side and the tip side are two independent measurement calls, each of which
  // must be pinned. Measuring only content boxes would find the member box inside the
  // group (x=165) → a 20px false positive.
  assert.deepEqual(runCheck(arrowMarker, FROM_GROUP(145)), []);
});

test('an arrow leaving from too far outside the group box reports that distance', () => {
  // start 138 is 12px from the group box boundary 150, while 26px from the left box and
  // 27px from the member box — the reported 12 can only come from the group box boundary.
  const findings = runCheck(arrowMarker, FROM_GROUP(138));
  assert.deepEqual(codes(findings), ['arrow-start-clearance']);
  assert.equal(findings[0].repair.actual, '12');
  assert.equal(findings[0].repair.expected, '5');
});

// ---- off-spec markers skip the clearance check at both ends ----
test('an off-spec marker size skips the clearance measurement instead of guessing', () => {
  // A 10×10 arrowhead actually advances 7.5px: endpoint 127.5 → tip 135 → exactly 5px
  // from target box 140 — this diagram's clearance is correct. Computing against "the
  // tier that stroke-width should use" (8×8, advance 6px) would treat the tip as landing
  // at 133.5 and emit an extra arrow-tip-clearance with actual=6.5; and the ∓11 in its
  // hint would also be wrong for a 10×10 arrowhead — two pieces of advice contradicting
  // each other.
  const marker = '<marker id="a" markerWidth="10" markerHeight="10" refX="2" refY="5" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,0 L10,5 L0,10 L2,5 z" fill="#64748b"/></marker>';
  const src = DEFS(marker).replace('d="M117,80 L 129,80"', 'd="M117,80 L 127.5,80"');
  assert.deepEqual(codes(runCheck(arrowMarker, src)), ['marker-size-off-spec']);
});

test('a marker with no markerWidth is reported as undeclared, not as "nullpx"', () => {
  // When markerWidth is missing, String(null) would make the message read `is nullpx wide`
  // and actual become `null`, sending the reader to find a value they never wrote. This
  // also pins the null guard on the too-small check: without it, `null < 8` holds and
  // the diagram receives an extra `needs a 8×8 marker, not null×null` finding.
  const marker = '<marker id="a" markerHeight="8" refX="2" refY="4" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,0 L8,4 L0,8 L2,4 z" fill="#64748b"/></marker>';
  const findings = runCheck(arrowMarker, DEFS(marker));
  assert.deepEqual(codes(findings), ['marker-size-off-spec']);
  assert.equal(findings[0].repair.actual, '(not declared)');
  assert.equal(findings[0].message, 'Marker "a" does not declare markerWidth; the house sizes are 8, 12 and 16');
});

test('a missing markerUnits or orient is reported as undeclared, not as the string "null"', () => {
  // The CLI prints actual verbatim: `markerUnits: null → userSpaceOnUse` looks as if the
  // author actually wrote `markerUnits="null"`, when the real action is to add the attribute.
  const marker = '<marker id="a" markerWidth="8" markerHeight="8" refX="2" refY="4"><path d="M0,0 L8,4 L0,8 L2,4 z" fill="#64748b"/></marker>';
  const findings = runCheck(arrowMarker, DEFS(marker));
  assert.deepEqual(codes(findings), ['marker-units-missing', 'marker-orient-missing']);
  assert.equal(findings[0].repair.actual, '(not declared)');
  assert.equal(findings[1].repair.actual, '(not declared)');
  for (const f of findings) assert.equal(/null/.test(f.message), false);
});

test('a missing markerHeight, refX or refY is reported as undeclared too', () => {
  // Each of the five attributes has its own actual field; if `(not declared)` is pinned
  // only for markerUnits and markerWidth, the remaining three can fall back to String(null),
  // reintroducing `refX: null → 2` and `is 8×null` in the report.
  const marker = '<marker id="a" markerWidth="8" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,0 L8,4 L0,8 L2,4 z" fill="#64748b"/></marker>';
  const findings = runCheck(arrowMarker, DEFS(marker));
  assert.deepEqual(codes(findings), ['marker-not-square', 'marker-refx-mismatch', 'marker-refy-mismatch']);
  assert.equal(findings[0].message, 'Marker "a" is 8×(not declared); house markers are square');
  for (const f of findings) {
    assert.equal(f.repair.actual, '(not declared)');
    assert.equal(/null/.test(f.message), false);
  }
  assert.deepEqual(findings.map((f) => f.repair.expected), ['8', '2', '4']);
});

test('an off-spec marker on a thick line still gets the size-up advice', () => {
  // The position of the "skip if size is off-spec" step is also a criterion: if it were
  // moved before the marker-too-small-for-stroke check, a 6×6 arrowhead on stroke-width 2
  // would only get "switch to 8 / 12 / 16" — the real conclusion "this line needs a 12×12
  // marker" would be gone. Both-end clearance is still skipped (advance distance unknown).
  const marker = '<marker id="a" markerWidth="6" markerHeight="6" refX="2" refY="3" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,0 L6,3 L0,6 L2,3 z" fill="#64748b"/></marker>';
  const src = DEFS(marker).replace('stroke-width="1.5"', 'stroke-width="2"');
  const findings = runCheck(arrowMarker, src);
  assert.deepEqual(codes(findings), ['marker-size-off-spec', 'marker-too-small-for-stroke']);
  assert.equal(findings[1].message, 'stroke-width 2 needs a 12×12 marker, not 6×6');
});

// ---- position: the line / column in the report is the only thing the author can jump to ----
test('a marker finding points at the <marker> element, not at line 1', () => {
  // All marker findings share the same source for their at field. Hardcoding 1:1 would
  // still look "correct" in the report, but every finding would point at the <svg> line,
  // and an editor jump would show the wrong element.
  const findings = runCheck(arrowMarker, fixture('fail/marker-units-missing.svg'));
  const units = findings.find((f) => f.code === 'marker-units-missing');
  assert.equal(units.line, 5);   // fixture line 5 `    <marker id="arrow" …`
  assert.equal(units.column, 5);
});

test('a marker finding reports its line and column, not one value twice', () => {
  // The fixture used above happens to be at 5:5, so swapping line and column is invisible.
  // Here <marker> is at row 3, column 9 (`  <defs>` occupies columns 1..8); the two
  // numbers differ, so a transposition would be caught.
  const marker = '<marker id="a" markerWidth="8" markerHeight="8" refX="2" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 L2,4 z" fill="#64748b"/></marker>';
  const findings = runCheck(arrowMarker, DEFS(marker));
  assert.deepEqual(codes(findings), ['marker-units-missing']);
  assert.equal(findings[0].line, 3);
  assert.equal(findings[0].column, 9);
});

test('a clearance finding points at the <path> element', () => {
  // The path side and the marker side are two independent at fields; each must be pinned.
  const deep = DEFS(GOOD_8).replace('d="M117,80 L 129,80"', 'd="M117,80 L 133,80"');
  const findings = runCheck(arrowMarker, deep);
  assert.deepEqual(codes(findings), ['arrow-tip-clearance']);
  assert.equal(findings[0].line, 4);   // DEFS line 4 `  <path d=… />`
  assert.equal(findings[0].column, 3);
});

// ---- the exported size table is a dependency of other checks and must not be silently made private ----
test('MARKER_SPECS is exported with the three house rows', () => {
  // All expected values are written as literals in this file: importing the constant from
  // the module under test and then asserting it appears in the output would make the
  // assertion permanently green. This test specifically verifies the export itself and
  // the table content.
  assert.deepEqual(MARKER_SPECS, [
    { maxStrokeWidth: 1.5, size: 8, refX: 2, refY: 4, tip: 6, endOffset: 11 },
    { maxStrokeWidth: 2.5, size: 12, refX: 3, refY: 6, tip: 9, endOffset: 14 },
    { maxStrokeWidth: Infinity, size: 16, refX: 4, refY: 8, tip: 12, endOffset: 17 },
  ]);
});

// ---- a shape that does not exist in house style: only marker-start ----
test('a path carrying only marker-start is a known unsupported shape: no clearance is measured', () => {
  // SKILL.md contains marker-end 12 times and marker-start zero times; house style draws
  // reverse arrows by writing d in the reverse direction. Clearance judgment is therefore
  // driven by marker-end, and this diagram is not measured at all — start 117 is 5px from
  // the left box, but the arrowhead extends **backwards** 6px from the start, actually
  // penetrating 1px into the box, and the tool genuinely cannot see it. This is a
  // deliberate trade-off, not an omission; if the check is ever extended to cover this,
  // the change is to the expected value in this test, not to add a hidden code path.
  const src = DEFS(GOOD_8)
    .replace('marker-end="url(#a)"', 'marker-start="url(#a)"')
    .replace('d="M117,80 L 129,80"', 'd="M117,80 L 135,80"');
  assert.deepEqual(runCheck(arrowMarker, src), []);
});

// ---- all three rows of the size table must be pinned, not just the row for size 8 ----
// The 8×8 row is incidentally pinned by the default marker in DEFS (changing it would
// turn many compliant diagrams red); the 12 and 16 rows each have their own independent
// set of numbers: the four fields refX / refY / tip advance / endpoint pull-back can be
// changed freely with no one noticing.

const GOOD_12 = '<marker id="a" markerWidth="12" markerHeight="12" refX="3" refY="6" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,0 L12,6 L0,12 L3,6 z" fill="#64748b"/></marker>';
const GOOD_16 = '<marker id="a" markerWidth="16" markerHeight="16" refX="4" refY="8" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,0 L16,8 L0,16 L4,8 z" fill="#64748b"/></marker>';
// Changing the marker requires changing stroke-width accordingly (8→1.5, 12→2, 16→3),
// otherwise marker-too-small-for-stroke fires first.
const withMarker = (marker, strokeWidth, endX) => DEFS(marker)
  .replace('stroke-width="1.5"', `stroke-width="${strokeWidth}"`)
  .replace('d="M117,80 L 129,80"', `d="M117,80 L ${endX},80"`);

test('a 16x16 marker uses refX 4 and refY 8', () => {
  // endpoint 123 + tip advance 12 = 135 → exactly 5px from target box 140, so this
  // diagram should produce no findings.
  assert.deepEqual(runCheck(arrowMarker, withMarker(GOOD_16, '3', 123)), []);
  const wrongX = runCheck(arrowMarker, withMarker(GOOD_16.replace('refX="4"', 'refX="2"'), '3', 123));
  assert.deepEqual(codes(wrongX), ['marker-refx-mismatch']);
  assert.equal(wrongX[0].repair.expected, '4');
});

test('refY must match half the marker height at every size', () => {
  // Before this test, the marker-refy-mismatch code had no assertions at all: the entire
  // judgment could be deleted and the suite would stay green, because compliant diagrams
  // always have the correct refY.
  const at12 = runCheck(arrowMarker, withMarker(GOOD_12.replace('refY="6"', 'refY="4"'), '2', 126));
  assert.deepEqual(codes(at12), ['marker-refy-mismatch']);
  assert.equal(at12[0].severity, 'error');
  assert.equal(at12[0].repair.actual, '4');
  assert.equal(at12[0].repair.expected, '6');
  const at16 = runCheck(arrowMarker, withMarker(GOOD_16.replace('refY="8"', 'refY="4"'), '3', 123));
  assert.deepEqual(codes(at16), ['marker-refy-mismatch']);
  assert.equal(at16[0].repair.expected, '8');
});

test('the tip advance and the suggested pull-back follow the marker size', () => {
  // tip advance: 12×12 uses 9px, 16×16 uses 12px. Using 8×8's 6px, both correctly-placed
  // diagrams would receive a finding.
  assert.deepEqual(runCheck(arrowMarker, withMarker(GOOD_12, '2', 126)), []);
  assert.deepEqual(runCheck(arrowMarker, withMarker(GOOD_16, '3', 123)), []);
  // The endpoint pull-back appears only in the hint, yet it is the number the author can
  // actually act on (8→11, 12→14, 16→17).
  const at12 = runCheck(arrowMarker, withMarker(GOOD_12, '2', 130));
  assert.deepEqual(codes(at12), ['arrow-tip-clearance']);
  assert.equal(at12[0].repair.actual, '1');
  assert.equal(at12[0].repair.hint, 'end the line at target edge ∓ 14 so the tip stops 5px short');
  const at16 = runCheck(arrowMarker, withMarker(GOOD_16, '3', 127));
  assert.deepEqual(codes(at16), ['arrow-tip-clearance']);
  assert.equal(at16[0].repair.hint, 'end the line at target edge ∓ 17 so the tip stops 5px short');
});

// ---- hand-drawn coordinates with decimals are normal; floating-point tails must not enter messages ----
test('a fractional clearance is reported to one decimal', () => {
  // 118.3 − 112 is 6.299999999999997 in JS; the 133.7 case gives 140 − 139.7 =
  // 0.2999999999999943. Both numbers are meant to be copied back into the d attribute;
  // they cannot carry a long tail.
  const start = runCheck(arrowMarker, DEFS(GOOD_8).replace('d="M117,80', 'd="M118.3,80'));
  assert.deepEqual(codes(start), ['arrow-start-clearance']);
  assert.equal(start[0].repair.actual, '6.3');
  assert.match(start[0].message, /starts 6\.3px from/);
  const tip = runCheck(arrowMarker, DEFS(GOOD_8).replace('L 129,80"', 'L 133.7,80"'));
  assert.deepEqual(codes(tip), ['arrow-tip-clearance']);
  assert.equal(tip[0].repair.actual, '0.3');
  assert.match(tip[0].message, /lands 0\.3px from/);
});

test('a distance with two real decimals is truncated to one, not just stripped of float noise', () => {
  // The second decimal digit in the two samples above is a floating-point tail that
  // `Number()` happens to consume — so the "one decimal place" convention is not actually
  // pinned, and switching to two decimal places would still pass. These two are values
  // that genuinely need truncation: 118.25 is 6.25 from the left box's right edge 112;
  // endpoint 133.875 → tip 139.875 is 0.125 from target box 140.
  const start = runCheck(arrowMarker, DEFS(GOOD_8).replace('d="M117,80', 'd="M118.25,80'));
  assert.deepEqual(codes(start), ['arrow-start-clearance']);
  assert.equal(start[0].repair.actual, '6.3');
  assert.match(start[0].message, /starts 6\.3px from/);
  const tip = runCheck(arrowMarker, DEFS(GOOD_8).replace('L 129,80"', 'L 133.875,80"'));
  assert.deepEqual(codes(tip), ['arrow-tip-clearance']);
  assert.equal(tip[0].repair.actual, '0.1');
  assert.match(tip[0].message, /lands 0\.1px from/);
});

// ---- malformed input must not crash the tool ----
test('a degenerate path carrying a marker reports nothing instead of crashing', () => {
  // Both degenerate forms must be exercised: `M117,80` leaves no points (the parser does
  // not record a point for an isolated moveto), and `M117,80 L 117,80` collapses to
  // exactly one point after deduplication. With only one point there is no last-segment
  // direction — without the length guard, accessing the second-to-last point returns
  // undefined, an exception is thrown before coordinates can become NaN, and a diagram
  // with a typo crashes the whole lint run rather than producing a finding.
  const at = (d) => runCheck(arrowMarker, DEFS(GOOD_8).replace('d="M117,80 L 129,80"', `d="${d}"`));
  assert.deepEqual(at('M117,80'), []);
  assert.deepEqual(at('M117,80 L 117,80'), []);
});

test('a zero-length path is measured at neither end', () => {
  // Curve sample points are not deduplicated (geometry.mjs:97-101), so
  // `C120,80 120,80 120,80` leaves 17 identical points: enough points, but the path has
  // no direction at all. Neither the target box it aims at nor any visible line to adjust
  // can be determined — reporting "start clearance 8px" for a path that draws nothing is
  // noise, so neither end is measured.
  const src = DEFS(GOOD_8).replace('d="M117,80 L 129,80"', 'd="M120,80 C120,80 120,80 120,80"');
  assert.deepEqual(runCheck(arrowMarker, src), []);
});

test('a zero-length path sitting inside a box is still not measured', () => {
  // A stronger variant of the previous test: the degenerate point is placed **inside** a
  // content box. Zero length means no direction; both direction-finding functions return
  // null, so neither end is measured. Without the "zero length means no direction" check,
  // the direction vector is computed as NaN, and NaN only makes subsequent comparisons
  // permanently false — except the "endpoint is inside a content box" shortcut, which
  // ignores direction, and so this diagram would receive a spurious `0 → 5`.
  const src = DEFS(GOOD_8).replace('d="M117,80 L 129,80"', 'd="M60,80 C60,80 60,80 60,80"');
  assert.deepEqual(runCheck(arrowMarker, src), []);
});

test('the start direction skips sample points that coincide with the start', () => {
  // Symmetric with the next test, covering the start side: a leading degenerate cubic
  // makes pts[1] coincide with the start point; looking only at pts[1] gives no direction,
  // and the start side is silently skipped. Start 115 is 3px from the left box's right
  // edge 112 and should report.
  const src = DEFS(GOOD_8).replace('d="M117,80 L 129,80"', 'd="M115,80 C115,80 115,80 115,80 L 133,80"');
  const findings = runCheck(arrowMarker, src);
  assert.deepEqual(codes(findings), ['arrow-start-clearance', 'arrow-tip-clearance']);
  assert.equal(findings[0].repair.actual, '3');
});

test('the tip direction skips sample points that coincide with the end', () => {
  // When a normal polyline is followed by a degenerate cubic, the second-to-last sample
  // point coincides with the last point, direction cannot be computed, and the tip side
  // is silently skipped. Taking the last **non-coincident** point gives the correct
  // judgment: here the tip is only 1px from the target box.
  const src = DEFS(GOOD_8).replace('d="M117,80 L 129,80"', 'd="M117,80 L 133,80 C133,80 133,80 133,80"');
  const findings = runCheck(arrowMarker, src);
  assert.deepEqual(codes(findings), ['arrow-tip-clearance']);
  assert.equal(findings[0].repair.actual, '1');
});

test('a stroke-width carrying a unit does not crash the check', () => {
  // `stroke-width="2px"` / `"1.5pt"` / `"inherit"` are all valid SVG, but
  // document.mjs:494 uses Number() to parse them and gets NaN, matching no size tier.
  // Without a guard, reading undefined.size throws an exception that lint.mjs catches as
  // a check-crashed error: the entire arrow check runs no tests on that file (silent
  // false negative), and the reported error gives the author nothing to act on.
  for (const sw of ['2px', '1.5pt', 'inherit']) {
    const src = DEFS(GOOD_8).replace('stroke-width="1.5"', `stroke-width="${sw}"`);
    assert.deepEqual(runCheck(arrowMarker, src), [], sw);
  }
  // The attribute itself must not be swallowed: the model layer still reports
  // non-numeric-attribute, so "not guessing the marker size" does not mean silence.
  const { findings } = lintSource('inline.svg', DEFS(GOOD_8).replace('stroke-width="1.5"', 'stroke-width="2px"'));
  assert.equal(hasCode(findings, 'check-crashed'), false);
  assert.equal(hasCode(findings, 'non-numeric-attribute'), true);
});

test('an authored stroke-width is echoed verbatim, not rounded', () => {
  // Only **measured** numbers are normalised. Reporting `stroke-width="2.05"` as 2.1
  // would mean the reader cannot find that number in the file, making it harder to match
  // up. The same convention applies in block-spacing.mjs when echoing doc.title.x.
  const src = DEFS(GOOD_8).replace('stroke-width="1.5"', 'stroke-width="2.05"');
  const findings = runCheck(arrowMarker, src);
  assert.deepEqual(codes(findings), ['marker-too-small-for-stroke']);
  assert.equal(findings[0].message, 'stroke-width 2.05 needs a 12×12 marker, not 8×8');
  assert.equal(findings[0].repair.hint, '8×8 arrowheads look too small at stroke-width 2.05');
});

// ---- a path command the parser does not model: the clearances are not judged ----
// parsePath marks A, S and T unsupported and collapses them to zero length, so the point
// array ends where the last modelled command ended rather than where the path ends on
// screen. A clearance measured from that point is a distance the author cannot find in
// their file. subpathTraces in overlap.mjs declines to judge such a path for the same
// reason; these tests pin the same behaviour here.

// One box, on the right, so a westward start direction never claims it and the start
// clearance stays out of the way of the tip assertions.
const ARC_TARGET = (d) => `<svg viewBox="0 0 340 140" width="340">
  <style>text { font-family: 'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif; }</style>
  <defs>${GOOD_8}</defs>
  <path d="${d}" fill="none" stroke="#64748b" stroke-width="1.5" marker-end="url(#a)"/>
  <rect x="230" y="52" width="90" height="36" fill="#dbeafe" stroke="#3b82f6"/>
</svg>`;

test('a modelled path ending short of its target box is still judged', () => {
  // The control for the three tests below: endpoint 200 plus the 8×8 tip advance of 6 is
  // 206, and the box starts at 230, so 24px is a real measurement of coordinates the
  // author wrote. This must keep being reported after the guard is added, otherwise the
  // guard is silencing every path rather than the unmodelled ones.
  const findings = runCheck(arrowMarker, ARC_TARGET('M50,70 L200,70'));
  assert.deepEqual(codes(findings), ['arrow-tip-clearance']);
  assert.equal(findings[0].repair.actual, '24');
  assert.equal(findings[0].message, 'Arrow tip lands 24px from its target box; house style is 5px');
});

test('an unmodelled command leaves both clearances unjudged', () => {
  // Each of these three paths carries on to (260,70), which is 30px inside the box, and
  // each collapses to the same modelled endpoint as the control above. Judging them would
  // report 24px on a path whose arrowhead is drawn well past the box wall.
  for (const d of [
    'M50,70 L200,70 A 30,30 0 0 1 260,70',
    'M50,70 C80,70 120,70 200,70 S 240,70 260,70',
    'M50,70 Q120,40 200,70 T 260,70',
  ]) {
    assert.deepEqual(runCheck(arrowMarker, ARC_TARGET(d)), [], d);
  }
});

test('declining to judge the geometry does not make the file look clean', () => {
  // The declining half is only defensible because the model layer names the command. If
  // this assertion ever goes red the guard has turned a wrong number into silence, which
  // is the failure mode one step less bad than the one it was added to fix.
  const { findings } = lintSource('arc.svg', ARC_TARGET('M50,70 L200,70 A 30,30 0 0 1 260,70'));
  assert.equal(hasCode(findings, 'arrow-tip-clearance'), false);
  const note = findings.find((f) => f.code === 'unsupported-path-command');
  assert.equal(note.check, 'document-model');
  assert.equal(note.severity, 'warning');
  assert.match(note.message, /"A"/);
});

test('an unmodelled command silences only the geometry, not the marker attributes', () => {
  // The guard belongs to the two clearance measurements, which are the only readers of
  // the point array. A marker that is too small for the stroke it is drawn on is read off
  // attributes, so an unmodelled command elsewhere in the same d is no reason to drop it.
  const findings = runCheck(arrowMarker, ARC_TARGET('M50,70 L200,70 A 30,30 0 0 1 260,70')
    .replace('stroke-width="1.5"', 'stroke-width="3"'));
  assert.deepEqual(codes(findings), ['marker-too-small-for-stroke']);
  assert.equal(findings[0].repair.expected, '16');
});

// ---- clearance inside a solid panel ----
// A card wrapping a row of boxes is house style, and a connector between two of its members
// has both of its endpoints inside the card. Treating "inside a content box" as 0px clearance
// without asking whether that content box is the enclosure makes every such connector report
// 0px at both ends, when the boxes it actually joins are the house-style 5px away.

// Left box spans x 60..170, right box spans x 196..306, both inside the card at x 40..440.
// The connector starts 5px clear of the left box and its 8×8 tip advance of 6 lands at 191,
// 5px clear of the right box.
const PANEL_ROW = (d) => `<svg viewBox="0 0 500 200" width="500">
  <style>text { font-family: 'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif; }</style>
  <defs>${GOOD_8}</defs>
  <rect x="40" y="55" width="400" height="120" rx="10" fill="#ffffff" stroke="#94a3b8"/>
  <rect x="60" y="97" width="110" height="36" rx="6" fill="#dbeafe" stroke="#3b82f6"/>
  <text x="115" y="119" font-size="12" fill="#1e40af" text-anchor="middle">Left</text>
  <rect x="196" y="97" width="110" height="36" rx="6" fill="#d1fae5" stroke="#22c55e"/>
  <text x="251" y="119" font-size="12" fill="#166534" text-anchor="middle">Right</text>
  <path d="${d}" fill="none" stroke="#64748b" stroke-width="1.5" marker-end="url(#a)"/>
</svg>`;

test('a connector between two members of a solid card is measured against the members', () => {
  assert.deepEqual(runCheck(arrowMarker, PANEL_ROW('M175,115 L185,115')), []);
});

test('a connector embedded in a member of a card is still reported at 0px', () => {
  // The control for the exemption above: the card is not a peer of the boxes it holds, but
  // the boxes themselves still bind. This connector starts 15px inside the left box, so both
  // ends are wrong and the exemption must not swallow them.
  const findings = runCheck(arrowMarker, PANEL_ROW('M155,115 L200,115'));
  assert.deepEqual(codes(findings), ['arrow-start-clearance', 'arrow-tip-clearance']);
  assert.equal(findings[0].repair.actual, '0');
  assert.equal(findings[1].repair.actual, '0');
});

test('a connector resting on the card wall is measured against the wall', () => {
  // Symmetric with the dashed group box: a card's purpose is to enclose, so an endpoint
  // inside it is normal, but an endpoint exactly on its wall is 0px of clearance and is
  // reported. Start x=40 is the card's left wall; the tip lands 5px clear of the left box.
  const findings = runCheck(arrowMarker, PANEL_ROW('M40,115 L49,115'));
  assert.deepEqual(codes(findings), ['arrow-start-clearance']);
  assert.equal(findings[0].repair.actual, '0');
});

// ---- wiring ----
test('the check is wired into the registry, so lintSource reports it', () => {
  // Without wiring, every other test in this file passes green while the CLI checks
  // nothing. Filtered by check name: this fixture also triggers viewbox-clipping; without
  // the filter this test would need updating with every new check added.
  const { findings } = lintSource('marker-units-missing.svg', fixture('fail/marker-units-missing.svg'));
  assert.deepEqual(
    findings.filter((f) => f.check === 'arrow-marker').map((f) => f.code),
    ['marker-units-missing', 'marker-refx-mismatch', 'marker-too-small-for-stroke'],
  );
});
