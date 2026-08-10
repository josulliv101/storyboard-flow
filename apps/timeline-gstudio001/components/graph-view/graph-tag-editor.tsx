"use client";

import { useCallback, useState } from "react";
import { X } from "lucide-react";

import { useCollectionsStore, type NodeId } from "@storyboard/ui/dnd-collections";
import { graphChildrenToClips } from "@storyboard/timeline-domain";
import { MAX_TAGS_PER_CLIP, MAX_TAG_LENGTH, normalizeTags } from "@storyboard/timeline-model/tags";

import { graphDocumentsGateway } from "@/lib/graph-documents-gateway";
import { isTagWriteRefusal, planTagWrite } from "@/lib/tag-write-plan";

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

  return (
    <div className="flex flex-col gap-2" data-tag-editor>
      <div className="flex flex-wrap items-center gap-1.5">
        {tags.length === 0 && (
          <span className="text-[11px] text-zinc-500">
            No tags yet — label this clip to find it again later.
          </span>
        )}
        {tags.map((tag) => (
          <span
            key={tag}
            data-tag-chip={tag}
            className="flex items-center gap-1 rounded bg-zinc-800 py-0.5 pr-0.5 pl-1.5 text-[11px] leading-none font-medium text-zinc-200 ring-1 ring-white/10"
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
      <input
        type="text"
        value={draft}
        disabled={full}
        maxLength={MAX_TAG_LENGTH}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          // Enter commits; comma too, because typing a list is the natural
          // gesture and a comma inside a single tag has no meaning here.
          if (event.key === "Enter" || event.key === ",") {
            event.preventDefault();
            add();
            return;
          }
          // Backspace on an empty field removes the last chip — the standard
          // token-field gesture, and the only keyboard route to removal that
          // does not require tabbing through every chip.
          if (event.key === "Backspace" && draft.length === 0 && tags.length > 0) {
            event.preventDefault();
            setTags(tags.slice(0, -1));
          }
        }}
        aria-label="Add a tag"
        placeholder={full ? `Limit of ${MAX_TAGS_PER_CLIP} tags reached` : "Add a tag…"}
        className="w-full rounded-sm bg-zinc-900 px-2 py-1 text-[11px] text-zinc-100 ring-1 ring-white/10 outline-none placeholder:text-zinc-600 focus:ring-sky-500/70 disabled:cursor-not-allowed disabled:text-zinc-500"
      />
    </div>
  );
}
