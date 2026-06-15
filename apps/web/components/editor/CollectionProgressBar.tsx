'use client';

import React from 'react';

interface CollectionProgressBarProps {
  itemStartedAt: number;
  durationSeconds: number;
  isPlaying: boolean;
  pausedOffset: number;
  isScrubbing: boolean;
  children?: React.ReactNode;
}

export const CollectionProgressBar = ({
  durationSeconds,
  isPlaying,
  pausedOffset,
  children
}: CollectionProgressBarProps) => {
  const barRef = React.useRef<HTMLDivElement>(null);
  const rafRef = React.useRef<number>(0);
  const animatingRef = React.useRef(false);
  const lastDurationRef = React.useRef(durationSeconds);
  const lastPlayingRef = React.useRef(isPlaying);
  const lastOffsetRef = React.useRef(pausedOffset);

  React.useEffect(() => {
    return () => {
      cancelAnimationFrame(rafRef.current);
    };
  }, []);

  React.useEffect(() => {
    const bar = barRef.current;
    if (!bar) return;

    const durationChanged = Math.abs(durationSeconds - lastDurationRef.current) > 0.01;
    const playStateChanged = isPlaying !== lastPlayingRef.current;
    const offsetJumpedBack = pausedOffset < lastOffsetRef.current - 0.3;

    lastDurationRef.current = durationSeconds;
    lastPlayingRef.current = isPlaying;
    lastOffsetRef.current = pausedOffset;

    if (!isPlaying) {
      cancelAnimationFrame(rafRef.current);
      animatingRef.current = false;
      const percent = durationSeconds > 0
        ? (Math.min(durationSeconds, Math.max(0, pausedOffset)) / durationSeconds) * 100
        : 0;
      bar.style.transition = 'none';
      bar.style.width = `${percent.toFixed(2)}%`;
      return;
    }

    if (animatingRef.current && !durationChanged && !playStateChanged && !offsetJumpedBack) {
      return;
    }

    cancelAnimationFrame(rafRef.current);
    animatingRef.current = true;

    const startPercent = durationSeconds > 0
      ? (Math.min(durationSeconds, Math.max(0, pausedOffset)) / durationSeconds) * 100
      : 0;
    const remainingSeconds = Math.max(0.016, durationSeconds - Math.max(0, pausedOffset));

    bar.style.transition = 'none';
    bar.style.width = `${startPercent.toFixed(2)}%`;

    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = requestAnimationFrame(() => {
        if (!barRef.current) return;
        barRef.current.style.transition = `width ${remainingSeconds.toFixed(3)}s linear`;
        barRef.current.style.width = '100%';
      });
    });
  }, [isPlaying, durationSeconds, pausedOffset]);

  return (
    <div
      ref={barRef}
      className="h-full bg-blue-500 shadow-[0_0_4px_rgba(59,130,246,0.6)] relative will-change-[width]"
    >
      {children}
    </div>
  );
};
