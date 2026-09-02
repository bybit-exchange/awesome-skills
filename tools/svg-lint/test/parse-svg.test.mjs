// tools/svg-lint/test/parse-svg.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSvg, walk, textContent, offsetToLineCol } from '../lib/parse-svg.mjs';

// every number in the fixture is distinct so that a misaligned assertion always goes red rather than coincidentally matching.
const DOC = `<svg viewBox="0 0 137 59" width="137" xmlns="http://www.w3.org/2000/svg">
  <style>text { font-family: 'PingFang SC'; }</style>
  <rect x="11" y="23" width="41" height="31" rx="7"/>
  <text x="29" y="47" font-size="13">Ship &amp; Bill</text>
</svg>`;

test('parses the svg element and its attributes', () => {
  const { svg, errors } = parseSvg(DOC);
  assert.deepEqual(errors, []);
  assert.equal(svg.tag, 'svg');
  assert.equal(svg.attrs.viewBox, '0 0 137 59');
  assert.equal(svg.attrs.width, '137');
});

test('parses self-closing elements with all attributes', () => {
  const { svg } = parseSvg(DOC);
  const rect = [...walk(svg)].find((e) => e.tag === 'rect');
  assert.equal(rect.attrs.x, '11');
  assert.equal(rect.attrs.y, '23');
  assert.equal(rect.attrs.width, '41');
  assert.equal(rect.attrs.height, '31');
  assert.equal(rect.attrs.rx, '7');
  assert.equal(rect.children.length, 0);
});

test('keeps text content verbatim, entities unexpanded', () => {
  const { svg } = parseSvg(DOC);
  const text = [...walk(svg)].find((e) => e.tag === 'text');
  assert.equal(textContent(text), 'Ship &amp; Bill');
  assert.equal(text.attrs['font-size'], '13');
});

test('records 1-based line and column for each element', () => {
  const { svg } = parseSvg(DOC);
  const text = [...walk(svg)].find((e) => e.tag === 'text');
  assert.equal(text.line, 4);
  assert.equal(text.column, 3);
});

test('captures style element content as a text node', () => {
  const { svg } = parseSvg(DOC);
  const style = [...walk(svg)].find((e) => e.tag === 'style');
  assert.match(textContent(style), /PingFang SC/);
});

test('does not treat ">" inside a quoted attribute as the tag end', () => {
  const { svg, errors } = parseSvg('<svg><path d="M1,2 L3,4" aria-label="a > b"/></svg>');
  assert.deepEqual(errors, []);
  const path = [...walk(svg)].find((e) => e.tag === 'path');
  assert.equal(path.attrs['aria-label'], 'a > b');
  assert.equal(path.attrs.d, 'M1,2 L3,4');
});

test('skips the xml declaration and comments', () => {
  const { svg, errors } = parseSvg('<?xml version="1.0"?><!-- note --><svg id="k9"><!--x--></svg>');
  assert.deepEqual(errors, []);
  assert.equal(svg.attrs.id, 'k9');
});

test('reports a mismatched closing tag', () => {
  const { errors } = parseSvg('<svg><g></rect></g></svg>');
  assert.equal(errors.length, 1);
  assert.equal(errors[0].code, 'mismatched-tag');
});

test('reports an element that is never closed', () => {
  const { errors } = parseSvg('<svg><g></svg>');
  assert.ok(errors.some((e) => e.code === 'unclosed-tag'));
});

test('offsetToLineCol counts newlines from 1', () => {
  assert.deepEqual(offsetToLineCol('ab\ncde\nf', 5), { line: 2, column: 3 });
});

// --- CDATA tests ---

test('CDATA content is accessible via textContent', () => {
  const src = '<svg><style><![CDATA[text { font-family: "NotoSans-CDATA-sentinel"; }]]></style></svg>';
  const { svg, errors } = parseSvg(src);
  assert.deepEqual(errors, []);
  const style = [...walk(svg)].find((e) => e.tag === 'style');
  assert.match(textContent(style), /NotoSans-CDATA-sentinel/);
});

test('CDATA text node carries cdata:true marker', () => {
  const src = '<svg><style><![CDATA[body { color: red; }]]></style></svg>';
  const { svg } = parseSvg(src);
  const style = [...walk(svg)].find((e) => e.tag === 'style');
  const cdataNode = style.children.find((c) => c.type === 'text' && c.cdata === true);
  assert.ok(cdataNode, 'expected a text node with cdata:true');
  assert.match(cdataNode.value, /body \{ color: red; \}/);
});

test('plain text node does NOT carry cdata marker', () => {
  const src = '<svg><text>plain-sentinel</text></svg>';
  const { svg } = parseSvg(src);
  const textEl = [...walk(svg)].find((e) => e.tag === 'text');
  const textNode = textEl.children.find((c) => c.type === 'text');
  assert.ok(textNode, 'expected a plain text node');
  assert.ok(!textNode.cdata, 'plain text node must NOT have cdata:true');
});

test('CDATA content with ">" and "&" is preserved raw, no errors reported', () => {
  const src = '<svg><style><![CDATA[a > b & c < d]]></style></svg>';
  const { svg, errors } = parseSvg(src);
  assert.deepEqual(errors, []);
  const style = [...walk(svg)].find((e) => e.tag === 'style');
  assert.equal(textContent(style), 'a > b & c < d');
});

test('unterminated CDATA reports unclosed-cdata error', () => {
  const { errors } = parseSvg('<svg><style><![CDATA[never ends</style></svg>');
  assert.ok(errors.some((e) => e.code === 'unclosed-cdata'), 'expected unclosed-cdata error');
});

// --- entity escaping tests ---

test('reports a raw ampersand in text content with its line and column', () => {
  const { errors } = parseSvg('<svg>\n  <text>Load & Save</text>\n</svg>');
  const amp = errors.filter((e) => e.code === 'unescaped-ampersand');
  assert.equal(amp.length, 1);
  assert.equal(amp[0].line, 2);
  assert.equal(amp[0].column, 14);
});

test('accepts the five predefined entities', () => {
  const src = '<svg><text>a &amp; b &lt; c &gt; d &quot; e &apos; f</text></svg>';
  assert.deepEqual(parseSvg(src).errors, []);
});

test('accepts decimal and hex numeric character references', () => {
  assert.deepEqual(parseSvg('<svg><text>&#60;&#x3C;</text></svg>').errors, []);
});

test('reports an entity that XML does not predefine', () => {
  const { errors } = parseSvg('<svg><text>a &nbsp; b</text></svg>');
  const unknown = errors.filter((e) => e.code === 'unknown-entity');
  assert.equal(unknown.length, 1);
  assert.match(unknown[0].message, /&nbsp;/);
});

test('reports a raw greater-than in text content', () => {
  const { errors } = parseSvg('<svg><text>x > 0</text></svg>');
  assert.equal(errors.filter((e) => e.code === 'unescaped-gt').length, 1);
});

// An attribute-value error must point at the offending character, not at the start of the tag.
// Column 26 is counted by hand: `<svg><text aria-label="` occupies 23 characters, followed by `A`
// and a space; `&` falls at 1-indexed column 26.
test('reports a raw ampersand inside an attribute value at the ampersand column', () => {
  const { errors } = parseSvg('<svg><text aria-label="A & B">z</text></svg>');
  const amp = errors.filter((e) => e.code === 'unescaped-ampersand');
  assert.equal(amp.length, 1);
  assert.equal(amp[0].line, 1);
  assert.equal(amp[0].column, 26);
});

// Long attribute name, non-first line: the longer the attribute name, the larger the error if the tag
// start is used as a substitute for the value offset. This test pins both line and column.
// Column 35 is also counted by hand.
test('locates an attribute-value ampersand past a long attribute name', () => {
  const { errors } = parseSvg('<svg>\n  <text data-longattributename="a & b">z</text>\n</svg>');
  const amp = errors.filter((e) => e.code === 'unescaped-ampersand');
  assert.equal(amp.length, 1);
  assert.equal(amp[0].line, 2);
  assert.equal(amp[0].column, 35);
});

test('a clean document produces no escaping errors', () => {
  const src = '<svg><text aria-label="A &amp; B">Validate &amp; Sanitize</text></svg>';
  assert.deepEqual(parseSvg(src).errors, []);
});

// --- a raw `<` inside an attribute value ---
//
// A `<` is never legal in an attribute value: rsvg-convert refuses the file with "Couldn't find end
// of Start Tag" and Python's xml.etree calls it not well-formed, so nothing renders. The code and
// message below are written out in full rather than imported from the parser, because a test that
// reads its expected value from the module under test cannot tell a correct message from a renamed one.

test('a raw "<" inside a double-quoted attribute value is reported at the character', () => {
  const { errors } = parseSvg('<svg><rect data-note="a<b" x="1" y="2" width="3" height="4"/></svg>');
  assert.deepEqual(errors.map((e) => e.code), ['unescaped-lt']);
  assert.equal(errors[0].line, 1);
  // counted by hand: `<svg>` occupies 1–5, `<rect ` to 11, `data-note` to 20, `=` 21, `"` 22,
  // `a` 23 → the `<` falls at column 24.
  assert.equal(errors[0].column, 24);
  assert.equal(errors[0].message, 'Raw "<" in an attribute value; escape it as &lt;');
});

// Quoting style is the author's choice and cannot change the verdict; both renderers reject either form.
test('a raw "<" inside a single-quoted attribute value is reported at the same place', () => {
  const { errors } = parseSvg("<svg><rect data-note='a<b' x='1' y='2' width='3' height='4'/></svg>");
  assert.deepEqual(errors.map((e) => [e.code, e.column]), [['unescaped-lt', 24]]);
});

// Every occurrence is a separate edit for the author, matching how a bare `&` is reported.
test('every "<" in one attribute value is reported', () => {
  const { errors } = parseSvg('<svg><rect data-note="a<b<c" x="1" y="2" width="3" height="4"/></svg>');
  assert.deepEqual(errors.map((e) => [e.code, e.column]),
    [['unescaped-lt', 24], ['unescaped-lt', 26]]);
});

// The value shadowed by a duplicate never enters attrs, so without its own scan the author would have
// to remove the duplicate and run again before this `<` was ever mentioned.
test('the value shadowed by a duplicate is still scanned for "<"', () => {
  const { errors } = parseSvg('<svg><text data-k="a<b" data-k="c<d" x="1" y="2" font-size="9">t</text></svg>');
  assert.deepEqual(
    errors.map((e) => [e.code, e.column]),
    [['duplicate-attribute', 25], ['unescaped-lt', 21], ['unescaped-lt', 34]],
  );
});

// Counter-cases, and they carry more weight than the four above: the worst failure mode of this tool
// is blocking a diagram that renders. A `>` inside an attribute value is well-formed XML — both
// oracles accept it — and unlike the text-content case the house style gives no reason to escape it,
// so it must produce nothing at all, not even a warning.
test('a ">" inside an attribute value is accepted', () => {
  const cases = [
    '<svg><rect data-note="a>b" x="1" y="2" width="3" height="4"/></svg>',
    '<svg><path d="M1,2 L3,4" aria-label="latency > 200ms"/></svg>',
  ];
  for (const src of cases) {
    assert.deepEqual(parseSvg(src).errors, [], src);
  }
});

// The three positions where a raw `<` is well-formed and both oracles render the file. Flagging any
// of them would block a correct diagram, and the acceptance bar is zero errors and zero warnings.
test('a raw "<" is left alone where XML allows it', () => {
  const cases = {
    comment: '<svg><!-- a < b --><rect x="1" y="2" width="3" height="4"/></svg>',
    'cdata section': '<svg><desc><![CDATA[a < b]]></desc></svg>',
    'css inside a cdata section': '<svg><style><![CDATA[/* a < b */ text { font-family: A; }]]></style></svg>',
  };
  for (const [where, src] of Object.entries(cases)) {
    assert.deepEqual(parseSvg(src).errors, [], `raw < in ${where}`);
  }
});

// An escaped `<` is the fix the repair receipt asks for, so it must come out clean; and the
// attribute-value scan must not have disturbed the entity handling that already lived beside it.
test('an escaped "<" in an attribute value produces no errors', () => {
  const src = '<svg><rect data-note="a &lt; b &#60; c" x="1" y="2" width="3" height="4"/></svg>';
  assert.deepEqual(parseSvg(src).errors, []);
});

// Duplicate attribute name within the same tag. Column counting: 2 spaces + `<text ` to 8 + `x="5" ` to 14
// + `y="20" ` to 21 + `font-size="12" ` to 36 + `fill="#1e40af" ` to 51
// → the second `fill` name starts at column 52. The offset points at **the one to be removed**.
test('a duplicate attribute name is reported at the later occurrence', () => {
  const src = [
    '<svg viewBox="0 0 60 40" width="60">',
    '  <text x="5" y="20" font-size="12" fill="#1e40af" fill="#166534">Ship</text>',
    '</svg>',
  ].join('\n');
  const { errors } = parseSvg(src);
  assert.deepEqual(errors.map((e) => e.code), ['duplicate-attribute']);
  assert.equal(errors[0].line, 2);
  assert.equal(errors[0].column, 52);
  assert.match(errors[0].message, /Duplicate attribute "fill"/);
});

// The shadowed value must also be scanned for escaping. It does not enter attrs and is invisible to the
// scanning pass at the call site — without separate scanning, the user must fix the duplicate first and
// run again to see it; the intermediate report is incomplete.
// Column counting: `<svg viewBox="0 0 60 40" width="60">` occupies 1–36, `<text ` to 42,
// in `data-k="a & b" `: `data-k` 43–48, `=` 49, `"` 50, `a` 51, space 52 → first `&` at 53;
// second `data-k` name starts at 58, its `"` at 65, `c` 66, space 67 → second `&` at 68.
test('the value shadowed by a duplicate is still scanned for escaping', () => {
  const { errors } = parseSvg('<svg viewBox="0 0 60 40" width="60"><text data-k="a & b" data-k="c & d" x="5" y="20" font-size="12">t</text></svg>');
  assert.deepEqual(
    errors.map((e) => [e.code, e.column]),
    [['duplicate-attribute', 58], ['unescaped-ampersand', 53], ['unescaped-ampersand', 68]],
  );
});

// Counter-case, and the most important one in this task: an attribute name that collides with an
// Object.prototype member must **not** be reported as a duplicate. Under a plain object literal,
// `attrs['constructor'] !== undefined` is true on the very first lookup — a false positive, the worst
// failure mode of this tool. A genuine `&` that should be reported is included in the same document;
// otherwise a degenerate implementation that reports nothing also passes.
test('an attribute name that collides with Object.prototype is not a duplicate', () => {
  for (const name of ['constructor', 'toString', 'valueOf', 'hasOwnProperty']) {
    const { errors } = parseSvg(`<svg viewBox="0 0 60 40" width="60"><text ${name}="a" data-x="p & q" x="5" y="20" font-size="12">t</text></svg>`);
    assert.deepEqual(errors.map((e) => e.code), ['unescaped-ampersand'], `<text ${name}=…>`);
  }
});

// `__proto__` is a valid attribute name accepted by ATTR_RE (`[A-Za-z_:]` accepts an underscore-prefixed name).
// Under a plain object, `attrs['__proto__'] = v` hits the prototype setter and the attribute, along with any
// bare `&` in its value, silently disappears. A null prototype makes it a plain own property — this test
// pins both "the attribute is genuinely stored" and "escaping is genuinely scanned".
test('an attribute named __proto__ is kept and its content still scanned', () => {
  const { svg, errors } = parseSvg('<svg viewBox="0 0 60 40" width="60"><text __proto__="a & b" x="5" y="20" font-size="12">t</text></svg>');
  const text = svg.children.find((c) => c.tag === 'text');
  assert.equal(text.attrs.__proto__, 'a & b');
  assert.deepEqual(errors.map((e) => e.code), ['unescaped-ampersand']);
  // column must also be pinned: if the offset table falls back to a plain object,
  // `attrValueOffsets['__proto__'] = n` hits the prototype setter and is silently discarded;
  // the error is still reported but column becomes null — asserting only code cannot detect this.
  assert.equal(errors[0].column, 56);
});

test('each shadowed value is scanned at its own offset, not at the winning duplicate\'s', () => {
  // in the previous test, the & in each value has the same relative position of 2, so an implementation
  // that reads the wrong value still produces the same column. Here the positions are staggered (0 vs 2)
  // so the column can distinguish which value was actually scanned.
  const { errors } = parseSvg('<svg viewBox="0 0 60 40" width="60"><text data-k="&x" data-k="y & z" x="5" y="20" font-size="12">t</text></svg>');
  assert.deepEqual(
    errors.map((e) => [e.code, e.column]),
    [['duplicate-attribute', 55], ['unescaped-ampersand', 51], ['unescaped-ampersand', 65]],
  );
});

// --- comment well-formedness tests ---
//
// XML forbids `--` anywhere inside comment content, and forbids the content ending in `-`
// (that would make the terminator `--->`). Both make the file fail to parse, so neither can be
// left to the author to discover from a renderer. The codes and messages below are written out
// in full rather than imported from the parser: a test that reads its expected value from the
// module under test cannot tell a correct message from a renamed one.

test('a double hyphen inside a comment is reported at the hyphens', () => {
  const { errors } = parseSvg('<svg><!-- layout -- two columns --></svg>');
  assert.deepEqual(errors.map((e) => e.code), ['double-hyphen-in-comment']);
  assert.equal(errors[0].line, 1);
  // counted by hand: `<svg>` occupies 1–5, `<!--` 6–9, so the content starts at column 10;
  // ` layout ` is 8 characters, putting the first `-` at column 18.
  assert.equal(errors[0].column, 18);
  assert.equal(errors[0].message, 'A comment may not contain "--" anywhere in its content');
});

// The `--` here is part of what looks like the terminator, so a detector that only searches the
// content for `--` misses it: `<!-- note --->` leaves a trailing `-` in the content and XML rejects it.
test('a comment whose content ends with a hyphen is reported', () => {
  const { errors } = parseSvg('<svg><!-- note ---></svg>');
  assert.deepEqual(errors.map((e) => e.code), ['double-hyphen-in-comment']);
  // the content starts at column 10 and is ` note -`, putting its final `-` at column 16.
  assert.equal(errors[0].column, 16);
  assert.equal(errors[0].message, 'A comment may not end with "-", because that makes the terminator "--->"');
});

// The hyphens do not have to be surrounded by spaces. A detector that only matches a ` -- ` written as
// a dash in prose passes every other test here while letting `<!-- col--row -->` and a year range
// through, and both of those make the file fail to parse just the same.
test('a double hyphen with no spaces around it is reported', () => {
  const cases = [
    // the content starts at column 10; ` col` puts the first `-` of `col--row` at column 14
    ['<svg><!-- col--row --></svg>', 14],
    // ` 2026` puts it at column 15
    ['<svg><!-- 2026--2027 --></svg>', 15],
  ];
  for (const [src, column] of cases) {
    const { errors } = parseSvg(src);
    assert.deepEqual(errors.map((e) => e.code), ['double-hyphen-in-comment'], src);
    assert.equal(errors[0].column, column, src);
  }
});

// A run of four hyphens is one mistake and must read as one: the content is ` a --`, which both
// holds a `--` and ends with `-`. Reporting it twice would send the author looking for a second
// defect that is not there.
test('a run of hyphens before the terminator is reported once', () => {
  const { errors } = parseSvg('<svg><!-- a ----></svg>');
  assert.deepEqual(errors.map((e) => e.code), ['double-hyphen-in-comment']);
  // the content starts at column 10 and is ` a --`, putting the reported pair at column 13.
  assert.equal(errors[0].column, 13);
});

// Two separate mistakes in one comment are two findings, so the author can fix both in one pass
// rather than rerunning the tool to discover the second.
test('two separate double hyphens in one comment are both reported', () => {
  const { errors } = parseSvg('<svg><!-- a -- b -- c --></svg>');
  assert.deepEqual(errors.map((e) => [e.code, e.column]),
    [['double-hyphen-in-comment', 13], ['double-hyphen-in-comment', 18]]);
});

// Counter-cases, and they carry more weight than the two above: this tool's worst failure mode is
// blocking a diagram that renders perfectly. An empty comment is legal (the content is empty), and a
// single hyphen with text either side is legal.
test('an empty comment and a single hyphen inside a comment are accepted', () => {
  assert.deepEqual(parseSvg('<svg><!----></svg>').errors, []);
  assert.deepEqual(parseSvg('<svg><!-- - --></svg>').errors, []);
  assert.deepEqual(parseSvg('<svg><!-- a - b --></svg>').errors, []);
});

// A double hyphen is ordinary content everywhere except inside a comment. Flagging any of these
// four positions would block a file that every XML parser accepts.
test('a double hyphen outside a comment is left alone', () => {
  const cases = {
    'text content': '<svg><text x="1" y="2" font-size="9">cost -- benefit</text></svg>',
    'attribute value': '<svg><path d="M1,2 L3,4" stroke-dasharray="4--4" aria-label="cost -- benefit"/></svg>',
    'url in an attribute': '<svg><image href="https://example.com/a--b.png" x="0" y="0" width="4" height="4"/></svg>',
    'css inside style': '<svg><style>:root { --brand: #1e40af; } text { font-family: A; /* a -- b */ }</style></svg>',
    'cdata section': '<svg><style><![CDATA[text { font-family: A; /* a -- b */ }]]></style></svg>',
  };
  for (const [where, src] of Object.entries(cases)) {
    assert.deepEqual(parseSvg(src).errors, [], `double hyphen in ${where}`);
  }
});

// Each comment is judged on its own content. A detector that scans the whole source, or that runs
// from the first `<!--` to the last `-->`, would report the clean comment here as well.
test('only the comment holding the double hyphen is reported', () => {
  const src = [
    '<svg viewBox="0 0 60 40" width="60">',
    '  <!-- header: the box row -->',
    '  <!-- footer -- the note row -->',
    '  <!-- trailer: the legend -->',
    '</svg>',
  ].join('\n');
  const { errors } = parseSvg(src);
  assert.deepEqual(errors.map((e) => [e.code, e.line]), [['double-hyphen-in-comment', 3]]);
});

// `<!-->` and `<!--->` have no terminator at all: the two hyphens that open a comment cannot also
// serve as the first two of `-->`, so the shortest legal comment is `<!---->`. Python's xml.etree
// calls both of these an unclosed token and rsvg-convert renders neither, so "no terminator" is the
// right verdict rather than "a comment that closed early".
test('a comment with too few hyphens to close is unterminated', () => {
  for (const src of ['<svg><!--></svg>', '<svg><!---></svg>']) {
    const { errors } = parseSvg(src);
    assert.ok(errors.some((e) => e.code === 'unterminated-markup'), src);
  }
});

// The parser is fault-tolerant by design: one bad comment must not cost the report every other
// finding in the file. Without this, an author fixing the comment would be shown a fresh set of
// problems on the next run instead of all of them at once.
test('a comment defect does not stop the rest of the document from parsing', () => {
  const { svg, errors } = parseSvg('<svg id="k9"><!-- a -- b --><text x="1" y="2" font-size="9">Load & Save</text></svg>');
  assert.equal(svg.attrs.id, 'k9');
  assert.deepEqual(errors.map((e) => e.code), ['double-hyphen-in-comment', 'unescaped-ampersand']);
  const text = [...walk(svg)].find((e) => e.tag === 'text');
  assert.equal(textContent(text), 'Load & Save');
});

test('a raw > inside a shadowed value is left alone, as in any attribute', () => {
  // a bare `>` inside an attribute value is legal XML; the normal-attribute scanning path passes checkGt: false,
  // and the shadowed-value path must match it — otherwise the same character gets opposite results in the two paths.
  const { errors } = parseSvg('<svg viewBox="0 0 60 40" width="60"><text data-k="a > b" data-k="ok" x="5" y="20" font-size="12">t</text></svg>');
  assert.deepEqual(errors.map((e) => [e.code, e.column]), [['duplicate-attribute', 58]]);
});
