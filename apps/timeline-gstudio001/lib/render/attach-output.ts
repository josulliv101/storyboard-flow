import "server-only";

import { parseNodeId, type CollectionsGraph } from "@storyboard/collections-core";
import type { TimelineDocument } from "@storyboard/timeline-model/types";

import { applyCollectionsCommand } from "@/lib/mcp/apply-command";
import { readStoredTimelineEntry } from "@/lib/firebase-timeline-store";

import {
  RENDERS_COLLECTION_NAME,
  RENDERS_COLLECTION_ROLE,
  findRendersCollection,
  renderClipName,
} from "./renders-collection";
import type { StoredRenderJob } from "./job-store";

/**
 * File a finished render into the project's Renders collection.
 *
 * BEST EFFORT, and that is the important property. It runs after the job has
 * already been marked succeeded, so a failure here loses the FILING, never the
 * render — the output URL is on the job either way, and the alternative
 * (attaching first, or letting a filing error fail the report) would turn a
 * finished encode into a lost one over a timeline that had been renamed or
 * moved in the meantime.
 *
 * Two writes rather than one: `add-nodes` targets a single parent, so creating
 * the Renders collection and putting a clip inside it cannot be the same
 * command. Each is atomic on its own, and the failure between them is a
 * created-but-empty collection — visible, harmless, and reused by the next
 * render.
 */
export type AttachResult =
  | Readonly<{ ok: true; collectionId: string; nodeId: string }>
  | Readonly<{ ok: false; reason: string }>;

/** Default seconds a render's card claims before anything measures it. The
 *  cut list already knows the real length, so this is never a guess. */
function mintClipId(): string {
  return `render-clip-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function mintTimelineId(): string {
  return `timeline-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * The Renders collection's id, creating it if the project has none.
 *
 * Read from the ROOT DOCUMENT's clips rather than from a built graph: the
 * question is "does this project have a Renders collection", which the stored
 * document answers directly and cheaply. Building a closure to ask it would
 * load every document in the project.
 */
async function ensureRendersCollection(
  timelineId: string,
  uid: string,
): Promise<
  | Readonly<{ ok: true; id: string; needsRoleStamp: boolean }>
  | Readonly<{ ok: false; reason: string }>
> {
  const entry = await readStoredTimelineEntry(timelineId, uid);
  if (!entry) return { ok: false, reason: `No timeline with id "${timelineId}".` };

  const existing = findRendersCollection(entry.document.clips);
  if (existing !== null) {
    // FOUND BY NAME MEANS IT PREDATES THE MARKER, and this is the moment to
    // fix that: the caller is about to write into this collection anyway, so
    // the stamp costs no extra round trip and the NEXT render resolves by role
    // — after which the collection can be renamed freely. A project that never
    // renders again is never migrated, which is correct: nothing is wrong with
    // it until something looks for its Renders collection.
    return { ok: true, id: existing.id, needsRoleStamp: existing.matchedBy === "title" };
  }

  const childId = mintTimelineId();
  const outcome = await applyCollectionsCommand(
    timelineId,
    (graph: CollectionsGraph) => {
      const rootId = parseNodeId(timelineId);
      const root = graph.nodesById.get(rootId);
      if (!root) return { ok: false, message: `No timeline with id "${timelineId}".` } as const;
      const childDocument: TimelineDocument = {
        id: childId,
        title: RENDERS_COLLECTION_NAME,
        clips: [],
      };
      return {
        ok: true,
        command: {
          type: "add-nodes",
          toParentId: rootId,
          // At the END of the project. Renders are output, not content — they
          // should not push the edit down the board.
          toIndex: graph.childrenById.get(rootId)?.length ?? 0,
          nodes: [
            { id: parseNodeId(childId), kind: "collection" as const, name: RENDERS_COLLECTION_NAME },
          ],
        },
        details: {
          [childId]: {
            alt: `${RENDERS_COLLECTION_NAME} collection`,
            aspect: 16 / 9,
            trackIndex: 0,
            itemCount: 0,
            // WHAT MAKES IT THE RENDERS COLLECTION. Set at creation so a
            // collection minted here is never identified by its name — it can
            // be renamed the minute after it appears and renders keep landing
            // in it.
            role: RENDERS_COLLECTION_ROLE,
            duration: 3,
            sourceDuration: 3,
            trimIn: 0,
            trimOut: 0,
            // Brand-new and empty, so drops into it must not bounce off the
            // un-hydrated-target veto.
            hydrated: true,
          },
        },
        newDocuments: [childDocument],
      } as const;
    },
    uid,
  );

  if (!outcome.ok) {
    return {
      ok: false,
      reason: outcome.kind === "rejected" ? outcome.rejection.reason : outcome.message,
    };
  }
  // Created carrying its role already, so there is nothing to migrate.
  return { ok: true, id: childId, needsRoleStamp: false };
}

export async function attachRenderOutput(
  job: StoredRenderJob,
  outputUrl: string,
): Promise<AttachResult> {
  const collection = await ensureRendersCollection(job.timelineId, job.requestedBy);
  if (!collection.ok) return { ok: false, reason: collection.reason };

  const entry = await readStoredTimelineEntry(job.timelineId, job.requestedBy);
  const name = renderClipName(entry?.document.title ?? "", job.createdAt);
  const clipId = mintClipId();

  const outcome = await applyCollectionsCommand(
    // The ROOT is the timeline whose closure gets loaded; the Renders
    // collection is a child of it, so it is in the graph.
    job.timelineId,
    (graph: CollectionsGraph, existingDetails) => {
      const parentId = parseNodeId(collection.id);
      if (!graph.nodesById.has(parentId)) {
        return { ok: false, message: `Renders collection "${collection.id}" is not loaded.` } as const;
      }
      // THE MIGRATION, folded into a write that was happening anyway. Adding
      // this clip already rewrites the Renders collection's own document AND
      // its parent's — a new child changes the collection's `itemCount` and
      // duration, which are denormalized onto the root's clip for it — so the
      // stamp rides along for free.
      //
      // The whole existing detail is respread because details merge PER NODE
      // and not per field: parking `{role}` alone would replace this
      // collection's entry outright and drop its `alt`, `aspect`, `itemCount`
      // and preview frames on the floor.
      //
      // NO DETAIL MEANS NO STAMP, rather than a synthesized one. `alt` and
      // `aspect` are required on a detail, so inventing an entry here would
      // write a card that had lost whatever it was actually showing — and a
      // Renders collection loaded into the graph always has one, so an absent
      // detail is a broken assumption, not a case to paper over. The title
      // fallback still resolves it, so this costs correctness nothing.
      const current = existingDetails[collection.id];
      const stamp =
        collection.needsRoleStamp && current !== undefined
          ? { [collection.id]: { ...current, role: RENDERS_COLLECTION_ROLE } }
          : {};
      return {
        ok: true,
        command: {
          type: "add-nodes",
          toParentId: parentId,
          // Newest last, so the collection reads in the order cuts were made.
          toIndex: graph.childrenById.get(parentId)?.length ?? 0,
          nodes: [
            {
              id: parseNodeId(clipId),
              kind: "media" as const,
              mediaKind: "video" as const,
              name,
              src: outputUrl,
              // The cut list already knows exactly how long this is — the
              // renderer produced it — so nothing here is estimated.
              fullDurationSeconds: job.cutList.durationSeconds,
              trimInSeconds: 0,
              trimOutSeconds: 0,
            },
          ],
        },
        details: {
          ...stamp,
          [clipId]: {
            alt: name,
            title: name,
            aspect: job.cutList.format.width / job.cutList.format.height,
            trackIndex: 0,
            // Provenance: which render made this file. Not `sourceAsset` —
            // that names a provider file, and this names the JOB.
            tags: ["render"],
          },
        },
      } as const;
    },
    job.requestedBy,
  );

  if (!outcome.ok) {
    return {
      ok: false,
      reason: outcome.kind === "rejected" ? outcome.rejection.reason : outcome.message,
    };
  }
  return { ok: true, collectionId: collection.id, nodeId: clipId };
}
