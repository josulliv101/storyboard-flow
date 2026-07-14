// Display rounding for media durations. Pointer trims commit raw
// pixel-derived floats ((clientX - startX) / pixelsPerSecond — deliberately
// unquantized, so the data keeps full precision for undo/persistence), which
// means a card label or announcement rendering the value verbatim leaks
// "3.5416666666666665s" into the UI and into speech. Round at the display
// boundary only; whole numbers stay whole ("4", never "4.0").

/** Round a seconds value to 0.1s for display. The underlying data is untouched. */
export function roundSecondsForDisplay(seconds: number): number {
  return Math.round(seconds * 10) / 10;
}
