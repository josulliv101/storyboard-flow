import { del, list } from '@vercel/blob';
import { NextResponse } from 'next/server';

import type { TimelineProjectJson } from '@/lib/timeline-context';
import { deleteSavedScene, getOtherSavedSceneProjects, getSavedScene } from '@/lib/saved-scenes-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isValidSceneId(id: string) {
  return /^[0-9a-f-]{36}$/i.test(id);
}

function getHostedVideoPathnames(project: TimelineProjectJson) {
  const pathnames = new Set<string>();

  project.scenes.forEach(scene => {
    scene.clips.forEach(clip => {
      if (clip.type !== 'video' || !clip.src) return;

      try {
        const sourceUrl = new URL(clip.src, 'http://local-scene');
        const pathname = sourceUrl.searchParams.get('pathname');

        if (sourceUrl.pathname === '/api/scenes/media' && pathname?.startsWith('timeline-videos/')) {
          pathnames.add(pathname);
        }
      } catch {
        // Invalid external media URLs are ignored during hosted cleanup.
      }
    });
  });

  return pathnames;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    if (!isValidSceneId(id)) {
      return NextResponse.json({ error: 'Invalid saved scene id.' }, { status: 400 });
    }

    const scene = await getSavedScene(id);
    if (!scene) {
      return NextResponse.json({ error: 'Saved scene was not found.' }, { status: 404 });
    }

    return NextResponse.json({ scene });
  } catch (error) {
    console.error('[SAVED_SCENE_LOAD_ERROR]', error);
    return NextResponse.json({ error: 'Unable to load the saved scene.' }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    if (!isValidSceneId(id)) {
      return NextResponse.json({ error: 'Invalid saved scene id.' }, { status: 400 });
    }

    const scene = await getSavedScene(id);
    if (!scene) {
      return NextResponse.json({ error: 'Saved scene was not found.' }, { status: 404 });
    }

    // 1. Compile pathnames that must be preserved (referenced by other saved scenes in the DB)
    const otherProjects = await getOtherSavedSceneProjects(id);
    const referencedPathnames = new Set<string>();
    otherProjects.forEach(project => {
      getHostedVideoPathnames(project).forEach(pathname => referencedPathnames.add(pathname));
    });

    // 2. Query Vercel Blob store to list all hosted files under the 'timeline-videos/' prefix
    let deletedCount = 0;
    try {
      const { blobs } = await list({ prefix: 'timeline-videos/' });
      
      // Identify blobs that are not in the referenced set and are older than 5 minutes (300,000 ms)
      const now = Date.now();
      const urlsToDelete: string[] = [];

      blobs.forEach(blob => {
        const isReferenced = referencedPathnames.has(blob.pathname);
        const uploadedTime = new Date(blob.uploadedAt).getTime();
        const isOldEnough = (now - uploadedTime) > 300_000;

        if (!isReferenced && isOldEnough) {
          urlsToDelete.push(blob.url);
        }
      });

      if (urlsToDelete.length > 0) {
        await del(urlsToDelete);
        deletedCount = urlsToDelete.length;
      }
    } catch (blobError) {
      console.error('[CLEANUP_ORPHANED_BLOBS_ERROR]', blobError);
      
      // Fallback: Attempt standard direct deletion of the specific unused video(s)
      const hostedVideoPathnames = getHostedVideoPathnames(scene.project);
      const unusedVideoPathnames = [...hostedVideoPathnames].filter(pathname => !referencedPathnames.has(pathname));
      if (unusedVideoPathnames.length > 0) {
        // Fallback: pass unused pathnames directly
        await del(unusedVideoPathnames);
        deletedCount = unusedVideoPathnames.length;
      }
    }

    // 3. Delete the saved scene metadata from the Postgres database
    await deleteSavedScene(id);

    return NextResponse.json({
      deletedVideoCount: deletedCount,
      scene: {
        id: scene.id,
        name: scene.name,
      },
    });
  } catch (error) {
    console.error('[SAVED_SCENE_DELETE_ERROR]', error);
    return NextResponse.json({ error: 'Unable to delete the saved scene and hosted video.' }, { status: 500 });
  }
}
