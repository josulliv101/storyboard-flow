"use client";

import React from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";

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
}

export default function TensionChart({ data, activeIndex, onSelectScene }: TensionChartProps) {
  if (!data || data.length === 0) return null;

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
            <Legend 
              verticalAlign="top" 
              height={36} 
              iconType="circle"
              iconSize={8}
              wrapperStyle={{ fontSize: "10px", color: "#71717a", fontFamily: "monospace", textTransform: "uppercase" }}
            />
            
            {/* Tension Line */}
            <Line
              type="monotone"
              dataKey="tension"
              name="Tension"
              stroke="#f43f5e"
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
                    fill={isActive ? "#f43f5e" : "#18181b"}
                    stroke="#f43f5e"
                    strokeWidth={ isActive ? 3 : 2}
                    className="cursor-pointer transition-all duration-200"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectScene(props.index);
                    }}
                  />
                );
              }}
              activeDot={{ r: 8, fill: "#f43f5e", stroke: "#fff", strokeWidth: 2 }}
            />
            
            {/* Suspense Line */}
            <Line
              type="monotone"
              dataKey="suspense"
              name="Suspense"
              stroke="#a855f7"
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
                    fill={isActive ? "#a855f7" : "#18181b"}
                    stroke="#a855f7"
                    strokeWidth={isActive ? 3 : 2}
                    className="cursor-pointer transition-all duration-200"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectScene(props.index);
                    }}
                  />
                );
              }}
              activeDot={{ r: 8, fill: "#a855f7", stroke: "#fff", strokeWidth: 2 }}
            />
            
            {/* Anticipation Line */}
            <Line
              type="monotone"
              dataKey="anticipation"
              name="Anticipation"
              stroke="#06b6d4"
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
                    fill={isActive ? "#06b6d4" : "#18181b"}
                    stroke="#06b6d4"
                    strokeWidth={isActive ? 3 : 2}
                    className="cursor-pointer transition-all duration-200"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectScene(props.index);
                    }}
                  />
                );
              }}
              activeDot={{ r: 8, fill: "#06b6d4", stroke: "#fff", strokeWidth: 2 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
