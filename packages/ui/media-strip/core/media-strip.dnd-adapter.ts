import {
  closestCenter,
  type Active,
  type ClientRect,
  type Collision,
  type CollisionDetection,
  type DroppableContainer,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import { type CollectionId } from "./media-strip.types";

export type MediaStripDndAdapterId = "dnd-kit" | "pragmatic";
export type MediaStripDndIdentifier = UniqueIdentifier;
export type MediaStripDndActive = Active;
export type MediaStripDndClientRect = ClientRect;
export type MediaStripDndCollision = Collision;
export type MediaStripDndCollisionDetection = CollisionDetection;
export type MediaStripDndDroppableContainer = DroppableContainer;

export type MediaStripDndDragStartEvent = {
  active: { id: MediaStripDndIdentifier };
};

export type MediaStripDndNormalizedDragMoveEvent = {
  active: { id: MediaStripDndIdentifier };
  over: { id: MediaStripDndIdentifier } | null;
  nestTargetId?: CollectionId | null;
};

export type MediaStripDndDragMoveEvent = MediaStripDndNormalizedDragMoveEvent;
export type MediaStripDndDragOverEvent = MediaStripDndNormalizedDragMoveEvent;
export type MediaStripDndDragEndEvent = MediaStripDndNormalizedDragMoveEvent;

export const getClosestCenterCollisions = closestCenter;
