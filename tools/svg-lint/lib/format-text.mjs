// tools/svg-lint/lib/format-text.mjs
// The human-readable format, and the only place --quiet is honoured.
import { ERROR } from './report.mjs';

function repairLine(repair) {
  const bits = [];
  if (repair.attribute !== undefined) bits.push(`${repair.attribute}: ${repair.actual} → ${repair.expected}`);
  else if (repair.expected !== undefined) bits.push(`${repair.actual} → ${repair.expected}`);
  if (repair.hint) bits.push(repair.hint);
  return bits.join(' · ');
}

export function formatText(results, { quiet = false } = {}) {
  const lines = [];
  let errors = 0;
  let warnings = 0;

  for (const { file, findings } of results) {
    for (const f of findings) {
      if (f.severity === ERROR) errors += 1;
      else warnings += 1;
    }
    const shown = quiet ? findings.filter((f) => f.severity === ERROR) : findings;
    if (shown.length === 0) {
      lines.push(`✓ ${file}`);
      continue;
    }
    lines.push(file);
    for (const f of shown) {
      const tag = f.severity === ERROR ? 'error  ' : 'warning';
      lines.push(`  ${f.line}:${f.column}  ${tag}  ${f.message}  [${f.check}/${f.code}]`);
      if (f.repair) lines.push(`           repair: ${repairLine(f.repair)}`);
    }
  }

  lines.push('');
  lines.push(`${results.length} file(s), ${errors} error(s), ${warnings} warning(s)`);
  if (errors === 0 && warnings > 0) {
    lines.push('!! WARNINGS PRESENT — house style requires 0 errors AND 0 warnings');
  }
  return `${lines.join('\n')}\n`;
}
