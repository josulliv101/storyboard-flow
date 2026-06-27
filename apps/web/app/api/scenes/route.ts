import { NextResponse } from 'next/server';

import type { TimelineProjectJson } from '@/lib/timeline-context';
import { listSavedScenes, saveScene } from '@/lib/saved-scenes-store';

import { getAuthUser } from '@/lib/auth-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isTimelineProjectJson(project: unknown): project is TimelineProjectJson {
  if (!project || typeof project !== 'object') return false;
  const value = project as Partial<TimelineProjectJson>;

  return value.version === 1
    && Array.isArray(value.scenes)
    && value.scenes.length === 1
    && typeof value.activeSceneId === 'string'
    && Array.isArray(value.characters)
    && !!value.config;
}

function storageErrorResponse(error: unknown) {
  const message = error instanceof Error && (
    error.message.startsWith('Scene storage is not configured')
    || error.message.startsWith('Unable to connect to scene storage')
    || error.message.startsWith('Firebase Storage is not configured')
    || error.message.includes('timed out')
  )
    ? error.message
    : 'Unable to access Firebase saved scenes.';
  console.error('[SAVED_SCENES_ERROR]', error);
  return NextResponse.json({ error: message }, { status: 500 });
}

export async function GET() {
  try {
    const user = await getAuthUser();
    const onlyPublished = !user;
    return NextResponse.json({ scenes: await listSavedScenes(onlyPublished) });
  } catch (error) {
    return storageErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await getAuthUser();
    if (!user || user.role === 'viewer') {
      return NextResponse.json({ error: 'Forbidden. Editing access required.' }, { status: 403 });
    }

    const body = await request.json() as { name?: unknown; project?: unknown };
    const name = typeof body.name === 'string' ? body.name.trim() : '';

    if (!name || name.length > 120) {
      return NextResponse.json({ error: 'Scene name must be between 1 and 120 characters.' }, { status: 400 });
    }

    if (!isTimelineProjectJson(body.project)) {
      return NextResponse.json({ error: 'A single valid scene snapshot is required.' }, { status: 400 });
    }

    if (JSON.stringify(body.project).length > 2_000_000) {
      return NextResponse.json({ error: 'Scene snapshot is too large to save.' }, { status: 413 });
    }

    return NextResponse.json({ scene: await saveScene(name, body.project) }, { status: 201 });
  } catch (error) {
    return storageErrorResponse(error);
  }
}
