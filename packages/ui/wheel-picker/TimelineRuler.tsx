import React from 'react';
import { cn } from '../lib/utils';

export const formatRulerSeconds = (seconds: number) => (
  `${Number(seconds.toFixed(1))}s`
);

export interface TimelineRulerProps {
  itemWidth: number;
  itemStartTime: number;
  itemDuration: number;
  itemEndTime: number;
  rulerTickStep: number;
  rulerTop: number;
  opacity: number;
  effect: string;
  x: number;
  z: number;
  rotateY: number;
  scale: number;
  distance: number;
  isLastItem: boolean;
}

export function TimelineRuler({
  itemWidth,
  itemStartTime,
  itemDuration,
  itemEndTime,
  rulerTickStep,
  rulerTop,
  opacity,
  effect,
  x,
  z,
  rotateY,
  scale,
  distance,
  isLastItem,
}: TimelineRulerProps) {
  const firstRulerTick = Math.ceil((itemStartTime - 0.001) / rulerTickStep) * rulerTickStep;
  const rulerTicks: number[] = [];
  
  for (
    let tickSeconds = firstRulerTick;
    tickSeconds < itemEndTime - 0.001 || (
      isLastItem && tickSeconds <= itemEndTime + 0.001
    );
    tickSeconds += rulerTickStep
  ) {
    rulerTicks.push(tickSeconds);
  }

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute left-1/2 h-7 border-b border-zinc-600/80 text-[9px] font-mono text-zinc-400"
      style={{
        top: rulerTop,
        width: itemWidth,
        opacity: effect === 'gallery' ? 1 : opacity,
        transform: `translate3d(${(x - itemWidth / 2).toFixed(2)}px, 0px, ${z}px) rotateY(${rotateY}deg) scale(${scale})`,
        transformOrigin: 'center bottom',
        zIndex: effect === 'gallery' ? 150 : Math.round(100 - distance * 10),
      }}
    >
      {rulerTicks.map(tickSeconds => (
        <div
          key={tickSeconds}
          className="absolute inset-y-0"
          style={{ left: `${((tickSeconds - itemStartTime) / itemDuration) * 100}%` }}
        >
          <span className="absolute left-0 top-0 -translate-x-1/2 whitespace-nowrap">
            {formatRulerSeconds(tickSeconds)}
          </span>
          <span className="absolute bottom-0 left-0 h-2 w-px bg-zinc-400/80" />
        </div>
      ))}
    </div>
  );
}
