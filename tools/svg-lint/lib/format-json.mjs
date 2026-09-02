// tools/svg-lint/lib/format-json.mjs
// The machine-readable format. Takes the summary rather than the CLI options, so --quiet does not
// reach it: a consumer filters by severity itself, and a report that silently dropped warnings
// would make `errors`/`warnings` disagree with the findings listed beside them.
export function formatJson(results, summary) {
  return `${JSON.stringify({ tool: 'svg-lint', summary, files: results }, null, 2)}\n`;
}
