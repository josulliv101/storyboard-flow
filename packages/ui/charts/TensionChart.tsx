"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  useYAxisInverseScale,
} from "recharts";
import { MetricSymbol } from "./MetricSymbol";

export type MetricKey = string;

export interface ChartMetricDefinition {
  id: MetricKey;
  label: string;
  color?: string;
}

export interface ChartDataPoint {
  name: string;
  tension?: number;
  suspense?: number;
  anticipation?: number;
  sceneIndex: number;
  timestamp: number;
  metrics?: Record<string, number>;
  [key: string]: string | number | Record<string, number> | undefined;
}

export interface TensionChartProps {
  data: ChartDataPoint[];
  activeIndex: number;
  onSelectScene: (index: number) => void;
  colors?: Partial<Record<string, string>>;
  metrics?: ChartMetricDefinition[];
  activeTab?: string;
  onUpdateValue?: (sceneIndex: number, metric: MetricKey, newValue: number) => void;
}

const DEFAULT_METRICS: ChartMetricDefinition[] = [
  { id: "tension", label: "Tension", color: "#f43f5e" },
  { id: "suspense", label: "Suspense", color: "#a855f7" },
  { id: "anticipation", label: "Anticipation", color: "#06b6d4" },
];

const FALLBACK_COLORS = ["#f43f5e", "#a855f7", "#06b6d4", "#f59e0b", "#14b8a6", "#f97316", "#e879f9", "#84cc16"];
const CHART_SURFACE_COLOR = "var(--card)";
const CHART_BORDER_COLOR = "var(--border)";
const CHART_TEXT_COLOR = "var(--foreground)";
const CHART_MUTED_COLOR = "var(--muted-foreground)";

interface ChartDragHandlerProps {
  draggingState: { index: number; metric: MetricKey } | null;
  onUpdateValue: (index: number, metric: MetricKey, val: number) => void;
  onStopDrag: () => void;
  data: ChartDataPoint[];
}

const getMetricValue = (point: ChartDataPoint | undefined, metric: MetricKey) => {
  if (!point) return null;
  const value = point[metric];
  if (typeof value === "number") return value;
  const nestedValue = point.metrics?.[metric];
  return typeof nestedValue === "number" ? nestedValue : null;
};

const ChartDragHandler = ({ draggingState, onUpdateValue, onStopDrag, data }: ChartDragHandlerProps) => {
  const yInverse = useYAxisInverseScale();
  const ref = useRef<SVGGElement>(null);

  useEffect(() => {
    if (!draggingState) return;

    let lastValue = getMetricValue(data[draggingState.index], draggingState.metric);

    const handleMouseMove = (e: MouseEvent) => {
      const element = ref.current;
      if (!element || !yInverse) return;

      const wrapper = element.closest(".recharts-wrapper");
      if (!wrapper) return;

      const rect = wrapper.getBoundingClientRect();
      const chartY = e.clientY - rect.top;

      const rawValue = yInverse(chartY) as number;
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

  return <g ref={ref} />;
};

const renderCustomLegend = (props: any) => {
  const { payload } = props;
  if (!payload) return null;
  return (
    <div className="mb-4 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 select-none">
      {payload.map((entry: any, index: number) => {
        const name = entry.value;
        return (
          <div key={`legend-item-${index}`} className="flex items-center gap-2">
            <MetricSymbol
              name={name}
              className="h-3.5 w-3.5 shrink-0 animate-fade-in"
              style={{ color: entry.color }}
            />
            <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-400">
              {name}
            </span>
          </div>
        );
      })}
    </div>
  );
};

const getActiveMetricId = (activeTab?: string) => {
  if (!activeTab?.startsWith("graph-")) return null;
  const rawId = activeTab.replace("graph-", "");
  if (rawId === "stakes") return "anticipation";
  if (rawId.startsWith("metric-")) return rawId.replace("metric-", "");
  return rawId;
};

export function TensionChart({
  data,
  activeIndex,
  onSelectScene,
  colors,
  metrics,
  activeTab,
  onUpdateValue,
}: TensionChartProps) {
  const [draggingState, setDraggingState] = useState<{ index: number; metric: MetricKey } | null>(null);

  const chartMetrics = useMemo(() => {
    const sourceMetrics = metrics && metrics.length > 0 ? metrics : DEFAULT_METRICS;
    return sourceMetrics
      .map((metric, index) => ({
        ...metric,
        color: colors?.[metric.id] || metric.color || FALLBACK_COLORS[index % FALLBACK_COLORS.length],
      }))
      .filter(metric => data.some(point => typeof getMetricValue(point, metric.id) === "number"));
  }, [colors, data, metrics]);

  if (!data || data.length === 0 || chartMetrics.length === 0) return null;

  const activeMetricId = getActiveMetricId(activeTab);
  const visibleMetrics = activeMetricId
    ? chartMetrics.filter(metric => metric.id === activeMetricId)
    : chartMetrics;
  const renderMetrics = visibleMetrics.length > 0 ? visibleMetrics : chartMetrics;

  return (
    <div className="h-80 w-full rounded-xl border border-zinc-800 bg-zinc-950 p-4 shadow-xl backdrop-blur-md">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-mono text-[11px] font-bold uppercase tracking-widest text-zinc-350">
          Narrative & Emotional Arc
        </h3>
        <span className="font-mono text-[10px] text-zinc-500">
          Click any beat to inspect details
        </span>
      </div>

      <div className="h-64 min-h-64 w-full" style={{ height: 256, minHeight: 256 }}>
        <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 990, height: 256 }}>
          <LineChart
            data={data}
            onClick={(state: any) => {
              if (state) {
                if (typeof state.activeTooltipIndex === "number") {
                  onSelectScene(state.activeTooltipIndex);
                } else if (state.activePayload && state.activePayload.length > 0) {
                  const sceneIndex = state.activePayload[0].payload?.sceneIndex;
                  if (typeof sceneIndex === "number") {
                    onSelectScene(sceneIndex);
                  }
                }
              }
            }}
            margin={{ top: 10, right: 10, left: -20, bottom: 5 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke={CHART_BORDER_COLOR} opacity={0.7} />
            <XAxis
              type="number"
              dataKey="timestamp"
              stroke={CHART_MUTED_COLOR}
              fontSize={10}
              tickLine={false}
              axisLine={false}
              tickFormatter={(tick) => {
                const minutes = Math.floor(tick / 60);
                const seconds = Math.floor(tick % 60);
                return `${minutes}:${seconds.toString().padStart(2, "0")}`;
              }}
              domain={[0, "auto"]}
            />
            <YAxis
              domain={[0, 5]}
              tickCount={6}
              stroke={CHART_MUTED_COLOR}
              fontSize={10}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              labelFormatter={(value) => {
                const item = data.find((d) => d.timestamp === value);
                const labelName = item ? item.name : "";
                const minutes = Math.floor(Number(value) / 60);
                const seconds = Math.floor(Number(value) % 60);
                const timeStr = `${minutes}:${seconds.toString().padStart(2, "0")}`;
                return labelName ? `${labelName} (${timeStr})` : timeStr;
              }}
              contentStyle={{
                backgroundColor: CHART_SURFACE_COLOR,
                borderColor: CHART_BORDER_COLOR,
                borderRadius: "8px",
                color: CHART_TEXT_COLOR,
                fontSize: "11px",
                fontFamily: "monospace",
              }}
              cursor={{ stroke: CHART_MUTED_COLOR, strokeWidth: 1, strokeDasharray: "4 4" }}
            />
            <Legend content={renderCustomLegend} />

            {renderMetrics.map((metric) => (
              <Line
                key={metric.id}
                type="monotone"
                dataKey={metric.id}
                name={metric.label}
                stroke={metric.color}
                strokeWidth={3}
                connectNulls
                onClick={(lineData: any, index: any) => {
                  const targetIndex = typeof index === "number"
                    ? index
                    : lineData && typeof lineData.index === "number"
                      ? lineData.index
                      : undefined;
                  if (targetIndex !== undefined) {
                    onSelectScene(targetIndex);
                  }
                }}
                dot={(props: any) => {
                  const isActive = props.index === activeIndex;
                  return (
                    <circle
                      cx={props.cx}
                      cy={props.cy}
                      r={isActive ? 6 : 4}
                      fill={isActive ? metric.color : CHART_SURFACE_COLOR}
                      stroke={metric.color}
                      strokeWidth={isActive ? 3 : 2}
                      className={onUpdateValue ? "cursor-ns-resize" : "cursor-pointer"}
                      onMouseDown={(event) => {
                        if (!onUpdateValue) return;
                        event.stopPropagation();
                        event.preventDefault();
                        setDraggingState({ index: props.index, metric: metric.id });
                      }}
                      onClick={(event) => {
                        event.stopPropagation();
                        onSelectScene(props.index);
                      }}
                    />
                  );
                }}
                activeDot={false}
              />
            ))}
            {onUpdateValue && (
              <ChartDragHandler
                draggingState={draggingState}
                onUpdateValue={onUpdateValue}
                onStopDrag={() => setDraggingState(null)}
                data={data}
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export default TensionChart;
