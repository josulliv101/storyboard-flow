"use client";

import React, { useState, useEffect, useRef } from "react";
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

interface ChartDataPoint {
  name: string;
  tension: number;
  suspense: number;
  anticipation: number;
  sceneIndex: number;
  timestamp: number;
}

interface TensionChartProps {
  data: ChartDataPoint[];
  activeIndex: number;
  onSelectScene: (index: number) => void;
  colors?: Partial<Record<"tension" | "suspense" | "anticipation", string>>;
  activeTab?: string;
  onUpdateValue?: (sceneIndex: number, metric: 'tension' | 'suspense' | 'anticipation', newValue: number) => void;
}

const DEFAULT_COLORS = {
  tension: "#f43f5e",
  suspense: "#a855f7",
  anticipation: "#06b6d4",
};

interface ChartDragHandlerProps {
  draggingState: { index: number; metric: 'tension' | 'suspense' | 'anticipation' } | null;
  onUpdateValue: (index: number, metric: 'tension' | 'suspense' | 'anticipation', val: number) => void;
  onStopDrag: () => void;
  data: ChartDataPoint[];
}

const ChartDragHandler = ({ draggingState, onUpdateValue, onStopDrag, data }: ChartDragHandlerProps) => {
  const yInverse = useYAxisInverseScale();
  const ref = useRef<SVGGElement>(null);

  useEffect(() => {
    if (!draggingState) return;

    const initialPoint = data[draggingState.index];
    let lastValue = initialPoint ? initialPoint[draggingState.metric] : null;

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

    const handleMouseUp = () => {
      onStopDrag();
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [draggingState, yInverse, onUpdateValue, onStopDrag, data]);

  return <g ref={ref} />;
};

const renderCustomLegend = (props: any) => {
  const { payload } = props;
  if (!payload) return null;
  return (
    <div className="flex justify-center items-center gap-6 mb-4 select-none">
      {payload.map((entry: any, index: number) => {
        const name = entry.value; // "Tension", "Suspense", "Anticipation"
        return (
          <div key={`legend-item-${index}`} className="flex items-center gap-2">
            <MetricSymbol 
              name={name} 
              className="w-3.5 h-3.5 shrink-0 animate-fade-in" 
              style={{ color: entry.color }} 
            />
            <span className="text-[10px] text-zinc-400 font-mono uppercase font-bold tracking-wider">
              {name}
            </span>
          </div>
        );
      })}
    </div>
  );
};

export default function TensionChart({ data, activeIndex, onSelectScene, colors, activeTab, onUpdateValue }: TensionChartProps) {
  if (!data || data.length === 0) return null;

  const [draggingState, setDraggingState] = useState<{ index: number; metric: 'tension' | 'suspense' | 'anticipation' } | null>(null);

  const chartColors = {
    ...DEFAULT_COLORS,
    ...colors,
  };

  const activeLabel = activeTab?.startsWith("graph-") ? activeTab.replace("graph-", "") : null;
  const showTension = !activeLabel || activeLabel === "tension";
  const showSuspense = !activeLabel || activeLabel === "suspense";
  const showAnticipation = !activeLabel || activeLabel === "anticipation" || activeLabel === "stakes";

  return (
    <div className="w-full h-80 bg-zinc-950 border border-zinc-800 rounded-xl p-4 shadow-xl backdrop-blur-md">
      <div className="flex justify-between items-center mb-3">
        <h3 className="text-[11px] font-bold text-zinc-350 tracking-widest uppercase font-mono">
          Narrative & Emotional Arc
        </h3>
        <span className="text-[10px] text-zinc-500 font-mono">
          Click any beat to inspect details
        </span>
      </div>
      
      <div className="w-full h-64">
        <ResponsiveContainer width="100%" height="100%">
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
            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" opacity={0.3} />
            <XAxis 
              type="number"
              dataKey="timestamp" 
              stroke="#52525b" 
              fontSize={10}
              tickLine={false}
              axisLine={false}
              tickFormatter={(tick) => {
                const minutes = Math.floor(tick / 60);
                const seconds = Math.floor(tick % 60);
                return `${minutes}:${seconds.toString().padStart(2, "0")}`;
              }}
              domain={[0, 'auto']}
            />
            <YAxis 
              domain={[0, 5]} 
              tickCount={6} 
              stroke="#52525b" 
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
                backgroundColor: "#09090b",
                borderColor: "#27272a",
                borderRadius: "8px",
                color: "#f4f4f5",
                fontSize: "11px",
                fontFamily: "monospace"
              }}
              cursor={{ stroke: "#3f3f46", strokeWidth: 1, strokeDasharray: "4 4" }}
            />
            <Legend content={renderCustomLegend} />
            
            {/* Tension Line */}
            {showTension && (
              <Line
                type="monotone"
                dataKey="tension"
                name="Tension"
                stroke={chartColors.tension}
                strokeWidth={3}
                onClick={(data: any, index: any) => {
                  const targetIndex = typeof index === "number" ? index : (data && typeof data.index === "number" ? data.index : undefined);
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
                      fill={isActive ? chartColors.tension : "#18181b"}
                      stroke={chartColors.tension}
                      strokeWidth={isActive ? 3 : 2}
                      className={onUpdateValue ? "cursor-ns-resize" : "cursor-pointer"}
                      onMouseDown={(e) => {
                        if (!onUpdateValue) return;
                        e.stopPropagation();
                        e.preventDefault();
                        setDraggingState({ index: props.index, metric: 'tension' });
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectScene(props.index);
                      }}
                    />
                  );
                }}
                activeDot={false}
              />
            )}
            
            {/* Suspense Line */}
            {showSuspense && (
              <Line
                type="monotone"
                dataKey="suspense"
                name="Suspense"
                stroke={chartColors.suspense}
                strokeWidth={3}
                onClick={(data: any, index: any) => {
                  const targetIndex = typeof index === "number" ? index : (data && typeof data.index === "number" ? data.index : undefined);
                  if (targetIndex !== undefined) {
                    onSelectScene(targetIndex);
                  }
                }}
                dot={(props: any) => {
                  const isActive = props.index === activeIndex;
                  const h = isActive ? 6.5 : 4.5;
                  const { cx, cy } = props;
                  const points = `${cx},${cy - h} ${cx + h},${cy} ${cx},${cy + h} ${cx - h},${cy}`;
                  return (
                    <polygon
                      points={points}
                      fill={isActive ? chartColors.suspense : "#18181b"}
                      stroke={chartColors.suspense}
                      strokeWidth={isActive ? 3 : 2}
                      className={onUpdateValue ? "cursor-ns-resize" : "cursor-pointer"}
                      onMouseDown={(e) => {
                        if (!onUpdateValue) return;
                        e.stopPropagation();
                        e.preventDefault();
                        setDraggingState({ index: props.index, metric: 'suspense' });
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectScene(props.index);
                      }}
                    />
                  );
                }}
                activeDot={false}
              />
            )}
            
            {/* Anticipation Line */}
            {showAnticipation && (
              <Line
                type="monotone"
                dataKey="anticipation"
                name="Anticipation"
                stroke={chartColors.anticipation}
                strokeWidth={3}
                onClick={(data: any, index: any) => {
                  const targetIndex = typeof index === "number" ? index : (data && typeof data.index === "number" ? data.index : undefined);
                  if (targetIndex !== undefined) {
                    onSelectScene(targetIndex);
                  }
                }}
                dot={(props: any) => {
                  const isActive = props.index === activeIndex;
                  const h = isActive ? 6.5 : 4.5;
                  const { cx, cy } = props;
                  const points = `${cx},${cy - h} ${cx + h},${cy + h} ${cx - h},${cy + h}`;
                  return (
                    <polygon
                      points={points}
                      fill={isActive ? chartColors.anticipation : "#18181b"}
                      stroke={chartColors.anticipation}
                      strokeWidth={isActive ? 3 : 2}
                      className={onUpdateValue ? "cursor-ns-resize" : "cursor-pointer"}
                      onMouseDown={(e) => {
                        if (!onUpdateValue) return;
                        e.stopPropagation();
                        e.preventDefault();
                        setDraggingState({ index: props.index, metric: 'anticipation' });
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectScene(props.index);
                      }}
                    />
                  );
                }}
                activeDot={false}
              />
            )}
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
