import {
  applyCommand,
  buildGraph,
  type CollectionsCommand,
  type CollectionsGraph,
  type CollectionsPatch,
  type CommandRejection,
  type GraphNodeSpec,
} from "@storyboard/collections-core";
import {
  buildFocusedGraph,
  buildHydrationSpecs,
  collectAffectedCollectionIds,
  graphChildrenToClips,
  type DetailsById,
} from "@storyboard/timeline-domain";
import type { TimelineDocument } from "@storyboard/timeline-model/types";

import {
  saveFirebaseTimelineDocumentsAtomic,
  TimelineRevisionConflictError,
  type TimelineBatchWrite,
} from "@/lib/firebase-timeline-store";
import { changeLogDocuments, recordChange } from "@/lib/change-log";
import { loadTimelineClosure, TimelineClosureTooLargeError } from "@/lib/load-timeline-closure";
import { serveTrashDocument } from "@/lib/serve-timeline";
import { TimelineAccessDeniedError } from "@/lib/timeline-ownership";

// The server-side twin of the in-page dispatch path. WebMCP tools mutate the
// live CollectionsStore and let PersistenceBridge save; the remote MCP endpoint
// has no store and no browser, so it does the same round trip against stored
// documents:
//
//   load closure -> build graph -> applyCommand -> write affected docs atomically
//
// The COMMAND is the shared unit. Tool handlers translate their arguments into
// one `CollectionsCommand` and hand it here, so both transports run identical
// reducer semantics and can only diverge in how the result is persisted.
//
// See docs/webmcp-agent-tools.md.

/**
 * Hydrate the whole loaded closure rather than one level.
 *
 * `buildFocusedGraph` defaults to one child level, which leaves deeper
 * collections as placeholders. A placeholder has no children in the graph, so a
 * command targeting something inside one would be rejected as `missing-node` —
 * and, worse, writing that graph back would flatten the branch. The closure
 * loader already bounds how much is read, so it is safe to hydrate all of it.
 */
const HYDRATE_ALL_LEVELS = Number.MAX_SAFE_INTEGER;

/**
 * Mirror a rename into the details side-table, which is what the in-page
 * PersistenceBridge does.
 *
 * The two clip kinds read their name from different places in
 * `graphChildrenToClips`: a COLLECTION clip's `title` comes straight off
 * `node.name`, so a rename lands with no help — but a MEDIA clip's `title`
 * comes from `detail.title` (deliberately, so the derived `alt` survives
 * naming). Without this the reducer renames the node, the write-back reads a
 * stale detail, and the new name is silently dropped on save.
 */
function syncRenameIntoDetails(
  details: DetailsById,
  command: CollectionsCommand | null,
  graph: CollectionsGraph,
): DetailsById {
  if (!command || command.type !== "rename-node") return details;
  const node = graph.nodesById.get(command.nodeId);
  if (!node || node.kind !== "media") return details;
  const existing = details[command.nodeId as string];
  return {
    ...details,
    [command.nodeId as string]: { ...existing, title: command.name } as DetailsById[string],
  };
}

export type ApplyCommandOptions = Readonly<{
  /**
   * Also load the requester's trash as a SECOND graph root, so a command can
   * move nodes into it. Off by default: the other tools never target the bin,
   * and loading it costs a second closure read.
   */
  includeTrash?: boolean;
  /**
   * This command is allowed to leave a collection with no clips.
   *
   * Only removals set it. The store otherwise refuses an empty write, because
   * an unexpected empty is a stale client about to erase real work — but that
   * blanket guard made it impossible to remove the LAST item from a collection,
   * and a per-shot lane holds exactly one clip, so every correction hit it.
   *
   * Applied per-document, to the ones this command actually emptied.
   */
  allowEmptying?: boolean;
}>;

/**
 * The requester's own bin. Derived from the VERIFIED uid, never from tool
 * arguments — `checkUserScopedId` only ever accepts `trash-<requesterUid>`, so
 * deriving it is both the correct id and the only reachable one.
 */
export function trashDocumentIdFor(requesterUid: string): string {
  return `trash-${requesterUid}`;
}

/**
 * A graph spanning the project AND the trash, mirroring the in-page boot's
 * `buildGraph([projectRoot, trashRoot])`.
 *
 * `buildHydrationSpecs` takes the already-used ids so a node reachable from
 * both roots demotes to a reference card instead of colliding — node ids must
 * be unique across the WHOLE graph, not per root.
 */
function buildRootsGraph(
  documents: Record<string, TimelineDocument>,
  rootTimelineId: string,
  trashId: string,
): Readonly<{ ok: true; value: { graph: CollectionsGraph; details: DetailsById } }
  | Readonly<{ ok: false; error: string }>> {
  const rootSpecs = buildHydrationSpecs(documents, rootTimelineId, HYDRATE_ALL_LEVELS);
  if (!rootSpecs.ok) return rootSpecs;
  const trashSpecs = buildHydrationSpecs(documents, trashId, HYDRATE_ALL_LEVELS, [
    rootTimelineId,
    ...Object.keys(rootSpecs.value.details),
  ]);
  if (!trashSpecs.ok) return trashSpecs;

  const roots: GraphNodeSpec[] = [
    {
      kind: "collection",
      id: rootTimelineId,
      name: documents[rootTimelineId].title,
      children: rootSpecs.value.specs,
    },
    {
      kind: "collection",
      id: trashId,
      name: documents[trashId].title || "Trash Bin",
      children: trashSpecs.value.specs,
    },
  ];

  const built = buildGraph(roots);
  if (!built.ok) {
    return { ok: false, error: `Could not build graph: ${JSON.stringify(built.error)}` };
  }
  return {
    ok: true,
    value: {
      graph: built.value,
      details: { ...rootSpecs.value.details, ...trashSpecs.value.details },
    },
  };
}

export type ApplyCommandOutcome =
  | Readonly<{
      ok: true;
      /** Documents actually written, in the order they were saved. */
      affectedIds: readonly string[];
      /** Post-command graph, for handlers that report the new ordering. */
      documents: Readonly<Record<string, TimelineDocument>>;
      details: DetailsById;
    }>
  | Readonly<{ ok: false; kind: "rejected"; rejection: CommandRejection }>
  | Readonly<{ ok: false; kind: "error"; message: string }>;

/**
 * Builds the command once the graph is loaded.
 *
 * Placement resolution (`resolveMovePlacement`) needs the graph, but so does
 * applying — passing a builder rather than a finished command lets a handler
 * see the graph without loading the closure a second time. Returning a string
 * is the handler's own validation failure (bad anchor, wrong media kind), kept
 * separate from a reducer rejection so the two report differently.
 */
export type CommandBuilder = (
  graph: CollectionsGraph,
  details: DetailsById,
) =>
  | Readonly<{
      ok: true;
      /**
       * The graph mutation, when there is one.
       *
       * OMITTED for a change that only touches the detail side-table — tags,
       * for instance. Those fields exist precisely because the engine does not
       * model them, so there is no command that expresses the edit: the graph
       * is genuinely unchanged and `applyCommand` is skipped. A caller
       * omitting this MUST name the documents to rewrite in
       * `affectedCollectionIds`, because the write set is normally derived
       * from the patch and there is no patch.
       *
       * Manufacturing a no-op command instead does not work and must not be
       * attempted: `applyRename` REJECTS a same-name rename outright
       * (collections-core/commands.ts, `same-position`), and a command that
       * did slip through would put a phantom entry in undo history.
       */
      command?: CollectionsCommand;
      /**
       * Collections whose stored document this change rewrites, on top of
       * whatever the patch reports. REQUIRED when `command` is omitted.
       *
       * A clip's stored form lives in its PARENT's `clips` array, so a
       * detail-only edit names exactly that parent — not its ancestors.
       * `collectAffectedCollectionIds` walks ancestors for a `nodes-updated`
       * patch because a trim changes a child's duration and therefore the
       * parent's denormalized collection summary; a tag changes no summary
       * (not `duration`, not `itemCount`, not `previewItems`), so rewriting
       * ancestors would be pure write amplification and extra CAS conflicts.
       */
      affectedCollectionIds?: readonly string[];
      /**
       * Details to park for nodes this command CREATES OR MODIFIES, merged
       * before write-back.
       *
       * Not optional bookkeeping: `graphChildrenToClips` reads `poster` and —
       * critically — `sourceAsset` from the details side-table, not the graph
       * node. A new node with no detail entry writes a clip with no provenance,
       * and an un-provenanced clip is never marked for reclaim, so its file
       * leaks in storage forever (docs/asset-providers.md).
       */
      details?: DetailsById;
      /**
       * Documents this command CREATES — a new collection's own document.
       *
       * Written in the SAME atomic batch as the parent's updated clip list,
       * with `expectedRevision: 0` (compare-and-set create, so a racing
       * creator loses rather than silently overwriting). Splitting them would
       * let a drill-in 404 on a half-created collection, which is exactly what
       * the in-page path avoids by joining one batch.
       */
      newDocuments?: readonly TimelineDocument[];
    }>
  | Readonly<{ ok: false; message: string }>;

/**
 * Run one command against a stored timeline closure and persist the result.
 *
 * `rootTimelineId` is the document whose closure is loaded — it must contain
 * every node the command touches. A cross-collection move is fine as long as
 * both collections live under this root, which is what makes the single atomic
 * write correct.
 *
 * `requesterUid` comes from the verified token, never from tool arguments.
 */
export async function applyCollectionsCommand(
  rootTimelineId: string,
  commandOrBuilder: CollectionsCommand | CommandBuilder,
  requesterUid: string,
  options: ApplyCommandOptions = {},
): Promise<ApplyCommandOutcome> {
  // The closure loader reads through `readStoredTimelineEntry`, which enforces
  // ownership, but it swallows the refusal (`.catch(() => null)`) and reports
  // the document as missing. That is the behaviour we want here too: a denied
  // id and an absent id are indistinguishable to the caller, so knowing an id
  // is not a claim to it. The write below re-checks ownership and throws.
  let loaded: Awaited<ReturnType<typeof loadTimelineClosure>>;
  try {
    loaded = await loadTimelineClosure(rootTimelineId, requesterUid);
  } catch (error) {
    // The loader THROWS past its own budget. Report it as a tool error rather
    // than letting it escape the handler as a 500 — including the trash
    // closure below makes the ceiling easier to reach.
    if (error instanceof TimelineClosureTooLargeError) {
      return { ok: false, kind: "error", message: error.message };
    }
    throw error;
  }
  const documents: Record<string, TimelineDocument> = { ...loaded.documents };
  const revisions: Record<string, number> = { ...loaded.revisions };
  if (!documents[rootTimelineId]) {
    return { ok: false, kind: "error", message: `No timeline document with id "${rootTimelineId}".` };
  }

  // The trash is a SIBLING ROOT, never a collection clip inside a project, so
  // it is absent from the project's closure and a command targeting it would be
  // rejected as `missing-node`. Load it as a second root, exactly as the
  // in-page boot does (graph-timeline-view.tsx) — that is the only way a
  // remove can reach the bin.
  const trashId = options.includeTrash ? trashDocumentIdFor(requesterUid) : null;
  if (trashId) {
    const served = await serveTrashDocument(trashId, requesterUid);
    const trashClosure = await loadTimelineClosure(trashId, requesterUid, {
      rootEntry: { document: served.document, revision: served.revision },
    });
    for (const [id, document] of Object.entries(trashClosure.documents)) {
      documents[id] ??= document;
    }
    for (const [id, revision] of Object.entries(trashClosure.revisions)) {
      revisions[id] ??= revision;
    }
    // `serveTrashDocument` defaults a not-yet-created bin to revision 0, so the
    // existing compare-and-set write CREATES it on first use.
    documents[trashId] = served.document;
    revisions[trashId] ??= served.revision;
  }

  const built = trashId
    ? buildRootsGraph(documents, rootTimelineId, trashId)
    : buildFocusedGraph(documents, rootTimelineId, HYDRATE_ALL_LEVELS);
  if (!built.ok) return { ok: false, kind: "error", message: built.error };

  let command: CollectionsCommand | null = null;
  let parkedDetails: DetailsById = {};
  let seeded: readonly TimelineDocument[] = [];
  let declaredAffected: readonly string[] = [];
  if (typeof commandOrBuilder === "function") {
    const requested = commandOrBuilder(built.value.graph, built.value.details);
    if (!requested.ok) return { ok: false, kind: "error", message: requested.message };
    command = requested.command ?? null;
    parkedDetails = requested.details ?? {};
    seeded = requested.newDocuments ?? [];
    declaredAffected = requested.affectedCollectionIds ?? [];
  } else {
    command = commandOrBuilder;
  }

  // A detail-only change has no command, so nothing is applied and the graph
  // carries through untouched — which is what makes re-projecting the affected
  // documents from it safe.
  let nextGraph = built.value.graph;
  let patch: CollectionsPatch | null = null;
  if (command !== null) {
    const applied = applyCommand(built.value.graph, command);
    if (!applied.ok) return { ok: false, kind: "rejected", rejection: applied.error };
    nextGraph = applied.value.graph;
    patch = applied.value.patch;
  }

  const details = syncRenameIntoDetails(
    { ...built.value.details, ...parkedDetails },
    command,
    nextGraph,
  );

  // Only collections that are their OWN stored document get written. The patch
  // reports every affected collection including ancestors, but a nested
  // collection's clips live in its own document, so an ancestor's clip list is
  // unchanged by a change inside its child.
  const patchAffected = patch === null ? [] : collectAffectedCollectionIds(nextGraph, patch);
  const affected = new Set(
    [...patchAffected, ...declaredAffected].filter((id) => documents[id] !== undefined),
  );

  // Renaming a COLLECTION also has to retitle the collection's own document.
  // The patch only reports the collection whose clip list changed — the child
  // document is a separate record, and leaving it means the board shows the new
  // name while the stored title (breadcrumb, project list) keeps the old one.
  // The in-page path does this through the bridge's `renameTimeline`.
  const retitled =
    command?.type === "rename-node" && documents[command.nodeId as string] !== undefined
      ? (command.nodeId as string)
      : null;
  if (retitled) affected.add(retitled);

  const affectedIds = [...affected];
  // A DECLARED write set that survives none of the filtering is a failure, not
  // a no-op. The empty short-circuit below is right for a patch-derived set (an
  // ancestor above the loaded root legitimately has nothing to write), but a
  // caller that named its documents and got silence would report success while
  // saving nothing — the exact failure this whole path exists to remove.
  if (affectedIds.length === 0 && declaredAffected.length > 0) {
    return {
      ok: false,
      kind: "error",
      message: `None of the collections to update (${declaredAffected.join(", ")}) are loaded documents under "${rootTimelineId}".`,
    };
  }
  if (affectedIds.length === 0 && seeded.length === 0) {
    return { ok: true, affectedIds: [], documents, details };
  }

  const nextDocuments: Record<string, TimelineDocument> = { ...documents };
  // New documents ride the SAME batch, at revision 0 — a compare-and-set
  // create, so two racing creators can't both think they made it.
  const seedWrites: TimelineBatchWrite[] = seeded.map((document) => {
    nextDocuments[document.id] = document;
    return { document, expectedRevision: 0 };
  });
  const writes: TimelineBatchWrite[] = affectedIds.map((id) => {
    const document: TimelineDocument = {
      ...documents[id],
      ...(id === retitled && command?.type === "rename-node" ? { title: command.name } : {}),
      clips: graphChildrenToClips(nextGraph, details, id),
    };
    nextDocuments[id] = document;
    return {
      document,
      // Compare-and-set against what we read. A concurrent writer (the app in
      // another tab, or a second agent call) bumps the revision and aborts the
      // WHOLE batch rather than letting half a change land.
      expectedRevision: revisions[id],
      // Only a command that MEANS to remove may leave a collection empty, and
      // only the documents this command actually emptied. A move empties its
      // source and fills its target; marking every write in the batch would
      // hand a blanket exemption to writes that never intended one.
      ...(options.allowEmptying && document.clips.length === 0
        ? { allowEmptying: true }
        : {}),
    };
  });

  const committed = [...seedWrites, ...writes];
  try {
    const results = await saveFirebaseTimelineDocumentsAtomic(committed, requesterUid);
    // After the commit, never inside it. Agent writes are exactly the ones with
    // no human watching, so they are the ones most worth having a record of.
    await recordChange({
      uid: requesterUid,
      source: "mcp",
      documents: changeLogDocuments(
        results,
        nextDocuments,
        Object.fromEntries(committed.map((write) => [write.document.id, write.expectedRevision])),
      ),
    });
  } catch (error) {
    if (error instanceof TimelineRevisionConflictError) {
      const ids = error.conflicts.map((conflict) => conflict.id).join(", ");
      return {
        ok: false,
        kind: "error",
        message: `The timeline changed while this edit was being applied (${ids}). Re-read it and try again.`,
      };
    }
    if (error instanceof TimelineAccessDeniedError) {
      return { ok: false, kind: "error", message: `Not authorized to edit timeline "${rootTimelineId}".` };
    }
    throw error;
  }

  return {
    ok: true,
    affectedIds: [...seeded.map((d) => d.id), ...affectedIds],
    documents: nextDocuments,
    details,
  };
}
