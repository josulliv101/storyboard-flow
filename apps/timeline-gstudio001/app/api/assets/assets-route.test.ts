import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CloudinaryAsset } from "@/lib/cloudinary-media-store";

// The REAL route handler over the REAL registry and Cloudinary adapter —
// only the process boundaries are faked (session, vendor listing).

const state = vi.hoisted(() => ({
  vendorAssets: [] as CloudinaryAsset[],
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
  listCloudinaryAssets: async () => state.vendorAssets,
}));

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

const request = (query = "") => new Request(`http://test.local/api/assets${query}`);

beforeEach(() => {
  state.vendorAssets = [
    vendorAsset("a", "root-a.png"),
    vendorAsset("b", "Scenes/b.png"),
    vendorAsset("c", "Scenes/Heist/c.png"),
  ];
  state.user = { uid: "user-a" };
});

describe("GET /api/assets", () => {
  it("serves the NEUTRAL shape from the default provider", async () => {
    const response = await listAssets(request());
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.providerId).toBe("cloudinary");
    expect(body.capabilities).toMatchObject({ folders: true });
    const assets = body.assets as { id: string; providerId: string; src: string; kind: string }[];
    // Flat listing: everything, regardless of folder.
    expect(assets.map((entry) => entry.id)).toEqual(["a", "b", "c"]);
    expect(assets[0]).toMatchObject({
      providerId: "cloudinary",
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

  it("404s an unknown provider by name", async () => {
    const response = await listAssets(request("?provider=nope"));
    expect(response.status).toBe(404);
    expect(((await response.json()) as { error: string }).error).toContain('"nope"');
  });

  it("requires a session", async () => {
    state.user = null;
    expect((await listAssets(request())).status).toBe(401);
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
        capabilities: { folders: true, tags: false, search: false, upload: false, delete: false },
      },
    ]);
  });
});
