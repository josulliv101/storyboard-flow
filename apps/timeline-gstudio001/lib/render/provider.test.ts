import { describe, expect, it, vi } from "vitest";

import {
  MINIMAL_RENDER_CAPABILITIES,
  createRenderProviderRegistry,
  type RenderProvider,
} from "./provider";
import { LOCAL_RENDER_PROVIDER_ID, localRenderProvider } from "./local-provider";

const fake = (id: string, label = id): RenderProvider => ({
  id,
  label,
  capabilities: MINIMAL_RENDER_CAPABILITIES,
  dispatch: async () => {},
});

describe("createRenderProviderRegistry", () => {
  it("resolves a provider by id", () => {
    const registry = createRenderProviderRegistry([fake("local"), fake("hosted")]);
    expect(registry.get("hosted")?.id).toBe("hosted");
  });

  it("is undefined for an id nobody registered, rather than throwing", () => {
    expect(createRenderProviderRegistry([fake("local")]).get("nope")).toBeUndefined();
  });

  it("is legal to register nothing — a deployment that cannot render", () => {
    const registry = createRenderProviderRegistry([]);
    expect(registry.describeAll()).toEqual([]);
    expect(registry.defaultProvider()).toBeUndefined();
  });

  it("REFUSES a duplicate id at construction, not at request time", () => {
    // A duplicate would route a render to whichever adapter registered last —
    // a job running somewhere nobody is watching.
    expect(() => createRenderProviderRegistry([fake("local"), fake("local", "other")])).toThrow(
      /Duplicate render provider id "local"/,
    );
  });

  it("takes the FIRST registered as the default", () => {
    const registry = createRenderProviderRegistry([fake("local"), fake("hosted")]);
    expect(registry.defaultProvider()?.id).toBe("local");
  });

  it("describes providers without leaking the methods", () => {
    const registry = createRenderProviderRegistry([fake("local", "This machine")]);
    expect(registry.describeAll()).toEqual([
      { id: "local", label: "This machine", capabilities: MINIMAL_RENDER_CAPABILITIES },
    ]);
  });
});

describe("localRenderProvider", () => {
  it("declares progress and not cancel, and carries the method for neither more than it claims", () => {
    expect(localRenderProvider.capabilities).toEqual({ cancel: false, progress: true });
    // The capability and the method are ONE claim. Cancel is declared false,
    // so the method must be absent — the registry cannot enforce the pairing,
    // which is why the adapter's own test does.
    expect(localRenderProvider.cancel).toBeUndefined();
  });

  it("has an empty dispatch — the job document IS the message", async () => {
    // The machine is behind NAT and cannot be pushed to; the worker polls for
    // queued work. Pinned because an empty dispatch reads like an oversight,
    // and the next provider's will not be empty.
    const spy = vi.fn();
    await expect(
      localRenderProvider.dispatch({ uid: "user-a" }, {
        id: "render-1",
        timelineId: "project-1",
        projectRevision: 3,
        cutList: { cuts: [], layers: [], durationSeconds: 0, format: { width: 1, height: 1, fps: 24 } },
        requestedBy: "user-a",
        createdAt: "2026-08-14T00:00:00.000Z",
      }),
    ).resolves.toBeUndefined();
    expect(spy).not.toHaveBeenCalled();
  });

  it("registers under the id the worker claims against", () => {
    expect(localRenderProvider.id).toBe(LOCAL_RENDER_PROVIDER_ID);
  });
});
