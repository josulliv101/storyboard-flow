import { afterEach, describe, expect, it, vi } from "vitest";

import { registerWebMcpTools } from "./webmcp-adapter";
import type { ToolDef } from "./types";

/**
 * What the adapter does with the promise `registerTool` returns.
 *
 * That promise was discarded, which is the entire bug this suite exists for.
 * Chrome settles a registration asynchronously and REJECTS it with the signal's
 * reason when the signal aborts first — so tearing the registration down before
 * it settles produced an unhandled rejection PER TOOL. Measured in Chrome 151:
 * six tools registered and the controller aborted in the same tick gave six
 * `AbortError: signal is aborted without reason`; aborting one turn of the
 * event loop later gave none.
 *
 * It surfaced on the `controller.abort()` line, which is misleading and worth
 * knowing: the rejection reason is the DOMException that `abort()` CREATES, and
 * a DOMException's stack points at where it was created rather than where it
 * was thrown.
 */

const tool = (name: string): ToolDef => ({
  name,
  description: `${name} tool`,
  inputSchema: { type: "object", properties: {} },
  execute: async () => ({ content: [] }),
});

/** The reason `AbortController.abort()` produces with no argument — the exact
 *  object Chrome rejects a torn-down registration with. */
const abortReason = () => new DOMException("signal is aborted without reason", "AbortError");

function installModelContext(
  registerTool: (tool: unknown, options?: { signal?: AbortSignal }) => Promise<void> | void,
) {
  const navigatorStub = { modelContext: { registerTool } };
  vi.stubGlobal("navigator", navigatorStub);
  return navigatorStub;
}

/** Rejections nothing awaited, which is what the browser reports. Node fires
 *  `unhandledRejection` only after the microtask queue drains, so the assertion
 *  has to wait for a macrotask — an immediate check passes vacuously. */
function watchUnhandledRejections() {
  const seen: unknown[] = [];
  const onUnhandled = (reason: unknown) => seen.push(reason);
  process.on("unhandledRejection", onUnhandled);
  return {
    seen,
    settle: async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      process.off("unhandledRejection", onUnhandled);
      return seen;
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("registerWebMcpTools", () => {
  it("absorbs the rejection a torn-down registration produces, per tool", async () => {
    // Exactly Chrome's behaviour: the registration settles later, and rejects
    // with the signal's reason if the signal went first.
    installModelContext((_tool, options) =>
      new Promise<void>((resolve, reject) => {
        options?.signal?.addEventListener("abort", () => reject(abortReason()));
        setTimeout(resolve, 50);
      }),
    );
    const watcher = watchUnhandledRejections();

    const unregister = registerWebMcpTools([tool("a"), tool("b"), tool("c")]);
    // In the SAME TICK, which is the case that produced one rejection per tool.
    unregister();

    expect(await watcher.settle()).toEqual([]);
  });

  it("reports a registration that failed for any other reason", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // `Duplicate tool name` is one Chrome actually returns. Swallowing it would
    // leave an agent tool silently absent, which is the hardest kind of missing
    // thing to notice.
    installModelContext(() => Promise.reject(new Error("Duplicate tool name")));
    const watcher = watchUnhandledRejections();

    registerWebMcpTools([tool("clashing")]);

    expect(await watcher.settle()).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      '[webmcp] "clashing" failed to register',
      expect.objectContaining({ message: "Duplicate tool name" }),
    );
  });

  it("still works when registerTool returns nothing", async () => {
    // The API is experimental; a build that returns void must not become a
    // TypeError inside the adapter's own error handling.
    const registered: unknown[] = [];
    installModelContext((registration) => {
      registered.push(registration);
    });
    const watcher = watchUnhandledRejections();

    const unregister = registerWebMcpTools([tool("a"), tool("b")]);
    unregister();

    expect(registered).toHaveLength(2);
    expect(await watcher.settle()).toEqual([]);
  });

  it("is a no-op without a provider, so callers can register unconditionally", () => {
    vi.stubGlobal("navigator", {});
    expect(() => registerWebMcpTools([tool("a")])()).not.toThrow();
  });
});
