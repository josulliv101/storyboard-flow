import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as Blob | null;
    const filename = formData.get('filename') as string | null;

    if (!file || !filename) {
      return NextResponse.json({ error: 'Missing file or filename.' }, { status: 400 });
    }

    // Clean up filename to prevent path traversal
    const safeFilename = path.basename(filename);
    
    // Ensure destination directory exists in public/timeline-videos
    const uploadDir = path.join(process.cwd(), 'public', 'timeline-videos');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    // Write file to disk
    const filePath = path.join(uploadDir, safeFilename);
    const buffer = Buffer.from(await file.arrayBuffer());
    fs.writeFileSync(filePath, buffer);

    return NextResponse.json({
      pathname: `timeline-videos/${safeFilename}`,
      url: `/api/scenes/media?pathname=timeline-videos/${safeFilename}`
    });
  } catch (error) {
    console.error('[LOCAL_UPLOAD_ERROR]', error);
    const message = error instanceof Error ? error.message : 'Unable to upload file locally.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
