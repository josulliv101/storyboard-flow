import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { put } from "@vercel/blob";
import fs from "fs";
import path from "path";
import os from "os";
import { randomUUID } from "crypto";
import { jsonrepair } from "jsonrepair";
import { getAuthUser } from "@/lib/auth-store";

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

type AnalysisMetricConfig = {
  id: string;
  label: string;
  description: string;
  color: string;
  shortLabel: string;
};

const DEFAULT_ANALYSIS_METRICS: AnalysisMetricConfig[] = [
  {
    id: "tension",
    label: "Tension",
    description: "Sense of strain, pressure, anticipation, or unease in the moment.",
    color: "#ec2727",
    shortLabel: "T",
  },
  {
    id: "suspense",
    label: "Suspense",
    description: "Withholding of information, ticking clocks, and anticipation of outcome.",
    color: "#32c0ec",
    shortLabel: "S",
  },
  {
    id: "stakes",
    label: "Stakes",
    description: "How much is at risk for the characters or situation right now.",
    color: "#27be45",
    shortLabel: "ST",
  },
];

const METRIC_COLORS = ["#ec2727", "#32c0ec", "#27be45", "#a855f7", "#f59e0b", "#14b8a6", "#f97316", "#e879f9"];

const slugifyMetricId = (value: string) => {
  const slug = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return slug || "metric";
};

const normalizeMetricConfigs = (input: unknown): AnalysisMetricConfig[] => {
  const rawItems = Array.isArray(input) ? input : [];
  const seenIds = new Set<string>();
  const metrics = rawItems
    .map((item, index) => {
      if (!item || typeof item !== "object") return null;
      const record = item as { name?: unknown; label?: unknown; description?: unknown };
      const label = String(record.name || record.label || "").trim().slice(0, 48);
      if (!label) return null;
      const baseId = slugifyMetricId(label);
      let id = baseId;
      let suffix = 2;
      while (seenIds.has(id)) {
        id = `${baseId}_${suffix}`;
        suffix += 1;
      }
      seenIds.add(id);
      return {
        id,
        label,
        description: String(record.description || "").trim().slice(0, 220),
        color: METRIC_COLORS[index % METRIC_COLORS.length],
        shortLabel: label.split(/\s+/).map(part => part[0]).join("").slice(0, 3).toUpperCase() || "M",
      };
    })
    .filter((metric): metric is AnalysisMetricConfig => Boolean(metric))
    .slice(0, 8);

  return metrics.length > 0 ? metrics : DEFAULT_ANALYSIS_METRICS;
};

const parseAnalysisMetrics = (value: unknown) => {
  if (Array.isArray(value)) return normalizeMetricConfigs(value);
  if (typeof value !== "string" || !value.trim()) return DEFAULT_ANALYSIS_METRICS;
  try {
    return normalizeMetricConfigs(JSON.parse(value));
  } catch {
    return DEFAULT_ANALYSIS_METRICS;
  }
};

const getSegmentMetric = (segment: any, metric: AnalysisMetricConfig) => {
  const candidates = [
    metric.id,
    metric.label,
    slugifyMetricId(metric.label),
    metric.label.toLowerCase(),
  ];
  for (const key of candidates) {
    const value = segment?.[key];
    if (value && typeof value === "object" && typeof value.value === "number") return value;
  }
  return undefined;
};

const getMetricTrackId = (metric: AnalysisMetricConfig) => `graph-metric-${metric.id}`;

const getMetricPromptLines = (metrics: AnalysisMetricConfig[]) => (
  metrics.map(metric => `- "${metric.id}" (${metric.label}): ${metric.description || `Evaluate ${metric.label}.`}`).join("\n")
);

const getMetricJsonExample = (metrics: AnalysisMetricConfig[]) => (
  metrics
    .slice(0, 2)
    .map((metric, index) => `    "${metric.id}": { "value": ${index === 0 ? 4 : 3}, "reason": "${metric.label} shifts because of visible story pressure." },`)
    .join("\n")
);

function createDynamicFallback(fileName: string, durationInSeconds: number, durationInFrames: number, metrics: AnalysisMetricConfig[] = DEFAULT_ANALYSIS_METRICS) {
  const expoEnd = Math.round(durationInFrames * 0.2);
  const incidentEnd = Math.round(durationInFrames * 0.35);
  const risingEnd = Math.round(durationInFrames * 0.75);
  const climaxEnd = Math.round(durationInFrames * 0.90);
  const resolutionEnd = durationInFrames;

  const baseName = fileName.replace(/\.[^/.]+$/, ""); // strip extension for display

  const clips = [
    {
      id: "clip-analysis-note-expo",
      name: "Exposition Beat",
      description: `Introduction to the world of "${baseName}". Visual framing sets the narrative tone.`,
      type: "note" as const,
      startFrame: 0,
      duration: expoEnd,
      trackId: "track-structural-analysis",
      color: "bg-blue-600",
      layoutType: "overlay" as const,
      anchorPoint: "bottom" as const,
      tags: ["EXPOSITION", "INTRO"]
    },
    {
      id: "clip-analysis-note-incident",
      name: "Inciting Incident",
      description: `A critical event disrupts the status quo in "${baseName}", initiating the core conflict.`,
      type: "note" as const,
      startFrame: expoEnd,
      duration: incidentEnd - expoEnd,
      trackId: "track-structural-analysis",
      color: "bg-amber-600",
      layoutType: "overlay" as const,
      anchorPoint: "bottom" as const,
      tags: ["INCITING_INCIDENT", "DISRUPTION"]
    },
    {
      id: "clip-analysis-note-rising",
      name: "Rising Action Beat",
      description: `Obstacles multiply as ${metrics.map(metric => metric.label).slice(0, 2).join(" and ") || "story pressure"} builds.`,
      type: "note" as const,
      startFrame: incidentEnd,
      duration: risingEnd - incidentEnd,
      trackId: "track-structural-analysis",
      color: "bg-purple-600",
      layoutType: "overlay" as const,
      anchorPoint: "bottom" as const,
      tags: ["RISING_ACTION", "STAKES"]
    },
    {
      id: "clip-analysis-note-climax",
      name: "Narrative Climax",
      description: `The highest point of confrontation and emotional valence in "${baseName}". The conflict reaches its peak.`,
      type: "note" as const,
      startFrame: risingEnd,
      duration: climaxEnd - risingEnd,
      trackId: "track-structural-analysis",
      color: "bg-red-600",
      layoutType: "overlay" as const,
      anchorPoint: "bottom" as const,
      tags: ["CLIMAX", "PEAK"]
    },
    {
      id: "clip-analysis-note-resolution",
      name: "Resolution & Outcome",
      description: "The aftermath of the climax. Narrative threads are resolved, establishing a new equilibrium.",
      type: "note" as const,
      startFrame: climaxEnd,
      duration: resolutionEnd - climaxEnd,
      trackId: "track-structural-analysis",
      color: "bg-emerald-600",
      layoutType: "overlay" as const,
      anchorPoint: "bottom" as const,
      tags: ["RESOLUTION", "OUTCOME"]
    },
    {
      id: "clip-dialogue-fallback-1",
      name: "Alright, let's look at this footage from " + baseName + ". There's something important we need to see.",
      description: "Protagonist introduces the scene and sets the narrative tone.",
      type: "dialog" as const,
      startFrame: Math.round(durationInFrames * 0.1),
      duration: Math.round(durationInFrames * 0.12),
      trackId: "track-verbatim-dialogue",
      color: "bg-purple-600",
      layoutType: "overlay" as const,
      anchorPoint: "bottom" as const,
      tags: ["DIALOGUE", "TRANSCRIPT"],
      characterId: "char-protagonist"
    },
    {
      id: "clip-dialogue-fallback-2",
      name: "I don't know about this. Are you sure we want to proceed with the analysis of " + baseName + "?",
      description: "Supporting character expresses doubt about the plan.",
      type: "dialog" as const,
      startFrame: Math.round(durationInFrames * 0.45),
      duration: Math.round(durationInFrames * 0.1),
      trackId: "track-verbatim-dialogue",
      color: "bg-purple-600",
      layoutType: "overlay" as const,
      anchorPoint: "bottom" as const,
      tags: ["DIALOGUE", "TRANSCRIPT"],
      characterId: "char-supporting"
    },
    {
      id: "clip-dialogue-fallback-3",
      name: "We've come too far to turn back now. Look at these story spikes!",
      description: "Protagonist resolves to finish the analysis.",
      type: "dialog" as const,
      startFrame: Math.round(durationInFrames * 0.78),
      duration: Math.round(durationInFrames * 0.08),
      trackId: "track-verbatim-dialogue",
      color: "bg-purple-600",
      layoutType: "overlay" as const,
      anchorPoint: "bottom" as const,
      tags: ["DIALOGUE", "TRANSCRIPT"],
      characterId: "char-protagonist"
    }
  ];

  const tracks = [
    {
      id: "group-story-analytics",
      name: "Scene Analytics",
      showDialogGridItem: false,
      notePlacement: "graph",
      graphUiLayout: "column"
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
    },
    ...metrics.map((metric, index) => {
      const offset = index % 3;
      return {
        id: getMetricTrackId(metric),
        name: metric.label,
        parentId: "group-story-analytics",
        type: "graph" as const,
        graph: {
          type: "line" as const,
          label: metric.label,
          min: 0,
          max: 10,
          increment: 1,
          barIntervalSeconds: 0.5,
          showValue: true,
          color: metric.color,
          points: [
            { frame: 0, value: Math.max(1, 2 - offset) },
            { frame: expoEnd, value: 3 + offset },
            { frame: incidentEnd, value: 5 + offset },
            { frame: risingEnd, value: 8 },
            { frame: climaxEnd, value: Math.max(2, 5 - offset) },
            { frame: resolutionEnd, value: Math.max(1, 2 - offset) }
          ],
          shortLabel: metric.shortLabel,
          noteDurationSeconds: 3
        }
      };
    })
  ];

  return {
    scenes: [
      {
        clips: clips,
        tracks: tracks
      }
    ],
    characters: [
      { id: "char-mac", name: "Mac", face_timestamp: 2.0, face_box: [15, 35, 55, 65] },
      { id: "char-jem", name: "Jem", face_timestamp: 8.5, face_box: [20, 40, 60, 60] },
      { id: "char-protagonist", name: "Protagonist", face_timestamp: 4.0, face_box: [10, 30, 50, 70] },
      { id: "char-supporting", name: "Supporting Character", face_timestamp: 12.0, face_box: [25, 35, 65, 65] }
    ]
  };
}

function convertSegmentsToWorkspace(
  segments: any[],
  fileName: string,
  durationInSeconds: number,
  durationInFrames: number,
  metrics: AnalysisMetricConfig[] = DEFAULT_ANALYSIS_METRICS,
) {
  const baseName = fileName.replace(/\.[^/.]+$/, ""); // strip extension

  const charactersMap = new Map<string, string>();
  charactersMap.set("Mac", "char-mac");
  charactersMap.set("Jem", "char-jem");

  const characters = [
    { id: "char-mac", name: "Mac", face_timestamp: 2.0, face_box: [15, 35, 55, 65] },
    { id: "char-jem", name: "Jem", face_timestamp: 8.5, face_box: [20, 40, 60, 60] }
  ];

  const clips: any[] = [];
  
  const metricPoints = new Map(metrics.map(metric => [metric.id, [] as any[]]));

  if (Array.isArray(segments)) {
    segments.forEach((segment, index) => {
      const startSec = typeof segment.start === 'number' ? segment.start : 0;
      const endSec = typeof segment.end === 'number' ? segment.end : durationInSeconds;
      const startFrame = Math.round(startSec * 30);
      const duration = Math.max(1, Math.round((endSec - startSec) * 30));

      // Graph points
      metrics.forEach(metric => {
        const segmentMetric = getSegmentMetric(segment, metric);
        if (typeof segmentMetric?.value === 'number') {
          const points = metricPoints.get(metric.id);
          points?.push({ frame: startFrame, value: segmentMetric.value });
          points?.push({ frame: startFrame + duration, value: segmentMetric.value });
        }
      });

      // 1. General Analysis Clip
      if (segment.analysis) {
        clips.push({
          id: `clip-analysis-${index}`,
          name: "Analysis",
          description: segment.analysis,
          type: "note",
          startFrame,
          duration,
          trackId: "track-structural-analysis",
          color: "bg-amber-600",
          layoutType: "overlay",
          anchorPoint: "bottom",
          tags: ["Analysis"]
        });
      }

      metrics.forEach(metric => {
        const segmentMetric = getSegmentMetric(segment, metric);
        if (segmentMetric?.reason) {
          clips.push({
            id: `clip-metric-${metric.id}-${index}`,
            name: `${metric.label} Reasoning`,
            description: segmentMetric.reason,
            type: "note",
            startFrame,
            duration,
            trackId: "track-structural-analysis",
            color: "bg-indigo-600",
            layoutType: "overlay",
            anchorPoint: "bottom",
            linkedGraphTrackIds: [getMetricTrackId(metric)],
            tags: [metric.label]
          });
        }
      });

      // 5. Audio Note Clip
      if (segment.audio) {
        clips.push({
          id: `clip-audio-${index}`,
          name: "Audio Notes",
          description: segment.audio,
          type: "note",
          startFrame,
          duration,
          trackId: "track-structural-analysis",
          color: "bg-zinc-600",
          layoutType: "overlay",
          anchorPoint: "bottom",
          tags: ["Audio"]
        });
      }

      // 6. Story Elements Note Clips
      if (Array.isArray(segment.story_elements)) {
        segment.story_elements.forEach((element: any, elementIdx: number) => {
          clips.push({
            id: `clip-story-${index}-${elementIdx}`,
            name: `Story: ${element.type}`,
            description: element.description,
            type: "note",
            startFrame,
            duration,
            trackId: "track-structural-analysis",
            color: "bg-purple-600",
            layoutType: "overlay",
            anchorPoint: "bottom",
            tags: [element.type]
          });
        });
      }

      // 7. Events Note Clips
      if (Array.isArray(segment.events)) {
        segment.events.forEach((event: string, eventIdx: number) => {
          clips.push({
            id: `clip-event-${index}-${eventIdx}`,
            name: "Event",
            description: event,
            type: "note",
            startFrame,
            duration,
            trackId: "track-structural-analysis",
            color: "bg-blue-600",
            layoutType: "overlay",
            anchorPoint: "bottom",
            tags: ["Events"]
          });
        });
      }

      // 8. Dialog Clips
      const dialogEntries = normalizeDialogEntries(segment);
      if (dialogEntries.length > 0) {
        dialogEntries.forEach((d: any, dIdx: number) => {
          const speaker = d.speaker || "Unknown";
          let charId = charactersMap.get(speaker);
          if (!charId) {
            charId = `char-${speaker.toLowerCase().replace(/[^a-z0-9]/g, "_")}`;
            charactersMap.set(speaker, charId);
            
            const face_timestamp = typeof d.face_timestamp === 'number' ? d.face_timestamp : undefined;
            const face_box = Array.isArray(d.face_box_ymin_xmin_ymax_xmax) && d.face_box_ymin_xmin_ymax_xmax.length === 4
              ? d.face_box_ymin_xmin_ymax_xmax
              : undefined;

            characters.push({ 
              id: charId, 
              name: speaker,
              face_timestamp,
              face_box
            });
          } else {
            const charObj = characters.find(c => c.id === charId);
            if (charObj && !charObj.face_timestamp && typeof d.face_timestamp === 'number') {
              charObj.face_timestamp = d.face_timestamp;
              if (Array.isArray(d.face_box_ymin_xmin_ymax_xmax) && d.face_box_ymin_xmin_ymax_xmax.length === 4) {
                charObj.face_box = d.face_box_ymin_xmin_ymax_xmax;
              }
            }
          }

          const dialogStartSec = typeof d.start === "number" ? d.start : startSec;
          const dialogEndSec = typeof d.end === "number" ? d.end : endSec;
          const dialogStartFrame = Math.max(0, Math.round(dialogStartSec * 30));
          const dialogDuration = Math.max(1, Math.round((dialogEndSec - dialogStartSec) * 30));

          clips.push({
            id: `clip-dialogue-${index}-${dIdx}`,
            name: d.text || "...",
            description: d.description || d.text || "...",
            type: "dialog",
            startFrame: dialogStartFrame,
            duration: dialogDuration,
            trackId: "track-verbatim-dialogue",
            color: "bg-purple-600",
            layoutType: "overlay",
            anchorPoint: "bottom",
            characterId: charId,
            tags: ["Dialogue"]
          });
        });
      }
    });
  }

  const ensureBoundaryPoints = (points: any[], defaultValue: number) => {
    if (points.length === 0) {
      return [
        { frame: 0, value: defaultValue },
        { frame: durationInFrames, value: defaultValue }
      ];
    }
    const sorted = [...points].sort((a, b) => a.frame - b.frame);
    if (sorted[0].frame > 0) {
      sorted.unshift({ frame: 0, value: sorted[0].value });
    }
    if (sorted[sorted.length - 1].frame < durationInFrames) {
      sorted.push({ frame: durationInFrames, value: sorted[sorted.length - 1].value });
    }
    return sorted;
  };

  const tracks = [
    {
      id: "group-story-analytics",
      name: "Scene Analytics",
      showDialogGridItem: false,
      notePlacement: "graph",
      graphUiLayout: "column"
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
    },
    ...metrics.map((metric, index) => ({
      id: getMetricTrackId(metric),
      name: metric.label,
      parentId: "group-story-analytics",
      type: "graph" as const,
      graph: {
        type: "line" as const,
        label: metric.label,
        min: 0,
        max: 10,
        increment: 1,
        barIntervalSeconds: 0.5,
        showValue: true,
        color: metric.color,
        points: ensureBoundaryPoints(metricPoints.get(metric.id) || [], Math.max(1, Math.min(8, 4 + index))),
        shortLabel: metric.shortLabel,
        noteDurationSeconds: 3
      }
    }))
  ];

  return {
    scenes: [
      {
        clips,
        tracks
      }
    ],
    characters
  };
}

function getUsableAnalysisSegments(output: unknown, metrics: AnalysisMetricConfig[] = DEFAULT_ANALYSIS_METRICS): any[] {
  const segments = Array.isArray(output)
    ? output
    : output && typeof output === 'object' && Array.isArray((output as { segments?: unknown }).segments)
      ? (output as { segments: any[] }).segments
      : [];

  const hasContent = segments.some(segment => (
    segment &&
    typeof segment === 'object' &&
    (
      typeof segment.analysis === 'string' && segment.analysis.trim().length > 0 ||
      typeof segment.audio === 'string' && segment.audio.trim().length > 0 ||
      normalizeDialogEntries(segment).length > 0 ||
      Array.isArray(segment.events) && segment.events.length > 0 ||
      Array.isArray(segment.story_elements) && segment.story_elements.length > 0 ||
      metrics.some(metric => typeof getSegmentMetric(segment, metric)?.value === 'number')
    )
  ));

  if (!hasContent) {
    throw new Error('Local model returned no usable analysis segments.');
  }

  return segments;
}

function parseDialogString(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const speakerMatch = trimmed.match(/^([^:\n]{1,48}):\s*(.+)$/);
  if (speakerMatch) {
    return {
      speaker: speakerMatch[1].trim() || "Unknown",
      text: speakerMatch[2].trim(),
    };
  }

  return {
    speaker: "Unknown",
    text: trimmed,
  };
}

function normalizeDialogEntries(segment: any) {
  const rawSources = [
    segment.dialog,
    segment.dialogue,
    segment.dialogues,
    segment.transcript,
    segment.transcript_lines,
    segment.speech,
    segment.lines,
  ];

  const rawEntries = rawSources.flatMap((source) => {
    if (!source) return [];
    if (Array.isArray(source)) return source;
    if (typeof source === "string") return source.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    return [];
  });

  return rawEntries
    .map((entry) => {
      if (typeof entry === "string") return parseDialogString(entry);
      if (!entry || typeof entry !== "object") return null;

      const text = (
        entry.text ||
        entry.line ||
        entry.dialogue ||
        entry.dialog ||
        entry.transcript ||
        entry.caption ||
        entry.content ||
        entry.quote ||
        ""
      ).toString().trim();

      if (!text) return null;

      const description = (
        entry.description ||
        entry.analysis ||
        entry.context ||
        entry.intent ||
        entry.subtext ||
        ""
      ).toString().trim();

      return {
        ...entry,
        speaker: (
          entry.speaker ||
          entry.character ||
          entry.character_name ||
          entry.name ||
          entry.role ||
          "Unknown"
        ).toString().trim(),
        text,
        description: description || undefined,
      };
    })
    .filter(Boolean);
}

async function queryLocalGemma(
  fileName: string,
  durationInSeconds: number,
  durationInFrames: number,
  images: string[],
  metrics: AnalysisMetricConfig[] = DEFAULT_ANALYSIS_METRICS,
) {
  const ollamaUrl = process.env.OLLAMA_HOST || 'http://localhost:11434';
  
  let modelName = 'gemma';
  try {
    const tagsRes = await fetch(`${ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (tagsRes.ok) {
      const tagsData = await tagsRes.json();
      const models = tagsData.models || [];
      const gemmaModel = models.find((m: any) => m.name.toLowerCase().includes('gemma'));
      if (gemmaModel) {
        modelName = gemmaModel.name;
      } else if (models.length > 0) {
        modelName = models[0].name;
      }
    }
  } catch (e) {
    console.warn("Could not query Ollama tags, defaulting to model 'gemma'", e);
  }

  if (images.length === 0) {
    throw new Error('No sampled video frames were supplied for local visual analysis.');
  }

  const prompt = `Analyze ${images.length} chronological video frames sampled from "${fileName}" (${durationInSeconds.toFixed(2)} seconds total).
Return a JSON array of chronological scene segments covering 0 to ${durationInSeconds.toFixed(2)} seconds.
For each segment provide start, end, concise analysis, and only applicable metric objects, events, story_elements, or dialog.
Evaluate only these user-configured metrics, on a 0 to 10 scale:
${getMetricPromptLines(metrics)}
If subtitles, captions, speech bubbles, or dialogue text are visible, include EVERY readable line as a separate dialog item.
When useful, add a brief description explaining the line's intent, context, or subtext.
Do not summarize multiple dialogue lines into one item. Keep each line distinct and chronological.
Do not invent spoken transcript when dialogue is not visibly readable in the frames.
Each reason or description must be brief.`;

  const segmentSchema = {
    type: 'array',
    minItems: 1,
    items: {
      type: 'object',
      required: ['start', 'end', 'analysis'],
      properties: {
        start: { type: 'number' },
        end: { type: 'number' },
        analysis: { type: 'string' },
        ...Object.fromEntries(metrics.map(metric => [
          metric.id,
          {
            type: 'object',
            properties: { value: { type: 'number' }, reason: { type: 'string' } }
          }
        ])),
        events: { type: 'array', items: { type: 'string' } },
        story_elements: {
          type: 'array',
          items: {
            type: 'object',
            properties: { type: { type: 'string' }, description: { type: 'string' } }
          }
        },
        dialog: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              speaker: { type: 'string' },
              text: { type: 'string' },
              description: { type: 'string' },
              start: { type: 'number' },
              end: { type: 'number' }
            }
          }
        }
      }
    }
  };

  const generateRes = await fetch(`${ollamaUrl}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: modelName,
      prompt: prompt,
      images,
      stream: false,
      think: false,
      format: segmentSchema
    }),
    signal: AbortSignal.timeout(45000)
  });

  if (!generateRes.ok) {
    throw new Error(`Local model server returned status ${generateRes.status}`);
  }

  const generateData = await generateRes.json();
  const rawResponse = generateData.response;
  if (!rawResponse) {
    throw new Error("Local model returned empty response.");
  }

  let parsedGemma;
  try {
    parsedGemma = JSON.parse(rawResponse);
  } catch (err) {
    const repaired = jsonrepair(rawResponse);
    parsedGemma = JSON.parse(repaired);
  }

  return {
    modelName,
    segments: getUsableAnalysisSegments(parsedGemma, metrics),
  };
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser();
  if (!user || user.role === 'viewer') {
    return NextResponse.json({ error: 'Forbidden. Editing access required.' }, { status: 403 });
  }

  let tempFilePath = "";
  try {
    let fileType = "video/mp4"; // Default
    let duration = 0;
    let modelChoice: 'gemini' | 'gemma' = 'gemini';
    let fileName = "video.mp4";
    let localAnalysisImages: string[] = [];
    let analysisMetrics = DEFAULT_ANALYSIS_METRICS;

    const contentType = req.headers.get("content-type") || "";
    
    if (contentType.includes("application/json")) {
      const body = await req.json();
      const { uploadId, fileName: jsonFileName, mimeType, totalChunks } = body;
      duration = body.duration || 0;
      modelChoice = body.model || 'gemini';
      fileName = jsonFileName || fileName;
      analysisMetrics = parseAnalysisMetrics(body.analysisMetrics);

      if (!uploadId) return NextResponse.json({ error: "Missing uploadId" }, { status: 400 });
      
      const tempDir = os.tmpdir();
      const chunkDir = path.join(tempDir, `upload_${uploadId}`);
      
      if (!fs.existsSync(chunkDir)) {
        return NextResponse.json({ error: "Upload chunks not found" }, { status: 400 });
      }
      
      const safeFileName = fileName.replace(/[^a-zA-Z0-9.\-_]/g, '_');
      tempFilePath = path.join(tempDir, `${Date.now()}-${safeFileName}`);
      fileType = mimeType || fileType;
      
      // Stitch chunks
      const writeStream = fs.createWriteStream(tempFilePath);
      for (let i = 0; i < totalChunks; i++) {
        const chunkPath = path.join(chunkDir, `chunk_${i}`);
        if (!fs.existsSync(chunkPath)) {
          throw new Error(`Missing chunk ${i}`);
        }
        const data = fs.readFileSync(chunkPath);
        writeStream.write(data);
      }
      writeStream.end();
      
      await new Promise((resolve) => writeStream.on('finish', () => resolve(null)));
      
      // Cleanup chunks
      fs.rmSync(chunkDir, { recursive: true, force: true });
      
    } else {
      // Legacy FormData approach
      const formData = await req.formData();
      const file = (formData.get("video") || formData.get("file")) as File;
      const durationStr = formData.get('duration') as string | null;
      modelChoice = (formData.get("model") || 'gemini') as 'gemini' | 'gemma';
      analysisMetrics = parseAnalysisMetrics(formData.get("analysisMetrics"));

      if (!file) {
        return NextResponse.json({ error: "No video provided" }, { status: 400 });
      }
      
      duration = durationStr ? parseFloat(durationStr) : 0;
      fileName = file.name || fileName;
      const buffer = Buffer.from(await file.arrayBuffer());
      const tempDir = os.tmpdir();
      const safeFileName = fileName.replace(/[^a-zA-Z0-9.\-_]/g, '_');
      tempFilePath = path.join(tempDir, `${Date.now()}-${safeFileName}`);
      fileType = file.type;
      
      fs.writeFileSync(tempFilePath, buffer);

      const analysisFrames = formData.getAll('analysisFrame')
        .filter((frame): frame is File => frame instanceof File && frame.type.startsWith('image/'))
        .slice(0, 6);
      localAnalysisImages = await Promise.all(analysisFrames.map(async frame => (
        Buffer.from(await frame.arrayBuffer()).toString('base64')
      )));
    }

    const durationInSeconds = duration > 0 ? duration : 30;
    const durationInFrames = Math.round(durationInSeconds * 30);

    const apiKey = process.env.GEMINI_API_KEY;

    if (modelChoice === 'gemma') {
      // User explicitly selected local Gemma
      try {
        const localOutput = await queryLocalGemma(fileName, durationInSeconds, durationInFrames, localAnalysisImages, analysisMetrics);
        const workspaceData = convertSegmentsToWorkspace(localOutput.segments, fileName, durationInSeconds, durationInFrames, analysisMetrics);
        const hydratedWorkspace = await populateCharacterImages(workspaceData, localAnalysisImages);
        return NextResponse.json({
          ...hydratedWorkspace,
          model: `${localOutput.modelName} (local Ollama vision analysis)`
        });
      } catch (gemmaError) {
        console.warn("[GEMMA_API_FAILURE] Local model Gemma query failed. Returning dynamic generic fallback:", gemmaError);
        const dynamicFallback = createDynamicFallback(fileName, durationInSeconds, durationInFrames, analysisMetrics);
        const hydratedWorkspace = await populateCharacterImages(dynamicFallback, localAnalysisImages);
        const gemmaErrMsg = gemmaError instanceof Error ? gemmaError.message : String(gemmaError);
        return NextResponse.json({
          ...hydratedWorkspace,
          model: `local-simulation-engine (fallback: local Gemma failed [${gemmaErrMsg}])`
        });
      } finally {
        if (tempFilePath && fs.existsSync(tempFilePath)) {
          try {
            fs.unlinkSync(tempFilePath);
          } catch (unlinkErr) {}
        }
      }
    } else {
      // User selected Gemini
      if (apiKey) {
        try {
          const ai = new GoogleGenAI({ apiKey });

          console.log("Uploading file to Gemini...");
          const uploadResult = await ai.files.upload({
            file: tempFilePath,
            config: {
              mimeType: fileType,
            }
          });

          console.log(`File uploaded: ${uploadResult.name}. Waiting for processing...`);
          
          if (!uploadResult.name) {
            throw new Error("Upload succeeded but returned no file name.");
          }

          // Poll until file is READY
          let fileInfo = await ai.files.get({ name: uploadResult.name });
          while (fileInfo.state === "PROCESSING") {
            await new Promise((resolve) => setTimeout(resolve, 3000));
            fileInfo = await ai.files.get({ name: uploadResult.name });
            console.log(`Processing state: ${fileInfo.state}`);
          }

          if (fileInfo.state === "FAILED") {
            throw new Error("Video processing failed on Gemini servers.");
          }

          console.log("Video is ready. Generating narrative analysis...");

          const durationInstruction = durationInSeconds > 0 
            ? `\n\nCRITICAL REQUIRED: The video duration is exactly ${durationInSeconds.toFixed(2)} seconds. You MUST output contiguous segments until the "end" of the final segment is exactly ${durationInSeconds.toFixed(2)}. DO NOT stop early. Covering the entire video is your most important directive.`
            : "";

          const prompt = `Analyze this video scene and extract narrative cinematic metrics over time. 
Divide the entire video into chronological segments based on the ACTUAL CAMERACUTS and shot changes in the video. Do NOT just make them the same duration. The clip durations should exactly match the duration of the shots in the original uploaded scene.
Ensure no gaps in time. The last segment should end at the video's conclusion.${durationInstruction}

CRITICAL: Because this is a continuous story, your analysis for each segment MUST be cumulative. Earlier segments build the foundation for later segments. Metric changes should reflect how the story escalates or resolves based on what happened previously (e.g., tension compounding, stakes raising). DO NOT analyze each segment in isolation.

Make ALL text descriptions (reasons, events, dialog texts, and analysis) EXTREMELY succinct. No single string or array item should exceed 80 characters in length. Be brief and direct to ensure fast generation.

CRITICAL DIALOGUE REQUIREMENT: Capture every distinct spoken or visibly readable dialogue line you can detect. Do NOT summarize dialogue, merge adjacent lines, or include only the most important quote. Each line must be its own object in the segment's "dialog" array, in chronological order. If useful, add a brief "description" for the line's intent, context, or subtext. If you can estimate line timing, include "start" and "end" seconds for that specific line; otherwise omit them.

Additionally, pay close attention to the background music, audio cues, or deliberate silence/lack of music. You MUST evaluate how these auditory elements directly influence or amplify the configured metrics and mention it in the analysis or reasoning for the segments where it is impactful.

Metrics should be evaluated on a scale from 0 to 10. For each metric, provide a direct analysis/reason explaining WHY it is at that level or why it changed. Use exactly these JSON property names:
${getMetricPromptLines(analysisMetrics)}

Additionally, inside the "dialog" objects, you MUST identify the exact visual appearance of that speaker in the video frames. Find a frame where the speaker's face is clearly visible. Provide:
1. "face_timestamp": a float indicating the exact seconds timestamp in the video where the speaker's face is visible and in focus.
2. "face_box_ymin_xmin_ymax_xmax": an array of 4 integers [ymin, xmin, ymax, xmax] from 0 to 100 representing the bounding box coordinates of the speaker's face in that frame (e.g. [15, 40, 50, 70] where 15 is ymin, 40 is xmin, 50 is ymax, 70 is xmax).

IMPORTANT: Every metric graph layer and tag (story_elements, events, audio) does NOT always need to be represented in every segment. ONLY include a metric when the situation actually dictates it. For example, if a metric is not meaningfully present, omit that metric property entirely for that segment.

Also identify key structural story elements that happen in this segment (e.g., "PLOT POINT", "CHARACTER BEAT", "EXPOSITION", "REVERSAL", "FORESHADOWING"). Leave empty or omit if none apply to the specific segment.

CRITICAL: Because there is limited space, if a segment generates more than 4 notes in total across all types, you MUST determine the 4 most important notes that should be shown in the preview. Provide their keys in the "important_notes" array (e.g., ["analysis", "${analysisMetrics[0]?.id || 'metric'}", "events", "audio"]). If there are 4 or fewer total notes, just list all their keys.

Respond EXACTLY in this JSON format, purely as an array of objects. Do not include markdown code block syntax. Note that the properties other than start, end, and analysis are optional.
[
  {
    "start": 0.0,
    "end": 3.5,
${getMetricJsonExample(analysisMetrics)}
    "audio": "Soft ambient drone builds slowly in the background, contrasting silence.",
    "story_elements": [
       { "type": "EXPOSITION", "description": "Establishing the isolated setting." }
    ],
    "events": ["Character enters the room", "Looks around suspiciously"],
    "dialog": [
       { 
         "speaker": "Character Name", 
         "text": "What they said...",
         "description": "Brief intent, context, or subtext for this line.",
         "start": 1.2,
         "end": 2.4,
         "face_timestamp": 1.8,
         "face_box_ymin_xmin_ymax_xmax": [20, 35, 55, 60]
       }
    ],
    "analysis": "The scene begins quietly, establishing a mysterious atmosphere.",
    "important_notes": ["${analysisMetrics[0]?.id || 'metric'}", "audio", "events", "analysis"]
  }
]`;

          let response;
          let retries = 5;
          let delay = 3000;

          while (true) {
            try {
              response = await ai.models.generateContent({
                model: "gemini-3.5-flash",
                contents: [
                  {
                    role: "user",
                    parts: [
                      {
                        fileData: {
                          fileUri: fileInfo.uri,
                          mimeType: fileInfo.mimeType,
                        },
                      },
                      { text: prompt },
                    ],
                  },
                ],
                config: {
                  responseMimeType: "application/json",
                  maxOutputTokens: 8192,
                }
              });
              break; // Success
            } catch (err: any) {
              let errString = "";
              try {
                errString = typeof err === 'object' ? JSON.stringify(err) + err?.toString() : err?.toString() || "";
              } catch(stringErr) {
                errString = err?.toString() || "";
              }
              if (
                retries > 1 && 
                (err?.status === 503 || err?.status === 529 || err?.status === 'UNAVAILABLE' || errString.includes("503") || errString.includes("529") || errString.includes("UNAVAILABLE") || errString.includes("high demand") || errString.includes("overloaded"))
              ) {
                console.warn(`Model API overloaded. Retrying in ${delay}ms... (Retries left: ${retries - 1})`);
                await new Promise(resolve => setTimeout(resolve, delay));
                retries--;
                delay *= 2;
              } else {
                throw err;
              }
            }
          }

          // Cleanup temp file
          if (tempFilePath && fs.existsSync(tempFilePath)) {
            try {
              fs.unlinkSync(tempFilePath);
            } catch (unlinkErr) {}
          }

          // Delete file from Gemini
          try {
            await ai.files.delete({ name: uploadResult.name });
          } catch (e) {
            console.error("Failed to delete file from Gemini:", e);
          }

          // Parse Response
          let jsonStr = response.text || "[]";
          
          // Strip markdown backticks
          let cleanStr = jsonStr.trim();
          if (cleanStr.startsWith('```json')) {
            cleanStr = cleanStr.substring(7);
          } else if (cleanStr.startsWith('```')) {
            cleanStr = cleanStr.substring(3);
          }
          if (cleanStr.endsWith('```')) {
            cleanStr = cleanStr.substring(0, cleanStr.length - 3);
          }
          cleanStr = cleanStr.trim();

          if (!cleanStr.startsWith('[')) {
            const firstBracket = cleanStr.indexOf('[');
            if (firstBracket !== -1) {
              cleanStr = cleanStr.substring(firstBracket);
            }
          }

          let segmentData;
          try {
            segmentData = JSON.parse(cleanStr);
          } catch (parseError: any) {
            console.error("Failed to parse clean JSON:", parseError.message);
            try {
              const repaired = jsonrepair(cleanStr);
              segmentData = JSON.parse(repaired);
            } catch (repairError) {
              console.error("jsonrepair could not fix the raw string directly:", repairError);
              if (jsonStr.trim().toLowerCase().startsWith('<!doctype') || jsonStr.trim().toLowerCase().startsWith('<html')) {
                 throw new Error("The AI generation service returned an unexpected HTML proxy error. Please try again.");
              }
              throw new Error("The AI model generated unparseable output format.");
            }
          }

          const workspaceData = convertSegmentsToWorkspace(segmentData, fileName, durationInSeconds, durationInFrames, analysisMetrics);
          const hydratedWorkspace = await populateCharacterImages(workspaceData, localAnalysisImages);
          return NextResponse.json({
            ...hydratedWorkspace,
            model: "gemini-3.5-flash (live AI multimodal analysis)"
          });

        } catch (geminiError) {
          console.warn("[GEMINI_API_FAILURE] Gemini API failed. Attempting local Gemma fallback...", geminiError);
          
          if (tempFilePath && fs.existsSync(tempFilePath)) {
            try {
              fs.unlinkSync(tempFilePath);
            } catch (unlinkErr) {}
          }

          try {
            const localOutput = await queryLocalGemma(fileName, durationInSeconds, durationInFrames, localAnalysisImages, analysisMetrics);
            const workspaceData = convertSegmentsToWorkspace(localOutput.segments, fileName, durationInSeconds, durationInFrames, analysisMetrics);
            const hydratedWorkspace = await populateCharacterImages(workspaceData, localAnalysisImages);
            return NextResponse.json({
              ...hydratedWorkspace,
              model: `${localOutput.modelName} (local Ollama fallback from Gemini)`
            });
          } catch (gemmaError) {
            console.warn("[GEMMA_API_FAILURE] Local model fallback failed. Returning dynamic generic fallback:", gemmaError);
            const dynamicFallback = createDynamicFallback(fileName, durationInSeconds, durationInFrames, analysisMetrics);
            const hydratedWorkspace = await populateCharacterImages(dynamicFallback, localAnalysisImages);
            const geminiErrMsg = geminiError instanceof Error ? geminiError.message : String(geminiError);
            const gemmaErrMsg = gemmaError instanceof Error ? gemmaError.message : String(gemmaError);
            return NextResponse.json({
              ...hydratedWorkspace,
              model: `local-simulation-engine (fallback: Gemini failed [${geminiErrMsg}] & Gemma failed [${gemmaErrMsg}])`
            });
          }
        }
      } else {
        // No API key - try local Gemma first, fallback to dynamic template
        if (tempFilePath && fs.existsSync(tempFilePath)) {
          try {
            fs.unlinkSync(tempFilePath);
          } catch (unlinkErr) {}
        }
        try {
          const localOutput = await queryLocalGemma(fileName, durationInSeconds, durationInFrames, localAnalysisImages, analysisMetrics);
          const workspaceData = convertSegmentsToWorkspace(localOutput.segments, fileName, durationInSeconds, durationInFrames, analysisMetrics);
          const hydratedWorkspace = await populateCharacterImages(workspaceData, localAnalysisImages);
          return NextResponse.json({
            ...hydratedWorkspace,
            model: `${localOutput.modelName} (local Ollama vision analysis)`
          });
        } catch (gemmaError) {
          console.warn("[GEMMA_API_FAILURE] No API key, and local model failed. Returning dynamic generic fallback:", gemmaError);
          const dynamicFallback = createDynamicFallback(fileName, durationInSeconds, durationInFrames, analysisMetrics);
          const hydratedWorkspace = await populateCharacterImages(dynamicFallback, localAnalysisImages);
          const gemmaErrMsg = gemmaError instanceof Error ? gemmaError.message : String(gemmaError);
          return NextResponse.json({
            ...hydratedWorkspace,
            model: `local-simulation-engine (fallback: no API key & Gemma failed [${gemmaErrMsg}])`
          });
        }
      }
    }
  } catch (error: any) {
    if (tempFilePath && fs.existsSync(tempFilePath)) {
      try {
        fs.unlinkSync(tempFilePath);
      } catch (unlinkErr) {}
    }
    const message = error instanceof Error ? error.message : 'Analysis failed.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function populateCharacterImages(workspace: any, localAnalysisImages?: string[]) {
  if (!workspace || !Array.isArray(workspace.characters) || workspace.characters.length === 0) return workspace;

  const charactersToDescribe = workspace.characters.filter((c: any) => !c.image);
  if (charactersToDescribe.length === 0) return workspace;

  const characterNames = charactersToDescribe.map((c: any) => c.name);
  const ai = new GoogleGenAI({});

  // 1. Query Gemini to get a physical description of these characters from the video frames (if available)
  const descriptionsMap = new Map<string, string>();
  if (localAnalysisImages && localAnalysisImages.length > 0) {
    try {
      console.log(`[AVATAR_DESC] Querying Gemini to extract physical descriptions for: ${characterNames.join(', ')}`);
      
      const frameParts = localAnalysisImages.map(base64 => ({
        inlineData: {
          mimeType: "image/jpeg",
          data: base64
        }
      }));

      const descPrompt = `Based on these chronological video frames, describe the visual appearance of the following characters who speak in the dialogue: ${characterNames.join(', ')}. For each character, provide an extremely brief 1-sentence physical description focusing on their age, gender, hair, facial features, or clothing (e.g. "a young man with short brown hair wearing a dark jacket"). Respond strictly in this JSON format: { "Character Name": "visual description..." }`;

      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: [
          {
            role: "user",
            parts: [
              ...frameParts,
              { text: descPrompt }
            ]
          }
        ],
        config: {
          responseMimeType: "application/json",
        }
      });

      const rawJson = response.text || "{}";
      console.log(`[AVATAR_DESC] Gemini returned description JSON: ${rawJson}`);
      const parsed = JSON.parse(jsonrepair(rawJson));
      
      for (const [name, desc] of Object.entries(parsed)) {
        descriptionsMap.set(name, String(desc));
      }
    } catch (descError) {
      console.error("[AVATAR_DESC_FAILED] Failed to extract character descriptions from video:", descError);
    }
  }

  // 2. For each character, generate their customized cinematic close up using Imagen 3
  for (const char of workspace.characters) {
    if (!char.image) {
      try {
        console.log(`[AVATAR_GEN] Generating customized extreme close up headshot for ${char.name}...`);
        
        let visualDescription = descriptionsMap.get(char.name) || "";
        if (visualDescription) {
          char.description = visualDescription; // Also save description in character metadata
        }

        // Build a highly tailored prompt using the character's physical description extracted from the video
        let promptDetails = "";
        if (visualDescription) {
          promptDetails = `, who looks like ${visualDescription}`;
        } else {
          promptDetails = `, dramatic portrait`;
        }

        const prompt = `Professional cinematic film frame, extreme close-up headshot of character "${char.name}"${promptDetails}, high fidelity, highly detailed, photorealistic, 4k, movie close-up, neutral background`;
        
        console.log(`[AVATAR_GEN] Prompt for Imagen: "${prompt}"`);

        const imageResponse = await ai.models.generateImages({
          model: 'imagen-3.0-generate-002',
          prompt,
          config: {
            numberOfImages: 1,
            aspectRatio: '1:1',
          }
        });

        const base64Bytes = imageResponse.generatedImages?.[0]?.image?.imageBytes;
        if (base64Bytes) {
          const buffer = Buffer.from(base64Bytes, 'base64');
          const filename = `character-avatars/${char.id}-${Date.now()}.png`;
          
          // Save to Vercel Blob (publicly, so all computers can access it!)
          const blob = await put(filename, buffer, {
            access: 'public',
            contentType: 'image/png',
          });
          
          char.image = blob.url;
          console.log(`[AVATAR_GEN] Saved ${char.name} headshot at: ${blob.url}`);
        } else {
          throw new Error('Empty image response from Imagen');
        }
      } catch (error) {
        console.error(`[AVATAR_GEN_FAILED] for ${char.name}:`, error);
        // High fidelity, persistent adventurer-neutral avatar fallback
        char.image = `https://api.dicebear.com/7.x/adventurer-neutral/svg?seed=${encodeURIComponent(char.name)}`;
      }
    }
  }

  return workspace;
}
