import { describe, expect, it } from "vitest";

import { buildGraph, type GraphNodeSpec } from "@storyboard/collections-core";
import type { PlaybackLeaf, PlaybackManifest } from "@storyboard/timeline-domain";

import {
  buildPlayheadMap,
  buildRulerCollectionSpans,
  buildRulerTicks,
  cardSpansOf,
  childSpans,
  manifestTrailsLedger,
  MAX_MANIFEST_FETCH_RETRIES,
  mediaSpanKey,
  nextManifestClipsState,
  nextManifestFailureCount,
  rulerMajorSpacing,
  rulerSubtierCount,
  shouldRetryManifestFetch,
  STRIP_GAP_PX,
  type ChildSpan,
  type PreviewCardSpans,
  type RulerTick,
} from "./graph-playhead-model";

const media = (id: string, durationSeconds: number): GraphNodeSpec => ({
  kind: "media",
  id,
  name: id,
  durationSeconds,
});

const collection = (
  id: string,
  children: readonly GraphNodeSpec[] = [],
): GraphNodeSpec => ({ kind: "collection", id, name: id, children });

function graphOf(roots: readonly GraphNodeSpec[]) {
  const result = buildGraph(roots);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

function leaf(
  id: string,
  collectionPath: readonly string[],
  timelineStart: number,
  timelineDuration: number,
): PlaybackLeaf {
  return {
    id,
    collectionPath,
    kind: "image",
    src: `https://cdn.test/${id}.jpg`,
    timelineStart,
    timelineDuration,
    sourceStart: 0,
    playbackRate: 1,
  };
}

function manifestOf(leaves: readonly PlaybackLeaf[]): PlaybackManifest {
  const last = leaves[leaves.length - 1];
  return {
    projectId: "root",
    projectRevision: 1,
    durationSeconds: last ? last.timelineStart + last.timelineDuration : 0,
    leaves,
    compiledAt: "2026-07-20T00:00:00.000Z",
  };
}

const flatWidth = () => 100;

describe("childSpans", () => {
  // The regression this clamp exists for: a span-less card (an empty
  // collection contributes no manifest leaves) speaks the PROJECTION clock
  // while its manifest-timed neighbours speak the pane's. The projection
  // packs A(4s) then E at 4.12 ending 7.12 — but the manifest, whose clock
  // runs behind, starts B at 4.62. Unclamped, the card times read
  // [0,4, 4.12,7.12, 4.62,8.62]: NOT sorted, and the map's binary search
  // silently interpolates garbage.
  it("clamps a projection-timed card monotonic against manifest-timed neighbours", () => {
    const graph = graphOf([
      collection("root", [media("a", 4), collection("e"), media("b", 4)]),
    ]);
    const spans: PreviewCardSpans = new Map([
      [mediaSpanKey("root", "a"), { start: 0, end: 4 }],
      [mediaSpanKey("root", "b"), { start: 4.62, end: 8.62 }],
    ]);

    const cards = childSpans(graph, {}, "root", spans, flatWidth);

    expect(cards.map((card) => [card.startTime, card.endTime])).toEqual([
      [0, 4],
      [4.12, 7.12], // E: projection times, already past A's end
      [7.12, 8.62], // B: manifest start 4.62 raised to E's end
    ]);
    // The invariant the map's binary search requires.
    const times = cards.flatMap((card) => [card.startTime, card.endTime]);
    expect([...times].sort((left, right) => left - right)).toEqual(times);
  });

  it("passes manifest spans through untouched when they are already ordered", () => {
    const graph = graphOf([collection("root", [media("a", 4), media("b", 4)])]);
    const spans: PreviewCardSpans = new Map([
      [mediaSpanKey("root", "a"), { start: 0, end: 3.9 }],
      [mediaSpanKey("root", "b"), { start: 3.95, end: 7.9 }],
    ]);

    const cards = childSpans(graph, {}, "root", spans, flatWidth);

    expect(cards.map((card) => [card.startTime, card.endTime])).toEqual([
      [0, 3.9],
      [3.95, 7.9],
    ]);
  });

  it("yields a monotonic x mapping across the mixed-clock seam", () => {
    const graph = graphOf([
      collection("root", [media("a", 4), collection("e"), media("b", 4)]),
    ]);
    const spans: PreviewCardSpans = new Map([
      [mediaSpanKey("root", "a"), { start: 0, end: 4 }],
      [mediaSpanKey("root", "b"), { start: 4.62, end: 8.62 }],
    ]);
    const map = buildPlayheadMap(childSpans(graph, {}, "root", spans, flatWidth));

    let previousX = -Infinity;
    for (let time = 0; time <= map.totalDurationSeconds; time += 0.25) {
      const x = map.xAt(time);
      expect(x).toBeGreaterThanOrEqual(previousX);
      previousX = x;
    }
  });
});

describe("cardSpansOf", () => {
  it("keys each leaf under its parent and folds it into every collection on its path", () => {
    const spans = cardSpansOf(
      manifestOf([
        leaf("m1", ["root", "sceneA"], 0, 4),
        leaf("m2", ["root", "sceneA"], 4.12, 3),
        leaf("m3", ["root"], 7.24, 5),
      ]),
    );

    expect(spans.get(mediaSpanKey("sceneA", "m1"))).toEqual({ start: 0, end: 4 });
    expect(spans.get("sceneA")).toEqual({ start: 0, end: 7.12 });
    expect(spans.get("root")).toEqual({ start: 0, end: 12.24 });
    expect(spans.get(mediaSpanKey("root", "m3"))).toEqual({ start: 7.24, end: 12.24 });
  });

  // Leaf ids repeat across documents (one clip referenced from two
  // collections). A flat id key merged both occurrences into one span
  // covering both, so either row's card mapped time across the union window.
  it("keeps a duplicated leaf id distinct per parent collection", () => {
    const graph = graphOf([
      collection("root", [
        collection("sceneA", [media("shared", 4)]),
        collection("sceneB", []),
      ]),
    ]);
    const spans = cardSpansOf(
      manifestOf([
        leaf("shared", ["root", "sceneA"], 0, 4),
        leaf("shared", ["root", "sceneB"], 10, 4),
      ]),
    );

    // sceneA's card gets ITS occurrence's window, not the 0..14 union.
    const cards = childSpans(graph, {}, "sceneA", spans, flatWidth);
    expect(cards.map((card) => [card.startTime, card.endTime])).toEqual([[0, 4]]);
  });
});

describe("manifestTrailsLedger", () => {
  const revisionOf = (ledger: Record<string, number>) => (id: string) => ledger[id];

  it("flags a manifest whose CHILD compile predates the session's write", () => {
    // The root's revision is current — only per-document checking catches it.
    const manifest = { projectRevision: 5, documentRevisions: { root: 5, kid: 2 } };
    expect(manifestTrailsLedger(manifest, "root", revisionOf({ root: 5, kid: 3 }))).toBe(true);
  });

  it("accepts a manifest at or ahead of every known revision", () => {
    const manifest = { projectRevision: 5, documentRevisions: { root: 5, kid: 3 } };
    expect(manifestTrailsLedger(manifest, "root", revisionOf({ root: 5, kid: 3 }))).toBe(false);
    expect(manifestTrailsLedger(manifest, "root", revisionOf({}))).toBe(false);
  });

  it("falls back to the root-only check when documentRevisions is absent", () => {
    expect(manifestTrailsLedger({ projectRevision: 4 }, "root", revisionOf({ root: 5 }))).toBe(true);
    expect(manifestTrailsLedger({ projectRevision: 5 }, "root", revisionOf({ root: 5 }))).toBe(false);
  });

  // The race the revision comparison alone cannot see: a write still in the
  // debounce window (or in a batch whose response hasn't landed) has not
  // bumped the ledger, so a manifest compiled server-side BEFORE the write
  // carries revisions that look current. A pending write on any document the
  // compile read must veto the install until the write settles.
  it("rejects a revision-current manifest while a read-set document has a pending write", () => {
    const manifest = { projectRevision: 5, documentRevisions: { root: 5, kid: 3 } };
    const ledger = revisionOf({ root: 5, kid: 3 });
    expect(manifestTrailsLedger(manifest, "root", ledger, (id) => id === "kid")).toBe(true);
    expect(manifestTrailsLedger(manifest, "root", ledger, () => false)).toBe(false);
  });

  it("waits on a pending ROOT write even without documentRevisions", () => {
    const manifest = { projectRevision: 5 };
    expect(manifestTrailsLedger(manifest, "root", revisionOf({ root: 5 }), (id) => id === "root")).toBe(true);
  });
});

describe("nextManifestClipsState", () => {
  const cached = { forId: "timeline-1" };

  it("keeps the cached manifest while preview stays enabled", () => {
    expect(nextManifestClipsState(cached, true)).toBe(cached);
  });

  // The regression this guards: an edit made while preview is CLOSED never
  // clears `state` (the commit-driven discard effect only subscribes while
  // enabled), so re-enabling used to hand back a manifest compiled before
  // that edit. Disabling must drop the cache so re-enabling always starts
  // from the live projection.
  it("drops the cached manifest the instant preview disables", () => {
    expect(nextManifestClipsState(cached, false)).toBeNull();
  });

  it("is a no-op on an already-empty cache either way", () => {
    expect(nextManifestClipsState(null, true)).toBeNull();
    expect(nextManifestClipsState(null, false)).toBeNull();
  });
});

describe("nextManifestFailureCount", () => {
  it("keeps the streak while preview stays enabled", () => {
    expect(nextManifestFailureCount(MAX_MANIFEST_FETCH_RETRIES + 1, true)).toBe(
      MAX_MANIFEST_FETCH_RETRIES + 1,
    );
    expect(nextManifestFailureCount(0, true)).toBe(0);
  });

  // The regression this guards: a session that reached the retry cap left the
  // count past MAX_MANIFEST_FETCH_RETRIES. Reopening preview for the SAME
  // focusedId does not trip the fetch effect's focusedId-change reset, so the
  // capped count carried over and the first failed fetch after reopening
  // scheduled no retry. Zeroing on disable means every reopen starts fresh.
  it("resets the streak the instant preview disables", () => {
    expect(nextManifestFailureCount(MAX_MANIFEST_FETCH_RETRIES + 1, false)).toBe(0);
    expect(nextManifestFailureCount(3, false)).toBe(0);
  });

  // Disabling already zeroed it, so the enable flip only has to leave 0 alone.
  it("leaves an already-reset streak at zero across a reopen", () => {
    expect(nextManifestFailureCount(0, false)).toBe(0);
    expect(nextManifestFailureCount(0, true)).toBe(0);
  });
});

describe("buildRulerTicks", () => {
  const PPS = 40;
  // At 40 px/s: major = 2s (first nice step ≥ 46/40), all three subtiers
  // clear the 6px minor gap (2/8 · 40 = 10px), so finest = 0.25s.
  const MAJOR = rulerMajorSpacing(PPS);
  const FINEST = MAJOR / 2 ** rulerSubtierCount(MAJOR, PPS);

  /** `count` back-to-back media cards of `seconds` each, laid out at PPS —
   *  times start at 0 and are gapless, so t maps linearly onto x within a
   *  card and the fixtures stay hand-checkable. */
  function mediaCards(count: number, seconds: number): ChildSpan[] {
    const cards: ChildSpan[] = [];
    for (let index = 0; index < count; index += 1) {
      cards.push({
        startTime: index * seconds,
        endTime: (index + 1) * seconds,
        width: seconds * PPS,
      });
    }
    return cards;
  }

  const noCollections = (cards: readonly ChildSpan[]) => cards.map(() => false);
  const FULL_WINDOW = { startX: 0, endX: Number.MAX_SAFE_INTEGER };
  const serialize = (tick: RulerTick) => `${tick.x.toFixed(3)}|${tick.level}|${tick.label}`;

  it("builds the exact tier ladder on a small strip (full window)", () => {
    const cards = mediaCards(1, 4);
    const ticks = buildRulerTicks(cards, noCollections(cards), PPS, FULL_WINDOW);

    // 4s at finest 0.25s = 17 ticks, t=n·0.25 at x=t·40.
    expect(ticks).toHaveLength(17);
    expect(ticks[0]).toEqual({ x: 0, level: 0, label: "0s" });
    expect(ticks[8]).toEqual({ x: 80, level: 0, label: "2s" }); // major (2s grid)
    expect(ticks[4]).toEqual({ x: 40, level: 1, label: "" }); // half-major
    expect(ticks[2]).toEqual({ x: 20, level: 2, label: "" }); // quarter
    expect(ticks[1]).toEqual({ x: 10, level: 3, label: "" }); // eighth
  });

  // The windowing contract: for ANY window, the output is exactly the full
  // build filtered to that window — plus at most one tick of slack per side
  // from the floor/ceil index widening. Nothing visible is ever missing.
  it("windowed output equals the full build filtered to the window", () => {
    const cards = mediaCards(500, 4); // 2000s ≈ 80,000px of content
    const flags = noCollections(cards);
    const windowRange = { startX: 8400, endX: 9424 };
    const full = buildRulerTicks(cards, flags, PPS, FULL_WINDOW);
    const windowed = buildRulerTicks(cards, flags, PPS, windowRange);

    // Completeness: every full-build tick inside the window is present.
    const windowedSet = new Set(windowed.map(serialize));
    const fullInWindow = full.filter(
      (tick) => tick.x >= windowRange.startX && tick.x <= windowRange.endX,
    );
    expect(fullInWindow.length).toBeGreaterThan(50); // non-vacuous window
    for (const tick of fullInWindow) {
      expect(windowedSet.has(serialize(tick))).toBe(true);
    }

    // Tightness: nothing further out than one finest-step of slack.
    const slackPx = FINEST * PPS + STRIP_GAP_PX;
    for (const tick of windowed) {
      expect(tick.x).toBeGreaterThanOrEqual(windowRange.startX - slackPx);
      expect(tick.x).toBeLessThanOrEqual(windowRange.endX + slackPx);
    }

    // And every windowed tick is byte-identical to its full-build twin
    // (tiers keyed on the ABSOLUTE step index — windowing shifts nothing).
    const fullSet = new Set(full.map(serialize));
    for (const tick of windowed) {
      expect(fullSet.has(serialize(tick))).toBe(true);
    }
  });

  it("bounds tick count by the window, not the timeline duration", () => {
    const cards = mediaCards(2000, 4); // 8000s — ~32,000 ticks unwindowed
    const windowed = buildRulerTicks(cards, noCollections(cards), PPS, {
      startX: 100_000,
      endX: 101_024,
    });

    // ~1024px of window at ≥10px per finest tick, plus slack: two orders of
    // magnitude under the unwindowed count.
    expect(windowed.length).toBeGreaterThan(50);
    expect(windowed.length).toBeLessThan(300);
  });

  // Every time at or before the first card's startTime clamps to x = 0 —
  // including the "0s" origin label. `timeAt(0)` returns that startTime, so a
  // naive floor from it would drop the pre-content pile; the startX <= 0
  // branch keeps it whenever the window reaches the content origin.
  it("keeps the t=0 origin tick when the window includes the content start", () => {
    const cards: ChildSpan[] = [{ startTime: 1, endTime: 5, width: 160 }];
    const ticks = buildRulerTicks(cards, [false], PPS, { startX: 0, endX: 1024 });

    expect(ticks.some((tick) => tick.label === "0s" && tick.x === 0)).toBe(true);
  });

  it("skips collection interiors and windows their edge ticks like any other", () => {
    // media(4s/160px) · gap · collection(128px holding 100s) · gap · media —
    // then a second collection far to the right, outside the window.
    const cards: ChildSpan[] = [
      { startTime: 0, endTime: 4, width: 160 },
      { startTime: 4, endTime: 104, width: 128 },
      { startTime: 104, endTime: 108, width: 160 },
      { startTime: 108, endTime: 208, width: 128 },
    ];
    const flags = [false, true, false, true];
    const windowRange = { startX: 0, endX: 300 }; // covers the FIRST collection only
    const ticks = buildRulerTicks(cards, flags, PPS, windowRange);

    // No numbered tick lands strictly inside the first collection's card
    // (x in (169, 296]); its edge tick at x0=168 is present.
    const collectionX0 = 160 + STRIP_GAP_PX;
    const collectionX1 = collectionX0 + 128;
    const interior = ticks.filter(
      (tick) => tick.x > collectionX0 + 1 && tick.x <= collectionX1,
    );
    expect(interior).toEqual([]);
    expect(ticks.filter((tick) => tick.x === collectionX0 && tick.level === 1)).toHaveLength(1);

    // The second collection sits beyond the window: no edge tick for it.
    const secondX0 = collectionX1 + STRIP_GAP_PX + 160 + STRIP_GAP_PX;
    expect(ticks.some((tick) => tick.x === secondX0)).toBe(false);
  });

  it("returns nothing for an empty or zero-duration strip", () => {
    expect(buildRulerTicks([], [], PPS, FULL_WINDOW)).toEqual([]);
    expect(
      buildRulerTicks([{ startTime: 0, endTime: 0, width: 100 }], [false], PPS, FULL_WINDOW),
    ).toEqual([]);
  });
});

describe("buildRulerCollectionSpans", () => {
  // Same fixture shape as the tick tests: media · collection · media ·
  // collection, so x-ranges are hand-checkable against the tick walk.
  const cards: ChildSpan[] = [
    { startTime: 0, endTime: 4, width: 160 },
    { startTime: 4, endTime: 104, width: 128 }, // 100s of content in 128px
    { startTime: 104, endTime: 108, width: 160 },
    { startTime: 108, endTime: 208, width: 128 },
  ];
  const flags = [false, true, false, true];
  const FULL_WINDOW = { startX: 0, endX: Number.MAX_SAFE_INTEGER };
  const collection1X = 160 + STRIP_GAP_PX;
  const collection2X = collection1X + 128 + STRIP_GAP_PX + 160 + STRIP_GAP_PX;

  it("yields each collection's x-range and content duration on the tick layout", () => {
    const spans = buildRulerCollectionSpans(cards, flags, FULL_WINDOW);
    expect(spans).toEqual([
      { x: collection1X, width: 128, seconds: 100 },
      { x: collection2X, width: 128, seconds: 100 },
    ]);
  });

  it("windows spans by INTERSECTION so a partially visible collection keeps its label", () => {
    // Window ends inside the first collection's card — it still reports.
    const spans = buildRulerCollectionSpans(cards, flags, {
      startX: 0,
      endX: collection1X + 10,
    });
    expect(spans).toEqual([{ x: collection1X, width: 128, seconds: 100 }]);
  });

  it("skips collections wholly outside the window and media everywhere", () => {
    expect(buildRulerCollectionSpans(cards, flags, { startX: 0, endX: 100 })).toEqual([]);
    expect(buildRulerCollectionSpans(cards, cards.map(() => false), FULL_WINDOW)).toEqual([]);
  });
});

describe("shouldRetryManifestFetch", () => {
  // The regression this guards: a transient 500/network blip left the pane on
  // the shallow live projection forever because no failure path advanced the
  // fetch. The caller now retries on failure — but only up to a cap, so a
  // hard-down endpoint stops polling on an idle session.
  it("retries every consecutive failure up to the cap", () => {
    for (let attempt = 1; attempt <= MAX_MANIFEST_FETCH_RETRIES; attempt += 1) {
      expect(shouldRetryManifestFetch(attempt)).toBe(true);
    }
  });

  it("gives up once the failure streak exceeds the cap", () => {
    expect(shouldRetryManifestFetch(MAX_MANIFEST_FETCH_RETRIES + 1)).toBe(false);
    expect(shouldRetryManifestFetch(MAX_MANIFEST_FETCH_RETRIES + 5)).toBe(false);
  });

  // A reset streak (the caller zeroes its count on any good response, and an
  // aborted fetch never increments) has nothing to retry.
  it("does not retry with no accrued failures", () => {
    expect(shouldRetryManifestFetch(0)).toBe(false);
  });

  it("honors a caller-supplied cap", () => {
    expect(shouldRetryManifestFetch(2, 2)).toBe(true);
    expect(shouldRetryManifestFetch(3, 2)).toBe(false);
  });
});
