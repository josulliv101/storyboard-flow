import React from 'react';
const DRAG_SELECT_THRESHOLD = 5;
const REORDER_LIFT_THRESHOLD = 24;
const DROP_SETTLE_DURATION_MS = 180;
const REORDER_LIFT_HOLD_MS = 200;
const REORDER_SHRINK_DURATION_MS = 180;
const PREPARED_PREVIEW_HANDOFF_MS = 900;
const REORDER_EDGE_ZONE_MAX_PX = 140;
const REORDER_AUTO_PAN_MAX_PX_PER_FRAME = 16;
const MOMENTUM_MIN_VELOCITY = 0.035;
const MOMENTUM_FRICTION_PER_FRAME = 0.945;
const SNAP_DURATION_MS = 420;
const FAST_NAVIGATION_ENTER_VELOCITY = 0.9;
const FAST_NAVIGATION_EXIT_VELOCITY = 0.45;
const FAST_NAVIGATION_IDLE_RESET_MS = 120;
const clamp = (value, min, max) => (Math.max(min, Math.min(max, value)));
const getNearestIndexForOffset = (offset, centerPositions) => {
    let nearestIndex = 0;
    let nearestDistance = Number.POSITIVE_INFINITY;
    centerPositions.forEach((position, index) => {
        const distance = Math.abs(position + offset);
        if (distance < nearestDistance) {
            nearestDistance = distance;
            nearestIndex = index;
        }
    });
    return nearestIndex;
};
export function usePreviewWheelDragDrop({ items, disabledItemIds, itemSequences, selectedMediaId, sizing, durationScale, effect, hidePreview, viewportSize, gridView, customChunks, breakoutTitles, breakoutIsCollection, breakoutRepresentativeUrls, breakoutCollectionsEnabled, breakoutNestingLevels, allCollections, getRecursiveMediaItems, thumbnailSize, showRuler, subRowIndex, nestingLevel, gridNestingLevels, rowIndex, gridDisplayPanelHeight, gridColumnCount, offset, setOffset, offsetRef, playheadX, renderedPlayheadX, playheadPositionRatio, setPlayheadPositionRatio, setGridPlayheadRatio, onCenteredMediaChange, onCollectionOpen, onItemsReorder, onItemMoveIntoCollection, onUtilityDrop, selectReorderedItem = true, slideOnClick = true, selectItemsWhilePreviewHidden = false, syncPreviewToPlayhead = false, onScrubUpdateRef, resolveItemSnapshot, playbackTimeRef, preparedPreviewMediaIdRef, preparedPreviewHandoffTimeoutRef, setPreparedPreviewMediaId, setPreparedPreviewReady, setVisiblePreparedPreviewMediaId, setDirectPreviewMediaId, setTrimOverlayMediaId, isPreviewPlaying, viewportRef, reorderGhostRef, reorderGhostContentRef, isGallery, uniformItemWidth, itemDurations, itemWidths, isGaplessGallery, itemGap, itemStartTimes, totalDurationSeconds, itemCenterPositions, itemStartPixels, selectedIndex, childGridItemWidth, verticalLineX, indentOffset, maxOffset, minOffset, timelineOriginOffset, stripEndPixel, finalIndex, gridLeftAlignOffset, snapReferencePositions, collectionItemIds, reorderPreview, setReorderPreview, reorderPreviewOrder, setReorderPreviewOrder, freeDrag, dragRef, clickGuardRef, }) {
    const [isDragging, setIsDragging] = React.useState(false);
    const [collectionDropTargetId, setCollectionDropTargetId] = React.useState(null);
    const [utilityDropTarget, setUtilityDropTarget] = React.useState(null);
    const [isSpinning, setIsSpinning] = React.useState(false);
    const [isSnapping, setIsSnapping] = React.useState(false);
    const clickGuardTimeoutRef = React.useRef(null);
    const momentumFrameRef = React.useRef(null);
    const snapFrameRef = React.useRef(null);
    const dragFrameRef = React.useRef(null);
    const pendingDragOffsetRef = React.useRef(null);
    const dropSettleTimeoutRef = React.useRef(null);
    const pendingReorderSelectionRef = React.useRef(null);
    const skipNextReorderAlignmentRef = React.useRef(false);
    const skipNextSelectedAlignmentRef = React.useRef(false);
    const snapCompletionRef = React.useRef(null);
    const reorderAutoPanFrameRef = React.useRef(null);
    const reorderPointerRef = React.useRef({ clientX: 0, clientY: 0 });
    const reorderPreviewOrderRef = React.useRef(null);
    const fastNavigationRef = React.useRef(false);
    const fastNavigationIdleTimeoutRef = React.useRef(null);
    const updateFastNavigation = React.useCallback((velocity) => {
        const speed = Math.abs(velocity);
        const nextFastNavigation = fastNavigationRef.current
            ? speed > FAST_NAVIGATION_EXIT_VELOCITY
            : speed >= FAST_NAVIGATION_ENTER_VELOCITY;
        if (nextFastNavigation === fastNavigationRef.current)
            return;
        fastNavigationRef.current = nextFastNavigation;
    }, []);
    React.useEffect(() => () => {
        if (dragFrameRef.current !== null) {
            window.cancelAnimationFrame(dragFrameRef.current);
        }
        if (momentumFrameRef.current !== null) {
            window.cancelAnimationFrame(momentumFrameRef.current);
        }
        if (snapFrameRef.current !== null) {
            window.cancelAnimationFrame(snapFrameRef.current);
        }
        if (clickGuardTimeoutRef.current !== null) {
            window.clearTimeout(clickGuardTimeoutRef.current);
        }
        if (fastNavigationIdleTimeoutRef.current !== null) {
            window.clearTimeout(fastNavigationIdleTimeoutRef.current);
        }
        if (dropSettleTimeoutRef.current !== null) {
            window.clearTimeout(dropSettleTimeoutRef.current);
        }
        if (reorderAutoPanFrameRef.current !== null) {
            window.cancelAnimationFrame(reorderAutoPanFrameRef.current);
        }
        if (preparedPreviewHandoffTimeoutRef.current !== null) {
            window.clearTimeout(preparedPreviewHandoffTimeoutRef.current);
        }
    }, [preparedPreviewHandoffTimeoutRef]);
    const stopAnimation = React.useCallback(() => {
        if (dragFrameRef.current !== null) {
            window.cancelAnimationFrame(dragFrameRef.current);
            dragFrameRef.current = null;
        }
        pendingDragOffsetRef.current = null;
        if (fastNavigationIdleTimeoutRef.current !== null) {
            window.clearTimeout(fastNavigationIdleTimeoutRef.current);
            fastNavigationIdleTimeoutRef.current = null;
        }
        updateFastNavigation(0);
        if (momentumFrameRef.current !== null) {
            window.cancelAnimationFrame(momentumFrameRef.current);
            momentumFrameRef.current = null;
        }
        if (snapFrameRef.current !== null) {
            window.cancelAnimationFrame(snapFrameRef.current);
            snapFrameRef.current = null;
        }
        snapCompletionRef.current = null;
        setIsSpinning(false);
        setIsSnapping(false);
    }, [updateFastNavigation]);
    const clearClickGuardSoon = React.useCallback(() => {
        if (clickGuardTimeoutRef.current !== null) {
            window.clearTimeout(clickGuardTimeoutRef.current);
        }
        clickGuardTimeoutRef.current = window.setTimeout(() => {
            clickGuardRef.current = false;
            clickGuardTimeoutRef.current = null;
        }, 140);
    }, []);
    const getCenteredMediaIdForOrder = React.useCallback((order) => {
        var _a;
        const firstItemIndex = items.findIndex(item => item.id === order[0]);
        const durationOrigin = ((_a = itemWidths[firstItemIndex]) !== null && _a !== void 0 ? _a : uniformItemWidth) / 2;
        let cursor = 0;
        let nearestMediaId = null;
        let nearestDistance = Number.POSITIVE_INFINITY;
        order.forEach((mediaId, orderIndex) => {
            var _a;
            const itemIndex = items.findIndex(item => item.id === mediaId);
            const width = (_a = itemWidths[itemIndex]) !== null && _a !== void 0 ? _a : uniformItemWidth;
            const referencePosition = (sizing === 'duration' || isGallery)
                ? cursor - durationOrigin
                : cursor + width / 2;
            const distance = Math.abs(referencePosition + offsetRef.current);
            if (distance < nearestDistance) {
                nearestDistance = distance;
                nearestMediaId = mediaId;
            }
            cursor += width + (orderIndex < order.length - 1 ? itemGap : 0);
        });
        return nearestMediaId;
    }, [itemGap, itemWidths, items, sizing, uniformItemWidth, offsetRef]);
    const prepareFixedCenterPreview = React.useCallback((order) => {
        if (selectReorderedItem)
            return;
        const mediaId = getCenteredMediaIdForOrder(order);
        if (!mediaId || mediaId === preparedPreviewMediaIdRef.current)
            return;
        preparedPreviewMediaIdRef.current = mediaId;
        setPreparedPreviewMediaId(mediaId);
        setPreparedPreviewReady(false);
        setVisiblePreparedPreviewMediaId(null);
    }, [getCenteredMediaIdForOrder, selectReorderedItem, preparedPreviewMediaIdRef, setPreparedPreviewMediaId, setPreparedPreviewReady, setVisiblePreparedPreviewMediaId]);
    const updateReorderTarget = React.useCallback((clientX, clientY) => {
        var _a, _b, _c;
        const drag = dragRef.current;
        if (drag.mode !== 'reorder' || !drag.targetMediaId)
            return;
        const candidates = Array.from((_b = (_a = viewportRef.current) === null || _a === void 0 ? void 0 : _a.querySelectorAll('[data-preview-wheel-item-id]')) !== null && _b !== void 0 ? _b : []).filter(element => element.dataset.previewWheelItemId !== drag.targetMediaId);
        const target = candidates.reduce((nearest, element) => {
            const bounds = element.getBoundingClientRect();
            const distance = Math.abs(clientX - (bounds.left + bounds.width / 2));
            return !nearest || distance < nearest.distance ? { element, distance } : nearest;
        }, null);
        const targetMediaId = target === null || target === void 0 ? void 0 : target.element.dataset.previewWheelItemId;
        if (!target || !targetMediaId)
            return;
        const bounds = target.element.getBoundingClientRect();
        const isCollectionTarget = collectionItemIds.includes(targetMediaId);
        const isInsideTarget = isCollectionTarget &&
            clientX >= bounds.left + bounds.width * 0.25 &&
            clientX <= bounds.right - bounds.width * 0.25 &&
            clientY >= bounds.top - 24 &&
            clientY <= bounds.bottom + 24;
        if (isInsideTarget) {
            const reorderTarget = `${targetMediaId}:inside`;
            if (drag.lastReorderTarget === reorderTarget)
                return;
            drag.lastReorderTarget = reorderTarget;
            drag.reorderTargetMediaId = targetMediaId;
            drag.reorderPosition = 'inside';
            setCollectionDropTargetId(targetMediaId);
            const initialOrder = items.map(item => item.id);
            reorderPreviewOrderRef.current = initialOrder;
            setReorderPreviewOrder(initialOrder);
            return;
        }
        setCollectionDropTargetId(null);
        const position = clientX < bounds.left + bounds.width / 2 ? 'before' : 'after';
        const reorderTarget = `${targetMediaId}:${position}`;
        if (drag.lastReorderTarget === reorderTarget)
            return;
        drag.lastReorderTarget = reorderTarget;
        drag.reorderTargetMediaId = targetMediaId;
        drag.reorderPosition = position;
        const next = [...((_c = reorderPreviewOrderRef.current) !== null && _c !== void 0 ? _c : items.map(item => item.id))];
        const draggedIndex = next.indexOf(drag.targetMediaId);
        if (draggedIndex >= 0)
            next.splice(draggedIndex, 1);
        const targetIndex = next.indexOf(targetMediaId);
        if (targetIndex < 0)
            return;
        next.splice(targetIndex + (position === 'after' ? 1 : 0), 0, drag.targetMediaId);
        reorderPreviewOrderRef.current = next;
        prepareFixedCenterPreview(next);
        setReorderPreviewOrder(next);
    }, [collectionItemIds, items, prepareFixedCenterPreview, viewportRef, reorderPreviewOrderRef]);
    const startReorderAutoPan = React.useCallback(() => {
        if (reorderAutoPanFrameRef.current !== null)
            return;
        let previousTime = performance.now();
        let previousHitTestTime = 0;
        const step = (time) => {
            const drag = dragRef.current;
            const viewport = viewportRef.current;
            if (drag.mode !== 'reorder' || !viewport) {
                reorderAutoPanFrameRef.current = null;
                return;
            }
            const deltaFrames = Math.min(2, Math.max(0.25, (time - previousTime) / 16.67));
            previousTime = time;
            const bounds = viewport.getBoundingClientRect();
            const edgeZone = Math.min(REORDER_EDGE_ZONE_MAX_PX, bounds.width * 0.18);
            const pointerX = reorderPointerRef.current.clientX;
            const leftStrength = clamp((bounds.left + edgeZone - pointerX) / edgeZone, 0, 1);
            const rightStrength = clamp((pointerX - (bounds.right - edgeZone)) / edgeZone, 0, 1);
            const panDelta = (leftStrength * leftStrength - rightStrength * rightStrength) * REORDER_AUTO_PAN_MAX_PX_PER_FRAME * deltaFrames;
            if (Math.abs(panDelta) > 0.01) {
                const previousOffset = offsetRef.current;
                setOffset(previousOffset + panDelta);
                if (offsetRef.current !== previousOffset && time - previousHitTestTime >= 48) {
                    previousHitTestTime = time;
                    updateReorderTarget(pointerX, reorderPointerRef.current.clientY);
                    const previewOrder = reorderPreviewOrderRef.current;
                    if (previewOrder)
                        prepareFixedCenterPreview(previewOrder);
                }
            }
            reorderAutoPanFrameRef.current = window.requestAnimationFrame(step);
        };
        reorderAutoPanFrameRef.current = window.requestAnimationFrame(step);
    }, [prepareFixedCenterPreview, setOffset, updateReorderTarget, viewportRef, offsetRef]);
    const snapToIndex = React.useCallback((index, { commit = true, scrubPreview = false, deferPreview = false, } = {}) => {
        var _a, _b, _c, _d;
        const boundedIndex = clamp(index, 0, Math.max(0, items.length - 1));
        const targetItem = items[boundedIndex];
        if (!scrubPreview && !deferPreview) {
            updateFastNavigation(0);
            setDirectPreviewMediaId((_a = targetItem === null || targetItem === void 0 ? void 0 : targetItem.id) !== null && _a !== void 0 ? _a : null);
            playbackTimeRef.current = (_b = itemStartTimes[boundedIndex]) !== null && _b !== void 0 ? _b : 0;
        }
        const targetOffset = clamp((sizing === 'duration' || isGallery)
            ? timelineOriginOffset - ((_c = itemStartPixels[boundedIndex]) !== null && _c !== void 0 ? _c : 0)
            : -((_d = itemCenterPositions[boundedIndex]) !== null && _d !== void 0 ? _d : 0), minOffset, maxOffset);
        if (snapFrameRef.current !== null) {
            window.cancelAnimationFrame(snapFrameRef.current);
            snapFrameRef.current = null;
        }
        setIsSpinning(true);
        setIsSnapping(true);
        let didFinish = false;
        const finish = () => {
            var _a;
            if (didFinish)
                return;
            didFinish = true;
            if (snapFrameRef.current !== null) {
                window.cancelAnimationFrame(snapFrameRef.current);
                snapFrameRef.current = null;
            }
            snapCompletionRef.current = null;
            setIsSpinning(false);
            setIsSnapping(false);
            if (commit) {
                if (deferPreview) {
                    setDirectPreviewMediaId((_a = targetItem === null || targetItem === void 0 ? void 0 : targetItem.id) !== null && _a !== void 0 ? _a : null);
                    if ((targetItem === null || targetItem === void 0 ? void 0 : targetItem.id) === preparedPreviewMediaIdRef.current) {
                        setVisiblePreparedPreviewMediaId(targetItem.id);
                        if (preparedPreviewHandoffTimeoutRef.current !== null) {
                            window.clearTimeout(preparedPreviewHandoffTimeoutRef.current);
                        }
                        preparedPreviewHandoffTimeoutRef.current = window.setTimeout(() => {
                            preparedPreviewHandoffTimeoutRef.current = null;
                            preparedPreviewMediaIdRef.current = null;
                            setVisiblePreparedPreviewMediaId(null);
                            setPreparedPreviewMediaId(null);
                        }, PREPARED_PREVIEW_HANDOFF_MS);
                    }
                }
                if (targetItem && targetItem.id !== selectedMediaId) {
                    setTrimOverlayMediaId(null);
                    onCenteredMediaChange(targetItem.id);
                }
            }
        };
        if (targetItem)
            snapCompletionRef.current = { mediaId: targetItem.id, finish };
        snapFrameRef.current = window.requestAnimationFrame(() => {
            setOffset(targetOffset);
            const transitionStart = performance.now();
            const finishAfterTransition = (time) => {
                if (time - transitionStart < SNAP_DURATION_MS + 80) {
                    snapFrameRef.current = window.requestAnimationFrame(finishAfterTransition);
                    return;
                }
                finish();
            };
            snapFrameRef.current = window.requestAnimationFrame(finishAfterTransition);
        });
    }, [itemCenterPositions, itemStartPixels, items, maxOffset, minOffset, onCenteredMediaChange, selectedMediaId, setOffset, sizing, timelineOriginOffset, updateFastNavigation, playbackTimeRef, preparedPreviewMediaIdRef, setPreparedPreviewMediaId, setPreparedPreviewReady, setVisiblePreparedPreviewMediaId, setDirectPreviewMediaId, setTrimOverlayMediaId]);
    const snapToNearest = React.useCallback(() => {
        snapToIndex(getNearestIndexForOffset(offsetRef.current, snapReferencePositions), { scrubPreview: true });
    }, [snapReferencePositions, snapToIndex, offsetRef]);
    const snapToGridLeftAlign = React.useCallback(() => {
        var _a, _b;
        if (snapFrameRef.current !== null) {
            window.cancelAnimationFrame(snapFrameRef.current);
            snapFrameRef.current = null;
        }
        setIsSpinning(true);
        setIsSnapping(true);
        let didFinish = false;
        const finish = () => {
            if (didFinish)
                return;
            didFinish = true;
            setIsSpinning(false);
            setIsSnapping(false);
        };
        snapCompletionRef.current = {
            mediaId: (_b = (_a = items[0]) === null || _a === void 0 ? void 0 : _a.id) !== null && _b !== void 0 ? _b : 'grid-left',
            finish,
        };
        setOffset(gridLeftAlignOffset);
    }, [gridLeftAlignOffset, setOffset, items]);
    const alignItemToOffset = React.useCallback((targetIndex, targetOffset, progress) => {
        var _a, _b;
        const boundedOffset = clamp(targetOffset, minOffset, maxOffset);
        const targetItem = items[targetIndex];
        if (!targetItem)
            return;
        if (snapFrameRef.current !== null) {
            window.cancelAnimationFrame(snapFrameRef.current);
            snapFrameRef.current = null;
        }
        setIsSpinning(true);
        setIsSnapping(true);
        let didFinish = false;
        const finish = () => {
            if (didFinish)
                return;
            didFinish = true;
            if (snapFrameRef.current !== null) {
                window.cancelAnimationFrame(snapFrameRef.current);
                snapFrameRef.current = null;
            }
            snapCompletionRef.current = null;
            setIsSpinning(false);
            setIsSnapping(false);
            skipNextSelectedAlignmentRef.current = true;
            if (targetItem.id !== selectedMediaId) {
                setTrimOverlayMediaId(null);
                onCenteredMediaChange(targetItem.id);
            }
        };
        if (targetItem)
            snapCompletionRef.current = { mediaId: targetItem.id, finish };
        setDirectPreviewMediaId(targetItem.id);
        const itemDuration = (_a = itemDurations[targetIndex]) !== null && _a !== void 0 ? _a : 0.5;
        playbackTimeRef.current = ((_b = itemStartTimes[targetIndex]) !== null && _b !== void 0 ? _b : 0) + progress * itemDuration;
        snapFrameRef.current = window.requestAnimationFrame(() => {
            setOffset(boundedOffset);
            const transitionStart = performance.now();
            const finishAfterTransition = (time) => {
                if (time - transitionStart < SNAP_DURATION_MS + 80) {
                    snapFrameRef.current = window.requestAnimationFrame(finishAfterTransition);
                    return;
                }
                finish();
            };
            snapFrameRef.current = window.requestAnimationFrame(finishAfterTransition);
        });
    }, [items, minOffset, maxOffset, selectedMediaId, setOffset, onCenteredMediaChange, itemDurations, itemStartTimes, playbackTimeRef, setDirectPreviewMediaId, setTrimOverlayMediaId]);
    const spinWithMomentum = React.useCallback((initialVelocity, snapWhenStopped = true) => {
        if (Math.abs(initialVelocity) < MOMENTUM_MIN_VELOCITY) {
            if (snapWhenStopped) {
                snapToNearest();
            }
            else {
                setIsSpinning(false);
                updateFastNavigation(0);
            }
            return;
        }
        let velocity = initialVelocity;
        let previousTime = performance.now();
        setIsSpinning(true);
        const step = (time) => {
            const deltaMs = Math.min(34, time - previousTime);
            previousTime = time;
            const nextOffset = offsetRef.current + velocity * deltaMs;
            const boundedOffset = clamp(nextOffset, minOffset, maxOffset);
            setOffset(boundedOffset);
            updateFastNavigation(velocity);
            const hitBounds = boundedOffset !== nextOffset;
            velocity *= Math.pow(MOMENTUM_FRICTION_PER_FRAME, deltaMs / 16.67);
            if (hitBounds || Math.abs(velocity) < MOMENTUM_MIN_VELOCITY) {
                momentumFrameRef.current = null;
                updateFastNavigation(0);
                if (snapWhenStopped) {
                    snapToNearest();
                }
                else {
                    setIsSpinning(false);
                }
                return;
            }
            momentumFrameRef.current = window.requestAnimationFrame(step);
        };
        momentumFrameRef.current = window.requestAnimationFrame(step);
    }, [maxOffset, minOffset, setOffset, snapToNearest, updateFastNavigation, offsetRef]);
    const beginDrag = React.useCallback((event) => {
        var _a, _b;
        if (event.button !== 0)
            return;
        const viewport = viewportRef.current;
        if (!viewport)
            return;
        stopAnimation();
        if (preparedPreviewHandoffTimeoutRef.current !== null) {
            window.clearTimeout(preparedPreviewHandoffTimeoutRef.current);
            preparedPreviewHandoffTimeoutRef.current = null;
        }
        preparedPreviewMediaIdRef.current = null;
        setPreparedPreviewMediaId(null);
        setPreparedPreviewReady(false);
        setVisiblePreparedPreviewMediaId(null);
        const targetMediaId = (_b = (_a = event.target
            .closest('[data-preview-wheel-item-id]')) === null || _a === void 0 ? void 0 : _a.dataset.previewWheelItemId) !== null && _b !== void 0 ? _b : null;
        dragRef.current = {
            isDragging: true,
            startX: event.clientX,
            startY: event.clientY,
            startOffset: offsetRef.current,
            lastX: event.clientX,
            lastTime: performance.now(),
            pointerId: event.pointerId,
            didMove: false,
            velocity: 0,
            targetMediaId,
            mode: 'pending',
            lastReorderTarget: null,
            reorderTargetMediaId: null,
            reorderPosition: null,
            utilityAction: null,
        };
        clickGuardRef.current = false;
        viewport.setPointerCapture(event.pointerId);
    }, [stopAnimation, viewportRef, offsetRef, preparedPreviewHandoffTimeoutRef, preparedPreviewMediaIdRef, setPreparedPreviewMediaId, setPreparedPreviewReady, setVisiblePreparedPreviewMediaId]);
    const moveDrag = React.useCallback((event) => {
        var _a, _b, _c;
        const drag = dragRef.current;
        if (!drag.isDragging || drag.pointerId !== event.pointerId)
            return;
        const deltaX = event.clientX - drag.startX;
        const deltaY = event.clientY - drag.startY;
        if (drag.mode === 'pending' &&
            drag.targetMediaId &&
            onItemsReorder &&
            deltaY <= -REORDER_LIFT_THRESHOLD &&
            Math.abs(deltaY) > Math.abs(deltaX) * 1.1) {
            const itemElement = (_a = viewportRef.current) === null || _a === void 0 ? void 0 : _a.querySelector(`[data-preview-wheel-item-id="${CSS.escape(drag.targetMediaId)}"]`);
            const bounds = itemElement === null || itemElement === void 0 ? void 0 : itemElement.getBoundingClientRect();
            const sourceWidth = (_b = bounds === null || bounds === void 0 ? void 0 : bounds.width) !== null && _b !== void 0 ? _b : 240;
            const sourceHeight = (_c = bounds === null || bounds === void 0 ? void 0 : bounds.height) !== null && _c !== void 0 ? _c : 135;
            const previewWidth = Math.min(sourceWidth * 0.72, clamp(sourceWidth * 0.55, 88, 180));
            const previewHeight = previewWidth * sourceHeight / Math.max(1, sourceWidth);
            drag.mode = 'reorder';
            drag.didMove = true;
            setIsDragging(true);
            clickGuardRef.current = true;
            updateFastNavigation(0);
            setReorderPreview({
                mediaId: drag.targetMediaId,
                clientX: event.clientX,
                clientY: event.clientY,
                width: previewWidth,
                height: previewHeight,
                liftScale: sourceWidth / previewWidth,
                trayX: bounds ? bounds.left + bounds.width / 2 : event.clientX,
                trayY: bounds ? bounds.top - 16 : event.clientY - sourceHeight / 2 - 16,
            });
            const initialOrder = items.map(item => item.id);
            setCollectionDropTargetId(null);
            reorderPreviewOrderRef.current = initialOrder;
            setReorderPreviewOrder(initialOrder);
            prepareFixedCenterPreview(initialOrder);
            reorderPointerRef.current = { clientX: event.clientX, clientY: event.clientY };
            startReorderAutoPan();
        }
        else if (drag.mode === 'pending' && Math.abs(deltaX) > DRAG_SELECT_THRESHOLD) {
            drag.mode = 'wheel';
            setIsDragging(true);
            setDirectPreviewMediaId(null);
        }
        if (drag.mode === 'reorder' && drag.targetMediaId && onItemsReorder) {
            reorderPointerRef.current = { clientX: event.clientX, clientY: event.clientY };
            if (reorderGhostRef.current) {
                reorderGhostRef.current.style.transform = `translate3d(${event.clientX}px, ${event.clientY}px, 0) translate(-50%, -50%) scale(1.03)`;
            }
            const utilityElement = Array.from(document.querySelectorAll('[data-wheel-utility-target]'))
                .find(element => {
                const bounds = element.getBoundingClientRect();
                return event.clientX >= bounds.left && event.clientX <= bounds.right &&
                    event.clientY >= bounds.top && event.clientY <= bounds.bottom;
            });
            const utilityAction = utilityElement === null || utilityElement === void 0 ? void 0 : utilityElement.dataset.wheelUtilityTarget;
            drag.utilityAction = utilityAction !== null && utilityAction !== void 0 ? utilityAction : null;
            setUtilityDropTarget(utilityAction !== null && utilityAction !== void 0 ? utilityAction : null);
            if (utilityAction) {
                setCollectionDropTargetId(null);
                event.preventDefault();
                return;
            }
            updateReorderTarget(event.clientX, event.clientY);
            event.preventDefault();
            return;
        }
        if (drag.mode !== 'wheel')
            return;
        const now = performance.now();
        const frameDeltaMs = Math.max(1, now - drag.lastTime);
        const instantVelocity = (event.clientX - drag.lastX) / frameDeltaMs;
        drag.velocity = drag.velocity * 0.72 + instantVelocity * 0.28;
        updateFastNavigation(drag.velocity);
        if (fastNavigationIdleTimeoutRef.current !== null) {
            window.clearTimeout(fastNavigationIdleTimeoutRef.current);
        }
        if (fastNavigationRef.current) {
            fastNavigationIdleTimeoutRef.current = window.setTimeout(() => {
                fastNavigationIdleTimeoutRef.current = null;
                updateFastNavigation(0);
            }, FAST_NAVIGATION_IDLE_RESET_MS);
        }
        drag.lastX = event.clientX;
        drag.lastTime = now;
        if (Math.abs(deltaX) > DRAG_SELECT_THRESHOLD) {
            drag.didMove = true;
            clickGuardRef.current = true;
        }
        pendingDragOffsetRef.current = drag.startOffset + deltaX;
        if (dragFrameRef.current === null) {
            dragFrameRef.current = window.requestAnimationFrame(() => {
                var _a, _b, _c, _d, _e, _f;
                dragFrameRef.current = null;
                const pendingOffset = pendingDragOffsetRef.current;
                pendingDragOffsetRef.current = null;
                if (pendingOffset !== null) {
                    setOffset(pendingOffset);
                    if (onScrubUpdateRef.current && items.length > 0) {
                        const currentOffset = clamp(pendingOffset, minOffset, maxOffset);
                        const playheadPixel = clamp(hidePreview
                            ? renderedPlayheadX - playheadX - currentOffset + timelineOriginOffset
                            : (sizing === 'duration' || isGallery) ? timelineOriginOffset - currentOffset : -currentOffset, 0, stripEndPixel);
                        let scrubbedIdx = finalIndex;
                        for (let idx = 0; idx < items.length; idx += 1) {
                            const itemEndPx = ((_a = itemStartPixels[idx]) !== null && _a !== void 0 ? _a : 0) + ((_b = itemWidths[idx]) !== null && _b !== void 0 ? _b : 0);
                            if (playheadPixel <= itemEndPx) {
                                scrubbedIdx = idx;
                                break;
                            }
                        }
                        const media = items[scrubbedIdx];
                        if (media && !disabledItemIds.includes(media.id)) {
                            const itemStartPx = (_c = itemStartPixels[scrubbedIdx]) !== null && _c !== void 0 ? _c : 0;
                            const itemW = Math.max(1, (_d = itemWidths[scrubbedIdx]) !== null && _d !== void 0 ? _d : 1);
                            const progress = clamp((playheadPixel - itemStartPx) / itemW, 0, 1);
                            const itemDur = (_e = itemDurations[scrubbedIdx]) !== null && _e !== void 0 ? _e : 0.5;
                            const resolved = resolveItemSnapshot(media, progress * itemDur);
                            onScrubUpdateRef.current(resolved.media.id, resolved.sourceTimeSeconds, ((_f = itemStartTimes[scrubbedIdx]) !== null && _f !== void 0 ? _f : 0) + progress * itemDur);
                        }
                    }
                }
            });
        }
        event.preventDefault();
    }, [items, onItemsReorder, prepareFixedCenterPreview, setOffset, startReorderAutoPan, updateFastNavigation, updateReorderTarget, minOffset, maxOffset, sizing, isGallery, hidePreview, playheadX, renderedPlayheadX, timelineOriginOffset, stripEndPixel, finalIndex, itemStartPixels, itemStartTimes, itemWidths, itemDurations, disabledItemIds, resolveItemSnapshot, viewportRef, reorderGhostRef, onScrubUpdateRef, setDirectPreviewMediaId]);
    const endDrag = React.useCallback((event) => {
        var _a, _b, _c, _d, _e;
        const drag = dragRef.current;
        const viewport = viewportRef.current;
        if (!drag.isDragging || drag.pointerId !== event.pointerId)
            return;
        if (reorderAutoPanFrameRef.current !== null) {
            window.cancelAnimationFrame(reorderAutoPanFrameRef.current);
            reorderAutoPanFrameRef.current = null;
        }
        if (fastNavigationIdleTimeoutRef.current !== null) {
            window.clearTimeout(fastNavigationIdleTimeoutRef.current);
            fastNavigationIdleTimeoutRef.current = null;
        }
        if (dragFrameRef.current !== null) {
            window.cancelAnimationFrame(dragFrameRef.current);
            dragFrameRef.current = null;
        }
        const pendingOffset = pendingDragOffsetRef.current;
        pendingDragOffsetRef.current = null;
        if (pendingOffset !== null)
            setOffset(pendingOffset);
        dragRef.current = {
            isDragging: false,
            startX: 0,
            startY: 0,
            startOffset: 0,
            lastX: 0,
            lastTime: 0,
            pointerId: -1,
            didMove: false,
            velocity: 0,
            targetMediaId: null,
            mode: 'pending',
            lastReorderTarget: null,
            reorderTargetMediaId: null,
            reorderPosition: null,
            utilityAction: null,
        };
        setIsDragging(false);
        setCollectionDropTargetId(null);
        setUtilityDropTarget(null);
        if (drag.mode !== 'reorder') {
            setReorderPreview(null);
            setReorderPreviewOrder(null);
        }
        if (viewport === null || viewport === void 0 ? void 0 : viewport.hasPointerCapture(event.pointerId)) {
            viewport.releasePointerCapture(event.pointerId);
        }
        if (drag.mode === 'reorder') {
            if (drag.utilityAction && drag.targetMediaId) {
                onUtilityDrop === null || onUtilityDrop === void 0 ? void 0 : onUtilityDrop(drag.utilityAction, drag.targetMediaId);
                reorderPreviewOrderRef.current = null;
                setReorderPreview(null);
                setReorderPreviewOrder(null);
                clickGuardRef.current = true;
                clearClickGuardSoon();
                return;
            }
            if (drag.targetMediaId && drag.reorderTargetMediaId && drag.reorderPosition) {
                if (selectReorderedItem) {
                    preparedPreviewMediaIdRef.current = drag.targetMediaId;
                    setPreparedPreviewMediaId(drag.targetMediaId);
                    setPreparedPreviewReady(false);
                    setVisiblePreparedPreviewMediaId(null);
                }
                const destinationMediaId = drag.reorderPosition === 'inside'
                    ? drag.reorderTargetMediaId
                    : drag.targetMediaId;
                const draggedElement = viewport === null || viewport === void 0 ? void 0 : viewport.querySelector(`[data-preview-wheel-item-id="${CSS.escape(destinationMediaId)}"]`);
                const destinationBounds = draggedElement === null || draggedElement === void 0 ? void 0 : draggedElement.getBoundingClientRect();
                if (reorderGhostRef.current && destinationBounds) {
                    reorderGhostRef.current.style.transition = `transform ${DROP_SETTLE_DURATION_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`;
                    reorderGhostRef.current.style.transform = `translate3d(${destinationBounds.left + destinationBounds.width / 2}px, ${destinationBounds.top + destinationBounds.height / 2}px, 0) translate(-50%, -50%) scale(1)`;
                    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches && reorderPreview) {
                        (_a = reorderGhostContentRef.current) === null || _a === void 0 ? void 0 : _a.animate([
                            { transform: 'scale(1)' },
                            { transform: `scale(${destinationBounds.width / reorderPreview.width})` },
                        ], {
                            duration: DROP_SETTLE_DURATION_MS,
                            easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
                            fill: 'both',
                        });
                    }
                }
                if (!selectReorderedItem) {
                    const centeredMediaId = reorderPreviewOrderRef.current
                        ? getCenteredMediaIdForOrder(reorderPreviewOrderRef.current)
                        : null;
                    if (centeredMediaId && centeredMediaId === preparedPreviewMediaIdRef.current) {
                        setVisiblePreparedPreviewMediaId(centeredMediaId);
                        if (preparedPreviewHandoffTimeoutRef.current !== null) {
                            window.clearTimeout(preparedPreviewHandoffTimeoutRef.current);
                        }
                        preparedPreviewHandoffTimeoutRef.current = window.setTimeout(() => {
                            preparedPreviewHandoffTimeoutRef.current = null;
                            preparedPreviewMediaIdRef.current = null;
                            setVisiblePreparedPreviewMediaId(null);
                            setPreparedPreviewMediaId(null);
                        }, PREPARED_PREVIEW_HANDOFF_MS);
                    }
                    if (centeredMediaId && centeredMediaId !== selectedMediaId) {
                        skipNextSelectedAlignmentRef.current = true;
                        setDirectPreviewMediaId(centeredMediaId);
                        setTrimOverlayMediaId(null);
                        onCenteredMediaChange(centeredMediaId);
                    }
                    skipNextReorderAlignmentRef.current = true;
                    if (drag.reorderPosition === 'inside') {
                        onItemMoveIntoCollection === null || onItemMoveIntoCollection === void 0 ? void 0 : onItemMoveIntoCollection(drag.targetMediaId, drag.reorderTargetMediaId);
                    }
                    else {
                        onItemsReorder === null || onItemsReorder === void 0 ? void 0 : onItemsReorder(drag.targetMediaId, drag.reorderTargetMediaId, drag.reorderPosition);
                    }
                }
                dropSettleTimeoutRef.current = window.setTimeout(() => {
                    dropSettleTimeoutRef.current = null;
                    if (selectReorderedItem) {
                        pendingReorderSelectionRef.current = drag.targetMediaId;
                        if (drag.reorderPosition === 'inside') {
                            onItemMoveIntoCollection === null || onItemMoveIntoCollection === void 0 ? void 0 : onItemMoveIntoCollection(drag.targetMediaId, drag.reorderTargetMediaId);
                        }
                        else {
                            onItemsReorder === null || onItemsReorder === void 0 ? void 0 : onItemsReorder(drag.targetMediaId, drag.reorderTargetMediaId, drag.reorderPosition);
                        }
                    }
                    reorderPreviewOrderRef.current = null;
                    setReorderPreview(null);
                    setReorderPreviewOrder(null);
                }, destinationBounds ? DROP_SETTLE_DURATION_MS : 0);
            }
            else {
                reorderPreviewOrderRef.current = null;
                setReorderPreview(null);
                setReorderPreviewOrder(null);
            }
            clickGuardRef.current = true;
            clearClickGuardSoon();
            return;
        }
        if (drag.didMove) {
            clickGuardRef.current = true;
            clearClickGuardSoon();
            if (hidePreview) {
                if (freeDrag) {
                    spinWithMomentum(drag.velocity, false);
                }
                else {
                    snapToGridLeftAlign();
                }
                return;
            }
            if (sizing === 'duration' || isGallery) {
                return;
            }
            spinWithMomentum(drag.velocity);
            return;
        }
        if (drag.targetMediaId) {
            const targetIndex = items.findIndex(item => item.id === drag.targetMediaId);
            if (targetIndex >= 0) {
                const targetItem = items[targetIndex];
                if (targetItem && collectionItemIds.includes(targetItem.id) && onCollectionOpen) {
                    onCollectionOpen(targetItem.id);
                }
                else if (hidePreview) {
                    if (selectItemsWhilePreviewHidden && targetItem) {
                        if (syncPreviewToPlayhead) {
                            const itemCenterPixel = ((_b = itemStartPixels[targetIndex]) !== null && _b !== void 0 ? _b : 0) + ((_c = itemWidths[targetIndex]) !== null && _c !== void 0 ? _c : 0) / 2;
                            const itemScreenX = playheadX + offsetRef.current - timelineOriginOffset + itemCenterPixel;
                            setGridPlayheadRatio(clamp(itemScreenX, 8, Math.max(8, viewportSize.width - 8)) / Math.max(1, viewportSize.width));
                        }
                        updateFastNavigation(0);
                        setDirectPreviewMediaId(targetItem.id);
                        playbackTimeRef.current = (_d = itemStartTimes[targetIndex]) !== null && _d !== void 0 ? _d : 0;
                        if (targetItem.id !== selectedMediaId) {
                            skipNextSelectedAlignmentRef.current = true;
                            setTrimOverlayMediaId(null);
                        }
                        onCenteredMediaChange(targetItem.id);
                    }
                    return;
                }
                else {
                    if (slideOnClick) {
                        snapToIndex(targetIndex);
                    }
                    else {
                        if (targetItem) {
                            updateFastNavigation(0);
                            setDirectPreviewMediaId(targetItem.id);
                            playbackTimeRef.current = (_e = itemStartTimes[targetIndex]) !== null && _e !== void 0 ? _e : 0;
                            if (targetItem.id !== selectedMediaId) {
                                skipNextSelectedAlignmentRef.current = true;
                                setTrimOverlayMediaId(null);
                                onCenteredMediaChange(targetItem.id);
                            }
                        }
                    }
                }
            }
        }
    }, [clearClickGuardSoon, collectionItemIds, freeDrag, getCenteredMediaIdForOrder, hidePreview, itemStartPixels, itemStartTimes, itemWidths, items, onCenteredMediaChange, onCollectionOpen, onItemMoveIntoCollection, onItemsReorder, onUtilityDrop, playheadX, reorderPreview, selectItemsWhilePreviewHidden, selectReorderedItem, selectedMediaId, setOffset, sizing, slideOnClick, snapToIndex, spinWithMomentum, snapToGridLeftAlign, syncPreviewToPlayhead, timelineOriginOffset, updateFastNavigation, viewportSize.width, viewportRef, reorderGhostRef, reorderGhostContentRef, reorderPreviewOrderRef, preparedPreviewHandoffTimeoutRef, preparedPreviewMediaIdRef, setPreparedPreviewMediaId, setPreparedPreviewReady, setVisiblePreparedPreviewMediaId, setDirectPreviewMediaId, setTrimOverlayMediaId, playbackTimeRef, skipNextSelectedAlignmentRef, skipNextReorderAlignmentRef, pendingReorderSelectionRef, offsetRef, setGridPlayheadRatio]);
    return {
        isDragging,
        reorderPreview,
        reorderPreviewOrder,
        collectionDropTargetId,
        utilityDropTarget,
        isSpinning,
        isSnapping,
        dragRef,
        clickGuardRef,
        clickGuardTimeoutRef,
        momentumFrameRef,
        snapFrameRef,
        dragFrameRef,
        pendingDragOffsetRef,
        dropSettleTimeoutRef,
        pendingReorderSelectionRef,
        skipNextReorderAlignmentRef,
        skipNextSelectedAlignmentRef,
        snapCompletionRef,
        reorderAutoPanFrameRef,
        reorderPointerRef,
        reorderPreviewOrderRef,
        beginDrag,
        moveDrag,
        endDrag,
        snapToIndex,
        snapToNearest,
        snapToGridLeftAlign,
        alignItemToOffset,
        spinWithMomentum,
        stopAnimation,
        clearClickGuardSoon,
        getCenteredMediaIdForOrder,
        prepareFixedCenterPreview,
        updateFastNavigation,
    };
}
