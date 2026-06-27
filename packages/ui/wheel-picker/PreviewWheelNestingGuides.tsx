import React from 'react';

export interface PreviewWheelNestingGuidesProps {
  nestingLevel: number;
  childGridItemWidth: number;
  gridItemGap: number;
  gridNestingLevels: number[];
  rowIndex: number;
  subRowIndex: number;
  indentOffset: number;
}

export function PreviewWheelNestingGuides({
  nestingLevel,
  childGridItemWidth,
  gridItemGap,
  gridNestingLevels,
  rowIndex,
  subRowIndex,
  indentOffset,
}: PreviewWheelNestingGuidesProps) {
  if (nestingLevel <= 0) {
    return null;
  }

  return (
    <div
      className="absolute pointer-events-none z-[10]"
      style={{
        left: 0,
        right: 0,
        top: -40,
        bottom: 0,
      }}
    >
      {Array.from({ length: nestingLevel }).map((_, i) => {
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
        
        const hasSubsequent = gridNestingLevels.slice(rowIndex + 1, subtreeBoundary).some(
          level => level >= i + 1
        );

        return (
          <React.Fragment key={`guide-line-${i}`}>
            {/* Vertical line: from top of the row to the horizontal branch level (56px) */}
            <div 
              className="absolute w-px border-l border-dashed border-zinc-600/65"
              style={{ 
                height: 56, 
                top: 0,
                left: lineX
              }}
            />
            
            {/* Continue vertical line down if there are subsequent sibling or descendant items at level i + 1 or deeper */}
            {hasSubsequent && (
              <div 
                className="absolute w-px border-l border-dashed border-zinc-600/65"
                style={{ 
                  top: 56,
                  bottom: 0,
                  left: lineX
                }}
              />
            )}

            {/* Horizontal branch turning right to connect to the collection header (only on the first row of a sub-collection, for the immediate parent line) */}
            {isImmediateParent && (!subRowIndex || subRowIndex === 0) && (
              <div 
                className="absolute h-px border-t border-dashed border-zinc-600/65"
                style={{ 
                  top: 56, 
                  left: lineX, 
                  width: Math.max(0, indentOffset - lineX)
                }}
              />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}
