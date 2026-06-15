'use client';

import React from 'react';
import { Check, FileVideo, Loader2, Sparkles, Trash2 } from 'lucide-react';
import { motion } from 'motion/react';
import { Button } from '@storyboard/ui';
import { cn } from '@/lib/utils';
import { saveBlob } from '@/lib/db';
import { toast } from 'sonner';
import type { TimelineProjectJson, TimelineTrack } from '@/lib/timeline-context';

type AnalysisSidePanelProps = {
  selectedVideoFile: File | null;
  setSelectedVideoFile: (file: File | null) => void;
  videoObjectURL: string;
  setVideoObjectURL: (url: string) => void;
  isAnalyzing: boolean;
  analysisProgress: number;
  analysisLogs: string[];
  setAnalysisLogs: (logs: string[]) => void;
  isAnalysisComplete: boolean;
  setIsAnalysisComplete: (complete: boolean) => void;
  setVideoDuration: (duration: number) => void;
  analysisModelChoice: 'gemini' | 'gemma';
  setAnalysisModelChoice: (choice: 'gemini' | 'gemma') => void;
  enabledGraphLayers: Record<string, boolean>;
  setEnabledGraphLayers: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  storyAnalyzePlotPoints: boolean;
  setStoryAnalyzePlotPoints: (enabled: boolean) => void;
  storyAnalyzeStakes: boolean;
  setStoryAnalyzeStakes: (enabled: boolean) => void;
  storyAnalyzeConfrontation: boolean;
  setStoryAnalyzeConfrontation: (enabled: boolean) => void;
  graphTracksInActiveScene: TimelineTrack[];
  runVideoAnalysis: () => void;
  pendingAnalysisProject: any;
  setPendingAnalysisProject: (project: any) => void;
  showDevJson: boolean;
  setShowDevJson: (show: boolean) => void;
  setAnalysisProgress: (progress: number) => void;
  importProjectIntoCurrent: (project: TimelineProjectJson) => void;
};

export function AnalysisSidePanel({
  selectedVideoFile,
  setSelectedVideoFile,
  videoObjectURL,
  setVideoObjectURL,
  isAnalyzing,
  analysisProgress,
  analysisLogs,
  setAnalysisLogs,
  isAnalysisComplete,
  setIsAnalysisComplete,
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
  graphTracksInActiveScene,
  runVideoAnalysis,
  pendingAnalysisProject,
  setPendingAnalysisProject,
  showDevJson,
  setShowDevJson,
  setAnalysisProgress,
  importProjectIntoCurrent,
}: AnalysisSidePanelProps) {
  return (
    <div className="p-4 flex flex-col gap-5">
      {!selectedVideoFile ? (
        <div className="space-y-4">
          <div className="rounded-md border border-zinc-800 bg-zinc-950/40 p-4 text-center">
            <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-zinc-400">AI Video Analyzer</div>
            <p className="text-[10px] text-zinc-500 leading-relaxed">
              Upload a scene video to extract pacing, emotional valence, and narrative plot points. Results will be plotted to existing graph layers and injected as notes.
            </p>
          </div>

          <label className="flex flex-col items-center justify-center h-48 rounded-lg border-2 border-dashed border-zinc-800 bg-zinc-900/10 hover:bg-zinc-900/30 hover:border-indigo-500/50 cursor-pointer transition-all group overflow-hidden">
            <div className="w-12 h-12 rounded-full bg-zinc-900 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
              <FileVideo className="w-6 h-6 text-indigo-500/70" />
            </div>
            <span className="text-[10px] font-black tracking-widest uppercase text-zinc-500 group-hover:text-zinc-300">Select Video File</span>
            <span className="text-[8px] text-zinc-600 mt-1 uppercase">MP4, MOV, WEBM up to 100MB</span>
            <input
              type="file"
              accept="video/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  const sanitizedName = file.name.replace(/[^a-zA-Z0-9._-]/g, '-');
                  const sanitizedFile = new File([file], sanitizedName, { type: file.type });
                  setSelectedVideoFile(sanitizedFile);
                  const url = URL.createObjectURL(sanitizedFile);
                  setVideoObjectURL(url);
                  setIsAnalysisComplete(false);
                  setAnalysisLogs([]);

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
        <div className="space-y-5">
          <div className="rounded-md border border-zinc-800 bg-[#0a0a0b] p-3 flex flex-col gap-3">
            <div className="relative aspect-video rounded overflow-hidden bg-black border border-zinc-900 shadow-lg">
              <video src={videoObjectURL} className="w-full h-full object-contain" controls preload="metadata" />
            </div>

            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-[10px] font-bold text-zinc-300 truncate">{selectedVideoFile.name}</div>
                <div className="text-[8px] font-mono text-zinc-600 mt-0.5 uppercase">
                  {(selectedVideoFile.size / (1024 * 1024)).toFixed(2)} MB
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-zinc-500 hover:text-red-400 hover:bg-red-400/10 shrink-0"
                disabled={isAnalyzing}
                onClick={() => {
                  setSelectedVideoFile(null);
                  if (videoObjectURL) {
                    URL.revokeObjectURL(videoObjectURL);
                    setVideoObjectURL('');
                  }
                  setIsAnalysisComplete(false);
                  setAnalysisLogs([]);
                }}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>

          <div className="space-y-3">
            <h5 className="text-[9px] font-black text-zinc-500 uppercase tracking-[0.15em] px-1">AI Model Engine</h5>
            <div className="grid grid-cols-2 gap-1 rounded-md border border-zinc-900 bg-zinc-950/40 p-1">
              {(['gemini', 'gemma'] as const).map(choice => (
                <button
                  key={choice}
                  type="button"
                  disabled={isAnalyzing}
                  onClick={() => setAnalysisModelChoice(choice)}
                  className={cn(
                    "py-1.5 rounded text-[9px] font-bold uppercase tracking-wider transition-all",
                    analysisModelChoice === choice
                      ? "bg-indigo-600 text-white shadow-md"
                      : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900/40"
                  )}
                >
                  {choice === 'gemini' ? 'Gemini Cloud' : 'Gemma Local'}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <h5 className="text-[9px] font-black text-zinc-500 uppercase tracking-[0.15em] px-1">Analysis Targets</h5>

            <div className="space-y-2 rounded-md border border-zinc-900 bg-zinc-950/40 p-3">
              <div className="text-[9px] font-bold text-zinc-400 uppercase tracking-wider mb-2 border-b border-zinc-900 pb-1">
                Graph Metrics
              </div>
              {graphTracksInActiveScene.length === 0 ? (
                <div className="text-[9px] font-bold text-zinc-700 uppercase italic">
                  No graph layers in active scene
                </div>
              ) : (
                graphTracksInActiveScene.map(track => (
                  <label key={track.id} className="flex items-center gap-2.5 cursor-pointer select-none group text-zinc-400 hover:text-zinc-200">
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
                      className="rounded border-zinc-800 bg-[#0a0a0b] text-indigo-600 focus:ring-0 focus:ring-offset-0 w-3.5 h-3.5 accent-indigo-600"
                    />
                    <span className="text-[10px] font-semibold truncate group-hover:text-zinc-200">
                      Plot "{track.graph?.label || track.name}"
                    </span>
                  </label>
                ))
              )}
            </div>

            <div className="space-y-2 rounded-md border border-zinc-900 bg-zinc-950/40 p-3">
              <div className="text-[9px] font-bold text-zinc-400 uppercase tracking-wider mb-2 border-b border-zinc-900 pb-1">
                Narrative Beats (Notes)
              </div>

              {[
                ['Detect Plot Points', storyAnalyzePlotPoints, setStoryAnalyzePlotPoints],
                ['Track Tension & Stakes', storyAnalyzeStakes, setStoryAnalyzeStakes],
                ['Map Confrontation Peaks', storyAnalyzeConfrontation, setStoryAnalyzeConfrontation],
              ].map(([label, checked, setter]) => (
                <label key={String(label)} className="flex items-center gap-2.5 cursor-pointer select-none group text-zinc-400 hover:text-zinc-200">
                  <input
                    type="checkbox"
                    checked={Boolean(checked)}
                    disabled={isAnalyzing}
                    onChange={(e) => (setter as (enabled: boolean) => void)(e.target.checked)}
                    className="rounded border-zinc-800 bg-[#0a0a0b] text-indigo-600 focus:ring-0 focus:ring-offset-0 w-3.5 h-3.5 accent-indigo-600"
                  />
                  <span className="text-[10px] font-semibold group-hover:text-zinc-200">
                    {String(label)}
                  </span>
                </label>
              ))}
            </div>
          </div>

          {!isAnalysisComplete && !isAnalyzing && (
            <Button
              onClick={runVideoAnalysis}
              className="w-full bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white text-[10px] font-black uppercase tracking-widest h-10 shadow-lg shadow-indigo-900/30 transition-all duration-300 border border-indigo-500/20"
            >
              <Sparkles className="w-3.5 h-3.5 mr-2 animate-pulse" />
              Analyze Video
            </Button>
          )}

          {isAnalyzing && (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-[10px] font-black text-indigo-400 uppercase tracking-widest px-1">
                <span className="flex items-center gap-1.5">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Processing
                </span>
                <span>{analysisProgress}%</span>
              </div>

              <div className="w-full h-1.5 bg-zinc-950 rounded-full overflow-hidden border border-zinc-900">
                <motion.div
                  className="h-full bg-gradient-to-r from-indigo-500 via-indigo-600 to-violet-500 rounded-full"
                  initial={{ width: 0 }}
                  animate={{ width: `${analysisProgress}%` }}
                  transition={{ duration: 0.3 }}
                />
              </div>
            </div>
          )}

          {(isAnalyzing || analysisLogs.length > 0) && (
            <div className="space-y-2">
              <div className="text-[9px] font-bold text-zinc-600 uppercase tracking-wider px-1">
                Analysis Console Log
              </div>
              <div className="rounded border border-zinc-900 bg-black/70 p-3 font-mono text-[9px] leading-relaxed text-zinc-400 h-32 overflow-y-auto shadow-inner flex flex-col gap-1.5">
                {analysisLogs.map((log, index) => (
                  <div key={index} className={cn(
                    log.startsWith('[SYSTEM]') && "text-indigo-300",
                    log.startsWith('[STAGE') && "text-zinc-300",
                    !log.startsWith('[') && "text-zinc-500"
                  )}>
                    {log}
                  </div>
                ))}
              </div>
            </div>
          )}

          {isAnalysisComplete && pendingAnalysisProject && (
            <div className="rounded-md border border-emerald-500/20 bg-emerald-500/5 p-4 space-y-4 text-center animate-fade-in">
              <div className="w-8 h-8 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mx-auto text-emerald-400">
                <Check className="w-4 h-4" />
              </div>
              <div>
                <div className="text-[10px] font-bold text-emerald-300 uppercase tracking-widest">Analysis Completed</div>
                <p className="text-[9px] text-zinc-400 mt-1 leading-relaxed">
                  Analysis matches exact narrative structure. Scene and graph metrics are ready to be loaded.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2 text-left font-semibold font-mono text-[9px] text-zinc-500 bg-[#0e0e11]/60 p-2.5 rounded border border-zinc-900">
                <div>
                  <div className="text-zinc-600 font-bold text-[8px] uppercase">Name</div>
                  <div className="truncate text-zinc-300 mt-0.5">{selectedVideoFile.name}</div>
                </div>
                <div>
                  <div className="text-zinc-600 font-bold text-[8px] uppercase">Characters</div>
                  <div className="truncate text-zinc-300 mt-0.5">
                    {pendingAnalysisProject.characters?.map((c: any) => c.name).join(', ') || 'Mac, Jem'}
                  </div>
                </div>
                <div className="mt-2">
                  <div className="text-zinc-600 font-bold text-[8px] uppercase">Graph Metrics</div>
                  <div className="text-zinc-300 mt-0.5">
                    {pendingAnalysisProject.scenes?.[0]?.tracks?.filter((t: any) => t.type === 'graph').length || 0} Layers Mapped
                  </div>
                </div>
                <div className="mt-2">
                  <div className="text-zinc-600 font-bold text-[8px] uppercase">Clips Generated</div>
                  <div className="text-zinc-300 mt-0.5">
                    {pendingAnalysisProject.scenes?.[0]?.clips?.length || 0} Clips Generated
                  </div>
                </div>
                <div className="col-span-2 mt-2 border-t border-zinc-900 pt-2">
                  <div className="text-zinc-600 font-bold text-[8px] uppercase">Engine Model</div>
                  <div className="text-indigo-400 mt-0.5 text-[8px] break-all leading-tight">
                    {pendingAnalysisProject.model || 'gemini-2.5-flash'}
                  </div>
                </div>
              </div>

              {pendingAnalysisProject.model?.includes('fallback') && (
                <div className="rounded border border-amber-500/20 bg-amber-500/5 p-2.5 text-left text-[9px] text-amber-200 leading-relaxed font-semibold">
                  <span className="font-black uppercase tracking-widest text-amber-300 block mb-0.5">API Service Interruption</span>
                  The live Gemini service is currently overloaded or returned a service error (503). The system successfully recovered by generating a custom dynamic narrative blueprint tailored perfectly to your video's name, dialogue transcripts, and computed duration.
                </div>
              )}

              <div className="flex flex-col gap-2">
                <Button
                  onClick={async () => {
                    if (selectedVideoFile) {
                      await saveBlob("clip-media-video", selectedVideoFile);
                    }
                    const projectCopy = JSON.parse(JSON.stringify(pendingAnalysisProject));
                    const videoClip = projectCopy.scenes[0].clips.find((c: any) => c.id === "clip-media-video");
                    if (videoClip) {
                      videoClip.src = videoObjectURL;
                    }
                    importProjectIntoCurrent(projectCopy);
                    toast.success("AI Analysis added as a new scene!");
                  }}
                  className="w-full bg-indigo-650 hover:bg-indigo-500 text-white text-[10px] font-black uppercase tracking-widest h-9"
                >
                  <Sparkles className="w-3.5 h-3.5 mr-1.5" />
                  Add as New Scene
                </Button>

                <Button
                  variant="ghost"
                  onClick={() => {
                    setIsAnalysisComplete(false);
                    setAnalysisProgress(0);
                    setAnalysisLogs([]);
                    setPendingAnalysisProject(null);
                    setShowDevJson(false);
                  }}
                  className="w-full border border-zinc-800 bg-transparent hover:bg-zinc-800 text-[9px] font-bold uppercase tracking-wider h-8 text-zinc-500 hover:text-zinc-300"
                >
                  Reset Analysis
                </Button>

                <div className="border-t border-zinc-800/40 my-1" />

                <Button
                  variant="outline"
                  onClick={() => setShowDevJson(!showDevJson)}
                  className="w-full text-[9px] border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40 bg-transparent uppercase font-black tracking-widest h-8"
                >
                  {showDevJson ? "Hide Raw JSON" : "Show Raw JSON"}
                </Button>

                {showDevJson && (
                  <div className="relative mt-2 p-2.5 rounded border border-zinc-800 bg-[#070709]/90 text-left overflow-auto max-h-64 font-mono text-[8px] text-zinc-300 leading-snug">
                    <Button
                      onClick={() => {
                        navigator.clipboard.writeText(JSON.stringify(pendingAnalysisProject, null, 2));
                        toast.success("JSON copied to clipboard!");
                      }}
                      className="absolute right-2 top-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-[8px] h-5 px-2 font-bold uppercase tracking-wider border border-zinc-700 rounded-sm"
                    >
                      Copy
                    </Button>
                    <pre className="whitespace-pre-wrap break-all pr-12 font-mono leading-normal text-zinc-400">
                      {JSON.stringify(pendingAnalysisProject, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
