import {
  applyCommand,
  type CollectionsCommand,
  type CollectionsGraph,
  type CommandRejection,
} from "@storyboard/collections-core";
import {
  buildFocusedGraph,
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
import { loadTimelineClosure } from "@/lib/load-timeline-closure";
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
  command: CollectionsCommand,
  graph: CollectionsGraph,
): DetailsById {
  if (command.type !== "rename-node") return details;
  const node = graph.nodesById.get(command.nodeId);
  if (!node || node.kind !== "media") return details;
  const existing = details[command.nodeId as string];
  return {
    ...details,
    [command.nodeId as string]: { ...existing, title: command.name } as DetailsById[string],
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
      command: CollectionsCommand;
      /**
       * Details to park for nodes this command CREATES, merged before write-back.
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
): Promise<ApplyCommandOutcome> {
  // The closure loader reads through `getFirebaseTimelineEntry`, which enforces
  // ownership, but it swallows the refusal (`.catch(() => null)`) and reports
  // the document as missing. That is the behaviour we want here too: a denied
  // id and an absent id are indistinguishable to the caller, so knowing an id
  // is not a claim to it. The write below re-checks ownership and throws.
  const { documents, revisions } = await loadTimelineClosure(rootTimelineId, requesterUid);
  if (!documents[rootTimelineId]) {
    return { ok: false, kind: "error", message: `No timeline document with id "${rootTimelineId}".` };
  }

  const built = buildFocusedGraph(documents, rootTimelineId, HYDRATE_ALL_LEVELS);
  if (!built.ok) return { ok: false, kind: "error", message: built.error };

  let command: CollectionsCommand;
  let parkedDetails: DetailsById = {};
  let seeded: readonly TimelineDocument[] = [];
  if (typeof commandOrBuilder === "function") {
    const requested = commandOrBuilder(built.value.graph, built.value.details);
    if (!requested.ok) return { ok: false, kind: "error", message: requested.message };
    command = requested.command;
    parkedDetails = requested.details ?? {};
    seeded = requested.newDocuments ?? [];
  } else {
    command = commandOrBuilder;
  }

  const applied = applyCommand(built.value.graph, command);
  if (!applied.ok) return { ok: false, kind: "rejected", rejection: applied.error };

  const { graph: nextGraph, patch } = applied.value;
  const details = syncRenameIntoDetails(
    { ...built.value.details, ...parkedDetails },
    command,
    nextGraph,
  );

  // Only collections that are their OWN stored document get written. The patch
  // reports every affected collection including ancestors, but a nested
  // collection's clips live in its own document, so an ancestor's clip list is
  // unchanged by a change inside its child.
  const affected = new Set(
    collectAffectedCollectionIds(nextGraph, patch).filter((id) => documents[id] !== undefined),
  );

  // Renaming a COLLECTION also has to retitle the collection's own document.
  // The patch only reports the collection whose clip list changed — the child
  // document is a separate record, and leaving it means the board shows the new
  // name while the stored title (breadcrumb, project list) keeps the old one.
  // The in-page path does this through the bridge's `renameTimeline`.
  const retitled =
    command.type === "rename-node" && documents[command.nodeId as string] !== undefined
      ? (command.nodeId as string)
      : null;
  if (retitled) affected.add(retitled);

  const affectedIds = [...affected];
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
      ...(id === retitled && command.type === "rename-node" ? { title: command.name } : {}),
      clips: graphChildrenToClips(nextGraph, details, id),
    };
    nextDocuments[id] = document;
    return {
      document,
      // Compare-and-set against what we read. A concurrent writer (the app in
      // another tab, or a second agent call) bumps the revision and aborts the
      // WHOLE batch rather than letting half a change land.
      expectedRevision: revisions[id],
    };
  });

  try {
    await saveFirebaseTimelineDocumentsAtomic([...seedWrites, ...writes], requesterUid);
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
