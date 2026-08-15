// The normalized collections graph — the single source of truth for
// dnd-collections. Everything is a node: media leaves and collections alike
// live flat in `nodesById`, ordering lives in `childrenById`, and the
// reverse index `parentById` makes ancestor walks O(depth). The UI is a
// projection of this graph; a "strip"/"panel" is just a collection some view
// chose to render expanded. Mutation happens ONLY through the command
// reducer in ./commands.ts, which returns a new graph plus a reversible
// patch — nothing else in the package writes graph state.

declare const nodeIdBrand: unique symbol;

/** Branded node id — plain string at runtime, nominal at compile time. */
export type NodeId = string & { readonly [nodeIdBrand]: true };

export type Result<T, E> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; error: E }>;

/**
 * Parse-or-throw for authoring-time-trusted ids (literals in stories/tests).
 * The only rule is non-empty/non-whitespace: an id may contain ANY other
 * character, including ":" — the droppable-id protocol (`node:<id>` etc.)
 * splits on the FIRST colon and DOM lookups use the shared escaped-or-exact
 * node helper, so arbitrary characters stay safe downstream.
 */
export function parseNodeId(id: string): NodeId {
  if (!id || !id.trim()) {
    throw new Error(`Invalid NodeId: ${JSON.stringify(id)}`);
  }
  return id as NodeId;
}

// Media leaves come in two flavors, discriminated by `mediaKind`. The ENGINE
// treats them identically (both are childless media, moved/added/trimmed the
// same way) — the divergence is domain/UI: an image has a single duration a
// trim handle sets directly, while a video carries its source `full` duration
// plus how much has been trimmed off each end; its timeline duration is
// derived (`mediaDurationSeconds`). `mediaKind` is OPTIONAL on the image
// variant so a plain `{ kind: "media", durationSeconds }` node stays a valid
// image (backward compatible).

export type ImageMediaNode = Readonly<{
  id: NodeId;
  kind: "media";
  mediaKind?: "image";
  name: string;
  /** Optional thumbnail/source url — display-only, the graph doesn't care. */
  src?: string;
  /** The item's timeline duration. Trimming an image sets this directly. */
  durationSeconds: number;
  /**
   * Skipped: excluded from playback and from every count and duration total,
   * along with its whole subtree when it is a collection. The engine treats a
   * disabled node exactly like an enabled one — it still occupies its slot,
   * still moves, still trims — because "skip this" is a DOMAIN fact about the
   * timeline, not a structural one about the graph. Absent means enabled;
   * re-enabling removes the key rather than writing `false`.
   */
  disabled?: boolean;
  /**
   * WHICH LANE this plays on, and WHERE on it — the same kind of fact as
   * `disabled`, carried here for the same reason.
   *
   * Lane 0 is the picture; anything above runs underneath it at the same
   * time. `placedStart` is an explicit start on that lane, in seconds;
   * absent means "queue behind the clip before it", which is what every
   * document did before placement existed.
   *
   * THE ENGINE NEVER INTERPRETS EITHER. It does not pack, it does not know
   * what a second is, and a node with a lane moves, trims and reorders
   * exactly like one without. They live on the node rather than in a
   * consumer's side-table for one reason: they are changed by a COMMAND
   * (`set-node-placement`), so they ride the patch path and undo/redo work
   * on them. The rule is "does the engine mutate it", not "does the engine
   * understand it".
   *
   * Absent means the default in both cases; clearing removes the key rather
   * than writing 0, so documents that never use lanes never grow the fields.
   */
  trackIndex?: number;
  placedStart?: number;
}>;

export type VideoMediaNode = Readonly<{
  id: NodeId;
  kind: "media";
  mediaKind: "video";
  name: string;
  /** Optional thumbnail/source url — display-only, the graph doesn't care. */
  src?: string;
  /**
   * Optional poster frames sampled across the clip. Cards render a few of
   * these as an image sequence (a video card is NEVER a <video> element —
   * it shows frames), cycling if fewer posters than frames are needed.
   * Display-only; the engine ignores it.
   */
  posterSrcs?: readonly string[];
  /** The source clip's full length. */
  fullDurationSeconds: number;
  /** Seconds trimmed off the START (left handle). 0 = untrimmed. */
  trimInSeconds: number;
  /** Seconds trimmed off the END (right handle). 0 = untrimmed. */
  trimOutSeconds: number;
  /**
   * Skipped: excluded from playback and from every count and duration total,
   * along with its whole subtree when it is a collection. The engine treats a
   * disabled node exactly like an enabled one — it still occupies its slot,
   * still moves, still trims — because "skip this" is a DOMAIN fact about the
   * timeline, not a structural one about the graph. Absent means enabled;
   * re-enabling removes the key rather than writing `false`.
   */
  disabled?: boolean;
  /** See ImageMediaNode — lane and placement, carried not interpreted. */
  trackIndex?: number;
  placedStart?: number;
}>;

/**
 * A sound with no picture.
 *
 * Modelled as a WINDOWED node like video (`fullDurationSeconds` + trims), NOT
 * as a duration node like image, and that choice is load-bearing in two ways.
 *
 * It keeps the model render-complete: `mediaDurationSeconds` computes the cut,
 * so the packed duration stays correct the day a trim handle ships. Storing a
 * single `durationSeconds` instead would mean a data migration later.
 *
 * And it is the TYPE-SAFETY LEVER for this whole feature. Roughly twenty sites
 * in this repo branch `mediaKind === "video"` with an else that silently means
 * "image"; only two of them failed to compile when audio was added. Narrowing
 * `Image | Video | Audio` by `!== "video"` yields `Image | Audio`, and Audio has
 * no `durationSeconds` — so every else-branch that reads one becomes a build
 * error instead of a silent wrong answer.
 *
 * No `posterSrcs`: audio has no frames, and a card must not try to show any.
 */
export type AudioMediaNode = Readonly<{
  id: NodeId;
  kind: "media";
  mediaKind: "audio";
  name: string;
  src?: string;
  /** The source clip's full length. */
  fullDurationSeconds: number;
  /** Seconds trimmed off the START. 0 = untrimmed. */
  trimInSeconds: number;
  /** Seconds trimmed off the END. 0 = untrimmed. */
  trimOutSeconds: number;
  disabled?: boolean;
  /** See ImageMediaNode — lane and placement, carried not interpreted. */
  trackIndex?: number;
  placedStart?: number;
}>;

export type MediaNode = ImageMediaNode | VideoMediaNode | AudioMediaNode;

export type CollectionNode = Readonly<{
  id: NodeId;
  kind: "collection";
  name: string;
  /**
   * Skipped: excluded from playback and from every count and duration total,
   * along with its whole subtree when it is a collection. The engine treats a
   * disabled node exactly like an enabled one — it still occupies its slot,
   * still moves, still trims — because "skip this" is a DOMAIN fact about the
   * timeline, not a structural one about the graph. Absent means enabled;
   * re-enabling removes the key rather than writing `false`.
   */
  disabled?: boolean;
  /** See ImageMediaNode — lane and placement, carried not interpreted. A
   *  COLLECTION can sit on a lane too: a whole nested scene under the
   *  picture is a legitimate layer. */
  trackIndex?: number;
  placedStart?: number;
}>;

export type CollectionItemNode = MediaNode | CollectionNode;

/**
 * True for video media (image is the default when `mediaKind` is absent).
 *
 * This means "SHOWS FILMSTRIP FRAMES", not "is trimmable" — audio is trimmable
 * and has no frames. When a caller means the latter, it wants `hasSourceWindow`.
 */
export function isVideoMedia(node: CollectionItemNode): node is VideoMediaNode {
  return node.kind === "media" && node.mediaKind === "video";
}

/**
 * True for media whose timeline duration is a WINDOW onto a longer source —
 * video and audio. The complement is an image, whose `durationSeconds` is set
 * directly because there is no source length to window into.
 *
 * Split out from `isVideoMedia` because the two questions stopped having the
 * same answer once audio existed, and every site that conflated them was a
 * silent bug rather than a type error.
 */
export function hasSourceWindow(
  node: CollectionItemNode,
): node is VideoMediaNode | AudioMediaNode {
  return (
    node.kind === "media" && (node.mediaKind === "video" || node.mediaKind === "audio")
  );
}

/**
 * The item's effective timeline duration: an image's `durationSeconds`, or a
 * windowed clip's source length minus what's trimmed off each end (never
 * below 0).
 */
export function mediaDurationSeconds(node: MediaNode): number {
  return hasSourceWindow(node)
    ? Math.max(0, node.fullDurationSeconds - node.trimInSeconds - node.trimOutSeconds)
    : node.durationSeconds;
}

/** Seconds of clip each poster frame stands for, and the frame ceiling. */
export const SECONDS_PER_VIDEO_FRAME = 2;
export const MAX_VIDEO_FRAMES = 5;

/**
 * How many poster frames a video card shows: more for a longer clip, at least
 * one, capped at `MAX_VIDEO_FRAMES`. A view can pass its own `max` (e.g. how
 * many frames fit the card width) to cap it tighter. Pure length math — the
 * card cycles the available `posterSrcs` to fill this count.
 */
export function videoFrameCount(durationSeconds: number, max: number = MAX_VIDEO_FRAMES): number {
  const ceiling = Number.isFinite(max)
    ? Math.max(1, Math.floor(max))
    : MAX_VIDEO_FRAMES;
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return 1;
  return Math.max(1, Math.min(ceiling, Math.round(durationSeconds / SECONDS_PER_VIDEO_FRAME)));
}

export type CollectionsGraph = Readonly<{
  nodesById: ReadonlyMap<NodeId, CollectionItemNode>;
  /** Ordered children for every collection node (always present, possibly empty). */
  childrenById: ReadonlyMap<NodeId, readonly NodeId[]>;
  /** Reverse index: node -> containing collection, or null for roots. */
  parentById: ReadonlyMap<NodeId, NodeId | null>;
  /** Ordered top-level collections. */
  rootIds: readonly NodeId[];
}>;

export const EMPTY_GRAPH: CollectionsGraph = {
  nodesById: new Map(),
  childrenById: new Map(),
  parentById: new Map(),
  rootIds: [],
};

// --- Building --------------------------------------------------------------

/** Author-friendly nested spec, denormalized into the graph by buildGraph. */
export type GraphNodeSpec =
  | Readonly<{
      kind: "media";
      mediaKind?: "image";
      id: string;
      name: string;
      src?: string;
      durationSeconds?: number; // default 4
      disabled?: boolean;
      trackIndex?: number;
      placedStart?: number;
    }>
  | Readonly<{
      kind: "media";
      mediaKind: "video";
      id: string;
      name: string;
      src?: string;
      posterSrcs?: readonly string[];
      fullDurationSeconds: number;
      trimInSeconds?: number; // default 0
      trimOutSeconds?: number; // default 0
      disabled?: boolean;
      trackIndex?: number;
      placedStart?: number;
    }>
  | Readonly<{
      kind: "media";
      mediaKind: "audio";
      id: string;
      name: string;
      src?: string;
      fullDurationSeconds: number;
      trimInSeconds?: number; // default 0
      trimOutSeconds?: number; // default 0
      disabled?: boolean;
      trackIndex?: number;
      placedStart?: number;
    }>
  | Readonly<{
      kind: "collection";
      id: string;
      name: string;
      children?: readonly GraphNodeSpec[];
      disabled?: boolean;
      trackIndex?: number;
      placedStart?: number;
    }>;

/** A media spec, i.e. every member of GraphNodeSpec that is not a collection. */
type MediaNodeSpec = Extract<GraphNodeSpec, { kind: "media" }>;

/**
 * The ONE place a media spec becomes a media node.
 *
 * `buildGraph` and `parseCollectionItemNode` each used to carry their own copy
 * of this, both shaped `mediaKind === "video" ? {...} : {...image}`. That
 * else-branch is a CONSTRUCTOR, so no shape change can ever break it — a new
 * media kind was silently built as an image, in two places, with no type error.
 * Unified here so the `never` default below is the single thing that has to
 * hold, and adding a fourth kind is a compile error rather than a silent
 * coercion.
 */
/**
 * The lane/placement fields, kept only when they are real numbers.
 *
 * DROPS rather than rejects. A stored document may legitimately carry a
 * fractional lane — the timeline model's own validator admits any finite
 * number there and normalises at read time — so rejecting the node would fail
 * to hydrate a document that works today. Absent is the default for both, and
 * the engine never reads either value, so dropping is lossless as far as the
 * graph is concerned.
 */
function placementOf(
  spec: Readonly<{ trackIndex?: unknown; placedStart?: unknown }>,
): Readonly<{ trackIndex?: number; placedStart?: number }> {
  const lane = spec.trackIndex;
  const start = spec.placedStart;
  return {
    ...(typeof lane === "number" && Number.isFinite(lane) ? { trackIndex: lane } : {}),
    ...(typeof start === "number" && Number.isFinite(start) && start >= 0
      ? { placedStart: start }
      : {}),
  };
}

function mediaNodeFromSpec(id: NodeId, spec: MediaNodeSpec): MediaNode {
  const disabled = spec.disabled ? { disabled: true as const } : {};
  const placement = placementOf(spec);
  switch (spec.mediaKind) {
    case "video":
      return {
        id,
        kind: "media",
        mediaKind: "video",
        name: spec.name,
        src: spec.src,
        // Copied (like parseCollectionItemNode does): the graph is Readonly,
        // so it must not alias an array the caller can mutate.
        posterSrcs: spec.posterSrcs === undefined ? undefined : [...spec.posterSrcs],
        fullDurationSeconds: spec.fullDurationSeconds,
        trimInSeconds: spec.trimInSeconds ?? 0,
        trimOutSeconds: spec.trimOutSeconds ?? 0,
        ...disabled,
        ...placement,
      };
    case "audio":
      return {
        id,
        kind: "media",
        mediaKind: "audio",
        name: spec.name,
        src: spec.src,
        fullDurationSeconds: spec.fullDurationSeconds,
        trimInSeconds: spec.trimInSeconds ?? 0,
        trimOutSeconds: spec.trimOutSeconds ?? 0,
        ...disabled,
        ...placement,
      };
    case "image":
    case undefined:
      return {
        id,
        kind: "media",
        mediaKind: "image",
        name: spec.name,
        src: spec.src,
        durationSeconds: spec.durationSeconds ?? 4,
        ...disabled,
        ...placement,
      };
    default: {
      // A new media kind reaches here as a build error, not as an image.
      const unreachable: never = spec;
      return unreachable;
    }
  }
}

export type BuildGraphError =
  | Readonly<{ reason: "duplicate-id"; id: string }>
  | Readonly<{ reason: "empty-id" }>
  | Readonly<{ reason: "root-not-collection"; id: string }>
  | Readonly<{ reason: "invalid-spec"; error: CollectionsValidationError }>;

/**
 * Denormalizes a nested spec into a `CollectionsGraph`. Fails (rather than
 * silently merging) on duplicate ids anywhere in the tree — ids are the
 * graph's addressing scheme, so a collision would corrupt every index.
 */
export function buildGraph(
  roots: readonly GraphNodeSpec[]
): Result<CollectionsGraph, BuildGraphError> {
  const parsed = parseGraphSpec(roots);
  if (!parsed.ok) {
    if (
      parsed.error.reason === "invalid-value" &&
      parsed.error.path.endsWith(".id") &&
      parsed.error.message === "Expected a non-empty id."
    ) {
      return { ok: false, error: { reason: "empty-id" } };
    }
    return { ok: false, error: { reason: "invalid-spec", error: parsed.error } };
  }
  const validatedRoots = parsed.value;
  const nodesById = new Map<NodeId, CollectionItemNode>();
  const childrenById = new Map<NodeId, readonly NodeId[]>();
  const parentById = new Map<NodeId, NodeId | null>();

  // Iterative walk (explicit stack): externally-supplied specs must not be
  // able to blow the call stack with pathological depth.
  type Frame = Readonly<{ spec: GraphNodeSpec; parentId: NodeId | null }>;
  const stack: Frame[] = [];

  for (const root of validatedRoots) {
    if (root.kind !== "collection") {
      return { ok: false, error: { reason: "root-not-collection", id: root.id } };
    }
    stack.push({ spec: root, parentId: null });
  }

  while (stack.length > 0) {
    const { spec, parentId } = stack.pop()!;
    if (!spec.id || !spec.id.trim()) {
      return { ok: false, error: { reason: "empty-id" } };
    }
    const id = spec.id as NodeId;
    if (nodesById.has(id)) {
      return { ok: false, error: { reason: "duplicate-id", id: spec.id } };
    }

    if (spec.kind === "media") {
      nodesById.set(id, mediaNodeFromSpec(id, spec));
    } else {
      nodesById.set(id, {
        id,
        kind: "collection",
        name: spec.name,
        ...(spec.disabled ? { disabled: true } : {}),
        ...placementOf(spec),
      });
      const children = spec.children ?? [];
      childrenById.set(id, children.map((child) => child.id as NodeId));
      // Push in reverse so pop() visits children in document order — keeps
      // duplicate-id reporting deterministic (first duplicate in reading
      // order wins the error).
      for (let i = children.length - 1; i >= 0; i--) {
        const spec = children[i];
        if (spec === undefined) continue;
        stack.push({ spec, parentId: id });
      }
    }
    parentById.set(id, parentId);
  }

  return {
    ok: true,
    value: {
      nodesById,
      childrenById,
      parentById,
      rootIds: validatedRoots.map((root) => root.id as NodeId),
    },
  };
}

// --- Queries ----------------------------------------------------------------

export function isCollection(node: CollectionItemNode): node is CollectionNode {
  return node.kind === "collection";
}

// Shared fallback so unknown/media ids return a STABLE reference: selectors
// pass getChildren results straight to useCollectionsSelector, and a fresh []
// per call would defeat the Object.is bail on every notify (a view mounted
// with a dead collection id would re-render per drag frame).
const NO_CHILDREN: readonly NodeId[] = [];

export function getChildren(graph: CollectionsGraph, collectionId: NodeId): readonly NodeId[] {
  return graph.childrenById.get(collectionId) ?? NO_CHILDREN;
}

/**
 * True if `possibleAncestorId` is `id` itself or an ancestor of it.
 * Iterative walk over `parentById` — O(depth), cycle-guarded so a corrupt
 * graph degrades to `false` instead of hanging.
 */
export function isSameOrAncestor(
  graph: CollectionsGraph,
  possibleAncestorId: NodeId,
  id: NodeId
): boolean {
  const seen = new Set<NodeId>();
  let current: NodeId | null = id;
  while (current !== null) {
    if (current === possibleAncestorId) return true;
    if (seen.has(current)) return false;
    seen.add(current);
    current = graph.parentById.get(current) ?? null;
  }
  return false;
}

/**
 * The document-order index of every node, for sorting arbitrary id sets into
 * reading order (multi-node moves preserve the dragged nodes' relative
 * order). Depth-first over roots.
 */
export function getDocumentOrder(graph: CollectionsGraph): ReadonlyMap<NodeId, number> {
  const order = new Map<NodeId, number>();
  const stack: NodeId[] = [];
  for (let i = graph.rootIds.length - 1; i >= 0; i--) {
    const rootId = graph.rootIds[i];
    if (rootId !== undefined) stack.push(rootId);
  }

  while (stack.length > 0) {
    const id = stack.pop()!;
    if (order.has(id)) continue; // corrupt-graph guard
    order.set(id, order.size);
    const children = graph.childrenById.get(id);
    if (children) {
      for (let i = children.length - 1; i >= 0; i--) {
        const childId = children[i];
        if (childId !== undefined) stack.push(childId);
      }
    }
  }
  return order;
}

export type GraphInvariantViolation =
  | Readonly<{ reason: "missing-node"; id: NodeId }>
  | Readonly<{ reason: "child-parent-mismatch"; childId: NodeId; expectedParentId: NodeId | null }>
  | Readonly<{ reason: "duplicate-child"; id: NodeId }>
  | Readonly<{ reason: "duplicate-root"; id: NodeId }>
  | Readonly<{ reason: "root-not-collection"; id: NodeId }>
  | Readonly<{ reason: "root-is-also-child"; id: NodeId }>
  | Readonly<{ reason: "parent-not-collection"; childId: NodeId; parentId: NodeId }>
  | Readonly<{ reason: "collection-missing-children-entry"; id: NodeId }>
  | Readonly<{ reason: "media-with-children"; id: NodeId }>
  | Readonly<{ reason: "unreachable-node"; id: NodeId }>;

/**
 * Development/testing invariant check: every reference resolves, roots are
 * unique collections that appear in no children list, the parent/children
 * indexes agree (and parents are collections with a children entry), media
 * nodes have no children, and every node is reachable from a root. Returns
 * the first violation, or null.
 */
export function findGraphInvariantViolation(
  graph: CollectionsGraph
): GraphInvariantViolation | null {
  const rootSet = new Set<NodeId>();
  for (const rootId of graph.rootIds) {
    const rootNode = graph.nodesById.get(rootId);
    if (!rootNode) return { reason: "missing-node", id: rootId };
    if (rootNode.kind !== "collection") return { reason: "root-not-collection", id: rootId };
    if (rootSet.has(rootId)) return { reason: "duplicate-root", id: rootId };
    rootSet.add(rootId);
    if (graph.parentById.get(rootId) !== null) {
      return { reason: "child-parent-mismatch", childId: rootId, expectedParentId: null };
    }
  }

  // EVERY collection node must have a childrenById entry ("always present,
  // possibly empty" is part of the CollectionsGraph contract) — not just the
  // ones some child's parent pointer happens to reference. A childless leaf
  // or root collection with a missing entry would otherwise pass.
  for (const [id, node] of graph.nodesById) {
    if (node.kind === "collection" && !graph.childrenById.has(id)) {
      return { reason: "collection-missing-children-entry", id };
    }
  }

  const seenChildren = new Set<NodeId>();
  for (const [collectionId, children] of graph.childrenById) {
    const collection = graph.nodesById.get(collectionId);
    if (!collection) return { reason: "missing-node", id: collectionId };
    if (collection.kind !== "collection") return { reason: "media-with-children", id: collectionId };

    for (const childId of children) {
      if (!graph.nodesById.has(childId)) return { reason: "missing-node", id: childId };
      if (seenChildren.has(childId)) return { reason: "duplicate-child", id: childId };
      seenChildren.add(childId);
      if (rootSet.has(childId)) return { reason: "root-is-also-child", id: childId };
      if (graph.parentById.get(childId) !== collectionId) {
        return { reason: "child-parent-mismatch", childId, expectedParentId: collectionId };
      }
    }
  }

  // parentById entries must point at collections that actually have a
  // children entry (a dangling parent pointer would make ancestor walks and
  // patch application disagree about the tree).
  for (const [childId, parentId] of graph.parentById) {
    // A dangling parentById key (no node behind it) is index garbage no
    // other loop sees: it's not in nodesById and needn't be in any children
    // list.
    if (!graph.nodesById.has(childId)) return { reason: "missing-node", id: childId };
    if (parentId === null) continue;
    const parentNode = graph.nodesById.get(parentId);
    if (!parentNode) return { reason: "missing-node", id: parentId };
    if (parentNode.kind !== "collection") {
      return { reason: "parent-not-collection", childId, parentId };
    }
    if (!graph.childrenById.has(parentId)) {
      return { reason: "collection-missing-children-entry", id: parentId };
    }
  }

  const reachable = getDocumentOrder(graph);
  for (const id of graph.nodesById.keys()) {
    if (!reachable.has(id)) return { reason: "unreachable-node", id };
  }

  return null;
}

// --- Runtime validation -----------------------------------------------------

export type CollectionsValidationError = Readonly<{
  reason: "invalid-type" | "invalid-value";
  /** JSONPath-like location of the invalid value. */
  path: string;
  message: string;
}>;

export type GraphValidationError =
  | CollectionsValidationError
  | Readonly<{
      reason: "graph-invariant";
      path: "$";
      violation: GraphInvariantViolation;
    }>;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidType(path: string, message: string): CollectionsValidationError {
  return { reason: "invalid-type", path, message };
}

function invalidValue(path: string, message: string): CollectionsValidationError {
  return { reason: "invalid-value", path, message };
}

function validateNodeIdentity(
  value: Readonly<Record<string, unknown>>,
  path: string
): CollectionsValidationError | null {
  if (typeof value.id !== "string") return invalidType(`${path}.id`, "Expected a string.");
  if (!value.id.trim()) return invalidValue(`${path}.id`, "Expected a non-empty id.");
  if (typeof value.name !== "string") {
    return invalidType(`${path}.name`, "Expected a string.");
  }
  if (value.kind !== "media" && value.kind !== "collection") {
    return invalidValue(`${path}.kind`, 'Expected "media" or "collection".');
  }
  // Checked here rather than per-kind: `disabled` is on every node type, and
  // a truthy non-boolean (the string "false", say) would otherwise be
  // normalized to `disabled: true` by the parse path's `? :` and silently
  // skip a clip in playback.
  if (value.disabled !== undefined && typeof value.disabled !== "boolean") {
    return invalidType(`${path}.disabled`, "Expected a boolean.");
  }
  return null;
}

function validateOptionalString(
  value: Readonly<Record<string, unknown>>,
  field: string,
  path: string
): CollectionsValidationError | null {
  const candidate = value[field];
  return candidate === undefined || typeof candidate === "string"
    ? null
    : invalidType(`${path}.${field}`, "Expected a string when provided.");
}

function validateNonNegativeNumber(
  value: Readonly<Record<string, unknown>>,
  field: string,
  path: string,
  required: boolean
): CollectionsValidationError | null {
  const candidate = value[field];
  if (candidate === undefined) {
    return required ? invalidType(`${path}.${field}`, "Expected a number.") : null;
  }
  if (typeof candidate !== "number") {
    return invalidType(`${path}.${field}`, "Expected a number.");
  }
  if (!Number.isFinite(candidate) || candidate < 0) {
    return invalidValue(`${path}.${field}`, "Expected a finite, non-negative number.");
  }
  return null;
}

function validateMediaRecord(
  value: Readonly<Record<string, unknown>>,
  path: string,
  requireResolvedFields: boolean
): CollectionsValidationError | null {
  if (
    value.mediaKind !== undefined &&
    value.mediaKind !== "image" &&
    value.mediaKind !== "video" &&
    value.mediaKind !== "audio"
  ) {
    return invalidValue(`${path}.mediaKind`, 'Expected "image", "video" or "audio".');
  }
  const srcError = validateOptionalString(value, "src", path);
  if (srcError) return srcError;

  // Windowed kinds (video, audio) validate their source length and trims;
  // an image validates a single duration instead.
  const windowed = value.mediaKind === "video" || value.mediaKind === "audio";
  if (!windowed) {
    return validateNonNegativeNumber(
      value,
      "durationSeconds",
      path,
      requireResolvedFields
    );
  }

  const fullError = validateNonNegativeNumber(value, "fullDurationSeconds", path, true);
  if (fullError) return fullError;
  const trimInError = validateNonNegativeNumber(
    value,
    "trimInSeconds",
    path,
    requireResolvedFields
  );
  if (trimInError) return trimInError;
  const trimOutError = validateNonNegativeNumber(
    value,
    "trimOutSeconds",
    path,
    requireResolvedFields
  );
  if (trimOutError) return trimOutError;

  if (value.posterSrcs !== undefined) {
    // Audio has no frames, so a poster array on one is a mistake upstream
    // rather than harmless extra data — reject it here where it is cheap.
    if (value.mediaKind === "audio") {
      return invalidValue(`${path}.posterSrcs`, "Audio media cannot carry poster frames.");
    }
    if (!Array.isArray(value.posterSrcs)) {
      return invalidType(`${path}.posterSrcs`, "Expected an array of strings.");
    }
    const invalidPoster = value.posterSrcs.findIndex((poster) => typeof poster !== "string");
    if (invalidPoster !== -1) {
      return invalidType(`${path}.posterSrcs[${invalidPoster}]`, "Expected a string.");
    }
  }

  const full = value.fullDurationSeconds as number;
  const trimIn = (value.trimInSeconds as number | undefined) ?? 0;
  const trimOut = (value.trimOutSeconds as number | undefined) ?? 0;
  if (trimIn + trimOut > full) {
    return invalidValue(path, "Trim cannot exceed the full duration.");
  }
  return null;
}

/** Parse an untrusted normalized node into a fresh, runtime-safe node value. */
export function parseCollectionItemNode(
  value: unknown
): Result<CollectionItemNode, CollectionsValidationError> {
  const path = "$";
  if (!isRecord(value)) {
    return { ok: false, error: invalidType(path, "Expected a node object.") };
  }
  const identityError = validateNodeIdentity(value, path);
  if (identityError) return { ok: false, error: identityError };

  const id = parseNodeId(value.id as string);
  const name = value.name as string;
  if (value.kind === "collection") {
    return {
      ok: true,
      value: {
        id,
        kind: "collection",
        name,
        ...(value.disabled ? { disabled: true } : {}),
        ...placementOf(value),
      },
    };
  }

  const mediaError = validateMediaRecord(value, path, true);
  if (mediaError) return { ok: false, error: mediaError };

  // `validateMediaRecord` has already proved the fields for this mediaKind are
  // present and well-typed, so the record is a resolved MediaNodeSpec. Build
  // through the SHARED constructor rather than a second copy of the branch —
  // see mediaNodeFromSpec for why a duplicate here was a silent-coercion trap.
  const common = {
    kind: "media",
    id: id as string,
    name,
    src: value.src as string | undefined,
    ...(value.disabled ? { disabled: true } : {}),
    ...placementOf(value),
  } as const;
  const spec: MediaNodeSpec =
    value.mediaKind === "video"
      ? {
          ...common,
          mediaKind: "video",
          posterSrcs:
            value.posterSrcs === undefined
              ? undefined
              : [...(value.posterSrcs as readonly string[])],
          fullDurationSeconds: value.fullDurationSeconds as number,
          trimInSeconds: value.trimInSeconds as number,
          trimOutSeconds: value.trimOutSeconds as number,
        }
      : value.mediaKind === "audio"
        ? {
            ...common,
            mediaKind: "audio",
            fullDurationSeconds: value.fullDurationSeconds as number,
            trimInSeconds: value.trimInSeconds as number,
            trimOutSeconds: value.trimOutSeconds as number,
          }
        : {
            ...common,
            mediaKind: "image",
            durationSeconds: value.durationSeconds as number,
          };

  return { ok: true, value: mediaNodeFromSpec(id, spec) };
}

/** Validate an untrusted nested graph specification without recursive calls. */
export function parseGraphSpec(
  value: unknown
): Result<readonly GraphNodeSpec[], CollectionsValidationError> {
  if (!Array.isArray(value)) {
    return { ok: false, error: invalidType("$", "Expected an array of root nodes.") };
  }

  type PendingSpec = Readonly<{ value: unknown; path: string }>;
  const pending: PendingSpec[] = [];
  for (let index = value.length - 1; index >= 0; index--) {
    pending.push({ value: value[index], path: `$[${index}]` });
  }

  while (pending.length > 0) {
    const current = pending.pop()!;
    if (!isRecord(current.value)) {
      return {
        ok: false,
        error: invalidType(current.path, "Expected a node object."),
      };
    }
    const identityError = validateNodeIdentity(current.value, current.path);
    if (identityError) return { ok: false, error: identityError };
    if (current.value.kind === "collection") {
      const children = current.value.children;
      if (children === undefined) continue;
      if (!Array.isArray(children)) {
        return {
          ok: false,
          error: invalidType(`${current.path}.children`, "Expected an array."),
        };
      }
      for (let index = children.length - 1; index >= 0; index--) {
        pending.push({
          value: children[index],
          path: `${current.path}.children[${index}]`,
        });
      }
      continue;
    }

    // A media record carrying `children` is almost certainly a mis-tagged
    // collection (serializer/authoring error). Accepting it would silently
    // DISCARD the whole subtree — buildGraph's media branch never reads the
    // key — and duplicate ids hidden inside it would evade the duplicate-id
    // check. Reject loudly instead.
    if (current.value.children !== undefined) {
      return {
        ok: false,
        error: invalidValue(
          `${current.path}.children`,
          "Media nodes cannot have children."
        ),
      };
    }

    const mediaError = validateMediaRecord(current.value, current.path, false);
    if (mediaError) return { ok: false, error: mediaError };
  }

  return { ok: true, value: value as readonly GraphNodeSpec[] };
}

/** Validate both runtime field shapes and all normalized graph indexes. */
export function validateGraph(value: unknown): Result<void, GraphValidationError> {
  if (!isRecord(value)) {
    return { ok: false, error: invalidType("$", "Expected a graph object.") };
  }
  if (!(value.nodesById instanceof Map)) {
    return { ok: false, error: invalidType("$.nodesById", "Expected a Map.") };
  }
  if (!(value.childrenById instanceof Map)) {
    return { ok: false, error: invalidType("$.childrenById", "Expected a Map.") };
  }
  if (!(value.parentById instanceof Map)) {
    return { ok: false, error: invalidType("$.parentById", "Expected a Map.") };
  }
  if (!Array.isArray(value.rootIds)) {
    return { ok: false, error: invalidType("$.rootIds", "Expected an array.") };
  }

  for (const [key, node] of value.nodesById as Map<unknown, unknown>) {
    if (typeof key !== "string" || !key.trim()) {
      return { ok: false, error: invalidValue("$.nodesById", "Expected valid node-id keys.") };
    }
    const parsed = parseCollectionItemNode(node);
    if (!parsed.ok) {
      return {
        ok: false,
        error: { ...parsed.error, path: `$.nodesById[${JSON.stringify(key)}]${parsed.error.path.slice(1)}` },
      };
    }
    if (parsed.value.id !== key) {
      return {
        ok: false,
        error: invalidValue(
          `$.nodesById[${JSON.stringify(key)}].id`,
          "Map key and node id must match."
        ),
      };
    }
  }

  for (const [key, children] of value.childrenById as Map<unknown, unknown>) {
    if (typeof key !== "string" || !key.trim()) {
      return {
        ok: false,
        error: invalidValue("$.childrenById", "Expected valid collection-id keys."),
      };
    }
    if (!Array.isArray(children)) {
      return {
        ok: false,
        error: invalidType(`$.childrenById[${JSON.stringify(key)}]`, "Expected an array."),
      };
    }
    const invalidChild = children.findIndex(
      (child) => typeof child !== "string" || !child.trim()
    );
    if (invalidChild !== -1) {
      return {
        ok: false,
        error: invalidValue(
          `$.childrenById[${JSON.stringify(key)}][${invalidChild}]`,
          "Expected a valid node id."
        ),
      };
    }
  }

  for (const [key, parent] of value.parentById as Map<unknown, unknown>) {
    if (typeof key !== "string" || !key.trim()) {
      return { ok: false, error: invalidValue("$.parentById", "Expected valid node-id keys.") };
    }
    if (parent !== null && (typeof parent !== "string" || !parent.trim())) {
      return {
        ok: false,
        error: invalidValue(
          `$.parentById[${JSON.stringify(key)}]`,
          "Expected a valid parent id or null."
        ),
      };
    }
  }

  const invalidRoot = value.rootIds.findIndex(
    (root) => typeof root !== "string" || !root.trim()
  );
  if (invalidRoot !== -1) {
    return {
      ok: false,
      error: invalidValue(`$.rootIds[${invalidRoot}]`, "Expected a valid node id."),
    };
  }

  const violation = findGraphInvariantViolation(value as CollectionsGraph);
  return violation
    ? { ok: false, error: { reason: "graph-invariant", path: "$", violation } }
    : { ok: true, value: undefined };
}
