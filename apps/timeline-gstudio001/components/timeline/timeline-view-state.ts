import type { ItemSize } from "./constants";

export type TimelineViewState = {
  thumbnailMode: boolean;
  gridMode: boolean;
  itemSize: ItemSize;
  manualOverhangScroll: boolean;
  showPassiveFilmstrips: boolean;
  zoom: number;
};

type TimelineSearchParams =
  | URLSearchParams
  | Record<string, string | string[] | undefined>;

const ITEM_SIZES: ItemSize[] = ["sm", "md", "lg", "xl"];

function getParam(searchParams: TimelineSearchParams, key: string) {
  if (searchParams instanceof URLSearchParams) {
    return searchParams.get(key) ?? undefined;
  }

  const value = searchParams[key];
  return Array.isArray(value) ? value[0] : value;
}

function parseBoolean(value: string | undefined) {
  if (value === "1") return true;
  if (value === "0") return false;
  return undefined;
}

function parseItemSize(value: string | undefined) {
  return ITEM_SIZES.includes(value as ItemSize) ? (value as ItemSize) : undefined;
}

function parseZoom(value: string | undefined) {
  if (!value) return undefined;

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function parseTimelineViewState(
  searchParams: TimelineSearchParams,
): Partial<TimelineViewState> {
  const thumbnailMode = parseBoolean(getParam(searchParams, "thumb"));

  return {
    thumbnailMode,
    gridMode: thumbnailMode
      ? parseBoolean(getParam(searchParams, "grid"))
      : false,
    itemSize: parseItemSize(getParam(searchParams, "size")),
    manualOverhangScroll: parseBoolean(getParam(searchParams, "pin")),
    showPassiveFilmstrips: parseBoolean(getParam(searchParams, "filmstrips")),
    zoom: parseZoom(getParam(searchParams, "zoom")),
  };
}

export function serializeTimelineViewState(state: TimelineViewState) {
  const searchParams = new URLSearchParams();

  searchParams.set("thumb", state.thumbnailMode ? "1" : "0");
  searchParams.set("grid", state.thumbnailMode && state.gridMode ? "1" : "0");
  searchParams.set("size", state.itemSize);
  searchParams.set("pin", state.manualOverhangScroll ? "1" : "0");
  searchParams.set("filmstrips", state.showPassiveFilmstrips ? "1" : "0");
  searchParams.set("zoom", String(Math.round(state.zoom)));

  return searchParams;
}

export function appendTimelineViewStateToHref(
  href: string,
  state: TimelineViewState,
) {
  const search = serializeTimelineViewState(state).toString();
  return search ? `${href}?${search}` : href;
}
