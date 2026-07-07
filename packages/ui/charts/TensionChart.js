"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useRef, useState } from "react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, useYAxisInverseScale, } from "recharts";
import { MetricSymbol } from "./MetricSymbol";
const DEFAULT_METRICS = [
    { id: "tension", label: "Tension", color: "#f43f5e" },
    { id: "suspense", label: "Suspense", color: "#a855f7" },
    { id: "anticipation", label: "Anticipation", color: "#06b6d4" },
];
const FALLBACK_COLORS = ["#f43f5e", "#a855f7", "#06b6d4", "#f59e0b", "#14b8a6", "#f97316", "#e879f9", "#84cc16"];
const CHART_SURFACE_COLOR = "var(--card)";
const CHART_BORDER_COLOR = "var(--border)";
const CHART_TEXT_COLOR = "var(--foreground)";
const CHART_MUTED_COLOR = "var(--muted-foreground)";
const getMetricValue = (point, metric) => {
    var _a;
    if (!point)
        return null;
    const value = point[metric];
    if (typeof value === "number")
        return value;
    const nestedValue = (_a = point.metrics) === null || _a === void 0 ? void 0 : _a[metric];
    return typeof nestedValue === "number" ? nestedValue : null;
};
const ChartDragHandler = ({ draggingState, onUpdateValue, onStopDrag, data }) => {
    const yInverse = useYAxisInverseScale();
    const ref = useRef(null);
    useEffect(() => {
        if (!draggingState)
            return;
        let lastValue = getMetricValue(data[draggingState.index], draggingState.metric);
        const handleMouseMove = (e) => {
            const element = ref.current;
            if (!element || !yInverse)
                return;
            const wrapper = element.closest(".recharts-wrapper");
            if (!wrapper)
                return;
            const rect = wrapper.getBoundingClientRect();
            const chartY = e.clientY - rect.top;
            const rawValue = yInverse(chartY);
            const snappedValue = Math.min(5, Math.max(0, Math.round(rawValue * 2) / 2));
            if (snappedValue !== lastValue) {
                lastValue = snappedValue;
                onUpdateValue(draggingState.index, draggingState.metric, snappedValue);
            }
        };
        document.addEventListener("mousemove", handleMouseMove);
        document.addEventListener("mouseup", onStopDrag);
        return () => {
            document.removeEventListener("mousemove", handleMouseMove);
            document.removeEventListener("mouseup", onStopDrag);
        };
    }, [draggingState, yInverse, onUpdateValue, onStopDrag, data]);
    return _jsx("g", { ref: ref });
};
const renderCustomLegend = (props) => {
    const { payload } = props;
    if (!payload)
        return null;
    return (_jsx("div", { className: "mb-4 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 select-none", children: payload.map((entry, index) => {
            const name = entry.value;
            return (_jsxs("div", { className: "flex items-center gap-2", children: [_jsx(MetricSymbol, { name: name, className: "h-3.5 w-3.5 shrink-0 animate-fade-in", style: { color: entry.color } }), _jsx("span", { className: "font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-400", children: name })] }, `legend-item-${index}`));
        }) }));
};
const getActiveMetricId = (activeTab) => {
    if (!(activeTab === null || activeTab === void 0 ? void 0 : activeTab.startsWith("graph-")))
        return null;
    const rawId = activeTab.replace("graph-", "");
    if (rawId === "stakes")
        return "anticipation";
    if (rawId.startsWith("metric-"))
        return rawId.replace("metric-", "");
    return rawId;
};
export function TensionChart({ data, activeIndex, onSelectScene, colors, metrics, activeTab, onUpdateValue, }) {
    const [draggingState, setDraggingState] = useState(null);
    const chartMetrics = useMemo(() => {
        const sourceMetrics = metrics && metrics.length > 0 ? metrics : DEFAULT_METRICS;
        return sourceMetrics
            .map((metric, index) => (Object.assign(Object.assign({}, metric), { color: (colors === null || colors === void 0 ? void 0 : colors[metric.id]) || metric.color || FALLBACK_COLORS[index % FALLBACK_COLORS.length] })))
            .filter(metric => data.some(point => typeof getMetricValue(point, metric.id) === "number"));
    }, [colors, data, metrics]);
    if (!data || data.length === 0 || chartMetrics.length === 0)
        return null;
    const activeMetricId = getActiveMetricId(activeTab);
    const visibleMetrics = activeMetricId
        ? chartMetrics.filter(metric => metric.id === activeMetricId)
        : chartMetrics;
    const renderMetrics = visibleMetrics.length > 0 ? visibleMetrics : chartMetrics;
    return (_jsxs("div", { className: "h-80 w-full rounded-xl border border-zinc-800 bg-zinc-950 p-4 shadow-xl backdrop-blur-md", children: [_jsxs("div", { className: "mb-3 flex items-center justify-between", children: [_jsx("h3", { className: "font-mono text-[11px] font-bold uppercase tracking-widest text-zinc-350", children: "Narrative & Emotional Arc" }), _jsx("span", { className: "font-mono text-[10px] text-zinc-500", children: "Click any beat to inspect details" })] }), _jsx("div", { className: "h-64 min-h-64 w-full", style: { height: 256, minHeight: 256 }, children: _jsx(ResponsiveContainer, { width: "100%", height: "100%", initialDimension: { width: 990, height: 256 }, children: _jsxs(LineChart, { data: data, onClick: (state) => {
                            var _a;
                            if (state) {
                                if (typeof state.activeTooltipIndex === "number") {
                                    onSelectScene(state.activeTooltipIndex);
                                }
                                else if (state.activePayload && state.activePayload.length > 0) {
                                    const sceneIndex = (_a = state.activePayload[0].payload) === null || _a === void 0 ? void 0 : _a.sceneIndex;
                                    if (typeof sceneIndex === "number") {
                                        onSelectScene(sceneIndex);
                                    }
                                }
                            }
                        }, margin: { top: 10, right: 10, left: -20, bottom: 5 }, children: [_jsx(CartesianGrid, { strokeDasharray: "3 3", stroke: CHART_BORDER_COLOR, opacity: 0.7 }), _jsx(XAxis, { type: "number", dataKey: "timestamp", stroke: CHART_MUTED_COLOR, fontSize: 10, tickLine: false, axisLine: false, tickFormatter: (tick) => {
                                    const minutes = Math.floor(tick / 60);
                                    const seconds = Math.floor(tick % 60);
                                    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
                                }, domain: [0, "auto"] }), _jsx(YAxis, { domain: [0, 5], tickCount: 6, stroke: CHART_MUTED_COLOR, fontSize: 10, tickLine: false, axisLine: false }), _jsx(Tooltip, { labelFormatter: (value) => {
                                    const item = data.find((d) => d.timestamp === value);
                                    const labelName = item ? item.name : "";
                                    const minutes = Math.floor(Number(value) / 60);
                                    const seconds = Math.floor(Number(value) % 60);
                                    const timeStr = `${minutes}:${seconds.toString().padStart(2, "0")}`;
                                    return labelName ? `${labelName} (${timeStr})` : timeStr;
                                }, contentStyle: {
                                    backgroundColor: CHART_SURFACE_COLOR,
                                    borderColor: CHART_BORDER_COLOR,
                                    borderRadius: "8px",
                                    color: CHART_TEXT_COLOR,
                                    fontSize: "11px",
                                    fontFamily: "monospace",
                                }, cursor: { stroke: CHART_MUTED_COLOR, strokeWidth: 1, strokeDasharray: "4 4" } }), _jsx(Legend, { content: renderCustomLegend }), renderMetrics.map((metric) => (_jsx(Line, { type: "monotone", dataKey: metric.id, name: metric.label, stroke: metric.color, strokeWidth: 3, connectNulls: true, onClick: (lineData, index) => {
                                    const targetIndex = typeof index === "number"
                                        ? index
                                        : lineData && typeof lineData.index === "number"
                                            ? lineData.index
                                            : undefined;
                                    if (targetIndex !== undefined) {
                                        onSelectScene(targetIndex);
                                    }
                                }, dot: (props) => {
                                    const isActive = props.index === activeIndex;
                                    return (_jsx("circle", { cx: props.cx, cy: props.cy, r: isActive ? 6 : 4, fill: isActive ? metric.color : CHART_SURFACE_COLOR, stroke: metric.color, strokeWidth: isActive ? 3 : 2, className: onUpdateValue ? "cursor-ns-resize" : "cursor-pointer", onMouseDown: (event) => {
                                            if (!onUpdateValue)
                                                return;
                                            event.stopPropagation();
                                            event.preventDefault();
                                            setDraggingState({ index: props.index, metric: metric.id });
                                        }, onClick: (event) => {
                                            event.stopPropagation();
                                            onSelectScene(props.index);
                                        } }));
                                }, activeDot: false }, metric.id))), onUpdateValue && (_jsx(ChartDragHandler, { draggingState: draggingState, onUpdateValue: onUpdateValue, onStopDrag: () => setDraggingState(null), data: data }))] }) }) })] }));
}
export default TensionChart;
