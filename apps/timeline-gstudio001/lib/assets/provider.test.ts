import { describe, expect, it } from "vitest";

import { LIST_ONLY_CAPABILITIES, createAssetProviderRegistry, type AssetProvider } from "./provider";

function fakeProvider(id: string, canDelete = false): AssetProvider {
  return {
    id,
    label: id.toUpperCase(),
    capabilities: { ...LIST_ONLY_CAPABILITIES, delete: canDelete },
    ...(canDelete ? { remove: async () => {} } : {}),
  };
}

describe("createAssetProviderRegistry", () => {
  it("resolves providers by id and answers unknown ids with undefined", () => {
    const registry = createAssetProviderRegistry([fakeProvider("one"), fakeProvider("two")]);
    expect(registry.get("two")?.id).toBe("two");
    expect(registry.get("nope")).toBeUndefined();
  });

  it("rejects a duplicate provider id at construction, not at request time", () => {
    // A ref that resolves to the WRONG provider is a delete pointed at the
    // wrong file, so this is the one thing worth failing loudly at startup.
    expect(() =>
      createAssetProviderRegistry([fakeProvider("dup"), fakeProvider("dup")]),
    ).toThrow(/Duplicate asset provider id "dup"/);
  });

  it("accepts an empty registry", () => {
    // It used to refuse one, because `defaultProvider()` had to have something
    // to return. Nothing asks for a default any more — every caller arrives
    // holding a providerId off a tombstone — so empty is simply a deployment
    // where nothing can be reclaimed.
    expect(createAssetProviderRegistry([]).get("cloudinary")).toBeUndefined();
  });
});
