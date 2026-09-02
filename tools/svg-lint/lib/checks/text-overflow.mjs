// tools/svg-lint/lib/checks/text-overflow.mjs
// SKILL.md "Estimating text width": text right edge + 10px < left edge of the right
// neighbour. Labels inside a box must leave inner padding and must not touch the edge.
import { error } from '../report.mjs';

const ID = 'text-overflow';
const INNER_PADDING = 2;
const NEIGHBOR_CLEARANCE = 10;

// Strict inequalities on both sides: boxes that only touch in the vertical direction (a
// box's bottom edge exactly meeting a text element's top edge, or vice versa) do not count
// as overlapping. House-style rows are 25–30px apart; a tangent touch is a deliberate
// alignment, the box and the text visually belong to different rows, and no matter how close
// they are horizontally they will not be read as crowded — treating them as neighbours would
// be a false positive.
const verticallyOverlaps = (a, b) => a.minY < b.maxY && b.minY < a.maxY;

export const textOverflow = {
  id: ID,
  title: 'Labels fit their box and clear their neighbours',
  run(doc) {
    const out = [];
    // toFixed(1) makes fractional gaps display as one decimal place in the message;
    // integer values are still output as integer strings.
    const round = (v) => Number(v.toFixed(1));

    for (const t of doc.texts) {
      const at = { line: t.line, column: t.column };

      if (t.container) {
        const box = t.container;
        const textWidth = round(t.bbox.maxX - t.bbox.minX);
        // Round at the point of calculation. Without this, a box with `width="52.7"` would
        // produce `≤48.699999999999996` — a number the author cannot find in the file, which
        // reads as though the tool computed incorrectly.
        // Same policy: `box.width` is the value the author wrote, so it is echoed back
        // unchanged without rounding.
        const usable = round(box.width - INNER_PADDING * 2);
        // The check uses both edges of the bbox, not the text width itself: when
        // `text-anchor="start"` places a fitting label off-centre (box x=0 width 60, text
        // width 42px, right padding line at 58), comparing text width 42 > 58 misses it,
        // but its right edge at 62 has already passed the box boundary — a false negative.
        //
        // Both sides are rounded before comparison: differences that cannot be printed are
        // not reported. If a right edge of 58.02 were judged as overflowing its 58 limit,
        // the repair receipt would be `58 → ≤58` with "sits 0px past" — the actual value
        // already satisfies the expected value, and the author cannot tell what to change.
        // This is not a new threshold; the precision is the one decimal place from the round
        // above.
        const leftLimit = round(box.x + INNER_PADDING);
        const rightLimit = round(box.x + box.width - INNER_PADDING);
        const leftEdge = round(t.bbox.minX);
        const rightEdge = round(t.bbox.maxX);
        const overLeft = leftEdge < leftLimit;
        const overRight = rightEdge > rightLimit;
        if (overLeft || overRight) {
          // "Does not fit at all" and "fits but is misplaced" are two different problems, so
          // the repair receipt must describe them separately. With a shared "text width →
          // usable width" receipt, a 14px label in a 60px box would receive `14 → ≤56` —
          // the actual value already satisfies the expected value, so the author cannot tell
          // which direction to adjust, and the hint about "widen the box / shorten the label"
          // would also be wrong: the x value is what needs to change.
          //
          // When the label fits, both sides cannot overflow simultaneously: that would require
          // the text width to exceed the usable width, which falls into the other branch.
          const tooWide = textWidth > usable;
          const edge = overRight
            ? { side: 'right', at: rightEdge, limit: rightLimit, sign: '≤' }
            : { side: 'left', at: leftEdge, limit: leftLimit, sign: '≥' };
          out.push(error({
            check: ID, code: 'text-overflows-box', ...at,
            message: tooWide
              ? `Label needs ${textWidth}px but its box is only ${box.width}px wide`
              : `Label sits ${round(Math.abs(edge.at - edge.limit))}px past the ${edge.side} inner edge of its box`,
            repair: tooWide
              ? {
                actual: String(textWidth),
                expected: `≤${usable}`,
                hint: 'widen the box, shorten the label, or move the text outside and centre it below',
              }
              // Do not write `attribute: 'x'`: these two numbers are the **edge** coordinates
              // of the label, whereas `x` is the centre under `text-anchor="middle"` —
              // labelling it as x would tell the author to set the centre to the edge position.
              : {
                actual: String(edge.at),
                expected: `${edge.sign}${edge.limit}`,
                hint: 'the label fits its box, so adjust x rather than resizing the box',
              },
          }));
        }
        // Labels inside a box are not subject to the neighbour check: the box itself provides
        // isolation, and checking neighbours would produce false positives for normal compact
        // layouts.
        continue;
      }

      // Free-standing text: compare only against the nearest neighbour that overlaps in the
      // vertical direction, to avoid flooding the whole diagram with warnings.
      for (const side of ['right', 'left']) {
        let nearest = null;
        for (const rect of doc.contentRects) {
          if (!verticallyOverlaps(t.bbox, rect.bbox)) continue;
          const gap = side === 'right'
            ? rect.bbox.minX - t.bbox.maxX
            : t.bbox.minX - rect.bbox.maxX;
          // A negative gap means the label overlaps the box — that is handled by the
          // "text overlaps box" check; here only the clearance before intersection is
          // measured. Strictly less than zero: a gap of exactly 0 (label right edge exactly
          // touching the box left edge) is the tightest intrusion short of overlapping and
          // must be reported here; letting it through would leave a class of shapes uncovered
          // between the two checks.
          if (gap < 0) continue;
          if (nearest === null || gap < nearest) nearest = gap;
        }
        // The boundary is included: SKILL.md asks for "text right edge + 10px < left edge of the
        // neighbour", a strict inequality, so a gap of exactly 10px does not satisfy it. That
        // wording differs from the detour clearance ("at least 20px"), where the threshold value
        // itself is compliant — each comparison follows the wording of its own rule.
        if (nearest !== null && nearest <= NEIGHBOR_CLEARANCE) {
          out.push(error({
            check: ID, code: 'text-intrudes-neighbor', ...at,
            message: `Label leaves only ${round(nearest)}px to the box on its ${side}`,
            repair: {
              actual: String(round(nearest)),
              expected: `>${NEIGHBOR_CLEARANCE}`,
              hint: 'estimate the text width from the char-width table before placing the label',
            },
          }));
        }
      }
    }

    return out;
  },
};
