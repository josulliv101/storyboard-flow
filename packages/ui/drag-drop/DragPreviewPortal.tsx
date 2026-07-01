"use client";

import React from "react";
import { createPortal } from "react-dom";

export type DragPreviewCoordinates = {
  clientX: number;
  clientY: number;
  pointerOffsetX: number;
  pointerOffsetY: number;
};

export type DragPreviewPortalProps = {
  preview: DragPreviewCoordinates | null;
  width: number;
  height: number;
  children: React.ReactNode;
  className?: string;
  scale?: number;
  testId?: string;
};

export function DragPreviewPortal({
  preview,
  width,
  height,
  children,
  className = "fixed pointer-events-none z-[9999]",
  scale = 1.03,
  testId,
}: DragPreviewPortalProps) {
  const [isMounted, setIsMounted] = React.useState(false);

  React.useEffect(() => {
    setIsMounted(true);
  }, []);

  if (!preview || !isMounted || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      className={className}
      data-testid={testId}
      style={{
        left: `${preview.clientX - preview.pointerOffsetX}px`,
        top: `${preview.clientY - preview.pointerOffsetY}px`,
        width: `${width}px`,
        height: `${height}px`,
        transform: `scale(${scale})`,
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
