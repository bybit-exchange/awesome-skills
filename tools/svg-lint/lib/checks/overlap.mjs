// tools/svg-lint/lib/checks/overlap.mjs
// SKILL.md "No overlapping elements" + "Routing around obstacles" + "Placing labels on curves".
// The three thresholds are distinct; do not merge them: text-to-line 10px, curve label 15px,
// detour from obstacle 20px.
import { error, warning } from '../report.mjs';
import { panelRects } from '../panels.mjs';
import {
  bboxIntersects, bboxToPolylineDistance, pointToBBoxDistance, pointInBBox, flattenPath,
} from '../geometry.mjs';

const ID = 'overlap';
const TEXT_LINE_CLEARANCE = 10;
const CURVE_LABEL_CLEARANCE = 15;
const DETOUR_CLEARANCE = 20;

// A connector that terminates near a box is connecting that box, not detouring past it —
// so that box is excluded from the detour clearance check. The radius is set to the same
// value as DETOUR_CLEARANCE: in hand-drawn diagrams connector endpoints often leave a few
// pixels of clearance from the box edge (house style arrow clearance is 5–11px), and within
// 20px the distance cannot be a "detour past" distance. A smaller radius would cause a
// normal connector with a clearance of ten-odd pixels to be flagged as "too close to the box
// it connects to" — a false positive that would appear in every diagram.
const ENDPOINT_RADIUS = DETOUR_CLEARANCE;

// bboxToPolylineDistance counts tangency as 0, so a connector whose y equals a label's bbox top or
// bottom edge measures as sitting on the label. textBBox puts minY at `y - ASCENT_RATIO × font-size`,
// and a card title is positioned by that same arithmetic: the CARD source in overlap.test.mjs has a
// title baseline of 57.5 at font-size 10, giving bbox minY 50 — which is also the y of the card rect
// whose wall a connector is snapped to. The on-connector question is therefore measured against a
// bbox pulled in by TANGENCY_EPSILON at top and bottom, so exact tangency does not count as touching
// while a connector 0.5px inside the glyph box still does.
//
// Only minY and maxY move. A connector whose x equals a label's left or right edge keeps measuring 0
// and is still reported as sitting on the label.
const TANGENCY_EPSILON = 0.01;
const withoutEdges = (bbox) => ({ ...bbox, minY: bbox.minY + TANGENCY_EPSILON, maxY: bbox.maxY - TANGENCY_EPSILON });

// Curvature is measured per **subpath**, not per whole path: clearance is already measured
// per subpath, so measuring curvature across the whole path would cause a straight subpath
// that is closest to the label to be judged against the 15px curve threshold when the same d
// also contains a curved subpath, and the message would say "from a curve" — a false
// positive whose receipt does not match the diagram.
const hasCurve = (segments) => segments.some((s) => s.cmd === 'C' || s.cmd === 'Q');

// This check is the only place in the repository that inserts author text into a message, so
// normalisation can only happen here. Three things: ① the content of a `<text>` with tspan
// children contains newlines and indentation; inserting it verbatim would split the
// "one finding per line" output of format-text into several lines; ② a long label pushes
// that line very wide, so it is truncated by display columns (see MAX_COLUMNS); ③ JSON.stringify
// adds quotes, and a label that contains its own quotes (`say "hi" now`) gets them escaped to
// `\"` so the reader can tell where the label boundary is — the cost is that backslashes are
// also doubled (`C:\a` prints as `C:\\a`), which is unavoidable when escaping quotes.
//
// The budget is in **display columns**, not character count: East Asian wide characters and
// emoji each occupy two columns in a terminal, so 40 Chinese characters is 80 columns; with
// a line/column prefix and a `[check/code]` suffix the whole line reaches about 150 columns
// and still wraps on an 80/120-column terminal — which is exactly what ① guards against, and
// house-style diagram labels are predominantly Chinese.
const MAX_COLUMNS = 40;
// The Miscellaneous Symbols and Arrows blocks (U+2600-27BF containing check marks / crosses /
// warning signs, and U+2B00-2BFF arrows) contain a mix of wide and narrow characters:
// `✅` (U+2705) is an emoji and occupies two columns, while `✓` (U+2713) has East Asian
// Width N and occupies only one. The whole range is counted as 2 because over-counting only
// causes truncation one column sooner, whereas under-counting causes a line to wrap — and
// not wrapping is the whole point of this budget. This is not a complete East Asian Width
// table; it only covers the ranges that appear in diagrams.
// No astral ranges here, and adding them would change no answer: ① below already gives any
// astral character at least 2, because it escapes to two UTF-16 code units. Swept both of the
// ranges this used to carry — U+1F000-1FAFF and U+20000-3FFFD, 133,886 code points — and
// columnsOf returns the same number for every one of them with the ranges absent.
const WIDE = /[\u1100-\u115F\u2600-\u27BF\u2B00-\u2BFF\u2E80-\u303E\u3041-\u33FF\u3400-\u4DBF\u4E00-\u9FFF\uA000-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6]/u;
// Width has only two sources, and the larger of the two is taken:
//   ① the length of the escaped form the receipt prints, in UTF-16 code units
//      (`JSON.stringify(ch).length - 2`): an ASCII character needing no escape gives 1, a quote or a
//      backslash gives 2, and a character JSON escapes to the `\uXXXX` form — a lone surrogate, or a
//      control character with no short escape such as U+0001 — gives 6. Code units, not printed
//      cells: an astral character that escapes to itself gives 2 for one cell (U+1D400 measured);
//   ② 2 for a character that falls in WIDE.
// The larger, rather than one or the other: `中` escapes to a single code unit but draws two columns,
// so ② speaks for it, while a quote is outside WIDE but escapes to two code units, so ① speaks.
// Variation selectors and zero-width characters get no tier of their own any more: they escape to
// themselves, so ① gives them 1 column (U+FE0F, U+200B and U+00AD measured; U+3164 lands in WIDE and
// gets 2). For the ones a terminal draws nothing for that is an over-count, and over-counting
// truncates a cell early instead of letting a line wrap — the direction this budget wants. Modelling
// their width exactly is what kept carrying a fresh arithmetic defect back into this function: three
// successive attempts to make the model more precise each introduced one.
const columnsOf = (ch) => Math.max(JSON.stringify(ch).length - 2, WIDE.test(ch) ? 2 : 1);

// Serves the single decision "is any visible content left after collapsing" and takes no part in the
// width arithmetic. A label made only of invisible characters (mostly from copy-paste) survives the
// `\s+` collapsing below, yet prints as a pair of apparently-empty quotes on the receipt, with which
// the author can search for nothing. Collapsing such characters as whitespace instead is not an
// option: U+200D is the zero-width joiner used in emoji and Persian, and folding it rewrites the
// author's text. U+FEFF is the one member that does not survive the collapsing — `\s` matches it
// (measured) — and is listed here for the reader rather than because this regex can be reached by it.
const INVISIBLE = /^[\s\u00AD\u200B-\u200F\u2060-\u206F\u3164\uFEFF\uFE00-\uFE0F]*$/u;

const quote = (content) => {
  const flat = content.replace(/\s+/g, ' ').trim();
  // An empty label is not written as `Label ""` — the empty quotes suggest the tool failed to
  // retrieve the text, and the author cannot search for anything.
  if (INVISIBLE.test(flat)) return '(no text)';
  const chars = [...flat];
  if (chars.reduce((n, ch) => n + columnsOf(ch), 0) <= MAX_COLUMNS) return JSON.stringify(flat);
  // Truncation proceeds by code point, so it cannot cut a surrogate pair in half; it is **not**
  // grapheme-cluster aware, so an emoji sequence can still be cut open, leaving a dangling joiner or
  // selector at the end. A known trade-off: house-style labels do not carry emoji.
  let used = 0;
  const kept = [];
  for (const ch of chars) {
    const w = columnsOf(ch);
    if (used + w > MAX_COLUMNS - 1) break; // reserve one column for `…`
    used += w;
    kept.push(ch);
  }
  return JSON.stringify(`${kept.join('')}…`);
};

// A `<path>` d attribute may contain multiple subpaths; flattenPath compresses them into a
// single point array, turning the jump introduced by each `M` into a line segment that does
// not exist on screen. Measuring against that would produce a spurious "connector passes
// through a box" finding that the author cannot fix by detouring. The subpaths are split on
// "does the next segment's start follow the previous segment's end", and each subpath is
// measured independently with its own endpoints.
function subpathTraces(path) {
  // Commands that parsePath does not model (A / S / T) are marked unsupported and collapsed
  // to zero length; the remaining points cannot form the actual path: an arc that genuinely
  // passes through a box would become invisible (false negative), and the straight segment
  // left after collapsing might pass through a box the original never crossed (false positive).
  // The whole path is skipped; no guess is made in either direction. The unreliability of the
  // geometry is surfaced by the unsupported-path-command note in document.mjs, so the author does
  // not just see "0 errors, 0 warnings". Two other checks meet such a path and neither skips all of
  // it: arrow-marker skips its two clearance measurements and goes on judging the marker attributes,
  // and connector-geometry drops the unsupported segments and judges what is left.
  if (path.segments.some((s) => s.unsupported)) return [];
  const runs = [];
  let run = [];
  for (const s of path.segments) {
    const prev = run.at(-1);
    if (prev && (s.start.x !== prev.end.x || s.start.y !== prev.end.y)) {
      runs.push(run);
      run = [];
    }
    run.push(s);
  }
  if (run.length) runs.push(run);
  // Subpaths that reduce to a single point (a zero-length segment like `M100,58 L 100,58`
  // after flattenPath deduplication) are not filtered out: bboxToPolylineDistance returns
  // Infinity for a single-point polyline, so neither check criterion is met, which is the
  // same result as filtering it out here. Adding a filter would suggest that omitting it
  // causes an error.
  return runs.map((r) => ({ points: flattenPath(r), curved: hasCurve(r) }));
}

// A clearance of 0 means the connector actually enters the box. At this threshold "it connects
// this box" only means an endpoint lies inside the box (landing exactly on the boundary also
// counts). Using the 20px endpoint radius at this threshold as well would let house-style
// numbers pass through: minimum block spacing 25px + connector endpoint clearance 5px ⇒
// endpoint to adjacent box is exactly 20px, so a straight connector that passes through the
// adjacent box would be silently passed as "connecting the adjacent box". The radius threshold
// is reserved for detour-too-close, which measures clearance before any intersection.
const endsInside = (points, rect) => pointInBBox(points[0], rect.bbox)
  || pointInBBox(points.at(-1), rect.bbox);

const endsNear = (points, rect) => pointToBBoxDistance(points[0], rect.bbox) <= ENDPOINT_RADIUS
  || pointToBBoxDistance(points.at(-1), rect.bbox) <= ENDPOINT_RADIUS;

// "The connector enters this box" cannot be tested with clearance === 0: bboxToPolylineDistance
// uses pointInBBox which **counts tangency as 0**, so a connector that starts exactly on the
// box boundary and lies entirely outside still counts as "entering". That is a permitted
// form in SKILL.md; the box wall still separates it from the label inside, and classifying
// it as entering is a false positive triggered by a difference of 1px that the author cannot
// perceive. The box is inset by one stroke-width on each side before measuring: house-style
// `<rect>` elements do not declare stroke-width, so SVG's default of 1 applies; a line that
// rests on the wall is **connecting** the box, and only crossing the wall counts as entering.
const WALL = 1;
const insideOf = (b) => {
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  // Without the clamp, a box thinner than two walls would invert -- the opposite edges cross
  // over (minX > maxX) -- and a distance to an inverted box is meaningless. Measuring found
  // the clamp flipping the verdict in both directions depending on the shape, so it is not
  // here to rescue one family of shapes; it is here so this case has one predictable rule.
  // The inset region collapses to the inset centreline, and a line counts as entering only
  // if it touches that. House style has no box this thin; the tests use synthetic ones.
  return {
    minX: Math.min(b.minX + WALL, cx), maxX: Math.max(b.maxX - WALL, cx),
    minY: Math.min(b.minY + WALL, cy), maxY: Math.max(b.maxY - WALL, cy),
  };
};
const entersBox = (points, rect) => bboxToPolylineDistance(insideOf(rect.bbox), points) === 0;

// A dashed grouping box is an obstacle of a different shape from a solid content box, and the
// difference decides everything about this judgment. A content box is an **area**: text has no
// business on top of it. A grouping box is a container: SKILL.md's group pattern puts the group
// name inside it and every solid content box it groups, each with its own label, inside it too — so treating the
// interior as forbidden would report a finding on every group title and every box label in every
// diagram that uses a group, which is worse than the miss it was meant to fix. What text may not
// do is sit across the **line** that draws the container, so each of the four edges is judged as a
// thin band and the interior is judged not at all.
//
// Two shapes the house style does draw, both of which a band leaves alone where a region would
// not: a group title inset from its wall (measured across the committed gallery, the nearest
// glyph-box edge sits 5.8px from a wall), and text inside a nested inner group, which is inside
// the outer group as well but tens of pixels from any of its edges.
const WALL_SIDES = [
  { side: 'left', vertical: true, edge: (b) => b.minX },
  { side: 'right', vertical: true, edge: (b) => b.maxX },
  { side: 'top', vertical: false, edge: (b) => b.minY },
  { side: 'bottom', vertical: false, edge: (b) => b.maxY },
];

// The band is the painted line and nothing wider. House-style rects declare no stroke-width, and
// document.mjs has already resolved SVG's default of 1, so half a stroke either side of the edge
// covers exactly the pixels the renderer darkens. Widening it into a "nearly touching" tolerance
// is the one change that could turn this judgment into the false-positive machine the group
// interior would have been: the acceptance bar is zero warnings, so every pixel added here is a
// correct diagram that can no longer pass, and a label that clears the line is not on it.
const halfStroke = (rect) => (Number.isFinite(rect.strokeWidth) ? rect.strokeWidth : 1) / 2;

const readableBox = (box) => [box.minX, box.minY, box.maxX, box.maxY].every((v) => Number.isFinite(v));

// The shortest edit that takes a glyph box off a wall: either the trailing edge retreats behind
// the band, or the leading edge advances past it. Both distances are positive whenever the box
// overlaps the band, and reporting the shorter one keeps the advice proportionate in both
// directions — a caption overhanging a wall from outside is nudged further out, a label mostly
// inside is nudged further in. A rule that always pointed inward would tell the author of an
// outside caption to move it its whole width into a container it does not belong to. The one
// exception is a glyph box too large to stand between the two opposing walls, where neither of
// those destinations is reachable; see the escape choice below.
function wallCrossing(bbox, rect) {
  const h = halfStroke(rect);
  const b = rect.bbox;
  // Geometry the model could not read is not judged, and **both** operands have to be checked:
  // `width="180px"` on the rect and `x="20px"` or `font-size="10px"` on the text are all valid SVG
  // that Number() reads as NaN. Every comparison with NaN is false, **including the two below that
  // mean "the glyph box is nowhere near this wall"**, so a NaN edge walks through both guards and a
  // finding is produced about a label a hundred pixels from the box. On the rect side the receipt
  // does at least say `≥NaN`. On the text side it does not: an unreadable font size leaves the glyph
  // box height and width NaN, only the retreat distance is then NaN, so `back.shift <= forward.shift`
  // is false and the advance candidate is taken for every wall, after which the largest-move rule
  // picks the far wall. A label 100px to the left of a group is told it straddles the group's right
  // wall and to move 280.5px right. Every number on that receipt is finite and plausible and none of
  // it is true, which reads as authoritative in a way `NaN` does not, and following it moves a
  // correctly placed label into the middle of the diagram. Guarding one operand of a two-operand
  // comparison is not a guard.
  //
  // The guard is deliberately coarse: one non-finite value abandons all four walls, though a bad
  // rect `width` strictly invalidates only the right wall and the two horizontal spans. Judging the
  // walls that remain readable would buy the author nothing — a file with an unreadable length
  // already carries a document-model warning naming the attribute, so it cannot pass the
  // zero-error-zero-warning bar either way — and it would go on reporting walls of a box whose shape
  // is unknown. Falling silent is what the rest of the module does with such geometry: bboxIntersects
  // is false for a NaN box, so text-over-box never reports it, and a NaN clearance loses every
  // comparison in the connector pass.
  if (!readableBox(b) || !readableBox(bbox)) return null;
  let worst = null;
  for (const { side, vertical, edge } of WALL_SIDES) {
    const wall = edge(b);
    // The band runs the length of its own edge only, extended half a stroke past each end so
    // that the two bands meeting at a corner leave no gap between them. This is what confines
    // the judgment to the outline: a glyph box level with the group but far to one side of it
    // shares no span with any band.
    const along = vertical
      ? { min: bbox.minY, max: bbox.maxY, low: b.minY - h, high: b.maxY + h }
      : { min: bbox.minX, max: bbox.maxX, low: b.minX - h, high: b.maxX + h };
    if (along.max <= along.low || along.high <= along.min) continue;
    // Strict on both sides, as bboxIntersects is: a glyph box whose edge lands exactly on the
    // outer edge of the stroke is tangent to the line, not on it.
    const across = vertical
      ? { min: bbox.minX, max: bbox.maxX }
      : { min: bbox.minY, max: bbox.maxY };
    if (across.max <= wall - h || wall + h <= across.min) continue;
    // Where the escape is allowed to stop. Normally it is this wall's own two faces: the trailing
    // edge retreats behind the band or the leading edge advances past it, and the shorter of the two
    // is reported.
    //
    // That pair of destinations is only reachable while the glyph box is narrow enough to stand
    // between the two opposing walls — the span between their inner faces, which is the box's own
    // extent less one stroke. When the label is wider than that span, no position inside the box
    // clears both walls, so the cheaper move past *this* wall lands the label on the opposite one,
    // and the receipt printed from there sends it back to this one; a 22px label in a 20px box
    // cycles between the walls forever and never converges. For such a label the only satisfiable
    // escape is outward — clear of the whole box, on whichever side is nearer — so the destinations
    // become the outer faces of the far wall rather than of this one. An inward move is not correct
    // in that case however small it is, and the finding itself does not change: the label really is
    // on this wall, only the direction out of it does.
    const span = vertical ? { min: b.minX, max: b.maxX } : { min: b.minY, max: b.maxY };
    const fits = across.max - across.min <= (span.max - span.min) - 2 * h;
    const retreatTo = fits ? wall - h : span.min - h;
    const advanceTo = fits ? wall + h : span.max + h;
    const back = {
      shift: across.max - retreatTo, at: across.max, limit: retreatTo, sign: '≤', toward: vertical ? 'left' : 'up',
    };
    const forward = {
      shift: advanceTo - across.min, at: across.min, limit: advanceTo, sign: '≥', toward: vertical ? 'right' : 'down',
    };
    const escape = back.shift <= forward.shift ? back : forward;
    // Which wall the message names. For an escape that stops at this wall's own faces it is this
    // wall, and for an outward escape it is still this wall whenever this is the only one of the
    // opposing pair the glyph box lies on — algebraically the outward escape then always goes the
    // way this wall is facing, because the alternative needs the box to be more than two strokes
    // wider than the label, which is exactly what this branch has ruled out.
    //
    // A label lying on **both** opposing walls at once is the case that needs saying: both of them
    // compute the same pair of outward destinations, so the two shifts are identical and the
    // largest-move rule below cannot separate them — WALL_SIDES order would decide, and the
    // message would name the wall the label is being moved away from while `expected` gave the
    // outer face of the other one. Both statements would be true of a label that really is on both
    // walls, but they would not be true of each other, and a receipt whose sentence and whose
    // number point at different walls is unreadable. Naming the wall the escape leaves past keeps
    // the two halves talking about the same edge.
    const leaving = { left: 'left', right: 'right', up: 'top', down: 'bottom' }[escape.toward];
    // One finding per label per grouping box: a label draped over a corner lies on two bands but is
    // one mistake. Which of the two walls to name is arbitrary on the merits — the walls of a corner
    // are perpendicular, so clearing the left wall is a move along x and clearing the top wall a move
    // along y, and neither escape clears the other whichever is reported first. The author needs two
    // edits either way, and the house repair loop is one repair then re-run, so an iterative receipt
    // is how the tool is meant to be used. What the choice does have to be is deterministic, or the
    // receipt would depend on the order of WALL_SIDES; the largest move is that rule.
    if (worst === null || escape.shift > worst.escape.shift) worst = { side: fits ? side : leaving, escape };
  }
  return worst;
}

export const overlap = {
  id: ID,
  title: 'Nothing overlaps and detours keep their distance',
  run(doc) {
    const out = [];
    const round = (v) => Number(v.toFixed(1));
    const panels = panelRects(doc);
    const traces = new Map(doc.paths.map((p) => [p, subpathTraces(p)]));

    for (const t of doc.texts) {
      const at = { line: t.line, column: t.column };

      for (const rect of doc.contentRects) {
        if (rect === t.container) continue;
        // Solid-outline panel boxes take no part in the text-over-box judgment: a panel
        // already surrounds inner boxes and their labels, so reporting them individually would
        // give every inner-box label one error, with a repair suggestion of "move the label
        // or widen the box so the label becomes its content" — the label is already the content
        // of its own box, and the only change that would silence the tool is deleting the panel.
        // Dashed grouping boxes are exempted upstream (not included in contentRects); solid panels
        // must be blocked here.
        //
        // Only text that **lives inside this panel** is exempt. Exempting the whole box merely
        // because the rect is a panel would also exempt a caption drawn outside the panel that
        // genuinely overlaps its edge; and the criterion in panelRects is "surrounds other
        // diagram content", so an ordinary solid content box with a small labelled badge (`v2` and
        // similar) inside it counts as a panel — common layout would then disable the
        // overlap check for the entire box. panels.mjs only answers "what counts as a panel";
        // "who is exempt" is decided by each consumer: baseline-offset needs "this rect's own
        // centring is not checked", while here "text inside it is not reported".
        if (panels.has(rect) && pointInBBox(t.center, rect.bbox)) continue;
        if (bboxIntersects(t.bbox, rect.bbox)) {
          out.push(error({
            check: ID, code: 'text-over-box', ...at,
            message: `Label ${quote(t.content)} overlaps a box it does not belong to`,
            repair: { hint: 'move the label, or widen the box so the label becomes its content' },
          }));
        }
      }

      for (const rect of doc.groupRects) {
        const crossing = wallCrossing(t.bbox, rect);
        if (crossing === null) continue;
        const { side, escape } = crossing;
        out.push(warning({
          check: ID, code: 'text-on-group-wall', ...at,
          message: `Label ${quote(t.content)} sits across the ${side} wall of a dashed grouping box`,
          repair: {
            // No `attribute: 'x'`: these are the **edges** of the glyph box, while `x` is the
            // centre under `text-anchor="middle"`, so naming the attribute would tell the author
            // to set the centre to an edge position. text-overflow declines to name it for the
            // same reason.
            actual: String(round(escape.at)),
            expected: `${escape.sign}${round(escape.limit)}`,
            hint: `shift the label ${round(escape.shift)}px ${escape.toward} so its glyph box clears the dashed line`,
          },
        }));
      }

      for (const path of doc.paths) {
        const runs = traces.get(path);
        // Measures each subpath in turn and takes the **most severe violation**: including a
        // phantom jump segment would artificially shorten the clearance. "Closest" cannot be
        // used instead — the straight-line threshold is 10 and the curve threshold is 15, so
        // the closest subpath is not necessarily the first one violated: a 12px straight
        // subpath in the same d is compliant while a 13px curve is a violation; taking the
        // closest would swallow the violation, while splitting the two into separate `<path>`
        // elements would report it — the verdict must not depend on how the author distributed
        // subpaths across elements. When clearances are tied, the same formula applies: both
        // at 12px, a curve is short by 3px and a straight line by -2px, so the curve is taken
        // as more severe, not the one that appears earlier in document order.
        let worst = null;
        for (const trace of runs) {
          const distance = bboxToPolylineDistance(t.bbox, trace.points);
          // Measured separately from `distance` so that the number clearance findings quote stays
          // exact; see withoutEdges for why the two questions get different boxes.
          const touching = bboxToPolylineDistance(withoutEdges(t.bbox), trace.points) === 0;
          const minimum = trace.curved ? CURVE_LABEL_CLEARANCE : TEXT_LINE_CLEARANCE;
          // Sitting on a connector outranks all clearance-deficiency findings; it is given a score
          // that no shortfall can beat.
          const shortfall = touching ? Infinity : minimum - distance;
          // When shortfalls are equal (a 7px straight line is short by 3, a 12px curve also
          // short by 3), the **closer** subpath to the label is taken: only one finding is
          // reported per path, and the reader looking at the diagram will notice the tightest
          // segment first. Without this tie-break the first-in-document-order subpath would be
          // taken, and swapping the two segments in d would change the receipt.
          const beats = worst === null || shortfall > worst.shortfall
            || (shortfall === worst.shortfall && distance < worst.distance);
          if (beats) worst = { distance, curved: trace.curved, shortfall, touching };
        }
        // No subpath could be measured (empty d, contains arc segments): this path is
        // invisible to this check; no guess is made.
        if (worst === null) continue;
        const { distance, curved, touching } = worst;
        // A label sitting on a connector is reported unconditionally, regardless of whether
        // the label is inside a box: the connector is already pressing against the text, and
        // the box wall cannot stop a connector that passes through it. Card separator lines and
        // connectors inside panels have this shape, and line-cuts-box does not apply to them —
        // those connectors' endpoints are also inside the box, so `endsInside` would exempt
        // them, and passing both routes would be a false negative.
        if (touching) {
          out.push(error({
            check: ID, code: 'text-over-line', ...at,
            message: `Label ${quote(t.content)} sits on a connector`,
            repair: { hint: 'put the label beside the line, or on the convex/concave side of a curve' },
          }));
          continue;
        }
        // Exempting a label inside a box applies only to the **clearance** check: clearance
        // measures the distance through the box wall, and the wall separates the label from
        // connectors outside; the only way for the author to comply is to move the label out
        // of its own box (text-overflow makes the same decision for the neighbour-overlap
        // check). This is placed after the on-connector test because "how deeply did the
        // connector enter" is only meaningful here — placing it before would cause a connector
        // that just grazes the wall by one stroke-width but presses directly against the label
        // to be skipped entirely, a silent false negative.
        if (t.container && !runs.some((r) => entersBox(r.points, t.container))) continue;
        const minimum = curved ? CURVE_LABEL_CLEARANCE : TEXT_LINE_CLEARANCE;
        if (distance < minimum) {
          out.push(warning({
            check: ID, code: curved ? 'curve-label-clearance' : 'text-line-clearance', ...at,
            message: `Label ${quote(t.content)} is ${round(distance)}px from a ${curved ? 'curve' : 'connector'}`,
            repair: {
              actual: String(round(distance)),
              expected: `≥${minimum}`,
              hint: curved
                ? 'for a downward-bending curve put the label above it, for an upward-bending curve below'
                : 'keep 10–20px between text and lines',
            },
          }));
        }
      }
    }

    for (const path of doc.paths) {
      const at = { line: path.line, column: path.column };
      // Only solid content boxes are checked: dashed grouping boxes may be passed through, and
      // connectors may also terminate on their boundary.
      for (const { points } of traces.get(path)) {
        for (const rect of doc.contentRects) {
          const distance = bboxToPolylineDistance(rect.bbox, points);
          // The entry test insets the box by one wall, exactly as entersBox does for the text pass
          // above, so that "a line resting on the wall is connecting, not entering" is one rule
          // rather than two. Asking the raw bbox instead counts tangency as entry, and the two arms
          // then disagree about which endpoint exemption applies: the entry arm exempts an endpoint
          // inside the box, the detour arm one within 20px of it. A connector starting at the
          // house-style 5px clearance and grazing the wall was therefore an error at exactly 0px and
          // silent half a pixel away — the sub-pixel flip this inset exists to prevent. A grazing
          // connector with both endpoints far away still gets a finding; it arrives as
          // detour-too-close at 0px, the same code it already had at 0.5px.
          if (entersBox(points, rect)) {
            if (endsInside(points, rect)) continue;
            out.push(error({
              check: ID, code: 'line-cuts-box', ...at,
              message: 'Connector passes through a box it neither starts nor ends at',
              repair: { hint: 'route around it with a C/Q curve, keeping 20px outside the boundary' },
            }));
          } else if (distance < DETOUR_CLEARANCE) {
            if (endsNear(points, rect)) continue;
            out.push(warning({
              check: ID, code: 'detour-too-close', ...at,
              message: `Connector passes ${round(distance)}px from an unrelated box`,
              repair: { actual: String(round(distance)), expected: `≥${DETOUR_CLEARANCE}`, hint: 'detour paths stay at least 20px outside the obstacle boundary' },
            }));
          }
        }
      }
    }

    return out;
  },
};
