// tools/svg-lint/lib/checks/connector-geometry.mjs
// SKILL.md "Connector rules" — choosing a connector, and the cp2 table under "Fixing arrow
// direction on curved paths" — plus checklist items 4 and 7.
import { error } from '../report.mjs';
import {
  turnAngle, polylineLength, flattenPath, directionAtStart, directionAtEnd, samePoint,
  pointToBBoxDistance,
} from '../geometry.mjs';
import { effectiveFill } from '../document.mjs';

const ID = 'connector-geometry';
const TANGENT_TOLERANCE = 0.5;
const RIGHT_ANGLE_MIN = 60;
const MIN_VISIBLE_LENGTH = 6;
const AXIS_TOLERANCE = 0.5;
// How close an end point has to be to a box for the arrowhead to be arriving at that box. Same
// number and same reasoning as ENDPOINT_RADIUS in overlap.mjs: house-style connectors stop 5–11px
// short of the wall they connect to, so anything tighter reads a normal arrival as a landing on
// nothing — and a landing on nothing is what the self-return rule below reports.
//
// Not arrow-marker.mjs's 40, the other radius in the tool that pairs an end point with a box: that
// one is a search window for *measuring* clearance, and it says so by reporting every distance it
// finds, including the ones it then calls too large. This number has to answer "is this box the
// thing the author aimed at", which is the question overlap.mjs asks. 40px is also wider than the
// whole 25-30px channel the house rule leaves between two rows, so at that radius a tip in the channel
// belongs to the box behind it as readily as to the one it points at; 20px cannot reach both.
const ARRIVAL_RADIUS = 20;
// How far off its lifeline an endpoint may sit and still belong to it. SKILL.md gives the 5px
// connector clearance and the 6px an arrowhead adds beyond the line, and the sequence diagrams built
// on it leave a self-call's start 5px clear of the lifeline and end its *line* at lifeline + 11, so
// that the painted tip lands 5px out once the arrowhead has added its 6px — the two committed
// self-calls in gallery/03 both have their end point exactly 11px out. So a correctly drawn self-call
// never touches the line it returns to, and its chord is always slightly diagonal. Deciding
// membership with the half-pixel axis tolerance therefore matches only a self-call drawn wrong: it
// would guard the shape the house style forbids and leave the shape it prescribes — the shape the
// repair hint below asks for — unguarded.
//
// One pixel past the 11px those diagrams use, and no wider. What bounds it from above is that the
// band is also what keeps a curve near *some other* dashed line from being read as a self-message, so
// it must stay well inside the 25px minimum block spacing; the neighbouring lifeline is far away
// (228px in gallery/03), but a box's own connectors are not.
const LIFELINE_BAND = 12;

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

// Whether the stroke renders dashed, which is not the same as whether the attribute is present.
// `none`, an empty or blank value, an all-zero list and a list with a negative length all draw solid,
// and counting them would make an ordinary solid rule a lifeline and a connector landing on it a
// self-message — a finding on a diagram that has none. One test covers all four: at least one dash
// length, every length a plain non-negative number, and at least one longer than zero.
//
// "A plain number" is this tool's limit, not SVG's: `4px` and `2em` do render dashed, and a line
// declaring them is not recognised here. That is the units stance the whole tool takes (see
// NUMERIC_ATTRS in document.mjs, which notes such a value rather than reading it), and it errs toward
// not finding a lifeline, so the cost is a missed finding rather than an invented one.
//
// The rect flag in document.mjs is laxer — it asks only whether the attribute is present — but that
// flag decides which boxes group content, where the laxity changes no verdict. `dasharray` is a key
// on path entries only, so a shape entry is asked for its raw attribute, the same escape hatch
// baseline-offset uses for `text-anchor`.
const dashed = (entry) => {
  const declared = entry.dasharray ?? entry.element.attrs['stroke-dasharray'] ?? null;
  if (declared === null) return false;
  const lengths = declared.trim().split(/[\s,]+/).filter((t) => t !== '').map(Number);
  return lengths.length > 0
    && lengths.every((n) => Number.isFinite(n) && n >= 0)
    && lengths.some((n) => n > 0);
};

const markered = (entry) => entry.element.attrs['marker-end'] !== undefined
  || entry.element.attrs['marker-start'] !== undefined;

// The straight dashed lines of the diagram, each as the axis it runs along, the coordinate it holds
// and the span it covers — a sequence diagram's lifelines. Read from the bounding box rather than from
// the segments, because a straight axis-aligned run is exactly one whose box has no width or no
// height, and that single test covers both spellings the model records: a `<path>` (house style) and a
// `<line>`.
function dashedGuides(doc) {
  const guides = [];
  for (const entry of [...doc.paths, ...doc.others]) {
    if (!dashed(entry) || !entry.bbox) continue;
    // A lifeline carries no arrowhead. This is also what makes it impossible for a connector to be
    // its own guide — the only way that could arise, since the arm below runs solely for a path that
    // has a marker-end — so no separate identity test is needed.
    //
    // Read from the raw attributes, not from the `markerEnd` / `markerStart` keys: the model resolves
    // those for paths only, so a shape entry has neither, and asking for them would let a dashed
    // `<line marker-end="…">` pass as a lifeline while the identical `<path>` was excluded.
    if (markered(entry)) continue;
    const { minX, minY, maxX, maxY } = entry.bbox;
    if (maxX - minX <= AXIS_TOLERANCE && maxY - minY > AXIS_TOLERANCE) {
      guides.push({ vertical: true, at: (minX + maxX) / 2, from: minY, to: maxY });
    } else if (maxY - minY <= AXIS_TOLERANCE && maxX - minX > AXIS_TOLERANCE) {
      guides.push({ vertical: false, at: (minY + maxY) / 2, from: minX, to: maxX });
    }
  }
  return guides;
}

// Across the guide is the axis the arrowhead has to close over; along it is the axis it must not run
// down. For a vertical lifeline those are x and y respectively.
const across = (guide, p) => (guide.vertical ? p.x : p.y);
const along = (guide, p) => (guide.vertical ? p.y : p.x);
// Whether a point belongs to this guide: inside the clearance band across it, and level with the
// stretch it actually covers. The band is what makes a correctly clearance'd endpoint count (see
// LIFELINE_BAND); the extent is what stops a dashed line elsewhere on the same x from claiming a
// curve that never comes near it.
const onGuide = (guide, p) => Math.abs(across(guide, p) - guide.at) <= LIFELINE_BAND
  && along(guide, p) >= guide.from - AXIS_TOLERANCE
  && along(guide, p) <= guide.to + AXIS_TOLERANCE;

// A self-message and an obstacle detour are the same geometry: both leave a point, bulge off the
// axis and come back to a point directly below, so nothing in the `d` tells them apart. What differs
// is where the arrowhead lands. A detour arrives at a box, and pointing along the axis into that box
// is correct. A self-message arrives at its own participant's lifeline with no box there, so an
// arrowhead pointing along the lifeline names no target at all. Hence this consults the document:
// the message begins and ends beside one straight dashed line, and nothing is there to be arrived at.
//
// `from` is where the subpath started, not where the last curve did. A self-message drawn as two
// curves has its apex 35px off the lifeline, so reading the last curve's start asked whether the
// bulge belongs to the lifeline — and answered no, letting the two-curve spelling of the very defect
// this rule names go unreported while the one-curve spelling was caught.
function returnGuide(from, curve, guides, arrivesAtTarget) {
  // Only a curve carries a cp2 to aim, and the sibling rule below is scoped the same way; a straight
  // run down a lifeline has nothing to correct.
  if (curve.cmd !== 'C' && curve.cmd !== 'Q') return null;
  if (arrivesAtTarget(from, curve.end)) return null;
  return guides.find((g) => onGuide(g, curve.end) && onGuide(g, from)) ?? null;
}

export const connectorGeometry = {
  id: ID,
  title: 'Connectors curve smoothly and stay long enough to read',
  run(doc) {
    const out = [];
    const guides = dashedGuides(doc);
    // Of the rects, the solid content ones only — the set every other geometry check measures against
    // (overlap.mjs, box-height.mjs, text-overflow.mjs), which already excludes the background rect.
    // Area-bearing shapes join them further down. A
    // dashed grouping box must not count: it is a container a message runs *inside*, so a point
    // within it measures 0 and every self-message drawn inside an `alt` frame would go unjudged — the
    // shape this rule exists for. The cost is that a detour terminating on a dashed group wall is not
    // recognised as an arrival, and if such a detour is also collinear with a lifeline it draws this
    // finding; an arrowhead that points down a lifeline is worth a look either way. Known limits in
    // ../../README.md carries the reproducing shape.
    //
    // The box also has to be nearer the tip than the start, or it is not what the curve travelled to.
    // An activation bar straddles its own lifeline and runs the length of the self-message drawn
    // against it, so it is inside the arrival radius of both ends at once — and counting it made this
    // rule stand down and let the chord arm tell the author of a correct self-return to aim the
    // arrowhead down the lifeline, printing the original defect as the repair. A box a connector is
    // no closer to at its tip than where it set out from is one it ran alongside.
    //
    // The two distances are compared rather than each tested against the radius, because a flat 20px
    // on both ends reported a correct drawing: at the house minimum block spacing of 25px a connector
    // leaves its source 5px clear and its line ends 11px short of its destination, which puts that
    // destination 20px from the start as well, so no box qualified and a correct downward arrow beside
    // a dashed line drew this finding. Comparing distances keeps the bar out (equidistant, so not an
    // arrival) and lets the destination in. Equality has to fall on the not-an-arrival side: a bar the
    // message is drawn *inside* measures 0 from both ends.
    //
    // What the comparison costs is a silence, written up under Known limits in ../../README.md and
    // pinned by a test so it cannot widen unnoticed: a bar opened at the message start, or a nested
    // bar opened where it lands, is nearer the tip than the start, so it reads as an arrival and the
    // defect this whole arm exists for goes unreported next to one. Narrowing that would mean telling
    // an activation bar from a destination box by its width, a threshold no house rule states.
    //
    // The point read is where the subpath began, not the last curve's start: a detour written as
    // several curves leaves the box it came from at its first point, and the apex of its bulge is not
    // a place it ever departed from.
    //
    // `<circle>`, `<ellipse>`, `<polygon>` and `<polyline>` are arrival targets too. They are drawn
    // content a connector can point at, and leaving them out reported a correct arrow that stops the
    // house 11px short of a circle beside a dashed line — the same harmful shape as the activation
    // bar. Only shapes with an area count: a straight `<line>` has none, and admitting it would make
    // every lifeline an arrival target 0px from the tip, which silences this arm outright.
    //
    // A *solid content rect* whose geometry the model could not read (`width="180px"` is valid SVG that
    // reads as NaN) stops the arrowhead judgment for every connector in the file, below: the boxes cannot be
    // placed, so no arrival can be ruled in or out, and both arms would then be judging a shape from
    // coordinates they do not have. Nulling the guide alone is not enough — that hands the curve to the
    // chord arm, which asks a self-return's cp2 to match a chord that runs along the lifeline and so
    // prints the very defect this check exists to catch as its repair. What makes silence affordable is
    // that document.mjs reports the attribute, so the file cannot pass as clean while carrying it.
    // readableBox in overlap.mjs declines the same way and for the same reason; endsNear in that file
    // goes the other way, but it is an exemption, so failing open there means reporting.
    //
    // A dashed grouping rect is not in this set, so an unreadable one does not withdraw anything; nor
    // does a rect missing `width` outright, which document.mjs reads as 0 and this rule then drops for
    // having no area.
    //
    // An unreadable *shape* gets the opposite stance, because that argument does not hold for it:
    // NUMERIC_ATTRS covers a rect's width and height but not a circle's `r`, so `r="19px"` draws no
    // note anywhere and the file lints 0/0. Silence would then be invisible — the defect this arm names
    // went unreported next to one with nothing in the output to say why. So an unreadable shape is
    // simply not an arrival target. That is not a free win, and the trade is recorded under Known
    // limits in ../../README.md: it swaps an invisible silence for an invisible false positive, because
    // an arrow that legitimately stops short of a circle written `r="19px"` is now read as a
    // self-message with nothing in the output to explain it. It is the better half of the trade only
    // because a defect that no output mentions cannot be found at all, while a finding can at least be
    // argued with. Widening NUMERIC_ATTRS to cover shape attributes removes the asymmetry outright and
    // belongs in its own change, since every check reads that list.
    const readable = (b) => [b.minX, b.minY, b.maxX, b.maxY].every(Number.isFinite);
    // AXIS_TOLERANCE is reused here as a minimum extent rather than as an off-axis tolerance: the two
    // questions are different, but the answer to both is "half a pixel is not a difference", and a
    // second constant with the same value would drift from this one for no gain.
    const hasArea = (b) => b.maxX - b.minX > AXIS_TOLERANCE && b.maxY - b.minY > AXIS_TOLERANCE;
    const near = (p, b) => pointToBBoxDistance(p, b) <= ARRIVAL_RADIUS;
    const rects = doc.contentRects.map((r) => r.bbox);
    const unplaceable = rects.some((b) => !readable(b));
    // Rects and shapes are filtered alike: a rect 200px wide and 0px tall paints what a `<line>`
    // paints, so admitting one and not the other would decide a diagram by which element spelled it.
    // hasArea is also what keeps unreadable geometry out, since every comparison against NaN is false;
    // a separate readable() term here was checked against the suite and could not be made to bite.
    const targets = [...rects, ...doc.others.map((o) => o.bbox).filter(Boolean)].filter(hasArea);
    const arrivesAtTarget = (from, end) => targets.some((b) => near(end, b)
      && pointToBBoxDistance(end, b) < pointToBBoxDistance(from, b));

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

      // `unplaceable` withdraws both arms rather than only the lifeline: see the note above the
      // arrival helpers for why half a withdrawal is worse than none.
      if (path.markerEnd && !unplaceable) {
        const last = segments.at(-1);
        // A self-return is handed to tangentProblem as well, with the lifeline as its axis: only the
        // perpendicular arm of that function disagrees with parallelReturn about this shape, and the
        // past-the-tip arm is as true of a self-message as of any other arrow. Still at most one
        // finding, because a curve whose cp2 lies past its own tip has no useful second sentence.
        const guide = returnGuide(runs.at(-1)[0].start, last, guides, arrivesAtTarget);
        const finding = tangentProblem(last, at, guide)
          ?? (guide ? parallelReturn(last, guide, at) : null);
        if (finding) out.push(finding);
      }
    }

    return out;
  },
};

// A self-message has to arrive at its participant, so its closing tangent must cross the lifeline
// rather than run down it. This is the one shape whose axis cannot come from the chord the way
// tangentProblem takes it: the chord of a self-return lies along the lifeline, so a rule reading the
// chord asks for exactly the tangent that is wrong here — which is how the shape below shipped in
// gallery/03. The axis comes from the lifeline instead, and the sub-pixel guard the chord arm needs
// (samePoint) is not repeated: a loop returning to its own start still points somewhere, and against
// a lifeline that direction can be judged.
function parallelReturn(curve, guide, at) {
  const tangent = directionAtEnd(curve);
  // A curve whose every point sits on its end point arrives in no direction, so there is no
  // arrowhead angle to judge — the same answer directionAtEnd gives the corner rule.
  if (tangent === null) return null;
  // How far the closing tangent moves across the lifeline. The repair quotes this rather than cp2's
  // coordinate so that the pair actually fails: with a tolerance in play, a cp2 a third of a pixel
  // off the endpoint is a defect whose coordinate already satisfies "different from the endpoint",
  // and a receipt whose expected is true of its actual tells the author to change nothing.
  const crossing = Math.abs(across(guide, tangent.end) - across(guide, tangent.start));
  // An absolute distance rather than an angle, matching the exact-match convention of the sibling arm:
  // it is the width of the cp2 arm's projection, so a tangent a few degrees off the lifeline over a
  // long arm passes. That is the same trade the four rows of SKILL.md's cp2 table make — they compare
  // coordinates, not angles — and it errs toward silence.
  if (crossing > TANGENT_TOLERANCE) return null;
  const off = guide.vertical ? 'x' : 'y';
  const level = guide.vertical ? 'y' : 'x';
  return error({
    check: ID, code: 'self-return-tangent-parallel', ...at,
    message: `A self-message closes only ${round(crossing)}px across the lifeline it returns to, so the arrowhead points along that lifeline rather than into the participant`,
    repair: {
      attribute: 'd',
      actual: round(crossing),
      expected: `> ${TANGENT_TOLERANCE}`,
      hint: `move the second control point ${off} clear of the endpoint ${off} — house style puts it at the far side of the bulge — and set its ${level} equal to the endpoint ${level} so the head closes level, pointing into the lifeline`,
    },
  });
}

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
//
// `guide` is the lifeline a self-return comes back to, or null for every other arrow. It changes two
// things: which axis "past the tip" is measured along (the chord of a self-return runs down the
// lifeline, so the two agree, but the guide says so directly instead of inferring it from a chord
// whose other component is only nearly zero), and it withdraws the perpendicular arms, which are
// parallelReturn's to make for that shape and reach the opposite verdict.
function tangentProblem(curve, at, guide = null) {
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
  const horizontal = guide ? !guide.vertical : Math.abs(travelX) >= Math.abs(travelY);
  // With both components non-zero there is no axis for the perpendicular component to be 0 in, so
  // only the direction agreement below is asked of a segment travelling diagonally. A self-return is
  // excused those arms for the other reason given above; the effect at these two sites is the same.
  const diagonal = guide !== null
    || (Math.abs(travelX) > AXIS_TOLERANCE && Math.abs(travelY) > AXIS_TOLERANCE);
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
