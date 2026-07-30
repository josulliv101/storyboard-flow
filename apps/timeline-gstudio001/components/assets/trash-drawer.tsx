"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import {
  Trash2,
  Undo2,
  X,
  LoaderCircle,
  CircleAlert,
} from "lucide-react";
import { usePathname } from "next/navigation";

import { Button } from "@/components/core/button";
import { toast } from "@/components/core/sonner";
import { deletionWindowLabel } from "@/lib/asset-deletion-window";
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

/**
 * An uploaded file marked for deletion, as `/api/assets/marked` serves it.
 *
 * Every field is a SNAPSHOT taken when the mark was written — there is no clip
 * left pointing at this asset, which is precisely why it is marked, so nothing
 * here can be re-derived and none of it is a lookup key.
 */
type MarkedAsset = {
  providerId: string;
  assetId: string;
  kind: "image" | "video";
  name: string;
  thumbnailUrl: string;
  markedAtMs: number;
  deleteAfterMs: number;
};

const markedAssetKey = (asset: MarkedAsset) => `${asset.providerId}|${asset.assetId}`;

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

  // The marked assets are a SEPARATE request with a separate failure: the bin
  // is the drawer's job and this section is an addition to it, so a marked-list
  // that fails to load leaves the bin working and simply shows nothing. One
  // combined error surface would let a broken side-panel hide the trash.
  const [marked, setMarked] = useState<readonly MarkedAsset[]>([]);
  const [keepingKeys, setKeepingKeys] = useState<readonly string[]>([]);

  useEffect(() => {
    if (!isOpen || !user) return;
    let cancelled = false;
    fetch("/api/assets/marked", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : { assets: [] }))
      .then((result: { assets?: MarkedAsset[] }) => {
        if (!cancelled) setMarked(result.assets ?? []);
      })
      .catch((err: unknown) => {
        console.error(err);
        if (!cancelled) setMarked([]);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, user]);

  /** Withdraw the mark. The file never moved, so this is bookkeeping — no
   *  re-upload, and nothing returns to a timeline. */
  const handleKeep = async (asset: MarkedAsset) => {
    const key = markedAssetKey(asset);
    setKeepingKeys((current) => [...current, key]);
    try {
      const response = await fetch("/api/assets/marked", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assets: [{ providerId: asset.providerId, assetId: asset.assetId }],
        }),
      });
      if (!response.ok) throw new Error("Failed to keep asset.");
      setMarked((current) => current.filter((entry) => markedAssetKey(entry) !== key));
      toast(`Keeping ${asset.name}.`, { id: `asset-kept-${key}` });
    } catch (err) {
      console.error(err);
      // The row stays, which is the truthful outcome: the mark is still there.
      toast("Unable to keep that file.", { id: `asset-keep-failed-${key}` });
    } finally {
      setKeepingKeys((current) => current.filter((entry) => entry !== key));
    }
  };

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
    // Says what actually happens, and it changed with PL12-003: an upload that
    // nothing else points at is now MARKED, and deleted for real 30 days later
    // (a file still used by a clip on a board is never marked, and a marked one
    // is spared the moment it is used again). The previous wording — "your
    // uploaded files stay in the Assets library" — became a promise this app no
    // longer keeps, which is worse than the blanket "permanently delete" it had
    // replaced.
    const confirmed = window.confirm(
      `Empty the trash? The ${clips.length} item${clips.length === 1 ? "" : "s"} in the bin will be removed and cannot be restored. Uploaded files that nothing else uses are deleted after 30 days.`
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
              <LoaderCircle className="h-4 w-4 animate-spin text-amber-500" />
              Loading trash...
            </div>
          ) : error ? (
            <div className="flex h-32 items-center justify-center gap-2 text-sm text-red-400">
              <CircleAlert className="h-4 w-4" />
              {error}
            </div>
          ) : clips.length === 0 && marked.length === 0 ? (
            // Only when BOTH are empty. A bin with nothing in it but files on
            // their way out is not an empty drawer, and saying so would hide
            // the one thing here anybody still has a decision to make about.
            <div className="flex flex-col items-center justify-center py-16 text-zinc-500">
              <Trash2 className="h-10 w-10 stroke-[1.2] mb-2 text-zinc-600" />
              <span className="text-sm font-medium">Trash is empty</span>
            </div>
          ) : (
            <>
            {clips.length > 0 && (
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

            {marked.length > 0 && (
              <section
                aria-labelledby="trash-recently-deleted"
                // Bordered off from the bin above it, because these two lists
                // answer different questions: what did I delete (and can put
                // back), versus what is about to stop existing.
                className={clips.length > 0 ? "border-t border-zinc-900" : undefined}
              >
                <header className="px-5 pt-4">
                  <h3
                    id="trash-recently-deleted"
                    className="text-xs font-semibold text-zinc-300"
                  >
                    Recently deleted files
                  </h3>
                  <p className="mt-0.5 text-[11px] text-zinc-500">
                    {marked.length} uploaded file{marked.length === 1 ? "" : "s"} nothing
                    uses any more. They stay in your library until they are deleted, and
                    keeping one stops the clock.
                  </p>
                </header>
                <ul className="grid grid-cols-2 gap-3 p-5 md:grid-cols-3 lg:grid-cols-4">
                  {marked.map((asset) => {
                    const key = markedAssetKey(asset);
                    const busy = keepingKeys.includes(key);
                    return (
                      <li
                        key={key}
                        className="flex min-w-0 items-center gap-3 rounded-lg border border-zinc-900 bg-zinc-900/20 p-2"
                      >
                        <div className="relative size-12 shrink-0 overflow-hidden rounded border border-zinc-800/40 bg-black/60">
                          {asset.thumbnailUrl ? (
                            // The file is still there for the whole window, so
                            // its own URL keeps resolving right up until it
                            // doesn't — no provider round trip to render this.
                            <img
                              src={asset.thumbnailUrl}
                              alt=""
                              className="h-full w-full object-cover opacity-80"
                            />
                          ) : (
                            <span className="flex h-full w-full items-center justify-center text-[8px] font-semibold uppercase tracking-wider text-zinc-500">
                              {asset.kind}
                            </span>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-semibold text-zinc-200">
                            {asset.name}
                          </p>
                          <p className="truncate text-[10px] text-zinc-500">
                            {deletionWindowLabel(asset.deleteAfterMs)}
                          </p>
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={busy}
                          onClick={() => handleKeep(asset)}
                          // The visible word is "Keep"; the accessible name
                          // says WHICH, because a column of identical buttons
                          // announces nothing otherwise.
                          aria-label={`Keep ${asset.name}`}
                          className="h-6 shrink-0 border-zinc-800 px-2 text-[10px] text-zinc-300 hover:border-sky-500/50 hover:text-sky-300 cursor-pointer"
                        >
                          {busy ? (
                            <LoaderCircle className="h-3 w-3 animate-spin" />
                          ) : (
                            "Keep"
                          )}
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}
            </>
          )}
        </main>
      </div>
    </div>,
    document.body
  );
}
