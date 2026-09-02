# svg-lint

A maintainer's tool for checking hand-written SVG diagrams against the house style in
`SKILL.md` — not a self-check gate for agents: the skill does not mention the linter and
does not ask an agent to run it.

## Running it

```bash
node tools/svg-lint/bin/svg-lint.mjs <file.svg...>          # text report
node tools/svg-lint/bin/svg-lint.mjs --json <file.svg...>    # machine-readable JSON
node tools/svg-lint/bin/svg-lint.mjs --quiet <file.svg...>   # errors only; warnings stay in the tally
node tools/svg-lint/bin/svg-lint.mjs --help                  # options and exit codes
```

Through the npm scripts in the repository-root `package.json`, run from the repository root — the
test glob and both lint paths are root-relative:

```bash
npm run lint:svg -- <file.svg...>   # the same CLI
npm run lint:svg:all               # every SVG the repo ships, i.e. every tracked one bar the fixtures
npm test                           # the test suite
```

`lint:svg:all` pipes NUL-separated paths (`-z` into `-0`) because the plain
`git ls-files '*.svg' | xargs` form splits a tracked path that contains a space into two arguments:
`a b.svg` arrives as `a` and `b.svg`, and the linter then reports two unreadable files.

`lint:svg:all` is the gate, so its pathspec drops everything under `tools/svg-lint/test/fixtures/`.
That is all 16 fixtures, not just the failing ones: 27 SVGs are tracked, 16 are fixtures — 14 under
`fail/` and 2 under `pass/` — and the 11 that remain are what the repository ships. The two `pass/`
fixtures do lint clean, so they could sit inside the gate; they are excluded because the suite already
asserts them, and because the gate answers one question, whether every shipped diagram is clean.

Excluding the other 14 is what makes a passing state possible at all. Each is aimed at one check,
though most trip a second, usually `viewbox-clipping`, because a fixture is sized to show its own
defect rather than to satisfy the margin rules. Every finding in the repository comes from those 14
files: pointed at them the linter reports exactly `14 file(s), 17 error(s), 35 warning(s)`, and the
gate reports `11 file(s), 0 error(s), 0 warning(s)` with exit 0. To see the fixture tally for
yourself, from the repository root:

```bash
node tools/svg-lint/bin/svg-lint.mjs $(git ls-files 'tools/svg-lint/test/fixtures/fail/*.svg')
```

## Zero dependencies

The root `package.json` holds `scripts` only — no `dependencies`, no `devDependencies`. Every source
and test file is `.mjs` running on Node built-ins, and the tests use `node:test`, so a bare clone runs
both the linter and its suite with no `npm install`. Verified on Node v22.23.1 by cloning this
repository into a directory with no `node_modules` and running the CLI and the suite there.

## Exit codes

| Code | Meaning |
|------|---------|
| 0 | No errors. Warnings may still be present — the text report then ends with a `WARNINGS PRESENT` line, because house style asks for 0 errors *and* 0 warnings. |
| 1 | At least one error. |
| 2 | Bad usage (no input files, unknown option), or a named file could not be read. Files that could be read are still linted and reported; the unreadable ones are named on stderr, and the 2 wins over the lint verdict because the report covers fewer files than were asked for. Under `--json` the report — including `summary.exitCode` — describes only the files that were read, so a consumer has to take the verdict from the process exit code, not from `summary`. |

The table describes the CLI. `npm run lint:svg:all` exits with the status of `xargs` instead, which is
not the same number: the BSD `xargs` on macOS exits 1 both when the linter exited 1 and when it exited
2, and GNU `xargs` documents 123 for a command that exited 1-125. Only the macOS behaviour was measured
here, so read the batch script's exit code as no more than "non-zero", and take the verdict from the
report or run the CLI on the file itself. Two further ways the pipeline loses information, both
theoretical at 11 short paths but worth knowing before the corpus grows: were the argument list ever to
exceed `ARG_MAX`, `xargs` would invoke the CLI once per batch and report only the last batch's status,
hiding a failure in an earlier one; and a `git ls-files` that failed would leave the pipeline exiting 0
on an empty list.

## The `--json` report

One object, `{ tool: 'svg-lint', summary, files }`, pretty-printed with a two-space indent and a trailing
newline. `summary` is `{ files, errors, warnings, exitCode }`, and `files` is one entry per file that
could be read, in the order the paths were given, each `{ file, findings }` — with `findings` present and
empty for a clean file rather than omitted.

A finding always carries the same seven keys, in this order:

| Key | Value |
|-----|-------|
| `check` | The check id, e.g. `overlap`. Also `document-model` for the model layer's own notes, which belong to no check. |
| `severity` | `error` or `warning`, the only two values. |
| `code` | The stable identifier for the specific problem, e.g. `text-overflows-box`. This is what to match on; messages are prose and get reworded. |
| `message` | One human-readable sentence, usually carrying the measured numbers. |
| `line`, `column` | 1-based position of the offending element in the source. Both default to 1, which is what a whole-file finding such as `model-crashed` reports. |
| `repair` | An object, or `null`. |

Findings are sorted by `line`, then `column`, then check id alphabetically — so two findings on one line
arrive in alphabetical order, not in the order the checks ran.

`repair` is where the shape varies, and a consumer has to handle four cases. Every field inside it is
optional, and an omitted one is **absent, not null**, so test with `in` or a nullish default rather than
comparing to `null`:

- `{ attribute, actual, expected, hint }` — the common case: which attribute to edit, what it says now,
  what it should say. `hint` is sometimes `null` even here, when the `expected` value already says
  everything — `palette-conformance/semantic-pair-mismatch`, raised on a box whose fill comes from one
  semantic triple and whose stroke comes from another, prints `actual: "#ec4899"`,
  `expected: "#3b82f6"` and an explicit `hint: null`, so the key is there and the advice is not. Both
  of those colours are in the palette; what the finding objects to is the pairing.
- `{ actual, expected, hint }` with no `attribute` — the measurement is not attributable to one
  attribute. `block-spacing`'s over-wide gap and `viewbox-clipping`'s margin asymmetry are both like
  this: the number comes from a pair of elements.
- `{ hint }` alone — nothing numeric to quote, only advice. Six findings have this shape: `overlap`'s
  `text-over-box`, `text-over-line` and `line-cuts-box`, which are yes-or-no placement verdicts with no
  measurement to report, and `xml-escaping`'s `unknown-entity`, `duplicate-attribute` and
  `double-hyphen-in-comment`, where no mechanical substitution is correct — a human has to choose the
  replacement, which duplicate to drop, or how to reword the comment.
- `null` — no repair at all, and this set is larger than it looks. The `document-model` notes and the
  two crash findings (`model-crashed`, `check-crashed`) have nothing to suggest. So do five of
  `xml-escaping`'s eleven codes: its `REPAIRS` table has entries for six, and the five well-formedness
  ones the parser can also raise — `mismatched-tag`, `unclosed-tag`, `unterminated-tag`,
  `unterminated-markup`, `unclosed-cdata` — fall through the table's `?? null` and arrive with no
  repair, because a file that does not parse has no attribute to point at. Measured: a `<g>` left open
  yields `mismatched-tag` and two `unclosed-tag`, all three with `"repair": null`, while a bare `&` in
  the same position carries the full object.

`actual` and `expected` are strings even when they hold numbers, so `"62"` and `"20–25"` rather than `62`
and a range object. Across the 14 fail fixtures all 52 findings carry a repair object, so a consumer
tested against those alone will never meet a `null`. Both routes to one are easy to reach: a `rotate()`
transform produces a `document-model` note, and an unclosed tag produces a well-formedness code.

`--quiet` does not reach this format. It is applied by the text formatter only, so `--json --quiet`
prints every warning in full — the same file reports three warnings under `--json --quiet` that the text
report hides. `--quiet` never changed the tally in either format, so `summary` is unaffected either way.

## What the checks look at

Twelve checks, in the order `lib/registry.mjs` runs them. The right-hand column names the item from the
verification checklist at the end of `SKILL.md`, or the section that states the rule when
the checklist has no item for it.

| Check | Reports | In SKILL.md |
|-------|---------|-------------|
| `xml-escaping` | Everything the parser reported, which is two jobs rather than one. Escaping: a raw `&`, `<` or `>` in text, and an unknown entity; a raw `&`, a raw `<` and an unknown entity are caught in attribute values as well, where a `>` needs no escaping and is left alone. Well-formedness: a closing tag that does not match the innermost open one, an element still open at the end of the file, an unterminated tag, an unterminated comment or declaration, an unclosed CDATA section, a duplicate attribute name, and a comment whose content contains `--` or ends in `-`, which no XML parser accepts. Of those eleven codes only the raw `>` is a warning; the other ten are errors. | "Special characters escaped (`&` → `&amp;`, `<` → `&lt;`)" covers the escaping half only. The well-formedness codes have no checklist item: `lib/parse-svg.mjs` raises them as it reads the file, and this check forwards every one of them. |
| `viewbox-clipping` | A missing `viewBox`, and then nothing else — the check stops there, so a file missing both `viewBox` and `width` is told only about the `viewBox`. With a `viewBox` present: a missing `width`; and once the model has produced a content bounding box, content outside the viewBox (error), a margin under 20px (error) or over 25px (warning), and top-versus-bottom or left-versus-right margins differing by more than 5px (warnings). | "`width` attribute present, viewBox matches the content"; "Top and bottom viewBox margins comparable (20–25px …)"; "Left and right viewBox padding symmetric …"; "Every element inside the visible viewBox …", whose elided bottom-margin figure is enforced as the 20–25px band rather than as exactly 25px; "No large blank regions …", whose elided "spacing within 30px" clause is `block-spacing`'s — nothing here measures blank space between elements |
| `font-stack` | In a file that holds at least one `<text>`: no `<style>` rule declaring a `font-family` for the bare `text` selector, any of `PingFang SC`, `Microsoft YaHei` and `Noto Sans CJK SC` missing from a stack, and those three out of that order. All three are errors. `missing-font-stack` also fires when the rule is there but its value is a CSS-wide keyword — all five of `inherit`, `initial`, `unset`, `revert` and `revert-layer` do it, because none of them names a font, and what the author has to do is write a stack the renderer can read. The same five are skipped when they appear as a `<text>`'s own effective family, so `font-family="inherit"` on an element adds no finding of its own. A file with no `<text>` element gets no finding at all, `missing-font-stack` included. | The "Fonts (required)" section. Of the five families in the declaration it prints, only the three CJK ones are required and ordered; `system-ui` and `sans-serif` appear in the suggested replacement and are never checked. |
| `box-height` | A solid content box too short (error) for the number of baselines it holds at their largest font size, and two adjacent baselines **of the same font size** spaced off font-size × 1.5 (warning). Two adjacent baselines of different font sizes have no recommended spacing and are not compared. | "Box heights sufficient (one line ≥ font-size × 3)", plus the "Box dimensions" section, which is where the font-size × 1.5 line height comes from |
| `baseline-offset` | In a solid content box that is not a panel: a single baseline off the box's optical centre, a multi-line block's midpoint off it, a label not resolving to `text-anchor="middle"` (the one error of the four), and a middle-anchored label sitting off its box's centre x. A box holding more than one line gets the block-midpoint finding and never the single-baseline one. | "Labels centered (`text-anchor="middle"`)", plus the "Vertically centering text in a box (baseline positioning)" section, whose formula this implements |
| `block-spacing` | For each solid content box, the gap to the nearest solid box to its right that overlaps it vertically, and to the nearest one below that overlaps it horizontally: under 25px is an error, over 30px a warning, and a pair yields at most one of the two. The two thresholds do not consult the same neighbour. Crowding is measured against the nearest box in any container, because crossing a container wall can only add distance, so a gap already under 25px is real wherever it is found. Looseness is measured only against the nearest box sharing the same container — a solid panel or a dashed grouping box counts as one — because a box inside one card otherwise reads as 81px from the box inside the next, a number no edit to either box can change. A vertical pair is dropped as well when a third box lies in the band between them, and that test reads the y axis only (`lib/checks/block-spacing.mjs`): the third box qualifies when its whole height falls between the pair's facing edges, however far to the side it sits. Boxes grouped into one row differing in width or height by more than 60px (warning); a box tall enough to span two rows is kept out of that grouping, and so is a panel. A title whose centre sits more than 2px off the centre of every box, path and shape drawn, the text and the background rect excluded (warning). | "Block spacing ≥25px (25–30px recommended …)"; "Title centered, boxes in a row similar in size" |
| `arrow-marker` | A marker missing `markerUnits` or `orient`, a width outside the 8 / 12 / 16 table, a non-square marker, `refX`/`refY` mismatches, a dangling `marker-*` reference, a marker too small for its stroke width, and clearance other than 5px (±1) at either end. Three of those are narrower than they read. An off-table width is reported on its own and replaces the square, `refX` and `refY` comparisons for that marker, which are only made once the width is one of the three (`markerUnits` and `orient` are checked either way); an absent `markerWidth` takes the same code with different wording, "does not declare markerWidth", since `null` is not a number to quote back. "Too small for its stroke" says nothing when `stroke-width` is not a number — `stroke-width="3px"` is valid SVG that the model reads as NaN, no size tier matches it, and `document-model/non-numeric-attribute` is the only finding on it — and nothing when `markerWidth` is absent, there being no width to compare. Clearance passes three gates before anything is measured: the path carries a `marker-end` that resolves to a defined marker, that marker's width is in the table, and no command in the path is one the parser does not model. Each end then needs a direction (the start needs a flattened point that differs from the first; the tip needs a segment carrying a tangent at its end) and a measured distance of 40px or less. Three things can produce that distance, and only the last of them consults the direction of travel: an end point lying inside a solid content box that is not a panel measures 0 whichever way the line travels, a point resting exactly on the wall of a dashed grouping box or a solid panel measures 0 the same way, and otherwise the distance is to the nearest box the point is travelling toward. Everything else gets no clearance finding — a `marker-start`-only path, a dangling reference, an off-table or absent width, a zero-length path, a path carrying an unmodelled command, and a box that sits to the side of the travel. The tip end is measured from the painted tip rather than the path's last point: that point is advanced 6, 9 or 12px along the end tangent for an 8, 12 or 16px marker. | "Symmetric arrow clearance at both ends (5px) …" — the item continues "visible line segment ≥6px", which is `connector-geometry`'s clause, not this check's; "Markers declare `markerUnits="userSpaceOnUse"`"; "Thick lines (stroke-width > 1.5) use the enlarged marker" |
| `text-overflow` | Three shapes: a label too wide for its box, a label that fits its box but whose left or right edge sits past the 2px inner padding line — the module treats those two as different problems and writes a different repair for each — and a free-standing label left with 10px or less of clearance to the nearest solid content box that overlaps it vertically. The guide asks for "text right edge + 10px < left edge of the neighbor", a strict inequality, so exactly 10px is reported and 10.5px is clean. Left and right are measured separately against their own nearest box, so one label can draw two of these. Every one of them is an error. The 2px inner padding and the 10px neighbour clearance are different rules for different situations — a box's own label against its own inner edge, versus a free-standing label against a box it does not belong to — so a box needs 2px of slack around its label, not 10. A label inside a box is never measured against a neighbour, and a gap already gone negative is `overlap`'s to report, not this check's. | "No text right edge intrudes on a neighbor (estimated from character widths)", plus the "Estimating text width (overflow protection)" section |
| `overlap` | Seven findings, three errors and four warnings. Errors: a label whose box overlaps a solid content box it does not belong to, a label a connector runs through, and a connector that crosses into a solid content box with neither endpoint inside it. "Crosses into" is measured against the box inset by a flat 1px — not by the rect's own stroke width — so a connector resting exactly on a wall is not entering — it falls to the detour arm below and is reported there at 0px, the same code it gets half a pixel out, which is what keeps one rule judging a grazing line at every offset. Warnings: a label under 10px from a straight connector or under 15px from a curved one, a connector passing under 20px from a solid content box that neither endpoint is within 20px of, and a label whose glyph box lies across the outline of a dashed grouping box. That last one judges the four edges as bands one stroke wide, never the interior: text belongs inside a container, so a group title or a member label inset from the wall is clean, and so is anything inside a nested inner group. A label inside a box is measured for clearance only where a subpath crosses that box's wall; a label whose centre is inside a panel is not reported against the panel. | "No overlapping elements (text, boxes, lines)" — of the pairings that item names, text-over-box, text-over-line and line-over-box are the ones checked here, and box-over-box is checked nowhere (see Known limits); the grouping-box outline is judged under the same item, since a label lying on the dashed line overlaps something drawn; "≥15px between a curve label and the nearest point on the curve"; "Detour paths stay outside obstacles" |
| `light-bg-fallback` | A label with none of four shields behind it, whose fill — **written as a 3- or 6-digit hex** — contrasts under 4.5:1 with the GitHub dark canvas `#0d1117`. A warning. The shields, any one of which is enough: the label's own box is painted; some painted solid content box covers the whole glyph box; some painted dashed grouping box covers it; or a painted `<circle>`, `<ellipse>`, `<polygon>` or `<polyline>` covers it. Covering means all four edges of the glyph box are inside, so a label running past the paint is not shielded. A painted `<line>` is not a shield — a line's fill paints nothing. Two exits come before all of that: a painted background rect stands in for every glyph in the file, and a file with no `<text>` is left alone. A fill the module cannot read as hex gets no finding either: `fill="black"` and `fill="rgb(0,0,0)"` produce nothing where `fill="#000000"` reports 1.11:1. Paint of any colour counts, so a dark full-canvas rect exempts the file — a false negative the check records rather than guesses at. | No checklist item. It is the machine-checkable half of a project decision: dark-theme readability comes from a light background rect, not from dual theming. |
| `palette-conformance` | All four findings are warnings. A `fill` or `stroke` outside the house palette on a `<rect>`, `<text>`, `<path>` or `<marker>` — those four element kinds are the whole scan, so `<line>`, `<circle>`, `<ellipse>`, `<polygon>` and `<polyline>` are never colour-checked. Colours are read from presentation attributes and inheritance only; a `fill` declared in a `<style>` rule is invisible here, because the model parses `font-family` and nothing else out of CSS. On a solid content box, a semantic fill paired with the wrong stroke or label colour. And a dashed grouping box whose `stroke-dasharray`, `rx` or `fill` differs from the commonest value among the diagram's grouping boxes, the earliest box winning a tie — so with exactly two boxes that disagree it is always the second one that is reported. Of the five properties the checklist item lists, those three are the ones compared: padding and title font size are not. | The "Colors" section (base text colours, the five semantic triples) — the set compared against is that section plus the six arrowhead colours, the dashed grouping box's own fill and stroke, `none` and `#ffffff`; "Dashed grouping boxes styled consistently (dasharray, corner radius, fill, padding, title font size)" |
| `connector-geometry` | Only a `<path>` whose effective `fill` resolves to `none` — that is how the tool decides a path is a connector. The same 90° elbow is silent with no `fill` attribute (an undeclared fill resolves to black) and an error with `fill="none"`. On such a path, five errors: a subpath shorter than 6px, a straight `L` running diagonally, a turn of 60° or more between two segments that meet, and — only when the path carries `marker-end` and its last modelled segment is a `C` or `Q` whose start-to-end chord is longer than half a pixel — a second control point that would aim the arrowhead back along the connector, or, **only where that chord is axis-aligned**, one that would aim it off the axis. Both perpendicular arms are gated on the chord not being diagonal, so a diagonal chord is judged for direction agreement alone; that is the tool's largest deliberate blind spot and it has its own Known limits entry. The fifth error, `self-return-tangent-parallel`, is the self-message arm. Like the two above it, it needs the path to carry `marker-end` and its last modelled segment to be a `C` or `Q`; unlike them it does not need a chord longer than half a pixel, because it takes its axis from elsewhere. It claims such a curve when the point its **subpath began at** — not the last curve's start, which on a two-curve self-message is the apex of the bulge — and its end both lie within 12px of one straight dashed line, level with the stretch that line covers. That line is a sequence diagram's lifeline, recognised as a `<path>` or a `<line>` with no `marker-start` or `marker-end` of its own (lifelines carry no arrowhead) whose bounding box has no width or no height, and whose own `stroke-dasharray` renders dashed — `none`, blank, `0`, `0,0` and any list with a negative length all draw solid and are not lifelines; a dasharray inherited from a `<g>`, or one written with units (`4px`), is not seen either. The 12px band is not slack: the house rule holds a message's start 5px clear of the lifeline and ends its line at lifeline + 11, which is where the 6px the arrowhead adds puts the painted tip 5px clear, so a correctly drawn self-call never touches the line it returns to, and a rule wanting the endpoints *on* the line would guard only self-calls drawn wrong. The other condition is that nothing the arrowhead could have arrived at lies within 20px of the end point *while being nearer that end point than the point the subpath began at* — something the curve is no closer to at its tip than at the place it set out from is something it ran alongside, not something it arrived at, which is what an activation bar straddling its own lifeline looks like: equidistant from both ends, or 0px from both where the message is drawn inside it. The two distances are compared rather than each held against the radius, and equality falls on the not-an-arrival side. A flat 20px on both ends was wrong in the reporting direction: at the house minimum block spacing of 25px a connector leaves its source 5px clear and its line ends 11px short of its destination, which puts that destination exactly 20px from the start as well, so no box qualified and a correct downward arrow drawn beside a dashed line was reported. What the comparison costs in the other direction is a silence with its own Known limits entry: an activation bar opened at the message start is nearer the tip than the start, so it reads as a destination and this arm stands down on a genuine defect. The things it can arrive at are the solid content boxes plus any `<circle>`, `<ellipse>`, `<polygon>` or `<polyline>` with an area; a `<line>` has none, and admitting it would make every lifeline the target of the message being judged. A rect with no width or no height is filtered the same way and for the same reason — it paints what that line paints. One further exit, and it withdraws more than this arm: a single **solid content rect** in the file whose geometry the model cannot read (`width="180px"`) stops **both** arrowhead judgments for every connector in that file, this one and `curve-tangent-not-aligned` — a dashed grouping rect withdraws nothing, and a rect missing `width` outright is read as 0 and dropped for having no area rather than triggering this. Withdrawing only the lifeline was worse than withdrawing nothing — it handed a correct self-return to the chord arm, which asks cp2 to match a chord that runs along the lifeline and so quoted `408 → 368`, the defect itself, as the repair. Silence is affordable there because the file still carries `document-model/non-numeric-attribute` and cannot pass as clean. An unreadable **shape** is treated the other way round — not an arrival target, and no silence — because `NUMERIC_ATTRS` covers a rect's width and height but not a circle's `r`, so `r="19px"` draws no note anywhere and a file carrying it lints 0/0: silence there would hide a real defect behind nothing at all. That trade buys an invisible false positive in exchange, since an arrow that legitimately stops short of such a circle is now read as a self-message with nothing to explain it; both halves have Known limits entries. Widening `NUMERIC_ATTRS` to cover shape attributes would remove the asymmetry and is left for its own change, since every check reads that list. For such a curve the axis comes from the lifeline rather than from the chord, and the closing tangent has to cross it: a tangent running along the lifeline is the error, because an arrowhead pointing down a lifeline names no participant. The receipt quotes how far the tangent crosses the lifeline against the half-pixel tolerance (`0` against `> 0.5`) rather than cp2's coordinate, so that a cp2 a third of a pixel off the endpoint — a defect whose coordinate already differs from the endpoint's — still gets an expected it fails. That replaces only the perpendicular arm above, which reaches the opposite verdict on this shape — the chord of a self-return lies along the lifeline, so asking cp2 to match it asks for the defect, and a correct self-return closing across the lifeline was being reported. The past-the-tip arm still applies, measured along the lifeline. The discriminator is the document and not the `d`, deliberately: an obstacle detour has the same chord, the same off-axis bulge and the same tangent along the axis, and is correct — the box at the end point is the only thing that tells the two apart. A dashed grouping box is not such a box, since a message drawn inside an `alt` frame is inside it rather than arriving at it. | "Connectors use C/Q curves, no right angles"; the "visible line segment ≥6px" clause of "Symmetric arrow clearance at both ends (5px), visible line segment ≥6px" — the clearance clause of that item is `arrow-marker`'s |

### Three exemptions shared by the rows above

Silence from a check is not always a pass. Three shapes are exempt in more than one row, so they
are stated once here rather than repeated.

- **Dashed grouping boxes.** The model keeps them out of the solid-content-box list, so a dashed box
  is never height-checked, is never one of the pair a spacing gap is measured between, and never
  binds a label as its own — and a connector may run straight through one with nothing reported.
  Eight judgments do read them, and this is the whole list, derived by grepping the model's dashed-box
  list across `lib/`:
  - `palette-conformance` compares their `stroke-dasharray`, `rx` and fill against each other.
  - `arrow-marker` counts them as enclosures for endpoint clearance: being strictly inside one is
    normal and unmeasured, resting exactly on the wall is 0px.
  - `block-spacing` measures the content centre a title is judged against across dashed boxes,
    connectors and plain shapes as well as solid boxes.
  - `block-spacing` also treats one as a container, so it ends an adjacency: two boxes in different
    groups are not compared for the over-wide gap. A gap already under 25px is still an error
    wherever it is found, because crossing a wall can only add distance.
  - `overlap` reports a label lying across the outline.
  - `light-bg-fallback` counts a *painted* dashed box as paint behind the glyphs it fully covers, so
    a group name on a filled group box draws no dark-canvas warning.
  - `lib/panels.mjs` counts a dashed box that holds something as inner content, which makes the
    solid box enclosing it a panel — and that changes the five judgments listed under Panels below.
  - The model strikes a text whose centre falls inside a dashed box from the title election, so a
    group name never stands for the diagram's title.

  Two of the eight can fault a dashed box's **edge**, and neither faults its interior. The outline
  judgment reports a label whose glyph box lies across one of the four edges, each taken as a band one
  stroke wide — that one really does read the rect's own `stroke-width`. And `arrow-marker` measures an
  arrow's clearance to the wall: a **painted tip** landing on it scores 0px and is reported as
  `arrow-tip-clearance`. Measured on a dashed box spanning x=30..170 with an 8px marker, whose tip sits
  6px past the path's end point: an end at x=36 puts the tip on the wall and reports `0` against an
  expected `5`, while an end at x=41 — tip 5px inside — and one at x=30 — tip 6px outside — are both
  silent. A dashed box's interior is where its own title and its members'
  labels belong, so nothing anywhere treats the interior as occupied.
- **Panels.** A solid box that encloses other diagram content is a panel (`lib/panels.mjs`). Five
  judgments read that determination, and the exemption is a different shape in each, because
  `panels.mjs` answers only "what counts as a panel" and each consumer decides who is exempt:
  `baseline-offset` makes none of its four judgments about a panel's own text; `overlap` does not
  report a label whose centre lies inside a panel as overlapping it, while a caption drawn outside
  the panel that genuinely crosses its edge is still reported; `box-height` exempts a panel from the
  line-height rule only, and still measures its height against the font-size formula; `block-spacing`
  keeps panels out of the row-size comparison and treats them as containers that end an adjacency;
  and `arrow-marker` groups them with the dashed grouping boxes, so an endpoint strictly inside a
  panel is normal rather than 0px. The criterion is wide — "encloses a labelled box" — so an ordinary
  box carrying a small badge in its corner qualifies. That is why `box-height` narrows its exemption
  to one rule, and it is a recorded cost elsewhere: a badge-bearing box leaves the row-size
  comparison, so a size mismatch in its row can be missed.
- **Two labels on one baseline in the same box.** House style sets their x against the two sides of
  the box, so `baseline-offset` checks neither their anchor nor their centre x, and `box-height`
  counts them as a single line.

### The `document-model` findings, which belong to no check

A report can also carry the id `document-model`, which is not one of the twelve: it is how the parser
and the model builder name the parts of a file they could not model. Its warnings are `unsupported-transform`, `non-numeric-attribute`,
`missing-geometry-attribute`, `missing-font-size` and `unsupported-path-command`. If building the model
throws, the file gets one `document-model/model-crashed` error and no other finding, because no check
ran on it. A check that throws is reported as `check-crashed` under that check's own id, not under
`document-model`, and as an error rather than a warning, so a missing conclusion cannot leave the exit
code at 0.

## Known limits

Most entries here are silence a reader could otherwise take for a pass; some run the other way and
report a drawing that is correct. They are not all the same kind, and each one says which it is: some
are scope decisions with the reasoning kept beside them, some are limits inherited from how the model
reads a file, and the last is a gap that nothing enforces and nobody chose.

- **`parsePath` does not model `A`, `S` or `T`.** A path using one is reported as a
  `document-model/unsupported-path-command` warning naming the command; the command is collapsed to
  zero length, so the point array is not the path on screen. The three geometry checks then decline
  different amounts, and none of them judges the collapsed coordinates:
  - `overlap` measures nothing against that path — no label clearance, no crossing, no detour
    distance. Its labels are still checked against boxes.
  - `arrow-marker` measures neither end clearance on it. Its attribute judgments — `markerUnits`,
    `orient`, the size table, `refX`/`refY`, a dangling reference, the size against the stroke width
    — read attributes rather than geometry and still run.
  - `connector-geometry` drops the unmodelled segments and judges what is left, so a diagonal `L`
    in the same `d` is still reported.
- **A multi-line label written with `<tspan>` is measured as one long line.** A limit inherited from
  how the model reads text, not a decision, and not scheduled: the checks that suffer from it have
  behaved this way since they were written. The model joins a `<text>` element's `tspan` children into
  one string and estimates a glyph box from it, one line tall and as wide as the two lines
  concatenated. A correctly centred two-line label in a box it fits draws **two** findings, not one:
  the width is priced as a single line, so `text-overflow/text-overflows-box` reports it, and the same
  single-line assumption makes `baseline-offset/baseline-off-center` demand the one-line baseline
  instead of accepting a centred two-line block. Reproducible: put `Delivery date` and `is next month`
  in a 120×54 box, first as one `<text>` with a `tspan` per line, then as two `<text>` elements. Each
  line is 13 characters — 91px at font-size 12, inside the 116px a 120px box leaves after its inner
  padding — so neither overflows on its own. The two `<text>` version reports nothing. The `tspan`
  version reports `text-overflow/text-overflows-box`, "Label needs 182px but its box is only 120px
  wide", 182px being all 26 characters run together at 7px each, plus the baseline finding.
  `overlap` inherits the same glyph box and can report the label against a box, a connector
  or a dashed grouping box's outline that it is nowhere near.

  **The working pattern is to put each line in its own `<text>` element.** That is measured correctly,
  and it is what every diagram in the gallery does. No check compensates for `tspan` locally, because
  the joining happens in the model and a local patch in one check would leave the others disagreeing
  about the same label.
- **A dashed grouping box's rounded corners are modelled as square.** A scope decision.
  `overlap/text-on-group-wall` judges each wall as a band half a stroke either side of a straight edge
  run at full length, while house style gives a grouping box an `rx` of 8 to 12, so within `rx` of a
  corner the drawn line has already curved away from the modelled edge. It errs both ways, and
  silence is the easier of the two to hit. Measured: box `x="120" y="56" width="180" height="60"
  rx="12"`, label `wall` at font-size 10 with `x="121" y="64.5"`, glyph box x 121..143 by y 57..67,
  draws no finding — yet the corner arc passes through that box, at x=127.2 where y=57 and x=123.1
  where y=60. Move the same label 2px left to `x="119"` and it is reported, so the silence is the
  corner and not the fixture. The opposite direction is reachable too, but only just. The modelled
  corner itself lies `rx × (√2 − 1)` from the nearest paint — 4.97px at `rx="12"` — yet a finding
  needs the glyph box to reach the band, half a pixel wide, and the arc is back at x≈120.1 by the
  bottom of a font-size 10 glyph box. Measured on the same box: `wall` at `x="98" y="64"`, glyph box
  x 98..120 by y 56.5..66.5, is reported as on the left wall and told to move 0.5px left, while the
  leftmost paint over that y range is x=120.094 — so the finding is wrong, by 0.09px. Widening that
  wedge needs a glyph box short enough to sit inside the arc stretch, and a font-size 10 box is 10px
  tall against an `rx` of 8 to 12. Following the arc would give every wall two arcs and a shortened
  straight span to buy a fraction of a pixel at four corners.
- **The arrowhead tip direction is wrong when the last control point sits within half a pixel of
  the end point.** `arrow-marker` takes the tip direction from `directionAtEnd`, whose half-pixel
  coincidence tolerance is set for corner measurement: inside it the tangent is taken from the
  previous control point instead, which for a curve that whips into its endpoint points sideways
  and lands the tip somewhere it was not drawn. A gap of 0.6px between cp2 and the end point
  measures the clearance exactly; 0.5px reports it several pixels out. Tightening the tolerance
  would change what `connector-geometry` calls a corner, so the two questions want different
  epsilons and only the corner one has a value chosen for it.
- **A single `C` or `Q` bend is not judged for a right angle inside itself.** The corner rule compares
  one segment's tangent where it arrives against the next segment's where it leaves, so a path with
  only one curved segment has no join to measure. A single `C` drawn as a visual right angle passes.
- **On a connector whose chord runs diagonally, only the direction agreement is judged, never the
  perpendicular component.** A scope decision, and the largest one the tool makes. With both
  components of the start-to-end chord non-zero there is no axis for the perpendicular component to be
  zero in, so the arm that catches a skewed arrowhead never runs. What that costs is specific enough to
  name: the guide's cp2 table exists to separate `M100,100 C 100,200 250,200 300,250`, which it marks
  non-conforming, from `M100,100 C 100,200 300,220 300,250`, which it marks conforming — and both of
  those chords run 200px across by 150px down, so both are exempt and the tool prints zero connector
  findings for each. The pair the guide draws its distinction with produces byte-identical output. The
  exemption is kept anyway: the guide's own conforming detour example
  `M600,313 Q 650,313 650,400 Q 650,640 635,685` ends on a chord 15px off vertical with a cp2 15px off
  the endpoint x, so tightening the rule would report a diagram the guide presents as correct, which is
  worse than the current silence.
- **The defect the self-message rule exists for goes unreported beside an activation bar that opens
  where the message starts.** A scope decision. `self-return-tangent-parallel` needs the curve to have
  arrived at nothing, and something counts as arrived at when it lies within 20px of the tip *and*
  nearer the tip than the point the curve set out from. That comparison is what stops a bar the
  message is drawn inside from counting, and what keeps a correct connector between two boxes at the
  25px minimum spacing from being reported — but a bar opened at the message start, or a nested bar
  opened where the message lands, is not equidistant from the two ends. It is nearer the tip, so it
  reads as a destination and the arm stands down. Measured, on a dashed lifeline at x=368 with the
  shape gallery/03 shipped with, `d="M368,250 C 408,255 368,290 368,300"`: against
  `<rect x="362" y="240" width="12" height="80"/>`, a bar straddling both endpoints, the defect is
  reported; against the same bar at `y="255"`, or a nested `<rect x="362" y="300" width="12"
  height="60"/>`, it is not. The arrowhead points straight down the lifeline in all three.

  The file is not silent overall, which is the one thing that keeps this from being the worst entry
  here: a bar sits on its own lifeline, so `overlap/line-cuts-box` reports the lifeline running through
  it and `arrow-marker/arrow-tip-clearance` reports the tip, and neither of those names the arrowhead
  angle. A sequence diagram with activation bars does not lint clean today for reasons of its own; what
  is missing is the finding that would tell the author the head points the wrong way.

  **The working pattern is to draw a self-call the way gallery/03 does** — start 5px clear of the
  lifeline, end the line at lifeline + 11, cp2 level with the endpoint — because beside a bar nothing
  will remind you. Narrowing the silence means telling a 12px activation bar from a 200px destination
  box, and the only feature that separates them is width, which the guide gives no number for; a
  threshold invented here would start reporting correct diagrams whose boxes happen to be narrow.
- **An arrow that legitimately stops short of a shape whose size carries a unit is reported as a
  self-message, and nothing in the output says why.** A scope decision, and the one that reports with
  no explanation attached. `NUMERIC_ATTRS` in `lib/document.mjs` covers a rect's `width` and `height`
  but not a circle's `r`, so `r="19px"` is read as NaN and draws no `document-model` note of its own.
  The shape is then not in the arrival set — a connector can never be said to have arrived at it — so a
  correct arrow that stops the house 11px short of such a circle beside a lifeline is read as an
  arrowhead pointing down that lifeline. Reproducible: replace `r="19"` with `r="19px"` on
  `<circle cx="368" cy="330" r="19"/>` in a file whose connector is `M368,250 C 408,255 368,290
  368,300`; the finding appears, and no `document-model` note appears beside it. The opposite stance was
  worse: treating such a shape as an arrival silenced a real defect beside it, in a file that lints 0
  errors and 0 warnings, so nothing anywhere pointed at the cause.

  **The working pattern is to write shape sizes as plain numbers** — `r="19"` — which is what every
  diagram in the gallery does and what the guide's own snippets show. The real repair is to widen
  `NUMERIC_ATTRS` to cover `r`, `cx`, `cy`, `rx`, `ry` and `points`, which would give this file a note
  of its own the way an unreadable rect gets one; that touches every check that reads the list and is
  left for its own change.
- **A single solid box whose size carries a unit switches off both arrowhead judgments for every
  connector in the file.** A scope decision, and the widest withdrawal the tool makes. `width="180px"`
  reads as NaN, so no box in that file can be placed, no arrival can be ruled in or out, and both
  `self-return-tangent-parallel` and `curve-tangent-not-aligned` decline for every connector — not only
  the one near the box. Withdrawing less was tried and was worse: dropping only the lifeline handed a
  correct self-return to the chord arm, which asks cp2 to match a chord that runs along the lifeline,
  and quoted `408 → 368` as the repair — the defect this check exists to catch, printed as an
  instruction. What makes the silence affordable is that the file still carries
  `document-model/non-numeric-attribute`, so it cannot pass as clean while the unit is there.
  Reproducible: add `<rect x="268" y="320" width="180px" height="36"/>` to any file and every arrowhead
  angle in it stops being judged.

  **The working pattern is to fix the flagged attribute first**, then re-run: the arrowhead judgments
  come back with it. A dashed grouping rect with a unit does not trigger this, and neither does a rect
  missing `width` altogether — that is read as 0 and dropped for having no area.
- **A curve whose tip stops on a dashed grouping box's wall is reported as a self-message when it also
  runs along a lifeline.** A scope decision, with its reasoning kept beside it at
  `lib/checks/connector-geometry.mjs:188`. The things an arrowhead may arrive at are the solid content
  boxes and the area shapes, which is the set every other geometry check measures against; a dashed
  grouping box is deliberately not among them, because a message drawn inside an `alt` frame measures 0
  against the frame it is inside, so admitting the frame would leave every self-message drawn inside one
  unjudged — the shape this rule exists for. The cost is that a detour whose tip stops at the frame's
  wall has nothing recorded as arrived at, and if both its endpoints also lie within 12px of a lifeline
  the finding fires on a curve whose cp2 sits exactly where the cp2 table puts it. Reproducible:
  lifeline `<path d="M368,176 L 368,330" stroke-dasharray="4,4"/>`, frame
  `<rect x="200" y="300" width="380" height="80" rx="8" fill="none" stroke-dasharray="6,4"/>`, and the
  detour `d="M368,181 C 340,215 320,250 325,270 C 330,282 368,272 368,289"` with a `marker-end`, its
  tip stopping 11px above the wall at y=300. One error, nothing else.

  **The working pattern is to land the arrow on a box inside the frame rather than on the frame's
  outline**, which is what every arrow in the gallery's sequence diagram does. An arrowhead that stops
  on a container's wall names no participant, so the finding is arguable here rather than plainly wrong.
- **A character whose East Asian Width is *ambiguous* is priced as Latin.** A scope decision, and the
  one whose cost is hardest to see, because the error runs in the direction that hides findings. The
  width table's CJK test starts at U+2E80, so everything below it — box-drawing characters, geometric
  shapes, enclosed alphanumerics — is charged the Latin width even where a renderer draws it
  full-width. Measured: `□□□□`, four U+25A1, estimates 28px at font-size 12, exactly what four Latin
  letters cost, while the table's own CJK column charges 48px for four full-width characters at that
  size. The estimate is 42% short, and short means silent: `text-overflow` will accept a label that
  visibly overflows its box and print nothing. Widening the table here was considered and rejected. The
  table is transcribed from `SKILL.md`, which is frozen and carries no ambiguous-width row,
  so adding ranges would make the tool and the published guide disagree about how a width is
  estimated — an author following the guide would compute one number and be judged against another. A
  diagram that uses ambiguous-width characters should be sized from a render rather than from the
  estimate. The astral-plane range in the same function is a different case, and the comment there says
  so: those characters are unambiguously full-width, so leaving *them* out would be a wrong answer
  rather than a disclosed gap.
- **Box-over-box overlap is checked by nothing.** This one is the gap: no reasoning was recorded for
  leaving it out, and nothing enforces it. The checklist item `overlap` cites names text, boxes and
  lines, but `overlap` compares text against boxes and connectors against boxes, never a box against a
  box, and `block-spacing` drops the pair because their directional gap is null once they overlap.
  Measured: two solid content boxes overlapping by 50×30px, with no labels, draw no finding from any of
  the twelve checks and the tool exits 0. Pull the same two boxes 10px apart and `block-spacing`
  reports `spacing-too-small`, so the silence is the overlap and not the fixture.

  What can betray the overlap is a **label**, and only by accident. Give each of those two boxes its own
  centred label and `overlap/text-over-box` fires twice, because each label now sits inside the other
  box — the boxes are still not being compared, their contents are. Move the labels to the far side of
  each box so neither lands in the other and the diagram goes quiet again with the boxes overlapping
  exactly as before. So a real diagram with stacked labelled boxes will often report *something*, which
  makes the gap easy to miss: the finding you get names a label, and fixing the label leaves the
  stacking in place.
