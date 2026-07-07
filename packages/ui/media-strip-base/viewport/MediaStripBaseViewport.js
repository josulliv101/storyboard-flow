var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
import { jsx as _jsx } from "react/jsx-runtime";
import { ScrollArea } from "@base-ui/react/scroll-area";
import * as React from "react";
/**
 * The draggable scrollable viewport for media strip content.
 * Renders an unstyled Base UI `ScrollArea.Viewport` element.
 */
export const MediaStripBaseViewport = React.forwardRef(function MediaStripBaseViewport(_a, forwardedRef) {
    var { inertialDrag = false, momentumFriction = 0.94, minMomentumVelocity = 0.01, onClickCapture, onPointerCancel, onPointerDown, onPointerMove, onPointerUp } = _a, props = __rest(_a, ["inertialDrag", "momentumFriction", "minMomentumVelocity", "onClickCapture", "onPointerCancel", "onPointerDown", "onPointerMove", "onPointerUp"]);
    const viewportRef = React.useRef(null);
    const animationFrameRef = React.useRef(null);
    const dragStateRef = React.useRef({
        active: false,
        moved: false,
        lastX: 0,
        lastTime: 0,
        velocity: 0,
    });
    const [isDragging, setIsDragging] = React.useState(false);
    React.useEffect(() => {
        return () => {
            if (animationFrameRef.current !== null) {
                window.cancelAnimationFrame(animationFrameRef.current);
            }
        };
    }, []);
    const setViewportRef = React.useCallback((node) => {
        viewportRef.current = node;
        if (typeof forwardedRef === "function") {
            forwardedRef(node);
            return;
        }
        if (forwardedRef) {
            forwardedRef.current = node;
        }
    }, [forwardedRef]);
    function stopMomentum() {
        if (animationFrameRef.current !== null) {
            window.cancelAnimationFrame(animationFrameRef.current);
            animationFrameRef.current = null;
        }
    }
    function startMomentum(initialVelocity) {
        let velocity = initialVelocity;
        const animate = () => {
            const viewportElement = viewportRef.current;
            if (!viewportElement || Math.abs(velocity) < minMomentumVelocity) {
                animationFrameRef.current = null;
                return;
            }
            viewportElement.scrollLeft -= velocity * 16;
            velocity *= momentumFriction;
            animationFrameRef.current = window.requestAnimationFrame(animate);
        };
        animationFrameRef.current = window.requestAnimationFrame(animate);
    }
    function handlePointerDown(event) {
        onPointerDown === null || onPointerDown === void 0 ? void 0 : onPointerDown(event);
        if (!inertialDrag || event.defaultPrevented || event.button !== 0) {
            return;
        }
        stopMomentum();
        event.currentTarget.setPointerCapture(event.pointerId);
        dragStateRef.current = {
            active: true,
            moved: false,
            lastX: event.clientX,
            lastTime: performance.now(),
            velocity: 0,
        };
        setIsDragging(true);
    }
    function handlePointerMove(event) {
        onPointerMove === null || onPointerMove === void 0 ? void 0 : onPointerMove(event);
        const viewportElement = viewportRef.current;
        const dragState = dragStateRef.current;
        if (!inertialDrag || !viewportElement || !dragState.active) {
            return;
        }
        const now = performance.now();
        const deltaX = event.clientX - dragState.lastX;
        const deltaTime = Math.max(now - dragState.lastTime, 1);
        if (Math.abs(deltaX) > 2) {
            dragState.moved = true;
        }
        viewportElement.scrollLeft -= deltaX;
        dragState.velocity = deltaX / deltaTime;
        dragState.lastX = event.clientX;
        dragState.lastTime = now;
    }
    function endDrag(event) {
        const nextVelocity = dragStateRef.current.velocity;
        const wasActive = dragStateRef.current.active;
        dragStateRef.current.active = false;
        setIsDragging(false);
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }
        if (wasActive && inertialDrag) {
            startMomentum(nextVelocity);
        }
    }
    function handlePointerUp(event) {
        onPointerUp === null || onPointerUp === void 0 ? void 0 : onPointerUp(event);
        endDrag(event);
    }
    function handlePointerCancel(event) {
        onPointerCancel === null || onPointerCancel === void 0 ? void 0 : onPointerCancel(event);
        endDrag(event);
    }
    function handleClickCapture(event) {
        onClickCapture === null || onClickCapture === void 0 ? void 0 : onClickCapture(event);
        if (!dragStateRef.current.moved) {
            return;
        }
        dragStateRef.current.moved = false;
        event.preventDefault();
        event.stopPropagation();
    }
    return (_jsx(ScrollArea.Viewport, Object.assign({ ref: setViewportRef }, props, { "data-dragging": isDragging ? "" : undefined, "data-inertial-drag": inertialDrag ? "" : undefined, onClickCapture: handleClickCapture, onPointerCancel: handlePointerCancel, onPointerDown: handlePointerDown, onPointerMove: handlePointerMove, onPointerUp: handlePointerUp })));
});
