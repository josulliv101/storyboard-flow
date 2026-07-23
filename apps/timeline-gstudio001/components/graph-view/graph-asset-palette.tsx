"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
  PaletteItem,
  parseNodeId,
  useCollectionsStore,
  usePanWithMomentum,
  type CollectionItemNode,
} from "@storyboard/ui/dnd-collections";

import { Button } from "@/components/core/button";
import { useBottomDrawerInset } from "@/components/assets/use-bottom-drawer-inset";
import type { CloudinaryAsset } from "@/lib/cloudinary-media-store";

import { clearPendingDetails, parkPendingDetail } from "./graph-pending-details";

const DEFAULT_IMAGE_SECONDS = 4;
const DEFAULT_VIDEO_SECONDS = 8;
const PALETTE_ASSET_LIMIT = 48;

function assetDisplayName(asset: CloudinaryAsset): string {
  const path = asset.relativePath ?? asset.pathname;
  return path.split("/").pop() ?? path;
}

function createNodeFromAsset(asset: CloudinaryAsset): CollectionItemNode {
  clearPendingDetails();
  const id = parseNodeId(
    `asset-${asset.id}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
  );
  const name = assetDisplayName(asset);
  const aspect =
    asset.width && asset.height && asset.height > 0 ? asset.width / asset.height : 16 / 9;

  parkPendingDetail(id as string, {
    alt: name,
    aspect,
    trackIndex: 0,
    poster: asset.thumbnailUrl,
    ...(asset.resourceType === "image"
      ? { sourceDuration: DEFAULT_IMAGE_SECONDS, trimIn: 0, trimOut: 0 }
      : {}),
  });

  if (asset.resourceType === "video") {
    return {
      id,
      kind: "media",
      mediaKind: "video",
      name,
      src: asset.url,
      posterSrcs: [asset.thumbnailUrl],
      fullDurationSeconds: asset.duration ?? DEFAULT_VIDEO_SECONDS,
      trimInSeconds: 0,
      trimOutSeconds: 0,
    };
  }

  return {
    id,
    kind: "media",
    mediaKind: "image",
    name,
    src: asset.url,
    durationSeconds: DEFAULT_IMAGE_SECONDS,
  };
}

type AssetPaletteState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "error"; message: string }>
  | Readonly<{ status: "ready"; assets: readonly CloudinaryAsset[]; truncated: boolean }>;

function PaletteRail({ assets }: Readonly<{ assets: readonly CloudinaryAsset[] }>) {
  const store = useCollectionsStore();
  const railRef = useRef<HTMLDivElement>(null);
  const panOptions = useMemo<Parameters<typeof usePanWithMomentum>[2]>(
    () => ({ isGestureClaimed: () => store.getSnapshot().interaction.isDragging }),
    [store],
  );
  usePanWithMomentum(railRef, "x", panOptions);

  return (
    <div
      ref={railRef}
      data-drag-activation="hold"
      className="flex cursor-grab gap-2 overflow-x-auto pb-1 select-none active:cursor-grabbing"
      style={{ touchAction: "pan-y" }}
    >
      {assets.map((asset) => (
        <PaletteItem
          key={asset.id}
          paletteId={`asset-${asset.id}`}
          createNode={() => createNodeFromAsset(asset)}
          className="relative h-24 w-36 shrink-0 overflow-hidden p-0"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={asset.thumbnailUrl}
            alt={assetDisplayName(asset)}
            draggable={false}
            loading="lazy"
            className="h-full w-full object-cover"
          />
          {asset.resourceType === "video" && (
            <span className="absolute bottom-1 left-1 rounded bg-black/75 px-1 py-0.5 text-[9px] font-bold tracking-wide text-zinc-100">
              VIDEO
            </span>
          )}
        </PaletteItem>
      ))}
    </div>
  );
}

export function AssetPaletteDrawer({
  open,
  onClose,
}: Readonly<{
  open: boolean;
  onClose: () => void;
}>) {
  const [state, setState] = useState<AssetPaletteState>({ status: "loading" });
  const panelRef = useRef<HTMLElement | null>(null);
  // This panel is FIXED to the bottom of the viewport and non-modal — the
  // board behind it stays live, and you drag out of it onto that board. So
  // the page has to be able to scroll its own content clear of it; without
  // this, the last row of cards sat under the panel with no scroll left to
  // reach them. Publishing the height also lets the preview pane size itself
  // against the viewport that is actually visible.
  useBottomDrawerInset(panelRef, open);

  const handleClose = () => {
    if (state.status === "error") setState({ status: "loading" });
    onClose();
  };

  useEffect(() => {
    if (!open || state.status !== "loading") return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/assets", { cache: "no-store" });
        const result = (await response.json().catch(() => ({}))) as {
          assets?: CloudinaryAsset[];
          error?: string;
        };
        if (cancelled) return;
        if (!response.ok || !result.assets) {
          setState({ status: "error", message: result.error ?? "Could not load assets." });
          return;
        }
        setState({
          status: "ready",
          assets: result.assets.slice(0, PALETTE_ASSET_LIMIT),
          truncated: result.assets.length > PALETTE_ASSET_LIMIT,
        });
      } catch (cause) {
        if (!cancelled) {
          setState({
            status: "error",
            message: cause instanceof Error ? cause.message : "Could not load assets.",
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, state.status]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <section
      aria-label="Asset palette"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-40"
    >
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="false"
        aria-label="Asset palette"
        className="pointer-events-auto ml-[72px] flex max-h-[38vh] flex-col border-t border-zinc-800 bg-zinc-950 p-3 text-white shadow-2xl shadow-black/50"
      >
        <div className="mb-2 flex items-center gap-3">
          <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-400">
            Assets
          </h3>
          <span className="text-[10px] text-zinc-600">
            Drag a thumbnail into any timeline · Enter picks one up for keyboard placement
          </span>
          <span className="grow" />
          <Button type="button" variant="ghost" size="sm" onClick={handleClose}>
            Close
          </Button>
        </div>

        {state.status === "loading" && (
          <div className="flex gap-2">
            {Array.from({ length: 6 }).map((_, index) => (
              <div
                key={index}
                className="h-24 w-36 shrink-0 animate-pulse rounded-md bg-zinc-900"
              />
            ))}
          </div>
        )}

        {state.status === "error" && (
          <div className="flex items-center gap-3 rounded-md border border-zinc-800 px-3 py-2">
            <p className="text-xs text-zinc-500">{state.message}</p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setState({ status: "loading" })}
            >
              Retry
            </Button>
          </div>
        )}

        {state.status === "ready" &&
          (state.assets.length === 0 ? (
            <p className="rounded-md border border-zinc-800 px-3 py-2 text-xs text-zinc-500">
              No assets yet — upload some from the asset library on the storyboard view.
            </p>
          ) : (
            <>
              <PaletteRail assets={state.assets} />
              {state.truncated && (
                <p className="mt-1 text-[10px] text-zinc-600">
                  Showing the newest {PALETTE_ASSET_LIMIT} assets — the full library is on the
                  storyboard view.
                </p>
              )}
            </>
          ))}
      </aside>
    </section>,
    document.body,
  );
}
