// tools/svg-lint/lib/checks/baseline-offset.mjs
// SKILL.md "Vertically centering text in a box":
//   text y = box y + box height/2 + font-size × 0.35
// 0.35 is the measured value for "optical centre of the glyph to the baseline"; do not
// confuse it with 0.75 (ascent, used for positioning from the top).
import { error, warning } from '../report.mjs';
import { panelRects } from '../panels.mjs';
import { BASELINE_CENTER_RATIO, groupIntoLines, sameLine } from '../text-metrics.mjs';

const ID = 'baseline-offset';
const BASELINE_TOLERANCE = 1;
const CENTER_TOLERANCE = 1;
// The block midpoint has a slightly looser tolerance than a single baseline: in hand-drawn
// diagrams two baselines are often rounded to integers (62.2/80.2 written as 61/79), so the
// midpoint is naturally off by about 1.2px. A 6px overall shift is still caught.
const BLOCK_TOLERANCE = 1.5;
const round = (v) => Number(v.toFixed(1));

export const baselineOffset = {
  id: ID,
  title: 'Text inside a box is centred both ways',
  run(doc) {
    const out = [];
    // Panel frames are not checked: their section names are placed in the top-left corner by
    // house style; checking centring would suggest moving the name to the centre of the
    // panel, directly over the inner boxes — a repair that would destroy the layout if
    // followed. The determination is done in panels.mjs; the overlap check also needs it.
    const panels = panelRects(doc);
    // When more than one text segment shares a baseline (left label + right value), their x
    // values are deliberately set against the two sides of the box, so checking horizontal
    // centring would be a false positive — the box-height check also treats this shape as a
    // compliant single line.
    const inLabelRow = (t) => t.container.texts.some((o) => o !== t
      && sameLine(o.y, o.fontSize, t.y, t.fontSize));

    for (const rect of doc.contentRects) {
      if (panels.has(rect) || rect.texts.length === 0) continue;
      const lines = groupIntoLines(rect.texts);
      if (lines.length === 1) {
        // Single line (possibly composed of multiple segments): each segment uses **its own**
        // font size to compute the optical centre. Using the line's maximum font size for an
        // 11px segment would cause a mixed-font-size label line to receive a 1.05px false
        // positive.
        for (const t of lines[0].texts) {
          const expected = rect.y + rect.height / 2 + t.fontSize * BASELINE_CENTER_RATIO;
          if (Math.abs(t.y - expected) > BASELINE_TOLERANCE) {
            out.push(warning({
              check: ID, code: 'baseline-off-center', line: t.line, column: t.column,
              message: `Baseline is at y=${t.y}; optical centring wants y=${round(expected)}`,
              repair: {
                attribute: 'y',
                actual: String(t.y),
                expected: String(round(expected)),
                hint: 'box y + box height/2 + font-size × 0.35',
              },
            }));
          }
        }
        continue;
      }
      // Multiple lines: inter-line spacing is covered by box-height's line-height-off check;
      // this branch only checks the block's position within the box —
      // without it, shifting two lines down together by 6px would go undetected by any check.
      // The criterion is the midpoint of the first and last baselines. When the block is
      // correctly placed, each line's midline is symmetric about the box centre, and since
      // each line's baseline = line midline + 0.35 × that line's font size, the midpoint of
      // the first and last baselines = box centre + 0.35 × (first-line font size + last-line
      // font size) / 2. Using the maximum font size in place of this average would cause a
      // correctly placed card with a 20px title and a 9px description to receive a 1.9px
      // false positive (average 14.5 versus maximum 20 differs by 0.35 × 5.5).
      const last = lines[lines.length - 1];
      const blockFontSize = (lines[0].fontSize + last.fontSize) / 2;
      const mid = (lines[0].y + last.y) / 2;
      const wanted = rect.y + rect.height / 2 + blockFontSize * BASELINE_CENTER_RATIO;
      if (Math.abs(mid - wanted) > BLOCK_TOLERANCE) {
        // The shift is given directly: actual / expected are the **midpoint**, and what
        // needs to change is the y of every line; requiring the reader to subtract the two
        // midpoints pushes that arithmetic step onto them, and the sign is exactly the part
        // most likely to be reversed.
        const shift = round(wanted - mid);
        out.push(warning({
          check: ID, code: 'block-off-center', line: rect.line, column: rect.column,
          // No attribute field: what needs to change is the y of every line, not an
          // attribute on the box.
          message: `The ${lines.length} lines are centred on y=${round(mid)}; optical centring wants y=${round(wanted)}`,
          repair: {
            actual: String(round(mid)),
            expected: String(round(wanted)),
            hint: `shift every line's y by ${shift > 0 ? '+' : ''}${shift}; the block centre belongs at box y + box height/2 + font-size × 0.35`,
          },
        }));
      }
    }

    for (const t of doc.texts) {
      if (!t.container) continue;
      if (panels.has(t.container) || inLabelRow(t)) continue;
      if (t.textAnchor !== 'middle') {
        // Report whether the attribute was declared, not the effective value: t.textAnchor
        // defaults to start, so reporting start directly would send the reader to search for
        // a text-anchor="start" that does not exist.
        // viewbox-clipping reports 'absent' for a missing width; this follows the same
        // convention.
        const declared = t.element.attrs['text-anchor'];
        out.push(error({
          check: ID, code: 'label-not-centered', line: t.line, column: t.column,
          message: `Label inside a box resolves to text-anchor="${t.textAnchor}"`,
          repair: { attribute: 'text-anchor', actual: declared ?? 'absent', expected: 'middle', hint: 'box labels are centred in house style' },
        }));
        continue;
      }
      const centerX = t.container.x + t.container.width / 2;
      if (Math.abs(t.x - centerX) > CENTER_TOLERANCE) {
        out.push(warning({
          check: ID, code: 'label-off-box-center', line: t.line, column: t.column,
          message: `Middle-anchored label sits at x=${t.x} but its box centre is ${round(centerX)}`,
          repair: { attribute: 'x', actual: String(t.x), expected: String(round(centerX)), hint: 'box x + box width/2' },
        }));
      }
    }

    return out;
  },
};
