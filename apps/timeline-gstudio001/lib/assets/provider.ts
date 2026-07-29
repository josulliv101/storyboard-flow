// The provider interface and its registry — pure module (no server imports),
// so registry behaviour unit-tests with in-memory fakes. The INSTANCE the
// routes use lives in ./registry.ts, which is server-only because the real
// adapters are.

import type {
  AssetKind,
  AssetProviderCapabilities,
  AssetProviderDescriptor,
} from "./types";

/** Who is asking. Per-user OAuth credentials (Drive/Dropbox) will arrive here
 *  when that track lands, which is why the methods take it rather than reading
 *  globals. */
export type AssetOwnerContext = Readonly<{ uid: string }>;

/** What `remove` needs to address a file. The `kind` is here because a
 *  provider can need it (Cloudinary's destroy endpoint is per resource type)
 *  and the caller is a sweep running 30 days after the clip was deleted, with
 *  no clip left to ask. */
export type AssetDeleteTarget = Readonly<{ assetId: string; kind: AssetKind }>;

export type AssetProvider = AssetProviderDescriptor &
  Readonly<{
    /**
     * Permanently delete one asset. Present exactly when
     * `capabilities.delete` is true — the registry has no way to enforce that
     * pairing, so an adapter declaring the capability without the method is a
     * bug its own tests should catch.
     *
     * Takes an OWNER context, not a project one: deletion addresses a durable
     * asset id, and by the time this runs there is no project view of it. A
     * missing asset is a SUCCESS — the desired end state is "this file is not
     * there", and a sweep that throws on an already-deleted object would jam
     * behind it forever.
     */
    remove?: (ctx: AssetOwnerContext, target: AssetDeleteTarget) => Promise<void>;
  }>;

export type AssetProviderRegistry = Readonly<{
  get: (id: string) => AssetProvider | undefined;
}>;

/**
 * The registry is now a lookup and nothing more.
 *
 * It used to answer "which provider serves a request that names none"
 * (`defaultProvider`) and "what can each one do" (`describeAll`) — both for the
 * browse API and its picker, both gone with the tray. Every caller today
 * arrives holding a `providerId` off a tombstone, so resolution is exact and
 * ordering means nothing.
 */
export function createAssetProviderRegistry(
  providers: readonly AssetProvider[],
): AssetProviderRegistry {
  const byId = new Map<string, AssetProvider>();
  for (const provider of providers) {
    if (byId.has(provider.id)) {
      // Fail at construction, not at request time: a duplicate id would make
      // an asset ref unresolvable, and a ref that resolves to the wrong
      // provider is a delete pointed at the wrong file.
      throw new Error(`Duplicate asset provider id "${provider.id}".`);
    }
    byId.set(provider.id, provider);
  }
  return { get: (id) => byId.get(id) };
}

/** Capability set for a provider that cannot do anything yet — the starting
 *  point for a new adapter; spread and override what the backend supports. */
export const LIST_ONLY_CAPABILITIES: AssetProviderCapabilities = {
  delete: false,
};
