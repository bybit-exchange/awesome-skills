// tools/svg-lint/test/geometry.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parsePath, flattenPath, polylineLength,
  pointsBBox, pathBBox, rectBBox, bboxUnion,
  pointInBBox, bboxIntersects, bboxInsets, segmentIntersectsBBox,
  pointToSegmentDistance, pointToBBoxDistance, bboxToPolylineDistance,
  horizontalGap, verticalGap, segmentAngle, turnAngle,
  directionAtStart, directionAtEnd,
} from '../lib/geometry.mjs';

test('parses an absolute co-axial straight line', () => {
  const segs = parsePath('M185,70 L 209,70');
  assert.equal(segs.length, 1);
  assert.equal(segs[0].cmd, 'L');
  assert.deepEqual(segs[0].start, { x: 185, y: 70 });
  assert.deepEqual(segs[0].end, { x: 209, y: 70 });
});

test('normalises H and V into L segments', () => {
  const segs = parsePath('M12,34 H 56 V 78');
  assert.deepEqual(segs.map((s) => s.cmd), ['L', 'L']);
  assert.deepEqual(segs[0].end, { x: 56, y: 34 });
  assert.deepEqual(segs[1].end, { x: 56, y: 78 });
});

test('resolves relative commands against the current point', () => {
  const segs = parsePath('M10,20 l5,7');
  assert.deepEqual(segs[0].end, { x: 15, y: 27 });
});

test('parses a cubic curve with both control points', () => {
  const segs = parsePath('M100,100 C 100,200 300,220 300,250');
  assert.equal(segs[0].cmd, 'C');
  assert.deepEqual(segs[0].controls[0], { x: 100, y: 200 });
  assert.deepEqual(segs[0].controls[1], { x: 300, y: 220 });
  assert.deepEqual(segs[0].end, { x: 300, y: 250 });
});

test('parses a quadratic curve with one control point', () => {
  const segs = parsePath('M600,313 Q 650,313 650,400');
  assert.equal(segs[0].cmd, 'Q');
  assert.deepEqual(segs[0].controls[0], { x: 650, y: 313 });
  assert.deepEqual(segs[0].end, { x: 650, y: 400 });
});

test('treats repeated coordinate pairs after M as implicit L', () => {
  const segs = parsePath('M0,0 41,17 63,29');
  assert.deepEqual(segs.map((s) => s.cmd), ['L', 'L']);
  assert.deepEqual(segs[1].end, { x: 63, y: 29 });
});

test('closes the subpath on Z', () => {
  const segs = parsePath('M0,0 L8,4 L0,8 z');
  assert.equal(segs.length, 3);
  assert.deepEqual(segs[2].end, { x: 0, y: 0 });
  assert.equal(segs[2].cmd, 'L');
  assert.deepEqual(segs[2].start, { x: 0, y: 8 });
});

test('marks unsupported commands instead of guessing', () => {
  const segs = parsePath('M0,0 A 5 5 0 0 1 10 10');
  assert.equal(segs.at(-1).unsupported, true);
});

test('computes the bounding box of the house arrowhead path', () => {
  assert.deepEqual(pathBBox(parsePath('M0,0 L8,4 L0,8 L2,4 z')), {
    minX: 0, minY: 0, maxX: 8, maxY: 8,
  });
});

test('flattens a cubic curve into a polyline that starts and ends on the anchors', () => {
  const pts = flattenPath(parsePath('M100,100 C 100,200 300,220 300,250'), 8);
  assert.deepEqual(pts[0], { x: 100, y: 100 });
  assert.deepEqual(pts.at(-1), { x: 300, y: 250 });
  assert.equal(pts.length, 9);
});

test('polylineLength measures a 3-4-5 triangle hypotenuse', () => {
  assert.equal(polylineLength([{ x: 0, y: 0 }, { x: 3, y: 4 }]), 5);
});

test('rectBBox converts x/y/width/height to edges', () => {
  assert.deepEqual(rectBBox({ x: 11, y: 23, width: 41, height: 31 }), {
    minX: 11, minY: 23, maxX: 52, maxY: 54,
  });
});

test('rectBBox normalises negative dimensions so max >= min', () => {
  // x=10, y=10, width=-4, height=-6  →  corners at (10,10) and (6,4)
  // Math.min/max normalisation: minX=6, minY=4, maxX=10, maxY=10
  assert.deepEqual(rectBBox({ x: 10, y: 10, width: -4, height: -6 }), {
    minX: 6, minY: 4, maxX: 10, maxY: 10,
  });
});

test('bboxUnion spans every input box', () => {
  const a = { minX: 5, minY: 9, maxX: 13, maxY: 17 };
  const b = { minX: 2, minY: 21, maxX: 8, maxY: 33 };
  assert.deepEqual(bboxUnion(a, b), { minX: 2, minY: 9, maxX: 13, maxY: 33 });
});

test('pointsBBox on a single point is degenerate, not empty', () => {
  assert.deepEqual(pointsBBox([{ x: 7, y: 19 }]), {
    minX: 7, minY: 19, maxX: 7, maxY: 19,
  });
});

// B1: quadratic-curve (Q) branch in flattenPath must use quadAt, not cubicAt
// Expected values computed by hand using the quadAt formula: p0={600,313}, p1={650,313}, p2={650,400}, samples=4
// t=k/4 for k=1..4; each point independently verified with (1-t)²p0 + 2(1-t)t·p1 + t²p2
// The incorrect cubic version yields x=643.75, y=323.875 at t=0.5, which does not match x=637.5, y=334.75 below
test('flattenPath flattens a quadratic curve using the quadAt formula', () => {
  const pts = flattenPath(parsePath('M600,313 Q 650,313 650,400'), 4);
  assert.deepEqual(pts, [
    { x: 600,     y: 313      },
    { x: 621.875, y: 318.4375 },
    { x: 637.5,   y: 334.75   },
    { x: 646.875, y: 361.9375 },
    { x: 650,     y: 400      },
  ]);
});

// B2: pathBBox must use enough sample points on curves; default samples=16 must be within 0.2 of the analytic value
// Analytic x maximum for curve M0,0 C 200,0 100,100 0,100:
//   x(t) = 600t − 900t² + 300t³, set dx/dt = 0 → 3t² − 6t + 2 = 0
//   t = 1 − 1/√3 ≈ 0.422650, substituting gives x_max = 200/√3 ≈ 115.470054
//   with samples=4 the closest sampled point is t=0.5, x=112.5, error ≈ 2.970054 — exceeds the 0.2 threshold, this test catches it
//   with samples=16 the closest sampled point is t=7/16=0.4375, x≈115.356445, error ≈ 0.113609 (< 0.2, passes normally)
test('pathBBox default sampling approximates the cubic maximum within 0.2 of the analytic value', () => {
  const bb = pathBBox(parsePath('M0,0 C 200,0 100,100 0,100'));
  assert.ok(bb.maxX < 115.470055, `maxX ${bb.maxX} must not exceed the analytic max 115.470054`);
  assert.ok(115.470054 - bb.maxX < 0.2,
    `maxX ${bb.maxX} must be within 0.2 of analytic max; samples=4 gives error ~2.97`);
});

// B3: when adjacent segments share an endpoint, pushIfNew inserts it only once; removing the guard produces 4 points (midpoint duplicated)
// a zero-length segment causes the point-to-segment distance calculation to divide by zero
test('flattenPath deduplicates the shared anchor between adjacent line segments', () => {
  const pts = flattenPath(parsePath('M0,0 L10,0 L10,10'));
  assert.deepEqual(pts, [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }]);
  assert.equal(pts.length, 3);
});

// B4: exponent notation in coordinates (e.g. 1e2 = 100) must be parsed correctly by TOKEN_RE
test('parsePath handles exponent notation in coordinates', () => {
  const segs = parsePath('M1e2,2e1 L 3e2,4e1');
  assert.equal(segs.length, 1);
  assert.deepEqual(segs[0].start, { x: 100, y: 20 });
  assert.deepEqual(segs[0].end, { x: 300, y: 40 });
});

// B5: decimal coordinates without a leading zero (e.g. .5 = 0.5) must be parsed correctly by TOKEN_RE
// the integer part of TOKEN_RE must allow zero digits (`\d*`): written as `\d+`, `.5` does not match and the coordinate is silently dropped
test('parsePath handles decimal coordinates without a leading zero', () => {
  const segs = parsePath('M0,0 L.5.25');
  assert.equal(segs.length, 1);
  assert.deepEqual(segs[0].end, { x: 0.5, y: 0.25 });
});

// ── Intersection, distance, gap, turn angle ──────────────────────────────────────────────────

const BOX = { minX: 100, minY: 200, maxX: 160, maxY: 236 };

test('pointInBBox includes the boundary', () => {
  assert.equal(pointInBBox({ x: 100, y: 236 }, BOX), true);
  assert.equal(pointInBBox({ x: 99, y: 218 }, BOX), false);
});

test('segmentIntersectsBBox detects a line cutting straight through', () => {
  assert.equal(segmentIntersectsBBox({ x: 80, y: 218 }, { x: 180, y: 218 }, BOX), true);
});

test('segmentIntersectsBBox is false for a line passing clear of the box', () => {
  assert.equal(segmentIntersectsBBox({ x: 80, y: 180 }, { x: 180, y: 180 }, BOX), false);
});

test('segmentIntersectsBBox is true when one endpoint sits inside', () => {
  assert.equal(segmentIntersectsBBox({ x: 130, y: 210 }, { x: 400, y: 210 }, BOX), true);
});

test('pointToSegmentDistance clamps to the segment ends', () => {
  assert.equal(pointToSegmentDistance({ x: 0, y: 7 }, { x: 0, y: 0 }, { x: 20, y: 0 }), 7);
  assert.equal(pointToSegmentDistance({ x: -4, y: 0 }, { x: 0, y: 0 }, { x: 20, y: 0 }), 4);
});

test('pointToBBoxDistance is zero inside and euclidean off a corner', () => {
  assert.equal(pointToBBoxDistance({ x: 130, y: 218 }, BOX), 0);
  assert.equal(pointToBBoxDistance({ x: 96, y: 197 }, BOX), 5);
});

test('bboxToPolylineDistance returns 0 when the line crosses the box', () => {
  const poly = [{ x: 80, y: 218 }, { x: 180, y: 218 }];
  assert.equal(bboxToPolylineDistance(BOX, poly), 0);
});

test('bboxToPolylineDistance measures the clear gap to a parallel line', () => {
  const poly = [{ x: 80, y: 248 }, { x: 180, y: 248 }];
  assert.equal(bboxToPolylineDistance(BOX, poly), 12);
});

test('bboxIntersects honours the gap expansion', () => {
  const other = { minX: 172, minY: 200, maxX: 220, maxY: 236 };
  assert.equal(bboxIntersects(BOX, other), false);
  assert.equal(bboxIntersects(BOX, other, 15), true);
});

test('bboxInsets reports the four paddings', () => {
  const outer = { minX: 0, minY: 0, maxX: 200, maxY: 300 };
  assert.deepEqual(bboxInsets(outer, BOX), { left: 100, right: 40, top: 200, bottom: 64 });
});

test('horizontalGap measures the house-style 28px block spacing', () => {
  const a = { minX: 77, minY: 70, maxX: 217, maxY: 106 };
  const b = { minX: 245, minY: 70, maxX: 395, maxY: 106 };
  assert.equal(horizontalGap(a, b), 28);
  assert.equal(horizontalGap(b, a), 28);
});

test('horizontalGap is null when the vertical projections do not overlap', () => {
  const a = { minX: 77, minY: 70, maxX: 217, maxY: 106 };
  const c = { minX: 245, minY: 300, maxX: 395, maxY: 336 };
  assert.equal(horizontalGap(a, c), null);
});

test('verticalGap measures a stacked pair', () => {
  const a = { minX: 65, minY: 125, maxX: 235, maxY: 161 };
  const b = { minX: 65, minY: 170, maxX: 235, maxY: 206 };
  assert.equal(verticalGap(a, b), 9);
});

test('segmentAngle reports degrees with y growing downward', () => {
  assert.equal(segmentAngle({ x: 0, y: 0 }, { x: 10, y: 0 }), 0);
  assert.equal(segmentAngle({ x: 0, y: 0 }, { x: 0, y: 10 }), 90);
});

test('turnAngle is 90 for a right-angle elbow', () => {
  const segs = parsePath('M100,100 L100,200 L200,200');
  assert.equal(turnAngle(segs[0], segs[1]), 90);
});

test('turnAngle is 0 for two co-axial segments', () => {
  const segs = parsePath('M10,10 L30,10 L70,10');
  assert.equal(turnAngle(segs[0], segs[1]), 0);
});

test('a cubic leaves its start towards cp1 and arrives at its end from cp2', () => {
  // Every one of the four coordinates below is distinct from the other three, so a pair that
  // reported the wrong point could not accidentally hold.
  const [seg] = parsePath('M10,20 C 30,40 50,60 70,80');
  assert.deepEqual(directionAtStart(seg), { start: { x: 10, y: 20 }, end: { x: 30, y: 40 } });
  assert.deepEqual(directionAtEnd(seg), { start: { x: 50, y: 60 }, end: { x: 70, y: 80 } });
});

test('a straight segment travels in the direction of its own two points', () => {
  const [seg] = parsePath('M10,20 L 70,80');
  assert.deepEqual(directionAtStart(seg), { start: { x: 10, y: 20 }, end: { x: 70, y: 80 } });
  assert.deepEqual(directionAtEnd(seg), { start: { x: 10, y: 20 }, end: { x: 70, y: 80 } });
});

test('a control point sitting on the endpoint it belongs to is stepped over', () => {
  // First curve: cp1 is on the start point, so the direction there is taken from cp2 instead.
  // Second curve: cp2 is on the end point, so the direction there is taken from cp1.
  const [seg] = parsePath('M10,20 C 10,20 50,60 70,80');
  assert.deepEqual(directionAtStart(seg), { start: { x: 10, y: 20 }, end: { x: 50, y: 60 } });
  const [seg2] = parsePath('M10,20 C 30,40 70,80 70,80');
  assert.deepEqual(directionAtEnd(seg2), { start: { x: 30, y: 40 }, end: { x: 70, y: 80 } });
});

test('a control point within half a pixel of its endpoint is stepped over too', () => {
  // cp1 is 0.4px from the start point and cp2 is 0.4px from the end point: too short an arm to set
  // a direction the drawn curve follows, so each end reaches past it as if it coincided.
  const [seg] = parsePath('M10,20 C 10.4,20 50,60 70,80');
  assert.deepEqual(directionAtStart(seg), { start: { x: 10, y: 20 }, end: { x: 50, y: 60 } });
  const [seg2] = parsePath('M10,20 C 30,40 70,80.4 70,80');
  assert.deepEqual(directionAtEnd(seg2), { start: { x: 30, y: 40 }, end: { x: 70, y: 80 } });
});

test('a control point over half a pixel from its endpoint sets the direction', () => {
  // Counterpart to the case above: the same two curves with the arms lengthened to 0.6px.
  const [seg] = parsePath('M10,20 C 10.6,20 50,60 70,80');
  assert.deepEqual(directionAtStart(seg), { start: { x: 10, y: 20 }, end: { x: 10.6, y: 20 } });
  const [seg2] = parsePath('M10,20 C 30,40 70,80.6 70,80');
  assert.deepEqual(directionAtEnd(seg2), { start: { x: 70, y: 80.6 }, end: { x: 70, y: 80 } });
});

test('a segment whose every point is the same point has no direction', () => {
  const [line] = parsePath('M10,20 L 10,20');
  assert.equal(directionAtStart(line), null);
  assert.equal(directionAtEnd(line), null);
  const [curve] = parsePath('M10,20 C 10,20 10,20 10,20');
  assert.equal(directionAtStart(curve), null);
  assert.equal(directionAtEnd(curve), null);
});

// ── Gap coverage ───────────────────────────────────────────────────────────

// G1: bboxIntersects gap expansion — only the right-side case was tested; this adds the left side
// BOX.minX = 100, other.maxX = 88, horizontal true gap = 100 − 88 = 12
// the key term is a.minX - gap < b.maxX: with gap=0, 100 < 88 is false; with gap=15, 85 < 88 is true
// without the `- gap` term, gap=15 still returns false — the gap parameter is entirely ineffective
test('bboxIntersects gap expansion covers the left-side boundary', () => {
  const other = { minX: 40, minY: 200, maxX: 88, maxY: 236 };
  assert.equal(bboxIntersects(BOX, other), false);
  assert.equal(bboxIntersects(BOX, other, 15), true);
});

// G2: bboxIntersects strict inequality — two boxes that touch exactly must not be treated as intersecting
// the inequality must be strict: written as `<=`, two boxes sharing one edge would be treated as intersecting,
// causing a false positive on a correctly laid-out diagram

// x-axis touching: other.minX = 160 = BOX.maxX, sharing the line x=160
test('bboxIntersects x-axis touching boxes return false (strict inequality)', () => {
  const other = { minX: 160, minY: 200, maxX: 200, maxY: 236 };
  assert.equal(bboxIntersects(BOX, other), false);
  // gap=1 makes the check pass: other.minX=160 < BOX.maxX+1=161 is true
  assert.equal(bboxIntersects(BOX, other, 1), true);
});

// y-axis touching: other.minY = 236 = BOX.maxY, sharing the line y=236
test('bboxIntersects y-axis touching boxes return false (strict inequality)', () => {
  const other = { minX: 100, minY: 236, maxX: 160, maxY: 280 };
  assert.equal(bboxIntersects(BOX, other), false);
});

// bboxIntersects has four comparison terms; one touching case can only pin the one term that decides the outcome.
// the two tests above pin b.minX < a.maxX + gap and b.minY < a.maxY + gap (box to the right / below);
// the other two terms, a.minX - gap < b.maxX and a.minY - gap < b.maxY, only become the deciding terms when the box is to the left / above.
test('bboxIntersects left-side touching boxes return false (strict inequality)', () => {
  const other = { minX: 40, minY: 200, maxX: 100, maxY: 236 };
  assert.equal(bboxIntersects(BOX, other), false);
  assert.equal(bboxIntersects(BOX, other, 1), true);
});

test('bboxIntersects top-side touching boxes return false (strict inequality)', () => {
  const other = { minX: 100, minY: 150, maxX: 160, maxY: 200 };
  assert.equal(bboxIntersects(BOX, other), false);
  assert.equal(bboxIntersects(BOX, other, 1), true);
});

// G3: pointToSegmentDistance zero-length segment guard
// removing the guard causes len2=0, t = 0/0 = NaN, clamp propagates NaN, result is NaN instead of 5
// reachability: flattenPath's pushIfNew deduplication ensures zero-length segments never enter a polyline,
// but this is a second line of defence — external callers passing raw un-deduplicated endpoints will hit this guard
test('pointToSegmentDistance handles a zero-length segment without returning NaN', () => {
  // distance from point (3,4) to degenerate segment (0,0)→(0,0) = hypot(3,4) = 5 (3-4-5 triangle, exact in floating point)
  assert.equal(pointToSegmentDistance({ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 0, y: 0 }), 5);
});

// G4: bboxToPolylineDistance must include the segment-endpoint-to-box term
// segment [{x:200,y:218},{x:210,y:218}] lies entirely to the right of BOX, within its y range
// nearest distance = endpoint (200,218) to BOX right edge x=160: 200 − 160 = 40
// if the pointToBBoxDistance(a/b, box) term is removed:
//   only the corner-to-segment term remains, nearest corner at y=200 or y=236, distance = hypot(40,18) ≈ 43.86
// 40 and 43.86 are distinguishable, so this test goes red when the endpoint term is missing
test('bboxToPolylineDistance uses segment-endpoint-to-box distance when shorter', () => {
  // short horizontal segment to the right of BOX; y=218 falls within BOX's y range [200,236]
  // endpoint (200,218) to BOX right edge x=160: 200 − 160 = 40
  const poly = [{ x: 200, y: 218 }, { x: 210, y: 218 }];
  assert.equal(bboxToPolylineDistance(BOX, poly), 40);
});

// G5: horizontalGap returns null when vertical projections touch exactly at one edge
// a.minY = 70, b.maxY = 70 → a.minY >= b.maxY is true → projections do not overlap, return null
// the inequality must include equality: written as `>`, 70 > 70 is false, exactly-touching projections
// are treated as overlapping and return 28 instead of null
test('horizontalGap is null when vertical projections touch exactly at one edge', () => {
  // a is the first <rect> from house-style.svg
  const a = { minX: 77, minY: 70, maxX: 217, maxY: 106 };
  // b.maxY = 70 = a.minY: the vertical projections touch exactly, not overlapping
  const b = { minX: 245, minY: 36, maxX: 395, maxY: 70 };
  assert.equal(horizontalGap(a, b), null);
});

// G6: turnAngle wrap across the ±180° discontinuity
// segs[0] direction (−100,+100) → segmentAngle = 135°
// segs[1] direction (−100,−100) → segmentAngle = −135°
// raw absolute difference = |−135 − 135| % 360 = 270; 270 > 180 → 360 − 270 = 90
// removing if (d > 180) d = 360 - d gives 270, which is not a valid turn angle (0–180°)
test('turnAngle wraps across the ±180° discontinuity', () => {
  const segs = parsePath('M100,100 L0,200 L-100,100');
  // first pin the segmentAngle of each segment so a fixture change cannot silently invalidate the conclusion assertion
  assert.equal(segmentAngle(segs[0].start, segs[0].end), 135);
  assert.equal(segmentAngle(segs[1].start, segs[1].end), -135);
  assert.equal(turnAngle(segs[0], segs[1]), 90);
});
