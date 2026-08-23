"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, X } from "lucide-react";

import { useCollectionsStore, type NodeId } from "@storyboard/ui/dnd-collections";
import { graphChildrenToClips } from "@storyboard/timeline-domain";
import { MAX_TAGS_PER_CLIP, MAX_TAG_LENGTH, normalizeTags } from "@storyboard/timeline-model/tags";

import { graphDocumentsGateway } from "@/lib/graph-documents-gateway";
import { isTagWriteRefusal, planTagWrite } from "@/lib/tag-write-plan";

import { JUDGEMENT_TAGS, TAG_FACT, TAG_JUDGEMENT } from "./graph-details-design";
import { useClipDetail, useGraphDetailsStore } from "./graph-details-context";

// Editing tags is the ONE mutation in this view that does not go through a
// graph command, and everything odd about this file follows from that.
//
// Tags live on the detail side-table because the engine does not model them.
// `detailsStore.merge()` notifies its own subscribers and NOTHING else — it
// produces no CollectionsPatch, so `store.subscribeToChanges` never fires and
// PersistenceBridge never writes. An editor that merged and stopped would look
// completely correct: the chips update, the card re-renders, and the change is
// gone on reload. So this does the bridge's job explicitly, in the same order
// the bridge does it: merge first, then project the parent from the MERGED
// details and hand it to the gateway.
//
// Consequence worth knowing: a tag edit is NOT undoable. `useScopedHistory` in
// the details modal whitelists `update-media` / `rename-node` /
// `set-node-disabled`, and a change with no command adds no history entry at
// all. Making tags undoable would mean making them a graph command, which would
// put them in the engine — the thing the side-table exists to avoid.

/** Persist a tag change for one node, and report whether it landed. */
export function useSetTags(nodeId: NodeId) {
  const store = useCollectionsStore();
  const detailsStore = useGraphDetailsStore();

  return useCallback(
    (next: readonly string[]) => {
      const graph = store.getSnapshot().graph;
      const plan = planTagWrite(graph, detailsStore.read(), nodeId, next);
      if (isTagWriteRefusal(plan)) return false;

      // MERGE FIRST. The projection below reads the details side-table, so
      // writing in the other order would persist the clip as it was and leave
      // the new tags in memory only — the same ordering bug the restore path
      // hit (see graph-item-actions).
      detailsStore.merge({ [nodeId as string]: plan.detail });

      // The SAME filters PersistenceBridge applies. A document nobody has
      // loaded, an un-hydrated placeholder, or a conflicted one would each be
      // refused by `writeClips` anyway; checking here keeps us from reporting
      // a write that did not happen.
      const current = detailsStore.read();
      if (
        graphDocumentsGateway.peek(plan.parentId) === null ||
        current[plan.parentId]?.hydrated === false ||
        graphDocumentsGateway.isConflicted(plan.parentId)
      ) {
        return false;
      }
      graphDocumentsGateway.writeClips(
        plan.parentId,
        graphChildrenToClips(graph, current, plan.parentId),
      );
      return true;
    },
    [nodeId, store, detailsStore],
  );
}

/**
 * Add and remove a clip's tags.
 *
 * Chips commit individually — a chip's remove button and the add field are
 * separate controls, so this deliberately does NOT commit the text input on
 * blur the way InlineNameEditor does. Clicking a remove button blurs the input,
 * and a blur-commit would fire the add path with whatever half-typed text was
 * sitting there at the same moment the remove fired.
 */
export function TagEditor({ nodeId }: Readonly<{ nodeId: NodeId }>) {
  const detail = useClipDetail(nodeId as string);
  const setTags = useSetTags(nodeId);
  const [draft, setDraft] = useState("");
  const tags = detail?.tags ?? [];
  const full = tags.length >= MAX_TAGS_PER_CLIP;

  const add = () => {
    const candidate = draft.trim();
    if (candidate.length === 0 || full) return;
    // Round-trip through the same normalizer the store uses, so a duplicate
    // differing only in case is dropped here rather than silently disappearing
    // on save.
    const next = normalizeTags([...tags, candidate]);
    if (next.length !== tags.length) setTags(next);
    setDraft("");
  };

  // THE ADD FIELD IS BEHIND AN ICON, not a row of its own.
  //
  // A permanently open text field costs a full row on every panel whether or
  // not anyone is tagging anything, and on a strip of nine panels that is nine
  // rows of empty input. Adding a tag is occasional; the tags themselves are
  // what you want to see. So the chips and the add control share one row, and
  // the field appears when it is asked for.
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Dismiss on a press ANYWHERE else. Captured, so it still fires for presses
  // the panel below stops from bubbling — this modal deliberately swallows
  // pointerdown on its panels so a stray click cannot close it.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (popoverRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [open]);

  // Focus follows the opening, or the icon would only have revealed a field
  // you then have to click.
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const commit = () => {
    add();
    inputRef.current?.focus();
  };

  return (
    <div className="relative flex items-center gap-1.5" data-tag-editor>
      {/* NO EMPTY-STATE SENTENCE. The field below it says "Add a tag…" in
            its own placeholder, so the line was telling you what the control
            already tells you — and in the details strip it appeared once per
            panel, up to nine times on one screen, which is how a helpful
            sentence turns into noise. An empty row of chips reads as empty
            without being told. */}
        {/* THE CHIPS SCROLL; THE CONTROLS DO NOT.

            ONE LINE, ALWAYS, so this row's height cannot change with the
            number of tags. The panel above hangs its filmstrip on that being
            true: the three cards share a bottom edge, so anything of varying
            height below the strip moves one card's strip off the line the
            other two are on. Wrapping was the alternative, and wrapping is
            exactly what broke it.

            THE `+` BUTTON AND ITS POPOVER STAY OUTSIDE THIS BOX. An overflow
            container clips on BOTH axes — `overflow-x: auto` makes the block
            direction `auto` too — so a popover anchored inside one opens into
            a scroll box a few pixels tall and is never seen. That is the
            whole reason the chips are wrapped here rather than the row.

            NOT `flex-1`. Grown to fill, an EMPTY scroller takes the whole row
            and strands the `+` button against the far edge of the card, yards
            from the chips it appends to. Shrink-only leaves it hugging its
            content and still scrolling once there is too much. */}
        <div className="flex min-w-0 items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {tags.map((tag) => (
          <span
            key={tag}
            data-tag-chip={tag}
            // ONE CHIP IN THE ROW MEANS SOMETHING DIFFERENT. Most tags
            // say what the clip IS — its scene, its model, its prompt
            // version — and those are facts, all equal, all grey. A tag
            // like `keeper` says what somebody DECIDED, and that is the
            // one thing on the card worth finding without reading. Amber
            // rather than blue or red: both of those already mean
            // something exact here, and a judgement is neither editable
            // data nor the playhead.
            className={[
              "flex shrink-0 items-center gap-1 rounded py-0.5 pr-0.5 pl-1.5",
              "text-[11px] leading-none font-medium ring-1",
              JUDGEMENT_TAGS.has(tag) ? TAG_JUDGEMENT : TAG_FACT,
            ].join(" ")}
          >
            {tag}
            <button
              type="button"
              aria-label={`Remove tag ${tag}`}
              title={`Remove ${tag}`}
              onClick={() => setTags(tags.filter((candidate) => candidate !== tag))}
              className="flex size-4 items-center justify-center rounded-sm text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-zinc-100 focus-visible:ring-2 focus-visible:ring-sky-500/70 focus-visible:outline-none"
            >
              <X aria-hidden="true" className="size-3" />
            </button>
          </span>
        ))}
        </div>

        {/* AT THE END OF THE TAGS, which is where the next one would go. A
            control that adds to a list belongs at the end of that list; parked
            on its own row underneath it reads as a separate thing that happens
            to be nearby. */}
        <button
          ref={triggerRef}
          type="button"
          disabled={full}
          aria-label={full ? `Limit of ${MAX_TAGS_PER_CLIP} tags reached` : "Add a tag"}
          aria-expanded={open}
          title={full ? `Limit of ${MAX_TAGS_PER_CLIP} tags reached` : "Add a tag"}
          data-tag-add
          onClick={() => setOpen((was) => !was)}
          // DASHED, because it is a SLOT rather than a chip. Drawn solid
          // it was a sixth tag in a row of five, and the eye had to read
          // the glyph to find out it was not one. A broken outline says
          // empty-and-fillable before anything is read.
          className="flex size-5 shrink-0 items-center justify-center rounded border border-dashed border-white/20 text-zinc-500 transition-colors hover:border-white/30 hover:bg-white/5 hover:text-zinc-100 focus-visible:ring-2 focus-visible:ring-sky-500/70 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Plus aria-hidden="true" className="size-3" />
        </button>

        {open && (
          <div
            ref={popoverRef}
            data-tag-popover
            className="absolute top-full left-0 z-20 mt-1 w-44 rounded-md border border-zinc-700 bg-zinc-900 p-1.5 shadow-xl shadow-black/60"
          >
            <input
              ref={inputRef}
              type="text"
              value={draft}
              maxLength={MAX_TAG_LENGTH}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                // STOPPED HERE, ALL OF IT. This field lives inside a dialog
                // that reads keys for its own shortcuts; letting them through
                // means typing a tag drives the modal.
                event.stopPropagation();
                if (event.key === "Escape") {
                  event.preventDefault();
                  setOpen(false);
                  triggerRef.current?.focus();
                  return;
                }
                // Enter commits; comma too, because typing a list is the
                // natural gesture and a comma inside a single tag has no
                // meaning here. The popover STAYS OPEN either way — tags
                // arrive in threes more often than singly, and reopening
                // between them is the annoying part.
                if (event.key === "Enter" || event.key === ",") {
                  event.preventDefault();
                  commit();
                  return;
                }
                // Backspace on an empty field removes the last chip — the
                // standard token-field gesture, and the only keyboard route to
                // removal that does not require tabbing through every chip.
                if (event.key === "Backspace" && draft.length === 0 && tags.length > 0) {
                  event.preventDefault();
                  setTags(tags.slice(0, -1));
                }
              }}
              aria-label="Add a tag"
              placeholder="Add a tag…"
              className="w-full rounded-sm bg-zinc-950 px-2 py-1 text-[11px] text-zinc-100 ring-1 ring-white/10 outline-none placeholder:text-zinc-600 focus:ring-sky-500/70"
            />
          </div>
        )}
    </div>
  );
}
