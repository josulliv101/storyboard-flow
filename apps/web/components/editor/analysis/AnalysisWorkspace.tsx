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
  Layers,
  ScrollText,
  UploadCloud,
  X,
  HelpCircle,
  Play,
  User
} from "lucide-react";
import { useTimeline } from "@/lib/timeline-context";
import { getGraphColor } from "@/lib/graph-style";
import TensionChart from "./TensionChart";
import ScriptBeatsList from "./ScriptBeatsList";
import SceneInspector from "./SceneInspector";
import ExecutiveSummary from "./ExecutiveSummary";
import DiagnosticsPanel from "./DiagnosticsPanel";
import AgentLogs from "./AgentLogs";
import ChatConsole from "./ChatConsole";
import { ScreenplayReport, LogEntry, SceneAnalysis } from "./types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";



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
}: AnalysisWorkspaceProps) {
  const {
    scenes,
    activeSceneId,
    clips,
    tracks,
    characters,
    fps,
    updateClip,
    setCurrentFrame,
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



  // Selected Beat State
  const [activeSceneIndex, setActiveSceneIndex] = useState(0);
  const [scrollTrigger, setScrollTrigger] = useState(0);
  const beatListRef = useRef<HTMLDivElement | null>(null);
  const [beatsListHeight, setBeatsListHeight] = useState<number>(450);

  const handleSelectScene = (idx: number) => {
    setActiveSceneIndex(idx);
    setScrollTrigger((prev) => prev + 1);
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = beatsListHeight;

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const deltaY = moveEvent.clientY - startY;
      const newHeight = Math.max(120, Math.min(600, startHeight + deltaY));
      setBeatsListHeight(newHeight);
    };

    const handlePointerUp = () => {
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
        (c) => c.type === "dialog" && c.startFrame >= beat.startFrame && c.startFrame < beat.startFrame + beat.duration
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
      const tension = Math.min(5, Math.max(0, Math.round(tensionVal / 2)));
      const suspense = Math.min(5, Math.max(0, Math.round(suspenseVal / 2)));
      const anticipation = Math.min(5, Math.max(0, Math.round(stakesVal / 2)));

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
    const beatStartFrame = Math.round((activeBeat.start ?? 0) * fps);
    const beatEndFrame = Math.round((activeBeat.end ?? 0) * fps);
    return clips
      .filter(
        (c) =>
          c.type === "dialog" &&
          c.startFrame >= beatStartFrame &&
          c.startFrame < beatEndFrame
      )
      .sort((a, b) => a.startFrame - b.startFrame);
  }, [activeBeat, clips, fps]);

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
                    setSelectedVideoFile(file);
                    const url = URL.createObjectURL(file);
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
                className="w-full bg-gradient-to-r from-indigo-650 to-violet-650 hover:from-indigo-600 hover:to-violet-600 text-white text-[10px] font-black uppercase tracking-widest h-9 shadow-lg shadow-indigo-950/20 transition-all border border-indigo-500/20 cursor-pointer"
              >
                <Sparkles className="w-3.5 h-3.5 mr-2 animate-pulse text-indigo-300" />
                Analyze Recording
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

  const renderActiveBeatDialogue = () => {
    return (
      <div className="bg-zinc-950 border border-zinc-800 rounded-2xl p-5 shadow-xl flex flex-col select-none animate-fade-in">
        <div className="flex items-center justify-between gap-3 pb-3 border-b border-zinc-900 mb-3.5">
          <div className="flex items-center space-x-2">
            <MessageSquare size={13} className="text-indigo-400" />
            <span className="text-[10px] font-mono font-bold tracking-widest text-zinc-400 uppercase">
              Dialogue in Beat {activeBeat?.scene_number}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[8.5px] font-mono text-zinc-550 uppercase tracking-wider font-semibold">
              {activeBeatDialogClips.length} {activeBeatDialogClips.length === 1 ? 'Line' : 'Lines'}
            </span>
            <Button
              type="button"
              size="xs"
              variant="outline"
              disabled={!onOpenScriptEditor || !activeScene?.id || activeBeatDialogClips.length === 0}
              onClick={() => {
                const dialogClip = activeBeatDialogClips[0];
                if (!dialogClip || !activeScene?.id) return;
                onOpenScriptEditor?.(dialogClip.id, activeScene.id);
              }}
              className="border-indigo-500/30 bg-indigo-500/10 text-[9px] font-mono font-bold uppercase tracking-widest text-indigo-200 hover:bg-indigo-500/20 hover:text-indigo-100"
            >
              <ScrollText data-icon="inline-start" />
              Dialog Editor
            </Button>
          </div>
        </div>

        <div className="max-h-[300px] overflow-y-auto space-y-2.5 pr-1 scrollbar-thin scrollbar-thumb-zinc-800">
          {activeBeatDialogClips.map((clip) => {
            const char = characters.find(
              (ch) =>
                ch.id === clip.characterId ||
                ch.name.toLowerCase() === clip.character?.toLowerCase()
            );
            const charName = char?.name || clip.character || "Hero";
            const charImage = char?.image;

            return (
              <div 
                key={clip.id}
                className="flex items-start gap-3 bg-zinc-900/20 border border-zinc-900/60 rounded-xl p-3 transition-colors hover:border-zinc-800 hover:bg-zinc-900/30"
              >
                {/* Character Headshot */}
                <div className="w-16 h-16 rounded-full bg-zinc-950 border border-zinc-800 overflow-hidden flex items-center justify-center shrink-0 shadow-inner">
                  {charImage ? (
                    <img src={charImage} alt={charName} className="w-full h-full object-cover" />
                  ) : (
                    <User className="w-8 h-8 text-zinc-500" />
                  )}
                </div>

                {/* Speech Bubble */}
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-mono font-bold text-indigo-400 uppercase tracking-wider">
                    {charName}
                  </div>
                  <p className="text-sm text-zinc-200 mt-1.5 leading-relaxed pl-0.5 select-text">
                    {clip.description || clip.name}
                  </p>
                </div>
              </div>
            );
          })}

          {activeBeatDialogClips.length === 0 && (
            <div className="py-8 flex flex-col items-center justify-center text-center gap-2 select-none">
              <MessageSquare className="w-8 h-8 text-zinc-800 animate-pulse" />
              <div className="text-[9.5px] font-mono text-zinc-650 uppercase tracking-widest mt-1">
                No dialogue registered
              </div>
              <p className="text-[8px] text-zinc-700 max-w-[200px] leading-relaxed">
                Add dialogue clips in the editor timeline to visualize speech bubbles in this beat.
              </p>
            </div>
          )}
        </div>
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
            <div className="flex items-center space-x-2 pb-3.5 border-b border-zinc-900 mb-4">
              <Sparkles size={14} className="text-indigo-400" />
              <h2 className="text-xs font-bold text-zinc-200 uppercase tracking-widest font-mono">
                Multimodal Narrative Analyzer
              </h2>
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
          {/* Left Column: Metrics, Analyzer Collapsible & Logs */}
          <section className="lg:col-span-5 flex flex-col space-y-6">
            {activeSceneVideoSrc && (
              <div className="bg-zinc-950 border border-zinc-800 rounded-2xl p-4 shadow-xl select-none">
                <div className="relative aspect-video rounded overflow-hidden bg-black border border-zinc-900 shadow">
                  <video 
                    ref={videoRef}
                    onTimeUpdate={handleVideoTimeUpdate}
                    src={activeSceneVideoSrc} 
                    className="w-full h-full object-contain" 
                    controls 
                    preload="metadata" 
                  />
                </div>
                <div className="mt-2.5 flex items-center justify-between text-[10px] font-mono text-zinc-400 px-1 font-semibold">
                  <span className="truncate max-w-[200px]">{selectedVideoFile?.name || activeScene?.name || "scene-video.mp4"}</span>
                  <span className="text-[8px] text-zinc-550 uppercase tracking-wider font-bold">Active Recording</span>
                </div>
              </div>
            )}

            {activeSceneVideoSrc && renderActiveBeatDialogue()}

            {/* Collapsible Video Analyzer Drawer */}
            <div className="bg-zinc-950 border border-zinc-800 rounded-2xl p-4 shadow-xl select-none">
              <div 
                className="flex items-center justify-between cursor-pointer pb-0.5"
                onClick={() => setIsAnalyzerOpen(!isAnalyzerOpen)}
              >
                <div className="flex items-center space-x-2">
                  <Sparkles size={14} className="text-indigo-400" />
                  <span className="text-[10px] font-mono font-bold tracking-widest text-zinc-400 uppercase">
                    AI Video Analyzer
                  </span>
                </div>
                <div className="flex items-center space-x-1.5">
                  <span className="text-[9px] font-mono text-zinc-500 truncate max-w-[120px]">
                    {selectedVideoFile ? selectedVideoFile.name : "Ready to analyze"}
                  </span>
                  {isAnalyzerOpen ? <ChevronUp size={12} className="text-zinc-500" /> : <ChevronDown size={12} className="text-zinc-550" />}
                </div>
              </div>
              
              {(isAnalyzerOpen || isAnalyzing) && (
                <div className="mt-4 pt-4 border-t border-zinc-900 select-text">
                  {renderAnalyzerUI()}
                </div>
              )}
            </div>

            <SceneInspector activeScene={activeBeat} />
            <ExecutiveSummary report={report} />
            <AgentLogs logs={report.agent_logs} isLoading={isAnalyzing} elapsedTime={elapsedTime} />
            <DiagnosticsPanel
              apiHealth={apiHealth}
              ollamaStatus={ollamaStatus}
              isCheckingDiagnostics={isCheckingDiagnostics}
              isDiagnosticsOpen={isDiagnosticsOpen}
              setIsDiagnosticsOpen={setIsDiagnosticsOpen}
              elapsedTime={elapsedTime}
              isLoading={isAnalyzing}
              checkDiagnostics={checkDiagnostics}
              selectedOllamaModel={selectedOllamaModel}
              setSelectedOllamaModel={setSelectedOllamaModel}
            />
          </section>

          {/* Right Column: Chart & Beats List */}
          <section className="lg:col-span-7 flex flex-col">
            <ScriptBeatsList
              report={report}
              activeSceneIndex={activeSceneIndex}
              setActiveSceneIndex={setActiveSceneIndex}
              beatListRef={beatListRef}
              handleListScroll={handleListScroll}
              height={beatsListHeight}
              scrollTrigger={scrollTrigger}
            />

            {/* Resizable Divider */}
            <div
              onPointerDown={handlePointerDown}
              className="w-full py-4 flex items-center justify-center cursor-ns-resize group select-none relative z-20"
            >
              {/* Divider Line */}
              <div className="w-full h-[1px] bg-zinc-800/80 group-hover:bg-indigo-500/50 group-active:bg-indigo-500 transition-colors" />
              {/* Grab Handle */}
              <div className="absolute px-3 py-1 bg-zinc-950 border border-zinc-850 rounded-full flex items-center justify-center space-x-1 opacity-70 group-hover:opacity-100 group-hover:border-indigo-500/30 group-active:border-indigo-500 transition-all shadow-md">
                <span className="w-1.5 h-1.5 rounded-full bg-zinc-650 group-hover:bg-indigo-400 animate-pulse" />
                <span className="w-1.5 h-1.5 rounded-full bg-zinc-650 group-hover:bg-indigo-400" />
                <span className="w-1.5 h-1.5 rounded-full bg-zinc-650 group-hover:bg-indigo-400" />
              </div>
            </div>

            <TensionChart
              data={chartData}
              activeIndex={activeSceneIndex}
              onSelectScene={handleSelectScene}
              colors={chartColors}
            />
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
    </div>
  );
}
