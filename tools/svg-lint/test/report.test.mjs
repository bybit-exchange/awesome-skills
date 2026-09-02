// tools/svg-lint/test/report.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { error, warning, summarize } from '../lib/report.mjs';
import { CHECKS } from '../lib/registry.mjs';
import { lintSource } from '../lib/lint.mjs';
import { formatText } from '../lib/format-text.mjs';
import { formatJson } from '../lib/format-json.mjs';
import { docFrom, fixture } from './helpers/load.mjs';

test('error and warning stamp the severity', () => {
  assert.equal(error({ check: 'k', code: 'c', message: 'm' }).severity, 'error');
  assert.equal(warning({ check: 'k', code: 'c', message: 'm' }).severity, 'warning');
});

test('a finding defaults to line 1 column 1 and a null repair', () => {
  const f = warning({ check: 'k', code: 'c', message: 'm' });
  assert.equal(f.line, 1);
  assert.equal(f.column, 1);
  assert.equal(f.repair, null);
});

test('summarize counts by severity and exits 1 only on errors', () => {
  const withError = summarize([{ file: 'a.svg', findings: [error({ check: 'k', code: 'c', message: 'm' })] }]);
  assert.deepEqual(withError, { files: 1, errors: 1, warnings: 0, exitCode: 1 });
  const warnOnly = summarize([{ file: 'b.svg', findings: [warning({ check: 'k', code: 'c', message: 'm' })] }]);
  assert.deepEqual(warnOnly, { files: 1, errors: 0, warnings: 1, exitCode: 0 });
});

// The previous test has only a single-file sample, so hard-coding `files: results.length` as 1 still passes,
// yet this number goes directly into the JSON report's summary. A three-file configuration simultaneously
// pins cross-file accumulation: drop the findings of any one file and errors/warnings no longer add up.
test('summarize accumulates across every file, not just the first', () => {
  const one = (kind) => kind({ check: 'k', code: 'c', message: 'm' });
  const s = summarize([
    { file: 'a.svg', findings: [one(error), one(warning)] },
    { file: 'b.svg', findings: [one(warning)] },
    { file: 'c.svg', findings: [] },
  ]);
  assert.deepEqual(s, { files: 3, errors: 1, warnings: 2, exitCode: 1 });
});

test('every registered check has a unique id and a run function', () => {
  const ids = CHECKS.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const c of CHECKS) {
    assert.equal(typeof c.run, 'function');
    assert.equal(typeof c.title, 'string');
  }
});

test('the minimal fixture lints clean', () => {
  const { findings } = lintSource('minimal.svg', fixture('pass/minimal.svg'));
  assert.deepEqual(findings, [], `unexpected findings: ${JSON.stringify(findings, null, 2)}`);
});

test('document-model notes surface as warnings, not silent drops', () => {
  const src = '<svg viewBox="0 0 60 40" width="60"><g transform="rotate(15)"><rect x="4" y="6" width="9" height="12"/></g></svg>';
  const { findings } = lintSource('rot.svg', src);
  assert.ok(findings.some((f) => f.code === 'unsupported-transform' && f.severity === 'warning'));
});

// A model note's line/column must be propagated all the way through to the finding. The previous test only
// checked code and severity — dropping line/column (falling back to report's default 1:1) still produces
// a non-empty report, but every finding points to line 1 and cannot be used to locate the issue.
// Here <g> is at line 3, column 3.
test('a model note keeps the position of the offending element', () => {
  const src = [
    '<svg viewBox="0 0 80 60" width="80">',
    '  <rect x="4" y="6" width="20" height="12"/>',
    '  <g transform="rotate(15)"><rect x="4" y="30" width="9" height="12"/></g>',
    '</svg>',
  ].join('\n');
  const f = lintSource('rot.svg', src).findings.find((x) => x.code === 'unsupported-transform');
  assert.equal(f.line, 3);
  assert.equal(f.column, 3);
});

// The second argument passed to check modules is their only entry point to anything outside the model:
// xml-escaping reads ctx.parsed.errors, and a finding can name ctx.file. No check reads ctx.source today
// — the character-by-character scanning lives in parse-svg — so it is pinned here rather than by a
// caller. When ctx is an empty object, all checks silently degrade to "finds nothing" without erroring,
// and no assertion elsewhere can see that, so the whole contract is pinned here.
test('each check receives the raw source, the parse tree and the file name', () => {
  const seen = [];
  const spy = { id: 'spy', title: 'spy', run: (doc, ctx) => { seen.push(ctx); return []; } };
  CHECKS.push(spy);
  try {
    const src = fixture('pass/minimal.svg');
    lintSource('minimal.svg', src);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].file, 'minimal.svg');
    assert.equal(seen[0].source, src);
    assert.equal(seen[0].parsed.svg.tag, 'svg');
  } finally {
    CHECKS.pop();
  }
});

// A crash during parsing or model-building must also be downgraded to a finding and must not take down
// the process — otherwise no other file in the CLI run can be checked and CI sees only a stack trace.
// The trigger uses **real input** rather than stubs: `visit` is recursive, and deeply nested <g> elements
// overflow the call stack (around 5000 levels throws RangeError; 12000 is used here for a 2.4× safety
// margin, taking about 0.5s on this machine).
test('a crash while building the model is reported, not thrown', () => {
  const deep = `<svg viewBox="0 0 60 40" width="60">${'<g>'.repeat(12000)}<rect x="1" y="1" width="2" height="2"/>${'</g>'.repeat(12000)}</svg>`;
  let out;
  assert.doesNotThrow(() => { out = lintSource('deep.svg', deep); });
  assert.deepEqual(out.findings.map((f) => [f.code, f.severity]), [['model-crashed', 'error']]);
});

// severity must be pinned too: checking only code and message, downgrading to warning still passes,
// but a warning leaves the exit code at 0 — CI receives a success signal even though a check did not run.
// Same level as model-crashed: both mean a conclusion is missing.
test('a crashing check is reported as an error, never swallowed', () => {
  const boom = { id: 'boom', title: 'boom', run() { throw new Error('kaboom'); } };
  CHECKS.push(boom);
  try {
    const { findings } = lintSource('minimal.svg', fixture('pass/minimal.svg'));
    const crash = findings.find((f) => f.code === 'check-crashed');
    assert.equal(crash.severity, 'error');
    assert.equal(crash.check, 'boom');
    assert.match(crash.message, /kaboom/);
  } finally {
    CHECKS.pop();
  }
});

// This test covers only the renderer: it must emit findings in the order it is given and must not reorder
// them (sorting is lintSource's responsibility, see the next test). The name must make the layer under test
// explicit — the original name was "findings come back sorted by position", but lintSource was not called
// at all, so the `findings.sort(...)` line had never been executed.
test('formatText preserves the order it is given', () => {
  const results = [{
    file: 'x.svg',
    findings: [
      warning({ check: 'k', code: 'late', message: 'm', line: 9, column: 1 }),
      error({ check: 'k', code: 'early', message: 'm', line: 2, column: 4 }),
    ],
  }];
  assert.match(formatText(results, {}), /late[\s\S]*early/);
});

// Testing lintSource's sorting properly: temporarily register a check that emits findings out of order.
// The sort key has three levels (line → column → check id); all three must have distinguishing samples,
// otherwise an implementation that sorts by line only still passes.
test('lintSource sorts findings by line, then column, then check id', () => {
  const jumble = {
    id: 'zzz',
    title: 'jumble',
    run: () => [
      warning({ check: 'zzz', code: 'd', message: 'm', line: 9, column: 1 }),
      warning({ check: 'zzz', code: 'b', message: 'm', line: 2, column: 7 }),
      warning({ check: 'zzz', code: 'a', message: 'm', line: 2, column: 3 }),
    ],
  };
  const alpha = {
    id: 'aaa',
    title: 'alpha',
    // same line and column as zzz's 'b', only check id can order them
    run: () => [warning({ check: 'aaa', code: 'c', message: 'm', line: 2, column: 7 })],
  };
  CHECKS.push(jumble, alpha);
  try {
    const { findings } = lintSource('minimal.svg', fixture('pass/minimal.svg'));
    assert.deepEqual(findings.map((f) => f.code), ['a', 'c', 'b', 'd']);
  } finally {
    CHECKS.length -= 2;
  }
});

test('formatText marks a clean file and reports the tally', () => {
  const out = formatText([{ file: 'ok.svg', findings: [] }], {});
  assert.match(out, /✓ ok\.svg/);
  assert.match(out, /1 file\(s\), 0 error\(s\), 0 warning\(s\)/);
});

test('formatText shouts when only warnings are present', () => {
  const out = formatText([{ file: 'w.svg', findings: [warning({ check: 'k', code: 'c', message: 'm' })] }], {});
  assert.match(out, /WARNINGS PRESENT/);
});

test('formatText --quiet hides warnings but still counts them', () => {
  const out = formatText([{ file: 'w.svg', findings: [warning({ check: 'k', code: 'c', message: 'm' })] }], { quiet: true });
  assert.doesNotMatch(out, /\bwarning\b\s{2}/);
  // a negation assertion alone is not enough: an empty string also passes it. This positive assertion
  // pins "after the only finding is hidden, this file renders as a clean file" and proves the output is still there.
  assert.match(out, /✓ w\.svg/);
  assert.match(out, /0 error\(s\), 1 warning\(s\)/);
});

test('formatText prints the repair receipt', () => {
  const f = error({
    check: 'arrow-marker', code: 'marker-refx-mismatch', message: 'm',
    repair: { attribute: 'refX', actual: '0', expected: '2', hint: 'notch alignment' },
  });
  assert.match(formatText([{ file: 'r.svg', findings: [f] }], {}), /refX: 0 → 2 · notch alignment/);
});

// The purpose of this banner is to explain "exit code 0 but still not house-style compliant". Once there
// is an error, the exit code is already 1, and the banner would read as if the error had been downgraded
// to a warning. Removing `errors === 0` from the condition causes no test to go red — because no sample
// had both severity levels before.
test('the WARNINGS PRESENT banner is only for the errors-free case', () => {
  const out = formatText([{
    file: 'both.svg',
    findings: [
      error({ check: 'k', code: 'e', message: 'm' }),
      warning({ check: 'k', code: 'w', message: 'm' }),
    ],
  }], {});
  assert.doesNotMatch(out, /WARNINGS PRESENT/);
  assert.match(out, /1 file\(s\), 1 error\(s\), 1 warning\(s\)/);
});

// The entire line is pinned verbatim. Every segment of this line is easy to get wrong without any other
// test catching it: line and column swapped, [check/code] segments swapped, error and warning labels swapped.
// It is the only positioning information for humans and editors, and is the key used when grepping reports.
// line and column deliberately have different values; otherwise swapping them is undetectable.
test('a finding renders as position, severity, message and check/code', () => {
  const out = formatText([{
    file: 'x.svg',
    findings: [
      error({ check: 'box-height', code: 'too-short', message: 'Box is 30 tall', line: 7, column: 21 }),
      warning({ check: 'palette', code: 'off-palette', message: 'Odd blue', line: 9, column: 3 }),
    ],
  }], {});
  const lines = out.split('\n');
  assert.ok(lines.includes('  7:21  error    Box is 30 tall  [box-height/too-short]'), out);
  assert.ok(lines.includes('  9:3  warning  Odd blue  [palette/off-palette]'), out);
});

// The two repair branches: with attribute takes the previous test's path, without takes this one. Not every
// repair targets a specific attribute (e.g. "this connector is missing 12px of clearance overall"), and this
// branch could have been deleted without causing any test to go red.
test('a repair with no specific attribute still prints its before → after', () => {
  const f = error({
    check: 'connector-geometry', code: 'gap-too-small', message: 'm',
    repair: { actual: '2px gap', expected: '12px gap' },
  });
  assert.match(formatText([{ file: 'r.svg', findings: [f] }], {}), /^\s+repair: 2px gap → 12px gap$/m);
});

test('formatJson emits a parseable envelope', () => {
  const results = [{ file: 'j.svg', findings: [warning({ check: 'k', code: 'c', message: 'm' })] }];
  const parsed = JSON.parse(formatJson(results, summarize(results)));
  assert.equal(parsed.tool, 'svg-lint');
  assert.equal(parsed.summary.warnings, 1);
  assert.equal(parsed.files[0].findings[0].code, 'c');
});

test('the background rect is excluded from content geometry', () => {
  const { doc } = docFrom(fixture('pass/minimal.svg'));
  // identified by geometry (area ≥ 98% of viewBox), not by colour — any rect covering the viewBox qualifies
  assert.equal(doc.backgroundRect.width, 272);
  assert.equal(doc.backgroundRect.height, 120);
  assert.equal(doc.contentRects.length, 2);
  assert.equal(doc.contentBBox.minX, 22);   // the background rect is at x=0; if mixed in this would become 0
  assert.equal(doc.contentBBox.maxX, 250);
});
