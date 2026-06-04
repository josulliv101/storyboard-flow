'use client';

import React, { useEffect } from 'react';
import { motion, PanInfo } from 'motion/react';
import { useTimeline } from '@/lib/timeline-context';
import { cn } from '@/lib/utils';

interface PlayheadProps {
  containerRef: React.RefObject<HTMLDivElement | null>;
  mode?: 'all' | 'handle' | 'line';
}

export function Playhead({ containerRef, mode = 'all' }: PlayheadProps) {
  const { currentFrame, setCurrentFrame, zoom } = useTimeline();

  const updatePosition = (clientX: number) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = clientX - rect.left + containerRef.current.scrollLeft;
      const frame = Math.max(0, Math.floor(x / zoom));
      setCurrentFrame(frame);
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    const handlePointerMove = (moveEvent: PointerEvent) => {
      updatePosition(moveEvent.clientX);
    };

    const handlePointerUp = () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  };

  return (
    <div
      className={cn(
        "absolute top-0 bottom-0 pointer-events-none",
        (mode === 'all' || mode === 'line') && "z-[45] w-px bg-red-500",
        mode === 'handle' && "z-[120]"
      )}
      style={{ left: `${currentFrame * zoom}px` }}
    >
      {/* Handle */}
      {(mode === 'all' || mode === 'handle') && (
        <div
          onPointerDown={handlePointerDown}
          className="absolute top-0 -translate-x-1/2 w-8 h-8 cursor-col-resize pointer-events-auto flex items-center justify-center group"
        >
          <div className="w-3 h-3 bg-red-500 rotate-45 shadow-[0_0_10px_rgba(239,68,68,0.5)] border border-white/20" />
        </div>
      )}
      
      {/* Vertical Line shadow */}
      {(mode === 'all' || mode === 'line') && (
        <div className="absolute top-4 bottom-0 w-px bg-red-500/50 -left-[0.5px] shadow-[0_0_8px_rgba(239,68,68,0.3)] pointer-events-none" />
      )}
    </div>
  );
}
