import type { ComponentPropsWithoutRef } from "react";

export type MediaStripItem = {
  id: string;
  title: string;
  subtitle?: string;
  thumbnailUrl?: string;
  videoSrc?: string;
  width?: number;
  alt?: string;
};
