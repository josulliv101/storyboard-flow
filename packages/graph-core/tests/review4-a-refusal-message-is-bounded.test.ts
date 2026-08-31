// Fourth review round — the ingress trust boundary quoted the wire verbatim.
//
// `JSON.stringify(node.id)` was the pattern at every ingress refusal, and a
// `NodeId` is ANY string except whitespace-only — including one whose length the
// sender chose. So the size of `error.message` was a function of the payload,
// and the consumer puts that message in a log line, a toast, or an error report.
//
// Measured before the fix, a 1 MB id in a `dangling-child` payload:
//
//   id length sent :  1,000,000
//   message length :  1,000,049
//
// After: 169. The bound is `quoteFromWire`, which clamps BEFORE it quotes —
// quoting first would allocate the whole megabyte and escape every character of
// it before throwing the result away, which is most of the cost being avoided.
//
// Not a vulnerability on its own; the document is refused either way. It is the
// difference between a refusal that costs what the refusal costs and one that
// costs whatever the sender decided.
import { describe, expect, it } from "vitest";

import {
  type ConsumerDefinedSummaryType,
  type Issue,
  type Result,
  defineNodeType,
  parseNodeId,
} from "../types";
import { createEngine } from "../engine";

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

const types = [folderType] as const;
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

const makeEngine = () =>
  createEngine<Types, Summary, {}>({ types, summary, folds: {} });

/** Comfortably above the 120-char clamp, comfortably below anything slow. */
const HUGE = "x".repeat(200_000);

/** The bound each message must respect. Not the clamp itself — a message is a
 *  sentence with a quoted name in it, and the sentence has a length too. */
const REASONABLE = 1_000;

describe("a refusal message is bounded by the engine, not by the sender", () => {
  it("a huge node id in a dangling-child payload", () => {
    const engine = makeEngine();
    const loaded = engine.deserialize({
      formatVersion: 1,
      schemaVersions: { folder: 1 },
      rootIds: ["root"],
      nodes: [
        { id: "root", kind: "folder", data: { name: "R" }, children: [HUGE] },
      ],
    });
    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(loaded.error.code).toBe("dangling-child");
    expect(loaded.error.message.length).toBeLessThan(REASONABLE);
    // The id is still IDENTIFIABLE — clamped, not withheld. A refusal that says
    // nothing about which node it means is a different bug.
    expect(loaded.error.message).toContain("xxx");
  });

  it("a huge id that is a duplicate", () => {
    const engine = makeEngine();
    const loaded = engine.deserialize({
      formatVersion: 1,
      schemaVersions: { folder: 1 },
      rootIds: ["root"],
      nodes: [
        { id: "root", kind: "folder", data: { name: "R" }, children: [HUGE] },
        { id: HUGE, kind: "folder", data: { name: "A" }, children: [] },
        { id: HUGE, kind: "folder", data: { name: "B" }, children: [] },
      ],
    });
    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(loaded.error.code).toBe("duplicate-node-id");
    expect(loaded.error.message.length).toBeLessThan(REASONABLE);
  });

  it("a huge KIND, which is the other string the wire chooses", () => {
    // Through `schemaVersions`, which formats the kind into a message. An
    // unknown kind on a NODE quarantines instead of refusing, and the
    // `IngressError` it produces carries `kind` as a structured FIELD rather
    // than inside a sentence — that one is deliberately not clamped, because a
    // consumer deciding what to do about a failed kind needs the whole kind.
    // The bound is on messages, not on data.
    const engine = makeEngine();
    const loaded = engine.deserialize({
      formatVersion: 1,
      schemaVersions: { folder: 1, [HUGE]: "not-a-number" },
      rootIds: ["root"],
      nodes: [
        { id: "root", kind: "folder", data: { name: "R" }, children: [] },
      ],
    });
    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(loaded.error.message.length).toBeLessThan(REASONABLE);
  });

  it("a huge id on the LAZY door, which refuses twice over", () => {
    const engine = makeEngine();
    const loaded = engine.deserialize({
      formatVersion: 1,
      schemaVersions: { folder: 1 },
      rootIds: ["root"],
      nodes: [
        {
          id: "root",
          kind: "folder",
          data: { name: "R" },
          children: ["lazy"],
        },
        {
          id: "lazy",
          kind: "folder",
          data: { name: "L" },
          childrenState: "unloaded",
        },
      ],
    });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const store = engine.createStore(loaded.value.graph);

    // A huge id is a perfectly VALID id, so the payload has to be malformed for
    // there to be a refusal at all — the first draft of this test just loaded a
    // 200KB id successfully. A dangling child inside the payload puts the huge
    // string in the inner message AND the outer one wraps it, which is the
    // "refuses twice over" this door does.
    const result = store.load(parseNodeId("lazy"), {
      formatVersion: 1,
      schemaVersions: { folder: 1 },
      rootIds: ["p1"],
      nodes: [{ id: "p1", kind: "folder", data: { name: "P" }, children: [HUGE] }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("malformed-document");
    expect(result.error.message.length).toBeLessThan(REASONABLE);
    // Both layers bounded, not just the outer one.
    expect(result.error.cause?.message.length ?? 0).toBeLessThan(REASONABLE);
  });

  it("an ordinary id is not clamped, so the bound costs nothing normal", () => {
    const engine = makeEngine();
    const loaded = engine.deserialize({
      formatVersion: 1,
      schemaVersions: { folder: 1 },
      rootIds: ["root"],
      nodes: [
        {
          id: "root",
          kind: "folder",
          data: { name: "R" },
          children: ["timeline-e2e,comma/and-slash"],
        },
      ],
    });
    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    // Verbatim, including the comma and slash that are legal in a NodeId.
    expect(loaded.error.message).toContain("timeline-e2e,comma/and-slash");
  });
});
