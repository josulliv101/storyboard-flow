import { THUMBNAIL_GAP } from "./constants";
import { clamp } from "./utils";

const GRID_ROWS = 2;
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
  viewportWidth,
}: {
  enabled: boolean;
  fallbackItemWidth: number;
  itemHeight: number;
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
  const rowsPerPage = enabled ? GRID_ROWS : 1;

  return {
    enabled,
    columnsPerPage,
    rowsPerPage,
    itemsPerPage: columnsPerPage * rowsPerPage,
    itemWidth,
    itemHeight,
    gap: THUMBNAIL_GAP,
    pageWidth: availableWidth,
    rowStride: itemHeight + THUMBNAIL_GAP,
    columnStride: itemWidth + THUMBNAIL_GAP,
  };
}

export function getTimelineGridItemLayout(
  index: number,
  metrics: TimelineGridMetrics,
): TimelineGridItemLayout {
  const safeIndex = Math.max(0, Math.floor(index));
  const page = Math.floor(safeIndex / metrics.itemsPerPage);
  const indexInPage = safeIndex % metrics.itemsPerPage;
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
  return Math.ceil(itemCount / metrics.itemsPerPage) * metrics.pageWidth;
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
  const page = Math.max(0, Math.floor(safeX / metrics.pageWidth));
  const pageX = safeX - page * metrics.pageWidth;
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

  let targetIndex = page * metrics.itemsPerPage + row * metrics.columnsPerPage + column;
  if (row >= metrics.rowsPerPage) {
    targetIndex = (page + 1) * metrics.itemsPerPage;
  }

  return clamp(targetIndex, 0, Math.max(0, itemCount - 1));
}
