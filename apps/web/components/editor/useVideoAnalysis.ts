'use client';

import React from 'react';
import { toast } from 'sonner';
import type { Scene, TimelineClip, ClipType, TimelineTrack, TimelineProjectJson } from '@/lib/timeline-context';
import { loadBlob, saveBlob } from '@/lib/db';
import { captureVideoAnalysisFrames, extractCharacterAvatarFromVideo, extractBeatThumbnailFromVideo } from '@/lib/video-helpers';
import { localUpload } from './editor-media-utils';

interface UseVideoAnalysisParams {
  activeSceneId: string;
  scenes: Scene[];
  updateScene: (sceneId: string, updates: Partial<Scene>) => void;
  updateClip: (clipId: string, updates: Partial<TimelineClip>) => void;
  tracks: TimelineTrack[];
  fps: number;
  currentUser: any;
  importProjectIntoCurrent: (project: any) => void;
}

export function useVideoAnalysis({
  activeSceneId,
  scenes,
  updateScene,
  updateClip,
  tracks,
  fps,
  currentUser,
  importProjectIntoCurrent,
}: UseVideoAnalysisParams) {
  const [selectedVideoFile, setSelectedVideoFile] = React.useState<File | null>(null);
  const [videoObjectURL, setVideoObjectURL] = React.useState<string>('');
  const [isAnalyzing, setIsAnalyzing] = React.useState(false);
  const [analysisProgress, setAnalysisProgress] = React.useState(0);
  const [analysisLogs, setAnalysisLogs] = React.useState<string[]>([]);
  const [isAnalysisComplete, setIsAnalysisComplete] = React.useState(false);
  const [pendingAnalysisProject, setPendingAnalysisProject] = React.useState<any>(null);
  const [showDevJson, setShowDevJson] = React.useState(false);
  const [videoDuration, setVideoDuration] = React.useState<number>(30);
  const [analysisModelChoice, setAnalysisModelChoice] = React.useState<'gemini' | 'gemma'>('gemini');

  // Selection checkmarks for graph layers to update
  const [enabledGraphLayers, setEnabledGraphLayers] = React.useState<Record<string, boolean>>({});

  // Checkmarks for story elements to analyze
  const [storyAnalyzePlotPoints, setStoryAnalyzePlotPoints] = React.useState(true);
  const [storyAnalyzeStakes, setStoryAnalyzeStakes] = React.useState(true);
  const [storyAnalyzeConfrontation, setStoryAnalyzeConfrontation] = React.useState(true);

  React.useEffect(() => {
    return () => {
      if (videoObjectURL) {
        URL.revokeObjectURL(videoObjectURL);
      }
    };
  }, [videoObjectURL]);

  // Synchronize selectedVideoFile and videoObjectURL from the active scene's video clip when scene changes or on mount
  React.useEffect(() => {
    let isCurrent = true;
    const activeScene = scenes.find(s => s.id === activeSceneId);
    if (!activeScene) return () => {
      isCurrent = false;
    };

    const videoClip = activeScene.clips.find(c => c.type === 'video' && c.src);
    if (videoClip && videoClip.src) {
      if (videoObjectURL === videoClip.src) return;

      const syncVideoFile = async () => {
        try {
          const shouldUseLocalBlob = videoClip.src?.startsWith('blob:') || videoClip.src?.startsWith('data:');
          const localBlob = shouldUseLocalBlob ? await loadBlob(videoClip.id) : undefined;
          if (localBlob) {
            if (!isCurrent) return;
            const rawName = videoClip.name || "scene-video.mp4";
            const sanitizedName = rawName.replace(/[^a-zA-Z0-9._-]/g, '-');
            const file = new File([localBlob], sanitizedName, { type: localBlob.type || "video/mp4" });

            const newObjectUrl = URL.createObjectURL(localBlob);
            setSelectedVideoFile(file);
            setVideoObjectURL(newObjectUrl);

            if (videoClip.src !== newObjectUrl) {
              updateClip(videoClip.id, { src: newObjectUrl });
            }
            return;
          }

          if (videoClip.src!.startsWith('blob:')) {
            console.warn(`Video blob URL has expired and was not found in IndexedDB: ${videoClip.src}`);
            return;
          }

          const res = await fetch(videoClip.src!);
          if (!isCurrent) return;
          if (!res.ok) {
            const isHostedSceneMedia = (() => {
              try {
                const sourceUrl = new URL(videoClip.src!, window.location.origin);
                return sourceUrl.pathname === "/api/scenes/media";
              } catch {
                return false;
              }
            })();

            if (res.status === 404 && isHostedSceneMedia) {
              console.warn(`Hosted video is no longer available: ${videoClip.src}`);
              setVideoObjectURL('');
              setSelectedVideoFile(null);
              return;
            }

            throw new Error(`Fetch returned status ${res.status}`);
          }
          const blob = await res.blob();
          if (!isCurrent) return;
          const rawName = videoClip.name || "scene-video.mp4";
          const sanitizedName = rawName.replace(/[^a-zA-Z0-9._-]/g, '-');
          const file = new File([blob], sanitizedName, { type: blob.type });
          setSelectedVideoFile(file);
          setVideoObjectURL(videoClip.src!);

          if (rawName !== sanitizedName) {
            updateClip(videoClip.id, { name: sanitizedName });
            if (activeScene.name === rawName) {
              updateScene(activeScene.id, { name: sanitizedName });
            }
            if (activeScene.analysisReport && activeScene.analysisReport.title === rawName) {
              updateScene(activeScene.id, {
                analysisReport: {
                  ...activeScene.analysisReport,
                  title: sanitizedName
                }
              });
            }
          }
        } catch (err) {
          console.error("Failed to sync video file from active scene:", err);
        }
      };
      void syncVideoFile();
    } else {
      if (selectedVideoFile || videoObjectURL) {
        setSelectedVideoFile(null);
        setVideoObjectURL('');
      }
    }
    return () => {
      isCurrent = false;
    };
  }, [activeSceneId, scenes, selectedVideoFile, updateClip, updateScene, videoObjectURL]);

  // Dynamic Visual Media Hydration & Persistence Effect for AI Analyzed Scene
  React.useEffect(() => {
    if (!selectedVideoFile || !videoObjectURL) return;

    const activeScene = scenes.find(s => s.id === activeSceneId);
    if (!activeScene) return;

    const videoClip = activeScene.clips.find(c =>
      c.type === 'video' &&
      c.id.includes('clip-media-video') &&
      (!c.src || c.src === '')
    );

    if (videoClip) {
      void saveBlob(videoClip.id, selectedVideoFile);
      updateClip(videoClip.id, { src: videoObjectURL });
    }
  }, [activeSceneId, scenes, selectedVideoFile, videoObjectURL, updateClip]);

  const graphTracksInActiveScene = React.useMemo(() => {
    return tracks.filter(t => t.type === 'graph' && t.graph);
  }, [tracks]);

  React.useEffect(() => {
    const initialLayers: Record<string, boolean> = {};
    graphTracksInActiveScene.forEach(track => {
      initialLayers[track.id] = true;
    });
    setEnabledGraphLayers(initialLayers);
  }, [graphTracksInActiveScene]);

  const runVideoAnalysis = React.useCallback(async () => {
    if (!currentUser || currentUser.role === 'viewer') {
      toast.error('You are in read-only viewer mode. Log in as an editor or admin to analyze videos.');
      return;
    }
    if (!selectedVideoFile || isAnalyzing) return;

    setIsAnalyzing(true);
    setAnalysisProgress(0);
    setAnalysisLogs(["[SYSTEM] Initializing multimodal AI analysis engine..."]);
    setIsAnalysisComplete(false);
    setPendingAnalysisProject(null);

    const formData = new FormData();
    formData.append('file', selectedVideoFile);
    formData.append('fileName', selectedVideoFile.name);
    formData.append('duration', String(videoDuration));
    formData.append('model', analysisModelChoice);

    if (analysisModelChoice === 'gemma') {
      try {
        setAnalysisLogs(prev => [...prev, "[LOCAL] Sampling video frames for Gemma vision input..."]);
        const sampledFrames = await captureVideoAnalysisFrames(selectedVideoFile);
        sampledFrames.forEach((frame, index) => {
          formData.append('analysisFrame', frame, `analysis-frame-${index + 1}.jpg`);
        });
        setAnalysisLogs(prev => [...prev, `${sampledFrames.length} visual frames ready for Gemma analysis.`]);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unable to prepare local visual analysis frames.';
        setAnalysisLogs(prev => [...prev, `[ERROR] ${message}`]);
        setIsAnalyzing(false);
        toast.error(message);
        return;
      }
    }

    let isRequestDone = false;
    let requestError: string | null = null;
    let requestResult: any = null;

    fetch('/api/analyze', {
      method: 'POST',
      body: formData,
    })
      .then(async (res) => {
        if (!res.ok) {
          const errJson = await res.json().catch(() => ({}));
          throw new Error(errJson.error || `Server responded with HTTP ${res.status}`);
        }
        return res.json();
      })
      .then((data) => {
        isRequestDone = true;
        requestResult = data;
      })
      .catch((err) => {
        isRequestDone = true;
        requestError = err instanceof Error ? err.message : 'Unknown analysis error';
      });

    const steps = analysisModelChoice === 'gemma'
      ? [
          { percent: 10, delay: 400, log: "[SYSTEM] Connecting to local Ollama analysis endpoint..." },
          { percent: 35, delay: 700, log: "[STAGE 1] Sending sampled video frames to Gemma vision..." },
          { percent: 65, delay: 900, log: "[STAGE 2] Extracting visual narrative narrative beats and scene text..." },
          { percent: 90, delay: 900, log: "[STAGE 3] Building narrative graphs and preview notes..." }
        ]
      : [
          { percent: 10, delay: 800, log: "[SYSTEM] Connecting to AI analysis endpoint..." },
          { percent: 25, delay: 1500, log: "[STAGE 1] Uploading video to Gemini Files API (handling secure sandbox)..." },
          { percent: 45, delay: 2000, log: "[STAGE 2] Polling Files API for model ingestion & safety checks..." },
          { percent: 65, delay: 2500, log: "[STAGE 3] Running shot-boundary detection & semantic dialogue mapping..." },
          { percent: 80, delay: 2500, log: "[STAGE 4] Querying gemini-3.5-flash with structured story schema..." },
          { percent: 90, delay: 2000, log: "[STAGE 5] Generating narrative graphs (Tension, Suspense, Stakes)..." }
        ];

    let currentIdx = 0;
    const runNextStep = () => {
      if (requestError) {
        setAnalysisLogs(prev => [...prev, `[ERROR] AI Analysis failed: ${requestError}`]);
        setIsAnalyzing(false);
        toast.error(`AI Analysis failed: ${requestError}`);
        return;
      }

      if (isRequestDone) {
        if (requestError) {
          setAnalysisLogs(prev => [...prev, `[ERROR] AI Analysis failed: ${requestError}`]);
          setIsAnalyzing(false);
          toast.error(`AI Analysis failed: ${requestError}`);
        } else if (requestResult) {
          try {
            const project = requestResult.project as TimelineProjectJson;
            const modelName = requestResult.modelName || analysisModelChoice;

            if (!project || !Array.isArray(project.scenes) || project.scenes.length === 0) {
              throw new Error('Analysis response is missing a valid project structure.');
            }

            const parsedBeats = project.scenes[0].clips.map((clip: any) => ({
              id: clip.id || `analysis-beat-${Math.random().toString(36).substr(2, 9)}`,
              name: clip.name || "Parsed Beat",
              type: clip.type || "video",
              startFrame: clip.startFrame || 0,
              duration: clip.duration || 150,
              trackId: clip.trackId || 'track-1',
              color: clip.color || 'bg-indigo-600',
              character: clip.character || undefined,
              dialogue: clip.dialogue || undefined,
              tags: clip.tags || [],
              notes: clip.notes || undefined,
              metrics: clip.metrics || { tension: 50, suspense: 50, anticipation: 50 }
            }));

            const processAvatars = async () => {
              const updatedCharacters = [...(project.characters || [])] as any[];
              for (const char of updatedCharacters) {
                let timestamp = typeof char.face_timestamp === 'number' ? char.face_timestamp : 2.0;
                const boundingBox = Array.isArray(char.face_box) && char.face_box.length === 4
                  ? char.face_box
                  : undefined;
                try {
                  setAnalysisLogs(prev => [...prev, `[SYSTEM] Seeking video to extract close-up headshot for character "${char.name}"...`]);
                  const croppedBlob = await extractCharacterAvatarFromVideo(selectedVideoFile, timestamp, boundingBox);
                  const rawFileName = `avatar-${char.id}-${Date.now()}.png`;
                  setAnalysisLogs(prev => [...prev, `[SYSTEM] Uploading "${char.name}" cropped headshot to persistent cloud storage...`]);
                  const file = new File([croppedBlob], rawFileName, { type: 'image/png' });
                  try {
                    const uploadPromise = localUpload(rawFileName, file);
                    const timeoutPromise = new Promise<never>((_, reject) => {
                      setTimeout(() => reject(new Error("Local upload timed out (8s limit reached)")), 8000);
                    });
                    const hostedBlob = await Promise.race([uploadPromise, timeoutPromise]);
                    char.image = `/api/scenes/media?pathname=${encodeURIComponent(hostedBlob.pathname)}`;
                    setAnalysisLogs(prev => [...prev, `[SUCCESS] Persistent cloud headshot successfully created for "${char.name}"!`]);
                  } catch (uploadErr) {
                    console.warn(`[UPLOAD_FAILED] Vercel Blob upload failed or store is suspended for "${char.name}". Falling back to local storage.`, uploadErr);
                    setAnalysisLogs(prev => [...prev, `[WARNING] Persistent upload failed for "${char.name}" (Vercel Blob store suspended). Saving to local IndexedDB.`]);
                    char.image = URL.createObjectURL(croppedBlob);
                  }
                  await saveBlob(`char-${char.id}`, croppedBlob);
                } catch (err) {
                  console.error(`Failed to extract avatar for ${char.name}:`, err);
                  setAnalysisLogs(prev => [...prev, `[WARNING] Failed to extract custom headshot for "${char.name}", falling back to initials.`]);
                }
              }

              for (const beat of parsedBeats) {
                const timestamp = (beat.startFrame / 30) + 0.1;
                try {
                  setAnalysisLogs(prev => [...prev, `[SYSTEM] Rendering thumbnail preview for beat "${beat.name}"...`]);
                  const thumbnailBlob = await extractBeatThumbnailFromVideo(selectedVideoFile, timestamp);
                  const rawFileName = `beat-${beat.id}.jpg`;
                  const hostedBlob = await localUpload(rawFileName, new File([thumbnailBlob], rawFileName, { type: 'image/jpeg' }));
                  (beat as any).thumbnailUrl = `/api/scenes/media?pathname=${encodeURIComponent(hostedBlob.pathname)}`;
                } catch (err) {
                  console.error(`Failed to extract beat thumbnail for ${beat.name}:`, err);
                }
              }

              const avgT = parseFloat((parsedBeats.reduce((acc, b) => acc + b.metrics.tension, 0) / Math.max(1, parsedBeats.length)).toFixed(2)) || 0;
              const avgS = parseFloat((parsedBeats.reduce((acc, b) => acc + b.metrics.suspense, 0) / Math.max(1, parsedBeats.length)).toFixed(2)) || 0;
              const avgA = parseFloat((parsedBeats.reduce((acc, b) => acc + b.metrics.anticipation, 0) / Math.max(1, parsedBeats.length)).toFixed(2)) || 0;

              let pacing = "Custom Storyboards Arc";
              if (modelName) {
                pacing = modelName.includes("gemma") ? "Slow-Burn Dialogue Arc" : "Crescendo / Rising Action Arc";
              }

              const finalLogsList = [
                "[SYSTEM] Initializing multimodal AI analysis engine...",
                `[SYSTEM] Connecting to ${modelName.includes('gemma') ? 'local Ollama' : 'AI'} analysis endpoint...`,
                ...updatedCharacters.flatMap(char => [
                  `[SYSTEM] Seeking video to extract close-up headshot for character "${char.name}"...`,
                  `[SYSTEM] Uploading "${char.name}" cropped headshot to persistent cloud storage...`,
                  `[SUCCESS] Persistent cloud headshot successfully created for "${char.name}"!`
                ]),
                `[SYSTEM] Multimodal analysis and visual headshot extraction complete! (Powered by: ${modelName})`
              ];

              const agent_logs = finalLogsList.map((logLine, logIdx) => ({
                sender: logLine.startsWith("[LOCAL]") || logLine.includes("Gemma") ? "Gemma Local Engine" : logLine.startsWith("[SYSTEM]") ? "Coordinator" : "Metric Analyzer",
                message: logLine.replace(/^\[[A-Za-z0-9\s_-]+\]\s*/i, ""),
                timestamp: `Step ${logIdx + 1}`
              }));

              const analysisReport = {
                title: selectedVideoFile.name,
                overall_summary: "The active timeline contains parsed narrative beats, detailing dialogue bubbles and emotional tracking. Select individual beats to check metrics.",
                scenes: parsedBeats,
                average_tension: avgT,
                average_suspense: avgS,
                average_anticipation: avgA,
                pacing_dynamics: pacing,
                agent_logs,
                model_used: modelName,
                is_llm: true
              };

              const finalProject = {
                ...project,
                scenes: [
                  {
                    ...project.scenes[0],
                    analysisReport: analysisReport
                  }
                ],
                characters: updatedCharacters
              };

              setAnalysisProgress(100);
              setAnalysisLogs(prev => [...prev, `[SYSTEM] Multimodal analysis and visual headshot extraction complete! (Powered by: ${modelName})`]);
              setPendingAnalysisProject(finalProject);
              setIsAnalyzing(false);
              setIsAnalysisComplete(true);
              toast.success("AI Analysis and headshot extraction complete!");
            };

            void processAvatars();
          } catch (e: any) {
            const parseErr = e instanceof Error ? e.message : 'Error post-processing project schema';
            setAnalysisLogs(prev => [...prev, `[ERROR] AI Analysis schema parsing failed: ${parseErr}`]);
            setIsAnalyzing(false);
            toast.error(`Schema error: ${parseErr}`);
          }
        }
        return;
      }

      const step = steps[currentIdx];
      setTimeout(() => {
        setAnalysisProgress(step.percent);
        setAnalysisLogs(prev => [...prev, step.log]);
        currentIdx++;
        runNextStep();
      }, step.delay);
    };

    runNextStep();
  }, [selectedVideoFile, isAnalyzing, videoDuration, videoObjectURL, fps, analysisModelChoice, currentUser, activeSceneId, scenes, updateClip, updateScene]);

  return {
    selectedVideoFile,
    setSelectedVideoFile,
    videoObjectURL,
    setVideoObjectURL,
    isAnalyzing,
    setIsAnalyzing,
    analysisProgress,
    setAnalysisProgress,
    analysisLogs,
    setAnalysisLogs,
    isAnalysisComplete,
    setIsAnalysisComplete,
    pendingAnalysisProject,
    setPendingAnalysisProject,
    showDevJson,
    setShowDevJson,
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
    graphTracksInActiveScene,
    runVideoAnalysis,
  };
}
