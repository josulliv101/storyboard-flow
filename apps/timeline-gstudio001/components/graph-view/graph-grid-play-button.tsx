"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { Pause, Play, SkipForward } from "lucide-react";

import {
  getChildren,
  parseNodeId,
  useCollectionsSelector,
  type NodeId,
} from "@storyboard/ui/dnd-collections";

import { usePreviewSettled } from "@storyboard/ui/timeline/viewport/workbench-display-surface";

import { useGraphDetailsStore } from "./graph-details-context";
import { childSpans } from "./graph-playhead-model";
import { clipWidthAt } from "./preview-card-geometry";
import { PreviewCardSpansContext } from "./preview-contexts";
import type { PreviewTimeChannel } from "./preview-time-channel";

/**
 * When each card starts, on the clock the pane is actually playing.
 *
 * COMPUTED ONCE FOR THE SURFACE, not once per card: `childSpans` walks the
 * focused collection's children, so a card doing it for itself would do the
 * whole walk N times to read one number out of it.
 *
 * It goes through `childSpans` rather than the spans context directly because
 * that context is NULL until the manifest lands — the pane plays a live
 * projection first, and for a couple of seconds after every edit. Reading the
 * context alone meant no buttons at all on a freshly opened board, which is
 * exactly how this was first found.
 */
type CardStart = Readonly<{ start: number; end: number; disabled: boolean }>;

const ClipStartsContext = createContext<ReadonlyMap<string, CardStart> | null>(null);

/**
 * WHICH CARD'S PLAY BUTTON STARTED THE PLAYBACK THAT IS RUNNING.
 *
 * The pause belongs to the button you pressed, and stays there until you press
 * it again — even once the playhead has run on into later clips. It followed
 * the playhead first, which meant the control you had just used slid out from
 * under the pointer and you had to go looking for where "pause" had got to,
 * on a board where every card looks the same.
 *
 * Only ever consulted WHILE PLAYING, which is what saves it from needing to be
 * cleared. A stale id sits harmlessly in a paused view, and the next press
 * overwrites it. If playback was started somewhere else entirely — the pane's
 * own transport — this is null and the pause falls back to the card the
 * playhead is in, which is the best guess available.
 */
type PlayInitiator = Readonly<{ id: string | null; claim: (id: string | null) => void }>;

const PlayInitiatorContext = createContext<PlayInitiator>({ id: null, claim: () => {} });

export function GridPlayStarts({
  focusedId,
  pixelsPerSecond,
  children,
}: Readonly<{ focusedId: string; pixelsPerSecond: number; children: ReactNode }>) {
  const graph = useCollectionsSelector((snapshot) => snapshot.graph);
  const detailsStore = useGraphDetailsStore();
  const details = useSyncExternalStore(
    detailsStore.subscribe,
    detailsStore.read,
    detailsStore.read,
  );
  const spans = useContext(PreviewCardSpansContext);

  const starts = useMemo(() => {
    const ids = getChildren(graph, parseNodeId(focusedId));
    // `laneScope` left at its default: one card per child, which is the
    // pairing this index alignment depends on.
    const cards = childSpans(graph, details, focusedId, spans, clipWidthAt(pixelsPerSecond, 0));
    const map = new Map<string, CardStart>();
    ids.forEach((id, index) => {
      const card = cards[index];
      if (card === undefined) return;
      // `disabled` here already folds in a disabled ANCESTOR — the rails draw
      // no distinction either, because in both cases nothing reaches the
      // viewer.
      map.set(id as string, {
        start: card.startTime,
        end: card.endTime,
        disabled: card.disabled === true,
      });
    });
    return map;
  }, [graph, details, spans, focusedId, pixelsPerSecond]);

  return (
    <ClipStartsContext.Provider value={starts}>
      <PlayInitiatorProvider>{children}</PlayInitiatorProvider>
    </ClipStartsContext.Provider>
  );
}

function PlayInitiatorProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [id, setId] = useState<string | null>(null);
  const value = useMemo<PlayInitiator>(() => ({ id, claim: setId }), [id]);
  return <PlayInitiatorContext.Provider value={value}>{children}</PlayInitiatorContext.Provider>;
}

/**
 * Start this clip playing IN THE PREVIEW PANE, from its own beginning.
 *
 * A SIBLING OF THE CARD, not a child of it. A card's shell is a `<button>` and
 * nested interactive content is invalid — the tag editor lives in the details
 * modal for the same reason — so this rides the grid's per-cell slot, which is
 * the nearest place that is both valid markup and card-shaped. Nothing has to
 * measure where a card is; the cell already knows.
 *
 * PLAY, NOT PLAY/PAUSE. Making each button a toggle means every card has to
 * know whether IT is the clip currently playing, which means subscribing every
 * card to the clock and re-rendering the grid as the playhead moves — a real
 * cost for a second pause button, when the transport sitting in the preview
 * pane above is already the obvious place to stop.
 */
export function GraphGridPlayButton({
  nodeId,
  channel,
}: Readonly<{ nodeId: NodeId; channel: PreviewTimeChannel }>) {
  const starts = useContext(ClipStartsContext);
  // NOT UNTIL THE PANE HAS LANDED. These buttons appear when the preview does,
  // which means their first paint would otherwise fall in the middle of the
  // reveal — one per card, all at once, over a board that is still moving. The
  // rails wait for the same signal and for the same reason.
  const settled = usePreviewSettled();
  const card = starts?.get(nodeId as string);

  // IS THIS THE CARD PLAYING RIGHT NOW.
  //
  // Subscribed per card, but the snapshot is a BOOLEAN — so React bails out
  // unless this particular card's answer flips, and a playhead sweeping the
  // timeline re-renders exactly two buttons per crossing rather than the whole
  // grid on every tick. That was the objection to a toggle; a boolean snapshot
  // answers it.
  // ONE STRING, and it now answers the question the single button asks:
  // IS THE PLAYHEAD ON THIS CLIP? Four mutually exclusive states from the same
  // two values, so one subscription and one bail-out check, and no way to
  // render a card claiming two of them at once.
  const cardState = useSyncExternalStore(
    (onChange) => {
      const stopTime = channel.subscribe(onChange);
      const stopPlaying = channel.subscribePlaying(onChange);
      return () => {
        stopTime();
        stopPlaying();
      };
    },
    () => {
      if (card === undefined) return "paused-forward";
      const now = channel.get();
      // BOTH FACTS IN ONE STRING. The zone answers "where is the playhead
      // relative to this card"; the prefix answers "is anything playing at
      // all", which the pause now needs even on a card the playhead has left.
      // One subscription, and React still bails out unless this card's own
      // answer changes.
      const running = channel.isPlaying() ? "playing" : "paused";
      // INSIDE THIS CLIP AT ALL, not merely parked on its first frame. That
      // was the old test, and it is the wrong one for a single control: a
      // playhead three seconds into a shot is plainly ON that shot, and
      // offering to "go to its start" there is a rewind nobody asked for.
      if (now >= card.start && now < card.end) return `${running}-here` as const;
      return `${running}-${card.start < now ? "back" : "forward"}` as const;
    },
    () => "paused-forward" as const,
  );
  const running = cardState.startsWith("playing");
  const zone = cardState.slice(cardState.indexOf("-") + 1);
  const initiator = useContext(PlayInitiatorContext);

  // THE PAUSE STAYS WHERE IT WAS PRESSED. While something is playing, the
  // card that started it wears the pause — wherever the playhead has since
  // travelled — so the control does not move out from under the pointer that
  // just used it. With no initiator (the pane's own transport started this),
  // it falls back to the card the playhead is in.
  const playingHere =
    running && (initiator.id !== null ? initiator.id === (nodeId as string) : zone === "here");
  // WHICH CONTROL THIS IS. On the clip the playhead is sitting in, the button
  // is a transport control; anywhere else it is a way of getting there.
  const onThisClip = playingHere || zone === "here";

  // WHICH WAY THE ARROW POINTS: forward for a card ahead of the playhead,
  // turned around for one behind it — the same glyph saying "fetch the
  // playhead back" instead of "run on to there".
  //
  // The last-direction memory this used to keep is gone with the state it
  // served. It existed for the instant a jump COMPLETED, when the card became
  // "at-start" with no direction of its own and a recomputed arrow would snap
  // round at the moment it went quiet. Arriving now makes the button a PLAY
  // control, so there is no arrow left to contradict the trip you just watched.
  const pointsBack = zone === "back";
  const node = useCollectionsSelector((snapshot) => snapshot.graph.nodesById.get(nodeId) ?? null);
  const anchorRef = useRef<HTMLDivElement | null>(null);

  // WHERE THE PICTURE ENDS INSIDE THE CELL.
  //
  // The button belongs at the bottom-left of the THUMBNAIL, and a grid cell is
  // thumbnail plus caption — so the cell's own bottom is the wrong edge by
  // however tall the caption is. That height is real layout, not a number this
  // file should own a copy of: the caption carries a name row and a tag row
  // that is present even when empty, and any constant here would be a second
  // opinion about it that silently rots.
  //
  // So it is measured, once per card and again on resize, from the artwork
  // marker the card publishes. Local to one cell, not a sweep of the grid.
  const [artworkBottom, setArtworkBottom] = useState<number | null>(null);
  useEffect(() => {
    const anchor = anchorRef.current;
    const cell = anchor?.parentElement;
    if (!cell || typeof ResizeObserver === "undefined") return;
    // RETRIED UNTIL THE PICTURE IS THERE. A collection card fills its frames
    // from child previews that arrive after mount, so the first measurement
    // finds nothing and a ResizeObserver on the CELL never fires — the cell's
    // own size did not change. The button then sat at its fallback, which on a
    // collection is below the name-and-count row: a play control under the
    // card it belongs to. Measured at 53px out, every time.
    let frame = 0;
    let tries = 0;
    const measure = () => {
      const artwork = cell.querySelector("[data-clip-artwork]");
      const box = artwork?.getBoundingClientRect();
      if (box === undefined || box.height === 0) {
        if (tries++ < 40) frame = requestAnimationFrame(measure);
        return;
      }
      setArtworkBottom(box.bottom - cell.getBoundingClientRect().bottom);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(cell);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
    // DEPENDS ON `settled`, and that is not incidental. This component returns
    // null until the preview has finished opening, so on first render there is
    // no element for the ref — an effect with an empty dependency list runs
    // once, against that null, and never again. The button then kept its
    // fallback position forever, which put it under the card instead of on the
    // picture. Re-running when the button actually mounts is the whole fix.
  }, [settled]);

  // COLLECTIONS GET ONE TOO. Its window is the union of every leaf beneath it,
  // so its start IS its first clip's start — pressing play on a collection
  // plays the collection, which is the only thing it could sensibly mean.
  //
  // DISABLED CARDS DO NOT. Playback jumps them, so the button would be a
  // control that visibly does nothing — the playhead would land past it and
  // the card it was pressed on would never appear.
  if (!settled || node === null) return null;
  if (card === undefined || card.disabled) return null;

  const discClass = [
    "pointer-events-auto flex size-7 items-center justify-center",
    "rounded-full bg-zinc-950/70 text-zinc-100 ring-1 ring-white/25 backdrop-blur-sm",
    "transition-colors hover:bg-zinc-950/90 hover:text-white",
    "focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:outline-none",
  ].join(" ");

  return (
    // GONE WHILE SELECTING. In that mode a card is a thing you are picking,
    // not a thing you are watching, and two transport controls sitting on it
    // are two places a press does something other than select — on a surface
    // where every press is supposed to mean the same thing.
    //
    // `hidden` rather than an opacity or a pointer-events trick, so they leave
    // the tab order too: a control you cannot see should not be one you can
    // still reach by keyboard.
    //
    // Driven off the panel's `data-select-mode` rather than a store read here,
    // for the same reason the cards' rings are: this is a whole-surface state,
    // and subscribing every card to it would re-render all of them on a toggle
    // to hide two buttons.
    <div
      ref={anchorRef}
      className="pointer-events-none absolute inset-0 [[data-select-mode]_&]:hidden"
    >
      {/* ONE CONTROL, AND WHICH ONE DEPENDS ON WHERE THE PLAYHEAD IS.
          There were two: play/pause, and a cue that jumped the playhead to
          this clip's start. Two controls on every card, in every cell, and on
          any given card exactly one of them was the one you wanted — the cue
          was pointless on the clip already playing, and play was the long way
          round on a clip the playhead was nowhere near.

          So the button IS the answer to "is the playhead here": on this clip
          it is the transport, anywhere else it is the way of getting here.
          The pair never disagreed about where a clip begins because there is
          no pair now.

          `data-grid-play` / `data-grid-cue` still mark the two modes, so a
          selector for either finds the button exactly when it is that thing. */}
      <div
        style={artworkBottom === null ? undefined : { bottom: `${8 - artworkBottom}px` }}
        className={[
          // left-3.5 = the card's own 6px padding plus 8px, so it sits inside
          // the PICTURE's corner rather than on its edge.
          "pointer-events-none absolute left-3.5 z-20 flex items-center",
          artworkBottom === null ? "bottom-2" : "",
        ].join(" ")}
      >
        <button
          type="button"
          {...(onThisClip
            ? { "data-grid-play": nodeId as string }
            : { "data-grid-cue": nodeId as string })}
          aria-label={
            playingHere
              ? `Pause ${node.name}`
              : onThisClip
                ? `Play ${node.name} in the preview`
                : pointsBack
                  ? `Move the playhead back to the start of ${node.name}`
                  : `Move the playhead forward to the start of ${node.name}`
          }
          title={
            playingHere
              ? `Pause ${node.name}`
              : onThisClip
                ? `Play ${node.name} in the preview`
                : `Go to the start of ${node.name}`
          }
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            // Stopped, or the press also reaches the card underneath and
            // selects it — or, held a moment, starts a reorder drag.
            event.stopPropagation();
            if (playingHere) {
              initiator.claim(null);
              // Pause where it is, rather than rewinding: stopping to look at
              // a frame and being thrown back to the clip's start would make
              // the button useless for the thing you stop for.
              channel.setPlaying(false);
              return;
            }
            if (!onThisClip) {
              // CUE: the playhead moves to this clip's start and stops there.
              channel.set(card.start);
              return;
            }
            // ALWAYS FROM THIS CARD'S OWN START, even though the clock is
            // already inside it — "play this" means this clip from its
            // beginning, not "resume wherever the playhead happens to sit".
            //
            // SEEK, THEN START A FRAME LATER, and the frame is the whole
            // point. Both writes land in one React batch, so the pane received
            // the new time and `playing: true` together — and a controlled
            // player ignores an incoming time while it is playing, or it would
            // fight its own progress. The seek was dropped and playback ran
            // from wherever the pane already was: measured, pressing the third
            // card played from 0.0s instead of its 16.5s start. Letting the
            // seek land while the pane is still paused fixes it.
            initiator.claim(nodeId as string);
            channel.set(card.start);
            requestAnimationFrame(() => channel.setPlaying(true));
          }}
          className={discClass}
        >
          {playingHere ? (
            <Pause aria-hidden="true" className="size-3.5" fill="currentColor" />
          ) : onThisClip ? (
            // Nudged right: a triangle's optical centre is left of its box.
            <Play aria-hidden="true" className="size-3.5 translate-x-px" fill="currentColor" />
          ) : (
            /* TRANSITIONED, because the turn is the message. A glyph that
               simply appears facing the other way says the same thing without
               anyone noticing it changed; watching it swing is what teaches
               the rule. */
            <SkipForward
              aria-hidden="true"
              fill="currentColor"
              className={[
                "size-3.5 transition-transform duration-200 ease-out motion-reduce:transition-none",
                pointsBack ? "rotate-180" : "rotate-0",
              ].join(" ")}
            />
          )}
        </button>
      </div>
    </div>
  );
}

/**
 * Convenience for the board's `cellOverlay`, which hands over a raw id.
 *
 * NAMED, because eslint reads any arrow returning JSX as a component and
 * `react/display-name` is an ERROR in this repo — one that fails the Vercel
 * build while tsc and vitest stay green, so it has to be caught here.
 */
export function gridPlayButtonFor(channel: PreviewTimeChannel) {
  const CellPlayButton = (id: NodeId) => (
    <GraphGridPlayButton nodeId={parseNodeId(id as string)} channel={channel} />
  );
  CellPlayButton.displayName = "GridCellPlayButton";
  return CellPlayButton;
}
