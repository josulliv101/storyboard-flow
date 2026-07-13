import { describe, expect, test } from "vitest";

import { applyCommand } from "./commands";
import { buildGraph, parseNodeId, type CollectionsGraph, type GraphNodeSpec } from "./graph";
import {
  createPatchEnvelope,
  replayPatchEnvelope,
  PATCH_ENVELOPE_SCHEMA_VERSION,
} from "./patch-replay";
import { invertPatch, type CollectionsPatch } from "./patches";

const id = parseNodeId;
const media = (nodeId: string): GraphNodeSpec => ({ kind: "media", id: nodeId, name: nodeId });
const collection = (
  nodeId: string,
  children: readonly GraphNodeSpec[] = []
): GraphNodeSpec => ({ kind: "collection", id: nodeId, name: nodeId, children });

function build(spec: readonly GraphNodeSpec[]): CollectionsGraph {
  const result = buildGraph(spec);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

function fixture(): CollectionsGraph {
  return build([collection("root", [media("a"), media("b"), collection("folder")])]);
}

function movePatch(graph: CollectionsGraph): CollectionsPatch {
  const result = applyCommand(graph, {
    type: "move-nodes",
    nodeIds: [id("a")],
    toParentId: id("root"),
    toIndex: 1,
  });
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value.patch;
}

describe("replayPatchEnvelope", () => {
  test("replays a JSON-round-tripped patch and advances the revision", () => {
    const graph = fixture();
    const commandResult = applyCommand(graph, {
      type: "move-nodes",
      nodeIds: [id("a")],
      toParentId: id("root"),
      toIndex: 1,
    });
    if (!commandResult.ok) throw new Error(JSON.stringify(commandResult.error));
    const serialized = JSON.parse(
      JSON.stringify(createPatchEnvelope(commandResult.value.patch, "r1", "r2"))
    ) as unknown;

    const replayed = replayPatchEnvelope(graph, "r1", serialized);
    expect(replayed).toEqual({
      ok: true,
      value: { graph: commandResult.value.graph, revision: "r2" },
    });
  });

  test("rejects unsupported schemas and stale base revisions", () => {
    const graph = fixture();
    const envelope = createPatchEnvelope(movePatch(graph), "r1", "r2");
    expect(
      replayPatchEnvelope(graph, "r1", { ...envelope, schemaVersion: 2 })
    ).toEqual({ ok: false, error: { reason: "unsupported-schema", schemaVersion: 2 } });
    expect(replayPatchEnvelope(graph, "other", envelope)).toEqual({
      ok: false,
      error: {
        reason: "revision-mismatch",
        expectedBaseRevision: "r1",
        actualRevision: "other",
      },
    });
  });

  test("rejects malformed patch fields before applying", () => {
    const graph = fixture();
    const envelope = createPatchEnvelope(movePatch(graph), "r1", "r2");
    if (envelope.patch.type !== "nodes-moved") throw new Error("Expected move patch.");
    const malformed = {
      ...envelope,
      patch: {
        ...envelope.patch,
        moves: [{ ...envelope.patch.moves[0], toIndex: Number.NaN }],
      },
    };
    expect(replayPatchEnvelope(graph, "r1", malformed)).toEqual({
      ok: false,
      error: {
        reason: "invalid-envelope",
        validationError: {
          reason: "invalid-value",
          path: "$.patch.moves[0].toIndex",
          message: "Expected a non-negative integer.",
        },
      },
    });
    expect(
      replayPatchEnvelope(graph, "r1", {
        schemaVersion: 1,
        baseRevision: "r1",
        revision: "r2",
        patch: { type: "nodes-moved", moves: [] },
      })
    ).toMatchObject({
      ok: false,
      error: {
        reason: "invalid-envelope",
        validationError: { path: "$.patch.moves" },
      },
    });
  });

  test("checks recorded source slots instead of clamping or guessing", () => {
    const graph = fixture();
    const envelope = createPatchEnvelope(movePatch(graph), "r1", "r2");
    if (envelope.patch.type !== "nodes-moved") throw new Error("Expected move patch.");
    const conflicting = {
      ...envelope,
      patch: {
        ...envelope.patch,
        moves: [{ ...envelope.patch.moves[0], fromIndex: 1 }],
      },
    };
    expect(replayPatchEnvelope(graph, "r1", conflicting)).toEqual({
      ok: false,
      error: {
        reason: "patch-conflict",
        path: "$.patch.moves[0].fromIndex",
        message: "The recorded source slot does not contain the node.",
      },
    });
  });

  test("rejects add collisions and stale update before-values", () => {
    const graph = fixture();
    const added = applyCommand(graph, {
      type: "add-nodes",
      nodes: [{ id: id("new"), kind: "media", name: "new", durationSeconds: 2 }],
      toParentId: id("root"),
      toIndex: 0,
    });
    if (!added.ok) throw new Error(JSON.stringify(added.error));
    expect(
      replayPatchEnvelope(
        added.value.graph,
        "r1",
        createPatchEnvelope(added.value.patch, "r1", "r2")
      )
    ).toMatchObject({
      ok: false,
      error: { reason: "patch-conflict", path: "$.patch.adds[0].node.id" },
    });

    const updated = applyCommand(graph, {
      type: "update-media",
      nodeId: id("a"),
      update: { mediaKind: "image", durationSeconds: 8 },
    });
    if (!updated.ok) throw new Error(JSON.stringify(updated.error));
    expect(
      replayPatchEnvelope(
        updated.value.graph,
        "r1",
        createPatchEnvelope(updated.value.patch, "r1", "r2")
      )
    ).toMatchObject({
      ok: false,
      error: { reason: "patch-conflict", path: "$.patch.updates[0].before" },
    });

    if (updated.value.patch.type !== "nodes-updated") throw new Error("Expected update patch.");
    const forgedMetadata = {
      ...createPatchEnvelope(updated.value.patch, "r1", "r2"),
      patch: {
        ...updated.value.patch,
        updates: updated.value.patch.updates.map((update) => ({
          ...update,
          after: { ...update.after, name: "forged" },
        })),
      },
    };
    expect(replayPatchEnvelope(graph, "r1", forgedMetadata)).toMatchObject({
      ok: false,
      error: {
        reason: "invalid-envelope",
        validationError: { path: "$.patch.updates[0]" },
      },
    });
  });

  test("will not remove a collection that is no longer empty", () => {
    const graph = build([collection("root", [collection("folder", [media("child")])])]);
    const folder = graph.nodesById.get(id("folder"));
    if (!folder) throw new Error("Missing folder fixture.");
    const patch: CollectionsPatch = {
      type: "nodes-removed",
      removals: [{ node: folder, parentId: id("root"), index: 0 }],
    };
    expect(
      replayPatchEnvelope(graph, "r1", createPatchEnvelope(patch, "r1", "r2"))
    ).toMatchObject({
      ok: false,
      error: { reason: "patch-conflict", path: "$.patch.removals[0].node" },
    });
  });

  test("validates the resulting graph and supports checked inverse replay", () => {
    const graph = build([
      collection("root", [collection("outer", [collection("inner")])]),
    ]);
    const cyclePatch: CollectionsPatch = {
      type: "nodes-moved",
      moves: [
        {
          nodeId: id("outer"),
          fromParentId: id("root"),
          fromIndex: 0,
          toParentId: id("inner"),
          toIndex: 0,
        },
      ],
    };
    expect(
      replayPatchEnvelope(graph, "r1", createPatchEnvelope(cyclePatch, "r1", "r2"))
    ).toMatchObject({ ok: false, error: { reason: "invalid-graph" } });

    const forward = movePatch(fixture());
    const moved = replayPatchEnvelope(
      fixture(),
      "r1",
      createPatchEnvelope(forward, "r1", "r2")
    );
    if (!moved.ok) throw new Error(JSON.stringify(moved.error));
    const undone = replayPatchEnvelope(
      moved.value.graph,
      moved.value.revision,
      createPatchEnvelope(invertPatch(forward), "r2", "r3")
    );
    expect(undone).toMatchObject({ ok: true, value: { revision: "r3" } });
    if (undone.ok) {
      expect([...undone.value.graph.childrenById.get(id("root"))!]).toEqual([
        "a",
        "b",
        "folder",
      ]);
    }
    expect(PATCH_ENVELOPE_SCHEMA_VERSION).toBe(1);
  });
});
