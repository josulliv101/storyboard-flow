// WHY A FIRESTORE CALL FAILED, said out loud.
//
// This exists because of a night spent looking in the wrong place. Every stall
// used to surface as "Check the Firebase project credentials and network
// access" — a guess, made by a timeout that cannot see a cause, and forwarded
// to the browser verbatim. The actual fault was the daily read quota, which is
// neither the credentials nor the network, and the message sent its reader off
// to re-check both.
//
// Firestore already says which it is. A gRPC rejection carries a numeric
// `code`, and the ones that matter here are distinguishable without guessing.
// The only genuinely unknowable case is our own timeout winning the race, and
// that one now says exactly that and nothing more.

/** What went wrong, in terms someone can act on. */
export type FirestoreFailureReason =
  /** The project's read/write quota is spent. Resets on Google's daily clock;
   *  no code change brings it back sooner. */
  | "quota"
  /** The service account is wrong, expired, or lacks access to the collection. */
  | "credentials"
  /** Firestore itself is unreachable or refusing — a real outage or a network
   *  fault, and the only reason where "check the network" is honest advice. */
  | "unavailable"
  /** OUR timer won the race. Says nothing about the cause, because at the
   *  moment it fires there is nothing to say: the call is still in flight. */
  | "timeout";

/**
 * A failure that has been identified, so a route can forward its message to
 * the client without sniffing strings for "timed out".
 *
 * The original is kept as `cause` — the server log should still show the gRPC
 * error with its stack, which is what makes the code visible next time.
 */
export class FirestoreFailure extends Error {
  readonly reason: FirestoreFailureReason;

  constructor(
    reason: FirestoreFailureReason,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "FirestoreFailure";
    this.reason = reason;
  }
}

/**
 * gRPC status codes, by the names they are usually discussed under. Only the
 * ones this maps are listed; anything else is deliberately not guessed at.
 */
const GRPC_PERMISSION_DENIED = 7;
const GRPC_RESOURCE_EXHAUSTED = 8;
const GRPC_UNAVAILABLE = 14;
const GRPC_UNAUTHENTICATED = 16;

const MESSAGE: Record<FirestoreFailureReason, string> = {
  quota:
    "The database's daily read quota is used up. It resets automatically; nothing here is broken.",
  credentials:
    "The database rejected this app's credentials. Check the Firebase service account.",
  unavailable: "The database is unreachable. Check network access to Firebase.",
  // No advice: a timeout is the one case with nothing to conclude.
  timeout: "The database did not answer in time.",
};

function codeOf(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const { code } = error as { code?: unknown };
  return typeof code === "number" ? code : undefined;
}

/**
 * Name the failure, or return null when it is not one this understands.
 *
 * Null rather than a catch-all "something went wrong": a caller that gets null
 * should keep its own fallback message, which is more specific than anything
 * this could invent about an error it does not recognise.
 */
export function describeFirestoreFailure(
  error: unknown,
  label: string,
): FirestoreFailure | null {
  // Already named — re-describing would restate the label twice.
  if (error instanceof FirestoreFailure) return error;

  const code = codeOf(error);
  const reason: FirestoreFailureReason | undefined =
    code === GRPC_RESOURCE_EXHAUSTED
      ? "quota"
      : code === GRPC_PERMISSION_DENIED || code === GRPC_UNAUTHENTICATED
        ? "credentials"
        : code === GRPC_UNAVAILABLE
          ? "unavailable"
          : undefined;

  if (reason === undefined) return null;
  return new FirestoreFailure(reason, `${label} failed. ${MESSAGE[reason]}`, {
    cause: error,
  });
}

/**
 * The timeout's own failure. Separate from the classifier because there is no
 * error to classify — the operation has not rejected, it simply has not
 * answered.
 *
 * THE CAUSE IS OFTEN KNOWABLE, JUST NOT HERE. Firestore retries internally
 * before it gives up, so on a quota wall our 8s timer usually wins the race
 * and this fires while the real rejection is still on its way. That rejection
 * does land, and the server log records it with its gRPC code — so rather than
 * guess (which is the bug this file exists for) the message says where the
 * answer actually is. The person reading this app's browser is also the person
 * who can read its log.
 */
export function firestoreTimeoutFailure(
  label: string,
  afterMs: number,
): FirestoreFailure {
  return new FirestoreFailure(
    "timeout",
    `${label} failed. ${MESSAGE.timeout} (no response after ${Math.round(afterMs / 1000)}s.) ` +
      `The server log records the reason.`,
  );
}

/**
 * The message a ROUTE may hand to the browser.
 *
 * Two things are safe to forward, and everything else falls back to the
 * caller's own sentence:
 *
 *   - a named `FirestoreFailure`, which is written for a reader and says
 *     nothing about internals;
 *   - the missing-configuration error, which is the one case where the fix is
 *     entirely in the operator's hands.
 *
 * It replaces four copies of `error.message.includes("timed out")` in the
 * routes. That test forwarded whatever string happened to contain those two
 * words — which is exactly how "Check the Firebase project credentials and
 * network access" reached the browser during a quota outage, and it would
 * forward the next such guess just as faithfully.
 */
export function clientFacingStorageMessage(error: unknown, fallback: string): string {
  if (error instanceof FirestoreFailure) return error.message;
  if (
    error instanceof Error &&
    error.message.startsWith("Firebase Storage is not configured")
  ) {
    return error.message;
  }
  return fallback;
}
