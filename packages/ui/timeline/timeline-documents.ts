import {
  TIMELINE_LEADING_PADDING_SECONDS,
  cloneTimelineClip,
  cloneTimelineDocument,
  packTimelineClips,
  previewItemsFrom,
} from "@storyboard/timeline-model";

import { createInitialClips } from "./hooks/use-timeline-clips";
import type {
  CollectionTimelineClip,
  MediaKind,
  TimelineClip,
  TimelineDocument,
} from "./types";

// The pure model functions moved to @storyboard/timeline-model (framework-
// free, shared with the server routes and the graph adapter). Re-exported
// here so every existing "@storyboard/ui/timeline/timeline-documents"
// import keeps working; this module keeps the demo fixtures and the
// documents-state store built on top of them.
export {
  cloneTimelineClip,
  cloneTimelineDocument,
  decodeFolderPath,
  encodeFolderPath,
  getFolderPathFromTimelineId,
  isUnsavedProjectPlaceholder,
  packTimelineClips,
  previewItemsFrom,
} from "@storyboard/timeline-model";

function clamp(val: number, min: number, max: number) {
  return Math.min(Math.max(val, min), max);
}

export type TimelinePageDocument = {
  id: string;
  title: string;
  description?: string;
  timelineIds: string[];
};

export type TimelineDocumentsState = {
  documents: Record<string, TimelineDocument>;
  pages: Record<string, TimelinePageDocument>;
};

export type CollectionFramePreview = {
  id: string;
  kind: MediaKind;
  src: string;
  poster?: string;
  alt: string;
  previewTime: number;
  sourceDuration: number;
  playbackRate: number;
};

function getClipsDuration(clips: TimelineClip[]) {
  return clips.reduce(
    (duration, clip) => Math.max(duration, clip.startTime + clip.duration),
    0,
  );
}

function cloneClipForDocument(documentId: string, clip: TimelineClip) {
  return {
    ...clip,
    id: `${documentId}-${clip.id}`,
    alt: `${clip.alt} (${documentId})`,
  };
}

function createMediaClips(documentId: string, count: number) {
  return createInitialClips(count, 100).map((clip) =>
    cloneClipForDocument(documentId, clip),
  );
}

function createCollectionClip({
  childTimelineId,
  duration,
  id,
  itemCount,
  previewItems,
  title,
}: {
  childTimelineId: string;
  duration: number;
  id: string;
  itemCount: number;
  previewItems: CollectionTimelineClip["previewItems"];
  title: string;
}): CollectionTimelineClip {
  return {
    id,
    index: 0,
    kind: "collection",
    title,
    childTimelineId,
    itemCount,
    previewItems,
    alt: `${title} collection`,
    aspect: 16 / 9,
    trackIndex: 0,
    startTime: 0,
    duration,
    sourceDuration: duration,
    trimIn: 0,
    trimOut: 0,
  };
}

const sceneADetailsClips = createMediaClips("scene-a-details", 18);
const sceneBClips = createMediaClips("scene-b", 26);
const collectionBoardActOneClips = createMediaClips(
  "collection-board-act-one",
  12,
);
const collectionBoardActTwoClips = createMediaClips(
  "collection-board-act-two",
  16,
);
const collectionBoardActThreeClips = createMediaClips(
  "collection-board-act-three",
  14,
);

const sceneAClips = packTimelineClips([
  ...createMediaClips("scene-a", 5),
  createCollectionClip({
    id: "scene-a-nested-collection",
    title: "Close-up Inserts",
    childTimelineId: "scene-a-details",
    itemCount: sceneADetailsClips.length,
    duration: 2.8,
    previewItems: previewItemsFrom(sceneADetailsClips),
  }),
  ...createMediaClips("scene-a", 9).slice(5),
]);

const collectionBoardClips = packTimelineClips([
  createCollectionClip({
    id: "collection-board-act-one",
    title: "Act One Collections",
    childTimelineId: "collection-board-act-one",
    itemCount: collectionBoardActOneClips.length,
    duration: 3,
    previewItems: previewItemsFrom(collectionBoardActOneClips),
  }),
  createCollectionClip({
    id: "collection-board-act-two",
    title: "Act Two Collections",
    childTimelineId: "collection-board-act-two",
    itemCount: collectionBoardActTwoClips.length,
    duration: 3.2,
    previewItems: previewItemsFrom(collectionBoardActTwoClips),
  }),
  createCollectionClip({
    id: "collection-board-act-three",
    title: "Act Three Collections",
    childTimelineId: "collection-board-act-three",
    itemCount: collectionBoardActThreeClips.length,
    duration: 3.1,
    previewItems: previewItemsFrom(collectionBoardActThreeClips),
  }),
]);

const rootClips = packTimelineClips([
  ...createMediaClips("root", 4),
  createCollectionClip({
    id: "root-scene-a",
    title: "Scene A Selects",
    childTimelineId: "scene-a",
    itemCount: sceneAClips.length,
    duration: 3.1,
    previewItems: previewItemsFrom(sceneAClips),
  }),
  ...createMediaClips("root", 9).slice(4, 6),
  createCollectionClip({
    id: "root-collection-board",
    title: "Collection Board",
    childTimelineId: "collection-board",
    itemCount: collectionBoardClips.length,
    duration: 3.6,
    previewItems: [
      ...previewItemsFrom(collectionBoardActOneClips).slice(0, 1),
      ...previewItemsFrom(collectionBoardActTwoClips).slice(0, 1),
      ...previewItemsFrom(collectionBoardActThreeClips).slice(0, 1),
    ],
  }),
  ...createMediaClips("root", 9).slice(6, 7),
  createCollectionClip({
    id: "root-scene-b",
    title: "Scene B Assembly",
    childTimelineId: "scene-b",
    itemCount: sceneBClips.length,
    duration: 3.4,
    previewItems: previewItemsFrom(sceneBClips),
  }),
  ...createMediaClips("root", 12).slice(7),
]);

const promoClips = createMediaClips("promo", 36);
const archiveClips = createMediaClips("archive", 72);

const initialTimelineDocuments: Record<string, TimelineDocument> = {
  root: {
    id: "root",
    title: "Root Timeline",
    description: "Top-level storyboard with nested timeline collections.",
    clips: rootClips,
  },
  "scene-a": {
    id: "scene-a",
    title: "Scene A Selects",
    description: "A nested scene timeline with another collection inside it.",
    clips: sceneAClips,
  },
  "scene-a-details": {
    id: "scene-a-details",
    title: "Close-up Inserts",
    description: "A deeper collection timeline reached from Scene A.",
    clips: sceneADetailsClips,
  },
  "scene-b": {
    id: "scene-b",
    title: "Scene B Assembly",
    description: "A separate nested collection timeline.",
    clips: sceneBClips,
  },
  "collection-board": {
    id: "collection-board",
    title: "Collection Board",
    description:
      "A collection timeline made only of other collection items.",
    clips: collectionBoardClips,
  },
  "collection-board-act-one": {
    id: "collection-board-act-one",
    title: "Act One Collections",
    description: "Media items inside the first collection-board branch.",
    clips: collectionBoardActOneClips,
  },
  "collection-board-act-two": {
    id: "collection-board-act-two",
    title: "Act Two Collections",
    description: "Media items inside the second collection-board branch.",
    clips: collectionBoardActTwoClips,
  },
  "collection-board-act-three": {
    id: "collection-board-act-three",
    title: "Act Three Collections",
    description: "Media items inside the third collection-board branch.",
    clips: collectionBoardActThreeClips,
  },
  promo: {
    id: "promo",
    title: "Promo Cut",
    description: "A standalone timeline loaded by a server component.",
    clips: promoClips,
  },
  archive: {
    id: "archive",
    title: "Archive Pulls",
    description: "A larger server-provided timeline for grid virtualization.",
    clips: archiveClips,
  },
  storyboard: {
    id: "storyboard",
    title: "Storyboard Workspace",
    description: "Your main storyboard preview timeline.",
    clips: rootClips.map((c) => ({ ...c })),
  },
  workbench: {
    id: "workbench",
    title: "Workbench Workspace",
    description: "Your workbench assembly timeline.",
    clips: sceneAClips.map((c) => ({ ...c })),
  },
};

const initialTimelinePages: Record<string, TimelinePageDocument> = {
  single: {
    id: "single",
    title: "Single Timeline Page",
    description: "One server-selected timeline document.",
    timelineIds: ["root"],
  },
  three: {
    id: "three",
    title: "Three Timeline Page",
    description: "Three independent timeline components on the same page.",
    timelineIds: ["root", "promo", "archive"],
  },
};

function cloneTimelineDocuments(
  documents: Record<string, TimelineDocument>,
): Record<string, TimelineDocument> {
  return Object.fromEntries(
    Object.entries(documents).map(([id, document]) => [
      id,
      cloneTimelineDocument(document),
    ]),
  );
}

function cloneTimelinePages(
  pages: Record<string, TimelinePageDocument>,
): Record<string, TimelinePageDocument> {
  return Object.fromEntries(
    Object.entries(pages).map(([id, page]) => [
      id,
      {
        ...page,
        timelineIds: [...page.timelineIds],
      },
    ]),
  );
}

export function createInitialTimelineDocuments() {
  return cloneTimelineDocuments(initialTimelineDocuments);
}

export function createInitialTimelinePages() {
  return cloneTimelinePages(initialTimelinePages);
}

export function createTimelineDocumentsState(
  documents: Record<string, TimelineDocument> = createInitialTimelineDocuments(),
  pages: Record<string, TimelinePageDocument> = createInitialTimelinePages(),
): TimelineDocumentsState {
  return {
    documents: cloneTimelineDocuments(documents),
    pages: cloneTimelinePages(pages),
  };
}

const defaultTimelineDocumentsState = createTimelineDocumentsState();

function persistTimelineDocument(document: TimelineDocument) {
  if (typeof window === "undefined") return;

  window
    .fetch(`/api/timelines/${encodeURIComponent(document.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ document }),
    })
    .catch((error) => {
      console.warn(`Failed to persist timeline "${document.id}" to Firebase`, error);
    });
}

export function getTimelineDocument(id: string) {
  return getTimelineDocumentFromState(defaultTimelineDocumentsState, id);
}

export function getTimelineDocumentFromState(
  state: TimelineDocumentsState,
  id: string,
) {
  const document = state.documents[id];
  return document ? cloneTimelineDocument(document) : null;
}

export function registerTimelineDocumentInState(
  state: TimelineDocumentsState,
  document: TimelineDocument,
) {
  return {
    ...state,
    documents: {
      ...state.documents,
      [document.id]: cloneTimelineDocument(document),
    },
  };
}

export function registerTimelineDocument(
  document: TimelineDocument,
  options: { persist?: boolean } = {},
) {
  const nextDocument = cloneTimelineDocument(document);

  if (options.persist) {
    persistTimelineDocument(nextDocument);
  }

  return nextDocument;
}

export function getTimelinePath(targetId: string): { id: string; title: string }[] {
  return getTimelinePathFromState(defaultTimelineDocumentsState, targetId);
}

export function getTimelinePathFromState(
  state: TimelineDocumentsState,
  targetId: string,
): { id: string; title: string }[] {
  const path: { id: string; title: string }[] = [];
  
  let currentId = targetId;
  while (currentId && currentId !== "root") {
    let parentId: string | null = null;
    let parentTitle = "";
    
    for (const doc of Object.values(state.documents)) {
      const hasChild = doc.clips.some(
        (clip) => clip.kind === "collection" && clip.childTimelineId === currentId
      );
      if (hasChild) {
        parentId = doc.id;
        parentTitle = doc.title;
        break;
      }
    }
    
    if (parentId) {
      path.unshift({ id: parentId, title: parentTitle });
      currentId = parentId;
    } else {
      break;
    }
  }
  
  return path;
}

export function syncParentCollectionsInState(
  state: TimelineDocumentsState,
  collectionTimelineId: string,
  childClips: TimelineClip[],
  newTimelineId?: string,
) {
  const targetId = newTimelineId || collectionTimelineId;
  const childDoc = getTimelineDocumentFromState(state, targetId);
  const title = childDoc?.title || "Collection";
  let nextDocuments = state.documents;

  let totalDuration = 3;
  if (childClips.length > 0) {
    const lastClip = childClips[childClips.length - 1];
    totalDuration = lastClip.startTime + lastClip.duration + TIMELINE_LEADING_PADDING_SECONDS;
  }

  for (const parentDoc of Object.values(state.documents)) {
    let updated = false;
    const nextClips = parentDoc.clips.map((c) => {
      if (c.kind === "collection" && c.childTimelineId === collectionTimelineId) {
        updated = true;
        return {
          ...c,
          title,
          alt: `${title} collection`,
          childTimelineId: targetId,
          itemCount: childClips.length,
          previewItems: previewItemsFrom(childClips),
          duration: totalDuration,
          sourceDuration: totalDuration,
        };
      }
      return c;
    });

    if (updated) {
      nextDocuments = {
        ...nextDocuments,
        [parentDoc.id]: {
          ...parentDoc,
          clips: packTimelineClips(nextClips),
        },
      };
    }
  }

  return {
    ...state,
    documents: nextDocuments,
  };
}

export function addClipToCollectionInState(
  state: TimelineDocumentsState,
  collectionTimelineId: string,
  clip: TimelineClip,
) {
  const doc = state.documents[collectionTimelineId];
  if (!doc) {
    return { state, clip: null };
  }

  const nextClips = packTimelineClips([...doc.clips, cloneTimelineClip(clip)]);
  const nextState = registerTimelineDocumentInState(state, {
    ...doc,
    clips: nextClips,
  });

  return {
    state: syncParentCollectionsInState(nextState, collectionTimelineId, nextClips),
    clip,
  };
}

export function createCollectionTimelineDocument(id: string, title: string) {
  return registerTimelineDocument({
    id,
    title,
    clips: [],
  }, { persist: true });
}

export function getTimelineContentDuration(timelineId: string) {
  return getTimelineContentDurationFromState(defaultTimelineDocumentsState, timelineId);
}

export function getTimelineContentDurationFromState(
  state: TimelineDocumentsState,
  timelineId: string,
) {
  const doc = state.documents[timelineId];
  return doc ? getClipsDuration(doc.clips) : null;
}

export function getCollectionClipSourceDuration(clip: CollectionTimelineClip) {
  return getCollectionClipSourceDurationFromState(defaultTimelineDocumentsState, clip);
}

export function getCollectionClipSourceDurationFromState(
  state: TimelineDocumentsState,
  clip: CollectionTimelineClip,
) {
  return Math.max(
    clip.duration,
    clip.sourceDuration,
    getTimelineContentDurationFromState(state, clip.childTimelineId) ?? 0,
  );
}

function getClipSourceDuration(state: TimelineDocumentsState, clip: TimelineClip) {
  return clip.kind === "collection"
    ? getCollectionClipSourceDurationFromState(state, clip)
    : Math.max(clip.duration, clip.sourceDuration);
}

function getClipEndpointFramePreview(
  state: TimelineDocumentsState,
  clip: TimelineClip,
  endpoint: "first" | "last",
  visited = new Set<string>(),
): CollectionFramePreview | null {
  const sourceDuration = getClipSourceDuration(state, clip);

  if (clip.kind === "collection") {
    return getCollectionFramePreviewFromState(
      state,
      clip.childTimelineId,
      endpoint === "first" ? 0 : Math.max(0, sourceDuration - 0.001),
      visited,
    );
  }

  // Audio has no frame to preview. Returning null (rather than widening
  // CollectionFramePreview.kind) keeps `MediaKind` meaning "can be a PICTURE",
  // which is what every consumer of this type assumes.
  if (clip.kind === "audio") return null;

  return {
    id: clip.id,
    kind: clip.kind,
    src: clip.src,
    poster: clip.poster,
    alt: clip.alt,
    previewTime:
      clip.kind === "video" && endpoint === "last"
        ? Math.max(0, sourceDuration - 0.05)
        : 0,
    sourceDuration,
    playbackRate: 1,
  };
}

export function getCollectionEndpointSummary(clip: CollectionTimelineClip) {
  return getCollectionEndpointSummaryFromState(defaultTimelineDocumentsState, clip);
}

export function getCollectionEndpointSummaryFromState(
  state: TimelineDocumentsState,
  clip: CollectionTimelineClip,
) {
  const doc = state.documents[clip.childTimelineId];
  const childClips = doc?.clips ?? [];
  const firstClip = childClips[0] ?? null;
  const lastClip = childClips[childClips.length - 1] ?? firstClip;

  if (!firstClip || !lastClip) {
    const fallbackFirst = clip.previewItems?.[0] ?? null;
    const fallbackLast =
      clip.previewItems?.[clip.previewItems.length - 1] ?? fallbackFirst;

    return {
      first: fallbackFirst
        ? {
            ...fallbackFirst,
            previewTime: 0,
            sourceDuration: Math.max(clip.duration, clip.sourceDuration, 0.001),
            playbackRate: 1,
          }
        : null,
      last: fallbackLast
        ? {
            ...fallbackLast,
            previewTime: 0,
            sourceDuration: Math.max(clip.duration, clip.sourceDuration, 0.001),
            playbackRate: 1,
          }
        : null,
      sourceDuration: Math.max(clip.duration, clip.sourceDuration, 0.001),
    };
  }

  const firstDuration = getClipSourceDuration(state, firstClip);
  const lastDuration = getClipSourceDuration(state, lastClip);
  const equalSegmentDuration = Math.max(firstDuration, lastDuration, 0.001);

  return {
    first: getClipEndpointFramePreview(state, firstClip, "first"),
    last: getClipEndpointFramePreview(state, lastClip, "last"),
    sourceDuration: equalSegmentDuration * 2,
  };
}

export function getCollectionClipFramePreview(
  clip: CollectionTimelineClip,
  clipTime: number,
  visited = new Set<string>(),
  parentPlaybackRate = 1,
): CollectionFramePreview | null {
  return getCollectionClipFramePreviewFromState(
    defaultTimelineDocumentsState,
    clip,
    clipTime,
    visited,
    parentPlaybackRate,
  );
}

export function getCollectionClipFramePreviewFromState(
  state: TimelineDocumentsState,
  clip: CollectionTimelineClip,
  clipTime: number,
  visited = new Set<string>(),
  parentPlaybackRate = 1,
): CollectionFramePreview | null {
  const sourceDuration = getCollectionClipSourceDurationFromState(state, clip);
  const sourceRange = Math.max(0, sourceDuration - clip.trimIn - clip.trimOut);
  const progress = clip.duration > 0 ? clamp(clipTime / clip.duration, 0, 1) : 0;
  const sourceTime = clamp(
    clip.trimIn + progress * sourceRange,
    0,
    Math.max(0, sourceDuration - 0.001),
  );
  const playbackRate =
    clip.duration > 0 && sourceRange > 0
      ? parentPlaybackRate * (sourceRange / clip.duration)
      : parentPlaybackRate;

  return getCollectionFramePreviewFromState(
    state,
    clip.childTimelineId,
    sourceTime,
    visited,
    playbackRate,
  );
}

export function getCollectionFramePreview(
  collectionTimelineId: string,
  time: number,
  visited = new Set<string>(),
  playbackRate = 1,
): CollectionFramePreview | null {
  return getCollectionFramePreviewFromState(
    defaultTimelineDocumentsState,
    collectionTimelineId,
    time,
    visited,
    playbackRate,
  );
}

export function getCollectionFramePreviewFromState(
  state: TimelineDocumentsState,
  collectionTimelineId: string,
  time: number,
  visited = new Set<string>(),
  playbackRate = 1,
): CollectionFramePreview | null {
  if (visited.has(collectionTimelineId)) return null;
  const nextVisited = new Set(visited);
  nextVisited.add(collectionTimelineId);

  const doc = state.documents[collectionTimelineId];
  const childClips = doc ? doc.clips : [];
  
  if (childClips.length === 0) return null;

  let activeClip: TimelineClip | null = null;
  let previousClip: TimelineClip | null = null;
  let firstFutureClip: TimelineClip | null = null;

  for (const c of childClips) {
    const start = c.startTime;
    const end = c.startTime + c.duration;
    if (time >= start && time <= end) {
      activeClip = c;
      break;
    }

    if (end < time) {
      if (!previousClip || end > previousClip.startTime + previousClip.duration) {
        previousClip = c;
      }
      continue;
    }

    if (start > time && (!firstFutureClip || start < firstFutureClip.startTime)) {
      firstFutureClip = c;
    }
  }

  const c = activeClip || previousClip || firstFutureClip;
  if (c) {
    const start = c.startTime;
    const relativeOffset = clamp(time - start, 0, c.duration);

    if (c.kind === "collection") {
      const nestedPreview = getCollectionClipFramePreviewFromState(
        state,
        c,
        relativeOffset,
        nextVisited,
        playbackRate,
      );
      if (nestedPreview) return nestedPreview;

      const fallbackPreview = c.previewItems?.[0];
      if (!fallbackPreview) return null;

      return {
        id: fallbackPreview.id,
        kind: fallbackPreview.kind,
        src: fallbackPreview.src,
        poster: fallbackPreview.poster,
        alt: fallbackPreview.alt,
        previewTime: 0,
        sourceDuration: c.sourceDuration || c.duration || 1,
        playbackRate,
      };
    }

    // The collection branch above returns, so `c` is a MediaTimelineClip here
    // and every field below is on the type — the casts these lines used to
    // carry predated the discriminated union and were hiding that.
    //
    // Audio is the exception: it is media, but it is not a PICTURE, so it can
    // never be the frame shown for a moment in time. Null lets the caller fall
    // back to a neighbouring visual clip rather than rendering a .flac as one.
    if (c.kind === "audio") return null;
    const sourceDuration = c.sourceDuration || c.duration || 1;
    const previewTime =
      c.kind === "video"
        ? clamp(c.trimIn + relativeOffset, 0, Math.max(0, sourceDuration - 0.001))
        : 0;

    return {
      id: c.id,
      kind: c.kind,
      src: c.src,
      poster: c.poster,
      alt: c.alt,
      previewTime,
      sourceDuration,
      playbackRate,
    };
  }
  
  return null;
}

export function getTimelinePage(id: string) {
  return getTimelinePageFromState(defaultTimelineDocumentsState, id);
}

export function getTimelinePageFromState(state: TimelineDocumentsState, id: string) {
  const page = state.pages[id];
  if (!page) return null;

  return {
    id: page.id,
    title: page.title,
    description: page.description,
    timelines: page.timelineIds
      .map((timelineId) => getTimelineDocumentFromState(state, timelineId))
      .filter((timeline): timeline is TimelineDocument => Boolean(timeline)),
  };
}

export function getChangedTimelineDocumentIds(
  previous: TimelineDocumentsState,
  next: TimelineDocumentsState,
) {
  const ids = new Set([
    ...Object.keys(previous.documents),
    ...Object.keys(next.documents),
  ]);

  return Array.from(ids).filter(
    (id) => previous.documents[id] !== next.documents[id],
  );
}

export { persistTimelineDocument };
