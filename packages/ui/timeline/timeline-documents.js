import { CLIP_GAP_SECONDS, TIMELINE_LEADING_PADDING_SECONDS, } from "./constants";
import { createInitialClips } from "./hooks/use-timeline-clips";
function clamp(val, min, max) {
    return Math.min(Math.max(val, min), max);
}
function getClipsDuration(clips) {
    return clips.reduce((duration, clip) => Math.max(duration, clip.startTime + clip.duration), 0);
}
function cloneClipForDocument(documentId, clip) {
    return Object.assign(Object.assign({}, clip), { id: `${documentId}-${clip.id}`, alt: `${clip.alt} (${documentId})` });
}
function createMediaClips(documentId, count) {
    return createInitialClips(count, 100).map((clip) => cloneClipForDocument(documentId, clip));
}
function createCollectionClip({ childTimelineId, duration, id, itemCount, previewItems, title, }) {
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
function previewItemsFrom(clips) {
    const mediaClips = clips.filter((clip) => clip.kind === "image" || clip.kind === "video");
    const previewClips = mediaClips.length <= 3
        ? mediaClips
        : [
            mediaClips[0],
            mediaClips[Math.floor(mediaClips.length / 2)],
            mediaClips[mediaClips.length - 1],
        ];
    return previewClips.map((clip) => ({
        id: clip.id,
        kind: clip.kind,
        src: clip.src,
        poster: clip.poster,
        alt: clip.alt,
    }));
}
export function packTimelineClips(clips) {
    let nextStartTime = TIMELINE_LEADING_PADDING_SECONDS;
    return clips.map((clip, index) => {
        const nextClip = Object.assign(Object.assign({}, clip), { index, startTime: nextStartTime });
        nextStartTime += nextClip.duration + CLIP_GAP_SECONDS;
        return nextClip;
    });
}
export function cloneTimelineDocument(document) {
    return JSON.parse(JSON.stringify(document));
}
export function cloneTimelineClip(clip) {
    return JSON.parse(JSON.stringify(clip));
}
export function isUnsavedProjectPlaceholder(document) {
    return (document.id.startsWith("project-") &&
        document.title === "Loading Project" &&
        document.clips.length === 0);
}
const sceneADetailsClips = createMediaClips("scene-a-details", 18);
const sceneBClips = createMediaClips("scene-b", 26);
const collectionBoardActOneClips = createMediaClips("collection-board-act-one", 12);
const collectionBoardActTwoClips = createMediaClips("collection-board-act-two", 16);
const collectionBoardActThreeClips = createMediaClips("collection-board-act-three", 14);
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
const initialTimelineDocuments = {
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
        description: "A collection timeline made only of other collection items.",
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
        clips: rootClips.map((c) => (Object.assign({}, c))),
    },
    workbench: {
        id: "workbench",
        title: "Workbench Workspace",
        description: "Your workbench assembly timeline.",
        clips: sceneAClips.map((c) => (Object.assign({}, c))),
    },
};
const initialTimelinePages = {
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
function cloneTimelineDocuments(documents) {
    return Object.fromEntries(Object.entries(documents).map(([id, document]) => [
        id,
        cloneTimelineDocument(document),
    ]));
}
function cloneTimelinePages(pages) {
    return Object.fromEntries(Object.entries(pages).map(([id, page]) => [
        id,
        Object.assign(Object.assign({}, page), { timelineIds: [...page.timelineIds] }),
    ]));
}
export function createInitialTimelineDocuments() {
    return cloneTimelineDocuments(initialTimelineDocuments);
}
export function createInitialTimelinePages() {
    return cloneTimelinePages(initialTimelinePages);
}
export function createTimelineDocumentsState(documents = createInitialTimelineDocuments(), pages = createInitialTimelinePages()) {
    return {
        documents: cloneTimelineDocuments(documents),
        pages: cloneTimelinePages(pages),
    };
}
const defaultTimelineDocumentsState = createTimelineDocumentsState();
function persistTimelineDocument(document) {
    if (typeof window === "undefined")
        return;
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
export function getTimelineDocument(id) {
    return getTimelineDocumentFromState(defaultTimelineDocumentsState, id);
}
export function getTimelineDocumentFromState(state, id) {
    const document = state.documents[id];
    return document ? cloneTimelineDocument(document) : null;
}
export function registerTimelineDocumentInState(state, document) {
    return Object.assign(Object.assign({}, state), { documents: Object.assign(Object.assign({}, state.documents), { [document.id]: cloneTimelineDocument(document) }) });
}
export function registerTimelineDocument(document, options = {}) {
    const nextDocument = cloneTimelineDocument(document);
    if (options.persist) {
        persistTimelineDocument(nextDocument);
    }
    return nextDocument;
}
export function getTimelinePath(targetId) {
    return getTimelinePathFromState(defaultTimelineDocumentsState, targetId);
}
export function getTimelinePathFromState(state, targetId) {
    const path = [];
    let currentId = targetId;
    while (currentId && currentId !== "root") {
        let parentId = null;
        let parentTitle = "";
        for (const doc of Object.values(state.documents)) {
            const hasChild = doc.clips.some((clip) => clip.kind === "collection" && clip.childTimelineId === currentId);
            if (hasChild) {
                parentId = doc.id;
                parentTitle = doc.title;
                break;
            }
        }
        if (parentId) {
            path.unshift({ id: parentId, title: parentTitle });
            currentId = parentId;
        }
        else {
            break;
        }
    }
    return path;
}
export function syncParentCollections(collectionTimelineId, childClips, newTimelineId) {
    return syncParentCollectionsInState(defaultTimelineDocumentsState, collectionTimelineId, childClips, newTimelineId);
}
export function syncParentCollectionsInState(state, collectionTimelineId, childClips, newTimelineId) {
    const targetId = newTimelineId || collectionTimelineId;
    const childDoc = getTimelineDocumentFromState(state, targetId);
    const title = (childDoc === null || childDoc === void 0 ? void 0 : childDoc.title) || "Collection";
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
                return Object.assign(Object.assign({}, c), { title, alt: `${title} collection`, childTimelineId: targetId, itemCount: childClips.length, previewItems: previewItemsFrom(childClips), duration: totalDuration, sourceDuration: totalDuration });
            }
            return c;
        });
        if (updated) {
            nextDocuments = Object.assign(Object.assign({}, nextDocuments), { [parentDoc.id]: Object.assign(Object.assign({}, parentDoc), { clips: packTimelineClips(nextClips) }) });
        }
    }
    return Object.assign(Object.assign({}, state), { documents: nextDocuments });
}
export function addClipToCollection(collectionTimelineId, clip) {
    const newClip = Object.assign(Object.assign({}, clip), { id: `${collectionTimelineId}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}` });
    return newClip;
}
export function addClipToCollectionInState(state, collectionTimelineId, clip) {
    const doc = state.documents[collectionTimelineId];
    if (!doc) {
        return { state, clip: null };
    }
    const nextClips = packTimelineClips([...doc.clips, cloneTimelineClip(clip)]);
    const nextState = registerTimelineDocumentInState(state, Object.assign(Object.assign({}, doc), { clips: nextClips }));
    return {
        state: syncParentCollectionsInState(nextState, collectionTimelineId, nextClips),
        clip,
    };
}
export function createCollectionTimelineDocument(id, title) {
    return registerTimelineDocument({
        id,
        title,
        clips: [],
    }, { persist: true });
}
export function getTimelineContentDuration(timelineId) {
    return getTimelineContentDurationFromState(defaultTimelineDocumentsState, timelineId);
}
export function getTimelineContentDurationFromState(state, timelineId) {
    const doc = state.documents[timelineId];
    return doc ? getClipsDuration(doc.clips) : null;
}
export function getCollectionClipSourceDuration(clip) {
    return getCollectionClipSourceDurationFromState(defaultTimelineDocumentsState, clip);
}
export function getCollectionClipSourceDurationFromState(state, clip) {
    var _a;
    return Math.max(clip.duration, clip.sourceDuration, (_a = getTimelineContentDurationFromState(state, clip.childTimelineId)) !== null && _a !== void 0 ? _a : 0);
}
function getClipSourceDuration(state, clip) {
    return clip.kind === "collection"
        ? getCollectionClipSourceDurationFromState(state, clip)
        : Math.max(clip.duration, clip.sourceDuration);
}
function getClipEndpointFramePreview(state, clip, endpoint, visited = new Set()) {
    const sourceDuration = getClipSourceDuration(state, clip);
    if (clip.kind === "collection") {
        return getCollectionFramePreviewFromState(state, clip.childTimelineId, endpoint === "first" ? 0 : Math.max(0, sourceDuration - 0.001), visited);
    }
    return {
        id: clip.id,
        kind: clip.kind,
        src: clip.src,
        poster: clip.poster,
        alt: clip.alt,
        previewTime: clip.kind === "video" && endpoint === "last"
            ? Math.max(0, sourceDuration - 0.05)
            : 0,
        sourceDuration,
        playbackRate: 1,
    };
}
export function getCollectionEndpointSummary(clip) {
    return getCollectionEndpointSummaryFromState(defaultTimelineDocumentsState, clip);
}
export function getCollectionEndpointSummaryFromState(state, clip) {
    var _a, _b, _c, _d, _e, _f, _g;
    const doc = state.documents[clip.childTimelineId];
    const childClips = (_a = doc === null || doc === void 0 ? void 0 : doc.clips) !== null && _a !== void 0 ? _a : [];
    const firstClip = (_b = childClips[0]) !== null && _b !== void 0 ? _b : null;
    const lastClip = (_c = childClips[childClips.length - 1]) !== null && _c !== void 0 ? _c : firstClip;
    if (!firstClip || !lastClip) {
        const fallbackFirst = (_e = (_d = clip.previewItems) === null || _d === void 0 ? void 0 : _d[0]) !== null && _e !== void 0 ? _e : null;
        const fallbackLast = (_g = (_f = clip.previewItems) === null || _f === void 0 ? void 0 : _f[clip.previewItems.length - 1]) !== null && _g !== void 0 ? _g : fallbackFirst;
        return {
            first: fallbackFirst
                ? Object.assign(Object.assign({}, fallbackFirst), { previewTime: 0, sourceDuration: Math.max(clip.duration, clip.sourceDuration, 0.001), playbackRate: 1 }) : null,
            last: fallbackLast
                ? Object.assign(Object.assign({}, fallbackLast), { previewTime: 0, sourceDuration: Math.max(clip.duration, clip.sourceDuration, 0.001), playbackRate: 1 }) : null,
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
export function getCollectionClipFramePreview(clip, clipTime, visited = new Set(), parentPlaybackRate = 1) {
    return getCollectionClipFramePreviewFromState(defaultTimelineDocumentsState, clip, clipTime, visited, parentPlaybackRate);
}
export function getCollectionClipFramePreviewFromState(state, clip, clipTime, visited = new Set(), parentPlaybackRate = 1) {
    const sourceDuration = getCollectionClipSourceDurationFromState(state, clip);
    const sourceRange = Math.max(0, sourceDuration - clip.trimIn - clip.trimOut);
    const progress = clip.duration > 0 ? clamp(clipTime / clip.duration, 0, 1) : 0;
    const sourceTime = clamp(clip.trimIn + progress * sourceRange, 0, Math.max(0, sourceDuration - 0.001));
    const playbackRate = clip.duration > 0 && sourceRange > 0
        ? parentPlaybackRate * (sourceRange / clip.duration)
        : parentPlaybackRate;
    return getCollectionFramePreviewFromState(state, clip.childTimelineId, sourceTime, visited, playbackRate);
}
export function getCollectionFramePreview(collectionTimelineId, time, visited = new Set(), playbackRate = 1) {
    return getCollectionFramePreviewFromState(defaultTimelineDocumentsState, collectionTimelineId, time, visited, playbackRate);
}
export function getCollectionFramePreviewFromState(state, collectionTimelineId, time, visited = new Set(), playbackRate = 1) {
    var _a;
    if (visited.has(collectionTimelineId))
        return null;
    const nextVisited = new Set(visited);
    nextVisited.add(collectionTimelineId);
    const doc = state.documents[collectionTimelineId];
    const childClips = doc ? doc.clips : [];
    if (childClips.length === 0)
        return null;
    let activeClip = null;
    let previousClip = null;
    let firstFutureClip = null;
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
            const nestedPreview = getCollectionClipFramePreviewFromState(state, c, relativeOffset, nextVisited, playbackRate);
            if (nestedPreview)
                return nestedPreview;
            const fallbackPreview = (_a = c.previewItems) === null || _a === void 0 ? void 0 : _a[0];
            if (!fallbackPreview)
                return null;
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
        const sourceDuration = c.sourceDuration || c.duration || 1;
        const previewTime = c.kind === "video"
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
export function getTimelinePage(id) {
    return getTimelinePageFromState(defaultTimelineDocumentsState, id);
}
export function getTimelinePageFromState(state, id) {
    const page = state.pages[id];
    if (!page)
        return null;
    return {
        id: page.id,
        title: page.title,
        description: page.description,
        timelines: page.timelineIds
            .map((timelineId) => getTimelineDocumentFromState(state, timelineId))
            .filter((timeline) => Boolean(timeline)),
    };
}
export function getChangedTimelineDocumentIds(previous, next) {
    const ids = new Set([
        ...Object.keys(previous.documents),
        ...Object.keys(next.documents),
    ]);
    return Array.from(ids).filter((id) => previous.documents[id] !== next.documents[id]);
}
export { persistTimelineDocument };
export function encodeFolderPath(folderPath) {
    if (typeof Buffer !== "undefined") {
        return Buffer.from(folderPath, "utf-8")
            .toString("base64")
            .replace(/\+/g, "-")
            .replace(/\//g, "_")
            .replace(/=+$/, "");
    }
    const base64 = btoa(encodeURIComponent(folderPath).replace(/%([0-9A-F]{2})/g, (match, p1) => {
        return String.fromCharCode(parseInt(p1, 16));
    }));
    return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function decodeFolderPath(encoded) {
    let base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
    while (base64.length % 4) {
        base64 += "=";
    }
    if (typeof Buffer !== "undefined") {
        return Buffer.from(base64, "base64").toString("utf-8");
    }
    return decodeURIComponent(Array.prototype.map
        .call(atob(base64), (c) => {
        return "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2);
    })
        .join(""));
}
export function getFolderPathFromTimelineId(id, userId) {
    if (id === `asset-library-${userId}`)
        return "";
    const prefix = `asset-library-col-${userId}-`;
    if (id.startsWith(prefix)) {
        const encoded = id.slice(prefix.length);
        try {
            return decodeFolderPath(encoded);
        }
        catch (_a) {
            return "";
        }
    }
    return "";
}
