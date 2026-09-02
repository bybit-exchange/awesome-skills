// tools/svg-lint/lib/checks/connector-geometry.mjs
// SKILL.md "Connector rules" — choosing a connector, and the cp2 table under "Fixing arrow
// direction on curved paths" — plus checklist items 4 and 7.
import { error } from '../report.mjs';
import { turnAngle, polylineLength, flattenPath, directionAtStart, directionAtEnd, samePoint } from '../geometry.mjs';
import { effectiveFill } from '../document.mjs';

const ID = 'connector-geometry';
const TANGENT_TOLERANCE = 0.5;
const RIGHT_ANGLE_MIN = 60;
const MIN_VISIBLE_LENGTH = 6;
const AXIS_TOLERANCE = 0.5;

const round = (n) => String(Math.round(n * 100) / 100);

// A path is treated as a connector when its effective fill is `none`. effectiveFill resolves the
// inheritance chain and then falls back to the SVG initial value, so a path that declares no fill
// anywhere in its chain reads as opaque black here and none of the rules below are applied to it.
const isConnector = (path) => effectiveFill(path) === 'none';

// A `d` may hold several subpaths, each opened by an `M` that moves the cursor without drawing.
// Two segments either side of such a move do not meet, so there is no vertex between them to turn
// at, and the move itself is not drawn, so it is not part of any visible length. The split test is
// the one subpathTraces in overlap.mjs uses: does this segment start where the previous one ended.
function subpaths(segments) {
  const runs = [];
  let run = [];
  for (const s of segments) {
    const prev = run.at(-1);
    if (prev && (s.start.x !== prev.end.x || s.start.y !== prev.end.y)) {
      runs.push(run);
      run = [];
    }
    run.push(s);
  }
  if (run.length) runs.push(run);
  return runs;
}

// The first turn at or beyond RIGHT_ANGLE_MIN, searched subpath by subpath. The turn at a shared
// point is the angle between the direction the segment before it arrives in and the direction the
// segment after it leaves in — the two tangents at that point. The straight line between a curve's
// own endpoints is not that direction: on a quarter turn it lies between the two tangents, so two
// quarter turns that join with one continuous tangent read as a large turn although the drawn line
// is smooth there. The two ends of a segment are asked separately, because directionAtStart measures
// every point against the start and directionAtEnd against the end: a segment barely a pixel long can
// carry a direction at one end and none at the other. A segment with no direction at its start opens
// no corner, and one with no direction at its end leaves the previous arriving direction in place, so
// a coordinate repeated at a corner neither forms a corner nor hides the corner around it.
function firstCorner(runs) {
  for (const run of runs) {
    let arriving = null;
    for (const s of run) {
      const leaving = directionAtStart(s);
      if (leaving === null) continue;
      if (arriving !== null) {
        const angle = turnAngle(arriving, leaving);
        if (angle >= RIGHT_ANGLE_MIN) return { angle, corner: s.start };
      }
      const next = directionAtEnd(s);
      if (next !== null) arriving = next;
    }
  }
  return null;
}

export const connectorGeometry = {
  id: ID,
  title: 'Connectors curve smoothly and stay long enough to read',
  run(doc) {
    const out = [];

    for (const path of doc.paths) {
      if (!isConnector(path)) continue;
      const at = { line: path.line, column: path.column };
      // Commands parsePath does not model are collapsed to zero length, so their endpoints are not
      // the ones the author wrote; they are dropped here and reported by the unsupported-path-command
      // note in document.mjs instead.
      // Split once, over every segment: an unmodelled command is collapsed onto the cursor
      // (see where parsePath marks a segment unsupported in geometry.mjs), so it starts where the
      // previous one ended and never splits a run. That means the same split serves both readers —
      // the ones that want the modelled segments only, and the visible-length measurement below,
      // which needs to know which subpath an unmodelled command sits in.
      const allRuns = subpaths(path.segments);
      const runs = allRuns.map((run) => run.filter((s) => !s.unsupported)).filter((run) => run.length > 0);
      const segments = runs.flat();
      if (runs.length === 0) continue;

      // Measured per subpath; the first subpath below the minimum ends the search. A subpath that
      // carries an unmodelled command is not measured at all: the command is collapsed to zero
      // length, so the length of what is left is not the length of what is drawn —
      // `M50,100 L53,100 A 40,40 0 0 1 133,100` draws 83px and would be reported as running only
      // 3px, at error severity, with a number the author cannot find in the diagram. Same
      // conclusion as the clearance guard in arrow-marker.mjs, reached the same way: the
      // judgments that read what the author wrote keep running, only this one measurement is
      // declined, and document.mjs still names the command in unsupported-path-command so the
      // file does not read as clean.
      const short = allRuns
        .filter((run) => !run.some((s) => s.unsupported))
        .map((run) => polylineLength(flattenPath(run)))
        .find((length) => length < MIN_VISIBLE_LENGTH);
      if (short !== undefined) {
        out.push(error({
          check: ID, code: 'visible-line-too-short', ...at,
          message: `Connector runs only ${round(short)}px, below the ${MIN_VISIBLE_LENGTH}px minimum visible length`,
          repair: { attribute: 'd', actual: round(short), expected: `>= ${MIN_VISIBLE_LENGTH}`, hint: 'move the endpoints apart, or drop the connector' },
        }));
      }

      // A straight segment is only allowed along an axis; a diagonal one has to become a C / Q curve.
      for (const s of segments) {
        if (s.cmd !== 'L') continue;
        const dx = Math.abs(s.end.x - s.start.x);
        const dy = Math.abs(s.end.y - s.start.y);
        if (dx <= AXIS_TOLERANCE || dy <= AXIS_TOLERANCE) continue;
        out.push(error({
          check: ID, code: 'diagonal-straight-line', ...at,
          message: `Straight segment runs diagonally (dx ${round(dx)}, dy ${round(dy)})`,
          repair: { attribute: 'd', actual: `L ${round(s.end.x)},${round(s.end.y)}`, expected: 'an axis-aligned L, or a C/Q curve', hint: 'draw a diagonal run as a C or Q curve so the connector reads as a flow, not a corner' },
        }));
      }

      const corner = firstCorner(runs);
      if (corner) {
        out.push(error({
          check: ID, code: 'curve-has-right-angle', ...at,
          message: `Connector turns ${round(corner.angle)}° at (${round(corner.corner.x)}, ${round(corner.corner.y)})`,
          repair: { attribute: 'd', actual: round(corner.angle), expected: `< ${RIGHT_ANGLE_MIN}`, hint: 'replace the elbow with a single C or Q curve' },
        }));
      }

      if (path.markerEnd) {
        const finding = tangentProblem(segments.at(-1), at);
        if (finding) out.push(finding);
      }
    }

    return out;
  },
};

// The cp2 → end segment has to run in the same direction as the final segment travels, with a
// component of 0 in the perpendicular direction. The four rows of SKILL.md's cp2 table are four
// spellings of that one sentence.
//
// The segment examined is the last one of the path that parsePath models, and only when it is a
// curve: `marker-end` sits at the end of the whole path and `orient="auto"` takes the arrowhead's
// angle from the tangent there, which is what SKILL.md means by "direction comes from the final path
// segment" — unless the path ends in a command the parser does not model, in which case the segment
// taken here is not the one the arrowhead sits on and the unmodelled command is reported on its own.
// So when a straight segment follows the curve, that segment carries the arrowhead and the curve's
// cp2 is not what the rule is about, and where the path doubles back, the direction the arrow points
// is the last segment's, not the one from the first point of the last subpath to the last point.
//
// The last element of `controls` is cp2 — C carries two control points and Q one, so taking the last
// covers both.
function tangentProblem(curve, at) {
  if (curve.cmd !== 'C' && curve.cmd !== 'Q') return null;
  const cp2 = curve.controls.at(-1);
  const end = curve.end;
  const travelX = end.x - curve.start.x;
  const travelY = end.y - curve.start.y;
  // Everything below reads the chord from start to end: `horizontal` takes the axis from it and
  // `diagonal` decides whether the perpendicular arm applies. A chord this short names no axis, so the
  // return here skips every comparison below, the past-the-tip ones as well as the perpendicular ones.
  // Such a segment can still have an end tangent — the loop returning to its own start arrives at
  // 45° — but not one this rule can classify. samePoint is the test geometry.mjs applies to a
  // segment's own points, reused here so the half pixel has one spelling rather than two.
  if (samePoint(curve.start, end)) return null;
  const horizontal = Math.abs(travelX) >= Math.abs(travelY);
  // With both components non-zero there is no axis for the perpendicular component to be 0 in, so
  // only the direction agreement below is asked of a segment travelling diagonally.
  const diagonal = Math.abs(travelX) > AXIS_TOLERANCE && Math.abs(travelY) > AXIS_TOLERANCE;
  const past = (c, e, forward) => (forward ? c > e : c < e);
  const behind = (e, forward) => (forward ? `< ${round(e)}` : `> ${round(e)}`);

  if (horizontal) {
    const forward = travelX >= 0;
    if (past(cp2.x, end.x, forward)) {
      return error({
        check: ID, code: 'curve-tangent-not-aligned', ...at,
        message: 'Second control point lies past the arrow tip, so the end tangent points back along the connector',
        repair: { attribute: 'd', actual: round(cp2.x), expected: behind(end.x, forward), hint: 'the last control point must lie behind the tip along the travel direction' },
      });
    }
    if (!diagonal && Math.abs(cp2.y - end.y) > TANGENT_TOLERANCE) {
      return error({
        check: ID, code: 'curve-tangent-not-aligned', ...at,
        message: 'A horizontal arrow needs cp2.y to match the endpoint y so the arrowhead stays level',
        repair: { attribute: 'd', actual: round(cp2.y), expected: round(end.y), hint: 'set the second control point y equal to the endpoint y' },
      });
    }
    return null;
  }

  const forward = travelY >= 0;
  if (past(cp2.y, end.y, forward)) {
    return error({
      check: ID, code: 'curve-tangent-not-aligned', ...at,
      message: 'Second control point lies past the arrow tip, so the end tangent points back along the connector',
      repair: { attribute: 'd', actual: round(cp2.y), expected: behind(end.y, forward), hint: 'the last control point must lie behind the tip along the travel direction' },
    });
  }
  if (!diagonal && Math.abs(cp2.x - end.x) > TANGENT_TOLERANCE) {
    return error({
      check: ID, code: 'curve-tangent-not-aligned', ...at,
      message: 'A vertical arrow needs cp2.x to match the endpoint x so the arrowhead stays plumb',
      repair: { attribute: 'd', actual: round(cp2.x), expected: round(end.x), hint: 'set the second control point x equal to the endpoint x' },
    });
  }
  return null;
}
