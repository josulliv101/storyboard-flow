// Sixth review round — the third describer was never bounded.
//
// `quoteFromWire` and `describeValue` were each written under the heading
// "every ingress refusal", a round apart. `describeThrown` is the third
// function in that file and was swept by neither, because both sweeps looked
// for `JSON.stringify` and it does not call it. MEASURED at the DEFAULT config,
// a node type whose `contentKey` throws with a 1 MB message:
//
//   deserialize(...).error.message      1,000,070 characters
//
// against the 169 `quoteFromWire` brought `dangling-child` down to. That string
// is what a consumer puts in a log line, a toast, or an error report.
//
// IT READS AS LOWER RISK THAN IT IS. The throw comes from consumer code rather
// than off the wire, so the length looks like the consumer's own business — but
// a node type that echoes the value it choked on into its error message is an
// ordinary thing to write, and that hands the sender control of the length
// after all.
//
// AND `String(thrown)` IS NOT TOTAL, which was not in the finding and is the
// worse half. `String(Object.create(null))` throws `TypeError: Cannot convert
// object to primitive value`, and so does any value whose `toString` throws —
// both of which a consumer can `throw`. So the function written to describe a
// failure had a failure mode of its own, at the exact doors that promise a
// `Result`, which is the rule its own sibling's doc states.
import { describe, expect, it } from "vitest";

import {
  type ConsumerDefinedSummaryType,
  type Issue,
  type Result,
  defineNodeType,
  parseNodeId,
} from "../types";
import { createEngine } from "../engine";

const HUGE = "x".repeat(1_000_000);

/** How a node type's `contentKey` fails, chosen per test. */
let failure: () => never = () => {
  throw new Error("unset");
};

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
    return { ok: true, value: { title: edit.title ?? data.title } };
  },
  contentKey(): string | null {
    return failure();
  },
});

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
    return { ok: true, value: { name: edit.name ?? data.name } };
  },
});

const types = [clipType, folderType] as const;
type Types = typeof types;
type Summary = Readonly<{ n: number }>;

const summary: ConsumerDefinedSummaryType<Summary> = {
  parse(): Result<Summary, readonly Issue[]> {
    return { ok: true, value: { n: 0 } };
  },
  serialize(): unknown {
    return { n: 0 };
  },
};

function engine() {
  return createEngine<Types, Summary, {}>({ types, summary, folds: {} });
}

const document = {
  formatVersion: 1 as const,
  schemaVersions: { folder: 1, clip: 1 },
  rootIds: ["root"],
  nodes: [
    { id: "root", kind: "folder", data: { name: "R" }, children: ["c1"] },
    { id: "c1", kind: "clip", data: { title: "t" } },
  ],
};

/**
 * Generous, and deliberately not tight. This asserts the ORDER OF MAGNITUDE —
 * that a megabyte cannot reach a log line — rather than pinning
 * `DESCRIBE_LIMIT`, which is one number three describers share and should be
 * movable without editing this file.
 */
const SANE = 2_000;

describe("a node-type throw cannot blow up a refusal message", () => {
  it("bounds an Error message at deserialize, the door a payload reaches", () => {
    failure = () => {
      throw new Error(HUGE);
    };
    const refused = engine().deserialize(document);
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.error.message.length).toBeLessThan(SANE);
  });

  it("still names the kind and the hook, which is what the message is FOR", () => {
    // The bound must not cost the diagnostic. The prefix is built from
    // engine-controlled text and stays unclamped, so a reader still learns
    // which node type failed and where.
    failure = () => {
      throw new Error(HUGE);
    };
    const refused = engine().deserialize(document);
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.error.code).toBe("node-type-threw");
    expect(refused.error.message).toContain("clip");
    expect(refused.error.message).toContain("contentKey");
  });

  it("bounds a thrown non-Error too", () => {
    // `String(thrown)` is the other arm and carried the same hazard.
    failure = () => {
      throw HUGE;
    };
    const refused = engine().deserialize(document);
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.error.message.length).toBeLessThan(SANE);
  });

  it("bounds it on the command path as well as on ingress", () => {
    // Same describer, different door. `dispatch` promises a `Result` and the
    // message it carries is relayed from the same place.
    failure = () => {
      throw new Error("unset");
    };
    const built = engine();
    const loaded = built.deserialize({
      formatVersion: 1,
      schemaVersions: { folder: 1 },
      rootIds: ["root"],
      nodes: [{ id: "root", kind: "folder", data: { name: "R" }, children: [] }],
    });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const store = built.createStore(loaded.value.graph);
    failure = () => {
      throw new Error(HUGE);
    };
    const refused = store.dispatch({
      type: "insert-nodes",
      toParentId: parseNodeId("root"),
      toIndex: 0,
      seeds: [{ kind: "clip", data: { title: "t" } }],
    });
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.error.code).toBe("node-type-threw");
    expect(refused.error.message.length).toBeLessThan(SANE);
  });

  it("survives a value that cannot be converted to a string at all", () => {
    // `String(Object.create(null))` throws. A describer that throws while
    // describing turns a refusable document into a thrown load, at the door
    // whose entire job is telling a bad payload from an engine bug.
    failure = () => {
      throw Object.create(null) as never;
    };
    const refused = engine().deserialize(document);
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.error.code).toBe("node-type-threw");
    expect(refused.error.message.length).toBeLessThan(SANE);
  });

  it("survives a value whose own toString throws", () => {
    failure = () => {
      throw {
        toString() {
          throw new Error("nested");
        },
      } as never;
    };
    const refused = engine().deserialize(document);
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.error.code).toBe("node-type-threw");
  });

  it("survives an Error whose message getter throws", () => {
    // `.message` may be a getter, so reading it is a call into consumer code
    // like any other and sits inside the same guard.
    failure = () => {
      const error = new Error();
      Object.defineProperty(error, "message", {
        get() {
          throw new Error("nested");
        },
      });
      throw error;
    };
    const refused = engine().deserialize(document);
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.error.code).toBe("node-type-threw");
  });

  it("leaves an ordinary message untouched", () => {
    // The bound must not cost the traffic it sits in front of. Real messages
    // are short, and a clamp that mangled them would be worse than the hazard.
    const real = "Cannot read properties of undefined (reading 'assetId')";
    failure = () => {
      throw new Error(real);
    };
    const refused = engine().deserialize(document);
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.error.message).toContain(real);
  });
});
