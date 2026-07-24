import { beforeEach, describe, expect, it, vi } from "vitest";

import { encodeFolderPath } from "@storyboard/timeline-model";
import type {
  CollectionTimelineClip,
  TimelineClip,
  TimelineDocument,
} from "@storyboard/timeline-model/types";
import type { CloudinaryAsset } from "@/lib/cloudinary-media-store";

// The REAL asset-library GET branch over the REAL provider seam and Cloudinary
// adapter — only the process boundaries are faked (session, the persisted
// firebase doc, the vendor listing). Proves phase 5: the synthetic
// asset-library timeline is now built FROM the seam, not a bespoke Cloudinary
// pipeline.

const state = vi.hoisted(() => ({
  vendorAssets: [] as CloudinaryAsset[],
  persisted: null as TimelineDocument | null,
  user: { uid: "user-a" } as { uid: string } | null,
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
vi.mock("@/lib/firebase-timeline-store", () => ({
  getFirebaseTimelineDocument: async () => state.persisted,
  saveFirebaseTimelineEntry: async () => ({ document: null, revision: 0 }),
  deleteFirebaseTimelineDocument: async () => undefined,
}));
// serve-timeline imports from the (mocked) store; the asset-library branch
// returns before reaching it, so a no-op stub is enough.
vi.mock("@/lib/serve-timeline", () => ({
  serveTimelineDocument: async () => null,
  serveTrashDocument: async () => null,
}));

import { GET as getTimeline } from "./[id]/route";

function vendorAsset(id: string, relativePath: string, over: Partial<CloudinaryAsset> = {}): CloudinaryAsset {
  return {
    id,
    pathname: `gstudio/user-a/${relativePath}`,
    url: `https://cdn.test/${id}`,
    thumbnailUrl: `https://cdn.test/${id}.thumb`,
    resourceType: "image",
    relativePath,
    ...over,
  };
}

async function getDoc(id: string): Promise<TimelineDocument> {
  const response = await getTimeline(new Request(`http://test.local/api/timelines/${id}`), {
    params: Promise.resolve({ id }),
  });
  expect(response.status).toBe(200);
  return ((await response.json()) as { document: TimelineDocument }).document;
}

beforeEach(() => {
  state.vendorAssets = [
    vendorAsset("root-a", "root-a.png"),
    vendorAsset("scenes-1", "Scenes/s1.png"),
    vendorAsset("heist-1", "Scenes/Heist/h1.png"),
  ];
  state.persisted = null;
  state.user = { uid: "user-a" };
});

describe("GET /api/timelines/asset-library-<uid> (seam-backed)", () => {
  it("synthesizes the ROOT folder: its asset plus a subfolder collection", async () => {
    const doc = await getDoc("asset-library-user-a");
    // Folders first, then root-level assets — the deeper assets appear only
    // through the subfolder collection.
    expect(doc.clips.map((clip) => clip.kind)).toEqual(["collection", "image"]);

    const collection = doc.clips[0] as CollectionTimelineClip;
    expect(collection.title).toBe("Scenes");
    expect(collection.childTimelineId).toBe(
      `asset-library-col-user-a-${encodeFolderPath("Scenes")}`,
    );

    const media = doc.clips[1] as TimelineClip & { sourceAsset?: unknown };
    expect(media).toMatchObject({
      kind: "image",
      src: "https://cdn.test/root-a",
      sourceAsset: { providerId: "cloudinary", assetId: "root-a" },
    });
  });

  it("scopes a subfolder timeline id to that folder's contents", async () => {
    const doc = await getDoc(`asset-library-col-user-a-${encodeFolderPath("Scenes")}`);
    // Scenes: its direct asset (scenes-1) + its Heist subfolder collection.
    expect(doc.clips.map((clip) => clip.kind)).toEqual(["collection", "image"]);
    expect((doc.clips[0] as CollectionTimelineClip).childTimelineId).toBe(
      `asset-library-col-user-a-${encodeFolderPath("Scenes/Heist")}`,
    );
    const media = doc.clips[1] as TimelineClip;
    expect(media.src).toBe("https://cdn.test/scenes-1");
  });

  it("returns an empty timeline for an empty library, not an error", async () => {
    state.vendorAssets = [];
    const doc = await getDoc("asset-library-user-a");
    expect(doc.clips).toEqual([]);
  });
});
