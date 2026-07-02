import type React from "react";

export function handleImageFallback(
  event: React.SyntheticEvent<HTMLImageElement>,
  fallbackSrc?: string,
) {
  if (!fallbackSrc || event.currentTarget.src === fallbackSrc) return;
  event.currentTarget.src = fallbackSrc;
}
