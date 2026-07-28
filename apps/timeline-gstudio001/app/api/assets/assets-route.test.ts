import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CloudinaryAsset } from "@/lib/cloudinary-media-store";

// The REAL route handler over the REAL registry and Cloudinary adapter —
// only the process boundaries are faked (session, vendor listing).

const state = vi.hoisted(() => ({
  vendorAssets: [] as CloudinaryAsset[],
  listedFor: null as { uid: string; projectId: string } | null,
  user: { uid: "user-a", email: null as string | null, name: null, picture: null } as {
    uid: string;
  } | null,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/firebase-auth-session", () => ({
  requireAuthUser: async () =>
    state.user
      ? { user: state.user, response: null }
      : { user: null, response: new Response(null, { status: 401 }) },
}));
vi.mock("@/lib/cloudinary-media-store", () => ({
  listCloudinaryAssets: async (uid: string, projectId: string) => {
    state.listedFor = { uid, projectId };
    return state.vendorAssets;
  },
}));
vi.mock("@/lib/project-asset-scope", () => {
  class ProjectAssetScopeError extends Error {
    constructor(
      message: string,
      readonly status: number,
    ) {
      super(message);
    }
  }
  return {
    ProjectAssetScopeError,
    requireProjectAssetScope: async (value: unknown) => {
      if (typeof value !== "string" || !value.startsWith("project-")) {
        throw new ProjectAssetScopeError("A valid projectId is required.", 400);
      }
      return value;
    },
  };
});

import { GET as listAssets } from "./route";
import { GET as listProviders } from "./providers/route";

function vendorAsset(id: string, relativePath: string): CloudinaryAsset {
  return {
    id,
    pathname: `gstudio/user-a/${relativePath}`,
    url: `https://cdn.test/${id}`,
    thumbnailUrl: `https://cdn.test/${id}.thumb`,
    resourceType: "image",
    relativePath,
  };
}

const request = (query = "") => {
  const url = new URL("http://test.local/api/assets");
  url.searchParams.set("projectId", "project-a");
  const supplied = new URLSearchParams(query.replace(/^\?/, ""));
  supplied.forEach((value, key) => url.searchParams.append(key, value));
  return new Request(url);
};

beforeEach(() => {
  state.vendorAssets = [
    vendorAsset("a", "root-a.png"),
    vendorAsset("b", "Scenes/b.png"),
    vendorAsset("c", "Scenes/Heist/c.png"),
  ];
  state.user = { uid: "user-a" };
  state.listedFor = null;
});

describe("GET /api/assets", () => {
  it("serves the NEUTRAL shape from the default provider", async () => {
    const response = await listAssets(request());
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.providerId).toBe("cloudinary");
    expect(state.listedFor).toEqual({ uid: "user-a", projectId: "project-a" });
    expect(body.capabilities).toMatchObject({ folders: true });
    const assets = body.assets as { id: string; providerId: string; src: string; kind: string }[];
    // Flat listing: everything, regardless of folder.
    expect(assets.map((entry) => entry.id)).toEqual(["a", "b", "c"]);
    expect(assets[0]).toMatchObject({
      providerId: "cloudinary",
      projectIds: ["project-a"],
      kind: "image",
      src: "https://cdn.test/a",
    });
    expect(body.folders).toEqual([{ name: "Scenes", path: ["Scenes"] }]);
  });

  it("scopes to a folder via repeated ?folder= segment params", async () => {
    const response = await listAssets(request("?folder=Scenes"));
    const body = (await response.json()) as { assets: { id: string }[]; folders: unknown };
    expect(body.assets.map((entry) => entry.id)).toEqual(["b"]);
    expect(body.folders).toEqual([{ name: "Heist", path: ["Scenes", "Heist"] }]);

    const deep = await listAssets(request("?folder=Scenes&folder=Heist"));
    expect(((await deep.json()) as { assets: { id: string }[] }).assets.map((e) => e.id)).toEqual([
      "c",
    ]);
  });

  it("?browse=1 with no folder params is the ROOT folder, distinct from flat", async () => {
    const response = await listAssets(request("?browse=1"));
    const body = (await response.json()) as { assets: { id: string }[] };
    expect(body.assets.map((entry) => entry.id)).toEqual(["a"]);
  });

  it("?mode=tags browses the tag pseudo-hierarchy via ?tag= segment params", async () => {
    state.vendorAssets = [
      { ...vendorAsset("plain", "plain.png") },
      { ...vendorAsset("tagged", "Scenes/t.png"), tags: ["scene/heist"] },
    ];
    // Tags root: untagged assets + top-level tag groups (folder placement is
    // irrelevant in tag space).
    const root = await listAssets(request("?mode=tags"));
    const rootBody = (await root.json()) as { assets: { id: string }[]; folders: unknown };
    expect(rootBody.assets.map((entry) => entry.id)).toEqual(["plain"]);
    expect(rootBody.folders).toEqual([{ name: "scene", path: ["scene"] }]);

    const heist = await listAssets(request("?mode=tags&tag=scene&tag=heist"));
    const heistBody = (await heist.json()) as { assets: { id: string }[] };
    expect(heistBody.assets.map((entry) => entry.id)).toEqual(["tagged"]);
  });

  it("404s an unknown provider by name", async () => {
    const response = await listAssets(request("?provider=nope"));
    expect(response.status).toBe(404);
    expect(((await response.json()) as { error: string }).error).toContain('"nope"');
  });

  it("requires a session", async () => {
    state.user = null;
    expect((await listAssets(request())).status).toBe(401);
  });

  it("requires a project scope", async () => {
    const response = await listAssets(new Request("http://test.local/api/assets"));
    expect(response.status).toBe(400);
  });
});

describe("GET /api/assets/providers", () => {
  it("lists installed providers with capabilities for the picker", async () => {
    const response = await listProviders();
    const body = (await response.json()) as {
      providers: { id: string; label: string; capabilities: { folders: boolean } }[];
    };
    expect(body.providers).toEqual([
      {
        id: "cloudinary",
        label: "Cloudinary",
        capabilities: { folders: true, tags: true, search: true, upload: false, delete: false },
      },
    ]);
  });
});
