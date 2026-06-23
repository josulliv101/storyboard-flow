import React, { useRef } from 'react';
import { cn } from '../lib/utils';

export interface TimelineItemData {
  id: string;
  label: string;
  start: number; // in seconds
  duration: number; // in seconds
  color?: string;
}

export interface TimelineTrackData {
  id: string;
  name: string;
  items: TimelineItemData[];
}

export interface TimelineProps extends React.HTMLAttributes<HTMLDivElement> {
  currentTime: number;
  duration: number;
  zoom?: number; // pixels per second
  tracks: TimelineTrackData[];
  onCurrentTimeChange?: (time: number) => void;
}

export function Timeline({
  currentTime,
  duration,
  zoom = 10,
  tracks,
  onCurrentTimeChange,
  className,
  ...props
}: TimelineProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Convert time to pixels based on zoom level
  const timeToPx = (time: number) => time * zoom;

  // Convert pixels to time based on zoom level
  const pxToTime = (px: number) => px / zoom;

  const handleTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!containerRef.current || !onCurrentTimeChange) return;

    const rect = containerRef.current.getBoundingClientRect();
    // Calculate click X coordinate relative to the scrollable track area
    const clickX = e.clientX - rect.left + containerRef.current.scrollLeft;
    
    // Account for track header offset if we click inside the tracks area
    const headerWidth = 120; // Matches class w-[120px] below
    const trackAreaClickX = clickX - headerWidth;

    if (trackAreaClickX >= 0) {
      const newTime = Math.min(Math.max(0, pxToTime(trackAreaClickX)), duration);
      onCurrentTimeChange(newTime);
    }
  };

  const playheadPosition = timeToPx(currentTime);
  const totalWidth = timeToPx(duration);

  // Generate ticks for the ruler (e.g. every 5 seconds or dynamically based on zoom)
  const tickInterval = zoom < 5 ? 10 : zoom < 15 ? 5 : 2;
  const ticks = [];
  for (let i = 0; i <= duration; i += tickInterval) {
    ticks.push(i);
  }

  return (
    <div
      ref={containerRef}
      className={cn(
        "flex flex-col w-full overflow-x-auto select-none bg-zinc-950/80 border border-zinc-800/80 rounded-xl backdrop-blur-md shadow-2xl text-zinc-200 font-sans",
        className
      )}
      {...props}
    >
      {/* Timeline Ruler Header */}
      <div 
        className="flex border-b border-zinc-800/80 min-w-max sticky top-0 bg-zinc-950/90 z-20"
        onClick={handleTimelineClick}
      >
        <div className="w-[120px] shrink-0 border-r border-zinc-800/80 p-3 text-xs font-semibold text-zinc-400 bg-zinc-950 flex items-center justify-between">
          <span>Tracks</span>
          <span className="text-[10px] bg-zinc-800 text-zinc-300 px-1.5 py-0.5 rounded font-mono">
            {currentTime.toFixed(2)}s
          </span>
        </div>
        <div 
          className="relative h-10 flex-1 cursor-pointer"
          style={{ width: totalWidth }}
        >
          {/* Ticks */}
          {ticks.map((tick) => (
            <div
              key={tick}
              className="absolute bottom-0 flex flex-col items-center -translate-x-1/2"
              style={{ left: timeToPx(tick) }}
            >
              <span className="text-[9px] font-mono text-zinc-500 mb-1">
                {tick}s
              </span>
              <div className="w-px h-2 bg-zinc-700" />
            </div>
          ))}
        </div>
      </div>

      {/* Tracks Area */}
      <div 
        className="relative flex flex-col min-w-max flex-1"
        onClick={handleTimelineClick}
      >
        {/* Playhead line (spans all tracks) */}
        <div
          className="absolute top-0 bottom-0 w-px bg-red-500 z-10 pointer-events-none transition-all duration-75 ease-out shadow-[0_0_8px_rgba(239,68,68,0.5)]"
          style={{ 
            left: playheadPosition + 120, // offset by track header width
          }}
        >
          <div className="absolute top-0 -translate-x-1/2 w-3 h-3 bg-red-500 rounded-full border border-zinc-950 shadow-md" />
        </div>

        {tracks.map((track) => (
          <div 
            key={track.id} 
            className="flex border-b border-zinc-900 last:border-b-0 hover:bg-zinc-900/30 transition-colors"
          >
            {/* Track Info Header */}
            <div className="w-[120px] shrink-0 border-r border-zinc-800/80 p-3 text-xs font-medium text-zinc-300 bg-zinc-950/60 sticky left-0 z-10 flex items-center">
              <span className="truncate">{track.name}</span>
            </div>

            {/* Track Content Lane */}
            <div 
              className="relative h-16 flex-1 py-2 bg-zinc-950/20"
              style={{ width: totalWidth }}
            >
              {/* Subtle background grid pattern */}
              <div 
                className="absolute inset-0 pointer-events-none opacity-5"
                style={{
                  backgroundImage: `linear-gradient(to right, #ffffff 1px, transparent 1px)`,
                  backgroundSize: `${timeToPx(1)}px 100%`
                }}
              />

              {/* Clip Items */}
              {track.items.map((item) => (
                <div
                  key={item.id}
                  className={cn(
                    "absolute top-2 bottom-2 rounded-lg border flex items-center px-3 shadow-md hover:brightness-110 active:scale-[0.99] transition-all cursor-pointer select-none",
                    item.color || "bg-violet-600/30 border-violet-500/50 text-violet-200"
                  )}
                  style={{
                    left: timeToPx(item.start),
                    width: timeToPx(item.duration),
                  }}
                  onClick={(e) => {
                    e.stopPropagation(); // prevent moving the playhead on item click
                    console.log(`Clicked item: ${item.label} (${item.id})`);
                  }}
                >
                  <span className="text-xs font-semibold truncate leading-none">
                    {item.label}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
