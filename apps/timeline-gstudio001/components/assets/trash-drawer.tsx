"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import {
  Trash2,
  Undo2,
  X,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { usePathname } from "next/navigation";

import { Button } from "@/components/core/button";
import { toast } from "@/components/core/sonner";
import { trashRowCaption } from "@/lib/trash-provenance";
import { groupTrashClips } from "@/lib/trash-groups";
import { discardTrashClips } from "@/lib/graph-trash-discard";
import { graphDocumentsGateway } from "@/lib/graph-documents-gateway";
import { useAuth } from "@/components/auth/auth-provider";
import {
  GRAPH_RESTORE_RESULT_EVENT,
  announceGraphTrashEmptied,
  isGraphViewRoute,
  requestGraphRestoreItem,
  type GraphRestoreResultDetail,
} from "@/lib/graph-view-events";
import type { TimelineClip } from "@storyboard/ui/timeline/types";

type TrashDrawerProps = {
  isOpen: boolean;
  onClose: () => void;
};

// "Am I on the client?" as an external-store read: the server snapshot says
// no, the client snapshot says yes, and nothing ever notifies — React swaps
// the value at hydration. Replaces the setIsMounted(true)-in-an-effect flag,
// which cost an extra post-mount render.
const emptySubscribe = () => () => {};
const useIsMounted = () =>
  useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );

export function TrashDrawer({ isOpen, onClose }: TrashDrawerProps) {
  const { user } = useAuth();
  const [clips, setClips] = useState<TimelineClip[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isMounted = useIsMounted();

  // Opening resets the loading/error surface DURING the render that opens
  // (the documented adjust-state-on-prop-change pattern), so the spinner is
  // up before the fetch below even starts — the effect itself then only
  // touches state from the request's own callbacks.
  const [prevOpen, setPrevOpen] = useState(isOpen);
  if (isOpen !== prevOpen) {
    setPrevOpen(isOpen);
    if (isOpen && user) {
      setIsLoading(true);
      setError(null);
    }
  }

  // Pure request: resolves to the trash clips and never touches state, so
  // the open effect can consume it through promise CALLBACKS — state changes
  // only when the request answers, never synchronously in the effect body.
  const requestTrashClips = useCallback(async (uid: string): Promise<TimelineClip[]> => {
    const trashId = `trash-${uid}`;
    const response = await fetch(`/api/timelines/${encodeURIComponent(trashId)}`, {
      cache: "no-store",
    });
    if (!response.ok) return [];
    const result = await response.json();
    return result.document?.clips || [];
  }, []);

  useEffect(() => {
    if (!isOpen || !user) return;
    let cancelled = false;
    requestTrashClips(user.uid)
      .then((next) => {
        if (cancelled) return;
        setClips(next);
        setError(null);
      })
      .catch((err: unknown) => {
        console.error(err);
        if (!cancelled) setError("Failed to load trash items.");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, user, requestTrashClips]);

  // RESTORE puts an item back into the timeline the user is looking at — which
  // is also how they choose the destination: navigate there, then restore. The
  // move itself is a graph command, and the graph lives in the route tree, so
  // the drawer asks across the window-event seam and waits for the answer
  // before dropping the row. Off-graph there is no graph to restore INTO, so
  // the control isn't offered at all rather than failing on click.
  const pathname = usePathname();
  const canRestore = isGraphViewRoute(pathname);
  const focusedName = "the open timeline";
  // A SET, not one id: "Restore all" puts several in flight at once, and a
  // single slot would leave every button but the last looking idle.
  const [restoringIds, setRestoringIds] = useState<readonly string[]>([]);

  const uid = user?.uid;
  useEffect(() => {
    const onResult = (event: Event) => {
      const detail = (event as CustomEvent<GraphRestoreResultDetail>).detail;
      if (!detail) return;
      setRestoringIds((current) => current.filter((id) => id !== detail.clipId));
      if (detail.ok) {
        // Drop ONE row for that clip id — the bin can hold the same id more
        // than once and the graph restored exactly one of them. The updater
        // computes the index itself rather than closing over a "did I remove
        // one yet" flag: React may invoke an updater more than once, and a
        // flag that survives between invocations made the second pass remove
        // nothing, leaving the restored row on screen.
        const duplicates = addedGroupRef.current.get(detail.clipId) ?? [];
        addedGroupRef.current.delete(detail.clipId);
        setClips((current) => {
          // Drop the clip that was added, plus the duplicates that came with
          // its row — the row stood for one image and that image is now taken.
          const doomed = new Set([detail.clipId, ...duplicates]);
          const kept: TimelineClip[] = [];
          const removedOnce = new Set<string>();
          for (const clip of current) {
            // One removal per id: the bin can hold the same id twice, and only
            // as many as this row accounted for may go.
            if (doomed.has(clip.id) && !removedOnce.has(clip.id)) {
              removedOnce.add(clip.id);
              continue;
            }
            kept.push(clip);
          }
          return kept;
        });
        // The add moved ONE clip out of the bin through the graph; these never
        // move anywhere, so they need a real discard — which has to wait for
        // the graph's own (debounced) trash write to land first, or it gets
        // overwritten by it. See lib/graph-trash-discard.ts.
        if (duplicates.length > 0 && uid) {
          void discardTrashClips(duplicates, `trash-${uid}`, graphDocumentsGateway);
        }
      }
      // Sonner, like every other surface in the app. This used to dispatch a
      // bespoke `gstudio-toast` event that the sidebar rendered as its own
      // fixed pill — see the commit that removed it: the sidebar has
      // `backdrop-filter`, which makes it a containing block for `position:
      // fixed`, so that pill resolved `left: 50%` against a 72px rail and
      // hung half off the left edge of the screen.
      toast(detail.message, { id: `trash-restore-${detail.clipId}` });
    };
    window.addEventListener(GRAPH_RESTORE_RESULT_EVENT, onResult);
    return () => window.removeEventListener(GRAPH_RESTORE_RESULT_EVENT, onResult);
  }, [uid]);

  const handleRestore = (clipId: string) => {
    setRestoringIds((current) => [...current, clipId]);
    requestGraphRestoreItem(clipId);
  };

  /**
   * Add the row's image to whatever timeline is open, and clear it from the
   * bin entirely.
   *
   * This was never "put it back where it came from" — the graph inserts at
   * `resolveInsertPlacement`, i.e. into the FOCUSED timeline — but calling it
   * Restore implied otherwise. The bin is a place you take images from; where
   * they land is wherever you are.
   *
   * The bin holds one row per IMAGE. How many clips happen to back that row
   * is bookkeeping the user never asked about, so taking the image takes ALL
   * of them: one copy is added, and any duplicates are discarded rather than
   * left behind as a row that looks unchanged after you just used it.
   *
   * The discard is deliberately AFTER the add succeeds. If the add is refused
   * (no graph, an un-hydrated target), nothing has been taken and nothing may
   * be thrown away.
   */
  const addedGroupRef = useRef(new Map<string, readonly string[]>());
  const handleAddToTimeline = (group: { key: string; clips: readonly TimelineClip[] }) => {
    const [first, ...duplicates] = group.clips;
    if (!first) return;
    addedGroupRef.current.set(
      first.id,
      duplicates.map((clip) => clip.id),
    );
    handleRestore(first.id);
  };

  const handleEmptyTrash = async () => {
    // Says what actually happens: the BIN entries go (with no restore path,
    // so it really is permanent), while the uploads behind them stay in the
    // Assets library and can be placed again. The old wording promised a
    // blanket "permanently delete", which read as losing the files too.
    const confirmed = window.confirm(
      `Empty the trash? The ${clips.length} item${clips.length === 1 ? "" : "s"} in the bin will be removed and cannot be restored. Your uploaded files stay in the Assets library.`
    );
    if (!confirmed) return;

    setIsLoading(true);
    try {
      const response = await fetch("/api/trash", { method: "DELETE" });
      if (!response.ok) throw new Error("Failed to empty trash.");

      setClips([]);

      // A graph view mounted behind this drawer still holds every one of
      // those items as nodes under its trash root, and would write them back
      // on the next commit that touches the trash. Tell it to rebuild.
      announceGraphTrashEmptied();

      toast("Trash bin emptied.", { id: "trash-emptied" });
    } catch (err) {
      console.error(err);
      setError("Unable to empty trash.");
    } finally {
      setIsLoading(false);
    }
  };

  if (!isMounted || !isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40">
      <div className="fixed inset-0" onClick={onClose} />
      {/* `relative` is load-bearing, not cosmetic: the click-to-close backdrop
          above is POSITIONED and this panel was static, and a positioned
          sibling paints over a static one whatever the DOM order. The backdrop
          therefore covered the panel's own controls — every click inside the
          drawer hit the backdrop and closed it, which is why Empty Trash
          "did nothing". Positioning the panel puts it back on top. */}
      <div className="asset-library-panel pointer-events-auto relative ml-[72px] flex max-h-[48vh] flex-col border-t border-zinc-800 bg-zinc-950 text-white shadow-2xl shadow-black/50">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-zinc-800 px-5 py-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-zinc-50 flex items-center gap-2">
              <Trash2 className="h-4 w-4 text-red-400" />
              Trash Bin
            </h2>
            <p className="mt-0.5 text-xs text-zinc-500">
              {clips.length} items in trash
            </p>
          </div>

          <div className="flex items-center gap-2">
            {clips.length > 0 && (
              <Button
                type="button"
                variant="outline"
                onClick={handleEmptyTrash}
                className="text-xs border-red-500/30 text-red-400 hover:bg-red-500/10 h-8 px-3 cursor-pointer"
              >
                Empty Trash
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              size="icon"
              // An icon-only control needs a name: this one had none, so it
              // reached assistive tech (and tests) as an anonymous button.
              aria-label="Close trash"
              title="Close"
              onClick={onClose}
              className="size-8 border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-200 cursor-pointer"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto min-h-0 bg-zinc-950">
          {isLoading ? (
            <div className="flex h-32 items-center justify-center gap-2 text-sm text-zinc-400">
              <Loader2 className="h-4 w-4 animate-spin text-amber-500" />
              Loading trash...
            </div>
          ) : error ? (
            <div className="flex h-32 items-center justify-center gap-2 text-sm text-red-400">
              <AlertCircle className="h-4 w-4" />
              {error}
            </div>
          ) : clips.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-zinc-500">
              <Trash2 className="h-10 w-10 stroke-[1.2] mb-2 text-zinc-600" />
              <span className="text-sm font-medium">Trash is empty</span>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 p-5">
              {groupTrashClips(clips).map((group, index) => {
                // The row stands for the IMAGE, not one clip: every field it
                // paints comes from the first copy, which is safe precisely
                // because copies of one asset share them.
                const clip = group.clips[0];
                const busy = group.clips.some((entry) => restoringIds.includes(entry.id));
                // `title` lives only on a COLLECTION clip, so it needs the
                // discriminant to reach — media clips fall straight through to
                // `alt`. Computed once: the visible label and the button's
                // accessible name must not be able to drift apart.
                const label =
                  (clip.kind === "collection" ? clip.title : undefined) || clip.alt || "Clip";
                return (
                <div
                  // Keyed by SLOT as well as identity: the trash document can
                  // legitimately hold the same id more than once (the legacy
                  // views mint stable per-asset clip ids, so one asset trashed
                  // from two timelines arrives twice — the graph's own
                  // hydration demotes such collisions for the same reason).
                  // An id key made React log a duplicate-key error per repeat
                  // and drop cards from the grid.
                  key={`${index}-${group.key}`}
                  className="relative group rounded-lg overflow-hidden border border-zinc-900 bg-zinc-900/20 p-2 hover:border-zinc-800 transition-colors"
                >
                  <div className="aspect-video relative rounded bg-black/60 overflow-hidden flex items-center justify-center border border-zinc-800/40">
                    {clip.kind === "video" ? (
                      <>
                        <img
                          src={clip.poster || clip.src}
                          alt={clip.alt}
                          className="w-full h-full object-cover opacity-80"
                        />
                        <span className="absolute bottom-1 right-1 bg-black/80 px-1 py-0.5 rounded text-[8px] text-zinc-300 font-semibold font-mono tracking-wider">
                          VIDEO
                        </span>
                      </>
                    ) : clip.kind === "image" ? (
                      <img
                        src={clip.src}
                        alt={clip.alt}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="flex flex-col items-center gap-1.5 p-2 text-center">
                        <Trash2 className="h-5 w-5 text-zinc-500" />
                        <span className="text-[9px] text-zinc-400 font-bold uppercase tracking-wider">
                          Collection
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="mt-2 flex min-w-0 items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-semibold text-zinc-200">
                        {label}
                      </p>
                      {/* Where it came from and when it went. Two clips can be
                          identical in every field the drawer paints — same
                          name, same thumbnail, same duration — because placing
                          one asset twice is ordinary and duplicating a clip
                          copies its src verbatim. This caption is the only
                          thing that tells those rows apart. Absent on clips
                          trashed before it was recorded, and the row then
                          simply prints nothing rather than an empty line. */}
                      {trashRowCaption(clip.trashedFrom, clip.trashedAt) && (
                        <p className="truncate text-[10px] text-zinc-500">
                          {trashRowCaption(clip.trashedFrom, clip.trashedAt)}
                        </p>
                      )}
                    </div>
                    {canRestore && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={() => handleAddToTimeline(group)}
                        title={`Add to ${focusedName}`}
                        aria-label={`Add ${label} to ${focusedName}`}
                        className="h-6 shrink-0 border-zinc-800 px-2 text-[10px] text-zinc-300 hover:border-sky-500/50 hover:text-sky-300 cursor-pointer"
                      >
                        <Undo2 className="mr-1 h-3 w-3" />
                        Add
                      </Button>
                    )}
                  </div>
                </div>
                );
              })}
            </div>
          )}
        </main>
      </div>
    </div>,
    document.body
  );
}
