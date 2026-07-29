"use client";

import { useEffect, useRef } from "react";

import { useCollectionsStore, type HistoryEntry } from "@storyboard/ui/dnd-collections";

// Undo that survives a reload (PL11-008).
//
// The app autosaves, and history lived only in memory — so a refresh made
// every committed mistake permanent, with the trash covering deletes and
// nothing covering trims, renames or moves. Patches are serializable by
// design ("this log doubles as a persistence journal", says the history
// module), so the stack can simply be written down.
//
// sessionStorage, not localStorage: a reload is the case this exists for, and
// a stack from days ago — built against a graph the server has since changed
// under other sessions — is a liability rather than a safety net. Same tab,
// same sitting.
//
// Restoring is SAFE without validation here: `undo` verifies each entry
// against the live graph before applying it and drops the unreachable side,
// so a stale entry is refused when reached instead of corrupting anything.

/** Bounded on purpose: sessionStorage is a few MB per origin, and a
 *  `nodes-added` patch carries whole node specs. Fifty steps back is far more
 *  than anyone walks, and the oldest are the least valuable. */
const MAX_ENTRIES = 50;
/** A ceiling in case fifty entries are unusually fat (a big multi-select
 *  move). Writing is best-effort — a full quota must never break editing. */
const MAX_BYTES = 512_000;

const storageKey = (sessionKey: string) => `graph-history:${sessionKey}`;

/** Structural check at the trust boundary — this came from storage, which the
 *  user (or an older build) can have written anything into. */
function parseEntries(raw: string): readonly HistoryEntry[] {
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) return [];
  const entries: HistoryEntry[] = [];
  for (const candidate of parsed) {
    if (typeof candidate !== "object" || candidate === null) continue;
    const entry = candidate as Partial<HistoryEntry>;
    if (typeof entry.command !== "object" || entry.command === null) continue;
    if (typeof entry.patch !== "object" || entry.patch === null) continue;
    if (typeof entry.at !== "number") continue;
    entries.push(entry as HistoryEntry);
  }
  return entries;
}

/**
 * Mount inside the collections provider, keyed to the boot session. Restores
 * once on mount, then mirrors every committed change back to storage.
 */
export function HistoryPersistenceBridge({
  sessionKey,
}: Readonly<{ sessionKey: string }>) {
  const store = useCollectionsStore();
  // Restore exactly once per session, and never re-restore from our own
  // writes: the effect below fires on every commit.
  const restoredRef = useRef(false);

  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    if (typeof window === "undefined") return;
    try {
      const raw = window.sessionStorage.getItem(storageKey(sessionKey));
      if (!raw) return;
      const entries = parseEntries(raw);
      if (entries.length > 0) store.restoreHistory(entries);
    } catch {
      // Unreadable or unparseable: an absent undo stack is the same outcome
      // the user had before this existed, so there is nothing to report.
    }
  }, [store, sessionKey]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    return store.subscribeToChanges(() => {
      const entries = store.getSnapshot().historyEntries;
      const recent = entries.slice(-MAX_ENTRIES);
      try {
        const payload = JSON.stringify(recent);
        if (payload.length > MAX_BYTES) {
          // Too fat to keep whole — keep the newest half rather than nothing.
          const half = recent.slice(Math.floor(recent.length / 2));
          window.sessionStorage.setItem(storageKey(sessionKey), JSON.stringify(half));
          return;
        }
        window.sessionStorage.setItem(storageKey(sessionKey), payload);
      } catch {
        // Quota or private-mode failure: editing continues, undo just goes
        // back to being session-only.
      }
    });
  }, [store, sessionKey]);

  return null;
}
