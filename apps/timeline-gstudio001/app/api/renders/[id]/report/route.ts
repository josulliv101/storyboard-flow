import { NextResponse } from "next/server";

import { readJsonObject } from "@/lib/read-json-body";
import { reportRenderProgress } from "@/lib/render/job-store";
import { attachRenderOutput } from "@/lib/render/attach-output";
import { authenticateWorker } from "@/lib/render/worker-request";
import type { RenderEvent } from "@/lib/render/job-state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Parse the worker's report into an event, or null if it is not one.
 *  Validated HERE rather than trusted: this is a machine endpoint, and the
 *  state machine's rules are only as good as what reaches them. */
function parseEvent(body: Record<string, unknown> | null): RenderEvent | null {
  const type = typeof body?.type === "string" ? body.type : "";
  switch (type) {
    case "start":
      return { type: "start" };
    case "progress": {
      const fraction = typeof body?.fraction === "number" ? body.fraction : Number.NaN;
      const message = typeof body?.message === "string" ? body.message : undefined;
      return { type: "progress", fraction, ...(message === undefined ? {} : { message }) };
    }
    case "succeed": {
      const outputUrl = typeof body?.outputUrl === "string" ? body.outputUrl : "";
      // A success with no file is not a success — refuse it as malformed
      // rather than storing a succeeded job nobody can open.
      return outputUrl.length === 0 ? null : { type: "succeed", outputUrl };
    }
    case "fail": {
      const message = typeof body?.message === "string" ? body.message : "";
      return { type: "fail", message: message.slice(0, 500) || "The render failed." };
    }
    default:
      return null;
  }
}

const STATUS_BY_REASON: Readonly<Record<string, number>> = {
  "not-found": 404,
  // Someone else holds this job. 409 rather than 403: the credential was
  // fine, the claim is what is wrong.
  "not-holder": 409,
  terminal: 409,
  "out-of-order": 409,
  invalid: 400,
};

/**
 * A worker reports on the job it holds.
 *
 * Every rule that decides whether a report is legal lives in
 * `lib/render/job-state` and is unit-tested there — this route validates the
 * shape and hands over. The rules matter because the worker is a separate
 * process: it can crash and come back, retry a report whose response timed
 * out, or be a stale instance reporting over a render it no longer owns.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = authenticateWorker(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await params;
  const event = parseEvent(await readJsonObject(request));
  if (event === null) {
    return NextResponse.json({ error: "Unrecognised render report." }, { status: 400 });
  }

  try {
    const result = await reportRenderProgress(
      id,
      auth.workerId,
      event,
      new Date().toISOString(),
    );
    if (!result.ok) {
      return NextResponse.json(
        { error: result.reason },
        { status: STATUS_BY_REASON[result.reason] ?? 409 },
      );
    }

    // FILE THE RESULT, after the job is already marked succeeded.
    //
    // The order is the whole point: a failure here loses the FILING, never the
    // render. The output URL is on the job either way, so a project that was
    // renamed or restructured mid-encode costs a card in a collection rather
    // than a finished file. Attaching first — or letting this fail the report
    // — would turn a completed render into a lost one.
    //
    // Idempotency comes from the state machine above: a retried `succeed` on
    // an already-succeeded job returns early as a no-op transition, so this
    // does not run twice and cannot file the same render twice.
    const outputUrl = result.job.progress.outputUrl;
    if (event.type === "succeed" && outputUrl !== undefined && result.changed) {
      const attached = await attachRenderOutput(result.job, outputUrl);
      if (!attached.ok) {
        console.warn("[GSTUDIO_RENDER_ATTACH_FAILED]", id, attached.reason);
      }
      return NextResponse.json({
        id,
        state: result.job.progress.state,
        ...(attached.ok
          ? { attachedTo: attached.collectionId, nodeId: attached.nodeId }
          : { attachWarning: attached.reason }),
      });
    }

    return NextResponse.json({ id, state: result.job.progress.state });
  } catch (error) {
    console.error("[GSTUDIO_RENDER_REPORT_ERROR]", error);
    return NextResponse.json({ error: "Unable to record the report." }, { status: 500 });
  }
}
