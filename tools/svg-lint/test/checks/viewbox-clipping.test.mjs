// tools/svg-lint/test/checks/viewbox-clipping.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { viewboxClipping } from '../../lib/checks/viewbox-clipping.mjs';
import { lintSource } from '../../lib/lint.mjs';
import { runCheck, fixture, hasCode, codes } from '../helpers/load.mjs';

test('the clean fixture has 22/22/20/22 margins and passes', () => {
  assert.deepEqual(runCheck(viewboxClipping, fixture('pass/minimal.svg')), []);
});

test('content past the bottom edge is an error', () => {
  const findings = runCheck(viewboxClipping, fixture('fail/clipped-bottom.svg'));
  const clipped = findings.find((f) => f.code === 'content-clipped');
  assert.equal(clipped.severity, 'error');
  assert.match(clipped.message, /bottom/);
});

test('a missing width attribute is an error', () => {
  const findings = runCheck(viewboxClipping, fixture('fail/clipped-bottom.svg'));
  const missing = findings.find((f) => f.code === 'missing-width-attribute');
  assert.equal(missing.severity, 'error');
  assert.equal(missing.repair.expected, '272');
});

test('a missing viewBox is an error and short-circuits the geometry checks', () => {
  const findings = runCheck(viewboxClipping, '<svg width="50"><rect x="5" y="5" width="9" height="7"/></svg>');
  assert.deepEqual(codes(findings), ['missing-viewbox']);
  // severity must be pinned too: without a viewBox the diagram cannot scale; this is not "a negotiable suggestion".
  assert.equal(findings[0].severity, 'error');
});

test('a margin below 20px is an error', () => {
  // content spans 10..60, left margin 10px
  const src = '<svg viewBox="0 0 70 80" width="70"><rect x="10" y="22" width="50" height="36" fill="#dbeafe" stroke="#3b82f6"/></svg>';
  const findings = runCheck(viewboxClipping, src);
  const small = findings.find((f) => f.code === 'margin-too-small');
  assert.equal(small.severity, 'error');
  assert.equal(small.repair.expected, '20–25');
});

test('a margin above 25px is a warning, not an error', () => {
  // content spans 40..90 in a 130-wide viewBox: 40px on each side
  const src = '<svg viewBox="0 0 130 80" width="130"><rect x="40" y="22" width="50" height="36" fill="#dbeafe" stroke="#3b82f6"/></svg>';
  const findings = runCheck(viewboxClipping, src);
  assert.equal(findings.find((f) => f.code === 'margin-too-large').severity, 'warning');
  assert.equal(hasCode(findings, 'margin-too-small'), false);
});

test('asymmetric left/right padding is flagged with the translate remedy', () => {
  // left 20, right 60
  const src = '<svg viewBox="0 0 130 80" width="130"><rect x="20" y="22" width="50" height="36" fill="#dbeafe" stroke="#3b82f6"/></svg>';
  const findings = runCheck(viewboxClipping, src);
  const asym = findings.find((f) => f.code === 'horizontal-margin-asymmetric');
  assert.equal(asym.severity, 'warning');
  assert.match(asym.repair.hint, /translate/);
});

test('asymmetric top/bottom margins are flagged', () => {
  // top 20, bottom 50
  const src = '<svg viewBox="0 0 94 106" width="94"><rect x="22" y="20" width="50" height="36" fill="#dbeafe" stroke="#3b82f6"/></svg>';
  assert.ok(hasCode(runCheck(viewboxClipping, src), 'vertical-margin-asymmetric'));
});

// The three cases below fix the symmetry tolerance at 5px from both sides and fix the comparison as
// exclusive. 5px of drift between two margins is invisible on screen, so it must not be reported; 6px
// must be. The expected values are written out here rather than read from the check, so widening the
// tolerance without meaning to will redden these instead of moving with the change.
test('top and bottom margins differing by exactly 5px are close enough', () => {
  // content spans 22..72 / 20..56 in a 94x81 viewBox: left 22, right 22, top 20, bottom 25.
  const src = '<svg viewBox="0 0 94 81" width="94"><rect x="22" y="20" width="50" height="36" fill="#dbeafe" stroke="#3b82f6"/></svg>';
  assert.deepEqual(runCheck(viewboxClipping, src), []);
});

test('left and right margins differing by exactly 5px are close enough', () => {
  // content spans 20..70 / 22..58 in a 95x80 viewBox: left 20, right 25, top 22, bottom 22.
  const src = '<svg viewBox="0 0 95 80" width="95"><rect x="20" y="22" width="50" height="36" fill="#dbeafe" stroke="#3b82f6"/></svg>';
  assert.deepEqual(runCheck(viewboxClipping, src), []);
});

test('top and bottom margins differing by 6px are a warning, matching the left/right pair', () => {
  // content spans 22..72 / 20..56 in a 94x82 viewBox: top 20, bottom 26 — one past the tolerance.
  const src = '<svg viewBox="0 0 94 82" width="94"><rect x="22" y="20" width="50" height="36" fill="#dbeafe" stroke="#3b82f6"/></svg>';
  const asym = runCheck(viewboxClipping, src).find((f) => f.code === 'vertical-margin-asymmetric');
  assert.equal(asym.severity, 'warning');
  assert.equal(asym.repair.actual, '20 / 26');
  assert.equal(asym.repair.expected, 'within 5px');
});

// Both ends of the interval are inclusive, so each boundary needs one test: the 20 end is covered by
// the counter-case of "a margin below 20px" (the clean fixture's top margin is exactly 20); the 25 end
// needs a dedicated case.
test('all four margins at exactly 25 are clean', () => {
  // content spans 25..75 / 25..61, viewBox 100x86 → all four margins are 25
  const src = '<svg viewBox="0 0 100 86" width="100"><rect x="25" y="25" width="50" height="36" fill="#dbeafe" stroke="#3b82f6"/></svg>';
  assert.deepEqual(runCheck(viewboxClipping, src), []);
});

test('content flush against the edge is too small, not clipped', () => {
  // content spans 0..50, left inset is exactly 0: this is "margin too small" not "clipped" —
  // the clipping condition must be < 0, not <= 0, otherwise flush content is reported as overflow,
  // and the fix is completely different.
  const src = '<svg viewBox="0 0 72 80" width="72"><rect x="0" y="22" width="50" height="36" fill="#dbeafe" stroke="#3b82f6"/></svg>';
  const findings = runCheck(viewboxClipping, src);
  assert.equal(hasCode(findings, 'content-clipped'), false);
  const small = findings.find((f) => f.code === 'margin-too-small');
  assert.equal(small.repair.actual, '0');
});

test('an empty diagram with a viewBox produces no geometry findings', () => {
  // contentBBox is null. Without an early exit, bboxInsets reads null.minX and throws,
  // which lint.mjs catches and converts to check-crashed — an empty diagram must not crash the check.
  assert.deepEqual(runCheck(viewboxClipping, '<svg viewBox="0 0 100 60" width="100"></svg>'), []);
});

test('a viewBox with a non-zero origin measures insets from that origin', () => {
  // viewBox starts at (10,10), 100x78; content spans 30..80 / 30..66.
  // left 30-10=20 (clean), right (10+100)-80=30 (exceeds upper limit), top 30-10=20, bottom (10+78)-66=22.
  // An implementation that forgets to add the origin computes the right margin as 100-80=20, and this test produces no findings.
  const src = '<svg viewBox="10 10 100 78" width="100"><rect x="30" y="30" width="50" height="36" fill="#dbeafe" stroke="#3b82f6"/></svg>';
  const findings = runCheck(viewboxClipping, src);
  const large = findings.find((f) => f.code === 'margin-too-large');
  assert.equal(large.repair.actual, '30');
  assert.equal(findings.find((f) => f.code === 'horizontal-margin-asymmetric').repair.actual, '20 / 30');
});

test('findings point at the <svg> element, not at the first line of the file', () => {
  // clipped-bottom.svg has two leading comment lines (path + description); <svg> is on line 3.
  const findings = runCheck(viewboxClipping, fixture('fail/clipped-bottom.svg'));
  assert.ok(findings.length > 0);
  for (const f of findings) {
    assert.equal(f.line, 3, f.code);
    assert.equal(f.column, 1, f.code);
  }
});

// `width=""` is the same as omitting width entirely: the diagram will not scale as expected. Normalisation
// is done in document.mjs, so the `=== null` check here is already covered without changes.
test('an empty width attribute is reported like a missing one', () => {
  const src = '<svg viewBox="0 0 94 80" width=""><rect x="22" y="22" width="50" height="36" fill="#dbeafe" stroke="#3b82f6"/></svg>';
  const findings = runCheck(viewboxClipping, src);
  assert.deepEqual(codes(findings), ['missing-width-attribute']);
  assert.equal(findings[0].repair.actual, 'absent');
  assert.equal(findings[0].repair.expected, '94');
});

// Wiring test: every test above calls check.run() directly, so removing this check from the registry still passes.
test('the check is wired into the registry, so lintSource reports it', () => {
  const { findings } = lintSource('clipped-bottom.svg', fixture('fail/clipped-bottom.svg'));
  assert.deepEqual(
    findings.filter((f) => f.check === 'viewbox-clipping').map((f) => f.code).sort(),
    ['content-clipped', 'horizontal-margin-asymmetric', 'margin-too-large', 'margin-too-large', 'missing-width-attribute', 'vertical-margin-asymmetric'],
  );
});
