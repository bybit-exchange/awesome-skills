// tools/svg-lint/lib/checks/font-stack.mjs
// SKILL.md "Fonts (required)": the font stack is ordered macOS → Windows → Linux;
// Noto Sans CJK SC must be present, otherwise Linux server-side rendering produces
// tofu blocks for Chinese text.
import { error } from '../report.mjs';
import { splitTop } from '../document.mjs';
import { decodeEntities } from '../text-metrics.mjs';

const ID = 'font-stack';
const REQUIRED_STACK = ['PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC'];
const CANONICAL = "'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', system-ui, sans-serif";

// CSS family matching is ASCII case-insensitive and must match the entire token. Using
// indexOf on the raw string would be fooled by variants such as 'Microsoft YaHei UI'
// (it matches 'Microsoft YaHei', shifting the position forward, so a correctly ordered
// stack is reported as out-of-order); lowercase spellings would also be flagged as missing.
// `&quot;` in attribute values must be decoded first: writing a double quote inside a
// double-quoted attribute requires `&quot;` as the only legal form, and parse-svg preserves
// attribute text without decoding. Without decoding, a compliant diagram would be reported
// as missing three fonts.
// This step is asymmetric for the two sources, but both paths must keep it: the
// `font-family` attribute value is raw text, and this is its only decode point;
// `doc.styleFontFamily` is already decoded at modelling time, so decoding again here is
// idempotent (a decoded string contains no entities). Removing it would cause the
// presentation-attribute path to revert to reporting three missing fonts.
//
// Tokenisation uses splitTop rather than a bare `split(',')`: commas inside quotes are part
// of the font name. In `font-family: 'X,Noto Sans CJK SC', <compliant stack>`, that is a
// family named `X,Noto Sans CJK SC` (a non-existent font); splitting naively would break it
// into two tokens, causing a correctly ordered stack to be reported as out-of-order — a
// false positive. Conversely, `font-family: 'PingFang SC, Microsoft YaHei,
// Noto Sans CJK SC', sans-serif` is a single non-existent family name; naive splitting
// would recognise all three as present, and a diagram that produces tofu on Linux would be
// judged compliant — a false negative.
function familyTokens(value) {
  return splitTop(decodeEntities(String(value ?? '')), ',')
    .map((t) => t.trim().replace(/^['"]/, '').replace(/['"]$/, '').toLowerCase());
}

// CSS-wide keywords are not font declarations: when `font-family: inherit` is written, the
// effective value comes from the ancestor or style rule, which is checked separately.
// Treating it as a font name would report "three fonts missing" — a false positive.
const CSS_WIDE_KEYWORDS = new Set(['inherit', 'initial', 'unset', 'revert', 'revert-layer']);

// The same font stack written in different forms (spacing, quoting, case, entities) is the
// same problem and should only be reported once.
const signature = (value) => familyTokens(value).join(',');

function stackProblems(value) {
  const tokens = familyTokens(value);
  const positions = REQUIRED_STACK.map((family) => tokens.indexOf(family.toLowerCase()));
  const missing = REQUIRED_STACK.filter((_, i) => positions[i] === -1);
  const present = positions.filter((p) => p !== -1);
  const outOfOrder = present.some((p, i) => i > 0 && p < present[i - 1]);
  return { missing, outOfOrder };
}

export const fontStack = {
  id: ID,
  title: 'A CJK-capable font stack is declared in the right order',
  run(doc) {
    const out = [];
    if (doc.texts.length === 0) return out;
    const at = { line: doc.svg?.line ?? 1, column: doc.svg?.column ?? 1 };

    const report = (value, where) => {
      const { missing, outOfOrder } = stackProblems(value);
      for (const family of missing) {
        out.push(error({
          check: ID, code: 'font-missing-from-stack', ...where,
          message: `"${family}" is missing from the font stack`,
          repair: {
            attribute: 'font-family',
            actual: String(value),
            expected: CANONICAL,
            hint: family === 'Noto Sans CJK SC'
              ? 'without it, Linux server-side rendering falls back to a font with no CJK coverage'
              : 'the stack must cover macOS, Windows and Linux',
          },
        }));
      }
      if (outOfOrder) {
        out.push(error({
          check: ID, code: 'font-stack-out-of-order', ...where,
          message: 'The font stack is not ordered macOS → Windows → Linux',
          repair: { attribute: 'font-family', actual: String(value), expected: CANONICAL, hint: null },
        }));
      }
    };

    // `text { font-family: inherit }` is not a font stack: it delegates the decision to the
    // ancestor, and the SVG root has no CJK fonts, so the whole diagram effectively has no
    // usable stack. Treating it as a font name would produce three "font family missing"
    // findings pointing to something that cannot be changed; reporting missing-font-stack
    // says what actually needs to be done.
    const styleDeclaresStack = doc.styleFontFamily
      && !CSS_WIDE_KEYWORDS.has(doc.styleFontFamily.trim().toLowerCase());
    if (!styleDeclaresStack) {
      out.push(error({
        check: ID, code: 'missing-font-stack', ...at,
        message: 'No <style> rule declares font-family for text',
        repair: {
          attribute: 'font-family',
          actual: doc.styleFontFamily ?? 'absent',
          expected: CANONICAL,
          hint: 'SKILL.md marks this non-negotiable',
        },
      }));
    } else {
      report(doc.styleFontFamily, at);
    }

    // Effective values override the style rule, so they must be checked separately. Use
    // t.fontFamily rather than the element's own attribute: the former already incorporates
    // inherited values from ancestor `<g font-family>`, while the latter cannot see them, so
    // a diagram wrapped in `<g font-family="Helvetica">` would pass silently — Chinese text
    // would still produce tofu on Linux.
    // Deduplicate by normalised signature, seeded with the style rule (already reported
    // above). The original comparison was strict string equality, so "the same stack with an
    // extra space" would report the same problem twice; and when a `<g>` wraps N `<text>`
    // elements, the same non-compliant value would be reported N times (three findings per
    // text for a `<g>` with N texts). Position is taken from the first occurrence.
    const seen = new Set([signature(doc.styleFontFamily)]);
    for (const t of doc.texts) {
      const effective = t.fontFamily;
      if (effective === null) continue;
      if (CSS_WIDE_KEYWORDS.has(effective.trim().toLowerCase())) continue;
      const sig = signature(effective);
      if (seen.has(sig)) continue;
      seen.add(sig);
      report(effective, { line: t.line, column: t.column });
    }

    return out;
  },
};
