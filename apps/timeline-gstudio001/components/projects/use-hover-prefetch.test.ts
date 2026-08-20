import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const prefetch = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ prefetch }) }));

import { HOVER_PREFETCH_DELAY_MS, useHoverPrefetch } from "./use-hover-prefetch";

/**
 * The hover-intent RULES, which is the part worth pinning here.
 *
 * What this cannot cover is whether a prefetch actually reaches the network —
 * that is Next's router, a real browser, and a real deployment. The reason to
 * test the rules at all is that each one exists to stop a Firestore bill: a
 * full prefetch of a project is a complete server render, measured at 149
 * reads, so "fires once", "does not fire on a pass-through" and "does not fire
 * twice for the same card" are each worth ~149 reads of correctness.
 *
 * Driven through the hook's returned callbacks rather than a rendered
 * component, because the app's vitest project is node-env and cannot parse TSX
 * — see the note in CLAUDE.md. The hook is plain functions over refs, so the
 * callbacks are the whole surface.
 */
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  const refs = new Map<number, { current: unknown }>();
  let index = 0;
  return {
    ...actual,
    useRef: <T,>(initial: T) => {
      const key = index++;
      if (!refs.has(key)) refs.set(key, { current: initial });
      return refs.get(key) as { current: T };
    },
    useCallback: <T,>(fn: T) => fn,
    useEffect: (fn: () => void) => {
      void fn;
    },
    __resetHookState: () => {
      refs.clear();
      index = 0;
    },
  };
});

const resetHookState = async () => {
  const react = (await import("react")) as unknown as { __resetHookState: () => void };
  react.__resetHookState();
};

beforeEach(async () => {
  vi.useFakeTimers();
  prefetch.mockClear();
  await resetHookState();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useHoverPrefetch", () => {
  it("fetches the board once the pointer settles", async () => {
    const { onEnter } = useHoverPrefetch();
    onEnter("/timeline/project-a/graph");

    // Nothing yet: a cursor crossing a card must not spend a server render.
    expect(prefetch).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(HOVER_PREFETCH_DELAY_MS);
    expect(prefetch).toHaveBeenCalledTimes(1);
    // FULL, not the default — `auto` is what the Link already did, and asking
    // again would spend a request to re-fetch the same skeleton.
    expect(prefetch).toHaveBeenCalledWith("/timeline/project-a/graph", { kind: "full" });
  });

  it("does not fetch a card the pointer only passed over", async () => {
    // The case the delay exists for: sweeping across a grid to reach one card
    // crosses every card before it, and each crossing would otherwise be 149
    // Firestore reads.
    const { onEnter, onLeave } = useHoverPrefetch();
    onEnter("/timeline/project-a/graph");
    await vi.advanceTimersByTimeAsync(HOVER_PREFETCH_DELAY_MS - 40);
    onLeave("/timeline/project-a/graph");

    await vi.advanceTimersByTimeAsync(1000);
    expect(prefetch).not.toHaveBeenCalled();
  });

  it("fetches a card at most once, however often it is hovered", async () => {
    const { onEnter, onLeave } = useHoverPrefetch();
    onEnter("/timeline/project-a/graph");
    await vi.advanceTimersByTimeAsync(HOVER_PREFETCH_DELAY_MS);
    onLeave("/timeline/project-a/graph");

    // Back and forth between two cards is the ordinary way someone reads this
    // page, and it must not re-bill the first one.
    onEnter("/timeline/project-a/graph");
    await vi.advanceTimersByTimeAsync(HOVER_PREFETCH_DELAY_MS);

    expect(prefetch).toHaveBeenCalledTimes(1);
  });

  it("treats each project separately", async () => {
    const { onEnter } = useHoverPrefetch();
    onEnter("/timeline/project-a/graph");
    onEnter("/timeline/project-b/graph");
    await vi.advanceTimersByTimeAsync(HOVER_PREFETCH_DELAY_MS);

    expect(prefetch).toHaveBeenCalledTimes(2);
    expect(prefetch.mock.calls.map((call) => call[0])).toEqual([
      "/timeline/project-a/graph",
      "/timeline/project-b/graph",
    ]);
  });
});
