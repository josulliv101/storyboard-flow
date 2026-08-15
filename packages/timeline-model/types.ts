// The stored timeline model: a TimelineDocument is a flat TimelineClip[]
// where a collection clip references its child document by childTimelineId —
// semantically a containment forest. These types are the persistence
// contract shared by the server routes, the graph adapter, and every view;
// they live here (framework-free) so domain and server code can depend on
// them without pulling a UI package. View-transient fields (the view*
// family) ride along on TimelineItemBase because stored clips round-trip
// through view state in the legacy pipeline.

import type { LayerFrame } from "./layer-frame";

export type MediaKind = "image" | "video";
export type CollectionEndpoint = "first" | "last";

export type TimelineItemBase = {
  id: string;
  index: number;
  /**
   * What this clip IS, for assistive tech and image fallbacks — derived from
   * the source when a clip is created, never authored. Distinct from `title`
   * on purpose: renaming a clip must not rewrite its accessibility text.
   */
  alt: string;
  /**
   * A NAME the user chose, absent until they choose one.
   *
   * Absence is the point. Every clip has an `alt` (a filename, usually), so a
   * card that displayed "the name" would display something for all of them —
   * and a library of two thousand machine-named clips reads as a rename
   * backlog rather than a set of finished items. Only authored titles are
   * shown, so a named clip looks deliberate and an unnamed one looks neutral.
   *
   * The job it does: similar-looking clips (ten close-ups of one actor, cut
   * from ten different takes) are indistinguishable by thumbnail and carry no
   * mechanical discriminator at all. A title is the only thing that can say
   * which moment this is.
   */
  title?: string;
  aspect: number;
  trackIndex: number;

  /**
   * WHERE THE AUTHOR PUT THIS CLIP on its lane, when they put it somewhere.
   *
   * The counterpart to `startTime`, which is always DERIVED: packing gives
   * each lane a running cursor and every clip's start comes out of it, so a
   * lane is a parallel queue and the only way to place a voiceover at 7.5s
   * would be to put 7.5s of something in front of it. This is the field that
   * says "start here" and means it.
   *
   * ABSENT MEANS QUEUED — pack behind the previous clip on this lane, which
   * is what every document written before this did, so nothing needs
   * migrating. Absence is also the safe default: a writer that forgets this
   * field gets the old behaviour rather than moving a clip to zero.
   *
   * IGNORED ON LANE 0, deliberately and defensively. The picture is a CUT:
   * trimming a shot closes the gap behind it and reordering repacks. A hole
   * there is not silence either — the player holds the last frame — so
   * deliberate gaps in the picture are a different feature with a different
   * answer, and a stray value here must not open one.
   */
  placedStart?: number;

  /**
   * WHERE THIS DRAWS INSIDE THE PICTURE, when it runs under one.
   *
   * A lane clip has always been mixed UNDER the picture, and for sound that is
   * the whole story. A picture cannot be under a picture — it would simply not
   * be visible — so a layer that has a frame is composited OVER, into this
   * sub-rectangle. "Under" describes the mix, "over" describes the screen.
   *
   * ABSENT MEANS NO PICTURE: the clip contributes its sound and nothing else,
   * which is what every layered clip did before this existed, so no stored
   * document changes what it renders. Discoverability is bought on the WRITE
   * side instead — dropping a visual clip onto a lane stamps the default inset
   * — rather than by inferring a frame here, which would silently change the
   * output of timelines nobody has touched.
   *
   * IGNORED ON LANE 0, like `placedStart`. The picture is not inside itself.
   *
   * Normalized 0..1 of the OUTPUT frame, whose size is a per-render setting; a
   * pixel rectangle would mean something different at every size. Height is
   * absent on purpose — it follows from `aspect`, so an inset cannot be
   * stretched. See {@link layerFrameRect} for resolving one, and
   * {@link layerFrameForPreset} for the corner presets that write it.
   */
  layerFrame?: LayerFrame;

  /** Absolute timeline position. DERIVED by packing — see `placedStart`,
   *  which is the authored input this is computed from on lanes 1+. */
  startTime: number;
  /** Visible duration after trimming. */
  duration: number;
  /** Total source duration available for this clip. */
  sourceDuration: number;
  /** Amount trimmed from the source beginning. */
  trimIn: number;
  /** Amount trimmed from the source end. */
  trimOut: number;
  /**
   * Skipped: excluded from playback and from every count and duration total,
   * along with its whole subtree when this is a collection clip. It KEEPS its
   * slot in the stored document — same index, same startTime, same duration —
   * because disabling is not deleting: the board still shows the clip in
   * place, and only the read models (the playback manifest and the
   * collection-summary derivation) drop it and repack around it.
   *
   * Absent means enabled; enabling removes the key rather than writing
   * `false`, so documents that never use the feature never grow the field.
   */
  disabled?: boolean;
  /**
   * Free-form labels for finding this clip again — the generator that made
   * it, the checkpoint, the shot, its status.
   *
   * On the BASE rather than on the media members so a collection can be
   * tagged too: "every take from 10 August" is the same kind of question as
   * "every SCAIL-2 multirole take", and answering one but not the other would
   * be an arbitrary split.
   *
   * Absent means untagged; an empty list is never written, so documents that
   * do not use tags never grow the field. See {@link normalizeTags} for the
   * cleaning rules and the caps.
   */
  tags?: string[];
  /** ISO instant this clip was moved to trash. Absent on every live clip —
   *  its presence IS the record that a clip is in the bin, which is why it is
   *  cleared on restore rather than left as stale metadata. */
  trashedAt?: string;
  /** Which timeline this clip was deleted from. See {@link TrashOrigin}. */
  trashedFrom?: TrashOrigin;
  /** Optional unscaled timeline position used when visual width differs from playback time. */
  playbackStartTime?: number;
  /** Optional unscaled playback duration used when visual width differs from playback time. */
  playbackDuration?: number;
  /** Transient view key used when a collection endpoint is exposed inline. */
  viewExpansionKey?: string;
  /** Transient source timeline for inline collection endpoint clips. */
  viewSourceTimelineId?: string;
  /** Transient source clip id for inline collection endpoint clips. */
  viewSourceClipId?: string;
  /** Transient nesting depth for inline collection endpoint views. */
  viewDepth?: number;
  /** Transient endpoint exposed from a collection preview. */
  viewEndpoint?: CollectionEndpoint;
  /** Transient parent collection key for exposed endpoint clips. */
  viewParentCollectionKey?: string;
  /** Transient role for synthetic inline collection endpoint cards. */
  viewRole?: "collection-endpoint";
  /** Transient accent index for sibling collection styling. */
  viewCollectionAccentIndex?: number;
};

/** Where a media clip's file came from: the asset provider that owns it and
 *  that provider's own id for it. Recorded when a clip is minted from the
 *  asset panel so the file stays identifiable across URL changes, provider
 *  re-configuration, and future re-linking — `src` is how the clip RENDERS,
 *  this is what the clip IS. Absent on clips that predate it and on media
 *  that never came through a provider (direct OS drops). */
export type AssetSourceRef = {
  providerId: string;
  assetId: string;
};

/** Where a clip was deleted FROM, and when. Written when a clip moves to
 *  trash; cleared when it is restored.
 *
 *  The title is a SNAPSHOT, not a lookup key: it is what the trash drawer
 *  prints, and it has to keep printing after the origin timeline is renamed or
 *  itself deleted — which is exactly when someone is digging through the trash.
 *  The id rides along for re-linking later (restore-to-origin), the same
 *  division of labour as `sourceAsset`: the id is what it IS, the snapshot is
 *  how it READS. */
export type TrashOrigin = {
  timelineId: string;
  title: string;
};

export type ImageTimelineClip = TimelineItemBase & {
  kind: "image";
  src: string;
  poster?: string;
  sourceAsset?: AssetSourceRef;
};

export type VideoTimelineClip = TimelineItemBase & {
  kind: "video";
  src: string;
  poster?: string;
  sourceAsset?: AssetSourceRef;
};

/**
 * A sound with no picture. Structurally identical to the other two media
 * members — including `sourceDuration`/`trimIn`/`trimOut` from
 * `TimelineItemBase` — so it is render-complete from the start even though the
 * trim AFFORDANCE is deferred. The graph side models it as a WINDOWED node
 * (like video, not like image); see AudioMediaNode in @storyboard/collections-core
 * for why that choice is load-bearing.
 *
 * `poster` exists on the type only because the field is shared; audio must not
 * carry one. A poster minted for an audio asset is a broken image URL, and it
 * would leak into the recently-deleted list as a thumbnail.
 */
export type AudioTimelineClip = TimelineItemBase & {
  kind: "audio";
  src: string;
  poster?: never;
  sourceAsset?: AssetSourceRef;
};

export type MediaTimelineClip = ImageTimelineClip | VideoTimelineClip | AudioTimelineClip;

/** Has a file behind it — i.e. anything that is not a collection. */
export function isMediaClip(clip: TimelineClip): clip is MediaTimelineClip {
  return clip.kind !== "collection";
}

/**
 * Can stand in as a PICTURE — a collection preview frame, a card thumbnail, a
 * project poster. Audio deliberately fails this: it has a `src`, so every
 * "does it have a source?" test would otherwise wave a .flac through into
 * places that render it as an <img>.
 */
export function isVisualClip(
  clip: TimelineClip,
): clip is ImageTimelineClip | VideoTimelineClip {
  return clip.kind === "image" || clip.kind === "video";
}

export type CollectionTimelineClip = TimelineItemBase & {
  kind: "collection";
  title: string;
  childTimelineId: string;
  itemCount: number;
  /**
   * Seconds of this collection that actually PLAY — its child's enabled clips
   * only. The twin of `duration`, which is the collection's LAYOUT span and
   * counts disabled children so the board, the ruler and the playback clock
   * agree on where every card sits.
   *
   * The two differ exactly when a descendant is disabled, and the split is
   * deliberate: geometry has to include a disabled clip (the playhead jumps
   * over its span, a scrub can land in it) while the readouts on the card
   * describe what a viewer would actually see. Absent when nothing under the
   * collection is disabled — then `duration` already is the playable time.
   */
  playableDuration?: number;
  previewItems?: Array<{
    id: string;
    kind: MediaKind;
    src: string;
    poster?: string;
    /** Source-time offset represented by a video preview. Absent means 0. */
    trimIn?: number;
    alt: string;
  }>;
};

export type TimelineClip = MediaTimelineClip | CollectionTimelineClip;

export type TimelineDocument = {
  id: string;
  title: string;
  description?: string;
  clips: TimelineClip[];
};
