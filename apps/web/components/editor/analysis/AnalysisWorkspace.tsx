"use client";

import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  Sparkles,
  MessageSquare,
  Terminal,
  FileVideo,
  Trash2,
  Loader2,
  Check,
  Activity,
  Flame,
  Award,
  AlertTriangle,
  RotateCcw,
  ChevronUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  GripVertical,
  GripHorizontal,
  Layers,
  ScrollText,
  UploadCloud,
  X,
  HelpCircle,
  Play,
  User,
  Camera,
  MoreVertical,
  Star
} from "lucide-react";
import { useTimeline } from "@/lib/timeline-context";
import { extractBeatThumbnailFromVideo } from "@/lib/video-helpers";
import { getGraphColor } from "@/lib/graph-style";
import ScriptBeatsList from "./ScriptBeatsList";
import SceneInspector from "./SceneInspector";
import ExecutiveSummary from "./ExecutiveSummary";
import DiagnosticsPanel from "./DiagnosticsPanel";
import AgentLogs from "./AgentLogs";
import ChatConsole from "./ChatConsole";
import { ScreenplayReport, LogEntry, SceneAnalysis } from "./types";
import { Button } from "@storyboard/ui";
import { MetricSymbol, TensionChart } from "@storyboard/ui/charts";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const detectLetterbox = (video: HTMLVideoElement): { top: number; bottom: number } => {
  const vWidth = video.videoWidth;
  const vHeight = video.videoHeight;
  const topDefault = 0;
  const bottomDefault = vHeight;

  try {
    const canvas = document.createElement('canvas');
    canvas.width = 3;
    canvas.height = vHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return { top: topDefault, bottom: bottomDefault };

    const cols = [
      Math.floor(vWidth * 0.25),
      Math.floor(vWidth * 0.5),
      Math.floor(vWidth * 0.75)
    ];

    for (let c = 0; c < 3; c++) {
      ctx.drawImage(video, cols[c], 0, 1, vHeight, c, 0, 1, vHeight);
    }

    const imgData = ctx.getImageData(0, 0, 3, vHeight);
    const data = imgData.data;

    let minTop = vHeight;
    let maxBottom = 0;

    for (let c = 0; c < 3; c++) {
      let colTop = 0;
      for (let y = 0; y < vHeight; y++) {
        const idx = (y * 3 + c) * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];
        if (r > 18 || g > 18 || b > 18) {
          colTop = y;
          break;
        }
      }
      minTop = Math.min(minTop, colTop);

      let colBottom = vHeight;
      for (let y = vHeight - 1; y >= 0; y--) {
        const idx = (y * 3 + c) * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];
        if (r > 18 || g > 18 || b > 18) {
          colBottom = y + 1;
          break;
        }
      }
      maxBottom = Math.max(maxBottom, colBottom);
    }

    const activeHeight = maxBottom - minTop;
    if (activeHeight < vHeight * 0.2 || minTop >= maxBottom) {
      return { top: topDefault, bottom: bottomDefault };
    }

    return { top: minTop, bottom: maxBottom };
  } catch (e) {
    console.warn("Letterbox detection failed:", e);
    return { top: topDefault, bottom: bottomDefault };
  }
};

const clipOverlapsFrameRange = (
  clip: { startFrame: number; duration: number },
  rangeStartFrame: number,
  rangeEndFrame: number
) => {
  const clipStartFrame = clip.startFrame;
  const clipEndFrame = clip.startFrame + Math.max(1, clip.duration);
  const normalizedRangeEndFrame = Math.max(rangeStartFrame + 1, rangeEndFrame);

  return clipStartFrame < normalizedRangeEndFrame && clipEndFrame > rangeStartFrame;
};

interface AnalysisWorkspaceProps {
  selectedVideoFile: File | null;
  setSelectedVideoFile: (file: File | null) => void;
  videoObjectURL: string;
  setVideoObjectURL: (url: string) => void;
  isAnalyzing: boolean;
  analysisProgress: number;
  analysisLogs: string[];
  isAnalysisComplete: boolean;
  setIsAnalysisComplete: (complete: boolean) => void;
  videoDuration: number;
  setVideoDuration: (duration: number) => void;
  analysisModelChoice: 'gemini' | 'gemma';
  setAnalysisModelChoice: (model: 'gemini' | 'gemma') => void;
  enabledGraphLayers: Record<string, boolean>;
  setEnabledGraphLayers: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  storyAnalyzePlotPoints: boolean;
  setStoryAnalyzePlotPoints: (val: boolean) => void;
  storyAnalyzeStakes: boolean;
  setStoryAnalyzeStakes: (val: boolean) => void;
  storyAnalyzeConfrontation: boolean;
  setStoryAnalyzeConfrontation: (val: boolean) => void;
  runVideoAnalysis: () => Promise<void>;
  onOpenScriptEditor?: (clipId: string, sceneId: string) => void;
  handleCaptureCurrentFrameThumbnail?: () => Promise<void>;
  isCapturingSceneThumbnail?: boolean;
  activeVideoClipAtCurrentFrame?: any;
  isPlaying?: boolean;
  isReadOnly?: boolean;
}

export function AnalysisWorkspace({
  selectedVideoFile,
  setSelectedVideoFile,
  videoObjectURL,
  setVideoObjectURL,
  isAnalyzing,
  analysisProgress,
  analysisLogs,
  isAnalysisComplete,
  setIsAnalysisComplete,
  videoDuration,
  setVideoDuration,
  analysisModelChoice,
  setAnalysisModelChoice,
  enabledGraphLayers,
  setEnabledGraphLayers,
  storyAnalyzePlotPoints,
  setStoryAnalyzePlotPoints,
  storyAnalyzeStakes,
  setStoryAnalyzeStakes,
  storyAnalyzeConfrontation,
  setStoryAnalyzeConfrontation,
  runVideoAnalysis,
  onOpenScriptEditor,
  handleCaptureCurrentFrameThumbnail,
  isCapturingSceneThumbnail = false,
  activeVideoClipAtCurrentFrame,
  isPlaying = false,
  isReadOnly = false,
}: AnalysisWorkspaceProps) {
  const {
    scenes,
    activeSceneId,
    clips,
    tracks,
    characters,
    fps,
    updateClip,
    updateTrack,
    setCurrentFrame,
    setWorkspaceViewMode,
  } = useTimeline();

  const activeScene = scenes.find((s) => s.id === activeSceneId) || scenes[0];

  const activeSceneVideoSrc = useMemo(() => {
    const videoClip = clips.find(c => c.type === 'video' && c.src);
    return videoClip?.src || videoObjectURL;
  }, [clips, videoObjectURL]);

  // Diagnostics and Chat States
  const [apiHealth, setApiHealth] = useState<{ status: string; has_genai_sdk: boolean; has_api_key: boolean } | null>(null);
  const [ollamaStatus, setOllamaStatus] = useState<{ status: string; models: string[]; error?: string } | null>(null);
  const [isCheckingDiagnostics, setIsCheckingDiagnostics] = useState(false);
  const [isDiagnosticsOpen, setIsDiagnosticsOpen] = useState(false);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [selectedOllamaModel, setSelectedOllamaModel] = useState("gemma4");

  // Panel Collapsible State
  const [isAnalyzerOpen, setIsAnalyzerOpen] = useState(false);

  // Preview mode (video or static storyboard image)
  const [previewMode, setPreviewMode] = useState<'video' | 'storyboard'>('video');
  const [showDialogueOverlay, setShowDialogueOverlay] = useState(true);
  const [videoLoadError, setVideoLoadError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>("beats");

  const [isJsonViewOpen, setIsJsonViewOpen] = useState(false);
  const [jsonTab, setJsonTab] = useState<'analysis' | 'timeline'>('analysis');
  const [copied, setCopied] = useState(false);

  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isCapturingThumbnail, setIsCapturingThumbnail] = useState(false);

  // Chat States
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatEngine, setChatEngine] = useState<"doctor" | "ollama">("doctor");
  const [chatInput, setChatInput] = useState("");
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [isThoughtExpanded, setIsThoughtExpanded] = useState(false);
  const [doctorMessages, setDoctorMessages] = useState<Array<{ role: "user" | "assistant"; content: string }>>([
    {
      role: "assistant",
      content:
        "Hello! I am your AI Story Doctor. I have reviewed your screenplay and active timeline beats.\n\n" +
        "I can help you brainstorm to:\n" +
        "- **Suggest a rewrite** for any scene to elevate its pacing or suspense.\n" +
        "- **Add a ticking-clock element** to raise the story stakes.\n" +
        "- **Improve dialogue subtext** to create more anticipation between characters.\n\n" +
        "What aspect of your story would you like to brainstorm first?",
    },
  ]);
  const [ollamaMessages, setOllamaMessages] = useState<Array<{ role: "user" | "assistant"; content: string }>>([
    {
      role: "assistant",
      content: "Hello! This is a direct connection to your local Ollama instance. Ask me anything about your project.",
    },
  ]);

  useEffect(() => {
    setVideoLoadError(null);
  }, [activeSceneVideoSrc]);



  // Selected Beat State
  const [activeSceneIndex, setActiveSceneIndex] = useState(0);
  const [scrollTrigger, setScrollTrigger] = useState(0);
  const beatListRef = useRef<HTMLDivElement | null>(null);
  const [beatsListHeight, setBeatsListHeight] = useState<number>(450);
  const [dialogueHeight, setDialogueHeight] = useState<number>(240);
  const [highlightedBeatNumbers, setHighlightedBeatNumbers] = useState<Set<string>>(new Set());

  const toggleHighlightBeat = useCallback((sceneNumber: number, key = "summary") => {
    const highlightKey = `${sceneNumber}-${key}`;
    setHighlightedBeatNumbers((prev) => {
      const next = new Set(prev);
      if (next.has(highlightKey)) {
        next.delete(highlightKey);
      } else {
        next.add(highlightKey);
      }
      return next;
    });
  }, []);

  // Drag and drop states for dashboard items reordering
  const [dashboardLayout, setDashboardLayout] = useState<{
    left: string[];
    right: string[];
  }>({
    left: ['preview', 'dialogue'],
    right: ['beatsList', 'chart'],
  });
  const [draggedItem, setDraggedItem] = useState<string | null>(null);
  const [draggedSourceCol, setDraggedSourceCol] = useState<'left' | 'right' | null>(null);
  const [isDraggable, setIsDraggable] = useState<string | null>(null);

  const handleDragStart = (e: React.DragEvent, id: string, col: 'left' | 'right') => {
    e.dataTransfer.effectAllowed = 'move';
    setDraggedItem(id);
    setDraggedSourceCol(col);
  };

  const handleDragOverCard = (e: React.DragEvent, targetId: string, targetCol: 'left' | 'right') => {
    e.preventDefault();
    if (!draggedItem || draggedItem === targetId) return;

    setDashboardLayout((prev) => {
      // Find source column and remove item
      const sourceCol = prev.left.includes(draggedItem) ? 'left' : 'right';
      const sourceItems = prev[sourceCol].filter((x) => x !== draggedItem);

      // Find target column and insert before targetId
      const targetItems = [...prev[targetCol]];
      const targetFiltered = sourceCol === targetCol ? sourceItems : targetItems;
      const targetIdx = targetFiltered.indexOf(targetId);
      if (targetIdx === -1) return prev;

      const newTarget = [...targetFiltered];
      newTarget.splice(targetIdx, 0, draggedItem);

      return {
        left: targetCol === 'left' ? newTarget : (sourceCol === 'left' ? sourceItems : prev.left),
        right: targetCol === 'right' ? newTarget : (sourceCol === 'right' ? sourceItems : prev.right),
      };
    });
  };

  const handleDragOverColumn = (e: React.DragEvent, col: 'left' | 'right') => {
    e.preventDefault();
    if (!draggedItem) return;

    setDashboardLayout((prev) => {
      const isAlreadyInCol = prev[col].includes(draggedItem);
      if (isAlreadyInCol) return prev;

      const sourceCol = prev.left.includes(draggedItem) ? 'left' : 'right';
      const sourceItems = prev[sourceCol].filter((x) => x !== draggedItem);
      const targetItems = [...prev[col], draggedItem];

      return {
        left: col === 'left' ? targetItems : (sourceCol === 'left' ? sourceItems : prev.left),
        right: col === 'right' ? targetItems : (sourceCol === 'right' ? sourceItems : prev.right),
      };
    });
  };

  const handleDragEnd = () => {
    setDraggedItem(null);
    setDraggedSourceCol(null);
    setIsDraggable(null);
  };

  const activeSceneData = useMemo(() => {
    return {
      id: activeScene.id,
      name: activeScene.name,
      description: activeScene.description,
      duration: activeScene.duration,
      clips: clips.map(c => ({
        id: c.id,
        name: c.name,
        type: c.type,
        startFrame: c.startFrame,
        duration: c.duration,
        trackId: c.trackId,
        tags: c.tags,
        linkedGraphTrackIds: c.linkedGraphTrackIds
      })),
      tracks: tracks.map(t => ({
        id: t.id,
        name: t.name,
        parentId: t.parentId,
        type: t.type,
        graph: t.graph ? {
          type: t.graph.type,
          label: t.graph.label,
          min: t.graph.min,
          max: t.graph.max,
          pointsCount: t.graph.points?.length
        } : undefined
      }))
    };
  }, [activeScene, clips, tracks]);

  const handleCopyJson = () => {
    const dataToCopy = jsonTab === 'analysis' ? report : activeSceneData;
    navigator.clipboard.writeText(JSON.stringify(dataToCopy, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const tracker = e.currentTarget;
    tracker.setPointerCapture(e.pointerId);
    const startY = e.clientY;
    const startHeight = beatsListHeight;

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const deltaY = moveEvent.clientY - startY;
      const newHeight = Math.max(120, Math.min(600, startHeight + deltaY));
      setBeatsListHeight(newHeight);
    };

    const handlePointerUp = (upEvent: PointerEvent) => {
      try {
        tracker.releasePointerCapture(upEvent.pointerId);
      } catch (err) {
        // ignore
      }
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", handlePointerUp);
    };

    document.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointerup", handlePointerUp);
  };

  const handleDialogueResizePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const tracker = e.currentTarget;
    tracker.setPointerCapture(e.pointerId);
    const startY = e.clientY;
    const startHeight = dialogueHeight;

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const deltaY = moveEvent.clientY - startY;
      const newHeight = Math.max(100, Math.min(500, startHeight + deltaY));
      setDialogueHeight(newHeight);
    };

    const handlePointerUp = (upEvent: PointerEvent) => {
      try {
        tracker.releasePointerCapture(upEvent.pointerId);
      } catch (err) {
        // ignore
      }
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", handlePointerUp);
    };

    document.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointerup", handlePointerUp);
  };
  


  // Probe diagnostics on mount
  useEffect(() => {
    void checkDiagnostics();
  }, []);


  const checkDiagnostics = async () => {
    setIsCheckingDiagnostics(true);
    try {
      const healthRes = await fetch("http://127.0.0.1:8000/api/health", { signal: AbortSignal.timeout(2000) });
      if (healthRes.ok) {
        setApiHealth(await healthRes.json());
      } else {
        setApiHealth({ status: "offline", has_genai_sdk: false, has_api_key: false });
      }
    } catch {
      setApiHealth({ status: "offline", has_genai_sdk: false, has_api_key: false });
    }

    try {
      const ollamaRes = await fetch("http://127.0.0.1:8000/api/ollama-status", { signal: AbortSignal.timeout(2000) });
      if (ollamaRes.ok) {
        setOllamaStatus(await ollamaRes.json());
      } else {
        setOllamaStatus({ status: "offline", models: [] });
      }
    } catch (e) {
      setOllamaStatus({ status: "offline", models: [], error: e instanceof Error ? e.message : "Ollama offline" });
    }
    setIsCheckingDiagnostics(false);
  };

  const graphTracksInActiveScene = useMemo(() => {
    return tracks.filter(t => t.type === 'graph' && t.graph);
  }, [tracks]);

  // Compile report from timeline context data
  const report: ScreenplayReport | null = useMemo(() => {
    const savedReport = activeScene.analysisReport;

    // Identify narrative beat clips (main beats only, preventing duplicates from Tension/Suspense notes)
    const noteClips = clips
      .filter((c) => c.type === "note" && (c.name === "Analysis" || c.tags?.includes("Analysis") || c.name.toLowerCase().includes("beat")))
      .sort((a, b) => a.startFrame - b.startFrame);

    if (noteClips.length === 0) {
      if (!savedReport) return null;
      const dur = videoDuration || (activeScene.duration ? activeScene.duration / fps : 180);
      const count = savedReport.scenes.length || 1;
      const scenes = savedReport.scenes.map((scene: any, idx: number) => {
        const start = scene.start !== undefined ? scene.start : (idx * (dur / count));
        const end = scene.end !== undefined ? scene.end : ((idx + 1) * (dur / count));
        return { ...scene, start, end };
      });
      return { ...savedReport, scenes };
    }

    const tensionTrack = tracks.find((t) => t.id === "graph-dramatic-tension" || t.name.toLowerCase().includes("tension"));
    const suspenseTrack = tracks.find((t) => t.id === "graph-anticipatory-suspense" || t.name.toLowerCase().includes("suspense"));
    const stakesTrack = tracks.find((t) => t.id === "graph-operational-stakes" || t.name.toLowerCase().includes("stakes") || t.name.toLowerCase().includes("conflict"));

    const getGraphValueAtFrame = (track: any, frame: number) => {
      if (!track?.graph?.points || track.graph.points.length === 0) return 3;
      const sorted = [...track.graph.points].sort((a, b) => a.frame - b.frame);
      let val = sorted[0].value;
      for (const pt of sorted) {
        if (pt.frame <= frame) {
          val = pt.value;
        } else {
          break;
        }
      }
      return val;
    };

    const parsedBeats: SceneAnalysis[] = noteClips.map((beat, idx) => {
      const start = beat.startFrame / fps;
      const end = (beat.startFrame + beat.duration) / fps;

      // Find overlapping dialog characters
      const overlappingClips = clips.filter(
        (c) =>
          c.type === "dialog" &&
          clipOverlapsFrameRange(c, beat.startFrame, beat.startFrame + beat.duration)
      );
      const speakerNames = Array.from(
        new Set(
          overlappingClips
            .map((c) => c.character || characters.find((ch) => ch.id === c.characterId)?.name || "")
            .filter(Boolean)
        )
      );

      const tensionVal = getGraphValueAtFrame(tensionTrack, beat.startFrame);
      const suspenseVal = getGraphValueAtFrame(suspenseTrack, beat.startFrame);
      const stakesVal = getGraphValueAtFrame(stakesTrack, beat.startFrame);

      // Divide by 2 because timeline metrics are 0-10, dashboard uses 0-5
      const tension = Math.min(5, Math.max(0, tensionVal / 2));
      const suspense = Math.min(5, Math.max(0, suspenseVal / 2));
      const anticipation = Math.min(5, Math.max(0, stakesVal / 2));

      // Extract details
      const tReasoning = clips.find((c) => c.type === "note" && c.startFrame === beat.startFrame && c.name.toLowerCase().includes("tension"))?.description;
      const sReasoning = clips.find((c) => c.type === "note" && c.startFrame === beat.startFrame && c.name.toLowerCase().includes("suspense"))?.description;
      const stReasoning = clips.find((c) => c.type === "note" && c.startFrame === beat.startFrame && c.name.toLowerCase().includes("stakes"))?.description;

      // Find all note clips starting at the same frame as this beat (e.g. Tension Reasoning, Stakes Reasoning)
      const sameFrameNotes = clips.filter(
        (c) => c.type === "note" && c.startFrame === beat.startFrame
      );

      // Collect all tags from these notes
      const clipTags = Array.from(
        new Set(
          sameFrameNotes.flatMap((c) => c.tags || [])
        )
      );

      // Combine linkedGraphTrackIds from all these notes as well
      const linkedGraphIdSet = new Set(
        sameFrameNotes.flatMap((c) => c.linkedGraphTrackIds || [])
      );

      const tagKeySet = new Set(clipTags.map((t) => t.trim().toLowerCase().replace(/\s+/g, '-')));

      const graphTracks = tracks.filter((t) => t.type === "graph" && t.graph);
      const matchedGraphTagKeys = new Set<string>();

      const graphTags = graphTracks
        .map((track, graphIndex) => {
          const label = track.graph?.label || track.name || "Graph";
          const shortLabel = track.graph?.shortLabel || label;
          const tagKeys = [
            track.id,
            track.name,
            label,
            shortLabel,
          ]
            .map((t) => t?.trim().toLowerCase().replace(/\s+/g, '-'))
            .filter(Boolean);

          const isLinked = linkedGraphIdSet.has(track.id) || tagKeys.some((tagKey) => tagKeySet.has(tagKey));
          if (isLinked) {
            tagKeys.forEach((tagKey) => {
              if (tagKeySet.has(tagKey)) matchedGraphTagKeys.add(tagKey);
            });
          }
          return { track, graphIndex, isLinked };
        })
        .filter(({ isLinked }) => isLinked)
        .map(({ track, graphIndex }) => {
          const graphColor = getGraphColor(track.graph, graphIndex);
          const rawValue = getGraphValueAtFrame(track, beat.startFrame);
          // Divide by 2 because timeline metrics are 0-10, dashboard uses 0-5
          const value = track.graph && track.graph.showValue !== false
            ? Math.min(5, Math.max(0, Math.round(rawValue / 2)))
            : undefined;

          // Find a note clip on this track (or linked to this track) starting at the same frame to extract reasoning
          const noteOnTrack = sameFrameNotes.find(
            (c) => c.trackId === track.id || c.linkedGraphTrackIds?.includes(track.id)
          );
          const reasoning = noteOnTrack?.description || `${track.graph?.label || track.name} metric assessed at ${value}/5.`;

          return {
            id: track.id,
            label: track.graph?.label || track.name || "Graph",
            color: graphColor.line || graphColor.accent,
            value,
            reasoning,
          };
        });

      const displayTags = clipTags.filter((tag) => {
        const tagKey = tag.trim().toLowerCase().replace(/\s+/g, '-');
        return tagKey !== 'preview' && tagKey !== 'analysis' && !matchedGraphTagKeys.has(tagKey);
      });

      return {
        scene_number: idx + 1,
        title: beat.name,
        text_segment: beat.description || "",
        summary: beat.description || "Narrative beat summary.",
        characters: speakerNames,
        thumbnailUrl: (beat as any).thumbnailUrl,
        metrics: {
          tension,
          suspense,
          anticipation,
          tension_reasoning: tReasoning || `Tension metric assessed at ${tension}/5.`,
          suspense_reasoning: sReasoning || `Suspense metric assessed at ${suspense}/5.`,
          anticipation_reasoning: stReasoning || `Anticipation metric assessed at ${anticipation}/5.`,
        },
        narrative_elements: {
          plot_point: beat.tags?.[0] || beat.name.replace(" Beat", ""),
          plot_point_reasoning: beat.description || "",
          stakes_raised: anticipation > 3,
          stakes_reasoning: stReasoning || "Stakes are evaluated relative to current conflict parameters.",
          additional_elements: beat.tags || [],
        },
        start,
        end,
        graph_tags: graphTags,
        display_tags: displayTags,
      };
    });

    const avgT = parseFloat((parsedBeats.reduce((acc, b) => acc + b.metrics.tension, 0) / parsedBeats.length).toFixed(2)) || 0;
    const avgS = parseFloat((parsedBeats.reduce((acc, b) => acc + b.metrics.suspense, 0) / parsedBeats.length).toFixed(2)) || 0;
    const avgA = parseFloat((parsedBeats.reduce((acc, b) => acc + b.metrics.anticipation, 0) / parsedBeats.length).toFixed(2)) || 0;

    let pacing = savedReport?.pacing_dynamics;
    if (!pacing) {
      if (activeScene.analysisModel) {
        pacing = activeScene.analysisModel.includes("gemma") ? "Slow-Burn Dialogue Arc" : "Crescendo / Rising Action Arc";
      } else {
        pacing = "Custom Storyboards Arc";
      }
    }

    const agent_logs = savedReport?.agent_logs || [];
    if (agent_logs.length === 0) {
      agent_logs.push(
        { sender: "Coordinator", message: `Loaded scene metrics for active scene "${activeScene.name}"`, timestamp: "Pipeline Init" },
        { sender: "Coordinator", message: `Stitched ${parsedBeats.length} story beats. Checking agent evaluations.`, timestamp: "Stage 1" }
      );
      parsedBeats.forEach((b) => {
        agent_logs.push({
          sender: "Metric Analyzer",
          message: `Parsed Beat ${b.scene_number}: Tension=${b.metrics.tension}, Suspense=${b.metrics.suspense}, Anticipation=${b.metrics.anticipation}`,
          timestamp: `Beat ${b.scene_number}`,
        });
        if (b.narrative_elements.plot_point) {
          agent_logs.push({
            sender: "Narrative Expert",
            message: `Detected critical plot point event: "${b.narrative_elements.plot_point}"`,
            timestamp: `Beat ${b.scene_number}`,
          });
        }
      });
      agent_logs.push({ sender: "Synthesizer", message: `Generated consolidated Executive Summary report. Pacing: "${pacing}"`, timestamp: "Done" });
    }

    return {
      title: activeScene.name,
      overall_summary: activeScene.description || savedReport?.overall_summary || "The active timeline contains parsed narrative beats, detailing dialogue bubbles and emotional tracking. Select individual beats to check metrics.",
      scenes: parsedBeats,
      average_tension: avgT,
      average_suspense: avgS,
      average_anticipation: avgA,
      pacing_dynamics: pacing,
      agent_logs,
      model_used: activeScene.analysisModel || savedReport?.model_used || "Heuristic Analysis Layer",
      is_llm: Boolean(activeScene.analysisModel || savedReport?.is_llm),
    };
  }, [clips, tracks, characters, activeScene, fps, videoDuration]);

  const handleSelectScene = useCallback((idx: number) => {
    if (!report?.scenes || idx < 0 || idx >= report.scenes.length) return;
    setActiveSceneIndex(idx);
    setScrollTrigger((prev) => prev + 1);
    const start = report.scenes[idx].start ?? 0;
    setCurrentFrame(Math.round(start * fps));
  }, [report, fps, setActiveSceneIndex, setScrollTrigger, setCurrentFrame]);

  // Keyboard Arrow Navigation for moving through beats
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if focus is in an input or textarea or contenteditable element
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        return;
      }

      if (!report?.scenes || report.scenes.length === 0) return;

      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        const nextIdx = Math.min(report.scenes.length - 1, activeSceneIndex + 1);
        handleSelectScene(nextIdx);
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        const prevIdx = Math.max(0, activeSceneIndex - 1);
        handleSelectScene(prevIdx);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [report, activeSceneIndex, handleSelectScene]);

  const handleUpdateMetricValue = useCallback((sceneIndex: number, metric: 'tension' | 'suspense' | 'anticipation', newValue: number) => {
    if (!report?.scenes) return;
    const beat = report.scenes[sceneIndex];
    if (!beat) return;

    let trackId = "";
    if (metric === 'tension') {
      const track = tracks.find((t) => t.id === "graph-dramatic-tension" || t.name.toLowerCase().includes("tension"));
      trackId = track?.id || "";
    } else if (metric === 'suspense') {
      const track = tracks.find((t) => t.id === "graph-anticipatory-suspense" || t.name.toLowerCase().includes("suspense"));
      trackId = track?.id || "";
    } else if (metric === 'anticipation') {
      const track = tracks.find((t) => t.id === "graph-operational-stakes" || t.name.toLowerCase().includes("stakes") || t.name.toLowerCase().includes("conflict"));
      trackId = track?.id || "";
    }

    if (!trackId) return;

    const track = tracks.find(t => t.id === trackId);
    if (!track || !track.graph) return;

    // Convert chart value [0..5] to timeline value [0..10]
    const timelineValue = Math.min(10, Math.max(0, Math.round(newValue * 2)));

    const targetFrame = Math.round((beat.start ?? 0) * fps);
    const existingPoints = track.graph.points || [];
    
    let updatedPoints = [...existingPoints];
    const exactPtIdx = updatedPoints.findIndex(pt => pt.frame === targetFrame);

    if (exactPtIdx !== -1) {
      updatedPoints[exactPtIdx] = { ...updatedPoints[exactPtIdx], value: timelineValue };
    } else {
      updatedPoints.push({ frame: targetFrame, value: timelineValue });
      updatedPoints.sort((a, b) => a.frame - b.frame);
    }

    updateTrack(trackId, {
      graph: {
        ...track.graph,
        points: updatedPoints
      }
    });

    toast.success(`Updated ${metric} to ${newValue} for "${beat.title || `Beat ${beat.scene_number}`}"`, {
      id: `metric-update-${metric}-${sceneIndex}`
    });
  }, [report, tracks, fps, updateTrack]);

  // Handle active beat scroll/click synchronization
  const chartData = useMemo(() => {
    return report
      ? report.scenes.map((s, idx) => ({
          name: s.title,
          tension: s.metrics.tension,
          suspense: s.metrics.suspense,
          anticipation: s.metrics.anticipation,
          sceneIndex: idx,
          timestamp: s.start ?? idx * 15,
        }))
      : [];
  }, [report]);

  const chartColors = useMemo(() => {
    const graphTracks = tracks.filter((track) => track.type === "graph" && track.graph);
    const getLineColor = (track: typeof graphTracks[number] | undefined) => {
      if (!track?.graph) return undefined;
      const graphIndex = Math.max(0, graphTracks.findIndex((item) => item.id === track.id));
      const graphColor = getGraphColor(track.graph, graphIndex);
      return graphColor.line || graphColor.accent;
    };

    const tensionTrack = graphTracks.find((track) => (
      track.id === "graph-dramatic-tension" || track.name.toLowerCase().includes("tension")
    ));
    const suspenseTrack = graphTracks.find((track) => (
      track.id === "graph-anticipatory-suspense" || track.name.toLowerCase().includes("suspense")
    ));
    const stakesTrack = graphTracks.find((track) => (
      track.id === "graph-operational-stakes" || track.name.toLowerCase().includes("stakes") || track.name.toLowerCase().includes("conflict")
    ));

    return {
      tension: getLineColor(tensionTrack),
      suspense: getLineColor(suspenseTrack),
      anticipation: getLineColor(stakesTrack),
    };
  }, [tracks]);

  const activeBeat = report?.scenes[activeSceneIndex];

  const activeBeatDialogClips = useMemo(() => {
    if (!activeBeat || !clips) return [];
    const beatStartSeconds = activeBeat.start ?? 0;
    const nextBeatStartSeconds = report?.scenes[activeSceneIndex + 1]?.start;
    const beatEndSeconds = activeBeat.end ?? nextBeatStartSeconds ?? videoDuration ?? beatStartSeconds;
    const beatStartFrame = Math.round(beatStartSeconds * fps);
    const beatEndFrame = Math.round(beatEndSeconds * fps);
    return clips
      .filter(
        (c) =>
          c.type === "dialog" &&
          clipOverlapsFrameRange(c, beatStartFrame, beatEndFrame)
      )
      .sort((a, b) => a.startFrame - b.startFrame);
  }, [activeBeat, activeSceneIndex, clips, fps, report, videoDuration]);

  const videoRef = useRef<HTMLVideoElement>(null);

  const handleVideoTimeUpdate = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    const video = e.currentTarget;
    const time = video.currentTime;
    
    // Only update the dashboard active beat from video timeline if the movie is actively playing
    if (!video.paused && report && report.scenes) {
      const idx = report.scenes.findIndex(s => time >= (s.start ?? 0) && time < (s.end ?? 0));
      if (idx !== -1 && idx !== activeSceneIndex) {
        setActiveSceneIndex(idx);
      }
    }
  };

  const handleSetThumbnail = async () => {
    setIsMenuOpen(false);
    
    const video = videoRef.current;
    if (!video) {
      toast.error("Video player not available");
      return;
    }

    // Identify corresponding timeline note clip
    const noteClips = clips
      .filter((c) => c.type === "note" && (c.name === "Analysis" || c.tags?.includes("Analysis") || c.name.toLowerCase().includes("beat")))
      .sort((a, b) => a.startFrame - b.startFrame);
      
    const activeBeatClip = noteClips[activeSceneIndex];
    if (!activeBeatClip) {
      toast.error("No active beat timeline clip found");
      return;
    }

    toast.loading("Capturing beat thumbnail...", { id: "set-thumb" });
    setIsCapturingThumbnail(true);

    try {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error("Could not get canvas context");

      const vWidth = video.videoWidth;
      const vHeight = video.videoHeight;

      // 16:9 target size
      const width = 640;
      const height = 360;
      canvas.width = width;
      canvas.height = height;

      // Detect letterboxing
      const { top: topLetterbox, bottom: bottomLetterbox } = detectLetterbox(video);
      const activeHeight = bottomLetterbox - topLetterbox;

      const srcAspect = vWidth / activeHeight;
      const destAspect = width / height;

      let sx = 0;
      let sy = topLetterbox;
      let sWidth = vWidth;
      let sHeight = activeHeight;

      if (srcAspect > destAspect) {
        sWidth = activeHeight * destAspect;
        sx = (vWidth - sWidth) / 2;
      } else if (srcAspect < destAspect) {
        sHeight = vWidth / destAspect;
        sy = topLetterbox + (activeHeight - sHeight) / 2;
      }

      ctx.drawImage(video, sx, sy, sWidth, sHeight, 0, 0, width, height);

      canvas.toBlob(async (blob) => {
        if (!blob) {
          toast.error("Failed to convert frame to blob", { id: "set-thumb" });
          setIsCapturingThumbnail(false);
          return;
        }

        try {
          const filename = `timeline-videos/beat-thumb-${activeBeatClip.id}-${Date.now()}.jpg`;
          const formData = new FormData();
          formData.append('file', blob);
          formData.append('filename', filename);

          // Upload to persistent store
          const uploadRes = await fetch('/api/scenes/media-upload', {
            method: 'POST',
            body: formData,
          });

          let thumbnailUrl = "";
          if (uploadRes.ok) {
            const data = await uploadRes.json();
            thumbnailUrl = `/api/scenes/media?pathname=${encodeURIComponent(data.pathname)}`;
          } else {
            console.warn("Cloud upload failed, falling back to local blob URL");
            thumbnailUrl = URL.createObjectURL(blob);
          }

          // Save locally in IndexedDB using lib/db saveBlob
          const { saveBlob } = await import('@/lib/db');
          await saveBlob(`beat-thumb-${activeBeatClip.id}`, blob);

          // Update timeline context clip
          updateClip(activeBeatClip.id, { thumbnailUrl });

          toast.success("Successfully set current frame as beat thumbnail!", { id: "set-thumb" });
        } catch (err: any) {
          console.error("Failed to save beat thumbnail:", err);
          toast.error("Error saving thumbnail: " + err.message, { id: "set-thumb" });
        } finally {
          setIsCapturingThumbnail(false);
        }
      }, 'image/jpeg', 0.85);

    } catch (err: any) {
      console.error(err);
      toast.error(err.message || "Failed to capture thumbnail", { id: "set-thumb" });
      setIsCapturingThumbnail(false);
    }
  };

  const handleUpdateBeatThumbnail = async (
    idx: number,
    source: 'current' | 'center' | 'file',
    customFile?: File
  ) => {
    // Identify corresponding timeline note clip
    const noteClips = clips
      .filter((c) => c.type === "note" && (c.name === "Analysis" || c.tags?.includes("Analysis") || c.name.toLowerCase().includes("beat")))
      .sort((a, b) => a.startFrame - b.startFrame);
      
    const beatClip = noteClips[idx];
    if (!beatClip) {
      toast.error("No beat timeline clip found", { id: `set-thumb-${idx}` });
      return;
    }

    if (source === 'file') {
      if (!customFile) return;
      toast.loading("Uploading custom image...", { id: `set-thumb-${idx}` });
      try {
        const filename = `timeline-videos/beat-thumb-${beatClip.id}-${Date.now()}.jpg`;
        const formData = new FormData();
        formData.append('file', customFile);
        formData.append('filename', filename);

        const uploadRes = await fetch('/api/scenes/media-upload', {
          method: 'POST',
          body: formData,
        });

        let thumbnailUrl = "";
        if (uploadRes.ok) {
          const data = await uploadRes.json();
          thumbnailUrl = `/api/scenes/media?pathname=${encodeURIComponent(data.pathname)}`;
        } else {
          console.warn("Cloud upload failed, falling back to local blob URL");
          thumbnailUrl = URL.createObjectURL(customFile);
        }

        const { saveBlob } = await import('@/lib/db');
        await saveBlob(`beat-thumb-${beatClip.id}`, customFile);

        updateClip(beatClip.id, { thumbnailUrl });
        toast.success(`Updated Beat ${idx + 1} thumbnail with custom image!`, { id: `set-thumb-${idx}` });
      } catch (err: any) {
        console.error(err);
        toast.error("Failed to save custom thumbnail: " + err.message, { id: `set-thumb-${idx}` });
      }
      return;
    }

    if (source === 'current') {
      const video = videoRef.current;
      if (!video) {
        toast.error("Video player not available to capture frame", { id: `set-thumb-${idx}` });
        return;
      }

      toast.loading(`Capturing current frame for Beat ${idx + 1}...`, { id: `set-thumb-${idx}` });
      try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error("Could not get canvas context");

        const vWidth = video.videoWidth;
        const vHeight = video.videoHeight;
        const width = 640;
        const height = 360;
        canvas.width = width;
        canvas.height = height;

        const { top: topLetterbox, bottom: bottomLetterbox } = detectLetterbox(video);
        const activeHeight = bottomLetterbox - topLetterbox;

        const srcAspect = vWidth / activeHeight;
        const destAspect = width / height;

        let sx = 0;
        let sy = topLetterbox;
        let sWidth = vWidth;
        let sHeight = activeHeight;

        if (srcAspect > destAspect) {
          sWidth = activeHeight * destAspect;
          sx = (vWidth - sWidth) / 2;
        } else if (srcAspect < destAspect) {
          sHeight = vWidth / destAspect;
          sy = topLetterbox + (activeHeight - sHeight) / 2;
        }

        ctx.drawImage(video, sx, sy, sWidth, sHeight, 0, 0, width, height);

        canvas.toBlob(async (blob) => {
          if (!blob) {
            toast.error("Failed to convert frame to blob", { id: `set-thumb-${idx}` });
            return;
          }

          try {
            const filename = `timeline-videos/beat-thumb-${beatClip.id}-${Date.now()}.jpg`;
            const formData = new FormData();
            formData.append('file', blob);
            formData.append('filename', filename);

            const uploadRes = await fetch('/api/scenes/media-upload', {
              method: 'POST',
              body: formData,
            });

            let thumbnailUrl = "";
            if (uploadRes.ok) {
              const data = await uploadRes.json();
              thumbnailUrl = `/api/scenes/media?pathname=${encodeURIComponent(data.pathname)}`;
            } else {
              console.warn("Cloud upload failed, falling back to local blob URL");
              thumbnailUrl = URL.createObjectURL(blob);
            }

            const { saveBlob } = await import('@/lib/db');
            await saveBlob(`beat-thumb-${beatClip.id}`, blob);

            updateClip(beatClip.id, { thumbnailUrl });
            toast.success(`Updated Beat ${idx + 1} thumbnail to current frame!`, { id: `set-thumb-${idx}` });
          } catch (err: any) {
            console.error("Failed to save beat thumbnail:", err);
            toast.error("Error saving thumbnail: " + err.message, { id: `set-thumb-${idx}` });
          }
        }, 'image/jpeg', 0.85);

      } catch (err: any) {
        console.error(err);
        toast.error(err.message || "Failed to capture thumbnail", { id: `set-thumb-${idx}` });
      }
      return;
    }

    if (source === 'center') {
      if (!selectedVideoFile) {
        toast.error("No video file loaded to extract from", { id: `set-thumb-${idx}` });
        return;
      }

      const midFrame = beatClip.startFrame + Math.floor(beatClip.duration / 2);
      const timestamp = midFrame / fps;

      toast.loading(`Extracting beat center frame for Beat ${idx + 1}...`, { id: `set-thumb-${idx}` });
      try {
        const thumbnailBlob = await extractBeatThumbnailFromVideo(selectedVideoFile, timestamp);

        const filename = `timeline-videos/beat-thumb-${beatClip.id}-${Date.now()}.jpg`;
        const formData = new FormData();
        formData.append('file', thumbnailBlob);
        formData.append('filename', filename);

        const uploadRes = await fetch('/api/scenes/media-upload', {
          method: 'POST',
          body: formData,
        });

        let thumbnailUrl = "";
        if (uploadRes.ok) {
          const data = await uploadRes.json();
          thumbnailUrl = `/api/scenes/media?pathname=${encodeURIComponent(data.pathname)}`;
        } else {
          console.warn("Cloud upload failed, falling back to local blob URL");
          thumbnailUrl = URL.createObjectURL(thumbnailBlob);
        }

        const { saveBlob } = await import('@/lib/db');
        await saveBlob(`beat-thumb-${beatClip.id}`, thumbnailBlob);

        updateClip(beatClip.id, { thumbnailUrl });
        toast.success(`Updated Beat ${idx + 1} thumbnail to center frame!`, { id: `set-thumb-${idx}` });
      } catch (err: any) {
        console.error(err);
        toast.error("Failed to extract center thumbnail: " + err.message, { id: `set-thumb-${idx}` });
      }
      return;
    }
  };

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    // Only scrub the video player timeline if the movie is paused/stopped (user-initiated click/scroll)
    if (video.paused) {
      const beat = report?.scenes[activeSceneIndex];
      if (beat && typeof beat.start === 'number') {
        if (Math.abs(video.currentTime - beat.start) > 0.5) {
          video.currentTime = beat.start;
        }
      }
    }
  }, [activeSceneIndex, report]);

  const executeChatAction = (action: { type: string; payload?: any }) => {
    switch (action.type) {
      case "SELECT_BEAT": {
        const idx = action.payload?.index;
        if (report?.scenes && typeof idx === "number" && idx >= 0 && idx < report.scenes.length) {
          setActiveSceneIndex(idx);
          setScrollTrigger((prev) => prev + 1); // Scroll the beat list item into view!
          const start = report.scenes[idx].start ?? 0;
          setCurrentFrame(Math.round(start * fps)); // Move the global playhead & sync main preview video!
          if (videoRef.current) {
            videoRef.current.currentTime = start;
          }
        }
        break;
      }
      case "SELECT_HIGHEST_METRIC": {
        const metric = action.payload?.metric;
        if (report?.scenes && report.scenes.length > 0 && typeof metric === "string") {
          let maxVal = -1;
          let targetIdx = 0;
          report.scenes.forEach((scene, index) => {
            let val = 0;
            if (metric === "tension") val = scene.metrics.tension;
            else if (metric === "suspense") val = scene.metrics.suspense;
            else if (metric === "anticipation") val = scene.metrics.anticipation;
            
            if (val > maxVal) {
              maxVal = val;
              targetIdx = index;
            }
          });
          setActiveSceneIndex(targetIdx);
          setScrollTrigger((prev) => prev + 1); // Scroll the beat list item into view!
          const start = report.scenes[targetIdx].start ?? 0;
          setCurrentFrame(Math.round(start * fps)); // Move the global playhead & sync main preview video!
          if (videoRef.current && report.scenes[targetIdx]) {
            videoRef.current.currentTime = start;
          }
        }
        break;
      }
      case "SEEK_TIME": {
        const time = action.payload?.time;
        if (typeof time === "number" && !isNaN(time)) {
          setCurrentFrame(Math.round(time * fps)); // Move the global playhead & sync main preview video!
          if (videoRef.current) {
            videoRef.current.currentTime = time;
          }
        }
        break;
      }
      default:
        console.warn("Unknown chat action type:", action.type);
    }
  };

  // Chat Submission Handler
  const handleChatSubmit = async (customMessage?: string) => {
    const textToSend = customMessage || chatInput;
    if (!textToSend.trim()) return;

    const activeMessages = chatEngine === "doctor" ? doctorMessages : ollamaMessages;
    const updatedMessages = [...activeMessages, { role: "user" as const, content: textToSend }];

    if (chatEngine === "doctor") {
      setDoctorMessages(updatedMessages);
    } else {
      setOllamaMessages(updatedMessages);
    }

    setChatInput("");
    setIsChatLoading(true);

    try {
      const response = await fetch("http://127.0.0.1:8000/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: updatedMessages,
          report: report,
          script_text: clips.filter(c => c.type === 'dialog').map(c => `${c.character || 'Character'}: ${c.name}`).join("\n"),
          direct_ollama: chatEngine === "ollama",
          ollama_model: selectedOllamaModel,
        }),
      });

      if (!response.ok) throw new Error(`HTTP error ${response.status}`);
      const data = await response.json();
      
      if (chatEngine === "doctor") {
        setDoctorMessages((prev) => [...prev, { role: "assistant", content: data.reply }]);
        
        // Execute tool calling actions if returned by the backend
        if (data.actions && Array.isArray(data.actions)) {
          data.actions.forEach((act: any) => executeChatAction(act));
        }
      } else {
        setOllamaMessages((prev) => [...prev, { role: "assistant", content: data.reply }]);
      }
    } catch {
      // Fallback
      await new Promise((resolve) => setTimeout(resolve, 800));
      let fallbackReply = `Hello! I am responding in local offline mode since the FastAPI server at http://127.0.0.1:8000/api/chat is currently unreachable.\n\nYour message was: "${textToSend}"\n\nTo chat live, ensure your backend server is running on port 8000.`;
      
      if (chatEngine === "doctor") {
        if (textToSend.toLowerCase().includes("stakes")) {
          fallbackReply = "To raise the stakes in your scene:\n- **Introduce a ticking clock**: Give characters a strict frame deadline.\n- **Escalate conflict**: Let opposing characters make irreversible actions (like pulling a weapon or locking a door).\n- **Increase jeopardy**: Make sure the consequences of failure are severe and explicit.";
        } else if (textToSend.toLowerCase().includes("rewrite")) {
          fallbackReply = "Here is a professional Courier screenplay rewrite to build pacing:\n\n```text\nINT. DARK ROOM - CONTINUOUS\n\nMac watches the door handle. It turns. Slow. Creaking.\n\nMAC\n(whispering)\nDon't open it.\n```";
        }
        setDoctorMessages((prev) => [...prev, { role: "assistant", content: fallbackReply }]);
      } else {
        setOllamaMessages((prev) => [...prev, { role: "assistant", content: fallbackReply }]);
      }
    } finally {
      setIsChatLoading(false);
    }
  };

  const handleListScroll = () => {
    // Sync list scrolling
  };

  const renderAnalyzerUI = () => {
    return (
      <div className="space-y-4">
        {!selectedVideoFile ? (
          <div className="space-y-4">
            <div className="rounded-md border border-zinc-800 bg-zinc-950/40 p-4 text-center">
              <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-zinc-400 font-mono">Upload Recording</div>
              <p className="text-[10px] text-zinc-550 leading-relaxed font-sans">
                Upload a scene video to extract pacing, emotional valence, and narrative plot points. Results will be mapped directly to your visual timeline layers.
              </p>
            </div>
            
            <label className="flex flex-col items-center justify-center h-44 rounded-lg border-2 border-dashed border-zinc-800 bg-zinc-900/10 hover:bg-zinc-900/30 hover:border-indigo-500/50 cursor-pointer transition-all group overflow-hidden relative">
              <div className="w-10 h-10 rounded-full bg-zinc-900 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform border border-zinc-800">
                <UploadCloud className="w-5 h-5 text-indigo-400" />
              </div>
              <span className="text-[9px] font-black tracking-widest uppercase text-zinc-500 group-hover:text-zinc-350">Select Video File</span>
              <span className="text-[8px] text-zinc-600 mt-1 uppercase font-mono">MP4, WEBM up to 100MB</span>
              <input 
                type="file" 
                accept="video/*" 
                className="hidden" 
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    // Sanitizing filename: replaces characters not in a-zA-Z0-9._- with '-' to match disk storage naming
                    const sanitizedName = file.name.replace(/[^a-zA-Z0-9._-]/g, '-');
                    const sanitizedFile = new File([file], sanitizedName, { type: file.type });
                    setSelectedVideoFile(sanitizedFile);
                    const url = URL.createObjectURL(sanitizedFile);
                    setVideoObjectURL(url);
                    setIsAnalysisComplete(false);
                    
                    // Dynamically query duration
                    const tempVideo = document.createElement('video');
                    tempVideo.preload = 'metadata';
                    tempVideo.onloadedmetadata = () => {
                      setVideoDuration(tempVideo.duration);
                    };
                    tempVideo.src = url;
                  }
                }} 
              />
            </label>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-md border border-zinc-850 bg-zinc-950 p-2.5 flex flex-col gap-2.5">
              {!report && (
                <div className="relative aspect-video rounded overflow-hidden bg-black border border-zinc-900 shadow">
                  <video src={videoObjectURL} className="w-full h-full object-contain" controls preload="metadata" />
                </div>
              )}
              
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-[10px] font-bold text-zinc-300 truncate font-mono">{selectedVideoFile.name}</div>
                  <div className="text-[8px] font-mono text-zinc-600 mt-0.5 uppercase">
                    {(selectedVideoFile.size / (1024 * 1024)).toFixed(2)} MB
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-zinc-500 hover:text-red-400 hover:bg-red-400/10 shrink-0 border border-zinc-900"
                  disabled={isAnalyzing}
                  onClick={() => {
                    setSelectedVideoFile(null);
                    if (videoObjectURL) {
                      URL.revokeObjectURL(videoObjectURL);
                      setVideoObjectURL('');
                    }
                    setIsAnalysisComplete(false);
                  }}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>

            <div className="space-y-2.5">
              <h5 className="text-[9px] font-bold text-zinc-550 uppercase tracking-widest px-1 font-mono">AI Engine</h5>
              <div className="grid grid-cols-2 gap-1 rounded border border-zinc-900 bg-zinc-950/40 p-0.5">
                <button
                  type="button"
                  disabled={isAnalyzing}
                  onClick={() => setAnalysisModelChoice('gemini')}
                  className={cn(
                    "py-1.5 rounded text-[9px] font-bold uppercase tracking-wider transition-all cursor-pointer font-mono",
                    analysisModelChoice === 'gemini'
                      ? "bg-indigo-650 text-white shadow-md"
                      : "text-zinc-500 hover:text-zinc-350 hover:bg-zinc-900/40"
                  )}
                >
                  Gemini Cloud
                </button>
                <button
                  type="button"
                  disabled={isAnalyzing}
                  className={cn(
                    "py-1.5 rounded text-[9px] font-bold uppercase tracking-wider transition-all cursor-pointer font-mono",
                    analysisModelChoice === 'gemma'
                      ? "bg-indigo-650 text-white shadow-md"
                      : "text-zinc-500 hover:text-zinc-350 hover:bg-zinc-900/40"
                  )}
                  onClick={() => setAnalysisModelChoice('gemma')}
                >
                  Gemma Local
                </button>
              </div>
            </div>

            <div className="space-y-2.5">
              <h5 className="text-[9px] font-bold text-zinc-555 uppercase tracking-widest px-1 font-mono">Target Dimensions</h5>
              
              <div className="space-y-2 rounded border border-zinc-900 bg-zinc-950/40 p-2.5">
                {graphTracksInActiveScene.length > 0 && (
                  <div className="border-b border-zinc-900 pb-1.5 mb-1.5 space-y-1.5">
                    {graphTracksInActiveScene.map(track => (
                      <label key={track.id} className="flex items-center gap-2 cursor-pointer select-none group text-zinc-500 hover:text-zinc-300">
                        <input
                          type="checkbox"
                          checked={enabledGraphLayers[track.id] ?? false}
                          disabled={isAnalyzing}
                          onChange={(e) => {
                            setEnabledGraphLayers(prev => ({
                              ...prev,
                              [track.id]: e.target.checked
                            }));
                          }}
                          className="rounded border-zinc-800 bg-[#0a0a0b] text-indigo-600 focus:ring-0 focus:ring-offset-0 w-3 h-3 accent-indigo-600 cursor-pointer"
                        />
                        <span className="text-[9.5px] font-semibold truncate font-sans">
                          Plot "{track.graph?.label || track.name}"
                        </span>
                      </label>
                    ))}
                  </div>
                )}

                <label className="flex items-center gap-2 cursor-pointer select-none group text-zinc-500 hover:text-zinc-300">
                  <input
                    type="checkbox"
                    checked={storyAnalyzePlotPoints}
                    disabled={isAnalyzing}
                    onChange={(e) => setStoryAnalyzePlotPoints(e.target.checked)}
                    className="rounded border-zinc-800 bg-[#0a0a0b] text-indigo-600 focus:ring-0 focus:ring-offset-0 w-3 h-3 accent-indigo-600 cursor-pointer"
                  />
                  <span className="text-[9.5px] font-semibold font-sans">
                    Detect Dramatic Plot Points
                  </span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer select-none group text-zinc-500 hover:text-zinc-300">
                  <input
                    type="checkbox"
                    checked={storyAnalyzeStakes}
                    disabled={isAnalyzing}
                    onChange={(e) => setStoryAnalyzeStakes(e.target.checked)}
                    className="rounded border-zinc-800 bg-[#0a0a0b] text-indigo-600 focus:ring-0 focus:ring-offset-0 w-3 h-3 accent-indigo-600 cursor-pointer"
                  />
                  <span className="text-[9.5px] font-semibold font-sans">
                    Track Stakes & Suspense Values
                  </span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer select-none group text-zinc-500 hover:text-zinc-300">
                  <input
                    type="checkbox"
                    checked={storyAnalyzeConfrontation}
                    disabled={isAnalyzing}
                    onChange={(e) => setStoryAnalyzeConfrontation(e.target.checked)}
                    className="rounded border-zinc-800 bg-[#0a0a0b] text-indigo-600 focus:ring-0 focus:ring-offset-0 w-3 h-3 accent-indigo-600 cursor-pointer"
                  />
                  <span className="text-[9.5px] font-semibold font-sans">
                    Identify Confrontation Peaks
                  </span>
                </label>
              </div>
            </div>

            {!isAnalysisComplete && !isAnalyzing && (
              <Button
                onClick={runVideoAnalysis}
                disabled={isReadOnly}
                className="w-full bg-gradient-to-r from-indigo-650 to-violet-650 hover:from-indigo-600 hover:to-violet-600 text-white text-[10px] font-black uppercase tracking-widest h-9 shadow-lg shadow-indigo-950/20 transition-all border border-indigo-500/20 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Sparkles className="w-3.5 h-3.5 mr-2 animate-pulse text-indigo-300" />
                {isReadOnly ? 'Read-Only (Viewer)' : 'Analyze Recording'}
              </Button>
            )}

            {isAnalyzing && (
              <div className="space-y-2 bg-zinc-950 p-2.5 rounded border border-zinc-900">
                <div className="flex items-center justify-between text-[9px] font-mono font-bold text-indigo-400 uppercase tracking-widest">
                  <span className="flex items-center gap-1.5">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    Executing Agent Pipeline
                  </span>
                  <span>{analysisProgress}%</span>
                </div>
                
                <div className="w-full h-1 bg-zinc-900 rounded-full overflow-hidden border border-zinc-850">
                  <div 
                    className="h-full bg-gradient-to-r from-indigo-500 to-violet-500 rounded-full transition-all duration-300"
                    style={{ width: `${analysisProgress}%` }}
                  />
                </div>
              </div>
            )}

            {(isAnalyzing || analysisLogs.length > 0) && (
              <div className="space-y-1.5">
                <div className="text-[9px] font-bold text-zinc-600 uppercase tracking-wider px-1 font-mono">
                  Console Pipeline Logs
                </div>
                <div className="bg-black border border-zinc-900 rounded p-2.5 h-32 overflow-y-auto font-mono text-[9px] text-zinc-500 leading-relaxed scrollbar-thin scrollbar-thumb-zinc-800">
                  {analysisLogs.map((log, idx) => (
                    <div key={idx} className="truncate select-text">{log}</div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderDashboardItem = (item: string, col: 'left' | 'right') => {
    if (!report) return null;
    switch (item) {
      case 'preview':
        return (
          activeSceneVideoSrc && (
            <div 
              key="preview"
              draggable={isDraggable === 'preview'}
              onDragStart={(e) => handleDragStart(e, 'preview', col)}
              onDragOver={(e) => handleDragOverCard(e, 'preview', col)}
              onDragEnd={handleDragEnd}
              className={cn(
                "bg-zinc-950 border border-zinc-800 rounded-2xl p-4 shadow-xl select-none transition-all duration-300",
                draggedItem === 'preview' ? "opacity-35 border-indigo-500/35" : ""
              )}
            >
              <div className="flex justify-between items-center mb-3">
                <div className="flex items-center gap-2">
                  {!isReadOnly && (
                    <div
                      onMouseDown={() => setIsDraggable('preview')}
                      onMouseUp={() => setIsDraggable(null)}
                      className="cursor-grab active:cursor-grabbing p-1 text-zinc-500 hover:text-zinc-300 rounded hover:bg-zinc-900 transition-colors select-none"
                      title="Drag to reorder"
                    >
                      <GripVertical size={13} />
                    </div>
                  )}
                  <span className="text-[10px] font-mono text-zinc-400 uppercase tracking-wider font-bold">Scene Preview</span>
                </div>
                <div className="flex items-center gap-1.5">
                  {/* 3 dots menu button */}
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setIsMenuOpen(!isMenuOpen)}
                      disabled={isCapturingThumbnail}
                      className="p-1.5 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60 rounded transition-colors cursor-pointer flex items-center justify-center disabled:opacity-50"
                      title="More options"
                    >
                      <MoreVertical size={14} />
                    </button>
                    
                    {isMenuOpen && (
                      <>
                        <div 
                          className="fixed inset-0 z-30 cursor-default" 
                          onClick={() => setIsMenuOpen(false)} 
                        />
                        <div className="absolute right-0 mt-1 w-44 bg-zinc-950 border border-zinc-800 rounded-lg shadow-xl py-1 z-40 select-none">
                          {!isReadOnly && (
                            <button
                              type="button"
                              onClick={handleSetThumbnail}
                              className="w-full text-left px-3 py-2 text-[10px] font-mono text-zinc-300 hover:text-zinc-100 hover:bg-zinc-900/80 transition-colors flex items-center gap-2 cursor-pointer font-bold uppercase tracking-wider"
                            >
                              <span>📸</span>
                              <span>Set Beat Thumbnail</span>
                            </button>
                          )}
                          <div className="border-t border-zinc-900 my-1" />
                          <button
                            type="button"
                            onClick={() => {
                              setPreviewMode('video');
                              setIsMenuOpen(false);
                            }}
                            className="w-full text-left px-3 py-2 text-[10px] font-mono text-zinc-300 hover:text-zinc-100 hover:bg-zinc-900/80 transition-colors flex items-center gap-2 cursor-pointer font-bold uppercase tracking-wider"
                          >
                            <FileVideo size={12} className="text-zinc-500" />
                            <span>Video</span>
                            {previewMode === 'video' && <Check size={12} className="ml-auto text-indigo-400" />}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setPreviewMode('storyboard');
                              setIsMenuOpen(false);
                            }}
                            className="w-full text-left px-3 py-2 text-[10px] font-mono text-zinc-300 hover:text-zinc-100 hover:bg-zinc-900/80 transition-colors flex items-center gap-2 cursor-pointer font-bold uppercase tracking-wider"
                          >
                            <Camera size={12} className="text-zinc-500" />
                            <span>Storyboard</span>
                            {previewMode === 'storyboard' && <Check size={12} className="ml-auto text-indigo-400" />}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setShowDialogueOverlay(prev => !prev);
                              setIsMenuOpen(false);
                            }}
                            className="w-full text-left px-3 py-2 text-[10px] font-mono text-zinc-300 hover:text-zinc-100 hover:bg-zinc-900/80 transition-colors flex items-center gap-2 cursor-pointer font-bold uppercase tracking-wider"
                          >
                            <MessageSquare size={12} className={showDialogueOverlay ? "text-indigo-400" : "text-zinc-500"} />
                            <span>{showDialogueOverlay ? "Hide Dialogue" : "Show Dialogue"}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setIsMenuOpen(false);
                              setIsJsonViewOpen(true);
                            }}
                            className="w-full text-left px-3 py-2 text-[10px] font-mono text-zinc-300 hover:text-zinc-100 hover:bg-zinc-900/80 transition-colors flex items-center gap-2 cursor-pointer font-bold uppercase tracking-wider border-t border-zinc-900"
                          >
                            <span>🔍</span>
                            <span>View Raw JSON</span>
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>

              <div className="relative aspect-video rounded overflow-hidden bg-black border border-zinc-900 shadow">
                {previewMode === 'video' ? (
                  <video 
                    ref={videoRef}
                    onTimeUpdate={handleVideoTimeUpdate}
                    onLoadedData={() => setVideoLoadError(null)}
                    onError={() => setVideoLoadError('Saved media file not found. Re-upload or re-save this scene with the original video available.')}
                    src={activeSceneVideoSrc} 
                    className="w-full h-full object-contain" 
                    controls 
                    preload="metadata" 
                  />
                ) : (
                  <div className="w-full h-full relative bg-zinc-950 flex flex-col items-center justify-center">
                    {activeBeat?.thumbnailUrl ? (
                      <img 
                        src={activeBeat.thumbnailUrl} 
                        className="w-full h-full object-contain"
                        alt={`Storyboard beat ${activeBeat.scene_number}`}
                      />
                    ) : (
                      <div className="flex flex-col items-center gap-2 text-zinc-500 p-4 text-center">
                        <span className="text-[20px]">🖼️</span>
                        <span className="text-[10px] font-mono font-semibold uppercase tracking-wider">No Beat Thumbnail</span>
                        <span className="text-[10px] text-zinc-650 max-w-[200px] leading-normal font-medium">
                          Run AI Video Analysis to automatically capture a storyboard thumbnail for each beat.
                        </span>
                      </div>
                    )}
                  </div>
                )}
                {previewMode === 'video' && videoLoadError && (
                  <div className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-2 bg-black/85 p-5 text-center">
                    <FileVideo size={20} className="text-zinc-500" />
                    <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-200">
                      Video Unavailable
                    </span>
                    <span className="max-w-[260px] text-[10px] font-medium leading-normal text-zinc-500">
                      {videoLoadError}
                    </span>
                  </div>
                )}

                {/* Beat Label & Star Overlay */}
                {activeBeat && (() => {
                  const isStarred = highlightedBeatNumbers.has(`${activeBeat.scene_number}-summary`);
                  return (
                    <div className="absolute top-2 left-2 z-30 flex items-center gap-2.5 bg-black/70 backdrop-blur-md border border-zinc-800/80 px-3 py-1.5 rounded-lg select-none">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          toggleHighlightBeat(activeBeat.scene_number, "summary");
                        }}
                        className="focus:outline-none transition-transform duration-200 hover:scale-110 active:scale-95 cursor-pointer flex items-center justify-center p-0.5 rounded hover:bg-zinc-900/50"
                        title={isStarred ? "Remove Star" : "Star Beat"}
                      >
                        <Star 
                          className={cn(
                            "w-4 h-4 transition-all duration-200", 
                            isStarred 
                              ? "fill-amber-400 text-amber-400 drop-shadow-[0_0_4px_rgba(251,191,36,0.5)]" 
                              : "text-zinc-500 hover:text-zinc-350 fill-transparent"
                          )} 
                        />
                      </button>
                      <div className="flex flex-col border-l border-zinc-800/80 pl-2">
                        <span className="text-[9px] font-mono font-bold text-indigo-400 uppercase tracking-widest leading-none">
                          Beat {activeBeat.scene_number}
                        </span>
                        <span className="text-[11px] font-extrabold text-white tracking-tight leading-tight mt-0.5 max-w-[150px] sm:max-w-[200px] truncate" title={activeBeat.title}>
                          {activeBeat.title || `Scene Beat`}
                        </span>
                      </div>
                    </div>
                  );
                })()}

                {/* Graph Bars Overlay */}
                {activeBeat && (() => {
                  const isTensionStarred = highlightedBeatNumbers.has(`${activeBeat.scene_number}-tension`);
                  const isSuspenseStarred = highlightedBeatNumbers.has(`${activeBeat.scene_number}-suspense`);
                  const isStakesStarred = highlightedBeatNumbers.has(`${activeBeat.scene_number}-stakes`);
                  return (
                    <div className="absolute top-1 right-1 z-30 flex items-end gap-2.5 bg-black/75 backdrop-blur-md border border-zinc-800/80 p-2 rounded-lg select-none">
                      {/* Tension Bar */}
                      <div className="flex flex-col items-center gap-1">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            toggleHighlightBeat(activeBeat.scene_number, "tension");
                          }}
                          className="focus:outline-none hover:scale-110 active:scale-95 cursor-pointer flex items-center justify-center p-0.5 rounded hover:bg-zinc-900/50"
                          title={isTensionStarred ? "Starred Tension" : "Star Tension"}
                        >
                          <Star 
                            className={cn(
                              "w-2.5 h-2.5 transition-all duration-200", 
                              isTensionStarred 
                                ? "fill-amber-400 text-amber-400 drop-shadow-[0_0_2px_rgba(251,191,36,0.5)]" 
                                : "text-zinc-650 hover:text-zinc-400 fill-transparent"
                            )} 
                          />
                        </button>
                        <div className="w-2.5 h-[35px] bg-zinc-900/40 border border-zinc-800/40 rounded-sm flex items-end relative" title={`Dramatic Tension: ${activeBeat.metrics.tension}/5`}>
                          <div 
                            className="w-full rounded-b-sm transition-all duration-500 ease-out"
                            style={{
                              height: `${(activeBeat.metrics.tension / 5) * 100}%`,
                              backgroundColor: chartColors.tension || "#f43f5e"
                            }}
                          />
                        </div>
                        <MetricSymbol 
                          name="tension" 
                          className="w-3 h-3 mt-0.5 shrink-0" 
                          style={{ color: chartColors.tension || "#f43f5e" }} 
                        />
                      </div>

                      {/* Suspense Bar */}
                      <div className="flex flex-col items-center gap-1">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            toggleHighlightBeat(activeBeat.scene_number, "suspense");
                          }}
                          className="focus:outline-none hover:scale-110 active:scale-95 cursor-pointer flex items-center justify-center p-0.5 rounded hover:bg-zinc-900/50"
                          title={isSuspenseStarred ? "Starred Suspense" : "Star Suspense"}
                        >
                          <Star 
                            className={cn(
                              "w-2.5 h-2.5 transition-all duration-200", 
                              isSuspenseStarred 
                                ? "fill-amber-400 text-amber-400 drop-shadow-[0_0_2px_rgba(251,191,36,0.5)]" 
                                : "text-zinc-650 hover:text-zinc-400 fill-transparent"
                            )} 
                          />
                        </button>
                        <div className="w-2.5 h-[35px] bg-zinc-900/40 border border-zinc-800/40 rounded-sm flex items-end relative" title={`Anticipatory Suspense: ${activeBeat.metrics.suspense}/5`}>
                          <div 
                            className="w-full rounded-b-sm transition-all duration-500 ease-out"
                            style={{
                              height: `${(activeBeat.metrics.suspense / 5) * 100}%`,
                              backgroundColor: chartColors.suspense || "#a855f7"
                            }}
                          />
                        </div>
                        <MetricSymbol 
                          name="suspense" 
                          className="w-3 h-3 mt-0.5 shrink-0" 
                          style={{ color: chartColors.suspense || "#a855f7" }} 
                        />
                      </div>

                      {/* Anticipation Bar */}
                      <div className="flex flex-col items-center gap-1">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            toggleHighlightBeat(activeBeat.scene_number, "stakes");
                          }}
                          className="focus:outline-none hover:scale-110 active:scale-95 cursor-pointer flex items-center justify-center p-0.5 rounded hover:bg-zinc-900/50"
                          title={isStakesStarred ? "Starred Stakes" : "Star Stakes"}
                        >
                          <Star 
                            className={cn(
                              "w-2.5 h-2.5 transition-all duration-200", 
                              isStakesStarred 
                                ? "fill-amber-400 text-amber-400 drop-shadow-[0_0_2px_rgba(251,191,36,0.5)]" 
                                : "text-zinc-650 hover:text-zinc-400 fill-transparent"
                            )} 
                          />
                        </button>
                        <div className="w-2.5 h-[35px] bg-zinc-900/40 border border-zinc-800/40 rounded-sm flex items-end relative" title={`Operational Stakes/Anticipation: ${activeBeat.metrics.anticipation}/5`}>
                          <div 
                            className="w-full rounded-b-sm transition-all duration-500 ease-out"
                            style={{
                              height: `${(activeBeat.metrics.anticipation / 5) * 100}%`,
                              backgroundColor: chartColors.anticipation || "#06b6d4"
                            }}
                          />
                        </div>
                        <MetricSymbol 
                          name="anticipation" 
                          className="w-3 h-3 mt-0.5 shrink-0" 
                          style={{ color: chartColors.anticipation || "#06b6d4" }} 
                        />
                      </div>
                    </div>
                  );
                })()}
              </div>

              <div className="mt-4 flex items-center justify-between text-[10px] font-mono text-zinc-400 px-1 font-semibold border-t border-zinc-900 pt-3">
                <span className="truncate max-w-[200px]">{selectedVideoFile?.name || activeScene?.name || "scene-video.mp4"}</span>
                <span className="text-[8px] text-zinc-550 uppercase tracking-wider font-bold">Active Recording</span>
              </div>
            </div>
          )
        );
      case 'analysis':
        return (
          activeSceneVideoSrc && activeBeat && (
            <div 
              key="analysis"
              draggable={isDraggable === 'analysis'}
              onDragStart={(e) => handleDragStart(e, 'analysis', col)}
              onDragOver={(e) => handleDragOverCard(e, 'analysis', col)}
              onDragEnd={handleDragEnd}
              className={cn(
                "transition-all duration-300",
                draggedItem === 'analysis' ? "opacity-35" : ""
              )}
            >
              {renderActiveBeatAnalysis()}
            </div>
          )
        );
      case 'beatsList':
        return (
          <React.Fragment key={item}>
            <div 
              draggable={isDraggable === 'beatsList'}
              onDragStart={(e) => handleDragStart(e, 'beatsList', col)}
              onDragOver={(e) => handleDragOverCard(e, 'beatsList', col)}
              onDragEnd={handleDragEnd}
              className={cn(
                "bg-zinc-950 border border-zinc-800 rounded-2xl p-5 shadow-xl flex flex-col gap-4 select-none relative transition-all duration-300",
                draggedItem === 'beatsList' ? "opacity-35 border-indigo-500/35" : ""
              )}
            >
              <div className="flex items-center justify-between pb-3.5 border-b border-zinc-900 mb-1">
                <div className="flex items-center gap-2">
                  {!isReadOnly && (
                    <div
                      onMouseDown={() => setIsDraggable('beatsList')}
                      onMouseUp={() => setIsDraggable(null)}
                      className="cursor-grab active:cursor-grabbing p-1 text-zinc-500 hover:text-zinc-300 rounded hover:bg-zinc-900 transition-colors select-none"
                      title="Drag to reorder"
                    >
                      <GripVertical size={13} />
                    </div>
                  )}
                  <span className="text-[10px] font-mono font-bold tracking-widest text-zinc-400 uppercase">
                    Script Beats & Timeline Arcs
                  </span>
                </div>

                {/* Beat Navigation Arrows */}
                <div className="flex items-center bg-zinc-900 border border-zinc-800 rounded px-1.5 py-0.5 select-none gap-1">
                  <button
                    type="button"
                    onClick={() => handleSelectScene(activeSceneIndex - 1)}
                    disabled={activeSceneIndex === 0}
                    className="p-0.5 hover:bg-zinc-850 text-zinc-400 hover:text-zinc-200 disabled:opacity-30 disabled:hover:bg-transparent disabled:text-zinc-650 rounded transition-colors cursor-pointer flex items-center justify-center border-0 outline-none"
                    title="Previous Beat"
                  >
                    <ChevronLeft size={11} />
                  </button>
                  <span className="text-[9px] font-mono text-zinc-500 font-bold px-1 select-none">
                    {activeSceneIndex + 1}/{report?.scenes?.length || 0}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleSelectScene(activeSceneIndex + 1)}
                    disabled={!report?.scenes || activeSceneIndex >= report.scenes.length - 1}
                    className="p-0.5 hover:bg-zinc-850 text-zinc-400 hover:text-zinc-200 disabled:opacity-30 disabled:hover:bg-transparent disabled:text-zinc-650 rounded transition-colors cursor-pointer flex items-center justify-center border-0 outline-none"
                    title="Next Beat"
                  >
                    <ChevronRight size={11} />
                  </button>
                </div>
              </div>
              
              <ScriptBeatsList
                report={report}
                activeSceneIndex={activeSceneIndex}
                setActiveSceneIndex={handleSelectScene}
                beatListRef={beatListRef}
                handleListScroll={handleListScroll}
                height={beatsListHeight}
                scrollTrigger={scrollTrigger}
                activeTab={activeTab}
                setActiveTab={setActiveTab}
                onUpdateBeatThumbnail={handleUpdateBeatThumbnail}
                selectedVideoFile={selectedVideoFile}
                highlightedBeatNumbers={highlightedBeatNumbers}
                toggleHighlightBeat={toggleHighlightBeat}
                isReadOnly={isReadOnly}
              />
            </div>

            <div
              onPointerDown={handlePointerDown}
              draggable={false}
              onDragStart={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              className="w-full py-1 flex items-center justify-center cursor-ns-resize group select-none relative z-20 -my-4 animate-fade-in"
            >
              <div className="w-full h-[1px] bg-zinc-850 group-hover:bg-indigo-500/50 group-active:bg-indigo-505 transition-colors" />
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 p-1 bg-zinc-950 border border-zinc-850/80 rounded-md flex items-center justify-center opacity-60 group-hover:opacity-100 transition-all shadow-md">
                <GripHorizontal size={10} className="text-zinc-500 group-hover:text-zinc-350" />
              </div>
            </div>
          </React.Fragment>
        );
      case 'chart':
        return (
          <div 
            key="chart"
            draggable={isDraggable === 'chart'}
            onDragStart={(e) => handleDragStart(e, 'chart', col)}
            onDragOver={(e) => handleDragOverCard(e, 'chart', col)}
            onDragEnd={handleDragEnd}
            className={cn(
              "bg-zinc-950 border border-zinc-800 rounded-2xl p-5 shadow-xl flex flex-col gap-4 select-none relative transition-all duration-300",
              draggedItem === 'chart' ? "opacity-35 border-indigo-500/35" : ""
            )}
          >
            <div className="flex items-center justify-between pb-3.5 border-b border-zinc-900 mb-1">
              <div className="flex items-center gap-2">
                {!isReadOnly && (
                  <div
                    onMouseDown={() => setIsDraggable('chart')}
                    onMouseUp={() => setIsDraggable(null)}
                    className="cursor-grab active:cursor-grabbing p-1 text-zinc-500 hover:text-zinc-300 rounded hover:bg-zinc-900 transition-colors select-none"
                    title="Drag to reorder"
                  >
                    <GripVertical size={13} />
                  </div>
                )}
                <span className="text-[10px] font-mono font-bold tracking-widest text-zinc-400 uppercase">
                  Narrative Arcs Visualization
                </span>
              </div>
            </div>

            <TensionChart
              data={chartData}
              activeIndex={activeSceneIndex}
              onSelectScene={handleSelectScene}
              colors={chartColors}
              activeTab={activeTab}
              onUpdateValue={handleUpdateMetricValue}
            />
          </div>
        );
      case 'dialogue':
        return (
          showDialogueOverlay && activeBeat && (
            <div 
              key="dialogue"
              draggable={isDraggable === 'dialogue'}
              onDragStart={(e) => handleDragStart(e, 'dialogue', col)}
              onDragOver={(e) => handleDragOverCard(e, 'dialogue', col)}
              onDragEnd={handleDragEnd}
              className={cn(
                "bg-zinc-950 border border-zinc-800 rounded-2xl p-5 shadow-xl flex flex-col gap-4 select-none relative transition-all duration-300",
                draggedItem === 'dialogue' ? "opacity-35 border-indigo-500/35" : ""
              )}
            >
              <div className="flex items-center justify-between pb-3.5 border-b border-zinc-900 mb-1 flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  {!isReadOnly && (
                    <div
                      onMouseDown={() => setIsDraggable('dialogue')}
                      onMouseUp={() => setIsDraggable(null)}
                      className="cursor-grab active:cursor-grabbing p-1 text-zinc-555 hover:text-zinc-350 rounded hover:bg-zinc-900 transition-colors select-none"
                      title="Drag to reorder"
                    >
                      <GripVertical size={13} />
                    </div>
                  )}
                  <span className="text-[10px] font-mono font-bold tracking-widest text-zinc-400 uppercase">
                    Dialogue Transcript
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[9px] font-mono text-zinc-500 uppercase tracking-wider font-semibold">
                    {activeBeatDialogClips.length} {activeBeatDialogClips.length === 1 ? 'Line' : 'Lines'}
                  </span>
                  <Button
                    type="button"
                    size="xs"
                    variant="outline"
                    disabled={(!onOpenScriptEditor && !setWorkspaceViewMode) || !activeScene?.id}
                    onClick={() => {
                      const dialogClip = activeBeatDialogClips[0];
                      if (dialogClip && activeScene?.id) {
                        onOpenScriptEditor?.(dialogClip.id, activeScene.id);
                      } else {
                        setWorkspaceViewMode?.('editor');
                      }
                    }}
                    className="border-indigo-500/30 bg-indigo-500/10 text-[9px] font-mono font-bold uppercase tracking-widest text-indigo-200 hover:bg-indigo-500/20 hover:text-indigo-100"
                  >
                    <ScrollText size={11} className="text-indigo-300 mr-1 shrink-0" />
                    Dialog Editor
                  </Button>
                </div>
              </div>

              {activeBeatDialogClips.length > 0 ? (
                <div 
                  style={{ height: `${dialogueHeight}px` }}
                  className="overflow-y-auto space-y-3 pr-1 scrollbar-thin scrollbar-thumb-zinc-800 select-text"
                >
                  {activeBeatDialogClips.map((clip) => {
                    const char = characters.find(
                      (ch) =>
                        ch.id === clip.characterId ||
                        ch.name.toLowerCase() === clip.character?.toLowerCase()
                    );
                    const charName = char?.name || clip.character || "Hero";
                    const charImage = char?.image;
                    const dialogLine = (clip.name || "").trim();
                    const dialogDescription = (clip.description || "").trim();
                    const hasDistinctDescription = Boolean(
                      dialogDescription &&
                      dialogDescription.toLowerCase() !== dialogLine.toLowerCase()
                    );

                    return (
                      <div 
                        key={clip.id}
                        className="flex items-start gap-4 bg-zinc-900/30 border border-zinc-900/60 rounded-xl p-3.5 transition-colors hover:border-zinc-850 hover:bg-zinc-900/45 animate-fade-in"
                      >
                        {/* Character Headshot */}
                        <div className="w-14 h-14 rounded-full bg-zinc-950 border border-zinc-800 overflow-hidden flex items-center justify-center shrink-0 shadow-inner">
                          {charImage ? (
                            <img src={charImage} alt={charName} className="w-full h-full object-cover" />
                          ) : (
                            <User className="w-7 h-7 text-zinc-500" />
                          )}
                        </div>

                        {/* Speech Bubble */}
                        <div className="flex-1 min-w-0">
                          <div className="text-[11px] font-mono font-bold text-indigo-350 uppercase tracking-wider">
                            {charName}
                          </div>
                          <p className="text-sm text-zinc-100 mt-1 leading-relaxed select-text font-sans">
                            {dialogLine || dialogDescription}
                          </p>
                          {hasDistinctDescription && (
                            <p className="mt-2 border-l border-indigo-500/30 pl-2.5 text-[11px] leading-relaxed text-zinc-400 font-sans select-text">
                              {dialogDescription}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-[10px] text-zinc-555 italic px-1 py-1 font-mono">
                  No dialogue in this beat.
                </div>
              )}

              {/* Horizontal Resize Divider */}
              <div
                onPointerDown={handleDialogueResizePointerDown}
                draggable={false}
                onDragStart={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                className="w-full py-2 flex items-center justify-center cursor-ns-resize group select-none relative z-20"
              >
                <div className="w-full h-[1px] bg-zinc-850 group-hover:bg-indigo-500/50 group-active:bg-indigo-500 transition-colors" />
                <div className="absolute px-2.5 py-0.5 bg-zinc-950 border border-zinc-850 rounded-full flex items-center justify-center space-x-1 opacity-70 group-hover:opacity-100 transition-all shadow-md">
                  <span className="w-1 h-1 rounded-full bg-zinc-650" />
                  <span className="w-1 h-1 rounded-full bg-zinc-650" />
                  <span className="w-1 h-1 rounded-full bg-zinc-650" />
                </div>
              </div>
            </div>
          )
        );
      default:
        return null;
    }
  };

  const renderActiveBeatAnalysis = () => {
    if (!activeBeat) return null;

    const plotPoint = activeBeat.narrative_elements?.plot_point;
    const summaryText = activeBeat.summary || activeBeat.text_segment || "";
    const speakers = activeBeat.characters || [];
    const startTime = activeBeat.start ?? 0;
    const endTime = activeBeat.end ?? 0;

    return (
      <div className="bg-zinc-950 border border-zinc-800 rounded-2xl p-5 shadow-xl flex flex-col gap-6 select-none animate-fade-in">
        {/* Header Title & Plot Point badge */}
        <div className="flex flex-col gap-2 pb-4 border-b border-zinc-900">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              {/* Drag Handle */}
              {!isReadOnly && (
                <div
                  onMouseDown={() => setIsDraggable('analysis')}
                  onMouseUp={() => setIsDraggable(null)}
                  className="cursor-grab active:cursor-grabbing p-1 text-zinc-500 hover:text-zinc-300 rounded hover:bg-zinc-900 transition-colors select-none"
                  title="Drag to reorder"
                >
                  <GripVertical size={13} />
                </div>
              )}
              <span className="text-[11px] font-mono font-bold tracking-widest text-indigo-400 uppercase">
                Beat {activeBeat.scene_number} Inspector
              </span>

              {/* Beat Navigation Arrows */}
              <div className="flex items-center bg-zinc-900 border border-zinc-800 rounded px-1.5 py-0.5 select-none gap-1">
                <button
                  type="button"
                  onClick={() => handleSelectScene(activeSceneIndex - 1)}
                  disabled={activeSceneIndex === 0}
                  className="p-0.5 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 disabled:opacity-30 disabled:hover:bg-transparent disabled:text-zinc-650 rounded transition-colors cursor-pointer flex items-center justify-center"
                  title="Previous Beat"
                >
                  <ChevronLeft size={11} />
                </button>
                <span className="text-[9px] font-mono text-zinc-500 font-bold px-1 select-none">
                  {activeSceneIndex + 1}/{report?.scenes?.length || 0}
                </span>
                <button
                  type="button"
                  onClick={() => handleSelectScene(activeSceneIndex + 1)}
                  disabled={!report?.scenes || activeSceneIndex >= report.scenes.length - 1}
                  className="p-0.5 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 disabled:opacity-30 disabled:hover:bg-transparent disabled:text-zinc-650 rounded transition-colors cursor-pointer flex items-center justify-center"
                  title="Next Beat"
                >
                  <ChevronRight size={11} />
                </button>
              </div>
            </div>
            {plotPoint && (
              <span className="px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest bg-indigo-500/15 text-indigo-300 border border-indigo-500/25 shadow-[0_0_8px_rgba(99,102,241,0.15)]">
                {plotPoint}
              </span>
            )}
          </div>
          <h3 className="text-base font-extrabold text-white tracking-tight mt-1 select-text">
            {activeBeat.title || `Beat ${activeBeat.scene_number}`}
          </h3>
          <div className="flex flex-wrap items-center gap-3 text-[10px] font-mono text-zinc-400 mt-1 uppercase">
            <span className="bg-zinc-900 border border-zinc-800 px-2 py-0.5 rounded">
              Time: {startTime.toFixed(1)}s - {endTime.toFixed(1)}s
            </span>
            {speakers.length > 0 && (
              <span className="bg-zinc-900 border border-zinc-800 px-2 py-0.5 rounded">
                Speakers: {speakers.join(', ')}
              </span>
            )}
          </div>
        </div>

        {/* Narrative Summary Description */}
        {summaryText && (
          <div className="bg-zinc-900/30 border border-zinc-800 rounded-xl p-4">
            <h4 className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest font-mono mb-2 flex items-center gap-2">
              <ScrollText size={12} className="text-indigo-400" />
              Narrative Summary
            </h4>
            <p className="text-xs text-zinc-200 leading-relaxed font-sans select-text">
              {summaryText}
            </p>
          </div>
        )}

        {/* Analytics & Metrics Stack */}
        <div className="space-y-3">
          <h4 className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest font-mono px-1">
            Metrics & Reasoning
          </h4>

          {/* Tension Metric */}
          <div className="bg-zinc-900/20 border border-zinc-800 rounded-xl p-3 flex flex-col gap-2 transition-all">
            <div className="flex items-center justify-between gap-2 border-b border-zinc-900/60 pb-1.5">
              <span className="text-[10.5px] font-bold text-zinc-300 uppercase tracking-wider font-mono flex items-center gap-1.5">
                <MetricSymbol name="tension" className="w-2.5 h-2.5 shrink-0" style={{ color: chartColors.tension || "#f43f5e" }} />
                Dramatic Tension
              </span>
              <span className="text-xs font-black bg-rose-500/10 text-rose-455 border border-rose-500/20 px-2 py-0.5 rounded font-mono">
                {activeBeat.metrics?.tension}/5
              </span>
            </div>
            <p className="text-xs text-zinc-300 leading-relaxed select-text">
              {activeBeat.metrics?.tension_reasoning || "No tension details available."}
            </p>
          </div>

          {/* Suspense Metric */}
          <div className="bg-zinc-900/20 border border-zinc-800 rounded-xl p-3 flex flex-col gap-2 transition-all">
            <div className="flex items-center justify-between gap-2 border-b border-zinc-900/60 pb-1.5">
              <span className="text-[10.5px] font-bold text-zinc-300 uppercase tracking-wider font-mono flex items-center gap-1.5">
                <MetricSymbol name="suspense" className="w-2.5 h-2.5 shrink-0" style={{ color: chartColors.suspense || "#a855f7" }} />
                Anticipatory Suspense
              </span>
              <span className="text-xs font-black bg-purple-500/10 text-purple-400 border border-purple-500/20 px-2 py-0.5 rounded font-mono">
                {activeBeat.metrics?.suspense}/5
              </span>
            </div>
            <p className="text-xs text-zinc-300 leading-relaxed select-text">
              {activeBeat.metrics?.suspense_reasoning || "No suspense details available."}
            </p>
          </div>

          {/* Stakes / Anticipation Metric */}
          <div className="bg-zinc-900/20 border border-zinc-800 rounded-xl p-3 flex flex-col gap-2 transition-all">
            <div className="flex items-center justify-between gap-2 border-b border-zinc-900/60 pb-1.5">
              <span className="text-[10.5px] font-bold text-zinc-300 uppercase tracking-wider font-mono flex items-center gap-1.5">
                <MetricSymbol name="anticipation" className="w-2.5 h-2.5 shrink-0" style={{ color: chartColors.anticipation || "#06b6d4" }} />
                Operational Stakes
              </span>
              <span className="text-xs font-black bg-cyan-500/10 text-cyan-455 border border-cyan-500/20 px-2 py-0.5 rounded font-mono">
                {activeBeat.metrics?.anticipation}/5
              </span>
            </div>
            <p className="text-xs text-zinc-300 leading-relaxed select-text">
              {activeBeat.metrics?.anticipation_reasoning || "No stakes details available."}
            </p>
          </div>
        </div>

        {/* Narrative Elements Stakes Raised */}
        {activeBeat.narrative_elements?.stakes_reasoning && (
          <div className="bg-zinc-900/30 border border-zinc-800 rounded-xl p-4">
            <h4 className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest font-mono mb-2 flex items-center gap-2">
              <AlertTriangle size={13} className={cn(activeBeat.narrative_elements.stakes_raised ? "text-amber-450 animate-pulse" : "text-zinc-500")} />
              Stakes Dynamics
              {activeBeat.narrative_elements.stakes_raised && (
                <span className="text-[8px] bg-amber-500/15 text-amber-400 border border-amber-500/25 px-1.5 py-0.5 rounded ml-1 font-mono font-bold uppercase tracking-wider">
                  Raised
                </span>
              )}
            </h4>
            <p className="text-xs text-zinc-300 leading-relaxed select-text">
              {activeBeat.narrative_elements.stakes_reasoning}
            </p>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex-1 overflow-y-auto bg-zinc-950 p-6 relative">
      {/* Sleek top gradient */}
      <div className="absolute top-0 left-0 right-0 h-[300px] bg-gradient-to-b from-indigo-950/10 via-transparent to-transparent pointer-events-none" />

      {!report ? (
        /* Standby State with Integrated Uploader Dashboard */
        <div className="max-w-6xl mx-auto my-6 grid grid-cols-1 md:grid-cols-12 gap-8 items-start relative z-10">
          <div className="md:col-span-5 bg-zinc-950 border border-zinc-800 rounded-2xl p-5 shadow-2xl">
            <div className="flex items-center justify-between pb-3.5 border-b border-zinc-900 mb-4">
              <div className="flex items-center space-x-2">
                <Sparkles size={14} className="text-indigo-400" />
                <h2 className="text-xs font-bold text-zinc-200 uppercase tracking-widest font-mono">
                  Multimodal Narrative Analyzer
                </h2>
              </div>
              <Button
                variant="outline"
                size="xs"
                onClick={() => setIsJsonViewOpen(true)}
                className="border-zinc-850 hover:bg-zinc-900 text-zinc-400 hover:text-zinc-200 text-[9px] font-mono uppercase font-bold tracking-widest h-6 cursor-pointer"
              >
                Raw JSON
              </Button>
            </div>
            {renderAnalyzerUI()}
          </div>

          <div className="md:col-span-7 flex flex-col space-y-6">
            <div className="bg-zinc-950/40 border border-zinc-800/80 rounded-2xl p-8 text-center flex flex-col items-center justify-center min-h-[460px] relative overflow-hidden">
              <div className="absolute w-72 h-72 rounded-full bg-indigo-500/5 blur-[100px] -top-10 -right-10 pointer-events-none" />
              <div className="absolute w-72 h-72 rounded-full bg-violet-500/5 blur-[100px] -bottom-10 -left-10 pointer-events-none" />

              <div className="p-4 bg-zinc-900 border border-zinc-800 rounded-full mb-4 shadow-lg text-zinc-500 animate-pulse">
                <Terminal size={28} className="text-indigo-400" />
              </div>
              <h3 className="text-xs font-bold text-zinc-300 uppercase tracking-widest mb-2 font-mono">Narrative Analytics Standby</h3>
              <p className="text-xs text-zinc-500 max-w-sm leading-relaxed mb-6 font-sans">
                Drag and drop or select your video recording on the left, configure the agent parameters, and click **Analyze Recording** to generate high-fidelity storyboarding layers and metric arcs.
              </p>
              
              <div className="flex space-x-2 select-none">
                <div className="flex items-center space-x-1.5 text-[9px] text-zinc-500 bg-zinc-900 border border-zinc-800 px-3 py-1.5 rounded font-mono uppercase tracking-wider">
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-400"></span>
                  <span>Coordinator</span>
                </div>
                <div className="flex items-center space-x-1.5 text-[9px] text-zinc-500 bg-zinc-900 border border-zinc-800 px-3 py-1.5 rounded font-mono uppercase tracking-wider">
                  <span className="w-1.5 h-1.5 rounded-full bg-rose-500"></span>
                  <span>Metric Analyzer</span>
                </div>
                <div className="flex items-center space-x-1.5 text-[9px] text-zinc-500 bg-zinc-900 border border-zinc-800 px-3 py-1.5 rounded font-mono uppercase tracking-wider">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
                  <span>Narrative Expert</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* Active Dashboard Grid */
        <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-6 relative z-10">
          {/* Left Column: Draggable Widgets Area */}
          <section 
            onDragOver={(e) => handleDragOverColumn(e, 'left')}
            className={cn(
              "lg:col-span-5 flex flex-col space-y-6 min-h-[600px] rounded-2xl transition-all duration-300",
              draggedItem ? "bg-zinc-950/25 border border-dashed border-zinc-850/60 p-2.5 -m-2.5" : ""
            )}
          >
            {dashboardLayout.left.map((item) => renderDashboardItem(item, 'left'))}
          </section>

          {/* Right Column: Draggable Widgets Area */}
          <section 
            onDragOver={(e) => handleDragOverColumn(e, 'right')}
            className={cn(
              "lg:col-span-7 flex flex-col space-y-6 min-h-[600px] rounded-2xl transition-all duration-300",
              draggedItem ? "bg-zinc-950/25 border border-dashed border-zinc-850/60 p-2.5 -m-2.5" : ""
            )}
          >
            {dashboardLayout.right.map((item) => renderDashboardItem(item, 'right'))}
          </section>
        </div>
      )}

      {/* Floating Consult Doctor Button */}
      {report && (
        <button
          onClick={() => setIsChatOpen(true)}
          className="fixed bottom-6 right-6 z-40 flex items-center space-x-2 px-5 py-3.5 bg-indigo-600 hover:bg-indigo-500 text-white font-mono text-xs uppercase tracking-widest rounded shadow-xl transition-all hover:scale-105 active:scale-95 group cursor-pointer border border-indigo-400/20"
        >
          <div className="relative">
            <span className="absolute -top-1 -right-1 w-2 h-2 bg-indigo-300 rounded-full animate-ping" />
            <span className="absolute -top-1 -right-1 w-2 h-2 bg-indigo-300 rounded-full" />
            <MessageSquare size={14} className="text-white" />
          </div>
          <span className="font-bold">Consult Story Doctor</span>
        </button>
      )}

      {/* Consult Chat drawer */}
      <ChatConsole
        isChatOpen={isChatOpen}
        setIsChatOpen={setIsChatOpen}
        chatEngine={chatEngine}
        setChatEngine={setChatEngine}
        selectedOllamaModel={selectedOllamaModel}
        setSelectedOllamaModel={setSelectedOllamaModel}
        ollamaStatus={ollamaStatus}
        chatMessages={chatEngine === "doctor" ? doctorMessages : ollamaMessages}
        chatInput={chatInput}
        setChatInput={setChatInput}
        isChatLoading={isChatLoading}
        isThoughtExpanded={isThoughtExpanded}
        setIsThoughtExpanded={setIsThoughtExpanded}
        report={report}
        handleChatSubmit={handleChatSubmit}
      />

      {/* Raw JSON Viewer Modal */}
      {isJsonViewOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in select-text">
          {/* Backdrop */}
          <div 
            className="absolute inset-0 bg-black/70 backdrop-blur-xs cursor-pointer" 
            onClick={() => setIsJsonViewOpen(false)}
          />
          {/* Modal Content */}
          <div className="relative bg-zinc-950 border border-zinc-800 rounded-2xl w-full max-w-3xl h-[600px] flex flex-col shadow-2xl z-10 overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between p-5 border-b border-zinc-900 select-none">
              <div>
                <h3 className="text-xs font-bold text-zinc-200 uppercase tracking-widest font-mono">
                  Raw Scene JSON Data
                </h3>
                <p className="text-[9px] text-zinc-550 font-mono mt-0.5">
                  Inspect or copy timeline context clips, tracks, and analysis reports
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsJsonViewOpen(false)}
                className="p-1 hover:bg-zinc-900 rounded text-zinc-400 hover:text-zinc-200 transition-all cursor-pointer flex items-center justify-center border border-transparent hover:border-zinc-850"
              >
                <X size={16} />
              </button>
            </div>

            {/* Tabs & Toolbar */}
            <div className="flex items-center justify-between px-5 py-3 bg-zinc-900/10 border-b border-zinc-900 select-none">
              <div className="flex bg-zinc-900/50 p-0.5 rounded-lg border border-zinc-800/60 space-x-0.5">
                <button
                  type="button"
                  onClick={() => setJsonTab('analysis')}
                  className={`px-3 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-wider font-mono transition-all cursor-pointer ${
                    jsonTab === 'analysis'
                      ? "bg-zinc-800 text-zinc-100 shadow-sm font-extrabold"
                      : "text-zinc-500 hover:text-zinc-300"
                  }`}
                >
                  📊 Analysis Report JSON
                </button>
                <button
                  type="button"
                  onClick={() => setJsonTab('timeline')}
                  className={`px-3 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-wider font-mono transition-all cursor-pointer ${
                    jsonTab === 'timeline'
                      ? "bg-zinc-800 text-zinc-100 shadow-sm font-extrabold"
                      : "text-zinc-500 hover:text-zinc-300"
                  }`}
                >
                  🎬 Timeline Layout JSON
                </button>
              </div>

              <button
                type="button"
                onClick={handleCopyJson}
                className="px-3.5 py-1.5 bg-indigo-650 hover:bg-indigo-500 text-white rounded text-[10px] font-mono font-bold uppercase tracking-widest cursor-pointer transition-all flex items-center gap-1.5 shadow"
              >
                {copied ? (
                  <>
                    <Check size={11} />
                    <span>Copied!</span>
                  </>
                ) : (
                  <>
                    <span className="text-xs">📋</span>
                    <span>Copy JSON</span>
                  </>
                )}
              </button>
            </div>

            {/* Code Body */}
            <div className="flex-1 overflow-auto p-5 bg-black/40 font-mono text-[11px] text-zinc-400 leading-relaxed scrollbar-thin scrollbar-thumb-zinc-850">
              <pre className="whitespace-pre-wrap select-text selection:bg-indigo-500/30">
                {jsonTab === 'analysis' 
                  ? JSON.stringify(report, null, 2) 
                  : JSON.stringify(activeSceneData, null, 2)
                }
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
