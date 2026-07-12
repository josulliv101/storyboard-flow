import { describe, expect, test } from "vitest";
import {
  buildGraph,
  findGraphInvariantViolation,
  parseNodeId,
  type CollectionsGraph,
  type GraphNodeSpec,
  type NodeId,
} from "./graph";
import { applyCommand, type CollectionsCommand } from "./commands";
import { applyPatch, invertPatch } from "./patches";

// Property fuzz over the package's most load-bearing invariant: EVERY
// accepted command yields a valid graph, and its patch round-trips —
// applyPatch(invertPatch(p)) restores the pre-state, re-applying p restores
// the post-state. Random nested graphs, random (often invalid) commands,
// graphs EVOLVE across steps so later commands run against arbitrary
// reachable states. Seeded PRNG: failures reproduce exactly.

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomSpec(
  rand: () => number,
  depth: number,
  counter: { n: number }
): GraphNodeSpec {
  counter.n += 1;
  const id = `n${counter.n}`;
  if (depth > 0 && rand() < 0.35) {
    const children: GraphNodeSpec[] = [];
    const childCount = Math.floor(rand() * 4);
    for (let i = 0; i < childCount; i++) children.push(randomSpec(rand, depth - 1, counter));
    return { kind: "collection", id, name: id, children };
  }
  return { kind: "media", id, name: id, durationSeconds: 1 + Math.floor(rand() * 9) };
}

function randomGraph(rand: () => number): CollectionsGraph {
  const counter = { n: 0 };
  const roots: GraphNodeSpec[] = [];
  const rootCount = 1 + Math.floor(rand() * 3);
  for (let r = 0; r < rootCount; r++) {
    const children: GraphNodeSpec[] = [];
    const count = 1 + Math.floor(rand() * 5);
    for (let i = 0; i < count; i++) children.push(randomSpec(rand, 3, counter));
    roots.push({ kind: "collection", id: `root${r}`, name: `root${r}`, children });
  }
  const built = buildGraph(roots);
  if (!built.ok) throw new Error(`fixture bug: ${JSON.stringify(built.error)}`);
  return built.value;
}

function childrenEqual(a: CollectionsGraph, b: CollectionsGraph): boolean {
  if (a.childrenById.size !== b.childrenById.size) return false;
  for (const [id, childrenA] of a.childrenById) {
    const childrenB = b.childrenById.get(id);
    if (!childrenB || childrenA.length !== childrenB.length) return false;
    for (let i = 0; i < childrenA.length; i++) {
      if (childrenA[i] !== childrenB[i]) return false;
    }
  }
  return true;
}

function pick<T>(rand: () => number, items: readonly T[]): T {
  return items[Math.floor(rand() * items.length)];
}

describe("fuzz: command -> patch -> inverse round-trips", () => {
  test("random command sequences preserve invariants and invert cleanly", () => {
    for (let seed = 1; seed <= 5; seed++) {
      const rand = mulberry32(seed * 1337);
      let graph = randomGraph(rand);
      let accepted = 0;

      for (let step = 0; step < 120; step++) {
        const allIds = [...graph.nodesById.keys()];
        const collections = allIds.filter(
          (id) => graph.nodesById.get(id)?.kind === "collection"
        );
        const mediaIds = allIds.filter((id) => graph.nodesById.get(id)?.kind === "media");
        const nonRoots = allIds.filter((id) => graph.parentById.get(id) !== null);

        const roll = rand();
        let command: CollectionsCommand;
        if (roll < 0.2) {
          command = {
            type: "add-nodes",
            nodes: [
              {
                id: parseNodeId(`fz${seed}-${step}`),
                kind: "media",
                name: "fz",
                durationSeconds: 2,
              },
            ],
            toParentId: pick(rand, collections),
            toIndex: Math.floor(rand() * 8),
          };
        } else if (roll < 0.35 && mediaIds.length > 0) {
          // Data mutation: retrim a random image (all fuzz media are images).
          // Exercises the nodes-updated patch's invert round-trip.
          command = {
            type: "update-media",
            nodeId: pick(rand, mediaIds),
            update: { mediaKind: "image", durationSeconds: 1 + Math.floor(rand() * 9) },
          };
        } else {
          // Duplicates, descendants-of-dragged, and cycle targets all occur
          // naturally — the rejection paths are part of the property.
          const count = 1 + Math.floor(rand() * 3);
          const nodeIds: NodeId[] = [];
          for (let i = 0; i < count; i++) nodeIds.push(pick(rand, nonRoots));
          command = {
            type: "move-nodes",
            nodeIds,
            toParentId: pick(rand, collections),
            toIndex: Math.floor(rand() * 8),
          };
        }

        const result = applyCommand(graph, command);
        if (!result.ok) continue;
        accepted += 1;

        const next = result.value.graph;
        expect(findGraphInvariantViolation(next)).toBeNull();

        const undone = applyPatch(next, invertPatch(result.value.patch));
        expect(findGraphInvariantViolation(undone)).toBeNull();
        expect(childrenEqual(undone, graph)).toBe(true);
        expect(undone.nodesById.size).toBe(graph.nodesById.size);
        // Node DATA is restored too: undo re-inserts the original node objects
        // (a patch stores the pre-state node), so every id maps to the same
        // reference — catches a broken update/add/remove that leaves stale data.
        for (const [id, node] of graph.nodesById) {
          expect(undone.nodesById.get(id)).toBe(node);
        }

        const redone = applyPatch(undone, result.value.patch);
        expect(findGraphInvariantViolation(redone)).toBeNull();
        expect(childrenEqual(redone, next)).toBe(true);

        graph = next; // evolve — later steps fuzz arbitrary reachable states
      }

      // Sanity: the fuzz actually exercised the accept path.
      expect(accepted).toBeGreaterThan(20);
    }
  });
});
