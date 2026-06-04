import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { put } from "@vercel/blob";
import fs from "fs";
import path from "path";
import os from "os";
import { randomUUID } from "crypto";
import { jsonrepair } from "jsonrepair";

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function createDynamicFallback(fileName: string, durationInSeconds: number, durationInFrames: number) {
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
      description: "Obstacles multiply and stakes grow higher. Anticipation and tension build up.",
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
      name: "We've come too far to turn back now. Look at these tension spikes!",
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
    {
      id: "graph-dramatic-tension",
      name: "Dramatic Tension",
      parentId: "group-story-analytics",
      type: "graph",
      graph: {
        type: "line",
        label: "Tension",
        min: 0,
        max: 10,
        increment: 1,
        barIntervalSeconds: 0.5,
        showValue: true,
        color: "#ec2727",
        points: [
          { frame: 0, value: 2 },
          { frame: expoEnd, value: 4 },
          { frame: incidentEnd, value: 5 },
          { frame: Math.round((incidentEnd + risingEnd) / 2), value: 7 },
          { frame: risingEnd, value: 9 },
          { frame: climaxEnd, value: 3 },
          { frame: resolutionEnd, value: 1 }
        ],
        shortLabel: "T",
        noteDurationSeconds: 3
      }
    },
    {
      id: "graph-anticipatory-suspense",
      name: "Anticipatory Suspense",
      parentId: "group-story-analytics",
      type: "graph",
      graph: {
        type: "line",
        label: "Suspense",
        min: 0,
        max: 10,
        increment: 1,
        barIntervalSeconds: 0.5,
        showValue: true,
        color: "#32c0ec",
        points: [
          { frame: 0, value: 1 },
          { frame: expoEnd, value: 2 },
          { frame: incidentEnd, value: 4 },
          { frame: risingEnd, value: 8 },
          { frame: climaxEnd, value: 4 },
          { frame: resolutionEnd, value: 1 }
        ],
        shortLabel: "S",
        noteDurationSeconds: 3
      }
    },
    {
      id: "graph-operational-stakes",
      name: "Stakes / Conflict",
      parentId: "group-story-analytics",
      type: "graph",
      graph: {
        type: "line",
        label: "Stakes",
        min: 0,
        max: 10,
        increment: 1,
        barIntervalSeconds: 0.5,
        showValue: true,
        color: "#27be45",
        points: [
          { frame: 0, value: 1 },
          { frame: expoEnd, value: 5 },
          { frame: incidentEnd, value: 6 },
          { frame: risingEnd, value: 8 },
          { frame: climaxEnd, value: 5 },
          { frame: resolutionEnd, value: 2 }
        ],
        shortLabel: "ST",
        noteDurationSeconds: 3
      }
    }
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

function convertSegmentsToWorkspace(segments: any[], fileName: string, durationInSeconds: number, durationInFrames: number) {
  const baseName = fileName.replace(/\.[^/.]+$/, ""); // strip extension

  const charactersMap = new Map<string, string>();
  charactersMap.set("Mac", "char-mac");
  charactersMap.set("Jem", "char-jem");

  const characters = [
    { id: "char-mac", name: "Mac", face_timestamp: 2.0, face_box: [15, 35, 55, 65] },
    { id: "char-jem", name: "Jem", face_timestamp: 8.5, face_box: [20, 40, 60, 60] }
  ];

  const clips: any[] = [];
  
  const tensionPoints: any[] = [];
  const suspensePoints: any[] = [];
  const stakesPoints: any[] = [];

  if (Array.isArray(segments)) {
    segments.forEach((segment, index) => {
      const startSec = typeof segment.start === 'number' ? segment.start : 0;
      const endSec = typeof segment.end === 'number' ? segment.end : durationInSeconds;
      const startFrame = Math.round(startSec * 30);
      const duration = Math.max(1, Math.round((endSec - startSec) * 30));

      // Graph points
      if (segment.tension && typeof segment.tension.value === 'number') {
        tensionPoints.push({ frame: startFrame, value: segment.tension.value });
        tensionPoints.push({ frame: startFrame + duration, value: segment.tension.value });
      }
      if (segment.suspense && typeof segment.suspense.value === 'number') {
        suspensePoints.push({ frame: startFrame, value: segment.suspense.value });
        suspensePoints.push({ frame: startFrame + duration, value: segment.suspense.value });
      }
      if (segment.stakes && typeof segment.stakes.value === 'number') {
        stakesPoints.push({ frame: startFrame, value: segment.stakes.value });
        stakesPoints.push({ frame: startFrame + duration, value: segment.stakes.value });
      }

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

      // 2. Tension Reasoning Note Clip
      if (segment.tension?.reason) {
        clips.push({
          id: `clip-tension-${index}`,
          name: "Tension Reasoning",
          description: segment.tension.reason,
          type: "note",
          startFrame,
          duration,
          trackId: "track-structural-analysis",
          color: "bg-red-600",
          layoutType: "overlay",
          anchorPoint: "bottom",
          linkedGraphTrackIds: ["graph-dramatic-tension"],
          tags: ["Tension"]
        });
      }

      // 3. Suspense Reasoning Note Clip
      if (segment.suspense?.reason) {
        clips.push({
          id: `clip-suspense-${index}`,
          name: "Suspense Reasoning",
          description: segment.suspense.reason,
          type: "note",
          startFrame,
          duration,
          trackId: "track-structural-analysis",
          color: "bg-amber-500",
          layoutType: "overlay",
          anchorPoint: "bottom",
          linkedGraphTrackIds: ["graph-anticipatory-suspense"],
          tags: ["Suspense"]
        });
      }

      // 4. Stakes Reasoning Note Clip
      if (segment.stakes?.reason) {
        clips.push({
          id: `clip-stakes-${index}`,
          name: "Stakes Reasoning",
          description: segment.stakes.reason,
          type: "note",
          startFrame,
          duration,
          trackId: "track-structural-analysis",
          color: "bg-emerald-600",
          layoutType: "overlay",
          anchorPoint: "bottom",
          linkedGraphTrackIds: ["graph-operational-stakes"],
          tags: ["Stakes"]
        });
      }

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
      if (Array.isArray(segment.dialog)) {
        segment.dialog.forEach((d: any, dIdx: number) => {
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

          clips.push({
            id: `clip-dialogue-${index}-${dIdx}`,
            name: d.text || "...",
            type: "dialog",
            startFrame,
            duration,
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
    {
      id: "graph-dramatic-tension",
      name: "Dramatic Tension",
      parentId: "group-story-analytics",
      type: "graph",
      graph: {
        type: "line",
        label: "Tension",
        min: 0,
        max: 10,
        increment: 1,
        barIntervalSeconds: 0.5,
        showValue: true,
        color: "#ec2727",
        points: ensureBoundaryPoints(tensionPoints, 4),
        shortLabel: "T",
        noteDurationSeconds: 3
      }
    },
    {
      id: "graph-anticipatory-suspense",
      name: "Anticipatory Suspense",
      parentId: "group-story-analytics",
      type: "graph",
      graph: {
        type: "line",
        label: "Suspense",
        min: 0,
        max: 10,
        increment: 1,
        barIntervalSeconds: 0.5,
        showValue: true,
        color: "#32c0ec",
        points: ensureBoundaryPoints(suspensePoints, 3),
        shortLabel: "S",
        noteDurationSeconds: 3
      }
    },
    {
      id: "graph-operational-stakes",
      name: "Stakes / Conflict",
      parentId: "group-story-analytics",
      type: "graph",
      graph: {
        type: "line",
        label: "Stakes",
        min: 0,
        max: 10,
        increment: 1,
        barIntervalSeconds: 0.5,
        showValue: true,
        color: "#27be45",
        points: ensureBoundaryPoints(stakesPoints, 3),
        shortLabel: "ST",
        noteDurationSeconds: 3
      }
    }
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

function getUsableAnalysisSegments(output: unknown): any[] {
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
      Array.isArray(segment.dialog) && segment.dialog.length > 0 ||
      Array.isArray(segment.events) && segment.events.length > 0 ||
      Array.isArray(segment.story_elements) && segment.story_elements.length > 0 ||
      typeof segment.tension?.value === 'number' ||
      typeof segment.suspense?.value === 'number' ||
      typeof segment.stakes?.value === 'number'
    )
  ));

  if (!hasContent) {
    throw new Error('Local model returned no usable analysis segments.');
  }

  return segments;
}

async function queryLocalGemma(
  fileName: string,
  durationInSeconds: number,
  durationInFrames: number,
  images: string[],
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
For each segment provide start, end, concise analysis, and only applicable tension, suspense, stakes, events, story_elements, or dialog.
If subtitles, captions, speech bubbles, or dialogue text are visible, include dialog entries with that readable text and any visible speaker name.
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
        tension: {
          type: 'object',
          properties: { value: { type: 'number' }, reason: { type: 'string' } }
        },
        suspense: {
          type: 'object',
          properties: { value: { type: 'number' }, reason: { type: 'string' } }
        },
        stakes: {
          type: 'object',
          properties: { value: { type: 'number' }, reason: { type: 'string' } }
        },
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
            properties: { speaker: { type: 'string' }, text: { type: 'string' } }
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
    segments: getUsableAnalysisSegments(parsedGemma),
  };
}

export async function POST(req: NextRequest) {
  let tempFilePath = "";
  try {
    let fileType = "video/mp4"; // Default
    let duration = 0;
    let modelChoice: 'gemini' | 'gemma' = 'gemini';
    let fileName = "video.mp4";
    let localAnalysisImages: string[] = [];

    const contentType = req.headers.get("content-type") || "";
    
    if (contentType.includes("application/json")) {
      const body = await req.json();
      const { uploadId, fileName: jsonFileName, mimeType, totalChunks } = body;
      duration = body.duration || 0;
      modelChoice = body.model || 'gemini';
      fileName = jsonFileName || fileName;

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
        const localOutput = await queryLocalGemma(fileName, durationInSeconds, durationInFrames, localAnalysisImages);
        const workspaceData = convertSegmentsToWorkspace(localOutput.segments, fileName, durationInSeconds, durationInFrames);
        const hydratedWorkspace = await populateCharacterImages(workspaceData, localAnalysisImages);
        return NextResponse.json({
          ...hydratedWorkspace,
          model: `${localOutput.modelName} (local Ollama vision analysis)`
        });
      } catch (gemmaError) {
        console.warn("[GEMMA_API_FAILURE] Local model Gemma query failed. Returning dynamic generic fallback:", gemmaError);
        const dynamicFallback = createDynamicFallback(fileName, durationInSeconds, durationInFrames);
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

Additionally, pay close attention to the background music, audio cues, or deliberate silence/lack of music. You MUST evaluate how these auditory elements directly influence or amplify the metrics (tension, suspense, etc.) and mention it in the analysis or reasoning for the segments where it is impactful.

Metrics should be evaluated on a scale from 0 to 10. For each metric, provide a direct analysis/reason explaining WHY it is at that level or why it changed:
- tension (sense of strain, anticipation, or unease)
- suspense (withholding of information, ticking clocks, anticipation of outcome)
- conflict (opposition between characters, environment, or internal struggle)
- stakes (how much is at risk in the current moment)

Additionally, inside the "dialog" objects, you MUST identify the exact visual appearance of that speaker in the video frames. Find a frame where the speaker's face is clearly visible. Provide:
1. "face_timestamp": a float indicating the exact seconds timestamp in the video where the speaker's face is visible and in focus.
2. "face_box_ymin_xmin_ymax_xmax": an array of 4 integers [ymin, xmin, ymax, xmax] from 0 to 100 representing the bounding box coordinates of the speaker's face in that frame (e.g. [15, 40, 50, 70] where 15 is ymin, 40 is xmin, 50 is ymax, 70 is xmax).

IMPORTANT: Every graph layer label (tension, suspense, conflict, stakes) and tag (story_elements, events, audio) do NOT always need to be represented in every segment. ONLY include them when the situation actually dictates it. For example, if there is no significant suspense, omit the "suspense" property entirely for that segment.

Also identify key structural story elements that happen in this segment (e.g., "PLOT POINT", "CHARACTER BEAT", "EXPOSITION", "REVERSAL", "FORESHADOWING"). Leave empty or omit if none apply to the specific segment.

CRITICAL: Because there is limited space, if a segment generates more than 4 notes in total across all types, you MUST determine the 4 most important notes that should be shown in the preview. Provide their keys in the "important_notes" array (e.g., ["analysis", "tension", "events", "audio"]). If there are 4 or fewer total notes, just list all their keys.

Respond EXACTLY in this JSON format, purely as an array of objects. Do not include markdown code block syntax. Note that the properties other than start, end, and analysis are optional.
[
  {
    "start": 0.0,
    "end": 3.5,
    "tension": { "value": 4, "reason": "Quiet atmosphere establishes a baseline unease." },
    "stakes": { "value": 3, "reason": "Personal safety is implicitly at risk in the unknown location." },
    "audio": "Soft ambient drone builds slowly in the background, contrasting silence.",
    "story_elements": [
       { "type": "EXPOSITION", "description": "Establishing the isolated setting." }
    ],
    "events": ["Character enters the room", "Looks around suspiciously"],
    "dialog": [
       { 
         "speaker": "Character Name", 
         "text": "What they said...",
         "face_timestamp": 1.8,
         "face_box_ymin_xmin_ymax_xmax": [20, 35, 55, 60]
       }
    ],
    "analysis": "The scene begins quietly, establishing a mysterious atmosphere.",
    "important_notes": ["tension", "audio", "events", "analysis"]
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

          const workspaceData = convertSegmentsToWorkspace(segmentData, fileName, durationInSeconds, durationInFrames);
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
            const localOutput = await queryLocalGemma(fileName, durationInSeconds, durationInFrames, localAnalysisImages);
            const workspaceData = convertSegmentsToWorkspace(localOutput.segments, fileName, durationInSeconds, durationInFrames);
            const hydratedWorkspace = await populateCharacterImages(workspaceData, localAnalysisImages);
            return NextResponse.json({
              ...hydratedWorkspace,
              model: `${localOutput.modelName} (local Ollama fallback from Gemini)`
            });
          } catch (gemmaError) {
            console.warn("[GEMMA_API_FAILURE] Local model fallback failed. Returning dynamic generic fallback:", gemmaError);
            const dynamicFallback = createDynamicFallback(fileName, durationInSeconds, durationInFrames);
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
          const localOutput = await queryLocalGemma(fileName, durationInSeconds, durationInFrames, localAnalysisImages);
          const workspaceData = convertSegmentsToWorkspace(localOutput.segments, fileName, durationInSeconds, durationInFrames);
          const hydratedWorkspace = await populateCharacterImages(workspaceData, localAnalysisImages);
          return NextResponse.json({
            ...hydratedWorkspace,
            model: `${localOutput.modelName} (local Ollama vision analysis)`
          });
        } catch (gemmaError) {
          console.warn("[GEMMA_API_FAILURE] No API key, and local model failed. Returning dynamic generic fallback:", gemmaError);
          const dynamicFallback = createDynamicFallback(fileName, durationInSeconds, durationInFrames);
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
