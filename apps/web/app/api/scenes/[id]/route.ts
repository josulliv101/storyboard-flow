import { NextResponse } from 'next/server';

import type { TimelineProjectJson } from '@/lib/timeline-context';
import { deleteSavedScene, getOtherSavedSceneProjects, getSavedScene, updateSavedSceneProject, updateSavedSceneThumbnail, updateSavedScenePublishStatus } from '@/lib/saved-scenes-store';
import { getAuthUser } from '@/lib/auth-store';
import { deleteMediaPathnames, listMediaPathnames } from '@/lib/firebase-media-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isValidSceneId(id: string) {
  return /^[0-9a-f-]{36}$/i.test(id);
}

function savedSceneStorageErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && (
    error.message.startsWith('Scene storage is not configured')
    || error.message.startsWith('Unable to connect to scene storage')
    || error.message.startsWith('Firebase Storage is not configured')
    || error.message.includes('timed out')
  )) {
    return error.message;
  }

  return fallback;
}

function addHostedMediaPathname(pathnames: Set<string>, src?: string) {
  if (!src) return;

  try {
    const sourceUrl = new URL(src, 'http://local-scene');
    const pathname = sourceUrl.searchParams.get('pathname');

    if (sourceUrl.pathname === '/api/scenes/media' && (pathname?.startsWith('timeline-videos/') || pathname?.startsWith('timeline-thumbnails/'))) {
      pathnames.add(pathname);
    }
  } catch {
    // Invalid external media URLs are ignored during hosted cleanup.
  }
}

function getHostedMediaPathnames(project: TimelineProjectJson) {
  const pathnames = new Set<string>();

  project.scenes.forEach(scene => {
    addHostedMediaPathname(pathnames, scene.thumbnailUrl);
    scene.clips.forEach(clip => {
      if (clip.type !== 'video' || !clip.src) return;
      addHostedMediaPathname(pathnames, clip.src);
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

    const user = await getAuthUser();
    const scene = await getSavedScene(id);
    if (!scene) {
      return NextResponse.json({ error: 'Saved scene was not found.' }, { status: 404 });
    }

    if (!user && !scene.isPublished) {
      return NextResponse.json({ error: 'Forbidden. You must be logged in to view this scene.' }, { status: 403 });
    }

    return NextResponse.json({ scene });
  } catch (error) {
    console.error('[SAVED_SCENE_LOAD_ERROR]', error);
    return NextResponse.json({ error: savedSceneStorageErrorMessage(error, 'Unable to load the saved scene.') }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getAuthUser();
    if (!user || user.role === 'viewer') {
      return NextResponse.json({ error: 'Forbidden. Editing access required.' }, { status: 403 });
    }

    const { id } = await params;

    if (!isValidSceneId(id)) {
      return NextResponse.json({ error: 'Invalid saved scene id.' }, { status: 400 });
    }

    const body = await request.json().catch(() => ({})) as { thumbnailUrl?: unknown; isPublished?: unknown; project?: unknown };

    if ('isPublished' in body) {
      if (user.role !== 'admin') {
        return NextResponse.json({ error: 'Forbidden. Admin role required to publish/unpublish scenes.' }, { status: 403 });
      }
      const isPublished = !!body.isPublished;
      const scene = await updateSavedScenePublishStatus(id, isPublished, user.id, user.username);
      if (!scene) {
        return NextResponse.json({ error: 'Saved scene was not found.' }, { status: 404 });
      }
      return NextResponse.json({ scene });
    }

    if ('project' in body) {
      const project = body.project as TimelineProjectJson;
      if (!project || typeof project !== 'object' || !Array.isArray(project.scenes) || project.scenes.length === 0) {
        return NextResponse.json({ error: 'A valid timeline project is required.' }, { status: 400 });
      }

      const scene = await updateSavedSceneProject(id, project);
      if (!scene) {
        return NextResponse.json({ error: 'Saved scene was not found.' }, { status: 404 });
      }
      return NextResponse.json({ scene });
    }

    const thumbnailUrl = typeof body.thumbnailUrl === 'string' ? body.thumbnailUrl.trim() : '';
    if (!thumbnailUrl || thumbnailUrl.length > 2048) {
      return NextResponse.json({ error: 'A valid thumbnail URL is required.' }, { status: 400 });
    }

    const scene = await updateSavedSceneThumbnail(id, thumbnailUrl);
    if (!scene) {
      return NextResponse.json({ error: 'Saved scene was not found.' }, { status: 404 });
    }

    return NextResponse.json({ scene });
  } catch (error) {
    console.error('[SAVED_SCENE_PATCH_ERROR]', error);
    return NextResponse.json({ error: savedSceneStorageErrorMessage(error, 'Unable to update the saved scene metadata.') }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getAuthUser();
    if (!user || user.role === 'viewer') {
      return NextResponse.json({ error: 'Forbidden. Editing access required.' }, { status: 403 });
    }

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
      getHostedMediaPathnames(project).forEach(pathname => referencedPathnames.add(pathname));
    });

    // 2. Query Firebase Storage to list all hosted files under the media prefixes.
    let deletedCount = 0;
    try {
      const blobs = [
        ...await listMediaPathnames('timeline-videos/'),
        ...await listMediaPathnames('timeline-thumbnails/'),
      ];
      
      const pathnamesToDelete = blobs.filter(pathname => !referencedPathnames.has(pathname));

      if (pathnamesToDelete.length > 0) {
        await deleteMediaPathnames(pathnamesToDelete);
        deletedCount = pathnamesToDelete.length;
      }
    } catch (blobError) {
      console.error('[CLEANUP_ORPHANED_BLOBS_ERROR]', blobError);
      
      // Fallback: Attempt standard direct deletion of the specific unused video(s)
      const hostedVideoPathnames = getHostedMediaPathnames(scene.project);
      const unusedVideoPathnames = [...hostedVideoPathnames].filter(pathname => !referencedPathnames.has(pathname));
      if (unusedVideoPathnames.length > 0) {
        await deleteMediaPathnames(unusedVideoPathnames);
        deletedCount = unusedVideoPathnames.length;
      }
    }

    // 3. Delete the saved scene metadata from Firestore.
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
    return NextResponse.json({ error: savedSceneStorageErrorMessage(error, 'Unable to delete the saved scene and hosted video.') }, { status: 500 });
  }
}
