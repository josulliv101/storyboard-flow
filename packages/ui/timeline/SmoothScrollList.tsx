"use client"

import type React from "react"
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Button } from "../core/button"
import { cn } from "../lib/utils"

export interface SmoothScrollListProps extends React.HTMLAttributes<HTMLDivElement> {
  itemCount?: number
  /** Width of the scrollable viewport. `width` is kept as a backwards-compatible alias. */
  viewportWidth?: number | string
  width?: number | string
  /** Timeline zoom level. Larger values make clips visually wider. */
  pixelsPerSecond?: number
}

type MediaKind = "image" | "video"

type TimelineClip = {
  id: string
  index: number
  kind: MediaKind
  src: string
  alt: string
  poster?: string
  aspect: number
  trackIndex: number

  /** Absolute timeline position. */
  startTime: number
  /** Visible duration after trimming. */
  duration: number
  /** Total source duration available for this clip. */
  sourceDuration: number
  /** Amount trimmed from the source beginning. */
  trimIn: number
  /** Amount trimmed from the source end. */
  trimOut: number
}

type MediaSpec =
  | { kind: "image"; aspect: number }
  | { kind: "video"; aspect: number; src: string }

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
const DEFAULT_PIXELS_PER_SECOND = 100
const CLIP_GAP_SECONDS = 0.12
const DRAG_THRESHOLD_PX = 3
const RESIZE_KEY_STEP_PX = 10
const VISIBLE_OVERSCAN_PX = 700

// Gives the first clips room to grow left before hitting time 0.
// Without this, a packed sequence cannot expand a middle clip to the left
// without overlapping earlier clips.
const TIMELINE_LEADING_PADDING_SECONDS = 5
const TIMELINE_TRAILING_PADDING_SECONDS = 5

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

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

function createClip(index: number, startTime: number, pixelsPerSecond: number): TimelineClip {
  const spec = getSpec(index)
  const visibleWidth = clamp(baseWidth(index), MIN_WIDTH, MAX_WIDTH)
  const sourceWidth = MAX_WIDTH
  const sourceDuration = sourceWidth / pixelsPerSecond
  const duration = visibleWidth / pixelsPerSecond

  // Demo clips have hidden source material on both sides so either handle can
  // shrink and then expand again. Real media should use real source duration,
  // trimIn, and trimOut values instead.
  const hiddenDuration = Math.max(0, sourceDuration - duration)
  const trimIn = hiddenDuration / 2
  const trimOut = hiddenDuration - trimIn

  if (spec.kind === "video") {
    return {
      id: `clip-${index}`,
      index,
      kind: "video",
      src: spec.src,
      alt: `Video ${index}`,
      aspect: spec.aspect,
      trackIndex: 0,
      startTime,
      duration,
      sourceDuration,
      trimIn,
      trimOut,
    }
  }

  const image = getFallbackImage(index, sourceWidth)

  return {
    id: `clip-${index}`,
    index,
    kind: "image",
    src: image.src,
    alt: image.alt,
    aspect: spec.aspect,
    trackIndex: 0,
    startTime,
    duration,
    sourceDuration,
    trimIn,
    trimOut,
  }
}

function createInitialClips(itemCount: number, pixelsPerSecond: number) {
  const clips: TimelineClip[] = []
  let nextStartTime = TIMELINE_LEADING_PADDING_SECONDS

  for (let index = 0; index < itemCount; index += 1) {
    const clip = createClip(index, nextStartTime, pixelsPerSecond)
    clips.push(clip)
    nextStartTime += clip.duration + CLIP_GAP_SECONDS
  }

  return clips
}

function getPackedDurationBefore(clips: TimelineClip[], anchorIndex: number) {
  let durationBefore = 0

  for (let index = 0; index < anchorIndex; index += 1) {
    durationBefore += clips[index].duration
    durationBefore += CLIP_GAP_SECONDS
  }

  return durationBefore
}

function layoutClipsAroundAnchor(clips: TimelineClip[], anchorIndex: number, anchorClip: TimelineClip) {
  const nextClips = clips.map((clip) => ({ ...clip }))
  nextClips[anchorIndex] = anchorClip

  // Pack clips before the anchor backwards. This is the key difference from
  // the awkward version: when the left handle moves, the selected clip's left
  // edge actually moves, while earlier clips respond by sliding with it.
  for (let index = anchorIndex - 1; index >= 0; index -= 1) {
    const clipToRight = nextClips[index + 1]
    const endTime = clipToRight.startTime - CLIP_GAP_SECONDS
    nextClips[index] = {
      ...nextClips[index],
      startTime: endTime - nextClips[index].duration,
    }
  }

  // Pack clips after the anchor forwards. Right trimming moves downstream clips;
  // left trimming keeps the right edge fixed, so downstream clips usually stay put.
  for (let index = anchorIndex + 1; index < nextClips.length; index += 1) {
    const clipToLeft = nextClips[index - 1]
    nextClips[index] = {
      ...nextClips[index],
      startTime: clipToLeft.startTime + clipToLeft.duration + CLIP_GAP_SECONDS,
    }
  }

  return nextClips
}

function resizeClipsFromBaseline({
  baselineClips,
  anchorIndex,
  edge,
  deltaTime,
  minDuration,
}: {
  baselineClips: TimelineClip[]
  anchorIndex: number
  edge: "left" | "right"
  deltaTime: number
  minDuration: number
}) {
  const clip = baselineClips[anchorIndex]
  if (!clip) return baselineClips

  if (edge === "left") {
    const fixedRightTime = clip.startTime + clip.duration
    const maxDurationFromSource = clip.sourceDuration - clip.trimOut
    const earliestStartFromSource = fixedRightTime - maxDurationFromSource
    const earliestStartFromLayout = getPackedDurationBefore(baselineClips, anchorIndex)
    const latestStart = fixedRightTime - minDuration

    const nextStartTime = clamp(
      clip.startTime + deltaTime,
      Math.max(earliestStartFromSource, earliestStartFromLayout),
      latestStart,
    )
    const nextDuration = fixedRightTime - nextStartTime
    const nextTrimIn = clamp(
      clip.sourceDuration - clip.trimOut - nextDuration,
      0,
      clip.sourceDuration - clip.trimOut - minDuration,
    )

    const resizedClip: TimelineClip = {
      ...clip,
      startTime: nextStartTime,
      duration: nextDuration,
      trimIn: nextTrimIn,
    }

    return layoutClipsAroundAnchor(baselineClips, anchorIndex, resizedClip)
  }

  const maxDurationFromSource = clip.sourceDuration - clip.trimIn
  const nextDuration = clamp(clip.duration + deltaTime, minDuration, maxDurationFromSource)
  const nextTrimOut = clamp(
    clip.sourceDuration - clip.trimIn - nextDuration,
    0,
    clip.sourceDuration - clip.trimIn - minDuration,
  )

  const resizedClip: TimelineClip = {
    ...clip,
    duration: nextDuration,
    trimOut: nextTrimOut,
  }

  return layoutClipsAroundAnchor(baselineClips, anchorIndex, resizedClip)
}

export function SmoothScrollList({
  itemCount = 100,
  viewportWidth,
  width = "100%",
  pixelsPerSecond = DEFAULT_PIXELS_PER_SECOND,
  className,
  style,
  ...props
}: SmoothScrollListProps) {
  const parentRef = useRef<HTMLDivElement>(null)
  const scrollFrameRef = useRef<number | null>(null)
  const inertiaFrameRef = useRef<number | null>(null)
  const resizeFrameRef = useRef<number | null>(null)
  const pendingClipsRef = useRef<TimelineClip[] | null>(null)

  const safeItemCount = Math.max(0, Math.floor(itemCount))
  const resolvedViewportWidth = viewportWidth ?? width
  const safePixelsPerSecond = Math.max(20, pixelsPerSecond)
  const minDuration = MIN_WIDTH / safePixelsPerSecond

  const [clips, setClips] = useState<TimelineClip[]>(() => createInitialClips(safeItemCount, safePixelsPerSecond))
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const [scrollLeft, setScrollLeft] = useState(0)
  const [viewportClientWidth, setViewportClientWidth] = useState(0)

  const dragState = useRef({
    isDragging: false,
    startX: 0,
    startScrollLeft: 0,
    lastX: 0,
    lastTime: 0,
    velocity: 0,
    moved: false,
    pointerId: -1,
    pressedIndex: null as number | null,
  })

  const resizeState = useRef({
    active: false,
    anchorIndex: -1,
    edge: "right" as "left" | "right",
    startX: 0,
    baselineClips: null as TimelineClip[] | null,
  })

  useEffect(() => {
    setClips(createInitialClips(safeItemCount, safePixelsPerSecond))
    setSelectedIndex(null)
    setScrollLeft(0)

    if (parentRef.current) {
      parentRef.current.scrollLeft = 0
    }
  }, [safeItemCount, safePixelsPerSecond])

  const totalDuration = useMemo(() => {
    if (clips.length === 0) return 0

    return clips.reduce((max, clip) => Math.max(max, clip.startTime + clip.duration), 0) + TIMELINE_TRAILING_PADDING_SECONDS
  }, [clips])

  const timelineWidth = Math.max(viewportClientWidth || 1, Math.ceil(totalDuration * safePixelsPerSecond))

  const visibleClips = useMemo(() => {
    const visibleStartTime = Math.max(0, (scrollLeft - VISIBLE_OVERSCAN_PX) / safePixelsPerSecond)
    const visibleEndTime = (scrollLeft + viewportClientWidth + VISIBLE_OVERSCAN_PX) / safePixelsPerSecond

    return clips.filter((clip) => {
      const clipStart = clip.startTime
      const clipEnd = clip.startTime + clip.duration
      return clipEnd >= visibleStartTime && clipStart <= visibleEndTime
    })
  }, [clips, safePixelsPerSecond, scrollLeft, viewportClientWidth])

  const stopInertia = useCallback(() => {
    if (inertiaFrameRef.current !== null) {
      cancelAnimationFrame(inertiaFrameRef.current)
      inertiaFrameRef.current = null
    }
  }, [])

  const syncScrollState = useCallback(() => {
    const el = parentRef.current
    if (!el) return

    setScrollLeft(el.scrollLeft)
    setViewportClientWidth(el.clientWidth)
  }, [])

  const handleScroll = useCallback(() => {
    if (scrollFrameRef.current !== null) return

    scrollFrameRef.current = requestAnimationFrame(() => {
      scrollFrameRef.current = null
      syncScrollState()
    })
  }, [syncScrollState])

  useEffect(() => {
    const el = parentRef.current
    if (!el) return

    syncScrollState()

    const observer = new ResizeObserver(() => {
      syncScrollState()
    })

    observer.observe(el)

    return () => {
      observer.disconnect()
    }
  }, [syncScrollState])

  const scheduleClips = useCallback((nextClips: TimelineClip[]) => {
    pendingClipsRef.current = nextClips

    if (resizeFrameRef.current !== null) return

    resizeFrameRef.current = requestAnimationFrame(() => {
      const pendingClips = pendingClipsRef.current
      pendingClipsRef.current = null
      resizeFrameRef.current = null

      if (!pendingClips) return
      setClips(pendingClips)
    })
  }, [])

  const applyClipsNow = useCallback((nextClips: TimelineClip[]) => {
    if (resizeFrameRef.current !== null) {
      cancelAnimationFrame(resizeFrameRef.current)
      resizeFrameRef.current = null
    }

    pendingClipsRef.current = null
    setClips(nextClips)
  }, [])

  const runInertia = useCallback(() => {
    const el = parentRef.current
    if (!el) return

    const friction = 0.95
    const minVelocity = 0.1

    const step = () => {
      const state = dragState.current
      state.velocity *= friction

      if (Math.abs(state.velocity) < minVelocity) {
        inertiaFrameRef.current = null
        return
      }

      const maxScroll = Math.max(0, el.scrollWidth - el.clientWidth)
      const next = clamp(el.scrollLeft + state.velocity, 0, maxScroll)
      el.scrollLeft = next
      setScrollLeft(next)

      if (next === 0 || next === maxScroll) {
        state.velocity = 0
        inertiaFrameRef.current = null
        return
      }

      inertiaFrameRef.current = requestAnimationFrame(step)
    }

    inertiaFrameRef.current = requestAnimationFrame(step)
  }, [])

  const scrollToClipIndex = useCallback(
    (targetIndex: number) => {
      const el = parentRef.current
      if (!el || clips.length === 0) return

      stopInertia()

      const index = clamp(Math.floor(targetIndex), 0, clips.length - 1)
      const clip = clips[index]
      const maxScroll = Math.max(0, el.scrollWidth - el.clientWidth)
      const nextScrollLeft = clamp(clip.startTime * safePixelsPerSecond, 0, maxScroll)

      el.scrollTo({ left: nextScrollLeft, behavior: "smooth" })
    },
    [clips, safePixelsPerSecond, stopInertia],
  )

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.pointerType === "mouse" && e.button !== 0) return

      const el = parentRef.current
      if (!el) return

      stopInertia()

      const target = e.target as HTMLElement
      const item = target.closest("[data-clip-index]") as HTMLElement | null
      const rawIndex = item?.dataset.clipIndex
      const pressedIndex = rawIndex === undefined ? null : Number(rawIndex)

      const state = dragState.current
      state.isDragging = true
      state.moved = false
      state.startX = e.clientX
      state.startScrollLeft = el.scrollLeft
      state.lastX = e.clientX
      state.lastTime = e.timeStamp
      state.velocity = 0
      state.pointerId = e.pointerId
      state.pressedIndex = Number.isFinite(pressedIndex) ? pressedIndex : null

      el.setPointerCapture(e.pointerId)
    },
    [stopInertia],
  )

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const state = dragState.current
    const el = parentRef.current
    if (!state.isDragging || !el) return

    const dx = e.clientX - state.startX

    if (!state.moved && Math.abs(dx) <= DRAG_THRESHOLD_PX) return

    state.moved = true
    e.preventDefault()

    const maxScroll = Math.max(0, el.scrollWidth - el.clientWidth)
    const nextScrollLeft = clamp(state.startScrollLeft - dx, 0, maxScroll)
    el.scrollLeft = nextScrollLeft
    setScrollLeft(nextScrollLeft)

    const dt = e.timeStamp - state.lastTime
    if (dt > 0) {
      const instantaneous = (-(e.clientX - state.lastX) / dt) * 16.67
      state.velocity = 0.7 * instantaneous + 0.3 * state.velocity
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

      if (el.hasPointerCapture(e.pointerId)) {
        el.releasePointerCapture(e.pointerId)
      }

      if (!state.moved && state.pressedIndex !== null) {
        const index = state.pressedIndex
        setSelectedIndex((previous) => (previous === index ? null : index))
      } else if (Math.abs(state.velocity) > 1) {
        runInertia()
      }

      state.pointerId = -1
      state.pressedIndex = null
    },
    [runInertia],
  )

  const handleResizeDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>, clip: TimelineClip, edge: "left" | "right") => {
      e.stopPropagation()
      e.preventDefault()
      stopInertia()
      setSelectedIndex(clip.index)

      const rs = resizeState.current
      rs.active = true
      rs.anchorIndex = clip.index
      rs.edge = edge
      rs.startX = e.clientX
      rs.baselineClips = clips.map((currentClip) => ({ ...currentClip }))

      const target = e.currentTarget as HTMLElement
      target.setPointerCapture(e.pointerId)
    },
    [clips, stopInertia],
  )

  const handleResizeMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const rs = resizeState.current
      if (!rs.active || !rs.baselineClips) return

      e.stopPropagation()
      e.preventDefault()

      const deltaTime = (e.clientX - rs.startX) / safePixelsPerSecond
      const nextClips = resizeClipsFromBaseline({
        baselineClips: rs.baselineClips,
        anchorIndex: rs.anchorIndex,
        edge: rs.edge,
        deltaTime,
        minDuration,
      })

      scheduleClips(nextClips)
    },
    [minDuration, safePixelsPerSecond, scheduleClips],
  )

  const handleResizeUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const rs = resizeState.current
      if (!rs.active || !rs.baselineClips) return

      e.stopPropagation()
      e.preventDefault()

      const deltaTime = (e.clientX - rs.startX) / safePixelsPerSecond
      const nextClips = resizeClipsFromBaseline({
        baselineClips: rs.baselineClips,
        anchorIndex: rs.anchorIndex,
        edge: rs.edge,
        deltaTime,
        minDuration,
      })

      applyClipsNow(nextClips)

      rs.active = false
      rs.anchorIndex = -1
      rs.baselineClips = null

      const target = e.currentTarget as HTMLElement
      if (target.hasPointerCapture(e.pointerId)) {
        target.releasePointerCapture(e.pointerId)
      }
    },
    [applyClipsNow, minDuration, safePixelsPerSecond],
  )

  const handleResizeKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>, clip: TimelineClip, edge: "left" | "right") => {
      let deltaPx = 0

      if (e.key === "Home") {
        deltaPx = edge === "left" ? -MAX_WIDTH : -MAX_WIDTH
      } else if (e.key === "End") {
        deltaPx = edge === "left" ? MAX_WIDTH : MAX_WIDTH
      } else if (e.key === "ArrowLeft") {
        deltaPx = -RESIZE_KEY_STEP_PX
      } else if (e.key === "ArrowRight") {
        deltaPx = RESIZE_KEY_STEP_PX
      } else {
        return
      }

      e.preventDefault()
      e.stopPropagation()
      stopInertia()
      setSelectedIndex(clip.index)

      const nextClips = resizeClipsFromBaseline({
        baselineClips: clips.map((currentClip) => ({ ...currentClip })),
        anchorIndex: clip.index,
        edge,
        deltaTime: deltaPx / safePixelsPerSecond,
        minDuration,
      })

      applyClipsNow(nextClips)
    },
    [applyClipsNow, clips, minDuration, safePixelsPerSecond, stopInertia],
  )

  useEffect(() => {
    return () => {
      stopInertia()

      if (scrollFrameRef.current !== null) {
        cancelAnimationFrame(scrollFrameRef.current)
      }

      if (resizeFrameRef.current !== null) {
        cancelAnimationFrame(resizeFrameRef.current)
      }
    }
  }, [stopInertia])

  return (
    <div
      {...props}
      className={cn(
        "flex w-[600px] max-w-full flex-col gap-4 rounded-xl border border-zinc-800 bg-zinc-900 p-4 font-sans shadow-2xl",
        className,
      )}
      style={style}
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-200">Anchored Timeline Trim</h3>
        <span className="rounded bg-zinc-800 px-2 py-0.5 font-mono text-[10px] text-zinc-400">
          {visibleClips.length}/{clips.length} rendered
        </span>
      </div>

      <p className="-mt-1 text-[11px] leading-relaxed text-zinc-500">
        Drag to scroll. Click a clip to select it. Left trim moves the left edge under your pointer while keeping the
        right edge fixed; neighboring clips repack around the selected clip.
      </p>

      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          id="scroll-to-100"
          className="flex-1"
          disabled={clips.length === 0}
          onClick={() => scrollToClipIndex(100)}
        >
          To 100
        </Button>
        <Button
          variant="outline"
          size="sm"
          id="scroll-to-800"
          className="flex-1"
          disabled={clips.length === 0}
          onClick={() => scrollToClipIndex(800)}
        >
          To 800
        </Button>
        <Button
          variant="outline"
          size="sm"
          id="scroll-to-0"
          className="flex-1"
          disabled={clips.length === 0}
          onClick={() => scrollToClipIndex(0)}
        >
          Start
        </Button>
      </div>

      <div
        ref={parentRef}
        onScroll={handleScroll}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className="w-full cursor-grab touch-none select-none overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-950 active:cursor-grabbing"
        style={{ width: resolvedViewportWidth, contain: "layout paint" }}
      >
        <div
          className="relative"
          style={{
            width: `${timelineWidth}px`,
            height: `${ITEM_HEIGHT}px`,
          }}
        >
          {clips.length === 0 ? (
            <div className="flex h-full w-full items-center justify-center text-xs text-zinc-500">No items</div>
          ) : (
            visibleClips.map((clip) => (
              <TimelineClipItem
                key={clip.id}
                clip={clip}
                pixelsPerSecond={safePixelsPerSecond}
                height={ITEM_HEIGHT}
                isSelected={selectedIndex === clip.index}
                onResizeDown={handleResizeDown}
                onResizeMove={handleResizeMove}
                onResizeUp={handleResizeUp}
                onResizeKeyDown={handleResizeKeyDown}
              />
            ))
          )}
        </div>
      </div>
    </div>
  )
}

type TimelineClipItemProps = {
  clip: TimelineClip
  pixelsPerSecond: number
  height: number
  isSelected: boolean
  onResizeDown: (e: React.PointerEvent<HTMLDivElement>, clip: TimelineClip, edge: "left" | "right") => void
  onResizeMove: (e: React.PointerEvent<HTMLDivElement>) => void
  onResizeUp: (e: React.PointerEvent<HTMLDivElement>) => void
  onResizeKeyDown: (e: React.KeyboardEvent<HTMLDivElement>, clip: TimelineClip, edge: "left" | "right") => void
}

const TimelineClipItem = memo(function TimelineClipItem({
  clip,
  pixelsPerSecond,
  height,
  isSelected,
  onResizeDown,
  onResizeMove,
  onResizeUp,
  onResizeKeyDown,
}: TimelineClipItemProps) {
  const left = clip.startTime * pixelsPerSecond
  const width = clip.duration * pixelsPerSecond
  const sourceWidth = clip.sourceDuration * pixelsPerSecond
  const trimInPx = clip.trimIn * pixelsPerSecond

  return (
    <div
      data-clip-index={clip.index}
      className="absolute top-0 h-full p-1.5"
      style={{
        width: `${width}px`,
        transform: `translateX(${left}px)`,
      }}
    >
      <div
        className={cn(
          "relative h-full w-full overflow-hidden rounded-md bg-zinc-800 transition-shadow",
          isSelected ? "ring-2 ring-amber-400 shadow-lg shadow-amber-400/20" : "ring-1 ring-transparent",
        )}
      >
        <div
          className="pointer-events-none h-full"
          style={{
            width: `${sourceWidth}px`,
            transform: `translateX(${-trimInPx}px)`,
          }}
        >
          {clip.kind === "video" ? (
            <VideoTile src={clip.src} poster={clip.poster} alt={clip.alt} active={isSelected} />
          ) : (
            <img src={clip.src} alt={clip.alt} draggable={false} className="h-full w-full object-cover" />
          )}
        </div>

        {clip.kind === "video" && (
          <span className="absolute left-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-amber-300">
            VIDEO
          </span>
        )}

        <span className="absolute bottom-1 right-1 rounded bg-black/60 px-1.5 py-0.5 font-mono text-[10px] text-zinc-100">
          {Math.round(width)}px · {clip.startTime.toFixed(1)}s
        </span>

        {isSelected && (
          <>
            <div className="pointer-events-none absolute inset-0 rounded-md border-2 border-amber-400" />
            <TrimHandle
              edge="left"
              currentWidth={width}
              onPointerDown={(e) => onResizeDown(e, clip, "left")}
              onPointerMove={onResizeMove}
              onPointerUp={onResizeUp}
              onPointerCancel={onResizeUp}
              onKeyDown={(e) => onResizeKeyDown(e, clip, "left")}
            />
            <TrimHandle
              edge="right"
              currentWidth={width}
              onPointerDown={(e) => onResizeDown(e, clip, "right")}
              onPointerMove={onResizeMove}
              onPointerUp={onResizeUp}
              onPointerCancel={onResizeUp}
              onKeyDown={(e) => onResizeKeyDown(e, clip, "right")}
            />
          </>
        )}
      </div>
    </div>
  )
})

type VideoTileProps = {
  src: string
  alt: string
  active: boolean
  poster?: string
}

function VideoTile({ src, poster, alt, active }: VideoTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    if (active) {
      void video.play().catch(() => {
        // Ignore autoplay failures. The user can still select/scroll normally.
      })
      return
    }

    video.pause()

    try {
      video.currentTime = 0
    } catch {
      // Some browsers can reject seeking before metadata is available.
    }
  }, [active, src])

  return (
    <video
      ref={videoRef}
      src={src}
      poster={poster}
      muted
      loop={active}
      playsInline
      preload={active ? "auto" : "metadata"}
      aria-label={alt}
      className="h-full w-full object-cover"
    />
  )
}

type TrimHandleProps = {
  edge: "left" | "right"
  currentWidth: number
} & Pick<
  React.HTMLAttributes<HTMLDivElement>,
  "onPointerDown" | "onPointerMove" | "onPointerUp" | "onPointerCancel" | "onKeyDown"
>

function TrimHandle({ edge, currentWidth, ...handlers }: TrimHandleProps) {
  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label={`Trim ${edge} edge`}
      aria-valuemin={MIN_WIDTH}
      aria-valuemax={MAX_WIDTH}
      aria-valuenow={Math.round(currentWidth)}
      className={cn(
        "absolute top-0 z-10 flex h-full w-4 cursor-ew-resize touch-none items-center justify-center bg-amber-400 outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950",
        edge === "left" ? "left-0 rounded-l-md" : "right-0 rounded-r-md",
      )}
      onClick={(e) => e.stopPropagation()}
      {...handlers}
    >
      <span className="h-8 w-0.5 rounded bg-zinc-900/70" />
    </div>
  )
}
