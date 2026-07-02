type TimelinePlayheadProps = {
  itemHeight: number;
  itemTop: number;
  left: number;
};

export function TimelinePlayhead({
  itemHeight,
  itemTop,
  left,
}: TimelinePlayheadProps) {
  return (
    <div
      data-testid="timeline-playhead"
      className="absolute top-0 bottom-0 z-40 w-[2.5px] bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.9)] pointer-events-none"
      style={{
        left: `${left}px`,
        top: `${itemTop}px`,
        height: `${itemHeight}px`,
      }}
    />
  );
}
