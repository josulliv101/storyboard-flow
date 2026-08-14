/**
 * Where a card's item actually LIVES, when that is not the timeline on screen.
 *
 * Extracted from `useCardProvenance` in `graph-item-content.tsx` (#281). The
 * hook keeps the three store subscriptions; this owns the decision, which is
 * the part with rules — and the part the app's vitest could not reach while it
 * sat in a `.tsx` file.
 */

/**
 * The label for a card whose parent is not the focused collection, or null
 * when no label belongs there.
 *
 * NO MODE FLAG, deliberately. In the ordinary nested strip every card's parent
 * IS the focused collection, so the comparison is false by construction and
 * the label never appears. In a flat run the cards drawn from nested
 * collections differ, and exactly those get one. Direct children of the
 * focused timeline stay unlabelled in both readings, which is right — their
 * collection is the one being looked at.
 *
 * THE NAME'S RESOLUTION ORDER IS LOAD-BEARING: the stored document title wins
 * over the graph node's name, because the document is the source of truth and
 * the node is the optimistic fallback until it loads. Reversing them means a
 * renamed collection keeps its old name here while the breadcrumb and the card
 * show the new one. The id is the last resort, so a row can never print
 * nothing at all.
 */
export function resolveCardProvenance({
  parentId,
  focusedId,
  title,
  nodeName,
}: Readonly<{
  parentId: string | null;
  focusedId: string | null;
  title: string | null;
  nodeName: string | null;
}>): Readonly<{ parentId: string; name: string }> | null {
  if (parentId === null || focusedId === null) return null;
  // A root card has no parent to name; a card whose parent is on screen needs
  // no pointer to it.
  if (parentId === focusedId) return null;
  return { parentId, name: title ?? nodeName ?? parentId };
}
