"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, Fragment } from "react";
import { createPortal } from "react-dom";
import {
  AlertCircle,
  RefreshCw,
  X,
  ArrowLeft,
} from "lucide-react";

import { Button } from "@/components/core/button";
import { SmoothScrollList } from "@/components/timeline/smooth-scroll-list";
import { cn } from "@/lib/utils";
import type { TimelineClip } from "@storyboard/ui/timeline/types";
import { useAuth } from "@/components/auth/auth-provider";
import { getTimelinePath, getTimelineDocument } from "@storyboard/ui/timeline/timeline-documents";

type CloudinaryAsset = {
  id: string;
  pathname: string;
  url: string;
  thumbnailUrl: string;
  resourceType: "image" | "video";
  format?: string;
  width?: number;
  height?: number;
  size?: number;
  createdAt?: string;
};

type AssetLibraryDrawerProps = {
  isOpen: boolean;
  onClose: () => void;
};

function getAssetName(pathname: string) {
  return pathname.split("/").pop() || pathname;
}

function createAssetClip(asset: CloudinaryAsset, index: number, startTime: number): TimelineClip {
  const name = getAssetName(asset.pathname);
  const aspect =
    asset.width && asset.height && asset.height > 0
      ? asset.width / asset.height
      : 16 / 9;
  const duration = asset.resourceType === "video" ? 6 : 4;
  const stableId = `asset-${asset.id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;

  if (asset.resourceType === "video") {
    return {
      id: stableId,
      index,
      kind: "video",
      src: asset.url,
      poster: asset.thumbnailUrl,
      alt: name,
      aspect,
      trackIndex: 0,
      startTime,
      duration,
      sourceDuration: duration,
      trimIn: 0,
      trimOut: 0,
    };
  }

  return {
    id: stableId,
    index,
    kind: "image",
    src: asset.url,
    alt: name,
    aspect,
    trackIndex: 0,
    startTime,
    duration,
    sourceDuration: duration,
    trimIn: 0,
    trimOut: 0,
  };
}

export function AssetLibraryDrawer({ isOpen, onClose }: AssetLibraryDrawerProps) {
  const { user } = useAuth();
  const panelRef = useRef<HTMLElement | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTimelineId, setActiveTimelineId] = useState(`asset-library-${user?.uid || "default"}`);
  const [prevUserRootTimelineId, setPrevUserRootTimelineId] = useState(activeTimelineId);
  const [assetsVersion, setAssetsVersion] = useState(0);
  const userRootTimelineId = `asset-library-${user?.uid || "default"}`;

  if (userRootTimelineId !== prevUserRootTimelineId) {
    setPrevUserRootTimelineId(userRootTimelineId);
    setActiveTimelineId((current) =>
      current === prevUserRootTimelineId ? userRootTimelineId : current,
    );
  }

  const loadAssets = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/assets", { cache: "no-store" });
      const result = (await response.json().catch(() => ({}))) as {
        assets?: CloudinaryAsset[];
        error?: string;
      };

      if (!response.ok) {
        throw new Error(result.error || "Unable to load Cloudinary assets.");
      }

      setAssetsVersion((v) => v + 1);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load Cloudinary assets.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  const activeDoc = getTimelineDocument(activeTimelineId);
  const activeClips = activeDoc ? activeDoc.clips : [];
  const path = getTimelinePath(activeTimelineId);

  useEffect(() => {
    if (!isOpen) return;
    const timeoutId = window.setTimeout(() => {
      void loadAssets();
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [isOpen, loadAssets]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  useLayoutEffect(() => {
    const root = document.documentElement;

    if (!isOpen) {
      root.style.setProperty("--asset-library-height", "0px");
      return;
    }

    const panel = panelRef.current;
    if (!panel) return;

    const publishHeight = () => {
      root.style.setProperty(
        "--asset-library-height",
        `${panel.getBoundingClientRect().height}px`,
      );
    };

    publishHeight();
    const observer = new ResizeObserver(publishHeight);
    observer.observe(panel);
    window.addEventListener("resize", publishHeight);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", publishHeight);
      root.style.setProperty("--asset-library-height", "0px");
    };
  }, [isOpen]);

  if (!isOpen || typeof document === "undefined") return null;

  return createPortal(
    <section
      aria-label="Assets timeline"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[9000] asset-library-shell"
    >
      <style>{`
        @keyframes assetLibrarySlideUp {
          from { transform: translateY(100%); }
          to { transform: translateY(0); }
        }

        .asset-library-panel {
          animation: assetLibrarySlideUp 260ms cubic-bezier(0.16, 1, 0.3, 1) both;
        }

        @media (prefers-reduced-motion: reduce) {
          .asset-library-panel {
            animation-duration: 1ms;
          }
        }
      `}</style>
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="false"
        aria-label="Assets timeline"
        className="asset-library-panel pointer-events-auto ml-[72px] flex max-h-[48vh] flex-col border-t border-zinc-800 bg-transparent text-white shadow-2xl shadow-black/50"
      >
        <div className="min-h-0 bg-zinc-950 p-3">
          {error && (
            <div className="mb-3 flex items-start gap-3 rounded-lg border border-red-500/25 bg-red-500/10 p-4 text-sm text-red-100">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-300" />
              <span>{error}</span>
            </div>
          )}
          <div className="min-h-0 overflow-hidden">
            <SmoothScrollList
              key={`${activeTimelineId}-${assetsVersion}`}
              className="gap-3 rounded-lg p-3 shadow-none"
              initialClips={activeClips}
              initialViewState={{
                hierarchyMode: false,
                itemSize: "xs",
                manualOverhangScroll: true,
                showPassiveFilmstrips: false,
                showPlayBarArea: false,
                thumbnailMode: true,
              }}
              itemCount={activeClips.length}
              pixelsPerSecond={48}
              syncMediaDuration={false}
              timelineId={activeTimelineId}
              timelineTitle={
                activeTimelineId === userRootTimelineId
                  ? "Assets Timeline"
                  : activeDoc?.title || "Assets Timeline"
              }
              titleMeta={
                <div className="flex min-w-0 items-center gap-2">
                  {activeTimelineId !== userRootTimelineId && (
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() => {
                        const parent = path[path.length - 1];
                        setActiveTimelineId(parent ? parent.id : userRootTimelineId);
                      }}
                      className="size-6 shrink-0 border-zinc-800 bg-zinc-900 text-zinc-500 hover:text-zinc-200"
                      aria-label="Go to parent collection"
                    >
                      <ArrowLeft className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  <span className="shrink-0 text-[10px] font-semibold uppercase tracking-widest text-zinc-600">
                    {isLoading
                      ? "Loading Cloudinary uploads"
                      : `${activeClips.length} items in current folder`}
                  </span>
                  {path.length > 0 && (
                    <div className="flex min-w-0 items-center gap-1.5 text-[10px] text-zinc-600">
                      <button
                        type="button"
                        onClick={() => setActiveTimelineId(userRootTimelineId)}
                        className="shrink-0 transition-colors hover:text-zinc-300"
                      >
                        Assets Timeline
                      </button>
                      {path.map((segment) => (
                        <Fragment key={segment.id}>
                          <span>/</span>
                          <button
                            type="button"
                            onClick={() => setActiveTimelineId(segment.id)}
                            className="max-w-[120px] truncate transition-colors hover:text-zinc-300"
                          >
                            {segment.title}
                          </button>
                        </Fragment>
                      ))}
                    </div>
                  )}
                </div>
              }
              toolbarActions={
                <>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => void loadAssets()}
                    disabled={isLoading}
                    className="size-7 border-zinc-800 bg-zinc-900 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                    aria-label="Refresh assets"
                  >
                    <RefreshCw className={cn("h-3.5 w-3.5", isLoading && "animate-spin")} />
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={onClose}
                    className="size-7 border-zinc-800 bg-zinc-900 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                    aria-label="Close assets"
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </>
              }
              viewportWidth="100%"
              onOpenCollection={(nextId) => setActiveTimelineId(nextId)}
              onTimelineIdChange={(nextId) => setActiveTimelineId(nextId)}
              style={{
                maxWidth: "100%",
              }}
            />
          </div>
        </div>
      </aside>
    </section>,
    document.body,
  );
}
