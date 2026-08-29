// F4 regression: a THROWING summary type must quarantine, not kill the document.
//
// `parseNodeData` wraps `nodeType.parse` in try/catch precisely because "a node type is
// consumer code, and an ingress door that throws takes the whole document
// down". `ctx.summary.parse` (serialize.ts, buildDocument, pass F) is the other
// consumer-supplied node type on the same ingress path, and must get the same
// protection. The two CONTROL cases below pass on unfixed code; the three
// throwing-summary cases fail on unfixed code.
import { describe, expect, it } from "vitest";

import { createEngine } from "./engine";
import { buildRegistry } from "./graph";
import { DEFAULT_MAX_NODES, deserializeDocument } from "./serialize";
import {
  type SerializedDocument,
  defineNodeType,
  parseNodeId,
  type EngineContext,
  type Issue,
  type Result,
  type ConsumerDefinedSummaryType,
} from "./types";

type Clip = Readonly<{ title: string }>;
const clipType = defineNodeType<Clip, Readonly<{ title?: string }>>()({
  kind: "clip",
  container: false,
  schemaVersion: 1,
  parse(raw): Result<Clip, readonly Issue[]> {
    if (typeof raw !== "object" || raw === null) {
      return { ok: false, error: [{ path: "$", message: "not an object" }] };
    }
    const title = (raw as Record<string, unknown>)["title"];
    if (typeof title !== "string") {
      return { ok: false, error: [{ path: "$.title", message: "title" }] };
    }
    return { ok: true, value: { title } };
  },
  serialize(data): unknown {
    return { title: data.title };
  },
  applyEdit(data, edit) {
    return { ok: true, value: { title: edit.title ?? data.title } };
  },
});

type Folder = Readonly<{ name: string }>;
const folderType = defineNodeType<Folder, Readonly<{ name?: string }>>()({
  kind: "folder",
  container: true,
  schemaVersion: 1,
  parse(raw): Result<Folder, readonly Issue[]> {
    if (typeof raw !== "object" || raw === null) {
      return { ok: false, error: [{ path: "$", message: "not an object" }] };
    }
    const name = (raw as Record<string, unknown>)["name"];
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

const types = [clipType, folderType] as const;
type Types = typeof types;

type Summary = Readonly<{ seconds: number }>;

/** The whole point: consumer code on the ingress path that throws. */
const throwingSummary: ConsumerDefinedSummaryType<Summary> = {
  parse(): Result<Summary, readonly Issue[]> {
    throw new Error("summary parse exploded");
  },
  serialize(value): unknown {
    return { seconds: value.seconds };
  },
};

/** Control: the well-behaved node type, same shape, REFUSES instead of throwing. */
const wellBehavedSummary: ConsumerDefinedSummaryType<Summary> = {
  parse(raw): Result<Summary, readonly Issue[]> {
    if (typeof raw !== "object" || raw === null) {
      return { ok: false, error: [{ path: "$", message: "not an object" }] };
    }
    const seconds = (raw as Record<string, unknown>)["seconds"];
    if (typeof seconds !== "number") {
      return { ok: false, error: [{ path: "$.seconds", message: "seconds" }] };
    }
    return { ok: true, value: { seconds } };
  },
  serialize(value): unknown {
    return { seconds: value.seconds };
  },
};

/** root(folder) -> [a(clip), sub(folder, unloaded, carries a summary)] */
function docWithSummary(summary: unknown): unknown {
  return {
    formatVersion: 1,
    schemaVersions: { clip: 1, folder: 1 },
    rootIds: ["root"],
    nodes: [
      {
        id: "root",
        kind: "folder",
        data: { name: "Root" },
        children: ["a", "sub"],
      },
      { id: "a", kind: "clip", data: { title: "A" } },
      {
        id: "sub",
        kind: "folder",
        data: { name: "Sub" },
        childrenState: "unloaded",
        summary,
      },
    ],
  };
}

function ctxWith(summary: ConsumerDefinedSummaryType<Summary>): EngineContext<Summary> {
  return {
    engineId: Symbol("f4-probe"),
    registry: buildRegistry(types),
    summary,
    onUnknownKind: "quarantine",
    onParseFailure: "quarantine",
    maxNodes: DEFAULT_MAX_NODES,
    maxDepth: null,
    mintId: () => "minted",
    now: () => 0,
    devChecks: false,
  };
}

describe("a throwing summary type quarantines rather than crashing", () => {
  it("CONTROL: a summary type that RETURNS a failure quarantines the node", () => {
    const ctx = ctxWith(wellBehavedSummary);
    const out = deserializeDocument<Types, Summary>(
      docWithSummary({ seconds: "thirty" }),
      ctx,
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.value.report.quarantined).toHaveLength(1);
    expect(out.value.report.quarantined[0]?.reason).toBe("parse-failed");
  });

  it("CONTROL: a NODE node type that throws is caught and quarantined", () => {
    const boomType = defineNodeType<Readonly<{ ok: true }>, never>()({
      kind: "boom",
      container: false,
      schemaVersion: 1,
      parse(): Result<Readonly<{ ok: true }>, readonly Issue[]> {
        throw new Error("node parse exploded");
      },
      serialize(): unknown {
        return {};
      },
      applyEdit(data) {
        return { ok: true, value: data };
      },
    });
    const ctx: EngineContext<Summary> = {
      ...ctxWith(wellBehavedSummary),
      registry: buildRegistry([clipType, folderType, boomType] as const),
    };
    const out = deserializeDocument(
      {
        formatVersion: 1,
        schemaVersions: { folder: 1, boom: 1 },
        rootIds: ["root"],
        nodes: [
          {
            id: "root",
            kind: "folder",
            data: { name: "Root" },
            children: ["b"],
          },
          { id: "b", kind: "boom", data: {} },
        ],
      },
      ctx,
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.value.report.quarantined).toHaveLength(1);
    expect(out.value.report.quarantined[0]?.issues[0]?.message).toMatch(
      /parse threw/,
    );
  });

  it("deserializeDocument quarantines instead of throwing when summary.parse throws", () => {
    const ctx = ctxWith(throwingSummary);
    const out = deserializeDocument<Types, Summary>(
      docWithSummary({ seconds: 30 }),
      ctx,
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.value.report.quarantined).toHaveLength(1);
    expect(out.value.report.quarantined[0]?.reason).toBe("parse-failed");
    expect(out.value.report.quarantined[0]?.issues[0]?.path).toMatch(
      /^\$\.summary/,
    );
    // The other two nodes still load — a bad summary is per-node content.
    expect(out.value.report.nodeCount).toBe(3);
  });

  it("PUBLIC API: engine.deserialize returns a Result instead of throwing", () => {
    const engine = createEngine({ types, summary: throwingSummary, folds: {} });
    const out = engine.deserialize(docWithSummary({ seconds: 30 }));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.value.report.quarantined).toHaveLength(1);
  });

  it("PUBLIC API: store.load returns a Result instead of throwing", () => {
    // Parent loads with a node type that tolerates the parent summary, then a child
    // payload whose summary trips the same node type into throwing.
    const engine = createEngine({
      types,
      summary: {
        parse(raw): Result<Summary, readonly Issue[]> {
          if (raw !== null && typeof raw === "object" && "boom" in raw) {
            throw new Error("summary parse exploded (child payload)");
          }
          return { ok: true, value: { seconds: 0 } };
        },
        serialize(value: Summary): unknown {
          return { seconds: value.seconds };
        },
      } satisfies ConsumerDefinedSummaryType<Summary>,
      folds: {},
    });
    const loaded = engine.deserialize(docWithSummary({ seconds: 30 }));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const store = engine.createStore(loaded.value.graph);
    const payload = {
      formatVersion: 1,
      schemaVersions: { clip: 1, folder: 1 },
      rootIds: ["kid"],
      nodes: [
        {
          id: "kid",
          kind: "folder",
          data: { name: "Kid" },
          childrenState: "unloaded",
          summary: { boom: true },
        },
      ],
    };
    let thrown: unknown = null;
    let ok: boolean | null = null;
    try {
      ok = store.load(parseNodeId("sub"), payload as SerializedDocument).ok;
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeNull();
    expect(ok).toBe(true);
  });
});
