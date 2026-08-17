import { toast } from "@/components/core/sonner";

/**
 * Load an exported project file into the offline store.
 *
 * SHARED, and deliberately not a component. Two places offer this — the
 * project library (where you are when you have no project open, which is the
 * only sensible place to load one) and the board's `⋮` (where you already are
 * when you decide to swap) — and what they share is the sequence, not the
 * markup: one is a menu item, the other a button beside "New Project". Wrapping
 * the DOM to share it would have forced one shape onto both; wrapping the
 * BEHAVIOUR leaves each free to look like where it lives. Each call site keeps
 * its own hidden file input, which is three lines, and neither can drift on what
 * a load actually does.
 *
 * EVERY FAILURE IS REPORTED. That is the whole reason this exists as a function
 * with toasts inside it rather than a promise the callers interpret: the refusals
 * are specific and actionable — offline mode off, a generated fixture as the
 * target, a document that fails the write gate — and a caller that swallowed one
 * would leave the user staring at a board that did not change, with the reason
 * sitting unread in a response body.
 *
 * Returns whether the load was accepted, so a caller can settle its own busy
 * state. On success it NAVIGATES and does not return meaningfully.
 */

/** One id for every message here, so a second attempt REPLACES the first
 *  complaint instead of stacking another copy of it. */
const TOAST_ID = "load-project";

/** Long. The server's refusals carry setup instructions ("point
 *  GSTUDIO_FIXTURE_TIMELINES at a scratch file…") and sonner's default few
 *  seconds is not enough to read one, let alone act on it. */
const ERROR_MS = 14_000;

export async function loadProjectFromFile(file: File): Promise<boolean> {
  let payload: unknown;
  try {
    payload = JSON.parse(await file.text());
  } catch {
    // Answered here rather than by the server: a corrupt file is the one failure
    // the person who picked it can fix, and naming the file is what makes it
    // obvious they picked the wrong one.
    toast.error(`${file.name} is not valid JSON — it may be truncated or not an export.`, {
      id: TOAST_ID,
      duration: ERROR_MS,
    });
    return false;
  }

  let response: Response;
  try {
    response = await fetch("/api/timelines/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
    });
  } catch {
    // A dev server that restarted or died mid-request. Distinguished from a
    // refusal because the action to take is completely different: retry, versus
    // change a setting.
    toast.error("Could not reach the server. Is the dev server still running?", {
      id: TOAST_ID,
      duration: ERROR_MS,
    });
    return false;
  }

  const body = (await response.json().catch(() => ({}))) as {
    error?: string;
    documents?: number;
  };

  if (!response.ok) {
    // The server's own words when it has them — they name the file, the setting,
    // or the document at fault, and none of that is reconstructible here.
    toast.error(body.error ?? `Load failed (${response.status}).`, {
      id: TOAST_ID,
      duration: ERROR_MS,
    });
    return false;
  }

  // NO success toast, because it would not survive the navigation below — and
  // the library rebuilding with the loaded project in it is a better
  // confirmation than a message about it would be.
  //
  // A FULL LOAD of the library, not a router refresh: the offline store picks
  // the new file up by itself, but any board already mounted is holding the
  // previous project in its session cache, and the project that should now be
  // open may not be the one in the address bar.
  window.location.assign("/");
  return true;
}
