import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseSvg } from '../../lib/parse-svg.mjs';
import { buildDocument } from '../../lib/document.mjs';

export function docFrom(source) {
  const parsed = parseSvg(source);
  return { parsed, doc: buildDocument(parsed) };
}

export function runCheck(check, source, file = 'inline.svg') {
  const { parsed, doc } = docFrom(source);
  return check.run(doc, { parsed, source, file });
}

export function fixture(relativePath) {
  return readFileSync(fileURLToPath(new URL(`../fixtures/${relativePath}`, import.meta.url)), 'utf8');
}

export const codes = (findings) => findings.map((f) => f.code);
export const hasCode = (findings, code) => findings.some((f) => f.code === code);
