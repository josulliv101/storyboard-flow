import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TimelineClip, TimelineDocument } from "@storyboard/timeline-model/types";

// Two-user authorization tests over the REAL route handlers and the REAL
// firebase-timeline-store enforcement — only the process boundaries are
// faked: the Firestore SDK (in-memory), the session cookie (switchable
// current user), and the Cloudinary listing (empty). Covers the review's
// P0: list scoping, direct GET, PATCH, DELETE, legacy-document claiming,
// and user-scoped id (trash-<uid>) pre-checks.

type Stored = Record<string, unknown>;

const state = vi.hoisted(() => {
  const docs = new Map<string, Stored>();
  const current = { user: { uid: "user-a", email: null as string | null, name: null, picture: null } };

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
  const db = {
    collection: () => ({
      doc: docRef,
      where: (field: string, _op: string, value: unknown) => ({
        limit: () => ({
          get: async () => ({
            docs: [...docs.keys()].filter((id) => docs.get(id)?.[field] === value).map(snapshot),
          }),
        }),
      }),
    }),
    batch: () => {
      const ops: (() => void)[] = [];
      return {
        set: (ref: { id: string }, data: Stored, opts?: { merge?: boolean }) => {
          ops.push(() => applySet(ref.id, data, opts));
        },
        commit: async () => {
          for (const op of ops) op();
        },
      };
    },
  };
  return { docs, current, db };
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/firebase-admin", () => ({
  getFirebaseDb: () => state.db,
}));
vi.mock("firebase-admin/firestore", () => {
  class Timestamp {
    toDate() {
      return new Date(0);
    }
  }
  return { Timestamp, FieldValue: { serverTimestamp: () => new Timestamp() } };
});
vi.mock("@/lib/firebase-auth-session", () => ({
  requireAuthUser: async () => ({ user: state.current.user, response: null }),
}));
vi.mock("@/lib/cloudinary-media-store", () => ({
  listCloudinaryAssets: async () => [],
}));

import { GET as listProjects, POST as createProject } from "./route";
import { DELETE as deleteTimeline, GET as getTimeline, PATCH as patchTimeline } from "./[id]/route";

const asUser = (uid: string) => {
  state.current.user = { uid, email: null, name: null, picture: null };
};

const params = (id: string) => ({ params: Promise.resolve({ id }) });

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

function seedProject(id: string, ownerUid: string | undefined) {
  const document: TimelineDocument = { id, title: `Project ${id}`, clips: [clip(`${id}-c0`)] };
  state.docs.set(id, {
    id,
    title: document.title,
    document,
    clips: document.clips,
    isProject: true,
    ...(ownerUid === undefined ? {} : { ownerUid }),
  });
}

function patchRequest(document: TimelineDocument) {
  return new Request("http://test.local/api/timelines/x", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ document }),
  });
}

beforeEach(() => {
  state.docs.clear();
  asUser("user-a");
});

describe("timeline authorization", () => {
  it("stamps ownerUid on newly created projects", async () => {
    const response = await createProject(
      new Request("http://test.local/api/timelines", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Mine" }),
      }),
    );
    expect(response.status).toBe(201);
    const { project } = (await response.json()) as { project: TimelineDocument };
    expect(state.docs.get(project.id)?.ownerUid).toBe("user-a");
  });

  it("GET returns 404 for another user's document", async () => {
    seedProject("project-a1", "user-a");
    asUser("user-b");

    const response = await getTimeline(new Request("http://test.local"), params("project-a1"));
    expect(response.status).toBe(404);
  });

  it("PATCH refuses another user's document and leaves it untouched", async () => {
    seedProject("project-a1", "user-a");
    const before = state.docs.get("project-a1");
    asUser("user-b");

    const evil: TimelineDocument = { id: "project-a1", title: "Taken over", clips: [clip("x")] };
    const response = await patchTimeline(patchRequest(evil), params("project-a1"));

    expect(response.status).toBe(404);
    expect(state.docs.get("project-a1")).toEqual(before);
  });

  it("DELETE refuses another user's document and leaves it in place", async () => {
    seedProject("project-a1", "user-a");
    asUser("user-b");

    const response = await deleteTimeline(new Request("http://test.local"), params("project-a1"));

    expect(response.status).toBe(404);
    expect(state.docs.has("project-a1")).toBe(true);
  });

  it("owner reads and updates their own document", async () => {
    seedProject("project-a1", "user-a");

    const getResponse = await getTimeline(new Request("http://test.local"), params("project-a1"));
    expect(getResponse.status).toBe(200);

    const updated: TimelineDocument = {
      id: "project-a1",
      title: "Project project-a1",
      clips: [clip("new")],
    };
    const patchResponse = await patchTimeline(patchRequest(updated), params("project-a1"));
    expect(patchResponse.status).toBe(200);
    expect((state.docs.get("project-a1")?.document as TimelineDocument).clips[0].id).toBe("new");
    expect(state.docs.get("project-a1")?.ownerUid).toBe("user-a");
  });

  it("first authenticated GET claims a legacy unowned document; others are then denied", async () => {
    seedProject("project-legacy", undefined);

    const response = await getTimeline(new Request("http://test.local"), params("project-legacy"));
    expect(response.status).toBe(200);
    expect(state.docs.get("project-legacy")?.ownerUid).toBe("user-a");

    asUser("user-b");
    const denied = await getTimeline(new Request("http://test.local"), params("project-legacy"));
    expect(denied.status).toBe(404);
  });

  it("list returns own and claims legacy projects, never another user's", async () => {
    seedProject("project-a1", "user-a");
    seedProject("project-b1", "user-b");
    seedProject("project-legacy", undefined);

    const response = await listProjects();
    expect(response.status).toBe(200);
    const { projects } = (await response.json()) as { projects: { id: string }[] };
    const ids = projects.map((project) => project.id).sort();

    expect(ids).toEqual(["project-a1", "project-legacy"]);
    expect(state.docs.get("project-legacy")?.ownerUid).toBe("user-a");
    expect(state.docs.get("project-b1")?.ownerUid).toBe("user-b");
  });

  it("rejects another user's trash id before any storage access", async () => {
    asUser("user-b");
    const response = await getTimeline(new Request("http://test.local"), params("trash-user-a"));
    expect(response.status).toBe(404);
    expect(state.docs.size).toBe(0); // no read, no claim, nothing written

    const patch = await patchTimeline(
      patchRequest({ id: "trash-user-a", title: "Trash Bin", clips: [clip("x")] }),
      params("trash-user-a"),
    );
    expect(patch.status).toBe(404);
    expect(state.docs.size).toBe(0);
  });

  it("serves the requester's own (possibly empty) trash", async () => {
    const response = await getTimeline(new Request("http://test.local"), params("trash-user-a"));
    expect(response.status).toBe(200);
    const { document } = (await response.json()) as { document: TimelineDocument };
    expect(document.id).toBe("trash-user-a");
  });
});
