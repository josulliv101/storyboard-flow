import { NextResponse } from "next/server";

import { readJsonObject } from "@/lib/read-json-body";
import { claimNextRenderJob } from "@/lib/render/job-store";
import { renderProviders } from "@/lib/render/registry";
import { authenticateWorker } from "@/lib/render/worker-request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A worker asks for work.
 *
 * POLLING, not pushing, because the first provider is a machine behind NAT
 * with no address the app can reach. That shape is not a concession — it is
 * what makes the local renderer and a hosted one the same kind of thing, and a
 * hosted worker is free to poll this too.
 *
 * 204 for "nothing queued" rather than 200 with a null body: the worker loop
 * checks a status code far more often than it gets a job, and an empty answer
 * should not have to be parsed to be understood.
 */
export async function POST(request: Request) {
  const auth = authenticateWorker(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = await readJsonObject(request);
  const providerId =
    typeof body?.providerId === "string"
      ? body.providerId
      : renderProviders.defaultProvider()?.id;
  if (providerId === undefined || renderProviders.get(providerId) === undefined) {
    return NextResponse.json({ error: "Unknown render provider." }, { status: 400 });
  }

  try {
    const job = await claimNextRenderJob(providerId, auth.workerId, new Date().toISOString());
    if (job === null) return new NextResponse(null, { status: 204 });

    // The cut list is the whole payload: resolved source URLs and absolute
    // output positions. The worker needs nothing else and is given nothing
    // else — it never sees the timeline, only the film to assemble.
    return NextResponse.json({
      id: job.id,
      timelineId: job.timelineId,
      projectRevision: job.projectRevision,
      cutList: job.cutList,
    });
  } catch (error) {
    console.error("[GSTUDIO_RENDER_CLAIM_ERROR]", error);
    return NextResponse.json({ error: "Unable to claim a render." }, { status: 500 });
  }
}
