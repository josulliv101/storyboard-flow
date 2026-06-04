'use client';

import React from 'react';
import { useTimeline, Character } from '@/lib/timeline-context';
import { Plus, Trash2, Upload, User, Pencil, Save, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '@/lib/utils';

export function CharactersPanel() {
  const { characters, addCharacter, updateCharacter, deleteCharacter } = useTimeline();
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [editName, setEditName] = React.useState("");

  const handleAdd = () => {
    addCharacter(`Character ${characters.length + 1}`);
  };

  const startEditing = (char: Character) => {
    setEditingId(char.id);
    setEditName(char.name);
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditName("");
  };

  const saveEdit = (id: string) => {
    updateCharacter(id, { name: editName });
    setEditingId(null);
  };

  const onImageUpload = (id: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      updateCharacter(id, {}, file);
    }
  };

  return (
    <div className="p-4 flex flex-col gap-4">
      <Button 
        onClick={handleAdd}
        className="w-full bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-bold uppercase tracking-widest h-9"
      >
        <Plus className="w-3.5 h-3.5 mr-2" />
        New Character
      </Button>

      <div className="space-y-3">
        <AnimatePresence mode="popLayout">
          {characters.map((char) => (
            <motion.div
              key={char.id}
              layout
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className={cn(
                "group bg-zinc-900/50 border border-zinc-800 rounded-lg p-3 transition-colors hover:border-zinc-700",
                editingId === char.id && "border-indigo-500/50 bg-indigo-500/5"
              )}
            >
              <div className="flex items-center gap-3">
                {/* Headshot */}
                <div className="relative group/img shrink-0">
                  <div className="w-12 h-12 rounded-full bg-zinc-800 border border-zinc-700 overflow-hidden flex items-center justify-center">
                    {char.image ? (
                      <img src={char.image} alt={char.name} className="w-full h-full object-cover" />
                    ) : (
                      <User className="w-6 h-6 text-zinc-600" />
                    )}
                  </div>
                  <label className="absolute inset-0 bg-black/60 rounded-full flex items-center justify-center opacity-0 group-hover/img:opacity-100 cursor-pointer transition-opacity">
                    <Upload className="w-4 h-4 text-white" />
                    <input 
                      type="file" 
                      accept="image/*" 
                      className="hidden" 
                      onChange={(e) => onImageUpload(char.id, e)} 
                    />
                  </label>
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  {editingId === char.id ? (
                    <div className="flex items-center gap-2">
                      <input 
                        type="text"
                        value={editName}
                        autoFocus
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && saveEdit(char.id)}
                        className="flex-1 bg-black border border-zinc-700 rounded px-2 py-1 text-xs text-white outline-none focus:border-indigo-500"
                      />
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-emerald-400" onClick={() => saveEdit(char.id)}>
                        <Save className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-zinc-500" onClick={cancelEditing}>
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-[11px] font-bold text-zinc-200 truncate">{char.name}</div>
                      <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-zinc-400 hover:text-white" onClick={() => startEditing(char)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-zinc-500 hover:text-red-400" onClick={() => deleteCharacter(char.id)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  )}
                  <div className="text-[9px] text-zinc-600 font-mono uppercase tracking-wider mt-0.5">
                    ID: {char.id.split('-').pop()}
                  </div>
                </div>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {characters.length === 0 && (
          <div className="py-8 flex flex-col items-center justify-center text-center gap-4 opacity-50 grayscale">
            <User className="w-10 h-10 text-zinc-700" />
            <div className="space-y-1">
              <h4 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">No Characters</h4>
              <p className="text-[8px] text-zinc-600 leading-relaxed">Start by adding your project&apos;s cast.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
