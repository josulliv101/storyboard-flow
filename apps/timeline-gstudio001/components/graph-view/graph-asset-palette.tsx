"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Folder as FolderIcon, Tag as TagIcon } from "lucide-react";

import {
  PaletteItem,
  parseNodeId,
  useCollectionsStore,
  usePanWithMomentum,
  type CollectionItemNode,
} from "@storyboard/ui/dnd-collections";

import { Button } from "@/components/core/button";
import { useBottomDrawerInset } from "@/components/assets/use-bottom-drawer-inset";
import type { Asset, AssetFolder } from "@/lib/assets/types";

import { clearPendingDetails, parkPendingDetail } from "./graph-pending-details";

const DEFAULT_IMAGE_SECONDS = 4;
const DEFAULT_VIDEO_SECONDS = 8;
/**
 * How many assets one request fetches — a PAGE SIZE now, not the cap it used
 * to be. The old 48 was the whole story: the rail showed 48 and said the rest
 * was elsewhere. With a cursor there is no "rest", so the number is free to
 * be small.
 *
 * Small on purpose. The first page is what the user waits for, and a dozen
 * tiles already fill a horizontal rail past its scroll edge — fetching four
 * times that to satisfy a scroll most people never make costs everyone the
 * wait. "Load more" is one click for the minority who go looking.
 */
const PALETTE_PAGE_SIZE = 12;

function createNodeFromAsset(asset: Asset): CollectionItemNode {
  clearPendingDetails();
  const id = parseNodeId(
    `asset-${asset.id}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
  );
  const aspect =
    asset.width && asset.height && asset.height > 0 ? asset.width / asset.height : 16 / 9;

  parkPendingDetail(id as string, {
    alt: asset.name,
    aspect,
    trackIndex: 0,
    poster: asset.thumbnailUrl,
    // Provenance: the persisted clip records which provider file it came
    // from, not just the URL it renders by (the model's `sourceAsset`).
    sourceAsset: { providerId: asset.providerId, assetId: asset.id },
    ...(asset.kind === "image"
      ? { sourceDuration: DEFAULT_IMAGE_SECONDS, trimIn: 0, trimOut: 0 }
      : {}),
  });

  if (asset.kind === "video") {
    return {
      id,
      kind: "media",
      mediaKind: "video",
      name: asset.name,
      src: asset.src,
      posterSrcs: [asset.thumbnailUrl],
      fullDurationSeconds: asset.durationSeconds ?? DEFAULT_VIDEO_SECONDS,
      trimInSeconds: 0,
      trimOutSeconds: 0,
    };
  }

  return {
    id,
    kind: "media",
    mediaKind: "image",
    name: asset.name,
    src: asset.src,
    durationSeconds: DEFAULT_IMAGE_SECONDS,
  };
}

type PalettePage = Readonly<{
  assets: readonly Asset[];
  folders: readonly AssetFolder[];
  /** The provider's cursor for the NEXT page, absent when this is the last.
   *  Replaces the old `truncated` boolean, which could only announce that
   *  there was more and never reach it. */
  nextCursor?: string;
}>;

/** What the picker needs from /api/assets/providers. */
type ProviderOption = Readonly<{ id: string; label: string }>;

type AssetPaletteState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "error"; message: string }>
  | (Readonly<{ status: "ready" }> & PalettePage);

/** Which pseudo-hierarchy the drawer is browsing. Folders are the default;
 *  tags appear as a toggle only when the provider declares the capability. */
type BrowseMode = "folders" | "tags";

/**
 * A folder (or tag-group) tile in the rail — same footprint as an asset
 * thumbnail so the rail scans as one row, but a plain BUTTON, not a
 * PaletteItem: these are navigation, not draggable media, and making them
 * drag sources would hand dnd-kit a node factory with nothing to mint.
 */
function FolderTile({
  folder,
  mode,
  onOpen,
}: Readonly<{
  folder: AssetFolder;
  mode: BrowseMode;
  onOpen: (path: readonly string[]) => void;
}>) {
  const Icon = mode === "tags" ? TagIcon : FolderIcon;
  return (
    <button
      type="button"
      data-palette-folder={folder.name}
      aria-label={`Open ${mode === "tags" ? "tag" : "folder"} ${folder.name}`}
      onClick={() => onOpen(folder.path)}
      className="flex h-24 w-36 shrink-0 flex-col items-center justify-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900/60 px-2 text-zinc-400 transition-colors hover:border-sky-500/50 hover:bg-zinc-900 hover:text-sky-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
    >
      <Icon aria-hidden="true" className="h-6 w-6" />
      <span className="w-full truncate text-center text-[10px] font-semibold text-zinc-300">
        {folder.name}
      </span>
    </button>
  );
}

/**
 * Where you are, and the way back up: Assets / segment / segment. Every
 * ancestor is a button; the CURRENT folder is text (there is nowhere to go
 * by clicking where you already are). At the root this renders as the plain
 * heading it always was — a provider without folders never grows crumbs, so
 * the degradation contract costs nothing here.
 */
function FolderBreadcrumb({
  path,
  rootLabel,
  onNavigate,
}: Readonly<{
  path: readonly string[];
  rootLabel: string;
  onNavigate: (path: readonly string[]) => void;
}>) {
  if (path.length === 0) {
    return (
      <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-400">
        {rootLabel}
      </h3>
    );
  }
  return (
    <nav aria-label="Asset folders" className="flex min-w-0 items-center gap-1 text-xs">
      <button
        type="button"
        onClick={() => onNavigate([])}
        className="shrink-0 font-semibold uppercase tracking-[0.14em] text-zinc-400 hover:text-sky-300"
      >
        {rootLabel}
      </button>
      {path.map((segment, index) => {
        const isCurrent = index === path.length - 1;
        return (
          <span key={index} className="flex min-w-0 items-center gap-1">
            <span aria-hidden="true" className="shrink-0 text-zinc-700">
              /
            </span>
            {isCurrent ? (
              <span aria-current="page" className="truncate font-semibold text-zinc-200">
                {segment}
              </span>
            ) : (
              <button
                type="button"
                onClick={() => onNavigate(path.slice(0, index + 1))}
                className="truncate text-zinc-400 hover:text-sky-300"
              >
                {segment}
              </button>
            )}
          </span>
        );
      })}
    </nav>
  );
}

function PaletteRail({
  assets,
  folders,
  mode,
  onOpenFolder,
}: Readonly<{
  assets: readonly Asset[];
  folders: readonly AssetFolder[];
  mode: BrowseMode;
  onOpenFolder: (path: readonly string[]) => void;
}>) {
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
      {/* Folders lead the rail — places before things, the file-browser
          convention — and they come from the same listing response, so a
          provider without folders simply contributes none. */}
      {folders.map((folder) => (
        <FolderTile key={folder.name} folder={folder} mode={mode} onOpen={onOpenFolder} />
      ))}
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
            alt={asset.name}
            draggable={false}
            loading="lazy"
            className="h-full w-full object-cover"
          />
          {asset.kind === "video" && (
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
  // The folder being browsed. [] is the ROOT, not the flat listing — the
  // drawer always browses (`?browse=1`): a provider with folders opens
  // organized instead of jumbled, and one without simply reports no folders
  // and the same view IS its flat listing. Survives close/reopen (this
  // component stays mounted), like the preview pane's height.
  const [path, setPath] = useState<readonly string[]>([]);
  // Visited folders answer instantly on the way back up; a provider fetch
  // per crumb-click would make the breadcrumb feel broken. Retry bypasses it
  // (the effect always network-fetches when loading), so a stale entry heals.
  const pageCacheRef = useRef(new Map<string, PalettePage>());
  const panelRef = useRef<HTMLElement | null>(null);
  // Folders or tags — the SAME breadcrumb/tile machinery browses either;
  // only the wire params and the tile icon differ. The toggle renders only
  // once a response has declared the provider can do tags (capability-gated
  // UI, per the seam's degradation contract).
  const [mode, setMode] = useState<BrowseMode>("folders");
  const [tagsAvailable, setTagsAvailable] = useState(false);
  // Which asset provider is selected. `null` = the server's default (the
  // first-registered); an explicit id is threaded into every request. The
  // picker only appears when more than one provider is installed, so a
  // single-provider deployment is unchanged.
  const [providers, setProviders] = useState<readonly ProviderOption[]>([]);
  const [providerId, setProviderId] = useState<string | null>(null);
  // Two pieces of state on purpose. `search` is what the box shows and must
  // track every keystroke; `searchTerm` is what the EFFECT queries on, and
  // lags it by a debounce so typing "alleyway" is one request rather than
  // eight. Rendering off the debounced value instead would make the input
  // feel broken.
  const [search, setSearch] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [searchAvailable, setSearchAvailable] = useState(false);

  // The page cache is keyed by ALL THREE axes — provider, mode, path — so no
  // cached page can leak across a provider or hierarchy switch (a folder path
  // means nothing in another provider, nor in tag space).
  const cacheKey = useCallback(
    (p: string | null, m: BrowseMode, segments: readonly string[], q: string) =>
      // Search is a FOURTH axis, not a variant of the path: a result set for
      // "alley" has nothing to do with the folder the user was standing in,
      // and caching them under one key would serve one for the other.
      JSON.stringify([p ?? "", m, segments, q]),
    [],
  );

  // The debounce lives in the CHANGE HANDLER, not an effect: the repo's
  // react-hooks/set-state-in-effect rule forbids synchronous setState in an
  // effect body, and this is event-driven anyway — an effect would only be
  // re-deriving what the keystroke already knows.
  //
  // 250ms is long enough that a typed word is one request and short enough
  // that the grid feels like it is tracking you. CLEARING settles
  // immediately: emptying the box should return to browsing at once rather
  // than after a pause.
  const searchTimerRef = useRef<number | null>(null);
  const applySearch = useCallback(
    (raw: string) => {
      setSearch(raw);
      const next = raw.trim();
      if (searchTimerRef.current !== null) window.clearTimeout(searchTimerRef.current);
      if (next === searchTerm) return;
      if (next.length === 0) {
        setSearchTerm("");
        setState({ status: "loading" });
        return;
      }
      searchTimerRef.current = window.setTimeout(() => {
        setSearchTerm(next);
        setState({ status: "loading" });
      }, 250);
    },
    [searchTerm],
  );
  useEffect(
    () => () => {
      if (searchTimerRef.current !== null) window.clearTimeout(searchTimerRef.current);
    },
    [],
  );

  // Both the first fetch and every "load more" go through this, so the
  // search-vs-browse param rules cannot drift between them — that divergence
  // would be invisible until a paged search silently started browsing.
  const requestParams = useCallback(
    (cursor?: string) => {
      const params = searchTerm
        ? new URLSearchParams({ q: searchTerm })
        : mode === "tags"
          ? new URLSearchParams({ mode: "tags" })
          : new URLSearchParams({ browse: "1" });
      params.set("limit", String(PALETTE_PAGE_SIZE));
      if (providerId !== null) params.set("provider", providerId);
      if (!searchTerm) {
        for (const segment of path) params.append(mode === "tags" ? "tag" : "folder", segment);
      }
      if (cursor !== undefined) params.set("cursor", cursor);
      return params;
    },
    [searchTerm, mode, providerId, path],
  );

  // Appending, not replacing: the rail keeps everything already loaded so a
  // second page never costs the user their scroll position or the tile they
  // were reaching for. Its own flag rather than the shared `loading` status,
  // which swaps the whole rail for skeletons — that would be a worse answer
  // to "show me more" than showing nothing at all.
  const [loadingMore, setLoadingMore] = useState(false);
  const loadMore = useCallback(async () => {
    const cursor = state.status === "ready" ? state.nextCursor : undefined;
    if (cursor === undefined || loadingMore) return;
    setLoadingMore(true);
    try {
      const response = await fetch(`/api/assets?${requestParams(cursor)}`, { cache: "no-store" });
      const result = (await response.json().catch(() => ({}))) as {
        assets?: Asset[];
        nextCursor?: string;
      };
      if (!response.ok || !result.assets) return;
      setState((current) => {
        // The page the user was on may have been replaced while this was in
        // flight (they searched, navigated, switched provider). Appending
        // then would splice one folder's assets onto another's.
        if (current.status !== "ready" || current.nextCursor !== cursor) return current;
        const merged: PalettePage = {
          assets: [...current.assets, ...result.assets!],
          folders: current.folders,
          ...(result.nextCursor === undefined ? {} : { nextCursor: result.nextCursor }),
        };
        pageCacheRef.current.set(cacheKey(providerId, mode, path, searchTerm), merged);
        return { status: "ready", ...merged };
      });
    } catch {
      // Silent: the rail still shows every asset already loaded, and the
      // button stays for a retry. An error banner would replace content the
      // user can still use.
    } finally {
      setLoadingMore(false);
    }
  }, [state, loadingMore, requestParams, cacheKey, providerId, mode, path, searchTerm]);

  const navigateTo = useCallback(
    (next: readonly string[], nextMode?: BrowseMode) => {
      const targetMode = nextMode ?? mode;
      setMode(targetMode);
      setPath(next);
      // Opening a folder is a request for a PLACE; leaving the query running
      // would put the user in a folder while still showing library-wide hits.
      setSearch("");
      setSearchTerm("");
      if (searchTimerRef.current !== null) window.clearTimeout(searchTimerRef.current);
      const cached = pageCacheRef.current.get(cacheKey(providerId, targetMode, next, ""));
      setState(cached ? { status: "ready", ...cached } : { status: "loading" });
    },
    [mode, providerId, cacheKey],
  );

  // Switching provider is a full reset: back to the FOLDER root, because a
  // path and even a hierarchy MODE belong to the provider you left (the new
  // one may not do tags at all — its next response re-derives tagsAvailable).
  const selectProvider = useCallback(
    (next: string) => {
      if (next === (providerId ?? "")) return;
      const targetId = next === "" ? null : next;
      setProviderId(targetId);
      setMode("folders");
      setPath([]);
      const cached = pageCacheRef.current.get(cacheKey(targetId, "folders", [], ""));
      setState(cached ? { status: "ready", ...cached } : { status: "loading" });
    },
    [providerId, cacheKey],
  );
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

  // Load the installed providers once the drawer opens — best-effort: a
  // failure just leaves the picker hidden and the default provider serving,
  // which is exactly the single-provider experience.
  useEffect(() => {
    if (!open || providers.length > 0) return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/assets/providers", { cache: "no-store" });
        const result = (await response.json().catch(() => ({}))) as {
          providers?: ProviderOption[];
        };
        if (!cancelled && response.ok && result.providers) setProviders(result.providers);
      } catch {
        // Ignore — the default provider still serves without a picker.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, providers.length]);

  useEffect(() => {
    if (!open || state.status !== "loading") return;
    let cancelled = false;
    void (async () => {
      try {
        // browse=1 names the ROOT when the path is empty; one param per
        // segment (never a joined string — a segment containing "/" must
        // not fake a boundary). Tags mode swaps the param family, nothing
        // else: the response shape is identical.
        // A search is library-wide and carries no place: no browse, no
        // folder/tag params. The route treats a blank `q` as "not searching",
        // so clearing the box returns to exactly the browse that was showing.
        const response = await fetch(`/api/assets?${requestParams()}`, { cache: "no-store" });
        const result = (await response.json().catch(() => ({}))) as {
          assets?: Asset[];
          folders?: AssetFolder[];
          capabilities?: { tags?: boolean; search?: boolean };
          nextCursor?: string;
          error?: string;
        };
        if (cancelled) return;
        if (!response.ok || !result.assets) {
          setState({ status: "error", message: result.error ?? "Could not load assets." });
          return;
        }
        const page: PalettePage = {
          // No client-side slice: the provider honours `limit`, so trimming
          // here again would drop assets we had already fetched AND lie about
          // where the next page starts.
          assets: result.assets,
          folders: result.folders ?? [],
          ...(result.nextCursor === undefined ? {} : { nextCursor: result.nextCursor }),
        };
        pageCacheRef.current.set(cacheKey(providerId, mode, path, searchTerm), page);
        setTagsAvailable(result.capabilities?.tags === true);
        setSearchAvailable(result.capabilities?.search === true);
        setState({ status: "ready", ...page });
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
  }, [open, state.status, path, mode, providerId, searchTerm, cacheKey, requestParams]);

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
          <FolderBreadcrumb
            path={path}
            rootLabel={mode === "tags" ? "Tags" : "Assets"}
            onNavigate={navigateTo}
          />
          {/* The provider picker appears ONLY with more than one installed —
              a single-provider deployment (Cloudinary alone, no S3 env) is
              visually unchanged. A native <select>: the option count is
              provider-driven, so a fixed toggle wouldn't scale. */}
          {providers.length > 1 && (
            <label className="flex shrink-0 items-center gap-1 text-[10px] text-zinc-500">
              <span className="sr-only">Asset source</span>
              <select
                aria-label="Asset source"
                value={providerId ?? providers[0].id}
                onChange={(event) => selectProvider(event.target.value)}
                className="rounded-md border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
              >
                {providers.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {tagsAvailable && (
            <div
              role="group"
              aria-label="Browse assets by"
              className="flex shrink-0 overflow-hidden rounded-md border border-zinc-800"
            >
              {(["folders", "tags"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={mode === option}
                  onClick={() => {
                    // Switching hierarchies starts at the new one's root —
                    // a folder path means nothing in tag space.
                    if (mode !== option) navigateTo([], option);
                  }}
                  className={
                    mode === option
                      ? "bg-zinc-800 px-2 py-0.5 text-[10px] font-semibold text-zinc-100"
                      : "px-2 py-0.5 text-[10px] font-semibold text-zinc-500 hover:text-zinc-200"
                  }
                >
                  {option === "folders" ? "Folders" : "Tags"}
                </button>
              ))}
            </div>
          )}
          {searchAvailable && (
            <label className="flex shrink-0 items-center gap-1.5 text-[10px] text-zinc-500">
              <span className="sr-only">Search assets</span>
              <input
                type="search"
                value={search}
                onChange={(event) => applySearch(event.target.value)}
                onKeyDown={(event) => {
                  // Escape clears the query rather than closing the drawer —
                  // the drawer's own Escape still works from anywhere else.
                  if (event.key === "Escape" && search.length > 0) {
                    event.stopPropagation();
                    applySearch("");
                  }
                }}
                placeholder="Search name, folder or tag…"
                aria-label="Search assets"
                className="h-6 w-52 rounded-md border border-zinc-800 bg-zinc-900 px-2 text-[11px] text-zinc-100 placeholder:text-zinc-600 focus:border-sky-500/60 focus:outline-none"
              />
            </label>
          )}
          <span className="shrink-0 text-[10px] text-zinc-600">
            {searchTerm
              ? "Results span the whole library · clear the box to browse"
              : "Drag a thumbnail into any timeline · Enter picks one up for keyboard placement"}
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
          (state.assets.length === 0 && state.folders.length === 0 ? (
            <p className="rounded-md border border-zinc-800 px-3 py-2 text-xs text-zinc-500">
              {/* A search that matches nothing is NOT an empty library — the
                  old copy said "No assets yet" either way, which reads as
                  data loss when you have hundreds and simply mistyped. It
                  also sent people to "the storyboard view", a route deleted
                  in #184. */}
              {searchTerm
                ? `No assets match "${searchTerm}".`
                : path.length === 0
                  ? mode === "tags"
                    ? "No tagged or untagged assets to show."
                    : "No assets yet — add some by dropping files onto a timeline."
                  : mode === "tags"
                    ? "No assets carry exactly this tag."
                    : "This folder is empty."}
            </p>
          ) : (
            <>
              <PaletteRail
                assets={state.assets}
                folders={state.folders}
                mode={mode}
                onOpenFolder={navigateTo}
              />
              {state.nextCursor !== undefined && (
                // This used to be a dead end: a line saying "showing the first
                // 48" and pointing at the storyboard view, a route deleted in
                // #184. There is now a way to actually reach the rest.
                <div className="mt-1 flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={loadingMore}
                    onClick={() => void loadMore()}
                    className="h-6 px-2 text-[10px]"
                  >
                    {loadingMore ? "Loading…" : "Load more"}
                  </Button>
                  <span className="text-[10px] text-zinc-600">
                    {state.assets.length} shown
                    {searchTerm ? " · narrow the search to get there faster" : ""}
                  </span>
                </div>
              )}
            </>
          ))}
      </aside>
    </section>,
    document.body,
  );
}
