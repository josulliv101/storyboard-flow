'use client';

import React, { useEffect, useRef, useState, type CSSProperties } from 'react';

export const aspectRatioOptions = {
  '16:9': { css: '16 / 9', factor: 16 / 9 },
  '4:3': { css: '4 / 3', factor: 4 / 3 },
  '21:9': { css: '21 / 9', factor: 21 / 9 },
  '1:1': { css: '1 / 1', factor: 1 / 1 },
  '9:16': { css: '9 / 16', factor: 9 / 16 },
} as const;

export type AspectRatioKey = keyof typeof aspectRatioOptions;

export function getAspectRatioSpec(aspectRatio: string = '16:9') {
  return aspectRatioOptions[aspectRatio as AspectRatioKey] ?? aspectRatioOptions['16:9'];
}

function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ height: 0, width: 0 });

  useEffect(() => {
    const element = ref.current;
    if (!element) return undefined;

    const updateSize = () => {
      setSize({
        height: element.clientHeight,
        width: element.clientWidth,
      });
    };

    updateSize();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateSize);
      return () => window.removeEventListener('resize', updateSize);
    }

    const observer = new ResizeObserver(updateSize);
    observer.observe(element);

    return () => observer.disconnect();
  }, []);

  return { ref, size };
}

export function ResponsiveAspectFrame({
  aspectRatio,
  cellClassName,
  cellTestId,
  children,
  frameClassName,
  frameDataAttributes,
  frameStyle,
  frameTestId,
}: {
  aspectRatio: string;
  cellClassName: string;
  cellTestId?: string;
  children: React.ReactNode;
  frameClassName: string;
  frameDataAttributes?: Record<`data-${string}`, string | number | boolean | undefined>;
  frameStyle?: CSSProperties;
  frameTestId?: string;
}) {
  const { ref, size } = useElementSize<HTMLDivElement>();
  const aspect = getAspectRatioSpec(aspectRatio);
  const measuredWidth = size.width > 0 && size.height > 0
    ? Math.min(size.width, size.height * aspect.factor)
    : 0;
  const measuredHeight = measuredWidth > 0 ? measuredWidth / aspect.factor : 0;

  return (
    <div
      ref={ref}
      data-testid={cellTestId}
      className={cellClassName}
      style={{ containerType: 'size' }}
    >
      <div
        data-testid={frameTestId}
        {...frameDataAttributes}
        className={frameClassName}
        style={{
          aspectRatio: aspect.css,
          height: measuredHeight > 0 ? `${measuredHeight}px` : undefined,
          maxHeight: '100%',
          maxWidth: '100%',
          width: measuredWidth > 0 ? `${measuredWidth}px` : 'min(100cqw, 100cqh)',
          ...frameStyle,
        }}
      >
        {children}
      </div>
    </div>
  );
}
