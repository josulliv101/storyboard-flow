import type { HistoryEntry } from "@storyboard/ui/dnd-collections";

// The stored form of the undo stack, and the check that stands between
// sessionStorage and the store. Pure and React-free so the trust boundary is
// unit-testable — the bridge that calls it is a `.tsx` component, which this
// app's vitest cannot load.
//
// Validation lives HERE rather than being left to replay, because `undo` asks
// a different question. `verifyPatchApplies` decides whether a WELL-FORMED
// patch still fits the live graph (ids present, parents matching), and to do
// that it walks `patch.moves` / `patch.adds` / … assuming the array is there.
// A stored patch missing its array — an older build's schema, a half-written
// entry, an edited storage key — passes that check's discriminant and throws
// on the `for…of` inside it, taking out the first Undo the user presses. So
// applicability stays with replay, and well-formedness happens at the edge
// where the bytes arrive.

/** Bumped whenever the stored shape changes. A payload written by any other
 *  version is DISCARDED, not migrated: a resumable undo stack is worth much
 *  less than the cost of replaying a misread patch into the graph, and the
 *  window this covers is one browser tab's sitting. */
export const FORMAT_VERSION = 1;

export type StoredPayload = Readonly<{ v: number; entries: readonly HistoryEntry[] }>;

export const serializeEntries = (entries: readonly HistoryEntry[]): string =>
  JSON.stringify({ v: FORMAT_VERSION, entries } satisfies StoredPayload);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/** Every field `applyPatch` writes into the graph indexes. Deliberately not a
 *  full `CollectionItemNode` check: the rest of a node is render data, and the
 *  graph already carries whatever hydration put there. */
const isNode = (value: unknown): boolean =>
  isRecord(value) && typeof value.id === "string" && typeof value.kind === "string";

const isNodeAdd = (value: unknown): boolean =>
  isRecord(value) &&
  isNode(value.node) &&
  typeof value.parentId === "string" &&
  typeof value.index === "number";

const isNodeMove = (value: unknown): boolean =>
  isRecord(value) &&
  typeof value.nodeId === "string" &&
  typeof value.fromParentId === "string" &&
  typeof value.fromIndex === "number" &&
  typeof value.toParentId === "string" &&
  typeof value.toIndex === "number";

const isNodeUpdate = (value: unknown): boolean =>
  isRecord(value) &&
  typeof value.nodeId === "string" &&
  isNode(value.before) &&
  isNode(value.after);

/**
 * The patch union, checked to the depth replay actually dereferences.
 *
 * The discriminant alone is not enough — it is exactly the field that survives
 * a schema change while the payload beside it does not, and every branch of
 * `verifyPatchApplies`/`applyPatch` iterates its own array without looking.
 */
function isPatch(value: unknown): boolean {
  if (!isRecord(value)) return false;
  switch (value.type) {
    case "nodes-added":
      return Array.isArray(value.adds) && value.adds.every(isNodeAdd);
    case "nodes-removed":
      return Array.isArray(value.removals) && value.removals.every(isNodeAdd);
    case "nodes-moved":
      return Array.isArray(value.moves) && value.moves.every(isNodeMove);
    case "nodes-updated":
      return Array.isArray(value.updates) && value.updates.every(isNodeUpdate);
    default:
      return false;
  }
}

/**
 * Structural check at the trust boundary — this came from storage, which the
 * user (or an older build) can have written anything into. Returns the empty
 * stack for anything it will not vouch for, including unparseable JSON.
 *
 * One bad entry discards the WHOLE stack rather than being skipped past. Undo
 * replays in order, so an accepted stack with a hole in it does not describe
 * any sequence of edits that ever happened; refusing the lot puts the user
 * back where they were before this existed, which the app already handles.
 */
export function parseEntries(raw: string): readonly HistoryEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!isRecord(parsed) || parsed.v !== FORMAT_VERSION) return [];
  const entries: unknown = parsed.entries;
  if (!Array.isArray(entries)) return [];
  for (const candidate of entries) {
    if (!isRecord(candidate)) return [];
    // The command rides along for display only (history views name what the
    // user did); replay never dereferences past its presence.
    if (!isRecord(candidate.command) || typeof candidate.command.type !== "string") return [];
    if (typeof candidate.at !== "number") return [];
    if (!isPatch(candidate.patch)) return [];
  }
  return entries as readonly HistoryEntry[];
}
