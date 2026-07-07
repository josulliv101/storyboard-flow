import { useReducer, useCallback } from "react";
import { type TimelineItemId, type CollectionId } from "./media-strip.types";

type DragState = {
  activeDragId: TimelineItemId | null;
  activeDragSourceCollectionId: CollectionId | null;
  activeNestTargetId: CollectionId | null;
  activeDragWidth: number;
};

type DragAction =
  | { type: "DRAG_START"; itemId: TimelineItemId; collectionId: CollectionId; width: number }
  | { type: "DRAG_MOVE"; nestTargetId: CollectionId | null }
  | { type: "DRAG_END_OR_CANCEL" }
  | { type: "SET_NEST_TARGET"; nestTargetId: CollectionId | null }
  | { type: "SET_DRAG_WIDTH"; width: number };

function dragReducer(state: DragState, action: DragAction): DragState {
  switch (action.type) {
    case "DRAG_START":
      return {
        activeDragId: action.itemId,
        activeDragSourceCollectionId: action.collectionId,
        activeNestTargetId: null,
        activeDragWidth: action.width,
      };
    case "DRAG_MOVE":
    case "SET_NEST_TARGET":
      return {
        ...state,
        activeNestTargetId: action.nestTargetId,
      };
    case "DRAG_END_OR_CANCEL":
      return {
        activeDragId: null,
        activeDragSourceCollectionId: null,
        activeNestTargetId: null,
        activeDragWidth: 160,
      };
    case "SET_DRAG_WIDTH":
      return {
        ...state,
        activeDragWidth: action.width,
      };
    default:
      return state;
  }
}

/**
 * Custom hook to manage active drag state for the MediaStripBoard using an atomic reducer.
 */
export function useBoardDragState() {
  const [state, dispatch] = useReducer(dragReducer, {
    activeDragId: null,
    activeDragSourceCollectionId: null,
    activeNestTargetId: null,
    activeDragWidth: 160,
  });

  const startDrag = useCallback((itemId: TimelineItemId, collectionId: CollectionId, width: number) => {
    dispatch({ type: "DRAG_START", itemId, collectionId, width });
  }, []);

  const moveDrag = useCallback((nestTargetId: CollectionId | null) => {
    dispatch({ type: "DRAG_MOVE", nestTargetId });
  }, []);

  const endDrag = useCallback(() => {
    dispatch({ type: "DRAG_END_OR_CANCEL" });
  }, []);

  const setDragWidth = useCallback((width: number) => {
    dispatch({ type: "SET_DRAG_WIDTH", width });
  }, []);

  return {
    activeDragId: state.activeDragId,
    activeDragSourceCollectionId: state.activeDragSourceCollectionId,
    activeNestTargetId: state.activeNestTargetId,
    activeDragWidth: state.activeDragWidth,
    startDrag,
    moveDrag,
    endDrag,
    setDragWidth,
  };
}
