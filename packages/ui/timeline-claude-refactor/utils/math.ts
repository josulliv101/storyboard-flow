export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function formatSeconds(value: number): string {
  if (value < 0.01) return "0s";
  if (value < 10) return `${value.toFixed(2)}s`;
  return `${value.toFixed(1)}s`;
}

export function getSourceTimeFromClientX({
  clientX,
  rectLeft,
  rectWidth,
  sourceDuration,
}: {
  clientX: number;
  rectLeft: number;
  rectWidth: number;
  sourceDuration: number;
}): number {
  if (rectWidth <= 0 || sourceDuration <= 0) return 0;

  const localX = clamp(clientX - rectLeft, 0, rectWidth);
  return (localX / rectWidth) * sourceDuration;
}
