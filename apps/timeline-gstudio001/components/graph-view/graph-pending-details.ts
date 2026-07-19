import type { CollectionsPatch } from "@storyboard/ui/dnd-collections";
import type { ClipDetail } from "@storyboard/timeline-domain";

// App-side details for nodes created OUTSIDE React state — a palette drag's
// factory (runs inside dnd-kit's drag start) and the native drop layer
// (sidebar tools, OS file drops) both mint nodes imperatively and park the
// node's app-only fields here. The PersistenceBridge claims parked entries
// when the add COMMITS — before the first write, so poster/aspect/hydrated
// round-trip into the stored clip.

const pendingDetails = new Map<string, ClipDetail>();

/** Park a freshly minted node's detail until its add-nodes commit claims it. */
export function parkPendingDetail(id: string, detail: ClipDetail): void {
  pendingDetails.set(id, detail);
}

/** Drop everything parked — a drag start clears leftovers from a CANCELLED
 *  or rejected drag (its minted ids can never be referenced again). */
export function clearPendingDetails(): void {
  pendingDetails.clear();
}

/** Drop one parked entry whose add was REFUSED, so the node it described
 *  can never exist. Targeted twin of `clearPendingDetails` for the
 *  imperative paths that park before dispatching. */
export function unparkPendingDetail(id: string): void {
  pendingDetails.delete(id);
}

/** Claim parked metadata for every node an add-nodes patch committed. */
export function claimPendingPaletteDetails(
  patch: CollectionsPatch,
): Record<string, ClipDetail> | null {
  if (patch.type !== "nodes-added") return null;

  let claimed: Record<string, ClipDetail> | null = null;
  for (const add of patch.adds) {
    const id = add.node.id as string;
    const detail = pendingDetails.get(id);
    if (!detail) continue;
    (claimed ??= {})[id] = detail;
    pendingDetails.delete(id);
  }
  return claimed;
}
