import "server-only";

import { getFirebaseDb } from "../firebase-admin";
import { applyRenderEvent, mayReport, type RenderEvent } from "./job-state";
import type { RenderCutList, RenderJob, RenderProgress } from "./types";

/**
 * Render jobs — the CONTRACT between the app and whatever renders.
 *
 * Every provider reports through this collection and the app watches only
 * this, which is what makes "the owner's laptop" and "a hosted service"
 * interchangeable. The job document is created queued; a worker claims it,
 * reports against it, and finishes it.
 *
 * DELIBERATELY NOT under the timeline document. A render is about a timeline
 * but is not part of it: it outlives the edit it was compiled from, it is
 * written by a party that must not be able to touch timeline content, and
 * putting it inside would put the worker's credential on the same document as
 * the edit.
 */
const RENDER_COLLECTION = "gstudioRenderJobs";

/**
 * How many queued jobs a claim looks at.
 *
 * Equality-only query plus an in-memory sort, rather than
 * `where(state).where(providerId).orderBy(createdAt)`, which would need a
 * composite index and therefore a deploy before the first render could run
 * (see #367 for how that goes). At this volume — renders are minutes apart,
 * not milliseconds — reading twenty and picking the oldest is indistinguishable
 * and costs no deployment step. Revisit if a queue ever really forms.
 */
const CLAIM_SCAN_LIMIT = 20;

type RenderJobRecord = {
  timelineId?: string;
  projectRevision?: number;
  providerId?: string;
  cutList?: RenderCutList;
  requestedBy?: string;
  createdAt?: string;
  state?: RenderProgress["state"];
  fraction?: number;
  message?: string;
  outputUrl?: string;
  workerId?: string;
  updatedAt?: string;
};

export type StoredRenderJob = RenderJob &
  Readonly<{
    providerId: string;
    progress: RenderProgress;
    workerId: string | null;
    updatedAt: string;
  }>;

function collection() {
  return getFirebaseDb().collection(RENDER_COLLECTION);
}

function toStoredJob(id: string, data: RenderJobRecord): StoredRenderJob | null {
  // A record missing its cut list is unrenderable; treating it as absent beats
  // handing a worker a job it will fail on in a way that looks like ffmpeg's
  // fault.
  if (!data.cutList || !data.timelineId || !data.providerId) return null;
  return {
    id,
    timelineId: data.timelineId,
    projectRevision: data.projectRevision ?? 0,
    cutList: data.cutList,
    requestedBy: data.requestedBy ?? "",
    createdAt: data.createdAt ?? "",
    providerId: data.providerId,
    workerId: data.workerId ?? null,
    updatedAt: data.updatedAt ?? "",
    progress: {
      state: data.state ?? "queued",
      ...(data.fraction === undefined ? {} : { fraction: data.fraction }),
      ...(data.message === undefined ? {} : { message: data.message }),
      ...(data.outputUrl === undefined ? {} : { outputUrl: data.outputUrl }),
    },
  };
}

export async function createRenderJob(
  job: RenderJob,
  providerId: string,
): Promise<StoredRenderJob> {
  const record: RenderJobRecord = {
    timelineId: job.timelineId,
    projectRevision: job.projectRevision,
    providerId,
    cutList: job.cutList,
    requestedBy: job.requestedBy,
    createdAt: job.createdAt,
    state: "queued",
    updatedAt: job.createdAt,
  };
  await collection().doc(job.id).set(record);
  const stored = toStoredJob(job.id, record);
  // Built from a record this function just constructed, so the guard inside
  // toStoredJob cannot fire; throwing beats a non-null assertion.
  if (stored === null) throw new Error("Render job was constructed incomplete.");
  return stored;
}

export async function readRenderJob(id: string): Promise<StoredRenderJob | null> {
  const snapshot = await collection().doc(id).get();
  if (!snapshot.exists) return null;
  return toStoredJob(snapshot.id, (snapshot.data() ?? {}) as RenderJobRecord);
}

/**
 * Take the oldest queued job for a provider, atomically.
 *
 * The transaction is the whole point: two workers polling at once must not
 * both come away holding the same render. The claim is a compare-and-set on
 * `state` — the re-read inside the transaction is what makes the check and the
 * write one step.
 */
export async function claimNextRenderJob(
  providerId: string,
  workerId: string,
  nowIso: string,
): Promise<StoredRenderJob | null> {
  const queued = await collection()
    .where("state", "==", "queued")
    .limit(CLAIM_SCAN_LIMIT)
    .get();

  const candidates = queued.docs
    .map((doc) => toStoredJob(doc.id, (doc.data() ?? {}) as RenderJobRecord))
    .filter((job): job is StoredRenderJob => job !== null && job.providerId === providerId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  for (const candidate of candidates) {
    const claimed = await getFirebaseDb().runTransaction(async (tx) => {
      const ref = collection().doc(candidate.id);
      const snapshot = await tx.get(ref);
      if (!snapshot.exists) return null;
      const current = toStoredJob(snapshot.id, (snapshot.data() ?? {}) as RenderJobRecord);
      if (current === null) return null;
      const transition = applyRenderEvent(
        current.progress,
        { type: "claim", workerId },
        current.workerId,
      );
      // Someone claimed it between the query and the transaction. Not an
      // error — try the next candidate.
      if (!transition.ok) return null;
      tx.set(
        ref,
        { state: transition.next.state, workerId, updatedAt: nowIso },
        { merge: true },
      );
      return { ...current, progress: transition.next, workerId, updatedAt: nowIso };
    });
    if (claimed !== null) return claimed;
  }
  return null;
}

export type ReportResult =
  | Readonly<{
      ok: true;
      job: StoredRenderJob;
      /**
       * Whether this report MOVED the job, as opposed to being an idempotent
       * re-report of a state it was already in.
       *
       * The caller needs the difference for anything with a side effect. A
       * worker whose success landed but whose response timed out will retry,
       * and filing the finished render twice — two cards in the collection for
       * one encode — is exactly the kind of duplicate that looks like a bug in
       * the renderer rather than in the retry.
       */
      changed: boolean;
    }>
  | Readonly<{ ok: false; reason: "not-found" | "not-holder" | "terminal" | "out-of-order" | "invalid" }>;

/**
 * Apply a worker's report, under the state machine.
 *
 * In a transaction because the rules read the CURRENT state — a worker
 * reporting progress while another request finishes the job would otherwise
 * decide against a state that no longer holds.
 */
export async function reportRenderProgress(
  id: string,
  workerId: string,
  event: RenderEvent,
  nowIso: string,
): Promise<ReportResult> {
  return getFirebaseDb().runTransaction<ReportResult>(async (tx) => {
    const ref = collection().doc(id);
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) return { ok: false, reason: "not-found" };
    const current = toStoredJob(snapshot.id, (snapshot.data() ?? {}) as RenderJobRecord);
    if (current === null) return { ok: false, reason: "not-found" };

    // Checked before the transition so an impostor is refused on identity
    // rather than on whatever the state machine happens to say about its
    // event — "you do not hold this" is the honest answer either way.
    if (!mayReport(current.workerId, workerId)) return { ok: false, reason: "not-holder" };

    const transition = applyRenderEvent(current.progress, event, current.workerId);
    if (!transition.ok) return { ok: false, reason: transition.reason };

    const next = transition.next;
    // A no-op transition is the state machine's idempotent branch: the job was
    // already terminal and this report agrees with it. Compared by state
    // rather than by object identity so the answer does not depend on whether
    // the machine happened to return the same reference.
    const changed = next.state !== current.progress.state;
    tx.set(
      ref,
      {
        state: next.state,
        updatedAt: nowIso,
        // Written as explicit undefined-free fields: Firestore rejects
        // undefined, and a merge that omitted them would leave a stale
        // fraction beside a terminal state.
        ...(next.fraction === undefined ? {} : { fraction: next.fraction }),
        ...(next.message === undefined ? {} : { message: next.message }),
        ...(next.outputUrl === undefined ? {} : { outputUrl: next.outputUrl }),
      },
      { merge: true },
    );
    return { ok: true, changed, job: { ...current, progress: next, updatedAt: nowIso } };
  });
}
