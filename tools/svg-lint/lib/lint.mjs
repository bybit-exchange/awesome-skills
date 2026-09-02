// tools/svg-lint/lib/lint.mjs
// Runs every check over one file and returns its findings, sorted for output.
import { parseSvg } from './parse-svg.mjs';
import { buildDocument } from './document.mjs';
import { CHECKS } from './registry.mjs';
import { error, warning } from './report.mjs';

export function lintSource(file, source) {
  const findings = [];

  // The parse and model-building phase must also be wrapped, for exactly the same reason as the
  // try/catch around each check below: the linter's job is to produce a report, not to crash with
  // a stack trace. Without this layer, one bad file kills the process and none of the remaining
  // files in the CLI invocation are checked — CI sees only a stack trace.
  // This is not hypothetical: the parser's NUMERIC_ATTRS lookup once threw a TypeError on a legal
  // tag name like `<constructor>` (fixed, but the same class of risk returns with each new module).
  let parsed;
  let doc;
  try {
    parsed = parseSvg(source);
    doc = buildDocument(parsed);
  } catch (cause) {
    return {
      file,
      findings: [error({
        check: 'document-model',
        code: 'model-crashed',
        message: `Could not build a document model: ${cause.message}`,
      })],
    };
  }

  // Problems discovered by the model layer itself (unsupported transforms, missing attributes)
  // must also be surfaced; otherwise the geometry checks would silently pass on wrong coordinates.
  for (const n of doc.notes) {
    findings.push(warning({ check: 'document-model', code: n.code, message: n.message, line: n.line, column: n.column }));
  }

  for (const check of CHECKS) {
    try {
      findings.push(...check.run(doc, { parsed, source, file }));
    } catch (cause) {
      // error rather than warning: this check produced no findings at all for this file, and a
      // warning would leave the exit code at 0, so `xargs svg-lint '*.svg' && echo pass` would
      // signal success even though a check never ran.
      // Same severity as model-crashed above — both mean "conclusion missing", not "the SVG is
      // broken". A check should not crash on valid input, so this branch costs nothing in practice.
      findings.push(error({
        check: check.id,
        code: 'check-crashed',
        message: `Check "${check.id}" threw: ${cause.message}`,
      }));
    }
  }

  findings.sort((a, b) => a.line - b.line || a.column - b.column || a.check.localeCompare(b.check));
  return { file, findings };
}
