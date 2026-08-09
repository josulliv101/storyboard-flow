import {
  getChildren,
  parseNodeId,
  type CollectionsGraph,
} from "@storyboard/collections-core";
import type { DetailsById, FlatItem } from "@storyboard/timeline-domain";

/**
 * The PURE half of the waveform lane: which audio each drawn card refers to.
 *
 * `ChildSpan` (graph-playhead-model) carries a card's geometry but deliberately
 * not its media — the playhead never needed it. The lane does: to draw a card's
 * waveform it must know the source URL, the asset identity to cache under, and
 * the trims, because two cards can show different windows of ONE file.
 *
 * No React, no DOM, for the same reason as its neighbour: the app's vitest globs
 * `.test.ts` only, so the arithmetic lives here and the `.tsx` stays a shell.
 */

export type WaveformSource = Readonly<{
  /** Cache key — the asset's durable id where there is one. */
  key: string;
  src: string;
  /** Seconds removed from each end. NOT offsets into the source: the core's
   *  `mediaDurationSeconds` computes `full - trimIn - trimOut`, and reading
   *  these the other way is the bug that shipped in the MCP write path. */
  trimIn: number;
  trimOut: number;
}>;

type MediaLike = Readonly<{
  kind: string;
  mediaKind?: string;
  src?: string;
  trimInSeconds?: number;
  trimOutSeconds?: number;
}>;

function sourceForNode(
  graph: CollectionsGraph,
  details: DetailsById,
  nodeId: string,
): WaveformSource | null {
  const node = graph.nodesById.get(parseNodeId(nodeId)) as MediaLike | undefined;
  // Collections have no audio of their own, and an image has none at all.
  // Both WINDOWED kinds qualify, not just video: an audio clip is the most
  // obvious thing in the app to draw a waveform for, and it carries the same
  // trimIn/trimOut this source shape needs. (Structural check rather than the
  // core's `hasSourceWindow` because `MediaLike` above is deliberately loose —
  // this module never sees a real graph node type.)
  if (!node || node.kind !== "media") return null;
  if (node.mediaKind !== "video" && node.mediaKind !== "audio") return null;
  if (!node.src) return null;

  const asset = details[nodeId]?.sourceAsset;
  return {
    // Asset-keyed so one upload placed five times decodes once; the src is the
    // fallback for clips minted before provenance was recorded.
    key: asset ? `${asset.providerId}:${asset.assetId}` : `src:${node.src}`,
    src: node.src,
    trimIn: node.trimInSeconds ?? 0,
    trimOut: node.trimOutSeconds ?? 0,
  };
}

/**
 * One entry per drawn card, index-aligned with `cardsFor`'s spans — `null` where
 * the card has no audio to draw (a collection, an image, a missing node).
 *
 * The alignment is the whole contract: the lane pairs `sources[i]` with
 * `cards[i]`, so this must walk children in exactly the order the span builders
 * do — `flatCardSpans` over `items`, `childSpans` over `getChildren`.
 */
export function waveformSourcesFor(
  graph: CollectionsGraph,
  details: DetailsById,
  focusedId: string,
  flatItems: readonly FlatItem[] | null,
): Array<WaveformSource | null> {
  if (flatItems) {
    return flatItems.map((item) => sourceForNode(graph, details, item.nodeId as string));
  }
  return getChildren(graph, parseNodeId(focusedId)).map((childId) =>
    sourceForNode(graph, details, childId as string),
  );
}

/**
 * The distinct assets a set of sources needs, so the lane can request each once
 * rather than once per card.
 */
export function distinctWaveformKeys(
  sources: ReadonlyArray<WaveformSource | null>,
): WaveformSource[] {
  const seen = new Set<string>();
  const out: WaveformSource[] = [];
  for (const source of sources) {
    if (!source || seen.has(source.key)) continue;
    seen.add(source.key);
    out.push(source);
  }
  return out;
}
