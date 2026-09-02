// tools/svg-lint/test/integration.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CHECKS } from '../lib/registry.mjs';

const BIN = fileURLToPath(new URL('../bin/svg-lint.mjs', import.meta.url));
const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));

function run(...args) {
  const r = spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8' });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}
const at = (rel) => FIXTURES + rel;

test('the registry holds twelve checks with unique ids', () => {
  assert.equal(CHECKS.length, 12);
  assert.equal(new Set(CHECKS.map((c) => c.id)).size, 12);
});

test('every check declares an id and a title', () => {
  for (const check of CHECKS) {
    assert.equal(typeof check.id, 'string');
    assert.equal(check.id.length > 0, true);
    assert.equal(typeof check.title, 'string');
    assert.equal(check.title.length > 0, true);
    assert.equal(typeof check.run, 'function');
  }
});

test('a compliant file exits 0 and says so', () => {
  const r = run(at('pass/minimal.svg'));
  assert.equal(r.code, 0);
  assert.match(r.stdout, /✓ /);
  assert.match(r.stdout, /^1 file\(s\), 0 error\(s\), 0 warning\(s\)$/m);
});

// A card wrapping one row of boxes is one of the commonest shapes in the house style, and it is
// the shape that several checks used to misread: the card was measured against its members' size,
// the connector between them was measured against the card's own wall, the card's height was put
// through the font-size formula, and a label on the card counted as sitting on bare canvas. Any of
// those coming back turns this file from clean into rejected, since the bar is 0 errors and
// 0 warnings — which makes this the single most useful assertion in this area.
test('a card wrapping a row of boxes is clean across every check', () => {
  const r = run(at('pass/card-row.svg'));
  assert.equal(r.code, 0);
  assert.match(r.stdout, /^1 file\(s\), 0 error\(s\), 0 warning\(s\)$/m);
});

test('an error exits 1 and prints file, line and repair', () => {
  const r = run(at('fail/clipped-bottom.svg'));
  assert.equal(r.code, 1);
  assert.match(r.stdout, /clipped-bottom\.svg/);
  assert.match(r.stdout, /content-clipped/);
  assert.match(r.stdout, /repair:/);
});

test('warnings alone exit 0 but are called out loudly', () => {
  const r = run(at('fail/warning-only.svg'));
  assert.equal(r.code, 0);
  // The error count is part of the pattern on purpose. `/1 warning\(s\)/` on its own is an
  // unanchored substring test, so it also matches `11 warning(s)` and `21 warning(s)`, and the
  // property under test here is that this fixture carries exactly one finding.
  assert.match(r.stdout, /0 error\(s\), 1 warning\(s\)/);
  assert.match(r.stdout, /WARNINGS PRESENT/);
  assert.match(r.stdout, /#ff6b6b/);
});

test('--quiet hides the warning body but keeps it in the tally', () => {
  const r = run('--quiet', at('fail/warning-only.svg'));
  assert.equal(r.code, 0);
  assert.equal(r.stdout.includes('#ff6b6b'), false);
  assert.match(r.stdout, /0 error\(s\), 1 warning\(s\)/);
});

test('several files are linted in one call and the worst outcome wins', () => {
  const r = run(at('pass/minimal.svg'), at('fail/clipped-bottom.svg'));
  assert.equal(r.code, 1);
  assert.match(r.stdout, /minimal\.svg/);
  assert.match(r.stdout, /clipped-bottom\.svg/);
});

test('--json emits one entry per file with parseable findings', () => {
  const r = run('--json', at('pass/minimal.svg'), at('fail/clipped-bottom.svg'));
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.tool, 'svg-lint');
  assert.equal(parsed.files.length, 2);
  assert.equal(parsed.summary.files, 2);
  assert.equal(parsed.summary.errors > 0, true);
  assert.equal(parsed.summary.exitCode, 1);
  const bad = parsed.files.find((f) => f.file.endsWith('clipped-bottom.svg'));
  assert.equal(bad.findings.every((f) => typeof f.check === 'string' && typeof f.code === 'string'), true);
  assert.equal(bad.findings.every((f) => Number.isInteger(f.line) && Number.isInteger(f.column)), true);
  assert.equal(bad.findings.some((f) => f.repair && 'expected' in f.repair), true);
});

test('a missing file is a usage failure, not a lint failure', () => {
  const r = run(at('pass/does-not-exist.svg'));
  assert.equal(r.code, 2);
  assert.match(r.stderr, /does-not-exist\.svg/);
});

test('no arguments exits 2 and says which input was missing', () => {
  const r = run();
  assert.equal(r.code, 2);
  assert.match(r.stderr, /No input files/);
  assert.match(r.stderr, /Usage: svg-lint/);
});

test('nothing is reported when none of the files could be read', () => {
  const r = run(at('pass/nope.svg'), at('pass/also-nope.svg'));
  assert.equal(r.code, 2);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /nope\.svg/);
  assert.match(r.stderr, /also-nope\.svg/);
});

test('--json stays parseable when a file could not be read, and its summary covers only what was read', () => {
  const r = run('--json', at('pass/minimal.svg'), at('pass/nope.svg'));
  assert.equal(r.code, 2);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.files.length, 1);
  assert.equal(parsed.summary.files, 1);
  // summary.exitCode is the lint verdict on the files that were read, so it disagrees with the
  // process exit code here. The unreadable path appears on stderr only, never in the document.
  assert.equal(parsed.summary.exitCode, 0);
  assert.equal(r.stdout.includes('nope.svg'), false);
  assert.match(r.stderr, /nope\.svg/);
});

test('one unreadable file does not stop the others from being linted', () => {
  const r = run(at('pass/minimal.svg'), at('pass/nope.svg'));
  assert.equal(r.code, 2);
  assert.match(r.stdout, /minimal\.svg/);
  assert.match(r.stderr, /nope\.svg/);
});

test('stdout survives a large multi-file run', () => {
  // 120 copies of this fixture print about 160KB, past the 64KB a piped stdout takes in one go.
  // Measured on this machine: 40 copies (54KB) arrive whole even when the process ends with
  // process.exit(), 100 copies stop at 64390 bytes. A batch below that boundary proves nothing.
  const args = Array.from({ length: 120 }, () => at('fail/clipped-bottom.svg'));
  const r = run(...args);
  assert.equal(r.code, 1);
  assert.equal(r.stdout.match(/content-clipped/g).length >= 120, true);
  // Anchored to the start of a line: the tally is the count of files, not a substring of some
  // larger number printed elsewhere in the report.
  assert.match(r.stdout, /^120 file\(s\), /m);
});
