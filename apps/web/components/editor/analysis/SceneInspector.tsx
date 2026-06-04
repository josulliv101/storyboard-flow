import React from "react";
import { Flame, CheckCircle } from "lucide-react";
import { SceneAnalysis } from "./types";

interface SceneInspectorProps {
  activeScene?: SceneAnalysis;
}

export default function SceneInspector({ activeScene }: SceneInspectorProps) {
  return (
    <div className="relative bg-zinc-950/60 border border-zinc-800 rounded-2xl p-5 shadow-2xl backdrop-blur flex flex-col h-80 overflow-y-auto scrollbar-thin scrollbar-thumb-zinc-800 animate-fade-in">
      {activeScene ? (
        <div className="space-y-4">
          <div className="flex justify-between items-start border-b border-zinc-900 pb-3">
            <div>
              <span className="text-[9px] font-mono text-indigo-400 uppercase font-semibold select-none">
                Scene Inspector
              </span>
              <h3
                className="text-xs font-bold text-zinc-100 mt-0.5 truncate max-w-[200px]"
                title={activeScene.title}
              >
                {activeScene.title}
              </h3>
            </div>
            <div className="text-right">
              <span className="text-[9px] font-mono text-zinc-550 select-none">Characters</span>
              <p
                className="text-[10px] text-zinc-400 font-semibold font-mono truncate max-w-[140px]"
                title={activeScene.characters.join(", ")}
              >
                {activeScene.characters.length > 0 ? activeScene.characters.join(", ") : "None"}
              </p>
            </div>
          </div>

          {/* Metric Scores with linear bars */}
          <div className="space-y-2.5">
            {/* Tension Bar */}
            <div>
              <div className="flex justify-between text-[10px] mb-1 font-mono select-none">
                <span className="text-rose-450 font-medium">Tension</span>
                <span className="text-zinc-400 font-bold">{activeScene.metrics.tension}/5</span>
              </div>
              <div className="w-full h-1 bg-zinc-900 rounded-full overflow-hidden">
                <div
                  className="bg-rose-500 h-full rounded-full transition-all duration-300"
                  style={{ width: `${(activeScene.metrics.tension / 5) * 100}%` }}
                />
              </div>
              <p
                className="text-[9.5px] text-zinc-450 leading-normal mt-1 italic pl-1 select-text"
                title={activeScene.metrics.tension_reasoning}
              >
                {activeScene.metrics.tension_reasoning}
              </p>
            </div>

            {/* Suspense Bar */}
            <div>
              <div className="flex justify-between text-[10px] mb-1 font-mono select-none">
                <span className="text-purple-450 font-medium">Suspense</span>
                <span className="text-zinc-400 font-bold">{activeScene.metrics.suspense}/5</span>
              </div>
              <div className="w-full h-1 bg-zinc-900 rounded-full overflow-hidden">
                <div
                  className="bg-purple-500 h-full rounded-full transition-all duration-300"
                  style={{ width: `${(activeScene.metrics.suspense / 5) * 100}%` }}
                />
              </div>
              <p
                className="text-[9.5px] text-zinc-450 leading-normal mt-1 italic pl-1 select-text"
                title={activeScene.metrics.suspense_reasoning}
              >
                {activeScene.metrics.suspense_reasoning}
              </p>
            </div>

            {/* Anticipation Bar */}
            <div>
              <div className="flex justify-between text-[10px] mb-1 font-mono select-none">
                <span className="text-cyan-450 font-medium">Anticipation</span>
                <span className="text-zinc-400 font-bold">{activeScene.metrics.anticipation}/5</span>
              </div>
              <div className="w-full h-1 bg-zinc-900 rounded-full overflow-hidden">
                <div
                  className="bg-cyan-500 h-full rounded-full transition-all duration-300"
                  style={{ width: `${(activeScene.metrics.anticipation / 5) * 100}%` }}
                />
              </div>
              <p
                className="text-[9.5px] text-zinc-450 leading-normal mt-1 italic pl-1 select-text"
                title={activeScene.metrics.anticipation_reasoning}
              >
                {activeScene.metrics.anticipation_reasoning}
              </p>
            </div>
          </div>

          {/* Narrative stakes alert card */}
          <div className="bg-[#111114] border border-zinc-900 rounded-xl p-3 mt-2">
            <div className="flex items-center space-x-1.5 text-[9px] font-mono mb-1.5 select-none">
              {activeScene.narrative_elements.stakes_raised ? (
                <>
                  <Flame size={12} className="text-rose-450 animate-pulse" />
                  <span className="text-rose-450 font-bold uppercase tracking-widest">
                    Stakes Raised!
                  </span>
                </>
              ) : (
                <>
                  <CheckCircle size={12} className="text-zinc-650" />
                  <span className="text-zinc-550 uppercase tracking-widest">Stakes Static</span>
                </>
              )}
            </div>
            <p
              className="text-[10px] text-zinc-400 leading-relaxed font-sans select-text"
              title={
                activeScene.narrative_elements.stakes_reasoning ||
                "No critical stake escalation detected in this scene segment."
              }
            >
              {activeScene.narrative_elements.stakes_reasoning ||
                "No critical stake escalation detected in this scene segment."}
            </p>
          </div>

          {/* Extra Elements Pills */}
          {activeScene.narrative_elements.additional_elements.length > 0 && (
            <div className="pt-1">
              <span className="text-[9px] font-mono text-zinc-550 block mb-1.5 select-none uppercase tracking-wider">
                Story Elements
              </span>
              <div className="flex flex-wrap gap-1.5">
                {activeScene.narrative_elements.additional_elements.map((el, index) => (
                  <span
                    key={index}
                    className="text-[9px] font-mono font-medium px-2 py-0.5 bg-indigo-950/20 text-indigo-400 border border-indigo-900/30 rounded"
                  >
                    {el}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="h-full flex items-center justify-center text-zinc-600 text-xs text-center font-mono select-none">
          Select a beat to inspect detailed agent analysis metrics.
        </div>
      )}
    </div>
  );
}
