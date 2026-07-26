import { afterEach, describe, expect, it, vi } from "vitest";

import { discardTrashClips, settlePendingWrites } from "./graph-trash-discard";

/** A gateway whose pending-write flag flips after a given number of checks —
 *  standing in for a debounced batch landing some time after the flush. */
function gatewayPendingFor(checks: number) {
  const calls = { flushes: 0, checks: 0 };
  return {
    calls,
    gateway: {
      hasPendingWrite: () => {
        calls.checks += 1;
        return calls.checks <= checks;
      },
      flushPendingWrites: () => {
        calls.flushes += 1;
      },
    },
  };
}

const noSleep = async () => {};

/** These tests run in the node environment, so `window` is stubbed down to the
 *  one method the announce needs. Returns the event types it saw. */
function captureAnnouncements(): string[] {
  const types: string[] = [];
  vi.stubGlobal("window", {
    dispatchEvent: (event: Event) => {
      types.push(event.type);
      return true;
    },
  });
  return types;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("settlePendingWrites", () => {
  it("returns without flushing when nothing is pending", async () => {
    const { calls, gateway } = gatewayPendingFor(0);
    await settlePendingWrites("trash-u1", gateway, noSleep);
    expect(calls.flushes).toBe(0);
  });

  it("flushes once and waits for the write to land", async () => {
    const { calls, gateway } = gatewayPendingFor(3);
    await settlePendingWrites("trash-u1", gateway, noSleep);
    expect(calls.flushes).toBe(1);
    // One check to decide to flush, then polls until it reads false.
    expect(calls.checks).toBe(4);
  });

  it("gives up rather than hanging on a write that never settles", async () => {
    const gateway = {
      hasPendingWrite: () => true,
      flushPendingWrites: () => {},
    };
    // Resolves at all — that is the assertion. A wedged write must not block
    // the discard forever; losing the race is recoverable, hanging is not.
    await expect(settlePendingWrites("trash-u1", gateway, noSleep)).resolves.toBeUndefined();
  });
});

describe("discardTrashClips", () => {
  it("does nothing for an empty id list", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { gateway } = gatewayPendingFor(0);

    await expect(discardTrashClips([], "trash-u1", gateway)).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("waits for the graph's own trash write BEFORE posting", async () => {
    const order: string[] = [];
    const gateway = {
      hasPendingWrite: () => order.length === 0,
      flushPendingWrites: () => order.push("flush"),
    };
    const fetchMock = vi.fn(async () => {
      order.push("post");
      return { ok: true } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    await discardTrashClips(["image-a"], "trash-u1", gateway);

    // The whole point: a discard sent before the graph's debounced write lands
    // is overwritten by it, and the entry comes back on the next load.
    expect(order).toEqual(["flush", "post"]);
  });

  it("posts the ids and announces the rebuild", async () => {
    const events = captureAnnouncements();
    const fetchMock = vi.fn(async () => ({ ok: true }) as Response);
    vi.stubGlobal("fetch", fetchMock);
    const { gateway } = gatewayPendingFor(0);

    await expect(discardTrashClips(["image-a", "image-b"], "trash-u1", gateway)).resolves.toBe(
      true,
    );

    expect(fetchMock).toHaveBeenCalledWith("/api/trash", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clipIds: ["image-a", "image-b"] }),
    });
    // Without this the mounted graph view writes the discarded clips straight
    // back on its next commit that touches the trash.
    expect(events).toEqual(["graph-view:trash-emptied"]);
  });

  it("does not announce a rebuild the server refused", async () => {
    const events = captureAnnouncements();
    vi.stubGlobal("fetch", async () => ({ ok: false }) as Response);
    const { gateway } = gatewayPendingFor(0);

    await expect(discardTrashClips(["image-a"], "trash-u1", gateway)).resolves.toBe(false);
    expect(events).toEqual([]);
  });

  it("survives a network failure", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("offline");
    });
    const { gateway } = gatewayPendingFor(0);
    await expect(discardTrashClips(["image-a"], "trash-u1", gateway)).resolves.toBe(false);
  });
});
