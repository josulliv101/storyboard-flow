import { NextResponse } from 'next/server';

import {
  createThumbnailPathname,
  getMediaContentType,
  sanitizeStoragePathname,
  toMediaUrl,
  uploadMedia,
} from '@/lib/firebase-media-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isImagePathname(pathname: string) {
  return /\.(jpe?g|png|webp)$/i.test(pathname);
}

function isVideoUpload(pathname: string, contentType: string) {
  return contentType.startsWith('video/') || /\.(mp4|webm|mov)$/i.test(pathname);
}

function getUploadPathname(filename: string, contentType: string) {
  const isImage = contentType.startsWith('image/') || isImagePathname(filename);
  const sanitized = sanitizeStoragePathname(filename, isImage ? 'timeline-thumbnails' : 'timeline-videos');

  if (!isImage || sanitized.startsWith('timeline-thumbnails/')) {
    return sanitized;
  }

  const basename = sanitized.split('/').pop() || `thumbnail-${Date.now()}.jpg`;
  return `timeline-thumbnails/${basename}`;
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as Blob | null;
    const filename = formData.get('filename') as string | null;
    const thumbnailFile = formData.get('thumbnail') as Blob | null;
    const thumbnailFilename = formData.get('thumbnailFilename') as string | null;

    if (!file || !filename) {
      return NextResponse.json({ error: 'Missing file or filename.' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const contentType = getMediaContentType(filename, file.type);
    const pathname = getUploadPathname(filename, contentType);
    const storedMedia = await uploadMedia(pathname, buffer, contentType);

    let thumbnailPathname: string | undefined;
    let thumbnailUrl: string | undefined;

    if (thumbnailFile && isVideoUpload(pathname, contentType)) {
      const thumbnailBuffer = Buffer.from(await thumbnailFile.arrayBuffer());
      thumbnailPathname = thumbnailFilename
        ? sanitizeStoragePathname(thumbnailFilename, 'timeline-thumbnails')
        : createThumbnailPathname(pathname);
      await uploadMedia(thumbnailPathname, thumbnailBuffer, thumbnailFile.type || 'image/jpeg');
      thumbnailUrl = toMediaUrl(thumbnailPathname);
    }

    return NextResponse.json({
      pathname: storedMedia.pathname,
      url: storedMedia.url,
      thumbnailPathname,
      thumbnailUrl,
    });
  } catch (error) {
    console.error('[FIREBASE_UPLOAD_ERROR]', error);
    const message = error instanceof Error ? error.message : 'Unable to upload file to Firebase Storage.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
