import { useReducer, useCallback } from "react";
import { type TimelineItemId, type CollectionId, type DropPlacement } from "./core/media-strip.types";
import { DEFAULT_DRAG_OVERLAY_WIDTH_PX } from "./core/media-strip.utils";

type DragState = {
  activeDragId: TimelineItemId | null;
  activeDragSourceCollectionId: CollectionId | null;
  activeNestTargetId: CollectionId | null;
  activeDropPlacement: DropPlacement | null;
  activeDragWidth: number;
};

type DragAction =
  | { type: "DRAG_START"; itemId: TimelineItemId; collectionId: CollectionId; width: number }
  | { type: "DRAG_MOVE"; nestTargetId: CollectionId | null; placement: DropPlacement | null }
  | { type: "DRAG_END_OR_CANCEL" };

function dragReducer(state: DragState, action: DragAction): DragState {
  switch (action.type) {
    case "DRAG_START":
      return {
        activeDragId: action.itemId,
        activeDragSourceCollectionId: action.collectionId,
        activeNestTargetId: null,
        activeDropPlacement: null,
        activeDragWidth: action.width,
      };
    case "DRAG_MOVE":
      return {
        ...state,
        activeNestTargetId: action.nestTargetId,
        activeDropPlacement: action.placement,
      };
    case "DRAG_END_OR_CANCEL":
      return {
        activeDragId: null,
        activeDragSourceCollectionId: null,
        activeNestTargetId: null,
        activeDropPlacement: null,
        activeDragWidth: DEFAULT_DRAG_OVERLAY_WIDTH_PX,
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
    activeDropPlacement: null,
    activeDragWidth: DEFAULT_DRAG_OVERLAY_WIDTH_PX,
  });

  const startDrag = useCallback((itemId: TimelineItemId, collectionId: CollectionId, width: number) => {
    dispatch({ type: "DRAG_START", itemId, collectionId, width });
  }, []);

  const moveDrag = useCallback((nestTargetId: CollectionId | null, placement: DropPlacement | null) => {
    dispatch({ type: "DRAG_MOVE", nestTargetId, placement });
  }, []);

  const endDrag = useCallback(() => {
    dispatch({ type: "DRAG_END_OR_CANCEL" });
  }, []);

  return {
    activeDragId: state.activeDragId,
    activeDragSourceCollectionId: state.activeDragSourceCollectionId,
    activeNestTargetId: state.activeNestTargetId,
    activeDropPlacement: state.activeDropPlacement,
    activeDragWidth: state.activeDragWidth,
    startDrag,
    moveDrag,
    endDrag,
  };
}
