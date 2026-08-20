import { compilePlaybackManifest, type PlaybackManifest } from "@storyboard/timeline-domain";
import type { TimelineDocument } from "@storyboard/timeline-model/types";

import { deriveClosureSummaries } from "./derive-collection-summaries";

/**
 * Compile the playback manifest IN THE BROWSER, from documents the session
 * already holds.
 *
 * The server route re-reads every document under the root to compile the same
 * thing — measured at ~149 document reads per compile on a 143-collection
 * project, repeated on every edit while preview is open. At ~175 collections a
 * 200-edit session spends ~35,000 reads that way, all of it re-reading a
 * closure the client primed on entry and has kept current since.
 *
 * ONLY WHEN THE CLOSURE IS PROVABLY COMPLETE. The manifest exists precisely so
 * that "playback depth no longer depends on how much of the graph a session
 * happens to have hydrated" — compiling from a partial closure would reintroduce
 * exactly what it was built to prevent, and the failure is silent: a collection
 * four levels down simply plays nothing. So `collectionIds` walks first and
 * refuses on the first reference it cannot resolve, and the caller falls back to
 * the server route, which reads from storage and has no such limit.
 *
 * SAME TWO STEPS, SAME ORDER as the server (`compile-timeline-manifest.ts`):
 * derive summaries across the closure, then compile. Skipping the derivation is
 * the plausible mistake and not a harmless one — stored summaries are stale by
 * design, because writes are patch-scoped, and a compile that trusted them once
 * "reported a different total than the board while windowing a grown child's
 * newest clips out of playback entirely". `client-manifest-equivalence.test.ts`
 * pins both the agreement and the fact that the derivation changes the answer.
 */

/**
 * Every document id reachable from `rootId`, or null when the closure cannot be
 * compiled from what is in hand.
 *
 * Null means "ask the server", never "compile a smaller manifest". Two causes,
 * deliberately not distinguished, because the caller's response is the same:
 *
 *   - A referenced document is not loaded — a placeholder below the hydration
 *     depth, or a prime that has not landed.
 *   - A cycle. `compilePlaybackManifest` throws on one; catching a throw is a
 *     worse contract than refusing up front, and the server's walk has the same
 *     guard for the same reason.
 */
export function closureIds(
  documents: Readonly<Record<string, TimelineDocument>>,
  rootId: string,
  /**
   * "The server already told us this id does not exist." A dangling
   * `childTimelineId` is a normal, handled condition — `loadTimelineClosure`
   * substitutes an empty document and reports it — so refusing on one would
   * mean never compiling locally on a project that has any. An exported project
   * has them by construction: export drops branches whose documents are gone,
   * leaving the references behind.
   *
   * Anything NOT on that list is treated as unhydrated, which is the case the
   * guard exists for.
   */
  isKnownMissing: (id: string) => boolean = () => false,
): Set<string> | null {
  const found = new Set<string>();
  const walk = (id: string, ancestors: ReadonlySet<string>): boolean => {
    if (ancestors.has(id)) return false;
    // Known-missing resolves as an empty document, exactly as the server's walk
    // does, and contributes nothing further to descend into.
    if (isKnownMissing(id) && !documents[id]) return true;
    const document = documents[id];
    if (!document) return false;
    found.add(id);
    const nextAncestors = new Set(ancestors);
    nextAncestors.add(id);
    for (const clip of document.clips) {
      if (clip.kind !== "collection" || !clip.childTimelineId) continue;
      if (!walk(clip.childTimelineId, nextAncestors)) return false;
    }
    return true;
  };
  return walk(rootId, new Set()) ? found : null;
}

/**
 * The manifest, or null when the caller should fetch it instead.
 *
 * Compiled over the closure SUBSET rather than every document the session has
 * cached: `deriveClosureSummaries` derives for everything it is given, and a
 * session holding several projects would otherwise pay for all of them on every
 * recompile.
 *
 * The revisions are the ledger's, which is the honest answer to "what was this
 * compiled from" — including the case where a document has unsaved local edits
 * and the ledger still names the last accepted revision. Unlike a server
 * manifest, this one cannot TRAIL the session's writes: it is compiled from the
 * very documents those writes produced, which is why the caller installs it
 * without the `manifestTrailsLedger` guard that exists to catch a stale
 * server-side compile.
 */
export function compileClientPlaybackManifest(
  documents: Readonly<Record<string, TimelineDocument>>,
  rootId: string,
  revisionOf: (id: string) => number | undefined,
  compiledAt: string,
  isKnownMissing: (id: string) => boolean = () => false,
): PlaybackManifest | null {
  const ids = closureIds(documents, rootId, isKnownMissing);
  if (ids === null) return null;

  const subset: Record<string, TimelineDocument> = {};
  const unresolved = new Set<string>();
  const revisions: Record<string, number> = {};
  for (const id of ids) {
    const document = documents[id];
    if (!document) return null;
    subset[id] = document;
    revisions[id] = revisionOf(id) ?? 0;
    // An empty stand-in for each dangling reference, so the compiler has
    // something to resolve — it throws on an unresolvable child, and a branch
    // that does not exist should fall silent rather than abort the compile.
    for (const clip of document.clips) {
      if (clip.kind !== "collection" || !clip.childTimelineId) continue;
      const childId = clip.childTimelineId;
      if (subset[childId] || documents[childId] || !isKnownMissing(childId)) continue;
      subset[childId] = { id: childId, title: "", clips: [] };
      revisions[childId] = 0;
      unresolved.add(childId);
    }
  }

  // THE UNRESOLVED SET, which is not the same as substituting empties.
  //
  // `deriveClosureSummaries` treats these ids as ABSENT so the parent's stored
  // summary stands — "stale beats blank", in its words, because deriving from
  // an empty stand-in would rewrite a real stored duration to "empty
  // collection". Passing the substitutes without the set does exactly that:
  // measured on a real project, the client compiled 1336.2s against the
  // server's 1360.7s, the whole 24.5s difference being two dangling branches
  // flattened to nothing.
  //
  // `serveTimelineClosure` passes its `missing` here for the same reason. The
  // stand-ins above are for the COMPILER, this set is for the DERIVATION, and
  // both are needed.
  return compilePlaybackManifest(
    deriveClosureSummaries(subset, unresolved),
    rootId,
    revisions[rootId] ?? 0,
    compiledAt,
    revisions,
  );
}
