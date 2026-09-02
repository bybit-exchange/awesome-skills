// tools/svg-lint/lib/checks/arrow-marker.mjs
// The size table in SKILL.md "Arrows on thick lines" is the sole reference for this file.
// refX varies with marker size (8→2, 12→3, 16→4); hard-coding 2 causes false positives on
// the large arrowheads used with thick lines.
import { error, warning } from '../report.mjs';
import { pointToBBoxDistance, pointInBBox, directionAtEnd } from '../geometry.mjs';
import { panelRects } from '../panels.mjs';

const ID = 'arrow-marker';

export const MARKER_SPECS = [
  { maxStrokeWidth: 1.5, size: 8, refX: 2, refY: 4, tip: 6, endOffset: 11 },
  { maxStrokeWidth: 2.5, size: 12, refX: 3, refY: 6, tip: 9, endOffset: 14 },
  { maxStrokeWidth: Infinity, size: 16, refX: 4, refY: 8, tip: 12, endOffset: 17 },
];

const SPEC_BY_SIZE = new Map(MARKER_SPECS.map((s) => [s.size, s]));
const START_CLEARANCE = 5;
const TIP_CLEARANCE = 5;
const CLEARANCE_TOLERANCE = 1;
// Beyond this distance the line is considered not to connect that box, and no clearance check
// is performed. Increasing it causes annotated or separator paths that never connect to any
// box to be checked for clearance as well, producing nonsensical suggestions.
const ENDPOINT_SEARCH_RADIUS = 40;

const NOT_DECLARED = '(not declared)';

// Only **measured** values (the two-end clearances) are rounded. Values the author wrote in
// attributes are echoed back verbatim: if `stroke-width="2.05"` is reported as 2.1, the
// reader cannot find that number in the file and it becomes harder to reconcile. Same policy:
// see how `title-not-centered` in block-spacing.mjs echoes `doc.title.x` unchanged.
const round = (v) => Number(v.toFixed(1));

// When an attribute is absent, the literal `null` must not appear in the report: the CLI
// would display it as `markerUnits: null → userSpaceOnUse`, which reads as if the author
// wrote `markerUnits="null"`, when what is actually needed is to add the attribute.
const declared = (v) => (v === null || v === undefined ? NOT_DECLARED : String(v));

const specForStroke = (strokeWidth) => MARKER_SPECS.find((s) => strokeWidth <= s.maxStrokeWidth);

// Which box an endpoint moves *toward* is a better indicator of which box it connects to
// than which box it is *nearest*: house-style connectors leave one edge perpendicularly and
// enter another perpendicularly, so the direction is the last-segment direction (SKILL.md:206).
// The criterion is a directional derivative: move the endpoint 1px along its travel direction;
// the distance to the box must decrease.
//
// If ownership were claimed purely by "nearest within search radius", an annotation line
// placed at the house-style block spacing (25–30px, SKILL.md:281–282) below a box would have
// both endpoints claimed by the box above, producing two false-positive `25 → 5` findings —
// and since the CLI acceptance bar is 0 errors and 0 warnings, a single such finding would
// fail a fully compliant diagram. Measured: gaps 20–40 all trigger, 41 onward is clean —
// meaning the house-style spacing falls squarely in the false-positive zone; dashed group
// boxes are much larger than solid content boxes, so diagrams that hit them would be even worse.
//
// Trade-off (accepted): the gate discards **all non-approaching** shapes, not just the
// "parallel" case — a curve whose last-segment tangent points away from the target box
// (`M117,60 C 160,60 160,180 129,180` paired with a box on the right) is silenced entirely.
// These shapes are not house-style connectors (house-style lines enter and leave edges
// perpendicularly), and the detour amounts in the original finding's hint would not match
// this geometry anyway, making the suggestion impossible to act on — so silence is one step
// less bad than a wrong suggestion.
//
// Step size is 1px: as long as it is smaller than the shortest edge of any box, the approach
// determination is independent of step size (the shortest edge in house style is the 36px
// height of a single-row box, SKILL.md:134). If the step size is changed, this premise must
// be re-checked.
const approaches = (point, step, bbox) => pointToBBoxDistance(
  { x: point.x + step.x, y: point.y + step.y }, bbox,
) < pointToBBoxDistance(point, bbox);

// Strictly inside the box. `pointInBBox` uses ≤ (geometry.mjs:154–156); using it for group
// boxes would treat "exactly on the boundary" as "inside" and skip the whole box, causing a
// genuine 0px clearance to be dropped while the 15px clearance to the content box inside the group is
// reported instead — inconsistent with what the author sees in the diagram.
const strictlyInside = (p, b) => p.x > b.minX && p.x < b.maxX && p.y > b.minY && p.y < b.maxY;

// Both callers first pick a sample point that does **not** coincide with the endpoint before
// calling here, so there is no need to guard against zero length again.
const unitStep = (from, to) => {
  const len = Math.hypot(to.x - from.x, to.y - from.y);
  return { x: (to.x - from.x) / len, y: (to.y - from.y) / len };
};

// Direction sampling must skip points that coincide with the endpoint: curve sample points
// are not deduplicated (geometry.mjs:97-101), and a degenerate cubic
// (`M117,80 C117,80 117,80 117,80`) produces 17 identical points, so taking the adjacent
// one would return the same coordinate. No non-coincident point on the entire path means a
// zero-length path with no direction; return null: it can neither determine which box it
// connects to nor has a visible line to adjust. Passing NaN is not equivalent to silence —
// the shortcut below that treats "endpoint inside a solid content box as 0" ignores direction and
// would fabricate a `0 → 5` finding.
function outwardStepAtStart(pts) {
  const start = pts[0];
  const next = pts.find((p) => p.x !== start.x || p.y !== start.y);
  return next ? unitStep(next, start) : null;
}

// Where the painted arrowhead's tip lands. The head is rotated by `orient="auto"`, which uses
// the path's tangent at its end point — for a cubic, the direction from cp2 to the end point,
// which is what `directionAtEnd` returns. The last chord of the flattened polyline is a
// different direction: on a wide, shallow curve (420px across against 43px tall) it is tens of
// degrees off the tangent, and a tip advanced along it lands where no arrowhead was drawn, so a
// drawing at the house 5px clearance measures over the tolerance and is reported. For a straight
// segment `directionAtEnd` returns the segment itself, which is the last chord, so polyline
// connectors keep the verdicts they had.
//
// The walk runs backwards over the segments rather than reading only the last one: a trailing
// zero-length segment has no direction of its own, and the head is then painted along the
// direction of what precedes it. It is not confined to the last subpath, so a `d` that ends with
// a degenerate subpath borrows a direction from the previous stroke — the same borrowing the
// polyline walk did before, on a shape the house style does not draw. When no segment has a
// direction the path draws nothing, there is no head on screen and no tip to measure — return
// null rather than a NaN direction, which would still reach the "endpoint inside a solid content box"
// shortcut and invent a 0px clearance. No point-count guard is needed at the call site for the
// same reason: an empty segment list is the only way to get an empty point array, and the loop
// below never reads the endpoint in that case.
//
// Known limit, inherited rather than introduced: `directionAtEnd` reads cp2 as coincident with
// the end point when it is within half a pixel of it, and then takes the tangent from cp1
// instead, which for a curve that whips into its endpoint points sideways. See the Known limits
// section of the README; the polyline walk was wrong across that whole family, this is wrong only
// in the last half pixel of it.
function tipAt(segments, end, advance) {
  for (let i = segments.length - 1; i >= 0; i -= 1) {
    const direction = directionAtEnd(segments[i]);
    if (!direction) continue;
    const step = unitStep(direction.start, direction.end);
    return { point: { x: end.x + step.x * advance, y: end.y + step.y * advance }, step };
  }
  return null;
}

export const arrowMarker = {
  id: ID,
  title: 'Arrow markers follow the size table and leave 5px at both ends',
  run(doc) {
    const out = [];

    // The boxes measured for clearance at both ends must include dashed grouping boxes:
    // SKILL.md:127 explicitly allows "when an arrow points to a group of elements, it
    // terminates at the grouping box boundary". Without grouping boxes, such paths would be
    // measured against the content box **inside** the grouping box (the house-style 15px inset,
    // see SKILL.md:118-124), causing a compliant diagram to receive a 20px false positive
    // whose repair tells the author to push the endpoint 15px further — which, if followed,
    // would cross the dashed boundary into the inset gap.
    //
    // The meaning of "inside" is opposite for the two box types, so they are handled
    // oppositely: an endpoint inside a solid content box means the arrow is embedded in the
    // target — distance 0 is the conclusion; a grouping box's purpose is to enclose its
    // members entirely (SKILL.md:118-124), so an endpoint inside it is normal, not an
    // error — if it were treated unconditionally, every connector between members inside
    // the box would be measured as 0px at both ends, and a compliant diagram would receive
    // two `d: 0 → 5` findings with no actionable direction.
    //
    // Known trade-off (accepted): if the tip is 10px from the target box (reportable) but
    // is also exactly 5px from a narrow dashed annotation box in the same direction, taking
    // the minimum makes it clean — a false negative, which is one step less bad than a
    // false positive.
    // A solid outer box (a card, a container) encloses the diagram content rather than being a
    // peer of it, so it is grouped with the dashed grouping boxes rather than with the boxes a
    // connector joins. Without this, a connector between two members of a card has both of its
    // endpoints inside the card and is reported at 0px at both ends, while the boxes it actually
    // joins are the house-style 5px away — a compliant diagram receiving two findings whose
    // repair hints cannot be acted on. Which boxes count as panels is decided in panels.mjs, so
    // that this check and the others cannot drift apart on the definition.
    const panels = panelRects(doc);
    const memberRects = doc.contentRects.filter((r) => !panels.has(r));
    const enclosingRects = [...doc.groupRects, ...doc.contentRects.filter((r) => panels.has(r))];

    const clearanceFrom = (point, step) => {
      let best = Infinity;
      for (const rect of memberRects) {
        if (pointInBBox(point, rect.bbox)) return 0;
        if (!approaches(point, step, rect.bbox)) continue;
        best = Math.min(best, pointToBBoxDistance(point, rect.bbox));
      }
      for (const rect of enclosingRects) {
        if (strictlyInside(point, rect.bbox)) continue;
        // Exactly on the grouping box boundary is 0px clearance, which should be reported per
        // SKILL.md:127. This case must be let through explicitly: the distance is already 0,
        // advancing further cannot make it smaller, so handing it to the directional gate
        // would swallow it entirely and report the inner content box's 15px instead —
        // inconsistent with what the author sees in the diagram.
        const distance = pointToBBoxDistance(point, rect.bbox);
        if (distance === 0) return 0;
        if (!approaches(point, step, rect.bbox)) continue;
        best = Math.min(best, distance);
      }
      return best;
    };

    for (const marker of doc.markers.values()) {
      const at = { line: marker.line, column: marker.column };
      if (marker.markerUnits !== 'userSpaceOnUse') {
        out.push(error({
          check: ID, code: 'marker-units-missing', ...at,
          message: `Marker "${marker.id}" does not declare markerUnits="userSpaceOnUse"`,
          repair: {
            attribute: 'markerUnits',
            actual: declared(marker.markerUnits),
            expected: 'userSpaceOnUse',
            hint: 'the default scales the arrowhead with stroke-width, doubling it at stroke-width=2',
          },
        }));
      }
      if (marker.orient !== 'auto') {
        out.push(error({
          check: ID, code: 'marker-orient-missing', ...at,
          message: `Marker "${marker.id}" does not declare orient="auto"`,
          repair: { attribute: 'orient', actual: declared(marker.orient), expected: 'auto', hint: 'without it the arrowhead ignores the path direction' },
        }));
      }

      const spec = SPEC_BY_SIZE.get(marker.markerWidth);
      if (!spec) {
        // "Not declared at all" and "declared with a non-house-style value" are two different
        // things and need separate wording: `is nullpx wide` would send the author looking
        // for a value they never wrote. The SVG default for markerWidth is 3, so treating
        // an absent attribute as off-spec is correct — only the wording needs to differ.
        const width = marker.markerWidth === null
          ? 'does not declare markerWidth'
          : `is ${marker.markerWidth}px wide`;
        out.push(warning({
          check: ID, code: 'marker-size-off-spec', ...at,
          message: `Marker "${marker.id}" ${width}; the house sizes are 8, 12 and 16`,
          repair: { attribute: 'markerWidth', actual: declared(marker.markerWidth), expected: '8 | 12 | 16', hint: null },
        }));
        continue;
      }
      if (marker.markerHeight !== spec.size) {
        out.push(warning({
          check: ID, code: 'marker-not-square', ...at,
          message: `Marker "${marker.id}" is ${marker.markerWidth}×${declared(marker.markerHeight)}; house markers are square`,
          repair: { attribute: 'markerHeight', actual: declared(marker.markerHeight), expected: String(spec.size), hint: null },
        }));
      }
      if (marker.refX !== spec.refX) {
        out.push(error({
          check: ID, code: 'marker-refx-mismatch', ...at,
          message: `Marker "${marker.id}" at ${spec.size}×${spec.size} needs refX="${spec.refX}"`,
          repair: { attribute: 'refX', actual: declared(marker.refX), expected: String(spec.refX), hint: 'refX aligns the line end with the centre of the tail notch' },
        }));
      }
      if (marker.refY !== spec.refY) {
        out.push(error({
          check: ID, code: 'marker-refy-mismatch', ...at,
          message: `Marker "${marker.id}" at ${spec.size}×${spec.size} needs refY="${spec.refY}"`,
          repair: { attribute: 'refY', actual: declared(marker.refY), expected: String(spec.refY), hint: 'refY = marker height / 2' },
        }));
      }
    }

    for (const path of doc.paths) {
      const at = { line: path.line, column: path.column };
      for (const [attribute, id] of [['marker-end', path.markerEnd], ['marker-start', path.markerStart]]) {
        if (id && !doc.markers.has(id)) {
          out.push(error({
            check: ID, code: 'marker-reference-dangling', ...at,
            message: `${attribute} references "#${id}", which is not defined`,
            repair: { attribute, actual: `url(#${id})`, expected: 'a marker defined in <defs>', hint: null },
          }));
        }
      }

      // A path with no marker-end and a path that references a non-existent marker share the
      // same exit: in both cases this get returns undefined, the tip-advance distance required
      // for clearance checking is unavailable, and the check cannot proceed.
      //
      // Therefore **paths that only have marker-start are skipped entirely** — this is a
      // declared unsupported shape, not an oversight: marker-end appears 12 times in SKILL.md
      // and marker-start not once; the house-style way to draw a reversed arrow is to reverse
      // the `d` attribute (the Leftward / Upward examples at SKILL.md:253 / :261 / :270), and
      // since marker-end in SVG always falls on the final point, geometry and rendering are
      // consistent and clearance at both ends can still be measured correctly.
      // The trade-off is that the non-house-style pattern of attaching a marker-start 5px from
      // the start point is silently ignored (the arrowhead extends 6px backward, actually
      // pressing 1px into the box). The marker-reference-dangling block above still checks both
      // attributes — referencing a non-existent marker is a typo, unrelated to which drawing
      // convention is used.
      const marker = doc.markers.get(path.markerEnd);
      if (!marker) continue;

      // `stroke-width="2px"` / `"inherit"` are valid SVG, but the `strokeWidth` key in document.mjs parses with
      // Number(), which produces NaN, causing the spec-table find to match nothing. Without
      // this guard, reading undefined.size would throw, which lint.mjs catches as a
      // check-crashed error: the entire arrow check produces no findings for this file, and
      // the one error that does appear gives the author nothing to act on. The attribute
      // itself is already reported by document-model/non-numeric-attribute; here we simply
      // do not guess what size arrowhead it should have.
      const required = specForStroke(path.strokeWidth);
      if (required && marker.markerWidth !== null && marker.markerWidth < required.size) {
        out.push(error({
          check: ID, code: 'marker-too-small-for-stroke', ...at,
          message: `stroke-width ${path.strokeWidth} needs a ${required.size}×${required.size} marker, not ${marker.markerWidth}×${marker.markerWidth}`,
          repair: {
            attribute: 'marker-end',
            actual: String(marker.markerWidth),
            expected: String(required.size),
            // The size is described in terms of the arrowhead that is actually drawn.
            // Hard-coding 8×8 would contradict the `not 12×12` in the same finding's message
            // when a stroke-width 3 path uses a 12×12 marker, making the reader think the
            // tool computed incorrectly. The plural form avoids article choice: the size is
            // a variable, and `an 8×8` versus `a 12×12` would each be wrong half the time.
            hint: `${marker.markerWidth}×${marker.markerWidth} arrowheads look too small at stroke-width ${path.strokeWidth}`,
          },
        }));
      }

      // spec is taken from the marker's actual size, not the size the stroke requires: when a
      // thick line has a small arrowhead, the tip-advance distance must be calculated from the
      // arrowhead that is drawn, otherwise the positions are wrong and two findings contradict
      // each other.
      //
      // When the size is not in the house-style table, **the two-end clearance check is
      // skipped**. The internal geometry of a non-house-style arrowhead is unknown, so the
      // tip-advance can only be guessed; falling back to the tier the stroke requires means
      // computing positions from an arrowhead that does not exist in the diagram, so the
      // actual and hint detour amounts are fabricated numbers (a 10×10 arrowhead receiving a
      // "∓ 11" suggestion that would make it worse). False positives are the worst failure
      // mode for this tool, so a false negative here is preferable: the author already has a
      // marker-size-off-spec finding to act on, and once the marker is changed to 8 / 12 / 16
      // the clearance will be checked.
      const spec = SPEC_BY_SIZE.get(marker.markerWidth);
      if (!spec) continue;

      // Commands parsePath does not model (A / S / T) are marked unsupported and collapsed to
      // zero length, so the point array ends where the last modelled command ended, not where
      // the path ends on screen. Measuring a clearance from it reports a distance that is not
      // in the diagram: `M50,70 L200,70 A 30,30 0 0 1 260,70` with a box at x=230 measures
      // 24px from the collapsed end at 200 while the drawn path finishes 30px inside the box.
      // The two clearance measurements below are the only readers of the point array here, so
      // the guard sits in front of them and the marker and stroke-width judgments above — which
      // read attributes, not geometry — keep running. Same conclusion as subpathTraces in
      // overlap.mjs, reached the same way: the geometry is unreliable, so it is not judged.
      // The path is still named by the unsupported-path-command note in document.mjs, so the
      // author does not read "0 errors, 0 warnings" instead.
      if (path.segments.some((s) => s.unsupported)) continue;

      // Point count does not need to be guarded here: the parser records no points for an
      // isolated moveto (`d="M117,80"` leaves zero points), and both direction-finding
      // functions require "find a sample point that does not coincide with the endpoint" —
      // empty array, single point, and fully coincident cases each return null, so that side
      // is not checked.
      const pts = path.points;
      const startStep = outwardStepAtStart(pts);
      const source = startStep ? round(clearanceFrom(pts[0], startStep)) : Infinity;
      if (source <= ENDPOINT_SEARCH_RADIUS
        && Math.abs(source - START_CLEARANCE) > CLEARANCE_TOLERANCE) {
        out.push(warning({
          check: ID, code: 'arrow-start-clearance', ...at,
          message: `Path starts ${source}px from its source box; house style is ${START_CLEARANCE}px`,
          repair: {
            attribute: 'd',
            actual: String(source),
            expected: String(START_CLEARANCE),
            hint: 'start at source edge ± 5',
          },
        }));
      }

      const tip = tipAt(path.segments, pts.at(-1), spec.tip);
      const target = tip ? round(clearanceFrom(tip.point, tip.step)) : Infinity;
      if (target <= ENDPOINT_SEARCH_RADIUS
        && Math.abs(target - TIP_CLEARANCE) > CLEARANCE_TOLERANCE) {
        out.push(warning({
          check: ID, code: 'arrow-tip-clearance', ...at,
          message: `Arrow tip lands ${target}px from its target box; house style is ${TIP_CLEARANCE}px`,
          repair: {
            attribute: 'd',
            actual: String(target),
            expected: String(TIP_CLEARANCE),
            hint: `end the line at target edge ∓ ${spec.endOffset} so the tip stops 5px short`,
          },
        }));
      }
    }

    return out;
  },
};
