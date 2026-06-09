import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_MEDIA_DIRS = ['timeline-videos/', 'timeline-thumbnails/'] as const;

function getPublicRoots() {
  return Array.from(new Set([
    path.join(process.cwd(), 'public'),
    path.join(process.cwd(), 'apps', 'web', 'public'),
    path.resolve(process.cwd(), '..', '..', 'public'),
  ]));
}

function getContentType(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webm') return 'video/webm';
  return 'video/mp4';
}

function resolveMediaFile(pathname: string) {
  const safePathname = path.normalize(pathname).replace(/^(\.\.(\/|\\))+/, '');

  for (const publicRoot of getPublicRoots()) {
    const filePath = path.resolve(publicRoot, safePathname);
    const relativePath = path.relative(publicRoot, filePath);
    const isInsidePublicRoot = relativePath && !relativePath.startsWith('..') && !path.isAbsolute(relativePath);

    if (isInsidePublicRoot && fs.existsSync(filePath)) {
      return filePath;
    }
  }

  return null;
}

function isValidMediaPath(pathname: string | null): pathname is string {
  return !!pathname && ALLOWED_MEDIA_DIRS.some(dir => pathname.startsWith(dir));
}

async function handleMediaRequest(request: Request, includeBody: boolean) {
  const pathname = new URL(request.url).searchParams.get('pathname');

  if (!isValidMediaPath(pathname)) {
    return NextResponse.json({ error: 'Invalid hosted media path.' }, { status: 400 });
  }

  try {
    const filePath = resolveMediaFile(pathname);

    if (!filePath) {
      return new NextResponse('Video not found.', { status: 404 });
    }

    const stat = fs.statSync(filePath);
    const contentType = getContentType(filePath);
    const cacheControl = pathname.startsWith('timeline-thumbnails/')
      ? 'public, max-age=31536000, immutable'
      : 'private, no-cache';
    const range = request.headers.get('range');

    if (range && contentType.startsWith('video/')) {
      const match = range.match(/bytes=(\d*)-(\d*)/);
      const start = match?.[1] ? Number(match[1]) : 0;
      const end = match?.[2] ? Number(match[2]) : stat.size - 1;

      if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= stat.size) {
        return new NextResponse(null, {
          status: 416,
          headers: {
            'Content-Range': `bytes */${stat.size}`,
          },
        });
      }

      const chunkEnd = Math.min(end, stat.size - 1);
      const chunkSize = chunkEnd - start + 1;
      const fileStream = includeBody ? fs.createReadStream(filePath, { start, end: chunkEnd }) : null;

      return new NextResponse(fileStream ? Readable.toWeb(fileStream) as BodyInit : null, {
        status: 206,
        headers: {
          'Accept-Ranges': 'bytes',
          'Cache-Control': cacheControl,
          'Content-Length': String(chunkSize),
          'Content-Range': `bytes ${start}-${chunkEnd}/${stat.size}`,
          'Content-Type': contentType,
        },
      });
    }

    const fileStream = includeBody ? fs.createReadStream(filePath) : null;

    return new NextResponse(fileStream ? Readable.toWeb(fileStream) as BodyInit : null, {
      headers: {
        'Accept-Ranges': contentType.startsWith('video/') ? 'bytes' : 'none',
        'Cache-Control': cacheControl,
        'Content-Length': String(stat.size),
        'Content-Type': contentType,
      },
    });
  } catch (error) {
    console.error('[LOCAL_VIDEO_READ_ERROR]', error);
    return new NextResponse('Unable to load hosted video.', { status: 500 });
  }
}

export async function GET(request: Request) {
  return handleMediaRequest(request, true);
}

export async function HEAD(request: Request) {
  return handleMediaRequest(request, false);
}
