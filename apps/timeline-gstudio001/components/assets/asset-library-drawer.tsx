"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertCircle,
  Image as ImageIcon,
  Loader2,
  RefreshCw,
  X,
} from "lucide-react";

import { Button } from "@/components/core/button";
import { SmoothScrollList } from "@/components/timeline/smooth-scroll-list";
import { cn } from "@/lib/utils";
import type { TimelineClip } from "@/components/timeline/types";

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
  const [assets, setAssets] = useState<CloudinaryAsset[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isMounted, setIsMounted] = useState(false);
  const assetClips = useMemo(() => {
    let nextStartTime = 0;

    return assets.map((asset, index) => {
      const clip = createAssetClip(asset, index, nextStartTime);
      nextStartTime += clip.duration;
      return clip;
    });
  }, [assets]);

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

      setAssets(result.assets || []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load Cloudinary assets.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    void loadAssets();
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

  if (!isMounted || !isOpen) return null;

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
        role="dialog"
        aria-modal="false"
        aria-labelledby="asset-library-title"
        className="asset-library-panel pointer-events-auto ml-[72px] flex max-h-[48vh] flex-col border-t border-zinc-800 bg-zinc-950 text-white shadow-2xl shadow-black/50"
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-zinc-800 px-5 py-3">
          <div className="min-w-0">
            <h2 id="asset-library-title" className="text-sm font-semibold text-zinc-50">
              Assets Timeline
            </h2>
            <p className="mt-1 text-xs text-zinc-500">
              {isLoading
                ? "Loading Cloudinary uploads"
                : `${assets.length} Cloudinary clips in SmoothScrollList`}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => void loadAssets()}
              disabled={isLoading}
              className="size-9 border-zinc-800 bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
              aria-label="Refresh assets"
            >
              <RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={onClose}
              className="size-9 border-zinc-800 bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
              aria-label="Close assets"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </header>

        <div className="min-h-0 p-3">
          {error ? (
            <div className="flex items-start gap-3 rounded-lg border border-red-500/25 bg-red-500/10 p-4 text-sm text-red-100">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-300" />
              <span>{error}</span>
            </div>
          ) : isLoading && assets.length === 0 ? (
            <div className="grid h-52 place-items-center rounded-lg border border-zinc-800 bg-zinc-900/35 text-sm text-zinc-500">
              <div className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-amber-300" />
                Loading assets
              </div>
            </div>
          ) : assets.length === 0 ? (
            <div className="grid h-52 place-items-center rounded-lg border border-dashed border-zinc-800 bg-zinc-900/25 p-6 text-center">
              <div className="grid justify-items-center gap-3">
                <div className="grid size-11 place-items-center rounded-lg border border-zinc-800 bg-zinc-950 text-zinc-500">
                  <ImageIcon className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-zinc-200">No uploaded assets yet</p>
                  <p className="mt-1 text-xs text-zinc-500">
                    Drop images or videos into a timeline to upload them to Cloudinary.
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="min-h-0 overflow-hidden">
              <SmoothScrollList
                className="gap-3 rounded-lg p-3 shadow-none"
                disablePersistence
                initialClips={assetClips}
                initialViewState={{
                  hierarchyMode: false,
                  itemSize: "sm",
                  manualOverhangScroll: true,
                  showPassiveFilmstrips: false,
                  showPlayBarArea: false,
                  thumbnailMode: true,
                }}
                itemCount={assetClips.length}
                pixelsPerSecond={48}
                syncMediaDuration={false}
                timelineId="asset-library"
                timelineTitle="Cloudinary Assets"
                viewportWidth="100%"
                style={{
                  maxWidth: "100%",
                }}
              />
            </div>
          )}
        </div>
      </aside>
    </section>,
    document.body,
  );
}
