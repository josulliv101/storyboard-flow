'use client';

import React from 'react';
import { motion } from 'motion/react';
import { Check, Clock, MessageSquare, StickyNote, X } from 'lucide-react';

import { Button } from '@storyboard/ui';
import { getGraphColor, getGraphDisplayLabel } from '@/lib/graph-style';
import { cn } from '@/lib/utils';
import { TimelineClip, useTimeline } from '@/lib/timeline-context';

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
