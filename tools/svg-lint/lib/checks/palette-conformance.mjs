// tools/svg-lint/lib/checks/palette-conformance.mjs
// The 5 light semantic triples from SKILL.md "Colors" + the style consistency requirement from "Dashed grouping boxes".
// The color criterion takes only the fill= / stroke= presentation attributes (see Global Constraints) and does not go through CSS.
import { warning } from '../report.mjs';
import { ALLOWED_COLORS, BASE_TEXT, semanticByFill } from '../palette.mjs';
import { effectiveFill, effectiveStroke } from '../document.mjs';

const ID = 'palette-conformance';
const BASE_TEXT_COLORS = new Set(Object.values(BASE_TEXT));
// Case-insensitive because SVG keywords are: `fill="NONE"` paints nothing exactly as `fill="none"` does,
// and a check that quoted it back would be demanding a change that alters nothing on screen.
// `currentColor` is in here for a different reason than the rest: it does name a colour, but the one it
// names is the `color` property, which this model does not carry. Judging it means resolving something not
// recorded, and calling it a colour name would tell the author to write the hex of a keyword that has none.
// `inherit` is deliberately absent: the cascade resolves it during collect (see inheritedPaint), so what
// arrives here is the colour in force -- the nearest ancestor's declaration, or the SVG initial value when no
// ancestor declared one. Either way it is what renders, which is what has to be judged.
const NOT_A_COLOR = /^(none|transparent|currentColor|url\(.*\))$/i;
// Letters only. Of the values that get this far -- past the skip above and past palette membership -- one
// spelt in letters alone takes the "colour name" wording and its notation-change advice, and everything else
// takes the wording that says the value is not in the palette and asserts nothing about what it is. `light-blue`
// and `gray50` take the second one: a hyphen or a digit is enough to fall outside this test. `none` and an
// in-palette hex never reach either, having been dropped earlier. `rgb(0,0,0)` and the malformed `#12345`
// are examples of what the second wording covers, not a statement of what else does.
const COLOR_NAME = /^[a-zA-Z]+$/;

export const paletteConformance = {
  id: ID,
  title: 'Colours come from the house palette and grouping boxes match',
  run(doc) {
    const out = [];
    // markers come in too: the arrow colour is in the palette, and the arrow-marker check only reads sizes, so
    // before this check nothing in the repository could see an arrowhead's colour at all.
    //
    // doc.others (circle / line / ellipse / polygon / polyline) is deliberately left out, and having their
    // colours is not a reason to include them: whether `fill` renders at all differs per tag -- a <line>'s
    // fill does nothing while a <polyline>'s fills the region its implied closing edge encloses. One rule
    // wrong there is a false positive on every diagram containing that shape, and none of the five appears in
    // SKILL.md or assets/house-style.svg to justify writing five. The consequence, recorded
    // rather than fixed: <circle fill="#ff00ff"/> passes in silence.
    const entries = [
      ...doc.rects.map((entry) => ({ entry, kind: 'rect' })),
      ...doc.texts.map((entry) => ({ entry, kind: 'text' })),
      ...doc.paths.map((entry) => ({ entry, kind: 'path' })),
      ...[...doc.markers.values()].map((entry) => ({ entry, kind: 'marker' })),
    ];

    // SVG's initial `fill` is black, so an undeclared fill resolves to black whichever element carries it. On a
    // connector that is not a colour choice but a missing `fill="none"` -- house style writes that attribute on
    // both of the connectors in assets/house-style.svg. How much of the black is painted depends on the shape: a
    // straight two-point path encloses no area and renders identically to `fill="none"`, while a path that turns
    // has whatever its implied closing edge encloses painted black. The attribute is missing in both cases, and
    // quoting the palette at that author sends them looking for a colour they never wrote, so the advice names
    // the real repair.
    // Only the fill arm can arrive here undeclared: an undeclared stroke resolves to `none` and is skipped
    // above as naming no colour, so there is no such thing as a reported stroke nobody wrote.
    const hintFor = (kind, declared) => (kind === 'path' && declared === null
      ? 'a connector needs fill="none"; an undeclared fill resolves to black, and any area the path encloses is painted with it'
      : 'pick one of the five semantic triples, the base text colours, or an arrow colour');

    for (const { entry, kind } of entries) {
      const at = { line: entry.line, column: entry.column };

      for (const [attribute, value, declared] of [
        ['fill', effectiveFill(entry), entry.fill ?? null],
        ['stroke', effectiveStroke(entry), entry.stroke ?? null],
      ]) {
        // Three legal values name no colour at all: `none` and `transparent` paint nothing, and a gradient
        // or pattern reference names an element instead of a colour. Quoting any of them back as an
        // off-palette choice, with advice to pick a semantic triple, would be advice to change something
        // that is not a colour. `NOT_PAINT` in light-bg-fallback.mjs agrees on `none` and `transparent`, and
        // matches them case-insensitively as this does, but decides gradients the other way on purpose: there
        // an unknown colour has to count as covering the canvas, here an unknown colour is one this check
        // cannot judge, and both readings avoid a false positive. (Cited by name, not line: a line number in
        // another file is a claim that goes stale the next time that file is edited.)
        if (NOT_A_COLOR.test(value)) continue;
        if (!ALLOWED_COLORS.has(value)) {
          // A colour name renders a real colour, so "not in the house palette" would send the author
          // hunting for a swatch problem when the fix is a notation change. But the notation change is not
          // the whole fix: `white` becomes the allowed #ffffff while `black` becomes #000000, which the
          // palette does not have -- so the advice has to name both halves rather than promise that
          // spelling it in hex is enough. Only hex is compared, because the palette is written in hex.
          const named = COLOR_NAME.test(value);
          out.push(warning({
            check: ID, code: 'off-palette-color', ...at,
            message: named
              ? `${attribute} "${value}" is a colour name; house style writes colours as hex`
              : `${attribute} "${value}" is not in the house palette`,
            repair: {
              attribute,
              actual: value,
              expected: named ? 'the hex form of a palette colour' : 'a palette colour',
              hint: named
                ? 'write the colour as hex, then check that hex against the palette -- a legal colour name is not necessarily a palette colour'
                : hintFor(kind, declared),
            },
          }));
        }
      }
    }

    // Semantic pairing: once the fill is recognised as some triple's fill color, the stroke has to be that same triple's stroke color.
    for (const rect of doc.contentRects) {
      const triple = semanticByFill(effectiveFill(rect));
      if (!triple) continue;
      // Every spelling of "no stroke" has to be let through, and none of them is a pairing error. `rect.stroke`
      // is null when nothing is declared anywhere; it is the string 'none' or 'transparent' when the author
      // wrote one of those -- and also when any ancestor did, because the field resolves the cascade, so a
      // single `<g stroke="none">` would otherwise report every semantic-fill box in the diagram. Testing
      // truthiness alone does not do it: those are non-empty strings. Reusing the same set as the off-palette
      // arm also covers a gradient stroke, which has no hex to compare against the triple's -- naming a
      // replacement for it would be the same guess the arm above declines to make.
      if (rect.stroke && !NOT_A_COLOR.test(rect.stroke) && rect.stroke !== triple.stroke) {
        out.push(warning({
          check: ID, code: 'semantic-pair-mismatch', line: rect.line, column: rect.column,
          message: `Fill ${effectiveFill(rect)} belongs to the "${triple.name}" triple, whose stroke is ${triple.stroke}`,
          repair: { attribute: 'stroke', actual: rect.stroke, expected: triple.stroke, hint: null },
        }));
      }
      for (const t of rect.texts) {
        if (effectiveFill(t) === triple.text) continue;
        if (BASE_TEXT_COLORS.has(effectiveFill(t))) continue;
        out.push(warning({
          check: ID, code: 'semantic-text-color-mismatch', line: t.line, column: t.column,
          message: `Label colour ${effectiveFill(t)} does not match the "${triple.name}" triple`,
          repair: { attribute: 'fill', actual: effectiveFill(t), expected: triple.text, hint: 'or use a base text colour' },
        }));
      }
    }

    // Grouping box style consistency: dasharray, corner radius and fill have to be uniform within one diagram.
    //
    // A dash list is separated by commas or whitespace or both, so "6,4" and "6, 4" draw the same dashes.
    // Comparing the raw strings reports two identical-looking boxes as inconsistent. Values are still echoed
    // back unnormalised, because the author has to find them in the file.
    const same = (value) => String(value).replace(/[\s,]+/g, ' ').trim();

    // `rx` is optional, and an absent one is null in the model but sharp corners on screen. Quoting it as
    // "null" sends the author looking for a string the file does not contain, which is the same defect the
    // unnormalised echo above avoids for dash lists.
    const absent = (value) => value === null || value === undefined;
    const shown = (value) => (absent(value) ? 'not set' : String(value));
    const inMessage = (value) => (absent(value) ? 'not set' : `"${value}"`);

    // The style the diagram is held to is the one most of its boxes already use, with a tie going to the
    // earliest. Taking the first box as the reference inverts the advice whenever that box is the odd one
    // out: two boxes that agree with each other get told to adopt the outlier's radius, and following the
    // repair makes the diagram worse. Insertion order carries the tie, so the comparison stays strict.
    const commonest = (values) => {
      const groups = new Map();
      for (const value of values) {
        const key = same(value);
        if (!groups.has(key)) groups.set(key, { value, count: 0 });
        groups.get(key).count += 1;
      }
      let winner = null;
      for (const group of groups.values()) if (!winner || group.count > winner.count) winner = group;
      return winner.value;
    };

    if (doc.groupRects.length > 1) {
      for (const [attribute, read] of [
        ['stroke-dasharray', (r) => r.dasharray],
        ['rx', (r) => r.rx],
        ['fill', (r) => effectiveFill(r)],
      ]) {
        const expected = commonest(doc.groupRects.map(read));
        for (const rect of doc.groupRects) {
          const actual = read(rect);
          if (same(actual) === same(expected)) continue;
          out.push(warning({
            check: ID, code: 'group-box-style-inconsistent', line: rect.line, column: rect.column,
            message: `Dashed grouping box ${attribute} is ${inMessage(actual)} but another one uses ${inMessage(expected)}`,
            repair: { attribute, actual: shown(actual), expected: shown(expected), hint: 'every dashed grouping box in one diagram shares dasharray, corner radius and fill' },
          }));
        }
      }
    }

    return out;
  },
};
