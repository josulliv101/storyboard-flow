'use client';

import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Button } from '@storyboard/ui';
import { ChevronDown, ChevronRight, FileImage, FileVideo, MessageSquare, StickyNote, Trash2, Upload, UserCircle } from 'lucide-react';
import { TimelineClip, useTimeline } from '@/lib/timeline-context';
import { cn } from '@/lib/utils';
import { getGraphColor, getGraphDisplayLabel } from '@/lib/graph-style';
import { ScriptClipEditorModal } from './ScriptClipEditorModal';

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


export function ClipPropertiesPanel({ selectedClip, tracks, updateClip, addClip, handleFileUpload, deleteClip, moveClipToFirst, moveClipToLast }: ClipPropertiesPanelProps) {
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

