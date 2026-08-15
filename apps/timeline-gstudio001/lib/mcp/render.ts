import "server-only";

import { checkUserScopedId } from "@/lib/timeline-ownership";
import { toolError, toolOk } from "@/lib/webmcp/results";
import type { ToolResult } from "@/lib/webmcp/types";

import { compileTimelineManifest } from "@/lib/compile-timeline-manifest";
import { compileCutList, DEFAULT_RENDER_FORMAT } from "@/lib/render/cut-list";
import { createRenderJob, readRenderJob } from "@/lib/render/job-store";
import { renderProviders } from "@/lib/render/registry";
import type { RenderJob } from "@/lib/render/types";

import type { WriteContext } from "./write-handlers";

// The render tools. Unlike the write tools beside them these do not edit the
// timeline at all — they compile a SNAPSHOT of it and queue that as a job, so
// editing afterwards does not change what renders. `projectRevision` records
// which version a given file came from.
//
// Two tools rather than one because a render is not instant and the caller is
// an agent: `render_timeline` returns immediately with an id, and
// `render_status` is how you find out what happened. A single blocking tool
// would sit on an MCP request for the length of an encode.

export type RenderTimelineArgs = Readonly<{
  timelineId: string;
  width?: number;
  height?: number;
  fps?: number;
}>;

function mintRenderId(): string {
  return `render-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export async function handleRenderTimeline(
  args: RenderTimelineArgs,
  ctx: WriteContext,
): Promise<ToolResult> {
  if (checkUserScopedId(args.timelineId, ctx.requesterUid) === false) {
    return toolError(`No timeline with id "${args.timelineId}".`);
  }

  const provider = renderProviders.defaultProvider();
  if (!provider) {
    return toolError("No render provider is configured for this deployment.");
  }

  const compiled = await compileTimelineManifest(args.timelineId, ctx.requesterUid);
  if (!compiled) return toolError(`No timeline with id "${args.timelineId}".`);

  // An explicit argument wins; then the PROJECT's stored shape; then the
  // default. Per-argument rather than all-or-nothing so `fps` alone can be
  // overridden without discarding the project's size.
  const base = compiled.renderFormat ?? DEFAULT_RENDER_FORMAT;
  const format = {
    width: args.width ?? base.width,
    height: args.height ?? base.height,
    fps: args.fps ?? base.fps,
  };
  const cutList = compileCutList(compiled.manifest, format);
  if (cutList.cuts.length === 0) {
    // A refusal, not an empty file: an export that produced zero seconds would
    // read as the renderer failing rather than as the edit being empty.
    return toolError(
      "Nothing to render — every clip is disabled, or the timeline is empty.",
    );
  }

  const job: RenderJob = {
    id: mintRenderId(),
    timelineId: args.timelineId,
    projectRevision: compiled.manifest.projectRevision,
    cutList,
    requestedBy: ctx.requesterUid,
    createdAt: new Date().toISOString(),
  };
  await createRenderJob(job, provider.id);
  await provider.dispatch({ uid: ctx.requesterUid }, job);

  return toolOk(
    `Queued render "${job.id}": ${cutList.cuts.length} cuts, ` +
      `${cutList.durationSeconds.toFixed(2)}s at ${format.width}x${format.height}. ` +
      `Poll it with render_status.`,
    {
      renderId: job.id,
      state: "queued",
      cutCount: cutList.cuts.length,
      durationSeconds: cutList.durationSeconds,
      format,
      // What the compile could not read. A render quietly missing a branch is
      // the kind of thing that is only noticed after watching it.
      ...(compiled.missing.length === 0 ? {} : { missingDocuments: compiled.missing }),
    },
  );
}

export type RenderStatusArgs = Readonly<{ renderId: string }>;

export async function handleRenderStatus(
  args: RenderStatusArgs,
  ctx: WriteContext,
): Promise<ToolResult> {
  const job = await readRenderJob(args.renderId);
  // Scoped to the requester, and a plain not-found for someone else's, so
  // render ids cannot be probed for existence.
  if (!job || job.requestedBy !== ctx.requesterUid) {
    return toolError(`No render with id "${args.renderId}".`);
  }

  const { state, fraction, message, outputUrl } = job.progress;
  const percent = fraction === undefined ? "" : ` (${Math.round(fraction * 100)}%)`;
  const detail = message === undefined ? "" : ` — ${message}`;

  return toolOk(
    state === "succeeded"
      ? `Render "${job.id}" finished: ${outputUrl}`
      : state === "queued"
        ? `Render "${job.id}" is queued. It starts when a render worker picks it up.`
        : `Render "${job.id}" is ${state}${percent}${detail}.`,
    {
      renderId: job.id,
      timelineId: job.timelineId,
      state,
      ...(fraction === undefined ? {} : { fraction }),
      ...(message === undefined ? {} : { message }),
      ...(outputUrl === undefined ? {} : { outputUrl }),
      durationSeconds: job.cutList.durationSeconds,
      cutCount: job.cutList.cuts.length,
      updatedAt: job.updatedAt,
    },
  );
}
