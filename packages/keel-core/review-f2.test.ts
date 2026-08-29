// Duplicate `Fold.key` must not reach a store.
//
// folds.ts's `readCachedFold` justifies its `as Folded<A>` cast with "this value
// was written by THIS function, under THIS `fold.key`", concedes that two folds
// registered with the same `key` and different `A` would break it, and defers
// the guard to "`createEngine`'s registry check". There is no such check.
//
// `EngineConfig.folds` is `Record<string, Fold<Ts, S, unknown>>`: the RECORD key
// is what `aggregate(key, id)` looks up, `fold.key` is what the per-store cache
// is keyed by (`computeFold`'s `commit` -> `cache.set(fold.key, ...)`), and
// nothing relates the two or forces the `fold.key`s to be distinct. Two entries
// sharing a `fold.key` therefore share cache slots, and whichever fold reads
// second gets the first one's value re-branded as its own `A`.
import { describe, expect, it } from "vitest";

import {
  type Issue,
  type Result,
  type SummaryType,
  defineNodeType,
  parseNodeId,
} from "./types";
import { foldMonoid } from "./folds";
import { createEngine } from "./engine";

type Clip = Readonly<{ title: string; seconds: number }>;
type ClipEdit = Readonly<{ title?: string; seconds?: number }>;

const clipType = defineNodeType<Clip, ClipEdit>()({
  kind: "clip",
  container: false,
  schemaVersion: 1,
  parse(raw): Result<Clip, readonly Issue[]> {
    if (typeof raw !== "object" || raw === null) {
      return { ok: false, error: [{ path: "$", message: "not an object" }] };
    }
    const record: Record<string, unknown> = { ...raw };
    const title = record["title"];
    const seconds = record["seconds"];
    if (typeof title !== "string" || title.trim() === "") {
      return { ok: false, error: [{ path: "$.title", message: "title" }] };
    }
    if (typeof seconds !== "number") {
      return { ok: false, error: [{ path: "$.seconds", message: "seconds" }] };
    }
    return { ok: true, value: { title: title.trim(), seconds } };
  },
  serialize(data): unknown {
    return { title: data.title, seconds: data.seconds };
  },
  applyEdit(data, edit) {
    return {
      ok: true,
      value: {
        title: edit.title ?? data.title,
        seconds: edit.seconds ?? data.seconds,
      },
    };
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
    const record: Record<string, unknown> = { ...raw };
    const name = record["name"];
    if (typeof name !== "string" || name.trim() === "") {
      return { ok: false, error: [{ path: "$.name", message: "name" }] };
    }
    return { ok: true, value: { name: name.trim() } };
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

const summary: SummaryType<Summary> = {
  parse(raw): Result<Summary, readonly Issue[]> {
    if (typeof raw !== "object" || raw === null) {
      return { ok: false, error: [{ path: "$", message: "not an object" }] };
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

/** `A` = number. */
const durationFold = foldMonoid<Types, Summary, number>({
  key: "duration",
  empty: 0,
  leaf(node) {
    return node.kind === "clip" ? node.data.seconds : 0;
  },
  concat(a, b) {
    return a + b;
  },
});

/**
 * `A` = string, and it declares THE SAME `key`. Not a contrived cast: `key` is a
 * plain `string` with no relation to the record key, so this is what a
 * copy-pasted `foldMonoid` block looks like — and `tsc --noEmit` is clean on it.
 */
const titlesFold = foldMonoid<Types, Summary, string>({
  key: "duration",
  empty: "",
  leaf(node) {
    return node.kind === "clip" ? node.data.title : "";
  },
  concat(a, b) {
    return a + b;
  },
});

const folds = { duration: durationFold, titles: titlesFold };

const doc = {
  formatVersion: 1,
  schemaVersions: { clip: 1, folder: 1 },
  rootIds: ["root"],
  nodes: [
    { id: "root", kind: "folder", data: { name: "Root" }, children: ["a", "b"] },
    { id: "a", kind: "clip", data: { title: "Alpha", seconds: 4 } },
    { id: "b", kind: "clip", data: { title: "Beta", seconds: 7 } },
  ],
};

const rootId = parseNodeId("root");

function makeEngine() {
  return createEngine<Types, Summary, typeof folds>({ types, summary, folds });
}

/**
 * Once `createEngine` grows the registry check the cast's soundness argument
 * already assumes, this registry stops being constructible at all — which is the
 * fix, and is why the corruption tests below treat a throw as a pass rather than
 * an error.
 */
function engineOrThrown():
  | Readonly<{ engine: ReturnType<typeof makeEngine> }>
  | Readonly<{ threw: unknown }> {
  try {
    return { engine: makeEngine() };
  } catch (error) {
    return { threw: error };
  }
}

describe("duplicate Fold.key", () => {
  it("createEngine rejects a fold registry whose entries share a fold key", () => {
    expect(() => makeEngine()).toThrow(/duplicate fold key/i);
  });

  it("aggregate never serves one fold's cached value under another fold's type", () => {
    const built = engineOrThrown();
    // Prevented at construction — nothing left to corrupt.
    if (!("engine" in built)) return;

    const loaded = built.engine.deserialize(doc);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;

    const store = built.engine.createStore(loaded.value.graph);

    // Warms the per-store cache under fold key "duration".
    expect(store.aggregate("duration", rootId)?.value).toBe(11);

    // A different registry entry with a different `A` and the SAME `fold.key`.
    // Statically `Folded<string> | undefined`.
    const titles = store.aggregate("titles", rootId);
    expect(titles).toBeDefined();
    if (titles === undefined) return;

    expect(typeof titles.value).toBe("string");
    expect(titles.value).toBe("AlphaBeta");
    expect(() => titles.value.toUpperCase()).not.toThrow();
  });

  it("aggregate is not silently poisoned in the other read order either", () => {
    const built = engineOrThrown();
    if (!("engine" in built)) return;

    const loaded = built.engine.deserialize(doc);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;

    const store = built.engine.createStore(loaded.value.graph);

    // String fold first: the number fold then reads its value and the sum
    // becomes concatenation, with no throw anywhere to mark it.
    expect(store.aggregate("titles", rootId)?.value).toBe("AlphaBeta");
    const seconds = store.aggregate("duration", rootId);
    expect(seconds).toBeDefined();
    if (seconds === undefined) return;

    expect(typeof seconds.value).toBe("number");
    expect(seconds.value).toBe(11);
    expect(seconds.value + 1).toBe(12);
  });
});
