// tools/svg-lint/lib/checks/block-spacing.mjs
// SKILL.md "Block spacing" is the sole block-spacing standard in the file: ≥25px,
// recommended 25–30px. The 25px figure comes from: 5px start clearance + 11px end clearance
// and arrowhead extension + ≥6px visible line segment + a safety margin.
import { error, warning } from '../report.mjs';
import { horizontalGap, verticalGap, bboxUnion } from '../geometry.mjs';
import { panelRects, enclosingContainers } from '../panels.mjs';

const ID = 'block-spacing';
const MIN_GAP = 25;
const MAX_GAP = 30;
const RANGE = `${MIN_GAP}–${MAX_GAP}`;
const ROW_SIZE_TOLERANCE = 60;
const ROW_OVERLAP_RATIO = 0.5;
const TITLE_CENTER_TOLERANCE = 2;
const round = (v) => Number(v.toFixed(1));

// Only look at the nearest neighbour: otherwise the two ends separated by an intermediate
// box would also be treated as an adjacent pair, producing many false positives.
// There is no row-based exemption fallback in the horizontal direction (the one below only
// covers vertical), so the distance comparison here must be genuine — taking the first
// match would produce an extra spacing-too-loose false positive for the two ends separated
// by the middle box in a three-box diagram.
function nearestAfter(from, candidates, gapOf) {
  let best = null;
  let bestGap = Infinity;
  for (const other of candidates) {
    if (other === from) continue;
    // gapOf only returns null (the two boxes overlap in this direction) or a non-negative
    // number, so negative values do not need to be guarded against here.
    const gap = gapOf(from.bbox, other.bbox);
    if (gap === null) continue;
    const after = gapOf === horizontalGap
      ? other.bbox.minX >= from.bbox.maxX
      : other.bbox.minY >= from.bbox.maxY;
    if (!after) continue;
    if (gap < bestGap) {
      best = other;
      bestGap = gap;
    }
  }
  return best ? { other: best, gap: bestGap } : null;
}

// "Nearest neighbour" is not enough: in a three-row diagram, if a column skips the middle
// row, the gap between the top and bottom boxes in that column can be over 90px, yet they
// are separated by another row's boxes — they are not neighbours. gapOf requires horizontal
// overlap for the vertical direction, so the middle box never enters the candidates;
// nearestAfter alone cannot block this case. Without this step, every staggered-layout
// diagram would receive a spacing-too-loose finding.
//
// **The exemption applies to the vertical direction only** (decided 2026-08-30). A "row" is
// a layout unit: measuring the gap across an entire row does not measure adjacency; two boxes
// in the same row are adjacent, and a box in another row (most typically the centred parent
// in a fan-out diagram) does not change that. Exempting both axes would silently miss all
// over-wide gaps between the two children in an up-down fan-out layout; keeping only the
// vertical side means a diagram that intentionally leaves a horizontal gap in the same row
// receives a false positive — and SKILL.md has no such layout.
//
// This trade-off **has a cost on both sides** — do not read the retained side as safe: the
// two shapes are geometric mirrors of each other, and at three-box scale no criterion can
// distinguish them. Keeping the vertical exemption therefore means accepting its mirror's
// false negative — in a left-right fan-out (parent on the left, two children stacked
// vertically on the right, parent's y interval falling between the two children), the
// over-wide vertical gap between the children cannot be reported. The test labelled
// `a left-right fan-out is a known blind spot` pins this behaviour; it will surface if this
// code is changed. The reason to keep this side is this tool's own trade-off and not a rule from
// SKILL.md: the shape the exemption protects — a column that skips a row, which any staggered
// layout produces — is judged more common than the left-right fan-out it blinds the tool to, and a
// false positive costs more than a false negative here, because the acceptance bar is zero warnings,
// so a false positive blocks a correct diagram while a false negative only fails to help. SKILL.md's
// Box layout section (lines 97–99) holds the only rules it states about rows and columns — boxes in
// one row differ in size by ≤60px, boxes in one column share a centre line, and an outer box encloses
// its inner boxes with equal padding. It mentions a row or a column three times more (lines 377, 542
// and 582): a reminder to update the rest of a row when one box moves, the checklist restating the
// ≤60px rule, and the same reminder in the rework list. None of the six speaks to a column that
// skips a row, so nothing there settles which side to keep.
// The `axis === 'Vertical' &&` at the call site is behaviourally redundant: the function
// below only uses y coordinates, and for a horizontal pair `hi` (right box top) is less than
// `lo` (left box bottom) or unrelated, so the condition is never true. It is kept because
// "this exemption covers vertical only" is a decision that should be visible at the call
// site, not something the reader has to infer from the function body.
function separatedByRow(from, to, all) {
  const lo = from.bbox.maxY;
  const hi = to.bbox.minY;
  return all.some((c) => {
    if (c === from || c === to) return false;
    return c.bbox.minY >= lo && c.bbox.maxY <= hi;
  });
}

function verticalOverlapRatio(a, b) {
  const overlap = Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY);
  if (overlap <= 0) return 0;
  return overlap / Math.min(a.maxY - a.minY, b.maxY - b.minY);
}

// A tall box spanning two rows vertically (a queue or database box) has an overlap ratio of
// 1.0 with both the short boxes above and below it, so all three are grouped into "one row"
// and a row-box-size-mismatch is spuriously raised — yet the tall box does not belong to any
// row. The criterion: if it simultaneously covers two boxes that have zero overlap with each
// other, it spans rows and is excluded from same-row comparisons.
// This does not conflict with "a 36px-tall and a 110px-tall box in the same row should be
// reported": that diagram has only one short box, so such a pair cannot be formed.
function spansRows(r, rects) {
  const covered = rects.filter((o) => o !== r
    && verticalOverlapRatio(r.bbox, o.bbox) > ROW_OVERLAP_RATIO);
  return covered.some((a) => covered.some((b) => a !== b
    && verticalOverlapRatio(a.bbox, b.bbox) === 0));
}

function groupRows(rects) {
  const rows = [];
  for (const r of rects.filter((r) => !spansRows(r, rects))) {
    const row = rows.find((group) => group.some((g) => verticalOverlapRatio(g.bbox, r.bbox) > ROW_OVERLAP_RATIO));
    if (row) row.push(r);
    else rows.push([r]);
  }
  // Keep only rows with ≥2 boxes. A single-box row has a width or height spread of 0, which
  // will never exceed the threshold of 60, so this filter has no observable effect on output
  // — it is kept to make explicit that "a row needs at least two boxes before a comparison
  // is meaningful".
  return rows.filter((row) => row.length > 1);
}

export const blockSpacing = {
  id: ID,
  title: 'Adjacent blocks sit 25–30px apart, rows are even, title is centred',
  run(doc) {
    const out = [];
    const rects = doc.contentRects;
    // A solid outer box (a card, a container) encloses the boxes below it rather than sitting
    // beside them. It overlaps each of them fully in y, so the row grouping reads it as their
    // row-mate, and the spansRows rescue only covers a box straddling two rows that do not
    // overlap each other. Comparing a 400×120 card against the 110×36 boxes it holds reports a
    // 290px size difference on a layout the house style asks for. Panels are therefore left out
    // of the row comparison; which boxes are panels is decided in panels.mjs so that this check
    // and the others cannot drift apart on the definition. Accepted cost: two cards side by side
    // are no longer compared against each other either — a false negative, chosen over the false
    // positive that a nested card would otherwise produce against its own outer card.
    const panels = panelRects(doc);
    const rowMembers = rects.filter((r) => !panels.has(r));
    // Adjacency stops at a container wall. The nearest thing to the right of a box inside one card
    // is often the *other* card's wall: two cards 26px apart — compliant — made the box inside the
    // first read as 81px from "the next block", and no edit to the boxes could satisfy that
    // measurement, because the number is the sum of two paddings and the channel between the
    // cards. A box is therefore only paired with boxes that share its container, which leaves the
    // cards themselves paired with each other, where the spacing rule does apply.
    //
    // A dashed grouping box is a container in the same sense, so it ends an adjacency too. Two
    // labelled groups 40px apart, each holding one box at the house-style 15px inner padding, left
    // the two boxes 70px apart — and that finding cannot be acted on: bringing 2 × padding + the
    // channel into 25–30px means the groups touch.
    //
    // The wall stops **only the over-wide direction**. Crossing a wall can only add distance to a
    // measurement, so a cross-wall gap that is already below the 25px floor means the two blocks
    // really are crowded — the containers holding them have to be touching or overlapping for it to
    // happen — and that is worth an error wherever it is found. Only the over-wide direction turns
    // into a number the author cannot act on, because it is the sum of two paddings and a channel.
    // Known gap, unchanged by any of this: nothing measures the over-wide gap between two grouping
    // boxes, because only solid content boxes enter the spacing pairs at all.
    const containerOf = enclosingContainers(doc, [...panels, ...doc.groupRects]);
    const siblingsOf = (rect) => rects.filter((r) => containerOf.get(r) === containerOf.get(rect));

    // `crowding` is the nearest block in any container, `looseness` the nearest one sharing this
    // block's container. They are usually the same rect; they differ exactly where a wall lies
    // between, which is the case the two thresholds treat differently.
    const reportGap = (from, crowding, looseness, axis) => {
      const relevant = (hit) => hit
        && !(axis === 'Vertical' && separatedByRow(from, hit.other, rects));
      // Round first, then check — consistent with the spread approach below. If the raw
      // value were used for the check and rounded only for output, a 24.96px gap would be
      // reported as "is 25px, below the 25px minimum" — the reported number already satisfies
      // the reported threshold, leaving the reader to suspect the tool computed incorrectly.
      // The trade-off is a tolerance of ≤0.05px.
      const tight = relevant(crowding) ? round(crowding.gap) : null;
      if (tight !== null && tight < MIN_GAP) {
        out.push(error({
          check: ID, code: 'spacing-too-small', line: from.line, column: from.column,
          message: `${axis} gap to the next block is ${tight}px, below the ${MIN_GAP}px minimum`,
          repair: {
            actual: String(tight),
            expected: RANGE,
            hint: 'below 25px the arrowhead degenerates into a dot (needs 5 + 11 + ≥6px of visible line)',
          },
        }));
        // One pair, one finding: the same neighbour cannot be both too close and too far, and the
        // wider gap to a sibling further away is not a second problem to fix.
        return;
      }
      const wide = relevant(looseness) ? round(looseness.gap) : null;
      if (wide !== null && wide > MAX_GAP) {
        out.push(warning({
          check: ID, code: 'spacing-too-loose', line: from.line, column: from.column,
          message: `${axis} gap to the next block is ${wide}px, above the ${MAX_GAP}px recommendation`,
          repair: { actual: String(wide), expected: RANGE, hint: 'wide spacing makes the diagram feel loose and the connectors long' },
        }));
      }
    };

    for (const rect of rects) {
      const siblings = siblingsOf(rect);
      reportGap(rect, nearestAfter(rect, rects, horizontalGap), nearestAfter(rect, siblings, horizontalGap), 'Horizontal');
      reportGap(rect, nearestAfter(rect, rects, verticalGap), nearestAfter(rect, siblings, verticalGap), 'Vertical');
    }

    for (const row of groupRows(rowMembers)) {
      // SKILL.md:97 says "differ in size by ≤60px" — size is not width alone.
      // Checking only width would allow a 36px-tall box alongside a 110px-tall box in the
      // same row to pass, which is clearly misaligned.
      const spanOf = (dim) => {
        const v = row.map((r) => r[dim]);
        return Math.max(...v) - Math.min(...v);
      };
      // Subtracting fractional sizes produces floating-point tails
      // (160.4 − 100.1 = 60.30000000000001), and the numbers reported to the user must be
      // directly pasteable into SVG. Rounding at the assignment site means the check, the
      // message, and the repair all use the same number.
      const spread = round(Math.max(spanOf('width'), spanOf('height')));
      if (spread > ROW_SIZE_TOLERANCE) {
        out.push(warning({
          check: ID, code: 'row-box-size-mismatch', line: row[0].line, column: row[0].column,
          message: `Boxes in this row differ in size by ${spread}px`,
          repair: { actual: String(spread), expected: `≤${ROW_SIZE_TOLERANCE}`, hint: 'boxes in the same row should differ by no more than 60px' },
        }));
      }
    }

    // The title is aligned to the centre of the *body content*, not the viewBox centre, and
    // the title itself is not included in the content width.
    // "Content" means everything drawn: the SKILL.md:48-52 definition is content left / right
    // edge, leaving no room to count only rects and paths. Omitting doc.others (`<line>` /
    // `<circle>` / `<ellipse>` / `<polygon>` / `<polyline>`, see `SHAPE_TAGS` in document.mjs) and dashed grouping boxes
    // would cause a correctly placed title to receive a false finding when `<line>` elements
    // draw the connectors or a dashed grouping box is the widest element, and the expected value given
    // would be wrong — following the suggestion would move the title away from the true visual
    // centre. texts are still excluded: the title cannot be included in its own centre
    // calculation.
    const bodyBBox = bboxUnion(
      ...rects.map((r) => r.bbox),
      ...doc.groupRects.map((r) => r.bbox),
      ...doc.paths.map((p) => p.bbox),
      ...doc.others.map((o) => o.bbox),
    );
    if (doc.title && bodyBBox) {
      const contentCenter = (bodyBBox.minX + bodyBBox.maxX) / 2;
      const titleCenter = (doc.title.bbox.minX + doc.title.bbox.maxX) / 2;
      if (Math.abs(titleCenter - contentCenter) > TITLE_CENTER_TOLERANCE) {
        // expected is "the x to write", not the content centre: for a title with
        // text-anchor="start", x is the left edge, so reporting the content centre directly
        // would produce a self-contradictory suggestion like actual 122 / expected 122.
        // The offset is "content centre − current text centre", which degenerates to the
        // content centre itself under a middle anchor.
        const suggestedX = doc.title.x + (contentCenter - titleCenter);
        out.push(warning({
          check: ID, code: 'title-not-centered', line: doc.title.line, column: doc.title.column,
          message: `Title centre is ${round(titleCenter)} but the content centre is ${round(contentCenter)}`,
          repair: {
            attribute: 'x',
            actual: String(doc.title.x),
            expected: String(round(suggestedX)),
            hint: 'centre the title on the content centre, not the viewBox centre',
          },
        }));
      }
    }

    return out;
  },
};
