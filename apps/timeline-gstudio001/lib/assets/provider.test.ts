import { describe, expect, it } from "vitest";

import { LIST_ONLY_CAPABILITIES, createAssetProviderRegistry, type AssetProvider } from "./provider";

function fakeProvider(id: string): AssetProvider {
  return {
    id,
    label: id.toUpperCase(),
    capabilities: { ...LIST_ONLY_CAPABILITIES, folders: id === "with-folders" },
    list: async () => ({ assets: [], folders: [] }),
  };
}

describe("createAssetProviderRegistry", () => {
  it("resolves providers by id and answers unknown ids with undefined", () => {
    const registry = createAssetProviderRegistry([fakeProvider("one"), fakeProvider("two")]);
    expect(registry.get("two")?.id).toBe("two");
    expect(registry.get("nope")).toBeUndefined();
  });

  it("defaults to the FIRST registered provider (registration order is preference)", () => {
    const registry = createAssetProviderRegistry([fakeProvider("first"), fakeProvider("second")]);
    expect(registry.defaultProvider().id).toBe("first");
  });

  it("describeAll carries each provider's own capabilities", () => {
    const registry = createAssetProviderRegistry([
      fakeProvider("with-folders"),
      fakeProvider("flat"),
    ]);
    expect(registry.describeAll()).toEqual([
      {
        id: "with-folders",
        label: "WITH-FOLDERS",
        capabilities: { ...LIST_ONLY_CAPABILITIES, folders: true },
      },
      { id: "flat", label: "FLAT", capabilities: LIST_ONLY_CAPABILITIES },
    ]);
  });

  it("rejects a duplicate provider id at construction, not at request time", () => {
    expect(() =>
      createAssetProviderRegistry([fakeProvider("dup"), fakeProvider("dup")]),
    ).toThrow(/Duplicate asset provider id "dup"/);
  });

  it("rejects an empty registry", () => {
    expect(() => createAssetProviderRegistry([])).toThrow(/at least one provider/);
  });
});
