// tools/svg-lint/lib/geometry.mjs
// Pure geometry, unaware of SVG semantics. The house style uses only M/L/H/V/C/Q/Z;
// other commands are marked unsupported rather than guessed — a wrong guess lets checks pass silently.

const TOKEN_RE = /[A-Za-z]|-?\d*\.?\d+(?:[eE][-+]?\d+)?/g;

export function parsePath(d) {
  const tokens = String(d ?? '').match(TOKEN_RE) ?? [];
  const segments = [];
  let cur = { x: 0, y: 0 };
  let sub = { x: 0, y: 0 };
  let cmd = null;
  let i = 0;
  const n = () => Number(tokens[i++]);

  while (i < tokens.length) {
    let repeated = false;
    if (/^[A-Za-z]$/.test(tokens[i])) cmd = tokens[i++];
    else repeated = true;
    if (!cmd) break;

    // Repeated coordinate pairs: after M the implicit command is L; all others repeat themselves.
    let c = cmd;
    if (repeated && c === 'M') c = 'L';
    if (repeated && c === 'm') c = 'l';

    const relative = c === c.toLowerCase();
    const U = c.toUpperCase();
    const ox = relative ? cur.x : 0;
    const oy = relative ? cur.y : 0;
    const line = (end) => {
      segments.push({ cmd: 'L', start: { ...cur }, end, controls: [] });
      cur = end;
    };

    if (U === 'Z') {
      if (cur.x !== sub.x || cur.y !== sub.y) line({ ...sub });
      cur = { ...sub };
      continue;
    }
    if (U === 'M') {
      const p = { x: n() + ox, y: n() + oy };
      cur = p;
      sub = { ...p };
      continue;
    }
    if (U === 'L') { line({ x: n() + ox, y: n() + oy }); continue; }
    if (U === 'H') { line({ x: n() + ox, y: cur.y }); continue; }
    if (U === 'V') { line({ x: cur.x, y: n() + oy }); continue; }
    if (U === 'C') {
      const c1 = { x: n() + ox, y: n() + oy };
      const c2 = { x: n() + ox, y: n() + oy };
      const end = { x: n() + ox, y: n() + oy };
      segments.push({ cmd: 'C', start: { ...cur }, end, controls: [c1, c2] });
      cur = end;
      continue;
    }
    if (U === 'Q') {
      const c1 = { x: n() + ox, y: n() + oy };
      const end = { x: n() + ox, y: n() + oy };
      segments.push({ cmd: 'Q', start: { ...cur }, end, controls: [c1] });
      cur = end;
      continue;
    }
    // cmd retains the original SVG letter (e.g. 'A'); consumers should branch on the unsupported flag, not on the cmd value.
    segments.push({ cmd: U, start: { ...cur }, end: { ...cur }, controls: [], unsupported: true });
    while (i < tokens.length && !/^[A-Za-z]$/.test(tokens[i])) i++;
  }
  return segments;
}

function cubicAt(p0, p1, p2, p3, t) {
  const u = 1 - t;
  const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return {
    x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
    y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
  };
}

function quadAt(p0, p1, p2, t) {
  const u = 1 - t;
  return {
    x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x,
    y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y,
  };
}

export function flattenPath(segments, samples = 16) {
  const pts = [];
  const pushIfNew = (p) => {
    const last = pts.at(-1);
    if (!last || last.x !== p.x || last.y !== p.y) pts.push(p);
  };
  for (const s of segments) {
    pushIfNew({ ...s.start });
    if (s.cmd === 'C') {
      for (let k = 1; k <= samples; k++) pts.push(cubicAt(s.start, s.controls[0], s.controls[1], s.end, k / samples));
    } else if (s.cmd === 'Q') {
      for (let k = 1; k <= samples; k++) pts.push(quadAt(s.start, s.controls[0], s.end, k / samples));
    } else {
      pushIfNew({ ...s.end });
    }
  }
  return pts;
}

export function polylineLength(points) {
  let total = 0;
  for (let k = 1; k < points.length; k++) {
    total += Math.hypot(points[k].x - points[k - 1].x, points[k].y - points[k - 1].y);
  }
  return total;
}

export function pointsBBox(points) {
  if (points.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

export function pathBBox(segments) {
  return pointsBBox(flattenPath(segments));
}

export function rectBBox({ x, y, width, height }) {
  return {
    minX: Math.min(x, x + width),
    minY: Math.min(y, y + height),
    maxX: Math.max(x, x + width),
    maxY: Math.max(y, y + height),
  };
}

export function bboxUnion(...boxes) {
  const present = boxes.filter(Boolean);
  if (present.length === 0) return null;
  return present.reduce((acc, b) => ({
    minX: Math.min(acc.minX, b.minX),
    minY: Math.min(acc.minY, b.minY),
    maxX: Math.max(acc.maxX, b.maxX),
    maxY: Math.max(acc.maxY, b.maxY),
  }));
}

// ── Intersection, distance, gap, turn angle ─────────────────────────────────

export function pointInBBox(p, b) {
  return p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY;
}

export function bboxIntersects(a, b, gap = 0) {
  return a.minX - gap < b.maxX && b.minX < a.maxX + gap
    && a.minY - gap < b.maxY && b.minY < a.maxY + gap;
}

export function bboxInsets(outer, inner) {
  return {
    left: inner.minX - outer.minX,
    right: outer.maxX - inner.maxX,
    top: inner.minY - outer.minY,
    bottom: outer.maxY - inner.maxY,
  };
}

function segmentsIntersect(p1, p2, p3, p4) {
  const denom = (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x);
  if (Math.abs(denom) < 1e-12) return false;
  const t = ((p3.x - p1.x) * (p4.y - p3.y) - (p3.y - p1.y) * (p4.x - p3.x)) / denom;
  const u = ((p3.x - p1.x) * (p2.y - p1.y) - (p3.y - p1.y) * (p2.x - p1.x)) / denom;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

function bboxCorners(b) {
  return [
    { x: b.minX, y: b.minY },
    { x: b.maxX, y: b.minY },
    { x: b.maxX, y: b.maxY },
    { x: b.minX, y: b.maxY },
  ];
}

export function segmentIntersectsBBox(p1, p2, box) {
  if (pointInBBox(p1, box) || pointInBBox(p2, box)) return true;
  const corners = bboxCorners(box);
  for (let k = 0; k < 4; k++) {
    if (segmentsIntersect(p1, p2, corners[k], corners[(k + 1) % 4])) return true;
  }
  return false;
}

export function pointToSegmentDistance(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export function pointToBBoxDistance(p, b) {
  const dx = Math.max(b.minX - p.x, 0, p.x - b.maxX);
  const dy = Math.max(b.minY - p.y, 0, p.y - b.maxY);
  return Math.hypot(dx, dy);
}

// The shortest distance between two convex shapes always lies at "a vertex of one plus the interior of an edge of the other",
// so enumerating "box corners to segment" and "segment endpoints to box" is sufficient — no iterative solver needed.
export function bboxToPolylineDistance(box, points) {
  let min = Infinity;
  const corners = bboxCorners(box);
  for (let k = 1; k < points.length; k++) {
    const a = points[k - 1];
    const b = points[k];
    if (segmentIntersectsBBox(a, b, box)) return 0;
    for (const c of corners) min = Math.min(min, pointToSegmentDistance(c, a, b));
    min = Math.min(min, pointToBBoxDistance(a, box), pointToBBoxDistance(b, box));
  }
  return min;
}

export function horizontalGap(a, b) {
  if (a.minY >= b.maxY || b.minY >= a.maxY) return null;
  if (a.maxX <= b.minX) return b.minX - a.maxX;
  if (b.maxX <= a.minX) return a.minX - b.maxX;
  return null;
}

export function verticalGap(a, b) {
  if (a.minX >= b.maxX || b.minX >= a.maxX) return null;
  if (a.maxY <= b.minY) return b.minY - a.maxY;
  if (b.maxY <= a.minY) return a.minY - b.maxY;
  return null;
}

export function segmentAngle(a, b) {
  return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
}

export function turnAngle(s1, s2) {
  let d = Math.abs(segmentAngle(s2.start, s2.end) - segmentAngle(s1.start, s1.end)) % 360;
  if (d > 180) d = 360 - d;
  return d;
}

// Two points this close together are read as one point, and the walks below move on to the next point
// along. Without a tolerance, a control point 0.05px below the point it belongs to would set a
// direction due south for a segment whose later points lie to the east, and a rule comparing that
// direction against a segment arriving from the west would read a right angle at the join.
const POINT_COINCIDENCE_TOLERANCE = 0.5;
export const samePoint = (a, b) => Math.hypot(b.x - a.x, b.y - a.y) <= POINT_COINCIDENCE_TOLERANCE;

// The direction a segment leaves its start point in, as a { start, end } point pair so that
// turnAngle can measure between two of these. A Bézier leaves its start point towards its first
// control point; when that control point sits on the start point the tangent there points at the
// next control point instead, and with both on the start point it points at the end point — hence
// the walk along the segment's points. A straight segment has no control points, so the pair is the
// segment itself. Returns null when every point of the segment is within the coincidence tolerance
// of the start point: a segment that covers no ground travels in no direction, and atan2(0, 0) would
// report due east for it.
export function directionAtStart(s) {
  for (const p of [...s.controls, s.end]) {
    if (!samePoint(s.start, p)) return { start: s.start, end: p };
  }
  return null;
}

// The direction a segment arrives at its end point from, walking the same points from the other
// end: the last control point first, then the earlier ones, then the start point.
export function directionAtEnd(s) {
  for (const p of [...s.controls].reverse().concat([s.start])) {
    if (!samePoint(s.end, p)) return { start: p, end: s.end };
  }
  return null;
}
