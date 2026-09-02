// tools/svg-lint/test/checks/block-spacing.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blockSpacing } from '../../lib/checks/block-spacing.mjs';
import { lintSource } from '../../lib/lint.mjs';
import { runCheck, fixture, codes } from '../helpers/load.mjs';

const WRAP = (body, vb, w) => `<svg viewBox="${vb}" width="${w}">
  <style>text { font-family: 'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif; }</style>
  ${body}
</svg>`;

// left box fixed x=22 w=80 (right edge 102), the x of the right box determines the gap.
const pair = (x2) => WRAP(`<rect x="22" y="40" width="80" height="36" fill="#dbeafe" stroke="#3b82f6"/>
  <rect x="${x2}" y="40" width="80" height="36" fill="#d1fae5" stroke="#22c55e"/>`, '0 0 400 116', '400');

// body content 22..222 → centre 122. the title's x determines the off-centre amount.
const titled = (x) => WRAP(`<text x="${x}" y="32" font-size="16" fill="#1e293b" text-anchor="middle">T</text>
  <rect x="22" y="62" width="200" height="36" fill="#dbeafe" stroke="#3b82f6"/>`, '0 0 244 120', '244');

test('the clean fixture uses 28px spacing and passes', () => {
  assert.deepEqual(runCheck(blockSpacing, fixture('pass/minimal.svg')), []);
});

test('12px spacing is an error naming the 25px floor', () => {
  const findings = runCheck(blockSpacing, fixture('fail/tight-spacing.svg'));
  // deepEqual rather than find: this diagram should have exactly one finding; find would hide any extras.
  assert.deepEqual(codes(findings), ['spacing-too-small']);
  assert.equal(findings[0].severity, 'error');
  assert.equal(findings[0].repair.actual, '12');
  assert.equal(findings[0].repair.expected, '25–30');
  // hint must explain where 25 comes from; otherwise the reader only knows "below 25 is wrong" without knowing why.
  assert.equal(
    findings[0].repair.hint,
    'below 25px the arrowhead degenerates into a dot (needs 5 + 11 + ≥6px of visible line)',
  );
  assert.equal(findings[0].line, 5);
  assert.equal(findings[0].column, 3);
});

test('spacing above 30px is a warning', () => {
  const findings = runCheck(blockSpacing, pair(150));
  assert.deepEqual(codes(findings), ['spacing-too-loose']);
  assert.equal(findings[0].severity, 'warning');
  assert.equal(findings[0].repair.actual, '48');
});

test('vertical spacing is measured too', () => {
  // vertical gap between the two boxes is 14, below the floor — what this test pins is that the
  // vertical axis is genuinely measured.
  // asserting "no finding" cannot pin this: there is also no finding when the vertical axis is not measured at all.
  const findings = runCheck(blockSpacing, WRAP(`<rect x="22" y="40" width="120" height="36" fill="#dbeafe" stroke="#3b82f6"/>
  <rect x="22" y="90" width="120" height="36" fill="#d1fae5" stroke="#22c55e"/>`, '0 0 164 148', '164'));
  assert.deepEqual(codes(findings), ['spacing-too-small']);
  assert.equal(findings[0].repair.actual, '14');
});

test('three boxes in a row only compare nearest neighbours', () => {
  // A|B gap 28, B|C gap 28; A|C is 116 apart — treating them as neighbours would produce spacing-too-loose.
  // deepEqual([]) rather than "no too-loose": the whole diagram is compliant, asserting zero findings is stronger.
  assert.deepEqual(runCheck(blockSpacing, WRAP(`<rect x="22" y="40" width="60" height="36" fill="#dbeafe" stroke="#3b82f6"/>
  <rect x="110" y="40" width="60" height="36" fill="#fef3c7" stroke="#f59e0b"/>
  <rect x="198" y="40" width="60" height="36" fill="#d1fae5" stroke="#22c55e"/>`, '0 0 280 116', '280')), []);
});

test('boxes in one row differing in width by more than 60px is a warning', () => {
  const findings = runCheck(blockSpacing, WRAP(`<rect x="22" y="40" width="40" height="36" fill="#dbeafe" stroke="#3b82f6"/>
  <rect x="90" y="40" width="150" height="36" fill="#d1fae5" stroke="#22c55e"/>`, '0 0 262 116', '262'));
  assert.deepEqual(codes(findings), ['row-box-size-mismatch']);
  assert.equal(findings[0].severity, 'warning');
  assert.equal(findings[0].repair.actual, '110');
  assert.equal(findings[0].repair.expected, '≤60');
});

test('boxes in one row differing in height also trip the size rule', () => {
  // SKILL.md:97 says "differ in size by ≤60px" — size is not width alone.
  // comparing only width lets a 36-high and a 97-high box in the same row pass, which is clearly misaligned.
  // both sides of the boundary are pinned: a difference of 60 passes, 61 reports.
  assert.deepEqual(runCheck(blockSpacing, WRAP(`<rect x="22" y="40" width="80" height="36" fill="#dbeafe" stroke="#3b82f6"/>
  <rect x="130" y="40" width="80" height="96" fill="#d1fae5" stroke="#22c55e"/>`, '0 0 232 180', '232')), []);
  const findings = runCheck(blockSpacing, WRAP(`<rect x="22" y="40" width="80" height="36" fill="#dbeafe" stroke="#3b82f6"/>
  <rect x="130" y="40" width="80" height="97" fill="#d1fae5" stroke="#22c55e"/>`, '0 0 232 180', '232'));
  assert.deepEqual(codes(findings), ['row-box-size-mismatch']);
  assert.equal(findings[0].repair.actual, '61');
});

test('a title that is not centred on the body content is a warning', () => {
  const findings = runCheck(blockSpacing, titled(60));
  assert.deepEqual(codes(findings), ['title-not-centered']);
  assert.equal(findings[0].severity, 'warning');
  assert.equal(findings[0].repair.actual, '60');
  assert.equal(findings[0].repair.expected, '122');
  // unlike the spacing findings, what needs changing here is the title's own x, so attribute must be
  // present — without it an auto-fix script cannot tell which attribute to change
  // (`format-text.mjs:5` branches on whether attribute is present).
  assert.equal(findings[0].repair.attribute, 'x');
});

test('the title tolerance is 2 units', () => {
  // an offset of 2 passes, 2.5 reports. without this test, writing the tolerance as 0 or 20 would still pass.
  assert.deepEqual(runCheck(blockSpacing, titled(122)), []);
  assert.deepEqual(runCheck(blockSpacing, titled(124)), []);
  const findings = runCheck(blockSpacing, titled(124.5));
  assert.deepEqual(codes(findings), ['title-not-centered']);
  assert.equal(findings[0].repair.actual, '124.5');
});

test('a diagram with no title at all reports nothing about titles', () => {
  // this is the branch where doc.title is null. gap 28, same width, so the whole diagram should have zero findings.
  assert.deepEqual(runCheck(blockSpacing, pair(130)), []);
});

test('the 25px floor and the 30px ceiling are both inclusive', () => {
  // each of the four points pins one side: 25 and 30 pass, 24 reports error, 31 reports warning.
  // without this test, changing < to <=, or 25 to 26, would still pass.
  assert.deepEqual(runCheck(blockSpacing, pair(127)), []);
  assert.deepEqual(runCheck(blockSpacing, pair(132)), []);
  const tooSmall = runCheck(blockSpacing, pair(126));
  assert.deepEqual(codes(tooSmall), ['spacing-too-small']);
  assert.equal(tooSmall[0].repair.actual, '24');
  const tooLoose = runCheck(blockSpacing, pair(133));
  assert.deepEqual(codes(tooLoose), ['spacing-too-loose']);
  assert.equal(tooLoose[0].repair.actual, '31');
});

test('a 2x2 grid spaced 28px both ways is clean', () => {
  // the most common shape in real diagrams. it exercises both the horizontal and vertical paths
  // simultaneously; without this test, a box pair being reported once per axis would go unnoticed.
  assert.deepEqual(runCheck(blockSpacing, WRAP(`<rect x="22" y="40" width="80" height="36" fill="#dbeafe" stroke="#3b82f6"/>
  <rect x="130" y="40" width="80" height="36" fill="#dbeafe" stroke="#3b82f6"/>
  <rect x="22" y="104" width="80" height="36" fill="#d1fae5" stroke="#22c55e"/>
  <rect x="130" y="104" width="80" height="36" fill="#d1fae5" stroke="#22c55e"/>`, '0 0 232 180', '232')), []);
});

test('a column that skips a row is not reported as loosely spaced', () => {
  // three rows, only the right column has a box in the middle row. the vertical gap between the
  // left column's top and bottom boxes is 92px, but the band occupied by the middle-row box
  // separates them — they are not neighbours. gapOf requires horizontal overlap for the vertical
  // direction, so the middle-row box never enters the candidate set; nearestAfter alone cannot
  // block this case: without separatedByRow, every staggered-layout diagram gets a false positive
  // spacing-too-loose.
  assert.deepEqual(runCheck(blockSpacing, WRAP(`<rect x="22" y="40" width="80" height="36" fill="#dbeafe" stroke="#3b82f6"/>
  <rect x="130" y="40" width="80" height="36" fill="#dbeafe" stroke="#3b82f6"/>
  <rect x="130" y="104" width="80" height="36" fill="#fef3c7" stroke="#f59e0b"/>
  <rect x="22" y="168" width="80" height="36" fill="#d1fae5" stroke="#22c55e"/>
  <rect x="130" y="168" width="80" height="36" fill="#d1fae5" stroke="#22c55e"/>`, '0 0 232 244', '232')), []);
});

test('a left-aligned group label on a dashed box is not judged as a title', () => {
  // regression guard: if a group label is still treated as a title, this emits title-not-centered.
  // group spacing 30, outer-box-to-inner-right-box spacing 30, so the whole diagram should have zero findings.
  assert.deepEqual(runCheck(blockSpacing, WRAP(`<rect x="16" y="34" width="200" height="90" stroke-dasharray="6,4" fill="#f8fafc" stroke="#94a3b8"/>
  <text x="26" y="50" font-size="11" fill="#64748b">Server</text>
  <rect x="26" y="58" width="80" height="36" fill="#dbeafe" stroke="#3b82f6"/>
  <rect x="134" y="58" width="80" height="36" fill="#dbeafe" stroke="#3b82f6"/>
  <rect x="244" y="58" width="80" height="36" fill="#d1fae5" stroke="#22c55e"/>`, '0 0 346 158', '346')), []);
});

test('a single box produces no spacing findings', () => {
  assert.deepEqual(
    runCheck(blockSpacing, WRAP('<rect x="22" y="40" width="120" height="36" fill="#dbeafe" stroke="#3b82f6"/>', '0 0 164 98', '164')),
    [],
  );
});

test('a title inside the full-canvas background rect is still judged', () => {
  // the background rect covers the full canvas and geometrically encloses the title. if the title
  // candidate condition is written as "not inside any box" rather than "not inside a dashed grouping
  // box", the title check silently fails for every diagram that has a background rect — which is
  // every diagram in this repository — reporting nothing and appearing to pass.
  const bg = (x) => `<svg viewBox="0 0 244 120" width="244">
  <style>text { font-family: 'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif; }</style>
  <rect x="0" y="0" width="244" height="120" fill="#ffffff"/>
  <text x="${x}" y="32" font-size="16" fill="#1e293b" text-anchor="middle">Off centre</text>
  <rect x="22" y="62" width="200" height="36" fill="#dbeafe" stroke="#3b82f6"/>
</svg>`;
  const findings = runCheck(blockSpacing, bg(60));
  assert.deepEqual(codes(findings), ['title-not-centered']);
  assert.equal(findings[0].repair.expected, '122');
  assert.deepEqual(runCheck(blockSpacing, bg(122)), []);
});

test('the suggested x for a start-anchored title is the x to write, not the centre', () => {
  // with text-anchor="start", x is the left edge of the text, not its centre. if expected simply
  // reports the content centre, the finding would show actual 122 / expected 122 — a
  // self-contradictory receipt that leaves the author still off-centre after following it.
  const start = (x) => WRAP(`<text x="${x}" y="32" font-size="16" fill="#1e293b" text-anchor="start">Wide title here</text>
  <rect x="22" y="62" width="200" height="36" fill="#dbeafe" stroke="#3b82f6"/>`, '0 0 244 120', '244');
  const findings = runCheck(blockSpacing, start(122));
  assert.deepEqual(codes(findings), ['title-not-centered']);
  assert.equal(findings[0].repair.actual, '122');
  assert.equal(findings[0].repair.expected, '52.4');
  // applying expected must actually make the diagram clean — otherwise the suggestion is wrong.
  assert.deepEqual(runCheck(blockSpacing, start(52.4)), []);
});

test('a connector reaching outside the boxes counts toward the content centre', () => {
  // the two boxes only span 22..210 (centre 116), but a back-flow connector path reaches x=6;
  // including it shifts the centre to 108.
  // if the content bbox omits paths, a diagram whose title is correctly placed at the visual centre (108)
  // is falsely reported as off-centre.
  const withPath = (x) => WRAP(`<rect x="22" y="40" width="80" height="36" fill="#dbeafe" stroke="#3b82f6"/>
  <rect x="130" y="40" width="80" height="36" fill="#d1fae5" stroke="#22c55e"/>
  <path d="M130,90 L6,90 L6,58 L22,58" fill="none" stroke="#94a3b8" stroke-width="1.5"/>
  <text x="${x}" y="24" font-size="16" fill="#1e293b" text-anchor="middle">T</text>`, '0 0 232 116', '232');
  assert.deepEqual(runCheck(blockSpacing, withPath(108)), []);
  const findings = runCheck(blockSpacing, withPath(116));
  assert.deepEqual(codes(findings), ['title-not-centered']);
  assert.equal(findings[0].repair.expected, '108');
});

test('boxes overlapping vertically by only a fifth are not one row', () => {
  // A is 36 high (y 40..76), B is 72 high (y 68..140): overlap 8px, 22% of the shorter box.
  // relaxing the overlap threshold to 0.1 would treat them as one row and produce row-box-size-mismatch
  // from the 110px size difference — but they are clearly not in the same row. this test asserts exactly one finding, the spacing one.
  assert.deepEqual(codes(runCheck(blockSpacing, WRAP(`<rect x="22" y="40" width="40" height="36" fill="#dbeafe" stroke="#3b82f6"/>
  <rect x="130" y="68" width="150" height="72" fill="#d1fae5" stroke="#22c55e"/>`, '0 0 300 180', '300'))), ['spacing-too-loose']);
});

test('a third box merely poking into the gap does not count as separating', () => {
  // "separating" requires the third box to fall **entirely** within the band between the two boxes.
  // if only the start point needs to lie inside the band, a tall box that begins inside the band but
  // extends past the target box also counts as separating, suppressing a genuinely over-wide gap — false negative.
  // here C runs from y=100 to 250, past B (168..204), so the 92px gap between A|B must still be reported.
  const findings = runCheck(blockSpacing, WRAP(`<rect x="22" y="40" width="80" height="36" fill="#dbeafe" stroke="#3b82f6"/>
  <rect x="22" y="168" width="80" height="36" fill="#d1fae5" stroke="#22c55e"/>
  <rect x="130" y="100" width="80" height="150" fill="#fef3c7" stroke="#f59e0b"/>`, '0 0 232 280', '232'));
  assert.deepEqual(codes(findings), ['spacing-too-loose', 'row-box-size-mismatch']);
  assert.equal(findings[0].repair.actual, '92');
});

test('the check is wired into the registry, so lintSource reports it', () => {
  // without wiring, all other tests in this file pass but the CLI checks nothing. the fixture also trips
  // viewbox-clipping (top margin 62px), so filter by check name — without the filter this test would need
  // updating each time a new check is added.
  const { findings } = lintSource('tight-spacing.svg', fixture('fail/tight-spacing.svg'));
  assert.deepEqual(
    findings.filter((f) => f.check === 'block-spacing').map((f) => f.code),
    ['spacing-too-small'],
  );
});

// both ends of "separating" must be checked. the previous test pins the near end (the third box's start
// must lie inside the band); this test pins the far end:
// a box that lies entirely **above** A (not between A and B at all) must not count as separating, or the
// 92px gap between A|B is silently missed.
test('a box above the pair does not count as separating it', () => {
  const findings = runCheck(blockSpacing, WRAP(`<rect x="22" y="20" width="80" height="36" fill="#d1fae5" stroke="#22c55e"/>
  <rect x="22" y="100" width="80" height="36" fill="#dbeafe" stroke="#3b82f6"/>
  <rect x="22" y="228" width="80" height="36" fill="#dbeafe" stroke="#3b82f6"/>`, '0 0 124 284', '124'));
  // the gap between the top box and the middle box is 44px (also over-wide), plus the 92px middle-to-bottom, two findings total.
  assert.deepEqual(codes(findings), ['spacing-too-loose', 'spacing-too-loose']);
  assert.deepEqual(findings.map((f) => f.repair.actual), ['44', '92']);
});

// both sides of the same-row overlap threshold must be pinned. the previous test pins the loose side
// (20% overlap is not one row); this test pins the tight side:
// two boxes in one row offset by 12px vertically (36 high → overlap 24/36 ≈ 0.67), raising the
// threshold to 0.95 would treat them as two rows and silently let through a size difference of 120px —
// but "same row, not aligned" is exactly the kind of diagram that should be reported.
test('boxes offset by a third of their height are still one row', () => {
  const findings = runCheck(blockSpacing, WRAP(`<rect x="22" y="100" width="80" height="36" fill="#dbeafe" stroke="#3b82f6"/>
  <rect x="130" y="112" width="200" height="36" fill="#d1fae5" stroke="#22c55e"/>`, '0 0 352 188', '352'));
  assert.deepEqual(codes(findings), ['row-box-size-mismatch']);
  assert.equal(findings[0].repair.actual, '120');
});

// the two tests above bracket the threshold loosely — a fifth of a height on one side, two thirds on
// the other — which leaves it free to move anywhere in between. the three cases below close it to half
// a height exactly and fix the comparison as exclusive. both boxes are 40 high and 28px apart
// horizontally, so the only thing that varies is how far the right-hand one is dropped, and the 80px
// width difference is there to give the size rule something to say once the two count as one row.
const dropped = (offset) => WRAP(`<rect x="22" y="40" width="60" height="40" rx="6" fill="#dbeafe" stroke="#3b82f6"/>
  <rect x="110" y="${40 + offset}" width="140" height="40" rx="6" fill="#d1fae5" stroke="#22c55e"/>`, '0 0 280 160', '280');

test('boxes overlapping by a little over half their height are one row', () => {
  // dropped 18 of 40: 22px of overlap, a ratio of 0.55.
  const findings = runCheck(blockSpacing, dropped(18));
  assert.deepEqual(codes(findings), ['row-box-size-mismatch']);
  assert.equal(findings[0].repair.actual, '80');
});

test('boxes overlapping by exactly half their height are not one row', () => {
  // dropped 20 of 40: 20px of overlap, a ratio of exactly 0.5. half of one box hanging below the
  // other is not a row, so the size difference between them is not the author's problem.
  assert.deepEqual(runCheck(blockSpacing, dropped(20)), []);
});

test('boxes overlapping by a little under half their height are not one row', () => {
  // dropped 22 of 40: 18px of overlap, a ratio of 0.45 — the counterpart of the 0.55 case, the same
  // two pixels of offset on the other side of the threshold.
  assert.deepEqual(runCheck(blockSpacing, dropped(22)), []);
});

// float noise from subtracting fractional sizes must not enter the message: 160.4 − 100.1 in JS is
// 60.30000000000001, and this value is meant to be copied directly into the SVG. repair and message
// must both use the same normalised number.
test('a fractional size spread is reported to one decimal', () => {
  const findings = runCheck(blockSpacing, WRAP(`<rect x="22" y="100" width="100.1" height="36" fill="#dbeafe" stroke="#3b82f6"/>
  <rect x="150" y="100" width="160.4" height="36" fill="#d1fae5" stroke="#22c55e"/>`, '0 0 332 176', '332'));
  assert.deepEqual(codes(findings), ['row-box-size-mismatch']);
  assert.equal(findings[0].repair.actual, '60.3');
  assert.match(findings[0].message, /differ in size by 60\.3px$/);
});

// the spacing findings' message likewise promises one decimal place: 134.4 − 122.1 = 12.299999999999997.
test('a fractional gap is reported to one decimal', () => {
  const findings = runCheck(blockSpacing, WRAP(`<rect x="22" y="100" width="100.1" height="36" fill="#dbeafe" stroke="#3b82f6"/>
  <rect x="134.4" y="100" width="100" height="36" fill="#d1fae5" stroke="#22c55e"/>`, '0 0 256 176', '256'));
  assert.deepEqual(codes(findings), ['spacing-too-small']);
  assert.equal(findings[0].repair.actual, '12.3');
  assert.match(findings[0].message, /gap to the next block is 12\.3px,/);
});

// ---- the content bounding box must include everything drawn ----
// SKILL.md's centring formula (line 44) measures content width from the "rightmost element" and the
// "leftmost element" — not from the rightmost `rect` — so anything drawn outside the boxes counts
// toward the content centre. document.mjs puts the `SHAPE_TAGS` tags
// (<line>/<circle>/<ellipse>/<polygon>/<polyline>) into doc.others; omitting them causes the same
// diagram to produce a false positive.
test('a <line> reaching outside the boxes counts toward the content centre', () => {
  // content 6..210 → centre 108, title placed at 108: nothing should be reported.
  const src = WRAP(`<text x="108" y="30" font-size="16" text-anchor="middle" fill="#0f172a">T</text>
  <line x1="6" y1="90" x2="130" y2="90" stroke="#94a3b8" stroke-width="1.5"/>
  <rect x="86" y="72" width="124" height="36" fill="#dbeafe" stroke="#3b82f6"/>`, '0 0 216 130', '216');
  assert.deepEqual(runCheck(blockSpacing, src), []);
});

// a dashed grouping box is drawn content (the doc.contentBBox that `viewbox-clipping` uses also
// counts it as content).
// excluding it causes a correctly-placed title to be reported as off-centre, with the suggested x
// landing to the left of the dashed box — following the suggestion makes it more crooked.
test('a dashed grouping box counts toward the content centre', () => {
  // dashed box 16..330 → centre 173, title placed at 173. the two inner boxes only reach 200; omitting the dashed box produces 120.
  const src = WRAP(`<text x="173" y="30" font-size="16" text-anchor="middle" fill="#0f172a">T</text>
  <rect x="16" y="50" width="314" height="90" fill="none" stroke="#94a3b8" stroke-dasharray="4 4"/>
  <rect x="40" y="80" width="70" height="36" fill="#dbeafe" stroke="#3b82f6"/>
  <rect x="140" y="80" width="70" height="36" fill="#dbeafe" stroke="#3b82f6"/>`, '0 0 346 162', '346');
  assert.deepEqual(codes(runCheck(blockSpacing, src)), []);
});

// ---- a box spanning two rows is not a member of either row ----
test('a box spanning two rows is not compared against either row', () => {
  const src = WRAP(`<rect x="22" y="40" width="80" height="36" fill="#dbeafe" stroke="#3b82f6"/>
  <rect x="22" y="104" width="80" height="36" fill="#dbeafe" stroke="#3b82f6"/>
  <rect x="130" y="40" width="100" height="100" fill="#d1fae5" stroke="#22c55e"/>`, '0 0 252 202', '252');
  // both the top and bottom boxes have a vertical overlap ratio of 1.0 with the tall box (denominator
  // is the shorter box); without excluding the tall box they are grouped into one row, producing
  // row-box-size-mismatch from the 64px size difference — but the tall box belongs to neither row.
  assert.deepEqual(codes(runCheck(blockSpacing, src)), []);
});

// ---- a solid card is not a peer of the boxes it holds ----
// The card fully overlaps the boxes it encloses in y, so the overlap ratio makes it a row-mate of
// theirs, and the "spans two rows" rescue only covers a box straddling two rows that do not
// overlap each other. A card is a container, not a member, and comparing its size against its own
// contents reports every card-wrapped row in the house style.
const CARD_ROW = (body = '') => WRAP(`<rect x="40" y="55" width="400" height="120" rx="10" fill="#ffffff" stroke="#94a3b8"/>
  <rect x="60" y="97" width="110" height="36" rx="6" fill="#dbeafe" stroke="#3b82f6"/>
  <text x="115" y="119" font-size="12" fill="#1e40af" text-anchor="middle">Left</text>
  <rect x="196" y="97" width="110" height="36" rx="6" fill="#d1fae5" stroke="#22c55e"/>
  <text x="251" y="119" font-size="12" fill="#166534" text-anchor="middle">Right</text>${body}`, '0 0 480 200', '480');

test('a card is not compared for size against the boxes it encloses', () => {
  // Without the exemption the 400×120 card and the 110×36 boxes read as one row and the 290px
  // size difference is reported.
  assert.deepEqual(codes(runCheck(blockSpacing, CARD_ROW())), []);
});

test('boxes inside a card are still compared against each other', () => {
  // The control: only the card leaves the row, so a genuine size mismatch between its members
  // is still reported. The second box is widened from 110 to 250, a 140px difference, and the card
  // is widened to match so that the widened box stays inside it — otherwise the box would leave the
  // card as well, and the test would be changing two things at once.
  const src = CARD_ROW()
    .replace('x="40" y="55" width="400"', 'x="40" y="55" width="540"')
    .replace('x="196" y="97" width="110"', 'x="196" y="97" width="250"')
    .replace('viewBox="0 0 480 200" width="480"', 'viewBox="0 0 620 200" width="620"');
  const findings = runCheck(blockSpacing, src);
  assert.deepEqual(codes(findings), ['row-box-size-mismatch']);
  assert.equal(findings[0].repair.actual, '140');
});

// ---- a gap is measured between siblings, not across two cards ----
// The nearest thing to the right of a box inside one card is the *other* card's wall, which is not
// a block this box is spaced from — the two cards are what the spacing rule is about there.
// Two cards 26px apart with one box each; the box-to-far-wall distance is 81px.
const TWO_CARDS = (card2X, box2X) => WRAP(`<rect x="20" y="25" width="220" height="106" rx="10" fill="#ffffff" stroke="#94a3b8"/>
  <rect x="75" y="67" width="110" height="36" rx="6" fill="#dbeafe" stroke="#3b82f6"/>
  <text x="130" y="89" font-size="12" fill="#1e40af" text-anchor="middle">A</text>
  <rect x="${card2X}" y="25" width="220" height="106" rx="10" fill="#ffffff" stroke="#94a3b8"/>
  <rect x="${box2X}" y="67" width="110" height="36" rx="6" fill="#d1fae5" stroke="#22c55e"/>
  <text x="${box2X + 55}" y="89" font-size="12" fill="#166534" text-anchor="middle">B</text>`, '0 0 506 156', '506');

test('a box inside one card is not spaced against another card', () => {
  assert.deepEqual(codes(runCheck(blockSpacing, TWO_CARDS(266, 321))), []);
});

test('two cards are still spaced against each other', () => {
  // The control for the exemption above: the cards themselves are peers, so pushing them 40px
  // apart is still reported — measured between the two walls, not from a box to a wall.
  const findings = runCheck(blockSpacing, TWO_CARDS(280, 335));
  assert.deepEqual(codes(findings), ['spacing-too-loose']);
  assert.equal(findings[0].repair.actual, '40');
});

test('a box outside every card is still spaced against the card wall', () => {
  // The second control: a card and a box drawn side by side at the same level are peers, and the
  // wall really is the edge the box is spaced from. Its 50px gap must survive.
  const src = WRAP(`<rect x="20" y="25" width="220" height="106" rx="10" fill="#ffffff" stroke="#94a3b8"/>
  <rect x="75" y="67" width="110" height="36" rx="6" fill="#dbeafe" stroke="#3b82f6"/>
  <text x="130" y="89" font-size="12" fill="#1e40af" text-anchor="middle">A</text>
  <rect x="290" y="67" width="110" height="36" rx="6" fill="#d1fae5" stroke="#22c55e"/>
  <text x="345" y="89" font-size="12" fill="#166534" text-anchor="middle">C</text>`, '0 0 420 156', '420');
  const findings = runCheck(blockSpacing, src);
  assert.deepEqual(codes(findings), ['spacing-too-loose']);
  assert.equal(findings[0].repair.actual, '50');
});

// ---- a dashed grouping box ends an adjacency too ----
// Two labelled groups drawn 40px apart, each holding one box at the house-style 15px inner
// padding. The boxes are then 70px apart, and that number is not something the author can fix:
// bringing it into 25–30px means squeezing two paddings and the channel between the groups into
// 30px, leaving the groups touching.
const TWO_GROUPS = (groupBX) => WRAP(`<rect x="40" y="60" width="170" height="96" rx="10" fill="#f8fafc" stroke="#94a3b8" stroke-dasharray="6,4"/>
  <text x="55" y="80" font-size="11" fill="#64748b">Group A</text>
  <rect x="${groupBX}" y="60" width="170" height="96" rx="10" fill="#f8fafc" stroke="#94a3b8" stroke-dasharray="6,4"/>
  <text x="${groupBX + 15}" y="80" font-size="11" fill="#64748b">Group B</text>
  <rect x="55" y="95" width="140" height="36" rx="6" fill="#dbeafe" stroke="#3b82f6"/>
  <text x="125" y="117" font-size="12" fill="#1e40af" text-anchor="middle">in A</text>
  <rect x="${groupBX + 15}" y="95" width="140" height="36" rx="6" fill="#dbeafe" stroke="#3b82f6"/>
  <text x="${groupBX + 85}" y="117" font-size="12" fill="#1e40af" text-anchor="middle">in B</text>`, '0 0 460 200', '460');

test('a box in one group is not spaced against a box in another group', () => {
  assert.deepEqual(codes(runCheck(blockSpacing, TWO_GROUPS(250))), []);
});

test('two boxes in the same group are still spaced against each other', () => {
  // The control: the boundary is what ends the adjacency, not the grouping box itself. Both boxes
  // here sit in group A, 45px apart, and that gap is the author's to fix.
  const src = TWO_GROUPS(250)
    .replace('x="55" y="95" width="140"', 'x="55" y="95" width="50"')
    .replace('x="265" y="95" width="140"', 'x="150" y="95" width="45"');
  const findings = runCheck(blockSpacing, src);
  assert.deepEqual(codes(findings), ['spacing-too-loose']);
  assert.equal(findings[0].repair.actual, '45');
});

test('two boxes crowded against each other across a group wall are still reported', () => {
  // Crossing a wall only ever adds distance to a measurement, so a cross-wall gap that is *below*
  // the minimum means the blocks really are crowded — the groups holding them must be touching or
  // overlapping for it to happen. Only the over-wide direction is the one a wall inflates into an
  // unfixable number, so only that direction stops at the wall. Here the two groups are 8px apart
  // and their members 15px, well under the 25px floor.
  const src = WRAP(`<rect x="40" y="60" width="170" height="96" rx="10" fill="#f8fafc" stroke="#94a3b8" stroke-dasharray="6,4"/>
  <text x="55" y="80" font-size="11" fill="#64748b">Group A</text>
  <rect x="218" y="60" width="170" height="96" rx="10" fill="#f8fafc" stroke="#94a3b8" stroke-dasharray="6,4"/>
  <text x="233" y="80" font-size="11" fill="#64748b">Group B</text>
  <rect x="55" y="95" width="140" height="36" rx="6" fill="#dbeafe" stroke="#3b82f6"/>
  <text x="125" y="117" font-size="12" fill="#1e40af" text-anchor="middle">in A</text>
  <rect x="210" y="95" width="140" height="36" rx="6" fill="#dbeafe" stroke="#3b82f6"/>
  <text x="280" y="117" font-size="12" fill="#1e40af" text-anchor="middle">in B</text>`, '0 0 428 200', '428');
  const findings = runCheck(blockSpacing, src);
  assert.deepEqual(codes(findings), ['spacing-too-small']);
  assert.equal(findings[0].repair.actual, '15');
  assert.equal(findings[0].severity, 'error');
});

// ---- gap is normalised before the threshold check ----
test('a gap of 24.96 is not reported as being below 25', () => {
  // checking with the raw value and only normalising for output would report "is 25px, below the
  // 25px minimum" — the reported number already satisfies the reported expected value.
  assert.deepEqual(runCheck(blockSpacing, WRAP(`<rect x="22" y="40" width="80" height="36" fill="#dbeafe" stroke="#3b82f6"/>
  <rect x="126.96" y="40" width="80" height="36" fill="#d1fae5" stroke="#22c55e"/>`, '0 0 229 116', '229')), []);
  // guard against over-correction: a genuinely under-25px gap must still be reported with the normalised value.
  const findings = runCheck(blockSpacing, WRAP(`<rect x="22" y="40" width="80" height="36" fill="#dbeafe" stroke="#3b82f6"/>
  <rect x="126.94" y="40" width="80" height="36" fill="#d1fae5" stroke="#22c55e"/>`, '0 0 229 116', '229'));
  assert.deepEqual(codes(findings), ['spacing-too-small']);
  assert.equal(findings[0].repair.actual, '24.9');
});

// ---- the nearest box is the neighbour, not the first one that qualifies ----
test('the nearest box wins even when a farther one comes first in the source', () => {
  // C is declared first; the horizontal gap between A|C is 138px; the actual neighbour is A|B with 28px.
  // B overlaps C in x, so the band exemption does not protect A|C — picking the first qualifying box
  // produces an extra false positive spacing-too-loose.
  const src = WRAP(`<rect x="240" y="40" width="80" height="20" fill="#dbeafe" stroke="#3b82f6"/>
  <rect x="130" y="88" width="130" height="20" fill="#dbeafe" stroke="#3b82f6"/>
  <rect x="22" y="40" width="80" height="68" fill="#d1fae5" stroke="#22c55e"/>`, '0 0 342 170', '342');
  assert.deepEqual(codes(runCheck(blockSpacing, src)), []);
});

// the "spans two rows" criterion requires the two boxes it covers to have no overlap with each other.
// relaxing it to "covers two boxes" lets every box in a row of three count as spanning, excluding
// the entire row and silently letting through size differences.
test('a row of three boxes still trips the size rule', () => {
  const findings = runCheck(blockSpacing, WRAP(`<rect x="22" y="40" width="40" height="36" fill="#dbeafe" stroke="#3b82f6"/>
  <rect x="90" y="40" width="40" height="36" fill="#fef3c7" stroke="#f59e0b"/>
  <rect x="158" y="40" width="150" height="36" fill="#d1fae5" stroke="#22c55e"/>`, '0 0 330 116', '330'));
  assert.deepEqual(codes(findings), ['row-box-size-mismatch']);
  assert.equal(findings[0].repair.actual, '110');
});

// the band exemption applies only to the vertical direction. in a fan-out layout (parent box in
// the row below, its x range landing exactly between its two children above), the two children
// are neighbours in the same row and their 98px over-wide gap must be reported —
// applying the exemption to both axes silently misses this entire class of diagram (measured
// trade-off decided 2026-08-30: accept false positives on "same row with an intentional horizontal
// gap", a layout that does not appear in SKILL.md).
test('a fan-out parent below does not excuse the gap between its children', () => {
  const findings = runCheck(blockSpacing, WRAP(`<rect x="22" y="40" width="80" height="36" fill="#dbeafe" stroke="#3b82f6"/>
  <rect x="200" y="40" width="80" height="36" fill="#dbeafe" stroke="#3b82f6"/>
  <rect x="120" y="140" width="60" height="36" fill="#d1fae5" stroke="#22c55e"/>`, '0 0 302 202', '302'));
  assert.deepEqual(codes(findings), ['spacing-too-loose']);
  assert.equal(findings[0].repair.actual, '98');
});

// the geometric mirror of the previous test: rotate the whole diagram 90°, the centred parent box
// lands inside the **vertical** gap between its two children, so the band exemption fires and the
// 98px over-wide gap is not reported. this is a known trade-off of keeping the vertical exemption,
// not an oversight — the current behaviour is pinned here so that anyone reconsidering the trade-off
// for left-right fan-outs will see this test first.
test('a left-right fan-out is a known blind spot for the vertical gap', () => {
  const children = `<rect x="200" y="20" width="80" height="36" fill="#dbeafe" stroke="#3b82f6"/>
  <rect x="200" y="154" width="80" height="36" fill="#dbeafe" stroke="#3b82f6"/>`;
  // the parent box on the left is hidden in the vertical gap between the two children → zero findings.
  assert.deepEqual(runCheck(blockSpacing, WRAP(`${children}
  <rect x="22" y="70" width="80" height="70" fill="#d1fae5" stroke="#22c55e"/>`, '0 0 302 210', '302')), []);
  // removing the parent box causes the same gap to be reported — proving the zero is caused by the exemption, not a measurement error.
  const findings = runCheck(blockSpacing, WRAP(children, '0 0 302 210', '302'));
  assert.deepEqual(codes(findings), ['spacing-too-loose']);
  assert.equal(findings[0].repair.actual, '98');
});

// a full-canvas dashed outer frame (area ≥98% of the viewBox) is background, not a grouping box.
// including it in the content bounding box pulls the content centre toward the canvas centre: a
// diagram whose title is at the true content centre gets a finding, and expected points to the
// canvas centre — following it moves a correctly placed title off-centre.
test('a dashed full-canvas frame is background, not content', () => {
  const body = (x) => `<text x="${x}" y="30" font-size="16" text-anchor="middle" fill="#0f172a">T</text>
  <rect x="40" y="60" width="70" height="36" fill="#dbeafe" stroke="#3b82f6"/>
  <rect x="138" y="60" width="70" height="36" fill="#dbeafe" stroke="#3b82f6"/>`;
  // content 40..208 → centre 124, canvas centre is 170. the dashed outer frame is placed below the canvas so the
  // title stays outside it — text inside the frame takes the "group label is not a title" path;
  // what this test pins is the content bounding box.
  const framed = (x) => WRAP(`<rect x="0" y="40" width="340" height="188" fill="none" stroke="#94a3b8" stroke-dasharray="4 4"/>
  ${body(x)}`, '0 0 340 188', '340');
  assert.deepEqual(runCheck(blockSpacing, framed(124)), []);
  // guard against over-correction: a genuinely off-centre title must still be reported, and expected must be the content centre 124, not the canvas centre 170.
  const findings = runCheck(blockSpacing, framed(60));
  assert.deepEqual(codes(findings), ['title-not-centered']);
  assert.equal(findings[0].repair.expected, '124');
});
