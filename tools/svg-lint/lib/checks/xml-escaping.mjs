// tools/svg-lint/lib/checks/xml-escaping.mjs
// The parser already supplies the code and line/column; this module only decides severity and how to repair.
import { error, warning } from '../report.mjs';

const ID = 'xml-escaping';

// The only warning is `>`: XML permits a bare `>`, but SKILL.md requires it to be escaped as well.
const WARNING_CODES = new Set(['unescaped-gt']);

// Object.create(null): consistent with NUMERIC_ATTRS / CHAR_WIDTH_TABLE / NAMED_ENTITIES.
// The keys here come from the parser's own fixed code vocabulary (not file content), so a
// prototype collision is unreachable; the same style is used so that "one pit has one
// defence in this repository", not as defensive redundancy.
const REPAIRS = Object.assign(Object.create(null), {
  'unescaped-ampersand': { actual: '&', expected: '&amp;', hint: 'an unescaped & makes the whole SVG fail to render' },
  'unescaped-lt': { actual: '<', expected: '&lt;', hint: 'otherwise the parser reads it as the start of a tag' },
  'unescaped-gt': { actual: '>', expected: '&gt;', hint: 'house style escapes > in text as well' },
  'unknown-entity': { hint: 'XML predefines only amp, lt, gt, quot, apos; use a numeric reference such as &#160; instead' },
  // No actual/expected: a mechanical replacement cannot fix this — a human must decide which one to remove.
  'duplicate-attribute': { hint: 'remove one of them; the last value silently wins and the other is dropped' },
  // Also hint-only, for the same reason: replacing `--` with any one thing would rewrite the author's
  // prose. An em dash is named because writing ` -- ` as a dash in a comment is how this arises.
  'double-hyphen-in-comment': { hint: 'XML allows no "--" inside a comment; use a single hyphen, an em dash, or split the comment in two' },
});

export const xmlEscaping = {
  id: ID,
  title: 'XML special characters are escaped',
  run(doc, ctx) {
    return (ctx.parsed?.errors ?? []).map((e) => {
      const make = WARNING_CODES.has(e.code) ? warning : error;
      return make({
        check: ID,
        code: e.code,
        message: e.message,
        line: e.line,
        column: e.column,
        repair: REPAIRS[e.code] ?? null,
      });
    });
  },
};
