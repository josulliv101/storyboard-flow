import { jsx as _jsx } from "react/jsx-runtime";
import React from 'react';
const clamp = (value, min, max) => (Math.max(min, Math.min(max, value)));
export function UniformItemProgress({ progress, durationSeconds, isPlaying, timelineTimeSeconds, }) {
    const barRef = React.useRef(null);
    const wasPlayingRef = React.useRef(false);
    const pausedInputProgressRef = React.useRef(null);
    const previousTimelineTimeRef = React.useRef(null);
    React.useLayoutEffect(() => {
        const bar = barRef.current;
        if (!bar)
            return;
        const boundedProgress = clamp(progress, 0, 1);
        const wasPlaying = wasPlayingRef.current;
        const previousTimelineTime = previousTimelineTimeRef.current;
        const didTimelineReset = previousTimelineTime !== null &&
            timelineTimeSeconds < previousTimelineTime - 0.001;
        wasPlayingRef.current = isPlaying;
        previousTimelineTimeRef.current = timelineTimeSeconds;
        if (!didTimelineReset && !isPlaying && wasPlaying) {
            const computedTransform = window.getComputedStyle(bar).transform;
            pausedInputProgressRef.current = boundedProgress;
            bar.style.transition = 'none';
            if (computedTransform !== 'none')
                bar.style.transform = computedTransform;
            return;
        }
        if (!isPlaying &&
            pausedInputProgressRef.current !== null &&
            Math.abs(pausedInputProgressRef.current - boundedProgress) < 0.0001) {
            return;
        }
        pausedInputProgressRef.current = isPlaying ? null : boundedProgress;
        let startingProgress = boundedProgress;
        if (isPlaying && !wasPlaying) {
            const computedTransform = window.getComputedStyle(bar).transform;
            const matrixMatch = computedTransform.match(/^matrix\(([^,]+),/);
            const computedScale = matrixMatch ? Number(matrixMatch[1]) : Number.NaN;
            if (Number.isFinite(computedScale))
                startingProgress = clamp(computedScale, 0, 1);
        }
        bar.style.transition = 'none';
        bar.style.transform = `scaleX(${startingProgress})`;
        if (!isPlaying || startingProgress >= 1)
            return;
        const frame = window.requestAnimationFrame(() => {
            const remainingSeconds = Math.max(0, durationSeconds * (1 - startingProgress));
            bar.style.transition = `transform ${remainingSeconds}s linear`;
            bar.style.transform = 'scaleX(1)';
        });
        return () => window.cancelAnimationFrame(frame);
    }, [durationSeconds, isPlaying, progress, timelineTimeSeconds]);
    return (_jsx("div", { "aria-hidden": "true", className: "pointer-events-none absolute inset-x-0 bottom-0 z-30 h-0.5 overflow-hidden bg-black/35", children: _jsx("div", { ref: barRef, className: "h-full origin-left bg-blue-500 shadow-[0_0_5px_rgba(59,130,246,0.85)] will-change-transform" }) }));
}
