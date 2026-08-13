import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TimelineClip, TimelineDocument } from "@storyboard/timeline-model/types";
import { at } from "../../lib/test-support/at";

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
  createCloudinaryUploadTicket: (filename: string) => ({
    uploadUrl: "https://api.cloudinary.com/v1_1/demo/video/upload",
    fields: { api_key: "k", folder: "f", public_id: filename, timestamp: "1", signature: "s" },
    // Keyed on the filename so a batch's tickets are distinguishable — a fixed
    // publicId would let a wrong-order or dropped-file bug pass unnoticed.
    publicId: `f/${filename}`,
    resourceType: "video",
    expiresAt: new Date().toISOString(),
  }),
}));

import { attachMedia, createUploadTickets } from "./upload";

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
    // The attach reported this id, so the clip must be there; saying so names
    // the failure instead of every later assertion reading undefined.
    if (added === undefined) throw new Error("the attached clip is not in the document");
    expect(added).toBeDefined();
    // TimelineClip is a union; provenance only exists on media clips.
    if (!added || added.kind === "collection") throw new Error("expected a media clip");
    expect(added.sourceAsset).toEqual({
      providerId: "cloudinary",
      assetId: "media/user-a/project-alpha/render-123",
    });
  });

  // Tagging at mint time is the only chance to do it automatically: a clip
  // that lands untagged stays untagged until someone opens it by hand. This
  // goes through the real store transaction, so it proves the tags survive the
  // detail side-table and the projection back to stored clips — not just that
  // the argument was accepted.
  it("files agent-uploaded media under the tags it was given", async () => {
    seed(PROJECT, []);

    await attachMedia(
      {
        timelineId: PROJECT,
        projectId: PROJECT,
        publicId: "media/user-a/project-alpha/render-123",
        tags: ["  SCAIL-2 ", "scail-2", "", "S02", "keeper"],
      },
      OWNER,
    );

    const added = at(storedClips(PROJECT), 0);
    // Cleaned on the way in: trimmed, de-duplicated case-insensitively with
    // the first spelling kept, blanks dropped.
    expect(added.tags).toEqual(["SCAIL-2", "S02", "keeper"]);
  });

  it("leaves an untagged upload with no tags field", async () => {
    seed(PROJECT, []);

    await attachMedia(
      { timelineId: PROJECT, projectId: PROJECT, publicId: "media/user-a/project-alpha/render-123" },
      OWNER,
    );

    expect("tags" in at(storedClips(PROJECT), 0)).toBe(false);
  });

  it("carries the real source duration and url from the upload", async () => {
    seed(PROJECT, []);

    await attachMedia(
      { timelineId: PROJECT, projectId: PROJECT, publicId: "media/user-a/project-alpha/render-123" },
      OWNER,
    );

    const added = at(storedClips(PROJECT), 0);
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

    const added = at(storedClips(PROJECT), 0);
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

    const added = at(storedClips(PROJECT), 0);
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
    const added = at(storedClips(PROJECT), 0);
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

  // Cards render `title` and never `alt`, so a caller-supplied name that only
  // reached `alt` was stored and then displayed nowhere. Audio is where this
  // bites hardest: no thumbnail, so the title is the only way to tell two takes
  // apart on the board.
  it("records an explicit name as an authored title, not just alt", async () => {
    seed(PROJECT, []);

    const result = await attachMedia(
      {
        timelineId: PROJECT,
        projectId: PROJECT,
        publicId: "media/user-a/project-alpha/render-123",
        name: 'Brian VO — "You worry about the door"',
      },
      OWNER,
    );

    expect(result.isError).toBeFalsy();
    const added = at(storedClips(PROJECT), 0);
    expect(added.title).toBe('Brian VO — "You worry about the door"');
    expect(added.alt).toBe('Brian VO — "You worry about the door"');
  });

  // The complement: an UNNAMED clip must stay untitled. "Only authored titles
  // are shown" is what keeps a library of machine-named clips from reading as
  // a rename backlog — defaulting a title from the filename would break it.
  it("leaves title absent when no name was given", async () => {
    seed(PROJECT, []);

    await attachMedia(
      { timelineId: PROJECT, projectId: PROJECT, publicId: "media/user-a/project-alpha/render-123" },
      OWNER,
    );

    expect(at(storedClips(PROJECT), 0).title).toBeUndefined();
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

// #307. Filing 24 images took 48 sequential calls — a ticket and an attach per
// image — so the timeline document was rewritten 24 times (24 chances to lose a
// revision race) and the project's assets were re-listed 24 times to verify
// them. Both halves of the pair take a list now.
describe("batching (#307)", () => {
  /** Three uploads sitting in the project, ready to attach. */
  function seedThreeAssets() {
    state.assets.length = 0;
    for (const name of ["shot-a", "shot-b", "shot-c"]) {
      state.assets.push({
        id: name,
        pathname: `media/user-a/project-alpha/${name}`,
        url: `https://res.cloudinary.com/demo/image/upload/${name}.jpg`,
        thumbnailUrl: `https://res.cloudinary.com/demo/image/upload/${name}.jpg`,
        resourceType: "image",
        relativePath: name,
      });
    }
  }

  it("mints one ticket per filename, in order", async () => {
    seed(PROJECT, []);
    const tickets = await createUploadTickets(
      { projectId: PROJECT, filenames: ["a.jpg", "b.jpg", "c.jpg"] },
      OWNER,
    );

    expect(tickets.map((ticket) => ticket.publicId)).toEqual(["f/a.jpg", "f/b.jpg", "f/c.jpg"]);
  });

  it("names EVERY unsupported file, not just the first", async () => {
    seed(PROJECT, []);
    // One bad name per round trip is the cost this change exists to remove.
    await expect(
      createUploadTickets({ projectId: PROJECT, filenames: ["a.jpg", "b.txt", "c.exe"] }, OWNER),
    ).rejects.toThrow(/"b\.txt", "c\.exe"/);
  });

  it("lands a batch in ONE write, in the order given", async () => {
    seed(PROJECT, [clip("existing")]);
    seedThreeAssets();

    const result = await attachMedia(
      {
        timelineId: PROJECT,
        projectId: PROJECT,
        items: [
          { publicId: "media/user-a/project-alpha/shot-a" },
          { publicId: "media/user-a/project-alpha/shot-b" },
          { publicId: "media/user-a/project-alpha/shot-c" },
        ],
        position: "end",
      },
      OWNER,
    );

    expect(result.isError).toBeFalsy();
    const stored = storedClips(PROJECT);
    expect(stored).toHaveLength(4);
    // Order preserved: `add-nodes` inserts the array at one index, so the batch
    // must not arrive reversed or scattered.
    expect(stored.slice(1).map((entry) => entry.alt)).toEqual(["shot-a", "shot-b", "shot-c"]);
    // ONE write. The revision moved by exactly one, which is the whole point —
    // three attaches would have bumped it three times.
    expect((state.docs.get(PROJECT) as { revision: number }).revision).toBe(2);
  });

  it("reports every attached clip, and keeps the single-file shape intact", async () => {
    seed(PROJECT, []);
    seedThreeAssets();

    const batch = await attachMedia(
      {
        timelineId: PROJECT,
        projectId: PROJECT,
        items: [
          { publicId: "media/user-a/project-alpha/shot-a" },
          { publicId: "media/user-a/project-alpha/shot-b" },
        ],
      },
      OWNER,
    );
    const batchContent = (batch.structuredContent ?? {}) as {
      attached?: { nodeId: string; toIndex: number }[];
      nodeId?: string;
    };
    expect(batchContent.attached).toHaveLength(2);
    expect(batchContent.attached!.map((entry) => entry.toIndex)).toEqual([0, 1]);

    // A single attach answers exactly as it always did — no `attached`, the
    // clip's own fields at the top level — so existing callers are untouched.
    const single = await attachMedia(
      { timelineId: PROJECT, projectId: PROJECT, publicId: "media/user-a/project-alpha/shot-c" },
      OWNER,
    );
    const singleContent = (single.structuredContent ?? {}) as { attached?: unknown; nodeId?: string };
    expect(singleContent.attached).toBeUndefined();
    expect(typeof singleContent.nodeId).toBe("string");
  });

  it("carries per-item name and duration rather than one setting for all", async () => {
    seed(PROJECT, []);
    seedThreeAssets();

    await attachMedia(
      {
        timelineId: PROJECT,
        projectId: PROJECT,
        items: [
          { publicId: "media/user-a/project-alpha/shot-a", name: "Opening", durationSeconds: 2 },
          { publicId: "media/user-a/project-alpha/shot-b", name: "Closing", durationSeconds: 7 },
        ],
      },
      OWNER,
    );

    const stored = storedClips(PROJECT);
    expect(stored.map((entry) => entry.title)).toEqual(["Opening", "Closing"]);
    expect(stored.map((entry) => entry.duration)).toEqual([2, 7]);
  });

  it("refuses the WHOLE batch, naming every missing upload", async () => {
    seed(PROJECT, [clip("existing")]);
    seedThreeAssets();

    const result = await attachMedia(
      {
        timelineId: PROJECT,
        projectId: PROJECT,
        items: [
          { publicId: "media/user-a/project-alpha/shot-a" },
          { publicId: "never-uploaded" },
          { publicId: "also-missing" },
        ],
      },
      OWNER,
    );

    expect(result.isError).toBe(true);
    const text = result.content.map((part) => ("text" in part ? part.text : "")).join(" ");
    expect(text).toContain("never-uploaded");
    expect(text).toContain("also-missing");
    // Nothing partially landed: one bad id must not leave the others attached.
    expect(storedClips(PROJECT)).toHaveLength(1);
  });
});
