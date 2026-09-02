// tools/svg-lint/lib/report.mjs
// The finding shape every check returns, and the tally the CLI turns into an exit code.
export const ERROR = 'error';
// Not exported: nothing outside this module needs the literal, and `warning()` below is the only
// way a check names that severity.
const WARNING = 'warning';

function finding(severity, { check, code, message, line = 1, column = 1, repair = null }) {
  return { check, severity, code, message, line, column, repair };
}

export const error = (opts) => finding(ERROR, opts);
export const warning = (opts) => finding(WARNING, opts);

export function summarize(results) {
  let errors = 0;
  let warnings = 0;
  for (const r of results) {
    for (const f of r.findings) {
      if (f.severity === ERROR) errors += 1;
      else warnings += 1;
    }
  }
  return { files: results.length, errors, warnings, exitCode: errors > 0 ? 1 : 0 };
}
