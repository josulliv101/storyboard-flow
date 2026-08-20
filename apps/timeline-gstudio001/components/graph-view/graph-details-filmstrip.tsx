"use client";

import { memo, useMemo, type ReactNode } from "react";

import {
  useCollectionsSelector,
  parseNodeId,
  type MediaNode,
} from "@storyboard/ui/dnd-collections";

import { detailsNeighbours, flatOrderRootId } from "./graph-details-neighbours";

/**
 * The details hero as a SECTION OF THE STRIP rather than a single frame: the
 * clip you opened in the middle, the clips either side of it in playback order
 * flanking it, both running off the edges.
 *
 * WHY THE NEIGHBOURS RUN OFF. The frames are all the same width, so three of
 * them cannot fit — and that is the effect, not a compromise. A clip cropped by
 * the panel edge reads as "the film continues", which a row of three neatly
 * fitted thumbnails does not. It is also what makes the two SEAMS the most
 * central things on screen after the subject itself, which is the point of the
 * view: what a cut looks like is a question about the frames on either side of
 * it, and until now answering it meant closing the modal and opening another.
 *
 * `FRAME_WIDTH_PCT` is what decides how much of a neighbour you get. At 70 the
 * subject keeps most of the panel and about 15% of each neighbour shows —
 * enough to recognise a shot, not enough to compete with the one being worked
 * on. It is a percentage rather than a pixel count so the proportion survives
 * every panel width.
 */
const FRAME_WIDTH_PCT = 70;

/** Same size, same display — a neighbour is drawn exactly as the subject is,
 *  minus being live. */
function frameStyle(): React.CSSProperties {
  return { width: `${FRAME_WIDTH_PCT}%`, flexShrink: 0 };
}

/**
 * A neighbour's picture: its poster, never a playing element.
 *
 * ONLY THE SUBJECT IS LIVE, deliberately, and this is the seam of that
 * decision. Three video elements seeking against each other would compete for
 * decode and for attention, and the trim controls below act on ONE clip — a
 * neighbour that moved would look like it was being edited too. So a neighbour
 * is a still until you click it, at which point it becomes the subject and gets
 * everything.
 */
const NeighbourFrame = memo(function NeighbourFrame({
  node,
  side,
  onOpen,
}: Readonly<{
  node: MediaNode | null;
  side: "previous" | "next";
  onOpen: (id: string) => void;
}>) {
  // NOTHING AFTER THE LAST CLIP, and the gap is drawn rather than closed up.
  // Collapsing it would slide the subject off centre at the ends, so the frame
  // you are working on would sit somewhere different depending on where you
  // are in the timeline.
  if (node === null) {
    return <div aria-hidden="true" style={frameStyle()} className="rounded-md bg-black/40" />;
  }

  const poster =
    node.mediaKind === "video" ? (node.posterSrcs?.[0] ?? null) : (node.src ?? null);

  return (
    <button
      type="button"
      data-details-neighbour={side}
      onClick={() => onOpen(node.id as string)}
      title={`${side === "previous" ? "Previous" : "Next"}: ${node.name}`}
      style={frameStyle()}
      // NOT DIMMED. Fading the neighbours was the first instinct and it is the
      // wrong one: they are drawn exactly as the subject is, and the hierarchy
      // is carried by POSITION — centred and whole against clipped at the edges
      // — rather than by making two of the three pictures harder to read. The
      // point of the view is judging a cut, and you cannot judge a cut against
      // a frame that has been turned down.
      className="group relative overflow-hidden rounded-md bg-black outline-none hover:ring-2 hover:ring-white/30 focus-visible:ring-2 focus-visible:ring-blue-500"
    >
      {poster === null ? (
        <div className="h-full w-full bg-zinc-900" />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={poster}
          alt=""
          draggable={false}
          className="h-full w-full bg-black object-contain"
        />
      )}
    </button>
  );
});

/**
 * The row. The SUBJECT is passed as children so this module owns the layout and
 * the modal keeps its hero — including the `view-transition-name` the card
 * morphs into, which has to stay on the middle frame or the open animation
 * lands on the wrong element.
 */
export function DetailsFilmstrip({
  nodeId,
  onOpen,
  children,
}: Readonly<{
  nodeId: string;
  onOpen: (id: string) => void;
  children: ReactNode;
}>) {
  // THE SELECTOR RETURNS THE GRAPH, and the derivation happens in a memo
  // OUTSIDE it. Returning `{ previous, next }` from the selector is the
  // obvious shape and it is an infinite loop: the store's snapshot identity is
  // a contract, so a selector allocating a fresh object every call means
  // `getSnapshot` is never cached, React re-renders to reconcile, and the
  // selector allocates again. It fails loudly — "Maximum update depth
  // exceeded" — which is the good version of this mistake.
  //
  // `s.graph` is a stable reference while the graph is unchanged, so this
  // re-derives exactly when the structure it reads from actually moves. The
  // board reads its own flat order the same way.
  const graph = useCollectionsSelector((state) => state.graph);

  const { previous, next } = useMemo(() => {
    const { previousId, nextId } = detailsNeighbours(graph, flatOrderRootId(graph), nodeId);
    const mediaAt = (id: string | null): MediaNode | null => {
      if (id === null) return null;
      const node = graph.nodesById.get(parseNodeId(id));
      return node && node.kind === "media" ? (node as MediaNode) : null;
    };
    return { previous: mediaAt(previousId), next: mediaAt(nextId) };
  }, [graph, nodeId]);

  return (
    <div
      data-details-filmstrip
      // `justify-center` is what centres the SUBJECT rather than the row: with
      // three equal frames overflowing, the middle one lands in the middle and
      // the other two are clipped symmetrically by `overflow-hidden`.
      className="flex min-h-0 flex-1 items-stretch justify-center gap-2 overflow-hidden"
    >
      <NeighbourFrame node={previous} side="previous" onOpen={onOpen} />
      <div style={frameStyle()} className="flex min-h-0 flex-col">
        {children}
      </div>
      <NeighbourFrame node={next} side="next" onOpen={onOpen} />
    </div>
  );
}
