import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React from "react";
import { expect, fireEvent, within } from "storybook/test";
import { DragPreviewPortal, } from "./DragPreviewPortal";
function PreviewCard({ label = "Dragged item" }) {
    return (_jsx("div", { className: "flex h-full w-full items-center justify-center rounded-md border border-sky-300/50 bg-sky-950 px-3 text-sm font-semibold text-sky-50 shadow-2xl shadow-black/40", children: label }));
}
function LifecycleDragDropDemo() {
    const [preview, setPreview] = React.useState(null);
    const [isDropped, setIsDropped] = React.useState(false);
    const dropTargetRef = React.useRef(null);
    const pointerOffsetRef = React.useRef({ x: 0, y: 0 });
    function startDrag(event) {
        const bounds = event.currentTarget.getBoundingClientRect();
        pointerOffsetRef.current = {
            x: event.clientX - bounds.left,
            y: event.clientY - bounds.top,
        };
        setIsDropped(false);
        setPreview({
            clientX: event.clientX,
            clientY: event.clientY,
            pointerOffsetX: pointerOffsetRef.current.x,
            pointerOffsetY: pointerOffsetRef.current.y,
        });
        event.currentTarget.setPointerCapture(event.pointerId);
    }
    function moveDrag(event) {
        setPreview((current) => current
            ? {
                clientX: event.clientX,
                clientY: event.clientY,
                pointerOffsetX: pointerOffsetRef.current.x,
                pointerOffsetY: pointerOffsetRef.current.y,
            }
            : null);
    }
    function finishDrag(event) {
        var _a;
        const dropBounds = (_a = dropTargetRef.current) === null || _a === void 0 ? void 0 : _a.getBoundingClientRect();
        const landedInTarget = Boolean(dropBounds &&
            event.clientX >= dropBounds.left &&
            event.clientX <= dropBounds.right &&
            event.clientY >= dropBounds.top &&
            event.clientY <= dropBounds.bottom);
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }
        setPreview(null);
        setIsDropped(landedInTarget);
    }
    return (_jsxs("div", { className: "relative h-[260px] w-full", children: [_jsx("button", { type: "button", "data-testid": "drag-source", "data-dragging": preview !== null, className: "absolute left-8 top-8 flex h-[72px] w-40 touch-none select-none items-center justify-center rounded-md border border-sky-300/50 bg-sky-950 px-3 text-sm font-semibold text-sky-50 shadow-lg shadow-black/30 data-[dragging=true]:opacity-30", onPointerDown: startDrag, onPointerMove: moveDrag, onPointerUp: finishDrag, onPointerCancel: finishDrag, children: "Clip A" }), _jsx("div", { ref: dropTargetRef, "data-testid": "drop-target", "data-dropped": isDropped, className: "absolute right-8 top-24 flex h-28 w-52 items-center justify-center rounded-md border border-dashed border-zinc-600 bg-zinc-900/80 text-sm font-semibold text-zinc-300 data-[dropped=true]:border-emerald-300 data-[dropped=true]:bg-emerald-950 data-[dropped=true]:text-emerald-100", children: isDropped ? "Dropped" : "Drop target" }), _jsx(DragPreviewPortal, { preview: preview, width: 160, height: 72, testId: "lifecycle-drag-preview", children: _jsx(PreviewCard, { label: "Clip A" }) })] }));
}
const meta = {
    title: "UI/Drag Drop/DragPreviewPortal",
    component: DragPreviewPortal,
    decorators: [
        (Story) => (_jsxs("div", { className: "relative min-h-[260px] overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950 text-zinc-100", style: {
                backgroundImage: "linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)",
                backgroundSize: "32px 32px",
            }, children: [_jsx("div", { className: "absolute left-8 top-8 h-16 w-32 rounded-md border border-zinc-700 bg-zinc-900/80" }), _jsx(Story, {})] })),
    ],
    args: {
        width: 160,
        height: 72,
        children: _jsx(PreviewCard, {}),
    },
};
export default meta;
export const HiddenWithoutPreview = {
    args: {
        preview: null,
        testId: "drag-preview-hidden",
    },
    play: async () => {
        const body = within(document.body);
        expect(body.queryByTestId("drag-preview-hidden")).not.toBeInTheDocument();
    },
};
export const DefaultPreview = {
    args: {
        preview: {
            clientX: 220,
            clientY: 150,
            pointerOffsetX: 40,
            pointerOffsetY: 24,
        },
        testId: "drag-preview-default",
    },
    play: async () => {
        const body = within(document.body);
        const preview = await body.findByTestId("drag-preview-default");
        expect(preview).toHaveStyle({
            left: "180px",
            top: "126px",
            width: "160px",
            height: "72px",
        });
        expect(preview.style.transform).toBe("scale(1.03)");
    },
};
export const CustomScaleAndClass = {
    args: {
        preview: {
            clientX: 280,
            clientY: 170,
            pointerOffsetX: 20,
            pointerOffsetY: 20,
        },
        width: 128,
        height: 56,
        scale: 1.12,
        className: "fixed pointer-events-none z-[9999] rounded-lg ring-2 ring-emerald-300",
        testId: "drag-preview-custom",
        children: _jsx(PreviewCard, { label: "Custom ghost" }),
    },
    play: async () => {
        const body = within(document.body);
        const preview = await body.findByTestId("drag-preview-custom");
        expect(preview).toHaveClass("ring-emerald-300");
        expect(preview).toHaveStyle({
            left: "260px",
            top: "150px",
            width: "128px",
            height: "56px",
        });
        expect(preview.style.transform).toBe("scale(1.12)");
    },
};
export const PickUpDragAndDrop = {
    render: () => _jsx(LifecycleDragDropDemo, {}),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement);
        const body = within(document.body);
        const source = await canvas.findByTestId("drag-source");
        const dropTarget = await canvas.findByTestId("drop-target");
        expect(source).toHaveAttribute("data-dragging", "false");
        expect(dropTarget).toHaveAttribute("data-dropped", "false");
        expect(body.queryByTestId("lifecycle-drag-preview")).not.toBeInTheDocument();
        const sourceBounds = source.getBoundingClientRect();
        const dropBounds = dropTarget.getBoundingClientRect();
        const pointerOffset = { x: 44, y: 32 };
        const startPoint = {
            x: sourceBounds.left + pointerOffset.x,
            y: sourceBounds.top + pointerOffset.y,
        };
        const dropPoint = {
            x: dropBounds.left + dropBounds.width / 2,
            y: dropBounds.top + dropBounds.height / 2,
        };
        await fireEvent.pointerDown(source, {
            pointerId: 1,
            clientX: startPoint.x,
            clientY: startPoint.y,
            buttons: 1,
        });
        expect(source).toHaveAttribute("data-dragging", "true");
        expect(await body.findByTestId("lifecycle-drag-preview")).toBeInTheDocument();
        await fireEvent.pointerMove(source, {
            pointerId: 1,
            clientX: dropPoint.x,
            clientY: dropPoint.y,
            buttons: 1,
        });
        const preview = await body.findByTestId("lifecycle-drag-preview");
        expect(preview).toHaveStyle({
            left: `${dropPoint.x - pointerOffset.x}px`,
            top: `${dropPoint.y - pointerOffset.y}px`,
        });
        await fireEvent.pointerUp(source, {
            pointerId: 1,
            clientX: dropPoint.x,
            clientY: dropPoint.y,
        });
        expect(source).toHaveAttribute("data-dragging", "false");
        expect(dropTarget).toHaveAttribute("data-dropped", "true");
        expect(body.queryByTestId("lifecycle-drag-preview")).not.toBeInTheDocument();
    },
};
