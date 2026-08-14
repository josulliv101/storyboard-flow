// The render provider interface and its registry — pure module (no server
// imports), so registry behaviour unit-tests with in-memory fakes. The
// INSTANCE the routes use lives in ./registry.ts, which is server-only
// because the real adapters are.
//
// Deliberately the same shape as lib/assets/provider.ts. That seam turned out
// well and the two problems rhyme: an interface, capabilities a caller can ask
// about, a registry that resolves an id, and adapters that know a vendor.

import type {
  RenderJob,
  RenderProgress,
  RenderProviderCapabilities,
  RenderProviderDescriptor,
} from "./types";

/** Who is asking. A hosted provider will need per-deployment credentials here
 *  rather than reading globals, which is why the methods take it. */
export type RenderOwnerContext = Readonly<{ uid: string }>;

/**
 * THE JOB DOCUMENT IS THE CONTRACT, not this interface.
 *
 * Every provider reports through the same stored job — state, progress,
 * output URL — and the app watches that and only that. `dispatch` exists to
 * TELL a backend there is work, and what that means is the one thing
 * providers genuinely differ on:
 *
 *   - the local machine cannot be pushed to (it is behind NAT), so it POLLS
 *     for queued work and `dispatch` has nothing to do;
 *   - a hosted runner is told, so `dispatch` fires its trigger.
 *
 * Modelling it this way is what keeps "my laptop" and "some service" the same
 * kind of thing. A provider that needs no push is not a special case; it is a
 * provider whose dispatch is empty.
 */
export type RenderProvider = RenderProviderDescriptor &
  Readonly<{
    /**
     * Hand a queued job to the backend. Called AFTER the job document exists,
     * so a provider that throws leaves a job that is still claimable — which
     * is the recoverable direction. Returning normally is not a promise that
     * the render started, only that the backend was told.
     */
    dispatch: (ctx: RenderOwnerContext, job: RenderJob) => Promise<void>;

    /**
     * Stop work already in flight. Present exactly when `capabilities.cancel`
     * is true — the registry cannot enforce that pairing, so an adapter
     * declaring the capability without the method is a bug its own tests
     * should catch. Abandoning a job that has not been claimed needs no
     * provider involvement and is the app's own business.
     */
    cancel?: (ctx: RenderOwnerContext, jobId: string) => Promise<void>;

    /**
     * Ask the backend where a job got to, for providers whose worker cannot
     * report for itself. Absent when the worker writes its own progress to
     * the job document, which is the local worker's arrangement and the
     * simpler one.
     */
    poll?: (ctx: RenderOwnerContext, jobId: string) => Promise<RenderProgress>;
  }>;

export type RenderProviderRegistry = Readonly<{
  get: (id: string) => RenderProvider | undefined;
  /** Every registered provider, in registration order. Unlike the asset
   *  registry — which lost its `describeAll` with the picker — this one keeps
   *  it: a render has to be routed somewhere at submit time, and offering the
   *  choice needs the list. */
  describeAll: () => readonly RenderProviderDescriptor[];
  /** Who serves a request naming no provider: the first registered. */
  defaultProvider: () => RenderProvider | undefined;
}>;

export function createRenderProviderRegistry(
  providers: readonly RenderProvider[],
): RenderProviderRegistry {
  const byId = new Map<string, RenderProvider>();
  for (const provider of providers) {
    if (byId.has(provider.id)) {
      // Fail at construction, not at request time: a duplicate id would send
      // a render to whichever adapter happened to register last, which is a
      // job silently running somewhere nobody is watching.
      throw new Error(`Duplicate render provider id "${provider.id}".`);
    }
    byId.set(provider.id, provider);
  }
  const ordered = [...byId.values()];
  return {
    get: (id) => byId.get(id),
    describeAll: () =>
      ordered.map(({ id, label, capabilities }) => ({ id, label, capabilities })),
    defaultProvider: () => ordered[0],
  };
}

/** Capability set for an adapter that can do neither yet — the starting point
 *  for a new provider; spread and override what the backend supports. */
export const MINIMAL_RENDER_CAPABILITIES: RenderProviderCapabilities = {
  cancel: false,
  progress: false,
};
