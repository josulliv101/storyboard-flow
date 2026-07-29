// The provider interface and its registry — pure module (no server imports),
// so registry behaviour unit-tests with in-memory fakes. The INSTANCE the
// routes use lives in ./registry.ts, which is server-only because the real
// adapters are.

import type {
  AssetKind,
  AssetPage,
  AssetProviderCapabilities,
  AssetProviderDescriptor,
  AssetQuery,
} from "./types";

/** Who is asking. Per-user OAuth credentials (Drive/Dropbox) will arrive here
 *  when that track lands, which is why every provider method takes it rather
 *  than reading globals. */
export type AssetOwnerContext = Readonly<{ uid: string }>;

/** Per-request context for BROWSING, which is always scoped to one project. */
export type AssetContext = AssetOwnerContext & Readonly<{ projectId: string }>;

/** What `remove` needs to address a file. The `kind` is here because a
 *  provider can need it (Cloudinary's destroy endpoint is per resource type)
 *  and the caller is a sweep running 30 days after the clip was deleted, with
 *  no clip left to ask. */
export type AssetDeleteTarget = Readonly<{ assetId: string; kind: AssetKind }>;

export type AssetProvider = AssetProviderDescriptor &
  Readonly<{
    /** List assets/folders for a query. A provider MUST tolerate query fields
     *  outside its capabilities by ignoring them (never throwing): the
     *  capabilities gate the UI, not the wire. */
    list: (ctx: AssetContext, query: AssetQuery) => Promise<AssetPage>;
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
  /** Descriptors only — what /api/assets/providers serves the picker. */
  describeAll: () => readonly AssetProviderDescriptor[];
  /** The provider used when a request names none. Always the first
   *  registered — registration order is the app's preference order. */
  defaultProvider: () => AssetProvider;
}>;

export function createAssetProviderRegistry(
  providers: readonly AssetProvider[],
): AssetProviderRegistry {
  if (providers.length === 0) {
    throw new Error("An asset provider registry needs at least one provider.");
  }
  const byId = new Map<string, AssetProvider>();
  for (const provider of providers) {
    if (byId.has(provider.id)) {
      // Fail at construction, not at request time: a duplicate id would make
      // `?provider=` ambiguous and asset refs unresolvable.
      throw new Error(`Duplicate asset provider id "${provider.id}".`);
    }
    byId.set(provider.id, provider);
  }
  return {
    get: (id) => byId.get(id),
    describeAll: () =>
      providers.map(({ id, label, capabilities }) => ({ id, label, capabilities })),
    defaultProvider: () => providers[0],
  };
}

/** Capability set for a provider that only lists — the common starting point
 *  for a new adapter; spread and override what the backend really supports. */
export const LIST_ONLY_CAPABILITIES: AssetProviderCapabilities = {
  folders: false,
  tags: false,
  search: false,
  upload: false,
  delete: false,
};
