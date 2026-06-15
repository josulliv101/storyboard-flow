'use client';

import { X } from 'lucide-react';
import { motion } from 'motion/react';
import { Button } from '@storyboard/ui';

export type RenderGroupOption = {
  id: string;
  name: string;
  trackIds: string[];
  clipCount: number;
};

type RenderGroupSelectionModalProps = {
  renderGroupOptions: RenderGroupOption[];
  isRendering: boolean;
  onClose: () => void;
  onRenderGroup: (group: RenderGroupOption) => void;
};

export function RenderGroupSelectionModal({
  renderGroupOptions,
  isRendering,
  onClose,
  onRenderGroup,
}: RenderGroupSelectionModalProps) {
  return (
    <motion.div
      key="render-group-selection"
      className="fixed inset-0 z-[300] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onPointerDown={onClose}
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
            onClick={onClose}
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
              onClick={() => onRenderGroup(group)}
            >
              <span className="text-xs font-bold uppercase tracking-wider text-zinc-200">{group.name}</span>
              <span className="text-[10px] font-mono uppercase tracking-widest text-zinc-500">{group.clipCount} clips</span>
            </Button>
          ))}
        </div>
      </motion.div>
    </motion.div>
  );
}
