import 'server-only';

import { Readable } from 'node:stream';
import { getFirebaseBucket } from './firebase-admin';

export type StoredMedia = {
  pathname: string;
  url: string;
  contentType?: string;
  size?: number;
};

const ALLOWED_MEDIA_PREFIXES = ['timeline-videos/', 'timeline-thumbnails/'] as const;

export function isAllowedMediaPathname(pathname: string | null): pathname is string {
  return !!pathname && ALLOWED_MEDIA_PREFIXES.some(prefix => pathname.startsWith(prefix));
}

export function toMediaUrl(pathname: string) {
  return `/api/scenes/media?pathname=${encodeURIComponent(pathname)}`;
}

export function sanitizeStoragePathname(filename: string, fallbackPrefix = 'timeline-videos') {
  const normalized = filename
    .replace(/\\/g, '/')
    .split('/')
    .filter(segment => segment && segment !== '.' && segment !== '..')
    .join('/');

  const safeName = normalized || `upload-${Date.now()}`;
  const prefixedName = safeName.startsWith('timeline-videos/') || safeName.startsWith('timeline-thumbnails/')
    ? safeName
    : `${fallbackPrefix}/${safeName}`;

  return prefixedName.replace(/[^a-zA-Z0-9/_.,@-]/g, '-');
}

export function getMediaContentType(pathname: string, explicitType?: string) {
  if (explicitType && explicitType !== 'application/octet-stream') return explicitType;

  const lower = pathname.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.webm')) return 'video/webm';
  if (lower.endsWith('.mov')) return 'video/quicktime';
  return lower.endsWith('.mp4') ? 'video/mp4' : 'application/octet-stream';
}

export function createThumbnailPathname(videoPathname: string) {
  const filename = videoPathname.split('/').pop() || `video-${Date.now()}`;
  const baseName = filename.replace(/\.[^/.]+$/, '').slice(0, 90) || 'video';
  return `timeline-thumbnails/${baseName}-thumbnail-${Date.now()}.jpg`;
}

export async function uploadMedia(pathname: string, data: Buffer, contentType?: string): Promise<StoredMedia> {
  if (!isAllowedMediaPathname(pathname)) {
    throw new Error('Invalid Firebase Storage media path.');
  }

  const bucket = getFirebaseBucket();
  const file = bucket.file(pathname);
  const normalizedContentType = getMediaContentType(pathname, contentType);

  await file.save(data, {
    resumable: false,
    metadata: {
      contentType: normalizedContentType,
      cacheControl: pathname.startsWith('timeline-thumbnails/')
        ? 'public, max-age=31536000, immutable'
        : 'private, no-cache',
    },
  });

  return {
    pathname,
    url: toMediaUrl(pathname),
    contentType: normalizedContentType,
    size: data.byteLength,
  };
}

export async function getMediaMetadata(pathname: string) {
  if (!isAllowedMediaPathname(pathname)) return null;

  const file = getFirebaseBucket().file(pathname);
  const [exists] = await file.exists();
  if (!exists) return null;

  const [metadata] = await file.getMetadata();
  return {
    file,
    size: Number(metadata.size || 0),
    contentType: getMediaContentType(pathname, metadata.contentType),
    cacheControl: metadata.cacheControl || (pathname.startsWith('timeline-thumbnails/')
      ? 'public, max-age=31536000, immutable'
      : 'private, no-cache'),
  };
}

export function createMediaReadStream(pathname: string, range?: { start: number; end: number }) {
  const file = getFirebaseBucket().file(pathname);
  return range
    ? Readable.toWeb(file.createReadStream({ start: range.start, end: range.end })) as BodyInit
    : Readable.toWeb(file.createReadStream()) as BodyInit;
}

export async function listMediaPathnames(prefix: typeof ALLOWED_MEDIA_PREFIXES[number]) {
  const [files] = await getFirebaseBucket().getFiles({ prefix });
  return files.map(file => file.name);
}

export async function deleteMediaPathnames(pathnames: string[]) {
  const validPathnames = pathnames.filter(isAllowedMediaPathname);
  await Promise.all(validPathnames.map(async pathname => {
    await getFirebaseBucket().file(pathname).delete({ ignoreNotFound: true });
  }));
}
