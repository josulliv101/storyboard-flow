"use client"

import type React from "react"
import { useRef, useCallback, useEffect, useState } from "react"
import { useVirtualizer } from "@tanstack/react-virtual"
import { Button } from '../core/button';
import { cn } from '../lib/utils';


export interface SmoothScrollListProps extends React.HTMLAttributes<HTMLDivElement> {
  itemCount?: number
  width?: number | string
}

type ResolvedMedia =
  | { kind: "image"; src: string; alt: string }
  | { kind: "video"; src: string; alt: string; poster?: string }

// Pattern of item kinds + aspect ratios. Height is constant; width is derived
// from each item's aspect ratio. The list renders any mix of images and video.
type MediaSpec =
  | { kind: "image"; aspect: number }
  | { kind: "video"; aspect: number; src: string }

// Reliable CC0 sample clips that allow cross-origin playback.
const VIDEO_SOURCES = [
  "https://www.w3schools.com/html/mov_bbb.mp4",
  "https://www.w3schools.com/html/movie.mp4",
  "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4",
]

const MEDIA: MediaSpec[] = [
  { kind: "image", aspect: 16 / 9 },
  { kind: "video", aspect: 16 / 9, src: VIDEO_SOURCES[0] },
  { kind: "image", aspect: 2 / 3 },
  { kind: "image", aspect: 1 },
  { kind: "video", aspect: 3 / 2, src: VIDEO_SOURCES[1] },
  { kind: "image", aspect: 16 / 9 },
  { kind: "image", aspect: 2 / 3 },
  { kind: "video", aspect: 1, src: VIDEO_SOURCES[2] },
  { kind: "image", aspect: 3 / 2 },
]

const ITEM_HEIGHT = 200
const MIN_WIDTH = 60
const MAX_WIDTH = 500

// Picsum fallback image keyed by a stable seed so each index is deterministic.
function getFallbackImage(index: number, imageWidth: number): { src: string; alt: string } {
  return {
    src: `https://picsum.photos/seed/smooth-scroll-${index}/${imageWidth}/${ITEM_HEIGHT}`,
    alt: `Image ${index}`,
  }
}

function getSpec(index: number) {
  return MEDIA[index % MEDIA.length]
}

function baseWidth(index: number) {
  return Math.round(ITEM_HEIGHT * getSpec(index).aspect)
}

function getMedia(index: number): ResolvedMedia {
  const spec = getSpec(index)
  if (spec.kind === "video") {
    return { kind: "video", src: spec.src, alt: `Video ${index}` }
  }
  // Request the image at its natural (base) width so trimming with object-cover
  // never forces a re-fetch from picsum.
  return { kind: "image", ...getFallbackImage(index, baseWidth(index)) }
}

export function SmoothScrollListV0({ itemCount = 1002, width = "100%", className, ...props }: SmoothScrollListProps) {
  const parentRef = useRef<HTMLDivElement>(null)

  // Per-item width overrides (set when the user trims an item).
  const widthsRef = useRef<Record<number, number>>({})
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  // Bump to force re-render after width changes so badges/handles stay in sync.
  const [, forceRender] = useState(0)

  const getItemWidth = useCallback((index: number) => {
    return widthsRef.current[index] ?? baseWidth(index)
  }, [])

  // Drag + inertia state (kept in refs so we don't trigger re-renders while dragging)
  const dragState = useRef({
    isDragging: false,
    startX: 0,
    startScrollLeft: 0,
    lastX: 0,
    lastTime: 0,
    velocity: 0,
    moved: false,
    pointerId: -1,
    captured: false,
  })
  const inertiaFrame = useRef<number | null>(null)

  // Resize (trim) state
  const resizeState = useRef({
    active: false,
    index: -1,
    edge: "right" as "left" | "right",
    startX: 0,
    startWidth: 0,
  })
  const resizeFrame = useRef<number | null>(null)

  const columnVirtualizer = useVirtualizer({
    horizontal: true,
    count: itemCount,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => getItemWidth(index),
  })

  const stopInertia = useCallback(() => {
    if (inertiaFrame.current !== null) {
      cancelAnimationFrame(inertiaFrame.current)
      inertiaFrame.current = null
    }
  }, [])

  const runInertia = useCallback(() => {
    const el = parentRef.current
    if (!el) return

    const friction = 0.95 // decay per frame
    const minVelocity = 0.1

    const step = () => {
      const state = dragState.current
      state.velocity *= friction

      if (Math.abs(state.velocity) < minVelocity) {
        inertiaFrame.current = null
        return
      }

      const maxScroll = el.scrollWidth - el.clientWidth
      const next = Math.min(Math.max(el.scrollLeft + state.velocity, 0), maxScroll)
      el.scrollLeft = next

      // Stop if we hit an edge
      if (next === 0 || next === maxScroll) {
        state.velocity = 0
        inertiaFrame.current = null
        return
      }

      inertiaFrame.current = requestAnimationFrame(step)
    }

    inertiaFrame.current = requestAnimationFrame(step)
  }, [])

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const el = parentRef.current
      if (!el) return
      stopInertia()

      const state = dragState.current
      state.isDragging = true
      state.moved = false
      state.startX = e.clientX
      state.startScrollLeft = el.scrollLeft
      state.lastX = e.clientX
      state.lastTime = e.timeStamp
      state.velocity = 0
      state.pointerId = e.pointerId
      state.captured = false
      // Do NOT capture here: capturing on pointerdown retargets the
      // subsequent `click` to this container, which prevents item clicks
      // from selecting. We capture lazily once a real drag begins.
    },
    [stopInertia],
  )

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const state = dragState.current
    const el = parentRef.current
    if (!state.isDragging || !el) return

    const dx = e.clientX - state.startX
    if (Math.abs(dx) > 3) {
      state.moved = true
      // Capture the pointer only once a real drag begins, so plain clicks
      // still reach the item and trigger selection.
      if (!state.captured) {
        el.setPointerCapture(state.pointerId)
        state.captured = true
      }
    }

    // Dragging right moves content right -> scroll left (natural drag)
    const maxScroll = el.scrollWidth - el.clientWidth
    el.scrollLeft = Math.min(Math.max(state.startScrollLeft - dx, 0), maxScroll)

    // Track velocity (px/frame ~ based on recent movement)
    const dt = e.timeStamp - state.lastTime
    if (dt > 0) {
      const instantaneous = -(e.clientX - state.lastX)
      // smooth the velocity a bit
      state.velocity = 0.8 * instantaneous + 0.2 * state.velocity
    }
    state.lastX = e.clientX
    state.lastTime = e.timeStamp
  }, [])

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const state = dragState.current
      const el = parentRef.current
      if (!state.isDragging || !el) return

      state.isDragging = false
      if (state.captured) {
        el.releasePointerCapture(e.pointerId)
        state.captured = false
      }

      // Kick off inertia if there's meaningful velocity
      if (Math.abs(state.velocity) > 1) {
        runInertia()
      }
    },
    [runInertia],
  )

  // ---- Trim handle (resize) interaction ----
  const handleResizeDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>, index: number, edge: "left" | "right") => {
      // Don't let the resize gesture start a scroll-drag.
      e.stopPropagation()
      e.preventDefault()
      stopInertia()

      const rs = resizeState.current
      rs.active = true
      rs.index = index
      rs.edge = edge
      rs.startX = e.clientX
      rs.startWidth = getItemWidth(index)
        ; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    },
    [getItemWidth, stopInertia],
  )

  const handleResizeMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const rs = resizeState.current
      if (!rs.active) return
      e.stopPropagation()

      const dx = e.clientX - rs.startX
      // Right edge grows toward the right; left edge grows toward the left.
      const delta = rs.edge === "right" ? dx : -dx
      const next = Math.min(Math.max(rs.startWidth + delta, MIN_WIDTH), MAX_WIDTH)
      widthsRef.current[rs.index] = next

      if (resizeFrame.current === null) {
        resizeFrame.current = requestAnimationFrame(() => {
          resizeFrame.current = null
          columnVirtualizer.measure()
          forceRender((v) => v + 1)
        })
      }
    },
    [columnVirtualizer],
  )

  const handleResizeUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const rs = resizeState.current
      if (!rs.active) return
      e.stopPropagation()
      rs.active = false
        ; (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
      columnVirtualizer.measure()
      forceRender((v) => v + 1)
    },
    [columnVirtualizer],
  )

  // Cleanup any running animation on unmount
  useEffect(() => {
    return () => {
      stopInertia()
      if (resizeFrame.current !== null) cancelAnimationFrame(resizeFrame.current)
    }
  }, [stopInertia])

  return (
    <div
      className={cn(
        "flex flex-col gap-4 w-[600px] max-w-full p-4 bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl font-sans",
        className,
      )}
      {...props}
    >
      <div className="flex justify-between items-center">
        <h3 className="text-sm font-semibold text-zinc-200">Drag, Inertia &amp; Trim</h3>
        <span className="text-[10px] bg-zinc-800 text-zinc-400 px-2 py-0.5 rounded font-mono">
          {itemCount.toLocaleString()} Items
        </span>
      </div>

      <p className="text-[11px] text-zinc-500 leading-relaxed -mt-1">
        Drag to scroll with inertia. Click a clip to select it, then drag its left or right edge to trim the width.
      </p>

      {/* Control Buttons */}
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          id="scroll-to-100"
          className="flex-1"
          onClick={() => {
            stopInertia()
            columnVirtualizer.scrollToIndex(100, { behavior: "smooth", align: "start" })
          }}
        >
          To 100
        </Button>
        <Button
          variant="outline"
          size="sm"
          id="scroll-to-800"
          className="flex-1"
          onClick={() => {
            stopInertia()
            columnVirtualizer.scrollToIndex(Math.min(800, itemCount - 1), { behavior: "smooth", align: "start" })
          }}
        >
          To 800
        </Button>
        <Button
          variant="outline"
          size="sm"
          id="scroll-to-0"
          className="flex-1"
          onClick={() => {
            stopInertia()
            columnVirtualizer.scrollToIndex(0, { behavior: "smooth", align: "start" })
          }}
        >
          Start
        </Button>
      </div>

      {/* Scrollable Viewport Container (drag to scroll with inertia) */}
      <div
        ref={parentRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className="w-full overflow-x-auto border border-zinc-800 rounded-lg bg-zinc-950 cursor-grab active:cursor-grabbing touch-none select-none"
        style={{ width, contain: "layout paint" }}
      >
        <div
          className="relative"
          style={{
            width: `${columnVirtualizer.getTotalSize()}px`,
            height: `${ITEM_HEIGHT}px`,
          }}
        >
          {columnVirtualizer.getVirtualItems().map((virtualCol) => {
            const media = getMedia(virtualCol.index)
            const colWidth = getItemWidth(virtualCol.index)
            const isSelected = selectedIndex === virtualCol.index

            return (
              <div
                key={virtualCol.index}
                data-index={virtualCol.index}
                className="absolute top-0 left-0 h-full p-1.5"
                style={{
                  width: `${colWidth}px`,
                  transform: `translateX(${virtualCol.start}px)`,
                }}
                onClick={() => {
                  // Ignore the click that ends a scroll-drag.
                  if (dragState.current.moved) return
                  setSelectedIndex((prev) => (prev === virtualCol.index ? null : virtualCol.index))
                }}
              >
                <div
                  className={cn(
                    "relative h-full w-full overflow-hidden rounded-md bg-zinc-800 transition-shadow",
                    isSelected ? "ring-2 ring-amber-400 shadow-lg shadow-amber-400/20" : "ring-1 ring-transparent",
                  )}
                >
                  {media.kind === "video" ? (
                    <video
                      src={media.src}
                      poster={media.poster}
                      muted
                      loop
                      playsInline
                      autoPlay
                      preload="metadata"
                      aria-label={media.alt}
                      className="h-full w-full object-cover pointer-events-none"
                    />
                  ) : (
                    <img
                      src={media.src || "/placeholder.svg"}
                      alt={media.alt}
                      draggable={false}
                      className="h-full w-full object-cover pointer-events-none"
                    />
                  )}
                  {media.kind === "video" && (
                    <span className="absolute left-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-amber-300">
                      VIDEO
                    </span>
                  )}
                  <span className="absolute bottom-1 right-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-mono text-zinc-100">
                    {Math.round(colWidth)}×{ITEM_HEIGHT}
                  </span>

                  {/* Video-clip style trim handles, shown when selected */}
                  {isSelected && (
                    <>
                      {/* dim overlay border */}
                      <div className="pointer-events-none absolute inset-0 rounded-md border-2 border-amber-400" />

                      <TrimHandle
                        edge="left"
                        onPointerDown={(e) => handleResizeDown(e, virtualCol.index, "left")}
                        onPointerMove={handleResizeMove}
                        onPointerUp={handleResizeUp}
                        onPointerCancel={handleResizeUp}
                      />
                      <TrimHandle
                        edge="right"
                        onPointerDown={(e) => handleResizeDown(e, virtualCol.index, "right")}
                        onPointerMove={handleResizeMove}
                        onPointerUp={handleResizeUp}
                        onPointerCancel={handleResizeUp}
                      />
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function TrimHandle({
  edge,
  ...handlers
}: {
  edge: "left" | "right"
} & Pick<
  React.HTMLAttributes<HTMLDivElement>,
  "onPointerDown" | "onPointerMove" | "onPointerUp" | "onPointerCancel"
>) {
  return (
    <div
      role="slider"
      aria-label={`Trim ${edge} edge`}
      aria-valuemin={MIN_WIDTH}
      aria-valuemax={MAX_WIDTH}
      className={cn(
        "absolute top-0 z-10 flex h-full w-4 cursor-ew-resize touch-none items-center justify-center bg-amber-400",
        edge === "left" ? "left-0 rounded-l-md" : "right-0 rounded-r-md",
      )}
      onClick={(e) => e.stopPropagation()}
      {...handlers}
    >
      <span className="h-8 w-0.5 rounded bg-zinc-900/70" />
    </div>
  )
}
