import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TimelineClip, TimelineDocument } from "@storyboard/timeline-model/types";

// attach_media, over the real graph adapter and the real store transaction.
// Cloudinary is faked at its module boundary (nothing here should reach the
// network); Firestore is the same in-memory fake the other server tests use.
//
// The invariant under test is PROVENANCE: a clip minted from an upload must
// carry `sourceAsset`, because an un-provenanced clip is never marked for
// reclaim and its file leaks in storage forever (docs/asset-providers.md).

type Stored = Record<string, unknown>;

const state = vi.hoisted(() => {
  const docs = new Map<string, Stored>();
  const applySet = (id: string, data: Stored, opts?: { merge?: boolean }) => {
    const existing = docs.get(id);
    docs.set(id, opts?.merge && existing ? { ...existing, ...data } : { ...data });
  };
  const snapshot = (id: string) => {
    const data = docs.get(id);
    return {
      id,
      exists: data !== undefined,
      data: () => (data ? { ...data } : undefined),
      get: (field: string) => (data ? data[field] : undefined),
    };
  };
  const docRef = (id: string) => ({
    id,
    get: async () => snapshot(id),
    set: async (data: Stored, opts?: { merge?: boolean }) => applySet(id, data, opts),
    delete: async () => {
      docs.delete(id);
    },
  });
  type Tx = {
    get: (ref: { id: string }) => Promise<ReturnType<typeof snapshot>>;
    set: (ref: { id: string }, data: Stored, opts?: { merge?: boolean }) => void;
  };
  const db = {
    collection: () => ({
      doc: docRef,
      where: () => ({ orderBy: () => ({ limit: () => ({ get: async () => ({ docs: [] }) }) }) }),
    }),
    runTransaction: async <T>(fn: (tx: Tx) => Promise<T>): Promise<T> => {
      const staged: Array<[string, Stored, { merge?: boolean } | undefined]> = [];
      const tx: Tx = {
        get: async (ref) => snapshot(ref.id),
        set: (ref, data, opts) => {
          staged.push([ref.id, data, opts]);
        },
      };
      const result = await fn(tx);
      for (const [id, data, opts] of staged) applySet(id, data, opts);
      return result;
    },
  };
  const assets: Array<Record<string, unknown>> = [];
  return { docs, db, assets };
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/firebase-admin", () => ({ getFirebaseDb: () => state.db }));
vi.mock("firebase-admin/firestore", () => {
  class Timestamp {
    toDate() {
      return new Date(0);
    }
  }
  return { Timestamp, FieldValue: { serverTimestamp: () => new Timestamp() } };
});
vi.mock("@/lib/cloudinary-media-store", () => ({
  listCloudinaryAssets: async () => state.assets,
  forgetCloudinaryAssetList: () => {},
  // Pure extension test, so the mock mirrors the real rule rather than
  // stubbing it — a stub here would let a wrong clip kind pass unnoticed.
  isAudioAsset: (value: string) => /\.(flac|wav|mp3|m4a|aac|ogg|oga|opus)$/i.test(value),
  createCloudinaryUploadTicket: () => ({
    uploadUrl: "https://api.cloudinary.com/v1_1/demo/video/upload",
    fields: { api_key: "k", folder: "f", public_id: "p", timestamp: "1", signature: "s" },
    publicId: "f/p",
    resourceType: "video",
    expiresAt: new Date().toISOString(),
  }),
}));

import { attachMedia } from "./upload";

const OWNER = "user-a";
const PROJECT = "project-alpha";

function clip(id: string): TimelineClip {
  return {
    id,
    index: 0,
    kind: "image",
    src: "https://example.test/img.jpg",
    alt: id,
    aspect: 16 / 9,
    trackIndex: 0,
    startTime: 0,
    duration: 4,
    sourceDuration: 4,
    trimIn: 0,
    trimOut: 0,
  };
}

function seed(id: string, clips: TimelineClip[]) {
  const document: TimelineDocument = { id, title: id, clips };
  state.docs.set(id, { ...document, ownerUid: OWNER, revision: 1 });
}

function storedClips(id: string): TimelineClip[] {
  return ((state.docs.get(id) as { clips?: TimelineClip[] } | undefined)?.clips ?? []);
}

/**
 * The id of the clip an attach minted. Ids are MINTED, not derived from the
 * asset, so a test cannot spell one out — read the one the tool reports. (These
 * assertions used to match on the public id inside the clip id, which is
 * exactly the coupling that stopped an asset being attached twice.)
 */
function attachedNodeId(result: Awaited<ReturnType<typeof attachMedia>>): string {
  const { nodeId } = (result.structuredContent ?? {}) as { nodeId?: string };
  if (nodeId === undefined) throw new Error("expected the attach to report a nodeId");
  return nodeId;
}

beforeEach(() => {
  state.docs.clear();
  state.assets.length = 0;
  state.assets.push({
    id: "a1",
    pathname: "media/user-a/project-alpha/render-123",
    url: "https://res.cloudinary.com/demo/video/upload/render-123.mp4",
    thumbnailUrl: "https://res.cloudinary.com/demo/video/upload/render-123.jpg",
    resourceType: "video",
    duration: 12,
    relativePath: "render-123",
  });
});

describe("attachMedia", () => {
  it("stamps sourceAsset on the minted clip — without it the file leaks", async () => {
    seed(PROJECT, [clip("a")]);

    const result = await attachMedia(
      { timelineId: PROJECT, projectId: PROJECT, publicId: "media/user-a/project-alpha/render-123" },
      OWNER,
    );

    expect(result.isError).toBeFalsy();
    const added = storedClips(PROJECT).find((c) => c.id === attachedNodeId(result));
    expect(added).toBeDefined();
    // TimelineClip is a union; provenance only exists on media clips.
    if (!added || added.kind === "collection") throw new Error("expected a media clip");
    expect(added.sourceAsset).toEqual({
      providerId: "cloudinary",
      assetId: "media/user-a/project-alpha/render-123",
    });
  });

  it("carries the real source duration and url from the upload", async () => {
    seed(PROJECT, []);

    await attachMedia(
      { timelineId: PROJECT, projectId: PROJECT, publicId: "media/user-a/project-alpha/render-123" },
      OWNER,
    );

    const added = storedClips(PROJECT)[0];
    if (added.kind === "collection") throw new Error("expected a media clip");
    expect(added.kind).toBe("video");
    expect(added.src).toBe("https://res.cloudinary.com/demo/video/upload/render-123.mp4");
    expect(added.sourceDuration).toBe(12);
  });

  // Trims are AMOUNTS REMOVED from each end (`mediaDurationSeconds` computes
  // `full - trimIn - trimOut`), so an untrimmed clip is 0/0. Passing the play
  // length through as `trimOutSeconds` trimmed the entire clip away: the clip
  // packed at zero width and had to be dragged back out by hand. The test above
  // only checked `sourceDuration`, which stayed correct throughout — `duration`
  // is the field that collapsed, so assert it here.
  it("attaches a video at its full length, not zero", async () => {
    seed(PROJECT, []);

    await attachMedia(
      { timelineId: PROJECT, projectId: PROJECT, publicId: "media/user-a/project-alpha/render-123" },
      OWNER,
    );

    const added = storedClips(PROJECT)[0];
    if (added.kind !== "video") throw new Error("expected a video clip");
    expect(added.trimIn).toBe(0);
    expect(added.trimOut).toBe(0);
    expect(added.duration).toBe(12);
  });

  it("honours durationSeconds by trimming the tail, leaving the rest playable", async () => {
    seed(PROJECT, []);

    await attachMedia(
      {
        timelineId: PROJECT,
        projectId: PROJECT,
        publicId: "media/user-a/project-alpha/render-123",
        durationSeconds: 5,
      },
      OWNER,
    );

    const added = storedClips(PROJECT)[0];
    if (added.kind !== "video") throw new Error("expected a video clip");
    expect(added.duration).toBe(5);
    expect(added.trimIn).toBe(0);
    expect(added.trimOut).toBe(7);
  });

  it("places it after a named sibling rather than always appending", async () => {
    seed(PROJECT, [clip("a"), clip("b")]);

    const result = await attachMedia(
      {
        timelineId: PROJECT,
        projectId: PROJECT,
        publicId: "media/user-a/project-alpha/render-123",
        after: "a",
      },
      OWNER,
    );

    expect(storedClips(PROJECT).map((c) => c.id)).toEqual(["a", attachedNodeId(result), "b"]);
  });

  // Node ids used to be `clip-<publicId>`, which made the id a function of the
  // asset: the same file could exist at exactly one place, and the second
  // attach was refused with "already on this timeline". Nothing about the
  // product wanted that rule — a shot legitimately reuses a plate, and the
  // read projection already has to demote cross-document collisions to `dup:`
  // ids. Provenance is what identifies the asset; the id only has to be unique.
  it("attaches the same asset twice, as two independent clips", async () => {
    seed(PROJECT, []);
    const args = {
      timelineId: PROJECT,
      projectId: PROJECT,
      publicId: "media/user-a/project-alpha/render-123",
    };

    const first = await attachMedia(args, OWNER);
    const second = await attachMedia(args, OWNER);

    expect(first.isError).toBeFalsy();
    expect(second.isError).toBeFalsy();
    expect(storedClips(PROJECT).map((c) => c.id)).toEqual([
      attachedNodeId(first),
      attachedNodeId(second),
    ]);
    // Both carry the same provenance — one file, two placements. That is what
    // keeps reclaim correct: the asset stays referenced until BOTH are gone.
    for (const added of storedClips(PROJECT)) {
      if (added.kind === "collection") throw new Error("expected media clips");
      expect(added.sourceAsset).toEqual({
        providerId: "cloudinary",
        assetId: "media/user-a/project-alpha/render-123",
      });
    }
  });

  // Cloudinary has no audio resource type — it serves audio as "video" — so a
  // clip kind read off `resourceType` would file every voice take as a video
  // with a poster URL that renders broken. The extension is the only honest
  // signal, and this is what unblocks getting DramaBox/H3 takes into the app.
  it("attaches a .flac as an AUDIO clip, not a video, despite Cloudinary's resourceType", async () => {
    seed(PROJECT, []);
    state.assets.length = 0;
    state.assets.push({
      id: "a2",
      pathname: "media/user-a/project-alpha/brian-take-6s",
      url: "https://res.cloudinary.com/demo/video/upload/brian-take-6s.flac",
      thumbnailUrl: "https://res.cloudinary.com/demo/video/upload/brian-take-6s.jpg",
      // Deliberately "video": that is genuinely what Cloudinary reports.
      resourceType: "video",
      duration: 5.875,
      relativePath: "brian-take-6s",
    });

    const result = await attachMedia(
      {
        timelineId: PROJECT,
        projectId: PROJECT,
        publicId: "media/user-a/project-alpha/brian-take-6s",
      },
      OWNER,
    );

    expect(result.isError).toBeFalsy();
    const added = storedClips(PROJECT)[0];
    expect(added.kind).toBe("audio");
    if (added.kind !== "audio") throw new Error("expected an audio clip");
    // Windowed like video: the full source length with no trim taken.
    expect(added.sourceDuration).toBe(5.875);
    expect(added.trimIn).toBe(0);
    expect(added.trimOut).toBe(0);
    expect(added.duration).toBe(5.875);
    // No poster, even though Cloudinary offered a thumbnail URL for it.
    expect(added.poster).toBeUndefined();
    expect(added.sourceAsset).toEqual({
      providerId: "cloudinary",
      assetId: "media/user-a/project-alpha/brian-take-6s",
    });
    // Minted id carries the kind, like the drag-drop path.
    expect(attachedNodeId(result).startsWith("audio-")).toBe(true);
  });

  it("refuses when the upload never landed, instead of minting a dead clip", async () => {
    seed(PROJECT, [clip("a")]);
    state.assets.length = 0;

    const result = await attachMedia(
      { timelineId: PROJECT, projectId: PROJECT, publicId: "media/user-a/project-alpha/missing" },
      OWNER,
    );

    expect(result.isError).toBe(true);
    expect(storedClips(PROJECT).map((c) => c.id)).toEqual(["a"]);
  });
});
