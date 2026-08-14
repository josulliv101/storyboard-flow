import "server-only";

import { bearerTokenMatches, configuredSecret } from "../bearer-token";

/**
 * Authenticating the RENDER WORKER — a machine, not a person.
 *
 * A dedicated secret rather than a user session, and that is the point of the
 * whole seam: the owner's laptop authenticates exactly the way a hosted
 * renderer would, holding a credential scoped to two endpoints and nothing
 * else. It cannot read a timeline, cannot write one, and cannot act as anyone.
 *
 * Unset means REFUSE. An endpoint that hands out work and accepts results must
 * never default to open, and 503 is the honest status: the deployment is not
 * configured, which is not the caller's fault and not fixable by presenting a
 * better token.
 */
export type WorkerAuth =
  | Readonly<{ ok: true; workerId: string }>
  | Readonly<{ ok: false; status: 401 | 503; error: string }>;

/** Identifies WHICH worker, so a report can be checked against the holder.
 *  Self-asserted — it distinguishes workers, it does not authenticate them;
 *  the shared secret does that. */
const WORKER_ID_HEADER = "x-render-worker-id";

export function authenticateWorker(request: Request): WorkerAuth {
  const secret = configuredSecret(process.env.RENDER_WORKER_SECRET);
  if (secret === null) {
    return { ok: false, status: 503, error: "Rendering is not configured." };
  }
  if (!bearerTokenMatches(request.headers.get("authorization"), secret)) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }
  const workerId = request.headers.get(WORKER_ID_HEADER)?.trim();
  if (!workerId) {
    // Required, because "who holds this job" is what stops a restarted worker
    // reporting over a render its predecessor is still doing.
    return { ok: false, status: 401, error: `Missing ${WORKER_ID_HEADER}.` };
  }
  return { ok: true, workerId };
}
