"use client"

import type React from "react"
import { useRef, useCallback, useEffect, useState } from "react"
import { useVirtualizer } from "@tanstack/react-virtual"
import { Button } from '../core/button'
import { cn } from '../lib/utils'

export interface SmoothScrollListProps extends React.HTMLAttributes<HTMLDivElement> {
    itemCount?: number
    width?: number | string
}

type ResolvedMedia =
    | { kind: "image"; src: string; alt: string }
    | { kind: "video"; src: string; alt: string; poster?: string }

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
    return { kind: "image", ...getFallbackImage(index, baseWidth(index)) }
}

// Custom hook for forcing re-renders cleanly
function useForceUpdate() {
    const [, setTick] = useState(0)
    return useCallback(() => setTick((tick) => tick + 1), [])
}

// Based on V0 version with some bug fixes
export function SmoothScrollListGemini({ itemCount = 1002, width = "100%", className, ...props }: SmoothScrollListProps) {
    const parentRef = useRef<HTMLDivElement>(null)
    const widthsRef = useRef<Record<number, number>>({})
    const [selectedIndex, setSelectedIndex] = useState<number | null>(null)

    const forceUpdate = useForceUpdate()

    const getItemWidth = useCallback((index: number) => {
        return widthsRef.current[index] ?? baseWidth(index)
    }, [])

    const dragState = useRef({
        isDragging: false,
        startX: 0,
        startScrollLeft: 0,
        velocity: 0,
        moved: false,
        pointerId: -1,
        captured: false,
    })

    const inertiaFrame = useRef<number | null>(null)

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

        const friction = 0.95
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
            state.velocity = 0
            state.pointerId = e.pointerId
            state.captured = false
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
            if (!state.captured) {
                el.setPointerCapture(state.pointerId)
                state.captured = true
            }
        }

        const maxScroll = el.scrollWidth - el.clientWidth
        el.scrollLeft = Math.min(Math.max(state.startScrollLeft - dx, 0), maxScroll)

        // Use e.movementX for cleaner velocity smoothing
        if (e.movementX !== 0) {
            const instantaneous = -e.movementX
            state.velocity = 0.8 * instantaneous + 0.2 * state.velocity
        }
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

            if (Math.abs(state.velocity) > 1) {
                runInertia()
            }
        },
        [runInertia],
    )

    const handleResizeDown = useCallback(
        (e: React.PointerEvent<HTMLDivElement>, index: number, edge: "left" | "right") => {
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
            const delta = rs.edge === "right" ? dx : -dx
            const next = Math.min(Math.max(rs.startWidth + delta, MIN_WIDTH), MAX_WIDTH)

            widthsRef.current[rs.index] = next

            if (resizeFrame.current === null) {
                resizeFrame.current = requestAnimationFrame(() => {
                    resizeFrame.current = null
                    columnVirtualizer.measure()
                    forceUpdate()
                })
            }
        },
        [columnVirtualizer, forceUpdate],
    )

    const handleResizeUp = useCallback(
        (e: React.PointerEvent<HTMLDivElement>) => {
            const rs = resizeState.current
            if (!rs.active) return
            e.stopPropagation()
            rs.active = false

                ; (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
            columnVirtualizer.measure()
            forceUpdate()
        },
        [columnVirtualizer, forceUpdate],
    )

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

            <div className="flex gap-2">
                <Button
                    variant="outline"
                    size="sm"
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
                    className="flex-1"
                    onClick={() => {
                        stopInertia()
                        columnVirtualizer.scrollToIndex(0, { behavior: "smooth", align: "start" })
                    }}
                >
                    Start
                </Button>
            </div>

            <div
                ref={parentRef}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
                onWheel={stopInertia} // Prevent native wheel scroll from fighting inertia
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
                                className="absolute top-0 left-0 h-full p-1.5 focus:outline-none"
                                style={{
                                    width: `${colWidth}px`,
                                    transform: `translateX(${virtualCol.start}px)`,
                                }}
                                role="button"
                                tabIndex={0}
                                aria-label={`Select item ${virtualCol.index}`}
                                aria-pressed={isSelected}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter" || e.key === " ") {
                                        e.preventDefault()
                                        setSelectedIndex((prev) => (prev === virtualCol.index ? null : virtualCol.index))
                                    }
                                }}
                                onClick={() => {
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
                                            title={media.alt}
                                            className="h-full w-full object-cover pointer-events-none"
                                        />
                                    ) : (
                                        <img
                                            src={media.src || "/placeholder.svg"}
                                            alt={media.alt}
                                            title={media.alt}
                                            draggable={false}
                                            loading="lazy"
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

                                    {isSelected && (
                                        <>
                                            <div className="pointer-events-none absolute inset-0 rounded-md border-2 border-amber-400" />
                                            <TrimHandle
                                                edge="left"
                                                currentWidth={colWidth}
                                                onPointerDown={(e) => handleResizeDown(e, virtualCol.index, "left")}
                                                onPointerMove={handleResizeMove}
                                                onPointerUp={handleResizeUp}
                                                onPointerCancel={handleResizeUp}
                                            />
                                            <TrimHandle
                                                edge="right"
                                                currentWidth={colWidth}
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
    currentWidth,
    ...handlers
}: {
    edge: "left" | "right"
    currentWidth: number
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
            aria-valuenow={Math.round(currentWidth)}
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