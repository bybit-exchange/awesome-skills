// tools/svg-lint/test/cli.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const BIN = fileURLToPath(new URL('../bin/svg-lint.mjs', import.meta.url));
const FIXTURE = fileURLToPath(new URL('./fixtures/pass/minimal.svg', import.meta.url));
const WITH_ERRORS = fileURLToPath(new URL('./fixtures/fail/clipped-bottom.svg', import.meta.url));

// Local to this file: the CLI contract is only driven from here, and an export from a test file is
// a surface no module can usefully reach.
function runCli(args) {
  const r = spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

test('exits 2 on an unknown option', () => {
  const r = runCli(['--nope', 'a.svg']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /Unknown option: --nope/);
});

test('--help exits 0 and documents the exit codes', () => {
  const r = runCli(['--help']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Exit codes:/);
});

// `-h` and `--help` share one branch, and that branch is only reachable through a spawned run:
// parseArgv is deliberately not exported. Nothing exercised the short spelling, so a change that
// dropped it would have gone out silently — an unrecognised `-h` falls into the unknown-option arm
// and exits 2. The expected first line is written out here as well as compared between the two
// spellings, so a run in which both spellings broke the same way could not pass either.
test('the short spelling of the help option behaves like the long one', () => {
  const short = runCli(['-h']);
  const long = runCli(['--help']);
  assert.equal(short.status, 0);
  assert.equal(short.status, long.status);
  assert.equal(short.stdout.split('\n')[0], 'Usage: svg-lint [options] <file.svg...>');
  assert.equal(short.stdout.split('\n')[0], long.stdout.split('\n')[0]);
});

// Exit 1 is the code that means "this diagram has errors", and it is the one a caller branches on:
// a hook or a Makefile target treats 1 as "the author has work to do" and 2 as "I was invoked
// wrongly", and confusing the two turns a real defect into an apparent tooling failure. It was
// covered nowhere in this file.
test('a file carrying errors exits 1, separately from the usage failures', () => {
  const r = runCli([WITH_ERRORS]);
  assert.equal(r.status, 1);
  // The count is read from the tally line rather than matched loosely, so a run that reported no
  // errors at all yet still exited 1 would not satisfy this.
  const tally = r.stdout.match(/^1 file\(s\), (\d+) error\(s\)/m);
  assert.ok(tally, r.stdout);
  assert.ok(Number(tally[1]) > 0, tally[1]);
});

test('the exit codes the help text promises are the ones the tool returns', () => {
  // Nothing held the help text against the behaviour, so the documented list could name codes the
  // tool never returns, or omit one it does. The three descriptions are written out here.
  const help = runCli(['--help']).stdout;
  assert.match(help, /^ {2}0 {2}no errors/m);
  assert.match(help, /^ {2}1 {2}at least one error$/m);
  assert.match(help, /^ {2}2 {2}bad usage, or an input file could not be read$/m);
  assert.equal(runCli([FIXTURE]).status, 0);
  assert.equal(runCli([WITH_ERRORS]).status, 1);
  assert.equal(runCli(['does-not-exist.svg']).status, 2);
});

test('accepts several files in one invocation', () => {
  const r = runCli([FIXTURE, FIXTURE]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /2 file\(s\)/);
});

test('--json emits parseable output', () => {
  const r = runCli(['--json', FIXTURE]);
  assert.equal(r.status, 0);
  assert.equal(JSON.parse(r.stdout).summary.errors, 0);
});
