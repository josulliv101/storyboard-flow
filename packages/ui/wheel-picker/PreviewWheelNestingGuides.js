import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React from 'react';
export function PreviewWheelNestingGuides({ nestingLevel, childGridItemWidth, gridItemGap, gridNestingLevels, rowIndex, subRowIndex, indentOffset, }) {
    if (nestingLevel <= 0) {
        return null;
    }
    return (_jsx("div", { className: "absolute pointer-events-none z-[10]", style: {
            left: 0,
            right: 0,
            top: -40,
            bottom: 0,
        }, children: Array.from({ length: nestingLevel }).map((_, i) => {
            const lineX = i * (childGridItemWidth + gridItemGap) + childGridItemWidth / 2 + 8;
            const isImmediateParent = i === nestingLevel - 1;
            // Find the boundary of the current parent collection's subtree (when nesting level goes up to level i or shallower)
            let subtreeBoundary = gridNestingLevels.length;
            for (let idx = rowIndex + 1; idx < gridNestingLevels.length; idx++) {
                if (gridNestingLevels[idx] <= i) {
                    subtreeBoundary = idx;
                    break;
                }
            }
            const hasSubsequent = gridNestingLevels.slice(rowIndex + 1, subtreeBoundary).some(level => level >= i + 1);
            return (_jsxs(React.Fragment, { children: [_jsx("div", { className: "absolute w-px border-l border-dashed border-zinc-600/65", style: {
                            height: 56,
                            top: 0,
                            left: lineX
                        } }), hasSubsequent && (_jsx("div", { className: "absolute w-px border-l border-dashed border-zinc-600/65", style: {
                            top: 56,
                            bottom: 0,
                            left: lineX
                        } })), isImmediateParent && (!subRowIndex || subRowIndex === 0) && (_jsx("div", { className: "absolute h-px border-t border-dashed border-zinc-600/65", style: {
                            top: 56,
                            left: lineX,
                            width: Math.max(0, indentOffset - lineX)
                        } }))] }, `guide-line-${i}`));
        }) }));
}
