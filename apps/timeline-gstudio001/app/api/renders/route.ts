import { NextResponse } from "next/server";

import { requireAuthUser } from "@/lib/firebase-auth-session";
import { readJsonObject } from "@/lib/read-json-body";
import { compileTimelineManifest } from "@/lib/compile-timeline-manifest";
import { checkUserScopedId, TimelineAccessDeniedError } from "@/lib/timeline-ownership";
import { TimelineClosureTooLargeError } from "@/lib/load-timeline-closure";
import { compileCutList, DEFAULT_RENDER_FORMAT } from "@/lib/render/cut-list";
import { createRenderJob, listRenderJobsForTimeline } from "@/lib/render/job-store";
import { renderProviders } from "@/lib/render/registry";
import type { RenderJob } from "@/lib/render/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isValidTimelineId(id: string) {
  return /^[a-zA-Z0-9_-]+$/.test(id);
}

function mintRenderId(): string {
  return `render-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * This timeline's recent renders, newest first — what the board's status chip
 * polls.
 *
 * A LISTING rather than a per-id lookup, because a render is started from
 * somewhere else entirely (the MCP tools, an agent) and the board has no id to
 * ask about. The poll RATE is where the cost of that lives, and it is decided
 * client-side in `lib/render/render-poll`: fast while something is encoding,
 * slow when idle, and stopped completely while the tab is hidden.
 *
 * The cut list is not returned. It is large, it is the worker's business, and
 * a chip needs a state, a fraction and a URL.
 */
export async function GET(request: Request) {
  const { user, response } = await requireAuthUser();
  if (response || !user) {
    return response || NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const timelineId = new URL(request.url).searchParams.get("timelineId") ?? "";
  if (!isValidTimelineId(timelineId)) {
    return NextResponse.json({ error: "Invalid timeline id." }, { status: 400 });
  }

  try {
    const jobs = await listRenderJobsForTimeline(timelineId, user.uid);
    return NextResponse.json({
      renders: jobs.map((job) => ({
        id: job.id,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        durationSeconds: job.cutList.durationSeconds,
        ...job.progress,
      })),
    });
  } catch (error) {
    console.error("[GSTUDIO_RENDER_LIST_ERROR]", error);
    return NextResponse.json({ error: "Unable to read renders." }, { status: 500 });
  }
}

/**
 * Submit a render: compile the timeline to a cut list, queue it, and tell the
 * provider there is work.
 *
 * THE JOB IS COMPILED HERE, not by the worker. The worker gets resolved source
 * URLs and absolute output positions and does no timeline arithmetic — which
 * is what lets a third-party renderer be a thing that runs ffmpeg rather than
 * a thing that understands this app's model. It also means a queued job is a
 * snapshot: editing the timeline afterwards does not change what renders, and
 * `projectRevision` records which version it was.
 *
 * The job document is created BEFORE dispatch. A provider that throws leaves a
 * job that is still claimable, which is the recoverable direction; dispatching
 * first could start work no document is waiting for.
 */
export async function POST(request: Request) {
  try {
    const { user, response } = await requireAuthUser();
    if (response || !user) {
      return response || NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await readJsonObject(request);
    const timelineId = typeof body?.timelineId === "string" ? body.timelineId : "";
    if (!isValidTimelineId(timelineId)) {
      return NextResponse.json({ error: "Invalid timeline id." }, { status: 400 });
    }
    if (checkUserScopedId(timelineId, user.uid) === false) {
      return NextResponse.json({ error: "Timeline was not found." }, { status: 404 });
    }

    const providerId =
      typeof body?.providerId === "string" ? body.providerId : renderProviders.defaultProvider()?.id;
    const provider = providerId === undefined ? undefined : renderProviders.get(providerId);
    if (!provider) {
      // No renderer configured at all, or one named that does not exist. 503
      // rather than 400 for the former: the request is fine.
      return NextResponse.json({ error: "No render provider is available." }, { status: 503 });
    }

    const compiled = await compileTimelineManifest(timelineId, user.uid);
    if (!compiled) {
      return NextResponse.json({ error: "Timeline was not found." }, { status: 404 });
    }

    const cutList = compileCutList(compiled.manifest, DEFAULT_RENDER_FORMAT);
    if (cutList.cuts.length === 0) {
      // Nothing enabled to render. A refusal rather than an empty file: an
      // export that silently produced zero seconds would look like a failure
      // of the renderer rather than of the edit.
      return NextResponse.json(
        { error: "Nothing to render — every clip is disabled or the timeline is empty." },
        { status: 400 },
      );
    }

    const job: RenderJob = {
      id: mintRenderId(),
      timelineId,
      projectRevision: compiled.manifest.projectRevision,
      cutList,
      requestedBy: user.uid,
      createdAt: new Date().toISOString(),
    };
    const stored = await createRenderJob(job, provider.id);
    await provider.dispatch({ uid: user.uid }, job);

    return NextResponse.json(
      {
        id: stored.id,
        state: stored.progress.state,
        providerId: provider.id,
        durationSeconds: cutList.durationSeconds,
        cutCount: cutList.cuts.length,
        // Reported so a caller can see what was left out without re-reading
        // the closure — a render missing a branch should not be a surprise.
        missing: compiled.missing,
      },
      { status: 202 },
    );
  } catch (error) {
    if (error instanceof TimelineAccessDeniedError) {
      return NextResponse.json({ error: "Timeline was not found." }, { status: 404 });
    }
    if (error instanceof TimelineClosureTooLargeError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error("[GSTUDIO_RENDER_SUBMIT_ERROR]", error);
    return NextResponse.json({ error: "Unable to submit the render." }, { status: 500 });
  }
}
