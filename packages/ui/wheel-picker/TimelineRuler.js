import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
export const formatRulerSeconds = (seconds) => (`${Number(seconds.toFixed(1))}s`);
export function TimelineRuler({ itemWidth, itemStartTime, itemDuration, itemEndTime, rulerTickStep, rulerTop, opacity, effect, x, z, rotateY, scale, distance, isLastItem, }) {
    const firstRulerTick = Math.ceil((itemStartTime - 0.001) / rulerTickStep) * rulerTickStep;
    const rulerTicks = [];
    for (let tickSeconds = firstRulerTick; tickSeconds < itemEndTime - 0.001 || (isLastItem && tickSeconds <= itemEndTime + 0.001); tickSeconds += rulerTickStep) {
        rulerTicks.push(tickSeconds);
    }
    return (_jsx("div", { "aria-hidden": "true", className: "pointer-events-none absolute left-1/2 h-7 border-b border-zinc-600/80 text-[9px] font-mono text-zinc-400", style: {
            top: rulerTop,
            width: itemWidth,
            opacity: effect === 'gallery' ? 1 : opacity,
            transform: `translate3d(${(x - itemWidth / 2).toFixed(2)}px, 0px, ${z}px) rotateY(${rotateY}deg) scale(${scale})`,
            transformOrigin: 'center bottom',
            zIndex: effect === 'gallery' ? 150 : Math.round(100 - distance * 10),
        }, children: rulerTicks.map(tickSeconds => (_jsxs("div", { className: "absolute inset-y-0", style: { left: `${((tickSeconds - itemStartTime) / itemDuration) * 100}%` }, children: [_jsx("span", { className: "absolute left-0 top-0 -translate-x-1/2 whitespace-nowrap", children: formatRulerSeconds(tickSeconds) }), _jsx("span", { className: "absolute bottom-0 left-0 h-2 w-px bg-zinc-400/80" })] }, tickSeconds))) }));
}
