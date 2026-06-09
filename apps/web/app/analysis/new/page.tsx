'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { 
  Sparkles, 
  UploadCloud, 
  Loader2, 
  Terminal, 
  FileVideo, 
  Trash2, 
  ChevronLeft, 
  Settings, 
  Activity, 
  Database,
  ArrowRight,
  Layers,
  Users,
  Film,
  Plus,
  X
} from 'lucide-react';
import { Button } from '@storyboard/ui';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useTimeline, type TimelineProjectJson } from '@/lib/timeline-context';
import { saveBlob } from '@/lib/db';
import { 
  captureVideoAnalysisFrames, 
  extractCharacterAvatarFromVideo, 
  extractBeatThumbnailFromVideo 
} from '@/lib/video-helpers';
import ThemeToggle from '@/components/ThemeToggle';
import LogoMark from '@/components/LogoMark';

async function localUpload(filename: string, file: Blob): Promise<{ pathname: string }> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('filename', filename);
  const uploadRes = await fetch('/api/scenes/media-upload', {
    method: 'POST',
    body: formData,
  });
  if (uploadRes.ok) {
    const data = await uploadRes.json();
    return { pathname: data.pathname };
  }
  throw new Error("Local upload failed");
}

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

type AnalysisMetricDraft = {
  id: string;
  name: string;
  description: string;
};

const DEFAULT_ANALYSIS_METRICS: AnalysisMetricDraft[] = [
  {
    id: 'metric-tension',
    name: 'Tension',
    description: 'Sense of strain, pressure, anticipation, or unease in the moment.',
  },
  {
    id: 'metric-suspense',
    name: 'Suspense',
    description: 'Withholding of information, ticking clocks, and anticipation of outcome.',
  },
  {
    id: 'metric-stakes',
    name: 'Stakes',
    description: 'How much is at risk for the characters or situation right now.',
  },
];

const createMetricDraft = (): AnalysisMetricDraft => ({
  id: `metric-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  name: '',
  description: '',
});

const getUsableMetricDrafts = (metrics: AnalysisMetricDraft[]) => (
  metrics
    .map(metric => ({
      name: metric.name.trim(),
      description: metric.description.trim(),
    }))
    .filter(metric => metric.name.length > 0)
);

const slugifyMetricId = (value: string) => (
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'metric'
);

export default function NewAnalysisPage() {
  const router = useRouter();
  const { currentUser, isAuthChecking } = useTimeline();

  // Redirect unauthenticated guest users
  React.useEffect(() => {
    if (!isAuthChecking && !currentUser) {
      toast.error('You must be logged in to run a new analysis.', { id: 'auth-redirect-toast' });
      router.push('/');
    }
  }, [isAuthChecking, currentUser, router]);

  // Video and settings states
  const [selectedFile, setSelectedFile] = React.useState<File | null>(null);
  const [videoUrl, setVideoUrl] = React.useState<string>('');
  const [duration, setDuration] = React.useState<number>(0);
  const [model, setModel] = React.useState<'gemini' | 'gemma'>('gemini');
  
  const [analysisMetrics, setAnalysisMetrics] = React.useState<AnalysisMetricDraft[]>(DEFAULT_ANALYSIS_METRICS);

  // Analysis state
  const [isAnalyzing, setIsAnalyzing] = React.useState(false);
  const [progress, setProgress] = React.useState(0);
  const [logs, setLogs] = React.useState<string[]>([]);
  const [isComplete, setIsComplete] = React.useState(false);
  const [projectData, setProjectData] = React.useState<any>(null);

  // Scene saving state
  const [sceneName, setSceneName] = React.useState('');
  const [isSaving, setIsSaving] = React.useState(false);

  // Handle file select
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const sanitizedName = file.name.replace(/[^a-zA-Z0-9._-]/g, '-');
      const sanitizedFile = new File([file], sanitizedName, { type: file.type });
      setSelectedFile(sanitizedFile);
      const url = URL.createObjectURL(sanitizedFile);
      setVideoUrl(url);
      setIsComplete(false);
      setProjectData(null);
      setLogs([]);
      setProgress(0);

      // Pre-fill scene name
      const nameWithoutExt = sanitizedName.substring(0, sanitizedName.lastIndexOf('.')) || sanitizedName;
      setSceneName(nameWithoutExt.replace(/[-_]+/g, ' '));
      
      const tempVideo = document.createElement('video');
      tempVideo.preload = 'metadata';
      tempVideo.onloadedmetadata = () => {
        setDuration(tempVideo.duration);
      };
      tempVideo.src = url;
    }
  };

  // Run analysis pipeline
  const runAnalysis = async () => {
    if (!currentUser || currentUser.role === 'viewer') {
      toast.error('You are in read-only viewer mode. Log in as an editor or admin to analyze videos.');
      return;
    }
    if (!selectedFile || isAnalyzing) return;
    const usableMetrics = getUsableMetricDrafts(analysisMetrics);
    if (usableMetrics.length === 0) {
      toast.error('Add at least one analysis metric before running analysis.');
      return;
    }

    setIsAnalyzing(true);
    setProgress(0);
    setLogs(["[SYSTEM] Initializing multimodal AI analysis engine..."]);
    setIsComplete(false);
    setProjectData(null);

    const formData = new FormData();
    formData.append('file', selectedFile);
    formData.append('fileName', selectedFile.name);
    formData.append('duration', String(duration));
    formData.append('model', model);
    formData.append('analysisMetrics', JSON.stringify(usableMetrics));

    if (model === 'gemma') {
      try {
        setLogs(prev => [...prev, "[LOCAL] Sampling video frames for Gemma vision input..."]);
        const sampledFrames = await captureVideoAnalysisFrames(selectedFile);
        sampledFrames.forEach((frame, index) => {
          formData.append('analysisFrame', frame, `analysis-frame-${index + 1}.jpg`);
        });
        setLogs(prev => [...prev, `[LOCAL] ${sampledFrames.length} visual frames ready for Gemma analysis.`]);
      } catch (error: any) {
        const message = error?.message || 'Unable to prepare local visual analysis frames.';
        setLogs(prev => [...prev, `[ERROR] ${message}`]);
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

    const metricLogLabel = usableMetrics.map(metric => metric.name).join(', ');
    const steps = model === 'gemma'
      ? [
          { percent: 10, delay: 500, log: "[SYSTEM] Connecting to local Ollama analysis endpoint..." },
          { percent: 35, delay: 900, log: "[STAGE 1] Sending sampled video frames to Gemma vision..." },
          { percent: 65, delay: 1100, log: "[STAGE 2] Extracting visual narrative beats and scene text..." },
          { percent: 90, delay: 1100, log: `[STAGE 3] Building metric graphs (${metricLogLabel}) and preview notes...` }
        ]
      : [
          { percent: 10, delay: 800, log: "[SYSTEM] Connecting to AI analysis endpoint..." },
          { percent: 25, delay: 1500, log: "[STAGE 1] Uploading video to Gemini Files API (handling secure sandbox)..." },
          { percent: 45, delay: 2000, log: "[STAGE 2] Polling Files API for model ingestion & safety checks..." },
          { percent: 65, delay: 2500, log: "[STAGE 3] Running shot-boundary detection & semantic dialogue mapping..." },
          { percent: 80, delay: 2500, log: "[STAGE 4] Querying gemini-3.5-flash with structured story schema..." },
          { percent: 90, delay: 2000, log: `[STAGE 5] Generating narrative metric graphs (${metricLogLabel})...` }
        ];

    let currentIdx = 0;
    const runNextStep = () => {
      if (requestError) {
        setLogs(prev => [...prev, `[ERROR] AI Analysis failed: ${requestError}`]);
        setIsAnalyzing(false);
        toast.error(`AI Analysis failed: ${requestError}`);
        return;
      }

      if (currentIdx >= steps.length) {
        if (!isRequestDone) {
          setTimeout(runNextStep, 500);
          return;
        }

        if (requestResult) {
          try {
            const apiScene = requestResult.scenes?.[0] || {};
            const apiClips = apiScene.clips || [];
            const apiTracks = apiScene.tracks || [];
            const apiCharacters = requestResult.characters || [];
            const fps = 30;
            const videoDurationInFrames = Math.round((duration || 30) * fps);

            const videoClip = {
              id: "clip-media-video",
              name: selectedFile.name,
              type: "video" as const,
              startFrame: 0,
              duration: videoDurationInFrames,
              trackId: "track-media-layer",
              color: "bg-indigo-600",
              src: videoUrl
            };

            const BASE_TRACKS = [
              {
                id: "group-story-analytics",
                name: "Scene Analytics",
                showDialogGridItem: false,
                notePlacement: "graph" as const,
                graphUiLayout: "column" as const
              },
              {
                id: "track-media-layer",
                name: "Media Layer",
                parentId: "group-story-analytics"
              },
              {
                id: "track-verbatim-dialogue",
                name: "Verbatim Dialogue",
                parentId: "group-story-analytics"
              },
              {
                id: "track-structural-analysis",
                name: "Structural Analysis Notes",
                parentId: "group-story-analytics"
              }
            ];

            const mergedTracks = [...BASE_TRACKS];
            apiTracks.forEach((t: any) => {
              const trackCopy = {
                ...t,
                parentId: t.id === "group-story-analytics" ? undefined : "group-story-analytics"
              };
              const existingIdx = mergedTracks.findIndex(et => et.id === t.id);
              if (existingIdx >= 0) {
                mergedTracks[existingIdx] = { ...mergedTracks[existingIdx], ...trackCopy };
              } else {
                mergedTracks.push(trackCopy);
              }
            });

            const mergedClips: any[] = [videoClip];
            apiClips.forEach((c: any) => {
              if (c.id !== "clip-media-video") {
                mergedClips.push({ ...c, type: c.type as any });
              }
            });

            const BASE_CHARACTERS = [
              { id: "char-mac", name: "Mac", face_timestamp: 2.0, face_box: [15, 35, 55, 65] },
              { id: "char-jem", name: "Jem", face_timestamp: 8.5, face_box: [20, 40, 60, 60] }
            ];
            const mergedCharacters = [...BASE_CHARACTERS] as any[];
            apiCharacters.forEach((char: any) => {
              if (!mergedCharacters.some(c => c.id === char.id)) {
                mergedCharacters.push(char);
              }
            });

            const modelName = requestResult.model || "gemini-3.5-flash";
            const sceneId = `scene-${Date.now()}`;
            const project: TimelineProjectJson & { model?: string } = {
              version: 1,
              exportedAt: new Date().toISOString(),
              scenes: [
                {
                  id: sceneId,
                  name: selectedFile.name,
                  clips: mergedClips,
                  tracks: mergedTracks,
                  duration: videoDurationInFrames,
                  analysisModel: modelName
                }
              ],
              characters: mergedCharacters,
              activeSceneId: sceneId,
              model: modelName,
              collapsedTrackIds: [],
              disabledTrackIds: [],
              mutedTrackIds: [],
              config: {
                aspectRatio: '16:9',
                zoom: 5,
                fps: 30,
                addGridItemPosition: 'last',
                previewGroupLayout: 'row',
                previewSceneMode: 'active',
                previewSceneIds: [sceneId],
                previewMediaLayout: 'inset',
                analyticsOverlayStyle: 'compact',
                showNoteOverlayIcons: false,
                compactNoteOverlays: false,
                showDialogPreviewUi: true,
                showSceneTitleUi: true,
                noteTagFilter: [],
                workspaceViewMode: 'analysis'
              }
            };

            const processAvatars = async () => {
              setLogs(prev => [...prev, "[SYSTEM] Extracting high-fidelity character close ups from video frames..."]);
              const updatedCharacters = [...mergedCharacters];
              
              for (const char of updatedCharacters) {
                let timestamp = typeof char.face_timestamp === 'number' ? char.face_timestamp : 2.0;
                const boundingBox = Array.isArray(char.face_box) && char.face_box.length === 4
                  ? char.face_box
                  : undefined;

                const matchingDialogClip = mergedClips.find(clip => {
                  if (clip.type !== 'dialog') return false;
                  if (clip.characterId && clip.characterId === char.id) return true;
                  const speakerName = (clip.character || clip.name || '').toLowerCase();
                  const targetName = char.name.toLowerCase();
                  return speakerName.includes(targetName) || targetName.includes(speakerName);
                });

                if (matchingDialogClip) {
                  const midFrame = matchingDialogClip.startFrame + Math.floor(matchingDialogClip.duration / 2);
                  timestamp = midFrame / fps;
                }
                
                try {
                  setLogs(prev => [...prev, `[SYSTEM] Seeking video to extract close-up headshot for character "${char.name}"...`]);
                  const croppedBlob = await extractCharacterAvatarFromVideo(selectedFile, timestamp, boundingBox);
                  const filename = `timeline-videos/char-${char.id}-${Date.now()}.png`;
                  setLogs(prev => [...prev, `[SYSTEM] Uploading "${char.name}" cropped headshot to persistent cloud storage...`]);
                  
                  const file = new File([croppedBlob], filename, { type: 'image/png' });
                  try {
                    const hostedBlob = await localUpload(filename, file);
                    char.image = `/api/scenes/media?pathname=${encodeURIComponent(hostedBlob.pathname)}`;
                    setLogs(prev => [...prev, `[SUCCESS] Persistent cloud headshot successfully created for "${char.name}"!`]);
                  } catch (uploadErr) {
                    char.image = URL.createObjectURL(croppedBlob);
                  }
                  await saveBlob(`char-${char.id}`, croppedBlob);
                } catch (avatarErr) {
                  setLogs(prev => [...prev, `[WARNING] Failed to extract custom headshot for "${char.name}", falling back to initials.`]);
                  char.image = `https://api.dicebear.com/7.x/adventurer-neutral/svg?seed=${encodeURIComponent(char.name)}`;
                }
              }

              const noteClips = mergedClips
                .filter((c) => c.type === "note" && (c.name === "Analysis" || c.tags?.includes("Analysis") || c.name.toLowerCase().includes("beat")))
                .sort((a, b) => a.startFrame - b.startFrame);

              setLogs(prev => [...prev, "[SYSTEM] Extracting visual storyboard thumbnails for each narrative beat..."]);
              for (const beat of noteClips) {
                const midFrame = beat.startFrame + Math.floor(beat.duration / 2);
                const timeStamp = midFrame / fps;

                try {
                  setLogs(prev => [...prev, `[SYSTEM] Seeking video to extract storyboard thumbnail for "${beat.name}"...`]);
                  const thumbnailBlob = await extractBeatThumbnailFromVideo(selectedFile, timeStamp);
                  const filename = `timeline-videos/beat-thumb-${beat.id}-${Date.now()}.jpg`;
                  
                  try {
                    const hostedBlob = await localUpload(filename, thumbnailBlob);
                    beat.thumbnailUrl = `/api/scenes/media?pathname=${encodeURIComponent(hostedBlob.pathname)}`;
                    setLogs(prev => [...prev, `[SUCCESS] Persistent storyboard thumbnail created for "${beat.name}"!`]);
                  } catch {
                    beat.thumbnailUrl = URL.createObjectURL(thumbnailBlob);
                  }
                  await saveBlob(`beat-thumb-${beat.id}`, thumbnailBlob);
                } catch {
                  setLogs(prev => [...prev, `[WARNING] Failed to extract custom storyboard thumbnail for "${beat.name}".`]);
                }
              }

              const tensionTrack = mergedTracks.find((t) => t.id === "graph-dramatic-tension" || t.name.toLowerCase().includes("tension"));
              const suspenseTrack = mergedTracks.find((t) => t.id === "graph-anticipatory-suspense" || t.name.toLowerCase().includes("suspense"));
              const stakesTrack = mergedTracks.find((t) => t.id === "graph-operational-stakes" || t.name.toLowerCase().includes("stakes"));

              const getGraphValueAtFrame = (track: any, frame: number) => {
                if (!track?.graph?.points || track.graph.points.length === 0) return 3;
                const sorted = [...track.graph.points].sort((a, b) => a.frame - b.frame);
                let val = sorted[0].value;
                for (const pt of sorted) {
                  if (pt.frame <= frame) val = pt.value;
                  else break;
                }
                return val;
              };

              const parsedBeats = noteClips.map((beat, idx) => {
                const start = beat.startFrame / fps;
                const end = (beat.startFrame + beat.duration) / fps;

                const overlappingClips = mergedClips.filter(
                  (c) =>
                    c.type === "dialog" &&
                    clipOverlapsFrameRange(c, beat.startFrame, beat.startFrame + beat.duration)
                );
                const speakerNames = Array.from(
                  new Set(
                    overlappingClips
                      .map((c) => c.character || updatedCharacters.find((ch) => ch.id === c.characterId)?.name || "")
                      .filter(Boolean)
                  )
                );

                const tensionVal = getGraphValueAtFrame(tensionTrack, beat.startFrame);
                const suspenseVal = getGraphValueAtFrame(suspenseTrack, beat.startFrame);
                const stakesVal = getGraphValueAtFrame(stakesTrack, beat.startFrame);

                const tension = Math.min(5, Math.max(0, Math.round(tensionVal / 2)));
                const suspense = Math.min(5, Math.max(0, Math.round(suspenseVal / 2)));
                const anticipation = Math.min(5, Math.max(0, Math.round(stakesVal / 2)));

                const tReasoning = mergedClips.find((c) => c.type === "note" && c.startFrame === beat.startFrame && c.name.toLowerCase().includes("tension"))?.description;
                const sReasoning = mergedClips.find((c) => c.type === "note" && c.startFrame === beat.startFrame && c.name.toLowerCase().includes("suspense"))?.description;
                const stReasoning = mergedClips.find((c) => c.type === "note" && c.startFrame === beat.startFrame && c.name.toLowerCase().includes("stakes"))?.description;
                const configuredMetrics = usableMetrics.map(metric => {
                  const metricId = slugifyMetricId(metric.name);
                  const track = mergedTracks.find((trackItem) => {
                    const t = trackItem as any;
                    return (
                    t.id === `graph-metric-${metricId}` ||
                    t.name.toLowerCase() === metric.name.toLowerCase() ||
                    t.graph?.label?.toLowerCase() === metric.name.toLowerCase()
                    );
                  });
                  const rawValue = getGraphValueAtFrame(track, beat.startFrame);
                  const value = Math.min(5, Math.max(0, Math.round(rawValue / 2)));
                  const reasoning = mergedClips.find((c) => (
                    c.type === "note" &&
                    c.startFrame === beat.startFrame &&
                    (
                      c.linkedGraphTrackIds?.includes(`graph-metric-${metricId}`) ||
                      c.name.toLowerCase().includes(metric.name.toLowerCase())
                    )
                  ))?.description;
                  return {
                    id: metricId,
                    name: metric.name,
                    description: metric.description,
                    value,
                    reasoning: reasoning || `${metric.name} assessed at ${value}/5.`,
                  };
                });

                return {
                  scene_number: idx + 1,
                  title: beat.name,
                  text_segment: beat.description || "",
                  summary: beat.description || "Narrative beat summary.",
                  characters: speakerNames,
                  thumbnailUrl: beat.thumbnailUrl,
                  metrics: {
                    tension,
                    suspense,
                    anticipation,
                    tension_reasoning: tReasoning || `Tension metric assessed at ${tension}/5.`,
                    suspense_reasoning: sReasoning || `Suspense metric assessed at ${suspense}/5.`,
                    anticipation_reasoning: stReasoning || `Anticipation metric assessed at ${anticipation}/5.`,
                    custom: configuredMetrics,
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
                };
              });

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
                title: selectedFile.name,
                overall_summary: "The active timeline contains parsed narrative beats, detailing dialogue bubbles and emotional tracking. Select individual beats to check metrics.",
                scenes: parsedBeats,
                metric_definitions: usableMetrics.map(metric => ({
                  id: slugifyMetricId(metric.name),
                  name: metric.name,
                  description: metric.description,
                })),
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

              setProgress(100);
              setLogs(prev => [...prev, `[SYSTEM] Multimodal analysis and visual headshot extraction complete! (Powered by: ${modelName})`]);
              setProjectData(finalProject);
              setIsAnalyzing(false);
              setIsComplete(true);
              toast.success("AI Analysis and headshot extraction complete!");
            };

            void processAvatars();
          } catch (e: any) {
            const parseErr = e instanceof Error ? e.message : 'Error post-processing project schema';
            setLogs(prev => [...prev, `[ERROR] AI Analysis schema parsing failed: ${parseErr}`]);
            setIsAnalyzing(false);
            toast.error(`Schema error: ${parseErr}`);
          }
        }
        return;
      }

      const step = steps[currentIdx];
      setTimeout(() => {
        setProgress(step.percent);
        setLogs(prev => [...prev, step.log]);
        currentIdx++;
        runNextStep();
      }, step.delay);
    };

    runNextStep();
  };

  // Save project as a scene
  const commitSavedScene = async () => {
    const name = sceneName.trim();
    if (!name || isSaving || !projectData) return;

    setIsSaving(true);
    try {
      // Save local media blob reference
      if (selectedFile) {
        await saveBlob("clip-media-video", selectedFile);
      }

      // Rename first scene name inside layout JSON to match user input
      const projectCopy = JSON.parse(JSON.stringify(projectData));
      if (projectCopy.scenes[0]) {
        projectCopy.scenes[0].name = name;
        if (projectCopy.scenes[0].analysisReport) {
          projectCopy.scenes[0].analysisReport.title = name;
        }
      }

      const response = await fetch('/api/scenes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, project: projectCopy }),
      });
      const result = await response.json().catch(() => ({}));
      
      if (!response.ok || !result.scene) {
        throw new Error(result.error || 'Failed to save the scene.');
      }
      
      toast.success(`Scene "${name}" saved successfully! Opening dashboard...`);
      router.push(`/analysis?sceneId=${result.scene.id}`);
    } catch (err: any) {
      toast.error(err.message || 'Unable to save the scene.');
      setIsSaving(false);
    }
  };

  if (isAuthChecking || !currentUser) {
    return (
      <div className="flex h-screen items-center justify-center bg-zinc-50 dark:bg-[#0a0a0b] text-zinc-500 dark:text-zinc-400 font-mono">
        <Loader2 className="h-5 w-5 animate-spin mr-2 text-indigo-650 dark:text-indigo-400" />
        Verifying Session...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-[#0a0a0b] text-zinc-850 dark:text-zinc-100 flex flex-col font-sans selection:bg-indigo-500/30 relative overflow-hidden">
      {/* Background Decorative Glow */}
      <div className="absolute top-[-10%] left-[-20%] w-[60vw] h-[60vw] rounded-full bg-gradient-to-br from-indigo-600/5 dark:from-indigo-600/10 via-transparent to-transparent blur-3xl pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-20%] w-[60vw] h-[60vw] rounded-full bg-gradient-to-tl from-violet-600/5 dark:from-violet-600/10 via-transparent to-transparent blur-3xl pointer-events-none" />

      {/* Header */}
      <header className="h-16 border-b border-zinc-200 dark:border-zinc-900 bg-white/60 dark:bg-zinc-950/60 backdrop-blur-md flex items-center justify-between px-6 md:px-12 shrink-0 z-25 relative">
        <Link href="/" className="flex items-center gap-2 hover:opacity-90 transition-opacity">
          <LogoMark className="h-10 w-10" />
          <span className="font-coiny text-lg text-zinc-800 dark:text-zinc-100 tracking-wide leading-none mt-0.5">Storyboard <span className="text-indigo-600 dark:text-indigo-400">Workbench</span></span>
        </Link>
        <div className="flex items-center gap-3">
          <ThemeToggle />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push('/')}
            className="text-xs font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-white border border-transparent hover:border-zinc-250 dark:hover:border-zinc-850 rounded-md"
          >
            <ChevronLeft className="h-4 w-4 mr-1" />
            Home
          </Button>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 flex flex-col justify-start max-w-6xl w-full mx-auto px-6 py-10 z-10 overflow-y-auto relative">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-10 border-b border-zinc-200 dark:border-zinc-900 pb-6">
          <div>
            <div className="inline-flex items-center gap-1.5 rounded-full border border-indigo-500/20 bg-indigo-500/5 px-3 py-0.5 text-[9px] font-black uppercase tracking-widest text-indigo-650 dark:text-indigo-400 mb-2 font-mono">
              <Sparkles className="h-3 w-3" />
              Analysis Engine Studio
            </div>
            <h1 className="text-2xl md:text-3xl font-extrabold text-zinc-900 dark:text-white tracking-tight">Run New AI Video Analysis</h1>
            <p className="text-xs text-zinc-605 dark:text-zinc-400 mt-1 max-w-xl leading-relaxed">
              Upload a scene video to automatically map dynamic tension graphs, isolate dialogue scripts, and crop facial headshots. No other saved scene details are loaded here.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-12 gap-8 items-start">
          {/* Settings / Upload Block (Left) */}
          <div className="md:col-span-5 space-y-6">
            <div className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-880/50 rounded-2xl p-5 shadow-sm dark:shadow-2xl relative overflow-hidden backdrop-blur-md">
              <h2 className="text-xs font-bold text-zinc-800 dark:text-zinc-200 uppercase tracking-widest font-mono border-b border-zinc-200 dark:border-zinc-900 pb-3.5 mb-4 flex items-center gap-2">
                <Settings className="w-3.5 h-3.5 text-indigo-500 dark:text-indigo-400" />
                Configure Session
              </h2>

              {!selectedFile ? (
                <div className="space-y-4">
                  <div className="rounded-md border border-zinc-200 dark:border-zinc-900 bg-zinc-100/50 dark:bg-zinc-900/10 p-3 text-center">
                    <p className="text-[10px] text-zinc-500 dark:text-zinc-550 leading-relaxed font-sans">
                      Select or drag in a scene recording to initialize the visual extraction hooks.
                    </p>
                  </div>

                  <label className="flex flex-col items-center justify-center h-48 rounded-xl border-2 border-dashed border-zinc-200 dark:border-zinc-800 bg-zinc-100/30 dark:bg-zinc-900/5 hover:bg-zinc-100/80 dark:hover:bg-zinc-900/20 hover:border-indigo-500/50 cursor-pointer transition-all group overflow-hidden relative">
                    <div className="w-11 h-11 rounded-full bg-zinc-100 dark:bg-zinc-900 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform border border-zinc-200 dark:border-zinc-800">
                      <UploadCloud className="w-5 h-5 text-indigo-555 dark:text-indigo-400" />
                    </div>
                    <span className="text-[9.5px] font-black tracking-widest uppercase text-zinc-550 dark:text-zinc-500 group-hover:text-zinc-800 dark:group-hover:text-zinc-350">Select Video File</span>
                    <span className="text-[8px] text-zinc-450 dark:text-zinc-650 mt-1 uppercase font-mono">MP4, WEBM up to 100MB</span>
                    <input 
                      type="file" 
                      accept="video/*" 
                      className="hidden" 
                      onChange={handleFileChange} 
                    />
                  </label>
                </div>
              ) : (
                <div className="space-y-5">
                  <div className="rounded-xl border border-zinc-200 dark:border-zinc-880 bg-zinc-50 dark:bg-zinc-900/30 p-3 flex flex-col gap-3">
                    <div className="relative aspect-video rounded-lg overflow-hidden bg-black border border-zinc-200 dark:border-zinc-900 shadow flex items-center justify-center">
                      <video src={videoUrl} className="w-full h-full object-contain" controls preload="metadata" />
                    </div>

                    <div className="flex items-center justify-between gap-3 px-1">
                      <div className="min-w-0 flex-1">
                        <div className="text-[10px] font-bold text-zinc-805 dark:text-zinc-200 truncate font-mono">{selectedFile.name}</div>
                        <div className="text-[8px] font-mono text-zinc-500 mt-0.5 uppercase">
                          {(selectedFile.size / (1024 * 1024)).toFixed(2)} MB • {duration > 0 ? `${duration.toFixed(1)}s` : 'Calculating duration...'}
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-zinc-500 hover:text-red-650 dark:hover:text-red-400 hover:bg-red-500/10 dark:hover:bg-red-400/10 shrink-0 border border-zinc-200 dark:border-zinc-900/60 rounded-full"
                        disabled={isAnalyzing}
                        onClick={() => {
                          setSelectedFile(null);
                          if (videoUrl) {
                            URL.revokeObjectURL(videoUrl);
                            setVideoUrl('');
                          }
                          setIsComplete(false);
                          setProjectData(null);
                        }}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>

                  {/* Model settings */}
                  <div className="space-y-2.5">
                    <h5 className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest px-1 font-mono">AI Model Model Choice</h5>
                    <div className="grid grid-cols-2 gap-1 rounded border border-zinc-200 dark:border-zinc-900 bg-zinc-100 dark:bg-zinc-950 p-0.5">
                      <button
                        type="button"
                        disabled={isAnalyzing}
                        onClick={() => setModel('gemini')}
                        className={cn(
                          "py-1.5 rounded text-[9px] font-bold uppercase tracking-wider transition-all cursor-pointer font-mono",
                          model === 'gemini'
                            ? "bg-indigo-600 dark:bg-indigo-650 text-white shadow-sm dark:shadow-md"
                            : "text-zinc-500 dark:text-zinc-550 hover:text-zinc-800 dark:hover:text-zinc-350 hover:bg-zinc-200/50 dark:hover:bg-zinc-900/40"
                        )}
                      >
                        Gemini Cloud
                      </button>
                      <button
                        type="button"
                        disabled={isAnalyzing}
                        className={cn(
                          "py-1.5 rounded text-[9px] font-bold uppercase tracking-wider transition-all cursor-pointer font-mono",
                          model === 'gemma'
                            ? "bg-indigo-600 dark:bg-indigo-650 text-white shadow-sm dark:shadow-md"
                            : "text-zinc-500 dark:text-zinc-550 hover:text-zinc-800 dark:hover:text-zinc-350 hover:bg-zinc-200/50 dark:hover:bg-zinc-900/40"
                        )}
                        onClick={() => setModel('gemma')}
                      >
                        Gemma Local
                      </button>
                    </div>
                  </div>

                  {/* Target configuration parameters */}
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between gap-3 px-1">
                      <h5 className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest font-mono">Analysis Metrics</h5>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={isAnalyzing}
                        onClick={() => setAnalysisMetrics(prev => [...prev, createMetricDraft()])}
                        className="h-7 border-zinc-250 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-2 text-[9px] font-black uppercase tracking-widest text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-900"
                      >
                        <Plus className="mr-1.5 h-3 w-3" />
                        Add
                      </Button>
                    </div>
                    <div className="space-y-2 rounded border border-zinc-200 dark:border-zinc-900 bg-zinc-100 dark:bg-zinc-950 p-3">
                      {analysisMetrics.map((metric, index) => (
                        <div
                          key={metric.id}
                          className="rounded-lg border border-zinc-200 dark:border-zinc-850 bg-white/80 dark:bg-[#0a0a0b] p-2.5 shadow-sm"
                        >
                          <div className="flex items-start gap-2">
                            <div className="min-w-0 flex-1 space-y-2">
                              <label className="block">
                                <span className="mb-1 block text-[8px] font-black uppercase tracking-widest text-zinc-500">Metric Name</span>
                                <input
                                  type="text"
                                  value={metric.name}
                                  disabled={isAnalyzing}
                                  maxLength={48}
                                  placeholder="e.g. Moral Pressure"
                                  onChange={(event) => {
                                    const value = event.target.value;
                                    setAnalysisMetrics(prev => prev.map(item => (
                                      item.id === metric.id ? { ...item, name: value } : item
                                    )));
                                  }}
                                  className="h-8 w-full rounded border border-zinc-250 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-2 text-xs font-semibold text-zinc-800 dark:text-zinc-200 outline-none placeholder:text-zinc-400 dark:placeholder:text-zinc-700 focus:border-indigo-500"
                                />
                              </label>
                              <label className="block">
                                <span className="mb-1 block text-[8px] font-black uppercase tracking-widest text-zinc-500">Analyzer Description</span>
                                <textarea
                                  value={metric.description}
                                  disabled={isAnalyzing}
                                  maxLength={180}
                                  rows={2}
                                  placeholder="Tell the analyzer what this metric should measure."
                                  onChange={(event) => {
                                    const value = event.target.value;
                                    setAnalysisMetrics(prev => prev.map(item => (
                                      item.id === metric.id ? { ...item, description: value } : item
                                    )));
                                  }}
                                  className="w-full resize-none rounded border border-zinc-250 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-2 py-1.5 text-[10px] leading-relaxed text-zinc-700 dark:text-zinc-300 outline-none placeholder:text-zinc-400 dark:placeholder:text-zinc-700 focus:border-indigo-500"
                                />
                              </label>
                            </div>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              disabled={isAnalyzing}
                              aria-label={`Remove metric ${metric.name || index + 1}`}
                              onClick={() => setAnalysisMetrics(prev => prev.filter(item => item.id !== metric.id))}
                              className="h-7 w-7 shrink-0 rounded-full border border-zinc-200 dark:border-zinc-850 text-zinc-500 hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400"
                            >
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                      ))}
                      {analysisMetrics.length === 0 && (
                        <div className="rounded border border-dashed border-zinc-300 dark:border-zinc-800 px-3 py-4 text-center text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
                          Add at least one metric
                        </div>
                      )}
                    </div>
                  </div>

                  {!isComplete && !isAnalyzing && (
                    <Button
                      onClick={runAnalysis}
                      className="w-full bg-gradient-to-r from-indigo-650 to-violet-650 hover:from-indigo-600 hover:to-violet-600 text-white text-[10px] font-black uppercase tracking-widest h-10 shadow-lg shadow-indigo-500/10 dark:shadow-indigo-950/20 transition-all border border-indigo-500/20 cursor-pointer"
                    >
                      <Sparkles className="w-3.5 h-3.5 mr-2 animate-pulse text-indigo-300" />
                      Analyze Recording
                    </Button>
                  )}

                  {isAnalyzing && (
                    <div className="space-y-2 bg-zinc-100 dark:bg-zinc-950 p-3 rounded-xl border border-zinc-200 dark:border-zinc-900">
                      <div className="flex items-center justify-between text-[9px] font-mono font-bold text-indigo-650 dark:text-indigo-400 uppercase tracking-widest">
                        <span className="flex items-center gap-1.5">
                          <Loader2 className="w-3 h-3 animate-spin" />
                          Executing Pipeline...
                        </span>
                        <span>{progress}%</span>
                      </div>
                      
                      <div className="w-full h-1 bg-zinc-200 dark:bg-zinc-900 rounded-full overflow-hidden border border-zinc-300 dark:border-zinc-850">
                        <div 
                          className="h-full bg-gradient-to-r from-indigo-500 to-violet-500 rounded-full transition-all duration-300"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Console / Status Logs (Right) */}
          <div className="md:col-span-7 flex flex-col space-y-6">
            {!isComplete ? (
              <div className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-880/50 rounded-2xl p-5 shadow-sm dark:shadow-2xl flex flex-col min-h-[460px] relative overflow-hidden backdrop-blur-md">
                <h2 className="text-xs font-bold text-zinc-800 dark:text-zinc-200 uppercase tracking-widest font-mono border-b border-zinc-200 dark:border-zinc-900 pb-3.5 mb-4 flex items-center gap-2">
                  <Terminal className="w-3.5 h-3.5 text-indigo-500 dark:text-indigo-400" />
                  Engine Logs Console
                </h2>
                
                {logs.length === 0 ? (
                  <div className="flex-1 flex flex-col items-center justify-center text-center p-8 select-none">
                    <div className="p-4 bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-full mb-4 shadow-sm dark:shadow-lg text-zinc-500 animate-pulse">
                      <Terminal size={24} className="text-indigo-600 dark:text-indigo-400" />
                    </div>
                    <h3 className="text-xs font-bold text-zinc-700 dark:text-zinc-400 uppercase tracking-widest mb-1.5 font-mono">Console Standby</h3>
                    <p className="text-[10px] text-zinc-500 dark:text-zinc-550 max-w-xs leading-relaxed font-sans">
                      Start the analysis pipeline to output visual extraction logs, safety markers, and model parameters in real-time.
                    </p>
                  </div>
                ) : (
                  <div className="flex-1 bg-zinc-950 dark:bg-black border border-zinc-800 dark:border-zinc-900 rounded-xl p-4 font-mono text-[10px] text-zinc-300 dark:text-zinc-400 leading-relaxed overflow-y-auto h-96 scrollbar-thin scrollbar-thumb-zinc-850 select-text selection:bg-indigo-500/30">
                    {logs.map((log, idx) => (
                      <div 
                        key={idx} 
                        className={cn(
                          "mb-1 break-words",
                          log.startsWith("[ERROR]") && "text-red-400 font-bold",
                          log.startsWith("[SUCCESS]") && "text-emerald-400",
                          log.startsWith("[WARNING]") && "text-amber-400",
                          log.startsWith("[SYSTEM]") && "text-indigo-300"
                        )}
                      >
                        {log}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              // Results Commit Interface
              <div className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-880/50 rounded-2xl p-6 shadow-sm dark:shadow-2xl flex flex-col min-h-[460px] relative overflow-hidden backdrop-blur-md select-none animate-fade-in">
                <div className="absolute w-72 h-72 rounded-full bg-indigo-500/5 blur-[100px] -top-10 -right-10 pointer-events-none" />
                <div className="absolute w-72 h-72 rounded-full bg-violet-500/5 blur-[100px] -bottom-10 -left-10 pointer-events-none" />

                <h2 className="text-xs font-bold text-zinc-800 dark:text-zinc-200 uppercase tracking-widest font-mono border-b border-zinc-200 dark:border-zinc-900 pb-3.5 mb-5 flex items-center gap-2">
                  <Database className="w-3.5 h-3.5 text-indigo-500 dark:text-indigo-400" />
                  Analysis Complete: Save Scene
                </h2>

                <div className="flex-1 space-y-6 z-10">
                  <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/5 p-4 flex items-start gap-3.5">
                    <div className="p-2 bg-indigo-500/10 border border-indigo-500/20 rounded-lg text-indigo-600 dark:text-indigo-400 shadow-[0_0_12px_rgba(99,102,241,0.15)] shrink-0 mt-0.5">
                      <Film className="w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-zinc-800 dark:text-zinc-200 uppercase tracking-wide">Workspace Generated Successfully</h4>
                      <p className="text-[10px] text-zinc-600 dark:text-zinc-450 mt-1 leading-relaxed">
                        Multimodal scene segmentation complete. Check the metrics below that are mapped and ready to commit.
                      </p>
                      
                      <div className="mt-3.5 grid grid-cols-2 gap-2 text-[10.5px] font-mono uppercase text-zinc-500 dark:text-zinc-400">
                        <div className="flex items-center gap-1.5">
                          <Layers className="w-3.5 h-3.5 text-indigo-650 dark:text-indigo-400" />
                          <span>{projectData?.scenes?.[0]?.tracks?.filter((t: any) => t.type === 'graph').length || 0} Layers</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Users className="w-3.5 h-3.5 text-indigo-650 dark:text-indigo-400" />
                          <span>{projectData?.characters?.length || 0} Speakers</span>
                        </div>
                        <div className="flex items-center gap-1.5 col-span-2">
                          <Activity className="w-3.5 h-3.5 text-indigo-650 dark:text-indigo-400" />
                          <span className="truncate">Model: {projectData?.model || 'Gemini Flash'}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Form to commit/save scene */}
                  <div className="space-y-2">
                    <label htmlFor="scene-name" className="block text-[10px] font-bold uppercase tracking-widest text-zinc-500 dark:text-zinc-550">
                      Save Scene As
                    </label>
                    <input
                      id="scene-name"
                      type="text"
                      required
                      value={sceneName}
                      onChange={(e) => setSceneName(e.target.value)}
                      className="h-10 w-full rounded-md border border-zinc-250 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3.5 text-sm text-zinc-800 dark:text-zinc-200 outline-none transition-colors placeholder:text-zinc-450 dark:placeholder:text-zinc-700 focus:border-indigo-500 dark:focus:border-indigo-400"
                      placeholder="e.g. Town Square Dialogue"
                    />
                    <p className="text-[8.5px] text-zinc-500 dark:text-zinc-600 font-mono uppercase pl-0.5">
                      This will create a new scene record in your cloud library database.
                    </p>
                  </div>
                </div>

                <div className="mt-6 flex flex-col sm:flex-row gap-3 z-10">
                  <Button
                    onClick={commitSavedScene}
                    disabled={isSaving || !sceneName.trim()}
                    className="flex-1 h-10 bg-indigo-650 hover:bg-indigo-500 text-white text-xs font-black uppercase tracking-widest shadow-lg shadow-indigo-950/20"
                  >
                    {isSaving ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <>
                        Compile & Open Analysis
                        <ArrowRight className="h-4 w-4 ml-1.5" />
                      </>
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setIsComplete(false);
                      setProjectData(null);
                      setLogs([]);
                      setProgress(0);
                    }}
                    disabled={isSaving}
                    className="border-zinc-250 dark:border-zinc-800 bg-transparent hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-white text-xs font-black uppercase tracking-widest h-10 text-zinc-500 dark:text-zinc-400"
                  >
                    Discard & Retry
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="h-12 border-t border-zinc-200 dark:border-zinc-900 bg-white/60 dark:bg-zinc-950/60 backdrop-blur-md flex items-center justify-between px-6 md:px-12 text-[10px] font-mono text-zinc-500 dark:text-zinc-650 uppercase tracking-widest shrink-0 z-25 relative">
        <span>© {new Date().getFullYear()} Storyboard Workbench</span>
        <span>Nominal Engine</span>
      </footer>
    </div>
  );
}
