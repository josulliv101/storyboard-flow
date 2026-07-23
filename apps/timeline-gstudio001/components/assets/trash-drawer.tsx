"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
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
  const [restoringId, setRestoringId] = useState<string | null>(null);

  useEffect(() => {
    const onResult = (event: Event) => {
      const detail = (event as CustomEvent<GraphRestoreResultDetail>).detail;
      if (!detail) return;
      setRestoringId((current) => (current === detail.clipId ? null : current));
      if (detail.ok) {
        // Drop ONE row for that clip id — the bin can hold the same id more
        // than once and the graph restored exactly one of them. The updater
        // computes the index itself rather than closing over a "did I remove
        // one yet" flag: React may invoke an updater more than once, and a
        // flag that survives between invocations made the second pass remove
        // nothing, leaving the restored row on screen.
        setClips((current) => {
          const index = current.findIndex((clip) => clip.id === detail.clipId);
          if (index === -1) return current;
          return [...current.slice(0, index), ...current.slice(index + 1)];
        });
      }
      window.dispatchEvent(
        new CustomEvent("gstudio-toast", { detail: { message: detail.message } }),
      );
    };
    window.addEventListener(GRAPH_RESTORE_RESULT_EVENT, onResult);
    return () => window.removeEventListener(GRAPH_RESTORE_RESULT_EVENT, onResult);
  }, []);

  const handleRestore = (clipId: string) => {
    setRestoringId(clipId);
    requestGraphRestoreItem(clipId);
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

      window.dispatchEvent(
        new CustomEvent("gstudio-toast", {
          detail: { message: "Trash bin emptied successfully" }
        })
      );
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
              {clips.map((clip, index) => (
                <div
                  // Keyed by SLOT, not by clip id: the trash document can
                  // legitimately hold the same id more than once (the legacy
                  // views mint stable per-asset clip ids, so one asset trashed
                  // from two timelines arrives twice — the graph's own
                  // hydration demotes such collisions for the same reason).
                  // An id key made React log a duplicate-key error per repeat
                  // and drop cards from the grid.
                  key={`${index}-${clip.id}`}
                  className="relative group rounded-lg overflow-hidden border border-zinc-900 bg-zinc-900/20 p-2 hover:border-zinc-800 transition-colors"
                >
                  <div className="aspect-video relative rounded bg-black/60 overflow-hidden flex items-center justify-center border border-zinc-800/40">
                    {clip.kind === "video" ? (
                      <>
                        <img
                          src={(clip as any).poster || (clip as any).src}
                          alt={clip.alt}
                          className="w-full h-full object-cover opacity-80"
                        />
                        <span className="absolute bottom-1 right-1 bg-black/80 px-1 py-0.5 rounded text-[8px] text-zinc-300 font-semibold font-mono tracking-wider">
                          VIDEO
                        </span>
                      </>
                    ) : clip.kind === "image" ? (
                      <img
                        src={(clip as any).src}
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
                    <p className="min-w-0 flex-1 truncate text-xs font-semibold text-zinc-200">
                      {(clip as any).title || clip.alt || "Clip"}
                    </p>
                    {canRestore && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={restoringId === clip.id}
                        onClick={() => handleRestore(clip.id)}
                        title={`Restore into ${focusedName}`}
                        aria-label={`Restore ${(clip as any).title || clip.alt || "clip"}`}
                        className="h-6 shrink-0 border-zinc-800 px-2 text-[10px] text-zinc-300 hover:border-sky-500/50 hover:text-sky-300 cursor-pointer"
                      >
                        <Undo2 className="mr-1 h-3 w-3" />
                        Restore
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </main>
      </div>
    </div>,
    document.body
  );
}
