// tools/svg-lint/test/checks/xml-escaping.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { xmlEscaping } from '../../lib/checks/xml-escaping.mjs';
import { lintSource } from '../../lib/lint.mjs';
import { runCheck, fixture, codes, hasCode } from '../helpers/load.mjs';

test('the clean fixture produces no escaping findings', () => {
  assert.deepEqual(runCheck(xmlEscaping, fixture('pass/minimal.svg')), []);
});

// Counter-case, and it must exist: the worst failure mode of this check is reporting a **correctly** escaped entity as a violation.
// One of each — named entity, decimal reference, hex reference — none may appear in the result.
test('correctly escaped entities produce no findings', () => {
  const src = '<svg viewBox="0 0 9 9" width="9"><text x="2" y="5" font-size="8">a &amp; b &#160; c &#xA0; d &lt;e&gt;</text></svg>';
  assert.deepEqual(runCheck(xmlEscaping, src), []);
});

test('a raw ampersand in a label is an error with a repair receipt', () => {
  const findings = runCheck(xmlEscaping, fixture('fail/unescaped-ampersand.svg'));
  // first pin "only this one finding is reported": this check's greatest risk is false positives,
  // and using only find() still passes with 11 extra spurious findings.
  assert.deepEqual(codes(findings), ['unescaped-ampersand']);
  const amp = findings[0];
  assert.equal(amp.severity, 'error');
  assert.equal(amp.line, 5);      // the comment header counts as line 1; <text> is on line 5
  assert.equal(amp.column, 84);   // counted by hand; see the fixture below
  assert.equal(amp.repair.actual, '&');
  assert.equal(amp.repair.expected, '&amp;');
  // both check and message appear in the human-readable line (`7:21 error <message> [check/code]`);
  // dropping either still leaves output but with nothing meaningful, and asserting only severity/code cannot detect this.
  assert.equal(amp.check, 'xml-escaping');
  assert.equal(amp.message, 'Raw "&" found; escape it as &amp;');
});

test('a raw greater-than is a warning, not an error', () => {
  const findings = runCheck(xmlEscaping, '<svg viewBox="0 0 9 9" width="9"><text x="2" y="5" font-size="8">a > b</text></svg>');
  assert.deepEqual(codes(findings), ['unescaped-gt']);
  assert.equal(findings[0].severity, 'warning');
  assert.equal(findings[0].repair.expected, '&gt;');
});

// The fourth error code: its entry has always been in REPAIRS, but no test had ever exercised it —
// removing that entry left the whole suite green.
test('a raw less-than in text is an error with its own repair receipt', () => {
  const findings = runCheck(xmlEscaping, '<svg viewBox="0 0 9 9" width="9"><text x="2" y="5" font-size="8">a < b</text></svg>');
  assert.deepEqual(codes(findings), ['unescaped-lt']);
  assert.equal(findings[0].severity, 'error');
  // counted by hand: `<svg ` to 5, viewBox to 22, space 23, width to 32, `>` 33, `<text ` to 39,
  // attributes to 64, `>` 65, `a` 66, space 67 → `<` at 68.
  assert.equal(findings[0].column, 68);
  assert.equal(findings[0].repair.actual, '<');
  assert.equal(findings[0].repair.expected, '&lt;');
});

// The same code in the other position. A raw `<` in an attribute value makes the file fail to parse
// exactly as it does in text, so it must reach the same severity and carry the same repair — the
// substitution `<` → `&lt;` is correct in an attribute value too.
test('a raw less-than in an attribute value is an error with the same repair receipt', () => {
  const findings = runCheck(xmlEscaping, '<svg viewBox="0 0 9 9" width="9"><rect data-note="a<b" x="1" y="2" width="3" height="4"/></svg>');
  assert.deepEqual(codes(findings), ['unescaped-lt']);
  assert.equal(findings[0].severity, 'error');
  assert.equal(findings[0].check, 'xml-escaping');
  assert.equal(findings[0].message, 'Raw "<" in an attribute value; escape it as &lt;');
  assert.equal(findings[0].repair.actual, '<');
  assert.equal(findings[0].repair.expected, '&lt;');
});

// The counter-case at check level: a `>` is legal in an attribute value and the house style has no
// reason to escape it there, so this file must produce nothing — not the warning that the same
// character earns in text content.
test('a greater-than inside an attribute value produces no escaping findings', () => {
  const src = '<svg viewBox="0 0 90 20" width="90"><path d="M1,2 L3,4" aria-label="latency > 200ms"/>'
    + '<!-- a < b --><desc><![CDATA[a < b]]></desc></svg>';
  assert.deepEqual(runCheck(xmlEscaping, src), []);
});

// unknown-entity's repair carries only a hint, no actual/expected — this test simultaneously pins
// the "no attribute and no expected" branch of repairLine (which renders as hint only).
test('a non-predefined entity is an error carrying only a hint', () => {
  const findings = runCheck(xmlEscaping, '<svg viewBox="0 0 9 9" width="9"><text x="2" y="5" font-size="8">a &nbsp; b</text></svg>');
  assert.ok(hasCode(findings, 'unknown-entity'));
  const e = findings.find((f) => f.code === 'unknown-entity');
  assert.equal(e.severity, 'error');
  assert.equal(e.repair.expected, undefined);
  assert.match(e.repair.hint, /numeric reference/);
});

// A `--` inside a comment makes the file fail to parse in every XML parser, so it belongs at the
// same severity as the other well-formedness codes. Like unknown-entity it carries only a hint:
// which of the two hyphens to drop, or whether the author meant a dash, is not mechanical.
test('a double hyphen inside a comment is an error carrying only a hint', () => {
  const findings = runCheck(xmlEscaping, '<svg viewBox="0 0 9 9" width="9"><!-- box -- row --><text x="2" y="5" font-size="8">a</text></svg>');
  assert.deepEqual(codes(findings), ['double-hyphen-in-comment']);
  assert.equal(findings[0].severity, 'error');
  assert.equal(findings[0].check, 'xml-escaping');
  assert.equal(findings[0].message, 'A comment may not contain "--" anywhere in its content');
  assert.equal(findings[0].repair.actual, undefined);
  assert.equal(findings[0].repair.expected, undefined);
  assert.match(findings[0].repair.hint, /em dash/);
});

// The counter-case at check level, not only at parser level: a comment is the one place `--` is
// illegal, and a diagram using it in a label, a dash pattern, or a stylesheet must stay clean.
test('a double hyphen outside a comment produces no escaping findings', () => {
  const src = '<svg viewBox="0 0 90 20" width="90"><style>:root { --brand: #1e40af; }</style>'
    + '<path d="M1,2 L3,4" stroke-dasharray="4--4"/><text x="2" y="12" font-size="8">cost -- benefit</text></svg>';
  assert.deepEqual(runCheck(xmlEscaping, src), []);
});

test('a mismatched tag is an error with no repair receipt', () => {
  const findings = runCheck(xmlEscaping, '<svg viewBox="0 0 9 9" width="9"><g></rect></g></svg>');
  const m = findings.find((f) => f.code === 'mismatched-tag');
  assert.equal(m.severity, 'error');
  // this code has no entry in REPAIRS: no mechanical fix can be produced (which tag to add depends on context),
  // so repair must be null rather than an empty receipt.
  assert.equal(m.repair, null);
});

// Duplicate attribute name: XML is not well-formed, and the later value silently overwrites the earlier one.
// error level — it means an attribute value was discarded, and the discarded one may carry other problems.
test('a duplicate attribute name is an error', () => {
  const findings = runCheck(xmlEscaping, '<svg viewBox="0 0 60 40" width="60"><text data-k="a" data-k="b" x="5" y="20" font-size="12">t</text></svg>');
  assert.deepEqual(codes(findings), ['duplicate-attribute']);
  assert.equal(findings[0].severity, 'error');
  assert.match(findings[0].repair.hint, /silently wins/);
});

// Wiring test: every test above calls check.run() directly, so clearing the registry still passes —
// the CLI would then report 0 findings for the same file. This test uses lintSource to bring the registry into coverage.
test('the check is wired into the registry, so lintSource reports it', () => {
  const { findings } = lintSource('unescaped-ampersand.svg', fixture('fail/unescaped-ampersand.svg'));
  // only the findings from this check are kept: other checks in the registry also fire for this fixture
  // (its top margin is 62px); without filtering, adding any check would break this test, but all it needs to pin is "this check is wired in".
  assert.deepEqual(
    findings.filter((f) => f.check === 'xml-escaping').map((f) => [f.check, f.code, f.severity]),
    [['xml-escaping', 'unescaped-ampersand', 'error']],
  );
});
