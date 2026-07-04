"use client";

import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from "react";

import type {
  CollectionTimelineClip,
  TimelineClip,
  TimelineDocument,
} from "./types";
import {
  addClipToCollectionInState,
  cloneTimelineDocument,
  createTimelineDocumentsState,
  getChangedTimelineDocumentIds,
  getCollectionClipFramePreviewFromState,
  getCollectionClipSourceDurationFromState,
  getCollectionEndpointSummaryFromState,
  getTimelineDocumentFromState,
  getTimelinePageFromState,
  getTimelinePathFromState,
  persistTimelineDocument,
  registerTimelineDocumentInState,
  syncParentCollectionsInState,
  type CollectionFramePreview,
  type TimelineDocumentsState,
} from "./timeline-documents";

type RegisterTimelineDocumentOptions = {
  persist?: boolean;
};

type TimelineDocumentsAction =
  | {
      type: "register-document";
      document: TimelineDocument;
    }
  | {
      type: "sync-parent-collections";
      collectionTimelineId: string;
      childClips: TimelineClip[];
      newTimelineId?: string;
    }
  | {
      type: "add-clip-to-collection";
      collectionTimelineId: string;
      clip: TimelineClip;
    };

export function timelineDocumentsReducer(
  state: TimelineDocumentsState,
  action: TimelineDocumentsAction,
): TimelineDocumentsState {
  switch (action.type) {
    case "register-document":
      return registerTimelineDocumentInState(state, action.document);
    case "sync-parent-collections":
      return syncParentCollectionsInState(
        state,
        action.collectionTimelineId,
        action.childClips,
        action.newTimelineId,
      );
    case "add-clip-to-collection":
      return addClipToCollectionInState(
        state,
        action.collectionTimelineId,
        action.clip,
      ).state;
    default:
      return state;
  }
}

type TimelineDocumentsStore = {
  state: TimelineDocumentsState;
  dispatch: (action: TimelineDocumentsAction) => void;
  getTimelineDocument: (id: string) => TimelineDocument | null;
  getTimelinePage: (id: string) => ReturnType<typeof getTimelinePageFromState>;
  getTimelinePath: (id: string) => { id: string; title: string }[];
  registerTimelineDocument: (
    document: TimelineDocument,
    options?: RegisterTimelineDocumentOptions,
  ) => TimelineDocument;
  syncParentCollections: (
    collectionTimelineId: string,
    childClips: TimelineClip[],
    newTimelineId?: string,
  ) => void;
  addClipToCollection: (
    collectionTimelineId: string,
    clip: TimelineClip,
  ) => TimelineClip | null;
  createCollectionTimelineDocument: (
    id: string,
    title: string,
  ) => TimelineDocument;
  getCollectionClipSourceDuration: (clip: CollectionTimelineClip) => number;
  getCollectionEndpointSummary: (
    clip: CollectionTimelineClip,
  ) => ReturnType<typeof getCollectionEndpointSummaryFromState>;
  getCollectionClipFramePreview: (
    clip: CollectionTimelineClip,
    clipTime: number,
    visited?: Set<string>,
    parentPlaybackRate?: number,
  ) => CollectionFramePreview | null;
  emitTimelineUpdate: (timelineId: string, document?: TimelineDocument) => void;
};

const TimelineDocumentsContext =
  createContext<TimelineDocumentsStore | null>(null);

function emitTimelineUpdate(timelineId: string, document?: TimelineDocument) {
  if (typeof window === "undefined") return;

  window.dispatchEvent(
    new CustomEvent("gstudio-timeline-update", {
      detail: { timelineId, document },
    }),
  );
}

function createReadOnlyTimelineDocumentsStore(): TimelineDocumentsStore {
  const state = createTimelineDocumentsState();
  const dispatch = () => {};

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
    syncParentCollections: () => {},
    addClipToCollection: (_collectionTimelineId, clip) => clip,
    createCollectionTimelineDocument: (id, title) => ({ id, title, clips: [] }),
    getCollectionClipSourceDuration: (clip) =>
      getCollectionClipSourceDurationFromState(state, clip),
    getCollectionEndpointSummary: (clip) =>
      getCollectionEndpointSummaryFromState(state, clip),
    getCollectionClipFramePreview: (
      clip,
      clipTime,
      visited,
      parentPlaybackRate,
    ) =>
      getCollectionClipFramePreviewFromState(
        state,
        clip,
        clipTime,
        visited,
        parentPlaybackRate,
      ),
    emitTimelineUpdate,
  };
}

const readOnlyTimelineDocumentsStore = createReadOnlyTimelineDocumentsStore();

type TimelineDocumentsProviderProps = {
  children: ReactNode;
  initialState?: TimelineDocumentsState;
};

export function TimelineDocumentsProvider({
  children,
  initialState,
}: TimelineDocumentsProviderProps) {
  const [state, dispatch] = useReducer(
    timelineDocumentsReducer,
    initialState ?? createTimelineDocumentsState(),
  );
  const stateRef = useRef(state);

  useLayoutEffect(() => {
    stateRef.current = state;
  }, [state]);

  const dispatchWithEffects = useCallback(
    (
      action: TimelineDocumentsAction,
      effects: {
        persist?: "changed" | string[];
        emit?: "changed" | string[];
      } = {},
    ) => {
      const previous = stateRef.current;
      const next = timelineDocumentsReducer(previous, action);
      const changedIds = getChangedTimelineDocumentIds(previous, next);
      stateRef.current = next;
      dispatch(action);

      const idsToPersist =
        effects.persist === "changed" ? changedIds : effects.persist ?? [];
      idsToPersist.forEach((id) => {
        const document = getTimelineDocumentFromState(next, id);
        if (document) {
          persistTimelineDocument(document);
        }
      });

      const idsToEmit =
        effects.emit === "changed" ? changedIds : effects.emit ?? [];
      idsToEmit.forEach((id) =>
        emitTimelineUpdate(id, getTimelineDocumentFromState(next, id) ?? undefined),
      );

      return { next, changedIds };
    },
    [],
  );

  const getTimelineDocument = useCallback(
    (id: string) => getTimelineDocumentFromState(stateRef.current, id),
    [],
  );

  const getTimelinePage = useCallback(
    (id: string) => getTimelinePageFromState(stateRef.current, id),
    [],
  );

  const getTimelinePath = useCallback(
    (id: string) => getTimelinePathFromState(stateRef.current, id),
    [],
  );

  const registerTimelineDocument = useCallback(
    (document: TimelineDocument, options: RegisterTimelineDocumentOptions = {}) => {
      const result = dispatchWithEffects(
        {
          type: "register-document",
          document,
        },
        {
          persist: options.persist ? [document.id] : [],
        },
      );

      return (
        getTimelineDocumentFromState(result.next, document.id) ??
        cloneTimelineDocument(document)
      );
    },
    [dispatchWithEffects],
  );

  const syncParentCollections = useCallback(
    (
      collectionTimelineId: string,
      childClips: TimelineClip[],
      newTimelineId?: string,
    ) => {
      dispatchWithEffects(
        {
          type: "sync-parent-collections",
          collectionTimelineId,
          childClips,
          newTimelineId,
        },
        {
          persist: "changed",
          emit: "changed",
        },
      );
    },
    [dispatchWithEffects],
  );

  const addClipToCollection = useCallback(
    (collectionTimelineId: string, clip: TimelineClip) => {
      const result = addClipToCollectionInState(
        stateRef.current,
        collectionTimelineId,
        clip,
      );
      if (!result.clip) return null;

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
      changedIds.forEach((id) =>
        emitTimelineUpdate(
          id,
          getTimelineDocumentFromState(result.state, id) ?? undefined,
        ),
      );

      return result.clip;
    },
    [],
  );

  const createCollectionTimelineDocument = useCallback(
    (id: string, title: string) =>
      registerTimelineDocument({ id, title, clips: [] }, { persist: true }),
    [registerTimelineDocument],
  );

  const getCollectionClipSourceDuration = useCallback(
    (clip: CollectionTimelineClip) =>
      getCollectionClipSourceDurationFromState(stateRef.current, clip),
    [],
  );

  const getCollectionEndpointSummary = useCallback(
    (clip: CollectionTimelineClip) =>
      getCollectionEndpointSummaryFromState(stateRef.current, clip),
    [],
  );

  const getCollectionClipFramePreview = useCallback(
    (
      clip: CollectionTimelineClip,
      clipTime: number,
      visited?: Set<string>,
      parentPlaybackRate?: number,
    ) =>
      getCollectionClipFramePreviewFromState(
        stateRef.current,
        clip,
        clipTime,
        visited,
        parentPlaybackRate,
      ),
    [],
  );

  const store = useMemo<TimelineDocumentsStore>(() => {
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
  return useContext(TimelineDocumentsContext) ?? readOnlyTimelineDocumentsStore;
}
