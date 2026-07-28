// The provider interface and its registry — pure module (no server imports),
// so registry behaviour unit-tests with in-memory fakes. The INSTANCE the
// routes use lives in ./registry.ts, which is server-only because the real
// adapters are.

import type {
  AssetPage,
  AssetProviderCapabilities,
  AssetProviderDescriptor,
  AssetQuery,
} from "./types";

/** Per-request context. Today just the signed-in user; per-user OAuth
 *  credentials (Drive/Dropbox) will arrive here when that track lands, which
 *  is why every provider method takes it rather than reading globals. */
export type AssetContext = Readonly<{ uid: string; projectId: string }>;

export type AssetProvider = AssetProviderDescriptor &
  Readonly<{
    /** List assets/folders for a query. A provider MUST tolerate query fields
     *  outside its capabilities by ignoring them (never throwing): the
     *  capabilities gate the UI, not the wire. */
    list: (ctx: AssetContext, query: AssetQuery) => Promise<AssetPage>;
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
