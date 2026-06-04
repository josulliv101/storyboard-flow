import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const inputProps = await request.json();
    const entryPoint = path.join(process.cwd(), 'video-render', 'index.tsx');
    const publicDir = path.join(process.cwd(), 'public');
    const rendersDir = path.join(publicDir, 'renders');
    const renderId = randomUUID();
    const fileName = `timeline-${renderId}.mp4`;
    const outputLocation = path.join(rendersDir, fileName);

    await mkdir(rendersDir, { recursive: true });

    const serveUrl = await bundle({
      entryPoint,
      publicDir,
    });

    const composition = await selectComposition({
      serveUrl,
      id: 'TimelineProject',
      inputProps,
    });

    await renderMedia({
      codec: 'h264',
      composition,
      inputProps,
      outputLocation,
      serveUrl,
    });

    return NextResponse.json({
      fileName,
      url: `/renders/${fileName}`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Render failed.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
