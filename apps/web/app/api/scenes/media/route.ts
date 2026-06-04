import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const pathname = new URL(request.url).searchParams.get('pathname');

  if (!pathname || (!pathname.startsWith('timeline-videos/') && !pathname.startsWith('timeline-thumbnails/'))) {
    return NextResponse.json({ error: 'Invalid hosted media path.' }, { status: 400 });
  }

  try {
    // Clean up pathname to prevent path traversal
    const safePathname = path.normalize(pathname).replace(/^(\.\.(\/|\\))+/, '');
    const filePath = path.join(process.cwd(), 'public', safePathname);

    if (!fs.existsSync(filePath)) {
      return new NextResponse('Video not found.', { status: 404 });
    }

    const stat = fs.statSync(filePath);
    const fileStream = fs.createReadStream(filePath);

    // Determine content type based on extension
    const ext = path.extname(filePath).toLowerCase();
    let contentType = 'video/mp4';
    if (ext === '.png') contentType = 'image/png';
    else if (ext === '.jpg' || ext === '.jpeg') contentType = 'image/jpeg';
    else if (ext === '.webm') contentType = 'video/webm';

    // Stream the file stream directly
    return new NextResponse(fileStream as any, {
      headers: {
      'Cache-Control': pathname.startsWith('timeline-thumbnails/') ? 'public, max-age=31536000, immutable' : 'private, no-cache',
        'Content-Length': String(stat.size),
        'Content-Type': contentType,
      },
    });
  } catch (error) {
    console.error('[LOCAL_VIDEO_READ_ERROR]', error);
    return new NextResponse('Unable to load hosted video.', { status: 500 });
  }
}
