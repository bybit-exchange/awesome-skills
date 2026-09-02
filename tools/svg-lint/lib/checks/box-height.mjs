// tools/svg-lint/lib/checks/box-height.mjs
// SKILL.md "Box dimensions": font-size × 3 = top padding + glyph height + bottom padding.
// For multiple lines, add (line count − 1) × line height, where line height = font-size × 1.5.
import { error, warning } from '../report.mjs';
import { groupIntoLines } from '../text-metrics.mjs';
import { panelRects } from '../panels.mjs';

const ID = 'box-height';
const HEIGHT_FACTOR = 3;
const LINE_HEIGHT_FACTOR = 1.5;
const HEIGHT_TOLERANCE = 0.5;
const LINE_SPACING_TOLERANCE = 1;
const round = (v) => Number(v.toFixed(1));

export const boxHeight = {
  id: ID,
  title: 'Box height is derived from the font size',
  run(doc) {
    const out = [];
    // Dashed grouping boxes follow the "Dashed grouping boxes" rules and are exempt from this
    // formula; doc.contentRects already excludes them.
    // A solid outer box (a card, a container) is exempt from the **line height** rule below: the
    // texts that fall inside it are not lines of one label, so the distance between them is not a
    // line height. A card's own heading and an annotation sitting in the same area were read as two
    // lines of one box and their 73px separation reported against an 18px line height.
    // baseline-offset.mjs exempts panels for the same shape of problem, and both take the
    // determination from panels.mjs so the two checks agree on what a panel is.
    //
    // The height formula keeps running for a panel, and that is not an oversight: "encloses a
    // labelled box" is a wide net, and an ordinary box with a small badge in its corner meets it, so
    // exempting the whole check would let one badge silence box-too-short on the box it sits in —
    // the commonest defect this check exists for. A real card is never reported by the formula
    // anyway: it has to be tall enough to hold a row of boxes, which is more than its own heading
    // needs.
    const panels = panelRects(doc);
    for (const rect of doc.contentRects) {
      // This guard is unreachable as "producing a finding" under the current code: with empty texts,
      // `Math.max(...[])` is −Infinity, `required` evaluates to NaN, and every comparison is false.
      // It is kept to prevent "0 line(s) at -Infinity px" from appearing in the message; do not
      // read it as evidence that this branch is ever reached — replacing it with `if (false)` would
      // not change the output for any input.
      if (rect.texts.length === 0) continue;
      const fontSize = Math.max(...rect.texts.map((t) => t.fontSize));
      // "Line count" = the number of merged baselines, not the number of <text> elements.
      // The criterion lives in text-metrics.mjs and is shared with the in-box positioning check —
      // both places must give the same answer to "what counts as one line".
      const baselines = groupIntoLines(rect.texts);
      const lines = baselines.length;
      const lineHeight = fontSize * LINE_HEIGHT_FACTOR;
      const required = fontSize * HEIGHT_FACTOR + (lines - 1) * lineHeight;

      if (rect.height < required - HEIGHT_TOLERANCE) {
        out.push(error({
          check: ID, code: 'box-too-short', line: rect.line, column: rect.column,
          message: `Box is ${rect.height}px tall but ${lines} line(s) at ${fontSize}px need ${required}px`,
          repair: {
            attribute: 'height',
            actual: String(rect.height),
            expected: String(required),
            hint: lines > 1
              ? `font-size × ${HEIGHT_FACTOR} + ${lines - 1} × ${lineHeight}px line height`
              : `font-size × ${HEIGHT_FACTOR}`,
          },
        }));
      }

      // The line-height rule, and only it, stops at a panel — see the note above the loop over boxes.
      if (panels.has(rect)) continue;
      for (let k = 1; k < baselines.length; k++) {
        // Adjacent lines with mixed font sizes: SKILL.md defines no recommended line height for that
        // case, so any expected value in the finding would be fabricated — do not report.
        if (baselines[k].fontSize !== baselines[k - 1].fontSize) continue;
        // Subtracting two y values introduces floating-point noise (82.4 − 60.2 = 22.200000000000003),
        // and the number in the finding must be directly pasteable into SVG. Rounding is applied at
        // the assignment here, so the tolerance comparison below also uses the rounded value —
        // unlike viewbox-clipping, which rounds only in the report string. The trade-off is that a
        // spacing like 19.04px is accepted (≤0.05px of slack), but in return the message, repair,
        // and decision all use the same number.
        const gap = round(baselines[k].y - baselines[k - 1].y);
        const rowHeight = baselines[k].fontSize * LINE_HEIGHT_FACTOR;
        if (Math.abs(gap - rowHeight) > LINE_SPACING_TOLERANCE) {
          out.push(warning({
            check: ID, code: 'line-height-off', line: rect.line, column: rect.column,
            message: `Baselines are ${gap}px apart; the recommended line height at ${baselines[k].fontSize}px is ${rowHeight}px`,
            // No attribute: the finding is about the relationship between two baselines, and
            // line/column points at the box, not at any individual <text>; including `y` would
            // suggest editing the box's y. Same reasoning as the two symmetry findings in viewbox-clipping.
            repair: { actual: String(gap), expected: String(rowHeight), hint: 'line height = font-size × 1.5' },
          }));
        }
      }
    }
    return out;
  },
};
