// tools/svg-lint/test/checks/font-stack.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fontStack } from '../../lib/checks/font-stack.mjs';
import { lintSource } from '../../lib/lint.mjs';
import { runCheck, fixture, codes } from '../helpers/load.mjs';

test('the clean fixture declares the full stack in order', () => {
  assert.deepEqual(runCheck(fontStack, fixture('pass/minimal.svg')), []);
});

test('dropping Noto Sans CJK SC is an error', () => {
  const findings = runCheck(fontStack, fixture('fail/missing-noto.svg'));
  assert.deepEqual(codes(findings), ['font-missing-from-stack']);
  const missing = findings[0];
  assert.equal(missing.severity, 'error');
  assert.match(missing.message, /Noto Sans CJK SC/);
  // assert the full hint text rather than /Linux/: both hint branches contain "Linux"; a regex match
  // cannot distinguish them, so replacing the Noto-specific branch with the generic one still passes.
  assert.equal(missing.repair.hint, 'without it, Linux server-side rendering falls back to a font with no CJK coverage');
  // repair.expected is the full stack meant to be copied directly into the SVG; it must be asserted
  // verbatim, otherwise no one enforces what it says.
  assert.equal(missing.repair.expected, "'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', system-ui, sans-serif");
  assert.equal(missing.repair.attribute, 'font-family');
  // a finding on a style rule is reported at the <svg> node (line 2 here; line 1 is the path comment).
  // without pinning the position, an implementation that hard-codes 1:1 goes unnoticed.
  assert.equal(missing.line, 2);
  assert.equal(missing.column, 1);
});

// exercises the other hint branch. when the missing family is not Noto, the Linux tofu explanation
// must not be copied; this test is also the only coverage of the else branch.
test('a family other than Noto going missing gets the generic hint', () => {
  const src = `<svg viewBox="0 0 60 40" width="60">
  <style>text { font-family: 'PingFang SC', 'Noto Sans CJK SC', sans-serif; }</style>
  <text x="9" y="21" font-size="12">hi</text>
</svg>`;
  const findings = runCheck(fontStack, src);
  assert.deepEqual(codes(findings), ['font-missing-from-stack']);
  assert.match(findings[0].message, /Microsoft YaHei/);
  assert.equal(findings[0].repair.hint, 'the stack must cover macOS, Windows and Linux');
  assert.equal(findings[0].repair.actual, "'PingFang SC', 'Noto Sans CJK SC', sans-serif");
});

test('no style block at all is an error when the document has text', () => {
  const src = '<svg viewBox="0 0 60 40" width="60"><text x="9" y="21" font-size="12">hi</text></svg>';
  const findings = runCheck(fontStack, src);
  assert.deepEqual(codes(findings), ['missing-font-stack']);
  assert.equal(findings[0].severity, 'error');
  // repair must give a verbatim stack that can be copied in; otherwise the reader knows something is
  // missing but not what to write. the value is hard-coded as a literal rather than imported from the
  // module as CANONICAL — importing it makes both sides share the same source, so changing the constant still passes.
  assert.equal(findings[0].repair.expected, "'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', system-ui, sans-serif");
  // actual and hint must likewise be asserted verbatim; otherwise no one enforces what they say.
  assert.equal(findings[0].repair.actual, 'absent');
  assert.equal(findings[0].repair.hint, 'SKILL.md marks this non-negotiable');
  assert.equal(findings[0].repair.attribute, 'font-family');
});

test('a document with no text needs no font stack', () => {
  const src = '<svg viewBox="0 0 60 40" width="60"><rect x="20" y="10" width="20" height="20"/></svg>';
  assert.deepEqual(runCheck(fontStack, src), []);
});

test('the wrong fallback order is an error', () => {
  const src = `<svg viewBox="0 0 60 40" width="60">
  <style>text { font-family: 'Noto Sans CJK SC', 'PingFang SC', 'Microsoft YaHei', sans-serif; }</style>
  <text x="9" y="21" font-size="12">hi</text>
</svg>`;
  const findings = runCheck(fontStack, src);
  // find() hides extra findings; deepEqual also pins "exactly this one, no extras".
  assert.deepEqual(codes(findings), ['font-stack-out-of-order']);
  const f = findings[0];
  assert.equal(f.severity, 'error');
  // repair.expected is the full stack meant to be copied directly into the SVG; it must be asserted
  // verbatim, otherwise no one enforces what it says.
  assert.equal(f.repair.expected, "'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', system-ui, sans-serif");
  // hint is null (out of order but nothing missing); it must be asserted, otherwise it can be set to
  // anything without anyone noticing.
  assert.equal(f.repair.hint, null);
  assert.equal(f.repair.attribute, 'font-family');
});

test('double-quoted family names are accepted', () => {
  const src = `<svg viewBox="0 0 60 40" width="60">
  <style>text { font-family: "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif; }</style>
  <text x="9" y="21" font-size="12">hi</text>
</svg>`;
  assert.deepEqual(runCheck(fontStack, src), []);
});

test('a per-element font-family override that drops Noto is an error', () => {
  const src = `<svg viewBox="0 0 60 40" width="60">
  <style>text { font-family: 'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif; }</style>
  <text x="9" y="21" font-size="12" font-family="Helvetica">hi</text>
</svg>`;
  const findings = runCheck(fontStack, src);
  // find() hides extra findings; deepEqual also pins "exactly three, no extras".
  assert.deepEqual(codes(findings), ['font-missing-from-stack', 'font-missing-from-stack', 'font-missing-from-stack']);
  // the position must fall on the <text> line, not the <svg> line:
  // hard-coding t.line/t.column as 1/1 puts all three on line 1; column must be pinned to distinguish the two.
  assert.equal(findings[0].line, 3);
  assert.equal(findings[0].column, 3);
});

// ── The following tests pin several points along the "effective font" path that easily degrade into
// false negatives: ancestor inheritance, inline style vs. attribute priority, and deduplication
// signatures. each comment states which kind of diagram would be missed without it.

// inheritance from an ancestor <g font-family>: the element itself has no attribute, but an ancestor
// sets a non-compliant font.
// without this test: switching to only check t.element.attrs['font-family'] still passes, making ancestor inheritance a dead letter.
test('a font-family inherited from an ancestor <g> is caught', () => {
  const src = `<svg viewBox="0 0 60 40" width="60">
  <style>text { font-family: 'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', system-ui, sans-serif; }</style>
  <g font-family="Helvetica">
    <text x="9" y="21" font-size="12">hi</text>
  </g>
</svg>`;
  const findings = runCheck(fontStack, src);
  // "Helvetica" is missing three CJK families; exactly three font-missing-from-stack findings are
  // expected (rather than using some to hide the count).
  // the position must fall on <text> (line 4, column 5), not <svg>;
  // without pinning column, hard-coding t.column as 1 still passes.
  assert.deepEqual(codes(findings), ['font-missing-from-stack', 'font-missing-from-stack', 'font-missing-from-stack']);
  assert.equal(findings[0].line, 4);
  assert.equal(findings[0].column, 5);
});

// deduplication: when both the style rule and the <g> carry the same non-compliant stack, the
// normalised signatures are equal, so only one set of findings is reported (2 missing families), not 4.
// stacks equivalent up to spacing are also counted as one — removing deduplication makes an extra
// space report the same problem a second time.
// without this test: old code using strict string equality produces 4 findings under extra spacing, while this test asserts 2.
test('a text inheriting the same stack from an ancestor <g> is not double-reported', () => {
  // exact equivalence: style and <g> have identical strings
  {
    const src = `<svg viewBox="0 0 60 40" width="60">
  <style>text { font-family: 'PingFang SC', sans-serif; }</style>
  <g font-family="'PingFang SC', sans-serif">
    <text x="9" y="21" font-size="12">hi</text>
  </g>
</svg>`;
    assert.deepEqual(codes(runCheck(fontStack, src)), ['font-missing-from-stack', 'font-missing-from-stack']);
  }
  // stacks equivalent up to spacing are also reported only once
  {
    const src = `<svg viewBox="0 0 60 40" width="60">
  <style>text { font-family: 'PingFang SC', sans-serif; }</style>
  <g font-family="'PingFang SC',  sans-serif">
    <text x="9" y="21" font-size="12">hi</text>
  </g>
</svg>`;
    assert.deepEqual(codes(runCheck(fontStack, src)), ['font-missing-from-stack', 'font-missing-from-stack']);
  }
});

// CSS family matching is ASCII case-insensitive: an all-lowercase stack is valid; reporting it as
// missing is a false positive.
// without this test: case-sensitive indexOf cannot find 'pingfang sc' against 'PingFang SC' and reports 3 errors.
test('lowercase family names are accepted as equivalent', () => {
  const src = `<svg viewBox="0 0 60 40" width="60">
  <style>text { font-family: 'pingfang sc', 'microsoft yahei', 'noto sans cjk sc', sans-serif; }</style>
  <text x="9" y="21" font-size="12">hi</text>
</svg>`;
  assert.deepEqual(runCheck(fontStack, src), []);
});

// 'Microsoft YaHei UI' is a different family and must not count as 'Microsoft YaHei'. substring
// indexOf on the raw string would hit the 'Microsoft YaHei' position for 'Microsoft YaHei UI',
// making the later genuine YaHei look "earlier", causing a correctly-ordered stack to be reported
// as out-of-order. token comparison is not fooled by this variant.
test("'Microsoft YaHei UI' variant does not displace the YaHei position check", () => {
  const src = `<svg viewBox="0 0 60 40" width="60">
  <style>text { font-family: 'Microsoft YaHei UI', 'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif; }</style>
  <text x="9" y="21" font-size="12">hi</text>
</svg>`;
  assert.deepEqual(runCheck(fontStack, src), []);
});

// unquoted family names are also valid: stripping quotes must be "strip if present", not "require present".
// without this test: if the unquoting logic errors on unquoted tokens, this is the only assertion that notices.
test('unquoted family names are accepted', () => {
  const src = `<svg viewBox="0 0 60 40" width="60">
  <style>text { font-family: PingFang SC, Microsoft YaHei, Noto Sans CJK SC, sans-serif; }</style>
  <text x="9" y="21" font-size="12">hi</text>
</svg>`;
  assert.deepEqual(runCheck(fontStack, src), []);
});

// ── The following tests cover three categories of false positives / false negatives: XML entities,
// CSS global keywords, and fan-out deduplication.

// ── False positive 1 (XML entities): parse-svg preserves attribute text without decoding; `&quot;`
// is the only valid way to write a double-quote inside a double-quoted attribute. without decoding,
// a compliant stack is reported as "missing three families" — a false positive.
test('XML entity-encoded family names in a <g> are decoded and accepted', () => {
  const src = `<svg viewBox="0 0 60 40" width="60">
  <style>text { font-family: 'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif; }</style>
  <g font-family="&quot;PingFang SC&quot;, &quot;Microsoft YaHei&quot;, &quot;Noto Sans CJK SC&quot;, sans-serif">
    <text x="9" y="21" font-size="12">hi</text>
  </g>
</svg>`;
  assert.deepEqual(runCheck(fontStack, src), []);
});

// ── False positive 2 (CSS global keywords): `inherit` / `initial` are not font names; the
// effective value comes from the ancestor or style rule.
// without this test: treating them as font names reports "missing three families" on a compliant
// diagram — a false positive.
test('CSS-wide keywords like inherit and initial are not treated as font names', () => {
  const stack = "'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif";
  const src = `<svg viewBox="0 0 60 40" width="60">
  <style>text { font-family: ${stack}; }</style>
  <text x="9" y="21" font-size="12" font-family="inherit">a</text>
  <text x="9" y="31" font-size="12" font-family="initial">b</text>
</svg>`;
  assert.deepEqual(runCheck(fontStack, src), []);
});

// CSS keywords are case-insensitive; without normalising before comparison, `INHERIT` is treated as
// a font name and a fully compliant diagram gets three font-missing-from-stack findings — a false positive.
// `INHERIT`, `Inherit`, and ` inherit ` (with leading/trailing spaces) are all valid CSS keywords.
test('CSS-wide keywords are matched case-insensitively and with whitespace trimmed', () => {
  const stack = "'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif";
  const src = `<svg viewBox="0 0 60 40" width="60">
  <style>text { font-family: ${stack}; }</style>
  <text x="9" y="21" font-size="12" font-family="INHERIT">a</text>
  <text x="9" y="31" font-size="12" font-family="Inherit">b</text>
  <text x="9" y="41" font-size="12" font-family=" inherit ">c</text>
</svg>`;
  assert.deepEqual(runCheck(fontStack, src), []);
});

// ── False positive 3 (fan-out deduplication): when a <g> contains N <text> elements, the same
// non-compliant value is reported only once, at the first occurrence.
// without this test: removing deduplication produces 12 findings (4 texts × 3 missing families).
test('a <g> with N child texts fires findings only once, at the first text', () => {
  const src = `<svg viewBox="0 0 60 40" width="60">
  <style>text { font-family: 'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif; }</style>
  <g font-family="Helvetica">
    <text x="9" y="21" font-size="12">a</text>
    <text x="9" y="31" font-size="12">b</text>
    <text x="9" y="41" font-size="12">c</text>
    <text x="9" y="51" font-size="12">d</text>
  </g>
</svg>`;
  const findings = runCheck(fontStack, src);
  assert.deepEqual(codes(findings), ['font-missing-from-stack', 'font-missing-from-stack', 'font-missing-from-stack']);
  // all three findings fall on the first <text> (line 4, column 5), not spread across four elements
  assert.ok(findings.every((f) => f.line === 4 && f.column === 5));
});

// signature deduplication uses comma-separated tokens to prevent two different stacks from
// colliding to the same string:
// 'Arial, Black' (tokens normalised to ['arial','black']) and 'ArialBlack' (single token ['arialblack'])
// have different signatures; both are non-compliant and should each produce 3 font-missing-from-stack
// findings, 6 in total.
// switching to join('') makes both signatures 'arialblack', the second set is swallowed, silently
// missing 3 findings.
test('stacks whose tokens join-concatenate identically are not de-duped', () => {
  const src = `<svg viewBox="0 0 60 40" width="60">
  <style>text { font-family: Arial, Black; }</style>
  <g font-family="ArialBlack">
    <text x="9" y="21" font-size="12">hi</text>
  </g>
</svg>`;
  const findings = runCheck(fontStack, src);
  assert.deepEqual(codes(findings), [
    'font-missing-from-stack', 'font-missing-from-stack', 'font-missing-from-stack',
    'font-missing-from-stack', 'font-missing-from-stack', 'font-missing-from-stack',
  ]);
  // the first 3 findings come from the style rule, position at <svg> (line 1, column 1)
  assert.ok(findings.slice(0, 3).every((f) => f.line === 1 && f.column === 1));
  // the last 3 findings come from the <text> inside <g> (line 4, column 5, 4-space indent)
  assert.ok(findings.slice(3).every((f) => f.line === 4 && f.column === 5));
});

// ── counter-example to over-suppression: when two <text> elements each carry a different bad
// value, both must be reported.
// without this test: writing deduplication as "once any bad value is reported, never report a new
// one" still passes.
test('two texts carrying different bad values each get their own findings', () => {
  const src = `<svg viewBox="0 0 60 40" width="60">
  <style>text { font-family: 'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif; }</style>
  <text x="9" y="21" font-size="12" font-family="Helvetica">a</text>
  <text x="9" y="31" font-size="12" font-family="Arial">b</text>
</svg>`;
  const findings = runCheck(fontStack, src);
  assert.equal(findings.length, 6);
  // the two sets of line numbers are distinct, proving the two bad values are each reported independently
  const lines = new Set(findings.map((f) => f.line));
  assert.equal(lines.size, 2);
});

// ── when a family name appears more than once, the first occurrence is used for order checking:
// `indexOf` picks the first, `lastIndexOf` picks the last.
// 'Microsoft YaHei' is at positions 0 and 2 here; `lastIndexOf` picks 2, making the order look
// correct — incorrectly reported as passing.
// CSS tries fonts in order; only the first occurrence is the effective position, so this stack
// genuinely is out of order.
test('duplicate family names use the first occurrence for order checking', () => {
  const src = `<svg viewBox="0 0 60 40" width="60">
  <style>text { font-family: 'Microsoft YaHei', 'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif; }</style>
  <text x="9" y="21" font-size="12">hi</text>
</svg>`;
  assert.deepEqual(codes(runCheck(fontStack, src)), ['font-stack-out-of-order']);
});

// wiring test: all tests above call check.run() directly; removing this check from the registry
// still passes them all.
// filter is needed — missing-noto.svg has a top margin of 62px, and viewbox-clipping also fires on it.
test('the check is wired into the registry, so lintSource reports it', () => {
  const { findings } = lintSource('missing-noto.svg', fixture('fail/missing-noto.svg'));
  assert.deepEqual(
    findings.filter((f) => f.check === 'font-stack').map((f) => f.code),
    ['font-missing-from-stack'],
  );
});

// ── The following tests cover the CSS parsing path end-to-end: inline style inheritance,
// at-rule stripping, last-wins for duplicate rules, !important stripping, empty-string guard,
// and CSS global keywords in the style rule.

// text wrapped by `<g style="font-family:Helvetica">` inherits the inline style; the effective
// value is Helvetica.
// without this test: checking only el.attrs['font-family'] cannot reach the inline style inheritance
// path, silently missing three findings.
test('a font-family set via inline style on a wrapping <g> is caught', () => {
  const src = `<svg viewBox="0 0 60 40" width="60">
  <style>text { font-family: 'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif; }</style>
  <g style="font-family: Helvetica">
    <text x="9" y="21" font-size="12">hi</text>
  </g>
</svg>`;
  const findings = runCheck(fontStack, src);
  assert.deepEqual(codes(findings), ['font-missing-from-stack', 'font-missing-from-stack', 'font-missing-from-stack']);
  // falls on the <text> line (line 4), not <svg> (line 1)
  assert.equal(findings[0].line, 4);
  assert.equal(findings[0].column, 5);
});

// inline style written directly on the <text> itself, not inherited from an ancestor.
// without this test: fixing only the ancestor inheritance path leaves the direct inline style
// path unhandled, silently missing three findings.
test('a font-family set via inline style directly on <text> is caught', () => {
  const src = `<svg viewBox="0 0 60 40" width="60">
  <style>text { font-family: 'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif; }</style>
  <text x="9" y="21" font-size="12" style="font-family: Helvetica">hi</text>
</svg>`;
  const findings = runCheck(fontStack, src);
  assert.deepEqual(codes(findings), ['font-missing-from-stack', 'font-missing-from-stack', 'font-missing-from-stack']);
  assert.equal(findings[0].line, 3);
  assert.equal(findings[0].column, 3);
});

// inline style takes priority over the presentation attribute (CSS specification): when both are
// present, inline style wins.
// without this test: if priority is reversed (attribute read before style), the presentation
// attribute is the compliant stack and inline style is Helvetica — three findings missed, all green.
test('inline style wins over the presentation attribute when both are set', () => {
  const src = `<svg viewBox="0 0 60 40" width="60">
  <style>text { font-family: 'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif; }</style>
  <text x="9" y="21" font-size="12" font-family="'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif" style="font-family: Helvetica">hi</text>
</svg>`;
  const findings = runCheck(fontStack, src);
  assert.deepEqual(codes(findings), ['font-missing-from-stack', 'font-missing-from-stack', 'font-missing-from-stack']);
});

// the <style> rule is non-compliant (Helvetica), but the <g> inline style is the compliant stack.
// the text's effective value is the compliant stack, so no finding on the text; the style rule
// itself is non-compliant, with the finding at the <svg> position.
test('a bad <style> rule with a good <g style=...> produces findings at the style rule position', () => {
  const src = `<svg viewBox="0 0 60 40" width="60">
  <style>text { font-family: Helvetica; }</style>
  <g style="font-family: 'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif">
    <text x="9" y="21" font-size="12">hi</text>
  </g>
</svg>`;
  const findings = runCheck(fontStack, src);
  assert.deepEqual(codes(findings), ['font-missing-from-stack', 'font-missing-from-stack', 'font-missing-from-stack']);
  // the style rule finding falls at <svg> (line 1), not at the text inside <g> (line 4)
  assert.equal(findings[0].line, 1);
  assert.equal(findings[0].column, 1);
});

// a @media block is not an unconditional rule; a compliant diagram must not get three false
// positives because of serif inside @media.
// without this test: without stripping the at-rule block, serif is treated as the sole declaration,
// and the compliant diagram gets three font-missing-from-stack findings.
test('@media block is ignored when a top-level text rule declares the correct stack', () => {
  const src = `<svg viewBox="0 0 60 40" width="60">
  <style>@media print { text { font-family: serif; } } text { font-family: 'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif; }</style>
  <text x="9" y="21" font-size="12">hi</text>
</svg>`;
  assert.deepEqual(runCheck(fontStack, src), []);
});

// @media placed after the main text rule: without this test, an implementation that only strips the
// first at-rule block passes for "@media before" but misses the case where it comes after.
test('@media block placed after the main text rule is also ignored', () => {
  const src = `<svg viewBox="0 0 60 40" width="60">
  <style>text { font-family: 'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif; } @media print { text { font-family: serif; } }</style>
  <text x="9" y="21" font-size="12">hi</text>
</svg>`;
  assert.deepEqual(runCheck(fontStack, src), []);
});

// nested at-rules (@supports wrapping @media): incorrect bracket depth leaves the block
// incompletely stripped, and serif leaks out causing a false positive.
test('deeply nested at-rule blocks are fully stripped', () => {
  const src = `<svg viewBox="0 0 60 40" width="60">
  <style>@supports (color: red) { @media print { text { font-family: serif; } } } text { font-family: 'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif; }</style>
  <text x="9" y="21" font-size="12">hi</text>
</svg>`;
  assert.deepEqual(runCheck(fontStack, src), []);
});

// @import has no block and ends with a semicolon: without separate handling it is treated as
// ordinary content and the following rule is not read.
// without this test: the @import path has no explicit coverage (this test passes already, but the
// coverage is intentionally kept).
test('@import at-rule without a block does not block the following text rule', () => {
  const src = `<svg viewBox="0 0 60 40" width="60">
  <style>@import url("base.css"); text { font-family: 'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif; }</style>
  <text x="9" y="21" font-size="12">hi</text>
</svg>`;
  assert.deepEqual(runCheck(fontStack, src), []);
});

// CSS cascade takes the last declaration: the same selector written twice with the second being
// non-compliant; an implementation that takes the first (compliant) silently misses three findings.
// without this test: an implementation that only reads the first text{} rule still passes.
test('when the text rule appears twice the last one wins — bad-last reports 3 findings', () => {
  const src = `<svg viewBox="0 0 60 40" width="60">
  <style>text { font-family: 'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif; } text { font-family: Helvetica; }</style>
  <text x="9" y="21" font-size="12">hi</text>
</svg>`;
  assert.deepEqual(codes(runCheck(fontStack, src)), ['font-missing-from-stack', 'font-missing-from-stack', 'font-missing-from-stack']);
});

// the reverse direction is also pinned: when the good value is last, the result should be compliant.
// without this test: changing "last wins" to "last compliant wins" also passes the previous test,
// making the two implementations indistinguishable.
test('when the text rule appears twice the last one wins — good-last is clean', () => {
  const src = `<svg viewBox="0 0 60 40" width="60">
  <style>text { font-family: Helvetica; } text { font-family: 'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif; }</style>
  <text x="9" y="21" font-size="12">hi</text>
</svg>`;
  assert.deepEqual(runCheck(fontStack, src), []);
});

// `!important` is not a font name; leaving it in prevents stripping the trailing quote from the
// last family name, causing a compliant diagram to get three false positives.
test('!important suffix in font-family value is stripped so the stack passes', () => {
  const src = `<svg viewBox="0 0 60 40" width="60">
  <style>text { font-family: 'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC' !important; }</style>
  <text x="9" y="21" font-size="12">hi</text>
</svg>`;
  assert.deepEqual(runCheck(fontStack, src), []);
});

// an empty font-family value is equivalent to no declaration: it must not be compared as a font
// name, otherwise familyTokens('') produces [''], all three families are reported missing — three
// false positives.
test('an empty font-family attribute on text is treated as absent', () => {
  const src = `<svg viewBox="0 0 60 40" width="60">
  <style>text { font-family: 'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif; }</style>
  <text x="9" y="21" font-size="12" font-family="">hi</text>
</svg>`;
  assert.deepEqual(runCheck(fontStack, src), []);
});

// pure whitespace is handled the same way: ' '.trim() === '' must be checked before comparing with null.
test('a whitespace-only font-family attribute on text is treated as absent', () => {
  const src = `<svg viewBox="0 0 60 40" width="60">
  <style>text { font-family: 'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif; }</style>
  <text x="9" y="21" font-size="12" font-family="   ">hi</text>
</svg>`;
  assert.deepEqual(runCheck(fontStack, src), []);
});

// a CSS global keyword (inherit) in the `<style>` rule is not a font stack: it should report
// missing-font-stack, not three "missing family" findings. repair.actual shows the keyword so the
// reader knows what is currently written.
// without this test: if the keyword guard is only added to the per-text side, the style rule side
// is missed, producing three false positives of font-missing-from-stack.
test('a CSS-wide keyword in the <style> rule triggers missing-font-stack with actual showing the keyword', () => {
  const src = `<svg viewBox="0 0 60 40" width="60">
  <style>text { font-family: inherit; }</style>
  <text x="9" y="21" font-size="12">hi</text>
</svg>`;
  const findings = runCheck(fontStack, src);
  assert.deepEqual(codes(findings), ['missing-font-stack']);
  assert.equal(findings[0].repair.actual, 'inherit');
});

// unset, revert, and revert-layer are valid CSS global keywords and, like inherit/initial, are not
// font names. removing these three from the guard set leaves text using these keywords without
// assertion coverage, treating them as font names and producing three false positives of
// font-missing-from-stack. this test group is the only explicit coverage of these three keywords.
test('unset, revert, and revert-layer on a text element are not treated as font names', () => {
  for (const kw of ['unset', 'revert', 'revert-layer']) {
    const src = `<svg viewBox="0 0 60 40" width="60">
  <style>text { font-family: 'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif; }</style>
  <text x="9" y="21" font-size="12" font-family="${kw}">hi</text>
</svg>`;
    assert.deepEqual(runCheck(fontStack, src), [], kw);
  }
});

test('a CSS-wide keyword in upper case is still not a font stack', () => {
  // CSS keywords are case-insensitive. without normalisation, INHERIT is compared as a font name,
  // producing three "missing family" findings pointing at something that cannot be changed, rather
  // than the actionable missing-font-stack.
  const src = `<svg viewBox="0 0 60 40" width="60">
    <style>text { font-family: INHERIT; }</style>
    <text x="9" y="21" font-size="12">hi</text>
  </svg>`;
  const findings = runCheck(fontStack, src);
  assert.deepEqual(codes(findings), ['missing-font-stack']);
  assert.equal(findings[0].repair.actual, 'INHERIT');
});

// end-to-end: the compliant stack written on `<text>` as an inline style using XML entity encoding
// (double-quotes as `&quot;`), the same stack in `<style>` using single quotes. font-stack zero findings.
// without decoding first, `&quot;` ends with `;`, the family name is truncated to `&quot`, its
// signature differs from the style rule's, producing three font-missing-from-stack findings; after
// decoding the signatures match, deduplication fires, zero findings.
test('an inline style with entity-encoded font family on <text> produces no font-stack findings', () => {
  const src = `<svg viewBox="0 0 60 40" width="60">
    <style>text { font-family: 'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif; }</style>
    <text x="9" y="21" font-size="12" style="font-family: &quot;PingFang SC&quot;, &quot;Microsoft YaHei&quot;, &quot;Noto Sans CJK SC&quot;, sans-serif">hi</text>
  </svg>`;
  assert.deepEqual(codes(lintSource('test.svg', src).findings.filter((f) => f.check === 'font-stack')), []);
});

// a family name may contain a comma (the whole quoted string is the name). splitting on bare commas
// would split it into two tokens, making the fragment in `'X,Noto Sans CJK SC'` look like a real
// Noto positioned before PingFang, reporting a correctly-ordered stack as out-of-order — a false positive.
test('a comma inside a quoted family name does not split it into two families', () => {
  const src = `<svg viewBox="0 0 60 40" width="60">
  <style>text { font-family: 'X,Noto Sans CJK SC', 'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif; }</style>
  <text x="9" y="21" font-size="12">hi</text>
</svg>`;
  assert.deepEqual(runCheck(fontStack, src), []);
});

// a stack inside `var()` does not count as declaring a font stack: the value of a custom property
// is not in this document, the tool cannot see it, and therefore cannot determine what `--x`
// actually is. the three required families are therefore each reported as missing ("not visible").
// this is an explicit boundary this tool draws (CSS escapes are likewise not decoded); house style
// requires a literal stack.
// without this test: an implementation that treats the stack inside `var(--x, …)` as a real
// declaration still passes, but that implementation would let through a diagram with unrenderable
// CJK text when `--x` is actually set to a different font.
test('a stack inside var() is not a declared font stack because custom properties are not resolved', () => {
  const src = `<svg viewBox="0 0 60 40" width="60">
  <style>text { font-family: var(--x, 'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif); }</style>
  <text x="9" y="21" font-size="12">hi</text>
</svg>`;
  assert.deepEqual(codes(runCheck(fontStack, src)), ['font-missing-from-stack', 'font-missing-from-stack', 'font-missing-from-stack']);
});

// the false-negative direction of the same pitfall, and also a common typo form: the entire stack
// is wrapped in one pair of quotes, making it a single family named
// `PingFang SC, Microsoft YaHei, Noto Sans CJK SC` — a nonexistent font; the browser falls back
// to sans-serif and CJK still renders as tofu on Linux. splitting on bare commas would recognise
// all three as present and pass.
test('a stack wrapped entirely in one pair of quotes is one nonexistent family, not three', () => {
  const src = `<svg viewBox="0 0 60 40" width="60">
  <style>text { font-family: 'PingFang SC, Microsoft YaHei, Noto Sans CJK SC', sans-serif; }</style>
  <text x="9" y="21" font-size="12">hi</text>
</svg>`;
  assert.deepEqual(codes(runCheck(fontStack, src)), ['font-missing-from-stack', 'font-missing-from-stack', 'font-missing-from-stack']);
});
