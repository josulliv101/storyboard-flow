// KEEL — the guided tour.
//
// This file is DOCUMENTATION FIRST and a test suite second. Each story teaches
// exactly one thing, in the order you would learn it: declare kinds, nest them,
// move them, edit them, undo that, roll them up, meet a subtree nobody has read
// yet, and finally meet data this build does not understand at all.
//
// It is also the interaction suite for the React bindings — this repo's
// convention is that stories ARE the tests, so every story that claims a
// behaviour proves it in a `play` function running in real headless Chromium.
//
// READING ORDER: the section marked "THE LIBRARY, WIRED UP" below is the part
// you would copy into your own app. Everything after it is story chrome.

import { Fragment, createContext, useCallback, useContext, useState } from "react";
import type { ReactNode } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, within } from "storybook/test";

import {
  childrenStateOf,
  createEngine,
  defineNodeType,
  folded,
  foldedExact,
  foldMonoid,
  getChildren,
  getParent,
  parseNodeId,
  summaryFrom,
  weakestCertainty,
  type Certainty,
  type ChildrenState,
  type ConsumerDefinedFold,
  type Folded,
  type Issue,
  type NodeId,
  type SerializedDocument,
  type SerializedNode,
  type ConsumerDefinedSummaryType,
} from "@storyboard/keel-core";

import { createReactBindings } from "./index";

// ===========================================================================
// THE LIBRARY, WIRED UP
// ===========================================================================
//
// Six steps, and they are the whole integration:
//   1. a `Data` and an `Edit` type per kind
//   2. `defineNodeType<Data, Edit>()({ ... })` — the node type for that kind
//   3. a summary type — the stored rollup a not-yet-loaded collection carries
//   4. folds — the questions you want answered about a subtree
//   5. `createEngine({ types, summary, folds })` — PURE, callable from a route
//      handler; it must not be created inside a `"use client"` module
//   6. `createReactBindings(engine)` — the React half, in a client module
//
// ---------------------------------------------------------------------------
// 1 + 2. Three kinds, and two of them are leaves that share nothing
// ---------------------------------------------------------------------------

/** A filmed shot. Contributes duration. */
type Shot = Readonly<{ slug: string; seconds: number; camera: string }>;

/**
 * Two edits, not one. `Edit` is per kind AND per intent, so a view dispatching
 * `{ type: "retime", seconds: -3 }` at a note is a compile error rather than a
 * runtime surprise.
 */
type ShotEdit =
  | Readonly<{ type: "rename"; slug: string }>
  | Readonly<{ type: "retime"; seconds: number }>;

/** A production note. Genuinely different shape — no duration, no camera. */
type Note = Readonly<{ text: string; author: string }>;
type NoteEdit = Readonly<{ type: "retext"; text: string }>;

/** The container kind. `container: true` is KIND-LEVEL and immutable. */
type Sequence = Readonly<{ name: string }>;
type SequenceEdit = Readonly<{ type: "rename"; name: string }>;

/**
 * Narrow `unknown` to something indexable without reaching for `any`.
 *
 * Every `parse` starts here because `raw` really is unknown: it came off a
 * wire, and the only honest thing to do with it is check one field at a time.
 */
function asRecord(raw: unknown): Readonly<Record<string, unknown>> | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  return raw as Readonly<Record<string, unknown>>;
}

function issue(path: string, message: string): readonly Issue[] {
  return [{ path, message }];
}

/**
 * `defineNodeType` is CURRIED — `defineNodeType<Shot, ShotEdit>()({ ... })`.
 *
 * That is not decoration. `Edit` has exactly one inference site (`applyEdit`'s
 * second parameter), so an uncurried factory lets a node type whose `applyEdit`
 * ignores its edit argument silently infer `Edit = unknown`, at which point
 * every dispatched edit for that kind typechecks and the per-kind edit typing
 * is dead. Making `Data` and `Edit` explicit closes that; `K` still infers as
 * the string literal `"shot"` from the object below.
 */
const shotType = defineNodeType<Shot, ShotEdit>()({
  kind: "shot",
  container: false,
  schemaVersion: 1,

  /**
   * CONSTRUCT a fresh value — never `return { ok: true, value: raw as Shot }`.
   * The engine stores exactly what this returns and never rebuilds a node's
   * data field by field, which is what makes `Data` a real type parameter
   * instead of a whitelist the engine has to be taught.
   */
  parse(raw, ctx) {
    const record = asRecord(raw);
    if (record === null) {
      return { ok: false, error: issue("$", "shot data must be an object") };
    }

    const slug = record["slug"];
    if (typeof slug !== "string" || slug.trim() === "") {
      return {
        ok: false,
        error: issue("$.slug", "slug must be a non-empty string"),
      };
    }

    const seconds = record["seconds"];
    if (typeof seconds !== "number" || !Number.isFinite(seconds)) {
      return {
        ok: false,
        error: issue("$.seconds", "seconds must be a finite number"),
      };
    }

    const camera = record["camera"];
    if (typeof camera !== "string") {
      // A WARNING, not a failure. `ctx.warn` lands in the `LoadReport` and the
      // node still loads; reserve a rejection for data you cannot represent.
      ctx.warn({ path: "$.camera", message: "no camera recorded" });
    }

    return {
      ok: true,
      value: {
        slug,
        seconds,
        camera: typeof camera === "string" ? camera : "unspecified",
      },
    };
  },

  serialize(data) {
    return { ...data };
  },

  /**
   * Returns a `Result`, never throws. A refusal here is relayed to the caller
   * verbatim as `Rejection.editRejection` — see the "Editing" story, which
   * shows one being rejected and printed instead of swallowed.
   */
  applyEdit(data, edit) {
    if (edit.type === "rename") {
      if (edit.slug.trim() === "") {
        return {
          ok: false,
          error: { code: "empty-slug", message: "A shot needs a name." },
        };
      }
      return { ok: true, value: { ...data, slug: edit.slug } };
    }
    if (edit.seconds <= 0) {
      return {
        ok: false,
        error: {
          code: "non-positive-duration",
          message: "A shot has to last longer than zero seconds.",
        },
      };
    }
    return { ok: true, value: { ...data, seconds: edit.seconds } };
  },
});

const noteType = defineNodeType<Note, NoteEdit>()({
  kind: "note",
  container: false,
  schemaVersion: 1,
  parse(raw) {
    const record = asRecord(raw);
    if (record === null) {
      return { ok: false, error: issue("$", "note data must be an object") };
    }
    const text = record["text"];
    if (typeof text !== "string") {
      return { ok: false, error: issue("$.text", "text must be a string") };
    }
    const author = record["author"];
    return {
      ok: true,
      value: { text, author: typeof author === "string" ? author : "anon" },
    };
  },
  serialize(data) {
    return { ...data };
  },
  applyEdit(data, edit) {
    return { ok: true, value: { ...data, text: edit.text } };
  },
});

const sequenceType = defineNodeType<Sequence, SequenceEdit>()({
  kind: "sequence",
  // KIND-LEVEL, never a predicate over data. A kind that is sometimes a
  // container cannot have its children invariants checked, and "does this node
  // have children" would become a question about content.
  container: true,
  schemaVersion: 1,
  parse(raw) {
    const record = asRecord(raw);
    if (record === null) {
      return { ok: false, error: issue("$", "sequence data must be an object") };
    }
    const name = record["name"];
    if (typeof name !== "string" || name.trim() === "") {
      return {
        ok: false,
        error: issue("$.name", "name must be a non-empty string"),
      };
    }
    return { ok: true, value: { name } };
  },
  serialize(data) {
    return { ...data };
  },
  applyEdit(data, edit) {
    return { ok: true, value: { ...data, name: edit.name } };
  },
});

/**
 * The registry tuple, named once so the folds below can be written against it.
 * It has to be a TUPLE (not `WidenedNodeType[]`) — that is what makes
 * `node.kind === "shot"` narrow `node.data` to `Shot` downstream.
 */
type Types = readonly [typeof shotType, typeof noteType, typeof sequenceType];

// ---------------------------------------------------------------------------
// 3. The summary type — what a collection remembers about children it has not
//    loaded yet
// ---------------------------------------------------------------------------

type Summary = Readonly<{ seconds: number; shots: number }>;

const summaryType: ConsumerDefinedSummaryType<Summary> = {
  parse(raw) {
    const record = asRecord(raw);
    if (record === null) {
      return { ok: false, error: issue("$", "summary must be an object") };
    }
    const seconds = record["seconds"];
    const shots = record["shots"];
    if (typeof seconds !== "number" || typeof shots !== "number") {
      return {
        ok: false,
        error: issue("$", "summary needs numeric `seconds` and `shots`"),
      };
    }
    return { ok: true, value: { seconds, shots } };
  },
  serialize(summary) {
    return { ...summary };
  },
};

// ---------------------------------------------------------------------------
// 4. Folds — one registered fold per question
// ---------------------------------------------------------------------------

/**
 * Total duration, via `foldMonoid` — the ergonomic path for sums and counts.
 *
 * `placeholder` is what makes the "Lazy loading" story honest: a collection
 * nobody has read reports its STORED number at certainty `"estimated"`, and one
 * with no stored number at all reports `0` at `"partial"`. Neither pretends to
 * be a measurement.
 */
const secondsFold = foldMonoid<Types, Summary, number>({
  key: "seconds",
  empty: 0,
  leaf(node) {
    // The collection is genuinely heterogeneous, so the fold has to say what
    // each kind contributes. A note has no duration; it contributes nothing,
    // and it says so here rather than by accident.
    return node.kind === "shot" ? node.data.seconds : 0;
  },
  concat(a, b) {
    return a + b;
  },
  placeholder(node) {
    // `undefined` is the declared sentinel for "nothing stored", which
    // foldMonoid turns into `empty` at `"partial"`.
    return node.summary === null ? undefined : node.summary.seconds;
  },
});

/**
 * How many shots are in this subtree — written OUT BY HAND rather than with
 * `foldMonoid`, because seeing all five hooks once is worth more than saving
 * fifteen lines.
 *
 * `collection` is GRAPH-BLIND on purpose: it gets its own node and its
 * children's already-folded values, and nothing else. That blindness is what
 * makes "invalidate the changed nodes and their ancestor chains" provably
 * sufficient; a fold handed the graph could read anything, and then the only
 * correct invalidation would be "drop everything".
 *
 * Reach for a hand-written `ConsumerDefinedFold` when you need something a monoid cannot
 * express: a subtree veto (a container's own flag dropping everything under
 * it), an empty-collection floor (`children.length === 0` is visible here and
 * is NOT the same as the monoid identity), or position-sensitive certainty.
 */
const shotsFold: ConsumerDefinedFold<Types, Summary, number> = {
  key: "shots",

  leaf(node) {
    return node.kind === "shot" ? 1 : 0;
  },

  collection(_node, children) {
    let total = 0;
    const certainties: Certainty[] = [];
    for (const child of children) {
      total += child.value;
      certainties.push(child.certainty);
    }
    // Weakest-wins is right for a COUNT. It is not right in general, which is
    // exactly why `collection` returns `Folded<A>` and not `A` — a fold whose
    // answer stops depending on the holes is free to keep reporting "exact".
    return folded(total, weakestCertainty(certainties));
  },

  placeholder(node) {
    if (node.summary === null) return folded(0, "partial");
    return folded(node.summary.shots, "estimated");
  },

  // MUST be "exact". Confirmed-gone is knowledge, not a gap: a subtree whose
  // only holes are `missing` is fully known to be empty.
  missing() {
    return foldedExact(0);
  },

  // REQUIRED — there is no default. Data this build cannot parse has to be
  // answered for, and "partial" is the honest answer.
  quarantined() {
    return folded(0, "partial");
  },
};

// ---------------------------------------------------------------------------
// 5. The engine — PURE. No React below this line reaches it.
// ---------------------------------------------------------------------------

/**
 * Deterministic ids, because stories are tests here and a random id in a
 * snapshot is a flake waiting to happen. A real app omits `mintId` and takes
 * the built-in generator.
 */
let mintCounter = 0;
function mintId(): string {
  mintCounter += 1;
  return `minted-${mintCounter}`;
}

const engine = createEngine({
  types: [shotType, noteType, sequenceType] as const,
  summary: summaryType,
  folds: { seconds: secondsFold, shots: shotsFold },
  mintId,
  // Deterministic `HistoryEntry.at`, same reasoning as `mintId`.
  now: () => 0,
  // Runs the affordable-in-dev checks: a `parse(serialize(d))` round-trip,
  // deep-freezing parsed values, and an invariant audit after every commit.
  // Leave this ON in stories — a story that corrupts the graph should say so.
  devChecks: true,
});

// ---------------------------------------------------------------------------
// 6. The React bindings
// ---------------------------------------------------------------------------

/**
 * ONE call, at module scope, and everything React-shaped comes out of it.
 *
 * It is a factory rather than a set of module exports because `createContext`
 * cannot be generic: a module-scope `createContext<Store<Ts, S, F> | null>` has
 * nowhere to get `Ts` from, so `useNode` would hand back an erased node and
 * every `switch (node.kind)` would have nothing to switch on. Creating the
 * contexts INSIDE a call where `Ts` is already bound is what keeps the type
 * parameter alive all the way to `data.slug` in a view.
 */
const ui = createReactBindings(engine);

// ===========================================================================
// PER-KIND VIEWS
// ===========================================================================
//
// Registered at MODULE SCOPE, before the first render. The registry is read
// during render, so a late registration does not re-render mounted slots — the
// bindings log an error if you try.
//
// Each view is an ORDINARY non-generic component. `NodeSlot` takes `{ id }` and
// nothing else and dispatches by kind, so there is no render prop for a
// parent's re-render to hand in fresh and no generic signature for `memo` to
// erase.

ui.defineNodeView("shot", function ShotView({ id, data }) {
  const dispatch = ui.useDispatch();
  const move = useMoveWithinParent();

  return (
    <div data-testid={`node-${id}`} className={classes.row}>
      <Tag>SHOT</Tag>
      <span data-testid={`slug-${id}`} className={classes.title}>
        {data.slug}
      </span>
      <span className={classes.muted}>
        {data.seconds}s · cam {data.camera}
      </span>
      <span className={classes.spacer} />
      <NudgeButtons id={id} move={move} />
      <Button
        testId={`rename-${id}`}
        onClick={() =>
          // ONE gesture = ONE command = ONE patch = ONE history entry. Renaming
          // every placement of an asset would be a single `edit-nodes` over all
          // of them, which is what keeps Ctrl-Z matching what the user did.
          dispatch({
            type: "edit-nodes",
            edits: [
              {
                nodeId: id,
                kind: "shot",
                edit: { type: "rename", slug: `${data.slug} (v2)` },
              },
            ],
          })
        }
      >
        Rename
      </Button>
    </div>
  );
});

ui.defineNodeView("note", function NoteView({ id, data }) {
  const move = useMoveWithinParent();

  return (
    <div data-testid={`node-${id}`} className={classes.row}>
      <Tag>NOTE</Tag>
      <span data-testid={`text-${id}`} className={classes.title}>
        {data.text}
      </span>
      <span className={classes.muted}>— {data.author}</span>
      <span className={classes.spacer} />
      <NudgeButtons id={id} move={move} />
    </div>
  );
});

ui.defineNodeView("sequence", function SequenceView({ id, data }) {
  const childIds = ui.useChildren(id);
  const state = useChildrenState(id);
  const move = useMoveWithinParent();

  return (
    <section data-testid={`node-${id}`} className={classes.collection}>
      <header className={classes.collectionHead}>
        <Tag>SEQ</Tag>
        <span className={classes.title}>{data.name}</span>
        <Rollup id={id} />
        {state === undefined ? null : <StateChip status={state.status} />}
        <span className={classes.spacer} />
        <NudgeButtons id={id} move={move} />
      </header>

      {state !== undefined && state.status === "loaded" ? (
        <div className={classes.children}>
          {childIds.length === 0 ? (
            // KNOWN to be empty — the four-state `ChildrenState` is what lets
            // this sentence be written at all. A three-state model cannot tell
            // "empty" from "not read yet".
            <p className={classes.muted}>Empty, and known to be empty.</p>
          ) : (
            childIds.map((childId) => (
              <ui.NodeSlot key={childId} id={childId} />
            ))
          )}
        </div>
      ) : (
        <PlaceholderBody id={id} state={state} />
      )}
    </section>
  );
});

/**
 * The fallback for data this build does not understand.
 *
 * Registering one is optional; without it a quarantined node renders nothing.
 * The engine keeps it movable, removable and re-emitted byte-exact either way —
 * what it looks like is a product decision keel cannot make for you.
 */
ui.defineQuarantinedView(function QuarantinedView({ id, node }) {
  const move = useMoveWithinParent();
  const firstIssue = node.issues[0];

  return (
    <div data-testid={`node-${id}`} className={cx(classes.row, classes.warn)}>
      <Tag tone="warn">?</Tag>
      <span className={classes.title}>
        kind {node.kind} — {node.reason}
      </span>
      <span data-testid={`why-${id}`} className={classes.muted}>
        {/* The engine always attaches at least one Issue, for both quarantine
            reasons — but `issues` is a readonly array and this repo types
            `arr[0]` as possibly undefined, so the empty case is answered rather
            than asserted away. */}
        {firstIssue === undefined ? "(no detail)" : firstIssue.message}
      </span>
      <span className={classes.spacer} />
      {/* Still movable. That is the point: quarantine is not a tombstone. */}
      <NudgeButtons id={id} move={move} />
    </div>
  );
});

// ===========================================================================
// SHARED HOOKS AND CHROME
// ===========================================================================

/**
 * Move one node one slot within its own parent.
 *
 * THE LESSON IS THE INDEX. `resolveDrop` takes what the VIEW measured —
 * PRE-removal coordinates, the only coordinates a view can see — and is the one
 * place in the whole system that converts it to the post-removal index a
 * `move-nodes` command carries.
 *
 * Note the asymmetry, which is exactly why that conversion lives in the engine:
 *   up   -> `from - 1`  (the gap before the previous sibling)
 *   down -> `from + 2`, NOT `from + 1`, because the node itself still occupies
 *           `from` while the view is looking, so `from + 1` is the gap it is
 *           already in. `resolveDrop` correctly rejects that as `empty-command`.
 */
function useMoveWithinParent(): (id: NodeId, direction: -1 | 1) => void {
  const store = ui.useStore();

  return useCallback(
    (id, direction) => {
      // Read the graph AT CLICK TIME, not at render time. `store` is stable for
      // its lifetime, so this closure can never go stale.
      const graph = store.getGraph();
      // `getParent`, not `graph.parentById.get` — the map answers `undefined`
      // for an unknown id and `null` for a root, and this caller wants the same
      // thing in both cases. The accessor already collapses them.
      const parentId = getParent(graph, id);
      if (parentId === null) return;

      // `getChildren` answers `[]` for anything that is not a loaded
      // collection, and `[]` fails the `indexOf` below exactly as `undefined`
      // did — so the load state is not load-bearing HERE. Where it is, this
      // file uses `childrenStateOf`; see the drop handler below.
      const siblings = getChildren(graph, parentId);

      const from = siblings.indexOf(id);
      if (from < 0) return;

      const toIndexBefore = direction === -1 ? from - 1 : from + 2;
      if (toIndexBefore < 0 || toIndexBefore > siblings.length) return;

      const command = store.resolveDrop({
        type: "move",
        nodeIds: [id],
        toParentId: parentId,
        toIndexBefore,
      });
      // Rejections are RETURNED, never thrown. A no-op drop is one of them.
      if (!command.ok) return;
      store.dispatch(command.value);
    },
    [store],
  );
}

/** Append a node to the end of another collection. */
function useMoveToCollection(): (id: NodeId, toParentId: NodeId) => void {
  const store = ui.useStore();

  return useCallback(
    (id, toParentId) => {
      const graph = store.getGraph();
      // The target must be a LOADED collection — the engine would refuse the
      // drop with `target-not-loaded` anyway, because a post-removal index into
      // children you have never seen has no honest value.
      //
      // `childrenStateOf` is what answers that. `getChildren` cannot: it
      // returns `[]` for a loaded-and-empty collection AND for an unloaded one,
      // and collapsing those two is the exact ambiguity this engine exists to
      // remove. Reading `graph.childrenById` raw would also distinguish them,
      // which is why this line used to — but that spelling reaches past the
      // accessor that states the contract, and the contract is what survives a
      // change to how the graph stores its indexes.
      if (childrenStateOf(graph, toParentId)?.status !== "loaded") return;
      const target = getChildren(graph, toParentId);

      const command = store.resolveDrop({
        type: "move",
        nodeIds: [id],
        toParentId,
        toIndexBefore: target.length,
      });
      if (!command.ok) return;
      store.dispatch(command.value);
    },
    [store],
  );
}

/**
 * A collection's load state, or `undefined` for anything that is not one.
 *
 * DISCRIMINATE ON `quarantined` FIRST. `container` cannot do it: on the
 * quarantined arm it is a plain `boolean` read off the wire, so it is not
 * disjoint from the literal `true` / `false` on the other two arms.
 */
function useChildrenState(id: NodeId): ChildrenState | undefined {
  const node = ui.useNode(id);
  if (node === undefined) return undefined;
  if (node.quarantined) return node.children ?? undefined;
  if (!node.container) return undefined;
  return node.children;
}

/** What a not-loaded collection says about itself, and how to fill it. */
function PlaceholderBody({
  id,
  state,
}: Readonly<{ id: NodeId; state: ChildrenState | undefined }>) {
  const store = ui.useStore();
  const [problem, setProblem] = useState<string | null>(null);

  if (state === undefined) return null;

  if (state.status === "reference") {
    return (
      <p data-testid={`state-${id}`} className={classes.muted}>
        reference — another placement owns these children, and this one is
        structurally childless forever.
      </p>
    );
  }

  if (state.status === "missing") {
    return (
      <p data-testid={`state-${id}`} className={classes.muted}>
        missing ({state.reason}) — confirmed gone, so the rollup above is EXACT.
      </p>
    );
  }

  const payload = LAZY_PAYLOADS.get(id);

  return (
    <div className={classes.children}>
      <p data-testid={`state-${id}`} className={classes.muted}>
        unloaded — nobody has read these children, so the rollup above is a
        guess and says so.
      </p>
      {payload !== undefined ? (
        <Button
          testId={`load-${id}`}
          onClick={() => {
            // `load` takes a full SerializedDocument, not a bare children
            // array, so MIGRATIONS RUN ON LAZY PAYLOADS TOO. It produces no
            // patch, no history entry and no change-feed event — it is IO
            // landing, not something the user did.
            const result = store.load(id, payload);
            setProblem(result.ok ? null : result.error.message);
          }}
        >
          Load children
        </Button>
      ) : (
        <p className={classes.muted}>No payload registered for this one.</p>
      )}
      {problem !== null ? <p className={classes.muted}>{problem}</p> : null}
    </div>
  );
}

/**
 * Both registered folds, with their certainty ALWAYS printed.
 *
 * Printing it is the whole point of `Folded<A>`. A UI that shows the number and
 * hides the certainty is the exact bug the type exists to prevent: the reader
 * cannot tell a measurement from a remembered guess, and neither can the code
 * that later persists it.
 */
function Rollup({ id }: Readonly<{ id: NodeId }>) {
  const seconds = ui.useFold("seconds", id);
  const shots = ui.useFold("shots", id);

  return (
    <span data-testid={`rollup-${id}`} className={classes.rollup}>
      <span className={certaintyClass(seconds)}>
        {formatFolded(seconds, "s")}
      </span>
      {" · "}
      <span className={certaintyClass(shots)}>
        {formatFolded(shots, " shots")}
      </span>
    </span>
  );
}

function formatFolded(
  value: Folded<number> | undefined,
  unit: string,
): string {
  // `undefined` means the node is gone. Routine in React, where a card outlives
  // its node by a frame on every removal.
  if (value === undefined) return "—";
  return `${value.value}${unit} (${value.certainty})`;
}

/**
 * The persistence gate, demonstrated.
 *
 * `summaryFrom` accepts ONLY the `"exact"` member of `Folded<A>` — the TYPE
 * refuses an estimate, not a runtime check a caller can forget. The failure it
 * is aimed at is measured: a duration accumulator starting at zero persisted
 * `0` for every empty collection, the write path persisted documents through
 * that projection, and every reader downstream then had to defend forever
 * against a number that was never a measurement.
 */
function PersistPanel({ id }: Readonly<{ id: NodeId }>) {
  const seconds = ui.useFold("seconds", id);
  const shots = ui.useFold("shots", id);
  const [written, setWritten] = useState<string>("nothing written yet");

  return (
    <div className={classes.panel}>
      <Button
        testId="persist"
        onClick={() => {
          if (seconds === undefined || shots === undefined) return;
          if (seconds.certainty !== "exact" || shots.certainty !== "exact") {
            setWritten("refused: only an exact rollup may be stored");
            return;
          }
          // Both are narrowed to the "exact" member here, so `summaryFrom`
          // compiles. Delete either check above and it stops compiling.
          const summary: Summary = {
            seconds: summaryFrom(seconds),
            shots: summaryFrom(shots),
          };
          setWritten(JSON.stringify(summary));
        }}
      >
        Write rollup to the stored summary
      </Button>
      <code data-testid="persist-result" className={classes.code}>
        {written}
      </code>
    </div>
  );
}

/** Undo/redo, with the buttons disabled from the store rather than guessed. */
function HistoryBar() {
  const { canUndo, canRedo, undo, redo } = ui.useHistory();

  return (
    <div className={classes.panel}>
      <Button testId="undo" disabled={!canUndo} onClick={() => void undo()}>
        Undo
      </Button>
      <Button testId="redo" disabled={!canRedo} onClick={() => void redo()}>
        Redo
      </Button>
      <span className={classes.muted}>
        undo={String(canUndo)} redo={String(canRedo)}
      </span>
    </div>
  );
}

/** The literal children array, so the move stories can be read at a glance. */
function ChildOrder({
  id,
  label,
}: Readonly<{ id: NodeId; label: string }>) {
  const childIds = ui.useChildren(id);
  return (
    <p data-testid={`order-${id}`} className={classes.code}>
      {label}: {childIds.length === 0 ? "(empty)" : childIds.join(", ")}
    </p>
  );
}

/**
 * What this node looks like on the wire RIGHT NOW.
 *
 * Used by the quarantine story to show that a node whose kind this build has
 * never heard of is re-emitted byte-exact — nothing is dropped, nothing is
 * normalized, and a round-trip through an old client cannot destroy it.
 */
function ReEmittedNode({ id }: Readonly<{ id: NodeId }>) {
  const graph = ui.useGraph();
  const wire: SerializedNode | undefined = engine
    .serialize(graph)
    .nodes.find((node) => node.id === id);

  return (
    <code data-testid={`wire-${id}`} className={classes.code}>
      {JSON.stringify(wire?.data ?? null)}
    </code>
  );
}

function NudgeButtons({
  id,
  move,
}: Readonly<{ id: NodeId; move: (id: NodeId, direction: -1 | 1) => void }>) {
  return (
    <>
      <Button testId={`up-${id}`} onClick={() => move(id, -1)}>
        up
      </Button>
      <Button testId={`down-${id}`} onClick={() => move(id, 1)}>
        down
      </Button>
    </>
  );
}

/** Mounts one document as a fresh store. Every story gets its own. */
function Stage({
  doc,
  children,
}: Readonly<{ doc: SerializedDocument; children?: ReactNode }>) {
  // A lazy initializer, so the store survives re-renders and is built once.
  const [store] = useState(() => {
    const loaded = engine.deserialize(doc);
    // `deserialize` is Result-shaped. A fixture that fails is a story bug, and
    // throwing surfaces it as a broken story instead of an empty box.
    if (!loaded.ok) {
      throw new Error(`fixture did not load: ${loaded.error.message}`);
    }
    return engine.createStore(loaded.value.graph);
  });

  return (
    <ui.Provider store={store}>
      <div className={classes.stage}>{children}</div>
    </ui.Provider>
  );
}

/** Every root, rendered through the kind registry. */
function Roots() {
  const rootIds = ui.useRoots();
  return (
    <>
      {rootIds.map((id) => (
        <ui.NodeSlot key={id} id={id} />
      ))}
    </>
  );
}

function Lesson({
  title,
  children,
}: Readonly<{ title: string; children: ReactNode }>) {
  return (
    <div className={classes.lesson}>
      <h3 className={classes.lessonTitle}>{title}</h3>
      <p className={classes.lessonBody}>{children}</p>
    </div>
  );
}

function Tag({
  children,
  tone,
}: Readonly<{ children: ReactNode; tone?: "warn" }>) {
  return (
    <span className={tone === "warn" ? classes.tagWarn : classes.tag}>
      {children}
    </span>
  );
}

function Button({
  testId,
  onClick,
  disabled,
  children,
}: Readonly<{
  testId: string;
  onClick(): void;
  disabled?: boolean;
  children: ReactNode;
}>) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      disabled={disabled === true}
      className={disabled === true ? classes.buttonOff : classes.button}
    >
      {children}
    </button>
  );
}

/**
 * TAILWIND CLASSES, and two things have to be true for them to work.
 *
 * FIRST, the storybook workspace's Tailwind entry must name this package in an
 * `@source` glob. It scans files, not imports, so a class written here is
 * compiled ONLY if `.storybook/globals.css` was told to look — and when it was
 * not, the class name still renders in the DOM and simply matches no CSS. The
 * story comes out unstyled with nothing anywhere saying why, which is the same
 * failure mode this repo has already paid for once with `lib/` and portals.
 *
 * SECOND, and less obvious: a class must appear LITERALLY in a scanned file.
 * Tailwind never runs this code, so a class name assembled at runtime compiles
 * to nothing. That is why every variant below is a whole string in a table
 * rather than an interpolation like `text-${hue}-600`.
 *
 * COLOUR IS THEME-AGNOSTIC ON PURPOSE. Neutrals are `currentColor` dimmed with
 * `opacity-*`, never a fixed grey, and every semantic hue is a mid-tone (600)
 * over a low-opacity fill of its own colour — legible on a white ground and on
 * a near-black one. Storybook currently forces a light ground here, so a fixed
 * dark text colour would look identical today and break silently the day that
 * changes.
 *
 * WHAT THE COLOUR IS SPENT ON is the whole design: the two ideas this tour
 * exists to teach — which of the four states a collection's children are in,
 * and how much a rollup is worth — are the only things allowed to be coloured.
 * Everything else is a neutral at some opacity. A tour that renders `exact`
 * and `partial` in identical grey has hidden its own subject, which is what
 * the first version did.
 *
 * Truly dynamic values — a computed indent, for instance — stay inline.
 */
const classes = {
  stage: "flex flex-col gap-4 font-sans text-sm leading-relaxed",
  lesson: "flex flex-col gap-1.5 max-w-[68ch]",
  lessonTitle: "m-0 text-[15px] font-semibold tracking-tight",
  lessonBody: "m-0 text-[13px] leading-relaxed opacity-65",

  collection:
    "flex flex-col gap-2 rounded-xl p-2.5 ring-1 ring-neutral-500/15",
  collectionHead:
    "flex items-center gap-2.5 rounded-lg bg-neutral-500/8 px-2.5 py-1.5",
  children:
    "ml-1.5 flex flex-col gap-1.5 border-l border-neutral-500/20 pl-3.5",

  row: "flex items-center gap-2.5 rounded-lg bg-neutral-500/5 px-2.5 py-1.5 transition-colors hover:bg-neutral-500/10",
  warn: "bg-amber-500/12 ring-1 ring-inset ring-amber-600/40 hover:bg-amber-500/18",

  title: "font-medium",
  muted: "m-0 opacity-60",
  spacer: "flex-1",

  // Quiet and uniform. The kind is context, not the lesson — colour is spent
  // on state and certainty instead, so this stays a neutral outline.
  tag: "shrink-0 rounded px-1.5 py-0.5 font-mono text-[9.5px] font-medium uppercase tracking-[0.08em] opacity-55 ring-1 ring-inset ring-neutral-500/25",
  tagWarn:
    "shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 font-mono text-[9.5px] font-medium uppercase tracking-[0.08em] text-amber-700 ring-1 ring-inset ring-amber-600/40",

  rollup: "font-mono text-[11.5px] tabular-nums",
  // `exact` is the ordinary case and gets no decoration; anything less than
  // exact is underlined as well as tinted, so it survives a greyscale screen
  // and a reader who does not know the colour code yet.
  certaintyExact: "opacity-55",
  certaintyEstimated:
    "text-amber-600 underline decoration-dashed decoration-amber-600/40 underline-offset-[3px]",
  certaintyPartial:
    "text-rose-600 underline decoration-dashed decoration-rose-600/40 underline-offset-[3px]",

  // The four children states, which is the distinction the whole engine turns
  // on. `unloaded` is DASHED rather than tinted: nothing is wrong with it, we
  // simply have not looked, and a colour would read as a status.
  stateChip:
    "shrink-0 rounded border px-1.5 py-0.5 font-mono text-[9.5px] font-medium uppercase tracking-[0.08em]",
  stateLoaded: "border-emerald-500/35 bg-emerald-500/10 text-emerald-600",
  stateUnloaded: "border-dashed border-neutral-500/40 opacity-55",
  stateReference: "border-sky-500/35 bg-sky-500/10 text-sky-600",
  stateMissing: "border-rose-500/35 bg-rose-500/10 text-rose-600",

  panel: "flex flex-wrap items-center gap-2",
  code: "m-0 rounded bg-neutral-500/8 px-2 py-1 font-mono text-[11.5px] opacity-70",

  button:
    "cursor-pointer rounded-md px-2 py-1 font-sans text-[11.5px] font-medium opacity-70 ring-1 ring-inset ring-neutral-500/25 transition-colors hover:bg-neutral-500/10 hover:opacity-100 active:bg-neutral-500/20",
  buttonOff:
    "cursor-not-allowed rounded-md px-2 py-1 font-sans text-[11.5px] font-medium opacity-30 ring-1 ring-inset ring-neutral-500/15",
} as const;

/**
 * A `ChildrenState` rendered as the thing it is: one of four, distinguishable
 * without reading the word.
 */
function StateChip({ status }: Readonly<{ status: ChildrenState["status"] }>) {
  const tone =
    status === "loaded"
      ? classes.stateLoaded
      : status === "unloaded"
        ? classes.stateUnloaded
        : status === "reference"
          ? classes.stateReference
          : classes.stateMissing;
  return <span className={cx(classes.stateChip, tone)}>{status}</span>;
}

/** How much a folded number is worth, as a class rather than a word. */
function certaintyClass(value: Folded<number> | undefined): string {
  if (value === undefined) return classes.certaintyExact;
  return value.certainty === "exact"
    ? classes.certaintyExact
    : value.certainty === "estimated"
      ? classes.certaintyEstimated
      : classes.certaintyPartial;
}


// ===========================================================================
// FIXTURES — deterministic, nothing fetches
// ===========================================================================

/**
 * PER KIND, because one number cannot advance three independent schemas.
 * `sticker` is declared even though this build has no node type for it: a document
 * is allowed to carry kinds you do not understand, and saying so is what lets
 * quarantine round-trip.
 */
const SCHEMA_VERSIONS: Readonly<Record<string, number>> = {
  shot: 1,
  note: 1,
  sequence: 1,
  sticker: 1,
};

function wireShot(
  id: string,
  slug: string,
  seconds: number,
  camera: string,
): SerializedNode {
  return { id, kind: "shot", data: { slug, seconds, camera } };
}

function wireNote(id: string, text: string, author: string): SerializedNode {
  return { id, kind: "note", data: { text, author } };
}

/** `children` PRESENT is what makes a collection `loaded` on the wire. */
function wireSequence(
  id: string,
  name: string,
  children: readonly string[],
): SerializedNode {
  return { id, kind: "sequence", children, data: { name } };
}

/** `children` ABSENT plus an explicit tag. `summary: null` means "nothing stored". */
function wireUnloaded(
  id: string,
  name: string,
  summary: Summary | null,
): SerializedNode {
  return {
    id,
    kind: "sequence",
    childrenState: "unloaded",
    summary,
    data: { name },
  };
}

/** A FLAT node list — no recursion, no depth limit, every node addressable. */
function wireDocument(
  rootIds: readonly string[],
  nodes: readonly SerializedNode[],
): SerializedDocument {
  return { formatVersion: 1, schemaVersions: SCHEMA_VERSIONS, rootIds, nodes };
}

const IDS = {
  actOne: parseNodeId("act-one"),
  reelA: parseNodeId("reel-a"),
  reelB: parseNodeId("reel-b"),
  sceneTwo: parseNodeId("scene-two"),
  sceneThree: parseNodeId("scene-three"),
  shotBridge: parseNodeId("shot-bridge"),
  sticker: parseNodeId("sticker-slate"),
} as const;

/** One collection, two different leaf kinds. 6s + 0s + 4s = 10s, 2 shots. */
const heterogeneousDoc = wireDocument(
  ["act-one"],
  [
    wireSequence("act-one", "Act One", [
      "shot-bridge",
      "note-lighting",
      "shot-reveal",
    ]),
    wireShot("shot-bridge", "Bridge, wide", 6, "A"),
    wireNote("note-lighting", "Match the 4pm key from the last setup.", "Joe"),
    wireShot("shot-reveal", "Reveal, push in", 4, "B"),
  ],
);

/** A sequence inside a sequence. 6 + (4 + 3) = 13s, 3 shots. */
const nestedDoc = wireDocument(
  ["act-one"],
  [
    wireSequence("act-one", "Act One", [
      "shot-bridge",
      "scene-two",
      "note-lighting",
    ]),
    wireShot("shot-bridge", "Bridge, wide", 6, "A"),
    wireSequence("scene-two", "Scene Two", ["shot-door", "shot-hands"]),
    wireShot("shot-door", "Door, medium", 4, "A"),
    wireShot("shot-hands", "Hands on the latch", 3, "C"),
    wireNote("note-lighting", "Match the 4pm key from the last setup.", "Joe"),
  ],
);

/** Two sibling roots, so a node can move from one collection to another. */
const twoReelsDoc = wireDocument(
  ["reel-a", "reel-b"],
  [
    wireSequence("reel-a", "Reel A", [
      "shot-bridge",
      "note-lighting",
      "shot-reveal",
    ]),
    wireSequence("reel-b", "Reel B", ["shot-door"]),
    wireShot("shot-bridge", "Bridge, wide", 6, "A"),
    wireNote("note-lighting", "Match the 4pm key from the last setup.", "Joe"),
    wireShot("shot-reveal", "Reveal, push in", 4, "B"),
    wireShot("shot-door", "Door, medium", 4, "A"),
  ],
);

/**
 * One unloaded collection WITH a stored summary and one WITHOUT.
 *
 * The stored summary deliberately says 12s where the real payload below totals
 * 11s. That gap is the entire lesson: an estimate is an estimate, and the only
 * thing that makes the discrepancy survivable is that it was labelled.
 */
const lazyDoc = wireDocument(
  ["act-one"],
  [
    wireSequence("act-one", "Act One", [
      "shot-bridge",
      "scene-two",
      "scene-three",
    ]),
    wireShot("shot-bridge", "Bridge, wide", 6, "A"),
    wireUnloaded("scene-two", "Scene Two", { seconds: 12, shots: 3 }),
    wireUnloaded("scene-three", "Scene Three", null),
  ],
);

/**
 * What an app would fetch for an unloaded subtree. In a sub-document `rootIds`
 * names the nodes that become the target's children, and — unlike a top-level
 * document's roots — those need not be containers.
 */
const sceneTwoPayload = wireDocument(
  ["shot-door", "shot-hands", "shot-tilt"],
  [
    wireShot("shot-door", "Door, medium", 4, "A"),
    wireShot("shot-hands", "Hands on the latch", 3, "C"),
    wireShot("shot-tilt", "Tilt to the sky", 4, "A"),
  ],
);

const LAZY_PAYLOADS: ReadonlyMap<NodeId, SerializedDocument> = new Map([
  [IDS.sceneTwo, sceneTwoPayload],
]);

/**
 * Two ways to be un-parseable, side by side.
 *
 *  - `sticker-slate` is an UNKNOWN KIND — no node type is registered for it.
 *  - `shot-broken` is a KNOWN kind whose data fails its own `parse` (empty
 *    slug, non-numeric seconds).
 *
 * Both quarantine rather than killing the document, and that default exists
 * because the alternative shipped: one refused stored clip made a whole
 * document unwritable forever, and since the trash bin is rewritten on every
 * delete, deleting anything at all became impossible.
 */
const quarantineDoc = wireDocument(
  ["act-one"],
  [
    wireSequence("act-one", "Act One", [
      "shot-bridge",
      "sticker-slate",
      "shot-reveal",
      "shot-broken",
    ]),
    wireShot("shot-bridge", "Bridge, wide", 6, "A"),
    {
      id: "sticker-slate",
      kind: "sticker",
      data: { glyph: "clapper", label: "SLATE", addedBy: "a newer build" },
    },
    wireShot("shot-reveal", "Reveal, push in", 4, "B"),
    { id: "shot-broken", kind: "shot", data: { slug: "", seconds: "six" } },
  ],
);

// ===========================================================================
// STORIES
// ===========================================================================

const meta = {
  title: "KEEL/Tour",
  decorators: [
    (Story) => (
      <div className="p-6 text-inherit">
        <Story />
      </div>
    ),
  ],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * 1. A collection holding two DIFFERENT kinds.
 *
 * `shot` and `note` share no fields, no edit type and no view. The registry
 * tuple is what keeps them apart all the way down: `NodeSlot` dispatches on the
 * same `kind` the engine parsed the node with, and inside `ShotView` the `data`
 * prop is a `Shot` — not a union, not `unknown`.
 */
export const HeterogeneousCollection: Story = {
  render: () => (
    <Stage doc={heterogeneousDoc}>
      <Lesson title="One collection, two kinds">
        Every kind brings its own data type, its own edit type and its own view.
        The fold has to say what each kind contributes — a note has no duration,
        so it contributes nothing, and it says so explicitly.
      </Lesson>
      <Roots />
      <ChildOrder id={IDS.actOne} label="act-one children" />
    </Stage>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // Both kinds render, side by side, from one children array.
    await expect(canvas.getByTestId("node-shot-bridge")).toBeInTheDocument();
    await expect(canvas.getByTestId("node-note-lighting")).toBeInTheDocument();

    // 6s + 0s (the note) + 4s = 10s over 2 shots, and nothing is uncertain.
    await expect(canvas.getByTestId("rollup-act-one")).toHaveTextContent(
      "10s (exact)",
    );
    await expect(canvas.getByTestId("rollup-act-one")).toHaveTextContent(
      "2 shots (exact)",
    );
  },
};

/**
 * 2. Nesting.
 *
 * A container is just another kind. `SequenceView` renders `NodeSlot` for each
 * child, so nesting is recursion through the registry rather than anything the
 * engine has to be told about — and the rollup composes bottom-up for free.
 */
export const Nesting: Story = {
  render: () => (
    <Stage doc={nestedDoc}>
      <Lesson title="Containers are kinds too">
        A sequence renders a NodeSlot per child, and a child may be another
        sequence. Folds compose bottom-up: Scene Two totals itself, Act One adds
        that total to its own leaves.
      </Lesson>
      <Roots />
    </Stage>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // The inner sequence knows its own total...
    await expect(canvas.getByTestId("rollup-scene-two")).toHaveTextContent(
      "7s (exact)",
    );
    // ...and the outer one adds it to its own leaf.
    await expect(canvas.getByTestId("rollup-act-one")).toHaveTextContent(
      "13s (exact)",
    );
  },
};

/**
 * 3. Reordering, and moving between collections.
 *
 * Both are the same command. The only hard part is the index, and it is hard
 * exactly once, in `resolveDrop` — see `useMoveWithinParent` above for why
 * "down" is `from + 2` and not `from + 1`.
 */
export const ReorderAndMove: Story = {
  render: () => {
    return (
      <Stage doc={twoReelsDoc}>
        <Lesson title="One command, one index rule">
          Views measure PRE-removal positions, commands carry POST-removal ones,
          and resolveDrop is the only place that converts. Moving between
          collections is the same command with a different parent.
        </Lesson>
        <ReelToolbar />
        <Roots />
        <ChildOrder id={IDS.reelA} label="reel-a children" />
        <ChildOrder id={IDS.reelB} label="reel-b children" />
      </Stage>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("down-shot-bridge"));
    await expect(canvas.getByTestId("order-reel-a")).toHaveTextContent(
      "note-lighting, shot-bridge, shot-reveal",
    );

    await userEvent.click(canvas.getByTestId("send-to-reel-b"));
    await expect(canvas.getByTestId("order-reel-a")).toHaveTextContent(
      "note-lighting, shot-reveal",
    );
    await expect(canvas.getByTestId("order-reel-b")).toHaveTextContent(
      "shot-door, shot-bridge",
    );
  },
};

function ReelToolbar() {
  const moveTo = useMoveToCollection();
  return (
    <div className={classes.panel}>
      <Button
        testId="send-to-reel-b"
        onClick={() => moveTo(IDS.shotBridge, IDS.reelB)}
      >
        Send Bridge to Reel B
      </Button>
    </div>
  );
}

/**
 * 4. Editing content.
 *
 * `edit-nodes` is the ONE door into a node's data that the user drives. The
 * node type's `applyEdit` decides, and its refusal comes back as a value — the
 * button below asks for a zero-second shot and prints the rejection instead of
 * throwing it.
 */
export const EditingContent: Story = {
  render: () => (
    <Stage doc={heterogeneousDoc}>
      <Lesson title="Edits go through the node type">
        The engine never interprets a node data field. It hands the edit to that
        kind&apos;s applyEdit and stores whatever comes back — including
        &quot;no&quot;.
      </Lesson>
      <RejectedEditPanel />
      <Roots />
    </Stage>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("rename-shot-bridge"));
    await expect(canvas.getByTestId("slug-shot-bridge")).toHaveTextContent(
      "Bridge, wide (v2)",
    );

    // A refusal is a Result, not an exception, and it names the node type's code.
    await userEvent.click(canvas.getByTestId("bad-edit"));
    await expect(canvas.getByTestId("edit-result")).toHaveTextContent(
      "edit-rejected",
    );
    await expect(canvas.getByTestId("edit-result")).toHaveTextContent(
      "non-positive-duration",
    );
  },
};

function RejectedEditPanel() {
  const dispatch = ui.useDispatch();
  const [message, setMessage] = useState<string>("no edit attempted yet");

  return (
    <div className={classes.panel}>
      <Button
        testId="bad-edit"
        onClick={() => {
          const result = dispatch({
            type: "edit-nodes",
            edits: [
              {
                nodeId: IDS.shotBridge,
                kind: "shot",
                edit: { type: "retime", seconds: 0 },
              },
            ],
          });
          setMessage(
            result.ok
              ? "accepted"
              : `${result.error.code}: ${
                  result.error.editRejection?.code ?? result.error.message
                }`,
          );
        }}
      >
        Try to set Bridge to 0s
      </Button>
      <code data-testid="edit-result" className={classes.code}>
        {message}
      </code>
    </div>
  );
}

/**
 * 5. Undo and redo, including undo of a CONTENT edit.
 *
 * Undo of content works from a whole-value before/after pair, so the engine
 * needs zero knowledge of what a `Shot` is and the pair CANNOT be wrong. Delta
 * inverses are opt-in per kind and off by default, because a wrong inverse
 * corrupts silently N undos later and is undetectable in production.
 *
 * Structural undo is the same machinery: an insert records the placements it
 * made, and inverting flips `inserted` to `removed` with the array order
 * preserved.
 */
export const UndoAndRedo: Story = {
  render: () => (
    <Stage doc={heterogeneousDoc}>
      <Lesson title="One gesture, one history entry">
        A content edit and a structural insert produce the same kind of
        reversible record. Undo replays the inverse; redo replays the original
        patch AS RECORDED, ids included, so nothing that pointed at the node
        loses it.
      </Lesson>
      <HistoryBar />
      <AddNoteButton />
      <Roots />
      <ChildOrder id={IDS.actOne} label="act-one children" />
    </Stage>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // --- undo of a CONTENT edit ---
    await userEvent.click(canvas.getByTestId("rename-shot-bridge"));
    await expect(canvas.getByTestId("slug-shot-bridge")).toHaveTextContent(
      "Bridge, wide (v2)",
    );

    await userEvent.click(canvas.getByTestId("undo"));
    await expect(canvas.getByTestId("slug-shot-bridge")).toHaveTextContent(
      "Bridge, wide",
    );

    await userEvent.click(canvas.getByTestId("redo"));
    await expect(canvas.getByTestId("slug-shot-bridge")).toHaveTextContent(
      "Bridge, wide (v2)",
    );

    // --- undo of a STRUCTURAL change ---
    await userEvent.click(canvas.getByTestId("add-note"));
    await expect(canvas.getByTestId("rollup-act-one")).toHaveTextContent(
      "2 shots (exact)",
    );
    await expect(canvas.getByTestId("order-act-one")).toHaveTextContent(
      "minted-",
    );

    await userEvent.click(canvas.getByTestId("undo"));
    await expect(canvas.getByTestId("order-act-one")).not.toHaveTextContent(
      "minted-",
    );
  },
};

function AddNoteButton() {
  const store = ui.useStore();
  return (
    <div className={classes.panel}>
      <Button
        testId="add-note"
        onClick={() => {
          const graph = store.getGraph();
          // Loaded-or-nothing, for the same reason as the drop handler above:
          // appending at `children.length` is only honest when the children
          // are ones this client has actually seen.
          if (childrenStateOf(graph, IDS.actOne)?.status !== "loaded") return;
          const children = getChildren(graph, IDS.actOne);
          store.dispatch({
            type: "insert-nodes",
            // A SEED carries a VALUE and never an id — the engine mints the id,
            // so a consumer cannot collide with a node it never saw, and "an
            // insert is undoable" is true by construction rather than by
            // convention. The data still goes through `parse`.
            seeds: [
              {
                kind: "note",
                data: { text: "Continuity: the mug moves.", author: "Joe" },
              },
            ],
            toParentId: IDS.actOne,
            toIndex: children.length,
          });
        }}
      >
        Add a note
      </Button>
    </div>
  );
}

/**
 * 6. A rollup, and its certainty.
 *
 * Folds live in a memo table beside the store — never in the graph, never in a
 * patch, never persisted from a non-exact value. A rollup inside a patch is a
 * lie the moment anything moves.
 */
export const RollupWithCertainty: Story = {
  render: () => (
    <Stage doc={nestedDoc}>
      <Lesson title="Every aggregate carries how much it is worth">
        Two folds are registered here, seconds and shots. Both are cached by
        (foldKey, nodeId, subtreeRev), so a stale entry is unreachable rather
        than wrong — and only an exact one may be written back to storage.
      </Lesson>
      <PersistPanel id={IDS.actOne} />
      <Roots />
    </Stage>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("rollup-act-one")).toHaveTextContent(
      "13s (exact)",
    );

    // Nothing is unloaded and nothing is quarantined, so the gate opens.
    await userEvent.click(canvas.getByTestId("persist"));
    await expect(canvas.getByTestId("persist-result")).toHaveTextContent(
      '{"seconds":13,"shots":3}',
    );
  },
};

/**
 * 7. A collection nobody has read yet, and what its rollup honestly reports.
 *
 * FOUR children states, not three and not a boolean:
 *   loaded    — there is a children array, possibly empty
 *   unloaded  — this placement owns a subtree nobody has read
 *   reference — another placement owns it; childless forever
 *   missing   — storage CONFIRMED gone, so exactly empty, so EXACT
 *
 * Collapsing "empty" and "not read yet" is the ambiguity every downstream
 * compensation in the predecessor was scar tissue for. Watch the numbers: 18s
 * partial becomes 17s exact, because the stored summary said 12 and the truth
 * was 11.
 */
export const UnloadedCollection: Story = {
  render: () => (
    <Stage doc={lazyDoc}>
      <Lesson title="Honesty is contagious, and that is the feature">
        Scene Two is unloaded but carries a stored summary, so it reports an
        estimate. Scene Three is unloaded with nothing stored, so it reports
        partial. Either one drags the whole ancestor chain down to the weakest
        answer, which is what stops a guess being saved as a measurement.
      </Lesson>
      <MissingToolbar />
      <PersistPanel id={IDS.actOne} />
      <Roots />
    </Stage>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // A remembered number, labelled as remembered.
    await expect(canvas.getByTestId("rollup-scene-two")).toHaveTextContent(
      "12s (estimated)",
    );
    // Nothing stored at all: zero, and honest about it.
    await expect(canvas.getByTestId("rollup-scene-three")).toHaveTextContent(
      "0s (partial)",
    );
    // 6 + 12 + 0, and the weakest child wins the certainty.
    await expect(canvas.getByTestId("rollup-act-one")).toHaveTextContent(
      "18s (partial)",
    );

    // The gate refuses to store a guess.
    await userEvent.click(canvas.getByTestId("persist"));
    await expect(canvas.getByTestId("persist-result")).toHaveTextContent(
      "refused",
    );

    // Load the real children: 4 + 3 + 4 = 11, not the 12 that was remembered.
    await userEvent.click(canvas.getByTestId("load-scene-two"));
    await expect(canvas.getByTestId("rollup-scene-two")).toHaveTextContent(
      "11s (exact)",
    );

    // Confirming a subtree is gone is KNOWLEDGE, so it folds to exact — which
    // is what finally makes the whole document persistable.
    await userEvent.click(canvas.getByTestId("mark-missing"));
    await expect(canvas.getByTestId("rollup-act-one")).toHaveTextContent(
      "17s (exact)",
    );

    await userEvent.click(canvas.getByTestId("persist"));
    await expect(canvas.getByTestId("persist-result")).toHaveTextContent(
      '{"seconds":17,"shots":4}',
    );
  },
};

function MissingToolbar() {
  const store = ui.useStore();
  return (
    <div className={classes.panel}>
      <Button
        testId="mark-missing"
        onClick={() =>
          // IO landing, like `load`: no patch, no history entry, no change-feed
          // event. The consumer performed the lookup and already knows.
          store.markMissing(IDS.sceneThree, "deleted upstream")
        }
      >
        Confirm Scene Three is gone
      </Button>
    </div>
  );
}

/**
 * 8. Quarantine — data this build cannot understand.
 *
 * A node whose kind is unregistered, or whose data fails its own parse, becomes
 * a `QuarantinedNode`. It keeps its id, its position and its children. It is
 * movable, removable and undoable. It is NOT editable. It poisons its
 * ancestors' folds to "partial". And it re-emits byte-exact, so a round-trip
 * through this build cannot destroy what a newer one wrote.
 *
 * `QuarantinedNode` is a member of the READ type on purpose: an exhaustive
 * switch over `GraphNode` does not compile until forward-incompatible data is
 * handled.
 */
export const Quarantine: Story = {
  render: () => (
    <Stage doc={quarantineDoc}>
      <Lesson title="Survive the data you do not understand">
        Two failures here: a kind with no node type, and a known kind whose data is
        invalid. Neither kills the document. Rejecting instead is what once made
        a document unwritable forever — and since the trash bin is rewritten on
        every delete, that made deleting anything impossible.
      </Lesson>
      <Roots />
      <ChildOrder id={IDS.actOne} label="act-one children" />
      <p className={classes.muted}>Re-emitted wire data for the unknown node:</p>
      <ReEmittedNode id={IDS.sticker} />
    </Stage>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // It survived the load, both ways, and each node carries the engine's own
    // explanation of why it could not be built.
    await expect(canvas.getByTestId("node-sticker-slate")).toHaveTextContent(
      "unknown-kind",
    );
    await expect(canvas.getByTestId("why-sticker-slate")).toHaveTextContent(
      'No node type is registered for kind "sticker"',
    );
    await expect(canvas.getByTestId("node-shot-broken")).toHaveTextContent(
      "parse-failed",
    );

    // And it is honest about the cost: the ancestor rollup cannot be trusted.
    await expect(canvas.getByTestId("rollup-act-one")).toHaveTextContent(
      "(partial)",
    );

    // Still movable — quarantine is not a tombstone.
    await userEvent.click(canvas.getByTestId("down-sticker-slate"));
    await expect(canvas.getByTestId("order-act-one")).toHaveTextContent(
      "shot-bridge, shot-reveal, sticker-slate, shot-broken",
    );

    // Still byte-exact on the way back out: nothing dropped, nothing
    // normalized, including the field this build has never heard of.
    await expect(canvas.getByTestId("wire-sticker-slate")).toHaveTextContent(
      '"addedBy":"a newer build"',
    );
  },
};

// ===========================================================================
// 9. Drag and drop — the one seam the engine gives a pointer
// ===========================================================================
//
// KEEL SHIPS NO DRAG-AND-DROP, ON PURPOSE. It has no sensors, no collision
// detection, no overlay and no opinion about pixels. Its entire contract with a
// pointer is `store.resolveDrop(intent)`, and everything below is ordinary
// pointer handling that a consumer writes — or that dnd-kit, Pragmatic DnD or
// the native HTML5 API writes for them.
//
// That is the lesson: this story is not showing a KEEL feature, it is showing
// the integration point, and the integration point is one call.
//
// WHY `toIndexBefore` IS THE WHOLE POINT. The view knows where the pointer is
// in the list it is CURRENTLY DRAWING — the moved node still occupies its slot.
// The reducer needs the index AFTER that node is taken out. Those two numbers
// differ whenever you drag something downward inside its own parent, and
// getting it wrong is the most re-derived bug in a DnD engine (the predecessor
// silently appended on cut+paste for exactly this reason). `resolveDrop`
// converts one to the other in exactly one place, and this story prints both
// numbers so you can watch them disagree.
//
// ---------------------------------------------------------------------------
// HOW THE GESTURE IS WIRED, and why it is not the obvious way
// ---------------------------------------------------------------------------
//
// The obvious wiring puts `onPointerUp` on each drop target. That works right
// up until you add POINTER CAPTURE — and capture is not optional, because
// without it a pointer that leaves the window mid-drag never delivers its
// `pointerup` and the drag stays armed forever.
//
// Capture RETARGETS every subsequent event to the capturing element, so the
// drop target's own handler stops firing. The fix is to stop asking "what did
// the event land on" and start asking "what is under the pointer":
//
//   - `pointerdown` on a ROW captures the pointer and records the drag.
//   - `pointermove` / `pointerup` are handled ONCE, on the board. Captured
//     events retarget into the board and bubble; synthesised events dispatched
//     straight at a target bubble too. Both paths arrive at the same handler.
//   - the target is resolved from the COORDINATES with `elementFromPoint`.
//
// That last step is also what lets a row be a drop target: the pointer's Y
// against the row's midpoint says whether you meant before it or after it.

type DropSpot = Readonly<{ parentId: NodeId; indexBefore: number }>;

type DragApi = Readonly<{
  dragId: NodeId | null;
  hover: DropSpot | null;
  begin: (id: NodeId, event: React.PointerEvent<HTMLElement>) => void;
}>;

const DragContext = createContext<DragApi | null>(null);

function useDragApi(): DragApi {
  const api = useContext(DragContext);
  if (api === null) throw new Error("useDragApi used outside a DragBoard");
  return api;
}

/** Is this spot the one currently under the pointer? */
function isHovered(hover: DropSpot | null, parentId: NodeId, index: number): boolean {
  return hover !== null && hover.parentId === parentId && hover.indexBefore === index;
}

/**
 * Resolve the pointer position to a drop spot.
 *
 * A GAP names its index outright. A ROW is split at its midpoint — above means
 * "before me", below means "after me" — which turns a 16px target into a 42px
 * one and is what every real DnD implementation does.
 */
function spotAt(x: number, y: number): DropSpot | null {
  const under = document.elementFromPoint(x, y);
  return under === null ? null : spotIn(under, y);
}

/**
 * Where the pointer is, from the two signals an event carries — and it needs
 * both.
 *
 * COORDINATES FIRST, because under pointer capture the event's `target` is the
 * CAPTURING element (the row being dragged), not the thing under the cursor.
 * Trusting the target there would resolve every drop onto the dragged row's own
 * slot.
 *
 * TARGET AS THE FALLBACK, because a SYNTHESISED pointer — a play function, a
 * test — frequently carries no coordinates at all, and `elementFromPoint(0, 0)`
 * is not a drop target. This is not defensive padding: the first version of
 * this handler read coordinates only, and every assertion in the play function
 * came back "dropped on nothing".
 */
function spotFrom(event: React.PointerEvent<HTMLElement>): DropSpot | null {
  const byPoint = spotAt(event.clientX, event.clientY);
  if (byPoint !== null) return byPoint;
  const target = event.target;
  return target instanceof Element ? spotIn(target, event.clientY) : null;
}

function spotIn(under: Element, y: number): DropSpot | null {
  const gap = under.closest<HTMLElement>("[data-drop-parent]");
  if (gap !== null) {
    const parent = gap.dataset.dropParent;
    const index = Number(gap.dataset.dropIndex);
    if (parent === undefined || Number.isNaN(index)) return null;
    return { parentId: parseNodeId(parent), indexBefore: index };
  }

  const row = under.closest<HTMLElement>("[data-row-parent]");
  if (row !== null) {
    const parent = row.dataset.rowParent;
    const index = Number(row.dataset.rowIndex);
    if (parent === undefined || Number.isNaN(index)) return null;
    const box = row.getBoundingClientRect();
    const after = y > box.top + box.height / 2;
    return { parentId: parseNodeId(parent), indexBefore: index + (after ? 1 : 0) };
  }

  return null;
}

/**
 * The integration, in full. Everything else in this section is chrome.
 *
 * A REFUSED DROP IS A VALUE, NOT AN EXCEPTION. `resolveDrop` returns a Result,
 * so an illegal gesture — a collection into its own descendant, anything into a
 * subtree nobody has read — comes back as a code you can put on screen. The
 * graph is untouched and no history entry is written.
 */
function DragBoard({ children }: Readonly<{ children: ReactNode }>) {
  const store = ui.useStore();
  const dispatch = ui.useDispatch();
  const [dragId, setDragId] = useState<NodeId | null>(null);
  const [hover, setHover] = useState<DropSpot | null>(null);
  const [outcome, setOutcome] = useState("Drag a row onto a gap or another row.");

  const begin = useCallback((id: NodeId, event: React.PointerEvent<HTMLElement>) => {
    setDragId(id);
    setHover(null);
    // CAPTURE IS AN ENHANCEMENT, NOT A REQUIREMENT. It keeps the gesture alive
    // when the pointer leaves the element — without it, releasing outside the
    // window never delivers `pointerup` and the drag stays armed forever. But a
    // browser that refuses it, or a synthesised pointer that has no capture to
    // take, must still be able to drag: a failure here cannot abort the
    // gesture, so it is swallowed rather than thrown.
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // No capture; the board's own handlers still see the drag through.
    }
  }, []);

  const track = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      if (dragId === null) return;
      setHover(spotFrom(event));
    },
    [dragId],
  );

  const finish = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      if (dragId === null) return;
      const spot = spotFrom(event) ?? hover;
      setDragId(null);
      setHover(null);
      if (spot === null) {
        setOutcome("dropped on nothing");
        return;
      }

      // ---- THE FOUR LINES THAT ARE ACTUALLY ABOUT KEEL ------------------
      const resolved = store.resolveDrop({
        type: "move",
        nodeIds: [dragId],
        toParentId: spot.parentId,
        toIndexBefore: spot.indexBefore,
      });
      if (!resolved.ok) {
        setOutcome("refused · " + resolved.error.code);
        return;
      }
      const command = resolved.value;
      const committed = dispatch(command);
      // -------------------------------------------------------------------

      // Only a move carries the converted index. Reading it here is what lets
      // this story SHOW the conversion rather than assert it.
      const toIndex =
        command.type === "move-nodes" ? command.toIndex : spot.indexBefore;
      setOutcome(
        committed.ok
          ? "moved · dropped at " + spot.indexBefore + " · committed at " + toIndex
          : "rejected · " + committed.error.code,
      );
    },
    [dragId, dispatch, hover, store],
  );

  return (
    <DragContext.Provider value={{ dragId, hover, begin }}>
      <div data-testid="dnd-outcome" className={dndClasses.outcome}>
        {outcome}
      </div>
      <div
        // Exposed so the live feedback is observable to a test, not just to a
        // pair of eyes.
        data-testid="dnd-board"
        data-hover={hover === null ? "" : hover.parentId + ":" + hover.indexBefore}
        onPointerMove={track}
        onPointerUp={finish}
        // A cancelled pointer (the OS taking over, a context menu) must not
        // leave the drag armed.
        onPointerCancel={finish}
        className={dndClasses.board}
      >
        {children}
      </div>
    </DragContext.Provider>
  );
}

/** The gap between two rows. Its index is what the view can see. */
function Gap({
  parentId,
  indexBefore,
}: Readonly<{ parentId: NodeId; indexBefore: number }>) {
  const { dragId, hover } = useDragApi();
  const lit = isHovered(hover, parentId, indexBefore);
  return (
    <div
      data-testid={"gap-" + parentId + "-" + indexBefore}
      data-drop-parent={parentId}
      data-drop-index={indexBefore}
      className={cx(
        dndClasses.gap,
        dragId !== null && dndClasses.gapArmed,
        lit && dndClasses.gapLit,
      )}
    >
      <span className={dndClasses.gapIndex}>{indexBefore}</span>
    </div>
  );
}

/**
 * A draggable row, and a drop target in its own right.
 *
 * THE WHOLE ROW IS THE HANDLE. The grip is an affordance, not the hit area —
 * making only the grip draggable meant the intuitive gesture, grabbing the row,
 * did nothing at all.
 */
function DragRow({
  id,
  parentId,
  index,
}: Readonly<{ id: NodeId; parentId: NodeId; index: number }>) {
  const node = ui.useNode(id);
  const { dragId, hover, begin } = useDragApi();
  if (node === undefined) return null;

  const label = node.quarantined
    ? "(unreadable " + node.kind + ")"
    : node.kind === "shot"
      ? node.data.slug
      : node.kind === "note"
        ? node.data.text
        : node.data.name;

  const before = isHovered(hover, parentId, index);
  const after = isHovered(hover, parentId, index + 1);

  return (
    <div
      data-row-parent={parentId}
      data-row-index={index}
      data-testid={"row-" + id}
      onPointerDown={(event) => begin(id, event)}
      className={cx(
        dndClasses.row,
        dragId === id && dndClasses.rowDragging,
        before && dndClasses.rowBefore,
        after && dndClasses.rowAfter,
      )}
    >
      <span
        data-testid={"grip-" + id}
        // POINTER EVENTS, NOT HTML5 DRAG. `dragstart` cannot be simulated
        // faithfully in a play function and gives no control over the drop
        // index.
        //
        // A real sensor library would also demand `isPrimary: true` on every
        // synthesised event — dnd-kit's PointerSensor silently ignores an
        // entire sequence without it, a trap this repo has already paid for.
        aria-label={"Drag " + String(id)}
        role="button"
        tabIndex={0}
        className={dndClasses.grip}
      >
        {"⠿"}
      </span>
      <span className={dndClasses.rowLabel}>{label}</span>
      {node.quarantined ? (
        <Tag tone="warn">?</Tag>
      ) : (
        <Tag>{node.kind}</Tag>
      )}
    </div>
  );
}

/**
 * A collection as a drop container.
 *
 * An UNLOADED collection still draws a landing zone, and dropping on it is
 * refused with `target-not-loaded` rather than silently appending. A
 * post-removal index into children nobody has read has no honest value, so this
 * is a graph-level truth rather than an app-level policy.
 */
function DragCollection({
  id,
  depth = 0,
}: Readonly<{ id: NodeId; depth?: number }>) {
  const node = ui.useNode(id);
  const children = ui.useChildren(id);
  const { dragId, hover } = useDragApi();
  if (node === undefined || node.quarantined || !node.container) return null;

  const loaded = node.children.status === "loaded";
  const name = node.kind === "sequence" ? node.data.name : String(id);

  return (
    <div className={dndClasses.collection} style={{ marginLeft: depth * 18 }}>
      <div className={dndClasses.collectionHead}>
        <strong className="font-medium">{name}</strong>
        <span className={classes.spacer} />
        <StateChip status={node.children.status} />
      </div>

      {!loaded ? (
        <div
          data-testid={"gap-" + id + "-0"}
          data-drop-parent={id}
          data-drop-index={0}
          className={cx(
            dndClasses.gap,
            dndClasses.gapClosed,
            dragId !== null && dndClasses.gapArmed,
            isHovered(hover, id, 0) && dndClasses.gapLit,
          )}
        >
          nobody has read these children
        </div>
      ) : (
        <>
          <Gap parentId={id} indexBefore={0} />
          {children.map((childId, index) => (
            <Fragment key={childId}>
              <ChildRow id={childId} parentId={id} index={index} depth={depth} />
              <Gap parentId={id} indexBefore={index + 1} />
            </Fragment>
          ))}
        </>
      )}
    </div>
  );
}

/** A child is either another container (recurse) or a leaf row. */
function ChildRow({
  id,
  parentId,
  index,
  depth,
}: Readonly<{ id: NodeId; parentId: NodeId; index: number; depth: number }>) {
  const node = ui.useNode(id);
  if (node === undefined) return null;
  if (!node.quarantined && node.container) {
    return (
      <div>
        <DragRow id={id} parentId={parentId} index={index} />
        <DragCollection id={id} depth={depth + 1} />
      </div>
    );
  }
  return <DragRow id={id} parentId={parentId} index={index} />;
}

const dndClasses = {
  outcome:
    "mb-2.5 rounded-lg bg-neutral-500/8 px-2.5 py-1.5 font-mono text-[11.5px] opacity-70",
  // `touch-none` on the whole board: a touch drag would otherwise scroll the
  // page, because the browser claims the gesture before any pointer handler
  // sees it.
  board: "touch-none",
  collection: "mb-2.5 flex flex-col gap-2 rounded-xl p-2.5 ring-1 ring-neutral-500/15",
  collectionHead:
    "flex items-center gap-2.5 rounded-lg bg-neutral-500/8 px-2.5 py-1.5 text-[13px]",
  // The insertion line is drawn as a border, so both edges are reserved and
  // transparent — otherwise every hover nudges the row by 2px.
  row: "flex cursor-grab items-center gap-2.5 rounded-lg border-y-2 border-transparent bg-neutral-500/5 px-2.5 py-1 transition-colors hover:bg-neutral-500/10",
  rowDragging: "cursor-grabbing opacity-45",
  rowBefore: "border-t-current",
  rowAfter: "border-b-current",
  rowLabel: "flex-1 text-[13px] font-medium",
  rowKind: "font-mono text-[11px] opacity-60",
  grip: "inline-flex h-8 w-8 shrink-0 cursor-grab select-none items-center justify-center rounded-md text-[17px] leading-none opacity-40 ring-1 ring-inset ring-neutral-500/25 transition-colors hover:bg-neutral-500/10 hover:opacity-80",
  gap: "flex h-[18px] items-center rounded pl-1.5 font-mono text-[10px] opacity-30",
  gapArmed: "opacity-70 outline outline-1 outline-dashed outline-neutral-500/50",
  gapLit: "bg-neutral-500/20 opacity-100 outline outline-2 outline-current",
  gapClosed: "h-auto p-1.5 italic opacity-50",
  gapIndex: "",
} as const;

/** Join the class strings that survive a condition. */
function cx(...parts: readonly (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

/**
 * 9. Drag and drop, and the index conversion nobody should re-derive.
 */
export const DragAndDrop: Story = {
  render: () => (
    <Stage doc={dndDoc}>
      <Lesson title="The engine's only contact with a pointer">
        The view knows where you dropped in the list it is drawing now; the
        reducer needs the index after the moved node is taken out.{" "}
        <code>resolveDrop</code> converts one to the other in exactly one place.
        Drag downward inside one reel and the two numbers differ; drag across
        reels and they agree. Drop on a gap, or on a row&rsquo;s upper or lower
        half.
      </Lesson>
      <DragBoard>
        <DragCollection id={IDS.reelA} />
        <DragCollection id={IDS.reelB} />
      </DragBoard>
      <ChildOrder id={IDS.reelA} label="reel-a children" />
      <ChildOrder id={IDS.reelB} label="reel-b children" />
      <HistoryBar />
    </Stage>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const drag = async (from: string, to: string) => {
      await userEvent.pointer([
        { keys: "[MouseLeft>]", target: canvas.getByTestId(from) },
        { target: canvas.getByTestId(to) },
        { keys: "[/MouseLeft]" },
      ]);
    };

    // --- 1. downward inside one parent: the indices DISAGREE --------------
    await expect(canvas.getByTestId("order-reel-a")).toHaveTextContent(
      "shot-bridge, scene-two, shot-reveal",
    );
    await drag("grip-shot-bridge", "gap-reel-a-2");
    await expect(canvas.getByTestId("dnd-outcome")).toHaveTextContent(
      "dropped at 2 · committed at 1",
    );
    await expect(canvas.getByTestId("order-reel-a")).toHaveTextContent(
      "scene-two, shot-bridge, shot-reveal",
    );

    // --- 2. across parents: the indices AGREE -----------------------------
    await drag("grip-shot-reveal", "gap-reel-b-0");
    await expect(canvas.getByTestId("dnd-outcome")).toHaveTextContent(
      "dropped at 0 · committed at 0",
    );
    await expect(canvas.getByTestId("order-reel-b")).toHaveTextContent(
      "shot-reveal",
    );

    // --- 3. a collection into its own descendant: refused, nothing moves ---
    await drag("grip-scene-two", "gap-scene-two-0");
    await expect(canvas.getByTestId("dnd-outcome")).toHaveTextContent(
      "would-create-cycle",
    );
    await expect(canvas.getByTestId("order-reel-a")).toHaveTextContent(
      "scene-two, shot-bridge",
    );

    // --- 4. into a subtree nobody has read: refused honestly ---------------
    await drag("grip-shot-bridge", "gap-scene-locked-0");
    await expect(canvas.getByTestId("dnd-outcome")).toHaveTextContent(
      "target-not-loaded",
    );

    // --- 5. one gesture, one history entry --------------------------------
    await userEvent.click(canvas.getByTestId("undo"));
    await expect(canvas.getByTestId("order-reel-b")).not.toHaveTextContent(
      "shot-reveal",
    );

    // --- 6. a ROW is a drop target too ------------------------------------
    //
    // `userEvent` aims at an element's CENTRE, and the midpoint test is
    // `y > middle`, so a centre hit resolves to "before this row" — which is
    // exactly the boundary case worth pinning.
    await drag("grip-shot-reveal", "row-scene-two");
    await expect(canvas.getByTestId("order-reel-a")).toHaveTextContent(
      "shot-reveal, scene-two",
    );
  },
};

/**
 * Two reels, a nested sequence so a collection can be dropped into itself, and
 * one unloaded collection to be refused by.
 */
const dndDoc = wireDocument(
  ["reel-a", "reel-b"],
  [
    wireSequence("reel-a", "Reel A", [
      "shot-bridge",
      "scene-two",
      "shot-reveal",
    ]),
    wireShot("shot-bridge", "Bridge, wide", 6, "A"),
    wireSequence("scene-two", "Scene Two", ["shot-door"]),
    wireShot("shot-door", "Door, medium", 4, "A"),
    wireShot("shot-reveal", "Reveal, push in", 4, "B"),
    wireSequence("reel-b", "Reel B", ["scene-locked"]),
    wireUnloaded("scene-locked", "Scene Locked", { seconds: 9, shots: 2 }),
  ],
);
