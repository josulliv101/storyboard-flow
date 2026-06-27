import { THUMBNAIL_GAP, TIMELINE_ITEM_TOP } from "./constants";
import { clamp } from "./utils";

const MIN_GRID_ITEM_WIDTH = 160;

export type TimelineGridMetrics = {
  enabled: boolean;
  columnsPerPage: number;
  rowsPerPage: number;
  itemsPerPage: number;
  itemWidth: number;
  itemHeight: number;
  gap: number;
  pageWidth: number;
  rowStride: number;
  columnStride: number;
};

export type TimelineGridItemLayout = {
  left: number;
  top: number;
  width: number;
  row: number;
  column: number;
  page: number;
};

export function getTimelineGridMetrics({
  enabled,
  fallbackItemWidth,
  itemHeight,
  itemCount,
  viewportWidth,
}: {
  enabled: boolean;
  fallbackItemWidth: number;
  itemHeight: number;
  itemCount: number;
  viewportWidth: number;
}): TimelineGridMetrics {
  const availableWidth = Math.max(1, viewportWidth || fallbackItemWidth);
  const targetWidth = Math.max(
    MIN_GRID_ITEM_WIDTH,
    Math.min(fallbackItemWidth, availableWidth),
  );
  const columnsPerPage = enabled
    ? Math.max(
        1,
        Math.floor((availableWidth + THUMBNAIL_GAP) / (targetWidth + THUMBNAIL_GAP)),
      )
    : 1;
  const itemWidth = enabled
    ? (availableWidth - THUMBNAIL_GAP * (columnsPerPage - 1)) / columnsPerPage
    : fallbackItemWidth;
  const rowsPerPage = enabled
    ? Math.max(1, Math.ceil(Math.max(0, itemCount) / columnsPerPage))
    : 1;

  return {
    enabled,
    columnsPerPage,
    rowsPerPage,
    itemsPerPage: columnsPerPage * rowsPerPage,
    itemWidth,
    itemHeight,
    gap: THUMBNAIL_GAP,
    pageWidth: availableWidth,
    rowStride: TIMELINE_ITEM_TOP + itemHeight + THUMBNAIL_GAP,
    columnStride: itemWidth + THUMBNAIL_GAP,
  };
}

export function getTimelineGridItemLayout(
  index: number,
  metrics: TimelineGridMetrics,
): TimelineGridItemLayout {
  const safeIndex = Math.max(0, Math.floor(index));
  const page = 0;
  const indexInPage = safeIndex;
  const row = Math.floor(indexInPage / metrics.columnsPerPage);
  const column = indexInPage % metrics.columnsPerPage;

  return {
    left: page * metrics.pageWidth + column * metrics.columnStride,
    top: row * metrics.rowStride,
    width: metrics.itemWidth,
    row,
    column,
    page,
  };
}

export function getTimelineGridContentWidth(
  itemCount: number,
  metrics: TimelineGridMetrics,
) {
  if (itemCount <= 0) return 0;
  return metrics.pageWidth;
}

export function getTimelineGridContentHeight(metrics: TimelineGridMetrics) {
  return (
    (metrics.rowsPerPage - 1) * metrics.rowStride +
    TIMELINE_ITEM_TOP +
    metrics.itemHeight
  );
}

export function getTimelineGridTargetIndex({
  contentX,
  contentY,
  itemCount,
  metrics,
}: {
  contentX: number;
  contentY: number;
  itemCount: number;
  metrics: TimelineGridMetrics;
}) {
  const safeX = Math.max(0, contentX);
  const pageX = clamp(safeX, 0, metrics.pageWidth);
  const rawColumn = Math.floor(pageX / metrics.columnStride);
  let column = clamp(rawColumn, 0, metrics.columnsPerPage - 1);
  let row = clamp(
    Math.floor(Math.max(0, contentY) / metrics.rowStride),
    0,
    metrics.rowsPerPage - 1,
  );

  const columnStart = column * metrics.columnStride;
  if (pageX > columnStart + metrics.itemWidth / 2) {
    column += 1;
  }

  if (column >= metrics.columnsPerPage) {
    column = 0;
    row += 1;
  }

  let targetIndex = row * metrics.columnsPerPage + column;
  if (row >= metrics.rowsPerPage) {
    targetIndex = metrics.itemsPerPage;
  }

  return clamp(targetIndex, 0, Math.max(0, itemCount - 1));
}
