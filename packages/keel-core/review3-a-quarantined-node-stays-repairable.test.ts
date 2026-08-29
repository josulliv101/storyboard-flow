// Third review round — saving a quarantined node destroyed the one fact needed
// to repair it.
//
// QUARANTINE'S WHOLE PROMISE is that a node whose content this build cannot
// understand keeps its id, its position, its children and its RAW BYTES, so a
// later build can read it correctly. The module header states it: "A document
// that will not load is a document the user cannot repair."
//
// `serializeGraph` wrote the REGISTRY's current version for every registered
// kind, up front, and the quarantined branch only filled in a version for kinds
// the registry did not know. So a node quarantined at v1 — because the v2
// migration was missing or threw — was re-emitted labelled v2. On the next load
// `runMigrations` sees `from >= to`, runs nothing, and hands v1 bytes to a v2
// `parse`. The node quarantines again, forever, and the mechanism that existed
// to preserve it is what destroyed it.
//
// The user gesture is completely ordinary: a build ships a bad migration, one
// node quarantines, the user keeps working (which is the POINT of quarantine)
// and saves. That save is the expected outcome, not an edge case.
import { describe, expect, it } from "vitest";

import {
  type Issue,
  type Result,
  type ConsumerDefinedSummaryType,
  defineNodeType,
  parseNodeId,
} from "./types";
import { createEngine } from "./engine";

/** v1 wire shape: `{ title, secs }`. v2 wire shape: `{ title, seconds }`. */
type Clip = Readonly<{ title: string; seconds: number }>;
type ClipEdit = Readonly<{ title?: string }>;

/** Flipped to simulate the build that ships the FIXED migration. */
let migrationThrows = true;

function makeClipV2() {
  return defineNodeType<Clip, ClipEdit>()({
    kind: "clip",
    container: false,
    schemaVersion: 2,
    migrations: {
      2: (raw: unknown): unknown => {
        if (migrationThrows) {
          throw new TypeError("clip migration to v2 is broken in this build");
        }
        const record: Record<string, unknown> = { ...(raw as object) };
        return { title: record["title"], seconds: record["secs"] };
      },
    },
    parse(raw): Result<Clip, readonly Issue[]> {
      if (typeof raw !== "object" || raw === null) {
        return { ok: false, error: [{ path: "$", message: "not an object" }] };
      }
      const record: Record<string, unknown> = { ...raw };
      const title = record["title"];
      const seconds = record["seconds"];
      if (typeof title !== "string") {
        return { ok: false, error: [{ path: "$.title", message: "title" }] };
      }
      // A v1 payload has `secs`, not `seconds`, so it fails here unless the
      // migration ran — which is exactly the signal this test turns on.
      if (typeof seconds !== "number") {
        return { ok: false, error: [{ path: "$.seconds", message: "seconds" }] };
      }
      return { ok: true, value: { title, seconds } };
    },
    serialize(data): unknown {
      return { title: data.title, seconds: data.seconds };
    },
    applyEdit(data, edit) {
      return { ok: true, value: { ...data, title: edit.title ?? data.title } };
    },
  });
}

type Folder = Readonly<{ name: string }>;
const folderType = defineNodeType<Folder, Readonly<{ name?: string }>>()({
  kind: "folder",
  container: true,
  schemaVersion: 1,
  parse(raw): Result<Folder, readonly Issue[]> {
    if (typeof raw !== "object" || raw === null) {
      return { ok: false, error: [{ path: "$", message: "not an object" }] };
    }
    const record: Record<string, unknown> = { ...raw };
    const name = record["name"];
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

type Summary = Readonly<{ n: number }>;
const summary: ConsumerDefinedSummaryType<Summary> = {
  parse(raw): Result<Summary, readonly Issue[]> {
    if (typeof raw !== "object" || raw === null) {
      return { ok: false, error: [{ path: "$", message: "not an object" }] };
    }
    const record: Record<string, unknown> = { ...raw };
    const n = record["n"];
    if (typeof n !== "number") {
      return { ok: false, error: [{ path: "$.n", message: "n" }] };
    }
    return { ok: true, value: { n } };
  },
  serialize(value): unknown {
    return { n: value.n };
  },
};

function makeEngineV2() {
  const types = [makeClipV2(), folderType] as const;
  return createEngine<typeof types, Summary, {}>({ types, summary, folds: {} });
}

/** The document as an older build wrote it: clip at schema version 1. */
const v1Document = {
  formatVersion: 1 as const,
  schemaVersions: { clip: 1, folder: 1 },
  rootIds: ["root"],
  nodes: [
    {
      id: "root",
      kind: "folder",
      data: { name: "Root" },
      children: ["a", "b"],
    },
    { id: "a", kind: "clip", data: { title: "A", secs: 4 } },
    { id: "b", kind: "clip", data: { title: "B", secs: 9 } },
  ],
};

const clipAId = parseNodeId("a");

describe("a quarantined node survives a save-and-reload well enough to be repaired", () => {
  it("quarantines when the migration is broken, which is the setup, not the bug", () => {
    migrationThrows = true;
    const engine = makeEngineV2();
    const loaded = engine.deserialize(v1Document);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.report.quarantined.length).toBe(2);
  });

  it("re-emits the version its bytes were actually written at", () => {
    migrationThrows = true;
    const engine = makeEngineV2();
    const loaded = engine.deserialize(v1Document);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;

    const saved = engine.serialize(loaded.value.graph);
    const clip = saved.nodes.find((node) => node.id === "a");
    expect(clip).toBeDefined();

    // The claim: whatever the document-level map says, this node carries the
    // version its raw bytes belong to. Without that, the v1 bytes are labelled
    // v2 and no migration can ever reach them again.
    expect(clip?.schemaVersion).toBe(1);
    // And the bytes themselves are untouched — quarantine's byte-exact re-emit.
    expect(clip?.data).toEqual({ title: "A", secs: 4 });
  });

  it("REPAIRS on the next build, which is the whole point of quarantine", () => {
    migrationThrows = true;
    const brokenBuild = makeEngineV2();
    const loadedBroken = brokenBuild.deserialize(v1Document);
    expect(loadedBroken.ok).toBe(true);
    if (!loadedBroken.ok) return;
    expect(loadedBroken.value.report.quarantined.length).toBe(2);

    // The user kept working and saved — the expected outcome, since quarantine
    // exists precisely so one bad node does not make the document unwritable.
    const saved = brokenBuild.serialize(loadedBroken.value.graph);

    // A later build ships the fixed migration.
    migrationThrows = false;
    const fixedBuild = makeEngineV2();
    const reloaded = fixedBuild.deserialize(saved);
    expect(reloaded.ok).toBe(true);
    if (!reloaded.ok) return;

    // Nothing quarantined this time: the migration ran because the node still
    // declared v1.
    expect(reloaded.value.report.quarantined.length).toBe(0);

    const node = reloaded.value.graph.nodesById.get(clipAId);
    expect(node?.quarantined).toBe(false);
    if (node === undefined || node.quarantined) return;
    expect(node.data).toEqual({ title: "A", seconds: 4 });
  });

  it("still round-trips a HEALTHY document without inventing per-node versions", () => {
    migrationThrows = false;
    const engine = makeEngineV2();
    const loaded = engine.deserialize(v1Document);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.report.quarantined.length).toBe(0);

    const saved = engine.serialize(loaded.value.graph);
    // A node that parsed cleanly holds CURRENT data, so it needs no per-node
    // escape hatch — writing one on every node would bloat every document to
    // carry a fact the document-level map already states.
    for (const node of saved.nodes) {
      expect(node.schemaVersion).toBeUndefined();
    }
    expect(saved.schemaVersions).toEqual({ clip: 2, folder: 1 });

    const again = engine.deserialize(saved);
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.value.report.quarantined.length).toBe(0);
  });

  it("refuses a per-node version that is not a finite number", () => {
    migrationThrows = false;
    const engine = makeEngineV2();
    const hostile = {
      ...v1Document,
      nodes: [
        v1Document.nodes[0],
        { id: "a", kind: "clip", data: { title: "A", secs: 4 }, schemaVersion: "2" },
        v1Document.nodes[2],
      ],
    };
    const loaded = engine.deserialize(hostile);
    // It comes off the wire, so it is validated like everything else there.
    expect(loaded.ok).toBe(false);
  });
});
