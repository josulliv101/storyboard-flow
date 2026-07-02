import type React from "react";

export type RepeatedMediaFramesProps = {
  children: React.ReactNode;
};

export function RepeatedMediaFrames({ children }: RepeatedMediaFramesProps) {
  return (
    <div className="pointer-events-none relative h-full w-full overflow-hidden">
      <div className="absolute inset-0 flex items-center">{children}</div>
    </div>
  );
}
