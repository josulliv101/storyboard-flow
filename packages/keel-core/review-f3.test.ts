// F3 regression — the `maxNodes` ceiling must actually be FIRST.
//
// serialize.ts claims, at the size bound in `buildDocument`:
//   "The size bound, before anything is allocated"
//   "FIRST, and it has to be first to be worth having. Every pass below builds
//    a map sized by `doc.nodes`, so a check that ran after even one of them
//    would be reporting a document too large from inside the allocation it was
//    supposed to prevent."
//
// `buildDocument` calls `parseSerializedDocument(raw)` on the line ABOVE the
// bound. That function walks every element of `raw.nodes`, validates each one,
// and CONSTRUCTS a fresh `NodeDraft` per node (plus a fresh copy of each
// `children` array). So "before anything is allocated" is a claim about code
// that runs after an O(n) validate-and-copy pass.
//
// The pre-existing "checks size BEFORE anything else it could fail on" in
// serialize.test.ts only proves the check precedes Pass A's duplicate-id map;
// it never reaches `parseSerializedDocument`. These tests measure that gap,
// they do not read it.
import { describe, expect, it } from "vitest";

import {
  DEFAULT_MAX_NODES,
  deserializeDocument,
  loadChildrenInto,
  parseSerializedDocument,
} from "./serialize";
import { createEngine } from "./engine";
import {
  defineNodeType,
  parseNodeId,
  type EngineContext,
  type Graph,
  type Issue,
  type NodeId,
  type ParseCtx,
  type Result,
  type SerializedNode,
  type SummaryCodec,
} from "./types";
import { buildRegistry } from "./graph";

// ---------------------------------------------------------------------------
// Fixtures (shape copied from serialize.test.ts / engine.test.ts)
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type Clip = Readonly<{ name: string }>;
type ClipEdit = Readonly<{ name: string }>;

const clipType = defineNodeType<Clip, ClipEdit>()({
  kind: "clip",
  container: false,
  schemaVersion: 1,
  parse(raw: unknown, _ctx: ParseCtx): Result<Clip, readonly Issue[]> {
    if (!isRecord(raw) || typeof raw.name !== "string") {
      return { ok: false, error: [{ path: "$.name", message: "name" }] };
    }
    return { ok: true, value: { name: raw.name } };
  },
  serialize(data: Clip): unknown {
    return { name: data.name };
  },
  applyEdit(_data: Clip, edit: ClipEdit): Result<Clip, never> {
    return { ok: true, value: { name: edit.name } };
  },
});

type Folder = Readonly<{ title: string }>;
type FolderEdit = Readonly<{ title: string }>;

const folderType = defineNodeType<Folder, FolderEdit>()({
  kind: "folder",
  container: true,
  schemaVersion: 1,
  parse(raw: unknown, _ctx: ParseCtx): Result<Folder, readonly Issue[]> {
    if (!isRecord(raw) || typeof raw.title !== "string") {
      return { ok: false, error: [{ path: "$.title", message: "title" }] };
    }
    return { ok: true, value: { title: raw.title } };
  },
  serialize(data: Folder): unknown {
    return { title: data.title };
  },
  applyEdit(_data: Folder, edit: FolderEdit): Result<Folder, never> {
    return { ok: true, value: { title: edit.title } };
  },
});

const TYPES = [clipType, folderType] as const;
type Types = typeof TYPES;

type Summary = Readonly<{ count: number }>;

const summaryCodec: SummaryCodec<Summary> = {
  parse(raw: unknown): Result<Summary, readonly Issue[]> {
    if (!isRecord(raw) || typeof raw.count !== "number") {
      return { ok: false, error: [{ path: "$.count", message: "count" }] };
    }
    return { ok: true, value: { count: raw.count } };
  },
  serialize(value: Summary): unknown {
    return { count: value.count };
  },
};

const ENGINE_ID = Symbol("keel-f3-probe");

function makeCtx(
  overrides: Partial<EngineContext<Summary>> = {},
): EngineContext<Summary> {
  return {
    engineId: ENGINE_ID,
    registry: buildRegistry(TYPES),
    summary: summaryCodec,
    onUnknownKind: "quarantine",
    onParseFailure: "quarantine",
    maxNodes: DEFAULT_MAX_NODES,
    maxDepth: null,
    mintId: () => "minted",
    now: () => 0,
    devChecks: false,
    ...overrides,
  };
}

function expectErr<T, E>(result: Result<T, E>): E {
  if (result.ok) {
    throw new Error(`expected an error, got ok`);
  }
  return result.error;
}

/**
 * An oversized document whose node objects COUNT being looked at.
 *
 * Each node exposes `id` as a getter that flips a per-node flag the first time
 * it is read. `counter.touched` is therefore the number of DISTINCT nodes the
 * engine inspected — not property reads, so it cannot be inflated by the
 * validator happening to read `id` twice.
 */
function countingDoc(
  count: number,
  counter: { touched: number },
): Readonly<Record<string, unknown>> {
  const kidIds = Array.from({ length: count - 1 }, (_, i) => `c${i}`);
  const nodes: unknown[] = [
    { id: "root", kind: "folder", data: { title: "root" }, children: kidIds },
  ];
  for (let i = 0; i < count - 1; i += 1) {
    const nodeId = `c${i}`;
    let seen = false;
    nodes.push({
      get id(): string {
        if (!seen) {
          seen = true;
          counter.touched += 1;
        }
        return nodeId;
      },
      kind: "clip",
      data: { name: nodeId },
    });
  }
  return { formatVersion: 1, rootIds: ["root"], nodes };
}

/** The same shape, plain objects, for allocation/timing measurement. */
function flatDoc(count: number): Readonly<Record<string, unknown>> {
  const kidIds = Array.from({ length: count - 1 }, (_, i) => `c${i}`);
  const nodes: SerializedNode[] = [
    { id: "root", kind: "folder", data: { title: "root" }, children: kidIds },
  ];
  for (const kid of kidIds) {
    nodes.push({ id: kid, kind: "clip", data: { name: kid } });
  }
  return { formatVersion: 1, rootIds: ["root"], nodes };
}

const HOSTILE = 200_000;
const CEILING = 10;

// ---------------------------------------------------------------------------
// F3
// ---------------------------------------------------------------------------

describe("the size bound runs before the document is normalised", () => {
  it("touches ZERO nodes of an oversized document before refusing it", () => {
    const counter = { touched: 0 };
    const doc = countingDoc(HOSTILE, counter);
    // Building the fixture must not itself have read anything.
    expect(counter.touched).toBe(0);

    const started = performance.now();
    const error = expectErr(
      deserializeDocument<Types, Summary>(doc, makeCtx({ maxNodes: CEILING })),
    );
    const elapsed = performance.now() - started;

    expect(error.code).toBe("document-too-large");

    // eslint-disable-next-line no-console
    console.log(
      `[F3] deserializeDocument refused ${HOSTILE} nodes at maxNodes=${CEILING} ` +
        `after inspecting ${counter.touched} of them, in ${elapsed.toFixed(1)} ms`,
    );

    // The claim under test: "before anything is allocated", "FIRST".
    // `doc.nodes` is a flat array whose `.length` is known in O(1), so a bound
    // that ran before `parseSerializedDocument` would inspect nothing at all.
    expect(counter.touched).toBe(0);
  });

  it("costs no more to refuse an oversized document than an unreadable one", () => {
    // The control: `formatVersion` IS checked before the node loop, so refusing
    // on it is the price of a bound that is genuinely first. Anything the size
    // bound costs above this is work the ceiling was supposed to prevent.
    const big = flatDoc(HOSTILE);
    const wrongVersion = { ...flatDoc(HOSTILE), formatVersion: 99 };
    const ctx = makeCtx({ maxNodes: CEILING });

    // Warm both paths so this is not measuring first-call JIT.
    deserializeDocument<Types, Summary>(flatDoc(1_000), makeCtx({ maxNodes: CEILING }));
    deserializeDocument<Types, Summary>(
      { ...flatDoc(1_000), formatVersion: 99 },
      makeCtx({ maxNodes: CEILING }),
    );

    const t0 = performance.now();
    const versionError = expectErr(
      deserializeDocument<Types, Summary>(wrongVersion, ctx),
    );
    const controlMs = performance.now() - t0;

    const t1 = performance.now();
    const sizeError = expectErr(deserializeDocument<Types, Summary>(big, ctx));
    const sizeMs = performance.now() - t1;

    expect(versionError.code).toBe("unsupported-format-version");
    expect(sizeError.code).toBe("document-too-large");

    // eslint-disable-next-line no-console
    console.log(
      `[F3] refusing ${HOSTILE} nodes: formatVersion (genuinely first) ` +
        `${controlMs.toFixed(2)} ms vs size bound ${sizeMs.toFixed(2)} ms ` +
        `(${(sizeMs / Math.max(controlMs, 0.001)).toFixed(0)}x)`,
    );

    // A bound that is first costs the same as the check that really is first.
    // The 1 ms floor keeps this from being a timing race once it passes: after
    // the fix the size refusal is a single `.length` read.
    expect(sizeMs).toBeLessThan(Math.max(controlMs * 5, 1));
  });


  it("is reachable through the public engine surface, not just the module", () => {
    const counter = { touched: 0 };
    const doc = countingDoc(HOSTILE, counter);

    const engine = createEngine({
      types: TYPES,
      summary: summaryCodec,
      folds: {},
      maxNodes: CEILING,
    });

    const result = engine.deserialize(doc);
    expect(result.ok).toBe(false);

    // eslint-disable-next-line no-console
    console.log(
      `[F3] engine.deserialize() inspected ${counter.touched} nodes before refusing`,
    );

    expect(counter.touched).toBe(0);
  });

  it("does the same on the lazy-load door", () => {
    // The more exposed door: `loadChildrenInto`'s `doc` is documented as
    // `unknown` precisely because it came from IO.
    const engine = createEngine({
      types: TYPES,
      summary: summaryCodec,
      folds: {},
      maxNodes: CEILING,
    });

    const base = engine.deserialize({
      formatVersion: 1,
      rootIds: ["root"],
      nodes: [
        { id: "root", kind: "folder", data: { title: "root" }, children: ["box"] },
        { id: "box", kind: "folder", data: { title: "box" }, childrenState: "unloaded" },
      ],
    });
    if (!base.ok) throw new Error("base document should load");

    const counter = { touched: 0 };
    const payload = countingDoc(HOSTILE, counter);

    const boxId: NodeId = parseNodeId("box");
    const graph = base.value.graph as Graph<Types, Summary>;
    const loaded = loadChildrenInto<Types, Summary>(
      graph,
      boxId,
      payload,
      makeCtx({ engineId: graph.engineId, maxNodes: CEILING }),
    );
    expect(loaded.ok).toBe(false);

    // eslint-disable-next-line no-console
    console.log(
      `[F3] loadChildrenInto() inspected ${counter.touched} nodes before refusing`,
    );

    expect(counter.touched).toBe(0);
  });
});
