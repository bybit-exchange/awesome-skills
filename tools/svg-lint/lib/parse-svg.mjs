// tools/svg-lint/lib/parse-svg.mjs
// Fault-tolerant XML parser, covering only the SVG subset used by the house style.
// Hand-written rather than pulling in a third-party library: more controllable over the
// constrained subset, and able to locate escaping problems to line and column.

export function offsetToLineCol(source, offset) {
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < offset && i < source.length; i++) {
    if (source[i] === '\n') {
      line += 1;
      lineStart = i + 1;
    }
  }
  return { line, column: offset - lineStart + 1 };
}

// Attribute values may contain a bare `>`, so a simple indexOf('>') is not sufficient.
function findTagEnd(source, start) {
  let quote = null;
  for (let i = start + 1; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '>') return i;
  }
  return -1;
}

const ATTR_RE = /([A-Za-z_:][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)')/g;

function parseTag(inner) {
  const nameMatch = /^([A-Za-z][\w:.-]*)/.exec(inner);
  const tag = nameMatch ? nameMatch[1] : '';
  // Object.create(null): attribute names come directly from file content, and ATTR_RE's
  // `[A-Za-z_:]` accepts names like `__proto__` and `constructor`. On a plain object literal,
  // `attrs['__proto__'] = v` hits the prototype setter and the attribute — along with any bare `&`
  // in its value — silently disappears; and the duplicate-detection below uses `!== undefined`,
  // which would cause `constructor` to be falsely reported as a duplicate on its first occurrence —
  // a false positive is the worst failure mode for this tool.
  const attrs = Object.create(null);
  // Discarding this offset would force escaping errors in attribute values to point only at the
  // tag start, making the repair receipt meaningless.
  const attrValueOffsets = Object.create(null);
  const duplicateAttrs = [];
  ATTR_RE.lastIndex = 0;
  let m;
  while ((m = ATTR_RE.exec(inner)) !== null) {
    const value = m[3] !== undefined ? m[3] : m[4];
    // A duplicate attribute name within the same tag is XML non-well-formed. What is carried out
    // is the **shadowed** value (the one already in attrs from the previous iteration), not the
    // current iteration's value — the latter ends up in attrs and will be covered by the escaping
    // scan at the call site; the shadowed value never enters attrs, so without a separate scan it
    // would go unreported in one pass.
    if (attrs[m[1]] !== undefined) {
      duplicateAttrs.push({
        name: m[1],
        offset: m.index,
        shadowedValue: attrs[m[1]],
        shadowedValueOffset: attrValueOffsets[m[1]],
      });
    }
    attrs[m[1]] = value;
    // m[0] ends with the closing quote, so value start = match end − 1 (quote) − value length.
    attrValueOffsets[m[1]] = m.index + m[0].length - 1 - value.length;
  }
  return { tag, attrs, attrValueOffsets, duplicateAttrs };
}

// XML predefines only these five named entities; other named entities (e.g. &nbsp;) cause SVG parsing to fail.
const PREDEFINED_ENTITIES = new Set(['amp', 'lt', 'gt', 'quot', 'apos']);
const ENTITY_RE = /^&(#x[0-9A-Fa-f]+|#\d+|[A-Za-z][A-Za-z0-9]*);/;

// `checkGt` and `checkLt` are each set for exactly one of the two positions this function is called
// for, because the two positions do not obey the same rules:
//
//   - `>` is well-formed in an attribute value and the house style gives no reason to escape it
//     there, so only text content asks for the `>` scan. Flagging it in attribute values would
//     block every diagram with a `>` in an aria-label — a false positive, the worst outcome here.
//   - `<` is never legal in an attribute value: the renderer stops at it looking for a start tag,
//     so the file produces no image at all. Only attribute values ask for the `<` scan, because a
//     `<` in text content never reaches this function — the parse loop splits the source on `<`
//     and reports the text-content case itself.
function scanEntities(value, baseOffset, err, { checkGt, checkLt }) {
  for (let k = 0; k < value.length; k++) {
    const ch = value[k];
    if (ch === '>' && checkGt) {
      err('unescaped-gt', 'Raw ">" in text content; escape it as &gt;', baseOffset + k);
      continue;
    }
    if (ch === '<' && checkLt) {
      err('unescaped-lt', 'Raw "<" in an attribute value; escape it as &lt;', baseOffset + k);
      continue;
    }
    if (ch !== '&') continue;
    const m = ENTITY_RE.exec(value.slice(k));
    if (!m) {
      err('unescaped-ampersand', 'Raw "&" found; escape it as &amp;', baseOffset + k);
      continue;
    }
    const name = m[1];
    if (!name.startsWith('#') && !PREDEFINED_ENTITIES.has(name)) {
      err('unknown-entity', `Unknown entity "&${name};"; XML predefines only amp, lt, gt, quot, apos`, baseOffset + k);
    }
    k += m[0].length - 1;
  }
}

// XML comment content is `((Char - '-') | ('-' (Char - '-')))*`, which forbids two things: a `--`
// anywhere in the content, and a content that ends in `-` (that final hyphen plus the terminator
// spells `--->`, which is not a terminator). Either one makes the whole file fail to parse — the
// renderer produces no image at all, so this cannot be left to the author to find out later. It is
// worth reporting because the house comment style here is prose-heavy, and ` -- ` is a natural way
// to write a dash in prose.
//
// Only the *content* is scanned, never the source at large: `--` is ordinary text everywhere else
// (a label, a `stroke-dasharray`, a URL, a CSS custom property, a CDATA section), and flagging it
// there would block a diagram that every parser accepts — the worst failure mode this tool has.
//
// Every occurrence is reported rather than only the first, matching how scanEntities reports every
// bare `&`: two dashes in one comment are two separate edits for the author. The trailing-hyphen
// case is suppressed when the content already ends in `--`, because the `--` scan has then already
// reported that same pair of characters, and one mistake should not produce two findings.
function scanComment(content, baseOffset, err) {
  for (let k = content.indexOf('--'); k !== -1; k = content.indexOf('--', k + 2)) {
    err('double-hyphen-in-comment', 'A comment may not contain "--" anywhere in its content', baseOffset + k);
  }
  if (content.endsWith('-') && !content.endsWith('--')) {
    err('double-hyphen-in-comment', 'A comment may not end with "-", because that makes the terminator "--->"',
      baseOffset + content.length - 1);
  }
}

export function parseSvg(source) {
  const errors = [];
  // `#root` is a synthetic node; its attrs are always empty, so a prototype collision is
  // unreachable. Object.create(null) is still used: this repository keeps only one defence for
  // this pit, and `attrs = {}` should be read as an unintended omission.
  const root = { tag: '#root', attrs: Object.create(null), children: [], line: 1, column: 1 };
  const stack = [root];
  let i = 0;

  const err = (code, message, offset) => {
    errors.push({ code, message, ...offsetToLineCol(source, offset) });
  };

  const addText = (value, offset) => {
    if (value === '') return;
    scanEntities(value, offset, err, { checkGt: true, checkLt: false });
    stack[stack.length - 1].children.push({
      type: 'text',
      value,
      offset,
      ...offsetToLineCol(source, offset),
    });
  };

  while (i < source.length) {
    const lt = source.indexOf('<', i);
    if (lt === -1) {
      addText(source.slice(i), i);
      break;
    }
    if (lt > i) addText(source.slice(i, lt), i);

    const next = source[lt + 1];

    if (next === '?' || next === '!') {
      if (source.startsWith('<![CDATA[', lt)) {
        // CDATA section: content is raw text; the closing marker is `]]>`, not the first `>`.
        const cdataStart = lt + 9; // '<![CDATA['.length === 9
        const cdataEnd = source.indexOf(']]>', cdataStart);
        if (cdataEnd === -1) {
          err('unclosed-cdata', 'CDATA section is never closed with ]]>', lt);
          // Fault-tolerant: swallow the rest as CDATA text instead of continuing to parse.
          break;
        }
        const value = source.slice(cdataStart, cdataEnd);
        if (value !== '') {
          stack[stack.length - 1].children.push({
            type: 'text',
            cdata: true,
            value,
            offset: cdataStart,
            ...offsetToLineCol(source, cdataStart),
          });
        }
        i = cdataEnd + 3; // ']]>'.length === 3
        continue;
      }
      if (source.startsWith('<!--', lt)) {
        // The terminator is searched for from lt + 4, the earliest position it can legally start:
        // an XML comment is `<!--` content `-->`, so the two hyphens of `<!--` can never double as
        // the first two of `-->`. Searching from lt instead let `<!-->` and `<!--->` — neither of
        // which any XML parser accepts — be consumed as if they were closed comments.
        const end = source.indexOf('-->', lt + 4);
        if (end === -1) {
          err('unterminated-markup', 'Unterminated comment or declaration', lt);
          break;
        }
        scanComment(source.slice(lt + 4, end), lt + 4, err);
        i = end + 3; // '-->'.length === 3
        continue;
      }
      const end = source.indexOf('>', lt);
      if (end === -1) {
        err('unterminated-markup', 'Unterminated comment or declaration', lt);
        break;
      }
      i = end + 1;
      continue;
    }

    if (next === '/') {
      const gt = source.indexOf('>', lt);
      if (gt === -1) {
        err('unterminated-tag', 'Unterminated closing tag', lt);
        break;
      }
      const tag = source.slice(lt + 2, gt).trim();
      const open = stack[stack.length - 1];
      if (open.tag !== tag) {
        err('mismatched-tag', `Closing tag </${tag}> does not match open <${open.tag}>`, lt);
      } else {
        stack.pop();
      }
      i = gt + 1;
      continue;
    }

    if (!next || !/[A-Za-z]/.test(next)) {
      // Bare `<` in text content. Invalid XML; SKILL.md requires it to be written as &lt;.
      err('unescaped-lt', 'Raw "<" in text content; escape it as &lt;', lt);
      addText('<', lt);
      i = lt + 1;
      continue;
    }

    const gt = findTagEnd(source, lt);
    if (gt === -1) {
      err('unterminated-tag', 'Unterminated element tag', lt);
      break;
    }
    const selfClosing = source[gt - 1] === '/';
    const inner = source.slice(lt + 1, selfClosing ? gt - 1 : gt);
    const { tag, attrs, attrValueOffsets, duplicateAttrs } = parseTag(inner);
    for (const d of duplicateAttrs) {
      err('duplicate-attribute', `Duplicate attribute "${d.name}"; the last value silently wins`, lt + 1 + d.offset);
      scanEntities(d.shadowedValue, lt + 1 + d.shadowedValueOffset, err, { checkGt: false, checkLt: true });
    }
    for (const [name, raw] of Object.entries(attrs)) {
      // inner is source.slice(lt + 1, …), so the absolute offset needs the 1 added back.
      scanEntities(raw, lt + 1 + attrValueOffsets[name], err, { checkGt: false, checkLt: true });
    }
    const el = { tag, attrs, children: [], ...offsetToLineCol(source, lt) };
    stack[stack.length - 1].children.push(el);
    if (!selfClosing) stack.push(el);
    i = gt + 1;
  }

  for (let s = stack.length - 1; s >= 1; s--) {
    err('unclosed-tag', `Element <${stack[s].tag}> is never closed`, source.length);
  }

  const svg = root.children.find((c) => c.tag === 'svg') ?? null;
  return { root, svg, errors };
}

export function* walk(el) {
  for (const child of el?.children ?? []) {
    if (child.type === 'text') continue;
    yield child;
    yield* walk(child);
  }
}

export function textContent(el) {
  if (!el) return '';
  return (el.children ?? [])
    .map((c) => (c.type === 'text' ? c.value : textContent(c)))
    .join('');
}
