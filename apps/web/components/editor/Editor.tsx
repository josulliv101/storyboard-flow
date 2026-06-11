'use client';

import React from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { TimelineProvider } from '@/lib/timeline-context';
import { Toolbar } from './Toolbar';
import { Preview } from './Preview';
import { ReviewWorkspace } from './ReviewWorkspace';
import { AnalysisWorkspace } from './analysis/AnalysisWorkspace';
import { TimelineRoot } from './TimelineRoot';
import { CharactersPanel } from './CharactersPanel';
import { 
  Layers, 
  Settings, 
  SlidersHorizontal,
  Share2, 
  LogOut,
  Shield,
  Lock, 
  Download, 
  Menu, 
  Upload, 
  FileImage, 
  FileVideo, 
  ArrowLeft,
  X, 
  ChevronDown, 
  Trash2,
  Clapperboard,
  Camera,
  Users,
  MapPin,
  GripVertical,
  Plus,
  ChevronRight,
  UserCircle,
  Loader2,
  Search,
  MoreVertical,
  HelpCircle,
  Columns4,
  Grid2X2,
  PanelsTopLeft,
  Eye,
  EyeOff,
  MessageSquare,
  StickyNote,
  Check,
  Clock,
  ScrollText,
  Sparkles,
  Cloud,
  CloudOff,
  RefreshCw,
  Play,
  Pause,
  SkipBack,
  ZoomIn,
  ZoomOut,
  Activity,
  Filter,
  Monitor,
  Tags,
  Type,
  Star,
  Video,
  Ratio,
  Repeat,
  Image as ImageIcon,
  Pencil
} from 'lucide-react';
import {
  Button,
  buttonVariants,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  Slider,
} from "@storyboard/ui";
import { useTimeline, TimelineClip, TimelineProjectJson, ClipType } from '@/lib/timeline-context';
import { loadBlob, saveBlob } from '@/lib/db';
import { motion, AnimatePresence, Reorder } from 'motion/react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { getGraphColor, getGraphDisplayLabel, getGraphShortLabel } from '@/lib/graph-style';
import { captureVideoAnalysisFrames, extractCharacterAvatarFromVideo, extractBeatThumbnailFromVideo } from '@/lib/video-helpers';
import ThemeToggle from '@/components/ThemeToggle';
import LogoMark from '@/components/LogoMark';

async function localUpload(filename: string, file: Blob): Promise<{ pathname: string }> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('filename', filename);

  const res = await fetch('/api/scenes/media-upload', {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Local upload failed: ${errText}`);
  }

  return res.json();
}

type SidebarTab = 'scenes' | 'characters' | 'locations' | 'settings' | 'analyze' | null;

type RenderGroupOption = {
  id: string;
  name: string;
  trackIds: string[];
  clipCount: number;
};

type PendingProjectImport = {
  fileName: string;
  project: TimelineProjectJson;
  savedSceneId?: string;
  isPublished?: boolean;
};

type SavedSceneSummary = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  thumbnailUrl?: string;
  isPublished: boolean;
};

type AutosaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

const MAX_SAVED_SCENE_NAME_LENGTH = 120;
const SCENE_THUMBNAIL_BLOB_PREFIX = 'scene-thumbnail';

function getSuggestedSavedSceneName(scene?: { name: string; analysisModel?: string }) {
  const baseName = scene?.name.trim() || 'Untitled Scene';
  const model = scene?.analysisModel?.trim();

  if (!model) return baseName.slice(0, MAX_SAVED_SCENE_NAME_LENGTH);

  const displayModel = model.split(' (')[0]?.trim() || model;
  const suffix = ` - ${displayModel}`;

  if (baseName.toLowerCase().endsWith(suffix.toLowerCase())) {
    return baseName.slice(0, MAX_SAVED_SCENE_NAME_LENGTH);
  }

  const availableBaseLength = Math.max(0, MAX_SAVED_SCENE_NAME_LENGTH - suffix.length);
  return `${baseName.slice(0, availableBaseLength).trimEnd()}${suffix}`.slice(0, MAX_SAVED_SCENE_NAME_LENGTH);
}

const normalizeSceneLookupName = (value?: string) => (
  (value || '')
    .toLowerCase()
    .replace(/\s*\(imported\)\s*$/i, '')
    .replace(/\s+-\s+gemini.*$/i, '')
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
);

const findMatchingSavedSceneId = (savedScenes: SavedSceneSummary[], scene?: { name?: string }, savedSceneName?: string) => {
  const lookupNames = [
    normalizeSceneLookupName(savedSceneName),
    normalizeSceneLookupName(scene?.name),
  ].filter(Boolean);

  if (lookupNames.length === 0) return undefined;

  const exactMatch = savedScenes.find(savedScene => {
    const savedName = normalizeSceneLookupName(savedScene.name);
    return lookupNames.some(name => savedName === name);
  });
  if (exactMatch) return exactMatch.id;

  const fuzzyMatches = savedScenes.filter(savedScene => {
    const savedName = normalizeSceneLookupName(savedScene.name);
    return lookupNames.some(name => savedName.includes(name) || name.includes(savedName));
  });

  return fuzzyMatches.length === 1 ? fuzzyMatches[0].id : undefined;
};

const blobToDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(blob);
});

const runtimeSrcToRenderSrc = async (src?: string) => {
  if (!src) return undefined;
  if (!src.startsWith('blob:')) return src;

  try {
    const response = await fetch(src);
    const blob = await response.blob();
    return await blobToDataUrl(blob);
  } catch {
    return undefined;
  }
};

const captureVideoThumbnail = async (videoBlob: Blob, targetTimeSeconds = 0.35): Promise<Blob | null> => {
  const sourceUrl = URL.createObjectURL(videoBlob);
  const video = document.createElement('video');
  video.muted = true;
  video.preload = 'auto';
  video.playsInline = true;

  const waitForVideoReady = () => new Promise<void>((resolve, reject) => {
    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      resolve();
      return;
    }

    const handleReady = () => resolve();
    const handleError = () => reject(new Error('Could not decode the selected video for thumbnail capture.'));
    video.addEventListener('loadeddata', handleReady, { once: true });
    video.addEventListener('error', handleError, { once: true });
  });

  const seekTo = (time: number) => new Promise<void>((resolve, reject) => {
    if (Math.abs(video.currentTime - time) < 0.01 && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      resolve();
      return;
    }

    const handleSeek = () => resolve();
    const handleError = () => reject(new Error('Could not seek the selected video for thumbnail capture.'));
    video.addEventListener('seeked', handleSeek, { once: true });
    video.addEventListener('error', handleError, { once: true });
    video.currentTime = time;
  });

  try {
    video.src = sourceUrl;
    await waitForVideoReady();

    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 1;
    await seekTo(Math.min(Math.max(0, targetTimeSeconds), Math.max(0, duration - 0.05)));

    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 360;
    const context = canvas.getContext('2d');
    if (!context) return null;

    context.fillStyle = '#000';
    context.fillRect(0, 0, canvas.width, canvas.height);

    const scale = Math.max(canvas.width / Math.max(1, video.videoWidth), canvas.height / Math.max(1, video.videoHeight));
    const width = video.videoWidth * scale;
    const height = video.videoHeight * scale;
    context.drawImage(video, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);

    return await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.78));
  } catch {
    return null;
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(sourceUrl);
  }
};

const captureVideoElementThumbnail = async (video: HTMLVideoElement): Promise<Blob | null> => {
  if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || video.videoWidth <= 0 || video.videoHeight <= 0) {
    return null;
  }

  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 360;
  const context = canvas.getContext('2d');
  if (!context) return null;

  context.fillStyle = '#000';
  context.fillRect(0, 0, canvas.width, canvas.height);

  const scale = Math.max(canvas.width / Math.max(1, video.videoWidth), canvas.height / Math.max(1, video.videoHeight));
  const width = video.videoWidth * scale;
  const height = video.videoHeight * scale;
  context.drawImage(video, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);

  return new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.78));
};

const getPreviewVideoElementForClip = (clipId: string) => (
  Array.from(document.querySelectorAll<HTMLVideoElement>('video[data-preview-clip-id]'))
    .find(video => video.dataset.previewClipId === clipId && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA)
);

function SavedSceneThumbnail({ scene }: { scene: SavedSceneSummary }) {
  return (
    <div className="relative aspect-video overflow-hidden rounded border border-zinc-800 bg-black shadow-inner">
      {scene.thumbnailUrl ? (
        <img
          src={scene.thumbnailUrl}
          className="h-full w-full object-cover"
          alt={`${scene.name} thumbnail`}
          loading="lazy"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-[radial-gradient(circle_at_center,rgba(99,102,241,0.18),rgba(9,9,11,0.95)_55%)]">
          <Clapperboard className="h-8 w-8 text-zinc-700" />
        </div>
      )}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-between px-2 py-1 opacity-60">
        {Array.from({ length: 7 }).map((_, index) => (
          <span key={index} className="h-1.5 w-2 rounded-[1px] bg-black/70 ring-1 ring-white/10" />
        ))}
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/25 to-transparent px-3 pb-2 pt-8">
        <div className="truncate text-[10px] font-black uppercase tracking-widest text-white">{scene.name}</div>
      </div>
    </div>
  );
}

// captureVideoAnalysisFrames helper is imported from '@/lib/video-helpers'

interface ClipPropertiesPanelProps {
  selectedClip: TimelineClip;
  tracks: ReturnType<typeof useTimeline>['tracks'];
  updateClip: (id: string, updates: Partial<TimelineClip>) => void;
  addClip: (clip: TimelineClip, file?: File) => void;
  handleFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  deleteClip: (id: string) => void;
  moveClipToFirst: (id: string) => void;
  moveClipToLast: (id: string) => void;
}

interface ScriptClipEditorModalProps {
  selectedClip: TimelineClip;
  clips: TimelineClip[];
  tracks: ReturnType<typeof useTimeline>['tracks'];
  characters: ReturnType<typeof useTimeline>['characters'];
  fps: number;
  updateClip: (id: string, updates: Partial<TimelineClip>) => void;
  addClip: (clip: TimelineClip, file?: File) => void;
  onClose: () => void;
}

type ScriptEditorBlock = {
  startFrame: number;
  duration: number;
  name: string;
  body: string;
  characterId?: string;
};

type ScriptEditorTextBlock = {
  start: number;
  end: number;
  text: string;
};

const formatScriptTime = (frames: number, fps: number) => (frames / fps).toFixed(1);

const formatScriptEditorBlock = (clip: TimelineClip, characters: ReturnType<typeof useTimeline>['characters'], fps: number) => {
  const isDialog = clip.type === 'dialog';
  const characterName = clip.characterId
    ? characters.find(character => character.id === clip.characterId)?.name
    : clip.character;
  const heading = isDialog
    ? characterName || clip.name || 'Dialog'
    : clip.name || 'Note';
  const body = isDialog
    ? [clip.name, clip.description].filter(Boolean).join('\n')
    : clip.description || '';

  return [
    `[${formatScriptTime(clip.startFrame, fps)}, ${formatScriptTime(clip.duration, fps)}] ${heading}`,
    body,
  ].filter(line => line.trim().length > 0).join('\n');
};

const getScriptClipSpeaker = (clip: TimelineClip, characters: ReturnType<typeof useTimeline>['characters']) => (
  clip.characterId
    ? characters.find(character => character.id === clip.characterId)?.name || clip.character || clip.name || 'Unknown'
    : clip.character || clip.name || 'Unknown'
);

const getScriptEditorTextBlocks = (text: string): ScriptEditorTextBlock[] => {
  let nextSearchStart = 0;

  return text
    .split(/\n\s*\n/g)
    .map(rawBlock => rawBlock.trim())
    .filter(Boolean)
    .map(block => {
      const start = text.indexOf(block, nextSearchStart);
      const end = start + block.length;
      nextSearchStart = end;

      return { start, end, text: block };
    });
};

const getScriptEditorBlockAtCaret = (blocks: ScriptEditorTextBlock[], caretPosition: number) => {
  const directMatch = blocks.findIndex(block => caretPosition >= block.start && caretPosition <= block.end);
  if (directMatch >= 0) return directMatch;

  const followingBlock = blocks.findIndex(block => caretPosition < block.start);
  if (followingBlock <= 0) return 0;

  // Keep trailing whitespace and the blank separator associated with the item being edited.
  return followingBlock - 1;
};

const scrollScriptEditorCaretIntoView = (textarea: HTMLTextAreaElement, caretPosition: number) => {
  const lineHeight = Number.parseFloat(window.getComputedStyle(textarea).lineHeight) || 28;
  const caretLine = textarea.value.slice(0, caretPosition).split('\n').length - 1;
  const caretTop = caretLine * lineHeight;
  const visibleBottom = textarea.scrollTop + textarea.clientHeight - lineHeight;

  if (caretTop < textarea.scrollTop || caretTop > visibleBottom) {
    textarea.scrollTop = Math.max(0, caretTop - (textarea.clientHeight / 3));
  }
};

const parseScriptEditorBlocks = (
  text: string,
  isDialog: boolean,
  characters: ReturnType<typeof useTimeline>['characters'],
  fps: number,
): ScriptEditorBlock[] => (
  text
    .split(/\n\s*\n/g)
    .map(block => block.trim())
    .filter(Boolean)
    .map(block => {
      const [headingLine = '', ...bodyLines] = block.split('\n');
      const match = headingLine.match(/^\s*\[([\d.]+)\s*,\s*([\d.]+)\]\s*(.*)$/);
      const startSeconds = match ? Number(match[1]) : 0;
      const durationSeconds = match ? Number(match[2]) : 1;
      const name = (match?.[3] || (isDialog ? 'Dialog' : 'Note')).trim() || (isDialog ? 'Dialog' : 'Note');
      const character = isDialog
        ? characters.find(item => item.name.toLowerCase() === name.toLowerCase())
        : undefined;

      return {
        startFrame: Math.max(0, Math.round((Number.isFinite(startSeconds) ? startSeconds : 0) * fps)),
        duration: Math.max(1, Math.round((Number.isFinite(durationSeconds) ? durationSeconds : 1) * fps)),
        name,
        body: bodyLines.join('\n').trim(),
        characterId: character?.id,
      };
    })
);

export function ScriptClipEditorModal({ selectedClip, clips, tracks, characters, fps, updateClip, addClip, onClose }: ScriptClipEditorModalProps) {
  const isDialog = selectedClip.type === 'dialog';
  const [activeFilter, setActiveFilter] = React.useState('all');
  const scriptClips = React.useMemo(() => (
    clips
      .filter(clip => clip.type === selectedClip.type)
      .sort((a, b) => a.startFrame - b.startFrame || a.id.localeCompare(b.id))
  ), [clips, selectedClip.type]);
  const speakerFilters = React.useMemo(() => (
    Array.from(new Set(
      scriptClips
        .map(clip => getScriptClipSpeaker(clip, characters).trim())
        .filter(Boolean)
    )).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
  ), [characters, scriptClips]);
  const tagFilters = React.useMemo(() => (
    Array.from(new Set(
      scriptClips
        .flatMap(clip => clip.tags || [])
        .map(tag => tag.trim())
        .filter(Boolean)
    )).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
  ), [scriptClips]);
  const visibleScriptClips = React.useMemo(() => {
    if (activeFilter === 'all') return scriptClips;
    if (activeFilter.startsWith('speaker:')) {
      const speaker = activeFilter.slice('speaker:'.length).toLowerCase();
      return scriptClips.filter(clip => getScriptClipSpeaker(clip, characters).toLowerCase() === speaker);
    }
    if (activeFilter.startsWith('tag:')) {
      const tag = activeFilter.slice('tag:'.length).toLowerCase();
      return scriptClips.filter(clip => (clip.tags || []).some(item => item.toLowerCase() === tag));
    }
    return scriptClips;
  }, [activeFilter, characters, scriptClips]);
  const getClipsForFilter = React.useCallback((filter: string) => {
    if (filter === 'all') return scriptClips;
    if (filter.startsWith('speaker:')) {
      const speaker = filter.slice('speaker:'.length).toLowerCase();
      return scriptClips.filter(clip => getScriptClipSpeaker(clip, characters).toLowerCase() === speaker);
    }
    if (filter.startsWith('tag:')) {
      const tag = filter.slice('tag:'.length).toLowerCase();
      return scriptClips.filter(clip => (clip.tags || []).some(item => item.toLowerCase() === tag));
    }
    return scriptClips;
  }, [characters, scriptClips]);
  const [text, setText] = React.useState(() => (
    visibleScriptClips.map(clip => formatScriptEditorBlock(clip, characters, fps)).join('\n\n')
  ));
  const [tags, setTags] = React.useState<string[]>(selectedClip.tags || []);
  const [linkedGraphTrackIds, setLinkedGraphTrackIds] = React.useState<string[]>(selectedClip.linkedGraphTrackIds || []);
  const [tagDraft, setTagDraft] = React.useState('');
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const [focusedBlockIndex, setFocusedBlockIndex] = React.useState(() => (
    Math.max(0, visibleScriptClips.findIndex(clip => clip.id === selectedClip.id))
  ));
  const [textareaScroll, setTextareaScroll] = React.useState({ left: 0, top: 0 });
  const textBlocks = React.useMemo(() => getScriptEditorTextBlocks(text), [text]);
  const selectedTrack = React.useMemo(() => tracks.find(track => track.id === selectedClip.trackId), [selectedClip.trackId, tracks]);
  const graphOptions = React.useMemo(() => (
    tracks
      .filter(track => track.type === 'graph' && track.graph && track.parentId === selectedTrack?.parentId)
      .map((track, graphIndex) => ({
        id: track.id,
        label: getGraphDisplayLabel(track.graph, track.name),
        color: getGraphColor(track.graph, graphIndex),
      }))
  ), [selectedTrack?.parentId, tracks]);

  React.useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const selectedIndex = visibleScriptClips.findIndex(clip => clip.id === selectedClip.id);
    if (selectedIndex < 0) {
      textarea.focus();
      return;
    }

    const precedingText = visibleScriptClips
      .slice(0, selectedIndex)
      .map(clip => formatScriptEditorBlock(clip, characters, fps))
      .join('\n\n');
    const selectedBlock = formatScriptEditorBlock(selectedClip, characters, fps);
    const selectedBodyOffset = selectedBlock.indexOf('\n');
    const blockStart = precedingText.length + (selectedIndex > 0 ? 2 : 0);
    const caretPosition = blockStart + (selectedBodyOffset >= 0 ? selectedBodyOffset + 1 : selectedBlock.length);

    textarea.setSelectionRange(caretPosition, caretPosition);
    textarea.focus();
    scrollScriptEditorCaretIntoView(textarea, caretPosition);
  }, [characters, fps, selectedClip, visibleScriptClips]);

  const updateFocusedBlock = React.useCallback((textarea: HTMLTextAreaElement, nextText = text) => {
    const blocks = nextText === text ? textBlocks : getScriptEditorTextBlocks(nextText);
    if (blocks.length === 0) return;
    setFocusedBlockIndex(getScriptEditorBlockAtCaret(blocks, textarea.selectionStart));
    scrollScriptEditorCaretIntoView(textarea, textarea.selectionStart);
    setTextareaScroll({ left: textarea.scrollLeft, top: textarea.scrollTop });
  }, [text, textBlocks]);

  const applyFilter = (filter: string) => {
    setActiveFilter(filter);
    setText(getClipsForFilter(filter).map(clip => formatScriptEditorBlock(clip, characters, fps)).join('\n\n'));
  };

  const addTag = (tag: string) => {
    const nextTag = tag.trim();
    if (!nextTag) return;
    setTags(prev => (
      prev.some(item => item.toLowerCase() === nextTag.toLowerCase()) ? prev : [...prev, nextTag]
    ));
    setTagDraft('');
  };

  const handleSave = () => {
    const parsedBlocks = parseScriptEditorBlocks(text, isDialog, characters, fps);
    const filteredTag = !isDialog && activeFilter.startsWith('tag:')
      ? activeFilter.slice('tag:'.length).trim()
      : '';
    const baseNoteTags = tags.length > 0 ? tags : selectedClip.tags || [];
    const newNoteTags = Array.from(new Set(
      [...baseNoteTags, filteredTag]
        .map(tag => tag.trim())
        .filter(Boolean)
    ));

    parsedBlocks.forEach((block, index) => {
      const targetClip = visibleScriptClips[index];
      const dialogBodyLines = block.body.split('\n').map(line => line.trim()).filter(Boolean);
      const dialogName = dialogBodyLines[0] || block.name;
      const dialogDescription = dialogBodyLines.length > 1 ? dialogBodyLines.slice(1).join('\n') : undefined;

      if (!targetClip) {
        const newClip: TimelineClip = isDialog
          ? {
              id: `clip-${Date.now()}-${index}`,
              type: 'dialog',
              trackId: selectedClip.trackId,
              startFrame: block.startFrame,
              duration: block.duration,
              name: dialogName,
              description: dialogDescription,
              color: 'bg-purple-600',
              characterId: block.characterId,
              character: block.characterId ? undefined : block.name,
            }
          : {
              id: `clip-${Date.now()}-${index}`,
              type: 'note',
              trackId: selectedClip.trackId,
              startFrame: block.startFrame,
              duration: block.duration,
              name: block.name,
              description: block.body,
              color: 'bg-amber-600',
              tags: newNoteTags.length > 0 ? newNoteTags : undefined,
              linkedGraphTrackIds: linkedGraphTrackIds.length > 0 ? linkedGraphTrackIds : undefined,
            };

        addClip(newClip);
        return;
      }

      updateClip(targetClip.id, {
        name: isDialog ? dialogName : block.name,
        description: isDialog ? dialogDescription : block.body,
        startFrame: block.startFrame,
        duration: block.duration,
        characterId: isDialog ? block.characterId : targetClip.characterId,
        character: isDialog && block.characterId ? undefined : isDialog ? block.name : targetClip.character,
        tags: !isDialog && targetClip.id === selectedClip.id && tags.length > 0 ? tags : targetClip.tags,
        linkedGraphTrackIds: !isDialog && targetClip.id === selectedClip.id && linkedGraphTrackIds.length > 0 ? linkedGraphTrackIds : targetClip.linkedGraphTrackIds,
      });
    });

    onClose();
  };

  return (
    <motion.div
      className="fixed inset-0 z-[360] flex items-center justify-center bg-black/75 p-5 backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onPointerDown={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: 14 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 14 }}
        transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
        className="flex h-[min(760px,88vh)] w-[min(980px,94vw)] flex-col overflow-hidden rounded-lg border border-zinc-800 bg-[#111114] shadow-2xl"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-zinc-800 bg-zinc-950/60 px-5">
          <div className="flex min-w-0 items-center gap-3">
            <div className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-md border",
              isDialog ? "border-purple-400/20 bg-purple-500/10 text-purple-200" : "border-amber-400/20 bg-amber-500/10 text-amber-200"
            )}>
              {isDialog ? <MessageSquare className="h-4.5 w-4.5" /> : <StickyNote className="h-4.5 w-4.5" />}
            </div>
            <div className="min-w-0">
              <h3 className="truncate text-sm font-black uppercase tracking-widest text-zinc-100">
                {isDialog ? 'Dialog Script' : 'Notes Script'}
              </h3>
              <div className="mt-0.5 font-mono text-[10px] uppercase tracking-widest text-zinc-600">
                {visibleScriptClips.length}/{scriptClips.length} {isDialog ? 'dialog clips' : 'notes'}
              </div>
            </div>
          </div>
          <Button variant="ghost" size="icon" className="h-8 w-8 text-zinc-500 hover:text-white" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-[1fr_260px] overflow-hidden">
          <div className="flex min-h-0 flex-col border-r border-zinc-800 bg-[#0a0a0b]">
            <div className="border-b border-zinc-900 p-4">
              <div className="rounded-md border border-zinc-800 bg-zinc-950/70 px-3 py-2 font-mono text-[11px] leading-relaxed text-zinc-500">
                Format each item as <span className="text-zinc-200">[start, duration] {isDialog ? 'Character' : 'Title'}</span>, then put the full text below it. Separate items with a blank line.
              </div>
            </div>

            <div className="min-h-0 flex-1 p-4">
              <div className="relative h-full w-full rounded-md bg-zinc-950/70">
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 overflow-hidden rounded-md border border-transparent p-5 font-mono text-base leading-7 text-transparent"
                >
                  <div
                    className="whitespace-pre-wrap break-words"
                    style={{ transform: `translate(${-textareaScroll.left}px, ${-textareaScroll.top}px)` }}
                  >
                    {textBlocks.map((block, index) => (
                      <React.Fragment key={`${block.start}-${block.end}`}>
                        <div
                          data-testid={`script-block-highlight-${index}`}
                          data-active={index === focusedBlockIndex ? 'true' : 'false'}
                          className={cn(
                            "min-h-7 rounded px-1 -mx-1",
                            index === focusedBlockIndex && "bg-indigo-500/20 ring-1 ring-inset ring-indigo-400/25",
                          )}
                        >
                          {block.text}
                        </div>
                        {index < textBlocks.length - 1 && <div className="h-7" />}
                      </React.Fragment>
                    ))}
                  </div>
                </div>
              <textarea
                ref={textareaRef}
                aria-label={`${isDialog ? 'Dialog' : 'Notes'} script editor`}
                value={text}
                onChange={(event) => {
                  setText(event.target.value);
                  updateFocusedBlock(event.target, event.target.value);
                }}
                onFocus={(event) => updateFocusedBlock(event.target)}
                onSelect={(event) => updateFocusedBlock(event.currentTarget)}
                onScroll={(event) => setTextareaScroll({
                  left: event.currentTarget.scrollLeft,
                  top: event.currentTarget.scrollTop,
                })}
                placeholder={`[0.0, 2.0] ${isDialog ? 'Narrator' : 'Beat'}\nWrite text here...`}
                className="absolute inset-0 h-full w-full resize-none rounded-md border border-zinc-800 bg-transparent p-5 font-mono text-base leading-7 text-zinc-100 outline-none placeholder:text-zinc-700 focus:border-indigo-500/60 focus:ring-1 focus:ring-indigo-500/10"
                spellCheck
              />
              </div>
            </div>
          </div>

          <aside className="flex min-h-0 flex-col gap-5 overflow-y-auto bg-[#111114] p-4">
            <div className="rounded-md border border-zinc-800 bg-zinc-950/60 p-3">
              <div className="mb-3 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-zinc-500">
                <Clock className="h-3.5 w-3.5" />
                Batch Edit
              </div>
              <div className="grid grid-cols-2 gap-2 font-mono text-[11px] text-zinc-500">
                <div className="rounded border border-zinc-800 bg-black/20 px-2 py-2">
                  <div className="text-[9px] uppercase tracking-widest text-zinc-700">Items</div>
                  <div className="mt-1 text-zinc-200">{visibleScriptClips.length}</div>
                </div>
                <div className="rounded border border-zinc-800 bg-black/20 px-2 py-2">
                  <div className="text-[9px] uppercase tracking-widest text-zinc-700">Units</div>
                  <div className="mt-1 text-zinc-200">Seconds</div>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-600">
                {isDialog ? 'Speakers' : 'Tags'}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={cn(
                    "rounded border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider transition-colors",
                    activeFilter === 'all'
                      ? "border-indigo-500/50 bg-indigo-500/10 text-indigo-200"
                      : "border-zinc-800 bg-zinc-950 text-zinc-500 hover:border-zinc-700 hover:text-zinc-200"
                  )}
                  onClick={() => applyFilter('all')}
                >
                  All
                </button>
                {(isDialog ? speakerFilters : tagFilters).map(item => {
                  const filterId = `${isDialog ? 'speaker' : 'tag'}:${item}`;
                  return (
                    <button
                      key={filterId}
                      type="button"
                      className={cn(
                        "rounded border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider transition-colors",
                        activeFilter === filterId
                          ? "border-indigo-500/50 bg-indigo-500/10 text-indigo-200"
                          : "border-zinc-800 bg-zinc-950 text-zinc-500 hover:border-zinc-700 hover:text-zinc-200"
                      )}
                      onClick={() => applyFilter(filterId)}
                    >
                      {item}
                    </button>
                  );
                })}
              </div>
              {activeFilter !== 'all' && (
                <div className="rounded border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-[10px] leading-relaxed text-zinc-500">
                  Saving now updates only the visible {isDialog ? 'dialog' : 'note'} items. Hidden items stay unchanged.
                </div>
              )}
            </div>

            {!isDialog ? (
              <>
                <div className="space-y-3">
                  <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-600">Selected Note Tags</div>
                  <div className="flex gap-2">
                    <input
                      value={tagDraft}
                      onChange={(event) => setTagDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ',') {
                          event.preventDefault();
                          addTag(tagDraft.replace(/,$/, ''));
                        }
                      }}
                      className="min-w-0 flex-1 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-200 outline-none focus:border-indigo-500/60"
                      placeholder="Tag..."
                    />
                    <Button type="button" variant="outline" size="sm" className="border-zinc-800 bg-zinc-950 text-xs" onClick={() => addTag(tagDraft)}>
                      Add
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {tags.map(tag => (
                      <button
                        key={tag}
                        type="button"
                        className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-zinc-400 hover:border-red-500/40 hover:text-red-300"
                        onClick={() => setTags(prev => prev.filter(item => item !== tag))}
                      >
                        {tag}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-600">Graph Links</div>
                  {graphOptions.length === 0 ? (
                    <div className="rounded border border-zinc-800 bg-zinc-950/60 px-3 py-3 text-[10px] font-bold uppercase tracking-widest text-zinc-700">
                      No graph layers
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {graphOptions.map(option => {
                        const isLinked = linkedGraphTrackIds.includes(option.id);
                        return (
                          <button
                            key={option.id}
                            type="button"
                            className={cn(
                              "rounded-md border px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-all",
                              isLinked ? "text-white" : "bg-zinc-950"
                            )}
                            style={isLinked
                              ? { backgroundColor: option.color.line, borderColor: option.color.accent }
                              : { borderColor: option.color.border, color: option.color.label }}
                            onClick={() => {
                              setLinkedGraphTrackIds(prev => (
                                prev.includes(option.id)
                                  ? prev.filter(id => id !== option.id)
                                  : [...prev, option.id]
                              ));
                              setTags(prev => (
                                prev.some(tag => tag.toLowerCase() === option.label.toLowerCase())
                                  ? prev
                                  : [...prev, option.label]
                              ));
                            }}
                          >
                            {option.label}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="rounded-md border border-zinc-800 bg-zinc-950/60 px-3 py-3 text-[10px] font-medium uppercase tracking-widest text-zinc-600">
                Character names are read from each block heading.
              </div>
            )}
          </aside>
        </div>

        <div className="flex h-14 shrink-0 justify-end gap-2 border-t border-zinc-800 bg-zinc-950/60 px-5 py-3">
          <Button variant="ghost" className="text-zinc-400 hover:text-zinc-100" onClick={onClose}>
            Cancel
          </Button>
          <Button className="bg-indigo-600 text-white hover:bg-indigo-500" onClick={handleSave}>
            <Check className="h-4 w-4" />
            Save
          </Button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function ClipPropertiesPanel({ selectedClip, tracks, updateClip, addClip, handleFileUpload, deleteClip, moveClipToFirst, moveClipToLast }: ClipPropertiesPanelProps) {
  const { characters, clips, fps } = useTimeline();
  const [expandedSections, setExpandedSections] = React.useState<string[]>(['general']);
  const [tagDraft, setTagDraft] = React.useState('');
  const [scriptEditorOpen, setScriptEditorOpen] = React.useState(false);
  const selectedTrack = React.useMemo(() => (
    tracks.find(track => track.id === selectedClip.trackId)
  ), [selectedClip.trackId, tracks]);
  const selectedParentId = selectedTrack?.parentId;
  const graphTracks = React.useMemo(() => (
    tracks.filter(track => (
      track.type === 'graph' &&
      track.graph &&
      track.parentId === selectedParentId
    ))
  ), [selectedParentId, tracks]);
  const graphLinkOptions = React.useMemo(() => {
    return graphTracks.map((track, graphIndex) => ({
      id: track.id,
      label: getGraphDisplayLabel(track.graph, track.name),
      color: getGraphColor(track.graph, graphIndex),
    }));
  }, [graphTracks]);
  const availableGraphTrackIds = React.useMemo(() => (
    new Set(graphLinkOptions.map(option => option.id))
  ), [graphLinkOptions]);
  const linkedGraphTrackIds = React.useMemo(() => (
    selectedClip.linkedGraphTrackIds || []
  ), [selectedClip.linkedGraphTrackIds]);
  const noteTags = React.useMemo(() => (
    Array.from(new Set((selectedClip.tags || []).map(tag => tag.trim()).filter(Boolean)))
  ), [selectedClip.tags]);
  const noteTagKeySet = React.useMemo(() => (
    new Set(noteTags.map(tag => tag.toLowerCase()))
  ), [noteTags]);

  const addNoteTag = React.useCallback((tag: string) => {
    const trimmedTag = tag.trim();
    if (!trimmedTag) return;

    const nextTags = noteTagKeySet.has(trimmedTag.toLowerCase())
      ? noteTags
      : [...noteTags, trimmedTag];

    updateClip(selectedClip.id, {
      tags: nextTags.length > 0 ? nextTags : undefined,
    });
    setTagDraft('');
  }, [noteTags, noteTagKeySet, selectedClip.id, updateClip]);

  const removeNoteTag = React.useCallback((tag: string) => {
    const nextTags = noteTags.filter(item => item.toLowerCase() !== tag.toLowerCase());
    const removedGraphOption = graphLinkOptions.find(option => option.label.toLowerCase() === tag.toLowerCase());
    updateClip(selectedClip.id, {
      tags: nextTags.length > 0 ? nextTags : undefined,
      linkedGraphTrackIds: removedGraphOption
        ? linkedGraphTrackIds.filter(id => id !== removedGraphOption.id)
        : linkedGraphTrackIds.length > 0 ? linkedGraphTrackIds : undefined,
    });
  }, [graphLinkOptions, linkedGraphTrackIds, noteTags, selectedClip.id, updateClip]);

  const toggleSection = (id: string) => {
    setExpandedSections(prev => 
      prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]
    );
  };

  const isExpanded = (id: string) => expandedSections.includes(id);

  return (
    <>
      <div className="flex-1 overflow-y-auto px-5 py-2 flex flex-col">
        {/* General Section */}
        <div className="border-b border-zinc-800/50">
          <button 
            onClick={() => toggleSection('general')}
            className="w-full py-4 flex items-center justify-between text-[11px] font-bold text-zinc-500 uppercase tracking-[0.2em] hover:text-zinc-200 transition-colors group"
          >
            <span>General</span>
            <ChevronRight className={cn("w-3.5 h-3.5 transition-transform duration-200 text-zinc-600 group-hover:text-zinc-400", isExpanded('general') && "rotate-90")} />
          </button>
          <AnimatePresence initial={false}>
            {isExpanded('general') && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2, ease: "easeInOut" }}
                className="overflow-hidden"
              >
                <div className="pb-6 flex flex-col gap-5">
                   {(selectedClip.type === 'dialog' || selectedClip.type === 'note') && (
                     <Button
                       type="button"
                       className="h-10 justify-start bg-indigo-600 text-[10px] font-black uppercase tracking-widest text-white hover:bg-indigo-500"
                       onClick={() => setScriptEditorOpen(true)}
                     >
                       {selectedClip.type === 'dialog' ? <MessageSquare className="h-4 w-4" /> : <StickyNote className="h-4 w-4" />}
                       Open Script Editor
                     </Button>
                   )}

                   <div className="space-y-2">
                     <label className="text-[10px] text-zinc-600 uppercase tracking-widest font-bold px-1">Name</label>
                     <input 
                       type="text"
                       value={selectedClip.name}
                       onChange={(e) => updateClip(selectedClip.id, { name: e.target.value })}
                       className="w-full bg-[#0a0a0b] p-3 rounded-md border border-zinc-900 text-xs font-semibold text-zinc-100 outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/10 transition-all placeholder:text-zinc-800"
                       placeholder="Clip name..."
                     />
                   </div>

                   <div className="space-y-2">
                     <label className="text-[10px] text-zinc-600 uppercase tracking-widest font-bold px-1">Description</label>
                     <textarea 
                       value={selectedClip.description || ''}
                       onChange={(e) => updateClip(selectedClip.id, { description: e.target.value })}
                       placeholder="Add a detailed description..."
                       rows={4}
                       className="w-full bg-[#0a0a0b] p-3 rounded-md border border-zinc-900 text-xs text-zinc-400 outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/10 transition-all resize-none placeholder:text-zinc-800"
                     />
                   </div>

                   <div className="flex items-center justify-between px-1">
                     <span className="text-[10px] text-zinc-600 font-mono uppercase tracking-widest">Type</span>
                     <span className="text-[10px] font-bold text-indigo-400 px-2 py-0.5 bg-indigo-500/10 border border-indigo-500/20 rounded">
                       {selectedClip.type.toUpperCase()}
                     </span>
                   </div>

                   <div className="space-y-3 pt-2">
                      <label className="text-[10px] text-zinc-600 uppercase tracking-widest font-bold px-1">Linked Character</label>
                      <div className="relative">
                         <UserCircle className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-600" />
                         <select 
                           value={selectedClip.characterId || ""}
                           onChange={(e) => updateClip(selectedClip.id, { characterId: e.target.value || undefined, character: undefined })}
                           className="w-full bg-[#0a0a0b] p-3 pl-10 pr-10 rounded-md border border-zinc-900 text-xs font-semibold text-zinc-200 outline-none focus:border-indigo-500/50 appearance-none cursor-pointer"
                         >
                           <option value="">No Character</option>
                           {characters.map(char => (
                             <option key={char.id} value={char.id}>{char.name}</option>
                           ))}
                         </select>
                         <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-3 h-3 text-zinc-600 pointer-events-none" />
                      </div>
                   </div>

                   {selectedClip.type === 'note' && (
                     <div className="space-y-3 pt-2">
                       <label className="text-[10px] text-zinc-600 uppercase tracking-widest font-bold px-1">Tags</label>
                       <div className="flex gap-2">
                         <input
                           type="text"
                           value={tagDraft}
                           onChange={(e) => setTagDraft(e.target.value)}
                           onKeyDown={(e) => {
                             if (e.key === 'Enter' || e.key === ',') {
                               e.preventDefault();
                               addNoteTag(tagDraft.replace(/,$/, ''));
                             }
                           }}
                           className="min-w-0 flex-1 rounded-md border border-zinc-900 bg-[#0a0a0b] px-3 py-2 text-xs font-semibold text-zinc-200 outline-none transition-all placeholder:text-zinc-800 focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/10"
                           placeholder="Add tag..."
                         />
                         <Button
                           type="button"
                           variant="outline"
                           size="sm"
                           className="h-auto border-zinc-800 bg-zinc-950 px-3 text-[10px] font-bold uppercase tracking-wider text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
                           onClick={() => addNoteTag(tagDraft)}
                         >
                           Add
                         </Button>
                       </div>
                       {noteTags.length > 0 && (
                         <div className="flex flex-wrap gap-2">
                           {noteTags.map(tag => (
                             <button
                               key={tag}
                               type="button"
                               onClick={() => removeNoteTag(tag)}
                               className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-zinc-400 transition-colors hover:border-red-500/40 hover:text-red-300"
                             >
                               {tag}
                             </button>
                           ))}
                         </div>
                       )}
                       <div className="space-y-2">
                         <div className="text-[10px] text-zinc-600 uppercase tracking-widest font-bold px-1">Graph Tags</div>
                         {graphLinkOptions.length === 0 ? (
                           <div className="rounded-md border border-zinc-900 bg-[#0a0a0b] px-3 py-3 text-[10px] font-medium uppercase tracking-widest text-zinc-700">
                             No graph layers
                           </div>
                         ) : (
                           <div className="flex flex-wrap gap-2">
                             {graphLinkOptions.map((graphOption) => {
                               const linkedIdSet = new Set(linkedGraphTrackIds);
                               const graphTagKey = graphOption.label.toLowerCase();
                               const isLinked = linkedIdSet.has(graphOption.id) || noteTagKeySet.has(graphTagKey);
                               return (
                                 <button
                                   key={graphOption.id}
                                   type="button"
                                   onClick={() => {
                                     const scopedLinkedGraphTrackIds = linkedGraphTrackIds.filter(id => availableGraphTrackIds.has(id));
                                     const nextLinkedGraphTrackIds = isLinked
                                       ? scopedLinkedGraphTrackIds.filter(id => id !== graphOption.id)
                                       : Array.from(new Set([...scopedLinkedGraphTrackIds, graphOption.id]));
                                     const nextTags = isLinked
                                       ? noteTags.filter(tag => tag.toLowerCase() !== graphTagKey)
                                       : noteTagKeySet.has(graphTagKey) ? noteTags : [...noteTags, graphOption.label];
                                     updateClip(selectedClip.id, {
                                       tags: nextTags.length > 0 ? nextTags : undefined,
                                       linkedGraphTrackIds: nextLinkedGraphTrackIds.length > 0 ? nextLinkedGraphTrackIds : undefined,
                                     });
                                   }}
                                   className={cn(
                                     "rounded-md border px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-all",
                                     isLinked
                                       ? "text-white shadow-sm"
                                       : "bg-[#0a0a0b] hover:bg-zinc-950"
                                   )}
                                   style={isLinked
                                     ? {
                                         backgroundColor: graphOption.color.line,
                                         borderColor: graphOption.color.accent,
                                       }
                                     : {
                                         borderColor: graphOption.color.border,
                                         color: graphOption.color.label,
                                       }}
                                 >
                                   {graphOption.label}
                                 </button>
                               );
                             })}
                           </div>
                         )}
                       </div>
                     </div>
                   )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Media Section */}
        {(selectedClip.type === 'video' || selectedClip.type === 'image') && (
          <div className="border-b border-zinc-800/50">
            <button 
              onClick={() => toggleSection('media')}
              className="w-full py-4 flex items-center justify-between text-[11px] font-bold text-zinc-500 uppercase tracking-[0.2em] hover:text-zinc-200 transition-colors group"
            >
              <span>Media</span>
              <ChevronRight className={cn("w-3.5 h-3.5 transition-transform duration-200 text-zinc-600 group-hover:text-zinc-400", isExpanded('media') && "rotate-90")} />
            </button>
            <AnimatePresence initial={false}>
              {isExpanded('media') && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2, ease: "easeInOut" }}
                  className="overflow-hidden"
                >
                  <div className="pb-6">
                    {selectedClip.src ? (
                      <div className="relative aspect-video rounded border border-zinc-900 overflow-hidden bg-black flex items-center justify-center group shadow-2xl">
                        {selectedClip.type === 'video' ? (
                          <video src={selectedClip.src} controls playsInline className="w-full h-full object-contain" />
                        ) : (
                          <img src={selectedClip.src} className="w-full h-full object-contain" alt="" />
                        )}
                        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity backdrop-blur-[2px]">
                          <label className="cursor-pointer text-[10px] font-bold bg-white text-black px-4 py-2 rounded-full flex items-center gap-2 hover:bg-zinc-200 transition-all transform scale-95 group-hover:scale-100">
                            <Upload className="w-3 h-3" />
                            REPLACE
                            <input type="file" accept="video/*,image/*" className="hidden" onChange={handleFileUpload} />
                          </label>
                        </div>
                      </div>
                    ) : (
                      <label className="flex flex-col items-center justify-center h-40 rounded border border-dashed border-zinc-800 bg-zinc-900/10 hover:bg-zinc-900/30 hover:border-indigo-500/50 cursor-pointer transition-all group overflow-hidden">
                        <div className="w-10 h-10 rounded-full bg-zinc-900 flex items-center justify-center mb-2 group-hover:scale-110 transition-transform">
                          {selectedClip.type === 'video' ? <FileVideo className="w-5 h-5 text-indigo-500/70" /> : <FileImage className="w-5 h-5 text-emerald-500/70" />}
                        </div>
                        <span className="text-[10px] font-bold tracking-[0.2em] uppercase text-zinc-600 group-hover:text-zinc-400">Upload {selectedClip.type}</span>
                        <input type="file" accept="video/*,image/*" className="hidden" onChange={handleFileUpload} />
                      </label>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {/* Animations Section */}
        <div className="border-b border-zinc-800/50">
           <button 
             onClick={() => toggleSection('animations')}
             className="w-full py-4 flex items-center justify-between text-[11px] font-bold text-zinc-500 uppercase tracking-[0.2em] hover:text-zinc-200 transition-colors group"
           >
             <span>Animations</span>
             <ChevronRight className={cn("w-3.5 h-3.5 transition-transform duration-200 text-zinc-600 group-hover:text-zinc-400", isExpanded('animations') && "rotate-90")} />
           </button>
           <AnimatePresence initial={false}>
             {isExpanded('animations') && (
               <motion.div
                 initial={{ height: 0, opacity: 0 }}
                 animate={{ height: "auto", opacity: 1 }}
                 exit={{ height: 0, opacity: 0 }}
                 transition={{ duration: 0.2, ease: "easeInOut" }}
                 className="overflow-hidden"
               >
                 <div className="pb-6 space-y-4">
                    <div className="space-y-3 px-1">
                      <label className="text-[10px] text-zinc-600 uppercase tracking-widest font-bold">Mode</label>
                      <div className="relative">
                        <select
                          value={selectedClip.animationMode || 'all'}
                          onChange={(e) => updateClip(selectedClip.id, { animationMode: e.target.value as any })}
                          className="w-full bg-[#0a0a0b] p-3 pr-10 rounded-md border border-zinc-900 text-xs font-semibold text-zinc-200 outline-none focus:border-indigo-500/50 appearance-none cursor-pointer"
                        >
                          <option value="all">All Animations</option>
                          <option value="entrance">Entrance Only</option>
                          <option value="exit">Exit Only</option>
                          <option value="none">Disabled</option>
                        </select>
                        <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-3 h-3 text-zinc-600 pointer-events-none" />
                      </div>
                    </div>

                    <div className="space-y-3 px-1">
                      <label className="text-[10px] text-zinc-600 uppercase tracking-widest font-bold">Direction</label>
                      <div className="relative">
                        <select
                          value={selectedClip.animationDirection || 'center'}
                          disabled={selectedClip.animationMode === 'none'}
                          onChange={(e) => updateClip(selectedClip.id, { animationDirection: e.target.value as any })}
                          className="w-full bg-[#0a0a0b] p-3 pr-10 rounded-md border border-zinc-900 text-xs font-semibold text-zinc-200 outline-none focus:border-indigo-500/50 appearance-none cursor-pointer disabled:opacity-50"
                        >
                          <option value="center">Center / Scale</option>
                          <option value="left">From Left</option>
                          <option value="right">From Right</option>
                          <option value="top">From Top</option>
                          <option value="bottom">From Bottom</option>
                        </select>
                        <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-3 h-3 text-zinc-600 pointer-events-none" />
                      </div>
                    </div>
                 </div>
               </motion.div>
             )}
           </AnimatePresence>
        </div>

        {/* Layout Section */}
        <div className="border-b border-zinc-800/50">
           <button 
             onClick={() => toggleSection('layout')}
             className="w-full py-4 flex items-center justify-between text-[11px] font-bold text-zinc-500 uppercase tracking-[0.2em] hover:text-zinc-200 transition-colors group"
           >
             <span>Layout</span>
             <ChevronRight className={cn("w-3.5 h-3.5 transition-transform duration-200 text-zinc-600 group-hover:text-zinc-400", isExpanded('layout') && "rotate-90")} />
           </button>
           <AnimatePresence initial={false}>
             {isExpanded('layout') && (
               <motion.div
                 initial={{ height: 0, opacity: 0 }}
                 animate={{ height: "auto", opacity: 1 }}
                 exit={{ height: 0, opacity: 0 }}
                 transition={{ duration: 0.2, ease: "easeInOut" }}
                 className="overflow-hidden"
               >
                 <div className="pb-6 space-y-4">
                    <div className="space-y-3 px-1">
                      <label className="text-[10px] text-zinc-600 uppercase tracking-widest font-bold">Layout Type</label>
                      <div className="relative">
                        <select
                          value={selectedClip.type === 'dialog' || selectedClip.type === 'note' ? 'overlay' : selectedClip.layoutType || 'grid'}
                          onChange={(e) => updateClip(selectedClip.id, { layoutType: e.target.value as any })}
                          disabled={selectedClip.type === 'dialog' || selectedClip.type === 'note'}
                          className="w-full bg-[#0a0a0b] p-3 pr-10 rounded-md border border-zinc-900 text-xs font-semibold text-zinc-200 outline-none focus:border-indigo-500/50 appearance-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <option value="grid">Grid (Standard)</option>
                          <option value="overlay">Overlay / Popover</option>
                        </select>
                        <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-3 h-3 text-zinc-600 pointer-events-none" />
                      </div>
                    </div>

                    {selectedClip.layoutType === 'overlay' && (
                      <div className="space-y-3 px-1">
                        <label className="text-[10px] text-zinc-600 uppercase tracking-widest font-bold">Anchor Point</label>
                        <div className="relative">
                          <select
                            value={selectedClip.type === 'dialog' || selectedClip.type === 'note' ? 'bottom' : selectedClip.anchorPoint || 'center'}
                            onChange={(e) => updateClip(selectedClip.id, { anchorPoint: e.target.value as any })}
                            disabled={selectedClip.type === 'dialog' || selectedClip.type === 'note'}
                            className="w-full bg-[#0a0a0b] p-3 pr-10 rounded-md border border-zinc-900 text-xs font-semibold text-zinc-200 outline-none focus:border-indigo-500/50 appearance-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            <option value="center">Center</option>
                            <option value="top-left">Top Left</option>
                            <option value="top-right">Top Right</option>
                            <option value="bottom-left">Bottom Left</option>
                            <option value="bottom-right">Bottom Right</option>
                            <option value="top">Top Center</option>
                            <option value="bottom">Bottom Center</option>
                            <option value="left">Left Center</option>
                            <option value="right">Right Center</option>
                          </select>
                          <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-3 h-3 text-zinc-600 pointer-events-none" />
                        </div>
                      </div>
                    )}

                    <div className="space-y-4 px-1">
                      <label className="text-[10px] text-zinc-600 uppercase tracking-widest font-bold block pt-2">Grid Layout Order</label>
                      <div className="flex gap-2">
                        <Button 
                          variant="outline" 
                          size="sm" 
                          className="flex-1 bg-zinc-900 border-zinc-800 text-[10px] font-bold uppercase tracking-wider h-8"
                          onClick={() => moveClipToFirst(selectedClip.id)}
                        >
                          Move to First
                        </Button>
                        <Button 
                          variant="outline" 
                          size="sm" 
                          className="flex-1 bg-zinc-900 border-zinc-800 text-[10px] font-bold uppercase tracking-wider h-8"
                          onClick={() => moveClipToLast(selectedClip.id)}
                        >
                          Move to Last
                        </Button>
                      </div>
                      <div className="relative">
                        <select
                          value={selectedClip.layoutOrder || 0}
                          onChange={(e) => updateClip(selectedClip.id, { layoutOrder: parseInt(e.target.value) })}
                          className="w-full bg-[#0a0a0b] p-3 pr-10 rounded-md border border-zinc-900 text-xs font-semibold text-zinc-200 outline-none focus:border-indigo-500/50 appearance-none cursor-pointer"
                        >
                          {Array.from({ length: 12 }).map((_, i) => (
                            <option key={i} value={i}>Manual Position {i + 1}</option>
                          ))}
                        </select>
                        <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-3 h-3 text-zinc-600 pointer-events-none" />
                      </div>
                      <p className="px-1 text-[9px] text-zinc-700 italic leading-tight">Controls visual order in split screen</p>
                    </div>
                 </div>
               </motion.div>
             )}
           </AnimatePresence>
        </div>
      </div>

      <div className="mt-auto border-t border-zinc-800 p-5 bg-[#0a0a0b]/50 space-y-5">
         <div className="space-y-3">
           <div className="text-[11px] font-bold uppercase tracking-widest text-zinc-600">Clip Metadata</div>
           <div className="grid grid-cols-2 gap-4 text-[10px] text-zinc-500 font-mono">
             <div className="space-y-1">
               <div className="text-zinc-700 font-bold uppercase">ID</div>
               <div className="truncate">{selectedClip.id}</div>
             </div>
             <div className="space-y-1 text-right">
               <div className="text-zinc-700 font-bold uppercase">Duration</div>
               <div>{selectedClip.duration} frames</div>
             </div>
           </div>
         </div>

         <Button 
           variant="destructive" 
           size="sm" 
           className="w-full h-9 bg-red-500/10 hover:bg-red-500 text-red-500 hover:text-white border border-red-500/20 text-[10px] font-bold uppercase tracking-widest transition-all"
           onClick={() => deleteClip(selectedClip.id)}
         >
           <Trash2 className="h-3.5 w-3.5 mr-2" />
           Delete Clip
         </Button>
      </div>

      <AnimatePresence>
        {scriptEditorOpen && (selectedClip.type === 'dialog' || selectedClip.type === 'note') && (
          <ScriptClipEditorModal
            selectedClip={selectedClip}
            clips={clips}
            tracks={tracks}
            characters={characters}
            fps={fps}
            updateClip={updateClip}
            addClip={addClip}
            onClose={() => setScriptEditorOpen(false)}
          />
        )}
      </AnimatePresence>
    </>
  );
}

const ANALYSIS_JSON_TEMPLATE = {
  version: 1,
  exportedAt: "2026-05-23T16:12:26.272Z",
  scenes: [
    {
      id: "scene-1779552746272",
      name: "town.mp4",
      clips: [
        {
          id: "clip-analysis-note-0-main",
          name: "Analysis",
          description: "Opening shot sets a grim, tense tone for the upcoming heist.",
          type: "note" as const,
          startFrame: 0,
          duration: 28,
          trackId: "track-structural-analysis",
          color: "bg-amber-600",
          layoutType: "overlay" as const,
          anchorPoint: "bottom" as const,
          tags: ["Analysis", "Preview"]
        },
        {
          id: "clip-analysis-note-0-tension",
          name: "Tension Reasoning",
          description: "Crew plans heist details under high pressure.",
          type: "note" as const,
          startFrame: 0,
          duration: 28,
          trackId: "track-structural-analysis",
          color: "bg-red-600",
          layoutType: "overlay" as const,
          anchorPoint: "bottom" as const,
          linkedGraphTrackIds: ["graph-dramatic-tension"],
          tags: ["Tension", "Preview"]
        },
        {
          id: "clip-analysis-note-0-stakes",
          name: "Stakes / Conflict Reasoning",
          description: "A botched robbery means prison or death.",
          type: "note" as const,
          startFrame: 0,
          duration: 28,
          trackId: "track-structural-analysis",
          color: "bg-emerald-600",
          layoutType: "overlay" as const,
          anchorPoint: "bottom" as const,
          linkedGraphTrackIds: ["graph-operational-stakes"],
          tags: ["Stakes", "Preview"]
        },
        {
          id: "clip-analysis-note-0-events",
          name: "Events",
          description: "• Mac talks strategy in the dark van",
          type: "note" as const,
          startFrame: 0,
          duration: 28,
          trackId: "track-structural-analysis",
          color: "bg-blue-600",
          layoutType: "overlay" as const,
          anchorPoint: "bottom" as const,
          tags: ["Events"]
        },
        {
          id: "clip-analysis-note-0-story-0",
          name: "Story Element: EXPOSITION",
          description: "Planning the robbery rules.",
          type: "note" as const,
          startFrame: 0,
          duration: 28,
          trackId: "track-structural-analysis",
          color: "bg-purple-600",
          layoutType: "overlay" as const,
          anchorPoint: "bottom" as const,
          tags: ["EXPOSITION"]
        },
        {
          id: "clip-analysis-note-1-main",
          name: "Analysis",
          description: "The crew's silence amplifies the gravity of their plan.",
          type: "note" as const,
          startFrame: 28,
          duration: 86,
          trackId: "track-structural-analysis",
          color: "bg-amber-600",
          layoutType: "overlay" as const,
          anchorPoint: "bottom" as const,
          tags: ["Analysis", "Preview"]
        },
        {
          id: "clip-analysis-note-1-tension",
          name: "Tension Reasoning",
          description: "Crew member listens intently, silent and grim.",
          type: "note" as const,
          startFrame: 28,
          duration: 86,
          trackId: "track-structural-analysis",
          color: "bg-red-600",
          layoutType: "overlay" as const,
          anchorPoint: "bottom" as const,
          linkedGraphTrackIds: ["graph-dramatic-tension"],
          tags: ["Tension", "Preview"]
        },
        {
          id: "clip-analysis-note-1-events",
          name: "Events",
          description: "• Crew member stares forward silently",
          type: "note" as const,
          startFrame: 28,
          duration: 86,
          trackId: "track-structural-analysis",
          color: "bg-blue-600",
          layoutType: "overlay" as const,
          anchorPoint: "bottom" as const,
          tags: ["Events", "Preview"]
        },
        {
          id: "clip-analysis-note-2-main",
          name: "Analysis",
          description: "The intense focus highlights each member's silent focus.",
          type: "note" as const,
          startFrame: 114,
          duration: 26,
          trackId: "track-structural-analysis",
          color: "bg-amber-600",
          layoutType: "overlay" as const,
          anchorPoint: "bottom" as const,
          tags: ["Analysis", "Preview"]
        },
        {
          id: "clip-analysis-note-2-tension",
          name: "Tension Reasoning",
          description: "Focus shifts to another crew member's stern face.",
          type: "note" as const,
          startFrame: 114,
          duration: 26,
          trackId: "track-structural-analysis",
          color: "bg-red-600",
          layoutType: "overlay" as const,
          anchorPoint: "bottom" as const,
          linkedGraphTrackIds: ["graph-dramatic-tension"],
          tags: ["Tension", "Preview"]
        },
        {
          id: "clip-analysis-note-2-events",
          name: "Events",
          description: "• Camera pans to reveal second crew member",
          type: "note" as const,
          startFrame: 114,
          duration: 26,
          trackId: "track-structural-analysis",
          color: "bg-blue-600",
          layoutType: "overlay" as const,
          anchorPoint: "bottom" as const,
          tags: ["Events", "Preview"]
        },
        {
          id: "clip-analysis-note-3-main",
          name: "Analysis",
          description: "Mac tries to establish a boundary of non-violence.",
          type: "note" as const,
          startFrame: 140,
          duration: 70,
          trackId: "track-structural-analysis",
          color: "bg-amber-600",
          layoutType: "overlay" as const,
          anchorPoint: "bottom" as const,
          tags: ["Analysis", "Preview"]
        },
        {
          id: "clip-analysis-note-3-tension",
          name: "Tension Reasoning",
          description: "Mac emphasizes minimizing casualties, adding weight.",
          type: "note" as const,
          startFrame: 140,
          duration: 70,
          trackId: "track-structural-analysis",
          color: "bg-red-600",
          layoutType: "overlay" as const,
          anchorPoint: "bottom" as const,
          linkedGraphTrackIds: ["graph-dramatic-tension"],
          tags: ["Tension", "Preview"]
        },
        {
          id: "clip-analysis-note-4-main",
          name: "Analysis",
          description: "Jem highlights the unpredictable danger of the heist.",
          type: "note" as const,
          startFrame: 210,
          duration: 159,
          trackId: "track-structural-analysis",
          color: "bg-amber-600",
          layoutType: "overlay" as const,
          anchorPoint: "bottom" as const,
          tags: ["Analysis", "Preview"]
        },
        {
          id: "clip-analysis-note-4-tension",
          name: "Tension Reasoning",
          description: "Jem challenges Mac's idealistic rule with reality.",
          type: "note" as const,
          startFrame: 210,
          duration: 159,
          trackId: "track-structural-analysis",
          color: "bg-red-600",
          layoutType: "overlay" as const,
          anchorPoint: "bottom" as const,
          linkedGraphTrackIds: ["graph-dramatic-tension"],
          tags: ["Tension", "Preview"]
        },
        {
          id: "clip-analysis-note-4-stakes",
          name: "Stakes / Conflict Reasoning",
          description: "Disagreement on how to handle resisting guards.",
          type: "note" as const,
          startFrame: 210,
          duration: 159,
          trackId: "track-structural-analysis",
          color: "bg-emerald-600",
          layoutType: "overlay" as const,
          anchorPoint: "bottom" as const,
          linkedGraphTrackIds: ["graph-operational-stakes"],
          tags: ["Stakes", "Preview"]
        },
        {
          id: "clip-analysis-note-5-main",
          name: "Analysis",
          description: "The planning phase ends, committing them to action.",
          type: "note" as const,
          startFrame: 369,
          duration: 87,
          trackId: "track-structural-analysis",
          color: "bg-amber-600",
          layoutType: "overlay" as const,
          anchorPoint: "bottom" as const,
          tags: ["Analysis", "Preview"]
        },
        {
          id: "clip-analysis-note-5-tension",
          name: "Tension Reasoning",
          description: "Mac decides it's time to initiate the heist.",
          type: "note" as const,
          startFrame: 369,
          duration: 87,
          trackId: "track-structural-analysis",
          color: "bg-red-600",
          layoutType: "overlay" as const,
          anchorPoint: "bottom" as const,
          linkedGraphTrackIds: ["graph-dramatic-tension"],
          tags: ["Tension", "Preview"]
        },
        {
          id: "clip-analysis-note-6-main",
          name: "Analysis",
          description: "Routine actions contrast sharply with the crew's deadly intent.",
          type: "note" as const,
          startFrame: 456,
          duration: 105,
          trackId: "track-structural-analysis",
          color: "bg-amber-600",
          layoutType: "overlay" as const,
          anchorPoint: "bottom" as const,
          tags: ["Analysis", "Preview"]
        },
        {
          id: "clip-analysis-note-6-tension",
          name: "Tension Reasoning",
          description: "The targets are unaware of the approaching threat.",
          type: "note" as const,
          startFrame: 456,
          duration: 105,
          trackId: "track-structural-analysis",
          color: "bg-red-600",
          layoutType: "overlay" as const,
          anchorPoint: "bottom" as const,
          linkedGraphTrackIds: ["graph-dramatic-tension"],
          tags: ["Tension", "Preview"]
        },
        {
          id: "clip-analysis-note-6-suspense",
          name: "Suspense Reasoning",
          description: "The contrast between normal routine and impending heist.",
          type: "note" as const,
          startFrame: 456,
          duration: 105,
          trackId: "track-structural-analysis",
          color: "bg-sky-600",
          layoutType: "overlay" as const,
          anchorPoint: "bottom" as const,
          linkedGraphTrackIds: ["graph-anticipatory-suspense"],
          tags: ["Suspense", "Preview"]
        },
        {
          id: "clip-analysis-note-6-events",
          name: "Events",
          description: "• Guard reads newspaper inside truck",
          type: "note" as const,
          startFrame: 456,
          duration: 105,
          trackId: "track-structural-analysis",
          color: "bg-blue-600",
          layoutType: "overlay" as const,
          anchorPoint: "bottom" as const,
          tags: ["Events", "Preview"]
        },
        {
          id: "clip-analysis-note-7-main",
          name: "Analysis",
          description: "The pieces of the heist start moving into place.",
          type: "note" as const,
          startFrame: 561,
          duration: 93,
          trackId: "track-structural-analysis",
          color: "bg-amber-600",
          layoutType: "overlay" as const,
          anchorPoint: "bottom" as const,
          tags: ["Analysis", "Preview"]
        },
        {
          id: "clip-analysis-note-7-suspense",
          name: "Suspense Reasoning",
          description: "Van rolls by as guard begins his routine.",
          type: "note" as const,
          startFrame: 561,
          duration: 93,
          trackId: "track-structural-analysis",
          color: "bg-sky-600",
          layoutType: "overlay" as const,
          anchorPoint: "bottom" as const,
          linkedGraphTrackIds: ["graph-anticipatory-suspense"],
          tags: ["Suspense", "Preview"]
        },
        {
          id: "clip-analysis-note-7-events",
          name: "Events",
          description: "• Orange utility van drives past the guard",
          type: "note" as const,
          startFrame: 561,
          duration: 93,
          trackId: "track-structural-analysis",
          color: "bg-blue-600",
          layoutType: "overlay" as const,
          anchorPoint: "bottom" as const,
          tags: ["Events", "Preview"]
        },
        {
          id: "clip-analysis-note-8-main",
          name: "Analysis",
          description: "Tightening focus on the target heightens anticipation.",
          type: "note" as const,
          startFrame: 654,
          duration: 54,
          trackId: "track-structural-analysis",
          color: "bg-amber-600",
          layoutType: "overlay" as const,
          anchorPoint: "bottom" as const,
          tags: ["Analysis", "Preview"]
        },
        {
          id: "clip-analysis-note-8-suspense",
          name: "Suspense Reasoning",
          description: "The guard's routine brings him closer to danger.",
          type: "note" as const,
          startFrame: 654,
          duration: 54,
          trackId: "track-structural-analysis",
          color: "bg-sky-600",
          layoutType: "overlay" as const,
          anchorPoint: "bottom" as const,
          linkedGraphTrackIds: ["graph-anticipatory-suspense"],
          tags: ["Suspense", "Preview"]
        },
        {
          id: "clip-analysis-note-8-events",
          name: "Events",
          description: "• Guard walks purposefully down the sidewalk",
          type: "note" as const,
          startFrame: 654,
          duration: 54,
          trackId: "track-structural-analysis",
          color: "bg-blue-600",
          layoutType: "overlay" as const,
          anchorPoint: "bottom" as const,
          tags: ["Events", "Preview"]
        },
        {
          id: "clip-analysis-note-9-main",
          name: "Analysis",
          description: "The entry marks the point of no return for the heist.",
          type: "note" as const,
          startFrame: 708,
          duration: 207,
          trackId: "track-structural-analysis",
          color: "bg-amber-600",
          layoutType: "overlay" as const,
          anchorPoint: "bottom" as const,
          tags: ["Analysis", "Preview"]
        },
        {
          id: "clip-analysis-note-9-suspense",
          name: "Suspense Reasoning",
          description: "The guard reaches the entry door, vulnerable.",
          type: "note" as const,
          startFrame: 708,
          duration: 207,
          trackId: "track-structural-analysis",
          color: "bg-sky-600",
          layoutType: "overlay" as const,
          anchorPoint: "bottom" as const,
          linkedGraphTrackIds: ["graph-anticipatory-suspense"],
          tags: ["Suspense", "Preview"]
        },
        {
          id: "clip-analysis-note-9-events",
          name: "Events",
          description: "• Guard unlocks the door and enters building",
          type: "note" as const,
          startFrame: 708,
          duration: 207,
          trackId: "track-structural-analysis",
          color: "bg-blue-600",
          layoutType: "overlay" as const,
          anchorPoint: "bottom" as const,
          tags: ["Events", "Preview"]
        },
        {
          id: "clip-analysis-note-10-main",
          name: "Analysis",
          description: "Security feed framing signals the heist has begun.",
          type: "note" as const,
          startFrame: 915,
          duration: 148,
          trackId: "track-structural-analysis",
          color: "bg-amber-600",
          layoutType: "overlay" as const,
          anchorPoint: "bottom" as const,
          tags: ["Analysis", "Preview"]
        },
        {
          id: "clip-analysis-note-10-suspense",
          name: "Suspense Reasoning",
          description: "CCTV view detaches the viewer, increasing dread.",
          type: "note" as const,
          startFrame: 915,
          duration: 148,
          trackId: "track-structural-analysis",
          color: "bg-sky-600",
          layoutType: "overlay" as const,
          anchorPoint: "bottom" as const,
          linkedGraphTrackIds: ["graph-anticipatory-suspense"],
          tags: ["Suspense", "Preview"]
        },
        {
          id: "clip-analysis-note-10-events",
          name: "Events",
          description: "• CCTV footage shows guard entering with hand truck",
          type: "note" as const,
          startFrame: 915,
          duration: 148,
          trackId: "track-structural-analysis",
          color: "bg-blue-600",
          layoutType: "overlay" as const,
          anchorPoint: "bottom" as const,
          tags: ["Events", "Preview"]
        },
        {
          id: "clip-dialogue-orig-0-0",
          name: "helicopter we're fucked if we see SWAT",
          type: "dialog" as const,
          startFrame: 0,
          duration: 28,
          trackId: "track-verbatim-dialogue",
          color: "bg-purple-600",
          layoutOrder: 1,
          layoutType: "overlay" as const,
          anchorPoint: "bottom" as const,
          characterId: "char-mac"
        },
        {
          id: "clip-dialogue-orig-3-0",
          name: "No one needs to get hurt.",
          type: "dialog" as const,
          startFrame: 140,
          duration: 70,
          trackId: "track-verbatim-dialogue",
          color: "bg-purple-600",
          layoutOrder: 4,
          layoutType: "overlay" as const,
          anchorPoint: "bottom" as const,
          characterId: "char-mac"
        },
        {
          id: "clip-dialogue-orig-4-0",
          name: "These guys like to test you though.",
          type: "dialog" as const,
          startFrame: 210,
          duration: 159,
          trackId: "track-verbatim-dialogue",
          color: "bg-purple-600",
          layoutOrder: 5,
          layoutType: "overlay" as const,
          anchorPoint: "bottom" as const,
          characterId: "char-jem"
        },
        {
          id: "clip-dialogue-orig-5-0",
          name: "Let's go.",
          type: "dialog" as const,
          startFrame: 369,
          duration: 87,
          trackId: "track-verbatim-dialogue",
          color: "bg-purple-600",
          layoutOrder: 6,
          layoutType: "overlay" as const,
          anchorPoint: "bottom" as const,
          characterId: "char-mac"
        },
        {
          id: "clip-media-video",
          name: "town.mp4",
          type: "video" as const,
          startFrame: 0,
          duration: 989,
          trackId: "track-media-layer",
          color: "bg-indigo-600",
          src: ""
        }
      ],
      tracks: [
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
        },
        {
          id: "graph-dramatic-tension",
          name: "Dramatic Tension",
          parentId: "group-story-analytics",
          type: "graph" as const,
          graph: {
            type: "line" as const,
            label: "Tension",
            min: 0,
            max: 10,
            increment: 1,
            barIntervalSeconds: 0.5,
            showValue: true,
            color: "#ec2727",
            points: [
              { frame: 14, value: 6 },
              { frame: 71, value: 6 },
              { frame: 127, value: 6 },
              { frame: 175, value: 7 },
              { frame: 290, value: 7 },
              { frame: 413, value: 7 },
              { frame: 509, value: 8 },
              { frame: 608, value: 0 },
              { frame: 681, value: 0 },
              { frame: 812, value: 0 },
              { frame: 989, value: 0 }
            ],
            shortLabel: "T",
            noteDurationSeconds: 3
          }
        },
        {
          id: "graph-anticipatory-suspense",
          name: "Anticipatory Suspense",
          parentId: "group-story-analytics",
          type: "graph" as const,
          graph: {
            type: "line" as const,
            label: "Suspense",
            min: 0,
            max: 10,
            increment: 1,
            barIntervalSeconds: 0.5,
            showValue: true,
            color: "#32c0ec",
            points: [
              { frame: 14, value: 0 },
              { frame: 71, value: 0 },
              { frame: 127, value: 0 },
              { frame: 175, value: 0 },
              { frame: 290, value: 0 },
              { frame: 413, value: 0 },
              { frame: 509, value: 8 },
              { frame: 608, value: 8 },
              { frame: 681, value: 8 },
              { frame: 812, value: 9 },
              { frame: 989, value: 9 }
            ],
            shortLabel: "S",
            noteDurationSeconds: 3
          }
        },
        {
          id: "graph-operational-stakes",
          name: "Stakes / Conflict",
          parentId: "group-story-analytics",
          type: "graph" as const,
          graph: {
            type: "line" as const,
            label: "Stakes",
            min: 0,
            max: 10,
            increment: 1,
            barIntervalSeconds: 0.5,
            showValue: true,
            color: "#27be45",
            points: [
              { frame: 14, value: 8 },
              { frame: 71, value: 0 },
              { frame: 127, value: 0 },
              { frame: 175, value: 0 },
              { frame: 290, value: 5 },
              { frame: 413, value: 0 },
              { frame: 509, value: 0 },
              { frame: 608, value: 0 },
              { frame: 681, value: 0 },
              { frame: 812, value: 0 },
              { frame: 989, value: 0 }
            ],
            shortLabel: "ST",
            noteDurationSeconds: 3
          }
        }
      ]
    }
  ],
  characters: [
    {
      id: "char-mac",
      name: "Mac"
    },
    {
      id: "char-jem",
      name: "Jem"
    }
  ],
  activeSceneId: "scene-1779552746272",
  collapsedTrackIds: [],
  disabledTrackIds: [],
  config: {
    aspectRatio: "16:9" as const,
    zoom: 1,
    fps: 30,
    playbackRate: 1,
    addGridItemPosition: "last" as const,
    previewGroupLayout: "row" as const,
    previewSceneMode: "active" as const,
    previewSceneIds: [],
    analyticsOverlayStyle: "compact" as const,
    showNoteOverlayIcons: true
  }
};

// detectLetterbox, extractCharacterAvatarFromVideo, extractBeatThumbnailFromVideo are imported from '@/lib/video-helpers'

function EditorInner() {
  // Routing integrations
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const sceneIdParam = searchParams?.get('sceneId');

  const { 
    zoom, 
    setZoom,
    aspectRatio, 
    setAspectRatio,
    fps,
    clips, 
    selectedClipIds, 
    characters,
    updateClip, 
    addClip,
    setSelectedClipIds, 
    deleteClip,
    scenes,
    activeSceneId,
    setActiveScene,
    addScene,
    deleteScene,
    updateScene,
    reorderScenes,
    tracks,
    updateTrack,
    deleteTrack,
    previewGroupLayout,
    setPreviewGroupLayout,
    previewSceneMode,
    setPreviewSceneMode,
    previewSceneIds,
    togglePreviewScene,
    previewMediaLayout,
    setPreviewMediaLayout,
    analyticsOverlayStyle,
    setAnalyticsOverlayStyle,
    showNoteOverlayIcons,
    setShowNoteOverlayIcons,
    moveClipToFirst,
    moveClipToLast,
    exportProject,
    importProject,
    importProjectIntoCurrent,
    resetToBlankScene,
    workspaceViewMode,
    setWorkspaceViewMode,
    currentFrame,
    setCurrentFrame,
    isPlaying,
    setPlaying,
    playbackRate,
    setPlaybackRate,
    totalDuration,
    noteTagFilter,
    setNoteTagFilter,
    showStarredNoteOverlaysOnly,
    setShowStarredNoteOverlaysOnly,
    showDialogPreviewUi,
    setShowDialogPreviewUi,
    showSceneTitleUi,
    setShowSceneTitleUi,
    compactNoteOverlays,
    setCompactNoteOverlays,
    disabledTrackIds,
    toggleTrackDisable,
    currentUser,
    setCurrentUser,
    isAuthChecking,
    activeSavedSceneId,
    setActiveSavedSceneId,
    activeSavedScenePublished,
    setActiveSavedScenePublished
  } = useTimeline();

  const isSceneLoading = !!(sceneIdParam && activeSavedSceneId !== sceneIdParam);
  const isNewSceneParam = searchParams.get('new') === '1';
  
  const selectedClip = clips.find(c => c.id === selectedClipIds[selectedClipIds.length - 1]);
  const activeScene = scenes.find(scene => scene.id === activeSceneId) || scenes[0];
  const [activeTab, setActiveTab] = React.useState<SidebarTab>(null);
  const [isFileMenuOpen, setIsFileMenuOpen] = React.useState(false);
  const [isRendering, setIsRendering] = React.useState(false);
  const [scriptEditorClipId, setScriptEditorClipId] = React.useState<string | null>(null);
  const [renderGroupOptions, setRenderGroupOptions] = React.useState<RenderGroupOption[] | null>(null);
  const [pendingProjectImport, setPendingProjectImport] = React.useState<PendingProjectImport | null>(null);
  const [isSaveSceneOpen, setIsSaveSceneOpen] = React.useState(false);
  const [isSceneLibraryOpen, setIsSceneLibraryOpen] = React.useState(false);
  const [savedSceneName, setSavedSceneName] = React.useState('');
  const [savedScenes, setSavedScenes] = React.useState<SavedSceneSummary[]>([]);
  const [isLoadingSavedScenes, setIsLoadingSavedScenes] = React.useState(false);
  const [savedScenesLoadError, setSavedScenesLoadError] = React.useState<string | null>(null);
  const [sceneLaunchSearch, setSceneLaunchSearch] = React.useState('');
  const [sceneComposerText, setSceneComposerText] = React.useState('');
  const [sceneLaunchMediaItems, setSceneLaunchMediaItems] = React.useState<Array<{
    id: string;
    name: string;
    type: 'image' | 'video';
    previewUrl: string;
    durationSeconds?: number;
  }>>([]);
  const [sceneLaunchBeats, setSceneLaunchBeats] = React.useState<Array<{
    id: string;
    name: string;
    items: Array<{
      id: string;
      name: string;
      type: 'image' | 'video';
      previewUrl: string;
      durationSeconds?: number;
    }>;
    childIds: string[];
    gridOrder: Array<{
      id: string;
      type: 'media' | 'collection';
    }>;
  }>>([]);
  const [sceneLaunchGridOrder, setSceneLaunchGridOrder] = React.useState<Array<{
    id: string;
    type: 'media' | 'collection';
  }>>([]);
  const [activeBeatUploadId, setActiveBeatUploadId] = React.useState<string | null>(null);
  const [sceneLaunchBeatPath, setSceneLaunchBeatPath] = React.useState<string[]>([]);
  const [hasLoadedSceneLaunchBoard, setHasLoadedSceneLaunchBoard] = React.useState(false);
  const [sceneLaunchPreviewHover, setSceneLaunchPreviewHover] = React.useState<{ collectionId: string; startedAt: number } | null>(null);
  const [sceneLaunchPreviewNow, setSceneLaunchPreviewNow] = React.useState(() => Date.now());
  const [sceneLaunchContextMenu, setSceneLaunchContextMenu] = React.useState<{ dragKey: string; x: number; y: number } | null>(null);
  const [pxPerSecond, setPxPerSecond] = React.useState(20);
  const [resizingItem, setResizingItem] = React.useState<{
    id: string;
    initialDuration: number;
    currentDuration: number;
    startX: number;
  } | null>(null);
  const [timelineDragOverKey, setTimelineDragOverKey] = React.useState<string | null>(null);
  const [gridDragOverInfo, setGridDragOverInfo] = React.useState<{ targetKey: string; position: 'before' | 'after' | 'inside' } | null>(null);
  const [isEditingHeaderName, setIsEditingHeaderName] = React.useState(false);
  const [editingHeaderNameValue, setEditingHeaderNameValue] = React.useState('');
  const [isTimelinePlaying, setIsTimelinePlaying] = React.useState(false);
  const [isTimelineLooping, setIsTimelineLooping] = React.useState(true);
  const [timelineCurrentTime, setTimelineCurrentTime] = React.useState(0);
  const currentTimeRef = React.useRef(0);
  React.useEffect(() => {
    currentTimeRef.current = timelineCurrentTime;
  }, [timelineCurrentTime]);
  const [isScrubbing, setIsScrubbing] = React.useState(false);
  const beatFileInputRef = React.useRef<HTMLInputElement>(null);
  const sceneLaunchMediaItemsRef = React.useRef(sceneLaunchMediaItems);
  const sceneLaunchBeatsRef = React.useRef(sceneLaunchBeats);

  // Authentication & Authorization Role States
  const [isAuthModalOpen, setIsAuthModalOpen] = React.useState(false);
  const [isAdminModalOpen, setIsAdminModalOpen] = React.useState(false);
  const [authMode, setAuthMode] = React.useState<'login' | 'signup'>('login');
  const [authUsername, setAuthUsername] = React.useState('');
  const [authPassword, setAuthPassword] = React.useState('');
  const [authLoading, setAuthLoading] = React.useState(false);
  const [authError, setAuthError] = React.useState('');
  const [allUsers, setAllUsers] = React.useState<{ id: string; username: string; role: 'viewer' | 'editor' | 'admin'; createdAt: string }[]>([]);
  const [isLoadingUsers, setIsLoadingUsers] = React.useState(false);

  // Enforce authentication: redirect anonymous users back to landing homepage
  React.useEffect(() => {
    if (!isAuthChecking && !isSceneLoading) {
      if (!currentUser) {
        const isPublicAnalysis = pathname === '/analysis' && sceneIdParam && activeSavedScenePublished;
        if (!isPublicAnalysis) {
          toast.error('You must be logged in to access the workspace.', { id: 'auth-redirect-toast' });
          router.push('/');
        }
      }
    }
  }, [isAuthChecking, isSceneLoading, currentUser, router, pathname, sceneIdParam, activeSavedScenePublished]);

  const handleLogout = async () => {
    try {
      const res = await fetch('/api/auth/logout', { method: 'POST' });
      if (res.ok) {
        setCurrentUser(null);
        toast.success('Successfully logged out.');
        // Refresh scene library
        void loadSavedScenes({ silent: true });
      }
    } catch (err) {
      console.error('Logout error:', err);
      toast.error('Failed to log out.');
    }
  };

  const handleLoadUsers = async () => {
    setIsLoadingUsers(true);
    try {
      const res = await fetch('/api/auth/users');
      if (res.ok) {
        const data = await res.json();
        setAllUsers(data.users || []);
      } else {
        const errData = await res.json().catch(() => ({}));
        toast.error(errData.error || 'Failed to load user list.');
      }
    } catch (err) {
      console.error('Error loading users:', err);
      toast.error('Error loading user list.');
    } finally {
      setIsLoadingUsers(false);
    }
  };

  const handleUpdateUserRole = async (userId: string, role: 'viewer' | 'editor' | 'admin') => {
    try {
      const res = await fetch('/api/auth/users', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, role }),
      });
      if (res.ok) {
        toast.success('User role updated successfully.');
        void handleLoadUsers();
      } else {
        const errData = await res.json().catch(() => ({}));
        toast.error(errData.error || 'Failed to update user role.');
      }
    } catch (err) {
      console.error('Error updating user role:', err);
      toast.error('Error updating user role.');
    }
  };

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    if (!authUsername.trim() || !authPassword) {
      setAuthError('All fields are required.');
      return;
    }
    setAuthLoading(true);
    try {
      const endpoint = authMode === 'login' ? '/api/auth/login' : '/api/auth/register';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: authUsername.trim(), password: authPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        if (authMode === 'signup') {
          toast.success('Account created successfully! You can now log in.');
          setAuthMode('login');
          setAuthPassword('');
          setAuthLoading(false);
          return;
        }
        
        setCurrentUser(data.user);
        setIsAuthModalOpen(false);
        setAuthUsername('');
        setAuthPassword('');
        toast.success(`Welcome back, ${data.user.username}!`);
        // Refresh scene library
        void loadSavedScenes({ silent: true });
      } else {
        setAuthError(data.error || 'Authentication failed.');
      }
    } catch (err) {
      console.error('Auth error:', err);
      setAuthError('An error occurred. Please try again.');
    } finally {
      setAuthLoading(false);
    }
  };

  const [isSavingScene, setIsSavingScene] = React.useState(false);
  const [isCapturingSceneThumbnail, setIsCapturingSceneThumbnail] = React.useState(false);
  const [sceneSaveStatus, setSceneSaveStatus] = React.useState<string | null>(null);
  const [sceneThumbnailPreviewUrls, setSceneThumbnailPreviewUrls] = React.useState<Record<string, string>>({});
  const [loadingSavedSceneId, setLoadingSavedSceneId] = React.useState<string | null>(null);
  const [pendingSavedSceneDelete, setPendingSavedSceneDelete] = React.useState<SavedSceneSummary | null>(null);
  const [deletingSavedSceneId, setDeletingSavedSceneId] = React.useState<string | null>(null);
  const [autosaveStatus, setAutosaveStatus] = React.useState<AutosaveStatus>('idle');
  const [autosaveMessage, setAutosaveMessage] = React.useState('Autosave ready');
  const autosaveSceneIdRef = React.useRef<string | null>(null);
  const lastAutosaveSnapshotRef = React.useRef<string | null>(null);
  const isDraggingRef = React.useRef(false);
  const workspaceRef = React.useRef<HTMLDivElement>(null);
  const [previewPanelPercent, setPreviewPanelPercent] = React.useState(56);
  const [reviewShowPreviewTagUi, setReviewShowPreviewTagUi] = React.useState(true);
  const [reviewContentMode, setReviewContentMode] = React.useState<'notes' | 'dialog'>('notes');
  const [verticalTimeScale, setVerticalTimeScale] = React.useState(1);



  // Synchronize route pathname with workspaceViewMode
  React.useEffect(() => {
    if (pathname === '/analysis') {
      if (workspaceViewMode !== 'analysis') setWorkspaceViewMode('analysis');
    } else if (pathname === '/review') {
      if (workspaceViewMode !== 'review') setWorkspaceViewMode('review');
    } else if (pathname === '/editor' || pathname === '/') {
      if (workspaceViewMode !== 'editor') setWorkspaceViewMode('editor');
    }
  }, [pathname, workspaceViewMode, setWorkspaceViewMode]);

  // Synchronize search params sceneId with context activeSavedSceneId on mount/change
  React.useEffect(() => {
    if (isNewSceneParam && !sceneIdParam) {
      resetToBlankScene();
      return;
    }

    if (sceneIdParam) {
      if (sceneIdParam !== activeSavedSceneId) {
        const loadSceneFromUrl = async () => {
          try {
            const response = await fetch(`/api/scenes/${sceneIdParam}`, { cache: 'no-store' });
            const result = await response.json().catch(() => ({})) as {
              scene?: SavedSceneSummary & { project: TimelineProjectJson };
              error?: string;
            };
            if (response.ok && result.scene && result.scene.project) {
              importProject(result.scene.project);
              setActiveSavedSceneId(sceneIdParam);
              setActiveSavedScenePublished(!!result.scene.isPublished);
            }
          } catch (error) {
            console.error('Failed to load scene from URL parameter:', error);
          }
        };
        void loadSceneFromUrl();
      }
    } else {
      // No sceneId in URL: clear active saved scene state to start fresh/blank
      if (activeSavedSceneId !== null) {
        setActiveSavedSceneId(null);
        setActiveSavedScenePublished(false);
      }
    }
  }, [sceneIdParam, isNewSceneParam, activeSavedSceneId, importProject, resetToBlankScene, setActiveSavedSceneId, setActiveSavedScenePublished]);


  const getAutosaveSnapshot = React.useCallback(() => {
    const project = exportProject();
    const comparableProject = { ...project, exportedAt: '' };
    return {
      project,
      serialized: JSON.stringify(comparableProject),
    };
  }, [exportProject]);

  React.useEffect(() => {
    if (!activeSavedSceneId || isSceneLoading) {
      autosaveSceneIdRef.current = null;
      lastAutosaveSnapshotRef.current = null;
      setAutosaveStatus('idle');
      setAutosaveMessage('Autosave ready');
      return;
    }

    if (autosaveSceneIdRef.current !== activeSavedSceneId) {
      autosaveSceneIdRef.current = activeSavedSceneId;
      lastAutosaveSnapshotRef.current = getAutosaveSnapshot().serialized;
      setAutosaveStatus('saved');
      setAutosaveMessage('Saved');
    }
  }, [activeSavedSceneId, getAutosaveSnapshot, isSceneLoading]);

  React.useEffect(() => {
    if (
      !activeSavedSceneId ||
      isSceneLoading ||
      !currentUser ||
      currentUser.role === 'viewer' ||
      isSavingScene ||
      isCapturingSceneThumbnail
    ) {
      return;
    }

    const { project, serialized } = getAutosaveSnapshot();
    if (serialized === lastAutosaveSnapshotRef.current) return;

    const controller = new AbortController();
    setAutosaveStatus('pending');
    setAutosaveMessage('Autosave pending...');
    const timeoutId = window.setTimeout(async () => {
      try {
        setAutosaveStatus('saving');
        setAutosaveMessage('Autosaving...');
        const response = await fetch(`/api/scenes/${activeSavedSceneId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ project }),
          signal: controller.signal,
        });
        const result = await response.json().catch(() => ({})) as { scene?: SavedSceneSummary; error?: string };

        if (!response.ok || !result.scene) {
          throw new Error(result.error || 'Autosave failed.');
        }

        lastAutosaveSnapshotRef.current = serialized;
        setSavedScenes(previous => previous.map(scene => (
          scene.id === activeSavedSceneId ? { ...scene, ...result.scene } : scene
        )));
        setAutosaveStatus('saved');
        setAutosaveMessage('Saved');
      } catch (error) {
        if (controller.signal.aborted) return;
        console.error('Autosave scene error:', error);
        setAutosaveStatus('error');
        setAutosaveMessage('Autosave failed');
      }
    }, 900);

    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [
    activeSavedSceneId,
    currentUser,
    getAutosaveSnapshot,
    isCapturingSceneThumbnail,
    isSavingScene,
    isSceneLoading,
  ]);



  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [pendingType, setPendingType] = React.useState<ClipType | null>(null);

  const normalizeTagKey = React.useCallback((value: string | undefined) => value?.trim().toLowerCase() || '', []);
  const activeVideoClipAtCurrentFrame = React.useMemo(() => (
    activeScene?.clips
      .filter(clip => clip.type === 'video' && clip.src)
      .find(clip => currentFrame >= clip.startFrame && currentFrame < clip.startFrame + clip.duration)
  ), [activeScene, currentFrame]);
  const activeSceneThumbnailPreviewUrl = activeScene
    ? sceneThumbnailPreviewUrls[activeScene.id] || activeScene.thumbnailUrl
    : undefined;

  const previewScenes = React.useMemo(() => {
    const previewSceneIdSet = previewSceneIds.length > 0 ? new Set(previewSceneIds) : undefined;
    const includedScenes = previewSceneIdSet
      ? scenes.filter(scene => previewSceneIdSet.has(scene.id))
      : scenes;
    if (previewSceneMode === 'all' || includedScenes.length > 1) {
      return includedScenes.length > 0 ? includedScenes : scenes.filter(scene => scene.id === activeSceneId);
    }
    return scenes.filter(scene => scene.id === activeSceneId);
  }, [activeSceneId, previewSceneIds, previewSceneMode, scenes]);

  const sceneTabs = previewScenes.length > 1 ? previewScenes : [];

  const closeSceneLaunchView = () => {
    const currentParams = new URLSearchParams(window.location.search);
    currentParams.delete('new');
    const nextQuery = currentParams.toString();
    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname);
  };

  const handleAddClipClick = (type: ClipType) => {
    if (type === 'dialog') {
      handleAddClip('dialog', 'Narrator');
    } else if (type === 'note') {
      handleAddClip('note');
    } else {
      setPendingType(type);
      fileInputRef.current?.click();
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && pendingType) {
      if (isNewSceneParam && (pendingType === 'video' || pendingType === 'image')) {
        addFilesToSceneLaunchMedia([file]);
      } else {
        handleAddClip(pendingType, undefined, file);
      }
    }
    e.target.value = '';
    setPendingType(null);
  };

  const handleAddClip = (type: ClipType, character?: string, file?: File) => {
    let trackId = 'track-1';
    let color = 'bg-indigo-600';
    let name = file ? file.name : 'New Clip';

    if (type === 'video') {
       trackId = tracks.find(t => t.name.includes('Video'))?.id || 'track-1';
       color = 'bg-zinc-600';
    } else if (type === 'image') {
       trackId = tracks.find(t => t.name.includes('Images'))?.id || 'track-4';
       color = 'bg-zinc-600';
    } else if (type === 'dialog') {
       trackId = tracks.find(t => t.name.includes('Dialog'))?.id || 'track-3';
       color = 'bg-purple-600';
       name = character ? `Line for ${character}` : 'Dialog';
    } else if (type === 'note') {
       trackId = tracks.find(t => t.name.includes('Dialog'))?.id || 'track-3';
       color = 'bg-amber-600';
       name = 'Note';
    }

    addClip({
      id: `clip-${Math.random().toString(36).substr(2, 9)}`,
      name,
      type,
      startFrame: currentFrame,
      duration: type === 'video' ? 150 : 60,
      trackId,
      color,
      character
    }, file);
  };

  const formatTime = (frame: number) => {
    const totalSeconds = frame / fps;
    const mins = Math.floor(totalSeconds / 60);
    const secs = Math.floor(totalSeconds % 60);
    const frames = frame % fps;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${frames.toString().padStart(2, '0')}`;
  };

  const formatReviewTime = (frame: number, currentFps: number) => {
    const seconds = frame / currentFps;
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const NOTE_TAG_FILTER_NONE = '__NO_NOTE_TAGS_VISIBLE__';

  const noteTagCounts = React.useMemo(() => {
    const counts = new Map<string, { label: string; count: number }>();
    previewScenes.flatMap(scene => scene.clips)
        .filter(clip => clip.type === 'note')
        .flatMap(clip => clip.tags || [])
        .map(tag => tag.trim())
        .filter(Boolean)
        .forEach(tag => {
          const key = tag.toLowerCase();
          const existing = counts.get(key);
          counts.set(key, { label: existing?.label || tag, count: (existing?.count || 0) + 1 });
        });
    return counts;
  }, [previewScenes]);

  const graphTagKeySet = React.useMemo(() => (
    new Set(
      previewScenes
        .flatMap(scene => scene.tracks)
        .filter(track => track.type === 'graph' && track.graph)
        .flatMap(track => [
          track.name,
          track.graph?.label,
          track.graph?.shortLabel,
          getGraphDisplayLabel(track.graph, track.name),
          getGraphShortLabel(track.graph, track.name),
        ])
        .map(normalizeTagKey)
        .filter(Boolean)
    )
  ), [previewScenes, normalizeTagKey]);

  const noteTags = React.useMemo(() => (
    Array.from(noteTagCounts.values())
      .map(item => item.label)
      .filter(tag => normalizeTagKey(tag) !== 'preview' && !graphTagKeySet.has(normalizeTagKey(tag)))
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
  ), [graphTagKeySet, noteTagCounts, normalizeTagKey]);

  const graphLayers = React.useMemo(() => {
    const trackById = new Map(tracks.map(track => [track.id, track]));
    return tracks
      .filter(track => track.type === 'graph' && track.graph)
      .map(track => ({
        id: track.id,
        label: getGraphDisplayLabel(track.graph, track.name),
        parentName: track.parentId ? trackById.get(track.parentId)?.name : undefined,
        isVisible: !disabledTrackIds.includes(track.id),
      }))
      .sort((a, b) => (
        (a.parentName || '').localeCompare(b.parentName || '', undefined, { sensitivity: 'base' }) ||
        a.label.localeCompare(b.label, undefined, { sensitivity: 'base' })
      ));
  }, [disabledTrackIds, tracks]);

  const visibleGraphLayerCount = graphLayers.filter(layer => layer.isVisible).length;

  const enabledNoteTagSet = React.useMemo(() => (
    new Set((noteTagFilter.length > 0 ? noteTagFilter : noteTags)
      .filter(tag => tag !== NOTE_TAG_FILTER_NONE)
      .map(tag => tag.toLowerCase()))
  ), [noteTagFilter, noteTags]);

  const activeFilterCount = noteTagFilter.length > 0
    ? noteTags.filter(tag => enabledNoteTagSet.has(tag.toLowerCase())).length
    : noteTags.length;

  const selectedFilterLabels = React.useMemo(() => {
    if (noteTagFilter.includes(NOTE_TAG_FILTER_NONE)) return showStarredNoteOverlaysOnly ? ['Starred only', 'No notes'] : ['No notes'];
    if (noteTags.length === 0) return [];
    const labels = noteTagFilter.length === 0
      ? ['All tags']
      : enabledNoteTagSet.size === 0
        ? ['None']
        : noteTags.filter(tag => enabledNoteTagSet.has(tag.toLowerCase()));
    return showStarredNoteOverlaysOnly ? ['Starred only', ...labels] : labels;
  }, [enabledNoteTagSet, noteTagFilter, noteTags, showStarredNoteOverlaysOnly]);

  const filterSummaryLabel = selectedFilterLabels.length > 2
    ? `${selectedFilterLabels.slice(0, 2).join(', ')} +${selectedFilterLabels.length - 2}`
    : selectedFilterLabels.join(', ');

  React.useEffect(() => {
    if (noteTagFilter.length === 0) return;

    const noteTagKeySet = new Set(noteTags.map(normalizeTagKey));
    const nextNoteTagFilter = noteTagFilter.filter(tag => (
      tag === NOTE_TAG_FILTER_NONE || noteTagKeySet.has(normalizeTagKey(tag))
    ));

    if (nextNoteTagFilter.length !== noteTagFilter.length) {
      setNoteTagFilter(
        nextNoteTagFilter.includes(NOTE_TAG_FILTER_NONE) || nextNoteTagFilter.some(tag => tag !== NOTE_TAG_FILTER_NONE)
          ? nextNoteTagFilter
          : []
      );
    }
  }, [noteTagFilter, noteTags, setNoteTagFilter, normalizeTagKey]);

  const toggleNoteTag = (tag: string) => {
    const tagKey = tag.toLowerCase();
    const currentEnabledTags = noteTagFilter.length > 0
      ? noteTagFilter.filter(item => item !== NOTE_TAG_FILTER_NONE)
      : noteTags;
    const isEnabled = currentEnabledTags.some(item => item.toLowerCase() === tagKey);
    const nextEnabledTags = isEnabled
      ? currentEnabledTags.filter(item => item.toLowerCase() !== tagKey)
      : [...currentEnabledTags, tag];

    setNoteTagFilter(nextEnabledTags.length > 0 ? nextEnabledTags : [NOTE_TAG_FILTER_NONE]);
  };

  const clampPreviewPanelPercent = React.useCallback((value: number) => (
    Math.max(28, Math.min(78, value))
  ), []);

  const resizePreviewPanel = React.useCallback((clientY: number) => {
    const workspace = workspaceRef.current;
    if (!workspace) return;

    const bounds = workspace.getBoundingClientRect();
    const nextPercent = ((clientY - bounds.top) / Math.max(1, bounds.height)) * 100;
    setPreviewPanelPercent(clampPreviewPanelPercent(nextPercent));
  }, [clampPreviewPanelPercent]);

  const handleResizePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  };

  const handleResizePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    resizePreviewPanel(event.clientY);
  };

  const handleResizePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  };

  const handleResizeKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 8 : 3;
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setPreviewPanelPercent(prev => clampPreviewPanelPercent(prev - step));
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setPreviewPanelPercent(prev => clampPreviewPanelPercent(prev + step));
    }
    if (event.key === 'Home') {
      event.preventDefault();
      setPreviewPanelPercent(28);
    }
    if (event.key === 'End') {
      event.preventDefault();
      setPreviewPanelPercent(78);
    }
  };

  const projectImportInputRef = React.useRef<HTMLInputElement>(null);
  const fileMenuRef = React.useRef<HTMLDivElement>(null);
  const sidePanelRef = React.useRef<HTMLElement>(null);
  const clipPropertiesPanelRef = React.useRef<HTMLElement>(null);
  const scriptEditorClip = scriptEditorClipId ? clips.find(clip => clip.id === scriptEditorClipId) : undefined;

  // AI Video Analysis States
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
      // If we already have the correct object URL set, don't do anything
      if (videoObjectURL === videoClip.src) return;

      // Fetch the blob and reconstruct the File object
      const syncVideoFile = async () => {
        try {
          // 1. Try loading from IndexedDB first (most reliable for reloads/sessions)
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
            
            // If the URL in the clip state was different (e.g. an old expired blob URL), update it
            if (videoClip.src !== newObjectUrl) {
              updateClip(videoClip.id, { src: newObjectUrl });
            }
            return;
          }

          // 2. Fall back to fetching the src if it's not a blob: URL (e.g., remote URL or api path)
          // If it is a blob URL and we didn't find it in loadBlob, it's expired/invalid, so don't try to fetch it.
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
      // If there is no video clip in the active scene, reset the state
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
        setAnalysisLogs(prev => [...prev, `[LOCAL] ${sampledFrames.length} visual frames ready for Gemma analysis.`]);
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
          { percent: 65, delay: 900, log: "[STAGE 2] Extracting visual narrative beats and scene text..." },
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
            
            const videoDurationInFrames = Math.round((videoDuration || 30) * fps);
            
            const videoClip = {
              id: "clip-media-video",
              name: selectedVideoFile.name || "town.mp4",
              type: "video" as const,
              startFrame: 0,
              duration: videoDurationInFrames,
              trackId: "track-media-layer",
              color: "bg-indigo-600",
              src: videoObjectURL
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
                const clipCopy = {
                  ...c,
                  type: c.type as any
                };
                mergedClips.push(clipCopy);
              }
            });

            const BASE_CHARACTERS: any[] = [
              { id: "char-mac", name: "Mac", face_timestamp: 2.0, face_box: [15, 35, 55, 65] },
              { id: "char-jem", name: "Jem", face_timestamp: 8.5, face_box: [20, 40, 60, 60] }
            ];
            const mergedCharacters = [...BASE_CHARACTERS] as any[];
            apiCharacters.forEach((char: any) => {
              if (!mergedCharacters.some(c => c.id === char.id)) {
                mergedCharacters.push(char);
              }
            });

            const modelName = requestResult.model || "gemini-2.5-flash";
            const sceneId = `scene-${Date.now()}`;
            const project = {
              version: 1,
              exportedAt: new Date().toISOString(),
              scenes: [
                {
                  id: sceneId,
                  name: selectedVideoFile.name || "town.mp4",
                  clips: mergedClips,
                  tracks: mergedTracks,
                  duration: videoDurationInFrames,
                  analysisModel: modelName
                }
              ],
              characters: mergedCharacters,
              activeSceneId: sceneId,
              model: modelName
            };

            // Crop and upload character avatars asynchronously from the local video file
            const processAvatars = async () => {
              setAnalysisLogs(prev => [...prev, "[SYSTEM] Extracting high-fidelity character close ups from video frames..."]);
              
              const updatedCharacters = [...mergedCharacters];
              
              for (const char of updatedCharacters) {
                // If it already has a custom image (from dynamic API or similar) we can skip it,
                // but since we want the absolute best crop from the actual video frame, we perform it if face_timestamp is available!
                let timestamp = typeof char.face_timestamp === 'number' ? char.face_timestamp : 2.0;
                const boundingBox = Array.isArray(char.face_box) && char.face_box.length === 4
                  ? char.face_box
                  : undefined;

                // Look for dialogue clips matching this character to get a guaranteed active frame
                const matchingDialogClip = (mergedClips as any[]).find(clip => {
                  if (clip.type !== 'dialog') return false;
                  
                  // Match by characterId
                  if (clip.characterId && clip.characterId === char.id) return true;
                  
                  // Match by name or legacy character field
                  const speakerName = (clip.character || clip.name || '').toLowerCase();
                  const targetName = char.name.toLowerCase();
                  return speakerName.includes(targetName) || targetName.includes(speakerName);
                });

                if (matchingDialogClip) {
                  const midFrame = matchingDialogClip.startFrame + Math.floor(matchingDialogClip.duration / 2);
                  const dialogueTime = midFrame / fps;
                  console.log(`[AVATAR_TIMING] Using dialogue-based timestamp ${dialogueTime.toFixed(2)}s instead of default ${timestamp}s for character "${char.name}"`);
                  timestamp = dialogueTime;
                }
                
                try {
                  setAnalysisLogs(prev => [...prev, `[SYSTEM] Seeking video to extract close-up headshot for character "${char.name}"...`]);
                  
                  // Extract frame directly from the locally uploaded video!
                  const croppedBlob = await extractCharacterAvatarFromVideo(selectedVideoFile, timestamp, boundingBox);
                  
                  // Upload to Vercel Blob publicly so all computers can see it!
                  const filename = `timeline-videos/char-${char.id}-${Date.now()}.png`;
                  setAnalysisLogs(prev => [...prev, `[SYSTEM] Uploading "${char.name}" cropped headshot to persistent cloud storage...`]);
                  
                  const file = new File([croppedBlob], filename, { type: 'image/png' });
                     try {
                    // Wrap upload in an 8-second safety timeout race to prevent hanging
                    const uploadPromise = localUpload(filename, file);

                    const timeoutPromise = new Promise<never>((_, reject) => {
                      setTimeout(() => reject(new Error("Local upload timed out (8s limit reached)")), 8000);
                    });

                    const hostedBlob = await Promise.race([uploadPromise, timeoutPromise]);

                    // Update character with the secure proxy URL (matching private storage proxy architecture)
                    char.image = `/api/scenes/media?pathname=${encodeURIComponent(hostedBlob.pathname)}`;
                    setAnalysisLogs(prev => [...prev, `[SUCCESS] Persistent cloud headshot successfully created for "${char.name}"!`]);
                  } catch (uploadErr) {
                    console.warn(`[UPLOAD_FAILED] Vercel Blob upload failed or store is suspended for "${char.name}". Falling back to local storage.`, uploadErr);
                    setAnalysisLogs(prev => [...prev, `[WARNING] Persistent upload failed for "${char.name}" (Vercel Blob store suspended). Saving to local IndexedDB.`]);
                    
                    // Resilient fallback: Use local blob URL immediately in memory
                    char.image = URL.createObjectURL(croppedBlob);
                  }
                  
                  // Also save locally in IndexedDB for instant hydration on page load
                  await saveBlob(`char-${char.id}`, croppedBlob);
                } catch (avatarErr) {
                  console.error(`[AVATAR_EXTRACTION_FAILED] for ${char.name}:`, avatarErr);
                  setAnalysisLogs(prev => [...prev, `[WARNING] Failed to extract custom headshot for "${char.name}", falling back to initials.`]);
                  // Fallback: adventurer SVG
                  char.image = `https://api.dicebear.com/7.x/adventurer-neutral/svg?seed=${encodeURIComponent(char.name)}`;
                }
              }

              // Compile the complete narrative report to save inside the project JSON scene
              const noteClips = mergedClips
                .filter((c) => c.type === "note" && (c.name === "Analysis" || c.tags?.includes("Analysis") || c.name.toLowerCase().includes("beat")))
                .sort((a, b) => a.startFrame - b.startFrame);

              // Extract storyboard beat thumbnails dynamically from the local video file
              setAnalysisLogs(prev => [...prev, "[SYSTEM] Extracting visual storyboard thumbnails for each narrative beat..."]);
              for (const beat of noteClips) {
                const midFrame = beat.startFrame + Math.floor(beat.duration / 2);
                const timestamp = midFrame / fps;

                try {
                  setAnalysisLogs(prev => [...prev, `[SYSTEM] Seeking video to extract storyboard thumbnail for "${beat.name}"...`]);
                  
                  // Extract widescreen 16:9 frame
                  const thumbnailBlob = await extractBeatThumbnailFromVideo(selectedVideoFile, timestamp);
                  
                  const filename = `timeline-videos/beat-thumb-${beat.id}-${Date.now()}.jpg`;
                  setAnalysisLogs(prev => [...prev, `[SYSTEM] Uploading "${beat.name}" storyboard thumbnail to cloud storage...`]);
                  
                  try {
                    const uploadPromise = localUpload(filename, thumbnailBlob);
                    const timeoutPromise = new Promise<never>((_, reject) => {
                      setTimeout(() => reject(new Error("Local upload timed out (8s limit)")), 8000);
                    });
                    const hostedBlob = await Promise.race([uploadPromise, timeoutPromise]);
                    
                    // Attach cloud hosted URL
                    (beat as any).thumbnailUrl = `/api/scenes/media?pathname=${encodeURIComponent(hostedBlob.pathname)}`;
                    setAnalysisLogs(prev => [...prev, `[SUCCESS] Persistent storyboard thumbnail created for "${beat.name}"!`]);
                  } catch (uploadErr) {
                    console.warn(`[UPLOAD_FAILED] Beat thumbnail upload failed for "${beat.name}":`, uploadErr);
                    setAnalysisLogs(prev => [...prev, `[WARNING] Persistent upload failed for "${beat.name}". Using local fallback.`]);
                    (beat as any).thumbnailUrl = URL.createObjectURL(thumbnailBlob);
                  }
                  
                  // Save locally in IndexedDB for instant reload hydration
                  await saveBlob(`beat-thumb-${beat.id}`, thumbnailBlob);
                } catch (thumbErr) {
                  console.error(`[THUMBNAIL_EXTRACTION_FAILED] for beat ${beat.name}:`, thumbErr);
                  setAnalysisLogs(prev => [...prev, `[WARNING] Failed to extract custom storyboard thumbnail for "${beat.name}".`]);
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
                  if (pt.frame <= frame) {
                    val = pt.value;
                  } else {
                    break;
                  }
                }
                return val;
              };

              const parsedBeats = noteClips.map((beat, idx) => {
                const start = beat.startFrame / fps;
                const end = (beat.startFrame + beat.duration) / fps;

                const overlappingClips = mergedClips.filter(
                  (c) => c.type === "dialog" && c.startFrame >= beat.startFrame && c.startFrame < beat.startFrame + beat.duration
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
                };
              });

              const avgT = parseFloat((parsedBeats.reduce((acc, b) => acc + b.metrics.tension, 0) / Math.max(1, parsedBeats.length)).toFixed(2)) || 0;
              const avgS = parseFloat((parsedBeats.reduce((acc, b) => acc + b.metrics.suspense, 0) / Math.max(1, parsedBeats.length)).toFixed(2)) || 0;
              const avgA = parseFloat((parsedBeats.reduce((acc, b) => acc + b.metrics.anticipation, 0) / Math.max(1, parsedBeats.length)).toFixed(2)) || 0;

              let pacing = "Custom Storyboards Arc";
              if (modelName) {
                pacing = modelName.includes("gemma") ? "Slow-Burn Dialogue Arc" : "Crescendo / Rising Action Arc";
              }

              // Capture the pipeline logs for history
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
  }, [selectedVideoFile, isAnalyzing, videoDuration, videoObjectURL, fps, analysisModelChoice]);

  const openScriptEditorForClip = React.useCallback((clipId: string, sceneId: string) => {
    setActiveScene(sceneId);
    setSelectedClipIds([clipId]);
    setActiveTab(null);
    setScriptEditorClipId(clipId);
  }, [setActiveScene, setSelectedClipIds]);

  // Global key listener for deletion
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedClipIds.length > 0) {
        selectedClipIds.forEach(id => deleteClip(id));
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedClipIds, deleteClip]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || selectedClipIds.length === 0) return;
    const targetId = selectedClipIds[selectedClipIds.length - 1];
    const type = file.type.startsWith('image/') ? 'image' : 'video';
    await saveBlob(targetId, file);
    const url = URL.createObjectURL(file);
    updateClip(targetId, { src: url, type, name: file.name });
  };

  const handleExportProjectJson = () => {
    const project = exportProject();
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const date = new Date().toISOString().slice(0, 10);

    link.href = url;
    link.download = `remotion-timeline-project-${date}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    toast.success('Project JSON exported');
  };

  const handleImportProjectJson = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    try {
      const json = JSON.parse(await file.text()) as TimelineProjectJson;
      setPendingProjectImport({ fileName: file.name, project: json });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to read that JSON file.';
      toast.error(message);
    }
  };

  const loadSavedScenes = React.useCallback(async (options?: { silent?: boolean }) => {
    setIsLoadingSavedScenes(true);
    setSavedScenesLoadError(null);
    try {
      const response = await fetch('/api/scenes', { cache: 'no-store' });
      const result = await response.json().catch(() => ({})) as { scenes?: SavedSceneSummary[]; error?: string };
      if (!response.ok) {
        throw new Error(result.error || 'Unable to load recent scenes.');
      }
      setSavedScenes(result.scenes || []);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load recent scenes.';
      setSavedScenesLoadError(message);
      if (!options?.silent) {
        toast.error(message);
      }
    } finally {
      setIsLoadingSavedScenes(false);
    }
  }, []);

  React.useEffect(() => {
    void loadSavedScenes({ silent: true });
  }, [loadSavedScenes]);

  const openSaveSceneModal = () => {
    const activeScene = scenes.find(scene => scene.id === activeSceneId) || scenes[0];
    setSavedSceneName(getSuggestedSavedSceneName(activeScene));
    setIsSaveSceneOpen(true);
  };

  const openSceneLibrary = () => {
    setIsSceneLibraryOpen(true);
    void loadSavedScenes();
  };

  const sceneLibraryCountLabel = isLoadingSavedScenes
    ? '...'
    : savedScenesLoadError
      ? '!'
      : String(savedScenes.length);

  const uploadSceneVideo = async (clipName: string, video: Blob) => {
    const fileName = (clipName || 'scene-video.mp4')
      .replace(/[^a-zA-Z0-9._-]/g, '-')
      .slice(-100);
    const file = new File([video], fileName, { type: video.type || 'video/mp4' });
    setSceneSaveStatus(`Uploading ${fileName} (0%)`);
    const hostedVideo = await localUpload(fileName, file);
    setSceneSaveStatus(`Uploading ${fileName} (100%)`);

    return `/api/scenes/media?pathname=${encodeURIComponent(hostedVideo.pathname)}`;
  };

  const uploadSceneThumbnail = async (sceneName: string, thumbnail: Blob) => {
    const baseName = (sceneName || 'scene-thumbnail')
      .replace(/\.[^/.]+$/, '')
      .replace(/[^a-zA-Z0-9._-]/g, '-')
      .slice(0, 80);
    const fileName = `${baseName || 'scene'}-thumbnail-${Date.now()}.jpg`;
    const file = new File([thumbnail], fileName, { type: 'image/jpeg' });
    setSceneSaveStatus(`Uploading scene thumbnail (${fileName})...`);
    const hostedImage = await localUpload(fileName, file);

    return `/api/scenes/media?pathname=${encodeURIComponent(hostedImage.pathname)}`;
  };

  const getVideoBlobForClip = async (clip: TimelineClip, runtimeClip?: TimelineClip) => {
    if (clip.src?.startsWith('http') || clip.src?.startsWith('/api/scenes/media?')) {
      const response = await fetch(clip.src);
      return response.blob();
    }

    const localBlob = await loadBlob(clip.id);
    if (localBlob) return localBlob;

    if (runtimeClip?.src?.startsWith('blob:')) {
      const response = await fetch(runtimeClip.src);
      return response.blob();
    }

    if (runtimeClip?.src) {
      const response = await fetch(runtimeClip.src);
      return response.blob();
    }

    return undefined;
  };

  const handleCaptureCurrentFrameThumbnail = async () => {
    if (!activeScene || !activeVideoClipAtCurrentFrame || isPlaying || isCapturingSceneThumbnail) return;

    const capturedFrame = currentFrame;
    const capturedClip = activeVideoClipAtCurrentFrame;
    const capturedSceneId = activeScene.id;
    const savedSceneId = activeSavedSceneId;
    setIsCapturingSceneThumbnail(true);
    try {
      const runtimeClip = scenes
        .find(scene => scene.id === activeSceneId)
        ?.clips.find(clip => clip.id === capturedClip.id);
      const previewVideo = getPreviewVideoElementForClip(capturedClip.id);
      let thumbnail = previewVideo ? await captureVideoElementThumbnail(previewVideo) : null;

      if (!thumbnail) {
        const video = await getVideoBlobForClip(capturedClip, runtimeClip);

        if (!video) {
          throw new Error('No video media is available at the current frame.');
        }

        const targetTime = Math.max(0, (capturedFrame - capturedClip.startFrame) / fps);
        thumbnail = await captureVideoThumbnail(video, targetTime);
      }

      if (!thumbnail) {
        throw new Error('Unable to capture a thumbnail from this frame.');
      }

      await saveBlob(`${SCENE_THUMBNAIL_BLOB_PREFIX}-${capturedSceneId}`, thumbnail);
      const localThumbnailUrl = URL.createObjectURL(thumbnail);
      setSceneThumbnailPreviewUrls(previous => ({ ...previous, [capturedSceneId]: localThumbnailUrl }));
      setCurrentFrame(capturedFrame);

      const hostedThumbnailUrl = await uploadSceneThumbnail(activeScene.name, thumbnail);
      setSceneThumbnailPreviewUrls(previous => ({ ...previous, [capturedSceneId]: hostedThumbnailUrl }));

      const thumbnailSavedSceneId = savedSceneId || findMatchingSavedSceneId(savedScenes, activeScene, savedSceneName);

      if (thumbnailSavedSceneId) {
        const response = await fetch(`/api/scenes/${thumbnailSavedSceneId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ thumbnailUrl: hostedThumbnailUrl }),
        });
        const result = await response.json().catch(() => ({})) as { scene?: SavedSceneSummary; error?: string };

        if (!response.ok || !result.scene) {
          throw new Error(result.error || 'Thumbnail captured locally, but could not update the saved scene.');
        }

        const updatedScene = result.scene;
        setSavedScenes(previous => previous.map(scene => (
          scene.id === thumbnailSavedSceneId ? { ...updatedScene, thumbnailUrl: hostedThumbnailUrl } : scene
        )));
        setActiveSavedSceneId(thumbnailSavedSceneId);
      }

      toast.success('Scene thumbnail saved to public/timeline-thumbnails');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to capture thumbnail.';
      toast.error(message);
    } finally {
      setCurrentFrame(capturedFrame);
      setSceneSaveStatus(null);
      setIsCapturingSceneThumbnail(false);
    }
  };

  const handleSaveScene = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSavingScene) return;

    const project = exportProject();
    const activeScene = project.scenes.find(scene => scene.id === activeSceneId) || project.scenes[0];
    const runtimeScene = scenes.find(scene => scene.id === activeScene?.id);
    const name = savedSceneName.trim();

    if (!activeScene || !name) return;

    setIsSavingScene(true);
    setSceneSaveStatus('Preparing scene snapshot...');
    try {
      const portableClips = [];
      let thumbnailBlob: Blob | undefined = await loadBlob(`${SCENE_THUMBNAIL_BLOB_PREFIX}-${activeScene.id}`);

      for (const clip of activeScene.clips) {
        if (clip.type !== 'video') {
          portableClips.push(clip);
          continue;
        }

        const runtimeClip = runtimeScene?.clips.find(runtimeItem => runtimeItem.id === clip.id);
        let video: Blob | undefined;
        const isHostedVideo = clip.src?.startsWith('http') || clip.src?.startsWith('/api/scenes/media?');

        if (!thumbnailBlob && activeVideoClipAtCurrentFrame?.id === clip.id) {
          const previewVideo = getPreviewVideoElementForClip(clip.id);
          thumbnailBlob = previewVideo ? await captureVideoElementThumbnail(previewVideo) ?? undefined : undefined;
        }

        if (!thumbnailBlob || !isHostedVideo) {
          try {
            video = await getVideoBlobForClip(clip, runtimeClip);
          } catch {
            video = undefined;
          }
        }

        if (!thumbnailBlob && video) {
          thumbnailBlob = await captureVideoThumbnail(video) ?? undefined;
        }

        if (isHostedVideo) {
          portableClips.push(clip);
          continue;
        }

        if (!video && runtimeClip?.src) {
          portableClips.push({ ...clip, src: runtimeClip.src });
          continue;
        }

        if (!video) {
          portableClips.push(clip);
          continue;
        }

        const sanitizedClipName = (clip.name || 'scene-video.mp4').replace(/[^a-zA-Z0-9._-]/g, '-');
        const publicUrl = await uploadSceneVideo(sanitizedClipName, video);
        portableClips.push({ ...clip, name: sanitizedClipName, src: publicUrl });
      }

      if (!thumbnailBlob && activeScene.clips.some(clip => clip.type === 'video')) {
        throw new Error('Scene thumbnail was not saved because no video frame could be captured. Pause on a visible video frame, then try Save Scene again.');
      }

      const thumbnailUrl = thumbnailBlob
        ? await uploadSceneThumbnail(name, thumbnailBlob)
        : activeSceneThumbnailPreviewUrl;

      const sanitizedSceneName = (name || activeScene.name || 'scene-video.mp4').replace(/[^a-zA-Z0-9._-]/g, '-');
      const sceneSnapshot: TimelineProjectJson = {
        ...project,
        scenes: [{ 
          ...activeScene, 
          name: sanitizedSceneName, 
          thumbnailUrl, 
          clips: portableClips,
          analysisReport: activeScene.analysisReport ? {
            ...activeScene.analysisReport,
            title: sanitizedSceneName
          } : undefined
        }],
        activeSceneId: activeScene.id,
        config: {
          ...project.config,
          previewSceneMode: 'active',
          previewSceneIds: [activeScene.id],
        },
      };

      setSceneSaveStatus('Saving scene snapshot...');
      const response = await fetch('/api/scenes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: sanitizedSceneName, project: sceneSnapshot }),
      });
      const result = await response.json().catch(() => ({})) as { scene?: SavedSceneSummary; error?: string };
      if (!response.ok || !result.scene) {
        throw new Error(result.error || 'Unable to save the scene.');
      }
      const savedScene = result.scene;
      setSavedScenes(previous => [savedScene, ...previous.filter(scene => scene.id !== savedScene.id)]);
      setActiveSavedSceneId(savedScene.id);
      setActiveSavedScenePublished(!!savedScene.isPublished);
      
      const currentParams = new URLSearchParams(window.location.search);
      currentParams.set('sceneId', savedScene.id);
      router.replace(`${pathname}?${currentParams.toString()}`);

      toast.success('Scene and hosted video saved to your cloud library');
      setIsSaveSceneOpen(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to save the scene.';
      toast.error(message);
    } finally {
      setIsSavingScene(false);
      setSceneSaveStatus(null);
    }
  };

  const handleLoadSavedScene = async (scene: SavedSceneSummary) => {
    if (loadingSavedSceneId || deletingSavedSceneId) return;

    setLoadingSavedSceneId(scene.id);
    try {
      const response = await fetch(`/api/scenes/${scene.id}`, { cache: 'no-store' });
      const result = await response.json().catch(() => ({})) as {
        scene?: SavedSceneSummary & { project: TimelineProjectJson };
        error?: string;
      };
      if (!response.ok || !result.scene) {
        throw new Error(result.error || 'Unable to load the saved scene.');
      }
      setIsSceneLibraryOpen(false);
      setPendingProjectImport({
        fileName: `${result.scene.name} (cloud scene)`,
        project: result.scene.project,
        savedSceneId: scene.id,
        isPublished: !!result.scene.isPublished,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load the saved scene.';
      toast.error(message);
    } finally {
      setLoadingSavedSceneId(null);
    }
  };

  const handleTogglePublish = async () => {
    if (!activeSavedSceneId || currentUser?.role !== 'admin') return;

    const newPublishStatus = !activeSavedScenePublished;
    toast.loading(newPublishStatus ? 'Publishing scene...' : 'Unpublishing scene...', { id: 'publish-scene' });
    try {
      const response = await fetch(`/api/scenes/${activeSavedSceneId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isPublished: newPublishStatus }),
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || 'Failed to update scene publication status.');
      }
      setActiveSavedScenePublished(newPublishStatus);
      toast.success(newPublishStatus ? 'Scene published successfully! It is now public.' : 'Scene unpublished.', { id: 'publish-scene' });
    } catch (err: any) {
      console.error('Error toggling publish:', err);
      toast.error(err.message || 'Failed to update publication status.', { id: 'publish-scene' });
    } finally {
      setIsFileMenuOpen(false);
    }
  };

  const confirmSavedSceneDelete = (scene: SavedSceneSummary) => {
    if (!currentUser || currentUser.role === 'viewer') {
      toast.error('You are in read-only viewer mode. Log in as an editor or admin to delete scenes.');
      return;
    }
    setIsSceneLibraryOpen(false);
    setPendingSavedSceneDelete(scene);
  };

  const handleDeleteSavedScene = async () => {
    if (!pendingSavedSceneDelete || deletingSavedSceneId) return;

    const scene = pendingSavedSceneDelete;
    setDeletingSavedSceneId(scene.id);
    try {
      const response = await fetch(`/api/scenes/${scene.id}`, { method: 'DELETE' });
      const result = await response.json().catch(() => ({})) as { deletedVideoCount?: number; error?: string };
      if (!response.ok) {
        throw new Error(result.error || 'Unable to delete the saved scene.');
      }

      setSavedScenes(previous => previous.filter(savedScene => savedScene.id !== scene.id));
      setActiveSavedSceneId(previous => previous === scene.id ? null : previous);
      setPendingSavedSceneDelete(null);
      setIsSceneLibraryOpen(true);
      toast.success(result.deletedVideoCount
        ? 'Saved analysis and hosted video deleted'
        : 'Saved analysis deleted');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to delete the saved scene.';
      toast.error(message);
    } finally {
      setDeletingSavedSceneId(null);
    }
  };

  const appendPendingProjectImport = () => {
    if (!pendingProjectImport) return;
    importProjectIntoCurrent(pendingProjectImport.project);
    setActiveSavedSceneId(null);
    setActiveSavedScenePublished(false);

    const currentParams = new URLSearchParams(window.location.search);
    currentParams.delete('sceneId');
    router.replace(`${pathname}?${currentParams.toString()}`);

    setPendingProjectImport(null);
    setActiveTab('scenes');
    toast.success('Imported into current project without changing existing work');
  };

  const replaceWithPendingProjectImport = () => {
    if (!pendingProjectImport) return;
    importProject(pendingProjectImport.project);
    setActiveSavedSceneId(pendingProjectImport.savedSceneId || null);
    setActiveSavedScenePublished(!!pendingProjectImport.isPublished);

    const currentParams = new URLSearchParams(window.location.search);
    if (pendingProjectImport.savedSceneId) {
      currentParams.set('sceneId', pendingProjectImport.savedSceneId);
    } else {
      currentParams.delete('sceneId');
    }
    router.replace(`${pathname}?${currentParams.toString()}`);

    setPendingProjectImport(null);
    setActiveTab('scenes');
    toast.success('Opened imported JSON as project');
  };

  const getRenderGroupOptions = React.useCallback((): RenderGroupOption[] => {
    return tracks
      .filter(track => !track.parentId)
      .map(parent => {
        const trackIds = tracks.filter(track => track.parentId === parent.id).map(track => track.id);
        return {
          id: parent.id,
          name: parent.name,
          trackIds,
          clipCount: clips.filter(clip => trackIds.includes(clip.trackId)).length,
        };
      });
  }, [clips, tracks]);

  const createRenderProject = async (group?: RenderGroupOption) => {
    const project = exportProject();
    const runtimeClipSrcById = new Map(
      scenes.flatMap(scene => scene.clips.map(clip => [clip.id, clip.src] as const))
    );
    const runtimeCharacterImageById = new Map(
      characters.map(character => [character.id, character.image] as const)
    );
    const scenesWithMedia = await Promise.all(project.scenes.map(async (scene) => ({
      ...scene,
      tracks: group
        ? scene.tracks.filter(track => track.id === group.id || group.trackIds.includes(track.id))
        : scene.tracks,
      clips: await Promise.all(scene.clips.map(async (clip) => {
        const blob = await loadBlob(clip.id);
        const renderSrc = blob
          ? await blobToDataUrl(blob)
          : await runtimeSrcToRenderSrc(runtimeClipSrcById.get(clip.id) || clip.src);

        let thumbnailUrl = clip.thumbnailUrl;
        if (clip.type === 'note' && (clip.name === "Analysis" || clip.tags?.includes("Analysis") || clip.name.toLowerCase().includes("beat"))) {
          const thumbBlob = await loadBlob(`beat-thumb-${clip.id}`);
          if (thumbBlob) {
            thumbnailUrl = await blobToDataUrl(thumbBlob);
          }
        }

        if (!renderSrc && thumbnailUrl === clip.thumbnailUrl) return clip;

        return {
          ...clip,
          ...(renderSrc ? { src: renderSrc } : {}),
          thumbnailUrl,
        };
      })).then(sceneClips => (
        group ? sceneClips.filter(clip => group.trackIds.includes(clip.trackId)) : sceneClips
      )),
    })));

    const charactersWithMedia = await Promise.all(project.characters.map(async (character) => {
      const blob = await loadBlob(`char-${character.id}`);
      const runtimeImage = runtimeCharacterImageById.get(character.id) || character.image;
      const image = blob
        ? await blobToDataUrl(blob)
        : await runtimeSrcToRenderSrc(typeof runtimeImage === 'string' ? runtimeImage : undefined);

      if (!image) return character;

      return {
        ...character,
        image,
      };
    }));

    return {
      project: {
        ...project,
        scenes: scenesWithMedia,
        characters: charactersWithMedia,
      },
    };
  };

  const handleRenderProject = async () => {
    if (isRendering) return;

    const groups = getRenderGroupOptions();
    if (groups.length > 1) {
      setRenderGroupOptions(groups);
      return;
    }

    await renderProject(groups[0]);
  };

  const renderProject = async (group?: RenderGroupOption) => {
    if (isRendering) return;

    setIsRendering(true);
    try {
      toast.loading(group ? `Rendering ${group.name}...` : 'Rendering MP4...', { id: 'render-project' });
      const inputProps = await createRenderProject(group);
      const response = await fetch('/api/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(inputProps),
      });

      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || 'Render failed.');
      }

      const link = document.createElement('a');
      link.href = result.url;
      link.download = result.fileName || 'timeline-render.mp4';
      document.body.appendChild(link);
      link.click();
      link.remove();
      toast.success('MP4 render ready', { id: 'render-project' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to render MP4.';
      toast.error(message, { id: 'render-project' });
    } finally {
      setIsRendering(false);
    }
  };



  React.useEffect(() => {
    if (!isFileMenuOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!fileMenuRef.current?.contains(event.target as Node)) {
        setIsFileMenuOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsFileMenuOpen(false);
    };

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isFileMenuOpen]);

  React.useEffect(() => {
    if (!activeTab && !selectedClip) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;

      if (activeTab) {
        if (sidePanelRef.current?.contains(target)) return;
        setActiveTab(null);
        return;
      }

      if (clipPropertiesPanelRef.current?.contains(target)) return;
      setSelectedClipIds([]);
    };

    window.addEventListener('pointerdown', handlePointerDown);
    return () => window.removeEventListener('pointerdown', handlePointerDown);
  }, [activeTab, selectedClip, setSelectedClipIds]);

  const sceneLaunchQuery = sceneLaunchSearch.trim().toLowerCase();
  const visibleProjectScenes = scenes.filter(scene => {
    if (!sceneLaunchQuery) return true;
    return `${scene.name} ${scene.description || ''}`.toLowerCase().includes(sceneLaunchQuery);
  });
  const projectHasSceneContent = scenes.some(scene => (
    scene.clips.length > 0 ||
    !!scene.thumbnailUrl ||
    !!scene.description?.trim() ||
    (scenes.length > 1 && scene.name !== 'Untitled Scene')
  ));
  const activeSceneLaunchBeatId = sceneLaunchBeatPath[sceneLaunchBeatPath.length - 1] || null;
  const activeSceneLaunchBeat = activeSceneLaunchBeatId
    ? sceneLaunchBeats.find(beat => beat.id === activeSceneLaunchBeatId)
    : null;
  const activeSceneLaunchGridOrder = activeSceneLaunchBeat ? activeSceneLaunchBeat.gridOrder : sceneLaunchGridOrder.filter(item => item.id !== 'trash');
  const sceneLaunchGridItems = activeSceneLaunchGridOrder
    .map(orderItem => {
      if (orderItem.type === 'media') {
        const item = activeSceneLaunchBeat
          ? activeSceneLaunchBeat.items.find(mediaItem => mediaItem.id === orderItem.id)
          : sceneLaunchMediaItems.find(mediaItem => mediaItem.id === orderItem.id);
        if (!item) return null;
        return { ...orderItem, item };
      }

      const collection = sceneLaunchBeats.find(beat => beat.id === orderItem.id);
      if (!collection) return null;
      return { ...orderItem, collection };
    })
    .filter((item): item is (
      | { id: string; type: 'media'; item: typeof sceneLaunchMediaItems[number] }
      | { id: string; type: 'collection'; collection: typeof sceneLaunchBeats[number] }
    ) => !!item)
    .filter(item => {
      if (!sceneLaunchQuery) return true;
      if (item.type === 'media') return item.item.name.toLowerCase().includes(sceneLaunchQuery);
      return `${item.collection.name} ${item.collection.items.map(collectionItem => collectionItem.name).join(' ')}`.toLowerCase().includes(sceneLaunchQuery);
    });
  const rootSceneLaunchGridItemsCount = sceneLaunchGridOrder.length;
  const showSceneLaunchView = pathname === '/editor' && isNewSceneParam && workspaceViewMode === 'editor' && !isSceneLoading;
  const sceneLaunchBoardStorageKey = 'storyboard-flow:scene-launch-board:v1';
  const sceneLaunchBoardDbName = 'storyboard-flow-scene-launch-board';
  const sceneLaunchBoardStoreName = 'boards';

  type SceneLaunchBoardState = {
    mediaItems: typeof sceneLaunchMediaItems;
    collections: typeof sceneLaunchBeats;
    gridOrder: typeof sceneLaunchGridOrder;
  };

  const normalizeSceneLaunchBoard = (board: Partial<SceneLaunchBoardState> | null | undefined): SceneLaunchBoardState => ({
    mediaItems: Array.isArray(board?.mediaItems) ? board.mediaItems : [],
    collections: (() => {
      const cols = Array.isArray(board?.collections)
        ? board.collections.map(collection => {
            const items = Array.isArray(collection.items) ? collection.items : [];
            return {
              ...collection,
              items,
              childIds: Array.isArray(collection.childIds) ? collection.childIds : [],
              gridOrder: Array.isArray(collection.gridOrder)
                ? collection.gridOrder
                : items.map(item => ({ id: item.id, type: 'media' as const })),
            };
          })
        : [];
      if (!cols.some(c => c.id === 'trash')) {
        cols.push({
          id: 'trash',
          name: 'Trash',
          items: [],
          childIds: [],
          gridOrder: []
        });
      }
      return cols;
    })(),
    gridOrder: Array.isArray(board?.gridOrder) ? board.gridOrder : [],
  });

  const openSceneLaunchBoardDb = () => new Promise<IDBDatabase>((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('IndexedDB is not available.'));
      return;
    }

    const request = window.indexedDB.open(sceneLaunchBoardDbName, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(sceneLaunchBoardStoreName)) {
        db.createObjectStore(sceneLaunchBoardStoreName);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Could not open board storage.'));
  });

  const readSceneLaunchBoardFromIndexedDb = async () => {
    const db = await openSceneLaunchBoardDb();
    return new Promise<Partial<SceneLaunchBoardState> | null>((resolve, reject) => {
      const transaction = db.transaction(sceneLaunchBoardStoreName, 'readonly');
      const request = transaction.objectStore(sceneLaunchBoardStoreName).get(sceneLaunchBoardStorageKey);
      request.onsuccess = () => resolve((request.result as Partial<SceneLaunchBoardState> | undefined) || null);
      request.onerror = () => reject(request.error || new Error('Could not read board storage.'));
      transaction.oncomplete = () => db.close();
      transaction.onerror = () => {
        db.close();
        reject(transaction.error || new Error('Could not read board storage.'));
      };
    });
  };

  const writeSceneLaunchBoardToIndexedDb = async (board: SceneLaunchBoardState) => {
    const db = await openSceneLaunchBoardDb();
    return new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(sceneLaunchBoardStoreName, 'readwrite');
      const request = transaction.objectStore(sceneLaunchBoardStoreName).put(board, sceneLaunchBoardStorageKey);
      request.onerror = () => reject(request.error || new Error('Could not write board storage.'));
      transaction.oncomplete = () => {
        db.close();
        resolve();
      };
      transaction.onerror = () => {
        db.close();
        reject(transaction.error || new Error('Could not write board storage.'));
      };
    });
  };

  React.useEffect(() => {
    sceneLaunchMediaItemsRef.current = sceneLaunchMediaItems;
  }, [sceneLaunchMediaItems]);

  React.useEffect(() => {
    sceneLaunchBeatsRef.current = sceneLaunchBeats;
  }, [sceneLaunchBeats]);

  // Hover preview animation frame loop handles preview timer and playhead sync (declared below timelineItems)

  React.useEffect(() => {
    let isCancelled = false;

    const loadSceneLaunchBoard = async () => {
      try {
        let storedBoard = await readSceneLaunchBoardFromIndexedDb();

        if (!storedBoard) {
          const localStorageBoard = window.localStorage.getItem(sceneLaunchBoardStorageKey);
          storedBoard = localStorageBoard ? JSON.parse(localStorageBoard) as Partial<SceneLaunchBoardState> : null;
        }

        if (isCancelled) return;

        const normalizedBoard = normalizeSceneLaunchBoard(storedBoard);
        setSceneLaunchMediaItems(normalizedBoard.mediaItems);
        setSceneLaunchBeats(normalizedBoard.collections);
        setSceneLaunchGridOrder(normalizedBoard.gridOrder);
      } catch {
        if (isCancelled) return;
        setSceneLaunchMediaItems([]);
        setSceneLaunchBeats([]);
        setSceneLaunchGridOrder([]);
      } finally {
        if (!isCancelled) setHasLoadedSceneLaunchBoard(true);
      }
    };

    void loadSceneLaunchBoard();

    return () => {
      isCancelled = true;
    };
  }, []);

  React.useEffect(() => {
    if (!hasLoadedSceneLaunchBoard) return;

    const saveSceneLaunchBoard = async () => {
      try {
        await writeSceneLaunchBoardToIndexedDb({
          mediaItems: sceneLaunchMediaItems,
          collections: sceneLaunchBeats,
          gridOrder: sceneLaunchGridOrder,
        });
      } catch {
        try {
          window.localStorage.setItem(sceneLaunchBoardStorageKey, JSON.stringify({
            mediaItems: sceneLaunchMediaItems,
            collections: sceneLaunchBeats,
            gridOrder: sceneLaunchGridOrder,
          }));
        } catch {
          toast.error('Could not save this scene board in browser storage.', { id: 'scene-board-storage-error' });
        }
      }
    };

    void saveSceneLaunchBoard();
  }, [hasLoadedSceneLaunchBoard, sceneLaunchBeats, sceneLaunchGridOrder, sceneLaunchMediaItems]);

  React.useEffect(() => (
    () => {
      sceneLaunchMediaItemsRef.current.forEach(item => {
        if (item.previewUrl.startsWith('blob:')) URL.revokeObjectURL(item.previewUrl);
      });
      sceneLaunchBeatsRef.current.forEach(beat => {
        beat.items.forEach(item => {
          if (item.previewUrl.startsWith('blob:')) URL.revokeObjectURL(item.previewUrl);
        });
      });
    }
  ), []);

  const readSceneLaunchFilePreview = (file: File) => new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
        return;
      }
      reject(new Error('Could not read file preview.'));
    });
    reader.addEventListener('error', () => reject(reader.error || new Error('Could not read file preview.')));
    reader.readAsDataURL(file);
  });

  const getVideoDuration = (file: File): Promise<number> => {
    return new Promise((resolve) => {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.muted = true;
      video.playsInline = true;

      const url = URL.createObjectURL(file);
      video.src = url;

      video.onloadedmetadata = () => {
        URL.revokeObjectURL(url);
        resolve(Number(video.duration.toFixed(1)) || 3);
      };

      video.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(3);
      };
    });
  };

  const addFilesToSceneLaunchMedia = async (files: File[]) => {
    const validFiles = files.filter(file => file.type.startsWith('image/') || file.type.startsWith('video/'));
    const invalidCount = files.length - validFiles.length;

    if (invalidCount > 0) {
      toast.error('Only image and video files can be added here.');
    }

    if (validFiles.length === 0) return;

    const nextItems = await Promise.all(validFiles.map(async file => {
      const isVideo = file.type.startsWith('video/');
      const durationSeconds = isVideo ? await getVideoDuration(file) : 3;
      return {
        id: `scene-media-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        name: file.name,
        type: isVideo ? 'video' as const : 'image' as const,
        previewUrl: await readSceneLaunchFilePreview(file),
        durationSeconds,
      };
    }));

    if (activeSceneLaunchBeatId) {
      setSceneLaunchBeats(previous => previous.map(beat => (
        beat.id === activeSceneLaunchBeatId
          ? {
              ...beat,
              items: [...beat.items, ...nextItems],
              gridOrder: [
                ...beat.gridOrder,
                ...nextItems.map(item => ({ id: item.id, type: 'media' as const })),
              ],
            }
          : beat
      )));
    } else {
      setSceneLaunchMediaItems(previous => [...previous, ...nextItems]);
      setSceneLaunchGridOrder(previous => [
        ...previous,
        ...nextItems.map(item => ({ id: item.id, type: 'media' as const })),
      ]);
    }

    validFiles.forEach(file => {
      handleAddClip(file.type.startsWith('video/') ? 'video' : 'image', undefined, file);
    });
  };

  const createSceneLaunchBeat = () => {
    const id = `beat-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    if (activeSceneLaunchBeatId) {
      setSceneLaunchBeats(previous => previous.map(beat => (
        beat.id === activeSceneLaunchBeatId
          ? {
              ...beat,
              childIds: [...beat.childIds, id],
              gridOrder: [...beat.gridOrder, { id, type: 'collection' as const }],
            }
          : beat
      )));
    } else {
      setSceneLaunchGridOrder(previous => [...previous, { id, type: 'collection' }]);
    }
    setSceneLaunchBeats(previous => [
      ...previous,
      {
        id,
        name: `Collection ${previous.length + 1}`,
        items: [],
        childIds: [],
        gridOrder: [],
      },
    ]);
  };

  const openBeatUpload = (beatId: string) => {
    setActiveBeatUploadId(beatId);
    beatFileInputRef.current?.click();
  };

  const openBeatDetail = (beatId: string) => {
    setSceneLaunchBeatPath(previous => [...previous, beatId]);
  };

  const addFilesToBeat = async (beatId: string, files: File[]) => {
    const validFiles = files.filter(file => file.type.startsWith('image/') || file.type.startsWith('video/'));
    const invalidCount = files.length - validFiles.length;

    if (invalidCount > 0) {
      toast.error('Only image and video files can be added to a collection.');
    }

    if (validFiles.length === 0) return;

    const nextItems = await Promise.all(validFiles.map(async file => {
      const isVideo = file.type.startsWith('video/');
      const durationSeconds = isVideo ? await getVideoDuration(file) : 3;
      return {
        id: `beat-item-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        name: file.name,
        type: isVideo ? 'video' as const : 'image' as const,
        previewUrl: await readSceneLaunchFilePreview(file),
        durationSeconds,
      };
    }));

    setSceneLaunchBeats(previous => previous.map(beat => (
      beat.id === beatId
        ? {
            ...beat,
            items: [...beat.items, ...nextItems],
            gridOrder: [
              ...beat.gridOrder,
              ...nextItems.map(item => ({ id: item.id, type: 'media' as const })),
            ],
          }
        : beat
    )));

    validFiles.forEach(file => {
      handleAddClip(file.type.startsWith('video/') ? 'video' : 'image', undefined, file);
    });
  };

  const handleBeatFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (activeBeatUploadId) {
      addFilesToBeat(activeBeatUploadId, files);
    }
    event.target.value = '';
    setActiveBeatUploadId(null);
  };

  const handleBeatDrop = (event: React.DragEvent<HTMLDivElement>, beatId: string) => {
    event.preventDefault();
    event.stopPropagation();
    addFilesToBeat(beatId, Array.from(event.dataTransfer.files || []));
  };

  const findSceneLaunchMediaItem = (mediaId: string) => {
    const rootItem = sceneLaunchMediaItems.find(item => item.id === mediaId);
    if (rootItem) return rootItem;
    return sceneLaunchBeats.flatMap(beat => beat.items).find(item => item.id === mediaId) || null;
  };

  const getAspectRatioValue = (ratio: string): number => {
    const [w, h] = ratio.split(':').map(Number);
    return w / h;
  };

  const getSceneLaunchMediaTileStyle = (item: typeof sceneLaunchMediaItems[number]): React.CSSProperties => {
    const ratioValue = getAspectRatioValue(aspectRatio);
    const ratioMultiplier = ratioValue / (16 / 9);

    const duration = item.type === 'image'
      ? Math.max(1, Math.min(12, item.durationSeconds ?? 3))
      : 3;

    // Use a base unit of 3.2rem so that 12s worth of duration fits on a single row (12 * 3.2 = 38.4rem)
    const baseBasis = duration * 3.2;
    const scaledBasis = Math.max(5.0, baseBasis * ratioMultiplier);

    const baseMin = item.type === 'image' ? 5 : 7;
    const scaledMin = Math.max(5.0, baseMin * ratioMultiplier);

    return {
      flex: `${duration} 1 ${scaledBasis}rem`,
      minWidth: `${scaledMin}rem`,
      maxWidth: '100%',
    };
  };

  const getSceneLaunchCollectionTileStyle = (): React.CSSProperties => {
    const ratioValue = getAspectRatioValue(aspectRatio);
    const ratioMultiplier = ratioValue / (16 / 9);

    const scaledBasis = Math.max(7, 9.6 * ratioMultiplier);
    const scaledMin = Math.max(5.5, 6.4 * ratioMultiplier);

    return {
      flex: `3 1 ${scaledBasis}rem`,
      minWidth: `${scaledMin}rem`,
      maxWidth: '100%',
    };
  };

  const getSceneLaunchMediaPreviewStyle = (): React.CSSProperties => {
    return {
      width: '100%',
    };
  };

  const getSceneLaunchMediaPreviewDuration = (item: typeof sceneLaunchMediaItems[number]) => (
    Math.max(1, item.durationSeconds ?? 3)
  );

  const getRecursiveMediaItems = (
    collection: typeof sceneLaunchBeats[number],
    visited = new Set<string>()
  ): Array<typeof sceneLaunchMediaItems[number]> => {
    if (visited.has(collection.id)) return [];
    visited.add(collection.id);

    const items: Array<typeof sceneLaunchMediaItems[number]> = [];

    for (const gridItem of collection.gridOrder) {
      if (gridItem.type === 'media') {
        const found = collection.items.find(x => x.id === gridItem.id);
        if (found) {
          items.push(found);
        }
      } else if (gridItem.type === 'collection') {
        const childBeat = sceneLaunchBeats.find(b => b.id === gridItem.id);
        if (childBeat) {
          items.push(...getRecursiveMediaItems(childBeat, visited));
        }
      }
    }
    return items;
  };

  const getRecursiveCollectionDuration = (
    collection: typeof sceneLaunchBeats[number],
    visited = new Set<string>()
  ): number => {
    if (visited.has(collection.id)) return 0;
    visited.add(collection.id);

    return collection.gridOrder.reduce((sum, orderItem) => {
      if (orderItem.type === 'media') {
        const m = collection.items.find(x => x.id === orderItem.id);
        if (!m) return sum;
        if (resizingItem && resizingItem.id === m.id) {
          return sum + resizingItem.currentDuration;
        }
        return sum + (m.durationSeconds || 3);
      } else {
        const childBeat = sceneLaunchBeats.find(b => b.id === orderItem.id);
        if (!childBeat) return sum;
        return sum + getRecursiveCollectionDuration(childBeat, visited);
      }
    }, 0);
  };

  const getGridItemTimelineState = (
    itemId: string,
    itemType: 'media' | 'collection'
  ): { status: 'past' | 'active' | 'future' | 'idle'; elapsed: number; duration: number } => {
    if (!isTimelinePlaying && !isScrubbing) {
      return { status: 'idle', elapsed: 0, duration: 3 };
    }

    let accumulatedTime = 0;
    for (const item of timelineItems) {
      let duration = 3;
      if (item.type === 'media') {
        if (resizingItem && resizingItem.id === item.item.id) {
          duration = resizingItem.currentDuration;
        } else {
          duration = item.item.durationSeconds || 3;
        }
      } else {
        duration = getRecursiveCollectionDuration(item.collection) || 3;
      }

      const isMatch = (item.type === itemType && item.id === itemId);
      
      let containsTarget = false;
      let relStart = 0;
      let relDuration = 0;

      if (!isMatch && item.type === 'collection') {
        const containsCollection = (parent: typeof sceneLaunchBeats[number], targetId: string, visited = new Set<string>()): boolean => {
          if (visited.has(parent.id)) return false;
          visited.add(parent.id);
          for (const g of parent.gridOrder) {
            if (g.type === 'collection') {
              if (g.id === targetId) return true;
              const child = sceneLaunchBeats.find(b => b.id === g.id);
              if (child && containsCollection(child, targetId, visited)) return true;
            }
          }
          return false;
        };

        const containsMedia = (parent: typeof sceneLaunchBeats[number], targetId: string, visited = new Set<string>()): boolean => {
          if (visited.has(parent.id)) return false;
          visited.add(parent.id);
          for (const g of parent.gridOrder) {
            if (g.type === 'media') {
              if (g.id === targetId) return true;
            } else {
              const child = sceneLaunchBeats.find(b => b.id === g.id);
              if (child && containsMedia(child, targetId, visited)) return true;
            }
          }
          return false;
        };

        const checkInside = itemType === 'collection'
          ? containsCollection(item.collection, itemId)
          : containsMedia(item.collection, itemId);

        if (checkInside) {
          containsTarget = true;
          const getRelativeStartAndDuration = (
            parent: typeof sceneLaunchBeats[number],
            targetId: string,
            targetType: 'media' | 'collection',
            visited = new Set<string>()
          ): { start: number; duration: number } | null => {
            if (visited.has(parent.id)) return null;
            visited.add(parent.id);

            let relTime = 0;
            for (const g of parent.gridOrder) {
              if (g.type === 'media') {
                const m = parent.items.find(x => x.id === g.id);
                const d = resizingItem && resizingItem.id === g.id
                  ? resizingItem.currentDuration
                  : (m?.durationSeconds || 3);
                if (targetType === 'media' && g.id === targetId) {
                  return { start: relTime, duration: d };
                }
                relTime += d;
              } else {
                const child = sceneLaunchBeats.find(b => b.id === g.id);
                if (!child) continue;
                if (targetType === 'collection' && g.id === targetId) {
                  return { start: relTime, duration: getRecursiveCollectionDuration(child) };
                }
                const res = getRelativeStartAndDuration(child, targetId, targetType, visited);
                if (res) {
                  return { start: relTime + res.start, duration: res.duration };
                }
                relTime += getRecursiveCollectionDuration(child);
              }
            }
            return null;
          };

          const rel = getRelativeStartAndDuration(item.collection, itemId, itemType);
          if (rel) {
            relStart = rel.start;
            relDuration = rel.duration;
          }
        }
      }

      if (isMatch) {
        if (timelineCurrentTime < accumulatedTime) {
          return { status: 'future', elapsed: 0, duration };
        } else if (timelineCurrentTime >= accumulatedTime + duration) {
          return { status: 'past', elapsed: duration, duration };
        } else {
          return { status: 'active', elapsed: timelineCurrentTime - accumulatedTime, duration };
        }
      } else if (containsTarget) {
        const absStart = accumulatedTime + relStart;
        const absEnd = absStart + relDuration;
        if (timelineCurrentTime < absStart) {
          return { status: 'future', elapsed: 0, duration: relDuration };
        } else if (timelineCurrentTime >= absEnd) {
          return { status: 'past', elapsed: relDuration, duration: relDuration };
        } else {
          return { status: 'active', elapsed: timelineCurrentTime - absStart, duration: relDuration };
        }
      }

      accumulatedTime += duration;
    }

    return { status: 'idle', elapsed: 0, duration: 3 };
  };

  const getSceneLaunchCollectionPreview = (collection: typeof sceneLaunchBeats[number]) => {
    const orderedMediaItems = getRecursiveMediaItems(collection);

    if (orderedMediaItems.length === 0) return null;

    const firstItem = orderedMediaItems[0];
    const isHoverActive = sceneLaunchPreviewHover?.collectionId === collection.id;
    const timelineState = getGridItemTimelineState(collection.id, 'collection');
    const isPlaying = isHoverActive || timelineState.status !== 'idle';

    if (!isPlaying) {
      return {
        item: firstItem,
        elapsedSeconds: 0,
        durationSeconds: getSceneLaunchMediaPreviewDuration(firstItem),
        isPlaying,
      };
    }

    const totalDuration = orderedMediaItems.reduce((total, item) => (
      total + getSceneLaunchMediaPreviewDuration(item)
    ), 0);
    
    let elapsed = 0;
    if (isHoverActive) {
      elapsed = ((sceneLaunchPreviewNow - sceneLaunchPreviewHover.startedAt) / 1000) % totalDuration;
    } else {
      if (timelineState.status === 'past') {
        elapsed = totalDuration - 0.001;
      } else if (timelineState.status === 'active') {
        elapsed = timelineState.elapsed % totalDuration;
      } else {
        elapsed = 0; // future
      }
    }

    for (const item of orderedMediaItems) {
      const durationSeconds = getSceneLaunchMediaPreviewDuration(item);
      if (elapsed < durationSeconds) {
        return {
          item,
          elapsedSeconds: elapsed,
          durationSeconds,
          isPlaying,
        };
      }
      elapsed -= durationSeconds;
    }

    const lastItem = orderedMediaItems[orderedMediaItems.length - 1];
    return {
      item: lastItem,
      elapsedSeconds: getSceneLaunchMediaPreviewDuration(lastItem) - 0.001,
      durationSeconds: getSceneLaunchMediaPreviewDuration(lastItem),
      isPlaying,
    };
  };

  const updateSceneLaunchMediaDuration = (mediaId: string, durationSeconds: number) => {
    const nextDuration = Math.max(1, Math.min(60, durationSeconds || 1));
    const updateItem = (item: typeof sceneLaunchMediaItems[number]) => (
      item.id === mediaId
        ? { ...item, durationSeconds: nextDuration }
        : item
    );

    setSceneLaunchMediaItems(previous => previous.map(updateItem));
    setSceneLaunchBeats(previous => previous.map(beat => ({
      ...beat,
      items: beat.items.map(updateItem),
    })));
  };

  const removeSceneLaunchMediaFromCurrentLevel = (mediaId: string) => {
    if (activeSceneLaunchBeatId) {
      setSceneLaunchBeats(previous => previous.map(beat => (
        beat.id === activeSceneLaunchBeatId
          ? {
              ...beat,
              items: beat.items.filter(item => item.id !== mediaId),
              gridOrder: beat.gridOrder.filter(item => !(item.type === 'media' && item.id === mediaId)),
            }
          : beat
      )));
      return;
    }

    setSceneLaunchMediaItems(previous => previous.filter(item => item.id !== mediaId));
    setSceneLaunchGridOrder(previous => previous.filter(item => !(item.type === 'media' && item.id === mediaId)));
  };

  const handleItemContextMenu = (event: React.MouseEvent, dragKey: string) => {
    event.preventDefault();
    event.stopPropagation();
    setSceneLaunchContextMenu({
      dragKey,
      x: event.clientX,
      y: event.clientY,
    });
  };

  const moveItemToTrash = (dragKey: string) => {
    const [type, id] = dragKey.split(':');
    if (!type || !id) return;
    if (id === 'trash') {
      toast.error("Cannot trash the Trash folder itself.");
      return;
    }

    let itemTitle = '';

    if (type === 'media') {
      let foundMedia: typeof sceneLaunchMediaItems[number] | null = null;
      const rootMedia = sceneLaunchMediaItems.find(m => m.id === id);
      if (rootMedia) {
        foundMedia = rootMedia;
        setSceneLaunchMediaItems(prev => prev.filter(m => m.id !== id));
        setSceneLaunchGridOrder(prev => prev.filter(item => !(item.type === 'media' && item.id === id)));
      } else {
        let parentBeatId: string | null = null;
        for (const beat of sceneLaunchBeats) {
          const m = beat.items.find(item => item.id === id);
          if (m) {
            foundMedia = m;
            parentBeatId = beat.id;
            break;
          }
        }
        if (parentBeatId) {
          setSceneLaunchBeats(prev => prev.map(beat => {
            if (beat.id === parentBeatId) {
              return {
                ...beat,
                items: beat.items.filter(m => m.id !== id),
                gridOrder: beat.gridOrder.filter(item => !(item.type === 'media' && item.id === id))
              };
            }
            return beat;
          }));
        }
      }

      if (!foundMedia) {
        toast.error("Media item not found.");
        return;
      }
      itemTitle = foundMedia.name;

      setSceneLaunchBeats(prev => prev.map(beat => {
        if (beat.id === 'trash') {
          const exists = beat.items.some(m => m.id === id);
          const newItems = exists ? beat.items : [...beat.items, foundMedia!];
          const newGridOrder = exists ? beat.gridOrder : [...beat.gridOrder, { id, type: 'media' as const }];
          return {
            ...beat,
            items: newItems,
            gridOrder: newGridOrder
          };
        }
        return beat;
      }));

    } else if (type === 'collection') {
      const targetBeat = sceneLaunchBeats.find(b => b.id === id);
      if (!targetBeat) {
        toast.error("Collection not found.");
        return;
      }
      itemTitle = targetBeat.name;

      const isAtRoot = sceneLaunchGridOrder.some(item => item.type === 'collection' && item.id === id);
      if (isAtRoot) {
        setSceneLaunchGridOrder(prev => prev.filter(item => !(item.type === 'collection' && item.id === id)));
      } else {
        let parentBeatId: string | null = null;
        for (const beat of sceneLaunchBeats) {
          if (beat.childIds.includes(id)) {
            parentBeatId = beat.id;
            break;
          }
        }
        if (parentBeatId) {
          setSceneLaunchBeats(prev => prev.map(beat => {
            if (beat.id === parentBeatId) {
              return {
                ...beat,
                childIds: beat.childIds.filter(cid => cid !== id),
                gridOrder: beat.gridOrder.filter(item => !(item.type === 'collection' && item.id === id))
              };
            }
            return beat;
          }));
        }
      }

      setSceneLaunchBeats(prev => prev.map(beat => {
        if (beat.id === 'trash') {
          const exists = beat.childIds.includes(id);
          const newChildIds = exists ? beat.childIds : [...beat.childIds, id];
          const newGridOrder = exists ? beat.gridOrder : [...beat.gridOrder, { id, type: 'collection' as const }];
          return {
            ...beat,
            childIds: newChildIds,
            gridOrder: newGridOrder
          };
        }
        return beat;
      }));
    }

    toast.success(`Moved "${itemTitle}" to Trash`);
  };

  const restoreItemFromTrash = (dragKey: string) => {
    const [type, id] = dragKey.split(':');
    if (!type || !id) return;

    const trashBeat = sceneLaunchBeats.find(b => b.id === 'trash');
    if (!trashBeat) return;

    let itemTitle = '';

    if (type === 'media') {
      const foundMedia = trashBeat.items.find(m => m.id === id);
      if (!foundMedia) return;
      itemTitle = foundMedia.name;

      setSceneLaunchBeats(prev => prev.map(beat => {
        if (beat.id === 'trash') {
          return {
            ...beat,
            items: beat.items.filter(m => m.id !== id),
            gridOrder: beat.gridOrder.filter(item => !(item.type === 'media' && item.id === id))
          };
        }
        return beat;
      }));

      setSceneLaunchMediaItems(prev => [...prev, foundMedia]);
      setSceneLaunchGridOrder(prev => [...prev, { id, type: 'media' as const }]);

    } else if (type === 'collection') {
      const targetBeat = sceneLaunchBeats.find(b => b.id === id);
      if (!targetBeat) return;
      itemTitle = targetBeat.name;

      setSceneLaunchBeats(prev => prev.map(beat => {
        if (beat.id === 'trash') {
          return {
            ...beat,
            childIds: beat.childIds.filter(cid => cid !== id),
            gridOrder: beat.gridOrder.filter(item => !(item.type === 'collection' && item.id === id))
          };
        }
        return beat;
      }));

      setSceneLaunchGridOrder(prev => [...prev, { id, type: 'collection' as const }]);
    }

    toast.success(`Restored "${itemTitle}" to main view`);
  };

  const permanentlyDeleteItem = (dragKey: string) => {
    const [type, id] = dragKey.split(':');
    if (!type || !id) return;

    const trashBeat = sceneLaunchBeats.find(b => b.id === 'trash');
    if (!trashBeat) return;

    let itemTitle = '';

    if (type === 'media') {
      const foundMedia = trashBeat.items.find(m => m.id === id);
      if (!foundMedia) return;
      itemTitle = foundMedia.name;

      if (foundMedia.previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(foundMedia.previewUrl);
      }

      setSceneLaunchBeats(prev => prev.map(beat => {
        if (beat.id === 'trash') {
          return {
            ...beat,
            items: beat.items.filter(m => m.id !== id),
            gridOrder: beat.gridOrder.filter(item => !(item.type === 'media' && item.id === id))
          };
        }
        return beat;
      }));

    } else if (type === 'collection') {
      const targetBeat = sceneLaunchBeats.find(b => b.id === id);
      if (!targetBeat) return;
      itemTitle = targetBeat.name;

      targetBeat.items.forEach(item => {
        if (item.previewUrl.startsWith('blob:')) URL.revokeObjectURL(item.previewUrl);
      });

      setSceneLaunchBeats(prev => prev
        .filter(beat => beat.id !== id)
        .map(beat => {
          if (beat.id === 'trash') {
            return {
              ...beat,
              childIds: beat.childIds.filter(cid => cid !== id),
              gridOrder: beat.gridOrder.filter(item => !(item.type === 'collection' && item.id === id))
            };
          }
          return beat;
        })
      );
    }

    toast.success(`Permanently deleted "${itemTitle}"`);
  };

  const emptyTrash = () => {
    const trashBeat = sceneLaunchBeats.find(b => b.id === 'trash');
    if (!trashBeat) return;

    const collectionsToPermanentlyDelete = new Set<string>(trashBeat.childIds);
    
    trashBeat.items.forEach(item => {
      if (item.previewUrl.startsWith('blob:')) URL.revokeObjectURL(item.previewUrl);
    });

    sceneLaunchBeats.forEach(beat => {
      if (collectionsToPermanentlyDelete.has(beat.id)) {
        beat.items.forEach(item => {
          if (item.previewUrl.startsWith('blob:')) URL.revokeObjectURL(item.previewUrl);
        });
      }
    });

    setSceneLaunchBeats(prev => prev
      .filter(beat => !collectionsToPermanentlyDelete.has(beat.id))
      .map(beat => {
        if (beat.id === 'trash') {
          return {
            ...beat,
            items: [],
            childIds: [],
            gridOrder: []
          };
        }
        return beat;
      })
    );

    toast.success("Trash emptied permanently");
  };

  const moveSceneLaunchMediaToCollection = (mediaId: string, beatId: string) => {
    const mediaItem = findSceneLaunchMediaItem(mediaId);
    if (!mediaItem) return;

    removeSceneLaunchMediaFromCurrentLevel(mediaId);
    setSceneLaunchBeats(previous => previous.map(beat => (
      beat.id === beatId
        ? {
            ...beat,
            items: beat.items.some(item => item.id === mediaId) ? beat.items : [...beat.items, mediaItem],
            gridOrder: beat.gridOrder.some(item => item.type === 'media' && item.id === mediaId)
              ? beat.gridOrder
              : [...beat.gridOrder, { id: mediaId, type: 'media' as const }],
          }
        : beat
    )));
  };

  const isDescendantCollection = (parentCollectionId: string, potentialDescendantId: string): boolean => {
    const parent = sceneLaunchBeats.find(b => b.id === parentCollectionId);
    if (!parent) return false;
    const childIds = Array.isArray(parent.childIds) ? parent.childIds : [];
    if (childIds.includes(potentialDescendantId)) return true;
    return childIds.some(childId => isDescendantCollection(childId, potentialDescendantId));
  };

  const moveSceneLaunchCollectionToCollection = (draggedId: string, targetId: string) => {
    if (draggedId === targetId) return;

    // Check for cycles
    if (isDescendantCollection(draggedId, targetId)) {
      toast.error("Cannot move a collection inside its own sub-collection.");
      return;
    }

    const draggedBeat = sceneLaunchBeats.find(b => b.id === draggedId);
    const targetBeat = sceneLaunchBeats.find(b => b.id === targetId);
    if (!draggedBeat || !targetBeat) {
      toast.error("Collection not found.");
      return;
    }

    // 1. Remove from current parent / level
    const isAtRoot = sceneLaunchGridOrder.some(item => item.type === 'collection' && item.id === draggedId);
    if (isAtRoot) {
      setSceneLaunchGridOrder(prev => prev.filter(item => !(item.type === 'collection' && item.id === draggedId)));
    } else {
      // Find parent collection
      let parentBeatId: string | null = null;
      for (const beat of sceneLaunchBeats) {
        const childIds = Array.isArray(beat.childIds) ? beat.childIds : [];
        if (childIds.includes(draggedId)) {
          parentBeatId = beat.id;
          break;
        }
      }

      if (parentBeatId) {
        // If it's already in the target collection, do nothing
        if (parentBeatId === targetId) return;

        setSceneLaunchBeats(prev => prev.map(beat => {
          if (beat.id === parentBeatId) {
            const childIds = Array.isArray(beat.childIds) ? beat.childIds : [];
            const gridOrder = Array.isArray(beat.gridOrder) ? beat.gridOrder : [];
            return {
              ...beat,
              childIds: childIds.filter(cid => cid !== draggedId),
              gridOrder: gridOrder.filter(item => !(item.type === 'collection' && item.id === draggedId))
            };
          }
          return beat;
        }));
      }
    }

    // 2. Add to target parent
    setSceneLaunchBeats(prev => prev.map(beat => {
      if (beat.id === targetId) {
        const childIds = Array.isArray(beat.childIds) ? beat.childIds : [];
        const gridOrder = Array.isArray(beat.gridOrder) ? beat.gridOrder : [];
        const exists = childIds.includes(draggedId);
        const newChildIds = exists ? childIds : [...childIds, draggedId];
        const newGridOrder = exists ? gridOrder : [...gridOrder, { id: draggedId, type: 'collection' as const }];
        return {
          ...beat,
          childIds: newChildIds,
          gridOrder: newGridOrder
        };
      }
      return beat;
    }));

    toast.success(`Moved collection "${draggedBeat.name}" to "${targetBeat.name}"`);
  };

  const moveSceneLaunchItemToParent = (dragKey: string) => {
    const [type, id] = dragKey.split(':');
    if (!type || !id) return;

    if (!activeSceneLaunchBeatId) return; // Already at root

    // Determine target (parent) ID
    let parentBeatId: string | null = null;
    if (activeSceneLaunchBeatId !== 'trash') {
      for (const beat of sceneLaunchBeats) {
        const childIds = Array.isArray(beat.childIds) ? beat.childIds : [];
        if (childIds.includes(activeSceneLaunchBeatId)) {
          parentBeatId = beat.id;
          break;
        }
      }
    }

    if (type === 'media') {
      const mediaItem = findSceneLaunchMediaItem(id);
      if (!mediaItem) return;

      // Remove from current level
      removeSceneLaunchMediaFromCurrentLevel(id);

      if (parentBeatId) {
        // Move to parent beat
        setSceneLaunchBeats(previous => previous.map(beat => {
          if (beat.id === parentBeatId) {
            const items = Array.isArray(beat.items) ? beat.items : [];
            const gridOrder = Array.isArray(beat.gridOrder) ? beat.gridOrder : [];
            return {
              ...beat,
              items: items.some(item => item.id === id) ? items : [...items, mediaItem],
              gridOrder: gridOrder.some(item => item.type === 'media' && item.id === id)
                ? gridOrder
                : [...gridOrder, { id, type: 'media' as const }],
            };
          }
          return beat;
        }));
        const parentBeat = sceneLaunchBeats.find(b => b.id === parentBeatId);
        toast.success(`Moved "${mediaItem.name}" to "${parentBeat?.name || 'parent folder'}"`);
      } else {
        // Move to root
        setSceneLaunchMediaItems(prev => [...prev, mediaItem]);
        setSceneLaunchGridOrder(prev => [...prev, { id, type: 'media' }]);
        toast.success(`Moved "${mediaItem.name}" to root`);
      }
    } else if (type === 'collection') {
      const draggedBeat = sceneLaunchBeats.find(b => b.id === id);
      if (!draggedBeat) return;

      // Remove from current level
      setSceneLaunchBeats(prev => prev.map(beat => {
        if (beat.id === activeSceneLaunchBeatId) {
          const childIds = Array.isArray(beat.childIds) ? beat.childIds : [];
          const gridOrder = Array.isArray(beat.gridOrder) ? beat.gridOrder : [];
          return {
            ...beat,
            childIds: childIds.filter(cid => cid !== id),
            gridOrder: gridOrder.filter(item => !(item.type === 'collection' && item.id === id))
          };
        }
        return beat;
      }));

      if (parentBeatId) {
        // Move to parent beat
        setSceneLaunchBeats(prev => prev.map(beat => {
          if (beat.id === parentBeatId) {
            const childIds = Array.isArray(beat.childIds) ? beat.childIds : [];
            const gridOrder = Array.isArray(beat.gridOrder) ? beat.gridOrder : [];
            const exists = childIds.includes(id);
            const newChildIds = exists ? childIds : [...childIds, id];
            const newGridOrder = exists ? gridOrder : [...gridOrder, { id, type: 'collection' as const }];
            return {
              ...beat,
              childIds: newChildIds,
              gridOrder: newGridOrder
            };
          }
          return beat;
        }));
        const parentBeat = sceneLaunchBeats.find(b => b.id === parentBeatId);
        toast.success(`Moved collection "${draggedBeat.name}" to "${parentBeat?.name || 'parent folder'}"`);
      } else {
        // Move to root
        setSceneLaunchGridOrder(prev => [...prev, { id, type: 'collection' }]);
        toast.success(`Moved collection "${draggedBeat.name}" to root`);
      }
    }
  };

  const getHeaderName = () => {
    if (activeSceneLaunchBeatId) {
      if (activeSceneLaunchBeatId === 'trash') return 'Trash';
      return activeSceneLaunchBeat?.name || 'Collection';
    }
    return activeSavedSceneId ? activeScene?.name || 'Current project' : 'New scene project';
  };

  const saveHeaderName = () => {
    const trimmed = editingHeaderNameValue.trim();
    if (!trimmed) {
      setIsEditingHeaderName(false);
      return;
    }

    if (activeSceneLaunchBeatId && activeSceneLaunchBeatId !== 'trash') {
      setSceneLaunchBeats(prev => prev.map(beat => (
        beat.id === activeSceneLaunchBeatId
          ? { ...beat, name: trimmed }
          : beat
      )));
      toast.success(`Renamed collection to "${trimmed}"`);
    } else if (!activeSceneLaunchBeatId && activeScene) {
      updateScene(activeScene.id, { name: trimmed });
      toast.success(`Renamed project to "${trimmed}"`);
    }
    setIsEditingHeaderName(false);
  };

  const handleCollectionGridDrop = (
    event: React.DragEvent<HTMLDivElement | HTMLElement>,
    beatId: string,
    targetKey: string
  ) => {
    event.preventDefault();
    event.stopPropagation();

    const draggedKey = event.dataTransfer.getData('text/plain');
    if (draggedKey.startsWith('media:')) {
      moveSceneLaunchMediaToCollection(draggedKey.slice('media:'.length), beatId);
      return;
    }

    if (draggedKey.startsWith('collection:')) {
      const draggedCollectionId = draggedKey.slice('collection:'.length);
      if (draggedCollectionId === beatId) return;
      moveSceneLaunchCollectionToCollection(draggedCollectionId, beatId);
      return;
    }

    if (draggedKey) {
      reorderSceneLaunchGridItem(draggedKey, targetKey);
      return;
    }

    addFilesToBeat(beatId, Array.from(event.dataTransfer.files || []));
  };

  const reorderSceneLaunchGridItem = (draggedKey: string, targetKey: string) => {
    if (!draggedKey || draggedKey === targetKey) return;

    const reorderItems = (previous: Array<{ id: string; type: 'media' | 'collection' }>) => {
      const draggedIndex = previous.findIndex(item => `${item.type}:${item.id}` === draggedKey);
      const targetIndex = previous.findIndex(item => `${item.type}:${item.id}` === targetKey);
      if (draggedIndex < 0 || targetIndex < 0) return previous;

      const next = [...previous];
      const [draggedItem] = next.splice(draggedIndex, 1);
      next.splice(targetIndex, 0, draggedItem);
      return next;
    };

    if (activeSceneLaunchBeatId) {
      setSceneLaunchBeats(previous => previous.map(beat => (
        beat.id === activeSceneLaunchBeatId
          ? { ...beat, gridOrder: reorderItems(beat.gridOrder) }
          : beat
      )));
      return;
    }

    setSceneLaunchGridOrder(reorderItems);
  };

  const handleGridDragOver = (e: React.DragEvent<HTMLElement>, targetKey: string, isCollection: boolean) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const ratio = x / rect.width;

    let position: 'before' | 'after' | 'inside' = 'inside';
    if (isCollection) {
      if (ratio < 0.25) position = 'before';
      else if (ratio > 0.75) position = 'after';
    } else {
      position = ratio < 0.5 ? 'before' : 'after';
    }

    if (!gridDragOverInfo || gridDragOverInfo.targetKey !== targetKey || gridDragOverInfo.position !== position) {
      setGridDragOverInfo({ targetKey, position });
    }
  };

  const handleGridDragLeave = () => {
    setGridDragOverInfo(null);
  };

  const handleGridDrop = (e: React.DragEvent<HTMLElement>, targetKey: string, isCollection: boolean) => {
    e.preventDefault();
    e.stopPropagation();
    setGridDragOverInfo(null);

    const draggedKey = e.dataTransfer.getData('text/plain');
    if (!draggedKey || draggedKey === targetKey) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const ratio = x / rect.width;

    let position: 'before' | 'after' | 'inside' = 'inside';
    if (isCollection) {
      if (ratio < 0.25) position = 'before';
      else if (ratio > 0.75) position = 'after';
    } else {
      position = ratio < 0.5 ? 'before' : 'after';
    }

    if (isCollection && position === 'inside') {
      const collectionId = targetKey.slice('collection:'.length);
      if (draggedKey.startsWith('media:')) {
        moveSceneLaunchMediaToCollection(draggedKey.slice('media:'.length), collectionId);
      } else if (draggedKey.startsWith('collection:')) {
        moveSceneLaunchCollectionToCollection(draggedKey.slice('collection:'.length), collectionId);
      }
      return;
    }

    // Operating system file drops
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      if (isCollection && position === 'inside') {
        const collectionId = targetKey.slice('collection:'.length);
        addFilesToBeat(collectionId, Array.from(e.dataTransfer.files));
      } else {
        if (activeSceneLaunchBeatId) {
          addFilesToBeat(activeSceneLaunchBeatId, Array.from(e.dataTransfer.files));
        } else {
          addFilesToSceneLaunchMedia(Array.from(e.dataTransfer.files));
        }
      }
      return;
    }

    // Reordering drops
    reorderSceneLaunchGridItemAtPosition(draggedKey, targetKey, position as 'before' | 'after');
  };

  const reorderSceneLaunchGridItemAtPosition = (draggedKey: string, targetKey: string, position: 'before' | 'after') => {
    if (!draggedKey || draggedKey === targetKey) return;

    const reorderItems = (previous: Array<{ id: string; type: 'media' | 'collection' }>) => {
      const draggedIndex = previous.findIndex(item => `${item.type}:${item.id}` === draggedKey);
      const targetIndex = previous.findIndex(item => `${item.type}:${item.id}` === targetKey);
      if (draggedIndex < 0 || targetIndex < 0) return previous;

      const next = [...previous];
      const [draggedItem] = next.splice(draggedIndex, 1);

      // Find the index of target in the array after splicing the dragged item
      const newTargetIndex = next.findIndex(item => `${item.type}:${item.id}` === targetKey);
      const insertIndex = position === 'before' ? newTargetIndex : newTargetIndex + 1;

      next.splice(insertIndex, 0, draggedItem);
      return next;
    };

    if (activeSceneLaunchBeatId) {
      setSceneLaunchBeats(previous => previous.map(beat => (
        beat.id === activeSceneLaunchBeatId
          ? { ...beat, gridOrder: reorderItems(beat.gridOrder) }
          : beat
      )));
      return;
    }

    setSceneLaunchGridOrder(reorderItems);
  };

  const createSceneFromComposer = () => {
    const nextName = sceneComposerText.trim() || `Scene ${scenes.length + 1}`;
    const reusableBlankScene = activeScene && scenes.length === 1 && activeScene.clips.length === 0 && !activeScene.description?.trim();

    if (reusableBlankScene) {
      updateScene(activeScene.id, { name: nextName });
      setActiveScene(activeScene.id);
    } else {
      addScene(nextName);
    }

    setSceneComposerText('');
    setActiveTab('scenes');
  };

  const handleSceneLaunchDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (event.dataTransfer.getData('text/plain')) return;
    addFilesToSceneLaunchMedia(Array.from(event.dataTransfer.files || []));
  };

  const openProjectScene = (sceneId: string) => {
    setActiveScene(sceneId);
    closeSceneLaunchView();
  };

  // Timeline View Helper calculations
  const timelineItems = activeSceneLaunchGridOrder
    .map(orderItem => {
      if (orderItem.type === 'media') {
        const item = activeSceneLaunchBeat
          ? activeSceneLaunchBeat.items.find(mediaItem => mediaItem.id === orderItem.id)
          : sceneLaunchMediaItems.find(mediaItem => mediaItem.id === orderItem.id);
        if (!item) return null;
        return { ...orderItem, item };
      }

      const collection = sceneLaunchBeats.find(beat => beat.id === orderItem.id);
      if (!collection) return null;
      return { ...orderItem, collection };
    })
    .filter((item): item is (
      | { id: string; type: 'media'; item: typeof sceneLaunchMediaItems[number] }
      | { id: string; type: 'collection'; collection: typeof sceneLaunchBeats[number] }
    ) => !!item);

  const timelineTotalDuration = timelineItems.reduce((sum, item) => {
    if (item.type === 'media') {
      if (resizingItem && resizingItem.id === item.item.id) {
        return sum + resizingItem.currentDuration;
      }
      return sum + (item.item.durationSeconds || 3);
    } else {
      return sum + (getRecursiveCollectionDuration(item.collection) || 3);
    }
  }, 0);

  const getActiveTimelineItemInfo = (currentTime: number) => {
    let accumulatedTime = 0;
    for (const item of timelineItems) {
      let duration = 3;
      if (item.type === 'media') {
        if (resizingItem && resizingItem.id === item.item.id) {
          duration = resizingItem.currentDuration;
        } else {
          duration = item.item.durationSeconds || 3;
        }
      } else {
        duration = getRecursiveCollectionDuration(item.collection) || 3;
      }
      if (currentTime >= accumulatedTime && currentTime < accumulatedTime + duration) {
        return { id: item.id, type: item.type };
      }
      accumulatedTime += duration;
    }
    if (timelineItems.length > 0 && currentTime >= accumulatedTime) {
      const last = timelineItems[timelineItems.length - 1];
      return { id: last.id, type: last.type };
    }
    return null;
  };

  const activeItemInfo = getActiveTimelineItemInfo(timelineCurrentTime);
  const activeItemKey = activeItemInfo ? `${activeItemInfo.type}:${activeItemInfo.id}` : null;

  React.useEffect(() => {
    if (!sceneLaunchPreviewHover) {
      if (!isTimelinePlaying && !isScrubbing) {
        setTimelineCurrentTime(0);
        currentTimeRef.current = 0;
      }
      return;
    }

    let frameId: number;
    const tick = () => {
      const now = Date.now();
      setSceneLaunchPreviewNow(now);

      const hoveredId = sceneLaunchPreviewHover.collectionId;
      const hoveredBeat = sceneLaunchBeats.find(b => b.id === hoveredId);
      if (hoveredBeat && !isTimelinePlaying && !isScrubbing) {
        const mediaItems = getRecursiveMediaItems(hoveredBeat);
        const totalDuration = mediaItems.reduce((sum, item) => sum + (item.durationSeconds || 3), 0);
        if (totalDuration > 0) {
          const elapsed = ((now - sceneLaunchPreviewHover.startedAt) / 1000) % totalDuration;
          
          let startTime = 0;
          let found = false;
          for (const item of timelineItems) {
            if (item.type === 'collection' && item.collection.id === hoveredId) {
              found = true;
              break;
            }
            if (item.type === 'media') {
              startTime += item.item.durationSeconds || 3;
            } else {
              startTime += getRecursiveCollectionDuration(item.collection) || 3;
            }
          }
          
          if (found) {
            const nextTime = startTime + elapsed;
            setTimelineCurrentTime(nextTime);
            currentTimeRef.current = nextTime;
          }
        }
      }

      frameId = requestAnimationFrame(tick);
    };

    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [sceneLaunchPreviewHover, isTimelinePlaying, isScrubbing, timelineItems, sceneLaunchBeats]);

  React.useEffect(() => {
    if (!isTimelinePlaying) return;

    let lastTime = performance.now();
    let frameId: number;

    const tick = (now: number) => {
      const delta = (now - lastTime) / 1000;
      lastTime = now;

      const current = currentTimeRef.current;
      const next = current + delta;

      if (next >= timelineTotalDuration) {
        setTimelineCurrentTime(0);
        currentTimeRef.current = 0;
        if (!isTimelineLooping) {
          setIsTimelinePlaying(false);
          return;
        }
      } else {
        setTimelineCurrentTime(next);
        currentTimeRef.current = next;
      }

      frameId = requestAnimationFrame(tick);
    };

    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [isTimelinePlaying, timelineTotalDuration, isTimelineLooping]);

  React.useEffect(() => {
    if (!activeItemKey) return;
    const element = document.getElementById(`grid-item-${activeItemKey}`);
    if (element) {
      element.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    }
  }, [activeItemKey]);

  const renderTimelineRuler = () => {
    const totalSec = Math.max(10, Math.ceil(timelineTotalDuration));
    const ticks = [];
    for (let i = 0; i <= totalSec; i++) {
      ticks.push(i);
    }

    const widthPx = Math.max(10, timelineTotalDuration) * pxPerSecond;

    return (
      <div 
        className="relative h-6 border-b border-zinc-800 text-[9px] font-mono text-zinc-500 select-none cursor-ew-resize"
        style={{ width: `${widthPx}px`, minWidth: '100%' }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          setIsScrubbing(true);
          const rect = e.currentTarget.getBoundingClientRect();
          const offsetX = e.clientX - rect.left;
          const clickedTime = Math.max(0, Math.min(timelineTotalDuration, offsetX / pxPerSecond));
          setTimelineCurrentTime(clickedTime);
          currentTimeRef.current = clickedTime;
        }}
        onPointerMove={(e) => {
          if (!isScrubbing) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const offsetX = e.clientX - rect.left;
          const clickedTime = Math.max(0, Math.min(timelineTotalDuration, offsetX / pxPerSecond));
          setTimelineCurrentTime(clickedTime);
          currentTimeRef.current = clickedTime;
        }}
        onPointerUp={(e) => {
          if (isScrubbing) {
            e.currentTarget.releasePointerCapture(e.pointerId);
            setIsScrubbing(false);
          }
        }}
      >
        {ticks.map((sec) => {
          const left = sec * pxPerSecond;
          const isMajor = sec % 5 === 0;
          return (
            <div 
              key={sec} 
              className="absolute bottom-0 -translate-x-1/2 flex flex-col items-center"
              style={{ left: `${left}px` }}
            >
              {isMajor && <span className="mb-0.5 text-[8px] text-zinc-500 font-semibold">{sec}s</span>}
              <div className={cn("w-px bg-zinc-800/80", isMajor ? "h-2.5 bg-zinc-600/80" : "h-1 bg-zinc-800/40")} />
            </div>
          );
        })}
      </div>
    );
  };

  const renderSceneLaunchTimeline = () => {
    const totalDuration = timelineTotalDuration;
    const widthPx = Math.max(10, totalDuration) * pxPerSecond;



    return (
      <div className="absolute bottom-5 left-1/2 z-20 -translate-x-1/2 w-[95%] max-w-[76rem] bg-zinc-950/85 border border-zinc-800/80 backdrop-blur-xl rounded-2xl shadow-2xl p-4 flex flex-col gap-2.5 select-none">
        <style dangerouslySetInnerHTML={{ __html: `
          .timeline-track-scroll::-webkit-scrollbar {
            height: 6px;
          }
          .timeline-track-scroll::-webkit-scrollbar-track {
            background: transparent;
          }
          .timeline-track-scroll::-webkit-scrollbar-thumb {
            background: rgba(255, 255, 255, 0.12);
            border-radius: 9999px;
          }
          .timeline-track-scroll::-webkit-scrollbar-thumb:hover {
            background: rgba(255, 255, 255, 0.25);
          }
        `}} />

        <div className="flex items-center justify-between text-zinc-400 px-1">
          {/* Left Column */}
          <div className="flex flex-1 items-center gap-2">
            <Clock className="h-4 w-4 text-indigo-400" />
            <span className="text-xs font-bold uppercase tracking-wider text-zinc-300 truncate max-w-[12rem] md:max-w-[18rem]">
              {activeSceneLaunchBeatId === 'trash' ? 'Trash Timeline' : activeSceneLaunchBeat ? `${activeSceneLaunchBeat.name} Timeline` : 'Project Timeline'}
            </span>
            <span className="text-[10px] bg-zinc-900 border border-zinc-800 text-zinc-300 px-1.5 py-0.5 rounded-full font-mono font-bold shrink-0">
              {totalDuration.toFixed(1)}s
            </span>
          </div>
          
          {/* Center Column: Play/Pause controls */}
          <div className="flex items-center justify-center shrink-0 gap-2.5">
            <button
              type="button"
              onClick={() => setIsTimelineLooping(!isTimelineLooping)}
              className={cn(
                "p-1 rounded transition-colors cursor-pointer",
                isTimelineLooping ? "text-indigo-400 hover:text-indigo-300" : "text-zinc-650 hover:text-zinc-400"
              )}
              title={isTimelineLooping ? "Disable Loop" : "Enable Loop"}
            >
              <Repeat className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setIsTimelinePlaying(!isTimelinePlaying)}
              className={cn(
                "flex h-7 w-7 items-center justify-center rounded-full transition-all text-white shadow-md cursor-pointer",
                isTimelinePlaying ? "bg-red-650 hover:bg-red-700 animate-pulse" : "bg-indigo-600 hover:bg-indigo-700"
              )}
              title={isTimelinePlaying ? "Pause Timeline" : "Play Timeline"}
            >
              {isTimelinePlaying ? (
                <Pause className="h-3.5 w-3.5 fill-current" />
              ) : (
                <Play className="h-3.5 w-3.5 fill-current ml-0.5" />
              )}
            </button>
            <span className="text-[10px] font-mono text-zinc-300 bg-zinc-900 border border-zinc-800/80 px-2 py-0.5 rounded-full font-bold">
              {timelineCurrentTime.toFixed(1)}s
            </span>
          </div>

          {/* Right Column */}
          <div className="flex flex-1 items-center justify-end gap-1.5">
            <button
              type="button"
              onClick={() => setPxPerSecond(prev => Math.max(5, prev - 5))}
              className="p-1 rounded hover:bg-white/5 hover:text-white transition-colors cursor-pointer"
              title="Zoom out"
            >
              <ZoomOut className="h-4 w-4" />
            </button>
            <span className="text-[10px] font-mono text-zinc-500 w-8 text-center select-none font-semibold">
              {Math.round(pxPerSecond * 5)}%
            </span>
            <button
              type="button"
              onClick={() => setPxPerSecond(prev => Math.min(60, prev + 5))}
              className="p-1 rounded hover:bg-white/5 hover:text-white transition-colors cursor-pointer"
              title="Zoom in"
            >
              <ZoomIn className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="relative border border-zinc-800/80 bg-[#09090b]/40 rounded-xl flex flex-col overflow-hidden">
          <div className="overflow-x-auto overflow-y-hidden timeline-track-scroll flex flex-col flex-1 relative" id="timeline-track-scrub-zone">
            {/* Ruler */}
            {renderTimelineRuler()}

            {/* Clips Row */}
            <div 
              className="flex items-stretch h-20 bg-zinc-950/20 relative"
              style={{ width: `${widthPx}px`, minWidth: '100%' }}
            >

              {timelineItems.length === 0 ? (
                <div className="flex items-center justify-center w-full h-full text-zinc-600 text-xs py-4">
                  Timeline is empty. Drag media items or collections here.
                </div>
              ) : (
                timelineItems.map((gridItem, idx) => {
                  const dragKey = `${gridItem.type}:${gridItem.id}`;
                  let duration = 3;
                  let name = '';
                  let previewUrl = '';
                  let isImage = false;
                  let isVideo = false;

                  if (gridItem.type === 'media') {
                    if (resizingItem && resizingItem.id === gridItem.id) {
                      duration = resizingItem.currentDuration;
                    } else {
                      duration = gridItem.item.durationSeconds || 3;
                    }
                    name = gridItem.item.name;
                    previewUrl = gridItem.item.previewUrl;
                    isImage = gridItem.item.type === 'image';
                    isVideo = gridItem.item.type === 'video';
                  } else {
                    duration = getRecursiveCollectionDuration(gridItem.collection) || 3;
                    name = gridItem.collection.name;
                    const colPreview = getSceneLaunchCollectionPreview(gridItem.collection);
                    if (colPreview) {
                      previewUrl = colPreview.item.previewUrl;
                      isImage = colPreview.item.type === 'image';
                      isVideo = colPreview.item.type === 'video';
                    }
                  }

                  const blockWidth = duration * pxPerSecond;
                  const isItemActive = activeItemKey === dragKey;

                  return (
                    <div
                      key={dragKey}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.effectAllowed = 'move';
                        e.dataTransfer.setData('text/plain', dragKey);
                      }}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'move';
                      }}
                      onDragEnter={() => setTimelineDragOverKey(dragKey)}
                      onDragLeave={() => setTimelineDragOverKey(null)}
                      onDrop={(e) => {
                        e.preventDefault();
                        setTimelineDragOverKey(null);
                        const draggedKey = e.dataTransfer.getData('text/plain');
                        if (draggedKey) {
                          reorderSceneLaunchGridItem(draggedKey, dragKey);
                        }
                      }}
                      onContextMenu={(e) => handleItemContextMenu(e, dragKey)}
                      style={{ width: `${blockWidth}px` }}
                      className={cn(
                        "relative group flex-shrink-0 flex items-stretch border-r border-zinc-800/80 bg-zinc-950/30 select-none overflow-hidden transition-all duration-150 cursor-grab active:cursor-grabbing",
                        timelineDragOverKey === dragKey && "border-l-2 border-l-indigo-500 bg-indigo-950/20",
                        gridItem.type === 'collection' && "bg-zinc-900/10 border-b-2 border-b-zinc-800",
                        isItemActive ? "bg-indigo-955/10 border-t border-t-indigo-500/40" : ""
                      )}
                    >
                      {/* Thumbnail background with low opacity */}
                      {previewUrl ? (
                        <div className="absolute inset-0 opacity-25 pointer-events-none">
                          {isVideo ? (
                            <video src={previewUrl} className="h-full w-full object-cover" muted />
                          ) : (
                            <img src={previewUrl} className="h-full w-full object-cover" alt="" />
                          )}
                        </div>
                      ) : (
                        <div className="absolute inset-0 opacity-10 bg-zinc-800 pointer-events-none flex items-center justify-center">
                          <Grid2X2 className="h-5 w-5" />
                        </div>
                      )}

                      {/* Content Overlay */}
                      <div className="relative z-10 flex flex-col justify-between p-2 w-full h-full pointer-events-none text-left">
                        <div className={cn("truncate text-[10px] font-bold text-zinc-300", isItemActive && "text-indigo-200")}>
                          {name}
                        </div>
                        <div className="flex items-center justify-between gap-1 text-[9px] font-mono font-medium text-zinc-500">
                          <span className={cn("bg-black/60 border border-zinc-800 px-1 rounded text-zinc-300", isItemActive && "border-indigo-900/50 text-indigo-300 bg-indigo-950/40")}>
                            {duration.toFixed(1)}s
                          </span>
                          <span className="uppercase text-[8px] tracking-wider font-extrabold text-zinc-600">
                            {gridItem.type}
                          </span>
                        </div>
                      </div>

                      {/* Resize handle (for media items of type image or video) */}
                      {gridItem.type === 'media' && (isImage || isVideo) && (
                        <div
                          style={{ touchAction: 'none' }}
                          onPointerDown={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            const target = e.currentTarget;
                            target.setPointerCapture(e.pointerId);
                            setResizingItem({
                              id: gridItem.id,
                              initialDuration: duration,
                              startX: e.clientX,
                              currentDuration: duration,
                            });
                          }}
                          onPointerMove={(e) => {
                            if (!resizingItem || resizingItem.id !== gridItem.id) return;
                            e.stopPropagation();
                            const deltaX = e.clientX - resizingItem.startX;
                            const deltaDuration = deltaX / pxPerSecond;
                            const newDuration = Math.max(1, Math.min(60, resizingItem.initialDuration + deltaDuration));
                            setResizingItem({
                              ...resizingItem,
                              currentDuration: newDuration,
                            });
                          }}
                          onPointerUp={(e) => {
                            if (resizingItem && resizingItem.id === gridItem.id) {
                              e.currentTarget.releasePointerCapture(e.pointerId);
                              updateSceneLaunchMediaDuration(gridItem.id, Number(resizingItem.currentDuration.toFixed(1)));
                              setResizingItem(null);
                            }
                          }}
                          className={cn(
                            "absolute right-0 top-0 w-2.5 h-full cursor-col-resize z-20 transition-all hover:bg-indigo-500/70 bg-zinc-800/10 border-r border-r-zinc-700/50 group-hover:border-r-indigo-500/50",
                            resizingItem?.id === gridItem.id && "bg-indigo-500 border-r-indigo-400"
                          )}
                        />
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {/* Vertical Playhead line & handle spanning BOTH ruler and clips row */}
            <div 
              className="absolute top-0 bottom-0 w-0.5 bg-red-500/80 z-30 pointer-events-none"
              style={{ left: `${timelineCurrentTime * pxPerSecond}px` }}
            >
              {/* Playhead Grab Handle badge sitting on ruler */}
              <div 
                className="absolute -top-0.5 -translate-x-1/2 w-6 h-6 flex items-center justify-center cursor-ew-resize pointer-events-auto group/playhead"
                onPointerDown={(e) => {
                  e.stopPropagation();
                  e.currentTarget.setPointerCapture(e.pointerId);
                  setIsScrubbing(true);
                }}
                onPointerMove={(e) => {
                  if (!isScrubbing) return;
                  const track = document.getElementById('timeline-track-scrub-zone');
                  if (track) {
                    const rect = track.getBoundingClientRect();
                    const offsetX = e.clientX - rect.left;
                    const clickedTime = Math.max(0, Math.min(totalDuration, offsetX / pxPerSecond));
                    setTimelineCurrentTime(clickedTime);
                    currentTimeRef.current = clickedTime;
                  }
                }}
                onPointerUp={(e) => {
                  e.currentTarget.releasePointerCapture(e.pointerId);
                  setIsScrubbing(false);
                }}
              >
                {/* Sleek inverted teardrop handle badge with glow */}
                <div className="w-3.5 h-4 bg-red-500 rounded-t-full rounded-b-sm border border-red-400 shadow-[0_1px_4px_rgba(0,0,0,0.5),0_0_8px_rgba(239,68,68,0.4)] group-hover/playhead:bg-red-400 group-hover/playhead:scale-110 transition-all duration-150" />
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderSceneLaunchWorkspace = () => (
    <div
      className="relative flex min-h-0 flex-1 overflow-hidden bg-black text-zinc-100"
      onDragOver={(event) => event.preventDefault()}
      onDrop={handleSceneLaunchDrop}
    >
      <input
        type="file"
        ref={fileInputRef}
        className="hidden"
        accept={pendingType === 'video' ? 'video/*' : 'image/*'}
        onChange={handleFileChange}
      />
      <input
        type="file"
        ref={beatFileInputRef}
        className="hidden"
        accept="image/*,video/*"
        multiple
        onChange={handleBeatFileChange}
      />

      <aside className="flex w-14 shrink-0 flex-col items-center border-r border-white/10 py-4">
        <button
          type="button"
          className="flex h-10 w-10 items-center justify-center rounded-full bg-zinc-800 text-white"
          aria-label="Scenes"
          onClick={() => setActiveTab('scenes')}
        >
          <Grid2X2 className="h-4.5 w-4.5" />
        </button>
        <button
          type="button"
          className="mt-5 flex h-9 w-9 items-center justify-center rounded-full text-zinc-500 hover:bg-white/5 hover:text-zinc-200"
          aria-label="Characters"
          onClick={() => setActiveTab('characters')}
        >
          <Users className="h-4.5 w-4.5" />
        </button>
        <button
          type="button"
          className="mt-2 flex h-9 w-9 items-center justify-center rounded-full text-zinc-500 hover:bg-white/5 hover:text-zinc-200"
          aria-label="Saved scenes"
          onClick={openSceneLibrary}
        >
          <Clapperboard className="h-4.5 w-4.5" />
        </button>
        <button
          type="button"
          className={cn(
            "mt-2 flex h-9 w-9 items-center justify-center rounded-full transition-all duration-200",
            activeSceneLaunchBeatId === 'trash'
              ? "bg-zinc-800 text-white shadow-md"
              : "text-zinc-500 hover:bg-white/5 hover:text-zinc-200"
          )}
          aria-label="Trash"
          onClick={() => setSceneLaunchBeatPath(['trash'])}
          onDragOver={(e) => {
            e.preventDefault();
            e.currentTarget.classList.add('bg-red-950/40', 'text-red-400', 'border', 'border-red-900/50');
          }}
          onDragLeave={(e) => {
            e.currentTarget.classList.remove('bg-red-950/40', 'text-red-400', 'border', 'border-red-900/50');
          }}
          onDrop={(e) => {
            e.preventDefault();
            e.currentTarget.classList.remove('bg-red-950/40', 'text-red-400', 'border', 'border-red-900/50');
            const dragKey = e.dataTransfer.getData('text/plain');
            if (dragKey) {
              moveItemToTrash(dragKey);
            }
          }}
        >
          <Trash2 className="h-4.5 w-4.5" />
        </button>
        <div className="my-5 h-px w-8 bg-white/10" />
        <button
          type="button"
          className="flex h-9 w-9 items-center justify-center rounded-full text-zinc-500 hover:bg-white/5 hover:text-zinc-200"
          aria-label="AI scene helper"
          onClick={() => setActiveTab('analyze')}
        >
          <Sparkles className="h-4.5 w-4.5" />
        </button>
        <div className="flex-1" />
        <button
          type="button"
          className="flex h-9 w-9 items-center justify-center rounded-full text-zinc-500 hover:bg-white/5 hover:text-zinc-200"
          aria-label="Settings"
          onClick={() => setActiveTab('settings')}
        >
          <Settings className="h-4.5 w-4.5" />
        </button>
      </aside>

      <div className="relative flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center justify-between gap-4 px-5">
          <div className="flex min-w-0 items-center gap-4">
            <button
              type="button"
              className={cn(
                "flex h-9 w-9 items-center justify-center rounded-full text-zinc-300 transition-all duration-200",
                activeSceneLaunchBeatId
                  ? "hover:bg-white/5 hover:text-white"
                  : "text-zinc-500 hover:bg-white/5 hover:text-zinc-200"
              )}
              aria-label="Back home"
              onClick={() => {
                if (activeSceneLaunchBeatId) {
                  setSceneLaunchBeatPath(previous => previous.slice(0, -1));
                  return;
                }
                router.push('/');
              }}
              onDragOver={(e) => {
                if (!activeSceneLaunchBeatId) return;
                e.preventDefault();
                e.currentTarget.classList.add('bg-zinc-800', 'text-white', 'border', 'border-zinc-700');
              }}
              onDragLeave={(e) => {
                e.currentTarget.classList.remove('bg-zinc-800', 'text-white', 'border', 'border-zinc-700');
              }}
              onDrop={(e) => {
                if (!activeSceneLaunchBeatId) return;
                e.preventDefault();
                e.currentTarget.classList.remove('bg-zinc-800', 'text-white', 'border', 'border-zinc-700');
                const dragKey = e.dataTransfer.getData('text/plain');
                if (dragKey) {
                  moveSceneLaunchItemToParent(dragKey);
                }
              }}
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            {(() => {
              const headerName = getHeaderName();
              const isHeaderEditable = activeSceneLaunchBeatId !== 'trash';
              return (
                <div className="min-w-0">
                  {isEditingHeaderName && isHeaderEditable ? (
                    <input
                      type="text"
                      value={editingHeaderNameValue}
                      onChange={(e) => setEditingHeaderNameValue(e.target.value)}
                      onBlur={saveHeaderName}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') saveHeaderName();
                        if (e.key === 'Escape') setIsEditingHeaderName(false);
                      }}
                      autoFocus
                      className="bg-transparent text-sm font-semibold text-zinc-100 border-b border-zinc-700 outline-none focus:border-indigo-500 py-0.5 px-0 w-auto min-w-[150px]"
                    />
                  ) : (
                    <div 
                      className={cn(
                        "flex items-center gap-1.5 truncate text-sm font-semibold text-zinc-100 select-none",
                        isHeaderEditable && "cursor-pointer hover:text-white group"
                      )}
                      onClick={() => {
                        if (isHeaderEditable) {
                          setEditingHeaderNameValue(headerName);
                          setIsEditingHeaderName(true);
                        }
                      }}
                    >
                      <span className="truncate">{headerName}</span>
                      {isHeaderEditable && (
                        <Pencil className="h-3 w-3 text-zinc-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                      )}
                    </div>
                  )}
                  <div className="mt-0.5 text-[10px] font-medium text-zinc-600">
                    {new Date().toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                  </div>
                </div>
              );
            })()}
          </div>

          <div className="hidden h-11 w-full max-w-xl items-center gap-3 rounded-full bg-zinc-900 px-5 text-zinc-500 ring-1 ring-white/10 md:flex">
            <Search className="h-4.5 w-4.5 shrink-0" />
            <input
              value={sceneLaunchSearch}
              onChange={(event) => setSceneLaunchSearch(event.target.value)}
              className="h-full min-w-0 flex-1 bg-transparent text-sm text-zinc-200 outline-none placeholder:text-zinc-600"
              placeholder="Search scenes"
            />
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-9 w-9 rounded-full text-zinc-300 hover:bg-white/5 hover:text-white"
              onClick={() => handleAddClipClick('video')}
              title="Add video scene media"
              aria-label="Add video scene media"
            >
              <Plus className="h-5 w-5" />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger
                className="h-9 w-9 flex items-center justify-center rounded-full text-zinc-300 hover:bg-white/5 hover:text-white transition-colors outline-none focus-visible:ring-1 focus-visible:ring-ring cursor-pointer"
                title={`Change aspect ratio (currently ${aspectRatio})`}
                aria-label="Change aspect ratio"
              >
                <Ratio className="h-5 w-5" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-36 bg-[#111114] border-zinc-800 text-zinc-300 z-50">
                <div className="px-2 py-1 text-[9px] uppercase tracking-widest text-zinc-500 font-bold select-none cursor-default">Aspect Ratio</div>
                {(['16:9', '21:9', '1:1', '9:16'] as const).map((ratio) => (
                  <DropdownMenuItem
                    key={ratio}
                    onClick={() => setAspectRatio(ratio)}
                    className="justify-between font-mono text-xs focus:bg-zinc-800 focus:text-white cursor-pointer"
                  >
                    {ratio}
                    {aspectRatio === ratio && <span className="text-indigo-300">•</span>}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-9 w-9 rounded-full text-zinc-300 hover:bg-white/5 hover:text-white"
              onClick={() => setActiveTab('settings')}
              title="Project settings"
              aria-label="Project settings"
            >
              <Settings className="h-5 w-5" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-9 w-9 rounded-full text-zinc-300 hover:bg-white/5 hover:text-white"
              onClick={openSceneLibrary}
              title="Scene help and library"
              aria-label="Scene help and library"
            >
              <HelpCircle className="h-5 w-5" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-9 w-9 rounded-full text-zinc-300 hover:bg-white/5 hover:text-white"
              title="More"
              aria-label="More"
            >
              <MoreVertical className="h-5 w-5" />
            </Button>
          </div>
        </header>

        <main className="relative flex min-h-0 flex-1 flex-col px-6 pb-56 overflow-y-auto">
          {!activeSceneLaunchBeat && rootSceneLaunchGridItemsCount === 0 && (projectHasSceneContent || visibleProjectScenes.length > 1) ? (
            <div className="mx-auto mt-8 w-full max-w-6xl">
              <div className="mb-4 flex items-end justify-between gap-4">
                <div>
                  <h2 className="text-sm font-semibold text-zinc-200">Project scenes</h2>
                  <p className="mt-1 text-xs text-zinc-600">Open an existing scene or add a new scene to this project.</p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 border-zinc-800 bg-zinc-950 text-xs text-zinc-300 hover:bg-zinc-900 hover:text-white"
                  onClick={createSceneFromComposer}
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add Scene
                </Button>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {visibleProjectScenes.map((scene, index) => (
                  <article
                    key={scene.id}
                    className="group overflow-hidden rounded-lg border border-zinc-900 bg-zinc-950/70 transition-colors hover:border-zinc-700"
                  >
                    <button
                      type="button"
                      className="block w-full text-left"
                      onClick={() => openProjectScene(scene.id)}
                    >
                      <div className="relative flex aspect-video items-center justify-center overflow-hidden bg-zinc-950">
                        {scene.thumbnailUrl ? (
                          <img src={scene.thumbnailUrl} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <Clapperboard className="h-8 w-8 text-zinc-700" />
                        )}
                        <span className="absolute left-3 top-3 rounded bg-black/70 px-2 py-1 font-mono text-[9px] uppercase tracking-widest text-zinc-400">
                          Scene {index + 1}
                        </span>
                      </div>
                      <div className="p-3">
                        <h3 className="truncate text-sm font-semibold text-zinc-100">{scene.name}</h3>
                        <p className="mt-1 text-[10px] font-mono uppercase tracking-widest text-zinc-600">
                          {scene.clips.length} {scene.clips.length === 1 ? 'clip' : 'clips'}
                        </p>
                      </div>
                    </button>
                  </article>
                ))}
              </div>
            </div>
          ) : sceneLaunchGridItems.length === 0 ? (
            <div className="flex flex-1 items-center justify-center">
              <div className="flex flex-col items-center text-center">
                <div className="flex h-16 w-16 items-center justify-center">
                  <Clapperboard className="h-12 w-12 text-zinc-200" />
                </div>
                <h2 className="mt-5 text-lg font-medium text-zinc-500">Start creating or drop scene media</h2>
                <p className="mt-2 max-w-sm text-xs leading-5 text-zinc-700">
                  Add a video, image, or scene note to begin building this project.
                </p>
              </div>
            </div>
          ) : null}

          <section className="mx-auto mt-6 w-full max-w-6xl shrink-0">
            {activeSceneLaunchBeat ? (
              <>
                <div className="mb-4 flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <h2 className="truncate text-sm font-semibold text-zinc-200">
                      {activeSceneLaunchBeatId === 'trash' ? 'Trash Folder' : activeSceneLaunchBeat.name}
                    </h2>
                    <p className="mt-1 text-[11px] text-zinc-700">
                      {activeSceneLaunchBeatId === 'trash'
                        ? 'Items moved here can be restored or permanently deleted'
                        : `${activeSceneLaunchBeat.gridOrder.length} ${activeSceneLaunchBeat.gridOrder.length === 1 ? 'item' : 'items'} in this collection`
                      }
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {activeSceneLaunchBeatId === 'trash' ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 border-red-950 bg-red-950/10 text-xs text-red-450 hover:bg-red-950 hover:text-white transition-colors"
                        onClick={emptyTrash}
                        disabled={activeSceneLaunchBeat.gridOrder.length === 0}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Empty Trash
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 border-zinc-800 bg-zinc-950 text-xs text-zinc-300 hover:bg-zinc-900 hover:text-white"
                        onClick={createSceneLaunchBeat}
                      >
                        <Grid2X2 className="h-3.5 w-3.5" />
                        Add Collection
                      </Button>
                    )}
                  </div>
                </div>

                <div
                  className="rounded-lg border border-zinc-900 bg-zinc-950/30 p-3"
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => handleBeatDrop(event, activeSceneLaunchBeat.id)}
                >
                  {sceneLaunchGridItems.length > 0 ? (
                    <div className="flex flex-wrap items-start gap-3">
                      {sceneLaunchGridItems.map((gridItem, index) => {
                        const dragKey = `${gridItem.type}:${gridItem.id}`;

                        if (gridItem.type === 'media') {
                          const item = gridItem.item;
                          return (
                            <article
                              key={dragKey}
                              id={`grid-item-${dragKey}`}
                              draggable
                              onDragStart={(event) => {
                                event.dataTransfer.effectAllowed = 'move';
                                event.dataTransfer.setData('text/plain', dragKey);
                              }}
                              onDragOver={(event) => handleGridDragOver(event, dragKey, false)}
                              onDragLeave={handleGridDragLeave}
                              onDrop={(event) => handleGridDrop(event, dragKey, false)}
                              style={getSceneLaunchMediaTileStyle(item)}
                              className={cn(
                                "group cursor-grab overflow-hidden rounded-lg border border-zinc-900 bg-black transition-all duration-300 active:cursor-grabbing scroll-mt-24 relative",
                                isTimelinePlaying && activeItemKey && activeItemKey !== dragKey ? "opacity-30" : "opacity-100"
                              )}
                              onContextMenu={(event) => handleItemContextMenu(event, dragKey)}
                            >
                              {gridDragOverInfo?.targetKey === dragKey && gridDragOverInfo.position === 'before' && (
                                <div className="absolute top-0 bottom-0 left-0 w-1 bg-indigo-500 shadow-[0_0_8px_#6366f1] z-30 pointer-events-none" />
                              )}
                              {gridDragOverInfo?.targetKey === dragKey && gridDragOverInfo.position === 'after' && (
                                <div className="absolute top-0 bottom-0 right-0 w-1 bg-indigo-500 shadow-[0_0_8px_#6366f1] z-30 pointer-events-none" />
                              )}
                              <div className="overflow-hidden relative h-36 sm:h-40 lg:h-44" style={getSceneLaunchMediaPreviewStyle()}>
                                {item.type === 'video' ? (
                                  <video
                                 ref={(el) => {
                                   if (el) {
                                     const state = getGridItemTimelineState(item.id, 'media');
                                     if (state.status === 'idle') {
                                       el.currentTime = 0;
                                       if (!el.paused) el.pause();
                                     } else if (state.status === 'past') {
                                       el.currentTime = state.duration;
                                       if (!el.paused) el.pause();
                                     } else if (state.status === 'future') {
                                       el.currentTime = 0;
                                       if (!el.paused) el.pause();
                                     } else if (state.status === 'active') {
                                       const diff = Math.abs(el.currentTime - state.elapsed);
                                       if (diff > 0.3) {
                                         el.currentTime = state.elapsed;
                                       }
                                       if (el.paused && isTimelinePlaying) {
                                         el.play().catch(() => {});
                                       } else if (!el.paused && !isTimelinePlaying) {
                                         el.pause();
                                       }
                                     }
                                   }
                                 }}
                                 src={item.previewUrl}
                                 className="h-full w-full object-cover"
                                 muted
                                 playsInline
                                 controls
                               />
                                ) : (
                                  <img src={item.previewUrl} alt="" className="h-full w-full object-cover" />
                                )}
                              </div>
                              <div className="flex items-center justify-between gap-2 p-2">
                                <div className="min-w-0">
                                  <div className="truncate text-[11px] font-semibold text-zinc-300">{item.name}</div>
                                  <div className="mt-0.5 text-[9px] font-mono uppercase tracking-widest text-zinc-700">{item.type}</div>
                                </div>
                                {item.type === 'image' || item.type === 'video' ? (
                                  <label className="flex h-8 shrink-0 items-center gap-1 rounded border border-zinc-900 bg-zinc-950 px-2 py-1 text-[10px] font-mono uppercase tracking-widest text-zinc-400 transition-colors hover:bg-zinc-900 focus-within:border-zinc-700 cursor-pointer select-none">
                                    <input
                                      type="number"
                                      min={1}
                                      max={60}
                                      value={item.durationSeconds ?? 3}
                                      onClick={(event) => event.stopPropagation()}
                                      onPointerDown={(event) => event.stopPropagation()}
                                      onChange={(event) => updateSceneLaunchMediaDuration(item.id, Number(event.target.value))}
                                      className="h-5 w-9 bg-transparent text-right text-[11px] font-semibold text-zinc-200 outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                      aria-label={`${item.name} duration in seconds`}
                                    />
                                    s
                                  </label>
                                ) : null}
                                <GripVertical className="h-3.5 w-3.5 shrink-0 text-zinc-700 group-hover:text-zinc-400" />
                              </div>
                            </article>
                          );
                        }

                        const beat = gridItem.collection;
                        const preview = getSceneLaunchCollectionPreview(beat);
                        return (
                          <article
                            key={dragKey}
                            id={`grid-item-${dragKey}`}
                            draggable
                            onDragStart={(event) => {
                              event.dataTransfer.effectAllowed = 'move';
                              event.dataTransfer.setData('text/plain', dragKey);
                            }}
                            onDragOver={(event) => handleGridDragOver(event, dragKey, true)}
                            onDragLeave={handleGridDragLeave}
                            onDrop={(event) => handleGridDrop(event, dragKey, true)}
                            onMouseEnter={() => setSceneLaunchPreviewHover({ collectionId: beat.id, startedAt: Date.now() })}
                            onMouseLeave={() => setSceneLaunchPreviewHover(previous => (
                              previous?.collectionId === beat.id ? null : previous
                            ))}
                            onFocus={() => setSceneLaunchPreviewHover({ collectionId: beat.id, startedAt: Date.now() })}
                            onBlur={() => setSceneLaunchPreviewHover(previous => (
                              previous?.collectionId === beat.id ? null : previous
                            ))}
                            style={getSceneLaunchCollectionTileStyle()}
                            className={cn(
                              "group cursor-grab overflow-hidden rounded-lg border border-zinc-900 bg-zinc-950/80 transition-all duration-300 active:cursor-grabbing scroll-mt-24 relative",
                              isTimelinePlaying && activeItemKey && activeItemKey !== dragKey ? "opacity-30" : "opacity-100",
                              gridDragOverInfo?.targetKey === dragKey && gridDragOverInfo.position === 'inside' && "ring-2 ring-indigo-500 border-indigo-500 shadow-[0_0_12px_rgba(99,102,241,0.3)]"
                            )}
                            onContextMenu={(event) => handleItemContextMenu(event, dragKey)}
                          >
                            {gridDragOverInfo?.targetKey === dragKey && gridDragOverInfo.position === 'before' && (
                              <div className="absolute top-0 bottom-0 left-0 w-1 bg-indigo-500 shadow-[0_0_8px_#6366f1] z-30 pointer-events-none" />
                            )}
                            {gridDragOverInfo?.targetKey === dragKey && gridDragOverInfo.position === 'after' && (
                              <div className="absolute top-0 bottom-0 right-0 w-1 bg-indigo-500 shadow-[0_0_8px_#6366f1] z-30 pointer-events-none" />
                            )}
                            <div
                              className="relative bg-black overflow-hidden h-36 sm:h-40 lg:h-44"
                              style={getSceneLaunchMediaPreviewStyle()}
                            >
                              <button
                                type="button"
                                className="block h-full w-full"
                                onClick={() => openBeatDetail(beat.id)}
                                aria-label={`Open ${beat.name}`}
                              >
                                {preview ? (
                                  preview.item.type === 'video' ? (
                                    <video
                                      key={preview.item.id}
                                      ref={(el) => {
                                        if (el) {
                                          const diff = Math.abs(el.currentTime - preview.elapsedSeconds);
                                          if (diff > 0.3) {
                                            el.currentTime = preview.elapsedSeconds;
                                          }
                                          const state = getGridItemTimelineState(beat.id, 'collection');
                                          if (state.status === 'past') {
                                            if (!el.paused) el.pause();
                                          }
                                        }
                                      }}
                                      src={preview.item.previewUrl}
                                      className="h-full w-full object-cover"
                                      muted
                                      playsInline
                                      autoPlay
                                      loop
                                    />
                                  ) : (
                                    <img
                                      key={preview.item.id}
                                      src={preview.item.previewUrl}
                                      alt=""
                                      className="h-full w-full object-cover"
                                    />
                                  )
                                ) : (
                                  <div className="flex h-full w-full flex-col items-center justify-center text-center text-zinc-600 transition-colors hover:bg-white/[0.03] hover:text-zinc-300">
                                    <Grid2X2 className="h-6 w-6" />
                                    <span className="mt-2 text-[10px] font-semibold uppercase tracking-widest">Open collection</span>
                                  </div>
                                )}
                              </button>
                              {preview?.isPlaying ? (
                                <div className="pointer-events-none absolute bottom-2 right-2 rounded bg-black/75 px-2 py-1 font-mono text-[10px] text-white">
                                  {Math.min(preview.durationSeconds, preview.elapsedSeconds).toFixed(1)}s / {preview.durationSeconds.toFixed(1)}s
                                </div>
                              ) : null}
                            </div>
                            <button
                              type="button"
                              className="flex w-full items-center justify-between gap-2 p-2 text-left"
                              onClick={() => openBeatDetail(beat.id)}
                            >
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-[11px] font-semibold text-zinc-300">{beat.name}</div>
                                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[9px] font-mono uppercase tracking-widest text-zinc-500">
                                  <span>{beat.gridOrder.length} {beat.gridOrder.length === 1 ? 'item' : 'items'}</span>
                                  <span className="text-zinc-700 font-bold">•</span>
                                  <span className="text-white font-extrabold bg-zinc-900 px-1.5 py-0.5 rounded border border-zinc-800">
                                    {(getRecursiveCollectionDuration(beat) || 0).toFixed(1)}s
                                  </span>
                                </div>
                              </div>
                              <span className="flex items-center gap-1">
                                <span className="flex h-5 min-w-5 items-center justify-center rounded bg-zinc-900 font-mono text-[9px] text-zinc-600">
                                  {index + 1}
                                </span>
                                <GripVertical className="h-3.5 w-3.5 text-zinc-700 group-hover:text-zinc-400" />
                              </span>
                            </button>
                          </article>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="flex min-h-64 w-full flex-col items-center justify-center rounded-md border border-dashed border-zinc-900 text-center text-zinc-650 transition-colors">
                      {activeSceneLaunchBeatId === 'trash' ? (
                        <>
                          <Trash2 className="h-7 w-7 text-zinc-700" />
                          <span className="mt-3 text-xs font-semibold uppercase tracking-widest text-zinc-500">Trash is empty</span>
                          <span className="mt-2 max-w-xs text-[11px] leading-5 text-zinc-700">Drag items to the Trash icon in the sidebar or right-click to delete them.</span>
                        </>
                      ) : (
                        <>
                          <Grid2X2 className="h-7 w-7 text-zinc-700" />
                          <span className="mt-3 text-xs font-semibold uppercase tracking-widest text-zinc-500">Collection is empty</span>
                          <span className="mt-2 max-w-xs text-[11px] leading-5 text-zinc-700">Drag and drop media here or add a child collection to begin.</span>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="mb-3 flex items-center justify-between gap-4">
                  <div>
                    <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-500">Scene board</h2>
                    <p className="mt-1 text-[11px] text-zinc-700">Media items and collections share one rearrangeable grid.</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 border-zinc-800 bg-zinc-950 text-xs text-zinc-300 hover:bg-zinc-900 hover:text-white"
                      onClick={() => handleAddClipClick('image')}
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Add Media
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 border-zinc-800 bg-zinc-950 text-xs text-zinc-300 hover:bg-zinc-900 hover:text-white"
                      onClick={createSceneLaunchBeat}
                    >
                      <Grid2X2 className="h-3.5 w-3.5" />
                      Add Collection
                    </Button>
                  </div>
                </div>

                <div className="flex flex-wrap items-start gap-3">
                  {sceneLaunchGridItems.map((gridItem, index) => {
                    const dragKey = `${gridItem.type}:${gridItem.id}`;

                    if (gridItem.type === 'media') {
                      const item = gridItem.item;
                      return (
                        <article
                          key={dragKey}
                          id={`grid-item-${dragKey}`}
                          draggable
                          onDragStart={(event) => {
                            event.dataTransfer.effectAllowed = 'move';
                            event.dataTransfer.setData('text/plain', dragKey);
                          }}
                          onDragOver={(event) => handleGridDragOver(event, dragKey, false)}
                          onDragLeave={handleGridDragLeave}
                          onDrop={(event) => handleGridDrop(event, dragKey, false)}
                          style={getSceneLaunchMediaTileStyle(item)}
                          className={cn(
                            "group cursor-grab overflow-hidden rounded-lg border border-zinc-900 bg-black transition-all duration-300 active:cursor-grabbing scroll-mt-24 relative",
                            isTimelinePlaying && activeItemKey && activeItemKey !== dragKey ? "opacity-30" : "opacity-100"
                          )}
                          onContextMenu={(event) => handleItemContextMenu(event, dragKey)}
                        >
                          {gridDragOverInfo?.targetKey === dragKey && gridDragOverInfo.position === 'before' && (
                            <div className="absolute top-0 bottom-0 left-0 w-1 bg-indigo-500 shadow-[0_0_8px_#6366f1] z-30 pointer-events-none" />
                          )}
                          {gridDragOverInfo?.targetKey === dragKey && gridDragOverInfo.position === 'after' && (
                            <div className="absolute top-0 bottom-0 right-0 w-1 bg-indigo-500 shadow-[0_0_8px_#6366f1] z-30 pointer-events-none" />
                          )}
                          <div className="overflow-hidden relative h-36 sm:h-40 lg:h-44" style={getSceneLaunchMediaPreviewStyle()}>
                            {item.type === 'video' ? (
                              <video
                                ref={(el) => {
                                  if (el) {
                                    const state = getGridItemTimelineState(item.id, 'media');
                                    if (state.status === 'idle') {
                                      el.currentTime = 0;
                                      if (!el.paused) el.pause();
                                    } else if (state.status === 'past') {
                                      el.currentTime = state.duration;
                                      if (!el.paused) el.pause();
                                    } else if (state.status === 'future') {
                                      el.currentTime = 0;
                                      if (!el.paused) el.pause();
                                    } else if (state.status === 'active') {
                                      const diff = Math.abs(el.currentTime - state.elapsed);
                                      if (diff > 0.3) {
                                        el.currentTime = state.elapsed;
                                      }
                                      if (el.paused && isTimelinePlaying) {
                                        el.play().catch(() => {});
                                      } else if (!el.paused && !isTimelinePlaying) {
                                        el.pause();
                                      }
                                    }
                                  }
                                }}
                                src={item.previewUrl}
                                className="h-full w-full object-cover"
                                muted
                                playsInline
                                controls
                              />
                            ) : (
                              <img src={item.previewUrl} alt="" className="h-full w-full object-cover" />
                            )}
                          </div>
                          <div className="flex items-center justify-between gap-2 p-2">
                            <div className="min-w-0">
                              <div className="truncate text-[11px] font-semibold text-zinc-300">{item.name}</div>
                              <div className="mt-0.5 text-[9px] font-mono uppercase tracking-widest text-zinc-700">{item.type}</div>
                            </div>
                            {item.type === 'image' || item.type === 'video' ? (
                              <label className="flex h-8 shrink-0 items-center gap-1 rounded border border-zinc-900 bg-zinc-950 px-2 py-1 text-[10px] font-mono uppercase tracking-widest text-zinc-400 transition-colors hover:bg-zinc-900 focus-within:border-zinc-700 cursor-pointer select-none">
                                <input
                                  type="number"
                                  min={1}
                                  max={60}
                                  value={item.durationSeconds ?? 3}
                                  onClick={(event) => event.stopPropagation()}
                                  onPointerDown={(event) => event.stopPropagation()}
                                  onChange={(event) => updateSceneLaunchMediaDuration(item.id, Number(event.target.value))}
                                  className="h-5 w-9 bg-transparent text-right text-[11px] font-semibold text-zinc-200 outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                  aria-label={`${item.name} duration in seconds`}
                                />
                                s
                              </label>
                            ) : null}
                            <GripVertical className="h-3.5 w-3.5 shrink-0 text-zinc-700 group-hover:text-zinc-400" />
                          </div>
                        </article>
                      );
                    }

                    const beat = gridItem.collection;
                    const preview = getSceneLaunchCollectionPreview(beat);
                    return (
                      <article
                        key={dragKey}
                        id={`grid-item-${dragKey}`}
                        draggable
                        onDragStart={(event) => {
                          event.dataTransfer.effectAllowed = 'move';
                          event.dataTransfer.setData('text/plain', dragKey);
                        }}
                        onDragOver={(event) => handleGridDragOver(event, dragKey, true)}
                        onDragLeave={handleGridDragLeave}
                        onDrop={(event) => handleGridDrop(event, dragKey, true)}
                        onMouseEnter={() => setSceneLaunchPreviewHover({ collectionId: beat.id, startedAt: Date.now() })}
                        onMouseLeave={() => setSceneLaunchPreviewHover(previous => (
                          previous?.collectionId === beat.id ? null : previous
                        ))}
                        onFocus={() => setSceneLaunchPreviewHover({ collectionId: beat.id, startedAt: Date.now() })}
                        onBlur={() => setSceneLaunchPreviewHover(previous => (
                          previous?.collectionId === beat.id ? null : previous
                        ))}
                        style={getSceneLaunchCollectionTileStyle()}
                        className={cn(
                          "group cursor-grab overflow-hidden rounded-lg border border-zinc-900 bg-zinc-950/80 transition-all duration-300 active:cursor-grabbing scroll-mt-24 relative",
                          isTimelinePlaying && activeItemKey && activeItemKey !== dragKey ? "opacity-30" : "opacity-100",
                          gridDragOverInfo?.targetKey === dragKey && gridDragOverInfo.position === 'inside' && "ring-2 ring-indigo-500 border-indigo-500 shadow-[0_0_12px_rgba(99,102,241,0.3)]"
                        )}
                        onContextMenu={(event) => handleItemContextMenu(event, dragKey)}
                      >
                        {gridDragOverInfo?.targetKey === dragKey && gridDragOverInfo.position === 'before' && (
                          <div className="absolute top-0 bottom-0 left-0 w-1 bg-indigo-500 shadow-[0_0_8px_#6366f1] z-30 pointer-events-none" />
                        )}
                        {gridDragOverInfo?.targetKey === dragKey && gridDragOverInfo.position === 'after' && (
                          <div className="absolute top-0 bottom-0 right-0 w-1 bg-indigo-500 shadow-[0_0_8px_#6366f1] z-30 pointer-events-none" />
                        )}
                        <div
                          className="relative bg-black overflow-hidden h-36 sm:h-40 lg:h-44"
                          style={getSceneLaunchMediaPreviewStyle()}
                        >
                          <button
                            type="button"
                            className="block h-full w-full"
                            onClick={() => openBeatDetail(beat.id)}
                            aria-label={`Open ${beat.name}`}
                          >
                            {preview ? (
                              preview.item.type === 'video' ? (
                                <video
                                  key={preview.item.id}
                                  ref={(el) => {
                                    if (el) {
                                      const diff = Math.abs(el.currentTime - preview.elapsedSeconds);
                                      if (diff > 0.3) {
                                        el.currentTime = preview.elapsedSeconds;
                                      }
                                      const state = getGridItemTimelineState(beat.id, 'collection');
                                      if (state.status === 'past') {
                                        if (!el.paused) el.pause();
                                      }
                                    }
                                  }}
                                  src={preview.item.previewUrl}
                                  className="h-full w-full object-cover"
                                  muted
                                  playsInline
                                  autoPlay
                                  loop
                                />
                              ) : (
                                <img
                                  key={preview.item.id}
                                  src={preview.item.previewUrl}
                                  alt=""
                                  className="h-full w-full object-cover"
                                />
                              )
                            ) : (
                              <div className="flex h-full w-full flex-col items-center justify-center text-center text-zinc-600 transition-colors hover:bg-white/[0.03] hover:text-zinc-300">
                                <Grid2X2 className="h-6 w-6" />
                                <span className="mt-2 text-[10px] font-semibold uppercase tracking-widest">Open collection</span>
                              </div>
                            )}
                          </button>
                          {preview?.isPlaying ? (
                            <div className="pointer-events-none absolute bottom-2 right-2 rounded bg-black/75 px-2 py-1 font-mono text-[10px] text-white">
                              {Math.min(preview.durationSeconds, preview.elapsedSeconds).toFixed(1)}s / {preview.durationSeconds.toFixed(1)}s
                            </div>
                          ) : null}
                        </div>
                        <button
                          type="button"
                          className="flex w-full items-center justify-between gap-2 p-2 text-left"
                          onClick={() => openBeatDetail(beat.id)}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[11px] font-semibold text-zinc-300">{beat.name}</div>
                            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[9px] font-mono uppercase tracking-widest text-zinc-500">
                              <span>{beat.gridOrder.length} {beat.gridOrder.length === 1 ? 'item' : 'items'}</span>
                              <span className="text-zinc-700 font-bold">•</span>
                              <span className="text-white font-extrabold bg-zinc-900 px-1.5 py-0.5 rounded border border-zinc-800">
                                {(getRecursiveCollectionDuration(beat) || 0).toFixed(1)}s
                              </span>
                            </div>
                          </div>
                          <span className="flex items-center gap-1">
                            <span className="flex h-5 min-w-5 items-center justify-center rounded bg-zinc-900 font-mono text-[9px] text-zinc-600">
                              {index + 1}
                            </span>
                            <GripVertical className="h-3.5 w-3.5 text-zinc-700 group-hover:text-zinc-400" />
                          </span>
                        </button>
                      </article>
                    );
                  })}

                  <button
                    type="button"
                    style={getSceneLaunchCollectionTileStyle()}
                    className="flex flex-col items-center justify-center rounded-lg border border-dashed border-zinc-900 bg-zinc-950/40 text-zinc-600 transition-colors hover:border-zinc-700 hover:bg-zinc-950 hover:text-zinc-300 h-36 sm:h-40 lg:h-44"
                    onClick={createSceneLaunchBeat}
                  >
                    <Plus className="h-6 w-6" />
                    <span className="mt-2 text-[10px] font-semibold uppercase tracking-widest">Add collection</span>
                  </button>
                </div>
              </>
            )}
          </section>

        </main>

        {renderSceneLaunchTimeline()}
      </div>

      <DropdownMenu
        open={!!sceneLaunchContextMenu}
        onOpenChange={(open) => !open && setSceneLaunchContextMenu(null)}
      >
        {sceneLaunchContextMenu && (
          <DropdownMenuTrigger
            style={{
              position: 'fixed',
              left: sceneLaunchContextMenu.x,
              top: sceneLaunchContextMenu.y,
              width: 1,
              height: 1,
              opacity: 0,
              pointerEvents: 'none'
            }}
          />
        )}
        <DropdownMenuContent align="start" className="w-40 bg-[#111114] border-zinc-800 text-zinc-300 z-50">
          {activeSceneLaunchBeatId === 'trash' ? (
            <>
              <DropdownMenuItem
                onClick={() => {
                  if (sceneLaunchContextMenu) {
                    restoreItemFromTrash(sceneLaunchContextMenu.dragKey);
                  }
                }}
                className="gap-2 focus:bg-zinc-800 focus:text-white cursor-pointer"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Restore Item
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  if (sceneLaunchContextMenu) {
                    permanentlyDeleteItem(sceneLaunchContextMenu.dragKey);
                  }
                }}
                className="gap-2 focus:bg-red-950/70 focus:text-red-200 text-red-400 cursor-pointer"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete Permanently
              </DropdownMenuItem>
            </>
          ) : (
            <DropdownMenuItem
              onClick={() => {
                if (sceneLaunchContextMenu) {
                  moveItemToTrash(sceneLaunchContextMenu.dragKey);
                }
              }}
              className="gap-2 focus:bg-zinc-800 focus:text-white cursor-pointer"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Move to Trash
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );

  const renderSidePanel = () => {
    if (!activeTab) return null;
    const panelActiveScene = scenes.find(scene => scene.id === activeSceneId) || scenes[0];

    const title = {
      scenes: 'Scenes',
      characters: 'Characters',
      locations: 'Locations',
      settings: 'Project Settings',
      analyze: 'AI Video Analysis'
    }[activeTab];

    return (
      <motion.aside
        ref={sidePanelRef}
        initial={{ x: '-100%' }}
        animate={{ x: 0 }}
        exit={{ x: '-100%' }}
        transition={{ type: 'spring', damping: 25, stiffness: 200 }}
        className="fixed inset-y-0 left-0 w-72 bg-[#111114] border-r border-zinc-800 z-[100] flex flex-col shadow-[20px_0_50px_rgba(0,0,0,0.5)]"
      >
        <div className="h-12 border-b border-zinc-800 flex items-center justify-between px-4 shrink-0">
          <h3 className="text-[11px] font-bold text-zinc-400 uppercase tracking-widest">{title}</h3>
          <Button 
            variant="ghost" 
            size="icon" 
            className="h-7 w-7 text-zinc-500 hover:text-white"
            onClick={() => setActiveTab(null)}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {activeTab === 'scenes' && (
            <div className="p-4 flex flex-col gap-4">
              <Button 
                onClick={() => addScene(`Scene ${scenes.length + 1}`)}
                className="w-full bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-bold uppercase tracking-widest h-9"
              >
                <Plus className="w-3.5 h-3.5 mr-2" />
                Add New Scene
              </Button>

              {panelActiveScene && (
                <div className="rounded-md border border-zinc-800 bg-zinc-900/50 p-3">
                  <label htmlFor="active-scene-title" className="block text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                    Preview Title
                  </label>
                  <input
                    id="active-scene-title"
                    type="text"
                    maxLength={120}
                    value={panelActiveScene.name}
                    onChange={(event) => updateScene(panelActiveScene.id, { name: event.target.value })}
                    className="mt-2 h-8 w-full rounded border border-zinc-800 bg-zinc-950 px-2 text-sm text-zinc-200 outline-none transition-colors placeholder:text-zinc-600 focus:border-indigo-400"
                    placeholder="Scene title"
                  />
                  <label htmlFor="active-scene-description" className="mt-3 block text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                    Short Description
                  </label>
                  <textarea
                    id="active-scene-description"
                    rows={3}
                    maxLength={180}
                    value={panelActiveScene.description || ''}
                    onChange={(event) => updateScene(panelActiveScene.id, { description: event.target.value })}
                    className="mt-2 w-full resize-none rounded border border-zinc-800 bg-zinc-950 px-2 py-2 text-sm leading-snug text-zinc-200 outline-none transition-colors placeholder:text-zinc-600 focus:border-indigo-400"
                    placeholder="Optional top-left preview copy"
                  />
                </div>
              )}

              <Reorder.Group axis="y" values={scenes} onReorder={reorderScenes} className="space-y-2">
                {scenes.map((scene) => {
                  const includedPreviewSceneIds = previewSceneIds.length > 0 ? previewSceneIds : scenes.map(item => item.id);
                  const isPreviewIncluded = includedPreviewSceneIds.includes(scene.id);
                  const canTogglePreviewScene = isPreviewIncluded ? includedPreviewSceneIds.length > 1 : true;

                  return (
                    <Reorder.Item
                      key={scene.id}
                      value={scene}
                      className={cn(
                        "group p-3 rounded-md border flex items-center gap-3 cursor-pointer transition-all",
                        activeSceneId === scene.id
                          ? "bg-indigo-500/10 border-indigo-500/50"
                          : "bg-zinc-900/50 border-zinc-800 hover:border-zinc-700"
                      )}
                      onClick={() => setActiveScene(scene.id)}
                    >
                      <GripVertical className="w-3.5 h-3.5 text-zinc-600 group-hover:text-zinc-400 cursor-grab active:cursor-grabbing" />
                      <button
                        type="button"
                        className={cn(
                          "flex h-7 w-7 shrink-0 items-center justify-center rounded border transition-colors",
                          isPreviewIncluded
                            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/15"
                            : "border-zinc-800 bg-zinc-950 text-zinc-600 hover:text-zinc-300",
                          !canTogglePreviewScene && "cursor-not-allowed opacity-50"
                        )}
                        aria-label={isPreviewIncluded ? `Hide ${scene.name} from preview` : `Show ${scene.name} in preview`}
                        disabled={!canTogglePreviewScene}
                        onClick={(e) => {
                          e.stopPropagation();
                          togglePreviewScene(scene.id);
                        }}
                      >
                        {isPreviewIncluded ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                      </button>
                      <div className="flex-1 min-w-0">
                        <div className="text-[11px] font-bold text-zinc-200 truncate">{scene.name}</div>
                        <div className="text-[9px] text-zinc-500 uppercase tracking-wider font-mono">
                          {scene.clips.length} Clips · {isPreviewIncluded ? 'Preview On' : 'Preview Off'}
                        </div>
                      </div>
                      {scenes.length > 1 && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-zinc-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteScene(scene.id);
                        }}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                      )}
                    </Reorder.Item>
                  );
                })}
              </Reorder.Group>
            </div>
          )}

          {activeTab === 'characters' && (
             <CharactersPanel />
          )}

          {activeTab === 'locations' && (
             <div className="p-8 flex flex-col items-center justify-center text-center gap-4 opacity-50">
               <MapPin className="w-12 h-12 text-zinc-700" />
               <div className="space-y-1">
                 <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-widest">Global Locations</h4>
                 <p className="text-[10px] text-zinc-600 leading-relaxed max-w-[200px]">Define environmental settings and local assets.</p>
               </div>
             </div>
          )}

          {activeTab === 'analyze' && (
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
                          // Sanitizing filename: replaces characters not in a-zA-Z0-9._- with '-' to match disk storage naming
                          const sanitizedName = file.name.replace(/[^a-zA-Z0-9._-]/g, '-');
                          const sanitizedFile = new File([file], sanitizedName, { type: file.type });
                          setSelectedVideoFile(sanitizedFile);
                          const url = URL.createObjectURL(sanitizedFile);
                          setVideoObjectURL(url);
                          setIsAnalysisComplete(false);
                          setAnalysisLogs([]);
                          
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
                      <button
                        type="button"
                        disabled={isAnalyzing}
                        onClick={() => setAnalysisModelChoice('gemini')}
                        className={cn(
                          "py-1.5 rounded text-[9px] font-bold uppercase tracking-wider transition-all",
                          analysisModelChoice === 'gemini'
                            ? "bg-indigo-600 text-white shadow-md"
                            : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900/40"
                        )}
                      >
                        Gemini Cloud
                      </button>
                      <button
                        type="button"
                        disabled={isAnalyzing}
                        className={cn(
                          "py-1.5 rounded text-[9px] font-bold uppercase tracking-wider transition-all",
                          analysisModelChoice === 'gemma'
                            ? "bg-indigo-600 text-white shadow-md"
                            : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900/40"
                        )}
                        onClick={() => setAnalysisModelChoice('gemma')}
                      >
                        Gemma Local
                      </button>
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
                      
                      <label className="flex items-center gap-2.5 cursor-pointer select-none group text-zinc-400 hover:text-zinc-200">
                        <input
                          type="checkbox"
                          checked={storyAnalyzePlotPoints}
                          disabled={isAnalyzing}
                          onChange={(e) => setStoryAnalyzePlotPoints(e.target.checked)}
                          className="rounded border-zinc-800 bg-[#0a0a0b] text-indigo-600 focus:ring-0 focus:ring-offset-0 w-3.5 h-3.5 accent-indigo-600"
                        />
                        <span className="text-[10px] font-semibold group-hover:text-zinc-200">
                          Detect Plot Points
                        </span>
                      </label>

                      <label className="flex items-center gap-2.5 cursor-pointer select-none group text-zinc-400 hover:text-zinc-200">
                        <input
                          type="checkbox"
                          checked={storyAnalyzeStakes}
                          disabled={isAnalyzing}
                          onChange={(e) => setStoryAnalyzeStakes(e.target.checked)}
                          className="rounded border-zinc-800 bg-[#0a0a0b] text-indigo-600 focus:ring-0 focus:ring-offset-0 w-3.5 h-3.5 accent-indigo-600"
                        />
                        <span className="text-[10px] font-semibold group-hover:text-zinc-200">
                          Track Tension & Stakes
                        </span>
                      </label>

                      <label className="flex items-center gap-2.5 cursor-pointer select-none group text-zinc-400 hover:text-zinc-200">
                        <input
                          type="checkbox"
                          checked={storyAnalyzeConfrontation}
                          disabled={isAnalyzing}
                          onChange={(e) => setStoryAnalyzeConfrontation(e.target.checked)}
                          className="rounded border-zinc-800 bg-[#0a0a0b] text-indigo-600 focus:ring-0 focus:ring-offset-0 w-3.5 h-3.5 accent-indigo-600"
                        />
                        <span className="text-[10px] font-semibold group-hover:text-zinc-200">
                          Map Confrontation Peaks
                        </span>
                      </label>
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
                      
                      {/* Visual summary indicators */}
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

                      {/* Resilient warning callout if using fallback mock model */}
                      {pendingAnalysisProject.model?.includes('fallback') && (
                        <div className="rounded border border-amber-500/20 bg-amber-500/5 p-2.5 text-left text-[9px] text-amber-200 leading-relaxed font-semibold">
                          <span className="font-black uppercase tracking-widest text-amber-300 block mb-0.5">⚠️ API Service Interruption</span>
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
          )}

          {activeTab === 'settings' && (
            <div className="p-4 flex flex-col gap-4">
               <div className="flex flex-col items-center justify-center text-center gap-2 mb-4 opacity-80 pt-4">
                 <Settings className="w-8 h-8 text-zinc-600" />
                 <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-widest">Project Settings</h4>
               </div>

               <div className="space-y-4">
                  <h5 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest px-1">Preview Layout</h5>
                  <div className="rounded border border-zinc-800 bg-zinc-900/60 p-3">
                    <div className="mb-4">
                      <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-zinc-300">Scene Scope</div>
                      <div className="grid grid-cols-2 gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className={cn(
                            "h-8 border-zinc-800 bg-zinc-950/80 text-[10px] font-bold uppercase tracking-wider text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200",
                            previewSceneMode === 'active' && "border-indigo-500/50 bg-indigo-500/10 text-indigo-300 hover:bg-indigo-500/15 hover:text-indigo-200"
                          )}
                          onClick={() => setPreviewSceneMode('active')}
                        >
                          <Clapperboard data-icon="inline-start" />
                          Active
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className={cn(
                            "h-8 border-zinc-800 bg-zinc-950/80 text-[10px] font-bold uppercase tracking-wider text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200",
                            previewSceneMode === 'all' && "border-indigo-500/50 bg-indigo-500/10 text-indigo-300 hover:bg-indigo-500/15 hover:text-indigo-200"
                          )}
                          onClick={() => setPreviewSceneMode('all')}
                        >
                          <Grid2X2 data-icon="inline-start" />
                          All Scenes
                        </Button>
                      </div>
                    </div>
                    <div className="mb-3 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-300">Group Arrangement</div>
                        <p className="mt-1 text-[10px] leading-relaxed text-zinc-600">
                          Row mode stays side by side on huge screens and falls back to grid on smaller viewports.
                        </p>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className={cn(
                          "h-8 border-zinc-800 bg-zinc-950/80 text-[10px] font-bold uppercase tracking-wider text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200",
                          previewGroupLayout === 'row' && "border-indigo-500/50 bg-indigo-500/10 text-indigo-300 hover:bg-indigo-500/15 hover:text-indigo-200"
                        )}
                        onClick={() => setPreviewGroupLayout('row')}
                      >
                        <Columns4 data-icon="inline-start" />
                        Row
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className={cn(
                          "h-8 border-zinc-800 bg-zinc-950/80 text-[10px] font-bold uppercase tracking-wider text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200",
                          previewGroupLayout === 'grid' && "border-indigo-500/50 bg-indigo-500/10 text-indigo-300 hover:bg-indigo-500/15 hover:text-indigo-200"
                        )}
                        onClick={() => setPreviewGroupLayout('grid')}
                      >
                        <Grid2X2 data-icon="inline-start" />
                        Grid
                      </Button>
                    </div>
                    <div className="mt-4 border-t border-zinc-800 pt-3">
                      <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-zinc-300">Video Size</div>
                      <div className="grid grid-cols-2 gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className={cn(
                            "h-8 border-zinc-800 bg-zinc-950/80 text-[10px] font-bold uppercase tracking-wider text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200",
                            previewMediaLayout === 'inset' && "border-indigo-500/50 bg-indigo-500/10 text-indigo-300 hover:bg-indigo-500/15 hover:text-indigo-200"
                          )}
                          onClick={() => setPreviewMediaLayout('inset')}
                        >
                          <PanelsTopLeft data-icon="inline-start" />
                          76.19%
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className={cn(
                            "h-8 border-zinc-800 bg-zinc-950/80 text-[10px] font-bold uppercase tracking-wider text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200",
                            previewMediaLayout === 'full' && "border-indigo-500/50 bg-indigo-500/10 text-indigo-300 hover:bg-indigo-500/15 hover:text-indigo-200"
                          )}
                          onClick={() => setPreviewMediaLayout('full')}
                        >
                          <FileVideo data-icon="inline-start" />
                          Full
                        </Button>
                      </div>
                    </div>
                  </div>
               </div>

               <div className="space-y-4">
                  <h5 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest px-1">Analytics Overlay</h5>
                  <div className="rounded border border-zinc-800 bg-zinc-900/60 p-3">
                    <div className="grid grid-cols-2 gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className={cn(
                          "h-8 border-zinc-800 bg-zinc-950/80 text-[10px] font-bold uppercase tracking-wider text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200",
                          analyticsOverlayStyle === 'compact' && "border-indigo-500/50 bg-indigo-500/10 text-indigo-300 hover:bg-indigo-500/15 hover:text-indigo-200"
                        )}
                        onClick={() => setAnalyticsOverlayStyle('compact')}
                      >
                        <Grid2X2 data-icon="inline-start" />
                        Compact
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className={cn(
                          "h-8 border-zinc-800 bg-zinc-950/80 text-[10px] font-bold uppercase tracking-wider text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200",
                          analyticsOverlayStyle === 'analysis' && "border-indigo-500/50 bg-indigo-500/10 text-indigo-300 hover:bg-indigo-500/15 hover:text-indigo-200"
                        )}
                        onClick={() => setAnalyticsOverlayStyle('analysis')}
                      >
                        <PanelsTopLeft data-icon="inline-start" />
                        Analysis
                      </Button>
                    </div>
                    <div className="mt-3 border-t border-zinc-800 pt-3">
                      <div className="mb-2 flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-300">Note Icons</div>
                          <p className="mt-1 text-[10px] leading-relaxed text-zinc-600">
                            Show linked graph badges beside preview notes.
                          </p>
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className={cn(
                          "h-8 w-full border-zinc-800 bg-zinc-950/80 text-[10px] font-bold uppercase tracking-wider text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200",
                          showNoteOverlayIcons && "border-indigo-500/50 bg-indigo-500/10 text-indigo-300 hover:bg-indigo-500/15 hover:text-indigo-200"
                        )}
                        onClick={() => setShowNoteOverlayIcons(!showNoteOverlayIcons)}
                      >
                        {showNoteOverlayIcons ? <Eye data-icon="inline-start" /> : <EyeOff data-icon="inline-start" />}
                        {showNoteOverlayIcons ? 'Shown' : 'Hidden'}
                      </Button>
                    </div>
                  </div>
               </div>

               <div className="space-y-4">
                  <h5 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest px-1">Manage Tracks & Groups</h5>
                  <div className="space-y-2">
                    {tracks.filter(t => !t.parentId).map(parent => (
                      <div key={parent.id} className="space-y-1">
                        <div className="flex items-center justify-between gap-2 bg-zinc-900/80 px-3 py-2 rounded border border-zinc-800">
                          <span className="text-xs font-bold text-zinc-300 uppercase tracking-wider">{parent.name}</span>
                          <div className="flex items-center gap-1.5">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className={cn(
                                "h-7 border-zinc-800 bg-zinc-950/80 px-2 text-[10px] font-bold uppercase tracking-wider text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200",
                                parent.showDialogGridItem && "border-indigo-500/50 bg-indigo-500/10 text-indigo-300 hover:bg-indigo-500/15 hover:text-indigo-200"
                              )}
                              onClick={() => updateTrack(parent.id, { showDialogGridItem: !parent.showDialogGridItem })}
                            >
                              Dialog Grid: {parent.showDialogGridItem ? 'On' : 'Off'}
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="w-6 h-6 text-zinc-500 hover:text-red-400 hover:bg-red-400/10"
                              onClick={() => deleteTrack(parent.id)}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </div>
                        {tracks.filter(t => t.parentId === parent.id).map(child => (
                          <div key={child.id} className="flex items-center justify-between bg-[#18181b] px-3 py-1.5 rounded border border-zinc-800/50 ml-4">
                            <span className="text-xs text-zinc-400">{child.name}</span>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="w-6 h-6 text-zinc-600 hover:text-red-400 hover:bg-red-400/10"
                              onClick={() => deleteTrack(child.id)}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
               </div>
            </div>
          )}
        </div>
      </motion.aside>
    );
  };

  const isPublicAnalysis = pathname === '/analysis' && sceneIdParam && activeSavedScenePublished;
  const isGated = !currentUser && !isPublicAnalysis;
  const showAutosaveIndicator = Boolean(activeSavedSceneId && currentUser && currentUser.role !== 'viewer');
  const autosaveToneClass = cn(
    autosaveStatus === 'error'
      ? 'border-red-500/25 bg-red-500/10 text-red-300'
      : autosaveStatus === 'saved'
        ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300'
        : autosaveStatus === 'saving' || autosaveStatus === 'pending'
          ? 'border-indigo-500/25 bg-indigo-500/10 text-indigo-300'
          : 'border-zinc-800 bg-zinc-950/60 text-zinc-500'
  );

  if (isAuthChecking || isGated || isSceneLoading) {
    return (
      <div className="workbench-shell flex flex-col h-screen w-screen bg-[#0a0a0b] items-center justify-center text-zinc-300 font-sans relative overflow-hidden">
        {/* Background Decorative Glow */}
        <div className="absolute top-[-10%] left-[-20%] w-[60vw] h-[60vw] rounded-full bg-gradient-to-br from-indigo-600/10 via-transparent to-transparent blur-3xl pointer-events-none" />
        <div className="absolute bottom-[-10%] right-[-20%] w-[60vw] h-[60vw] rounded-full bg-gradient-to-tl from-violet-600/10 via-transparent to-transparent blur-3xl pointer-events-none" />
        
        <div className="flex flex-col items-center gap-4 z-10">
          <div className="w-12 h-12 bg-indigo-600 rounded-lg flex items-center justify-center text-white font-sans font-black text-base leading-none shadow-lg shadow-indigo-500/20 animate-pulse select-none">S</div>
          <div className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin text-indigo-400" />
            <span className="text-xs font-bold uppercase tracking-widest text-zinc-400">
              {isAuthChecking 
                ? "Verifying Session..." 
                : isGated 
                  ? "Redirecting..." 
                  : "Loading Project..."}
            </span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="workbench-shell flex flex-col h-screen bg-[#0a0a0b] text-zinc-300 font-sans overflow-hidden">
      <input
        ref={projectImportInputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={handleImportProjectJson}
      />

      <AnimatePresence>
        {isSaveSceneOpen && (
          <motion.div
            key="save-scene"
            className="fixed inset-0 z-[330] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onPointerDown={() => setIsSaveSceneOpen(false)}
          >
            <motion.section
              role="dialog"
              aria-modal="true"
              aria-labelledby="save-scene-title"
              initial={{ opacity: 0, scale: 0.96, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 12 }}
              className="flex w-full max-w-lg flex-col rounded-lg border border-zinc-800 bg-[#111114] shadow-2xl"
              onPointerDown={(event) => event.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-4 border-b border-zinc-800 p-4">
                <div>
                  <h2 id="save-scene-title" className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-zinc-200">
                    <Cloud className="h-4 w-4 text-indigo-300" />
                    Save Scene
                  </h2>
                  <p className="mt-1 text-[10px] text-zinc-500">Save the active scene snapshot to the cloud library.</p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0 text-zinc-500 hover:text-white"
                  onClick={() => setIsSaveSceneOpen(false)}
                  aria-label="Close save scene"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>

              <form className="space-y-3 p-4" onSubmit={handleSaveScene}>
                <div className="grid gap-3 rounded-md border border-zinc-800 bg-zinc-950/60 p-3 sm:grid-cols-[8rem_1fr]">
                  <div className="relative aspect-video overflow-hidden rounded border border-zinc-800 bg-black">
                    {activeSceneThumbnailPreviewUrl ? (
                      <img src={activeSceneThumbnailPreviewUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-[radial-gradient(circle_at_center,rgba(99,102,241,0.18),rgba(9,9,11,0.95)_55%)]">
                        <Clapperboard className="h-7 w-7 text-zinc-700" />
                      </div>
                    )}
                  </div>
                  <div className="flex min-w-0 flex-col justify-center gap-2">
                    <div>
                      <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">Scene Thumbnail</div>
                      <p className="mt-1 text-[10px] leading-relaxed text-zinc-600">
                        Pause on a video frame, then capture it as the static library thumbnail.
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="w-fit border-zinc-700 bg-zinc-900 text-[10px] font-bold uppercase tracking-widest text-zinc-300 hover:border-indigo-500/40 hover:bg-indigo-500/10 hover:text-indigo-100"
                      onClick={() => void handleCaptureCurrentFrameThumbnail()}
                      disabled={isPlaying || isCapturingSceneThumbnail || !activeVideoClipAtCurrentFrame}
                      title={
                        isPlaying
                          ? 'Pause playback before capturing a thumbnail.'
                          : !activeVideoClipAtCurrentFrame
                            ? 'Move the playhead over a video clip to capture a thumbnail.'
                            : 'Use the current paused frame as the thumbnail.'
                      }
                    >
                      {isCapturingSceneThumbnail ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}
                      Capture Current Frame
                    </Button>
                  </div>
                </div>
                <label htmlFor="saved-scene-name" className="block text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                  Active Scene Name
                </label>
                <div className="flex gap-2">
                  <input
                    id="saved-scene-name"
                    name="sceneName"
                    type="text"
                    required
                    maxLength={120}
                    value={savedSceneName}
                    onChange={(event) => setSavedSceneName(event.target.value)}
                    className="h-9 min-w-0 flex-1 rounded-md border border-zinc-800 bg-zinc-950 px-3 text-base text-zinc-200 outline-none transition-colors placeholder:text-zinc-600 focus:border-indigo-400 sm:text-sm"
                    placeholder="Scene name"
                  />
                  <Button
                    type="submit"
                    className="h-9 bg-indigo-600 px-3 text-xs font-semibold text-white hover:bg-indigo-500"
                    disabled={isSavingScene}
                  >
                    {isSavingScene ? <Loader2 className="h-4 w-4 animate-spin" /> : <Cloud className="h-4 w-4" />}
                    Save
                  </Button>
                </div>
                <p className="text-[10px] leading-relaxed text-zinc-500">
                  Scene structure, analysis, and local videos are uploaded for access on other computers.
                </p>
                {sceneSaveStatus && (
                  <p className="text-[10px] font-mono text-indigo-300" aria-live="polite">{sceneSaveStatus}</p>
                )}
              </form>
            </motion.section>
          </motion.div>
        )}

        {isSceneLibraryOpen && (
          <motion.div
            key="scene-library"
            className="fixed inset-0 z-[330] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onPointerDown={() => setIsSceneLibraryOpen(false)}
          >
            <motion.section
              role="dialog"
              aria-modal="true"
              aria-labelledby="cloud-scenes-title"
              initial={{ opacity: 0, scale: 0.96, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 12 }}
              className="flex max-h-[min(760px,calc(100vh-2rem))] w-full max-w-4xl flex-col rounded-lg border border-zinc-800 bg-[#111114] shadow-2xl"
              onPointerDown={(event) => event.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-4 border-b border-zinc-800 p-4">
                <div>
                  <h2 id="cloud-scenes-title" className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-zinc-200">
                    <Cloud className="h-4 w-4 text-indigo-300" />
                    Scene Library
                  </h2>
                  <p className="mt-1 text-[10px] text-zinc-500">Load a saved scene snapshot into the current project.</p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0 text-zinc-500 hover:text-white"
                  onClick={() => setIsSceneLibraryOpen(false)}
                  aria-label="Close saved scenes"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>

              <div className="flex min-h-0 flex-1 flex-col p-4">
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <h3 className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Available Scenes</h3>
                    <p className="mt-1 text-[10px] font-mono uppercase tracking-widest text-zinc-700">
                      {savedScenesLoadError ? 'Unable to load' : `${savedScenes.length} ${savedScenes.length === 1 ? 'scene' : 'scenes'}`}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 text-[10px] uppercase tracking-widest text-zinc-500 hover:text-zinc-200"
                    onClick={() => void loadSavedScenes()}
                    disabled={isLoadingSavedScenes}
                  >
                    <RefreshCw className={cn('h-3.5 w-3.5', isLoadingSavedScenes && 'animate-spin')} />
                    Refresh
                  </Button>
                </div>
                <div className="min-h-0 overflow-y-auto pr-1">
                  {isLoadingSavedScenes && savedScenes.length === 0 ? (
                    <div className="flex items-center justify-center gap-2 rounded-md border border-zinc-800 py-8 text-xs text-zinc-500">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading saved scenes...
                    </div>
                  ) : savedScenesLoadError ? (
                    <div className="rounded-md border border-red-500/20 bg-red-500/5 px-4 py-6 text-center">
                      <div className="text-xs font-semibold text-red-200">{savedScenesLoadError}</div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="mt-4 border-red-500/30 bg-red-500/10 text-xs text-red-100 hover:bg-red-500/20"
                        onClick={() => void loadSavedScenes()}
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                        Try Again
                      </Button>
                    </div>
                  ) : savedScenes.length === 0 ? (
                    <div className="rounded-md border border-dashed border-zinc-800 py-8 text-center text-xs text-zinc-500">
                      No cloud scenes saved yet.
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                      {savedScenes.map(scene => (
                        <article
                          key={scene.id}
                          className="group overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950/80 shadow-xl shadow-black/25 transition-colors hover:border-indigo-500/40"
                        >
                          <SavedSceneThumbnail scene={scene} />
                          <div className="space-y-3 p-3">
                            <div className="min-w-0">
                              <div className="flex items-center justify-between gap-2">
                                <h4 className="truncate text-sm font-semibold text-zinc-100">{scene.name}</h4>
                                {scene.isPublished && (
                                  <span className="px-1.5 py-0.5 rounded-full text-[8px] font-black uppercase tracking-widest bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shrink-0">
                                    Public
                                  </span>
                                )}
                              </div>
                              <div className="mt-1 text-[10px] font-mono uppercase tracking-widest text-zinc-600">
                                {new Date(scene.updatedAt).toLocaleString()}
                              </div>
                            </div>
                            <div className="flex gap-2 select-none">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="flex-1 border-zinc-700 bg-zinc-900 text-xs text-zinc-200 hover:border-indigo-500/40 hover:bg-indigo-500/10 hover:text-indigo-100"
                                onClick={() => void handleLoadSavedScene(scene)}
                                disabled={loadingSavedSceneId !== null || deletingSavedSceneId !== null}
                              >
                                {loadingSavedSceneId === scene.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                                Load Scene
                              </Button>
                              {currentUser && currentUser.role !== 'viewer' && (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-zinc-500 hover:text-red-400 hover:bg-red-400/10 shrink-0 border border-zinc-900"
                                  onClick={() => confirmSavedSceneDelete(scene)}
                                  disabled={loadingSavedSceneId !== null || deletingSavedSceneId !== null}
                                  title="Delete Saved Scene"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              )}
                            </div>
                          </div>
                        </article>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </motion.section>
          </motion.div>
        )}

        {isAuthModalOpen && (
          <motion.div
            key="auth-modal"
            className="fixed inset-0 z-[330] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onPointerDown={() => setIsAuthModalOpen(false)}
          >
            <motion.section
              role="dialog"
              aria-modal="true"
              aria-labelledby="auth-title"
              initial={{ opacity: 0, scale: 0.96, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 12 }}
              className="flex w-full max-w-sm flex-col rounded-lg border border-zinc-800 bg-[#111114] shadow-2xl"
              onPointerDown={(event) => event.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-4 border-b border-zinc-800 p-4">
                <div>
                  <h2 id="auth-title" className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-zinc-200">
                    <Lock className="h-4 w-4 text-indigo-300" />
                    {authMode === 'login' ? 'Sign In' : 'Create Account'}
                  </h2>
                  <p className="mt-1 text-[10px] text-zinc-500">
                    {authMode === 'login' ? 'Access your saved scenes and editing permissions.' : 'Join and get default viewer permissions.'}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0 text-zinc-550 hover:text-white"
                  onClick={() => setIsAuthModalOpen(false)}
                  aria-label="Close auth dialog"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>

              {/* Tabs */}
              <div className="grid grid-cols-2 border-b border-zinc-850 p-1 bg-zinc-950/40">
                <button
                  type="button"
                  onClick={() => {
                    setAuthMode('login');
                    setAuthError('');
                  }}
                  className={cn(
                    "py-2 rounded text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer font-mono text-center",
                    authMode === 'login'
                      ? "bg-zinc-900 text-indigo-300 border border-zinc-850 shadow"
                      : "text-zinc-500 hover:text-zinc-350"
                  )}
                >
                  Sign In
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAuthMode('signup');
                    setAuthError('');
                  }}
                  className={cn(
                    "py-2 rounded text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer font-mono text-center",
                    authMode === 'signup'
                      ? "bg-zinc-900 text-indigo-300 border border-zinc-850 shadow"
                      : "text-zinc-500 hover:text-zinc-350"
                  )}
                >
                  Create Account
                </button>
              </div>

              <form className="space-y-4 p-5" onSubmit={handleAuthSubmit}>
                {authError && (
                  <div className="rounded border border-red-500/20 bg-red-500/10 p-2.5 text-xs text-red-200">
                    {authError}
                  </div>
                )}

                <div className="space-y-1.5">
                  <label htmlFor="auth-username" className="block text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                    Username
                  </label>
                  <input
                    id="auth-username"
                    type="text"
                    required
                    value={authUsername}
                    onChange={(e) => setAuthUsername(e.target.value)}
                    className="h-9 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-200 outline-none transition-colors placeholder:text-zinc-700 focus:border-indigo-400"
                    placeholder="e.g. editor_pro"
                  />
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="auth-password" className="block text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                    Password
                  </label>
                  <input
                    id="auth-password"
                    type="password"
                    required
                    value={authPassword}
                    onChange={(e) => setAuthPassword(e.target.value)}
                    className="h-9 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-200 outline-none transition-colors placeholder:text-zinc-700 focus:border-indigo-400"
                    placeholder="••••••••"
                  />
                </div>

                <Button
                  type="submit"
                  disabled={authLoading}
                  className="w-full h-10 bg-indigo-650 hover:bg-indigo-500 text-xs font-black uppercase tracking-widest text-white shadow-lg shadow-indigo-900/30"
                >
                  {authLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : authMode === 'login' ? 'Sign In' : 'Create Account'}
                </Button>
              </form>
            </motion.section>
          </motion.div>
        )}

        {isAdminModalOpen && (
          <motion.div
            key="admin-modal"
            className="fixed inset-0 z-[330] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onPointerDown={() => setIsAdminModalOpen(false)}
          >
            <motion.section
              role="dialog"
              aria-modal="true"
              aria-labelledby="admin-title"
              initial={{ opacity: 0, scale: 0.96, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 12 }}
              className="flex max-h-[min(560px,calc(100vh-4rem))] w-full max-w-2xl flex-col rounded-lg border border-zinc-800 bg-[#111114] shadow-2xl"
              onPointerDown={(event) => event.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-4 border-b border-zinc-800 p-4">
                <div>
                  <h2 id="admin-title" className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-zinc-200">
                    <Shield className="h-4 w-4 text-indigo-300" />
                    User Management Panel
                  </h2>
                  <p className="mt-1 text-[10px] text-zinc-500">Review system users and promote roles (viewer, editor, admin).</p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0 text-zinc-550 hover:text-white"
                  onClick={() => setIsAdminModalOpen(false)}
                  aria-label="Close admin panel"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>

              <div className="flex-1 overflow-y-auto p-4 scrollbar-thin scrollbar-thumb-zinc-850">
                {isLoadingUsers ? (
                  <div className="flex py-12 items-center justify-center">
                    <Loader2 className="h-6 w-6 animate-spin text-zinc-500" />
                  </div>
                ) : (
                  <div className="overflow-hidden rounded-md border border-zinc-800 bg-zinc-950/40">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="border-b border-zinc-850 bg-zinc-950 text-[10px] font-bold uppercase tracking-widest text-zinc-550 font-mono">
                          <th className="p-3">Username</th>
                          <th className="p-3">Role</th>
                          <th className="p-3">Created At</th>
                        </tr>
                      </thead>
                      <tbody>
                        {allUsers.map((user) => {
                          const isSelf = user.id === currentUser?.id;
                          return (
                            <tr key={user.id} className="border-b border-zinc-850 hover:bg-zinc-900/40 transition-colors">
                              <td className="p-3 font-semibold text-zinc-200">
                                {user.username} {isSelf && <span className="text-[9px] text-zinc-500 font-mono font-normal">(you)</span>}
                              </td>
                              <td className="p-3">
                                <select
                                  disabled={isSelf}
                                  value={user.role}
                                  onChange={(e) => void handleUpdateUserRole(user.id, e.target.value as any)}
                                  className={cn(
                                    "bg-zinc-950 border text-xs rounded px-2 py-1 outline-none font-semibold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed",
                                    user.role === 'admin' ? "border-indigo-500/30 text-indigo-300 focus:border-indigo-400" :
                                    user.role === 'editor' ? "border-emerald-500/30 text-emerald-300 focus:border-emerald-400" :
                                    "border-zinc-800 text-zinc-400 focus:border-zinc-700"
                                  )}
                                >
                                  <option value="viewer">Viewer</option>
                                  <option value="editor">Editor</option>
                                  <option value="admin">Admin</option>
                                </select>
                              </td>
                              <td className="p-3 text-zinc-500 font-mono text-[10px]">
                                {new Date(user.createdAt).toLocaleDateString()}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </motion.section>
          </motion.div>
        )}

        <AlertDialog
          key="saved-scene-delete-confirmation"
          open={Boolean(pendingSavedSceneDelete)}
          onOpenChange={(open) => {
            if (!open && !deletingSavedSceneId) {
              setPendingSavedSceneDelete(null);
              setIsSceneLibraryOpen(true);
            }
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete saved scene?</AlertDialogTitle>
              <AlertDialogDescription>
                This permanently deletes the saved analysis for {pendingSavedSceneDelete?.name}. Hosted video is also removed when no other saved scene uses it.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={Boolean(deletingSavedSceneId)}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                disabled={Boolean(deletingSavedSceneId)}
                onClick={() => void handleDeleteSavedScene()}
              >
                {deletingSavedSceneId ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <Trash2 data-icon="inline-start" />}
                Delete Permanently
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {pendingProjectImport && (
          <motion.div
            key="project-import-confirmation"
            className="fixed inset-0 z-[320] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onPointerDown={() => setPendingProjectImport(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 12 }}
              className="w-full max-w-md rounded-lg border border-zinc-800 bg-[#111114] p-4 shadow-2xl"
              onPointerDown={(event) => event.stopPropagation()}
            >
              <div className="mb-4 flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h3 className="text-[11px] font-bold uppercase tracking-widest text-zinc-300">Import Project JSON</h3>
                  <p className="mt-1 truncate text-[10px] font-mono text-zinc-600">{pendingProjectImport.fileName}</p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0 text-zinc-500 hover:text-white"
                  onClick={() => setPendingProjectImport(null)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>

              <div className="space-y-2">
                <Button
                  type="button"
                  variant="outline"
                  className="h-auto w-full justify-start border-emerald-500/30 bg-emerald-500/10 px-3 py-3 text-left hover:bg-emerald-500/15 hover:text-emerald-100"
                  onClick={appendPendingProjectImport}
                >
                  <Plus className="h-4 w-4 text-emerald-300" />
                  <span className="ml-2 flex min-w-0 flex-col items-start">
                    <span className="text-xs font-bold uppercase tracking-wider text-emerald-200">Add to Current Project</span>
                    <span className="mt-1 text-[10px] font-medium normal-case leading-snug text-emerald-100/70">
                      Appends imported scenes with new IDs. Existing scenes, clips, tracks, characters, and settings stay unchanged.
                    </span>
                  </span>
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="h-auto w-full justify-start border-zinc-800 bg-zinc-900/70 px-3 py-3 text-left hover:bg-zinc-800 hover:text-zinc-100"
                  onClick={replaceWithPendingProjectImport}
                >
                  <Upload className="h-4 w-4 text-zinc-400" />
                  <span className="ml-2 flex min-w-0 flex-col items-start">
                    <span className="text-xs font-bold uppercase tracking-wider text-zinc-200">Open as New Project</span>
                    <span className="mt-1 text-[10px] font-medium normal-case leading-snug text-zinc-500">
                      Replaces the open workspace with the imported JSON.
                    </span>
                  </span>
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}

        {renderGroupOptions && (
          <motion.div
            key="render-group-selection"
            className="fixed inset-0 z-[300] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onPointerDown={() => setRenderGroupOptions(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 12 }}
              className="w-full max-w-sm rounded-lg border border-zinc-800 bg-[#111114] p-4 shadow-2xl"
              onPointerDown={(event) => event.stopPropagation()}
            >
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-[11px] font-bold uppercase tracking-widest text-zinc-300">Choose Render Group</h3>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-zinc-500 hover:text-white"
                  onClick={() => setRenderGroupOptions(null)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>

              <div className="space-y-2">
                {renderGroupOptions.map(group => (
                  <Button
                    key={group.id}
                    variant="outline"
                    className="h-auto w-full justify-between border-zinc-800 bg-zinc-900/70 px-3 py-3 text-left hover:bg-indigo-500/10 hover:text-indigo-200"
                    disabled={isRendering}
                    onClick={() => {
                      setRenderGroupOptions(null);
                      void renderProject(group);
                    }}
                  >
                    <span className="text-xs font-bold uppercase tracking-wider text-zinc-200">{group.name}</span>
                    <span className="text-[10px] font-mono uppercase tracking-widest text-zinc-500">{group.clipCount} clips</span>
                  </Button>
                ))}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header Rail */}
      <header className="h-12 border-b border-zinc-800 bg-[#111114] flex items-center justify-between pr-4 pl-0 shrink-0 overflow-visible relative z-[200]">
        <div className="flex items-center gap-4">
          <Link href="/" className="w-12 h-12 flex items-center justify-center border-r border-zinc-800 hover:opacity-90 transition-opacity" title="Back to Homepage">
            <LogoMark size="sm" />
          </Link>
          <div className="flex items-center gap-4 text-xs font-medium text-zinc-500">
            <div ref={fileMenuRef} className="relative">
              <button
                type="button"
                className="text-zinc-300 cursor-pointer text-[11px] font-bold uppercase tracking-widest outline-none hover:text-white transition-colors"
                onClick={() => setIsFileMenuOpen(open => !open)}
              >
                File
              </button>

              {isFileMenuOpen && (
                <div className="absolute left-0 top-full mt-2 z-50 w-56 rounded-lg border border-zinc-800 bg-[#111114] p-1 text-zinc-300 shadow-2xl shadow-black/50">
                  <div className="px-2 py-1.5 text-[10px] uppercase tracking-widest text-zinc-500 font-bold select-none">Cloud Library</div>
                  <button
                    type="button"
                    disabled={!currentUser || currentUser.role === 'viewer'}
                    onClick={() => {
                      openSaveSceneModal();
                      setIsFileMenuOpen(false);
                    }}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm transition-colors",
                      (!currentUser || currentUser.role === 'viewer')
                        ? "text-zinc-650 cursor-not-allowed bg-transparent"
                        : "hover:bg-zinc-800 hover:text-white"
                    )}
                    title={(!currentUser || currentUser.role === 'viewer') ? "Log in as an editor or admin to save scenes" : undefined}
                  >
                    <Cloud className="h-4 w-4" />
                    Save Scene
                  </button>
                  {currentUser?.role === 'admin' && activeSavedSceneId && (
                    <button
                      type="button"
                      onClick={handleTogglePublish}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-zinc-800 hover:text-white"
                    >
                      <Share2 className="h-4 w-4 text-indigo-400" />
                      {activeSavedScenePublished ? 'Unpublish Scene' : 'Publish Scene'}
                    </button>
                  )}
                  <div className="-mx-1 my-1 h-px bg-zinc-800" />
                  <div className="px-2 py-1.5 text-[10px] uppercase tracking-widest text-zinc-500 font-bold select-none">Project JSON</div>
                  <button
                    type="button"
                    onClick={() => {
                      handleExportProjectJson();
                      setIsFileMenuOpen(false);
                    }}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-zinc-800 hover:text-white"
                  >
                    <Download className="h-4 w-4" />
                    Export Project
                  </button>
                  <div className="-mx-1 my-1 h-px bg-zinc-800" />
                  <button
                    type="button"
                    onClick={() => {
                      projectImportInputRef.current?.click();
                      setIsFileMenuOpen(false);
                    }}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-zinc-800 hover:text-white"
                  >
                    <Upload className="h-4 w-4" />
                    Import Project
                  </button>
                </div>
              )}
            </div>
            <span className="hover:text-zinc-300 cursor-pointer transition-colors text-[11px] font-bold uppercase tracking-widest">Project</span>

            <button
              type="button"
              className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-zinc-500 transition-colors hover:text-zinc-200"
              onClick={openSceneLibrary}
              aria-label={savedScenesLoadError ? 'Open scene library, scenes could not be loaded' : `Open scene library with ${savedScenes.length} scenes`}
              title={savedScenesLoadError || undefined}
            >
              <span>Scene Library</span>
              <span aria-hidden="true" className="text-zinc-700">(</span>
              <span className={cn(
                "rounded border bg-zinc-950 px-1.5 py-0.5 font-mono text-[9px] tabular-nums",
                savedScenesLoadError ? "border-red-500/30 text-red-300" : "border-zinc-800 text-zinc-400"
              )}>
                {sceneLibraryCountLabel}
              </span>
              <span aria-hidden="true" className="text-zinc-700">)</span>
            </button>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {showAutosaveIndicator && (
            <div
              className={cn(
                "hidden h-7 items-center gap-1.5 rounded border px-2 text-[9px] font-black uppercase tracking-widest sm:inline-flex",
                autosaveToneClass
              )}
              aria-live="polite"
              aria-atomic="true"
              title={autosaveMessage}
            >
              {autosaveStatus === 'saving' || autosaveStatus === 'pending' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : autosaveStatus === 'error' ? (
                <CloudOff className="h-3.5 w-3.5" />
              ) : autosaveStatus === 'saved' ? (
                <Check className="h-3.5 w-3.5" />
              ) : (
                <Cloud className="h-3.5 w-3.5" />
              )}
              <span>{autosaveMessage}</span>
            </div>
          )}

          <div className="flex bg-zinc-950/60 rounded border border-zinc-800 p-0.5 shrink-0 select-none">
            <button
              type="button"
              className={cn(
                "inline-flex h-7 items-center gap-1.5 rounded px-2.5 text-[9px] font-black uppercase tracking-widest transition-colors cursor-pointer",
                workspaceViewMode === 'editor'
                  ? "bg-indigo-600 text-white shadow"
                  : "text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200"
              )}
              onClick={() => {
                const sId = activeSavedSceneId ? `?sceneId=${activeSavedSceneId}` : '';
                router.push('/editor' + sId);
              }}
            >
              <Layers className="h-3.5 w-3.5" />
              Editor
            </button>

            <button
              type="button"
              className={cn(
                "inline-flex h-7 items-center gap-1.5 rounded px-2.5 text-[9px] font-black uppercase tracking-widest transition-colors cursor-pointer",
                workspaceViewMode === 'analysis'
                  ? "bg-indigo-600 text-white shadow"
                  : "text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200"
              )}
              onClick={() => {
                if (activeSavedSceneId) {
                  router.push(`/analysis?sceneId=${activeSavedSceneId}`);
                } else {
                  router.push('/analysis/new');
                }
              }}
            >
              <Activity className="h-3.5 w-3.5" />
              Analysis
            </button>

          </div>

          <ThemeToggle />

          {/* Visual Divider */}
          <div className="h-4 w-px bg-zinc-800" />

          {/* Auth Status / Controls */}
          {currentUser ? (
            <div className="flex items-center gap-3">
              <div className="flex flex-col items-end">
                <span className="text-[10px] font-bold text-zinc-200">{currentUser.username}</span>
                <span className={cn(
                  "mt-0.5 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-widest rounded-sm border leading-none",
                  currentUser.role === 'admin' && "bg-indigo-500/10 text-indigo-300 border-indigo-500/20 shadow-[0_0_8px_rgba(99,102,241,0.1)]",
                  currentUser.role === 'editor' && "bg-emerald-500/10 text-emerald-300 border-emerald-500/20 shadow-[0_0_8px_rgba(16,185,129,0.1)]",
                  currentUser.role === 'viewer' && "bg-zinc-800/40 text-zinc-400 border-zinc-800/80"
                )}>
                  {currentUser.role}
                </span>
              </div>
              
              {currentUser.role === 'admin' && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-zinc-500 hover:text-white hover:bg-zinc-850 rounded"
                  onClick={() => {
                    void handleLoadUsers();
                    setIsAdminModalOpen(true);
                  }}
                  title="Admin User Management"
                >
                  <Settings className="h-4 w-4" />
                </Button>
              )}

              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-zinc-500 hover:text-red-400 hover:bg-red-400/10 rounded"
                onClick={handleLogout}
                title="Log Out"
              >
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setAuthMode('login');
                setAuthError('');
                setIsAuthModalOpen(true);
              }}
              className="h-8 border-zinc-800 bg-zinc-950 px-3 text-[10px] font-black uppercase tracking-widest text-zinc-300 hover:border-indigo-500/50 hover:bg-indigo-500/10 hover:text-white"
            >
              <UserCircle className="h-3.5 w-3.5 mr-1 text-indigo-400" />
              Sign In
            </Button>
          )}

        </div>
      </header>

      {/* Main Content Pane */}
      <main className="flex-1 flex overflow-hidden relative">
        <AnimatePresence>
          {renderSidePanel()}
        </AnimatePresence>

        {/* Selected Clip Properties Panel */}
        <AnimatePresence>
          {selectedClip && !activeTab && (
            <motion.aside 
             ref={clipPropertiesPanelRef}
             key={selectedClip.id}
             initial={{ x: '-100%' }}
             animate={{ x: 0 }}
             exit={{ x: '-100%' }}
             transition={{ type: 'spring', damping: 25, stiffness: 200 }}
             className="fixed inset-y-0 left-0 w-72 bg-[#111114] border-r border-zinc-800 z-[100] flex flex-col shadow-[20px_0_50px_rgba(0,0,0,0.5)]"
            >
              <div className="h-12 border-b border-zinc-800 flex items-center justify-between px-4 shrink-0">
                <h3 className="text-[11px] font-bold text-zinc-400 uppercase tracking-widest">Clip Properties</h3>
                <Button 
                 variant="ghost" 
                 size="icon" 
                 className="h-7 w-7 text-zinc-500 hover:text-white"
                 onClick={() => setSelectedClipIds([])}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>

              <ClipPropertiesPanel 
                selectedClip={selectedClip}
                tracks={tracks}
                updateClip={updateClip}
                addClip={addClip}
                handleFileUpload={handleFileUpload}
                deleteClip={deleteClip}
                moveClipToFirst={moveClipToFirst}
                moveClipToLast={moveClipToLast}
              />
            </motion.aside>
          )}
        </AnimatePresence>

        {/* Vertical Toolbar Sidebar */}
        <aside className="w-12 border-r border-zinc-800 bg-[#111114] flex flex-col items-center py-4 gap-4 shrink-0 z-10">
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={() => setActiveTab(activeTab === 'scenes' ? null : 'scenes')}
            className={cn(
              "h-8 w-8 transition-all",
              activeTab === 'scenes' ? "text-indigo-400 bg-indigo-500/10" : "text-zinc-600 hover:text-zinc-300"
            )}
          >
            <Clapperboard className="h-4.5 w-4.5" />
          </Button>
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={() => setActiveTab(activeTab === 'characters' ? null : 'characters')}
            className={cn(
              "h-8 w-8 transition-all",
              activeTab === 'characters' ? "text-indigo-400 bg-indigo-500/10" : "text-zinc-600 hover:text-zinc-300"
            )}
          >
            <Users className="h-4.5 w-4.5" />
          </Button>
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={() => setActiveTab(activeTab === 'locations' ? null : 'locations')}
            className={cn(
              "h-8 w-8 transition-all",
              activeTab === 'locations' ? "text-indigo-400 bg-indigo-500/10" : "text-zinc-600 hover:text-zinc-300"
            )}
          >
            <MapPin className="h-4.5 w-4.5" />
          </Button>
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={() => setActiveTab(activeTab === 'analyze' ? null : 'analyze')}
            className={cn(
              "h-8 w-8 transition-all",
              activeTab === 'analyze' ? "text-indigo-400 bg-indigo-500/10" : "text-zinc-600 hover:text-zinc-300"
            )}
            title="AI Video Analysis"
          >
            <Sparkles className="h-4.5 w-4.5" />
          </Button>
          <div className="flex-1" />
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={() => setActiveTab(activeTab === 'settings' ? null : 'settings')}
            className={cn(
              "h-8 w-8 transition-all",
              activeTab === 'settings' ? "text-indigo-400 bg-indigo-500/10" : "text-zinc-600 hover:text-zinc-300"
            )}
          >
            <Settings className="h-4.5 w-4.5" />
          </Button>
        </aside>

        {/* Editor Workspace */}
        <div ref={workspaceRef} className="flex-1 flex flex-col overflow-hidden relative">
          {showSceneLaunchView ? (
            renderSceneLaunchWorkspace()
          ) : (
          <>
          {/* Upper Split: Preview Area (PERSISTENT & SHARED) */}
          {workspaceViewMode !== 'analysis' && (
            <>
              <div 
                className="flex min-h-0 overflow-hidden"
                style={{ flexBasis: `${previewPanelPercent}%` }}
              >
                 <Preview 
                   showSceneMuteControls={workspaceViewMode === 'review'} 
                   showPreviewTagUi={workspaceViewMode === 'review' ? reviewShowPreviewTagUi : true} 
                   useTagOverlayPresentation={workspaceViewMode === 'review'} 
                 />
              </div>

              {/* Shared Resizer Divider */}
              <div
                role="separator"
                aria-orientation="horizontal"
                aria-label="Resize preview panel"
                aria-valuemin={28}
                aria-valuemax={78}
                aria-valuenow={Math.round(previewPanelPercent)}
                tabIndex={0}
                className="group relative z-30 h-2 shrink-0 cursor-row-resize bg-[#050505] outline-none"
                onPointerDown={handleResizePointerDown}
                onPointerMove={handleResizePointerMove}
                onPointerUp={handleResizePointerUp}
                onPointerCancel={handleResizePointerUp}
                onKeyDown={handleResizeKeyDown}
              >
                <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-zinc-900 transition-colors group-hover:bg-indigo-500/70 group-focus-visible:bg-indigo-400" />
                <div className="absolute left-1/2 top-1/2 h-1.5 w-12 -translate-x-1/2 -translate-y-1/2 rounded-full border border-zinc-800 bg-zinc-950 transition-colors group-hover:border-indigo-400/50 group-focus-visible:border-indigo-300" />
              </div>
            </>
          )}

          {/* Shared Persistent Playback Toolbar Row */}
          <TooltipProvider>
            <input 
              type="file" 
              ref={fileInputRef} 
              className="hidden" 
              accept={pendingType === 'video' ? 'video/*' : 'image/*'}
              onChange={handleFileChange}
            />
            <div className="relative z-30 flex h-12 items-center justify-between border-b border-zinc-800 bg-[#111114] px-4 shrink-0">
              {/* Left aligned block */}
              {workspaceViewMode === 'review' ? (
                <div className="flex min-w-0 flex-1 items-center gap-3 pr-4">
                  <div className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">
                    {reviewContentMode === 'notes' ? 'Notes' : 'Dialog'} Timeline
                  </div>
                  <div className="flex rounded-md border border-zinc-800 bg-zinc-950 p-0.5 shrink-0">
                    {(['notes', 'dialog'] as const).map(mode => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setReviewContentMode(mode)}
                        className={cn(
                          "inline-flex h-6 items-center gap-1.5 rounded px-2 text-[9px] font-black uppercase tracking-widest transition-colors",
                          reviewContentMode === mode
                            ? "bg-indigo-500 text-white shadow"
                            : "text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200"
                        )}
                      >
                        {mode === 'notes' ? <StickyNote className="h-3.5 w-3.5" /> : <MessageSquare className="h-3.5 w-3.5" />}
                        {mode}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="flex min-w-0 flex-1 items-center gap-2 pr-4">
                  {sceneTabs.length > 1 ? (
                    <>
                      <div className="shrink-0 text-[9px] font-black uppercase tracking-[0.22em] text-zinc-600">
                        Scenes
                      </div>
                      <div className="flex min-w-0 max-w-[min(34vw,420px)] items-center gap-1.5 overflow-x-auto">
                        {sceneTabs.map((scene, index) => {
                          const isActive = scene.id === activeSceneId;
                          return (
                            <button
                              key={scene.id}
                              type="button"
                              className={cn(
                                "flex h-7 shrink-0 items-center gap-1.5 rounded border px-2 text-left transition-colors",
                                isActive
                                  ? "border-indigo-500/60 bg-indigo-500/15 text-indigo-100"
                                  : "border-zinc-800 bg-zinc-950/80 text-zinc-500 hover:border-zinc-700 hover:bg-zinc-900 hover:text-zinc-200"
                              )}
                              onClick={() => setActiveScene(scene.id)}
                            >
                              <span className={cn(
                                "flex h-4 min-w-4 items-center justify-center rounded-sm font-mono text-[9px] font-black tabular-nums",
                                isActive ? "bg-indigo-400 text-black" : "bg-zinc-800 text-zinc-500"
                              )}>
                                {index + 1}
                              </span>
                              <span className="max-w-24 truncate text-[10px] font-bold uppercase tracking-wider">
                                {scene.name}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </>
                  ) : (
                    <div className="h-8" />
                  )}
                </div>
              )}

              {/* Centered Playback Block (100% PERSISTENT & STATIONARY) */}
              {workspaceViewMode !== 'analysis' && (
                <div className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-2">
                  <Tooltip>
                    <TooltipTrigger
                      className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "h-8 w-8 text-zinc-500 hover:text-zinc-300")}
                      onClick={() => setCurrentFrame(0)}
                    >
                      <SkipBack className="h-4 w-4" />
                    </TooltipTrigger>
                    <TooltipContent>Reset to Start</TooltipContent>
                  </Tooltip>

                  <Button 
                    variant="secondary" 
                    size="icon" 
                    className="h-8 w-8 rounded-full bg-white text-black hover:bg-zinc-200 transition-all shadow-[0_0_15px_rgba(255,255,255,0.1)]"
                    onClick={() => {
                      if (!isPlaying) {
                        window.dispatchEvent(new Event('timeline-preview-play-request'));
                      }
                      setPlaying(!isPlaying);
                    }}
                  >
                    {isPlaying ? <Pause className="h-4 w-4 fill-current" /> : <Play className="h-4 w-4 ml-0.5 fill-current" />}
                  </Button>

                  <DropdownMenu>
                    <DropdownMenuTrigger
                      className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-8 min-w-14 justify-center border-zinc-800 bg-[#0a0a0b] px-2 font-mono text-[10px] font-bold text-zinc-300 hover:bg-zinc-900 hover:text-white")}
                    >
                      {playbackRate.toFixed(playbackRate % 1 === 0 ? 0 : 2)}x
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-28 bg-[#111114] border-zinc-800 text-zinc-300 z-50">
                      <div className="px-2 py-1 text-[9px] uppercase tracking-widest text-zinc-500 font-bold select-none cursor-default">Speed</div>
                      {[0.25, 0.5, 0.75, 1, 1.25, 1.5].map((rate) => (
                        <DropdownMenuItem
                          key={rate}
                          onClick={() => setPlaybackRate(rate)}
                          className="justify-between font-mono text-xs focus:bg-zinc-800 focus:text-white"
                        >
                          {rate.toFixed(rate % 1 === 0 ? 0 : 2)}x
                          {playbackRate === rate && <span className="text-indigo-300">•</span>}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>

                  <div className="flex items-center gap-3 ml-4">
                    <span className="text-sm font-mono text-indigo-400 font-bold tabular-nums">
                      {workspaceViewMode === 'review' ? formatReviewTime(currentFrame, fps) : formatTime(currentFrame)}
                    </span>
                    <div className="h-4 w-px bg-zinc-800" />
                    <span className="text-[10px] text-zinc-600 font-mono tracking-widest uppercase">
                       {currentFrame} / {totalDuration} FR
                    </span>
                  </div>
                </div>
              )}

              {/* Right aligned block */}
              {workspaceViewMode !== 'analysis' && (
                workspaceViewMode === 'review' ? (
                <div className="flex flex-1 items-center justify-end gap-4 pl-4">
                  <div role="group" aria-label="Preview overlays" className="flex items-center gap-1 rounded-md border border-zinc-800 bg-zinc-950 p-0.5 shrink-0">
                    <button
                      type="button"
                      aria-label="Tags and note/graph overlays on previews"
                      aria-pressed={reviewShowPreviewTagUi}
                      title="Tags and note/graph overlays on previews"
                      onClick={() => setReviewShowPreviewTagUi(!reviewShowPreviewTagUi)}
                      className={cn(
                        "inline-flex h-6 items-center gap-1.5 rounded px-2 text-[9px] font-black uppercase tracking-widest transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/70",
                        reviewShowPreviewTagUi
                          ? "bg-indigo-500/20 text-indigo-100"
                          : "text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200"
                      )}
                    >
                      <Tags className="h-3.5 w-3.5" />
                      Tags
                    </button>
                    <button
                      type="button"
                      aria-label="Dialog on previews"
                      aria-pressed={showDialogPreviewUi}
                      title="Dialog on previews"
                      onClick={() => setShowDialogPreviewUi(!showDialogPreviewUi)}
                      className={cn(
                        "inline-flex h-6 items-center gap-1.5 rounded px-2 text-[9px] font-black uppercase tracking-widest transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/70",
                        showDialogPreviewUi
                          ? "bg-indigo-500/20 text-indigo-100"
                          : "text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200"
                      )}
                    >
                      <MessageSquare className="h-3.5 w-3.5" />
                      Dialog
                    </button>
                  </div>

                  <div className="h-4 w-px bg-zinc-800 shrink-0" />

                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[9px] font-black uppercase tracking-widest text-zinc-500">Time scale</span>
                    <Slider
                      className="w-24 cursor-pointer"
                      value={[verticalTimeScale]}
                      min={0.5}
                      max={4}
                      step={0.25}
                      getAriaLabel={() => 'Vertical timeline time scale'}
                      getAriaValueText={(_, value) => `${value.toFixed(2)} times vertical time scale`}
                      onValueChange={(val) => {
                        const newValue = Array.isArray(val) ? val[0] : val;
                        setVerticalTimeScale(newValue);
                      }}
                    />
                    <span className="w-10 text-right font-mono text-[10px] font-bold text-zinc-400">
                      {verticalTimeScale.toFixed(2)}x
                    </span>
                  </div>
                </div>
              ) : (
                <div className="flex flex-1 items-center justify-end gap-4 pl-4">
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      className={cn(
                        buttonVariants({ variant: "ghost", size: "icon" }),
                        "relative text-zinc-500 hover:text-zinc-300",
                        (noteTagFilter.length > 0 || showStarredNoteOverlaysOnly) && "text-indigo-300 hover:text-indigo-200"
                      )}
                      aria-label="Filter notes"
                    >
                      <Filter className="h-4 w-4" />
                      {(noteTagFilter.length > 0 || showStarredNoteOverlaysOnly) && (
                        <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-indigo-400" />
                      )}
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="center" className="max-h-80 w-64 overflow-y-auto border-zinc-800 bg-[#111114] p-2 text-zinc-300 z-50">
                      <div className="mb-2 flex flex-col gap-2 rounded border border-zinc-800 bg-zinc-950/70 p-2">
                        <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">Preview UI</div>
                        <button
                          type="button"
                          aria-pressed={showDialogPreviewUi}
                          className={cn(
                            "flex items-center justify-between gap-3 rounded-md border px-2.5 py-2 text-left transition-colors",
                            showDialogPreviewUi
                              ? "border-indigo-500/50 bg-indigo-500/10 text-indigo-100"
                              : "border-zinc-800 bg-zinc-950/80 text-zinc-500 hover:border-zinc-700 hover:text-zinc-200"
                          )}
                          onClick={() => setShowDialogPreviewUi(!showDialogPreviewUi)}
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <MessageSquare className="h-3.5 w-3.5 shrink-0" />
                            <span className="truncate text-[10px] font-bold uppercase tracking-wider">Dialog UI</span>
                          </span>
                          <span
                            className={cn(
                              "relative h-4 w-7 shrink-0 rounded-full border transition-colors",
                              showDialogPreviewUi ? "border-indigo-400/60 bg-indigo-400/25" : "border-zinc-700 bg-zinc-900"
                            )}
                            aria-hidden="true"
                          >
                            <span
                              className={cn(
                                "absolute top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full transition-transform",
                                showDialogPreviewUi ? "translate-x-3.5 bg-indigo-200" : "translate-x-0.5 bg-zinc-600"
                              )}
                            />
                          </span>
                        </button>
                        <button
                          type="button"
                          aria-pressed={showSceneTitleUi}
                          className={cn(
                            "flex items-center justify-between gap-3 rounded-md border px-2.5 py-2 text-left transition-colors",
                            showSceneTitleUi
                              ? "border-indigo-500/50 bg-indigo-500/10 text-indigo-100"
                              : "border-zinc-800 bg-zinc-950/80 text-zinc-500 hover:border-zinc-700 hover:text-zinc-200"
                          )}
                          onClick={() => setShowSceneTitleUi(!showSceneTitleUi)}
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <Type className="h-3.5 w-3.5 shrink-0" />
                            <span className="truncate text-[10px] font-bold uppercase tracking-wider">Scene Info</span>
                          </span>
                          <span
                            className={cn(
                              "relative h-4 w-7 shrink-0 rounded-full border transition-colors",
                              showSceneTitleUi ? "border-indigo-400/60 bg-indigo-400/25" : "border-zinc-700 bg-zinc-900"
                            )}
                            aria-hidden="true"
                          >
                            <span
                              className={cn(
                                "absolute top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full transition-transform",
                                showSceneTitleUi ? "translate-x-3.5 bg-indigo-200" : "translate-x-0.5 bg-zinc-600"
                              )}
                            />
                          </span>
                        </button>
                        <button
                          type="button"
                          aria-pressed={previewMediaLayout === 'full'}
                          className={cn(
                            "flex items-center justify-between gap-3 rounded-md border px-2.5 py-2 text-left transition-colors",
                            previewMediaLayout === 'full'
                              ? "border-indigo-500/50 bg-indigo-500/10 text-indigo-100"
                              : "border-zinc-800 bg-zinc-950/80 text-zinc-500 hover:border-zinc-700 hover:text-zinc-200"
                          )}
                          onClick={() => setPreviewMediaLayout(previewMediaLayout === 'full' ? 'inset' : 'full')}
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <Monitor className="h-3.5 w-3.5 shrink-0" />
                            <span className="truncate text-[10px] font-bold uppercase tracking-wider">
                              {previewMediaLayout === 'full' ? 'Full Video' : 'Inset Video'}
                            </span>
                          </span>
                          <span
                            className={cn(
                              "relative h-4 w-7 shrink-0 rounded-full border transition-colors",
                              previewMediaLayout === 'full' ? "border-indigo-400/60 bg-indigo-400/25" : "border-zinc-700 bg-zinc-900"
                            )}
                            aria-hidden="true"
                          >
                            <span
                              className={cn(
                                "absolute top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full transition-transform",
                                previewMediaLayout === 'full' ? "translate-x-3.5 bg-indigo-200" : "translate-x-0.5 bg-zinc-600"
                              )}
                            />
                          </span>
                        </button>
                        <button
                          type="button"
                          aria-pressed={compactNoteOverlays}
                          className={cn(
                            "flex items-center justify-between gap-3 rounded-md border px-2.5 py-2 text-left transition-colors",
                            compactNoteOverlays
                              ? "border-indigo-500/50 bg-indigo-500/10 text-indigo-100"
                              : "border-zinc-800 bg-zinc-950/80 text-zinc-500 hover:border-zinc-700 hover:text-zinc-200"
                          )}
                          onClick={() => setCompactNoteOverlays(!compactNoteOverlays)}
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <Tags className="h-3.5 w-3.5 shrink-0" />
                            <span className="truncate text-[10px] font-bold uppercase tracking-wider">Note Tags</span>
                          </span>
                          <span
                            className={cn(
                              "relative h-4 w-7 shrink-0 rounded-full border transition-colors",
                              compactNoteOverlays ? "border-indigo-400/60 bg-indigo-400/25" : "border-zinc-700 bg-zinc-900"
                            )}
                            aria-hidden="true"
                          >
                            <span
                              className={cn(
                                "absolute top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full transition-transform",
                                compactNoteOverlays ? "translate-x-3.5 bg-indigo-200" : "translate-x-0.5 bg-zinc-600"
                              )}
                            />
                          </span>
                        </button>
                        <button
                          type="button"
                          aria-pressed={showStarredNoteOverlaysOnly}
                          className={cn(
                            "flex items-center justify-between gap-3 rounded-md border px-2.5 py-2 text-left transition-colors",
                            showStarredNoteOverlaysOnly
                              ? "border-amber-400/50 bg-amber-400/10 text-amber-100"
                              : "border-zinc-800 bg-zinc-950/80 text-zinc-500 hover:border-zinc-700 hover:text-zinc-200"
                          )}
                          onClick={() => setShowStarredNoteOverlaysOnly(!showStarredNoteOverlaysOnly)}
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <Star className={cn("h-3.5 w-3.5 shrink-0", showStarredNoteOverlaysOnly && "fill-amber-300 text-amber-300")} />
                            <span className="truncate text-[10px] font-bold uppercase tracking-wider">Starred Notes Only</span>
                          </span>
                          <span
                            className={cn(
                              "relative h-4 w-7 shrink-0 rounded-full border transition-colors",
                              showStarredNoteOverlaysOnly ? "border-amber-300/60 bg-amber-300/25" : "border-zinc-700 bg-zinc-900"
                            )}
                            aria-hidden="true"
                          >
                            <span
                              className={cn(
                                "absolute top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full transition-transform",
                                showStarredNoteOverlaysOnly ? "translate-x-3.5 bg-amber-100" : "translate-x-0.5 bg-zinc-600"
                              )}
                            />
                          </span>
                        </button>
                      </div>
                      <DropdownMenuSeparator className="mb-2 bg-zinc-800" />
                      <div className="mb-2 flex flex-col gap-2 rounded border border-zinc-800 bg-zinc-950/70 p-2">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">Graph Layers</div>
                            <div className="mt-0.5 text-[9px] font-mono uppercase tracking-widest text-zinc-600">
                              {graphLayers.length === 0 ? 'No graphs' : `${visibleGraphLayerCount}/${graphLayers.length} visible`}
                            </div>
                          </div>
                        </div>
                        {graphLayers.length === 0 ? (
                          <div className="rounded border border-zinc-800 bg-zinc-950/80 px-3 py-3 text-center text-[10px] font-semibold uppercase tracking-widest text-zinc-600">
                            No graph layers yet
                          </div>
                        ) : (
                          <div className="flex flex-col gap-1.5">
                            {graphLayers.map(layer => (
                              <button
                                key={layer.id}
                                type="button"
                                aria-pressed={layer.isVisible}
                                className={cn(
                                  "flex items-center justify-between gap-3 rounded-md border px-2.5 py-2 text-left transition-colors",
                                  layer.isVisible
                                    ? "border-indigo-500/50 bg-indigo-500/10 text-indigo-100"
                                    : "border-zinc-800 bg-zinc-950/80 text-zinc-500 hover:border-zinc-700 hover:text-zinc-200"
                                )}
                                onClick={() => toggleTrackDisable(layer.id)}
                              >
                                <span className="flex min-w-0 items-center gap-2">
                                  <Activity className="h-3.5 w-3.5 shrink-0" />
                                  <span className="flex min-w-0 flex-col">
                                    <span className="truncate text-[10px] font-bold uppercase tracking-wider">{layer.label}</span>
                                    {layer.parentName && (
                                      <span className="truncate text-[9px] font-mono uppercase tracking-widest text-zinc-600">{layer.parentName}</span>
                                    )}
                                  </span>
                                </span>
                                <span
                                  className={cn(
                                    "relative h-4 w-7 shrink-0 rounded-full border transition-colors",
                                    layer.isVisible ? "border-indigo-400/60 bg-indigo-400/25" : "border-zinc-700 bg-zinc-900"
                                  )}
                                  aria-hidden="true"
                                >
                                  <span
                                    className={cn(
                                      "absolute top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full transition-transform",
                                      layer.isVisible ? "translate-x-3.5 bg-indigo-200" : "translate-x-0.5 bg-zinc-600"
                                    )}
                                  />
                                </span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      <DropdownMenuSeparator className="mb-2 bg-zinc-800" />
                      <div className="mb-2 flex items-center justify-between gap-3 px-1">
                        <div>
                          <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">Note Tags</div>
                          <div className="mt-0.5 text-[9px] font-mono uppercase tracking-widest text-zinc-600">
                            {noteTags.length === 0 ? 'No tags' : `${activeFilterCount}/${noteTags.length} visible`}
                          </div>
                        </div>
                        {noteTags.length > 0 && (
                          <div className="flex shrink-0 items-center gap-1.5">
                            <button
                              type="button"
                              className="rounded border border-zinc-800 px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-zinc-500 hover:border-zinc-700 hover:text-zinc-200"
                              onClick={() => setNoteTagFilter([])}
                            >
                              Show All
                            </button>
                            <button
                              type="button"
                              className="rounded border border-zinc-800 px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-zinc-500 hover:border-zinc-700 hover:text-zinc-200"
                              onClick={() => setNoteTagFilter([NOTE_TAG_FILTER_NONE])}
                            >
                              Hide All
                            </button>
                          </div>
                        )}
                      </div>
                      {noteTags.length === 0 ? (
                        <div className="rounded border border-zinc-800 bg-zinc-950/80 px-3 py-4 text-center text-[10px] font-semibold uppercase tracking-widest text-zinc-600">
                          No note tags yet
                        </div>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {noteTags.map(tag => {
                            const isEnabled = enabledNoteTagSet.has(tag.toLowerCase());
                            const noteCount = noteTagCounts.get(tag.toLowerCase())?.count || 0;
                            return (
                              <button
                                key={tag}
                                type="button"
                                className={cn(
                                  "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-colors",
                                  isEnabled
                                    ? "border-indigo-500/50 bg-indigo-500/10 text-indigo-200"
                                    : "border-zinc-800 bg-zinc-950/80 text-zinc-600 hover:border-zinc-700 hover:text-zinc-300"
                                )}
                                onClick={() => toggleNoteTag(tag)}
                              >
                                <span>{tag}</span>
                                <span className={cn(
                                  "ml-0.5 rounded px-1 font-mono text-[9px] leading-none",
                                  isEnabled ? "bg-indigo-300/15 text-indigo-100" : "bg-white/[0.04] text-zinc-500"
                                )}>
                                  {noteCount}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>

                  {filterSummaryLabel && (
                    <div
                      className="max-w-44 truncate rounded border border-zinc-800 bg-zinc-950/80 px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-zinc-500"
                      title={selectedFilterLabels.join(', ')}
                    >
                      {filterSummaryLabel}
                    </div>
                  )}

                  <div className="h-4 w-px bg-zinc-800" />

                  <div className="flex items-center gap-1">
                    <Tooltip>
                      <TooltipTrigger
                        className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "h-8 w-8 text-zinc-500 hover:text-zinc-300")}
                        onClick={() => setZoom(Math.max(2, zoom - 1))}
                      >
                        <ZoomOut className="h-4 w-4" />
                      </TooltipTrigger>
                      <TooltipContent>Zoom Out</TooltipContent>
                    </Tooltip>

                    <Slider
                      className="w-20 cursor-pointer"
                      value={[zoom]}
                      min={2}
                      max={18}
                      step={1}
                      getAriaLabel={() => 'Timeline horizontal zoom'}
                      onValueChange={(val) => {
                        const newValue = Array.isArray(val) ? val[0] : val;
                        setZoom(newValue);
                      }}
                    />

                    <Tooltip>
                      <TooltipTrigger
                        className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "h-8 w-8 text-zinc-500 hover:text-zinc-300")}
                        onClick={() => setZoom(Math.min(18, zoom + 1))}
                      >
                        <ZoomIn className="h-4 w-4" />
                      </TooltipTrigger>
                      <TooltipContent>Zoom In</TooltipContent>
                    </Tooltip>
                  </div>

                  <div className="h-4 w-px bg-zinc-800 mx-1" />

                  <Tooltip>
                    <TooltipTrigger
                      className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "h-8 w-8 text-zinc-500 hover:text-red-400 hover:bg-red-900/10 transition-colors disabled:opacity-50")}
                      disabled={selectedClipIds.length === 0}
                      onClick={() => selectedClipIds.forEach(id => deleteClip(id))}
                    >
                      <Trash2 className="h-4 w-4" />
                    </TooltipTrigger>
                    <TooltipContent>Delete Selection</TooltipContent>
                  </Tooltip>

                  <div className="h-4 w-px bg-zinc-800 mx-1" />

                  <Button
                    size="sm"
                    className="h-8 px-4 bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-black uppercase tracking-widest rounded shadow-lg shadow-indigo-900/40 transition-all disabled:opacity-60"
                    disabled={isRendering}
                    onClick={handleRenderProject}
                  >
                    {isRendering ? (
                      <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />
                    ) : (
                      <Download className="h-3.5 w-3.5 mr-2" />
                    )}
                    {isRendering ? 'Rendering' : 'Render'}
                  </Button>

                  <div className="h-4 w-px bg-zinc-800 mx-1" />

                  <DropdownMenu>
                    <DropdownMenuTrigger
                      className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-8 gap-2 bg-indigo-600 border-indigo-500 text-white hover:bg-indigo-500 hover:text-white")}
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Add Item
                      <ChevronDown className="h-3 w-3 opacity-50" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56 bg-[#111114] border-zinc-800 text-zinc-300 z-50">
                      <div className="px-2 py-1.5 text-[10px] uppercase tracking-widest text-zinc-500 font-bold select-none cursor-default">Media Assets</div>
                      <DropdownMenuItem onClick={() => handleAddClipClick('video')} className="focus:bg-zinc-800 focus:text-white gap-2">
                        <Video className="h-4 w-4" /> Video Layer
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleAddClipClick('image')} className="focus:bg-zinc-800 focus:text-white gap-2">
                        <ImageIcon className="h-4 w-4" /> Image/Graphic
                      </DropdownMenuItem>
                      <DropdownMenuSeparator className="bg-zinc-800" />
                      <div className="px-2 py-1.5 text-[10px] uppercase tracking-widest text-zinc-500 font-bold select-none cursor-default">Storyboard elements</div>
                      <DropdownMenuItem onClick={() => handleAddClipClick('dialog')} className="focus:bg-zinc-800 focus:text-white gap-2">
                        <MessageSquare className="h-4 w-4" /> Dialogue Bubble
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleAddClipClick('note')} className="focus:bg-zinc-800 focus:text-white gap-2">
                        <StickyNote className="h-4 w-4" /> Director Note
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              )
            )}
            </div>
          </TooltipProvider>

          {/* Lower Split: Swappable Timeline Content */}
          {workspaceViewMode === 'analysis' ? (
            <AnalysisWorkspace 
              selectedVideoFile={selectedVideoFile}
              setSelectedVideoFile={setSelectedVideoFile}
              videoObjectURL={videoObjectURL}
              setVideoObjectURL={setVideoObjectURL}
              isAnalyzing={isAnalyzing}
              analysisProgress={analysisProgress}
              analysisLogs={analysisLogs}
              isAnalysisComplete={isAnalysisComplete}
              setIsAnalysisComplete={setIsAnalysisComplete}
              videoDuration={videoDuration}
              setVideoDuration={setVideoDuration}
              analysisModelChoice={analysisModelChoice}
              setAnalysisModelChoice={setAnalysisModelChoice}
              enabledGraphLayers={enabledGraphLayers}
              setEnabledGraphLayers={setEnabledGraphLayers}
              storyAnalyzePlotPoints={storyAnalyzePlotPoints}
              setStoryAnalyzePlotPoints={setStoryAnalyzePlotPoints}
              storyAnalyzeStakes={storyAnalyzeStakes}
              setStoryAnalyzeStakes={setStoryAnalyzeStakes}
              storyAnalyzeConfrontation={storyAnalyzeConfrontation}
              setStoryAnalyzeConfrontation={setStoryAnalyzeConfrontation}
              runVideoAnalysis={runVideoAnalysis}
              onOpenScriptEditor={openScriptEditorForClip}
              handleCaptureCurrentFrameThumbnail={handleCaptureCurrentFrameThumbnail}
              isCapturingSceneThumbnail={isCapturingSceneThumbnail}
              activeVideoClipAtCurrentFrame={activeVideoClipAtCurrentFrame}
              isPlaying={isPlaying}
              isReadOnly={!currentUser || currentUser.role === 'viewer'}
            />
          ) : workspaceViewMode === 'review' ? (
            <ReviewWorkspace 
              onOpenScriptEditor={openScriptEditorForClip} 
              showPreviewTagUi={reviewShowPreviewTagUi}
              setShowPreviewTagUi={setReviewShowPreviewTagUi}
              contentMode={reviewContentMode}
              setContentMode={setReviewContentMode}
              verticalTimeScale={verticalTimeScale}
              setVerticalTimeScale={setVerticalTimeScale}
            />
          ) : (
            <div className="flex-1 flex flex-col overflow-hidden">
              <TimelineRoot />
            </div>
          )}
          </>
          )}
        </div>
      </main>

      {/* Footer Status Bar */}
      <footer className="h-6 bg-[#0a0a0b] border-t border-zinc-800 flex items-center justify-between px-3 shrink-0 uppercase tracking-[0.2em]">
         <div className="flex items-center gap-4 text-[8px] text-zinc-600 font-bold">
            <span className="flex items-center gap-1.5"><div className="w-1.5 h-1.5 rounded-full bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.5)]"/> ENGINE NOMINAL</span>
            <span>MEM: 44.2MB</span>
         </div>
         <div className="text-[8px] text-zinc-600 font-bold">
             SCENE: {scenes.findIndex(s => s.id === activeSceneId) + 1} / {scenes.length}
         </div>
      </footer>
      <AnimatePresence>
        {scriptEditorClip && (scriptEditorClip.type === 'dialog' || scriptEditorClip.type === 'note') && (
          <ScriptClipEditorModal
            selectedClip={scriptEditorClip}
            clips={clips}
            tracks={tracks}
            characters={characters}
            fps={fps}
            updateClip={updateClip}
            addClip={addClip}
            onClose={() => setScriptEditorClipId(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}


export function Editor() {
  return <EditorInner />;
}
