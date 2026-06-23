"use client"

import type React from "react"
import { useRef, useCallback, useEffect, useState, useMemo } from "react"
import { useVirtualizer } from "@tanstack/react-virtual"
import { Button } from '../core/button';
import { cn } from '../lib/utils';
import { useMotionValue, animate, MotionValue } from "framer-motion"

export interface ResizableScrollListProps extends React.HTMLAttributes<HTMLDivElement> {
    itemCount?: number
    width?: number | string
}

const MIN_ITEM_WIDTH = 50 // px
const ITEM_HEIGHT = 140 // px
const HANDLE_WIDTH = 8 // px

// Array of Unsplash image photo tracking IDs to cycle through
const IMAGE_IDS = [
    "photo-1506744038136-46273834b3fb", // Valley
    "photo-1470071459604-3b5ec3a7fe05", // Foggy hills
    "photo-1447752875215-b2761acb3c5d", // Forest path
    "photo-1472214222541-d510753a4907", // Sunny pasture
    "photo-1469474968028-56623f02e42e", // Mountains
    "photo-1501854140801-50d01698950b", // Mountain view
    "photo-1441974231531-c6227db76b6e", // Sunbeam trees
    "photo-1532274402911-5a369e4c4bb5", // Lake sunset
]

export function ResizableScrollList({ itemCount = 1002, width = "100%", className, ...props }: ResizableScrollListProps) {
    const parentRef = useRef<HTMLDivElement>(null)

    // State for item widths, indexed by stringified index
    const [itemWidths, setItemWidths] = useState<Record<string, number>>(() => {
        const initialWidths: Record<string, number> = {}
        for (let i = 0; i < itemCount; i++) {
            initialWidths[i.toString()] = 180 // Default width
        }
        return initialWidths
    })

    // Use framer-motion to manage scroll velocity for inertia
    const scrollVelocity = useMotionValue(0)

    // Drag state (kept in refs so we don't trigger re-renders while dragging)
    const dragState = useRef({
        isDraggingList: false,
        isDraggingHandle: false,
        startX: 0,
        startScrollLeft: 0,
        lastX: 0,
        activeHandleItemIndex: "",
        activeHandleSide: "" as "left" | "right",
        startItemWidth: 0,
        startPointerId: -1,
    })

    // Set initial scrollVelocity to handle potential scroll events on render
    useEffect(() => {
        if (parentRef.current) {
            animate(scrollVelocity, 0, { duration: 0 })
        }
    }, [scrollVelocity])

    // Map state widths for TanStack Virtual
    const getWidth = useCallback((index: number) => {
        return itemWidths[index.toString()] || 160 // Fallback estimate
    }, [itemWidths])

    const columnVirtualizer = useVirtualizer({
        horizontal: true,
        count: itemCount,
        getScrollElement: () => parentRef.current,
        estimateSize: () => 160,
        getScrollPosition: () => parentRef.current?.scrollLeft || 0, // Explicit scroll position
    })

    const totalWidth = columnVirtualizer.getTotalSize()

    const handlePointerDown = useCallback(
        (e: React.PointerEvent<HTMLDivElement>) => {
            const el = parentRef.current
            if (!el) return

            // Stop any running inertia animation
            animate(scrollVelocity, 0, { duration: 0 })

            const state = dragState.current
            const target = e.target as HTMLElement

            // Check if a resize handle was clicked
            const handleSide = target.getAttribute("data-handle-side") as "left" | "right" | null
            const handleIndex = target.getAttribute("data-handle-index")

            if (handleSide && handleIndex !== null) {
                state.isDraggingHandle = true
                state.activeHandleSide = handleSide
                state.activeHandleItemIndex = handleIndex
                state.startItemWidth = itemWidths[handleIndex] || 180
            } else {
                state.isDraggingList = true
                state.startScrollLeft = el.scrollLeft
            }

            state.startX = e.clientX
            state.lastX = e.clientX
            state.startPointerId = e.pointerId
            el.setPointerCapture(e.pointerId)
        },
        [scrollVelocity, itemWidths],
    )

    const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
        const state = dragState.current
        const el = parentRef.current
        if (!el || state.startPointerId !== e.pointerId) return

        const dx = e.clientX - state.startX

        if (state.isDraggingList) {
            // Dragging right moves content right -> scroll left (natural drag)
            el.scrollLeft = state.startScrollLeft - dx
            // framer-motion velocity calculation for inertia
            scrollVelocity.set(-(e.clientX - state.lastX))
        } else if (state.isDraggingHandle) {
            const itemIndexStr = state.activeHandleItemIndex
            const side = state.activeHandleSide

            setItemWidths(prev => {
                const currentWidth = prev[itemIndexStr] || state.startItemWidth
                let newWidth = currentWidth

                if (side === "right") {
                    newWidth = Math.max(MIN_ITEM_WIDTH, state.startItemWidth + dx)
                } else if (side === "left") {
                    // Adjust position based on width change, keeping right edge fixed
                    const widthChange = Math.max(MIN_ITEM_WIDTH, state.startItemWidth - dx) - state.startItemWidth
                    if (widthChange < 0) {
                        // Shrinking, content moves left, adjust scroll Left
                        el.scrollLeft -= widthChange
                    } else if (widthChange > 0) {
                        // Expanding, content moves right, adjust scroll Left
                        el.scrollLeft += widthChange
                    }
                    newWidth = Math.max(MIN_ITEM_WIDTH, state.startItemWidth - dx)
                }

                return {
                    ...prev,
                    [itemIndexStr]: newWidth,
                }
            })

            // When resizing, the underlying sizes change. Recalculate and explicit position helps.
            columnVirtualizer.measureElement(columnVirtualizer.getVirtualItems().find(item => item.index === parseInt(itemIndexStr))?.measureElement || null)
            columnVirtualizer.scrollToOffset(columnVirtualizer.scrollPosition, { align: 'start' }) // Force alignment maintain
        }
        state.lastX = e.clientX
    }, [columnVirtualizer, scrollVelocity])

    const handlePointerUp = useCallback(
        (e: React.PointerEvent<HTMLDivElement>) => {
            const state = dragState.current
            const el = parentRef.current
            if (!el || state.startPointerId !== e.pointerId) return

            el.releasePointerCapture(e.pointerId)

            // Kick off inertia if list was dragged with meaningful velocity
            if (state.isDraggingList && Math.abs(scrollVelocity.get()) > 1) {
                // Friction decay on velocity, then apply scroll using framer-motion inertia
                animate(scrollVelocity, 0, {
                    type: "decay",
                    velocity: scrollVelocity.get(),
                    onUpdate: (latest) => {
                        if (parentRef.current && dragState.current.isDraggingHandle === false) {
                            parentRef.current.scrollLeft += latest;
                        }
                    },
                    onComplete: () => {
                        // Clean up any remaining velocity when done
                        scrollVelocity.set(0)
                    }
                });
            } else {
                // Reset velocity if not applicable
                scrollVelocity.set(0)
            }

            // Reset drag state
            state.isDraggingList = false
            state.isDraggingHandle = false
            state.activeHandleItemIndex = ""
            state.startPointerId = -1
        },
        [scrollVelocity],
    )

    const virtualItems = useMemo(() => columnVirtualizer.getVirtualItems(), [columnVirtualizer]);

    return (
        <div
            className={cn(
                "flex flex-col gap-4 w-[450px] p-4 bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl font-sans",
                className,
            )}
            {...props}
        >
            <div className="flex justify-between items-center">
                <h3 className="text-sm font-semibold text-zinc-200">Resizable Edge Scroll List</h3>
                <span className="text-[10px] bg-zinc-800 text-zinc-400 px-2 py-0.5 rounded font-mono">
                    {itemCount.toLocaleString()} Items
                </span>
            </div>

            {/* Control Buttons */}
            <div className="flex gap-2">
                <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => {
                        animate(scrollVelocity, 0, { duration: 0 })
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
                        animate(scrollVelocity, 0, { duration: 0 })
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
                        animate(scrollVelocity, 0, { duration: 0 })
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
                className="w-full overflow-x-auto border border-zinc-800 rounded-lg bg-zinc-950 cursor-grab active:cursor-grabbing touch-none select-none scroll-smooth"
                style={{ height: ITEM_HEIGHT, contain: "strict" }}
            >
                <div
                    className="relative h-full"
                    style={{
                        width: `${totalWidth}px`,
                    }}
                >
                    {virtualItems.map((virtualCol) => {
                        const itemIndexStr = virtualCol.index.toString();
                        const colWidth = getWidth(virtualCol.index);
                        const imageId = IMAGE_IDS[virtualCol.index % IMAGE_IDS.length]

                        // Generate a lightweight, appropriately cached optimized size string
                        const imageUrl = `https://images.unsplash.com/${imageId}?auto=format&fit=crop&w=${colWidth}&h=140&q=70`

                        return (
                            <div
                                key={virtualCol.index}
                                ref={columnVirtualizer.measureElement}
                                data-index={virtualCol.index}
                                className="absolute top-0 bottom-0 pr-1 p-0.5"
                                style={{
                                    width: `${colWidth}px`,
                                    transform: `translateX(${virtualCol.start}px)`,
                                }}
                            >
                                <div className="relative w-full h-full rounded-md overflow-hidden bg-zinc-900 group border border-zinc-800/50">
                                    <img
                                        src={imageUrl}
                                        alt={`Item ${virtualCol.index}`}
                                        loading="lazy"
                                        className="w-full h-full object-cover pointer-events-none transition-transform duration-300 group-hover:scale-105"
                                    />

                                    {/* Subtle index overlay */}
                                    <div className="absolute bottom-1.5 left-2 px-1.5 py-0.5 rounded bg-black/60 backdrop-blur-[2px] text-[9px] font-mono text-zinc-300 pointer-events-none">
                                        #{virtualCol.index} ({colWidth}px)
                                    </div>

                                    {/* Right Resize Handle */}
                                    <div
                                        data-handle-side="right"
                                        data-handle-index={itemIndexStr}
                                        className="absolute top-0 right-0 bottom-0 cursor-col-resize active:cursor-col-resize opacity-0 group-hover:opacity-100 transition-opacity bg-zinc-400 hover:bg-zinc-100/50"
                                        style={{ width: `${HANDLE_WIDTH}px` }}
                                    />

                                    {/* Left Resize Handle */}
                                    <div
                                        data-handle-side="left"
                                        data-handle-index={itemIndexStr}
                                        className="absolute top-0 left-0 bottom-0 cursor-col-resize active:cursor-col-resize opacity-0 group-hover:opacity-100 transition-opacity bg-zinc-400 hover:bg-zinc-100/50"
                                        style={{ width: `${HANDLE_WIDTH}px` }}
                                    />
                                </div>
                            </div>
                        )
                    })}
                </div>
            </div>
        </div>
    )
}