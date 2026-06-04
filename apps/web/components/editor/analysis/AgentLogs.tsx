"use client";

import React, { useEffect, useRef } from "react";
import { Terminal, Cpu } from "lucide-react";
import { LogEntry } from "./types";

interface AgentLogsProps {
  logs: LogEntry[];
  isLoading: boolean;
  elapsedTime?: number;
}

export default function AgentLogs({ logs, isLoading, elapsedTime }: AgentLogsProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
    }
  }, [logs]);

  const getAgentColor = (sender?: string) => {
    if (!sender) return "text-zinc-400 bg-zinc-900 border border-zinc-800";
    switch (sender.toLowerCase()) {
      case "coordinator":
        return "text-indigo-400 bg-indigo-950/40 border border-indigo-900/30";
      case "metric analyzer":
        return "text-rose-450 bg-rose-950/40 border border-rose-900/30";
      case "narrative expert":
        return "text-amber-450 bg-amber-950/40 border border-amber-900/30";
      case "synthesizer":
        return "text-emerald-450 bg-emerald-950/40 border border-emerald-900/30";
      default:
        return "text-zinc-400 bg-zinc-900 border border-zinc-800";
    }
  };

  return (
    <div className="w-full bg-[#0a0a0b] border border-zinc-800 rounded-xl overflow-hidden shadow-2xl">
      {/* Terminal Title Bar */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-zinc-950 border-b border-zinc-800">
        <div className="flex items-center space-x-2">
          <Terminal size={14} className="text-zinc-550 animate-pulse" />
          <span className="text-[10px] font-mono font-bold text-zinc-400 uppercase tracking-widest">
            Agent Collaboration Hub
          </span>
        </div>
        <div className="flex space-x-1.5">
          <div className="w-2 h-2 rounded-full bg-zinc-800"></div>
          <div className="w-2 h-2 rounded-full bg-zinc-800"></div>
          <div className="w-2 h-2 rounded-full bg-zinc-800"></div>
        </div>
      </div>

      {/* Terminal Screen Body */}
      <div ref={scrollContainerRef} className="p-4 h-52 overflow-y-auto font-mono text-[10.5px] leading-relaxed scrollbar-thin scrollbar-thumb-zinc-800">
        {logs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-zinc-600 space-y-2">
            <Cpu size={24} className="opacity-40 animate-pulse" />
            <p className="uppercase tracking-widest text-[9px] font-bold">No active agent pipeline runs in this scene</p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {logs.map((log, idx) => {
              if (!log) return null;
              return (
                <div
                  key={idx}
                  className="flex items-start space-x-3 transition-opacity duration-300 animate-fade-in"
                >
                  <span className="text-[9.5px] text-zinc-600 select-none pt-0.5 min-w-[36px]">
                    {log.timestamp || ""}
                  </span>
                  <span
                    className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider whitespace-nowrap min-w-[110px] text-center ${getAgentColor(
                      log.sender
                    )}`}
                  >
                    {log.sender || "Agent"}
                  </span>
                  <span className="text-zinc-300 flex-1">{log.message || ""}</span>
                </div>
              );
            })}
            
            {isLoading && (
              <div className="flex items-center justify-between text-indigo-400 pr-2 pt-1 font-mono text-[9.5px] border-t border-zinc-900 mt-2">
                <div className="flex items-center space-x-2 animate-pulse pl-12">
                  <div className="flex space-x-1">
                    <div className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }}></div>
                    <div className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }}></div>
                    <div className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }}></div>
                  </div>
                  <span className="text-zinc-550 uppercase tracking-widest">Agent team is thinking...</span>
                </div>
                {elapsedTime !== undefined && (
                  <span className="text-indigo-400 bg-indigo-950/40 border border-indigo-900/30 px-2 py-0.5 rounded text-[9.5px] font-bold tabular-nums">
                    ⏱️ Elapsed: {elapsedTime.toFixed(1)}s
                  </span>
                )}
              </div>
            )}
            
          </div>
        )}
      </div>
    </div>
  );
}
