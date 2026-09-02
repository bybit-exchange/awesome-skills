// tools/svg-lint/lib/panels.mjs
// Determines which boxes are "solid outer boxes (panels)". SKILL.md's phrase "An outer box fully
// encloses the inner boxes" is the house style definition, and several checks need to exempt panels;
// re-evaluating it independently in each check will inevitably drift — when two checks disagree on
// what counts as a panel, the same diagram passes one and is flagged by the other. So the
// determination lives here only.
import { pointInBBox } from './geometry.mjs';

// Geometric containment, not the dashed flag: the dashed-box exemption is applied upstream
// (dashed grouping boxes never bind text), so it cannot reach solid outer boxes.
const encloses = (rect, other) => other !== rect
  && other.width * other.height < rect.width * rect.height
  && other.bbox.minX >= rect.bbox.minX && other.bbox.maxX <= rect.bbox.maxX
  && other.bbox.minY >= rect.bbox.minY && other.bbox.maxY <= rect.bbox.maxY;

// What counts as "inner diagram content". If purely geometric containment were used, placing a
// decorative colour block or an accent bar inside a card would turn the whole card into a panel,
// suppressing every finding about its own misaligned labels — exactly the kind of box that is
// most often drawn incorrectly.
// So only two categories of candidates qualify: solid content boxes that have text, and dashed grouping
// boxes that hold something. Dashed grouping boxes are listed separately because upstream they bind
// no text of their own — their group name is bound to the enclosing solid content box instead, so looking at
// `texts` alone cannot identify them as panels.
// Both categories require the same threshold (the box must actually hold something), otherwise an
// **empty** small dashed placeholder inside a card would again exempt the whole card — the same
// problem as the decorative colour block above.
// "Holds something" means: the centre of some text falls inside the box (group name written inside),
// or the box encloses some solid content box (the primary purpose of a dashed grouping box).
const holdsContent = (group, doc) => doc.texts.some((t) => pointInBBox(t.center, group.bbox))
  || doc.contentRects.some((r) => encloses(group, r));

const innerContentOf = (doc) => [
  ...doc.contentRects.filter((r) => r.texts.length > 0),
  ...doc.groupRects.filter((g) => holdsContent(g, doc)),
];

// Solid content boxes that enclose other diagram content. Returns a Set; callers use `has` to test whether a rect is a panel.
export function panelRects(doc) {
  const inner = innerContentOf(doc);
  return new Set(doc.contentRects.filter((r) => inner.some((o) => encloses(r, o))));
}

// Which container each solid content box sits in: the innermost of `containers` that encloses it, or
// null for a box drawn at the top level. Two boxes with different containers are not neighbours of
// each other — the wall of somebody else's container is not a block one is spaced from — and the
// containment test is the same one panels are identified with, so the two cannot disagree.
// The caller supplies the container list because which kinds of container end an adjacency
// relationship is the caller's judgment; the innermost one wins so that nesting resolves to the
// closest wall rather than to the outermost canvas-sized box. Two containers of exactly equal area
// enclosing the same box are separated by iteration order rather than by geometry — a shape the
// house style does not draw, and either answer groups the box with the same siblings, because
// equal-area containers enclosing each other's contents enclose each other's members too.
export function enclosingContainers(doc, containers) {
  const area = (r) => r.width * r.height;
  const map = new Map();
  for (const rect of doc.contentRects) {
    let best = null;
    for (const c of containers) {
      if (!encloses(c, rect)) continue;
      if (best === null || area(c) < area(best)) best = c;
    }
    map.set(rect, best);
  }
  return map;
}
