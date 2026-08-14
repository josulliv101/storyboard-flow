import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TimelineClip, TimelineDocument } from "@storyboard/timeline-model/types";
import { at } from "../../../lib/test-support/at";

// Two-user authorization tests over the REAL route handlers and the REAL
// firebase-timeline-store enforcement — only the process boundaries are
// faked: the Firestore SDK (in-memory), the session cookie (switchable
// current user), and the Cloudinary listing (empty). Covers the review's
// P0: list scoping, direct GET, PATCH, DELETE, unowned-document refusal,
// and user-scoped id (trash-<uid>) pre-checks.

type Stored = Record<string, unknown>;

const state = vi.hoisted(() => {
  const docs = new Map<string, Stored>();
  const current = { user: { uid: "user-a", email: null as string | null, name: null, picture: null } };

  // Lets one test drop a COMPETING write in immediately after ours lands —
  // the only way an in-memory double can pose the "someone else wrote between
  // your write and your read-back" question at all. Fires once, then clears.
  const hooks: { afterSet?: () => void } = {};

  const applySet = (id: string, data: Stored, opts?: { merge?: boolean }) => {
    const existing = docs.get(id);
    docs.set(id, opts?.merge && existing ? { ...existing, ...data } : { ...data });
    const hook = hooks.afterSet;
    if (hook) {
      hooks.afterSet = undefined;
      hook();
    }
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
  // Query filters ACCUMULATE, and `limit` applies AFTER all of them — the
  // real Firestore semantics, and the whole point of the regression below:
  // a mock whose limit ran before the filters would pass either way.
  type Filter = { field: string; value: unknown };
  const query = (filters: readonly Filter[], cap: number | null) => {
    const run = () =>
      [...docs.keys()]
        .filter((id) => filters.every((f) => docs.get(id)?.[f.field] === f.value))
        .slice(0, cap ?? Infinity)
        .map(snapshot);
    return {
      where: (field: string, _op: string, value: unknown) =>
        query([...filters, { field, value }], cap),
      limit: (next: number) => query(filters, next),
      get: async () => ({ docs: run() }),
    };
  };
  const db = {
    collection: () => ({
      doc: docRef,
      where: (field: string, _op: string, value: unknown) =>
        query([{ field, value }], null),
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
    // Writes STAGE and apply on commit, like the real thing — a double that
    // applied them eagerly would hide a throw-after-write.
    runTransaction: async <T>(
      fn: (tx: {
        get: (ref: { id: string }) => Promise<ReturnType<typeof snapshot>>;
        set: (ref: { id: string }, data: Stored, opts?: { merge?: boolean }) => void;
      }) => Promise<T>,
    ): Promise<T> => {
      const staged: Array<[string, Stored, { merge?: boolean } | undefined]> = [];
      const result = await fn({
        get: async (ref) => snapshot(ref.id),
        set: (ref, data, opts) => {
          staged.push([ref.id, data, opts]);
        },
      });
      for (const [id, data, opts] of staged) applySet(id, data, opts);
      return result;
    },
  };
  return { docs, current, db, hooks };
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
  state.hooks.afterSet = undefined;
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
    expect(at((state.docs.get("project-a1")?.document as TimelineDocument).clips, 0).id).toBe("new");
    expect(state.docs.get("project-a1")?.ownerUid).toBe("user-a");
  });

  // Both of these used to assert the opposite: a GET or a list CLAIMED an
  // unowned record for whoever arrived first. The legacy records that justified
  // that are migrated, so knowing an id is no longer a claim to it.
  it("reports the revision THIS save produced, not a racing writer's", async () => {
    // `revision` is the compare-and-set token every other writer trusts. The
    // save used to write, then RE-READ, and hand back whatever it found — so a
    // writer landing in that gap had its number reported as the caller's own.
    // The caller then held an expectation matching content it never produced,
    // and its next CAS passed instead of refusing: the stale overwrite the
    // token exists to stop.
    //
    // Reporting our own number instead fails CLOSED — the caller's next CAS is
    // refused and it refetches.
    seedProject("project-a1", "user-a");
    state.hooks.afterSet = () => {
      const stored = state.docs.get("project-a1");
      state.docs.set("project-a1", { ...stored, revision: 99 });
    };

    const response = await patchTimeline(
      patchRequest({ id: "project-a1", title: "Mine", clips: [clip("c1")] }),
      params("project-a1"),
    );

    expect(response.status).toBe(200);
    const { revision } = (await response.json()) as { revision: number };
    expect(revision).toBe(1);
    // The racing writer's value is genuinely in the store — this is not the
    // hook failing to fire.
    expect(state.docs.get("project-a1")?.revision).toBe(99);
  });

  it("serves a demo fixture without claiming its global id", async () => {
    // The fixture ids are short and SHARED (`root`, `promo`, `workbench`…) and
    // `checkUserScopedId` does not recognise them, so persisting one on a READ
    // handed a global name to whoever asked first — and every other user got a
    // permanent 404 on it. A GET must serve the fixture and store nothing.
    const response = await getTimeline(new Request("http://test.local"), params("root"));

    expect(response.status).toBe(200);
    const body = (await response.json()) as { document: TimelineDocument; revision: number };
    expect(body.document.id).toBe("root");
    // revision 0 is the compare-and-set CREATE token, so the client's first
    // real write still brings the document into existence under its own owner.
    expect(body.revision).toBe(0);
    expect(state.docs.has("root")).toBe(false);
  });

  it("GET denies an unowned document and writes nothing", async () => {
    seedProject("project-legacy", undefined);

    const response = await getTimeline(new Request("http://test.local"), params("project-legacy"));

    expect(response.status).toBe(404);
    expect(state.docs.get("project-legacy")?.ownerUid).toBeUndefined();
  });

  it("list returns only the requester's own projects and claims nothing", async () => {
    seedProject("project-a1", "user-a");
    seedProject("project-b1", "user-b");
    seedProject("project-legacy", undefined);

    const response = await listProjects();
    expect(response.status).toBe(200);
    const { projects } = (await response.json()) as { projects: { id: string }[] };
    const ids = projects.map((project) => project.id).sort();

    expect(ids).toEqual(["project-a1"]);
    // Listing is read-only now — no ownership was stamped on the way past.
    expect(state.docs.get("project-legacy")?.ownerUid).toBeUndefined();
    expect(state.docs.get("project-b1")?.ownerUid).toBe("user-b");
  });

  it("finds the requester's project behind a page-full of other users' rows", async () => {
    // The bug this pins: `.limit(...)` used to select from EVERY user's rows
    // before ownership was considered, and with no orderBy Firestore returns
    // them in `__name__` order — which, for `project-${Date.now()}-…` ids, is
    // oldest first. So a user's newly created project fell outside the window
    // the moment the collection held a page of older documents, and their
    // library rendered empty while the project existed.
    //
    // Seeded FIRST so they occupy the whole window under the old query; the
    // mock preserves insertion order, standing in for that id ordering.
    for (let index = 0; index < 250; index += 1) {
      seedProject(`project-old-${String(index).padStart(4, "0")}`, "user-b");
    }
    seedProject("project-newest", "user-a");

    const response = await listProjects();
    expect(response.status).toBe(200);
    const { projects } = (await response.json()) as { projects: { id: string }[] };

    expect(projects.map((project) => project.id)).toEqual(["project-newest"]);
  });

  it("refuses to overwrite or delete an unowned document", async () => {
    seedProject("project-legacy", undefined);

    const patch = await patchTimeline(
      patchRequest({ id: "project-legacy", title: "Taken", clips: [clip("x")] }),
      params("project-legacy"),
    );
    expect(patch.status).toBe(404);

    const removed = await deleteTimeline(new Request("http://test.local"), params("project-legacy"));
    expect(removed.status).toBe(404);
    expect(state.docs.has("project-legacy")).toBe(true);
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
