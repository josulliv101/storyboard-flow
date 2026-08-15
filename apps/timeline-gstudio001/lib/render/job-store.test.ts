import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RenderCutList, RenderJob } from "./types";

// Store tests over the REAL transaction logic — only the Firestore SDK is
// faked, with an all-or-nothing runTransaction, the same shape
// app/api/timelines/timelines-batch.test.ts uses.

type Stored = Record<string, unknown>;

const state = vi.hoisted(() => {
  const docs = new Map<string, Stored>();
  const applySet = (id: string, data: Stored, opts?: { merge?: boolean }) => {
    const existing = docs.get(id);
    docs.set(id, opts?.merge && existing ? { ...existing, ...data } : { ...data });
  };
  const snapshot = (id: string) => {
    const data = docs.get(id);
    return { id, exists: data !== undefined, data: () => (data ? { ...data } : undefined) };
  };
  const docRef = (id: string) => ({
    id,
    get: async () => snapshot(id),
    set: async (data: Stored, opts?: { merge?: boolean }) => applySet(id, data, opts),
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
    runTransaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
      const staged: (() => void)[] = [];
      const tx = {
        get: async (ref: { id: string }) => snapshot(ref.id),
        set: (ref: { id: string }, data: Stored, opts?: { merge?: boolean }) => {
          staged.push(() => applySet(ref.id, data, opts));
        },
      };
      const result = await fn(tx);
      for (const op of staged) op();
      return result;
    },
  };
  return { docs, db };
});

vi.mock("server-only", () => ({}));
vi.mock("../firebase-admin", () => ({ getFirebaseDb: () => state.db }));

import { claimNextRenderJob, createRenderJob, readRenderJob, reportRenderProgress } from "./job-store";

const CUT_LIST: RenderCutList = {
  cuts: [
    {
      src: "https://cdn.test/a.mp4",
      kind: "video",
      sourceStart: 0,
      outputDuration: 4,
      playbackRate: 1,
      outputStart: 0,
    },
  ],
  layers: [],
  durationSeconds: 4,
  format: { width: 1152, height: 480, fps: 24 },
};

const job = (id: string): RenderJob => ({
  id,
  timelineId: "project-1",
  projectRevision: 3,
  cutList: CUT_LIST,
  requestedBy: "user-a",
  createdAt: "2026-08-14T00:00:00.000Z",
});

const NOW = "2026-08-14T00:01:00.000Z";

beforeEach(() => {
  state.docs.clear();
});

describe("createRenderJob / readRenderJob", () => {
  it("stores a job queued and reads it back whole", async () => {
    await createRenderJob(job("render-1"), "local");
    const stored = await readRenderJob("render-1");
    expect(stored).toMatchObject({
      id: "render-1",
      providerId: "local",
      workerId: null,
      progress: { state: "queued" },
      cutList: CUT_LIST,
    });
  });

  it("is null for a job that does not exist", async () => {
    expect(await readRenderJob("nope")).toBeNull();
  });
});

describe("claimNextRenderJob", () => {
  it("claims the OLDEST queued job for the provider", async () => {
    await createRenderJob({ ...job("render-new"), createdAt: "2026-08-14T02:00:00Z" }, "local");
    await createRenderJob({ ...job("render-old"), createdAt: "2026-08-14T01:00:00Z" }, "local");

    const claimed = await claimNextRenderJob("local", "worker-1", NOW);
    expect(claimed?.id).toBe("render-old");
    expect(claimed?.progress.state).toBe("claimed");
    expect(claimed?.workerId).toBe("worker-1");
  });

  it("does not take another provider's work", async () => {
    await createRenderJob(job("render-1"), "hosted");
    expect(await claimNextRenderJob("local", "worker-1", NOW)).toBeNull();
  });

  it("is null when nothing is queued", async () => {
    expect(await claimNextRenderJob("local", "worker-1", NOW)).toBeNull();
  });

  it("NEVER hands one job to two workers", async () => {
    await createRenderJob(job("render-1"), "local");
    expect((await claimNextRenderJob("local", "worker-1", NOW))?.id).toBe("render-1");
    // The second worker gets nothing rather than the same render.
    expect(await claimNextRenderJob("local", "worker-2", NOW)).toBeNull();
  });
});

describe("reportRenderProgress", () => {
  async function claimed(id = "render-1") {
    await createRenderJob(job(id), "local");
    await claimNextRenderJob("local", "worker-1", NOW);
    return id;
  }

  it("refuses a report from a worker that does not hold the job", async () => {
    const id = await claimed();
    const result = await reportRenderProgress(id, "worker-2", { type: "start" }, NOW);
    expect(result).toEqual({ ok: false, reason: "not-holder" });
  });

  it("refuses a report against a job that does not exist", async () => {
    expect(
      await reportRenderProgress("nope", "worker-1", { type: "start" }, NOW),
    ).toEqual({ ok: false, reason: "not-found" });
  });

  it("advances the job and persists the fraction", async () => {
    const id = await claimed();
    await reportRenderProgress(id, "worker-1", { type: "start" }, NOW);
    const result = await reportRenderProgress(
      id,
      "worker-1",
      { type: "progress", fraction: 0.5, message: "cut 2 of 4" },
      NOW,
    );
    expect(result).toMatchObject({ ok: true, changed: false });
    expect((await readRenderJob(id))?.progress).toEqual({
      state: "rendering",
      fraction: 0.5,
      message: "cut 2 of 4",
    });
  });

  it("reports CHANGED when the state actually moves", async () => {
    const id = await claimed();
    const result = await reportRenderProgress(id, "worker-1", { type: "start" }, NOW);
    expect(result).toMatchObject({ ok: true, changed: true });
  });

  it("stores the output URL on success", async () => {
    const id = await claimed();
    await reportRenderProgress(
      id,
      "worker-1",
      { type: "succeed", outputUrl: "https://cdn.test/out.mp4" },
      NOW,
    );
    expect((await readRenderJob(id))?.progress).toMatchObject({
      state: "succeeded",
      outputUrl: "https://cdn.test/out.mp4",
    });
  });

  it("A RETRIED SUCCESS IS NOT A SECOND ONE — changed is false", async () => {
    // This is what stops a finished render being filed twice. A worker whose
    // report landed but whose response timed out will retry, and two cards in
    // the Renders collection for one encode reads as a bug in the renderer.
    const id = await claimed();
    const first = await reportRenderProgress(
      id,
      "worker-1",
      { type: "succeed", outputUrl: "https://cdn.test/out.mp4" },
      NOW,
    );
    const retry = await reportRenderProgress(
      id,
      "worker-1",
      { type: "succeed", outputUrl: "https://cdn.test/out.mp4" },
      NOW,
    );
    expect(first).toMatchObject({ ok: true, changed: true });
    expect(retry).toMatchObject({ ok: true, changed: false });
    // And the stored URL is still the first one.
    expect((await readRenderJob(id))?.progress.outputUrl).toBe("https://cdn.test/out.mp4");
  });

  it("refuses to reopen a finished job", async () => {
    const id = await claimed();
    await reportRenderProgress(id, "worker-1", { type: "succeed", outputUrl: "u" }, NOW);
    expect(
      await reportRenderProgress(id, "worker-1", { type: "progress", fraction: 0.1 }, NOW),
    ).toEqual({ ok: false, reason: "terminal" });
  });

  it("records a failure with its message", async () => {
    const id = await claimed();
    await reportRenderProgress(id, "worker-1", { type: "fail", message: "ffmpeg exited 1" }, NOW);
    expect((await readRenderJob(id))?.progress).toMatchObject({
      state: "failed",
      message: "ffmpeg exited 1",
    });
  });
});
