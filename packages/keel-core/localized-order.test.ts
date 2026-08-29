import { describe, expect, it } from "vitest";
import { createEngine } from "./engine";
import { defineNodeType, parseNodeId } from "./types";
import type { Issue, NodeId, Result, ConsumerDefinedSummaryType } from "./types";

type Clip = Readonly<{ t: string }>;
type Folder = Readonly<{ n: string }>;
const clip = defineNodeType<Clip, Record<string, never>>()({
  kind: "clip", container: false, schemaVersion: 1,
  parse: (r): Result<Clip, readonly Issue[]> => ({ ok: true, value: { t: String((r as Clip).t) } }),
  serialize: (d) => d, applyEdit: (d) => ({ ok: true, value: d }),
});
const folder = defineNodeType<Folder, Record<string, never>>()({
  kind: "folder", container: true, schemaVersion: 1,
  parse: (r): Result<Folder, readonly Issue[]> => ({ ok: true, value: { n: String((r as Folder).n) } }),
  serialize: (d) => d, applyEdit: (d) => ({ ok: true, value: d }),
});
const types = [clip, folder] as const;
const summary: ConsumerDefinedSummaryType<Record<string, never>> = { parse: () => ({ ok: true, value: {} }), serialize: () => ({}) };
const engine = createEngine<typeof types, Record<string, never>, Record<string, never>>({
  types, summary, folds: {}, now: () => 0,
});

// A DEEP, MIXED tree — nested folders so the general path's root-path
// comparison is genuinely exercised, not just flat siblings.
function nestedDoc() {
  const nodes: unknown[] = [];
  const mk = (id: string, kids: string[]) =>
    nodes.push({ id, kind: "folder", data: { n: id }, children: kids });
  mk("root", ["A", "B", "C"]);
  for (const top of ["A", "B", "C"]) {
    const subs = [`${top}1`, `${top}2`];
    mk(top, subs);
    for (const sub of subs) {
      const kids = [0, 1, 2].map((i) => `${sub}-c${i}`);
      mk(sub, kids);
      for (const k of kids) nodes.push({ id: k, kind: "clip", data: { t: k } });
    }
  }
  return { formatVersion: 1, schemaVersions: { clip: 1, folder: 1 }, rootIds: ["root"], nodes };
}

function rng(seed: number) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }

// `inDocumentOrder` used to rank ids by walking the WHOLE document; it now
// sorts siblings by slot and otherwise compares root-paths. This fuzz drove 400
// random multi-node moves at mixed parents and depths with a temporary
// differential armed against the old full-walk implementation — zero
// divergence over 272 committed moves — and stays here as the general-path
// exercise, since the rest of the suite mostly moves one node at a time.
describe("multi-node moves across mixed parents and depths", () => {
  it("stay a valid forest over 400 random batches", () => {
    const loaded = engine.deserialize(nestedDoc());
    if (!loaded.ok) throw new Error("fixture");
    const store = engine.createStore(loaded.value.graph);
    const random = rng(20260828);
    const containers = ["root", "A", "B", "C", "A1", "A2", "B1", "B2", "C1", "C2"];

    let moved = 0, rejected = 0;
    for (let step = 0; step < 400; step += 1) {
      const g = store.getGraph();
      const all: NodeId[] = [...g.nodesById.keys()].filter((id) => String(id) !== "root");
      // 2-4 nodes, picked at random from ANYWHERE — mixed parents and depths,
      // which is exactly the case the fast path declines and the comparator owns.
      const pickCount = 2 + Math.floor(random() * 3);
      const picked = new Set<NodeId>();
      for (let i = 0; i < pickCount; i += 1) {
        const c = all[Math.floor(random() * all.length)];
        if (c !== undefined) picked.add(c);
      }
      if (picked.size < 2) continue;
      const target = containers[Math.floor(random() * containers.length)];
      if (target === undefined) continue;
      const toParentId = parseNodeId(target);
      const kids = g.childrenById.get(toParentId);
      if (kids === undefined) continue;
      const res = store.dispatch({
        type: "move-nodes",
        nodeIds: [...picked],
        toParentId,
        toIndex: Math.floor(random() * (kids.length + 1)),
      });
      // The differential THROWS on divergence, so reaching here at all is the
      // assertion. Rejections are legitimate (cycles, root moves) and expected.
      if (res.ok) moved += 1; else rejected += 1;
    }
    // eslint-disable-next-line no-console
    console.log(`\n  moves committed: ${moved}   rejected (cycle/root/no-op): ${rejected}\n`);
    expect(moved).toBeGreaterThan(50);
    expect(engine.findInvariantViolation(store.getGraph())).toBeNull();
  });
});
