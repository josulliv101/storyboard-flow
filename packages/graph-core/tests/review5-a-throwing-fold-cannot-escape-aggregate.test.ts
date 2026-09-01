// Fifth review round — the last consumer hook family called with no guard.
//
// review3 established the rule — "dispatch promises a `Result`. A node type that
// throws ... turned that into an unhandled exception out of a React event
// handler, at every call site that correctly wrote `if (!result.ok)`" — and
// review4 closed the last two key hooks with `KeyHookFailure`. By then every
// consumer callback in the package was contained: listeners through
// `notifyOne`, `parse` / `serialize` / `applyEdit` each at their own door, and
// even the dev-only shadow refold wraps its own `computeFold` call.
//
// A fold's five hooks were not. `computeFold` called `fold.sealed`, `fold.leaf`,
// `fold.missing`, `fold.placeholder` and `fold.collection` bare, and `aggregate`
// is the one read path React runs during RENDER — once per mounted card.
// Measured before this: `store.aggregate` threw "fold collection exploded" and
// returned nothing.
//
// `undefined` IS the answer here, not a rejection. `Folded<A>`'s `A` is the
// consumer's own type and this module cannot manufacture a value of it, so there
// is nothing to hand back but "no answer" — a case every caller already handles,
// because a card outliving its node by a frame produces it on every removal.
// What must not happen is a throw.
//
// THE WHOLE WALK IS ABANDONED rather than the failing node dropped. Folding on
// past it would hand the parent a subtree with a hole in it and report the total
// as `exact` — a wrong number that looks right, which is the failure the shadow
// cold refold exists to catch.
import { describe, expect, it, vi } from "vitest";

import {
  type ConsumerDefinedFold,
  type ConsumerDefinedSummaryType,
  type Issue,
  type NodeId,
  type Result,
  defineNodeType,
  parseNodeId,
} from "../types";
import { createEngine } from "../engine";

/** Which hook detonates, and optionally on which node only. */
const explode: { hook: string | null; onNode: string | null } = {
  hook: null,
  onNode: null,
};

function reset(): void {
  explode.hook = null;
  explode.onNode = null;
}

function detonate(hook: string, nodeId: string): void {
  if (
    explode.hook === hook &&
    (explode.onNode === null || explode.onNode === nodeId)
  ) {
    throw new Error(`fold ${hook} exploded`);
  }
}

type Folder = Readonly<{ name: string }>;
type FolderEdit = Readonly<{ name?: string }>;

const folderType = defineNodeType<Folder, FolderEdit>()({
  kind: "folder",
  container: true,
  schemaVersion: 1,
  parse(raw): Result<Folder, readonly Issue[]> {
    if (typeof raw !== "object" || raw === null) {
      return { ok: false, error: [{ path: "$", message: "not an object" }] };
    }
    const name = ({ ...raw } as Record<string, unknown>)["name"];
    if (typeof name !== "string") {
      return { ok: false, error: [{ path: "$.name", message: "name" }] };
    }
    return { ok: true, value: { name } };
  },
  serialize(data): unknown {
    return { name: data.name };
  },
  applyEdit(data, edit) {
    return { ok: true, value: { ...data, name: edit.name ?? data.name } };
  },
});

type Clip = Readonly<{ title: string }>;
type ClipEdit = Readonly<{ title?: string }>;

const clipType = defineNodeType<Clip, ClipEdit>()({
  kind: "clip",
  container: false,
  schemaVersion: 1,
  parse(raw): Result<Clip, readonly Issue[]> {
    if (typeof raw !== "object" || raw === null) {
      return { ok: false, error: [{ path: "$", message: "not an object" }] };
    }
    const title = ({ ...raw } as Record<string, unknown>)["title"];
    if (typeof title !== "string") {
      return { ok: false, error: [{ path: "$.title", message: "title" }] };
    }
    return { ok: true, value: { title } };
  },
  serialize(data): unknown {
    return { title: data.title };
  },
  applyEdit(data, edit) {
    return { ok: true, value: { ...data, title: edit.title ?? data.title } };
  },
});

const types = [clipType, folderType] as const;
type Types = typeof types;
type Summary = Readonly<{ n: number }>;

const summary: ConsumerDefinedSummaryType<Summary> = {
  parse(raw): Result<Summary, readonly Issue[]> {
    if (typeof raw !== "object" || raw === null) {
      return { ok: false, error: [{ path: "$", message: "not an object" }] };
    }
    const n = ({ ...raw } as Record<string, unknown>)["n"];
    if (typeof n !== "number") {
      return { ok: false, error: [{ path: "$.n", message: "n" }] };
    }
    return { ok: true, value: { n } };
  },
  serialize(value): unknown {
    return { n: value.n };
  },
};

/** Counts live nodes. Any one of its five hooks can be made to throw. */
const sizeFold: ConsumerDefinedFold<Types, Summary, number> = {
  key: "size",
  leaf(node) {
    detonate("leaf", node.id);
    return 1;
  },
  collection(node, children) {
    detonate("collection", node.id);
    let total = 1;
    for (const child of children) total += child.value;
    return { value: total, certainty: "exact" };
  },
  placeholder(node) {
    detonate("placeholder", node.id);
    return { value: 0, certainty: "partial" };
  },
  missing(node) {
    detonate("missing", node.id);
    return { value: 0, certainty: "partial" };
  },
  sealed(node) {
    detonate("sealed", node.id);
    return { value: 0, certainty: "partial" };
  },
};

type Folds = { size: typeof sizeFold };

// root -> box -> (c1, c2), plus an unloaded container, a missing one, and a
// node of a kind nothing registers — so all five hooks are on one walk.
// `onUnknownKind` defaults to "seal", which is what puts `sealed` there.
const doc = {
  formatVersion: 1 as const,
  schemaVersions: { folder: 1, clip: 1 },
  rootIds: ["root"],
  nodes: [
    {
      id: "root",
      kind: "folder",
      data: { name: "R" },
      children: ["box", "lazy", "gone", "odd"],
    },
    { id: "box", kind: "folder", data: { name: "B" }, children: ["c1", "c2"] },
    { id: "c1", kind: "clip", data: { title: "One" } },
    { id: "c2", kind: "clip", data: { title: "Two" } },
    {
      id: "lazy",
      kind: "folder",
      data: { name: "L" },
      childrenState: "unloaded" as const,
    },
    {
      id: "gone",
      kind: "folder",
      data: { name: "G" },
      childrenState: "missing" as const,
    },
    // No node type claims "mystery", so ingress seals it and `fold.sealed`
    // answers for it.
    { id: "odd", kind: "mystery", data: { anything: true } },
  ],
};

function makeStore() {
  reset();
  const engine = createEngine<Types, Summary, Folds>({
    types,
    summary,
    folds: { size: sizeFold },
  });
  const loaded = engine.deserialize(doc);
  if (!loaded.ok) throw new Error("fixture failed to load");
  return { engine, store: engine.createStore(loaded.value.graph) };
}

const rootId = parseNodeId("root");

/** root + box + c1 + c2. `lazy`, `gone` and `odd` each contribute 0, through
 *  `placeholder`, `missing` and `sealed` respectively. */
const HEALTHY_TOTAL = 4;

describe("a throwing fold hook refuses rather than escaping", () => {
  for (const hook of [
    "leaf",
    "collection",
    "placeholder",
    "missing",
    "sealed",
  ] as const) {
    it(`store.aggregate answers undefined when ${hook} throws, and does not throw`, () => {
      const { store } = makeStore();
      const logged = vi.spyOn(console, "error").mockImplementation(() => {});
      explode.hook = hook;

      let thrown: unknown = null;
      let answer: unknown = "unset";
      try {
        answer = store.aggregate("size", rootId);
      } catch (caught) {
        thrown = caught;
      }
      reset();
      const messages = logged.mock.calls.map((call) => String(call[0])).join("\n");
      logged.mockRestore();

      expect(thrown).toBeNull();
      expect(answer).toBeUndefined();
      // Reported, never silent: `undefined` otherwise means both "the node is
      // gone" and "your fold crashed", and those need different fixes. The line
      // names the hook and the fold key so the consumer can find it.
      expect(messages).toContain(hook);
      expect(messages).toContain("size");
    });
  }

  it("the engine-level aggregate is guarded too, not only the store's", () => {
    const { engine, store } = makeStore();
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    explode.hook = "collection";

    let thrown: unknown = null;
    let answer: unknown = "unset";
    try {
      answer = engine.aggregate(store.getGraph(), "size", rootId);
    } catch (caught) {
      thrown = caught;
    }
    reset();
    logged.mockRestore();

    expect(thrown).toBeNull();
    expect(answer).toBeUndefined();
  });

  it("abandons the whole walk rather than folding on past the hole", () => {
    // Only `box` throws. The root must NOT come back with a total that silently
    // omits box's subtree — a wrong number reported as `exact` is worse than no
    // number, and is precisely what the shadow cold refold exists to catch.
    const { store } = makeStore();
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    explode.hook = "collection";
    explode.onNode = "box";

    const answer = store.aggregate("size", rootId);
    reset();
    logged.mockRestore();

    expect(answer).toBeUndefined();
  });

  it("a later read succeeds once the fold stops throwing", () => {
    // The failure is not latched, and the entries committed before the throw are
    // correct values keyed by their own `(fold.key, id, rev)` — so recovery is a
    // plain re-read rather than anything the consumer has to reset.
    const { store } = makeStore();
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    explode.hook = "collection";
    explode.onNode = "box";
    expect(store.aggregate("size", rootId)).toBeUndefined();
    reset();
    logged.mockRestore();

    const answer = store.aggregate("size", rootId);
    expect(answer).not.toBeUndefined();
    expect(answer?.value).toBe(HEALTHY_TOTAL);
  });

  it("a genuine engine bug is NOT swallowed as a fold failure", () => {
    // The catch is `instanceof` a private tag, never bare. A throw that is not
    // that tag must keep crashing as itself — otherwise a bug inside this
    // package is reported as the consumer's fault and hidden behind an
    // `undefined` nobody can act on. The same guarantee
    // `review4-a-throwing-key-hook-cannot-escape-either` pins for `KeyHookFailure`.
    const { store } = makeStore();
    const graph = store.getGraph();
    const children = graph.childrenById;
    const original = children.get.bind(children);
    let armed = true;
    const patched = (key: NodeId): readonly NodeId[] | undefined => {
      if (armed && (key as string) === "box") {
        armed = false;
        throw new Error("engine bug, not a fold");
      }
      return original(key);
    };
    (children as { get: typeof patched }).get = patched;

    expect(() => store.aggregate("size", rootId)).toThrow("engine bug, not a fold");

    (children as { get: typeof original }).get = original;
  });

  it("a fold that behaves is completely unaffected", () => {
    const { store } = makeStore();
    const answer = store.aggregate("size", rootId);
    expect(answer?.value).toBe(HEALTHY_TOTAL);
    // `exact`, not `partial`, and the distinction is worth pinning: weakest-wins
    // is `foldMonoid`'s behaviour, not the evaluator's. A hand-written
    // `ConsumerDefinedFold` declares its own certainty, and this one's
    // `collection` says `exact` unconditionally — so `lazy` and `gone` answering
    // `partial` does not propagate. Nothing in this round changes that; it is
    // asserted so a future guard cannot quietly start rewriting certainty.
    expect(answer?.certainty).toBe("exact");
  });
});
