// The provider-NEUTRAL render model. Nothing above this seam names a
// particular renderer, a particular machine, or ffmpeg — a render provider's
// whole job is to take a CutList somewhere it can be turned into a file and
// report where that got to.
//
// Isomorphic on purpose: the client renders progress from these shapes, so
// this module must import nothing server-only.
//
// The first provider is the OWNER'S OWN MACHINE, deliberately modelled as a
// third party rather than as a special case. It receives work the same way a
// hosted worker would — by claiming a queued job — so swapping in a hosted
// renderer later is a new adapter and a registry entry, not a rewrite. See
// lib/assets/provider.ts, which is the same seam for asset storage and the
// pattern this follows.

/** What a single cut plays. Images have no source timeline of their own. */
export type RenderCutKind = "image" | "video" | "audio";

/**
 * ONE piece of media in the finished render, with every position already
 * resolved — the worker does no timeline arithmetic.
 *
 * `outputStart` is where it lands in the FINISHED FILE, not on the board. The
 * two differ: the board spaces clips by CLIP_GAP_SECONDS so cards do not
 * touch, and a stored `startTime` carries that spacing. A render that honoured
 * it would emit 0.12s of black between every clip (2.28s across a 20-clip
 * timeline), so the compiler closes the gaps — see `compileCutList`.
 */
export type RenderCut = Readonly<{
  /** Fetchable media URL. Public by design — see the Cloudinary delivery
   *  decision — so a worker needs no credential to READ its inputs. */
  src: string;
  kind: RenderCutKind;
  /** Seconds into the SOURCE file where this cut begins. */
  sourceStart: number;
  /** How long the cut runs in the OUTPUT, in seconds. */
  outputDuration: number;
  /** Source seconds consumed per output second; 1 is normal speed. Carried
   *  even for images (always 1) so every cut has the same shape. */
  playbackRate: number;
  /** Where the cut begins in the OUTPUT — the running total of everything
   *  before it, with gaps closed. */
  outputStart: number;
}>;

/** Output format. Fixed per job rather than per cut: the worker normalises
 *  every source to this before concatenating, because ffmpeg's concat
 *  demuxer requires identical parameters and produces garbage without it. */
export type RenderFormat = Readonly<{
  width: number;
  height: number;
  fps: number;
}>;

/**
 * The finished cut list — everything a renderer needs and nothing about how it
 * renders.
 *
 * PHASE 1 IS A SEQUENCE. `cuts` never overlap, because the stored model cannot
 * express overlap: `packTimelineClips` packs one sequence and `trackIndex` is
 * carried but always 0. Layered audio (VO or a bed UNDER the picture) needs
 * per-track packing in the model first, and is deliberately out of scope here
 * rather than faked — an export that silently flattened a layered mix into a
 * sequence would be worse than one that cannot express it yet.
 */
export type RenderCutList = Readonly<{
  cuts: readonly RenderCut[];
  /** Total output length: the sum of the cut durations, gaps already removed.
   *  NOT the manifest's `durationSeconds`, which is board time. */
  durationSeconds: number;
  format: RenderFormat;
}>;

/** Where a render has got to. Terminal states are `succeeded` and `failed`. */
export type RenderState = "queued" | "claimed" | "rendering" | "succeeded" | "failed";

export type RenderJob = Readonly<{
  id: string;
  /** The timeline this was compiled from, and the revision it was compiled at
   *  — a render is only honest about a specific version of the edit. */
  timelineId: string;
  projectRevision: number;
  cutList: RenderCutList;
  requestedBy: string;
  createdAt: string;
}>;

export type RenderProgress = Readonly<{
  state: RenderState;
  /** 0..1 where the provider can report it; absent when it cannot. A worker
   *  that only knows "started" and "done" says so by omitting this rather
   *  than by inventing a number. */
  fraction?: number;
  /** Provider-side detail for a human: the current stage, or the failure. */
  message?: string;
  /** Set exactly when `state` is "succeeded": the finished file. */
  outputUrl?: string;
}>;

export type RenderProviderCapabilities = Readonly<{
  /** Whether a running render can be stopped. A queued job can always be
   *  abandoned by the app; this is about work already in flight. */
  cancel: boolean;
  /** Whether the provider reports a fraction, or only state transitions. */
  progress: boolean;
}>;

export type RenderProviderDescriptor = Readonly<{
  id: string;
  /** Human label ("This machine", "GitHub Actions") — status lines and logs. */
  label: string;
  capabilities: RenderProviderCapabilities;
}>;
