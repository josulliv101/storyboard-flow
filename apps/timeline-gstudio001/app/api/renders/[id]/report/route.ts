import { NextResponse } from "next/server";

import { readJsonObject } from "@/lib/read-json-body";
import { reportRenderProgress } from "@/lib/render/job-store";
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
    return NextResponse.json({ id, state: result.job.progress.state });
  } catch (error) {
    console.error("[GSTUDIO_RENDER_REPORT_ERROR]", error);
    return NextResponse.json({ error: "Unable to record the report." }, { status: 500 });
  }
}
