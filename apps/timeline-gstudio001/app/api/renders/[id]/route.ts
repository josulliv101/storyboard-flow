import { NextResponse } from "next/server";

import { requireAuthUser } from "@/lib/firebase-auth-session";
import { readRenderJob } from "@/lib/render/job-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Where a render got to — what the app watches while it waits.
 *
 * Scoped to the requester: a render is addressed by an unguessable id, but
 * "unguessable" is not an access rule, and the job carries the timeline it was
 * compiled from. A plain 404 for someone else's, so ids cannot be probed.
 *
 * The CUT LIST is deliberately not returned. It is large, it is the worker's
 * business, and the app only needs to know where the render is and where the
 * file landed.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, response } = await requireAuthUser();
  if (response || !user) {
    return response || NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  try {
    const job = await readRenderJob(id);
    if (!job || job.requestedBy !== user.uid) {
      return NextResponse.json({ error: "Render was not found." }, { status: 404 });
    }
    return NextResponse.json({
      id: job.id,
      timelineId: job.timelineId,
      projectRevision: job.projectRevision,
      providerId: job.providerId,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      durationSeconds: job.cutList.durationSeconds,
      cutCount: job.cutList.cuts.length,
      ...job.progress,
    });
  } catch (error) {
    console.error("[GSTUDIO_RENDER_READ_ERROR]", error);
    return NextResponse.json({ error: "Unable to read the render." }, { status: 500 });
  }
}
