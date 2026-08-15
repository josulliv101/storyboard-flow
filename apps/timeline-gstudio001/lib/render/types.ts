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
 * TWO PARTS, because a timeline has two kinds of content. `cuts` is the
 * PICTURE: lane 0, concatenated, gaps closed. `layers` is everything placed
 * UNDER it — a voiceover, a music bed — which does not concatenate, because
 * the whole point of it is to play at the same time as something else.
 */
export type RenderCutList = Readonly<{
  /** The picture, in order, touching. Never overlapping. */
  cuts: readonly RenderCut[];
  /**
   * Everything on a lane above the picture, positioned in OUTPUT time.
   *
   * These DO overlap the cuts — that is what makes them layers — and they may
   * overlap each other, which is a VO over a bed. Empty for any timeline that
   * uses no lanes, which is every one written before phase 2.
   */
  layers: readonly RenderCut[];
  /**
   * Total output length: the sum of the PICTURE's durations, gaps removed.
   *
   * The picture decides, not the longest layer. A 30-second bed under eight
   * seconds of picture makes an eight-second film with the bed cut off at the
   * end — which is what a bed is for. The alternative, extending the output to
   * the longest layer, ends the film on however much black the bed had left.
   */
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
