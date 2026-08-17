import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { TimelineClip } from "@storyboard/timeline-model/types";

// Export/load, over the real route handlers.
//
// Only the process boundaries are faked — the Firestore SDK and the session
// cookie. The offline store is NOT faked: `fixtureStorePath` is pointed at a
// real temp file and the import route really writes it, because the one thing
// this pair has to get right is that the writer and the reader agree on which
// file they mean. A mocked `writeFileSync` would assert that a function was
// called and prove nothing about that.

type Stored = Record<string, unknown>;

const state = vi.hoisted(() => {
  const docs = new Map<string, Stored>();
  const current = {
    user: { uid: "user-a", email: null as string | null, name: null, picture: null },
  };
  const reads: string[] = [];
  const snapshot = (id: string) => {
    const data = docs.get(id);
    return {
      id,
      exists: data !== undefined,
      data: () => (data ? { ...data } : undefined),
      get: (field: string) => (data ? data[field] : undefined),
    };
  };
  const db = {
    collection: () => ({
      doc: (id: string) => ({
        id,
        get: async () => {
          reads.push(id);
          return snapshot(id);
        },
      }),
    }),
  };
  return { docs, current, db, reads };
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/firebase-admin", () => ({ getFirebaseDb: () => state.db }));
vi.mock("firebase-admin/firestore", () => {
  class Timestamp {
    toDate() {
      return new Date(0);
    }
  }
  return {
    Timestamp,
    FieldValue: { serverTimestamp: () => new Timestamp(), delete: () => "__delete__" },
  };
});
vi.mock("@/lib/firebase-auth-session", () => ({
  requireAuthUser: async () => ({ user: state.current.user, response: null }),
}));
vi.mock("@/lib/cloudinary-media-store", () => ({ listCloudinaryAssets: async () => [] }));

import { GET as exportProject } from "./[id]/export/route";
import { POST as importProject } from "./import/route";

const scratch = mkdtempSync(join(tmpdir(), "gstudio-import-"));

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function mediaClip(id: string, index: number): TimelineClip {
  return {
    id,
    index,
    kind: "image",
    src: "data:image/gif;base64,R0lGODlhAQABAAAAACw=",
    poster: "data:image/gif;base64,R0lGODlhAQABAAAAACw=",
    alt: id,
    aspect: 16 / 9,
    trackIndex: 0,
    startTime: 0,
    duration: 4,
    sourceDuration: 4,
    trimIn: 0,
    trimOut: 0,
  } as TimelineClip;
}

function collectionClip(id: string, childTimelineId: string, index: number): TimelineClip {
  return {
    id,
    index,
    kind: "collection",
    childTimelineId,
    title: childTimelineId,
    // REQUIRED by `isTimelineClip` — a collection clip without it fails the
    // import's document guard. Omitting it here 400'd four of these tests and
    // was worth chasing: it is the denormalized summary the export carries
    // through deliberately, so a real exported file has it and a hand-written
    // fixture is the only thing that would not.
    itemCount: 0,
    alt: id,
    aspect: 16 / 9,
    trackIndex: 0,
    startTime: 0,
    duration: 4,
    sourceDuration: 4,
    trimIn: 0,
    trimOut: 0,
  } as TimelineClip;
}

const doExport = async (id: string) => {
  const response = await exportProject(
    new Request(`http://localhost/api/timelines/${id}/export`),
    { params: Promise.resolve({ id }) },
  );
  return response;
};

const doImport = async (body: unknown) => {
  const response = await importProject(
    new Request("http://localhost/api/timelines/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
};

beforeEach(() => {
  state.docs.clear();
  state.reads.length = 0;
  state.current.user = { uid: "user-a", email: null, name: null, picture: null };
  // `unstubEnvs` is NOT on by default, so a stub set in one test survives into
  // every test after it — which is how the production check silently 404'd half
  // this file on the first run.
  vi.unstubAllEnvs();
  vi.stubEnv("GSTUDIO_FIXTURE_TIMELINES", join(scratch, "local.json"));
});

describe("GET /api/timelines/[id]/export", () => {
  beforeEach(() => {
    // Offline mode must be OFF for these: the export goes through the shared
    // read seam, so a configured fixture would intercept before the fake db and
    // the test would assert against a file instead of the store.
    vi.stubEnv("GSTUDIO_FIXTURE_TIMELINES", "");
    state.docs.set("project-a", {
      id: "project-a",
      title: "Toon Town",
      ownerUid: "user-a",
      isProject: true,
      revision: 4,
      clips: [collectionClip("c-1", "t-child", 0)],
    });
    state.docs.set("t-child", {
      id: "t-child",
      title: "Scene 1",
      ownerUid: "user-a",
      revision: 2,
      clips: [mediaClip("m-1", 0), mediaClip("m-2", 1)],
    });
  });

  it("emits the fixture format: projectId, every document, isProject on the root", async () => {
    const response = await doExport("project-a");
    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      projectId: string;
      documents: Record<string, { id: string; title: string; clips: unknown[]; isProject?: boolean }>;
    };

    expect(payload.projectId).toBe("project-a");
    expect(Object.keys(payload.documents).sort()).toEqual(["project-a", "t-child"]);
    // `isProject` lives on the Firestore record rather than the document, so the
    // route has to add it back — without it an imported board opens nothing.
    expect(payload.documents["project-a"]?.isProject).toBe(true);
    expect(payload.documents["t-child"]?.isProject).toBeUndefined();
    expect(payload.documents["t-child"]?.clips).toHaveLength(2);
  });

  it("reads one document per COLLECTION, not per item", async () => {
    await doExport("project-a");
    // Two documents, three clips inside them. The media items are free.
    expect(state.reads).toEqual(["project-a", "t-child"]);
  });

  it("names the file from the project title", async () => {
    const response = await doExport("project-a");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="toon-town.json"',
    );
  });

  it("is a 404 for a root that does not exist", async () => {
    const response = await doExport("project-missing");
    expect(response.status).toBe(404);
  });

  it("is a 404 for someone else's project", async () => {
    state.current.user = { uid: "user-b", email: null, name: null, picture: null };
    const response = await doExport("project-a");
    expect(response.status).toBe(404);
  });

  it("drops a dangling child rather than exporting it as an empty document", async () => {
    state.docs.set("project-a", {
      id: "project-a",
      title: "Toon Town",
      ownerUid: "user-a",
      isProject: true,
      clips: [collectionClip("c-1", "t-child", 0), collectionClip("c-2", "t-gone", 1)],
    });
    const response = await doExport("project-a");
    const payload = (await response.json()) as { documents: Record<string, unknown> };
    // Re-importing a placeholder would MINT `t-gone` as a real empty collection,
    // turning a broken reference into a legitimate-looking one.
    expect(Object.keys(payload.documents).sort()).toEqual(["project-a", "t-child"]);
  });
});

describe("POST /api/timelines/import", () => {
  const validExport = () => ({
    projectId: "project-a",
    documents: {
      "project-a": {
        id: "project-a",
        title: "Toon Town",
        isProject: true,
        clips: [collectionClip("c-1", "t-child", 0)],
      },
      "t-child": { id: "t-child", title: "Scene 1", clips: [mediaClip("m-1", 0)] },
    },
  });

  it("writes the offline fixture file the store reads", async () => {
    const { status, body } = await doImport(validExport());
    expect(status).toBe(200);
    expect(body).toMatchObject({ projectId: "project-a", documents: 2, file: "local.json" });

    // The actual bytes, at the path `fixtureStorePath()` resolves — the one
    // agreement this feature depends on.
    const written = JSON.parse(readFileSync(join(scratch, "local.json"), "utf8")) as {
      projectId: string;
      documents: Record<string, unknown>;
    };
    expect(written.projectId).toBe("project-a");
    expect(Object.keys(written.documents).sort()).toEqual(["project-a", "t-child"]);
  });

  it("refuses in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { status } = await doImport(validExport());
    expect(status).toBe(404);
  });

  it("refuses when offline mode is off, rather than writing somewhere useless", async () => {
    vi.stubEnv("GSTUDIO_FIXTURE_TIMELINES", "");
    const { status, body } = await doImport(validExport());
    expect(status).toBe(409);
    expect(String(body.error)).toContain("GSTUDIO_FIXTURE_TIMELINES");
  });

  it.each(["scale-probe.json", "dev-timelines.json"])(
    "refuses to overwrite the checked-in fixture %s",
    async (name) => {
      vi.stubEnv("GSTUDIO_FIXTURE_TIMELINES", join(scratch, name));
      const { status, body } = await doImport(validExport());
      expect(status).toBe(409);
      expect(String(body.error)).toContain(name);
    },
  );

  it("rejects a payload with no documents", async () => {
    expect((await doImport({ projectId: "x" })).status).toBe(400);
    expect((await doImport({ documents: {} })).status).toBe(400);
    expect((await doImport({ documents: [] })).status).toBe(400);
  });

  it("rejects a document whose own id disagrees with its key", async () => {
    const payload = validExport();
    payload.documents["t-child"].id = "t-somethingelse";
    const { status, body } = await doImport(payload);
    expect(status).toBe(400);
    expect(String(body.error)).toContain("t-child");
  });

  it("rejects a file with no project root — nothing would be openable", async () => {
    const payload = validExport();
    delete (payload.documents["project-a"] as { isProject?: boolean }).isProject;
    const { status, body } = await doImport(payload);
    expect(status).toBe(400);
    expect(String(body.error)).toContain("isProject");
  });

  it("falls back to the marked root when projectId does not name one", async () => {
    const payload = { ...validExport(), projectId: "not-in-this-file" };
    const { status, body } = await doImport(payload);
    expect(status).toBe(200);
    expect(body.projectId).toBe("project-a");
  });
});
