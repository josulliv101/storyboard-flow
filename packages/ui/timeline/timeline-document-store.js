"use client";
import { createContext, createElement, useCallback, useContext, useLayoutEffect, useMemo, useReducer, useRef, } from "react";
import { addClipToCollectionInState, cloneTimelineDocument, createTimelineDocumentsState, getChangedTimelineDocumentIds, getCollectionClipFramePreviewFromState, getCollectionClipSourceDurationFromState, getCollectionEndpointSummaryFromState, getTimelineDocumentFromState, getTimelinePageFromState, getTimelinePathFromState, persistTimelineDocument, registerTimelineDocumentInState, syncParentCollectionsInState, } from "./timeline-documents";
export function timelineDocumentsReducer(state, action) {
    switch (action.type) {
        case "register-document":
            return registerTimelineDocumentInState(state, action.document);
        case "sync-parent-collections":
            return syncParentCollectionsInState(state, action.collectionTimelineId, action.childClips, action.newTimelineId);
        case "add-clip-to-collection":
            return addClipToCollectionInState(state, action.collectionTimelineId, action.clip).state;
        default:
            return state;
    }
}
const TimelineDocumentsContext = createContext(null);
function emitTimelineUpdate(timelineId, document) {
    if (typeof window === "undefined")
        return;
    window.dispatchEvent(new CustomEvent("gstudio-timeline-update", {
        detail: { timelineId, document },
    }));
}
function createReadOnlyTimelineDocumentsStore() {
    const state = createTimelineDocumentsState();
    const dispatch = () => { };
    return {
        state,
        dispatch,
        getTimelineDocument: (id) => getTimelineDocumentFromState(state, id),
        getTimelinePage: (id) => getTimelinePageFromState(state, id),
        getTimelinePath: (id) => getTimelinePathFromState(state, id),
        registerTimelineDocument: (document, options = {}) => {
            const nextDocument = cloneTimelineDocument(document);
            if (options.persist) {
                persistTimelineDocument(nextDocument);
            }
            return nextDocument;
        },
        syncParentCollections: () => { },
        addClipToCollection: (_collectionTimelineId, clip) => clip,
        createCollectionTimelineDocument: (id, title) => ({ id, title, clips: [] }),
        getCollectionClipSourceDuration: (clip) => getCollectionClipSourceDurationFromState(state, clip),
        getCollectionEndpointSummary: (clip) => getCollectionEndpointSummaryFromState(state, clip),
        getCollectionClipFramePreview: (clip, clipTime, visited, parentPlaybackRate) => getCollectionClipFramePreviewFromState(state, clip, clipTime, visited, parentPlaybackRate),
        emitTimelineUpdate,
    };
}
const readOnlyTimelineDocumentsStore = createReadOnlyTimelineDocumentsStore();
export function TimelineDocumentsProvider({ children, initialState, }) {
    const [state, dispatch] = useReducer(timelineDocumentsReducer, initialState !== null && initialState !== void 0 ? initialState : createTimelineDocumentsState());
    const stateRef = useRef(state);
    useLayoutEffect(() => {
        stateRef.current = state;
    }, [state]);
    const dispatchWithEffects = useCallback((action, effects = {}) => {
        var _a, _b;
        const previous = stateRef.current;
        const next = timelineDocumentsReducer(previous, action);
        const changedIds = getChangedTimelineDocumentIds(previous, next);
        stateRef.current = next;
        dispatch(action);
        const idsToPersist = effects.persist === "changed" ? changedIds : (_a = effects.persist) !== null && _a !== void 0 ? _a : [];
        idsToPersist.forEach((id) => {
            const document = getTimelineDocumentFromState(next, id);
            if (document) {
                persistTimelineDocument(document);
            }
        });
        const idsToEmit = effects.emit === "changed" ? changedIds : (_b = effects.emit) !== null && _b !== void 0 ? _b : [];
        idsToEmit.forEach((id) => { var _a; return emitTimelineUpdate(id, (_a = getTimelineDocumentFromState(next, id)) !== null && _a !== void 0 ? _a : undefined); });
        return { next, changedIds };
    }, []);
    const getTimelineDocument = useCallback((id) => getTimelineDocumentFromState(stateRef.current, id), []);
    const getTimelinePage = useCallback((id) => getTimelinePageFromState(stateRef.current, id), []);
    const getTimelinePath = useCallback((id) => getTimelinePathFromState(stateRef.current, id), []);
    const registerTimelineDocument = useCallback((document, options = {}) => {
        var _a;
        const result = dispatchWithEffects({
            type: "register-document",
            document,
        }, {
            persist: options.persist ? [document.id] : [],
        });
        return ((_a = getTimelineDocumentFromState(result.next, document.id)) !== null && _a !== void 0 ? _a : cloneTimelineDocument(document));
    }, [dispatchWithEffects]);
    const syncParentCollections = useCallback((collectionTimelineId, childClips, newTimelineId) => {
        dispatchWithEffects({
            type: "sync-parent-collections",
            collectionTimelineId,
            childClips,
            newTimelineId,
        }, {
            persist: "changed",
            emit: "changed",
        });
    }, [dispatchWithEffects]);
    const addClipToCollection = useCallback((collectionTimelineId, clip) => {
        const result = addClipToCollectionInState(stateRef.current, collectionTimelineId, clip);
        if (!result.clip)
            return null;
        const previous = stateRef.current;
        stateRef.current = result.state;
        dispatch({
            type: "add-clip-to-collection",
            collectionTimelineId,
            clip,
        });
        const changedIds = getChangedTimelineDocumentIds(previous, result.state);
        changedIds.forEach((id) => {
            const document = getTimelineDocumentFromState(result.state, id);
            if (document) {
                persistTimelineDocument(document);
            }
        });
        changedIds.forEach((id) => {
            var _a;
            return emitTimelineUpdate(id, (_a = getTimelineDocumentFromState(result.state, id)) !== null && _a !== void 0 ? _a : undefined);
        });
        return result.clip;
    }, []);
    const createCollectionTimelineDocument = useCallback((id, title) => registerTimelineDocument({ id, title, clips: [] }, { persist: true }), [registerTimelineDocument]);
    const getCollectionClipSourceDuration = useCallback((clip) => getCollectionClipSourceDurationFromState(stateRef.current, clip), []);
    const getCollectionEndpointSummary = useCallback((clip) => getCollectionEndpointSummaryFromState(stateRef.current, clip), []);
    const getCollectionClipFramePreview = useCallback((clip, clipTime, visited, parentPlaybackRate) => getCollectionClipFramePreviewFromState(stateRef.current, clip, clipTime, visited, parentPlaybackRate), []);
    const store = useMemo(() => {
        return {
            state,
            dispatch,
            getTimelineDocument,
            getTimelinePage,
            getTimelinePath,
            registerTimelineDocument,
            syncParentCollections,
            addClipToCollection,
            createCollectionTimelineDocument,
            getCollectionClipSourceDuration,
            getCollectionEndpointSummary,
            getCollectionClipFramePreview,
            emitTimelineUpdate,
        };
    }, [
        addClipToCollection,
        createCollectionTimelineDocument,
        getCollectionClipFramePreview,
        getCollectionClipSourceDuration,
        getCollectionEndpointSummary,
        getTimelineDocument,
        getTimelinePage,
        getTimelinePath,
        registerTimelineDocument,
        state,
        syncParentCollections,
    ]);
    return createElement(TimelineDocumentsContext.Provider, { value: store }, children);
}
export function useOptionalTimelineDocuments() {
    return useContext(TimelineDocumentsContext);
}
export function useTimelineDocuments() {
    var _a;
    return (_a = useContext(TimelineDocumentsContext)) !== null && _a !== void 0 ? _a : readOnlyTimelineDocumentsStore;
}
