"use client";

import { notFound, useRouter } from "next/navigation";
import { use, useEffect } from "react";

/**
 * Compatibility shim for bare `/timeline/{projectId}` URLs — bookmarks, and
 * anything that linked a project before the graph view became the product.
 * It redirects into `/timeline/{projectId}/graph`, preserving the rest of the
 * query string.
 *
 * It used to be two pages in one: this redirect for `project-` ids, and a
 * full legacy document view (SmoothScrollList + hierarchy toggle) for every
 * other id. That second half is gone with the legacy routes, and with it the
 * `?view=storyboard|workbench` escape hatch — those targets no longer exist,
 * so honouring the param would redirect into a 404. Every view is the graph
 * view now.
 *
 * A NON-project id 404s rather than redirecting: a child timeline is reached
 * through its project (`/timeline/{projectId}/graph/{childPath}`), and a bare
 * child id carries nothing to resolve the project it belongs to. Nothing
 * links to one — the only source was this page's own breadcrumb.
 */
export default function TimelineDocumentPage({
  params,
  searchParams,
}: Readonly<{
  params: Promise<{ timelineId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>) {
  const router = useRouter();
  const { timelineId } = use(params);
  const resolvedSearchParams = use(searchParams);
  const isProjectTimeline = timelineId.startsWith("project-");

  // `view` is dropped on the way through; every other param rides along.
  const forwarded = new URLSearchParams();
  for (const [key, value] of Object.entries(resolvedSearchParams)) {
    if (key === "view" || value === undefined) continue;
    if (Array.isArray(value)) value.forEach((item) => forwarded.append(key, item));
    else forwarded.set(key, value);
  }
  const search = forwarded.toString();

  useEffect(() => {
    if (!isProjectTimeline) return;
    router.replace(
      `/timeline/${encodeURIComponent(timelineId)}/graph${search ? `?${search}` : ""}`,
    );
  }, [isProjectTimeline, search, router, timelineId]);

  if (!isProjectTimeline) notFound();
  return null;
}
