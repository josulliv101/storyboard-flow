// KEEL — the four `devChecks` audits, each with a codec built to violate it.
//
// `EngineContext.devChecks` named four audits and implemented NONE of them
// (#590), so the whole risk in fixing it is shipping four audits that cannot
// fire. Every describe block below pairs a VIOLATING fixture with a CONFORMING
// one: the first proves the check works, the second proves it is not simply
// shouting at everything.
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  defineNodeType,
  parseNodeId,
  type Issue,
  type Result,
  type SummaryCodec,
} from "./types";
import { foldMonoid } from "./folds";
import { createEngine } from "./engine";

type Summary = Readonly<{ seconds: number }>;
const summary: SummaryCodec<Summary> = {
  parse(raw): Result<Summary, readonly Issue[]> {
    if (typeof raw !== "object" || raw === null) {
      return { ok: false, error: [{ path: "$", message: "x" }] };
    }
    const record: Record<string, unknown> = { ...raw };
    const seconds = record["seconds"];
    if (typeof seconds !== "number") {
      return { ok: false, error: [{ path: "$.seconds", message: "seconds" }] };
    }
    return { ok: true, value: { seconds } };
  },
  serialize(value): unknown {
    return { seconds: value.seconds };
  },
};

const folder = defineNodeType<Readonly<{ name: string }>, Readonly<{ name?: string }>>()({
  kind: "folder",
  container: true,
  schemaVersion: 1,
  parse(raw): Result<Readonly<{ name: string }>, readonly Issue[]> {
    if (typeof raw !== "object" || raw === null) {
      return { ok: false, error: [{ path: "$", message: "x" }] };
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
    return { ok: true, value: { name: edit.name ?? data.name } };
  },
});

afterEach(() => {
  vi.restoreAllMocks();
});

function errors() {
  return vi.spyOn(console, "error").mockImplementation(() => undefined);
}

function messagesFrom(spy: ReturnType<typeof errors>): string {
  return spy.mock.calls.map((call) => String(call[0] ?? "")).join("\n");
}

/** root -> one clip. `data` is whatever the caller's codec wants. */
function docWith(clipData: unknown) {
  return {
    formatVersion: 1,
    schemaVersions: { clip: 1, folder: 1 },
    rootIds: ["root"],
    nodes: [
      { id: "root", kind: "folder", data: { name: "R" }, children: ["c1"] },
      { id: "c1", kind: "clip", data: clipData },
    ],
  };
}

// ---------------------------------------------------------------------------
// 1. DEEP-FREEZING PARSED VALUES
// ---------------------------------------------------------------------------

describe("parsed values are frozen under devChecks", () => {
  /**
   * A codec that normalises IN PLACE during serialize — a real performance
   * idiom, and precisely the class the reducer already wraps in try/catch. The
   * engine stores what `parse` returned, so a `serialize` that edits its
   * argument is quietly rewriting stored state from a method contracted to read.
   */
  const mutating = defineNodeType<
    Readonly<{ title: string }>,
    Readonly<{ title?: string }>
  >()({
    kind: "clip",
    container: false,
    schemaVersion: 1,
    parse(raw): Result<Readonly<{ title: string }>, readonly Issue[]> {
      if (typeof raw !== "object" || raw === null) {
        return { ok: false, error: [{ path: "$", message: "x" }] };
      }
      const title = ({ ...raw } as Record<string, unknown>)["title"];
      if (typeof title !== "string") {
        return { ok: false, error: [{ path: "$.title", message: "title" }] };
      }
      return { ok: true, value: { title } };
    },
    serialize(data): unknown {
      // THE VIOLATION. Frozen, this throws; unfrozen, it silently edits the
      // value the engine is about to store.
      (data as { title: string }).title = data.title.trim();
      return { title: data.title };
    },
    applyEdit(data, edit) {
      return { ok: true, value: { title: edit.title ?? data.title } };
    },
  });

  it("reports a serialize that mutates its argument, and still loads", () => {
    const engine = createEngine<readonly [typeof mutating, typeof folder], Summary, {}>({
      types: [mutating, folder],
      summary,
      folds: {},
      devChecks: true,
    });
    const spy = errors();
    const loaded = engine.deserialize(docWith({ title: "  spaced  " }));
    expect(loaded.ok).toBe(true);
    expect(spy).toHaveBeenCalled();
    // Reported, never thrown, and never turned into a quarantine: a document
    // that loads clean with the flag off must load clean with it on.
    expect(messagesFrom(spy)).toContain("keel dev check");
  });

  it("stays silent, and does not freeze, with devChecks off", () => {
    const engine = createEngine<readonly [typeof mutating, typeof folder], Summary, {}>({
      types: [mutating, folder],
      summary,
      folds: {},
    });
    const spy = errors();
    expect(engine.deserialize(docWith({ title: "  spaced  " })).ok).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });

  it("does not throw on a codec that returns a typed array", () => {
    // THE REGRESSION THIS GUARD EXISTS FOR. `Object.freeze` on a TypedArray
    // with elements throws, so without the `ArrayBuffer.isView` skip, turning
    // devChecks on takes the ingress door down for a conforming consumer.
    const binary = defineNodeType<
      Readonly<{ bytes: Uint8Array }>,
      Readonly<{ bytes?: Uint8Array }>
    >()({
      kind: "clip",
      container: false,
      schemaVersion: 1,
      parse(): Result<Readonly<{ bytes: Uint8Array }>, readonly Issue[]> {
        return { ok: true, value: { bytes: new Uint8Array([1, 2, 3]) } };
      },
      serialize(): unknown {
        return { bytes: [1, 2, 3] };
      },
      applyEdit(data) {
        return { ok: true, value: data };
      },
    });
    const engine = createEngine<readonly [typeof binary, typeof folder], Summary, {}>({
      types: [binary, folder],
      summary,
      folds: {},
      devChecks: true,
    });
    errors();
    expect(() => engine.deserialize(docWith({ bytes: [1, 2, 3] }))).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 2. parse(serialize(d)) ROUND-TRIP
// ---------------------------------------------------------------------------

/** Parses two fields, serializes ONE. The classic lossy codec. */
const lossy = defineNodeType<
  Readonly<{ title: string; note: string }>,
  Readonly<{ title?: string }>
>()({
  kind: "clip",
  container: false,
  schemaVersion: 1,
  parse(raw): Result<Readonly<{ title: string; note: string }>, readonly Issue[]> {
    if (typeof raw !== "object" || raw === null) {
      return { ok: false, error: [{ path: "$", message: "x" }] };
    }
    const record = { ...raw } as Record<string, unknown>;
    const title = record["title"];
    const note = record["note"];
    if (typeof title !== "string") {
      return { ok: false, error: [{ path: "$.title", message: "title" }] };
    }
    return { ok: true, value: { title, note: typeof note === "string" ? note : "" } };
  },
  serialize(data): unknown {
    // THE VIOLATION: `note` is parsed, stored, and then dropped on the way out.
    // Every save of this document silently loses it.
    return { title: data.title };
  },
  applyEdit(data, edit) {
    return { ok: true, value: { ...data, title: edit.title ?? data.title } };
  },
});

/** Normalises on parse. Conforming, and the false-alarm floor. */
const trimming = defineNodeType<
  Readonly<{ title: string }>,
  Readonly<{ title?: string }>
>()({
  kind: "clip",
  container: false,
  schemaVersion: 1,
  parse(raw): Result<Readonly<{ title: string }>, readonly Issue[]> {
    if (typeof raw !== "object" || raw === null) {
      return { ok: false, error: [{ path: "$", message: "x" }] };
    }
    const title = ({ ...raw } as Record<string, unknown>)["title"];
    if (typeof title !== "string") {
      return { ok: false, error: [{ path: "$.title", message: "title" }] };
    }
    return { ok: true, value: { title: title.trim() } };
  },
  serialize(data): unknown {
    return { title: data.title };
  },
  applyEdit(data, edit) {
    return { ok: true, value: { title: edit.title ?? data.title } };
  },
});

describe("the round trip catches a lossy serialize", () => {
  it("reports at the ingress door", () => {
    const engine = createEngine<readonly [typeof lossy, typeof folder], Summary, {}>({
      types: [lossy, folder],
      summary,
      folds: {},
      devChecks: true,
    });
    const spy = errors();
    expect(engine.deserialize(docWith({ title: "a", note: "dropped" })).ok).toBe(true);
    expect(messagesFrom(spy)).toContain("round trip");
    expect(messagesFrom(spy)).toContain("clip");
  });

  it("stays silent for a NORMALISING codec — the false-alarm floor", () => {
    // A raw-vs-reserialized comparison would report a violation here on a
    // perfectly correct codec, which is why both halves of the comparison must
    // be parse OUTPUTS. `{title:"  a  "}` parses to `{title:"a"}`, and `"a"`
    // round-trips to itself.
    const engine = createEngine<readonly [typeof trimming, typeof folder], Summary, {}>({
      types: [trimming, folder],
      summary,
      folds: {},
      devChecks: true,
    });
    const spy = errors();
    expect(engine.deserialize(docWith({ title: "  a  " })).ok).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });

  it("reports at the EDIT door too", () => {
    const engine = createEngine<readonly [typeof lossy, typeof folder], Summary, {}>({
      types: [lossy, folder],
      summary,
      folds: {},
      devChecks: true,
    });
    const loaded = engine.deserialize(docWith({ title: "a", note: "dropped" }));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const store = engine.createStore(loaded.value.graph);
    const spy = errors();
    const result = store.dispatch({
      type: "edit-nodes",
      edits: [{ nodeId: parseNodeId("c1"), kind: "clip", edit: { title: "b" } }],
    });
    expect(result.ok).toBe(true);
    expect(spy).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 3. THE OPT-IN invertEdit
// ---------------------------------------------------------------------------

function clipWithInverse(
  invertEdit: ((edit: Readonly<{ by: number }>, before: Readonly<{ n: number }>) => Readonly<{ by: number }>) | undefined,
) {
  return defineNodeType<Readonly<{ n: number }>, Readonly<{ by: number }>>()({
    kind: "clip",
    container: false,
    schemaVersion: 1,
    parse(raw): Result<Readonly<{ n: number }>, readonly Issue[]> {
      if (typeof raw !== "object" || raw === null) {
        return { ok: false, error: [{ path: "$", message: "x" }] };
      }
      const n = ({ ...raw } as Record<string, unknown>)["n"];
      if (typeof n !== "number") {
        return { ok: false, error: [{ path: "$.n", message: "n" }] };
      }
      return { ok: true, value: { n } };
    },
    serialize(data): unknown {
      return { n: data.n };
    },
    applyEdit(data, edit) {
      return { ok: true, value: { n: data.n + edit.by } };
    },
    ...(invertEdit === undefined ? {} : { invertEdit }),
  });
}

describe("an opt-in invertEdit is verified", () => {
  function run(type: ReturnType<typeof clipWithInverse>) {
    const engine = createEngine<readonly [typeof type, typeof folder], Summary, {}>({
      types: [type, folder],
      summary,
      folds: {},
      devChecks: true,
    });
    const loaded = engine.deserialize(docWith({ n: 10 }));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) throw new Error("fixture");
    const store = engine.createStore(loaded.value.graph);
    const spy = errors();
    const result = store.dispatch({
      type: "edit-nodes",
      edits: [{ nodeId: parseNodeId("c1"), kind: "clip", edit: { by: 5 } }],
    });
    expect(result.ok).toBe(true);
    return spy;
  }

  it("reports an inverse that does not undo its edit", () => {
    // WRONG ON PURPOSE: negating the delta is correct; this forgets the sign.
    const spy = run(clipWithInverse((edit) => ({ by: edit.by })));
    expect(messagesFrom(spy)).toContain("invertEdit");
  });

  it("stays silent for a CORRECT inverse", () => {
    const spy = run(clipWithInverse((edit) => ({ by: -edit.by })));
    expect(spy).not.toHaveBeenCalled();
  });

  it("stays silent when the codec declares no inverse at all", () => {
    // The common case by far — `invertEdit` is opt-in and off by default, so
    // the check must cost nothing and say nothing for a codec without one.
    const spy = run(clipWithInverse(undefined));
    expect(spy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 4. THE SHADOW COLD REFOLD — cache HITS only
// ---------------------------------------------------------------------------

describe("the shadow refold audits what the memo table serves", () => {
  const clip = defineNodeType<Readonly<{ seconds: number }>, Readonly<{ seconds?: number }>>()({
    kind: "clip",
    container: false,
    schemaVersion: 1,
    parse(raw): Result<Readonly<{ seconds: number }>, readonly Issue[]> {
      if (typeof raw !== "object" || raw === null) {
        return { ok: false, error: [{ path: "$", message: "x" }] };
      }
      const seconds = ({ ...raw } as Record<string, unknown>)["seconds"];
      if (typeof seconds !== "number") {
        return { ok: false, error: [{ path: "$.seconds", message: "seconds" }] };
      }
      return { ok: true, value: { seconds } };
    },
    serialize(data): unknown {
      return { seconds: data.seconds };
    },
    applyEdit(data, edit) {
      return { ok: true, value: { seconds: edit.seconds ?? data.seconds } };
    },
  });

  function engineWith(leaf: (node: { kind: string; data: unknown }) => number) {
    const folds = {
      seconds: foldMonoid<readonly [typeof clip, typeof folder], Summary, number>({
        key: "seconds",
        empty: 0,
        leaf: (node) => leaf(node as { kind: string; data: unknown }),
        concat: (a, b) => a + b,
      }),
    };
    return createEngine<readonly [typeof clip, typeof folder], Summary, typeof folds>({
      types: [clip, folder],
      summary,
      folds,
      devChecks: true,
    });
  }

  it("stays silent when the table is telling the truth", () => {
    const engine = engineWith((node) =>
      node.kind === "clip" ? (node.data as { seconds: number }).seconds : 0,
    );
    const loaded = engine.deserialize(docWith({ seconds: 4 }));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const store = engine.createStore(loaded.value.graph);
    const spy = errors();
    // FIRST read is a miss and is deliberately NOT audited — there is nothing
    // memoized to be wrong. The second is a hit, and that one gets a shadow.
    store.aggregate("seconds", parseNodeId("root"));
    store.aggregate("seconds", parseNodeId("root"));
    expect(spy).not.toHaveBeenCalled();
  });

  it("reports when a cached value and a fresh fold disagree", () => {
    // A NON-DETERMINISTIC fold: every evaluation returns a different number, so
    // the cached answer and a fresh one necessarily differ. That is exactly the
    // SHAPE of a stale entry — the table serving something the graph no longer
    // implies — induced honestly rather than by poking at the cache, which the
    // store owns and does not expose.
    let tick = 0;
    const engine = engineWith(() => {
      tick += 1;
      return tick;
    });
    const loaded = engine.deserialize(docWith({ seconds: 4 }));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const store = engine.createStore(loaded.value.graph);
    const spy = errors();
    store.aggregate("seconds", parseNodeId("root"));
    store.aggregate("seconds", parseNodeId("root"));
    expect(messagesFrom(spy)).toContain("STALE");
  });

  it("is OFF entirely when devChecks is off", () => {
    let tick = 0;
    const folds = {
      seconds: foldMonoid<readonly [typeof clip, typeof folder], Summary, number>({
        key: "seconds",
        empty: 0,
        leaf: () => {
          tick += 1;
          return tick;
        },
        concat: (a, b) => a + b,
      }),
    };
    const engine = createEngine<readonly [typeof clip, typeof folder], Summary, typeof folds>({
      types: [clip, folder],
      summary,
      folds,
    });
    const loaded = engine.deserialize(docWith({ seconds: 4 }));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const store = engine.createStore(loaded.value.graph);
    const spy = errors();
    store.aggregate("seconds", parseNodeId("root"));
    const before = tick;
    store.aggregate("seconds", parseNodeId("root"));
    expect(spy).not.toHaveBeenCalled();
    // And the fold ran ZERO extra times: the second read was served from the
    // table with no shadow beside it.
    expect(tick).toBe(before);
  });
});
