// tools/svg-lint/lib/checks/light-bg-fallback.mjs
// A project decision rather than a house-style rule: dark-theme readability comes from a light background rect, not from dual theming. SKILL.md is silent on dark pages.
// This check is the machine-checkable point of that decision: a label with nothing painted behind it at all,
// whose own colour would be unreadable on a dark canvas → warning. Paint of any colour shields, not just light paint.
import { warning } from '../report.mjs';
import { contrastRatio, DARK_CANVAS, LIGHT_CANVAS, WCAG_AA_TEXT } from '../color.mjs';
import { effectiveFill } from '../document.mjs';
import { bboxInsets } from '../geometry.mjs';

const ID = 'light-bg-fallback';

// Anything with a fill paints over the canvas and shields the glyphs drawn on it. `none` and
// `transparent` do not, and they are the whole reason existence is not the test: `doc.backgroundRect`
// is chosen by area alone (see where `doc.backgroundRect` is assigned in document.mjs) and house style
// draws a dashed `fill="none"` frame around a whole diagram, so trusting the rect to exist lets that stand in
// for a background and silences this check for the entire file.
//
// A gradient or pattern (`fill="url(#g)"`) counts as paint even though its colour is unknown here.
// Reading it would mean resolving the referenced element; guessing wrong in the other direction
// would report a diagram whose background is perfectly light, and a false positive is the worse
// failure for this tool.
// Matched case-insensitively, SVG keywords being case-insensitive: a `fill="NONE"` paints nothing, and a set
// that misses it treats the rect as a shield and drops the warning for every label behind it.
const NOT_PAINT = new Set(['none', 'transparent']);
const paintOf = (entry) => {
  if (!entry) return null;
  const fill = effectiveFill(entry);
  return NOT_PAINT.has(fill.toLowerCase()) ? null : fill;
};

// Whether `outer` covers every corner of `inner`.
const covers = (outer, inner) => {
  const insets = bboxInsets(outer, inner);
  return insets.left >= 0 && insets.right >= 0 && insets.top >= 0 && insets.bottom >= 0;
};

// Of the five shapes in `doc.others`, `<line>` is the one whose `fill` paints nothing at all, so a
// `<line fill="#ffffff">` shields no glyph. The other four do paint: a `<polyline>` fills the region its
// implied closing edge encloses, and the rest fill their outline.
const FILLED_SHAPE_TAGS = new Set(['circle', 'ellipse', 'polygon', 'polyline']);

export const lightBgFallback = {
  id: ID,
  title: 'A background rect keeps uncontained text readable in GitHub dark mode',
  run(doc) {
    if (doc.texts.length === 0) return [];

    // A painted background covers the canvas for every glyph in the file, so there is nothing left
    // to measure. What colour it is painted is deliberately not asked: measuring text against the
    // background's own fill turns this into a text-on-background contrast check, and it then fires
    // on the palette — the muted text colour `#94a3b8` is 7.38:1 on the dark canvas but only 2.56:1
    // on white, so a caption that passes here would start failing the moment the author followed
    // the hint below and added the white rect. That question belongs to the palette check, which
    // owns text-against-fill contrast.
    //
    // The gap this leaves, and it applies to every door below, not only this one: paint of any
    // colour shields. A full-canvas rect painted dark exempts the file while being the very defect
    // this check describes, one layer up, and a dark dashed grouping box hides a dark label just as well.
    // These are false negatives, and the palette check is where a non-house colour gets caught.
    if (paintOf(doc.backgroundRect)) return [];

    const out = [];
    const round = (v) => Number(v.toFixed(2));

    // A dashed grouping box never becomes a `container`, because dashed grouping boxes are kept out of
    // `contentRects` (both assigned in document.mjs). A grouping box with a fill still paints behind the group's
    // own name, so without this the label on a `fill="#f8fafc"` grouping box is reported at 1.29:1.
    //
    // The whole text box has to be inside, not its centre. The group-name binding in document.mjs ties one to
    // its box by the centre on purpose, because a long name written in a narrow grouping box overflows
    // and testing the full box would miss it — but that question is "which box does this name belong
    // to", and this one is "is there paint behind these glyphs". A name centred in an 80px box and
    // running well past both edges is bound to the box and still mostly over bare canvas.
    const insidePaintedGroup = (t) => doc.groupRects.some((rect) => paintOf(rect) && covers(rect.bbox, t.bbox));

    // A solid content box paints behind glyphs that are not its own label: a card painted `#ffffff` holding
    // an unfilled inner box shields that box's label, which is bound to the box, not to the card,
    // so `t.container` never reaches the card and the label was reported at 2.17:1 while sitting on
    // white. Every solid content box is asked, not only the ones that qualify as panels, matching the two
    // doors either side of this one — they ask whether a grouping box or a shape is painted and covers
    // the glyphs, not what role it plays in the layout. Same coverage rule as the grouping-box door:
    // the whole text box must be inside, because a label running past the paint's edges is over
    // bare canvas for most of its length.
    const overPaintedBox = (t) => doc.contentRects.some((rect) => paintOf(rect) && covers(rect.bbox, t.bbox));

    // A label written on a filled circle is as legible as one on a filled box, and nothing in the model
    // makes it a `container`, so without this door a caption on a white disc is reported at 1.29:1.
    // A shape is tested by its bounding box, which for a circle is the enclosing square: a glyph tucked
    // into a corner of that square is over bare canvas and still counts as shielded. Tracing the real
    // outline would fix that, and would mean a per-tag geometry model for shapes house style does not use;
    // the error this leaves is a missed warning, not a warning on a correct diagram.
    const overPaintedShape = (t) => doc.others.some((shape) => FILLED_SHAPE_TAGS.has(shape.element.tag)
      && paintOf(shape) && covers(shape.bbox, t.bbox));

    for (const t of doc.texts) {
      // Text on a filled box sits on that fill, so what is behind the diagram never reaches the
      // reader and this check has nothing to say about it. The box's stroke is deliberately not
      // consulted: requiring one reports two legible dark labels on a white strokeless panel at
      // 1.29:1 and 1.83:1, advising "add a background rect" when one is already behind them.
      // An unfilled box is not a shield — the canvas shows straight through it — so its label
      // falls through to the measurement below.
      if (paintOf(t.container) || overPaintedBox(t) || insidePaintedGroup(t) || overPaintedShape(t)) continue;
      // effectiveFill already falls back to '#000000' per the SVG initial value, so there is no need for a second fallback here
      // (writing another default would copy the initial value into two places, and one of them gets missed on a change).
      const fill = effectiveFill(t);
      const ratio = contrastRatio(fill, DARK_CANVAS);
      if (ratio !== null && ratio < WCAG_AA_TEXT) {
        out.push(warning({
          check: ID,
          code: 'no-light-background',
          line: t.line,
          column: t.column,
          message: `"${t.content}" (${fill}) has ${round(ratio)}:1 contrast on dark canvas; add a background rect`,
          repair: {
            actual: String(round(ratio)),
            expected: String(WCAG_AA_TEXT),
            hint: `add a white background rect covering the full viewBox: <rect x="0" y="0" width="..." height="..." fill="${LIGHT_CANVAS}"/>`,
          },
        }));
      }
    }
    return out;
  },
};
