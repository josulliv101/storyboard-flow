import { NextResponse } from "next/server";

import {
  createCloudinaryUploadTicket,
  forgetCloudinaryAssetList,
  hasCloudinaryConfig,
} from "@/lib/cloudinary-media-store";
import { readRenderJob } from "@/lib/render/job-store";
import { mayReport } from "@/lib/render/job-state";
import { authenticateWorker } from "@/lib/render/worker-request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A short-lived signed ticket for the worker to PUT its finished mp4 straight
 * to Cloudinary.
 *
 * THE BYTES NEVER CROSS THIS SERVER, and that is not an optimisation. Vercel
 * caps a serverless request body at 4.5MB — the upload route's own comment
 * already concedes the platform limit bites before its 200MB ceiling — so a
 * render coming back through the app would fail on every file worth making.
 *
 * The same mechanism `upload_media` already uses for agent uploads, for the
 * same reason, and reusing it means no second copy of the signing code.
 *
 * The server still decides WHERE the file lands: `folder` and `public_id` are
 * derived inside `createCloudinaryUploadTicket` from the job's owner and
 * timeline, never taken from the caller. A worker-chosen path would either
 * break the reclaim sweep or let a render write into another account's prefix.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = authenticateWorker(_request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  if (!hasCloudinaryConfig()) {
    return NextResponse.json({ error: "Uploads are not configured." }, { status: 503 });
  }

  const { id } = await params;
  try {
    const job = await readRenderJob(id);
    if (!job) return NextResponse.json({ error: "Render was not found." }, { status: 404 });

    // Only the worker that HOLDS the job may be handed a place to write. The
    // ticket is a write credential scoped to the owner's prefix, so issuing
    // one to a worker that does not hold this render would let a stale
    // process drop a file into a live project.
    if (!mayReport(job.workerId, auth.workerId)) {
      return NextResponse.json({ error: "not-holder" }, { status: 409 });
    }

    const ticket = createCloudinaryUploadTicket(
      `${job.id}.mp4`,
      job.requestedBy,
      job.timelineId,
    );
    // The direct-upload path never touches `uploadCloudinaryMedia`, which is
    // what normally invalidates the listing cache — without this a
    // just-rendered file is genuinely there and invisible.
    forgetCloudinaryAssetList(job.requestedBy);

    return NextResponse.json(ticket);
  } catch (error) {
    console.error("[GSTUDIO_RENDER_TICKET_ERROR]", error);
    return NextResponse.json({ error: "Unable to issue an upload ticket." }, { status: 500 });
  }
}
