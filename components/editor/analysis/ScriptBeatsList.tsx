import React, { useState } from "react";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { ScreenplayReport } from "./types";
import { useTimeline } from "@/lib/timeline-context";

const formatTime = (time: number) => {
  const mins = Math.floor(time / 60);
  const secs = Math.floor(time % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
};

interface ScriptBeatsListProps {
  report: ScreenplayReport;
  activeSceneIndex: number;
  setActiveSceneIndex: (index: number) => void;
  beatListRef: React.RefObject<HTMLDivElement | null>;
  handleListScroll: () => void;
  height?: number;
  scrollTrigger?: number;
}

export default function ScriptBeatsList({
  report,
  activeSceneIndex,
  setActiveSceneIndex,
  beatListRef,
  handleListScroll,
  height,
  scrollTrigger,
}: ScriptBeatsListProps) {
  const [activeTab, setActiveTab] = useState<string>("all");
  const [isScrolled, setIsScrolled] = useState(false);
  const { isPlaying } = useTimeline();

  React.useEffect(() => {
    if (beatListRef.current) {
      beatListRef.current.scrollTop = 0;
      setIsScrolled(false);
    }
  }, [report, beatListRef]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    setIsScrolled(target.scrollTop > 10);
    handleListScroll();
  };

  React.useEffect(() => {
    const container = beatListRef.current;
    if (!container) return;
    const activeItem = container.querySelector(`#beat-item-${activeSceneIndex}`) as HTMLElement;
    if (activeItem) {
      const containerTop = container.getBoundingClientRect().top;
      const activeItemTop = activeItem.getBoundingClientRect().top;
      const targetScrollTop = container.scrollTop + activeItemTop - containerTop;
      
      container.scrollTo({
        top: targetScrollTop,
        behavior: "smooth"
      });
    }
  }, [activeSceneIndex, beatListRef, scrollTrigger]);

  // Determine available tabs dynamically from graph tags
  const tabs = React.useMemo(() => {
    const list = [{ id: "all", label: "Narrative Beats", color: "#6366f1" }]; // indigo-500 color dot for Narrative Beats
    const addedLabels = new Set<string>();

    report.scenes.forEach((scene) => {
      scene.graph_tags?.forEach((tag) => {
        const normalized = tag.label.toLowerCase();
        if (!addedLabels.has(normalized)) {
          addedLabels.add(normalized);
          list.push({
            id: `graph-${normalized}`,
            label: tag.label,
            color: tag.color,
          });
        }
      });
    });

    return list;
  }, [report.scenes]);

  return (
    <div
      className="w-full bg-zinc-950/60 border border-zinc-800 rounded-2xl p-5 shadow-xl backdrop-blur flex flex-col"
      style={{ height: height ?? 450 }}
    >
      {/* Title & Tabs Navigation */}
      <div className="flex items-center justify-between border-b border-zinc-900/60 pb-3 mb-3 select-none flex-wrap gap-2">
        {/* Tabs Navigation (Moved to Left) */}
        <div className="flex space-x-1 bg-zinc-900/40 p-0.5 rounded-lg border border-zinc-850">
          {tabs.map((tab) => {
            const isTabActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center space-x-2 px-3.5 py-2 rounded-md text-xs font-bold uppercase tracking-wider font-mono transition-all cursor-pointer ${
                  isTabActive
                    ? "bg-zinc-800 text-zinc-100 shadow-sm font-extrabold"
                    : "text-zinc-500 hover:text-zinc-350"
                }`}
              >
                <span
                  className={`w-2 h-2 rounded-full shrink-0 transition-all duration-200 ${
                    isTabActive ? "scale-110 opacity-100" : "opacity-60"
                  }`}
                  style={{
                    backgroundColor: tab.color,
                    boxShadow: isTabActive
                      ? `0 0 6px color-mix(in srgb, ${tab.color} 80%, transparent)`
                      : undefined,
                  }}
                />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Step Beat-by-Beat Navigation Arrows (Moved to Right with Skip Buttons) */}
        <div className="flex bg-zinc-900/40 p-0.5 rounded-lg border border-zinc-850 space-x-0.5">
          {/* Skip to Start */}
          <button
            onClick={() => {
              setActiveSceneIndex(0);
              if (beatListRef.current) {
                beatListRef.current.scrollTo({
                  top: 0,
                  behavior: "smooth"
                });
              }
            }}
            disabled={isPlaying || (activeSceneIndex === 0 && !isScrolled)}
            className={`p-1.5 rounded transition-all cursor-pointer ${
              isPlaying || (activeSceneIndex === 0 && !isScrolled)
                ? "opacity-25 cursor-not-allowed text-zinc-650"
                : "text-zinc-400 hover:text-indigo-400 hover:bg-zinc-800"
            }`}
            title="Skip to Start Beat"
          >
            <ChevronsLeft size={16} />
          </button>
          
          {/* Previous Beat */}
          <button
            onClick={() => setActiveSceneIndex(Math.max(0, activeSceneIndex - 1))}
            disabled={isPlaying || activeSceneIndex === 0}
            className={`p-1.5 rounded transition-all cursor-pointer ${
              isPlaying || activeSceneIndex === 0
                ? "opacity-25 cursor-not-allowed text-zinc-650"
                : "text-zinc-400 hover:text-indigo-400 hover:bg-zinc-800"
            }`}
            title="Previous Beat"
          >
            <ChevronLeft size={16} />
          </button>

          {/* Next Beat */}
          <button
            onClick={() => setActiveSceneIndex(Math.min(report.scenes.length - 1, activeSceneIndex + 1))}
            disabled={isPlaying || activeSceneIndex === report.scenes.length - 1}
            className={`p-1.5 rounded transition-all cursor-pointer ${
              isPlaying || activeSceneIndex === report.scenes.length - 1
                ? "opacity-25 cursor-not-allowed text-zinc-650"
                : "text-zinc-400 hover:text-indigo-400 hover:bg-zinc-800"
            }`}
            title="Next Beat"
          >
            <ChevronRight size={16} />
          </button>

          {/* Skip to End */}
          <button
            onClick={() => setActiveSceneIndex(report.scenes.length - 1)}
            disabled={isPlaying || activeSceneIndex === report.scenes.length - 1}
            className={`p-1.5 rounded transition-all cursor-pointer ${
              isPlaying || activeSceneIndex === report.scenes.length - 1
                ? "opacity-25 cursor-not-allowed text-zinc-650"
                : "text-zinc-400 hover:text-indigo-400 hover:bg-zinc-800"
            }`}
            title="Skip to End Beat"
          >
            <ChevronsRight size={16} />
          </button>
        </div>
      </div>

      {/* Beat List */}
      <div
        ref={beatListRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto space-y-2 pr-1 scrollbar-thin scrollbar-thumb-zinc-800"
      >
        {report.scenes.map((scene, idx) => {
          const isActive = idx === activeSceneIndex;
          
          // Determine what content to show based on the active tab
          let displayedSummary = scene.summary;
          let activeBadge: React.ReactNode = null;

          if (activeTab === "all") {
            if (scene.narrative_elements.plot_point) {
              activeBadge = (
                <span className="text-[10px] font-bold font-mono px-2 py-0.5 bg-amber-950/50 text-amber-400 border border-amber-900/30 rounded">
                  {scene.narrative_elements.plot_point}
                </span>
              );
            }
          } else if (activeTab.startsWith("graph-")) {
            const targetLabel = activeTab.replace("graph-", "");
            const matchingTag = scene.graph_tags?.find(
              (tag) => tag.label.toLowerCase() === targetLabel
            );

            if (matchingTag) {
              displayedSummary = matchingTag.reasoning || displayedSummary;
              activeBadge = (
                <span
                  className="text-[10px] font-bold font-mono px-2 py-0.5 rounded text-white border border-white/5"
                  style={{
                    backgroundColor: matchingTag.color,
                    boxShadow: `0 0 6px color-mix(in srgb, ${matchingTag.color} 30%, transparent)`,
                  }}
                >
                  {matchingTag.label} {matchingTag.value !== undefined ? `(${matchingTag.value})` : ""}
                </span>
              );
            } else {
              displayedSummary = "Not active in this narrative beat.";
            }
          }

          return (
            <button
              key={scene.scene_number}
              id={`beat-item-${idx}`}
              onClick={() => setActiveSceneIndex(idx)}
              className={`w-full text-left p-3.5 rounded-xl border transition-all duration-200 cursor-pointer ${
                isActive
                  ? "bg-zinc-900 border-indigo-500/50 shadow-lg"
                  : "bg-zinc-950 border-zinc-900 hover:border-zinc-800 hover:bg-zinc-900/10"
              }`}
            >
              <div className="flex justify-between items-start mb-1.5">
                <span className="text-[10px] font-mono text-indigo-400 font-semibold uppercase tracking-wider flex items-center gap-1.5">
                  <span>Beat {scene.scene_number}</span>
                  {scene.start !== undefined && scene.end !== undefined && (
                    <span className="text-zinc-500 font-normal normal-case">
                      ({formatTime(scene.start)} - {formatTime(scene.end)})
                    </span>
                  )}
                </span>
                {activeBadge}
              </div>
              <p className="text-sm text-zinc-300 leading-relaxed">
                {displayedSummary}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
