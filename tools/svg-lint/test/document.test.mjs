// tools/svg-lint/test/document.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSvg } from '../lib/parse-svg.mjs';
import { buildDocument, splitTop, effectiveFill, effectiveStroke } from '../lib/document.mjs';

const build = (src) => buildDocument(parseSvg(src));

// Every numeric value is deliberately distinct to prevent misaligned assertions from passing by coincidence.
const DOC = `<svg viewBox="0 0 400 180" width="400" xmlns="http://www.w3.org/2000/svg">
  <style>text { font-family: 'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', system-ui, sans-serif; }</style>
  <defs>
    <marker id="arrow-blue" markerWidth="8" markerHeight="8" refX="2" refY="4" orient="auto" markerUnits="userSpaceOnUse">
      <path d="M0,0 L8,4 L0,8 L2,4 z" fill="#3b82f6"/>
    </marker>
  </defs>
  <text x="163" y="32" font-size="16" fill="#1e293b" text-anchor="middle">Pipeline</text>
  <path d="M147,88 L 159,88" fill="none" stroke="#3b82f6" stroke-width="1.5" marker-end="url(#arrow-blue)"/>
  <rect x="31" y="70" width="111" height="36" rx="6" fill="#dbeafe" stroke="#3b82f6"/>
  <text x="86" y="92" font-size="12" fill="#1e40af" text-anchor="middle">Ingest</text>
  <g transform="translate(23, 5)">
    <rect x="147" y="65" width="103" height="36" rx="6" fill="#d1fae5" stroke="#22c55e"/>
    <text x="198" y="87" font-size="12" fill="#166534" text-anchor="middle">Store</text>
  </g>
</svg>`;

test('parses the viewBox and the width attribute', () => {
  const doc = build(DOC);
  assert.deepEqual(doc.viewBox, { x: 0, y: 0, width: 400, height: 180 });
  assert.equal(doc.widthAttr, '400');
});

// An empty string or pure whitespace in SVG is equivalent to no width at all. Normalising to null
// lets downstream code check a single "absent" condition; keeping the `?? null` form would let
// `width=""` slip past the `=== null` guard in the viewBox check.
test('an empty or whitespace-only width is normalized to null', () => {
  for (const attr of ['width=""', 'width="  "', "width='\t'"]) {
    const doc = build(`<svg viewBox="0 0 80 40" ${attr}><rect x="22" y="10" width="36" height="20"/></svg>`);
    assert.equal(doc.widthAttr, null, attr);
  }
  // Counter-case: a genuine width must not be normalised away, and surrounding whitespace must be trimmed before the value is stored.
  assert.equal(build('<svg viewBox="0 0 80 40" width=" 80 "><rect x="22" y="10" width="36" height="20"/></svg>').widthAttr, '80');
  assert.equal(build('<svg viewBox="0 0 80 40" height=""><rect x="22" y="10" width="36" height="20"/></svg>').heightAttr, null);
  assert.equal(build('<svg viewBox="0 0 80 40" height="40"><rect x="22" y="10" width="36" height="20"/></svg>').heightAttr, '40');
});

test('collects marker definitions with numeric attributes', () => {
  const marker = build(DOC).markers.get('arrow-blue');
  assert.equal(marker.markerWidth, 8);
  assert.equal(marker.refX, 2);
  assert.equal(marker.refY, 4);
  assert.equal(marker.markerUnits, 'userSpaceOnUse');
  assert.equal(marker.orient, 'auto');
});

test('excludes marker internals from the collected shapes', () => {
  const doc = build(DOC);
  // The path inside the arrowhead starts at the origin; if included, contentBBox would be pulled
  // to 0,0. Pin the whole bounding box rather than just asserting > 0 — the weaker check would
  // pass even a clearly wrong minX=1.
  assert.equal(doc.paths.length, 1);
  assert.deepEqual(doc.contentBBox, { minX: 31, minY: 20, maxX: 273, maxY: 106 });
});

test('accumulates translate into absolute coordinates', () => {
  const stored = build(DOC).rects.find((r) => r.fill === '#d1fae5');
  assert.equal(stored.x, 170);          // 147 + 23
  assert.equal(stored.y, 70);           // 65 + 5
  assert.deepEqual(stored.bbox, { minX: 170, minY: 70, maxX: 273, maxY: 106 });
});

test('applies translate to text coordinates too', () => {
  const stored = build(DOC).texts.find((t) => t.content === 'Store');
  assert.equal(stored.x, 221);          // 198 + 23
  assert.equal(stored.y, 92);           // 87 + 5
});

test('binds each text to the smallest rect that contains its centre', () => {
  const doc = build(DOC);
  const ingest = doc.texts.find((t) => t.content === 'Ingest');
  assert.equal(ingest.container.fill, '#dbeafe');
  const store = doc.texts.find((t) => t.content === 'Store');
  assert.equal(store.container.fill, '#d1fae5');
});

test('leaves the title unbound and exposes it as doc.title', () => {
  const doc = build(DOC);
  const title = doc.texts.find((t) => t.content === 'Pipeline');
  assert.equal(title.container, null);
  assert.equal(doc.title.content, 'Pipeline');
  assert.equal(doc.title.fontSize, 16);
});

// Hard-coded in full (copied from the style in DOC), not just a prefix: the **right boundary**
// of the capture group (`[^;}]+` missing the semicolon exclusion would consume one extra `;`)
// must be exercised. When only the prefix is pinned, an extra trailing semicolon goes unnoticed,
// yet the font-stack check compares character-for-character — one extra semicolon flags
// every compliant SVG as a violation, which is a false positive, the worst failure mode for this
// tool.
const FONT_STACK = "'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', system-ui, sans-serif";

test('reads the font stack out of the style element', () => {
  const doc = build(DOC);
  assert.equal(doc.styleFontFamily, FONT_STACK);
  // Compare against FONT_STACK, not against doc.styleFontFamily — the latter shares the same
  // source on both sides, so if the propagation step fails entirely (e.g. no assignment, both
  // sides null) the assertion still passes.
  assert.equal(doc.texts.every((t) => t.fontFamily === FONT_STACK), true);
});

// The implementation has a missing-font-size diagnostic, but no test above exercises it. When
// font-size is absent the fallback is 12 — the fallback value must be pinned too, otherwise
// changing it to something else would go unnoticed.
test('flags a text with no font-size anywhere in its ancestry', () => {
  const doc = build('<svg viewBox="0 0 60 40" width="60"><text x="5" y="20">hi</text></svg>');
  assert.ok(doc.notes.some((n) => n.code === 'missing-font-size'));
  assert.equal(doc.texts[0].fontSize, 12);
});

// The five shape branches in others (line/circle/ellipse/polygon/polyline) originally had zero
// assertions, yet the overlap check relies on their bounding boxes. The circle/ellipse
// branches also involve cx-r arithmetic; if wrong, the overlap check would silently mis-report.
// All expected values are hand-calculated independently. The polyline is additionally nested under
// a translate to confirm that dx/dy is correctly propagated to this branch (otherwise the result
// would be {90,30,100,35}).
test('computes bounding boxes for the other shape tags', () => {
  const doc = build(`<svg viewBox="0 0 120 60" width="120">
    <line x1="3" y1="7" x2="19" y2="23"/>
    <circle cx="30" cy="40" r="5"/>
    <ellipse cx="60" cy="50" rx="8" ry="3"/>
    <polygon points="70,10 80,15 75,25"/>
    <g transform="translate(1, 2)"><polyline points="90,30 100,35"/></g>
  </svg>`);
  const bboxOf = (tag) => doc.others.find((o) => o.element.tag === tag).bbox;
  assert.equal(doc.others.length, 5);
  assert.deepEqual(bboxOf('line'), { minX: 3, minY: 7, maxX: 19, maxY: 23 });
  assert.deepEqual(bboxOf('circle'), { minX: 25, minY: 35, maxX: 35, maxY: 45 });
  assert.deepEqual(bboxOf('ellipse'), { minX: 52, minY: 47, maxX: 68, maxY: 53 });
  assert.deepEqual(bboxOf('polygon'), { minX: 70, minY: 10, maxX: 80, maxY: 25 });
  assert.deepEqual(bboxOf('polyline'), { minX: 91, minY: 32, maxX: 101, maxY: 37 });
});

// These shapes carry the same colour keys as everything else, so that a check asking "is anything painted
// behind this label" can see them. Without them a label on a white disc is reported as unreadable.
test('records the colours and position of the other shape tags', () => {
  const doc = build(`<svg viewBox="0 0 120 60" width="120">
    <circle cx="30" cy="40" r="5" fill="#F8FAFC" stroke="#94A3B8"/>
    <g fill="#dbeafe"><polygon points="70,10 80,15 75,25"/></g>
    <ellipse cx="60" cy="50" rx="8" ry="3" fill="none"/>
  </svg>`);
  const shape = (tag) => doc.others.find((o) => o.element.tag === tag);
  // Normalised to lowercase, like every other colour in the model.
  assert.equal(shape('circle').fill, '#f8fafc');
  assert.equal(shape('circle').stroke, '#94a3b8');
  assert.equal(shape('circle').line, 2);
  assert.equal(shape('circle').column, 5);
  // The inheritance chain is resolved during collect, so a fill written on the group reaches the shape.
  assert.equal(shape('polygon').fill, '#dbeafe');
  // `none` is a declaration, not the absence of one, and it has to survive as itself: a check reading it
  // as "nothing declared" would fall back to the initial black and treat an outline as painted.
  assert.equal(shape('ellipse').fill, 'none');
  assert.equal(shape('ellipse').stroke, null);
});

test('records path stroke width and the referenced marker id', () => {
  const path = build(DOC).paths[0];
  assert.equal(path.strokeWidth, 1.5);
  assert.equal(path.markerEnd, 'arrow-blue');
  assert.deepEqual(path.points.at(-1), { x: 159, y: 88 });
});

test('inherits font-size from an ancestor group', () => {
  const doc = build('<svg viewBox="0 0 60 40" width="60"><g font-size="11"><text x="9" y="21">hi</text></g></svg>');
  assert.equal(doc.texts[0].fontSize, 11);
  assert.equal(doc.texts[0].hasOwnFontSize, false);
});

test('flags a transform it cannot model instead of silently mis-placing content', () => {
  const doc = build('<svg viewBox="0 0 60 40" width="60"><g transform="rotate(15)"><rect x="4" y="6" width="9" height="12"/></g></svg>');
  assert.ok(doc.notes.some((n) => n.code === 'unsupported-transform'));
});

test('flags a rect missing geometry attributes', () => {
  const doc = build('<svg viewBox="0 0 60 40" width="60"><rect x="4" y="6" height="12"/></svg>');
  assert.ok(doc.notes.some((n) => n.code === 'missing-geometry-attribute'));
});

// A length with a unit is valid SVG, but this tool's arithmetic assumes unitless numbers;
// Number('12px') yields NaN. Without reporting this, NaN causes all 12 checks to silently pass
// the element — the report is empty, but nothing was actually checked. This is a distinct problem
// from missing-geometry-attribute and must not be merged with it.
test('flags a non-numeric attribute value separately from a missing one', () => {
  const doc = build('<svg viewBox="0 0 60 40" width="60"><rect x="4" y="6" width="100%" height="12"/></svg>');
  const codes = doc.notes.map((n) => n.code);
  assert.ok(codes.includes('non-numeric-attribute'));
  assert.ok(!codes.includes('missing-geometry-attribute'), 'width is present, so it is not "missing"');
});

// font-size goes through the same path, and '12px' is the most common real-world form.
test('flags a font-size carrying a unit', () => {
  const doc = build('<svg viewBox="0 0 60 40" width="60"><text x="5" y="20" font-size="12px">hi</text></svg>');
  assert.ok(doc.notes.some((n) => n.code === 'non-numeric-attribute'));
});

// Counter-case: a fully numeric value must produce no notes, otherwise this diagnostic becomes a source of false positives.
test('a fully numeric rect produces no attribute notes', () => {
  const doc = build('<svg viewBox="0 0 60 40" width="60"><rect x="4" y="6" width="20" height="12" rx="3" stroke-width="2"/></svg>');
  const codes = doc.notes.map((n) => n.code);
  assert.ok(!codes.includes('non-numeric-attribute'));
  assert.ok(!codes.includes('missing-geometry-attribute'));
});

test('marks dashed rects as group boxes', () => {
  const doc = build('<svg viewBox="0 0 90 70" width="90"><rect x="7" y="9" width="61" height="43" stroke-dasharray="6,4" fill="#f8fafc"/></svg>');
  assert.equal(doc.rects[0].dashed, true);
});

test('returns an empty document when there is no svg element', () => {
  const doc = build('<html></html>');
  assert.equal(doc.viewBox, null);
  assert.deepEqual(doc.rects, []);
});

// ── The following tests fill assertion gaps found during independent verification. This module is
// the shared foundation for all 12 checks; a silent error in binding, bounding boxes, or
// diagnostic positions causes all 12 checks to produce a report that looks clean but checked
// nothing. All expected values are hand-calculated independently and cross-checked against
// module output.

// A dashed box is a group box, not a content box, so the group label must stay unbound (it will
// then be a candidate for doc.title). Removing the `!r.dashed` filter binds the label to the
// dashed box.
test('a label inside a dashed group box stays unbound', () => {
  const doc = build(`<svg viewBox="0 0 200 130" width="200">
    <rect x="20" y="30" width="160" height="60" fill="#f8fafc" stroke="#94a3b8" stroke-dasharray="6,4"/>
    <rect x="20" y="100" width="40" height="20" fill="#dbeafe" stroke="#3b82f6"/>
    <text x="30" y="44" font-size="10">Group label</text>
  </svg>`);
  const label = doc.texts.find((t) => t.content === 'Group label');
  assert.equal(label.container, null);
  assert.deepEqual(doc.rects.find((r) => r.dashed).texts, []);
});

// "The smallest containing box" is the core of the binding rule, but the original fixtures had
// no nested boxes — an implementation that picks the largest box still passes all of them. Here
// the inner box has area 800 and the outer 4320, with the text centre falling inside both.
// The two title assertions are also only discriminating in this configuration: 'Huge' has the
// largest font size (20) in the document but is already bound, so the title must be 'Big' (15)
// — the condition "pick only from unbound texts" is only observable here.
test('a text binds to the smallest containing rect and is backfilled onto it', () => {
  const doc = build(`<svg viewBox="0 0 200 130" width="200">
    <text x="10" y="18" font-size="15">Big</text>
    <text x="10" y="110" font-size="9">tiny</text>
    <rect x="40" y="50" width="120" height="36" fill="#dbeafe" stroke="#3b82f6"/>
    <rect x="46" y="54" width="40" height="20" fill="#d1fae5" stroke="#22c55e"/>
    <text x="66" y="68" font-size="20" text-anchor="middle">Huge</text>
  </svg>`);
  const huge = doc.texts.find((t) => t.content === 'Huge');
  assert.equal(huge.container.fill, '#d1fae5');
  assert.deepEqual(doc.rects.find((r) => r.fill === '#d1fae5').texts.map((t) => t.content), ['Huge']);
  assert.deepEqual(doc.rects.find((r) => r.fill === '#dbeafe').texts, []);
  assert.equal(doc.title.content, 'Big');
  assert.equal(doc.title.fontSize, 15);
});

// The SVG initial value for text-anchor is start. Getting the default wrong shifts every text
// bounding box that has no explicit anchor by half a text width — the overflow and overlap checks
// both break. Asserting only the field is not enough: the bounding box must also be pinned,
// otherwise "field set correctly but not passed to textBBox" still passes.
test('text-anchor defaults to start, not middle', () => {
  const doc = build('<svg viewBox="0 0 200 60" width="200"><text x="100" y="40" font-size="12">abcd</text></svg>');
  assert.equal(doc.texts[0].textAnchor, 'start');
  assert.deepEqual(doc.texts[0].bbox, { minX: 100, maxX: 128, minY: 31, maxY: 43 });
});

// center is the anchor for binding and overlap decisions. In this fixture the left edge of the
// text (x=30) extends outside the box while the midpoint 61.5 is still inside — writing center
// as minX would fail to bind it. All original fixtures have both the centre and minX inside the
// box, so they cannot tell the two apart.
test('a text centre is the bbox midpoint, which decides its container', () => {
  const doc = build(`<svg viewBox="0 0 200 80" width="200">
    <rect x="50" y="24" width="70" height="24" fill="#dbeafe" stroke="#3b82f6"/>
    <text x="30" y="40" font-size="12">wide text</text>
  </svg>`);
  const t = doc.texts[0];
  assert.deepEqual(t.center, { x: 61.5, y: 37 });
  assert.equal(t.container.fill, '#dbeafe');
});

// contentBBox is the input to the viewBox-clipping check. This fixture lets each of the four
// shape categories own one extremum: text contributes minX/minY, path contributes maxX,
// line (others) contributes maxY. Omitting any one category changes its number — yet the original
// assertions only checked minX/minY > 0, so all three missing categories still passed.
test('contentBBox unions rects, texts, paths and other shapes', () => {
  const doc = build(`<svg viewBox="0 0 120 100" width="120">
    <rect x="40" y="40" width="30" height="20" fill="#dbeafe" stroke="#3b82f6"/>
    <text x="20" y="30" font-size="12">T</text>
    <path d="M75,45 L 92,45" fill="none" stroke="#64748b"/>
    <line x1="50" y1="70" x2="60" y2="88" stroke="#64748b"/>
  </svg>`);
  assert.deepEqual(doc.contentBBox, { minX: 20, minY: 21, maxX: 92, maxY: 88 });
});

// Placing a connector inside a `<g transform="translate(...)">` is a common house style pattern,
// yet all original paths were at the top level — the code path through shiftSegments with a
// non-zero offset was never exercised, so the entire function could be deleted without turning
// a single test red.
test('a path inside a translated group gets shifted coordinates', () => {
  const doc = build('<svg viewBox="0 0 120 80" width="120"><g transform="translate(7, 3)"><path d="M10,20 L 40,20" stroke="#64748b" fill="none"/></g></svg>');
  const p = doc.paths[0];
  assert.deepEqual(p.points.at(0), { x: 17, y: 23 });
  assert.deepEqual(p.points.at(-1), { x: 47, y: 23 });
  assert.deepEqual(p.bbox, { minX: 17, minY: 23, maxX: 47, maxY: 23 });
});

// content must be decoded and rawContent kept verbatim: the former is used for width estimation,
// the latter for XML-escape checking. No original fixture contained entities, so removing
// `decodeEntities` entirely would not turn a single test red.
test('decodes XML entities in text content and keeps the raw form too', () => {
  const doc = build('<svg viewBox="0 0 80 40" width="80"><text x="5" y="20" font-size="12">A &amp;&#x2192; B</text></svg>');
  assert.equal(doc.texts[0].content, 'A &→ B');
  assert.equal(doc.texts[0].rawContent, 'A &amp;&#x2192; B');
});

// fill="none" is ubiquitous (connectors, transparent boxes). If non-hex paint values were
// normalised to null, the palette check could not distinguish "explicitly declared transparent"
// from "not written at all" — the two cases are handled differently.
test('keeps non-hex paint values verbatim instead of nulling them', () => {
  const doc = build('<svg viewBox="0 0 80 40" width="80"><rect x="5" y="5" width="20" height="10" fill="none" stroke="url(#grad)"/></svg>');
  assert.equal(doc.rects[0].fill, 'none');
  assert.equal(doc.rects[0].stroke, 'url(#grad)');
  const bare = build('<svg viewBox="0 0 80 40" width="80"><rect x="5" y="5" width="20" height="10"/></svg>');
  assert.equal(bare.rects[0].fill, null);
});

// The two marker attributes each follow a separate code path. The original assertions only covered
// markerEnd; wiring markerStart to marker-end as well still passes everything — the arrow check
// would then fail to see start-point arrowheads.
test('marker-start and marker-end are read independently', () => {
  const doc = build('<svg viewBox="0 0 80 40" width="80"><path d="M5,20 L 40,20" stroke="#64748b" fill="none" marker-start="url(#dot)" marker-end="url(#arrow)"/></svg>');
  assert.equal(doc.paths[0].markerStart, 'dot');
  assert.equal(doc.paths[0].markerEnd, 'arrow');
});

// Three defaults pinned together: the SVG initial value for stroke-width is 1 (downstream uses
// it to compute stroke outset); a missing rx is null rather than 0 (`null` = not written,
// `0` = explicitly set to a sharp corner); and the missing-attribute check must cover x/y as
// well as width/height (the original fixture omitted only width).
test('rect defaults: stroke-width 1, rx null, and every missing geometry attribute is reported', () => {
  const doc = build('<svg viewBox="0 0 80 40" width="80"><rect width="20" height="10"/></svg>');
  assert.equal(doc.rects[0].strokeWidth, 1);
  assert.equal(doc.rects[0].rx, null);
  assert.deepEqual(
    doc.notes.filter((n) => n.code === 'missing-geometry-attribute').map((n) => n.message),
    ['<rect> is missing the "x" attribute', '<rect> is missing the "y" attribute'],
  );
});

// A diagnostic without the correct position cannot be acted on. If line/column were hardcoded
// to 1, the report would still have content but every entry would point to line 1 — this
// regression would not turn any assertion that checks only code.
test('a note carries the offending element position, not a constant', () => {
  const doc = build([
    '<svg viewBox="0 0 80 60" width="80">',
    '  <rect x="4" y="6" width="20" height="12"/>',
    '  <rect x="4" y="30" height="12"/>',
    '</svg>',
  ].join('\n'));
  const n = doc.notes.find((x) => x.code === 'missing-geometry-attribute');
  assert.equal(n.line, 3);
  assert.equal(n.column, 3);
});

// In SVG, width="" is equivalent to absent and is treated as 0. Reporting it as non-numeric is
// a false positive — the worst failure mode for this tool.
test('an empty attribute value is treated as zero, not reported as non-numeric', () => {
  const doc = build('<svg viewBox="0 0 80 40" width="80"><rect x="" y="6" width="20" height="12"/></svg>');
  assert.ok(!doc.notes.some((n) => n.code === 'non-numeric-attribute'));
  assert.equal(doc.rects[0].x, 0);
});

// All five kinds must be reported. The original fixture only tested rotate; removing any of the
// other kinds from the regex would not turn a test red, yet unsupported-transform is the only
// escape hatch signalling that the geometry of this subtree may be wrong.
test('flags every transform kind it cannot model', () => {
  const doc = build(`<svg viewBox="0 0 200 200" width="200">
    <g transform="scale(2)"><rect x="1" y="1" width="2" height="2"/></g>
    <g transform="rotate(15)"><rect x="1" y="1" width="2" height="2"/></g>
    <g transform="matrix(1,0,0,1,0,0)"><rect x="1" y="1" width="2" height="2"/></g>
    <g transform="skewX(5)"><rect x="1" y="1" width="2" height="2"/></g>
    <g transform="skewY(5)"><rect x="1" y="1" width="2" height="2"/></g>
  </svg>`);
  assert.equal(doc.notes.filter((n) => n.code === 'unsupported-transform').length, 5);
});

// Elements inside <defs> are templates, not content. The original fixture's defs contained only
// a marker, which has its own branch that continues early — the inDefs guard was therefore never
// exercised.
test('shapes inside defs are not collected as content', () => {
  const doc = build(`<svg viewBox="0 0 80 40" width="80">
    <defs><rect id="tpl" x="0" y="0" width="9" height="9" fill="#dbeafe"/></defs>
    <rect x="20" y="10" width="20" height="12" fill="#d1fae5"/>
  </svg>`);
  assert.deepEqual(doc.rects.map((r) => r.fill), ['#d1fae5']);
});

// The element's own font-family takes priority over the style block's font stack (`??=` rather
// than `=`), otherwise the font-stack check would use the style value to audit an element that
// actually uses a different font.
// This also pins the trim: a deliberate space before the semicolon means that without trimming
// the value would carry a trailing space, and the font-stack check compares character-for-character.
test('a text keeps its own font-family instead of being overwritten by the style block', () => {
  const doc = build(`<svg viewBox="0 0 80 40" width="80">
    <style>text { font-family: 'PingFang SC', sans-serif ; }</style>
    <text x="5" y="20" font-size="12" font-family="monospace">code</text>
  </svg>`);
  assert.equal(doc.texts[0].fontFamily, 'monospace');
  assert.equal(doc.styleFontFamily, "'PingFang SC', sans-serif");
});

// Commenting out an old font stack is a common action when hand-editing a diagram. If comments
// are not stripped, the regex would extract the old value from inside the comment, reporting a
// compliant diagram as missing its font — a false positive, the worst failure mode.
// Placed in document.test.mjs rather than font-stack.test.mjs because the fix is in document.mjs.
test('CSS comments in style do not contaminate the font-family extraction', () => {
  const doc = build(`<svg viewBox="0 0 80 40" width="80">
    <style>/* was: text { font-family: Helvetica; } */ text { font-family: ${FONT_STACK}; }</style>
    <text x="5" y="20" font-size="12">hi</text>
  </svg>`);
  assert.equal(doc.styleFontFamily, FONT_STACK);
});

// The test above has only one single-line comment and cannot pin the comment-stripping
// implementation: replacing `[\s\S]*?` with `.*?`, with the greedy `[\s\S]*`, or removing the
// `g` flag all still pass — yet all three lead to false positives. The two tests below each
// target one variant: a live rule sandwiched between two comments (the greedy version would
// swallow it).
test('a live rule between two comments survives comment stripping', () => {
  const doc = build(`<svg viewBox="0 0 80 40" width="80">
    <style>/* old */ text { font-family: ${FONT_STACK}; } /* TODO */</style>
    <text x="5" y="20" font-size="12">hi</text>
  </svg>`);
  assert.equal(doc.styleFontFamily, FONT_STACK);
});

// The second comment is multi-line, contains a decoy rule, and appears before the live rule:
// the single-line regex cannot strip it, and the version without the `g` flag strips only the
// first comment — both extract Helvetica. The decoy value is a sentinel: when extraction goes
// wrong the result is Helvetica, not just null, so it is clear from the assertion where the
// error lies.
test('a multi-line comment holding a decoy rule is stripped too', () => {
  const doc = build(`<svg viewBox="0 0 80 40" width="80">
    <style>/* keep */ /* text {
      font-family: Helvetica;
    } */ text { font-family: ${FONT_STACK}; }</style>
    <text x="5" y="20" font-size="12">hi</text>
  </svg>`);
  assert.equal(doc.styleFontFamily, FONT_STACK);
});

// An unclosed `/*` in real CSS comments out everything from that point to the end of the file.
// Without stripping it, the regex would extract the rule inside the comment, making a file with
// nothing declared appear to have a font stack — the font-stack check would then silently produce
// a false negative.
test('an unclosed CSS comment makes the font-family unreachable', () => {
  const doc = build(`<svg viewBox="0 0 80 40" width="80">
    <style>/* keep for later: text { font-family: ${FONT_STACK}; }</style>
    <text x="5" y="20" font-size="12">hi</text>
  </svg>`);
  assert.equal(doc.styleFontFamily, null);
});

// A comma-separated selector list is valid CSS and a common pattern when hand-writing diagrams.
// Failing to extract from it would cause the font-stack check to report missing-font-stack on a
// correctly written file — a false positive, the worst failure mode.
test('a comma-separated selector list still yields the font stack', () => {
  const doc = build(`<svg viewBox="0 0 80 40" width="80">
    <style>text, tspan { font-family: ${FONT_STACK}; }</style>
    <text x="5" y="20" font-size="12">hi</text>
  </svg>`);
  assert.equal(doc.styleFontFamily, FONT_STACK);
});

// Counter-case: a rule whose class name merely ends in `text` must not be treated as a text
// rule. The decoy is placed **after** the live rule so that the selector match is genuinely
// required: if `.subtext` were mistaken for `text`, CSS cascading would let it override the
// compliant stack, making styleFontFamily 'Helvetica' (the sentinel value) and turning the
// assertion red. When the decoy comes first, "take the last rule" makes text{} win regardless
// of whether the guard is present, so nothing is pinned.
test('a class name ending in text is not mistaken for the text rule', () => {
  const doc = build(`<svg viewBox="0 0 80 40" width="80">
    <style>text { font-family: ${FONT_STACK}; } .subtext { font-family: Helvetica; }</style>
    <text x="5" y="20" font-size="12">hi</text>
  </svg>`);
  assert.equal(doc.styleFontFamily, FONT_STACK);
});

// Placing a marker outside <defs> is valid SVG, but the inDefs guard only takes effect inside
// defs — the continue in the marker branch only triggers in this configuration. Remove that
// continue and the arrowhead path inside the top-level marker, which starts at the origin,
// would pull contentBBox from {20,10,40,22} to {0,0,40,22}, causing the viewBox-clipping check
// to evaluate against an artificially enlarged content box.
test('excludes the internals of a marker declared outside defs', () => {
  const doc = build(`<svg viewBox="0 0 60 40" width="60">
    <marker id="a" markerWidth="8" markerHeight="8"><path d="M0,0 L8,4 L0,8 z" fill="#3b82f6"/></marker>
    <rect x="20" y="10" width="20" height="12" fill="#dbeafe"/>
  </svg>`);
  assert.equal(doc.paths.length, 0);
  assert.equal(doc.markers.has('a'), true);
  assert.deepEqual(doc.contentBBox, { minX: 20, minY: 10, maxX: 40, maxY: 22 });
});

// NUMERIC_ATTRS uses el.tag as a key. A plain object literal here is a **crash**-level problem:
// NUMERIC_ATTRS['constructor'] returns the Object constructor itself (not undefined, so `?? []`
// does not catch it), and iterating over a function with for...of throws TypeError — the entire
// linter dies with a stack trace instead of producing a report. These tag names are all valid
// XML. This repository has already hit the same trap twice, in the parser and in the model.
// parse-svg does not accept tag names beginning with underscores, so <__proto__> never reaches
// this point; the names that can actually trigger the issue are constructor / toString / valueOf /
// hasOwnProperty.
test('a tag name that collides with Object.prototype does not crash the model', () => {
  for (const tag of ['constructor', 'toString', 'valueOf', 'hasOwnProperty']) {
    // A genuine element that should produce a note (x="abc") is added to the same document.
    // Asserting only "no notes" is insufficient: these tag names are never in NUMERIC_ATTRS, so
    // the table always returns [], and an implementation that always falls back to [] still passes.
    // The expected note lets the assertion distinguish the two cases.
    const doc = build(`<svg viewBox="0 0 60 40" width="60"><${tag} x="1"/><text x="abc" y="20" font-size="12">t</text></svg>`);
    assert.deepEqual(doc.notes.map((n) => n.code), ['non-numeric-attribute'], `<${tag}>`);
    assert.deepEqual(doc.rects, []);
  }
});

// Background-box detection is based on an area ratio (≥ 98% of the viewBox area), and the
// threshold must be pinned at this magnitude. Loosening it to 50% would misclassify a large
// content box that fills most of the diagram as the background: it would then be excluded from
// contentRects and contentBBox, all its labels would become unbound, and title would be wrong.
// Here 80×80 is 64% of the viewBox.
test('a large content rect is not mistaken for the background', () => {
  const doc = build('<svg viewBox="0 0 100 100" width="100"><rect x="5" y="5" width="80" height="80" fill="#dbeafe" stroke="#3b82f6"/></svg>');
  assert.equal(doc.backgroundRect, null);
  assert.deepEqual(doc.contentRects.map((r) => r.fill), ['#dbeafe']);
});

// Without a viewBox there is no basis for comparison, so detection must be skipped entirely.
// If the fallback area were 1 (instead of 0), any box with non-zero area would satisfy the
// ≥ 0.98 condition, causing the first box to be excluded as the background — yet a missing
// viewBox is the problem viewbox-clipping is supposed to report, and the model should not add another
// layer of misclassification here.
test('without a viewBox no rect is guessed to be the background', () => {
  const doc = build('<svg width="100"><rect x="5" y="5" width="20" height="10" fill="#dbeafe"/></svg>');
  assert.equal(doc.viewBox, null);
  assert.equal(doc.backgroundRect, null);
  assert.deepEqual(doc.contentRects.map((r) => r.fill), ['#dbeafe']);
});

// groupRects previously had zero assertions: inverting the condition to "non-dashed boxes" still
// passed everything, which would cause subsequent group-spacing checks to use content boxes as
// group boxes. Asserting alongside contentRects pins the two as complements of each other.
test('groupRects holds the dashed boxes and nothing else', () => {
  const doc = build(`<svg viewBox="0 0 200 130" width="200">
    <rect x="10" y="10" width="180" height="70" fill="#f8fafc" stroke="#94a3b8" stroke-dasharray="6,4"/>
    <rect x="20" y="20" width="60" height="30" fill="#dbeafe" stroke="#3b82f6"/>
  </svg>`);
  assert.deepEqual(doc.groupRects.map((r) => r.fill), ['#f8fafc']);
  assert.deepEqual(doc.contentRects.map((r) => r.fill), ['#dbeafe']);
});

// When two unbound texts have the same font size, title takes the one that comes first in
// document order. The behaviour is deterministic but was not pinned — changing the reduce to
// `>=` would silently switch to the later one, and title is the input to the title-font-size
// and title-position checks.
test('title breaks a font-size tie by document order', () => {
  const doc = build(`<svg viewBox="0 0 200 80" width="200">
    <text x="10" y="20" font-size="14">First</text>
    <text x="10" y="60" font-size="14">Second</text>
  </svg>`);
  assert.equal(doc.title.content, 'First');
});

// ── The following tests cover the CSS parsing paths in document.mjs:
// inline style inheritance, at-rule stripping, last-declaration wins for duplicate rules,
// !important stripping, and empty-string guards.

// A text wrapped in `<g style="font-family:Helvetica">` should inherit fontFamily from the
// inline style. Without this test: reading only el.attrs['font-family'] would miss the entire
// inline-style path, causing t.fontFamily to fall back to the style-rule value and making the
// font-stack check produce three false negatives.
test('font-family from a <g> inline style is inherited by its child text', () => {
  const doc = build(`<svg viewBox="0 0 60 40" width="60">
  <style>text { font-family: 'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif; }</style>
  <g style="font-family: Helvetica">
    <text x="9" y="21" font-size="12">hi</text>
  </g>
</svg>`);
  assert.equal(doc.texts[0].fontFamily, 'Helvetica');
});

// inline style written directly on the <text> element itself.
test('font-family set via inline style on the text element itself takes effect', () => {
  const doc = build(`<svg viewBox="0 0 60 40" width="60">
  <style>text { font-family: 'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif; }</style>
  <text x="9" y="21" font-size="12" style="font-family: Helvetica">hi</text>
</svg>`);
  assert.equal(doc.texts[0].fontFamily, 'Helvetica');
});

// inline style takes priority over the presentation attribute (per the CSS specification).
// Without pinning this: if the priority were reversed (reading the attribute before the style),
// the attribute value would be returned when both are present and the difference would be
// invisible.
test('inline style takes priority over the font-family presentation attribute', () => {
  const doc = build(`<svg viewBox="0 0 60 40" width="60">
  <text x="9" y="21" font-size="12"
    font-family="'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif"
    style="font-family: Helvetica">hi</text>
</svg>`);
  assert.equal(doc.texts[0].fontFamily, 'Helvetica');
});

// Rules inside @media print {...} are not unconditionally active; styleFontFamily should only
// read the top-level text rule. Without this test: the at-rule block would not be stripped,
// 'serif' would be treated as the only fact, and styleFontFamily would be 'serif'.
test('@media block is stripped before extracting styleFontFamily', () => {
  const doc = build(`<svg viewBox="0 0 60 40" width="60">
  <style>@media print { text { font-family: serif; } } text { font-family: 'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif; }</style>
  <text x="9" y="21" font-size="12">hi</text>
</svg>`);
  assert.equal(doc.styleFontFamily, "'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif");
});

// @media placed after the main rule: without this test, an implementation that strips only the
// first at-rule block still passes the "@media first" case and misses the trailing case.
test('@media block placed after the main text rule is also stripped', () => {
  const doc = build(`<svg viewBox="0 0 60 40" width="60">
  <style>text { font-family: 'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif; } @media print { text { font-family: serif; } }</style>
  <text x="9" y="21" font-size="12">hi</text>
</svg>`);
  assert.equal(doc.styleFontFamily, "'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif");
});

// Nested at-rules (@supports wrapping @media): incorrect bracket depth fails to strip them cleanly.
test('nested at-rule blocks are fully stripped before extracting styleFontFamily', () => {
  const doc = build(`<svg viewBox="0 0 60 40" width="60">
  <style>@supports (color: red) { @media print { text { font-family: serif; } } } text { font-family: 'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif; }</style>
  <text x="9" y="21" font-size="12">hi</text>
</svg>`);
  assert.equal(doc.styleFontFamily, "'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif");
});

// @import has no block, only a trailing semicolon: it must be skipped on its own without affecting the rules that follow.
test('@import at-rule without a block does not prevent reading the following text rule', () => {
  const doc = build(`<svg viewBox="0 0 60 40" width="60">
  <style>@import url("base.css"); text { font-family: 'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif; }</style>
  <text x="9" y="21" font-size="12">hi</text>
</svg>`);
  assert.equal(doc.styleFontFamily, "'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif");
});

// CSS cascade takes the last declaration: the same selector written twice, with the second
// overriding the first. The second is the bad value, so styleFontFamily should be the bad value.
// Without this test: an implementation that takes only the first text{} rule silently misses the
// "good-first, bad-last" case.
test('when the text rule appears twice styleFontFamily is the last declaration — bad-last gives bad value', () => {
  const doc = build(`<svg viewBox="0 0 60 40" width="60">
  <style>text { font-family: 'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif; } text { font-family: Helvetica; }</style>
  <text x="9" y="21" font-size="12">hi</text>
</svg>`);
  assert.equal(doc.styleFontFamily, 'Helvetica');
});

// The reverse direction is also pinned: the good value is last, so styleFontFamily is the good value, not the earlier bad one.
test('when the text rule appears twice styleFontFamily is the last declaration — good-last gives good value', () => {
  const doc = build(`<svg viewBox="0 0 60 40" width="60">
  <style>text { font-family: Helvetica; } text { font-family: 'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif; }</style>
  <text x="9" y="21" font-size="12">hi</text>
</svg>`);
  assert.equal(doc.styleFontFamily, "'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif");
});

// `!important` is not a font name: stripping it allows the closing quote of the last family
// name to be correctly removed. When `!important` is left in, the closing quote of
// `Noto Sans CJK SC' !important` cannot be stripped, familyTokens ends up with
// `noto sans cjk sc' !important`, and all three required families are reported as missing —
// a false positive.
test('!important in the style rule is stripped so the family names are parsed correctly', () => {
  const doc = build(`<svg viewBox="0 0 60 40" width="60">
  <style>text { font-family: 'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC' !important; }</style>
  <text x="9" y="21" font-size="12">hi</text>
</svg>`);
  assert.equal(doc.styleFontFamily, "'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC'");
});

// An empty font-family is equivalent to not declared and must not override the inherited value.
// Without this test: the empty string bypasses the null guard, t.fontFamily becomes '',
// and the downstream font-stack check produces three false positives.
test('an empty font-family attribute does not override the inherited style stack', () => {
  const doc = build(`<svg viewBox="0 0 60 40" width="60">
  <style>text { font-family: 'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif; }</style>
  <text x="9" y="21" font-size="12" font-family="">hi</text>
</svg>`);
  assert.equal(doc.texts[0].fontFamily, "'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif");
});

// Pure whitespace follows the same rule: '   '.trim() === '' must be handled before comparing with null.
test('a whitespace-only font-family attribute does not override the inherited style stack', () => {
  const doc = build(`<svg viewBox="0 0 60 40" width="60">
  <style>text { font-family: 'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif; }</style>
  <text x="9" y="21" font-size="12" font-family="   ">hi</text>
</svg>`);
  assert.equal(doc.texts[0].fontFamily, "'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif");
});

test('an at-rule block is skipped whole, including a rule that follows a nested block', () => {
  // Only when the implementation stops at the first `}` does the rule following @supports inside
  // @media leak out and get treated as a global fact, making a diagram with no font declaration
  // report "missing three families" instead of "no font stack declared".
  const doc = build(`<svg viewBox="0 0 60 40" width="60">
    <style>@media print { @supports (color: red) { text { font-family: cursive; } } text { font-family: serif; } }</style>
    <text x="9" y="21" font-size="12">hi</text>
  </svg>`);
  assert.equal(doc.styleFontFamily, null);
});

test('!important is only stripped where CSS allows it — at the end of the declaration', () => {
  // A font name inside quotes is arbitrary text; `!important` appearing in the middle must be
  // kept as-is. Without anchoring to the end of the declaration, it would be removed from the
  // middle of the name, making the reported family name differ from what the author wrote.
  const doc = build(`<svg viewBox="0 0 60 40" width="60">
    <style>text { font-family: 'A !important B', 'Microsoft YaHei'; }</style>
    <text x="9" y="21" font-size="12">hi</text>
  </svg>`);
  assert.equal(doc.styleFontFamily, "'A !important B', 'Microsoft YaHei'");
});

test('!IMPORTANT in upper case is stripped too', () => {
  // CSS keywords are case-insensitive. Recognising only lowercase means the closing quote of
  // the last family name cannot be stripped, causing a compliant diagram to receive a false
  // positive.
  const doc = build(`<svg viewBox="0 0 60 40" width="60">
    <style>text { font-family: ${FONT_STACK} !IMPORTANT; }</style>
    <text x="9" y="21" font-size="12">hi</text>
  </svg>`);
  assert.equal(doc.styleFontFamily, FONT_STACK);
});

test('a property whose name merely ends in font-family is not read as font-family', () => {
  // Without anchoring to the start of the declaration, -moz-font-family would match first,
  // making the effective font for text the value of a vendor-prefix property — a compliant
  // diagram would receive three false positives.
  const doc = build(`<svg viewBox="0 0 60 40" width="60">
    <style>text { font-family: ${FONT_STACK}; }</style>
    <text x="9" y="21" font-size="12" style="-moz-font-family: Comic Sans; font-family: ${FONT_STACK}">hi</text>
  </svg>`);
  assert.equal(doc.texts[0].fontFamily, FONT_STACK);
});

test('an inline style declaring an empty font-family falls back to the style rule', () => {
  // If an empty value is not collapsed to null, the effective font of this text becomes an empty
  // string, and comparing it against the font stack reports "three families missing".
  const doc = build(`<svg viewBox="0 0 60 40" width="60">
    <style>text { font-family: ${FONT_STACK}; }</style>
    <text x="9" y="21" font-size="12" style="font-family:  ">hi</text>
  </svg>`);
  assert.equal(doc.texts[0].fontFamily, FONT_STACK);
});

// ── The following tests cover CSS entity decoding, descendant-selector guards,
// last-declaration wins within a block, and special characters inside strings.

// `&quot;` is the only valid way to write a double quote inside a double-quoted attribute in XML.
// It ends with `;`, so without decoding first a `;`-split of the CSS declaration treats
// `font-family: &quot` as the value and then reports "three families missing".
test('entity-encoded quotes in <style> font-family are decoded before CSS parsing', () => {
  const doc = build(`<svg viewBox="0 0 60 40" width="60">
    <style>text { font-family: &quot;PingFang SC&quot;, &quot;Microsoft YaHei&quot;, &quot;Noto Sans CJK SC&quot;, sans-serif; }</style>
    <text x="9" y="21" font-size="12">hi</text>
  </svg>`);
  assert.equal(doc.styleFontFamily, '"PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif');
});

// The same applies in an inline style: `&quot;` ends with `;`, so splitting on `;` without
// decoding first would yield `&quot` as the value. fontFamily should be the fully decoded
// stack, not the truncated `&quot`.
test('entity-encoded quotes in an inline style are decoded before CSS parsing', () => {
  const doc = build(`<svg viewBox="0 0 60 40" width="60">
    <text x="9" y="21" font-size="12" style="font-family: &quot;PingFang SC&quot;, &quot;Microsoft YaHei&quot;, &quot;Noto Sans CJK SC&quot;, sans-serif">hi</text>
  </svg>`);
  assert.equal(doc.texts[0].fontFamily, '"PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif');
});

// Entity encoding on an ancestor `<g>`'s inline style — the child `<text>` should inherit the fully decoded stack.
test('entity-encoded inline style on an ancestor <g> is decoded and inherited by child text', () => {
  const doc = build(`<svg viewBox="0 0 60 40" width="60">
    <g style="font-family: &quot;PingFang SC&quot;, &quot;Microsoft YaHei&quot;, &quot;Noto Sans CJK SC&quot;, sans-serif">
      <text x="9" y="21" font-size="12">hi</text>
    </g>
  </svg>`);
  assert.equal(doc.texts[0].fontFamily, '"PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif');
});

// A descendant selector (`.legend text`) is not a global text declaration. Treating it as one
// causes three false positives on a compliant diagram. The decoy is placed after the real rule
// to ensure that if the descendant selector is misread as bare `text`, CSS cascading lets it
// override the earlier compliant stack.
test('a descendant selector is not treated as a global text font declaration', () => {
  const doc = build(`<svg viewBox="0 0 60 40" width="60">
    <style>text { font-family: ${FONT_STACK}; } .legend text { font-family: Helvetica; }</style>
    <text x="9" y="21" font-size="12">hi</text>
  </svg>`);
  assert.equal(doc.styleFontFamily, "'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', system-ui, sans-serif");
});

// When `font-family` is declared twice in the same inline style, CSS takes the last one. Taking
// the first would silently miss the case where the later declaration overrides it with a bad value.
test('when font-family is declared twice in an inline style the last one wins', () => {
  const doc = build(`<svg viewBox="0 0 60 40" width="60">
    <text x="9" y="21" font-size="12" style="font-family: Helvetica; font-family: ${FONT_STACK}">hi</text>
  </svg>`);
  assert.equal(doc.texts[0].fontFamily, "'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', system-ui, sans-serif");
});

// An `@` inside a font name: without the hand-written scanner, an old regex treats `@` as the
// start of an at-rule, causing everything after that point to be consumed and styleFontFamily
// to become null — three false positives on a compliant diagram.
test('an at-sign inside a quoted font name is not treated as an at-rule', () => {
  const doc = build(`<svg viewBox="0 0 60 40" width="60">
    <style>text { font-family: 'A@B', ${FONT_STACK}; }</style>
    <text x="9" y="21" font-size="12">hi</text>
  </svg>`);
  assert.ok(doc.styleFontFamily?.startsWith("'A@B', "), `starts with 'A@B', : got ${doc.styleFontFamily}`);
  assert.ok(doc.styleFontFamily?.endsWith('sans-serif'), `ends with sans-serif: got ${doc.styleFontFamily}`);
});

// `/*` inside a font name: an old regex would treat it as the start of a comment, stripping
// everything from that point to the next `*/` (or end of input), causing the entire font-family
// declaration to disappear and styleFontFamily to become null — three false positives on a
// compliant diagram.
test('a comment-open sequence inside a quoted font name is not treated as a comment', () => {
  const doc = build(`<svg viewBox="0 0 60 40" width="60">
    <style>text { font-family: 'A/*B', ${FONT_STACK}; }</style>
    <text x="9" y="21" font-size="12">hi</text>
  </svg>`);
  assert.ok(doc.styleFontFamily?.startsWith("'A/*B', "), `starts with 'A/*B', : got ${doc.styleFontFamily}`);
  assert.ok(doc.styleFontFamily?.endsWith('sans-serif'), `ends with sans-serif: got ${doc.styleFontFamily}`);
});

// In `@import url("a{b.css")` the url string contains `{`; without the scanner it is treated
// as a block start, causing the text{} rule that follows to be skipped as if it were part of
// the @import block, making styleFontFamily null.
test('a brace inside a quoted @import url is not treated as a block start', () => {
  const doc = build(`<svg viewBox="0 0 60 40" width="60">
    <style>@import url("a{b.css"); text { font-family: ${FONT_STACK}; }</style>
    <text x="9" y="21" font-size="12">hi</text>
  </svg>`);
  assert.equal(doc.styleFontFamily, "'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', system-ui, sans-serif");
});

// ── Each of the following 8 tests pins one guard in the CSS scanner. These shapes are all
// valid or malformed-but-expected CSS. The common property: without the corresponding guard,
// a correctly written diagram would be reported as having a problem (false positive), or a rule
// that should not be active would become active (false negative).

// An unclosed `/*` in real CSS comments out everything from that point to the end of the file.
// Without this guard, the text rule inside the comment would be treated as a live rule and
// override the earlier one that actually takes effect.
test('an unclosed block comment hides everything after it, not the rule before it', () => {
  const doc = build(`<svg viewBox="0 0 80 40" width="80">
    <style>text { font-family: Helvetica; } /* text { font-family: ${FONT_STACK}; }</style>
    <text x="5" y="20" font-size="12">hi</text>
  </svg>`);
  assert.equal(doc.styleFontFamily, 'Helvetica');
});

// A `{` inside the quotes of an attribute selector is a plain character, not a block start.
// Without the scanner it would be treated as a block start, swallowing the text rule that
// follows into the declaration block and making a correctly written diagram appear to have no
// font stack — a false positive.
test('a brace inside an attribute selector string is not treated as a block start', () => {
  const doc = build(`<svg viewBox="0 0 80 40" width="80">
    <style>.a[data-x="{"] { fill: red; } text { font-family: ${FONT_STACK}; }</style>
    <text x="5" y="20" font-size="12">hi</text>
  </svg>`);
  assert.equal(doc.styleFontFamily, FONT_STACK);
});

// In malformed CSS a stray `}` may be preceded by a partial selector that must be discarded
// before accumulating the next one. Without discarding it, the following bare `text` would be
// contaminated into a descendant selector and no longer count as a global declaration — a
// correctly written diagram receives a false positive.
test('a stray closing brace resets the selector accumulator', () => {
  const doc = build(`<svg viewBox="0 0 80 40" width="80">
    <style>.a } text { font-family: ${FONT_STACK}; }</style>
    <text x="5" y="20" font-size="12">hi</text>
  </svg>`);
  assert.equal(doc.styleFontFamily, FONT_STACK);
});

// An unclosed string inside an at-rule consumes to the end — this is malformed input; the
// conservative choice is to treat it as nothing declared rather than guessing.
// Without the conservative treatment the scanner would parse subsequent content at the wrong
// position and might extract a spurious value from the noise, causing a false negative.
test('an unclosed string inside an at-rule causes the rest to be consumed, giving null', () => {
  const doc = build(`<svg viewBox="0 0 80 40" width="80">
    <style>@import url("unclosed; text { font-family: ${FONT_STACK}; }</style>
    <text x="5" y="20" font-size="12">hi</text>
  </svg>`);
  assert.equal(doc.styleFontFamily, null);
});

// A `}` inside a quoted font name is valid CSS; without recognising strings the block would
// end prematurely inside the quotes, truncating the value and causing the complete font stack
// to be misidentified.
test('a closing brace inside a quoted font name does not end the declaration block', () => {
  const doc = build(`<svg viewBox="0 0 80 40" width="80">
    <style>text { font-family: 'A}B', ${FONT_STACK}; }</style>
    <text x="5" y="20" font-size="12">hi</text>
  </svg>`);
  assert.equal(doc.styleFontFamily, `'A}B', ${FONT_STACK}`);
});

// Comments before `font-family` inside a declaration block must be stripped before matching,
// otherwise the declaration-start anchor `(?:^|;)` fails to match — the character before
// `font-family` is `*/`, which is neither the start of the string nor a semicolon, causing a
// correctly written diagram to be reported as missing its font stack.
test('a comment before font-family inside a declaration block is stripped before matching', () => {
  const doc = build(`<svg viewBox="0 0 80 40" width="80">
    <style>text { /* } */ font-family: ${FONT_STACK}; }</style>
    <text x="5" y="20" font-size="12">hi</text>
  </svg>`);
  assert.equal(doc.styleFontFamily, FONT_STACK);
});

// The declaration-start anchor is only genuinely tested when the vendor-prefix property appears
// **after** the compliant one: when it comes first, the "last declaration wins" rule makes the
// result correct regardless of whether the anchor is present. The test above that places it
// first therefore cannot replace this one — both orderings must be kept.
test('a vendor-prefix property after the compliant declaration does not shadow it', () => {
  const doc = build(`<svg viewBox="0 0 60 40" width="60">
    <style>text { font-family: ${FONT_STACK}; }</style>
    <text x="9" y="21" font-size="12" style="font-family: ${FONT_STACK}; -moz-font-family: Comic Sans">hi</text>
  </svg>`);
  assert.equal(doc.texts[0].fontFamily, FONT_STACK);
});

// When a later text rule does not declare font-family, it must not erase the earlier declaration
// — in CSS cascading "not declared" is not the same as "declared empty". Without this guard,
// the second empty rule would reset last to null.
test('a later text rule without font-family does not erase the earlier declaration', () => {
  const doc = build(`<svg viewBox="0 0 80 40" width="80">
    <style>text { font-family: ${FONT_STACK}; } text { fill: red; }</style>
    <text x="5" y="20" font-size="12">hi</text>
  </svg>`);
  assert.equal(doc.styleFontFamily, FONT_STACK);
});

// ── Each of the following 10 tests pins one degenerate shape of string-aware splitting at the
// value layer. If the scanner misidentifies a comment, string, or escape, it would either report
// a diagram that renders correctly in the browser as a violation, or miss a genuinely problematic
// one.

// `;` can legitimately appear inside quotes (as part of a `content` value). Only splitting on
// `;` outside strings gives the correct result; splitting inside quotes would extract a spurious
// font-family declaration, and because it comes after the real one it would win — three false
// positives on a diagram that renders correctly in the browser.
test('a semicolon inside a quoted content value is not treated as a declaration separator', () => {
  const doc = build(`<svg viewBox="0 0 60 40" width="60">
    <style>text { font-family: ${FONT_STACK}; content: "; font-family: Comic Sans"; }</style>
    <text x="5" y="20" font-size="12">hi</text>
  </svg>`);
  assert.equal(doc.styleFontFamily, FONT_STACK);
});

// The same must hold for the inline style path. Both paths share the same declaration-list
// scanner, but testing only one means that if the other degrades no test turns red.
test('a semicolon inside a quoted content value in inline style is not treated as a declaration separator', () => {
  const doc = build(`<svg viewBox="0 0 60 40" width="60">
    <text x="5" y="20" font-size="12" style="font-family: ${FONT_STACK}; content: '; font-family: Comic Sans'">hi</text>
  </svg>`);
  assert.equal(doc.texts[0].fontFamily, FONT_STACK);
});

// A font name itself can contain a semicolon (inside quotes). Splitting there would truncate the
// value — the extracted stack would start with `'A` instead of `'A;B'`, and the font-stack check
// would report three required fonts as missing.
test('a semicolon inside a quoted font name is preserved intact in the extracted value', () => {
  const doc = build(`<svg viewBox="0 0 60 40" width="60">
    <style>text { font-family: 'A;B', ${FONT_STACK}; }</style>
    <text x="5" y="20" font-size="12">hi</text>
  </svg>`);
  assert.equal(doc.styleFontFamily, `'A;B', ${FONT_STACK}`);
});

// CSS comments are also allowed in inline styles; when a comment precedes font-family the
// property-name anchor fails to match. The declaration-list scanner must strip comments and
// split on `;` in the same pass, otherwise the inline path silently degrades.
test('a CSS comment before font-family in an inline style does not prevent extraction', () => {
  const doc = build(`<svg viewBox="0 0 60 40" width="60">
    <text x="5" y="20" font-size="12" style="/* note */ font-family: ${FONT_STACK}">hi</text>
  </svg>`);
  assert.equal(doc.texts[0].fontFamily, FONT_STACK);
});

// `\` inside a CSS string escapes the next character, including the closing quote. Without
// recognising escapes, the string would end prematurely at `\'`, the following `;` would be
// treated as a declaration separator, and the value would be truncated to a `'A`-prefixed half.
test('a CSS escape sequence in a font name prevents premature string termination', () => {
  const doc = build(`<svg viewBox="0 0 60 40" width="60">
    <style>text { font-family: 'A\\';B', ${FONT_STACK}; }</style>
    <text x="5" y="20" font-size="12">hi</text>
  </svg>`);
  assert.equal(doc.styleFontFamily, `'A\\';B', ${FONT_STACK}`);
});

// An unclosed declaration block is malformed input, but that is no reason to silently discard
// the last character — the person reading the report cannot tell a truncation occurred. When the
// block is unclosed, endOfBlock returns css.length; the slice-end criterion must be decided by
// whether `}` is present rather than by subtracting 1 unconditionally.
test('an unclosed declaration block does not truncate the last character of the font-family value', () => {
  const doc = build(`<svg viewBox="0 0 60 40" width="60">
    <style>text { font-family: ${FONT_STACK}</style>
    <text x="5" y="20" font-size="12">hi</text>
  </svg>`);
  assert.equal(doc.styleFontFamily, FONT_STACK);
});

// Each <style> element is its own independent stylesheet: an unclosed `/*` in one element
// comments out only to the end of that element and must not suppress the rules in the next.
// Parsing element by element rather than concatenating guarantees this.
test('an unclosed comment in the first style element does not swallow the rules in the second', () => {
  const doc = build(`<svg viewBox="0 0 60 40" width="60">
    <style>/* todo</style>
    <style>text { font-family: ${FONT_STACK}; }</style>
    <text x="5" y="20" font-size="12">hi</text>
  </svg>`);
  assert.equal(doc.styleFontFamily, FONT_STACK);
});

// Omitting the semicolon from the last declaration is valid and common. The closing `}` must
// not be treated as part of the value; otherwise the font stack would gain a trailing `' }'`,
// causing the character-for-character font-stack check to flag every compliant diagram as a
// violation. This shape currently produces no finding — all three required fonts are present —
// so the extracted value is pinned directly.
test('a declaration without a trailing semicolon yields the font stack without a trailing brace', () => {
  const doc = build(`<svg viewBox="0 0 60 40" width="60">
    <style>text { font-family: ${FONT_STACK} }</style>
    <text x="5" y="20" font-size="12">hi</text>
  </svg>`);
  assert.equal(doc.styleFontFamily, FONT_STACK);
});

// A font-family declaration inside an unclosed `/*` must be entirely inactive. Without this
// guard it would instead win (cascade takes the later declaration), causing a correctly written
// diagram to receive three false positives.
test('a font-family inside an unclosed block comment does not override the prior declaration', () => {
  const doc = build(`<svg viewBox="0 0 60 40" width="60">
    <style>text { font-family: ${FONT_STACK}; /* font-family: Comic Sans }</style>
    <text x="5" y="20" font-size="12">hi</text>
  </svg>`);
  assert.equal(doc.styleFontFamily, FONT_STACK);
});

// When the font stack is declared in the first <style> element and subsequent elements contain
// other rules, it must still be found. This test is the reverse of the "unclosed comment does
// not span elements" test; both must be kept: with only one of them, an implementation that
// degrades to "look at only one element" still passes.
test('the font stack declared in the first style element is found when a second element adds other rules', () => {
  const doc = build(`<svg viewBox="0 0 60 40" width="60">
    <style>text { font-family: ${FONT_STACK}; }</style>
    <style>.a { fill: red; }</style>
    <text x="5" y="20" font-size="12">hi</text>
  </svg>`);
  assert.equal(doc.styleFontFamily, FONT_STACK);
});

// ── Each of the following 8 tests pins one degenerate shape of the unified entry point for
// non-structural fragments (comments / strings / escapes). All three fragment kinds go through
// the same entry point; if the scanner fails to recognise any one kind, the result is a false
// positive or false negative at that position.

// An at-rule prelude may contain comments, and those comments may contain `;` and `{`.
// If misidentified, the at-rule would end in the middle of the comment, and the text rule that
// follows would be swallowed as part of it — a compliant diagram would be reported as missing
// its font stack.
test('a comment in an at-rule prelude containing semicolons and braces does not end the at-rule prematurely', () => {
  const doc = build(`<svg viewBox="0 0 60 40" width="60">
    <style>@media print /* has ; and { */ { text { font-family: serif; } } text { font-family: ${FONT_STACK}; }</style>
    <text x="5" y="20" font-size="12">hi</text>
  </svg>`);
  assert.equal(doc.styleFontFamily, FONT_STACK);
});

// The same must hold for an at-rule with no block that ends at a semicolon (@import). Both
// forms go through the same scanner, but testing only one means that if the other degrades no
// test turns red.
test('a comment in an @import prelude containing a semicolon does not end the import prematurely', () => {
  const doc = build(`<svg viewBox="0 0 60 40" width="60">
    <style>@import /* drop this; */ url("base.css"); text { font-family: ${FONT_STACK}; }</style>
    <text x="5" y="20" font-size="12">hi</text>
  </svg>`);
  assert.equal(doc.styleFontFamily, FONT_STACK);
});

// `\` in CSS escapes the next character, even outside quotes. Without this, the semicolon in
// `\;` would be treated as a declaration separator, the value would be truncated to `A\`, and
// a compliant diagram would receive three false positives.
test('a backslash escape outside quotes in a style block is not treated as a declaration separator', () => {
  const doc = build(`<svg viewBox="0 0 60 40" width="60">
    <style>text { font-family: A\\;B, ${FONT_STACK}; }</style>
    <text x="5" y="20" font-size="12">hi</text>
  </svg>`);
  assert.equal(doc.styleFontFamily, `A\\;B, ${FONT_STACK}`);
});

// The inline style version of the third test above. Both paths share the same splitter; each is tested independently.
test('a backslash escape outside quotes in an inline style is not treated as a declaration separator', () => {
  const doc = build(`<svg viewBox="0 0 60 40" width="60">
    <text x="5" y="20" font-size="12" style="font-family: A\\;B, ${FONT_STACK}">hi</text>
  </svg>`);
  assert.equal(doc.texts[0].fontFamily, `A\\;B, ${FONT_STACK}`);
});

// An attribute selector value may contain a comma, which is not a selector list separator.
// Splitting there would produce a pseudo-selector named `text`, causing a rule that only applies
// to elements with a specific attribute to be treated as a global font declaration — a false
// positive.
test('a comma inside an attribute selector value is not treated as a selector list separator', () => {
  const doc = build(`<svg viewBox="0 0 60 40" width="60">
    <style>text { font-family: ${FONT_STACK}; } [data-x=",text,"] { font-family: Helvetica; }</style>
    <text x="5" y="20" font-size="12">hi</text>
  </svg>`);
  assert.equal(doc.styleFontFamily, FONT_STACK);
});

// The false-negative direction of the same trap: when the pseudo text selector carries the
// compliant stack and the real text rule uses a different font, the tool reports no problem while
// the browser renders the other font. This is a worse kind of failure than a false positive.
test('a comma inside an attribute selector value does not cause the rule to match as a plain type selector', () => {
  const doc = build(`<svg viewBox="0 0 60 40" width="60">
    <style>text { font-family: Helvetica; } [data-x=",text,"] { font-family: ${FONT_STACK}; }</style>
    <text x="5" y="20" font-size="12">hi</text>
  </svg>`);
  assert.equal(doc.styleFontFamily, 'Helvetica');
});

// The selector accumulator must be reset after an at-rule. In malformed input a partial selector
// fragment may precede the at-rule (a common result of hand-editing a stylesheet); without
// clearing it, the fragment would stick to the next selector, turning `text` into `.junk  text`
// so it is no longer a bare selector — a compliant diagram would be reported as missing its
// font stack.
test('the selector prelude is reset after an at-rule so a trailing junk fragment does not stick to the next selector', () => {
  const doc = build(`<svg viewBox="0 0 60 40" width="60">
    <style>.junk @media print { .a { fill: red; } } text { font-family: ${FONT_STACK}; }</style>
    <text x="5" y="20" font-size="12">hi</text>
  </svg>`);
  assert.equal(doc.styleFontFamily, FONT_STACK);
});

// A string literal in a selector position (`"junk" text`) is illegal in CSS and the entire rule
// is not applied by the browser. Discarding the string's content would collapse it into bare
// `text`, causing the tool to accept a declaration that the browser never applied — a silent
// false negative.
test('a string literal in a selector position is not collapsed into a bare type selector', () => {
  const doc = build(`<svg viewBox="0 0 60 40" width="60">
    <style>"junk" text { font-family: ${FONT_STACK}; }</style>
    <text x="5" y="20" font-size="12">hi</text>
  </svg>`);
  assert.equal(doc.styleFontFamily, null);
});

// ── The following tests pin the remaining three "non-structural fragment" kinds: bad-string
// termination, comments as token boundaries, and parenthesis groups as units. They go through
// the same entry point as the three above, so each kind needs its own shape — failing to
// recognise any one produces the same symptom: a diagram that renders correctly in the browser
// is reported as a violation, or a diagram whose font stack never took effect is judged as
// compliant.

// A missing closing quote is the most common typo when hand-writing a stylesheet. In CSS a
// string becomes a bad-string at a newline, invalidating only that one declaration; "consuming
// to the end" would swallow all subsequent rules including the one that actually declares the
// font stack — a diagram with nothing wrong except a missing quote would be reported as missing
// its font stack, and the fix suggestion would tell you to add what you already wrote.
test('a CSS string with a missing closing quote ends at the newline instead of swallowing the rest of the stylesheet', () => {
  const doc = build(`<svg viewBox="0 0 60 40" width="60">
    <style>.a { font-family: 'oops
}
text { font-family: ${FONT_STACK}; }</style>
    <text x="5" y="20" font-size="12">hi</text>
  </svg>`);
  assert.equal(doc.styleFontFamily, FONT_STACK);
});

// When the same typo occurs on a single line, the string runs to the end of the stylesheet;
// the `;` inside it is part of the font name, not a declaration separator — the browser handles
// EOF the same way (implicitly adding the closing quote). Terminating at the `;` would truncate
// the value, and the reported actual would not be what the author wrote. This test is the reverse
// of the one above; both must be kept: with only the newline test, an implementation that always
// terminates at a newline or semicolon still passes.
test('an unclosed CSS string with no newline runs to the end of the stylesheet', () => {
  const doc = build(`<svg viewBox="0 0 60 40" width="60">
    <style>text { font-family: 'oops; fill: red</style>
    <text x="5" y="20" font-size="12">hi</text>
  </svg>`);
  assert.equal(doc.styleFontFamily, "'oops; fill: red");
});

// CSS recognises three kinds of newline; a lone carriage return (old-style line endings) is one
// of them. Recognising only \n means the same typo in a file with these line endings still
// consumes the entire stylesheet.
test('a carriage return also ends a CSS string with a missing closing quote', () => {
  const doc = build(`<svg viewBox="0 0 60 40" width="60">
    <style>.a { font-family: 'oops\r}\rtext { font-family: ${FONT_STACK}; }</style>
    <text x="5" y="20" font-size="12">hi</text>
  </svg>`);
  assert.equal(doc.styleFontFamily, FONT_STACK);
});

test('a form feed also ends a CSS string with a missing closing quote', () => {
  const doc = build(`<svg viewBox="0 0 60 40" width="60">
    <style>.a { font-family: 'oops\f}\ftext { font-family: ${FONT_STACK}; }</style>
    <text x="5" y="20" font-size="12">hi</text>
  </svg>`);
  assert.equal(doc.styleFontFamily, FONT_STACK);
});

// The reverse case: a backslash followed by a newline is valid CSS line-continuation syntax;
// the string does not end there. Terminating the string at that point would truncate a complete
// family name, and the value would no longer be what the author wrote — a false positive.
// (This tool does not decode CSS escapes, so the family name is kept verbatim; the assertion
// pins "the value is not truncated".)
test('a backslash-newline continuation does not end a CSS string', () => {
  const doc = build(`<svg viewBox="0 0 60 40" width="60">
    <style>text { font-family: 'Pin\\
gFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC'; }</style>
    <text x="5" y="20" font-size="12">hi</text>
  </svg>`);
  assert.equal(doc.styleFontFamily, "'Pin\\\ngFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC'");
});

// A comment in CSS is a token boundary, not zero-width. `te/**/xt` is the descendant selector
// `te xt`, not `text`. Collapsing the comment to an empty string would glue it into bare `text`,
// causing the tool to accept a declaration that the browser never applied — a silent false negative.
test('a comment inside a selector separates it into two names instead of gluing it into a type selector', () => {
  const doc = build(`<svg viewBox="0 0 60 40" width="60">
    <style>te/**/xt { font-family: ${FONT_STACK}; }</style>
    <text x="5" y="20" font-size="12">hi</text>
  </svg>`);
  assert.equal(doc.styleFontFamily, null);
});

// The same applies to a property name: `font-fam/**/ily` is a property the browser does not
// recognise, so the declaration has no effect. Gluing it into `font-family` would cause the
// tool to report a font stack that never took effect — also a false negative.
test('a comment inside a property name does not glue it into font-family', () => {
  const doc = build(`<svg viewBox="0 0 60 40" width="60">
    <style>text { font-fam/**/ily: ${FONT_STACK}; }</style>
    <text x="5" y="20" font-size="12">hi</text>
  </svg>`);
  assert.equal(doc.styleFontFamily, null);
});

// The same applies to comments in values: collapsing to an empty string would glue two adjacent
// family names into a single non-existent family. The expected value is hard-coded in full
// because what is being pinned is precisely the character-level result "comment leaves a single
// space in place".
test('a comment between two font families keeps them as two families', () => {
  const doc = build(`<svg viewBox="0 0 60 40" width="60">
    <style>text { font-family: 'PingFang SC', 'Microsoft YaHei'/**/, 'Noto Sans CJK SC'; }</style>
    <text x="5" y="20" font-size="12">hi</text>
  </svg>`);
  assert.equal(doc.styleFontFamily, "'PingFang SC', 'Microsoft YaHei' , 'Noto Sans CJK SC'");
});

// Inside CDATA, `<!--` and `-->` are literal text and part of the CSS (an old technique to hide
// style content from ancient browsers that did not understand the style element). CSS ignores
// these two tokens and the rules still apply; treating them as part of the selector would make
// `<!-- text` no longer bare `text`, causing a compliant diagram to be reported as missing its
// font stack.
// Without CDATA, `<!-- … -->` is an XML comment and the CSS inside is invisible to the browser
// entirely; a separate test pins that side.
test('CDO and CDC tokens inside CDATA do not become part of the selector', () => {
  const doc = build(`<svg viewBox="0 0 60 40" width="60">
    <style><![CDATA[<!-- text { font-family: ${FONT_STACK}; } -->]]></style>
    <text x="5" y="20" font-size="12">hi</text>
  </svg>`);
  assert.equal(doc.styleFontFamily, FONT_STACK);
});

// A comma inside a parenthesis group is part of the group, not a selector list separator.
// Splitting there would produce a pseudo-selector named `text`, causing the `:not()` rule that
// only applies to other elements to be treated as a global font declaration — a false positive.
test('a comma inside a functional pseudo-class is not treated as a selector list separator', () => {
  const doc = build(`<svg viewBox="0 0 60 40" width="60">
    <style>text { font-family: ${FONT_STACK}; } :not(.a, text, .b) { font-family: Helvetica; }</style>
    <text x="5" y="20" font-size="12">hi</text>
  </svg>`);
  assert.equal(doc.styleFontFamily, FONT_STACK);
});

// The false-negative direction of the same trap: when the pseudo `text` selector carries the
// compliant stack and the real `text` rule uses a different font, the tool reports no problem
// while the browser renders the other font.
test('a comma inside a functional pseudo-class does not make the rule count as a global font declaration', () => {
  const doc = build(`<svg viewBox="0 0 60 40" width="60">
    <style>text { font-family: Helvetica; } :not(.a, text, .b) { font-family: ${FONT_STACK}; }</style>
    <text x="5" y="20" font-size="12">hi</text>
  </svg>`);
  assert.equal(doc.styleFontFamily, 'Helvetica');
});

// An unquoted `url()` may contain a semicolon as part of the filename. Treating it as a
// structural symbol would cause the at-rule to end in the middle of the parenthesis, swallowing
// the text rule that follows as part of it — a missing-font-stack false positive.
test('a semicolon inside an unquoted url() does not end the at-rule', () => {
  const doc = build(`<svg viewBox="0 0 60 40" width="60">
    <style>@import url(a;b.css); text { font-family: ${FONT_STACK}; }</style>
    <text x="5" y="20" font-size="12">hi</text>
  </svg>`);
  assert.equal(doc.styleFontFamily, FONT_STACK);
});

// The same position with a brace: treating it as a block start would cause the at-rule to swallow everything after it.
test('a brace inside an unquoted url() does not open a block', () => {
  const doc = build(`<svg viewBox="0 0 60 40" width="60">
    <style>@import url(a{b.css); text { font-family: ${FONT_STACK}; }</style>
    <text x="5" y="20" font-size="12">hi</text>
  </svg>`);
  assert.equal(doc.styleFontFamily, FONT_STACK);
});

// A parenthesised @media condition is the most common form of this at-rule kind; the condition
// contains both colons and parentheses. This is not malformed input — it is the path that any
// diagram using a media query will take.
test('a parenthesised media condition does not break the at-rule scan', () => {
  const doc = build(`<svg viewBox="0 0 60 40" width="60">
    <style>@media (min-width: 100px) { text { font-family: serif; } } text { font-family: ${FONT_STACK}; }</style>
    <text x="5" y="20" font-size="12">hi</text>
  </svg>`);
  assert.equal(doc.styleFontFamily, FONT_STACK);
});

// Quotes must be recognised inside a parenthesis group too: a `)` inside quotes is not the
// closing delimiter of the group. Closing the group there would expose the second half of the
// group, turning the comma back into a separator and producing another pseudo `text` selector
// — a false positive.
test('a quoted closing parenthesis inside a functional pseudo-class does not end the group', () => {
  const doc = build(`<svg viewBox="0 0 60 40" width="60">
    <style>:not([a=")"], text) { font-family: Helvetica; } text { font-family: ${FONT_STACK}; }</style>
    <text x="5" y="20" font-size="12">hi</text>
  </svg>`);
  assert.equal(doc.styleFontFamily, FONT_STACK);
});

// Square bracket groups and round bracket groups follow the same rule; each has its own test.
// An unquoted attribute selector value is an illegal selector and the browser does not apply
// the whole rule; splitting on the comma inside it would produce a pseudo-selector named `text`,
// causing the tool to accept a declaration the browser never applied. The pseudo-rule must come
// after the real rule for the test to discriminate — placed before it, the real rule would
// override it anyway.
test('a comma inside an unquoted attribute selector value is not treated as a selector list separator', () => {
  const doc = build(`<svg viewBox="0 0 60 40" width="60">
    <style>text { font-family: ${FONT_STACK}; } [data-x=,text,] { font-family: Helvetica; }</style>
    <text x="5" y="20" font-size="12">hi</text>
  </svg>`);
  assert.equal(doc.styleFontFamily, FONT_STACK);
});

// An unquoted `url(` is read according to CSS's own rules, consuming up to `)`: `[` is a valid
// URL character and does not open a bracket group. Treating it as a plain parenthesis group
// means the `[` never finds its `]` and consumes to the end of the stylesheet, causing the text
// rule that actually declares the font stack to disappear entirely — a diagram that renders
// correctly in the browser receives a missing-font-stack report.
test('a bracket inside an unquoted url() does not open a bracket group', () => {
  const doc = build(`<svg viewBox="0 0 60 40" width="60">
    <style>@import url(a[b.css); text { font-family: ${FONT_STACK}; }</style>
    <text x="5" y="20" font-size="12">hi</text>
  </svg>`);
  assert.equal(doc.styleFontFamily, FONT_STACK);
});

// The flip side of the same rule: a quote inside an unquoted url does not open a string.
// CSS treats such a URL as bad, but even a bad URL stops consuming at `)` — the rules that
// follow it take effect normally. Treating the quote as the start of a string would consume
// the entire stylesheet.
test('a quote inside an unquoted url() does not open a string', () => {
  const doc = build(`<svg viewBox="0 0 60 40" width="60">
    <style>@import url(it's.css); text { font-family: ${FONT_STACK}; }</style>
    <text x="5" y="20" font-size="12">hi</text>
  </svg>`);
  assert.equal(doc.styleFontFamily, FONT_STACK);
});

// A url() inside a declaration (the `src` of `@font-face` is the most common case) runs
// through a different scanner path — one test per path. Testing only the at-rule prelude
// path would leave the declaration path dead without any test catching it.
test('a bracket inside an unquoted url() in a declaration does not run past the block', () => {
  const doc = build(`<svg viewBox="0 0 60 40" width="60">
    <style>@font-face { src: url(a[b.woff); } text { font-family: ${FONT_STACK}; }</style>
    <text x="5" y="20" font-size="12">hi</text>
  </svg>`);
  assert.equal(doc.styleFontFamily, FONT_STACK);
});

// A quoted `url("…")` does not follow the rules above: it is a plain function token and its
// string is protected normally. Using a URL whose quoted content contains both `)` and `;`
// distinguishes the two paths — reading it as unquoted would stop at the `)` inside the
// string, exposing the `;` as a structural character and breaking the at-rule in the middle.
// Whitespace between the parenthesis and the quote: determining whether the form is quoted
// requires skipping whitespace first; without that skip, `url( "…" )` would be treated as
// an unquoted URL and fall into the same trap.
test('a quoted url() keeps its string intact so a parenthesis inside it does not end the token', () => {
  const doc = build(`<svg viewBox="0 0 60 40" width="60">
    <style>@import url( "a);b.css" ); text { font-family: ${FONT_STACK}; }</style>
    <text x="5" y="20" font-size="12">hi</text>
  </svg>`);
  assert.equal(doc.styleFontFamily, FONT_STACK);
});

// A `\` inside an unquoted url still escapes the next character, including a closing `)`.
// Without this, the URL would end at the escaped `)`, exposing the `;` that follows to
// terminate the at-rule; the remainder would attach to the next selector, bare `text` would
// no longer be bare `text`, and a missing-font-stack false positive would result.
test('a backslash escape inside an unquoted url() does not end the token early', () => {
  const doc = build(`<svg viewBox="0 0 60 40" width="60">
    <style>@import url(a\\);b.css); text { font-family: ${FONT_STACK}; }</style>
    <text x="5" y="20" font-size="12">hi</text>
  </svg>`);
  assert.equal(doc.styleFontFamily, FONT_STACK);
});

// The identifier `url` is matched ASCII case-insensitively, so `URL(` is the same thing.
// Recognising only the lowercase form would send the uppercase variant down the plain
// parenthesis-group path, where the `[` consumes to the end of the stylesheet.
test('an uppercase URL( is recognised as an unquoted url token', () => {
  const doc = build(`<svg viewBox="0 0 60 40" width="60">
    <style>@import URL(a[b.css); text { font-family: ${FONT_STACK}; }</style>
    <text x="5" y="20" font-size="12">hi</text>
  </svg>`);
  assert.equal(doc.styleFontFamily, FONT_STACK);
});

// `-url` is a valid identifier (a hyphen may lead it), so `-url(` is a plain function named
// `-url` and is not read by the url rules — the quote inside it opens a string normally,
// and this stylesheet has no active font stack in the browser either. If the identifier check
// omits the leading hyphen, any `-…url(` would be treated as a url token and parsed wrong.
test('a hyphen before url is part of the identifier so -url( is a plain function', () => {
  const doc = build(`<svg viewBox="0 0 60 40" width="60">
    <style>.a { background: -url(it's.png); } text { font-family: ${FONT_STACK}; }</style>
    <text x="5" y="20" font-size="12">hi</text>
  </svg>`);
  assert.equal(doc.styleFontFamily, null);
});

// An escaped backslash is also part of the identifier: `\\url` is a function named `\url`,
// not `url`. (A single `\u` never reaches this check — an escape sequence consumes two
// characters at once and the identifier check never runs; reaching the identifier check
// requires an already-escaped backslash, hence two backslash characters.)
test('an escaped backslash before url is part of the identifier', () => {
  const doc = build(`<svg viewBox="0 0 60 40" width="60">
    <style>.a { background: \\\\url(it's.png); } text { font-family: ${FONT_STACK}; }</style>
    <text x="5" y="20" font-size="12">hi</text>
  </svg>`);
  assert.equal(doc.styleFontFamily, null);
});

// CSS nesting: `&:hover { … }` is a nested rule whose declarations apply to a different
// selector, not to the outer declaration list. Without skipping the whole block, the
// `font-family` inside the nested rule would be treated as an outer declaration and, coming
// after the real declaration, would win — a diagram that renders correctly in the browser
// receives three false positives (and the extracted value carries a stray `}`).
// The trigger condition is two or more declarations inside the nested block (so there is an
// internal `;` to split on).
test('a nested rule inside a declaration list does not contribute its declarations', () => {
  const doc = build(`<svg viewBox="0 0 60 40" width="60">
    <style>text { font-family: ${FONT_STACK}; &:hover { opacity: .5; font-family: Helvetica } }</style>
    <text x="5" y="20" font-size="12">hi</text>
  </svg>`);
  assert.equal(doc.styleFontFamily, FONT_STACK);
});

// CSS does not require a `;` after a nested rule's `}`, so when the nested rule comes first
// its selector runs right up against the real declaration that follows. The entire nested
// rule (selector included) does not count as a declaration at this level; only what follows
// it does.
test('a declaration after a nested rule is read even without a separating semicolon', () => {
  const doc = build(`<svg viewBox="0 0 60 40" width="60">
    <style>text { &:hover { opacity: .5; color: red } font-family: ${FONT_STACK} }</style>
    <text x="5" y="20" font-size="12">hi</text>
  </svg>`);
  assert.equal(doc.styleFontFamily, FONT_STACK);
});

// When font-family is declared twice in the same rule with a nested rule between them, the
// later declaration still wins.
test('a nested rule between two declarations does not stop the later one from winning', () => {
  const doc = build(`<svg viewBox="0 0 60 40" width="60">
    <style>text { font-family: Helvetica; &:hover { opacity: .5 } font-family: ${FONT_STACK}; }</style>
    <text x="5" y="20" font-size="12">hi</text>
  </svg>`);
  assert.equal(doc.styleFontFamily, FONT_STACK);
});

// The false-negative side of the same issue, and the worse of the two: when the compliant
// stack is inside the nested block but a different font is declared in the outer rule, the
// tool would report no problem while the browser applies the non-compliant outer font to text.
test('a nested rule declaring the stack does not make the outer rule count as compliant', () => {
  const doc = build(`<svg viewBox="0 0 60 40" width="60">
    <style>text { font-family: Helvetica; &:hover { opacity: .5; font-family: ${FONT_STACK} } }</style>
    <text x="5" y="20" font-size="12">hi</text>
  </svg>`);
  assert.equal(doc.styleFontFamily, 'Helvetica');
});

// A bare `&` is the exception in nested rules: it targets exactly the outer elements
// themselves, so its declarations count at this level, and because it comes later it wins
// under CSS cascade. Discarding the whole block would cause a correctly rendered diagram
// to receive a false positive.
test('a nested rule whose selector is a bare ampersand contributes its declarations', () => {
  const doc = build(`<svg viewBox="0 0 60 40" width="60">
    <style>text { font-family: Helvetica; & { opacity: .5; font-family: ${FONT_STACK} } }</style>
    <text x="5" y="20" font-size="12">hi</text>
  </svg>`);
  assert.equal(doc.styleFontFamily, FONT_STACK);
});

// The other direction of the same exception: when a different font is declared inside
// a bare `&` rule, the browser uses that font, and the tool must not report the outer one.
test('a bare ampersand rule overrides the font stack declared before it', () => {
  const doc = build(`<svg viewBox="0 0 60 40" width="60">
    <style>text { font-family: ${FONT_STACK}; & { opacity: .5; font-family: Helvetica } }</style>
    <text x="5" y="20" font-size="12">hi</text>
  </svg>`);
  assert.equal(doc.styleFontFamily, 'Helvetica');
});

// A bare `&` may appear as one item in a selector list (`&, .x` targets both the outer
// elements and `.x`). The check looks for any item that is a bare `&`, not for the entire
// selector string equalling `&`.
test('a bare ampersand among other selectors still contributes its declarations', () => {
  const doc = build(`<svg viewBox="0 0 60 40" width="60">
    <style>text { font-family: Helvetica; &, .x { font-family: ${FONT_STACK} } }</style>
    <text x="5" y="20" font-size="12">hi</text>
  </svg>`);
  assert.equal(doc.styleFontFamily, FONT_STACK);
});

// A bare `&` block may itself contain further nesting, so the content inside it must be
// re-split as a declaration list rather than swallowed as a single declaration.
test('a bare ampersand rule nested inside another one still contributes', () => {
  const doc = build(`<svg viewBox="0 0 60 40" width="60">
    <style>text { font-family: Helvetica; & { & { font-family: ${FONT_STACK} } } }</style>
    <text x="5" y="20" font-size="12">hi</text>
  </svg>`);
  assert.equal(doc.styleFontFamily, FONT_STACK);
});

// `& text` is a descendant selector that targets text inside text, not the outer elements
// themselves, so its declarations do not count — missing one declaration is the conservative
// side; treating a declaration that applies elsewhere as belonging to these elements is the
// dangerous side.
test('a descendant nested selector does not contribute its declarations', () => {
  const doc = build(`<svg viewBox="0 0 60 40" width="60">
    <style>text { font-family: ${FONT_STACK}; & text { font-family: Helvetica } }</style>
    <text x="5" y="20" font-size="12">hi</text>
  </svg>`);
  assert.equal(doc.styleFontFamily, FONT_STACK);
});

// The bare-`&` check must split by selector list rather than using a raw `split(',')`:
// the `&` inside `:not(.a,&,.b)` is within a parenthesis group, so the whole selector is
// not a bare `&` and its declarations apply to other elements. A raw split would treat it
// as a separate item and claim those declarations belong to these elements — a diagram that
// renders correctly in the browser would receive three false positives.
test('an ampersand inside a functional pseudo-class is not a bare parent selector', () => {
  const grouped = build(`<svg viewBox="0 0 60 40" width="60">
    <style>text { font-family: ${FONT_STACK}; :not(.a,&,.b) { font-family: Helvetica } }</style>
    <text x="5" y="20" font-size="12">hi</text>
  </svg>`);
  assert.equal(grouped.styleFontFamily, FONT_STACK);
  // The same applies to `&` inside a quoted string in an attribute selector.
  const quoted = build(`<svg viewBox="0 0 60 40" width="60">
    <style>text { font-family: ${FONT_STACK}; [data-x="a,&,b"] { font-family: Helvetica } }</style>
    <text x="5" y="20" font-size="12">hi</text>
  </svg>`);
  assert.equal(quoted.styleFontFamily, FONT_STACK);
});

// Whether a block is closed must be determined from the scanning process itself, not by
// checking whether the last character is `}`: the `}` here is inside an unclosed string and
// is not the block's closing character. Cutting on it would truncate the value to
// `'PingFang SC`, losing one finding from the report in a way invisible to the reader.
test('a brace inside an unclosed string is not treated as the end of the block', () => {
  const doc = build(`<svg viewBox="0 0 60 40" width="60">
    <style>text { font-family: 'PingFang SC}</style>
    <text x="5" y="20" font-size="12">hi</text>
  </svg>`);
  assert.equal(doc.styleFontFamily, "'PingFang SC}");
});

// A bare `&` block goes through a different splitting path, and that path must also
// determine whether the block actually closed: the `}` here is inside an unclosed string,
// and cutting on it would truncate the value to `'PingFang SC`, losing one finding.
test('a nested bare ampersand block also keeps a brace that is inside an unclosed string', () => {
  const doc = build(`<svg viewBox="0 0 60 40" width="60">
    <style>text { font-family: Helvetica; & { font-family: 'PingFang SC}</style>
    <text x="5" y="20" font-size="12">hi</text>
  </svg>`);
  assert.equal(doc.styleFontFamily, "'PingFang SC}");
});

// When an at-rule block is unclosed the scanner must continue to the end of the stylesheet.
// Stopping just after `{` would let the rules inside leak to the top level and be treated as
// unconditionally active — a font stack inside `@media print` would cause the tool to pass a
// diagram that has no active font stack on screen, a silent false negative.
test('an unclosed at-rule block still swallows the rules inside it', () => {
  const doc = build(`<svg viewBox="0 0 60 40" width="60">
    <style>@media print { text { font-family: ${FONT_STACK} }</style>
    <text x="5" y="20" font-size="12">hi</text>
  </svg>`);
  assert.equal(doc.styleFontFamily, null);
});

// The same issue in another form: `}` inside an unclosed unquoted URL.
test('a brace inside an unclosed url token is not treated as the end of the block', () => {
  const doc = build(`<svg viewBox="0 0 60 40" width="60">
    <style>text { font-family: url(a}</style>
    <text x="5" y="20" font-size="12">hi</text>
  </svg>`);
  assert.equal(doc.styleFontFamily, 'url(a}');
});

// The "block is a nested rule" logic applies only at the declaration-list level. At the
// selector-list level, braces are ordinary characters — if that level treated braces as
// nested rules too, everything accumulated before the brace would be discarded.
test('the selector layer treats braces as ordinary characters', () => {
  assert.deepEqual(splitTop('a{b;c}d, e', ','), ['a{b;c}d', ' e']);
});

// When an unquoted url is missing its closing `)`, CSS treats everything that follows as
// part of that URL (reading to the end of input), so the block is also unclosed and the
// following text rule has no effect in the browser — reporting a missing font stack is
// correct. An implementation that stops at the next suspicious character would pass the
// diagram as compliant even though its CJK text cannot render.
test('an unclosed unquoted url() runs to the end of the stylesheet', () => {
  const doc = build(`<svg viewBox="0 0 60 40" width="60">
    <style>.a { background: url(x } text { font-family: ${FONT_STACK}; }</style>
    <text x="5" y="20" font-size="12">hi</text>
  </svg>`);
  assert.equal(doc.styleFontFamily, null);
});

// Only the standalone identifier `url` gets the unquoted-url rules. `myurl(` is a plain
// function where a quote opens a string normally (that is how CSS parses plain functions),
// so this stylesheet has no active font stack in the browser — reporting missing is correct.
// Removing this check would cause any function name ending in `url` to be treated specially.
test('only a standalone url identifier gets the unquoted-url rules', () => {
  const doc = build(`<svg viewBox="0 0 60 40" width="60">
    <style>.a { background: myurl(it's.png); } text { font-family: ${FONT_STACK}; }</style>
    <text x="5" y="20" font-size="12">hi</text>
  </svg>`);
  assert.equal(doc.styleFontFamily, null);
});

// The lengths of `<!--` and `-->` must both be consumed precisely. Consuming one character
// too many eats the first letter of the following rule's selector (`text` becomes `ext`);
// consuming one too few leaves a fragment of punctuation attached to the selector — either
// way bare `text` is no longer bare `text`. This test omits the surrounding spaces so the
// length can be verified; the CDATA test above has whitespace on both sides and would not
// catch an off-by-one.
test('the CDO and CDC tokens are consumed at their own lengths', () => {
  const doc = build(`<svg viewBox="0 0 60 40" width="60">
    <style><![CDATA[<!--text{font-family:Helvetica}-->text{font-family:${FONT_STACK}}]]></style>
    <text x="5" y="20" font-size="12">hi</text>
  </svg>`);
  assert.equal(doc.styleFontFamily, FONT_STACK);
});

// An unclosed parenthesis in CSS consumes everything to the end of input (the tokeniser
// supplies an implied closing token), so the value of this declaration is the entire
// remaining string; the browser discards the whole declaration along with the following text
// rule, leaving the diagram with no active font stack.
// The reported actual is that consumed string, pointing directly at the missing `)`.
// The assertion uses the full string because "consume to end" and "skip one character" differ
// only in this value.
// The final `}` is included in the value: the block itself is also unclosed (`A(` swallowed
// its `}`), so the `}` at the end of the stylesheet is not that block's closing character
// and must not be stripped.
test('an unclosed parenthesis runs to the end of the stylesheet', () => {
  const doc = build(`<svg viewBox="0 0 60 40" width="60">
    <style>text { font-family: A( ; } text { font-family: ${FONT_STACK}; }</style>
    <text x="5" y="20" font-size="12">hi</text>
  </svg>`);
  assert.equal(doc.styleFontFamily, `A( ; } text { font-family: ${FONT_STACK}; }`);
});

// A parenthesised group must be kept in the output rather than folded away like a comment:
// folding `var(--x, …)` would leave only `var`, making the reported actual unrecognisable
// to the author reading the report.
// (This tool does not parse custom properties, so a stack inside `var()` does not count as
// a declared font stack — that behaviour is pinned by the font-stack tests. This test only
// pins "the value is preserved as written".)
test('a parenthesised group keeps its original text in the value', () => {
  const doc = build(`<svg viewBox="0 0 60 40" width="60">
    <style>text { font-family: var(--x, ${FONT_STACK}); }</style>
    <text x="5" y="20" font-size="12">hi</text>
  </svg>`);
  assert.equal(doc.styleFontFamily, `var(--x, ${FONT_STACK})`);
});

// In a CRLF file, the newline after a backslash is **one** newline (`\r\n` is normalised to
// `\n` before tokenisation). Skipping only two characters would leave the `\n` in place,
// breaking the string at the continuation point and producing a truncated value with a
// stray `;` at the end. The continuation test above uses LF; only this test covers CRLF.
test('a backslash continuation followed by CRLF is treated as one newline', () => {
  const doc = build(`<svg viewBox="0 0 60 40" width="60">
    <style>text { font-family: 'Pin\\\r\ngFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC'; }</style>
    <text x="5" y="20" font-size="12">hi</text>
  </svg>`);
  assert.equal(doc.styleFontFamily, "'Pin\\\r\ngFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC'");
});

// ── Dashed grouping box labels are not the title ────────────────────────────
// The criteria for doc.title are tightened: free text whose centre falls inside a dashed
// box's bounding box is excluded from the candidate set. Without this exclusion, a diagram
// with no real title but with dashed grouping would promote a group label to the title,
// causing the title-not-centered check to fire on a compliant diagram — a false positive.

test('a dashed grouping box label does not become the title', () => {
  // Group label font-size 11, real title font-size 16 — the title wins on size alone too;
  // this test pins that the group label is not a candidate at all.
  const doc = build(`<svg viewBox="0 0 346 158" width="346">
    <style>text { font-family: ${FONT_STACK}; }</style>
    <text x="173" y="24" font-size="16" fill="#1e293b" text-anchor="middle">Real title</text>
    <rect x="16" y="40" width="200" height="90" stroke-dasharray="6,4" fill="#f8fafc" stroke="#94a3b8"/>
    <text x="26" y="56" font-size="11" fill="#64748b">Server</text>
  </svg>`);
  assert.equal(doc.title.content, 'Real title');
});

test('a diagram whose only free text is a group label has no title', () => {
  // Without exclusion, the group label would become the title, and block-spacing would then
  // report a title-not-centered finding on a compliant diagram — a false positive.
  const doc = build(`<svg viewBox="0 0 232 140" width="232">
    <style>text { font-family: ${FONT_STACK}; }</style>
    <rect x="16" y="20" width="200" height="90" stroke-dasharray="6,4" fill="#f8fafc" stroke="#94a3b8"/>
    <text x="26" y="36" font-size="11" fill="#64748b">Server</text>
  </svg>`);
  assert.equal(doc.title, null);
});

test('a free-floating title is still the title when no dashed box exists', () => {
  // Guard against over-correction: writing the exclusion as "no free text is ever the title"
  // would also make the two tests above pass.
  const doc = build(`<svg viewBox="0 0 232 140" width="232">
    <style>text { font-family: ${FONT_STACK}; }</style>
    <text x="116" y="24" font-size="16" fill="#1e293b" text-anchor="middle">Plain title</text>
    <rect x="22" y="40" width="80" height="36" fill="#dbeafe" stroke="#3b82f6"/>
  </svg>`);
  assert.equal(doc.title.content, 'Plain title');
});

// The y half of the exclusion condition must be pinned separately: dashed grouping boxes
// often span the full width of a diagram while the title is narrower, so the title's x
// interval falls inside the box's x interval. Checking x only would cause the real title
// to be treated as a group label, silently disabling the entire title-centred check — an
// off-centre title would produce no findings at all.
test('a title above a full-width dashed box is still the title', () => {
  const doc = build(`<svg viewBox="0 0 346 190" width="346">
    <style>text { font-family: ${FONT_STACK}; }</style>
    <text x="100" y="24" font-size="16" fill="#1e293b" text-anchor="middle">Short</text>
    <rect x="16" y="40" width="314" height="120" stroke-dasharray="6,4" fill="none" stroke="#94a3b8"/>
    <text x="26" y="56" font-size="11" fill="#64748b">Server</text>
  </svg>`);
  assert.equal(doc.title.content, 'Short');
});

// A group label is identified by its centre falling inside the dashed box, not by its full
// bounding box: the example in SKILL.md:103 is a long name such as `Employee instances`
// written inside a narrow dashed box, where the right edge overflows — requiring full
// containment would miss it, and it would again be treated as the title, causing
// block-spacing to report title-not-centered, the false positive this exclusion exists to prevent.
test('a long group label overflowing its dashed box is still not the title', () => {
  const doc = build(`<svg viewBox="0 0 122 132" width="122">
    <style>text { font-family: ${FONT_STACK}; }</style>
    <rect x="16" y="40" width="90" height="70" stroke-dasharray="4,4" fill="none" stroke="#94a3b8"/>
    <text x="26" y="56" font-size="11" fill="#64748b">Employee instances</text>
    <rect x="26" y="66" width="70" height="36" fill="#dbeafe" stroke="#3b82f6"/>
  </svg>`);
  assert.equal(doc.title, null);
});

// The converse: text whose x centre falls outside the dashed box is not its group label.
// Checking y only would cause annotation text to the right of a grouping box to be excluded
// as a group label, losing the diagram's title and silently disabling the centred-title check.
test('a text beside a dashed box, not inside it, is still the title', () => {
  const doc = build(`<svg viewBox="0 0 320 140" width="320">
    <style>text { font-family: ${FONT_STACK}; }</style>
    <rect x="16" y="40" width="120" height="60" stroke-dasharray="4,4" fill="none" stroke="#94a3b8"/>
    <rect x="26" y="52" width="100" height="36" fill="#dbeafe" stroke="#3b82f6"/>
    <text x="240" y="74" font-size="16" fill="#0f172a" text-anchor="middle">Aside</text>
  </svg>`);
  assert.equal(doc.title.content, 'Aside');
});

// A dashed full-canvas frame is a background decoration, not a grouping box: if it were
// added to groupRects, the real title inside it would be excluded as a group label
// (doc.title = null), silently disabling the centred-title check — no findings at all,
// which looks like the diagram passed.
test('a dashed full-canvas frame is not a grouping box', () => {
  const doc = build(`<svg viewBox="0 0 320 140" width="320">
    <style>text { font-family: ${FONT_STACK}; }</style>
    <rect x="0" y="0" width="320" height="140" stroke-dasharray="4,4" fill="none" stroke="#94a3b8"/>
    <text x="160" y="30" font-size="16" fill="#0f172a" text-anchor="middle">Framed</text>
    <rect x="26" y="52" width="100" height="36" fill="#dbeafe" stroke="#3b82f6"/>
  </svg>`);
  assert.deepEqual(doc.groupRects, []);
  assert.equal(doc.title.content, 'Framed');
  // It is still a background frame and must not appear in contentRects.
  assert.deepEqual(doc.contentRects.map((r) => r.fill), ['#dbeafe']);
});

// ---- Presentation-attribute colour inheritance and SVG initial value fallback ----

// Each test uses **different values** for the group colour and the element's own colour so
// the assertion clearly pins which source it is testing.
const COLORED = (body) => `<svg viewBox="0 0 200 100" width="200">${body}</svg>`;

test('a rect inherits fill from its group', () => {
  const doc = buildDocument(parseSvg(COLORED(
    '<g fill="#dbeafe"><rect x="10" y="10" width="80" height="36"/></g>',
  )));
  assert.equal(doc.rects[0].fill, '#dbeafe');
});

test('a rect inherits stroke from its group', () => {
  const doc = buildDocument(parseSvg(COLORED(
    '<g stroke="#3b82f6"><rect x="10" y="10" width="80" height="36"/></g>',
  )));
  assert.equal(doc.rects[0].stroke, '#3b82f6');
});

// An element's own attribute overrides the inherited value: the two sides have different
// colours, and the assertion receives the element's own colour.
test('a rect fill attribute beats the inherited group fill', () => {
  const doc = buildDocument(parseSvg(COLORED(
    '<g fill="#dbeafe"><rect x="10" y="10" width="80" height="36" fill="#d1fae5"/></g>',
  )));
  assert.equal(doc.rects[0].fill, '#d1fae5');
});

test('a rect stroke attribute beats the inherited group stroke', () => {
  const doc = buildDocument(parseSvg(COLORED(
    '<g stroke="#3b82f6"><rect x="10" y="10" width="80" height="36" stroke="#22c55e"/></g>',
  )));
  assert.equal(doc.rects[0].stroke, '#22c55e');
});

test('a path inherits stroke from its group', () => {
  const doc = buildDocument(parseSvg(COLORED(
    '<g stroke="#64748b"><path d="M10,50 L 90,50" fill="none"/></g>',
  )));
  assert.equal(doc.paths[0].stroke, '#64748b');
});

// Connectors always have fill="none". Without collecting this attribute, effectiveFill
// would fall back to the SVG initial black — palette-conformance compares it against the palette and
// every connector would receive a false positive.
test('a path fill attribute is collected', () => {
  const doc = buildDocument(parseSvg(COLORED('<path d="M10,50 L 90,50" fill="none" stroke="#64748b"/>')));
  assert.equal(doc.paths[0].fill, 'none');
});

test('a text inherits stroke from its group', () => {
  const doc = buildDocument(parseSvg(COLORED(
    '<g stroke="#22c55e"><text x="10" y="50" font-size="12">Ingest</text></g>',
  )));
  assert.equal(doc.texts[0].stroke, '#22c55e');
});

// Nested `<g>`: the innermost declaration wins. Three levels each use a different colour;
// the assertion receives the innermost one.
test('nested groups resolve fill to the innermost declaration', () => {
  const doc = buildDocument(parseSvg(COLORED(
    '<g fill="#dbeafe"><g fill="#d1fae5"><rect x="10" y="10" width="80" height="36"/></g></g>',
  )));
  assert.equal(doc.rects[0].fill, '#d1fae5');
});

// stroke travels a chain independent of fill, so "innermost wins" must be pinned
// separately for stroke: if only fill is tested, changing stroke to let the outer layer
// override the inner would leave the entire suite green.
test('nested groups resolve stroke to the innermost declaration', () => {
  const doc = buildDocument(parseSvg(COLORED(
    '<g stroke="#3b82f6"><g stroke="#22c55e"><rect x="10" y="10" width="80" height="36"/></g></g>',
  )));
  assert.equal(doc.rects[0].stroke, '#22c55e');
});

// Normalisation still applies on the new inheritance chain: an uppercase six-digit hex
// value must be lowercased.
test('an inherited fill is normalised to lowercase hex', () => {
  const doc = buildDocument(parseSvg(COLORED(
    '<g fill="#DBEAFE"><rect x="10" y="10" width="80" height="36"/></g>',
  )));
  assert.equal(doc.rects[0].fill, '#dbeafe');
});

// Nothing declared anywhere in the chain means rendered as black. Returning null would cause
// palette-conformance to skip a box that genuinely has no fill and renders black — a false negative.
test('effectiveFill falls back to the SVG initial black', () => {
  const doc = buildDocument(parseSvg(COLORED('<rect x="10" y="10" width="80" height="36"/>')));
  assert.equal(doc.rects[0].fill, null);
  assert.equal(effectiveFill(doc.rects[0]), '#000000');
});

test('effectiveStroke falls back to the SVG initial none', () => {
  const doc = buildDocument(parseSvg(COLORED('<rect x="10" y="10" width="80" height="36"/>')));
  assert.equal(effectiveStroke(doc.rects[0]), 'none');
});

// fill="none" is an explicit "no fill" from the author, not an absent declaration, and must
// not be replaced by the initial black.
test('an explicit fill of none is not replaced by the initial black', () => {
  const doc = buildDocument(parseSvg(COLORED('<rect x="10" y="10" width="80" height="36" fill="none"/>')));
  assert.equal(effectiveFill(doc.rects[0]), 'none');
});

// An empty or whitespace-only value is an invalid declaration, discarded and then falling
// back to the inherited or initial value — the same treatment as widthAttr in this file.
// Passing an empty string through would make parseHex('') return null, causing the contrast
// check to skip computing the ratio, and a label that truly renders as black would be
// silently missed.
test('an empty fill attribute is treated as undeclared, so the initial black applies', () => {
  const doc = buildDocument(parseSvg(COLORED('<rect x="10" y="10" width="80" height="36" fill=""/>')));
  assert.equal(doc.rects[0].fill, null);
  assert.equal(effectiveFill(doc.rects[0]), '#000000');
});

test('a whitespace-only stroke attribute is treated as undeclared', () => {
  const doc = buildDocument(parseSvg(COLORED('<rect x="10" y="10" width="80" height="36" stroke="  "/>')));
  assert.equal(effectiveStroke(doc.rects[0]), 'none');
});

// An empty value must be treated as undeclared at the cascade layer itself, not only at the
// leaf: when an inner `<g fill="">` would otherwise shadow the outer colour, the browser
// renders the outer light blue, and the model returning black would be a false positive.
test('an empty fill on an inner group does not block the outer group colour', () => {
  const doc = buildDocument(parseSvg(COLORED(
    '<g fill="#dbeafe"><g fill=""><rect x="10" y="10" width="80" height="36"/></g></g>',
  )));
  assert.equal(doc.rects[0].fill, '#dbeafe');
});

// Trimming whitespace must not corrupt valid values: a six-digit hex with surrounding spaces
// must still normalise to lowercase. (This test pins the hex branch; `parseHex` trims on its
// own, so it does not cover `paintAttr`.)
test('a colour padded with whitespace still normalises to lowercase hex', () => {
  const doc = buildDocument(parseSvg(COLORED('<rect x="10" y="10" width="80" height="36" fill=" #DBEAFE "/>')));
  assert.equal(doc.rects[0].fill, '#dbeafe');
});

// Non-hex values are passed through as-is, and whitespace trimming happens only in
// paintAttr — which is exactly what this test watches: without that trim, keywords would
// enter the model with surrounding spaces and all downstream `=== 'none'` comparisons would
// fail.
test('a non-hex paint value padded with whitespace is trimmed', () => {
  const doc = buildDocument(parseSvg(COLORED('<rect x="10" y="10" width="80" height="36" fill=" none "/>')));
  assert.equal(doc.rects[0].fill, 'none');
});

// Presentation attributes on the root `<svg>` are also part of the inheritance chain:
// without this, a box with a light-blue fill declared on `<svg>` would fall back to solid
// black, and palette-conformance would report a #000000 the author cannot find anywhere in the file.
test('a rect inherits fill and stroke declared on the root svg', () => {
  const doc = buildDocument(parseSvg(
    '<svg viewBox="0 0 200 100" width="200" fill="#dbeafe" stroke="#3b82f6">'
    + '<rect x="10" y="10" width="80" height="36"/></svg>',
  ));
  assert.equal(doc.rects[0].fill, '#dbeafe');
  assert.equal(doc.rects[0].stroke, '#3b82f6');
});

// Seeding must go through the same empty-value normalisation: `<svg fill="">` would otherwise
// inject an empty string into the entire chain, causing every box in the diagram that omits
// fill to receive a value parseHex cannot parse, making the contrast check silently skip each
// one.
test('an empty fill on the root svg is treated as undeclared', () => {
  const doc = buildDocument(parseSvg(
    '<svg viewBox="0 0 200 100" width="200" fill=""><rect x="10" y="10" width="80" height="36"/></svg>',
  ));
  assert.equal(doc.rects[0].fill, null);
  assert.equal(effectiveFill(doc.rects[0]), '#000000');
});

test('a group colour beats the same property declared on the root svg', () => {
  const doc = buildDocument(parseSvg(
    '<svg viewBox="0 0 200 100" width="200" fill="#dbeafe">'
    + '<g fill="#d1fae5"><rect x="10" y="10" width="80" height="36"/></g></svg>',
  ));
  assert.equal(doc.rects[0].fill, '#d1fae5');
});

// A group's colour must not leak outside the group: allocating a separate ctx per child is
// the structural guarantee, but without an assertion watching it, if someone later switches
// to modifying one shared ctx in place to save allocations, elements outside the group would pick up the
// group's colour (false positive) without any test catching it.
test('a sibling outside the group does not inherit the group colour', () => {
  const doc = buildDocument(parseSvg(COLORED(
    '<g fill="#dbeafe"><rect x="10" y="10" width="40" height="36"/></g>'
    + '<rect x="60" y="10" width="40" height="36"/>',
  )));
  assert.equal(doc.rects[0].fill, '#dbeafe');
  assert.equal(doc.rects[1].fill, null);
});

// Previously only the fill="none" case was covered for paths; the inheritance branch had
// no test watching it.
test('a path inherits fill from its group', () => {
  const doc = buildDocument(parseSvg(COLORED(
    '<g fill="#d1fae5"><path d="M10,50 L 90,50" stroke="#64748b"/></g>',
  )));
  assert.equal(doc.paths[0].fill, '#d1fae5');
});

test('effectiveFill returns a declared colour unchanged', () => {
  const doc = buildDocument(parseSvg(COLORED('<rect x="10" y="10" width="80" height="36" fill="#dbeafe"/>')));
  assert.equal(effectiveFill(doc.rects[0]), '#dbeafe');
});

// All three entity types resolve correctly in the same diagram: the group provides the base
// colour, the rect overrides its own stroke, and the path only inherits stroke.
test('fill and stroke resolve independently for rects, texts and paths', () => {
  const doc = buildDocument(parseSvg(COLORED(
    `<g fill="#dbeafe" stroke="#3b82f6">
      <rect x="10" y="10" width="80" height="36" stroke="#22c55e"/>
      <text x="20" y="30" font-size="12">Ingest</text>
      <path d="M100,30 L 180,30" fill="none"/>
    </g>`,
  )));
  assert.equal(effectiveFill(doc.rects[0]), '#dbeafe');
  assert.equal(effectiveStroke(doc.rects[0]), '#22c55e');
  assert.equal(effectiveFill(doc.texts[0]), '#dbeafe');
  assert.equal(effectiveStroke(doc.texts[0]), '#3b82f6');
  assert.equal(effectiveFill(doc.paths[0]), 'none');
  assert.equal(effectiveStroke(doc.paths[0]), '#3b82f6');
});

// styleText (the concatenated full text) has no consumers — styleFontFamily uses the
// per-element styleTexts. Keeping it would lead the next person to believe "concatenated
// full text" is a required interface and add logic on top of it.
test('the document model no longer carries the unused styleText field', () => {
  const doc = buildDocument(parseSvg(
    '<svg viewBox="0 0 200 100" width="200"><style>text { font-family: serif; }</style></svg>',
  ));
  assert.equal('styleText' in doc, false);
  assert.deepEqual(doc.styleTexts, ['text { font-family: serif; }']);
});

test('stroke="inherit" resolves to the ancestor colour, not to the keyword', () => {
  // `inherit` means "take the parent's value", and collect resolves it so that what a check receives is the
  // colour in force. Carried through as the keyword instead, the border that renders pink is judged as a
  // colour name, and on a box whose fill belongs to a triple the pairing arm quotes "inherit" as the stroke
  // to replace rather than the value in force.
  const doc = build(`<svg viewBox="0 0 120 60" width="120">
    <g stroke="#ec4899"><rect x="12" y="12" width="90" height="30" fill="#dbeafe" stroke="inherit"/></g>
  </svg>`);
  assert.equal(doc.rects[0].stroke, '#ec4899');
});

test('fill="INHERIT" resolves as well, the keyword being case-insensitive', () => {
  const doc = build(`<svg viewBox="0 0 120 60" width="120">
    <g fill="#dbeafe"><rect x="12" y="12" width="90" height="30" fill="INHERIT"/></g>
  </svg>`);
  assert.equal(doc.rects[0].fill, '#dbeafe');
});

test('inherit with nothing to inherit stays undeclared', () => {
  // No ancestor declares a stroke, so there is no value to take. Resolving to the keyword instead would put a
  // string that is not a colour where checks expect either a colour or null.
  const doc = build('<svg viewBox="0 0 120 60" width="120"><rect x="12" y="12" width="90" height="30" stroke="inherit"/></svg>');
  assert.equal(doc.rects[0].stroke, null);
});

test('inherit on the root svg has nothing above it to take', () => {
  // The root's chain is seeded by hand rather than through childContext, so it is its own read site. Left
  // unresolved the keyword itself becomes the inherited value and every descendant reports it as a colour.
  const doc = build('<svg viewBox="0 0 120 60" width="120" fill="inherit"><rect x="1" y="1" width="9" height="9"/></svg>');
  assert.equal(doc.rects[0].fill, null);
});

test('inherit on the marker element resolves to what the marker inherits', () => {
  // A third read site: the marker's own attributes are read directly, not through the cascade.
  const doc = build(`<svg viewBox="0 0 120 60" width="120" fill="#64748b"><defs>
    <marker id="arrow" markerWidth="8" markerHeight="8" fill="inherit"><path d="M0,0 L8,4 L0,8 z"/></marker>
  </defs></svg>`);
  assert.equal(doc.markers.get('arrow').fill, '#64748b');
});

test('inherit on the arrowhead resolves to what the arrowhead inherits', () => {
  // And a fourth: the descent into the marker reads shape attributes directly too. Each site left out hands
  // a colour check the literal keyword, which it then reports as a colour name on a compliant diagram.
  const doc = build(`<svg viewBox="0 0 120 60" width="120" fill="#64748b"><defs>
    <marker id="arrow" markerWidth="8" markerHeight="8"><path d="M0,0 L8,4 L0,8 z" fill="inherit"/></marker>
  </defs></svg>`);
  assert.equal(doc.markers.get('arrow').fill, '#64748b');
});

// ---- what the walk does with a transform it cannot model ----
// The note exists so that a diagram whose geometry this tool mis-measures says so out loud. It must therefore
// fire wherever geometry is read, and stay quiet where none is.
test('a transform on defs does not warn about geometry under it', () => {
  // Nothing inside <defs> is measured — its content is referenced, not drawn — so a transform there moves
  // nothing this tool reads, and warning that geometry may be wrong is advice about a subtree no check sees.
  const doc = build(`<svg viewBox="0 0 120 60" width="120"><defs transform="rotate(30)">
    <marker id="arrow" markerWidth="8" markerHeight="8"><path d="M0,0 L8,4 L0,8 z" fill="#64748b"/></marker>
  </defs></svg>`);
  assert.equal(doc.notes.some((n) => n.code === 'unsupported-transform'), false);
});

test('a transform on a group inside defs does not warn either', () => {
  // Suppressing the note for the <defs> element alone leaves it firing one level in, on exactly the same
  // nothing: the content of defs is referenced, not drawn, at every depth.
  const doc = build(`<svg viewBox="0 0 120 60" width="120"><defs><g transform="rotate(30)">
    <marker id="arrow" markerWidth="8" markerHeight="8"><path d="M0,0 L8,4 L0,8 z" fill="#64748b"/></marker>
  </g></defs></svg>`);
  assert.equal(doc.notes.some((n) => n.code === 'unsupported-transform'), false);
});

test('a transform on a group is still reported', () => {
  // The counterpart: the note has to survive where it means something, or suppressing it for defs has
  // quietly switched it off everywhere.
  const doc = build(`<svg viewBox="0 0 120 60" width="120"><g transform="rotate(30)">
    <rect x="12" y="12" width="90" height="30" fill="#dbeafe"/>
  </g></svg>`);
  assert.equal(doc.notes.some((n) => n.code === 'unsupported-transform'), true);
});

// ---- Unmodelled path commands must leave a receipt ----
// parsePath collapses A / S / T to zero length; the remaining points cannot form the real
// trajectory and overlap skips the whole path. This must be surfaced: an author who draws an
// arc crossing a box and sees "0 errors, 0 warnings" has reason to believe the diagram
// passed. Same escape hatch as unsupported-transform.
const PATHED = (d) => `<svg viewBox="0 0 320 180" width="320">
    <path d="${d}" fill="none" stroke="#94a3b8"/>
  </svg>`;

test('an arc command leaves a note saying this path geometry may be wrong', () => {
  // The wording must not say "skip this path": only overlap skips it; viewbox-clipping and
  // arrow-marker still measure the collapsed fake trajectory and may produce the opposite
  // conclusion. The assertion uses the full message text to pin this exact wording.
  const n = build(PATHED('M22,58 A 80 80 0 0 1 280,58')).notes
    .find((x) => x.code === 'unsupported-path-command');
  assert.equal(n.message, 'Path command "A" is not modelled; geometry checks on this path may be wrong');
  assert.equal(n.line, 2);
  assert.equal(n.column, 5);
});

test('the note names the command that is not modelled, not a generic one', () => {
  // Reporting only "an unsupported command exists" would leave the author unable to find
  // which segment to fix. Each of the three commands reports itself.
  const codeOf = (d) => build(PATHED(d)).notes
    .find((x) => x.code === 'unsupported-path-command').message.match(/"(.+?)"/)[1];
  assert.equal(codeOf('M22,58 S 60,20 120,58 L 300,58'), 'S');
  assert.equal(codeOf('M22,58 Q 50,40 80,58 T 300,58'), 'T');
  assert.equal(codeOf('M0,0 a 5 5 0 0 1 10,0'), 'A');
});

test('a path built only from modelled commands leaves no note', () => {
  // Negative control: without this test, an implementation that emits a note for every path
  // would still pass, which would add noise to every diagram.
  const codes = build(PATHED('M22,58 L 100,58 C 140,58 180,58 220,58 Q 260,58 300,58 Z')).notes
    .map((n) => n.code);
  assert.equal(codes.includes('unsupported-path-command'), false);
});

// ---- the arrow colour and the position of <marker> ----
// The inner shapes of a marker are deliberately not recursed into as diagram content, so the arrow color can only be collected at the marker collect site.
// Without collecting it, no check in the whole repository can read it — a #ff00ff arrow passes silently.
const MARKED = (head, markerAttrs = '') => `<svg viewBox="0 0 200 100" width="200">
    <defs>
      <marker id="arrow" markerWidth="8" markerHeight="8" refX="2" refY="4" orient="auto" markerUnits="userSpaceOnUse"${markerAttrs}>${head}</marker>
    </defs>
  </svg>`;

test('a marker carries the fill of its arrowhead, normalised to lowercase', () => {
  const doc = build(MARKED('<path d="M0,0 L8,4 L0,8 z" fill="#64748B"/>'));
  assert.equal(doc.markers.get('arrow').fill, '#64748b');
});

test('a marker whose arrowhead declares no fill carries null', () => {
  // null = nothing declared anywhere along the chain. The palette check falls back to pure black through effectiveFill before judging —
  // an arrow with no fill written is black in the browser, and black is not in the palette, so it should be reported.
  const doc = build(MARKED('<path d="M0,0 L8,4 L0,8 z"/>'));
  assert.equal(doc.markers.get('arrow').fill, null);
});

test('an empty fill on an arrowhead counts as undeclared', () => {
  // The same definition as widthAttr / rect: `fill=""` is an invalid declaration in SVG and gets discarded.
  const doc = build(MARKED('<path d="M0,0 L8,4 L0,8 z" fill="  "/>'));
  assert.equal(doc.markers.get('arrow').fill, null);
});

test('a marker carries its own position, not its arrowhead\'s', () => {
  // The finding has to point at the <marker> line: what the author has to change is that marker's definition.
  const doc = build(MARKED('<path d="M0,0 L8,4 L0,8 z" fill="#64748b"/>'));
  const m = doc.markers.get('arrow');
  assert.equal(m.line, 3);
  assert.equal(m.column, 7);
});

test('the existing marker keys are untouched by the colour key', () => {
  // The arrow-marker check reads these keys. Adding a fill must not disturb them.
  const m = build(MARKED('<path d="M0,0 L8,4 L0,8 z" fill="#64748b"/>')).markers.get('arrow');
  assert.equal(m.markerWidth, 8);
  assert.equal(m.markerHeight, 8);
  assert.equal(m.refX, 2);
  assert.equal(m.refY, 4);
  assert.equal(m.markerUnits, 'userSpaceOnUse');
  assert.equal(m.element.tag, 'marker');
});

test('a fill on the marker element reaches the arrowhead that declares none', () => {
  // fill inherits, so this arrow renders slate. Reading the arrowhead's own attribute alone collects null
  // and a colour check then judges the SVG initial value, black, which is not what anyone sees.
  const doc = build(MARKED('<path d="M0,0 L8,4 L0,8 z"/>', ' fill="#64748B"'));
  assert.equal(doc.markers.get('arrow').fill, '#64748b');
});

test('an arrowhead fill wins over one on the marker element', () => {
  // The nearer declaration is the one that renders. Reversing the two would name a colour the reader
  // cannot see anywhere in the arrow.
  const doc = build(MARKED('<path d="M0,0 L8,4 L0,8 z" fill="#22c55e"/>', ' fill="#ff1493"'));
  assert.equal(doc.markers.get('arrow').fill, '#22c55e');
});

test('an invalid arrowhead fill inherits the marker element colour', () => {
  // `fill="  "` is discarded rather than obeyed, and a discarded declaration inherits like any other, so
  // this arrow renders slate too. Treating "the attribute is present" as "the colour is here" collects
  // null and loses the colour that is written one line up.
  const doc = build(MARKED('<path d="M0,0 L8,4 L0,8 z" fill="  "/>', ' fill="#64748b"'));
  assert.equal(doc.markers.get('arrow').fill, '#64748b');
});

test('a marker carries its arrowhead stroke as well as its fill', () => {
  // An open-V arrowhead is drawn with a stroke and no fill, so recording only the fill loses its colour
  // entirely. The two are resolved one at a time: this one declares the stroke and inherits the fill.
  const doc = build(MARKED('<path d="M0,0 L8,4 L0,8" stroke="#64748B"/>', ' fill="none"'));
  assert.equal(doc.markers.get('arrow').stroke, '#64748b');
  assert.equal(doc.markers.get('arrow').fill, 'none');
});

test('a marker with a solid arrowhead carries no stroke', () => {
  // The house-style arrowhead declares a fill and nothing else, and nothing along the chain declares a
  // stroke, so null is the honest answer rather than a colour nobody wrote.
  const doc = build(MARKED('<path d="M0,0 L8,4 L0,8 z" fill="#64748b"/>'));
  assert.equal(doc.markers.get('arrow').stroke, null);
});

test('an arrowhead painted none keeps none, whatever the marker element says', () => {
  // `none` is a valid declaration meaning "do not paint", not a missing one, so it is not overridden by
  // the marker's colour -- and the palette check has nothing to judge.
  const doc = build(MARKED('<path d="M0,0 L8,4 L0,8 z" fill="none"/>', ' fill="#ff1493"'));
  assert.equal(doc.markers.get('arrow').fill, 'none');
});

// The chain above the <marker> matters as much as the two levels inside it. `fill` and `stroke` are
// inherited properties and <defs> does not interrupt inheritance, so a paint on an ancestor reaches the
// arrowhead. Resolving only the marker and its children collects null here, and the palette check then
// reports #000000 -- pure black, which appears nowhere in these files, on arrows that render magenta.
const ABOVE = (svgAttrs, head) => `<svg viewBox="0 0 200 100" width="200"${svgAttrs}>
    <defs>
      <marker id="arrow" markerWidth="8" markerHeight="8" refX="2" refY="4" orient="auto" markerUnits="userSpaceOnUse">${head}</marker>
    </defs>
  </svg>`;

test('a fill inherited from above the marker reaches the arrowhead', () => {
  const doc = build(ABOVE(' fill="#ff00ff"', '<path d="M0,0 L8,4 L0,8 z"/>'));
  assert.equal(doc.markers.get('arrow').fill, '#ff00ff');
});

test('a stroke inherited from above the marker reaches the arrowhead', () => {
  // The stroke arm has its own resolution, so inheriting a fill proves nothing about it.
  const doc = build(ABOVE(' stroke="#ff1493"', '<path d="M0,0 L8,4" fill="none"/>'));
  assert.equal(doc.markers.get('arrow').stroke, '#ff1493');
});

test('a fill on the marker element wins over an inherited one', () => {
  // Ordering, not merely reachability: the nearer declaration is the one the renderer obeys, so a marker
  // that names its own colour must not be reported in the colour of an ancestor it overrode.
  const doc = build(`<svg viewBox="0 0 200 100" width="200" fill="#ff00ff">
    <defs>
      <marker id="arrow" markerWidth="8" markerHeight="8" refX="2" refY="4" orient="auto" markerUnits="userSpaceOnUse" fill="#64748b"><path d="M0,0 L8,4 L0,8 z"/></marker>
    </defs>
  </svg>`);
  assert.equal(doc.markers.get('arrow').fill, '#64748b');
});

test('a fill on the defs element itself reaches the arrowhead', () => {
  // <defs> is an ordinary element for inheritance, so its own attributes belong in the chain. The branch that
  // walks into it is the only one that could drop them, and a `<g>` in the same position does not -- so the
  // level above resolving correctly proves nothing about this one.
  const doc = build(`<svg viewBox="0 0 200 100" width="200">
    <defs fill="#ff00ff">
      <marker id="arrow" markerWidth="8" markerHeight="8" refX="2" refY="4" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,0 L8,4 L0,8 z"/></marker>
    </defs>
  </svg>`);
  assert.equal(doc.markers.get('arrow').fill, '#ff00ff');
});

test('an arrowhead wrapped in a group carries its own fill', () => {
  // A grouped arrowhead is a compliant arrow, so reading only the marker's direct children reports it in the
  // initial value -- a false positive on a diagram that is right.
  const doc = build(MARKED('<g><path d="M0,0 L8,4 L0,8 z" fill="#64748b"/></g>'));
  assert.equal(doc.markers.get('arrow').fill, '#64748b');
});

test('an arrowhead fill wins over one on the group wrapping it', () => {
  // Descending has to keep the renderer's nearest-wins order, or the wrapper's colour is reported for a shape
  // that overrode it.
  const doc = build(MARKED('<g fill="#ff00ff"><path d="M0,0 L8,4 L0,8 z" fill="#64748b"/></g>'));
  assert.equal(doc.markers.get('arrow').fill, '#64748b');
});

test('a group inside a marker paints the arrowhead that declares nothing', () => {
  // The other direction: with no declaration on the shape, the wrapper's colour is what renders.
  const doc = build(MARKED('<g fill="#22c55e"><path d="M0,0 L8,4 L0,8 z"/></g>'));
  assert.equal(doc.markers.get('arrow').fill, '#22c55e');
});

test('a marker\'s own paint is the colour its first shape renders in', () => {
  // The same rule as the wrapper case below, one level further out. Seeding the descent with nothing makes
  // this structure report the *second* shape's colour, while the identical structure under a group reports
  // the first's -- the marker and a group have to behave alike, being both just ancestors of the shape.
  const doc = build(MARKED('<path d="M0,0 L8,4 L0,8 z"/><path d="M0,8 L8,4" fill="#3b82f6"/>', ' fill="#64748b"'));
  assert.equal(doc.markers.get('arrow').fill, '#64748b');
});

test('an empty marker still carries the paint written on it', () => {
  // The counterpart the seed needs: with no shape inside, there is nothing for the seed to reach, so the
  // marker's own declaration has to be read directly or a `<marker fill="…"/>` collects null.
  const doc = build(MARKED('', ' fill="#64748b"'));
  assert.equal(doc.markers.get('arrow').fill, '#64748b');
});

test('a paint above the marker is the first shape\'s colour too', () => {
  // The seed has to come from the chain, not from the <marker> element alone: with a paint on <defs> and two
  // shapes, seeding from the marker's own attributes only leaves the second shape's colour reported for an
  // arrow whose first shape renders magenta.
  const doc = build(`<svg viewBox="0 0 200 100" width="200"><defs fill="#ff00ff">
    <marker id="arrow" markerWidth="8" markerHeight="8" refX="2" refY="4" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,0 L8,4 L0,8 z"/><path d="M0,8 L8,4" fill="#3b82f6"/></marker>
  </defs></svg>`);
  assert.equal(doc.markers.get('arrow').fill, '#ff00ff');
});

test('a paint on <title> is not the arrow colour', () => {
  // <title> is accessibility text and is never drawn, and convention puts it first — so a paint on it would
  // win document order outright and be reported as the arrow's colour.
  const doc = build(MARKED('<title fill="#ff00ff">arrow</title><path d="M0,0 L8,4 L0,8 z" fill="#64748b"/>'));
  assert.equal(doc.markers.get('arrow').fill, '#64748b');
});

test('a paint on <desc> is not the arrow colour', () => {
  // The second tag in the never-drawn set: <desc> is a longer accessibility description, skipped for the same
  // reason as <title> and needing its own entry in the set. It precedes the arrowhead in the marker's children
  // here, so without the skip it is the first child declaring a fill and #ff00ff is what gets recorded.
  const doc = build(MARKED('<desc fill="#ff00ff">a solid arrowhead</desc><path d="M0,0 L8,4 L0,8 z" fill="#64748b"/>'));
  assert.equal(doc.markers.get('arrow').fill, '#64748b');
});

test('a paint on <metadata> is not the arrow colour', () => {
  // The third tag in the never-drawn set: <metadata> holds machine-readable data rather than accessibility
  // text, and it too needs its own entry. Same placement as the two above -- ahead of the arrowhead in the
  // children list, so dropping it from the set records #ff00ff for an arrow whose only shape declares #64748b.
  const doc = build(MARKED('<metadata fill="#ff00ff">note</metadata><path d="M0,0 L8,4 L0,8 z" fill="#64748b"/>'));
  assert.equal(doc.markers.get('arrow').fill, '#64748b');
});

test('a grouped arrowhead takes the colour it renders in, not a later sibling\'s', () => {
  // Two shapes under one wrapper, only the second declaring a fill. The recorded colour is the first shape's,
  // which is the wrapper's -- so the descent has to carry the wrapper's value down as it goes rather than
  // treating a shape that declares nothing as having no colour and moving on to the next one.
  const doc = build(MARKED('<g fill="#22c55e"><path d="M0,0 L8,4 L0,8 z"/><path d="M0,8 L8,4" fill="#3b82f6"/></g>'));
  assert.equal(doc.markers.get('arrow').fill, '#22c55e');
});

test('an arrowhead that declares no paint anywhere in the chain still carries null', () => {
  // The counterpart the three above need: null has to stay reachable, or "nothing was written" becomes
  // indistinguishable from a colour that was, and the reported #000000 stops meaning anything.
  const doc = build(ABOVE('', '<path d="M0,0 L8,4 L0,8 z"/>'));
  assert.equal(doc.markers.get('arrow').fill, null);
  assert.equal(doc.markers.get('arrow').stroke, null);
});

// A transform attribute may list several transforms, and `translate(20,0) translate(30,0)` is
// exactly `translate(50,0)`. Reading only the first left the model 30px out with no note, so
// margin measurements reported numbers that are not in the diagram and the repair hints asked for
// a correction that would have made it worse.
test('every translate in one transform attribute is accumulated', () => {
  const doc = build('<svg viewBox="0 0 200 80" width="200"><g transform="translate(20,0) translate(30,7)"><rect x="10" y="20" width="40" height="30" fill="#dbeafe" stroke="#3b82f6"/></g></svg>');
  const r = doc.rects[0];
  assert.equal(r.x, 60);                // 10 + 20 + 30
  assert.equal(r.y, 27);                // 20 + 0 + 7
  assert.deepEqual(r.bbox, { minX: 60, minY: 27, maxX: 100, maxY: 57 });
});

test('three translates in one attribute accumulate too, and a y-only one counts', () => {
  // Different numbers on each side so an implementation that reads one of them and doubles it
  // cannot pass, and one translate carrying only an x so the omitted y still defaults to 0.
  const doc = build('<svg viewBox="0 0 200 120" width="200"><g transform="translate(5,1) translate(11) translate(2,4)"><text x="30" y="60" font-size="12" fill="#1e293b">A</text></g></svg>');
  const t = doc.texts[0];
  assert.equal(t.x, 48);                // 30 + 5 + 11 + 2
  assert.equal(t.y, 65);                // 60 + 1 + 0 + 4
});
