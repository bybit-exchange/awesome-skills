// tools/svg-lint/lib/document.mjs
// Normalises the parse tree into a model that check modules can use directly.
// Three error-prone areas are handled here: translate accumulation, exclusion of primitives
// inside markers, and binding text to boxes.
import { textContent } from './parse-svg.mjs';
import {
  parsePath, flattenPath, pointsBBox, rectBBox, bboxUnion, pointInBBox,
} from './geometry.mjs';
import { decodeEntities, textBBox } from './text-metrics.mjs';
import { normalizeHex } from './color.mjs';

// Global, because one transform attribute may list several transforms and `translate(20,0)
// translate(30,0)` is exactly `translate(50,0)`: reading only the first left the model 30px out
// with no note at all, so margins were reported as numbers that are not in the diagram and the
// repair hints asked for a correction that would have made it worse. Accumulating is only equal to
// composing while every transform in the attribute is a translate; anything that scales or rotates
// them is caught by UNSUPPORTED_TRANSFORM_RE below and noted.
const TRANSLATE_RE = /translate\(\s*(-?[\d.]+)(?:[\s,]+(-?[\d.]+))?\s*\)/g;
const UNSUPPORTED_TRANSFORM_RE = /(scale|rotate|matrix|skewX|skewY)\s*\(/;
// Elements that carry no paint of their own because nothing of them is drawn.
const NON_RENDERING_TAGS = new Set(['title', 'desc', 'metadata']);

// Both <style> bodies and inline style values must be XML-decoded before being parsed as CSS.
// Inside a double-quoted attribute, a double quote can only be written as `&quot;`, and that
// entity ends with `;` — splitting declarations on `;` before decoding would split
// `font-family: &quot;PingFang SC&quot;, …` at the `&quot`, producing three false positives
// on a compliant diagram.

// CSS has six kinds of fragment that do not participate in structural decisions: comments,
// strings, backslash escapes, parenthesis/bracket groups, `<!--` `-->`, and the interior of
// an unquoted `url()`. This function is the single entry point for all of them —
// given an index, it returns { end, text }: end is the index after skipping the fragment,
// text is the source that should remain in the result
// (comments and `<!--` `-->` collapse to a single space; everything else is kept verbatim).
// If this position is not one of the six, it returns null.
//
// There is a seventh kind, but it only applies at the **declaration list** layer, not at the
// rule layer (`{ … }` is a structural symbol at the rule layer), so it is not here — it is
// on the nestedRules flag in splitTop.
//
// Why a single entry point: all four scanners below must recognise these forms, and any
// "scanner misses one form" failure produces the same class of false positive —
// a comment in `@media print /* has ; and { */ { … }` is treated as structural punctuation,
// the text rule that actually applies is swallowed whole, a compliant diagram gets
// missing-font-stack; the escaped semicolon in `font-family: A\\;B` is treated as a
// declaration separator, the value is truncated, and three more findings appear.
// With a single entry point, "misses one form" can no longer happen in just one place.
function nonStructural(css, i) {
  if (css[i] === '/' && css[i + 1] === '*') {
    // An unclosed comment in real CSS comments out everything through to the end.
    const end = css.indexOf('*/', i + 2);
    // Collapses to a single space rather than an empty string: comments are token boundaries
    // in CSS, so `te/**/xt` is the descendant selector `te xt` and `font-fam/**/ily` is a
    // property name no browser recognises. Collapsing to empty would merge them into `text`
    // and `font-family` respectively, causing the tool to accept a declaration that a browser
    // never acted on — a silent false negative, harder to catch than a false positive.
    return { end: end === -1 ? css.length : end + 2, text: ' ' };
  }
  if (css[i] === "'" || css[i] === '"') {
    const end = endOfString(css, i);
    return { end, text: css.slice(i, end) };
  }
  if (css[i] === '\\') {
    // A backslash escapes the next character; the two characters form a unit and must not
    // be treated as structural punctuation.
    const end = Math.min(i + 2, css.length);
    return { end, text: css.slice(i, end) };
  }
  // The leading-character check is just a fast gate: this function runs at every index, so
  // this check rejects the vast majority of positions before any slice or regex is needed.
  // The actual criterion is still the regex below.
  if ((css[i] === 'u' || css[i] === 'U') && URL_OPEN_RE.test(css.slice(i, i + 4))
    && !isIdentChar(css[i - 1])) {
    // After an unquoted `url(`, CSS uses its own rules to read up to `)`: a quote inside
    // does not open a string, and `[` does not open a bracket group (`[` in `url(a[b.css)` is
    // a legal URL character). Treating it as an ordinary group would let that quote or `[`
    // consume everything to the end of the stylesheet, making the text rule that declares the
    // font stack disappear — a diagram that renders correctly in a browser gets
    // missing-font-stack. A quoted `url("…")` is a normal function token and goes to the
    // bracket-group branch below, so this returns null for that case.
    const end = endOfUrlToken(css, i + 4);
    if (end !== null) return { end, text: css.slice(i, end) };
  }
  if (css[i] === '(' || css[i] === '[') {
    // Inside a bracket group, `,` `;` `{` `}` are all part of the group, not structural
    // symbols: the comma in `:not(.a, text, .b)` does not separate selector list items
    // (splitting there would produce a pseudo-selector named `text`, treating a rule that
    // applies only to specific elements as a global font declaration — a false positive, and
    // the reverse direction is a false negative); the semicolon in `@import url(a;b.css)` does
    // not terminate the at-rule. The whole group is kept verbatim.
    const end = endOfGroup(css, i);
    return { end, text: css.slice(i, end) };
  }
  if (css.startsWith('<!--', i) || css.startsWith('-->', i)) {
    // The old `<style><!-- … --></style>` idiom (hiding style from ancient browsers that did
    // not understand the element). CSS ignores these two tokens and the rules still apply;
    // treating them as part of a selector would make `<!-- text` no longer a bare `text`,
    // causing a compliant diagram to be reported as missing a font stack. They collapse to a
    // space for the same reason as comments — they too are token boundaries.
    return { end: i + (css[i] === '<' ? 4 : 3), text: ' ' };
  }
  return null;
}

// `url` must be a standalone identifier to form a url token: `myurl(a[b)` is an ordinary
// function named myurl, its `[` opens a bracket group as usual (that is how CSS reads
// ordinary functions), so it goes to the bracket-group branch.
const URL_OPEN_RE = /^url\(/i;
const isIdentChar = (c) => c !== undefined && /[\w\-\\]/.test(c);

// Returns the index after the end of an unquoted url token (after the `)`, or at end of input).
// Returns null to signal "this is not a url token": when the first non-whitespace character
// after `url(` is a quote, CSS reads it as a normal function plus string, which goes to the
// bracket-group branch. Inside the token, only backslash escapes are recognised
// (`\)` in `url(a\)b.css)` is part of the URL, not the closing delimiter).
function endOfUrlToken(css, start) {
  let i = start;
  while (i < css.length && /\s/.test(css[i])) i += 1;
  if (css[i] === "'" || css[i] === '"') return null;
  while (i < css.length) {
    if (css[i] === '\\') { i += 2; continue; }
    if (css[i] === ')') return i + 1;
    i += 1;
  }
  return css.length;
}

// Returns the index after the matching closing bracket for `(` / `[`. Nested brackets of the
// same kind are consumed by nonStructural itself, so this only searches for its own closing
// delimiter. On unclosed input this goes to the end — CSS tokenisation on such input also
// consumes to the end (adding an implicit closing bracket).
const GROUP_CLOSE = { '(': ')', '[': ']' };

function endOfGroup(css, open) {
  const close = GROUP_CLOSE[css[open]];
  let i = open + 1;
  while (i < css.length) {
    const skip = nonStructural(css, i);
    if (skip) { i = skip.end; continue; }
    if (css[i] === close) return i + 1;
    i += 1;
  }
  return css.length;
}

// Splits a CSS fragment on sep, but only at structural positions: sep inside quotes, after
// an escape, or inside a bracket group does not count as a separator. Splitting a declaration
// list on `;` and a selector list on `,` are the same operation —
// `content: "; font-family: X"` and `[data-x=",text,"]` are two faces of the same trap.
//
// `nestedRules` is for the declaration-list layer: `{ … }` is a structural symbol at the
// rule layer (it delimits a declaration block), but a block encountered **inside** a
// declaration list is a nested rule (CSS nesting:
// `text { font-family: X; &:hover { opacity: .5; font-family: Y } }`). Apart from the bare
// `&` case below, the entire nested rule — its selector and its block — belongs to itself;
// none of it is a declaration at this layer, so it is discarded and accumulation resumes.
// Without this, declarations from a nested rule would be treated as declarations of the outer
// rule, and because they appear after the real declarations they would win: a diagram that
// renders correctly in a browser gets a false positive; the reverse (compliant stack inside
// the nested block, another font in the outer rule) is a worse silent false negative — the
// tool passes it while the browser renders the non-compliant outer font.
// It is discarded rather than kept as an unmatched declaration because CSS does not require
// `;` after a nested rule's `}`: if kept, the selector would merge with the next real
// declaration into one segment, and since the `font-family` anchor is at the segment start,
// it would not be found.
// So "which fragments do not participate in structural decisions" is layered: this kind only
// applies at the declaration-list layer.
export function splitTop(css, sep, nestedRules = false) {
  const out = [];
  let cur = '';
  let i = 0;
  while (i < css.length) {
    const skip = nonStructural(css, i);
    if (skip) { cur += skip.text; i = skip.end; continue; }
    if (nestedRules && css[i] === '{') {
      const block = blockAt(css, i);
      // Exception: when the selector is a bare `&` (or the selector list contains a bare `&`),
      // the nested rule targets exactly the same elements as the outer rule, so its
      // declarations **are** declarations at this layer. And because they appear later, CSS
      // cascade makes them win — discarding them would give a false positive on
      // `text { font-family: non-compliant; & { font-family: compliant-stack } }`,
      // and writing it the other way round would be a false negative: the tool passes it
      // while the browser uses the non-compliant font.
      // The block content is split again recursively, because nesting can continue inside a
      // bare `&`.
      if (hasBareParent(cur)) {
        out.push(...splitTop(blockBody(css, i, block), sep, true));
      }
      cur = '';
      i = block.end;
      continue;
    }
    if (css[i] === sep) { out.push(cur); cur = ''; i += 1; continue; }
    cur += css[i];
    i += 1;
  }
  out.push(cur);
  return out;
}

// Returns the body of a block (stripping the surrounding braces). An unclosed block strips
// only the opening brace — subtracting 1 more would drop the last character, silently
// truncating the value to something like `sans-seri`.
const blockBody = (css, open, { end, closed }) => css.slice(open + 1, closed ? end - 1 : end);

// Checks whether the selector list contains at least one bare `&`. A bare `&` targets exactly
// the same elements as the outer rule, so its declarations count as declarations at this
// layer. The check recognises only **the literal bare `&`** form: `&:hover` (another state),
// `& text` (a descendant), `&.foo` (also requires that class) genuinely target other elements
// and should not count; `:is(&)`, `&&`, and `@media (min-width: 1px) { & { … } }` match the
// same elements in a browser but are not recognised here either — doing so would require
// deciding which forms are equivalent to the parent selector, which is the same position the
// rule layer takes by recognising only bare `text`: this tool does not perform selector
// equivalence analysis, and the SKILL.md house style does not use these forms.
// The cost is that those forms get font-stack findings: one missing-font-stack when the outer
// rule has no font declaration, three font-missing-from-stack when it declares a different
// font. Both sets of findings point toward "write the compliant stack in a position the tool
// recognises", which is the result we want.
//
// The selector list must be split with splitTop rather than `split(',')`: the `&` inside
// `:not(.a,&,.b)` is inside a bracket group and is not a selector list item; a bare split
// would treat it as a bare `&` and count declarations that target other elements as belonging
// to this batch — three false positives on a compliant diagram.
const hasBareParent = (prelude) => splitTop(prelude, ',').some((s) => s.trim() === '&');

// A hand-written scanner rather than a regex: regexes cannot count nested brackets (at-rule
// blocks can nest), and they cannot distinguish `@` `/*` `{` `;` inside a string from the
// structural symbols of the same name — `font-family: 'A@B'` was once treated as an at-rule
// start, and `'A/*B'` as a comment start; both produced three false positives.
// Skips at-rules (entire block or single statement; blocks may nest), then collects the
// remainder as a rule table of `selector-list { declaration-block }`.
function cssRules(css) {
  const rules = [];
  let prelude = '';
  let i = 0;
  while (i < css.length) {
    const skip = nonStructural(css, i);
    if (skip) { prelude += skip.text; i = skip.end; continue; }
    const c = css[i];
    if (c === '@') {
      i = endOfAtRule(css, i);
      prelude = '';
    } else if (c === '{') {
      const block = blockAt(css, i);
      rules.push({
        selectors: splitTop(prelude, ',').map((s) => s.trim()),
        declarations: blockBody(css, i, block),
      });
      prelude = '';
      i = block.end;
    } else if (c === '}') {
      // A stray closing brace: can only come from malformed CSS; discard and restart selector
      // accumulation.
      prelude = '';
      i += 1;
    } else {
      prelude += c;
      i += 1;
    }
  }
  return rules;
}

// Returns the index after the end of a quoted string. `\\` escapes the next character,
// including the closing quote itself: `'A\\';B'` is a complete font name. Without escape
// recognition the scanner would stop early at `\\'`, treating the `;` after it as a
// declaration separator and truncating the value.
//
// A newline terminates the string (CSS bad-string): a missing closing quote is the most
// common typo in hand-written stylesheets, and consuming to the end of input would treat all
// following rules as part of the string, including the one that declares the font stack —
// a diagram missing only a quote would be reported as having no font stack, and the repair
// suggestion would tell the author to add the stack they clearly already wrote. Stopping at
// the newline means only that one declaration is broken; later rules in the same block still
// apply, consistent with browser behaviour.
function endOfString(css, start) {
  const quote = css[start];
  let i = start + 1;
  while (i < css.length) {
    // When `\` is followed by CRLF, the line ending counts as **one** newline: CSS normalises
    // `\r\n` to a single `\n` before tokenising. Skipping only two characters would leave the
    // `\n` in place, causing the same stylesheet to break at the continuation point when the
    // file uses CRLF line endings — the value is truncated, and the actual reported does not
    // match what the author wrote.
    if (css[i] === '\\') { i += css[i + 1] === '\r' && css[i + 2] === '\n' ? 3 : 2; continue; }
    if (css[i] === quote) return i + 1;
    if (css[i] === '\n' || css[i] === '\r' || css[i] === '\f') return i;
    i += 1;
  }
  return css.length;
}

// Returns the block matched by `{`: `end` is the index after the closing `}` (or the end of
// the stylesheet if unclosed), and `closed` records whether the block was actually closed.
// Nested brackets must be counted, and braces inside non-structural fragments must be skipped
// (braces in comments, strings, or escape sequences, inside a bracket group like `:not({)`,
// and inside an unquoted URL like `url(a{b.css)`, are not block boundaries).
//
// `closed` is set by the scan itself; callers must not infer it by looking at the character
// before `end`: that `}` might come from an unclosed string (`font-family: 'PingFang SC}`)
// or an unclosed URL (`url(a}`), and cutting there would silently truncate the value to
// `'PingFang SC`, dropping a finding from the report with no visible trace of the truncation.
//
// Invariant: when `closed === false`, `end` is always `css.length` (an unclosed block
// consumes to the end under CSS tokenisation). As long as this holds, uses of `endOfAtRule`
// that only read `end` without checking `closed` are correct; if an unclosed block ever
// returned an earlier `end`, that use would silently become wrong (rules inside the block
// would leak to the top level and be treated as unconditionally active). The converse does not
// hold: a block with `end === css.length` may simply be one that closed at the very end.
function blockAt(css, open) {
  let depth = 0;
  let i = open;
  while (i < css.length) {
    const skip = nonStructural(css, i);
    if (skip) { i = skip.end; continue; }
    const c = css[i];
    if (c === '{') depth += 1;
    else if (c === '}') {
      depth -= 1;
      if (depth === 0) return { end: i + 1, closed: true };
    }
    i += 1;
  }
  return { end: css.length, closed: false };
}

// Rules inside `@media print { … }` do not apply unconditionally; treating them as the sole
// source of truth would produce three findings on a compliant diagram.
// `@import url("x.css");` and similar have no block; they end at the semicolon. The preamble
// may contain comments, and comments may contain `;` and `{` — misreading them would cause
// this at-rule to "close" in the middle of a comment, swallowing the text rule that actually
// applies, and a compliant diagram would get missing-font-stack.
function endOfAtRule(css, start) {
  let i = start;
  while (i < css.length) {
    const skip = nonStructural(css, i);
    if (skip) { i = skip.end; continue; }
    if (css[i] === ';') return i + 1;
    if (css[i] === '{') return blockAt(css, i).end;
    i += 1;
  }
  return css.length;
}

// Individual declarations. `;` appears legitimately inside quotes
// (`content: "; font-family: Comic Sans"`, font name `'A;B'`) and after escapes (`A\\;B`) —
// splitting there would produce a spurious declaration, and a spurious declaration appearing
// after the real one would win, giving three false positives on a diagram that renders
// correctly in a browser. Nested rules (`&:hover { … }`) are discarded along with their
// selectors: their declarations target a different selector and are not declarations of this
// rule; bare `&` is the exception, see splitTop. Nested rules can only appear in a `<style>`
// element; they cannot be written in an inline `style` attribute, so the flag makes no
// difference at that layer.
const declarationList = (declarations) => splitTop(declarations, ';', true);

// When the same property appears twice in a declaration list, CSS takes the later one. The
// property name is anchored at the start of each declaration to prevent properties like
// `-moz-font-family` (whose name ends in `font-family`) from matching — if they matched, the
// effective font of `text` would be taken from a vendor-prefixed property, producing three
// false positives on a compliant diagram.
function lastFontFamily(declarations) {
  let last = null;
  for (const decl of declarationList(declarations)) {
    const m = /^\s*font-family\s*:([\s\S]*)$/i.exec(decl);
    if (m) last = stripImportant(m[1]).trim() || null;
  }
  return last;
}

// `!important` is not a font name. Leaving it in place prevents stripping the closing quote
// from the last family name, producing a false positive on a compliant diagram. It is
// anchored at the end of the value: a font name inside quotes can be arbitrary text, so any
// occurrence of this string in the middle must be kept as-is.
function stripImportant(value) {
  return value.replace(/!\s*important\s*$/i, '');
}

// Each <style> element is an independent stylesheet: an unclosed `/*` in one element comments
// out only to its own end, and must not also comment out rules in the next element (that would
// give a correctly written diagram missing-font-stack). Across elements they cascade in
// document order, so the last text rule with a font-family wins.
//
// Only a bare `text` selector counts as a global font declaration. `.legend text { … }` is a
// descendant selector that covers only that group; treating it as a global fact would give a
// compliant diagram three false positives. A compound selector (`text.label`) likewise does
// not count — SKILL.md requires the bare `text { … }` form. When the same selector appears
// multiple times, the last one wins.
function styleTextFontFamily(styleTexts) {
  let last = null;
  for (const css of styleTexts) {
    for (const rule of cssRules(decodeEntities(css))) {
      if (!rule.selectors.includes('text')) continue;
      const value = lastFontFamily(rule.declarations);
      if (value !== null) last = value;
    }
  }
  return last;
}

// An inline style has higher priority than a presentation attribute and also higher than a
// type selector in <style>. Only the font-family property is parsed: all other checks in this
// tool read geometric attributes that are never written into a style attribute.
function inlineFontFamily(el) {
  const style = el.attrs.style;
  return style ? lastFontFamily(decodeEntities(style)) : null;
}

// An empty or whitespace-only font-family is the same as no declaration. Treating it as a
// font name and comparing it against the required families would report three missing fonts —
// a false positive.
function declaredFontFamily(el) {
  return inlineFontFamily(el) ?? (el.attrs['font-family']?.trim() || null);
}

const SHAPE_TAGS = new Set(['line', 'circle', 'ellipse', 'polygon', 'polyline']);

const num = (v) => (v === undefined || v === '' ? 0 : Number(v));

// "Attribute missing" and "attribute value is not a number" are two distinct problems and
// must be reported separately. `num()` returns NaN for 'abc' or '12px', and any comparison
// involving NaN is always false — so 12 checks would silently pass this element one by one,
// leaving a clean report that in fact checked nothing (a false negative, with no trace).
// `font-size="12px"` / `width="100%"` are valid SVG syntax, not imagined inputs, so this
// diagnostic is necessary rather than defensive padding.
// Object.create(null) is used because this table uses el.tag as a key, and `<constructor>`
// / `<toString>` are both legal XML tag names. On a plain object literal,
// NUMERIC_ATTRS['constructor'] would return the Object function itself — not undefined, so
// `?? []` cannot catch it — and a subsequent for...of over a function throws TypeError,
// crashing the entire linter with a stack trace instead of producing a report.
const NUMERIC_ATTRS = Object.assign(Object.create(null), {
  rect: ['x', 'y', 'width', 'height', 'rx', 'stroke-width'],
  text: ['x', 'y', 'font-size'],
  path: ['stroke-width'],
});
const colorOf = (v) => (v === undefined ? null : normalizeHex(v) ?? v);

// Same treatment as widthAttr (see buildDocument): `fill=""` / `fill="  "` is an invalid
// declaration in SVG; it is discarded and falls back to the inherited or initial value —
// a browser draws the box in the inherited colour, and the model must do the same.
// Normalising to undefined at this layer means downstream code only needs to test for null as
// the single "not present" state, without each check having to remember to guard against an
// empty string (`parseHex('')` is null, and any check that forgets the guard cannot retrieve
// the colour).
const paintAttr = (v) => (v?.trim() || undefined);

// An element's own paint declaration against what it inherits. `inherit` is the CSS keyword for "take the
// parent's value", so it resolves to exactly what an undeclared attribute would; `currentColor` is left
// alone, because the `color` property it refers to is not part of this model.
const inheritedPaint = (declared, inheritedValue) => {
  const own = paintAttr(declared);
  return own === undefined || own.toLowerCase() === 'inherit' ? inheritedValue : own;
};

// The authoritative source for colours is presentation attributes (Global Constraints); the
// inheritance chain has already been resolved during collect, so this function only adds
// SVG's initial values (from SVG 1.1: `fill: black` / `stroke: none`).
// `null` means no declaration anywhere in the chain, which renders as solid black fill —
// check modules must not skip such entries as "no colour to look at"; those are exactly the
// diagrams to catch.
//
// Accepts entries from `doc.rects` / `doc.texts` / `doc.paths` / `doc.others` and the values of
// `doc.markers` — those five all carry a fill and a stroke key. Anything else silently returns the
// initial value, which does not mean "it declared no colour" but "this model did not record its
// colour", and the two cannot be told apart here.
//
// Having the colour is not the same as being able to judge it. `doc.others` (`circle` / `line` /
// `ellipse` / `polygon` / `polyline`) needs a per-tag answer to whether `fill` renders at all before a
// palette check can report on it: a `<line>`'s fill paints nothing, while a `<polyline>`'s fills the
// region its implied closing edge encloses. A check that only asks whether something is painted behind a
// label does not need that answer and can read these entries directly.
export const effectiveFill = (entry) => entry.fill ?? '#000000';
export const effectiveStroke = (entry) => entry.stroke ?? 'none';

const markerIdOf = (v) => {
  const m = /^url\(#(.+)\)$/.exec(String(v ?? '').trim());
  return m ? m[1] : null;
};

function parseViewBox(value) {
  if (!value) return null;
  const parts = String(value).trim().split(/[\s,]+/).map(Number);
  if (parts.length !== 4 || parts.some(Number.isNaN)) return null;
  return { x: parts[0], y: parts[1], width: parts[2], height: parts[3] };
}

function shiftSegments(segments, dx, dy) {
  if (dx === 0 && dy === 0) return segments;
  const shift = (p) => ({ x: p.x + dx, y: p.y + dy });
  return segments.map((s) => ({
    ...s,
    start: shift(s.start),
    end: shift(s.end),
    controls: s.controls.map(shift),
  }));
}

function otherShapeBBox(el, dx, dy) {
  const A = el.attrs;
  if (el.tag === 'line') {
    return pointsBBox([
      { x: num(A.x1) + dx, y: num(A.y1) + dy },
      { x: num(A.x2) + dx, y: num(A.y2) + dy },
    ]);
  }
  if (el.tag === 'circle') {
    const r = num(A.r);
    return rectBBox({ x: num(A.cx) + dx - r, y: num(A.cy) + dy - r, width: r * 2, height: r * 2 });
  }
  if (el.tag === 'ellipse') {
    const rx = num(A.rx);
    const ry = num(A.ry);
    return rectBBox({ x: num(A.cx) + dx - rx, y: num(A.cy) + dy - ry, width: rx * 2, height: ry * 2 });
  }
  const pts = String(A.points ?? '').trim().split(/[\s,]+/).map(Number);
  const points = [];
  for (let k = 0; k + 1 < pts.length; k += 2) points.push({ x: pts[k] + dx, y: pts[k + 1] + dy });
  return points.length ? pointsBBox(points) : null;
}

export function buildDocument(parsed) {
  const svg = parsed?.svg ?? null;
  const doc = {
    svg,
    viewBox: parseViewBox(svg?.attrs?.viewBox),
    // `|| null` rather than `?? null`: `width=""` and `width="  "` in SVG are equivalent to
    // no width being given; the diagram will not scale as expected. Normalising here once
    // means downstream checks only need to test for null as the single "not present" state,
    // without each check having to remember to guard against an empty string.
    widthAttr: svg?.attrs?.width?.trim() || null,
    heightAttr: svg?.attrs?.height?.trim() || null,
    // styleTexts holds the raw source of each <style> element, for styleFontFamily to parse
    // one by one.
    styleTexts: [],
    styleFontFamily: null,
    markers: new Map(),
    rects: [],
    texts: [],
    paths: [],
    others: [],
    title: null,
    contentBBox: null,
    notes: [],
  };
  if (!svg) return doc;

  const note = (code, message, el) =>
    doc.notes.push({ code, message, line: el?.line ?? 1, column: el?.column ?? 1 });

  // `rendered: false` is for an element whose subtree is never measured -- `<defs>`, whose content is
  // referenced rather than drawn. Its transform moves nothing and modelling it is not worth a warning about
  // geometry no check reads; its paint declarations still belong in the chain, so the rest runs as usual.
  const childContext = (el, ctx, { rendered = true } = {}) => {
    let { dx, dy } = ctx;
    const transform = rendered ? el.attrs.transform : undefined;
    if (transform) {
      // matchAll rather than exec: exec on a global regex carries lastIndex from one call to the
      // next, so consecutive elements would read from the wrong offset and skip transforms.
      for (const m of transform.matchAll(TRANSLATE_RE)) {
        dx += Number(m[1]);
        dy += Number(m[2] ?? 0);
      }
      if (UNSUPPORTED_TRANSFORM_RE.test(transform)) {
        note('unsupported-transform', `Transform "${transform}" is not modelled; geometry checks on this subtree may be wrong`, el);
      }
    }
    return {
      dx,
      dy,
      inDefs: ctx.inDefs,
      inherited: {
        fontSize: el.attrs['font-size'] !== undefined ? Number(el.attrs['font-size']) : ctx.inherited.fontSize,
        fontFamily: declaredFontFamily(el) ?? ctx.inherited.fontFamily,
        textAnchor: el.attrs['text-anchor'] ?? ctx.inherited.textAnchor,
        // One of the two places that encode the colour cascade: an element's own declaration overrides
        // its ancestors'. This one covers every element collect records; the other is paintOf /
        // declaredPaint in the marker branch below, which encodes the same nearest-wins priority for an
        // arrowhead because a marker's inner shapes are not walked by collect at all. What has to stay
        // in step between them is the priority order (own declaration first, then the nearest ancestor
        // that declared one, then what arrives from further up) and the treatment of `inherit` and of a
        // blank declaration — both go through inheritedPaint on either side. Changing one without the
        // other is what leaves an arrowhead judged by a different rule than every other element, so a
        // change here needs a look there. collect itself re-encodes nothing: it receives exactly the ctx
        // this function computed for that element and reads ctx.inherited.* directly, same as fontSize /
        // textAnchor.
        // `inherit` is resolved rather than passed on, by inheritedPaint, which both this function and the
        // marker branch call -- so neither side hands the literal keyword to a check. Passing it on instead
        // changes what the checks say: a `stroke="inherit"` is reported as a colour name, with advice to
        // write the keyword as hex; and on a box whose fill belongs to a semantic triple, the pairing arm
        // quotes "inherit" as the stroke to replace rather than the `<g stroke="#ec4899">` value in force.
        fill: inheritedPaint(el.attrs.fill, ctx.inherited.fill),
        stroke: inheritedPaint(el.attrs.stroke, ctx.inherited.stroke),
      },
    };
  };

  // Reports only "value present but not a number". Missing attributes go to
  // missing-geometry-attribute, and empty strings are treated as 0 (SVG treats width="" as
  // equivalent to absent); neither should be reported again here.
  const checkNumeric = (el) => {
    for (const key of NUMERIC_ATTRS[el.tag] ?? []) {
      const raw = el.attrs[key];
      if (raw === undefined || raw === '') continue;
      if (Number.isNaN(Number(raw))) {
        note('non-numeric-attribute',
          `<${el.tag}> has a non-numeric "${key}" of "${raw}"; lengths with units are not supported`, el);
      }
    }
  };

  const collect = (el, ctx) => {
    const A = el.attrs;
    checkNumeric(el);
    if (el.tag === 'rect') {
      for (const key of ['x', 'y', 'width', 'height']) {
        if (A[key] === undefined) {
          note('missing-geometry-attribute', `<rect> is missing the "${key}" attribute`, el);
        }
      }
      const x = num(A.x) + ctx.dx;
      const y = num(A.y) + ctx.dy;
      const width = num(A.width);
      const height = num(A.height);
      doc.rects.push({
        element: el, line: el.line, column: el.column,
        x, y, width, height,
        rx: A.rx === undefined ? null : Number(A.rx),
        fill: colorOf(ctx.inherited.fill),
        stroke: colorOf(ctx.inherited.stroke),
        strokeWidth: A['stroke-width'] === undefined ? 1 : Number(A['stroke-width']),
        dasharray: A['stroke-dasharray'] ?? null,
        dashed: A['stroke-dasharray'] !== undefined,
        bbox: rectBBox({ x, y, width, height }),
        texts: [],
      });
      return;
    }
    if (el.tag === 'text') {
      const rawContent = textContent(el);
      const content = decodeEntities(rawContent);
      const fontSize = ctx.inherited.fontSize ?? 12;
      const x = num(A.x) + ctx.dx;
      const y = num(A.y) + ctx.dy;
      const textAnchor = ctx.inherited.textAnchor ?? 'start';
      if (A['font-size'] === undefined && ctx.inherited.fontSize === undefined) {
        note('missing-font-size', '<text> has no font-size and inherits none; assuming 12px', el);
      }
      const entry = {
        element: el, line: el.line, column: el.column,
        x, y, content, rawContent, fontSize, textAnchor,
        fill: colorOf(ctx.inherited.fill),
        stroke: colorOf(ctx.inherited.stroke),
        fontFamily: ctx.inherited.fontFamily ?? null,
        hasOwnFontSize: A['font-size'] !== undefined,
        bbox: textBBox({ x, y, content, fontSize, textAnchor }),
        container: null,
      };
      entry.center = {
        x: (entry.bbox.minX + entry.bbox.maxX) / 2,
        y: (entry.bbox.minY + entry.bbox.maxY) / 2,
      };
      doc.texts.push(entry);
      return;
    }
    if (el.tag === 'path') {
      const segments = shiftSegments(parsePath(A.d), ctx.dx, ctx.dy);
      // parsePath marks commands it does not model (A / S / T) as unsupported and collapses
      // them to zero length; the remaining points cannot form the actual path. "Skip this path"
      // is not written here: only overlap skips the whole path; viewbox-clipping and
      // arrow-marker measure against the collapsed false path and can produce opposite
      // conclusions — an arc that bulges outside the canvas gets "top margin 78px too large,
      // tighten the viewBox", while the same shape written as C gets content-clipped.
      // The wording therefore matches the unsupported-transform note (may be wrong): the author
      // is told the geometry conclusions for this path are unreliable, not that it was skipped.
      const unsupported = segments.find((s) => s.unsupported);
      if (unsupported) {
        note('unsupported-path-command',
          `Path command "${unsupported.cmd}" is not modelled; geometry checks on this path may be wrong`, el);
      }
      const points = flattenPath(segments);
      doc.paths.push({
        element: el, line: el.line, column: el.column,
        d: A.d ?? '',
        segments,
        points,
        bbox: pointsBBox(points),
        fill: colorOf(ctx.inherited.fill),
        stroke: colorOf(ctx.inherited.stroke),
        strokeWidth: A['stroke-width'] === undefined ? 1 : Number(A['stroke-width']),
        dasharray: A['stroke-dasharray'] ?? null,
        markerEnd: markerIdOf(A['marker-end']),
        markerStart: markerIdOf(A['marker-start']),
      });
      return;
    }
    if (SHAPE_TAGS.has(el.tag)) {
      // These shapes carry the same two colour keys as everything else, resolved through the same
      // inheritance chain. Not so that colour conformance can judge them -- that still needs a per-tag
      // answer to "does fill render at all" (see the palette check) -- but so that a check asking the much
      // simpler question "is anything painted behind this label" can see them. Without the keys such a
      // check reads a shape's colour as the SVG initial value and reports a label drawn on a white disc as
      // unreadable, which is a false positive on a diagram that is perfectly legible.
      doc.others.push({
        element: el, line: el.line, column: el.column,
        bbox: otherShapeBBox(el, ctx.dx, ctx.dy),
        fill: colorOf(ctx.inherited.fill),
        stroke: colorOf(ctx.inherited.stroke),
      });
    }
  };

  const visit = (el, ctx) => {
    for (const child of el.children) {
      if (child.type === 'text') continue;
      if (child.tag === 'style') {
        const styleSource = textContent(child);
        doc.styleTexts.push(styleSource);
        continue;
      }
      if (child.tag === 'defs') {
        // Through childContext, not a bare spread of ctx. A bare spread carries the chain from above intact;
        // what it drops is `<defs>`'s *own* attributes, so a `<defs fill="#64748b">` collected null for every
        // arrowhead under it and a colour check reported #000000 on arrows that render slate. `<defs>` is an
        // ordinary element for inheritance, so its declarations belong in the chain like any other's.
        //
        // Its transform is skipped, though: a transform on `<defs>` has no rendering effect at all, and
        // childContext would otherwise warn that geometry under it may be wrong -- advice about a subtree
        // that is never measured.
        visit(child, { ...childContext(child, ctx, { rendered: false }), inDefs: true });
        continue;
      }
      if (child.tag === 'marker') {
        const A = child.attrs;
        // The arrow color can only be collected here: the continue below deliberately does not treat the marker's
        // inner shapes as diagram content, so they are in neither doc.paths nor doc.others.
        //
        // Three levels are tried in the order the renderer would: the first element inside the marker that
        // declares the attribute, then the <marker> itself, then whatever the marker inherits from its own
        // ancestors -- `fill` and `stroke` are inherited properties, so a `<svg fill="#ff00ff">` becomes the
        // recorded colour of every arrowhead under it that declares none of its own. The first two are raw
        // attributes and are read through inheritedPaint here, so an `inherit` written on the arrowhead or on
        // the <marker> resolves rather than reaching a colour check as the literal keyword. The third is not
        // read as an attribute at all: it arrives as ctx.inherited, whose fill and stroke are an
        // inheritedPaint result at every level -- childContext produces them for each hop below the root, and
        // the root <svg>, which childContext never runs on, is seeded by the rootInherited block just before
        // the visit call, which calls inheritedPaint as well.
        // Stopping short at any level collects null, and a colour check then reads the SVG initial value. The
        // two arms differ there: for fill that is #000000 and gets reported, a colour appearing nowhere in the
        // file on an arrow that renders in one that does; for stroke it is `none`, which the check skips, so
        // the arrow's real colour goes unjudged instead. The declaring element is the first with a *valid*
        // value, because `fill="  "` is discarded
        // rather than obeyed (see paintAttr), and a discarded declaration inherits like any other.
        //
        // fill and stroke are resolved one at a time: a solid arrowhead declares only a fill, but an open-V
        // one is drawn with a stroke and `fill="none"`, and without the stroke a magenta open arrow is a
        // colour nothing in the tool can see. A house style arrow is a single <path>, where per-attribute
        // resolution and per-element resolution agree. They part on a multi-shape arrowhead, which house style
        // does not have: this can pair a fill from one shape with a stroke from another, a combination no single
        // shape wears. That is a colour inventory for the palette check to judge, not a description of a shape,
        // and the alternative -- reading one shape and ignoring the rest -- would hide the other's colours.
        // The search goes to any depth, because a `<marker><g><path fill="#64748b"/></g></marker>` is a
        // compliant arrow and reading only direct children collects null for it -- again reporting #000000
        // on something that renders slate. Descending also resolves nearest-wins on the way down: a
        // declaration on a `<g>` is what its children render in until one of them overrides it, and the
        // descent is seeded with the <marker>'s own paint so that the same holds one level further out --
        // otherwise `<marker fill="A"><path/><path fill="B"/></marker>` reports B for an arrow whose first
        // shape renders A, while the identical structure under a `<g fill="A">` reports A.
        //
        // What this does not model is which shapes are drawn: an empty `<g fill="A">` before the arrowhead
        // wins, because it does declare a paint. The value is still one written in the file, so the palette
        // verdict on it is about a colour the author really chose, and holding a whole render model here to
        // decide otherwise is not worth it for a structure house style does not produce.
        const declaredPaint = (parent, attribute, inheritedValue) => {
          for (const c of parent.children) {
            if (c.type === 'text') continue;
            // <title>, <desc> and <metadata> are never drawn -- the first two are accessibility text and the
            // third is machine-readable data -- so a paint on one is not a colour the arrow renders in. All
            // three also come first by convention, which would put them ahead of the arrowhead in document
            // order and let them win outright.
            if (NON_RENDERING_TAGS.has(c.tag)) continue;
            const here = inheritedPaint(c.attrs?.[attribute], inheritedValue);
            const deeper = declaredPaint(c, attribute, here);
            if (deeper !== undefined) return deeper;
            if (here !== undefined) return here;
          }
          return undefined;
        };
        const paintOf = (attribute) => {
          // The `??` still matters after seeding: an empty <marker> has no shape for the seed to reach.
          // ctx.inherited[attribute] is passed as it stands, with no paintAttr around it: every value in
          // ctx.inherited came out of inheritedPaint, which is where paintAttr already discarded blank
          // declarations, so what arrives here is either undefined or an already-trimmed non-empty string.
          const marked = inheritedPaint(A[attribute], ctx.inherited[attribute]);
          return colorOf(declaredPaint(child, attribute, marked) ?? marked);
        };
        doc.markers.set(A.id, {
          id: A.id ?? null,
          markerWidth: A.markerWidth === undefined ? null : Number(A.markerWidth),
          markerHeight: A.markerHeight === undefined ? null : Number(A.markerHeight),
          refX: A.refX === undefined ? null : Number(A.refX),
          refY: A.refY === undefined ? null : Number(A.refY),
          orient: A.orient ?? null,
          markerUnits: A.markerUnits ?? null,
          fill: paintOf('fill'),
          stroke: paintOf('stroke'),
          line: child.line,
          column: child.column,
          // Retained as part of the model's contract, not because a check needs it: since
          // arrow-marker started taking its position from `line`/`column` like every other check,
          // nothing under lib/ reads this field and only document.test.mjs does. It is the escape
          // hatch every other modelled entry offers — rects, texts and shapes all carry their
          // element — and dropping it from markers alone would make the model inconsistent for the
          // sake of one word. A dead-code pass does not need to re-derive this.
          element: child,
        });
        continue; // no recursion: the arrow's inner shapes are not diagram content
      }
      const next = childContext(child, ctx, { rendered: !ctx.inDefs });
      if (!ctx.inDefs) collect(child, next);
      visit(child, next);
    }
  };

  // The root <svg> itself does not pass through childContext, so its fill / stroke must be
  // seeded here; otherwise boxes inside `<svg fill="#dbeafe">` cannot retrieve the colour and
  // fall back to solid black, even though the diagram renders with a light-blue background in
  // a browser. Only these two keys are seeded rather than switching to childContext(svg, …):
  // that would also inherit the root's font-size / text-anchor, changing the scope of the
  // missing-font-size note — a separate change.
  const rootInherited = {
    fill: inheritedPaint(svg.attrs.fill, undefined),
    stroke: inheritedPaint(svg.attrs.stroke, undefined),
  };
  visit(svg, { dx: 0, dy: 0, inDefs: false, inherited: rootInherited });

  // The authoritative source for the font stack is the text rule in <style>, parsed
  // per-element and cascaded in document order with the last one winning.
  // Commenting out an old font stack is a very common action in hand-written diagrams, so the
  // scanner treats comments as non-existent: a value lifted from a comment would report a
  // compliant diagram as missing a font (false positive), and treating a commented-out rule
  // as active would be a silent false negative.
  doc.styleFontFamily = styleTextFontFamily(doc.styleTexts);
  for (const t of doc.texts) t.fontFamily ??= doc.styleFontFamily;

  // A full-width background rectangle is the canvas, not diagram content (house style uses
  // it to give the diagram a light-coloured background). Without excluding it, all four
  // margins become 0 and every label is judged to overlap a box.
  const viewBoxArea = doc.viewBox ? doc.viewBox.width * doc.viewBox.height : 0;
  doc.backgroundRect = viewBoxArea
    ? doc.rects.find((r) => r.width * r.height >= viewBoxArea * 0.98) ?? null
    : null;
  // The background rectangle is also excluded from groupRects: if drawn as dashed (the
  // style used for a full-diagram outer frame) it would be treated as a dashed grouping box, causing
  // the content bounding box to expand to the full canvas, a correctly centred title would
  // get a finding, and the suggested x would land at the canvas centre rather than the
  // content centre — following the repair would move a correctly positioned title off-centre.
  doc.groupRects = doc.rects.filter((r) => r.dashed && r !== doc.backgroundRect);
  doc.contentRects = doc.rects.filter((r) => !r.dashed && r !== doc.backgroundRect);

  // Bind text to box: find the smallest solid content box that contains the text centre.
  const contentRects = doc.contentRects;
  for (const t of doc.texts) {
    let best = null;
    for (const r of contentRects) {
      if (!pointInBBox(t.center, r.bbox)) continue;
      const area = r.width * r.height;
      if (!best || area < best.width * best.height) best = r;
    }
    if (best) {
      t.container = best;
      best.texts.push(t);
    }
  }

  // A group name inside a dashed grouping box is not a title: house style places it left-aligned
  // at the top-left of the box, and treating it as a title would cause the "title centred"
  // check to fire on a compliant diagram. Dashed boxes themselves are not bound to text, so
  // container === null alone cannot distinguish a group name from a real title.
  // The text **centre** is tested for containment, not the whole bounding box: the group-name
  // example in SKILL.md:103 is a long name like `Employee instances`; written inside a narrow
  // dashed grouping box, its right edge overflows, and requiring full containment would miss it — which
  // is exactly what this step is meant to prevent. The same `pointInBBox(t.center, ...)`
  // already used for text-to-box binding is reused here so both places cannot drift apart.
  // groupRects is used rather than filtering dashed again: filtering again would bring in the
  // background rectangle, and in a diagram with a dashed full-diagram outer frame the real
  // title would be classified as a group name and excluded (doc.title = null), silently
  // disabling the entire title-centred check.
  const insideDashedGroup = (t) => doc.groupRects.some((r) => pointInBBox(t.center, r.bbox));
  const unbound = doc.texts.filter((t) => t.container === null && !insideDashedGroup(t));
  doc.title = unbound.length
    ? unbound.reduce((a, b) => (b.fontSize > a.fontSize ? b : a))
    : null;

  doc.contentBBox = bboxUnion(
    ...doc.rects.filter((r) => r !== doc.backgroundRect).map((r) => r.bbox),
    ...doc.texts.map((t) => t.bbox),
    ...doc.paths.map((p) => p.bbox),
    ...doc.others.map((o) => o.bbox),
  );

  return doc;
}
