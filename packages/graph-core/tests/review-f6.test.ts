// schemaVersions survives reserved object keys.
//
// `parseSerializedDocument` and `serializeGraph` both build `schemaVersions` as
// a bare `{}` keyed by CONSUMER-CHOSEN kind names. Nothing in the engine
// constrains a kind name (`defineNodeType` takes any `K extends string`,
// `buildRegistry` keys a Map), so a kind may legally be named `"__proto__"` or
// `"constructor"` — and then:
//
//   - `schemaVersions[kind] = n` for `"__proto__"` hits `Object.prototype`'s
//     `__proto__` SETTER, which silently ignores a non-object. The version is
//     dropped on both the write and the read side.
//   - `doc.schemaVersions[kind]` for an undeclared `"constructor"` (or
//     `"toString"`, `"valueOf"`, ...) INHERITS a non-number from
//     `Object.prototype`, and `??` does not catch it, so the documented
//     "undeclared reads as this build's current version" fallback never runs.
//   - `!(node.kind in schemaVersions)` in `serializeGraph` walks the prototype
//     chain, so a quarantined `"constructor"` node's declared version is never
//     re-emitted — breaking the stated byte-exact quarantine round-trip.
//
// Everything below goes through `createEngine` / `engine.serialize` /
// `engine.deserialize` / `parseSerializedDocument` — the public surface.

import { describe, expect, it } from "vitest";

import { createEngine } from "../engine";
import { parseSerializedDocument } from "../serialize";
import {
  defineNodeType,
  parseNodeId,
  type Issue,
  type Result,
  type ConsumerDefinedSummaryType,
} from "../types";

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type Folder = Readonly<{ name: string }>;

const folderType = defineNodeType<Folder, never>()({
  kind: "folder",
  container: true,
  schemaVersion: 1,
  parse(raw): Result<Folder, readonly Issue[]> {
    if (!isRecord(raw) || typeof raw.name !== "string") {
      return { ok: false, error: [{ path: "$.name", message: "name" }] };
    }
    return { ok: true, value: { name: raw.name } };
  },
  serialize(data): unknown {
    return { name: data.name };
  },
  applyEdit(data): Result<Folder, never> {
    return { ok: true, value: data };
  },
});

/** Records which migration TARGETS actually ran. */
const migrationLog: number[] = [];

type Proto = Readonly<{ text: string }>;

/**
 * A leaf kind literally named `__proto__`, at schemaVersion 2, with a v1 -> v2
 * migration that renames `body` to `text`. Nothing about this is exotic to the
 * engine: it is an ordinary registered node type whose kind string happens to
 * collide with an accessor on `Object.prototype`.
 */
const protoType = defineNodeType<Proto, never>()({
  kind: "__proto__",
  container: false,
  schemaVersion: 2,
  migrations: {
    2: (raw: unknown): unknown => {
      migrationLog.push(2);
      const rec = isRecord(raw) ? raw : {};
      return { text: typeof rec.body === "string" ? rec.body : "" };
    },
  },
  parse(raw): Result<Proto, readonly Issue[]> {
    if (!isRecord(raw) || typeof raw.text !== "string") {
      return { ok: false, error: [{ path: "$.text", message: "needs text" }] };
    }
    return { ok: true, value: { text: raw.text } };
  },
  serialize(data): unknown {
    return { text: data.text };
  },
  applyEdit(data): Result<Proto, never> {
    return { ok: true, value: data };
  },
});

const types = [folderType, protoType] as const;
type Types = typeof types;

type Summary = Readonly<{ seconds: number }>;

const summary: ConsumerDefinedSummaryType<Summary> = {
  parse(raw): Result<Summary, readonly Issue[]> {
    if (!isRecord(raw) || typeof raw.seconds !== "number") {
      return { ok: false, error: [{ path: "$.seconds", message: "seconds" }] };
    }
    return { ok: true, value: { seconds: raw.seconds } };
  },
  serialize(value): unknown {
    return { seconds: value.seconds };
  },
};

function makeEngine() {
  return createEngine<Types, Summary, {}>({ types, summary, folds: {} });
}

/**
 * Documents arrive from IO as JSON. `JSON.parse` uses CreateDataProperty, so a
 * wire `"__proto__"` key really IS an own, enumerable property of the parsed
 * object — the engine is handed a well-formed declaration and loses it itself.
 */
function wire(json: string): unknown {
  return JSON.parse(json);
}

describe("schemaVersions survives reserved object keys", () => {
  it("parseSerializedDocument keeps a declared __proto__ version", () => {
    const raw = wire(
      '{"formatVersion":1,"schemaVersions":{"__proto__":1,"folder":1},"rootIds":["r"],' +
        '"nodes":[{"id":"r","kind":"folder","data":{"name":"R"},"children":[]}]}',
    );

    // Prove the input really declares it as an own key before blaming the parse.
    const rawVersions = (raw as { schemaVersions: object }).schemaVersions;
    expect(Object.getOwnPropertyNames(rawVersions)).toContain("__proto__");

    const parsed = parseSerializedDocument(raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const out = parsed.value.schemaVersions;
    // MEASUREMENT: what survived the copy, and what a lookup now returns.
    // eslint-disable-next-line no-console
    console.log(
      "[F6] parsed own keys:", JSON.stringify(Object.getOwnPropertyNames(out)),
      "| lookup typeof:", typeof (out as Record<string, unknown>)["__proto__"],
    );

    expect(Object.getOwnPropertyNames(out)).toContain("__proto__");
    expect((out as Record<string, unknown>)["__proto__"]).toBe(1);
  });

  it("engine.serialize emits a registered __proto__ kind's schemaVersion", () => {
    const engine = makeEngine();
    const loaded = engine.deserialize(
      wire(
        '{"formatVersion":1,"schemaVersions":{"folder":1},"rootIds":["r"],' +
          '"nodes":[{"id":"r","kind":"folder","data":{"name":"R"},"children":["p"]},' +
          '{"id":"p","kind":"__proto__","data":{"text":"hi"}}]}',
      ),
    );
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;

    const written = engine.serialize(loaded.value.graph);
    // eslint-disable-next-line no-console
    console.log(
      "[F6] serialize schemaVersions JSON:",
      JSON.stringify(written.schemaVersions),
    );

    // The registry holds `__proto__` at version 2; the wire must say so, or a
    // future build cannot know which migrations this document predates.
    expect(JSON.parse(JSON.stringify(written.schemaVersions))).toMatchObject({
      folder: 1,
      ["__proto__"]: 2,
    });
  });

  it("a v1 __proto__ node migrates like any other kind", () => {
    migrationLog.length = 0;
    const engine = makeEngine();

    // Declares `__proto__: 1`; the node carries v1 data (`body`, not `text`).
    // Correct behaviour: migration 2 runs, `{body}` becomes `{text}`, parse
    // succeeds, node is live.
    const loaded = engine.deserialize(
      wire(
        '{"formatVersion":1,"schemaVersions":{"__proto__":1,"folder":1},"rootIds":["r"],' +
          '"nodes":[{"id":"r","kind":"folder","data":{"name":"R"},"children":["p"]},' +
          '{"id":"p","kind":"__proto__","data":{"body":"hello"}}]}',
      ),
    );
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;

    const node = loaded.value.graph.nodesById.get(parseNodeId("p"));
    // eslint-disable-next-line no-console
    console.log(
      "[F6] migrations that ran:", JSON.stringify(migrationLog),
      "| quarantined:", node?.quarantined,
      "| quarantine count:", loaded.value.report.quarantined.length,
    );

    expect(migrationLog).toEqual([2]);
    expect(node?.quarantined).toBe(false);
  });

  it("an UNDECLARED 'constructor' kind reads as undefined, not a function", () => {
    const engine = makeEngine();
    // `constructor` is not registered, so this node quarantines as unknown-kind
    // and carries `declaredVersion` verbatim. The document declares no version
    // for it, so the documented fallback is "this build's current version",
    // and for an unregistered kind that bottoms out at 0.
    const loaded = engine.deserialize(
      wire(
        '{"formatVersion":1,"schemaVersions":{"folder":1},"rootIds":["r"],' +
          '"nodes":[{"id":"r","kind":"folder","data":{"name":"R"},"children":["c"]},' +
          '{"id":"c","kind":"constructor","data":{"anything":true}}]}',
      ),
    );
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;

    const node = loaded.value.graph.nodesById.get(parseNodeId("c"));
    expect(node?.quarantined).toBe(true);
    if (node === undefined || !node.quarantined) return;

    // eslint-disable-next-line no-console
    console.log(
      "[F6] quarantined 'constructor'.schemaVersion typeof:",
      typeof node.schemaVersion,
      "| value:",
      String(node.schemaVersion).slice(0, 40),
    );

    expect(typeof node.schemaVersion).toBe("number");
    expect(node.schemaVersion).toBe(0);
  });

  it("a quarantined 'constructor' node re-emits its declared version", () => {
    const engine = makeEngine();
    const loaded = engine.deserialize(
      wire(
        '{"formatVersion":1,"schemaVersions":{"folder":1,"constructor":7},"rootIds":["r"],' +
          '"nodes":[{"id":"r","kind":"folder","data":{"name":"R"},"children":["c"]},' +
          '{"id":"c","kind":"constructor","data":{"anything":true}}]}',
      ),
    );
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;

    const node = loaded.value.graph.nodesById.get(parseNodeId("c"));
    expect(node?.quarantined).toBe(true);
    // The read side got this one right — `constructor` is a writable DATA
    // property on Object.prototype, so the own-property shadow took.
    if (node !== undefined && node.quarantined) {
      expect(node.schemaVersion).toBe(7);
    }

    const written = engine.serialize(loaded.value.graph);
    // eslint-disable-next-line no-console
    console.log(
      "[F6] re-emitted schemaVersions:",
      JSON.stringify(written.schemaVersions),
      "| own keys:",
      JSON.stringify(Object.getOwnPropertyNames(written.schemaVersions)),
    );

    // Quarantine's contract is a byte-exact re-emit, version included.
    expect(JSON.parse(JSON.stringify(written.schemaVersions))).toMatchObject({
      folder: 1,
      constructor: 7,
    });
  });
});
