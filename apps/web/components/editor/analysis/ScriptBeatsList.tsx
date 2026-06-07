import React, { useState } from "react";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, MessageSquare, Camera } from "lucide-react";
import { ScreenplayReport } from "./types";
import { MetricSymbol } from "./MetricSymbol";
import { useTimeline } from "@/lib/timeline-context";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@storyboard/ui";

const formatTime = (time: number) => {
  const mins = Math.floor(time / 60);
  const secs = Math.floor(time % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
};

const formatTagValue = (value: number) => (
  Number.isInteger(value) ? value.toString() : value.toFixed(1)
);

interface ScriptBeatsListProps {
  report: ScreenplayReport;
  activeSceneIndex: number;
  setActiveSceneIndex: (index: number) => void;
  beatListRef: React.RefObject<HTMLDivElement | null>;
  handleListScroll: () => void;
  height?: number;
  scrollTrigger?: number;
  activeTab: string;
  setActiveTab: (tabId: string) => void;
  onUpdateBeatThumbnail?: (idx: number, source: 'current' | 'center' | 'file', file?: File) => void;
  selectedVideoFile?: File | null;
  isReadOnly?: boolean;
}

export default function ScriptBeatsList({
  report,
  activeSceneIndex,
  setActiveSceneIndex,
  beatListRef,
  handleListScroll,
  height,
  scrollTrigger,
  activeTab,
  setActiveTab,
  onUpdateBeatThumbnail,
  selectedVideoFile,
  isReadOnly = false,
}: ScriptBeatsListProps) {
  const [isScrolled, setIsScrolled] = useState(false);
  const { isPlaying, clips, fps } = useTimeline();

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
      activeItem.scrollIntoView({
        behavior: "smooth",
        block: "nearest"
      });
    }
  }, [activeSceneIndex, beatListRef, scrollTrigger]);

  // Determine available tabs dynamically from graph tags
  const tabs = React.useMemo(() => {
    const list = [{ id: "all", label: "Beats", color: "#6366f1", count: report.scenes.length }];
    const addedLabels = new Set<string>();

    report.scenes.forEach((scene) => {
      scene.graph_tags?.forEach((tag) => {
        const normalized = tag.label.toLowerCase();
        if (!addedLabels.has(normalized)) {
          addedLabels.add(normalized);
          
          // Count how many scenes actually have this tag
          const count = report.scenes.filter((s) =>
            s.graph_tags?.some((t) => t.label.toLowerCase() === normalized)
          ).length;

          list.push({
            id: `graph-${normalized}`,
            label: tag.label,
            color: tag.color,
            count,
          });
        }
      });
    });

    return list;
  }, [report.scenes]);

  return (
    <div
      className="w-full bg-zinc-950/60 border border-zinc-900/80 rounded-2xl p-5 shadow-xl backdrop-blur flex flex-col"
      style={{ height: height ?? 450 }}
    >
      {/* Title & Tabs Navigation */}
      <div className="flex items-center justify-between border-b border-zinc-900/30 pb-3 mb-3 select-none flex-wrap gap-2">
        {/* Tabs Navigation (Moved to Left) */}
        <div className="flex space-x-1 bg-zinc-900/30 p-0.5 rounded-lg border border-zinc-900/50">
          {tabs.map((tab) => {
            const isTabActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center space-x-2 px-3.5 py-2 rounded-md text-xs font-bold uppercase tracking-wider font-mono transition-all cursor-pointer group ${
                  isTabActive
                    ? "bg-zinc-800 text-zinc-100 shadow-sm font-extrabold"
                    : "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900/40"
                }`}
              >
                {tab.id !== "all" && (
                  <MetricSymbol
                    name={tab.label}
                    className={`shrink-0 transition-all duration-200 w-3 h-3 ${
                      isTabActive ? "scale-110 opacity-100" : "opacity-60"
                    }`}
                    style={{
                      color: tab.color,
                    }}
                  />
                )}
                <span>{tab.label}</span>
                <span className={`text-[9px] px-1.5 py-0.5 rounded font-normal font-mono transition-colors ${
                  isTabActive
                    ? "bg-zinc-950 text-indigo-300"
                    : "bg-zinc-900/80 text-zinc-500 group-hover:text-zinc-350"
                }`}>
                  {(tab as any).count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Step Beat-by-Beat Navigation Arrows (Moved to Right with Skip Buttons) */}
        <div className="flex bg-zinc-900/30 p-0.5 rounded-lg border border-zinc-900/50 space-x-0.5">
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
                : "text-zinc-300 hover:text-indigo-400 hover:bg-zinc-800"
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
                : "text-zinc-300 hover:text-indigo-400 hover:bg-zinc-800"
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
                : "text-zinc-300 hover:text-indigo-400 hover:bg-zinc-800"
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
                : "text-zinc-300 hover:text-indigo-400 hover:bg-zinc-800"
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

          const isGraphTab = activeTab.startsWith("graph-");
          const targetLabel = isGraphTab ? activeTab.replace("graph-", "") : "";
          const matchingTag = isGraphTab
            ? scene.graph_tags?.find((tag) => tag.label.toLowerCase() === targetLabel)
            : null;
          const hasNoData = isGraphTab && !matchingTag;

          if (activeTab === "all") {
            if (scene.narrative_elements.plot_point) {
              activeBadge = (
                <span className="text-[10px] font-bold font-mono px-2 py-0.5 bg-amber-950/50 text-amber-400 border border-amber-900/30 rounded">
                  {scene.narrative_elements.plot_point}
                </span>
              );
            }
          } else if (isGraphTab) {
            if (matchingTag) {
              displayedSummary = matchingTag.reasoning || displayedSummary;
              activeBadge = (
                <span
                  className="inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-[10px] font-bold font-mono shadow-sm bg-zinc-950/40"
                  style={{
                    borderColor: `${matchingTag.color}30`,
                    color: matchingTag.color,
                  }}
                >
                  <MetricSymbol name={matchingTag.label} className="w-2.5 h-2.5 shrink-0 fill-current" />
                  <span className="[text-box:trim-both_cap_alphabetic]">{matchingTag.label}</span>
                  {matchingTag.value !== undefined && (
                    <span 
                      className="inline-flex min-w-6 items-center justify-center rounded px-1.5 py-0.5 tabular-nums text-[9px]"
                      style={{
                        backgroundColor: `${matchingTag.color}15`,
                        color: matchingTag.color,
                        border: `1px solid ${matchingTag.color}25`
                      }}
                    >
                      {formatTagValue(matchingTag.value)}
                    </span>
                  )}
                </span>
              );
            } else {
              displayedSummary = "Not active in this beat.";
            }
          }

          const hasDialogue = clips && fps && clips.some(
            (c) =>
              c.type === "dialog" &&
              c.startFrame >= Math.round((scene.start ?? 0) * fps) &&
              c.startFrame < Math.round((scene.end ?? 0) * fps)
          );

          return (
            <div
              key={scene.scene_number}
              id={`beat-item-${idx}`}
              onClick={() => setActiveSceneIndex(idx)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setActiveSceneIndex(idx);
                }
              }}
              role="button"
              tabIndex={0}
              className={`w-full text-left rounded-xl border transition-all duration-200 cursor-pointer flex items-stretch overflow-hidden outline-none focus-visible:ring-1 focus-visible:ring-indigo-500/50 ${
                isActive
                  ? "bg-zinc-900/60 border-indigo-500/30 shadow-md"
                  : "bg-transparent border-transparent hover:border-zinc-900/50 hover:bg-zinc-900/10"
              }`}
            >
              <div className="w-24 shrink-0 bg-zinc-950 relative border-r border-zinc-900/50 flex items-center justify-center group/thumb overflow-hidden min-h-[80px] select-none">
                {scene.thumbnailUrl ? (
                  <img 
                    src={scene.thumbnailUrl} 
                    className="absolute inset-0 w-full h-full object-cover transition-transform duration-300 group-hover/thumb:scale-105" 
                    alt={`Beat ${scene.scene_number}`} 
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center gap-1 text-zinc-700">
                    <Camera className="w-4 h-4 opacity-40" />
                    <span className="text-[8px] font-mono font-bold uppercase tracking-wider opacity-40">No Frame</span>
                  </div>
                )}
                
                {/* Camera update overlay button/dropdown */}
                {!isReadOnly && onUpdateBeatThumbnail && (
                  <div className="absolute inset-0 bg-black/60 opacity-0 group-hover/thumb:opacity-100 transition-opacity flex items-center justify-center z-10">
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                        }}
                        className="p-2 bg-indigo-650 hover:bg-indigo-500 text-white rounded-full transition-all cursor-pointer shadow-lg hover:scale-105 flex items-center justify-center border-0 outline-none"
                        title="Update beat screenshot"
                      >
                        <Camera className="w-4 h-4 text-white" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent 
                        align="start" 
                        className="bg-zinc-950 border border-zinc-900 text-zinc-300 z-50 p-1.5 rounded-lg w-48 shadow-2xl"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                        }}
                      >
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            onUpdateBeatThumbnail(idx, 'current');
                          }}
                          className="focus:bg-zinc-900 focus:text-white px-2 py-1.5 text-[10px] font-mono font-bold uppercase tracking-wider flex items-center gap-2 rounded cursor-pointer transition-colors"
                        >
                          📸 Use Current Playhead
                        </DropdownMenuItem>
                        {selectedVideoFile && (
                          <DropdownMenuItem
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              onUpdateBeatThumbnail(idx, 'center');
                            }}
                            className="focus:bg-zinc-900 focus:text-white px-2 py-1.5 text-[10px] font-mono font-bold uppercase tracking-wider flex items-center gap-2 rounded cursor-pointer transition-colors border-t border-zinc-900/50 mt-0.5 pt-1.5"
                          >
                            ⏱️ Use Beat Center Frame
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            // Trigger file input
                            const input = document.createElement('input');
                            input.type = 'file';
                            input.accept = 'image/*';
                            input.onchange = (evt: any) => {
                              const file = evt.target.files?.[0];
                              if (file) {
                                onUpdateBeatThumbnail(idx, 'file', file);
                              }
                            };
                            input.click();
                          }}
                          className="focus:bg-zinc-900 focus:text-white px-2 py-1.5 text-[10px] font-mono font-bold uppercase tracking-wider flex items-center gap-2 rounded cursor-pointer transition-colors border-t border-zinc-900/50 mt-0.5 pt-1.5"
                        >
                          📁 Upload Custom Image
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                )}
              </div>
 
              <div className="flex-1 min-w-0 p-3.5">
                <div className="flex justify-between items-start mb-1.5 flex-wrap gap-1">
                  <span className="text-[10px] font-mono text-indigo-400 font-semibold uppercase tracking-wider flex items-center gap-1.5">
                    <span>Beat {scene.scene_number}</span>
                    {hasDialogue && (
                      <span title="Contains dialogue" className="inline-flex items-center">
                        <MessageSquare className="w-3 h-3 text-indigo-400/80 shrink-0" />
                      </span>
                    )}
                    {scene.start !== undefined && scene.end !== undefined && (
                      <span className="text-zinc-500 font-normal normal-case">
                        ({formatTime(scene.start)} - {formatTime(scene.end)})
                      </span>
                    )}
                  </span>
                  <div className="flex items-center gap-1.5 select-none">
                    {activeBadge}
                    {!isReadOnly && onUpdateBeatThumbnail && (
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                          }}
                          className="p-1.5 text-zinc-500 hover:text-indigo-400 hover:bg-zinc-900 rounded-md transition-all cursor-pointer flex items-center justify-center border-0 outline-none"
                          title="Update beat screenshot"
                        >
                          <Camera className="w-3.5 h-3.5" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent 
                          align="end" 
                          className="bg-zinc-950 border border-zinc-900 text-zinc-300 z-50 p-1.5 rounded-lg w-48 shadow-2xl"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                          }}
                        >
                          <DropdownMenuItem
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              onUpdateBeatThumbnail(idx, 'current');
                            }}
                            className="focus:bg-zinc-900 focus:text-white px-2 py-1.5 text-[10px] font-mono font-bold uppercase tracking-wider flex items-center gap-2 rounded cursor-pointer transition-colors"
                          >
                            📸 Use Current Playhead
                          </DropdownMenuItem>
                          {selectedVideoFile && (
                            <DropdownMenuItem
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                onUpdateBeatThumbnail(idx, 'center');
                              }}
                              className="focus:bg-zinc-900 focus:text-white px-2 py-1.5 text-[10px] font-mono font-bold uppercase tracking-wider flex items-center gap-2 rounded cursor-pointer transition-colors border-t border-zinc-900/50 mt-0.5 pt-1.5"
                            >
                              ⏱️ Use Beat Center Frame
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              // Trigger file input
                              const input = document.createElement('input');
                              input.type = 'file';
                              input.accept = 'image/*';
                              input.onchange = (evt: any) => {
                                const file = evt.target.files?.[0];
                                if (file) {
                                  onUpdateBeatThumbnail(idx, 'file', file);
                                }
                              };
                              input.click();
                            }}
                            className="focus:bg-zinc-900 focus:text-white px-2 py-1.5 text-[10px] font-mono font-bold uppercase tracking-wider flex items-center gap-2 rounded cursor-pointer transition-colors border-t border-zinc-900/50 mt-0.5 pt-1.5"
                          >
                            📁 Upload Custom Image
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                </div>
                <p className={`text-sm leading-relaxed break-words ${
                  isActive
                    ? "text-zinc-200"
                    : hasNoData
                      ? "text-zinc-500"
                      : "text-zinc-300"
                }`}>
                  {displayedSummary}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
