"use client";
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
import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import * as React from "react";
import * as RechartsPrimitive from "recharts";
import { cn } from "@/lib/utils";
// Format: { THEME_NAME: CSS_SELECTOR }
const THEMES = { light: "", dark: ".dark" };
const INITIAL_DIMENSION = { width: 320, height: 200 };
const ChartContext = React.createContext(null);
function useChart() {
    const context = React.useContext(ChartContext);
    if (!context) {
        throw new Error("useChart must be used within a <ChartContainer />");
    }
    return context;
}
function ChartContainer(_a) {
    var { id, className, children, config, initialDimension = INITIAL_DIMENSION } = _a, props = __rest(_a, ["id", "className", "children", "config", "initialDimension"]);
    const uniqueId = React.useId();
    const chartId = `chart-${id !== null && id !== void 0 ? id : uniqueId.replace(/:/g, "")}`;
    return (_jsx(ChartContext.Provider, { value: { config }, children: _jsxs("div", Object.assign({ "data-slot": "chart", "data-chart": chartId, className: cn("flex aspect-video justify-center text-xs [&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground [&_.recharts-cartesian-grid_line[stroke='#ccc']]:stroke-border/50 [&_.recharts-curve.recharts-tooltip-cursor]:stroke-border [&_.recharts-dot[stroke='#fff']]:stroke-transparent [&_.recharts-layer]:outline-hidden [&_.recharts-polar-grid_[stroke='#ccc']]:stroke-border [&_.recharts-radial-bar-background-sector]:fill-muted [&_.recharts-rectangle.recharts-tooltip-cursor]:fill-muted [&_.recharts-reference-line_[stroke='#ccc']]:stroke-border [&_.recharts-sector]:outline-hidden [&_.recharts-sector[stroke='#fff']]:stroke-transparent [&_.recharts-surface]:outline-hidden", className) }, props, { children: [_jsx(ChartStyle, { id: chartId, config: config }), _jsx(RechartsPrimitive.ResponsiveContainer, { initialDimension: initialDimension, children: children })] })) }));
}
const ChartStyle = ({ id, config }) => {
    const colorConfig = Object.entries(config).filter(([, config]) => { var _a; return (_a = config.theme) !== null && _a !== void 0 ? _a : config.color; });
    if (!colorConfig.length) {
        return null;
    }
    return (_jsx("style", { dangerouslySetInnerHTML: {
            __html: Object.entries(THEMES)
                .map(([theme, prefix]) => `
${prefix} [data-chart=${id}] {
${colorConfig
                .map(([key, itemConfig]) => {
                var _a, _b;
                const color = (_b = (_a = itemConfig.theme) === null || _a === void 0 ? void 0 : _a[theme]) !== null && _b !== void 0 ? _b : itemConfig.color;
                return color ? `  --color-${key}: ${color};` : null;
            })
                .join("\n")}
}
`)
                .join("\n"),
        } }));
};
const ChartTooltip = RechartsPrimitive.Tooltip;
function ChartTooltipContent({ active, payload, className, indicator = "dot", hideLabel = false, hideIndicator = false, label, labelFormatter, labelClassName, formatter, color, nameKey, labelKey, }) {
    const { config } = useChart();
    const tooltipLabel = React.useMemo(() => {
        var _a, _b, _c, _d;
        if (hideLabel || !(payload === null || payload === void 0 ? void 0 : payload.length)) {
            return null;
        }
        const [item] = payload;
        const key = `${(_b = (_a = labelKey !== null && labelKey !== void 0 ? labelKey : item === null || item === void 0 ? void 0 : item.dataKey) !== null && _a !== void 0 ? _a : item === null || item === void 0 ? void 0 : item.name) !== null && _b !== void 0 ? _b : "value"}`;
        const itemConfig = getPayloadConfigFromPayload(config, item, key);
        const value = !labelKey && typeof label === "string"
            ? ((_d = (_c = config[label]) === null || _c === void 0 ? void 0 : _c.label) !== null && _d !== void 0 ? _d : label)
            : itemConfig === null || itemConfig === void 0 ? void 0 : itemConfig.label;
        if (labelFormatter) {
            return (_jsx("div", { className: cn("font-medium", labelClassName), children: labelFormatter(value, payload) }));
        }
        if (!value) {
            return null;
        }
        return _jsx("div", { className: cn("font-medium", labelClassName), children: value });
    }, [
        label,
        labelFormatter,
        payload,
        hideLabel,
        labelClassName,
        config,
        labelKey,
    ]);
    if (!active || !(payload === null || payload === void 0 ? void 0 : payload.length)) {
        return null;
    }
    const nestLabel = payload.length === 1 && indicator !== "dot";
    return (_jsxs("div", { className: cn("grid min-w-32 items-start gap-1.5 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl", className), children: [!nestLabel ? tooltipLabel : null, _jsx("div", { className: "grid gap-1.5", children: payload
                    .filter((item) => item.type !== "none")
                    .map((item, index) => {
                    var _a, _b, _c, _d, _e;
                    const key = `${(_b = (_a = nameKey !== null && nameKey !== void 0 ? nameKey : item.name) !== null && _a !== void 0 ? _a : item.dataKey) !== null && _b !== void 0 ? _b : "value"}`;
                    const itemConfig = getPayloadConfigFromPayload(config, item, key);
                    const indicatorColor = (_d = color !== null && color !== void 0 ? color : (_c = item.payload) === null || _c === void 0 ? void 0 : _c.fill) !== null && _d !== void 0 ? _d : item.color;
                    return (_jsx("div", { className: cn("flex w-full flex-wrap items-stretch gap-2 [&>svg]:h-2.5 [&>svg]:w-2.5 [&>svg]:text-muted-foreground", indicator === "dot" && "items-center"), children: formatter && (item === null || item === void 0 ? void 0 : item.value) !== undefined && item.name ? (formatter(item.value, item.name, item, index, item.payload)) : (_jsxs(_Fragment, { children: [(itemConfig === null || itemConfig === void 0 ? void 0 : itemConfig.icon) ? (_jsx(itemConfig.icon, {})) : (!hideIndicator && (_jsx("div", { className: cn("shrink-0 rounded-[2px] border-(--color-border) bg-(--color-bg)", {
                                        "h-2.5 w-2.5": indicator === "dot",
                                        "w-1": indicator === "line",
                                        "w-0 border-[1.5px] border-dashed bg-transparent": indicator === "dashed",
                                        "my-0.5": nestLabel && indicator === "dashed",
                                    }), style: {
                                        "--color-bg": indicatorColor,
                                        "--color-border": indicatorColor,
                                    } }))), _jsxs("div", { className: cn("flex flex-1 justify-between leading-none", nestLabel ? "items-end" : "items-center"), children: [_jsxs("div", { className: "grid gap-1.5", children: [nestLabel ? tooltipLabel : null, _jsx("span", { className: "text-muted-foreground", children: (_e = itemConfig === null || itemConfig === void 0 ? void 0 : itemConfig.label) !== null && _e !== void 0 ? _e : item.name })] }), item.value != null && (_jsx("span", { className: "font-mono font-medium text-foreground tabular-nums", children: typeof item.value === "number"
                                                ? item.value.toLocaleString()
                                                : String(item.value) }))] })] })) }, index));
                }) })] }));
}
const ChartLegend = RechartsPrimitive.Legend;
function ChartLegendContent({ className, hideIcon = false, payload, verticalAlign = "bottom", nameKey, }) {
    const { config } = useChart();
    if (!(payload === null || payload === void 0 ? void 0 : payload.length)) {
        return null;
    }
    return (_jsx("div", { className: cn("flex items-center justify-center gap-4", verticalAlign === "top" ? "pb-3" : "pt-3", className), children: payload
            .filter((item) => item.type !== "none")
            .map((item, index) => {
            var _a;
            const key = `${(_a = nameKey !== null && nameKey !== void 0 ? nameKey : item.dataKey) !== null && _a !== void 0 ? _a : "value"}`;
            const itemConfig = getPayloadConfigFromPayload(config, item, key);
            return (_jsxs("div", { className: cn("flex items-center gap-1.5 [&>svg]:h-3 [&>svg]:w-3 [&>svg]:text-muted-foreground"), children: [(itemConfig === null || itemConfig === void 0 ? void 0 : itemConfig.icon) && !hideIcon ? (_jsx(itemConfig.icon, {})) : (_jsx("div", { className: "h-2 w-2 shrink-0 rounded-[2px]", style: {
                            backgroundColor: item.color,
                        } })), itemConfig === null || itemConfig === void 0 ? void 0 : itemConfig.label] }, index));
        }) }));
}
function getPayloadConfigFromPayload(config, payload, key) {
    if (typeof payload !== "object" || payload === null) {
        return undefined;
    }
    const payloadPayload = "payload" in payload &&
        typeof payload.payload === "object" &&
        payload.payload !== null
        ? payload.payload
        : undefined;
    let configLabelKey = key;
    if (key in payload &&
        typeof payload[key] === "string") {
        configLabelKey = payload[key];
    }
    else if (payloadPayload &&
        key in payloadPayload &&
        typeof payloadPayload[key] === "string") {
        configLabelKey = payloadPayload[key];
    }
    return configLabelKey in config ? config[configLabelKey] : config[key];
}
export { ChartContainer, ChartTooltip, ChartTooltipContent, ChartLegend, ChartLegendContent, ChartStyle, };
