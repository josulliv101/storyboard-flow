// Discarding bin entries has to cooperate with the graph's own writer, or it
// loses to it.
//
// Both are FULL-DOCUMENT writers of the trash document: the graph derives it
// from its trash root's children, and `POST /api/trash` rewrites it from the
// stored copy. The graph's writer is debounced (`SAVE_DEBOUNCE_MS`), so a
// discard sent the instant a restore succeeds reads the document, drops the
// duplicate, saves — and is then overwritten ~900ms later by a batch built
// from a cache that still contains it. The duplicate reappears on the next
// load, which is exactly the bug this exists to prevent.
//
// So: flush the graph's pending write and wait for it to SETTLE, then discard,
// then tell the graph to rebuild. Ordering is the whole fix — with the graph's
// write already on the server, the discard reads the current document and
// nothing is queued behind it to clobber the result.

import { announceGraphTrashEmptied } from "@/lib/graph-view-events";

/** The slice of the documents gateway this needs. Named structurally so tests
 *  can drive the ordering without the real gateway (and its IO). */
export type PendingWriteGateway = Readonly<{
  hasPendingWrite: (timelineId: string) => boolean;
  flushPendingWrites: (options?: { keepalive?: boolean }) => void;
}>;

/** How often to re-check, and how long to wait before giving up and issuing
 *  the discard anyway. Losing the race is recoverable (the entry comes back and
 *  can be discarded again); hanging on a wedged write is not. */
const SETTLE_POLL_MS = 100;
const SETTLE_TIMEOUT_MS = 5000;

/**
 * Resolve once no write for `timelineId` is outstanding.
 *
 * Polls rather than subscribing: the gateway's `subscribe` reports CACHE
 * changes, and a batch settling without changing the cache would never wake a
 * subscriber — a wait that can miss its own wake-up is worse than a cheap
 * 100ms tick over a window this short.
 */
export async function settlePendingWrites(
  timelineId: string,
  gateway: PendingWriteGateway,
  sleep: (ms: number) => Promise<void> = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<void> {
  if (!gateway.hasPendingWrite(timelineId)) return;
  // Don't wait out the debounce window — the batch is ready, send it now.
  gateway.flushPendingWrites();
  for (let waited = 0; waited < SETTLE_TIMEOUT_MS; waited += SETTLE_POLL_MS) {
    if (!gateway.hasPendingWrite(timelineId)) return;
    await sleep(SETTLE_POLL_MS);
  }
}

/**
 * Drop specific entries from the bin without restoring them, safely.
 *
 * Returns whether the server took them. The announce is not optional and is
 * the reason this is one function rather than a bare fetch: a mounted graph
 * view still holds those clips as nodes under its trash root, and would write
 * them straight back on the next commit that touches the trash.
 */
export async function discardTrashClips(
  clipIds: readonly string[],
  trashId: string,
  gateway: PendingWriteGateway,
): Promise<boolean> {
  if (clipIds.length === 0) return false;
  await settlePendingWrites(trashId, gateway);
  try {
    const response = await fetch("/api/trash", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clipIds }),
    });
    if (!response.ok) return false;
    announceGraphTrashEmptied();
    return true;
  } catch {
    // The row is already gone from the drawer's own list; the entries simply
    // stay in the bin and can be discarded again. Nothing to say here that the
    // next open of the drawer won't show.
    return false;
  }
}
