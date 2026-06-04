import React from "react";
import { Award } from "lucide-react";
import { ScreenplayReport } from "./types";

interface ExecutiveSummaryProps {
  report: ScreenplayReport;
}

export default function ExecutiveSummary({ report }: ExecutiveSummaryProps) {
  return (
    <div className="relative bg-zinc-950/60 border border-zinc-800 rounded-2xl p-5 shadow-xl backdrop-blur-md overflow-hidden animate-fade-in">
      <div className="absolute top-0 right-0 px-3.5 py-1 bg-indigo-950/40 border-l border-b border-indigo-900/40 rounded-bl-xl text-[9px] font-mono text-indigo-400 font-bold uppercase tracking-widest">
        {report.pacing_dynamics}
      </div>
      <div className="flex items-center space-x-2 text-zinc-500 font-mono text-[9px] mb-2 uppercase tracking-widest">
        <Award size={12} className="text-indigo-400" />
        <span>Synthesizer Executive Summary</span>
      </div>
      <div className="flex flex-col gap-2 mb-3">
        <h2 className="text-sm font-black text-zinc-100 uppercase tracking-wide leading-tight">{report.title}</h2>

        {/* Dynamic Model / Fallback Intelligence Indicator Badge */}
        <div className="flex-shrink-0">
          {report.is_llm ? (
            report.model_used.toLowerCase().includes("ollama") ? (
              <div className="inline-flex items-center space-x-1.5 px-2 py-0.5 bg-sky-950/30 border border-sky-900/30 rounded text-[9px] font-semibold text-sky-400 font-mono">
                <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-pulse"></span>
                <span>LOCAL: {report.model_used}</span>
              </div>
            ) : (
              <div className="inline-flex items-center space-x-1.5 px-2 py-0.5 bg-emerald-950/30 border border-emerald-900/30 rounded text-[9px] font-semibold text-emerald-400 font-mono">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                <span>CLOUD ACTIVE: {report.model_used}</span>
              </div>
            )
          ) : (
            <div className="inline-flex items-center space-x-1.5 px-2 py-0.5 bg-zinc-900 border border-zinc-800 rounded text-[9px] font-semibold text-zinc-400 font-mono">
              <span className="w-1.5 h-1.5 rounded-full bg-zinc-650"></span>
              <span>HEURISTIC ACTIVE: Heuristic Engine</span>
            </div>
          )}
        </div>
      </div>
      <p className="text-xs text-zinc-400 leading-relaxed font-sans">{report.overall_summary}</p>

      {/* High level average scores */}
      <div className="grid grid-cols-3 gap-3 mt-4 pt-3.5 border-t border-zinc-900">
        <div className="bg-zinc-950/80 border border-zinc-900 p-2.5 rounded-xl flex items-center justify-between">
          <div>
            <p className="text-[9px] font-mono text-zinc-500 uppercase tracking-wider">Avg Tension</p>
            <p className="text-base font-black text-rose-500 mt-0.5">
              {report.average_tension}
              <span className="text-[10px] text-zinc-600 font-normal">/5</span>
            </p>
          </div>
          <div className="w-1 h-7 bg-rose-950/20 rounded-full overflow-hidden">
            <div
              className="bg-rose-500 rounded-full h-full"
              style={{ height: `${(report.average_tension / 5) * 100}%` }}
            ></div>
          </div>
        </div>
        <div className="bg-zinc-950/80 border border-zinc-900 p-2.5 rounded-xl flex items-center justify-between">
          <div>
            <p className="text-[9px] font-mono text-zinc-500 uppercase tracking-wider">Avg Suspense</p>
            <p className="text-base font-black text-purple-400 mt-0.5">
              {report.average_suspense}
              <span className="text-[10px] text-zinc-600 font-normal">/5</span>
            </p>
          </div>
          <div className="w-1 h-7 bg-purple-950/20 rounded-full overflow-hidden">
            <div
              className="bg-purple-400 rounded-full h-full"
              style={{ height: `${(report.average_suspense / 5) * 100}%` }}
            ></div>
          </div>
        </div>
        <div className="bg-zinc-950/80 border border-zinc-900 p-2.5 rounded-xl flex items-center justify-between">
          <div>
            <p className="text-[9px] font-mono text-zinc-500 uppercase tracking-wider">Avg Anticipation</p>
            <p className="text-base font-black text-cyan-400 mt-0.5">
              {report.average_anticipation}
              <span className="text-[10px] text-zinc-600 font-normal">/5</span>
            </p>
          </div>
          <div className="w-1 h-7 bg-cyan-950/20 rounded-full overflow-hidden">
            <div
              className="bg-cyan-450 rounded-full h-full"
              style={{ height: `${(report.average_anticipation / 5) * 100}%` }}
            ></div>
          </div>
        </div>
      </div>
    </div>
  );
}
