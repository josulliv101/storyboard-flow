import React, { useState } from "react";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, MessageSquare, Camera, ScrollText, AlertTriangle, Star, Pencil, Trash2, Check, X } from "lucide-react";
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
  highlightedBeatNumbers: Set<string>;
  toggleHighlightBeat: (sceneNumber: number, key?: string) => void;
  isReadOnly?: boolean;
  onEditBeatText?: (idx: number, newText: string, key?: string) => void;
  onDeleteBeat?: (idx: number, key?: string) => void;
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
  highlightedBeatNumbers,
  toggleHighlightBeat,
  onEditBeatText,
  onDeleteBeat,
}: ScriptBeatsListProps) {
  const [isScrolled, setIsScrolled] = useState(false);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editText, setEditText] = useState<string>("");
  const [deletingIdx, setDeletingIdx] = useState<number | null>(null);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const { isPlaying, clips, fps } = useTimeline();

  const getActiveKey = () => {
    if (activeTab === "beats") return "summary";
    if (activeTab.startsWith("graph-")) {
      const metric = activeTab.replace("graph-", "");
      return metric === "anticipation" ? "stakes" : metric;
    }
    return "summary";
  };

  const renderSubNoteControls = (sceneIdx: number, subKey: string, currentText: string) => {
    const scene = report.scenes[sceneIdx];
    const sceneNumber = scene.scene_number;
    const highlightKey = `${sceneNumber}-${subKey}`;
    const isStarred = highlightedBeatNumbers.has(highlightKey);

    if (deletingIdx === sceneIdx && deletingKey === subKey) {
      return (
        <div className="flex items-center gap-1 bg-rose-950/45 border border-rose-900/35 px-1.5 py-0.5 rounded animate-fade-in" onClick={(e) => e.stopPropagation()}>
          <span className="text-[8.5px] font-bold text-rose-350 font-mono uppercase tracking-wider mr-1">Delete?</span>
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (onDeleteBeat) onDeleteBeat(sceneIdx, subKey);
              setDeletingIdx(null);
              setDeletingKey(null);
            }}
            className="px-1.5 py-0.5 bg-rose-600 hover:bg-rose-500 text-white text-[8px] font-bold uppercase tracking-wider font-mono rounded cursor-pointer border-0 transition-colors animate-fade-in"
          >
            Yes
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setDeletingIdx(null);
              setDeletingKey(null);
            }}
            className="px-1.5 py-0.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-[8px] font-bold uppercase tracking-wider font-mono rounded cursor-pointer border-0 transition-colors"
          >
            No
          </button>
        </div>
      );
    }

    return (
      <div className="flex items-center gap-1 select-none animate-fade-in" onClick={(e) => e.stopPropagation()}>
        {!isReadOnly && onEditBeatText && (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setEditingIdx(sceneIdx);
              setEditingKey(subKey);
              setEditText(currentText);
              setDeletingIdx(null);
              setDeletingKey(null);
            }}
            className="p-1 rounded text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900/60 transition-all cursor-pointer flex items-center justify-center border-0 outline-none"
            title="Edit note"
          >
            <Pencil className="w-3 h-3" />
          </button>
        )}
        {!isReadOnly && onDeleteBeat && (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setDeletingIdx(sceneIdx);
              setDeletingKey(subKey);
              setEditingIdx(null);
              setEditingKey(null);
            }}
            className="p-1 rounded text-zinc-500 hover:text-rose-400 hover:bg-rose-950/20 transition-all cursor-pointer flex items-center justify-center border-0 outline-none"
            title="Delete note"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        )}
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            toggleHighlightBeat(sceneNumber, subKey);
          }}
          className={`p-1 rounded transition-all cursor-pointer flex items-center justify-center border-0 outline-none ${
            isStarred
              ? "text-amber-400 hover:text-amber-300"
              : "text-zinc-500 hover:text-zinc-350 hover:bg-zinc-900/60"
          }`}
          title={isStarred ? "Remove highlight" : "Highlight note"}
        >
          <Star 
            className={`w-3 h-3 ${
              isStarred ? "fill-amber-400 text-amber-400" : "fill-transparent"
            }`} 
          />
        </button>
      </div>
    );
  };

  const renderSubNoteEditor = (sceneIdx: number, subKey: string) => {
    return (
      <div className="flex flex-col gap-2 w-full mt-1 animate-fade-in" onClick={(e) => e.stopPropagation()}>
        <textarea
          value={editText}
          onChange={(e) => setEditText(e.target.value)}
          className="w-full min-h-[60px] bg-zinc-900 border border-zinc-800 rounded-lg p-2 text-[11px] text-zinc-200 focus:outline-none focus:ring-1 focus:ring-indigo-500/50 resize-y leading-relaxed font-sans"
          placeholder="Enter note details..."
          autoFocus
        />
        <div className="flex justify-end gap-1.5">
          <button
            type="button"
            onClick={() => {
              if (onEditBeatText && editText.trim()) {
                onEditBeatText(sceneIdx, editText.trim(), subKey);
              }
              setEditingIdx(null);
              setEditingKey(null);
            }}
            className="px-2 py-0.5 bg-indigo-650 hover:bg-indigo-500 text-white rounded text-[9px] font-bold uppercase tracking-wider font-mono flex items-center gap-1 transition-colors cursor-pointer border-0 animate-fade-in"
          >
            <Check size={10} /> Save
          </button>
          <button
            type="button"
            onClick={() => {
              setEditingIdx(null);
              setEditingKey(null);
            }}
            className="px-2 py-0.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded text-[9px] font-bold uppercase tracking-wider font-mono flex items-center gap-1 transition-colors cursor-pointer border-0"
          >
            <X size={10} /> Cancel
          </button>
        </div>
      </div>
    );
  };

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
    const list = [{ id: "beats", label: "Beats", color: "#6366f1", count: report.scenes.length }];
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

    // Add a last option called "All"
    list.push({
      id: "all",
      label: "All",
      color: "#ec4899",
      count: report.scenes.length,
    });

    // Add a last option called "Highlighted"
    list.push({
      id: "highlighted",
      label: "Highlighted",
      color: "#fbbf24",
      count: report.scenes.filter((s) => Array.from(highlightedBeatNumbers).some(k => k.startsWith(`${s.scene_number}-`))).length,
    });

    return list;
  }, [report.scenes, highlightedBeatNumbers]);

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
                title={tab.id === "highlighted" ? "Highlighted Beats" : undefined}
                className={`flex items-center space-x-2 px-3.5 py-2 rounded-md text-xs font-bold uppercase tracking-wider font-mono transition-all cursor-pointer group ${
                  isTabActive
                    ? "bg-zinc-800 text-zinc-100 shadow-sm font-extrabold"
                    : "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900/40"
                }`}
              >
                {tab.id !== "beats" && tab.id !== "all" && tab.id !== "highlighted" && (
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
                {tab.id === "highlighted" && (
                  <Star 
                    className={`w-3.5 h-3.5 shrink-0 fill-amber-400 text-amber-400 ${
                      isTabActive ? "scale-110 opacity-100" : "opacity-60"
                    }`}
                  />
                )}
                {tab.id !== "highlighted" && <span>{tab.label}</span>}
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
      </div>

      {/* Beat List */}
      <div
        ref={beatListRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto space-y-2 pr-1 scrollbar-thin scrollbar-thumb-zinc-800"
      >
        {activeTab === "highlighted" && report.scenes.filter(s => Array.from(highlightedBeatNumbers).some(k => k.startsWith(`${s.scene_number}-`))).length === 0 ? (
          <div className="flex flex-col items-center justify-center p-8 text-center text-zinc-500 border border-dashed border-zinc-900/60 rounded-xl my-4 animate-fade-in">
            <Star className="w-8 h-8 opacity-25 text-amber-400 mb-2.5 fill-transparent" />
            <h4 className="text-[11px] font-bold font-mono uppercase tracking-wider text-zinc-400 mb-1">No Highlights</h4>
            <p className="text-[10px] text-zinc-650 max-w-[200px] leading-relaxed">
              Click the star icon on any beat card to highlight and pin key moments.
            </p>
          </div>
        ) : (
          report.scenes.map((scene, idx) => {
            const isActive = idx === activeSceneIndex;
            const isHighlighted = Array.from(highlightedBeatNumbers).some(k => k.startsWith(`${scene.scene_number}-`));
            if (activeTab === "highlighted" && !isHighlighted) return null;
            
            // Determine what content to show based on the active tab
            let displayedSummary = scene.summary;
            let activeBadge: React.ReactNode = null;

            const isGraphTab = activeTab.startsWith("graph-");
            const targetLabel = isGraphTab ? activeTab.replace("graph-", "") : "";
            const matchingTag = isGraphTab
              ? scene.graph_tags?.find((tag) => tag.label.toLowerCase() === targetLabel)
              : null;
            const hasNoData = isGraphTab && !matchingTag;

          if (activeTab === "beats") {
            if (scene.narrative_elements.plot_point && scene.narrative_elements.plot_point.toLowerCase() !== 'analysis') {
              activeBadge = (
                <span className="text-[10px] font-bold font-mono px-2 py-0.5 bg-amber-950/50 text-amber-400 border border-amber-900/30 rounded animate-fade-in">
                  {scene.narrative_elements.plot_point}
                </span>
              );
            }
          } else if (activeTab === "highlighted") {
            const isSummaryStarred = highlightedBeatNumbers.has(`${scene.scene_number}-summary`);
            const isTensionStarred = highlightedBeatNumbers.has(`${scene.scene_number}-tension`);
            const isSuspenseStarred = highlightedBeatNumbers.has(`${scene.scene_number}-suspense`);
            const isStakesStarred = highlightedBeatNumbers.has(`${scene.scene_number}-stakes`);

            activeBadge = (
              <div className="flex flex-wrap items-center gap-1.5 select-none">
                {isSummaryStarred && scene.narrative_elements.plot_point && scene.narrative_elements.plot_point.toLowerCase() !== 'analysis' && (
                  <span className="text-[10px] font-bold font-mono px-2 py-0.5 bg-amber-950/50 text-amber-400 border border-amber-900/30 rounded animate-fade-in">
                    {scene.narrative_elements.plot_point}
                  </span>
                )}
                {scene.graph_tags?.map((tag) => {
                  const normalized = tag.label.toLowerCase();
                  const isStarred = (normalized === "tension" && isTensionStarred) ||
                                    (normalized === "suspense" && isSuspenseStarred) ||
                                    (normalized === "stakes" && isStakesStarred);
                  if (!isStarred) return null;

                  return (
                    <span
                      key={tag.label}
                      title={tag.label}
                      className="inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-[10px] font-bold font-mono shadow-sm bg-zinc-950/40 animate-fade-in"
                      style={{
                        borderColor: `${tag.color}30`,
                        color: tag.color,
                      }}
                    >
                      <MetricSymbol name={tag.label} className="w-2.5 h-2.5 shrink-0 fill-current" style={{ color: tag.color }} />
                      {tag.value !== undefined && (
                        <span 
                          className="inline-flex min-w-6 items-center justify-center rounded px-1.5 py-0.5 tabular-nums text-[10.5px] font-extrabold text-white"
                          style={{
                            backgroundColor: `${tag.color}25`,
                            border: `1px solid ${tag.color}40`
                          }}
                        >
                          {formatTagValue(tag.value)}
                        </span>
                      )}
                    </span>
                  );
                })}
              </div>
            );
          } else if (activeTab === "all") {
            activeBadge = (
              <div className="flex flex-wrap items-center gap-1.5 select-none">
                {scene.narrative_elements.plot_point && scene.narrative_elements.plot_point.toLowerCase() !== 'analysis' && (
                  <span className="text-[10px] font-bold font-mono px-2 py-0.5 bg-amber-950/50 text-amber-400 border border-amber-900/30 rounded animate-fade-in">
                    {scene.narrative_elements.plot_point}
                  </span>
                )}
                {scene.graph_tags?.map((tag) => (
                  <span
                    key={tag.label}
                    title={tag.label}
                    className="inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-[10px] font-bold font-mono shadow-sm bg-zinc-950/40 animate-fade-in"
                    style={{
                      borderColor: `${tag.color}30`,
                      color: tag.color,
                    }}
                  >
                    <MetricSymbol name={tag.label} className="w-2.5 h-2.5 shrink-0 fill-current" style={{ color: tag.color }} />
                    {tag.value !== undefined && (
                      <span 
                        className="inline-flex min-w-6 items-center justify-center rounded px-1.5 py-0.5 tabular-nums text-[10.5px] font-extrabold text-white"
                        style={{
                          backgroundColor: `${tag.color}25`,
                          border: `1px solid ${tag.color}40`
                        }}
                      >
                        {formatTagValue(tag.value)}
                      </span>
                    )}
                  </span>
                ))}
              </div>
            );
          } else if (isGraphTab) {
            if (matchingTag) {
              displayedSummary = matchingTag.reasoning || displayedSummary;
              activeBadge = (
                <span
                  title={matchingTag.label}
                  className="inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-[10px] font-bold font-mono shadow-sm bg-zinc-950/40"
                  style={{
                    borderColor: `${matchingTag.color}30`,
                    color: matchingTag.color,
                  }}
                >
                  <MetricSymbol name={matchingTag.label} className="w-2.5 h-2.5 shrink-0 fill-current" />
                  {matchingTag.value !== undefined && (
                    <span 
                      className="inline-flex min-w-6 items-center justify-center rounded px-1.5 py-0.5 tabular-nums text-[10.5px] font-extrabold text-white"
                      style={{
                        backgroundColor: `${matchingTag.color}25`,
                        border: `1px solid ${matchingTag.color}40`
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

          let allDetailsContent: React.ReactNode = null;
          if (activeTab === "all") {
            allDetailsContent = (
              <div className="mt-3 space-y-3 pt-3 border-t border-zinc-900/30">
                {/* Narrative Summary Description */}
                {scene.summary && (
                  <div className="bg-zinc-900/30 border border-zinc-900/50 rounded-lg p-3 flex flex-col gap-1.5 animate-fade-in">
                    <div className="flex items-center justify-between gap-2 border-b border-zinc-900/30 pb-1.5 select-none">
                      <h4 className="text-[9.5px] font-bold text-zinc-400 uppercase tracking-widest font-mono flex items-center gap-1.5">
                        <ScrollText size={11} className="text-indigo-400" />
                        Narrative Summary
                      </h4>
                      {renderSubNoteControls(idx, "summary", scene.summary)}
                    </div>
                    {editingIdx === idx && editingKey === "summary" ? (
                      renderSubNoteEditor(idx, "summary")
                    ) : (
                      <p className="text-xs text-zinc-200 leading-relaxed font-sans select-text">
                        {scene.summary}
                      </p>
                    )}
                  </div>
                )}

                {/* Plot Point details if exists */}
                {scene.narrative_elements?.plot_point && scene.narrative_elements.plot_point.toLowerCase() !== 'analysis' && (
                  <div className="bg-zinc-900/20 border border-zinc-900/40 rounded-lg p-3 flex flex-col gap-1.5 animate-fade-in">
                    <div className="flex items-center justify-between gap-2 border-b border-zinc-900/40 pb-1.5 select-none">
                      <span className="text-[10px] font-bold text-zinc-300 uppercase tracking-wider font-mono">
                        Plot Point
                      </span>
                      <span className="text-[9px] font-bold bg-amber-500/10 text-amber-300 border border-amber-500/20 px-1.5 py-0.5 rounded font-mono uppercase tracking-wider">
                        {scene.narrative_elements.plot_point}
                      </span>
                    </div>
                    {scene.narrative_elements.plot_point_reasoning && (
                      <p className="text-xs text-zinc-350 leading-relaxed select-text">
                        {scene.narrative_elements.plot_point_reasoning}
                      </p>
                    )}
                  </div>
                )}

                {/* Metrics Stack */}
                <div className="space-y-2.5">
                  {/* Tension */}
                  {scene.metrics?.tension !== undefined && (
                    <div className="bg-zinc-900/20 border border-zinc-900/40 rounded-lg p-3 flex flex-col gap-1.5 animate-fade-in">
                      <div className="flex items-center justify-between gap-2 border-b border-zinc-900/40 pb-1.5 select-none">
                        <span className="text-[10px] font-bold text-zinc-300 uppercase tracking-wider font-mono flex items-center gap-1.5">
                          <MetricSymbol name="tension" className="w-2.5 h-2.5 shrink-0" style={{ color: "#f43f5e" }} />
                          Dramatic Tension
                          <span className="text-[10px] font-black bg-rose-500/10 text-rose-400 border border-rose-500/20 px-1.5 py-0.5 rounded font-mono ml-2">
                            {scene.metrics.tension}/5
                          </span>
                        </span>
                        {renderSubNoteControls(idx, "tension", scene.metrics.tension_reasoning || "")}
                      </div>
                      {editingIdx === idx && editingKey === "tension" ? (
                        renderSubNoteEditor(idx, "tension")
                      ) : (
                        scene.metrics.tension_reasoning && (
                          <p className="text-xs text-zinc-350 leading-relaxed select-text">
                            {scene.metrics.tension_reasoning}
                          </p>
                        )
                      )}
                    </div>
                  )}

                  {/* Suspense */}
                  {scene.metrics?.suspense !== undefined && (
                    <div className="bg-zinc-900/20 border border-zinc-900/40 rounded-lg p-3 flex flex-col gap-1.5 animate-fade-in">
                      <div className="flex items-center justify-between gap-2 border-b border-zinc-900/40 pb-1.5 select-none">
                        <span className="text-[10px] font-bold text-zinc-300 uppercase tracking-wider font-mono flex items-center gap-1.5">
                          <MetricSymbol name="suspense" className="w-2.5 h-2.5 shrink-0" style={{ color: "#a855f7" }} />
                          Anticipatory Suspense
                          <span className="text-[10px] font-black bg-purple-500/10 text-purple-400 border border-purple-500/20 px-1.5 py-0.5 rounded font-mono ml-2">
                            {scene.metrics.suspense}/5
                          </span>
                        </span>
                        {renderSubNoteControls(idx, "suspense", scene.metrics.suspense_reasoning || "")}
                      </div>
                      {editingIdx === idx && editingKey === "suspense" ? (
                        renderSubNoteEditor(idx, "suspense")
                      ) : (
                        scene.metrics.suspense_reasoning && (
                          <p className="text-xs text-zinc-350 leading-relaxed select-text">
                            {scene.metrics.suspense_reasoning}
                          </p>
                        )
                      )}
                    </div>
                  )}

                  {/* Operational Stakes */}
                  {scene.metrics?.anticipation !== undefined && (
                    <div className="bg-zinc-900/20 border border-zinc-900/40 rounded-lg p-3 flex flex-col gap-1.5 animate-fade-in">
                      <div className="flex items-center justify-between gap-2 border-b border-zinc-900/40 pb-1.5 select-none">
                        <span className="text-[10px] font-bold text-zinc-300 uppercase tracking-wider font-mono flex items-center gap-1.5">
                          <MetricSymbol name="anticipation" className="w-2.5 h-2.5 shrink-0" style={{ color: "#06b6d4" }} />
                          Operational Stakes
                          <span className="text-[10px] font-black bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 px-1.5 py-0.5 rounded font-mono ml-2">
                            {scene.metrics.anticipation}/5
                          </span>
                        </span>
                        {renderSubNoteControls(idx, "stakes", scene.metrics.anticipation_reasoning || "")}
                      </div>
                      {editingIdx === idx && editingKey === "stakes" ? (
                        renderSubNoteEditor(idx, "stakes")
                      ) : (
                        scene.metrics.anticipation_reasoning && (
                          <p className="text-xs text-zinc-350 leading-relaxed select-text">
                            {scene.metrics.anticipation_reasoning}
                          </p>
                        )
                      )}
                    </div>
                  )}

                  {/* Stakes dynamics */}
                  {scene.narrative_elements?.stakes_reasoning && (
                    <div className="bg-zinc-900/20 border border-zinc-900/40 rounded-lg p-3 flex flex-col gap-1.5 animate-fade-in">
                      <div className="flex items-center justify-between gap-2 border-b border-zinc-900/40 pb-1.5">
                        <span className="text-[10px] font-bold text-zinc-300 uppercase tracking-wider font-mono flex items-center gap-1.5">
                          <AlertTriangle size={11} className={scene.narrative_elements.stakes_raised ? "text-amber-400 animate-pulse" : "text-zinc-500"} />
                          Stakes Dynamics
                        </span>
                        {scene.narrative_elements.stakes_raised && (
                          <span className="text-[9px] bg-amber-500/15 text-amber-400 border border-amber-500/25 px-1.5 py-0.5 rounded font-mono font-bold uppercase tracking-wider">
                            Raised
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-zinc-350 leading-relaxed select-text">
                        {scene.narrative_elements.stakes_reasoning}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            );
          }

          let highlightedDetailsContent: React.ReactNode = null;
          if (activeTab === "highlighted") {
            const isSummaryStarred = highlightedBeatNumbers.has(`${scene.scene_number}-summary`);
            const isTensionStarred = highlightedBeatNumbers.has(`${scene.scene_number}-tension`);
            const isSuspenseStarred = highlightedBeatNumbers.has(`${scene.scene_number}-suspense`);
            const isStakesStarred = highlightedBeatNumbers.has(`${scene.scene_number}-stakes`);

            highlightedDetailsContent = (
              <div className="mt-3 space-y-3 pt-3 border-t border-zinc-900/30">
                {/* Narrative Summary Description */}
                {isSummaryStarred && scene.summary && (
                  <div className="bg-zinc-900/30 border border-zinc-900/50 rounded-lg p-3 flex flex-col gap-1.5 animate-fade-in">
                    <div className="flex items-center justify-between gap-2 border-b border-zinc-900/30 pb-1.5 select-none">
                      <h4 className="text-[9.5px] font-bold text-zinc-400 uppercase tracking-widest font-mono flex items-center gap-1.5">
                        <ScrollText size={11} className="text-indigo-400" />
                        Narrative Summary
                      </h4>
                      {renderSubNoteControls(idx, "summary", scene.summary)}
                    </div>
                    {editingIdx === idx && editingKey === "summary" ? (
                      renderSubNoteEditor(idx, "summary")
                    ) : (
                      <p className="text-xs text-zinc-200 leading-relaxed font-sans select-text">
                        {scene.summary}
                      </p>
                    )}
                  </div>
                )}

                {/* Metrics Stack */}
                <div className="space-y-2.5">
                  {/* Tension */}
                  {isTensionStarred && scene.metrics?.tension !== undefined && (
                    <div className="bg-zinc-900/20 border border-zinc-900/40 rounded-lg p-3 flex flex-col gap-1.5 animate-fade-in">
                      <div className="flex items-center justify-between gap-2 border-b border-zinc-900/40 pb-1.5 select-none">
                        <span className="text-[10px] font-bold text-zinc-300 uppercase tracking-wider font-mono flex items-center gap-1.5">
                          <MetricSymbol name="tension" className="w-2.5 h-2.5 shrink-0" style={{ color: "#f43f5e" }} />
                          Dramatic Tension
                          <span className="text-[10px] font-black bg-rose-500/10 text-rose-400 border border-rose-500/20 px-1.5 py-0.5 rounded font-mono ml-2">
                            {scene.metrics.tension}/5
                          </span>
                        </span>
                        {renderSubNoteControls(idx, "tension", scene.metrics.tension_reasoning || "")}
                      </div>
                      {editingIdx === idx && editingKey === "tension" ? (
                        renderSubNoteEditor(idx, "tension")
                      ) : (
                        scene.metrics.tension_reasoning && (
                          <p className="text-xs text-zinc-350 leading-relaxed select-text">
                            {scene.metrics.tension_reasoning}
                          </p>
                        )
                      )}
                    </div>
                  )}

                  {/* Suspense */}
                  {isSuspenseStarred && scene.metrics?.suspense !== undefined && (
                    <div className="bg-zinc-900/20 border border-zinc-900/40 rounded-lg p-3 flex flex-col gap-1.5 animate-fade-in">
                      <div className="flex items-center justify-between gap-2 border-b border-zinc-900/40 pb-1.5 select-none">
                        <span className="text-[10px] font-bold text-zinc-300 uppercase tracking-wider font-mono flex items-center gap-1.5">
                          <MetricSymbol name="suspense" className="w-2.5 h-2.5 shrink-0" style={{ color: "#a855f7" }} />
                          Anticipatory Suspense
                          <span className="text-[10px] font-black bg-purple-500/10 text-purple-400 border border-purple-500/20 px-1.5 py-0.5 rounded font-mono ml-2">
                            {scene.metrics.suspense}/5
                          </span>
                        </span>
                        {renderSubNoteControls(idx, "suspense", scene.metrics.suspense_reasoning || "")}
                      </div>
                      {editingIdx === idx && editingKey === "suspense" ? (
                        renderSubNoteEditor(idx, "suspense")
                      ) : (
                        scene.metrics.suspense_reasoning && (
                          <p className="text-xs text-zinc-350 leading-relaxed select-text">
                            {scene.metrics.suspense_reasoning}
                          </p>
                        )
                      )}
                    </div>
                  )}

                  {/* Operational Stakes */}
                  {isStakesStarred && scene.metrics?.anticipation !== undefined && (
                    <div className="bg-zinc-900/20 border border-zinc-900/40 rounded-lg p-3 flex flex-col gap-1.5 animate-fade-in">
                      <div className="flex items-center justify-between gap-2 border-b border-zinc-900/40 pb-1.5 select-none">
                        <span className="text-[10px] font-bold text-zinc-300 uppercase tracking-wider font-mono flex items-center gap-1.5">
                          <MetricSymbol name="anticipation" className="w-2.5 h-2.5 shrink-0" style={{ color: "#06b6d4" }} />
                          Operational Stakes
                          <span className="text-[10px] font-black bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 px-1.5 py-0.5 rounded font-mono ml-2">
                            {scene.metrics.anticipation}/5
                          </span>
                        </span>
                        {renderSubNoteControls(idx, "stakes", scene.metrics.anticipation_reasoning || "")}
                      </div>
                      {editingIdx === idx && editingKey === "stakes" ? (
                        renderSubNoteEditor(idx, "stakes")
                      ) : (
                        scene.metrics.anticipation_reasoning && (
                          <p className="text-xs text-zinc-350 leading-relaxed select-text">
                            {scene.metrics.anticipation_reasoning}
                          </p>
                        )
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
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
              <div className="w-32 shrink-0 bg-zinc-950/40 relative border-r border-zinc-900/50 flex flex-col justify-start select-none">
                <div className="w-full aspect-video bg-zinc-950 border-b border-zinc-900/50 flex items-center justify-center group/thumb overflow-hidden relative select-none">
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
                          className="p-1.5 bg-indigo-650 hover:bg-indigo-500 text-white rounded-full transition-all cursor-pointer shadow-lg hover:scale-105 flex items-center justify-center border-0 outline-none"
                          title="Update beat screenshot"
                        >
                          <Camera className="w-3.5 h-3.5 text-white" />
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
                    {activeTab !== "all" && activeTab !== "highlighted" && !hasNoData && (
                      deletingIdx === idx && (deletingKey === null || deletingKey === getActiveKey()) ? (
                        <div className="flex items-center gap-1.5 bg-rose-955/45 border border-rose-900/35 px-2 py-0.5 rounded animate-fade-in" onClick={(e) => e.stopPropagation()}>
                          <span className="text-[9px] font-bold text-rose-350 font-mono uppercase tracking-wider mr-1">Delete?</span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              if (onDeleteBeat) onDeleteBeat(idx, getActiveKey());
                              setDeletingIdx(null);
                              setDeletingKey(null);
                            }}
                            className="px-1.5 py-0.5 bg-rose-600 hover:bg-rose-500 text-white text-[9px] font-bold uppercase tracking-wider font-mono rounded cursor-pointer border-0 transition-colors"
                          >
                            Yes
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setDeletingIdx(null);
                              setDeletingKey(null);
                            }}
                            className="px-1.5 py-0.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-[9px] font-bold uppercase tracking-wider font-mono rounded cursor-pointer border-0 transition-colors"
                          >
                            No
                          </button>
                        </div>
                      ) : (
                        <>
                          {!isReadOnly && onEditBeatText && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setEditingIdx(idx);
                                setEditingKey(getActiveKey());
                                
                                // Set initial editText based on active tab
                                let val = "";
                                if (activeTab === "beats") {
                                  val = scene.summary || "";
                                } else if (activeTab.startsWith("graph-")) {
                                  const metric = activeTab.replace("graph-", "");
                                  if (metric === "tension") val = scene.metrics?.tension_reasoning || "";
                                  else if (metric === "suspense") val = scene.metrics?.suspense_reasoning || "";
                                  else if (metric === "anticipation" || metric === "stakes") val = scene.metrics?.anticipation_reasoning || "";
                                }
                                setEditText(val);
                                setDeletingIdx(null);
                                setDeletingKey(null);
                              }}
                              className="p-1 rounded text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900/60 transition-all cursor-pointer flex items-center justify-center border-0 outline-none"
                              title="Edit description"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {!isReadOnly && onDeleteBeat && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setDeletingIdx(idx);
                                setDeletingKey(getActiveKey());
                                setEditingIdx(null);
                                setEditingKey(null);
                              }}
                              className="p-1 rounded text-zinc-500 hover:text-rose-455 hover:bg-rose-955/20 transition-all cursor-pointer flex items-center justify-center border-0 outline-none"
                              title="Delete beat"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              toggleHighlightBeat(scene.scene_number, getActiveKey());
                            }}
                            className={`p-1 rounded transition-all cursor-pointer flex items-center justify-center border-0 outline-none ${
                              highlightedBeatNumbers.has(`${scene.scene_number}-${getActiveKey()}`)
                                ? "text-amber-400 hover:text-amber-300"
                                : "text-zinc-500 hover:text-zinc-350 hover:bg-zinc-900/60"
                            }`}
                            title={highlightedBeatNumbers.has(`${scene.scene_number}-${getActiveKey()}`) ? "Remove highlight" : "Highlight beat"}
                          >
                            <Star 
                              className={`w-3.5 h-3.5 ${
                                highlightedBeatNumbers.has(`${scene.scene_number}-${getActiveKey()}`) ? "fill-amber-400 text-amber-400" : "fill-transparent"
                              }`} 
                            />
                          </button>
                        </>
                      )
                    )}
                  </div>
                </div>
                {editingIdx === idx && (editingKey === null || editingKey === getActiveKey()) ? (
                  <div className="flex flex-col gap-2 w-full mt-1.5 animate-fade-in" onClick={(e) => e.stopPropagation()}>
                    <textarea
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      className="w-full min-h-[80px] bg-zinc-900 border border-zinc-800 rounded-lg p-2.5 text-xs text-zinc-200 focus:outline-none focus:ring-1 focus:ring-indigo-500/50 resize-y leading-relaxed font-sans"
                      placeholder="Enter beat description..."
                      autoFocus
                    />
                    <div className="flex justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          if (onEditBeatText && editText.trim()) {
                            onEditBeatText(idx, editText.trim(), getActiveKey());
                          }
                          setEditingIdx(null);
                          setEditingKey(null);
                        }}
                        className="px-2.5 py-1 bg-indigo-650 hover:bg-indigo-500 text-white rounded text-[10px] font-bold uppercase tracking-wider font-mono flex items-center gap-1 transition-colors cursor-pointer border-0 animate-fade-in"
                      >
                        <Check size={12} /> Save
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingIdx(null);
                          setEditingKey(null);
                        }}
                        className="px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded text-[10px] font-bold uppercase tracking-wider font-mono flex items-center gap-1 transition-colors cursor-pointer border-0"
                      >
                        <X size={12} /> Cancel
                      </button>
                    </div>
                  </div>
                ) : activeTab === "all" ? (
                  allDetailsContent
                ) : activeTab === "highlighted" ? (
                  highlightedDetailsContent
                ) : (
                  <p className={`text-sm leading-relaxed break-words ${
                    isActive
                      ? "text-zinc-200"
                      : hasNoData
                        ? "text-zinc-500"
                        : "text-zinc-300"
                  }`}>
                    {displayedSummary}
                  </p>
                )}
              </div>
            </div>
          );
        })
      )}
      </div>
    </div>
  );
}
