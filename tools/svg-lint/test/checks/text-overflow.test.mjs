// tools/svg-lint/test/checks/text-overflow.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { textOverflow } from '../../lib/checks/text-overflow.mjs';
import { lintSource } from '../../lib/lint.mjs';
import { runCheck, fixture, hasCode } from '../helpers/load.mjs';

const WRAP = (body, vb = '0 0 272 160', w = '272') => `<svg viewBox="${vb}" width="${w}">
  <style>text { font-family: 'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif; }</style>
  ${body}
</svg>`;

test('the clean fixture keeps every label inside its box', () => {
  assert.deepEqual(runCheck(textOverflow, fixture('pass/minimal.svg')), []);
});

test('a label wider than its box is an error stating both widths', () => {
  const findings = runCheck(textOverflow, fixture('fail/text-overflow.svg'));
  const overflow = findings.find((f) => f.code === 'text-overflows-box');
  assert.equal(overflow.severity, 'error');
  assert.match(overflow.message, /182/);
  assert.match(overflow.message, /90/);
});

test('an entity counts as one character, not five', () => {
  // 'A &amp; B' decodes to 5 characters × 7 = 35px, which fits exactly inside a 60px box
  assert.deepEqual(runCheck(textOverflow, WRAP(`<rect x="22" y="40" width="60" height="36" fill="#dbeafe" stroke="#3b82f6"/>
  <text x="52" y="62" font-size="12" text-anchor="middle" fill="#1e40af">A &amp; B</text>`)), []);
});

test('CJK labels are measured at one character per font size', () => {
  // 6 CJK characters × 12px = 72px, which does not fit inside a 60px box
  assert.ok(hasCode(runCheck(textOverflow, WRAP(`<rect x="22" y="40" width="60" height="36" fill="#dbeafe" stroke="#3b82f6"/>
  <text x="52" y="62" font-size="12" text-anchor="middle" fill="#1e40af">数据接入服务</text>`)), 'text-overflows-box'));
});

test('free-standing text closer than 10px to the box on its right is an error', () => {
  // text spans 30..72 (6 characters × 7), the right-hand box starts at x=78: clearance 6px
  const findings = runCheck(textOverflow, WRAP(`<text x="30" y="62" font-size="12" fill="#64748b">Ingest</text>
  <rect x="78" y="44" width="120" height="36" fill="#dbeafe" stroke="#3b82f6"/>`, '0 0 220 106', '220'));
  const intrude = findings.find((f) => f.code === 'text-intrudes-neighbor');
  assert.equal(intrude.severity, 'error');
  assert.equal(intrude.repair.actual, '6');
  assert.equal(intrude.repair.expected, '>10');
});

test('a 12px clearance to the neighbour passes', () => {
  assert.deepEqual(runCheck(textOverflow, WRAP(`<text x="30" y="62" font-size="12" fill="#64748b">Ingest</text>
  <rect x="84" y="44" width="120" height="36" fill="#dbeafe" stroke="#3b82f6"/>`, '0 0 226 106', '226')), []);
});

test('a neighbour whose vertical range does not overlap is ignored', () => {
  assert.deepEqual(runCheck(textOverflow, WRAP(`<text x="30" y="62" font-size="12" fill="#64748b">Ingest</text>
  <rect x="78" y="110" width="120" height="36" fill="#dbeafe" stroke="#3b82f6"/>`, '0 0 220 172', '220')), []);
});

test('the title above the body is not treated as intruding', () => {
  assert.equal(hasCode(runCheck(textOverflow, fixture('pass/minimal.svg')), 'text-intrudes-neighbor'), false);
});

test('a label that just touches the 2px inner padding from either side is an error', () => {
  // box x=20 width=60; 5 CJK characters × 12px = 60px, text x=20 start.
  // bbox.minX=20 < 20+2=22 (overLeft); bbox.maxX=80 > 20+60-2=78 (overRight) → triggered.
  // removing the padding (0px) makes 20<20 false and 80>80 false → the whole case passes: a label
  // flush against the box edge merges with the border visually; this test pins the padding as non-zero.
  assert.ok(
    hasCode(
      runCheck(textOverflow, WRAP(
        `<rect x="20" y="20" width="60" height="40" fill="#dbeafe" stroke="#3b82f6"/>
  <text x="20" y="45" font-size="12" text-anchor="start" fill="#1e40af">一二三四五</text>`,
        '0 0 120 80', '120',
      )),
      'text-overflows-box',
    ),
  );
});

test('a label within 2px inner padding but outside 6px inner padding passes', () => {
  // 5 CJK × 12 + 2 Latin × 7 = 74px; box x=10 width=80, text centre x=50.
  // bbox.minX=50-37=13, bbox.maxX=87; INNER_PADDING=2 → 13<12? no, 87>88? no → passes.
  // widening the padding to 6px makes 13<16 true → a label that looks properly positioned on the
  // diagram gets a false positive; this test pins the padding at no more than 2px.
  assert.deepEqual(
    runCheck(textOverflow, WRAP(
      `<rect x="10" y="30" width="80" height="40" fill="#dbeafe" stroke="#3b82f6"/>
  <text x="50" y="55" font-size="12" text-anchor="middle" fill="#1e40af">一二三四五AB</text>`,
      '0 0 120 100', '120',
    )),
    [],
  );
});

test('free text with exactly 10px clearance to its right neighbour is an error', () => {
  // The style guide asks for "text right edge + 10px < left edge of the neighbour", so 10px itself
  // does not satisfy it and the comparison has to include the boundary.
  // text x=30, "Ingest" 6 × 7 = 42px, bbox.maxX=72; right-hand neighbour rect.x=82, clearance=10px.
  const findings = runCheck(textOverflow, WRAP(
    `<text x="30" y="62" font-size="12" fill="#64748b">Ingest</text>
  <rect x="82" y="44" width="120" height="36" fill="#dbeafe" stroke="#3b82f6"/>`,
    '0 0 224 106', '224',
  ));
  const intrude = findings.find((f) => f.code === 'text-intrudes-neighbor');
  assert.equal(intrude.repair.actual, '10');
  assert.equal(intrude.repair.expected, '>10');
});

test('free text with 11px clearance to its right neighbour passes', () => {
  // The counterpart of the boundary case: one pixel more and the guide is satisfied. Without this,
  // widening the comparison to `< 11` would still pass the test above.
  assert.deepEqual(
    runCheck(textOverflow, WRAP(
      `<text x="30" y="62" font-size="12" fill="#64748b">Ingest</text>
  <rect x="83" y="44" width="120" height="36" fill="#dbeafe" stroke="#3b82f6"/>`,
      '0 0 225 106', '225',
    )),
    [],
  );
});

test('a label whose left edge encroaches the inner padding is an error', () => {
  // box x=22 width=60; text x=23 start, "AB" 2 × 7 = 14px.
  // bbox.minX=23 < 22+2=24 → overLeft triggered; bbox.maxX=37 < 80 → overRight not triggered.
  // an implementation that only checks right overflow misses a pure left overflow: a label
  // poking out on the left side also needs fixing.
  assert.ok(
    hasCode(
      runCheck(textOverflow, WRAP(
        `<rect x="22" y="40" width="60" height="36" fill="#dbeafe" stroke="#3b82f6"/>
  <text x="23" y="62" font-size="12" text-anchor="start" fill="#1e40af">AB</text>`,
        '0 0 120 100', '120',
      )),
      'text-overflows-box',
    ),
  );
});

test('a label whose right edge encroaches the inner padding is an error', () => {
  // box x=22 width=60; text x=67 middle, "ABCDE" 5 × 7 = 35px.
  // bbox.minX=67-17.5=49.5, 49.5<24? no; bbox.maxX=84.5 > 22+60-2=80 → overRight triggered.
  // an implementation that only checks left overflow misses a pure right overflow — both sides must be checked.
  assert.ok(
    hasCode(
      runCheck(textOverflow, WRAP(
        `<rect x="22" y="40" width="60" height="36" fill="#dbeafe" stroke="#3b82f6"/>
  <text x="67" y="62" font-size="12" text-anchor="middle" fill="#1e40af">ABCDE</text>`,
        '0 0 120 100', '120',
      )),
      'text-overflows-box',
    ),
  );
});

test('free text bbox tangent to the top edge of a rect below is not a neighbour', () => {
  // text y=62 font-size=12: bbox.maxY=62+12×0.25=65; neighbour rect.y=65 → rect.minY=65.
  // verticallyOverlaps: rect.minY=65 < text.maxY=65 → 65<65 false → no overlap → ignored.
  // writing the upper bound as `<=` makes 65<=65 true → counts as overlap, clearance 78-72=6<10, one false positive.
  assert.deepEqual(
    runCheck(textOverflow, WRAP(
      `<text x="30" y="62" font-size="12" fill="#64748b">Ingest</text>
  <rect x="78" y="65" width="120" height="36" fill="#dbeafe" stroke="#3b82f6"/>`,
      '0 0 224 120', '224',
    )),
    [],
  );
});

test('free text with a left-side neighbour closer than 10px is an error', () => {
  // neighbour rect x=80 width=18 → bbox.maxX=98; text x=100 start, "A" 7px, bbox.minX=100.
  // left-side clearance=100-98=2<10 → triggers text-intrudes-neighbor (side="left").
  // an implementation that only checks the right side misses a neighbour closing in from the left.
  const findings = runCheck(textOverflow, WRAP(
    `<rect x="80" y="44" width="18" height="36" fill="#dbeafe" stroke="#3b82f6"/>
  <text x="100" y="62" font-size="12" text-anchor="start" fill="#64748b">A</text>`,
    '0 0 140 100', '140',
  ));
  const intrude = findings.find((f) => f.code === 'text-intrudes-neighbor');
  assert.ok(intrude, 'expected a text-intrudes-neighbor finding on the left side');
  assert.equal(intrude.repair.expected, '>10');
});

test('when two rects lie on the same side the nearer one drives the check', () => {
  // text bbox.maxX=72; near neighbour rect x=76 gap=4, far neighbour rect x=94 gap=22.
  // the correct implementation picks the nearest (gap=4), 4<10 → reports it.
  // an implementation that picks the farthest gets gap=22 and judges compliant, missing the box that actually crowds the label.
  assert.ok(
    hasCode(
      runCheck(textOverflow, WRAP(
        `<text x="30" y="62" font-size="12" fill="#64748b">Ingest</text>
  <rect x="76" y="44" width="50" height="36" fill="#dbeafe" stroke="#3b82f6"/>
  <rect x="94" y="44" width="50" height="36" fill="#d1fae5" stroke="#22c55e"/>`,
        '0 0 200 100', '200',
      )),
      'text-intrudes-neighbor',
    ),
  );
});

test('a box label that fits its container is not checked against outer rects', () => {
  // text is centred inside Box1 (x=0 width=90) with no overflow; Box2 (x=70) is clearance=4 from text bbox.maxX=66.
  // the correct implementation continues past the neighbour check → no finding.
  // an implementation that still checks neighbours for a box label emits an extra text-intrudes-neighbor
  // (Box2 clearance=4<10) — the box itself already separates the label, so this is a false positive on compact layouts.
  assert.deepEqual(
    runCheck(textOverflow, WRAP(
      `<rect x="0" y="20" width="90" height="40" fill="#dbeafe" stroke="#3b82f6"/>
  <text x="45" y="45" font-size="12" text-anchor="middle" fill="#1e40af">Ingest</text>
  <rect x="70" y="20" width="60" height="40" fill="#d1fae5" stroke="#22c55e"/>`,
      '0 0 160 80', '160',
    )),
    [],
  );
});

test('box overflow repair.expected reflects usable width after both inner paddings', () => {
  // box width=90, INNER_PADDING=2 → usable width=90-4=86; repair.expected should be the literal '≤86'.
  // an implementation that does not subtract both paddings outputs '≤90': the author widens the box to
  // 90px as instructed and still gets an error.
  // the label is 8 CJK characters × 12 = 96px: the text must **genuinely not fit** (96 > 86) to fall
  // into the "usable width" branch; a label that fits but is misplaced takes the other receipt branch
  // (which reports edge coordinates, not width).
  const findings = runCheck(textOverflow, WRAP(
    `<rect x="0" y="20" width="90" height="40" fill="#dbeafe" stroke="#3b82f6"/>
  <text x="40" y="45" font-size="12" text-anchor="start" fill="#1e40af">数据接入服务处理</text>`,
    '0 0 200 80', '200',
  ));
  const f = findings.find((fn) => fn.code === 'text-overflows-box');
  assert.ok(f, 'expected a text-overflows-box finding');
  assert.equal(f.repair.expected, '≤86');
});

test('fractional gap is reported with one decimal place in repair.actual', () => {
  // text x=20 font-size=8, "ABCD" 4 × 4.5 = 18px, bbox.maxX=38; neighbour rect.x=44.5, clearance=6.5.
  // round(6.5) = Number((6.5).toFixed(1)) = 6.5 → "6.5".
  // normalising with toFixed(0) → Number((6.5).toFixed(0)) = 7 → reported as "7"; the author adjusts to 7 and it is still not enough.
  const findings = runCheck(textOverflow, WRAP(
    `<text x="20" y="62" font-size="8" fill="#64748b">ABCD</text>
  <rect x="44.5" y="44" width="60" height="36" fill="#dbeafe" stroke="#3b82f6"/>`,
    '0 0 150 100', '150',
  ));
  const intrude = findings.find((f) => f.code === 'text-intrudes-neighbor');
  assert.ok(intrude, 'expected a text-intrudes-neighbor finding');
  assert.equal(intrude.repair.actual, '6.5');
});

test('a background rect spanning nearly the full viewBox is excluded from neighbour checks', () => {
  // background box width=490 height=100, area=49000=98%×50000 → recognised as a background rect.
  // text x=492, left-side clearance=492-490=2<10.
  // the correct implementation iterates contentRects (excluding the background box) → no finding.
  // switching to doc.rects (including the background box) → clearance=2<10 → every diagram with a
  // light background gets a false positive.
  assert.deepEqual(
    runCheck(textOverflow, WRAP(
      `<rect x="0" y="0" width="490" height="100" fill="#f1f5f9"/>
  <text x="492" y="50" font-size="12" text-anchor="start" fill="#64748b">A</text>`,
      '0 0 500 100', '500',
    )),
    [],
  );
});

test('a label shifted past its box right edge is an error even when textWidth would fit', () => {
  // box x=0 width=60; text x=20 start, "Ingest" 6 × 7 = 42px, bbox.maxX=62.
  // correct check: bbox.maxX=62 > 0+60-2=58 → triggered.
  // switching to a text-width criterion (42 > 60-2=58 is false) misses labels that fit but are shifted past the edge.
  assert.ok(
    hasCode(
      runCheck(textOverflow, WRAP(
        `<rect x="0" y="20" width="60" height="40" fill="#dbeafe" stroke="#3b82f6"/>
  <text x="20" y="45" font-size="12" text-anchor="start" fill="#1e40af">Ingest</text>`,
        '0 0 120 80', '120',
      )),
      'text-overflows-box',
    ),
  );
});

// ---- supplement: criteria found unguarded during bench testing ----

// the padding is "must not cross" not "must not touch": a left edge landing exactly on the inner
// padding line is still compliant.
// switching to `<=` gives this shape a false positive even though it looks properly aligned in the diagram.
// box x=20 inner padding line = 22; text x=22 start, "AB" 2 × 7 = 14px, bbox = 22..36.
test('a label whose left edge rests exactly on the inner padding line passes', () => {
  assert.deepEqual(
    runCheck(textOverflow, WRAP(
      `<rect x="20" y="20" width="60" height="40" fill="#dbeafe" stroke="#3b82f6"/>
  <text x="22" y="45" font-size="12" text-anchor="start" fill="#1e40af">AB</text>`,
      '0 0 120 80', '120',
    )),
    [],
  );
});

// same on the right side: box x=20 width=60 → right inner padding line = 78; text x=64 start, bbox = 64..78.
test('a label whose right edge rests exactly on the inner padding line passes', () => {
  assert.deepEqual(
    runCheck(textOverflow, WRAP(
      `<rect x="20" y="20" width="60" height="40" fill="#dbeafe" stroke="#3b82f6"/>
  <text x="64" y="45" font-size="12" text-anchor="start" fill="#1e40af">AB</text>`,
      '0 0 120 80', '120',
    )),
    [],
  );
});

// when two boxes are on the same side the nearest one wins — and the implementation cannot rely on
// "the first in document order is the nearest": here the far neighbour is declared first.
// an implementation that only remembers the first match gets gap=22 and judges compliant, missing the one that actually crowds the label.
// text bbox.maxX=72; far neighbour x=94 gap=22, near neighbour x=76 gap=4.
test('the nearer neighbour wins even when the farther one is declared first', () => {
  const findings = runCheck(textOverflow, WRAP(
    `<text x="30" y="62" font-size="12" fill="#64748b">Ingest</text>
  <rect x="94" y="44" width="50" height="36" fill="#d1fae5" stroke="#22c55e"/>
  <rect x="76" y="44" width="50" height="36" fill="#dbeafe" stroke="#3b82f6"/>`,
    '0 0 200 100', '200',
  ));
  const intrude = findings.find((f) => f.code === 'text-intrudes-neighbor');
  assert.ok(intrude, 'expected a text-intrudes-neighbor finding');
  assert.equal(intrude.repair.actual, '4');
});

// the other half of "tangent does not count as overlap": the box is **above** the text and its
// bottom edge lands exactly on the text's top edge.
// if only the "box below" side is pinned, relaxing the upper-bound inequality to `<=` still passes.
// text y=62 size=12 → bbox.minY=53; box y=17 height=36 → maxY=53.
test('a box tangent to the top of the text bbox is not a neighbour', () => {
  assert.deepEqual(
    runCheck(textOverflow, WRAP(
      `<text x="30" y="62" font-size="12" fill="#64748b">Ingest</text>
  <rect x="78" y="17" width="120" height="36" fill="#dbeafe" stroke="#3b82f6"/>`,
      '0 0 224 120', '224',
    )),
    [],
  );
});

// every text element must be checked, not just the first; this also pins that the finding carries
// the line and column of **that** text element.
// the first "Ingest" 6 × 7 = 42px fits inside the 90px box; the second 8 CJK characters × 12 = 96px does not.
// an implementation that only checks the first element, or hard-codes the position as 1:1, fails this test.
test('every text is checked and the finding carries that text position', () => {
  const findings = runCheck(textOverflow, WRAP(
    `<rect x="0" y="10" width="90" height="36" fill="#dbeafe" stroke="#3b82f6"/>
  <text x="45" y="32" font-size="12" text-anchor="middle" fill="#1e40af">Ingest</text>
  <rect x="0" y="60" width="90" height="36" fill="#d1fae5" stroke="#22c55e"/>
  <text x="45" y="82" font-size="12" text-anchor="middle" fill="#166534">数据接入服务处理</text>`,
    '0 0 120 110', '120',
  ));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].code, 'text-overflows-box');
  assert.equal(findings[0].line, 6);
  assert.equal(findings[0].column, 3);
});

// repair.actual is the measured text width, not the box width. The two values differ widely in the
// fixture (182 / 90), so the author knows by how much to shrink.
test('box overflow reports the measured text width in repair.actual', () => {
  const findings = runCheck(textOverflow, fixture('fail/text-overflow.svg'));
  const overflow = findings.find((f) => f.code === 'text-overflows-box');
  assert.equal(overflow.repair.actual, '182');
});

// the positions of the two numbers in the message also need to be pinned: only asserting "both 182
// and 90 appear" lets "needs 90px but its box is only 182px wide" pass, which states the conclusion backwards.
test('the box overflow message states the text width first and the box width second', () => {
  const findings = runCheck(textOverflow, fixture('fail/text-overflow.svg'));
  const overflow = findings.find((f) => f.code === 'text-overflows-box');
  assert.match(overflow.message, /needs 182px/);
  assert.match(overflow.message, /only 90px wide/);
});

// the message must name the side: hard-coding "right" makes the author move the label in the wrong direction.
// neighbour x=80 width=18 → maxX=98; text x=100 start, left-side clearance = 2px.
test('a left-side intrusion names the left side in its message', () => {
  const findings = runCheck(textOverflow, WRAP(
    `<rect x="80" y="44" width="18" height="36" fill="#dbeafe" stroke="#3b82f6"/>
  <text x="100" y="62" font-size="12" text-anchor="start" fill="#64748b">A</text>`,
    '0 0 140 100', '140',
  ));
  const intrude = findings.find((f) => f.code === 'text-intrudes-neighbor');
  assert.ok(intrude, 'expected a text-intrudes-neighbor finding');
  assert.match(intrude.message, /on its left/);
});

// ---- wiring ----
test('the check is wired into the registry, so lintSource reports it', () => {
  // without wiring, all other tests in this file pass but the CLI checks nothing. filter by check name:
  // this fixture also trips other checks, and without the filter this test would need updating each time
  // a new check is added. the filter itself also pins the check name.
  const { findings } = lintSource('text-overflow.svg', fixture('fail/text-overflow.svg'));
  assert.deepEqual(
    findings.filter((f) => f.check === 'text-overflow').map((f) => f.code),
    ['text-overflows-box'],
  );
});

// ---- supplement: gaps found by independent review ----

// a clearance of exactly 0 (label right edge just touching the box left edge) is the tightest
// intrusion shape short of overlap, and must be reported.
// writing the condition as `gap <= 0 continue` silences it entirely, while the overlap case
// belongs to another check, leaving no second safety net.
// text x=30 "Ingest" 6 × 7 = 42px → right edge 72; box x=72.
test('a label whose right edge just touches the neighbour is a 0px clearance', () => {
  const findings = runCheck(textOverflow, WRAP(
    `<text x="30" y="62" font-size="12" fill="#64748b">Ingest</text>
  <rect x="72" y="44" width="60" height="36" fill="#dbeafe" stroke="#3b82f6"/>`,
    '0 0 200 100', '200',
  ));
  const intrude = findings.find((f) => f.code === 'text-intrudes-neighbor');
  assert.ok(intrude, 'expected a text-intrudes-neighbor finding');
  assert.equal(intrude.repair.actual, '0');
});

// the right-side condition only pins `- INNER_PADDING` when the edge lands inside the 2px band
// between the inner padding line and the box edge: a label that crosses the box edge itself would
// also be caught by a comparison against the bare box edge, so it cannot distinguish the two.
// box x=20 w=60 → inner padding line 78, box edge 80;
// text x=65 "AB" 14px → right edge 79, landing in (78, 80].
test('a label whose right edge lands inside the box edge but past the inner padding is an error', () => {
  const findings = runCheck(textOverflow, WRAP(
    `<rect x="20" y="20" width="60" height="40" fill="#dbeafe" stroke="#3b82f6"/>
  <text x="65" y="45" font-size="12" text-anchor="start" fill="#1e40af">AB</text>`,
    '0 0 120 80', '120',
  ));
  assert.ok(hasCode(findings, 'text-overflows-box'));
});

// gap is normalised to one decimal place: two decimal places are needed to tell whether normalisation happened.
// text x=20 size=8 "ABCD" 4 × 4.5 = 18px → right edge 38; box x=44.25 → clearance 6.25 → 6.3.
test('a two-decimal gap is rounded to one decimal place', () => {
  const findings = runCheck(textOverflow, WRAP(
    `<text x="20" y="62" font-size="8" fill="#64748b">ABCD</text>
  <rect x="44.25" y="44" width="60" height="36" fill="#dbeafe" stroke="#3b82f6"/>`,
    '0 0 150 100', '150',
  ));
  const intrude = findings.find((f) => f.code === 'text-intrudes-neighbor');
  assert.ok(intrude, 'expected a text-intrudes-neighbor finding');
  assert.equal(intrude.repair.actual, '6.3');
});

// a label that fits but is misplaced: the receipt must state the edge coordinate, not the width —
// stating the width produces receipts like "42 → ≤56" where the actual value already satisfies the
// expected value, giving the author no direction.
// box x=0 w=60 → right inner padding line 58; text x=20 "Ingest" 42px → right edge 62, overshooting by 4px.
test('a label that fits but sits past the right inner edge reports the edge, not the width', () => {
  const findings = runCheck(textOverflow, WRAP(
    `<rect x="0" y="20" width="60" height="40" fill="#dbeafe" stroke="#3b82f6"/>
  <text x="20" y="45" font-size="12" text-anchor="start" fill="#1e40af">Ingest</text>`,
    '0 0 120 80', '120',
  ));
  const f = findings.find((fn) => fn.code === 'text-overflows-box');
  assert.ok(f, 'expected a text-overflows-box finding');
  assert.equal(f.repair.actual, '62');
  assert.equal(f.repair.expected, '≤58');
  assert.match(f.message, /sits 4px past the right inner edge/);
  assert.match(f.repair.hint, /adjust x/);
});

// same shape on the left: box x=22 w=60 → left inner padding line 24; text x=23 "AB" → left edge 23, overshooting by 1px.
// the expected value here is a lower bound, so the symbol must be ≥ not ≤.
test('a label that fits but sits past the left inner edge reports the left edge', () => {
  const findings = runCheck(textOverflow, WRAP(
    `<rect x="22" y="40" width="60" height="36" fill="#dbeafe" stroke="#3b82f6"/>
  <text x="23" y="62" font-size="12" text-anchor="start" fill="#1e40af">AB</text>`,
    '0 0 120 100', '120',
  ));
  const f = findings.find((fn) => fn.code === 'text-overflows-box');
  assert.ok(f, 'expected a text-overflows-box finding');
  assert.equal(f.repair.actual, '23');
  assert.equal(f.repair.expected, '≥24');
  // anchor on `sits `: an implementation that does not take the absolute value gives `sits -1px past ...`,
  // and /1px past/ matches `-1px` as a substring, staying green.
  assert.match(f.message, /sits 1px past the left inner edge/);
});

// the "does not fit" branch still reports the width, and carries no attribute (width is not the value of any attribute).
// box width=90 usable width 86; label 8 CJK characters × 12 = 96px.
test('a label too wide for its box still reports the width and no attribute', () => {
  const findings = runCheck(textOverflow, WRAP(
    `<rect x="0" y="20" width="90" height="40" fill="#dbeafe" stroke="#3b82f6"/>
  <text x="45" y="45" font-size="12" text-anchor="middle" fill="#1e40af">数据接入服务处理</text>`,
    '0 0 200 80', '200',
  ));
  const f = findings.find((fn) => fn.code === 'text-overflows-box');
  assert.ok(f, 'expected a text-overflows-box finding');
  assert.equal(f.repair.actual, '96');
  assert.equal(f.repair.expected, '≤86');
  assert.equal(f.repair.attribute, undefined);
  assert.match(f.repair.hint, /widen the box/);
});

// ---- supplement: three receipt / boundary minors recorded in the second review pass ----

// the usable width is normalised the moment it is computed: without normalisation, `width="52.7"`
// produces `≤48.699999999999996`, which the author cannot find in the file. the box width itself
// is the value the author wrote and is echoed back as-is.
test('a fractional box width does not leak float noise into the expected width', () => {
  // 64.1 - 4 under IEEE 754 is 60.099999999999994. without normalisation this string gets printed
  // into the receipt and the author cannot find it in the file. the box width itself is the value the
  // author wrote and is echoed back as-is.
  const findings = runCheck(textOverflow, WRAP(
    `<rect x="0" y="20" width="64.1" height="40" fill="#dbeafe" stroke="#3b82f6"/>
  <text x="32" y="45" font-size="12" text-anchor="middle" fill="#1e40af">数据接入服务处理</text>`,
    '0 0 120 80', '120',
  ));
  const f = findings.find((fn) => fn.code === 'text-overflows-box');
  assert.ok(f, 'expected a text-overflows-box finding');
  assert.equal(f.repair.expected, '≤60.1');
  assert.match(f.message, /only 64.1px wide/);
});

// the inner padding line itself must also be normalised: box x=0 width=64.1 → right inner
// padding line 62.099999999999994.
// "Ingest" 42px fits (usable width 60.1), but its right edge 67 crosses the padding line → takes the edge branch.
test('a fractional inner padding line does not leak float noise into the expected edge', () => {
  const findings = runCheck(textOverflow, WRAP(
    `<rect x="0" y="20" width="64.1" height="40" fill="#dbeafe" stroke="#3b82f6"/>
  <text x="25" y="45" font-size="12" text-anchor="start" fill="#1e40af">Ingest</text>`,
    '0 0 120 80', '120',
  ));
  const f = findings.find((fn) => fn.code === 'text-overflows-box');
  assert.ok(f, 'expected a text-overflows-box finding');
  assert.equal(f.repair.actual, '67');
  assert.equal(f.repair.expected, '≤62.1');
});

// if the overshoot rounds to nothing to print (0.02px) it is not reported: reporting it would
// produce `58 → ≤58` paired with "sits 0px past", where the actual value already satisfies the
// expected value, giving the author nothing to fix.
// box x=0 w=60 → inner padding line 58; text x=16.02 "Ingest" 42px → right edge 58.02.
test('an overshoot too small to print is not reported', () => {
  assert.deepEqual(
    runCheck(textOverflow, WRAP(
      `<rect x="0" y="20" width="60" height="40" fill="#dbeafe" stroke="#3b82f6"/>
  <text x="16.02" y="45" font-size="12" text-anchor="start" fill="#1e40af">Ingest</text>`,
      '0 0 120 80', '120',
    )),
    [],
  );
});

// counterpart: a printable overshoot (0.2px) is still reported; the guard must not swallow this tier too.
test('an overshoot of a tenth of a pixel is still reported', () => {
  const findings = runCheck(textOverflow, WRAP(
    `<rect x="0" y="20" width="60" height="40" fill="#dbeafe" stroke="#3b82f6"/>
  <text x="16.2" y="45" font-size="12" text-anchor="start" fill="#1e40af">Ingest</text>`,
    '0 0 120 80', '120',
  ));
  const f = findings.find((fn) => fn.code === 'text-overflows-box');
  assert.ok(f, 'expected a text-overflows-box finding');
  assert.equal(f.repair.actual, '58.2');
  assert.match(f.message, /sits 0.2px past the right inner edge/);
});

// counterpart: when the label genuinely does not fit it must be reported no matter how small the
// overshoot — that branch reports width, which is independent of edge rounding.
// box w=40 usable width 36; label 42px; right edge 38.02 against inner padding line 38 (overshoot 0.02px).
test('a label too wide to fit is reported even when its edge barely overshoots', () => {
  const findings = runCheck(textOverflow, WRAP(
    `<rect x="0" y="20" width="40" height="40" fill="#dbeafe" stroke="#3b82f6"/>
  <text x="-3.98" y="45" font-size="12" text-anchor="start" fill="#1e40af">Ingest</text>`,
    '0 0 120 80', '120',
  ));
  const f = findings.find((fn) => fn.code === 'text-overflows-box');
  assert.ok(f, 'expected a text-overflows-box finding');
  assert.equal(f.repair.expected, '≤36');
});

// a label overlapping the box (negative clearance) belongs to the "text presses on box" check;
// this check does not report it. the boundary must be pinned at 0:
// relaxing the condition to `< -20` causes a label 15px into the box to get a finding "-15 → ≥10",
// a negative actual paired with a positive expected, giving the author no direction.
// text right edge 72; box x=57 → clearance −15.
test('a label overlapping the box on its right is not reported as a clearance', () => {
  assert.deepEqual(
    runCheck(textOverflow, WRAP(
      `<text x="30" y="62" font-size="12" fill="#64748b">Ingest</text>
  <rect x="57" y="44" width="60" height="36" fill="#dbeafe" stroke="#3b82f6"/>`,
      '0 0 200 100', '200',
    )),
    [],
  );
});

// the left edge must also be normalised before comparison: text x=21.98 against inner padding
// line 22, overshoot 0.02px does not print.
// without normalisation a finding `22 → ≥22` paired with "sits 0px past" is emitted —
// the actual value already satisfies the expected value.
test('an overshoot too small to print is not reported on the left either', () => {
  assert.deepEqual(
    runCheck(textOverflow, WRAP(
      `<rect x="20" y="20" width="60" height="40" fill="#dbeafe" stroke="#3b82f6"/>
  <text x="21.98" y="45" font-size="12" text-anchor="start" fill="#1e40af">AB</text>`,
      '0 0 120 80', '120',
    )),
    [],
  );
});
