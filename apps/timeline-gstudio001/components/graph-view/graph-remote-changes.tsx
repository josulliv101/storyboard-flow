"use client";

import { useEffect, useRef } from "react";

import { buildFocusedGraph } from "@storyboard/timeline-domain";
import {
  applyCommand,
  getChildren,
  parseNodeId,
  useCollectionsStore,
  verifyPatchApplies,
  type CollectionItemNode,
  type NodeId,
} from "@storyboard/ui/dnd-collections";

import { graphDocumentsGateway } from "@/lib/graph-documents-gateway";

import { buildRemovalPatch, diffRemoteChildren } from "./graph-remote-diff";
import { parkPendingDetail, unparkPendingDetail } from "./graph-pending-details";

// Live updates for writes this tab cannot hear.
//
// A clip can now arrive from outside the session — an agent uploading a render
// through the remote MCP endpoint, or another tab. There is no Firestore
// listener on the client (the app has no client Firebase SDK; every read goes
// through the server so ownership stays enforced there), and SSE would not help
// on serverless anyway: the function that writes is not the one holding the
// connection, so pushing would need a shared bus. So: poll a tiny revisions
// endpoint, and pull only when it says something moved.
//
// ADDITIONS and REMOVALS. New clips are spliced into the live graph and animate
// in like any other drop; children that have DEPARTED remotely are taken out.
// Remote moves-within and trims are still not applied — reconciling those
// against in-flight local edits is a different problem, and silently rewriting a
// clip somebody is dragging would be worse than not updating at all.
//
// Removals were originally left out with the rest, and that turned out to be the
// hole that let a project silently revert: an agent removed collections through
// the MCP endpoint, this tab never learned, kept them in its live graph, and
// re-asserted them on its next write — against a fresh revision, so the
// compare-and-set passed. Additions-only convergence is not convergence.
//
// Applied through `store.applyRemotePatch`, NOT `store.dispatch`: this is not
// the local user's action, so it must not enter their undo stack. Undo should
// only ever walk back your own edits.

/** Slow enough to be free, fast enough that an upload feels immediate. */
const POLL_MS = 5000;

export function RemoteChangesBridge({
  timelineIds,
}: Readonly<{ timelineIds: readonly string[] }>) {
  const store = useCollectionsStore();
  // The poll reads these through a ref so a changing id list doesn't restart
  // the timer mid-cycle. Written in an effect, not during render — a render
  // can be thrown away, and a ref written then would outlive it.
  const idsRef = useRef(timelineIds);
  useEffect(() => {
    idsRef.current = timelineIds;
  }, [timelineIds]);
  const busyRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function pull(timelineId: string) {
      // `ensure` serves the session cache unless the id is stale — without
      // this it would hand back the very copy we already know is out of date,
      // and the diff below would find nothing.
      graphDocumentsGateway.markStale(timelineId);
      const document = await graphDocumentsGateway.ensure(timelineId);
      if (!document || cancelled) return;

      // Rebuild a graph from the FETCHED document rather than converting clips
      // to nodes by hand — `buildFocusedGraph` is the canonical conversion, and
      // duplicating it here is how the two would drift.
      const built = buildFocusedGraph({ [timelineId]: document }, timelineId, 1);
      if (!built.ok || cancelled) return;

      const live = store.getSnapshot().graph;
      const parentId = parseNodeId(timelineId);
      // REFRESHED BUT NOT ABSORBED — the dangerous half-state.
      //
      // `ensure` above has already replaced the cached document AND advanced
      // the revision ledger. Returning here leaves the graph without the
      // change, and nothing else notices: a later edit anywhere BELOW this
      // document still writes it (the affected set walks ancestors), projecting
      // the stale graph over the fresh cache with a revision that is current,
      // so CAS passes and the other writer's content is deleted.
      //
      // Blocking clip writes for the document is the same posture the conflict
      // gate takes, and for the same reason — see `markGraphBehind`.
      if (!live.nodesById.has(parentId)) {
        graphDocumentsGateway.markGraphBehind(timelineId, "not on this board");
        return;
      }

      const { added: incoming, departed } = diffRemoteChildren(
        live,
        built.value.graph,
        parentId,
      );

      // A pending local write means this session has unsaved intent for the
      // document. Converging under it would delete work the user is part-way
      // through, so leave the whole thing alone — the next poll will catch it
      // once their write settles.
      const settled = !graphDocumentsGateway.hasPendingWrite(timelineId);
      if (incoming.length === 0 && (departed.length === 0 || !settled)) return;

      const nodes: CollectionItemNode[] = [];
      const parked: string[] = [];
      for (const id of incoming) {
        const node = built.value.graph.nodesById.get(id);
        if (!node) continue;
        const detail = built.value.details[String(id)];
        // Park the detail BEFORE dispatch: poster and `sourceAsset` live in the
        // side-table, not on the node, and a clip that reaches the store
        // without its provenance would be written back without it.
        if (detail) {
          parkPendingDetail(String(id), detail);
          parked.push(String(id));
        }
        nodes.push(node);
      }

      // ADDITIONS FIRST. A clip moved from one collection to another on the same
      // board is seen by two polls — departed from A, arriving at B. Adding
      // before removing means it is never briefly absent from both.
      if (nodes.length > 0) {
        // NOT `store.dispatch` — that records an undo entry, and this is not the
        // local user's action. With it in the stack, Ctrl+Z would delete a clip
        // an agent just uploaded, and the autosave would persist that deletion.
        // Run the reducer purely to get the patch, then apply it without history.
        const applied = applyCommand(live, {
          type: "add-nodes",
          nodes,
          toParentId: parentId,
          toIndex: getChildren(live, parentId).length,
        });
        const ok = applied.ok && store.applyRemotePatch(applied.value.patch);
        // On refusal the details must not be left parked — they would attach
        // themselves to whatever later minted a node with the same id.
        if (!ok) {
          for (const id of parked) unparkPendingDetail(id);
          // Refused, so the graph does not have the arrivals the cache does.
          graphDocumentsGateway.markGraphBehind(timelineId, "remote additions refused");
          return;
        }
      }

      if (departed.length === 0 || cancelled) return;
      // Departures are deliberately skipped while a local write is pending —
      // converging under it would delete work in progress. But the cache and
      // the ledger already moved, so the same half-state applies and the next
      // ancestor write would resurrect what the other writer removed.
      if (!settled) {
        graphDocumentsGateway.markGraphBehind(timelineId, "local edit in flight");
        return;
      }

      // Built against the graph as it stands NOW — the additions above committed
      // and shifted the indices.
      const after = store.getSnapshot().graph;
      const patch = buildRemovalPatch(after, parentId, departed);
      if (!patch) return;

      // Verify before applying, the same gate `store.undo` uses — `applyPatch`
      // does not validate, and a patch built from a stale read would corrupt the
      // indices rather than fail.
      if (!verifyPatchApplies(after, patch).ok) return;
      store.applyRemotePatch(patch);
    }

    async function tick() {
      if (cancelled || busyRef.current) return;
      // Nothing to do for a hidden tab: the visibility listener pulls once on
      // the way back, so a backgrounded board costs nothing.
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;

      const ids = idsRef.current.filter(Boolean);
      if (ids.length === 0) return;

      busyRef.current = true;
      try {
        const response = await fetch(
          `/api/timelines/revisions?ids=${encodeURIComponent(ids.join(","))}`,
          { cache: "no-store" },
        );
        if (!response.ok || cancelled) return;
        const body = (await response.json()) as { revisions?: Record<string, number> };
        const remote = body.revisions ?? {};

        for (const [id, revision] of Object.entries(remote)) {
          const known = graphDocumentsGateway.revisionOf(id);
          // `undefined` means this session never observed one, so there is
          // nothing to compare and nothing to conclude.
          if (known === undefined || revision <= known) continue;
          await pull(id);
          if (cancelled) return;
        }
      } catch {
        // A failed poll is not worth surfacing — the next one is 5s away, and
        // an error banner for a background timer would be noise.
      } finally {
        busyRef.current = false;
      }
    }

    const timer = setInterval(() => void tick(), POLL_MS);
    const onVisible = () => void tick();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [store]);

  return null;
}
