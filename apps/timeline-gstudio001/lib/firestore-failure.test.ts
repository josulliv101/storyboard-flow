import { describe, expect, it } from "vitest";

import {
  FirestoreFailure,
  clientFacingStorageMessage,
  describeFirestoreFailure,
  firestoreTimeoutFailure,
} from "./firestore-failure";

// The real rejection Firestore produced during the outage that prompted this,
// reduced to the fields that matter. `code: 8` is the whole signal.
const quotaError = Object.assign(new Error("8 RESOURCE_EXHAUSTED: Quota exceeded."), {
  code: 8,
  details: "Quota exceeded.",
});

describe("describeFirestoreFailure", () => {
  it("names a QUOTA failure, and does not blame the credentials", () => {
    // The bug this exists for: a spent read quota reported as an auth problem,
    // which sends the reader to re-check a service account that is fine.
    const failure = describeFirestoreFailure(quotaError, "Loading timeline document")!;
    expect(failure.reason).toBe("quota");
    expect(failure.message).toContain("daily read quota");
    expect(failure.message).not.toMatch(/credential/i);
    expect(failure.message).toContain("Loading timeline document");
  });

  it("says the quota resets, because that is the only action there is", () => {
    // No code change shortens it. A message that omitted this reads as a bug
    // to chase rather than a wall to wait out.
    expect(describeFirestoreFailure(quotaError, "x")!.message).toMatch(/resets/i);
  });

  it.each([
    [7, "PERMISSION_DENIED"],
    [16, "UNAUTHENTICATED"],
  ])("names code %i (%s) as a CREDENTIALS failure", (code) => {
    const failure = describeFirestoreFailure(Object.assign(new Error("nope"), { code }), "x")!;
    expect(failure.reason).toBe("credentials");
    expect(failure.message).toMatch(/service account/i);
  });

  it("names UNAVAILABLE as the one case where 'check the network' is honest", () => {
    const failure = describeFirestoreFailure(Object.assign(new Error("down"), { code: 14 }), "x")!;
    expect(failure.reason).toBe("unavailable");
    expect(failure.message).toMatch(/network/i);
  });

  it("keeps the original as `cause`, so the log still shows the gRPC error", () => {
    // The server log is where the numeric code is visible next time. Losing it
    // to a friendlier message would trade tomorrow's diagnosis for today's.
    expect(describeFirestoreFailure(quotaError, "x")!.cause).toBe(quotaError);
  });

  it.each([
    ["an unmapped code", Object.assign(new Error("?"), { code: 3 })],
    ["a plain Error", new Error("boom")],
    ["a string", "boom"],
    ["null", null],
    ["a non-numeric code", Object.assign(new Error("?"), { code: "8" })],
  ])("returns null for %s rather than guessing", (_name, input) => {
    // Null, not a catch-all: the caller's own fallback is more specific than
    // anything this could invent about an error it does not recognise.
    expect(describeFirestoreFailure(input, "x")).toBeNull();
  });

  it("passes an already-named failure straight through", () => {
    // Otherwise the label would appear twice in one sentence.
    const already = new FirestoreFailure("quota", "Loading x failed. Quota.");
    expect(describeFirestoreFailure(already, "Loading x")).toBe(already);
  });
});

describe("firestoreTimeoutFailure", () => {
  it("states the timeout and CONCLUDES NOTHING about why", () => {
    // The whole bug in one assertion. At the moment the timer fires the call
    // is still in flight, so there is nothing to say about the cause — and the
    // old message said "check the credentials and network access" anyway.
    const failure = firestoreTimeoutFailure("Loading timeline document", 8000);
    expect(failure.reason).toBe("timeout");
    expect(failure.message).not.toMatch(/credential/i);
    expect(failure.message).not.toMatch(/network/i);
    expect(failure.message).not.toMatch(/quota/i);
  });

  it("says how long it waited, which is the one fact it has", () => {
    expect(firestoreTimeoutFailure("x", 8000).message).toContain("8s");
  });

  it("points at the server log, where the cause usually IS known", () => {
    // Firestore retries internally, so on a quota wall our timer wins the race
    // and this fires while the real rejection is still in flight. That
    // rejection does land and is logged with its gRPC code — so the honest
    // move is to say where the answer is rather than guess at it.
    expect(firestoreTimeoutFailure("x", 8000).message).toMatch(/server log/i);
  });
});

describe("clientFacingStorageMessage", () => {
  const FALLBACK = "Unable to load the timeline.";

  it("forwards a named failure, which is what puts the real cause on screen", () => {
    const failure = describeFirestoreFailure(quotaError, "Loading timeline document")!;
    expect(clientFacingStorageMessage(failure, FALLBACK)).toBe(failure.message);
  });

  it("forwards the missing-configuration error, whose fix is the operator's", () => {
    const error = new Error("Firebase Storage is not configured for this project.");
    expect(clientFacingStorageMessage(error, FALLBACK)).toBe(error.message);
  });

  it("NO LONGER forwards a stray message just because it says 'timed out'", () => {
    // The old test was `error.message.includes("timed out")`, which forwarded
    // whatever string happened to carry those words — and that is exactly how
    // "Check the Firebase project credentials and network access" reached the
    // browser during a quota outage.
    const stray = new Error("Something unrelated timed out. Check the credentials.");
    expect(clientFacingStorageMessage(stray, FALLBACK)).toBe(FALLBACK);
  });

  it.each([
    ["a raw gRPC error", quotaError],
    ["a plain Error", new Error("boom")],
    ["a string", "boom"],
  ])("falls back for %s rather than leaking it", (_name, input) => {
    // An unclassified error may carry internals; the caller's sentence is both
    // safer and more specific.
    expect(clientFacingStorageMessage(input, FALLBACK)).toBe(FALLBACK);
  });
});
