'use client';

import React from 'react';
import { useTimeline } from '@/lib/timeline-context';

export function Ruler() {
  const { totalDuration, zoom, fps } = useTimeline();
  
  const markers = [];
  const majorInterval = fps; // Every second
  const minorInterval = fps / 2; // Every half second

  for (let i = 0; i <= totalDuration; i += fps) {
    markers.push(
      <div 
        key={i} 
        className="absolute bottom-0 flex flex-col items-start"
        style={{ left: `${i * zoom}px` }}
      >
        <div className="h-4 w-[1px] bg-zinc-700" />
        <span className="text-[9px] text-zinc-500 font-mono mt-[-18px] ml-1">
          {Math.floor(i / fps)}s
        </span>
      </div>
    );
  }

  // Smaller markers
  const subMarkers = [];
  for (let i = 0; i <= totalDuration; i += fps / 5) {
    if (i % fps === 0) continue;
    subMarkers.push(
      <div 
        key={i} 
        className={`absolute bottom-0 h-2 w-[1px] ${i % (fps/2) === 0 ? 'bg-zinc-700' : 'bg-zinc-800'}`}
        style={{ left: `${i * zoom}px` }}
      />
    );
  }

  return (
    <div className="relative w-full h-full pointer-events-none">
      {markers}
      {subMarkers}
    </div>
  );
}
