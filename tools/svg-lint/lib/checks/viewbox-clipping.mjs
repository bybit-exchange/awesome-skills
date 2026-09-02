// tools/svg-lint/lib/checks/viewbox-clipping.mjs
import { error, warning } from '../report.mjs';
import { bboxInsets } from '../geometry.mjs';

const ID = 'viewbox-clipping';

// SKILL.md "viewBox margins" recommends 20–25px; item 17 of the checklist fixes 25.
// Implemented as a range so both requirements are met: <20 is an error, >25 is a warning.
const MARGIN_MIN = 20;
const MARGIN_MAX = 25;
const SYMMETRY_TOLERANCE = 5;
const RANGE = `${MARGIN_MIN}–${MARGIN_MAX}`;

export const viewboxClipping = {
  id: ID,
  title: 'viewBox hugs the content with 20–25px margins',
  run(doc) {
    const out = [];
    const at = { line: doc.svg?.line ?? 1, column: doc.svg?.column ?? 1 };

    if (!doc.viewBox) {
      out.push(error({
        check: ID, code: 'missing-viewbox', ...at,
        message: 'The <svg> element has no viewBox',
        repair: { attribute: 'viewBox', actual: 'absent', expected: '0 0 <width> <height>', hint: 'without a viewBox the diagram cannot scale' },
      }));
      return out;
    }

    if (doc.widthAttr === null) {
      out.push(error({
        check: ID, code: 'missing-width-attribute', ...at,
        message: 'The <svg> element has no width attribute',
        repair: { attribute: 'width', actual: 'absent', expected: String(doc.viewBox.width), hint: 'SKILL.md requires an explicit display width' },
      }));
    }

    if (!doc.contentBBox) return out;

    const vb = {
      minX: doc.viewBox.x,
      minY: doc.viewBox.y,
      maxX: doc.viewBox.x + doc.viewBox.width,
      maxY: doc.viewBox.y + doc.viewBox.height,
    };
    const insets = bboxInsets(vb, doc.contentBBox);
    const round = (v) => Number(v.toFixed(1));

    for (const side of ['left', 'right', 'top', 'bottom']) {
      const value = insets[side];
      if (value < 0) {
        out.push(error({
          check: ID, code: 'content-clipped', ...at,
          message: `Content overflows the viewBox on the ${side} by ${round(-value)}px`,
          repair: { attribute: 'viewBox', actual: `${side} inset ${round(value)}`, expected: RANGE, hint: 'grow the viewBox or move the content inward' },
        }));
      } else if (value < MARGIN_MIN) {
        out.push(error({
          check: ID, code: 'margin-too-small', ...at,
          message: `The ${side} viewBox margin is ${round(value)}px, below the ${MARGIN_MIN}px minimum`,
          repair: { attribute: 'viewBox', actual: String(round(value)), expected: RANGE, hint: 'grow the viewBox on that side' },
        }));
      } else if (value > MARGIN_MAX) {
        out.push(warning({
          check: ID, code: 'margin-too-large', ...at,
          message: `The ${side} viewBox margin is ${round(value)}px, above the ${MARGIN_MAX}px recommendation`,
          repair: { attribute: 'viewBox', actual: String(round(value)), expected: RANGE, hint: 'shrink the viewBox so it hugs the content' },
        }));
      }
    }

    if (Math.abs(insets.top - insets.bottom) > SYMMETRY_TOLERANCE) {
      out.push(warning({
        check: ID, code: 'vertical-margin-asymmetric', ...at,
        message: `Top margin ${round(insets.top)}px and bottom margin ${round(insets.bottom)}px differ by more than ${SYMMETRY_TOLERANCE}px`,
        repair: { actual: `${round(insets.top)} / ${round(insets.bottom)}`, expected: `within ${SYMMETRY_TOLERANCE}px`, hint: 'adjust the viewBox height, measuring the top margin from the title' },
      }));
    }

    if (Math.abs(insets.left - insets.right) > SYMMETRY_TOLERANCE) {
      out.push(warning({
        check: ID, code: 'horizontal-margin-asymmetric', ...at,
        message: `Left margin ${round(insets.left)}px and right margin ${round(insets.right)}px differ by more than ${SYMMETRY_TOLERANCE}px`,
        repair: {
          actual: `${round(insets.left)} / ${round(insets.right)}`,
          expected: `within ${SYMMETRY_TOLERANCE}px`,
          hint: `wrap the content in <g transform="translate(${round((insets.right - insets.left) / 2)}, 0)">`,
        },
      }));
    }

    return out;
  },
};
