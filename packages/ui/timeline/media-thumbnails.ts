import { FILMSTRIP_MAX_FRAMES } from "./constants";

const CLOUDINARY_CLOUD_NAME = "drrxyckxi";

function getCloudinaryVersionedVideoPath(uploadPath: string) {
  const pathWithoutQuery = uploadPath.split(/[?#]/)[0];
  const segments = pathWithoutQuery.split("/");
  const versionIndex = segments.findIndex((segment) => /^v\d+$/.test(segment));
  const sourceSegments = versionIndex >= 0 ? segments.slice(versionIndex + 1) : segments;

  return sourceSegments.join("/").replace(/\.[^/.]+$/, ".jpg");
}

export function getThumbnailSlotCount(availableWidth: number, frameSize: number) {
  return Math.min(
    FILMSTRIP_MAX_FRAMES,
    Math.max(1, Math.ceil(Math.max(1, availableWidth) / Math.max(1, frameSize))),
  );
}

export function getEndpointFrameTimes({
  count,
  endTime,
  startTime = 0,
}: {
  count: number;
  endTime: number;
  startTime?: number;
}) {
  const frameCount = Math.max(1, Math.floor(count));
  const start = Math.max(0, startTime);
  const end = Math.max(start, endTime);

  if (frameCount === 1) return [start];
  if (frameCount === 2) return [start, end];

  return Array.from({ length: frameCount }, (_, index) => {
    const progress = index / (frameCount - 1);
    return start + (end - start) * progress;
  });
}

export function getVideoThumbnailUrl(
  src: string,
  second: number,
  width = 480,
  height = 270,
): string {
  const roundedSecond = Math.max(0, Number(second.toFixed(2)));

  if (src.includes("res.cloudinary.com") && src.includes("/video/upload/")) {
    const parts = src.split("/video/upload/");
    if (parts.length === 2) {
      const baseUrl = parts[0];
      const videoPath = getCloudinaryVersionedVideoPath(parts[1]);
      return `${baseUrl}/video/upload/so_${roundedSecond},w_${width},h_${height},c_fill,q_auto,f_jpg/${videoPath}`;
    }
  }

  return `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/video/fetch/so_${roundedSecond},w_${width},h_${height},c_fill,q_auto,f_jpg/${encodeURIComponent(src)}`;
}
