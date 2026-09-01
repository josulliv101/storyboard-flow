// Fifth review round — the message bound stopped short of the first door.
//
// The fourth round introduced `quoteFromWire`, which clamps before it quotes,
// and applied it across the ingress refusals. Its own note describes the pattern
// it was replacing as "`JSON.stringify(node.id)` ... at every ingress refusal".
// Two places kept it.
//
// `parseSerializedNode` in ./serialize/shape is the FIRST door a payload meets —
// `parseSerializedDocument` runs before `buildDocument` adopts a single id — so
// its six refusals were reached before anything else could refuse, including the
// fifth round's own `maxNodeIdLength`. MEASURED with a 1,000,000-character id AT
// THE DEFAULT CONFIG, with that ceiling in force at 1024:
//
//   non-string kind      malformed-document       1,000,030 characters
//   bad childrenState    invalid-children-state   1,000,085
//   non-array children   malformed-document       1,000,034
//   (dangling child, fixed in round four)   dangling-child      169
//
// `tryParseNodeId` in ./types is the other, and it hid differently: it does not
// SIT at a refusal site, it is relayed verbatim by three of them, so those three
// inherited an unbounded quote however carefully they were written and a sweep
// for `JSON.stringify` at the refusal sites could not see it. A 1,000,000-space
// id is legal JSON, fails the `trim()` test, and produced a 1,000,063-character
// message.
//
// THE CEILING IS NOT A SUBSTITUTE, which is the reason this is its own round
// rather than a note on that one. It cannot run before the shape is known, and
// `maxNodeIdLength: null` is a supported configuration — so both controls are
// needed, and this file pins the one that holds when the other is off.
import { describe, expect, it } from "vitest";

import {
  type ConsumerDefinedSummaryType,
  type Issue,
  type Result,
  defineNodeType,
  parseNodeId,
  tryParseNodeId,
} from "../index";
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

/** Both engines, because the two controls are independent and each must hold on
 *  its own: the ceiling in force, and the ceiling explicitly off. */
const bounded = () =>
  createEngine<Types, Summary, {}>({ types, summary, folds: {} });
const unbounded = () =>
  createEngine<Types, Summary, {}>({
    types,
    summary,
    folds: {},
    maxNodeIdLength: null,
  });

const HUGE = "x".repeat(1_000_000);
const SPACES = " ".repeat(1_000_000);

/** A message is a sentence with a clamped name in it, and the sentence has a
 *  length too. Far below the payload, far above any real message. */
const REASONABLE = 1_000;

describe("the message bound reaches the first door", () => {
  it("shape refusals are bounded, with the ceiling on AND off", () => {
    // Each of these is reached by `parseSerializedNode` before any id is
    // adopted, so the id-length ceiling is not what saves them.
    const payloads: readonly [string, unknown][] = [
      ["non-string kind", { id: HUGE, kind: 5 }],
      [
        "bad childrenState",
        { id: HUGE, kind: "folder", data: { name: "A" }, childrenState: "bogus" },
      ],
      [
        "non-array children",
        { id: HUGE, kind: "folder", data: { name: "A" }, children: 7 },
      ],
      [
        "non-string child id",
        { id: HUGE, kind: "folder", data: { name: "A" }, children: [7] },
      ],
      [
        "non-finite schemaVersion",
        {
          id: HUGE,
          kind: "folder",
          data: { name: "A" },
          schemaVersion: Number.NaN,
        },
      ],
      [
        "non-string missingReason",
        { id: HUGE, kind: "folder", data: { name: "A" }, missingReason: 7 },
      ],
    ];

    for (const [label, node] of payloads) {
      for (const engine of [bounded(), unbounded()]) {
        const loaded = engine.deserialize({
          formatVersion: 1,
          schemaVersions: { folder: 1 },
          rootIds: ["root"],
          nodes: [node],
        });
        expect(loaded.ok, label).toBe(false);
        if (loaded.ok) continue;
        // Labelled, so a failure names which of the six payloads regressed
        // rather than only which line.
        expect(loaded.error.message.length, label).toBeLessThan(REASONABLE);
        // CLAMPED, NOT WITHHELD. A refusal that says nothing about which node it
        // means is a different bug — the fourth round makes the same point.
        expect(loaded.error.message).toContain("xxx");
      }
    }
  });

  it("a whitespace id is bounded even with the ceiling off", () => {
    // The relayed message. The ceiling refuses an over-LONG id first where it is
    // set, so this is the configuration that exercises the clamp itself.
    const loaded = unbounded().deserialize({
      formatVersion: 1,
      schemaVersions: { folder: 1 },
      rootIds: ["root"],
      nodes: [
        { id: "root", kind: "folder", data: { name: "R" }, children: [SPACES] },
        { id: SPACES, kind: "folder", data: { name: "A" }, children: [] },
      ],
    });
    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(loaded.error.code).toBe("invalid-node-id");
    expect(loaded.error.message.length).toBeLessThan(REASONABLE);
  });

  it("the id door bounds its own message, at both of its forms", () => {
    // `tryParseNodeId` is where the relayed message is BUILT, so the bound
    // belongs there rather than at each of the three sites that pass it on.
    const refused = tryParseNodeId(SPACES);
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.error.message.length).toBeLessThan(REASONABLE);

    // `parseNodeId` throws that same string, so it was carrying the megabyte too.
    let thrown: unknown = null;
    try {
      parseNodeId(SPACES);
    } catch (caught) {
      thrown = caught;
    }
    expect(thrown).not.toBeNull();
    expect(String((thrown as Error).message).length).toBeLessThan(REASONABLE);
  });

  it("an ordinary refusal still names the node in full", () => {
    // The clamp must not cost legibility for real ids, which are far under it.
    const loaded = bounded().deserialize({
      formatVersion: 1,
      schemaVersions: { folder: 1 },
      rootIds: ["root"],
      nodes: [
        {
          id: "root",
          kind: "folder",
          data: { name: "R" },
          children: ["scene/a-missing"],
        },
      ],
    });
    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(loaded.error.message).toContain("scene/a-missing");
  });
});
