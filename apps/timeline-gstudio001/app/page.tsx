import { getAuthUser } from "@/lib/firebase-auth-session";
import {
  listFirebaseTimelineProjects,
  type TimelineProjectSummary,
} from "@/lib/firebase-timeline-store";

import Home from "./projects-client";

/**
 * The projects list, RENDERED ON THE SERVER (PL15-027).
 *
 * This page was a client component that fetched `/api/timelines` on mount, so
 * the first project's poster — which IS the LCP element on this page — did not
 * exist in the initial HTML at all. Chrome's own check said so: "Request is
 * discoverable in initial document: FAILED", with the image's initiator a JS
 * chunk rather than the document.
 *
 * The cost of that is not the request; it is everything that has to happen
 * BEFORE the request. Measured at 4x CPU on Slow 4G, LCP was 1,671ms and
 * 1,405ms of it was load delay — the browser sitting idle because it did not
 * yet know the image existed. Nothing could start until React had downloaded,
 * parsed, executed, fetched the list and rendered a card.
 *
 * IT ALSO MAKES THE PRIORITY HINT MEAN SOMETHING. `fetchPriority="high"` on
 * the first card was measured as doing NOTHING on its own, which is the honest
 * result rather than a surprising one: a browser cannot prioritise a request it
 * does not know about. The two only work together.
 *
 * SIGNED OUT, OR A FAILED READ, RENDERS EXACTLY AS BEFORE. `initialProjects`
 * is `null` then and the client fetches on mount as it always did — this adds
 * a fast path, it does not move the source of truth. Everything after first
 * paint (refresh, create, delete) still goes through the API.
 */
export default async function Page() {
  let initialProjects: TimelineProjectSummary[] | null = null;

  try {
    const user = await getAuthUser();
    // `getAuthUser` answers null when signed out, which is not an error — it
    // is the case that has no list to render.
    if (user) initialProjects = await listFirebaseTimelineProjects(user.uid);
  } catch {
    // A server-side read failure must not cost the page. Falling through with
    // `null` puts the client back on the path it took before this existed,
    // where the same failure is already reported through `loadError`.
    initialProjects = null;
  }

  return <Home initialProjects={initialProjects} />;
}
