import { NextResponse } from "next/server";

import {
  createMediaReadStream,
  getMediaMetadata,
  isAllowedMediaPathname,
} from "@/lib/firebase-media-store";
import { requireAuthUser } from "@/lib/firebase-auth-session";
import {
  ProjectAssetScopeError,
  requireProjectAssetScope,
} from "@/lib/project-asset-scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function projectScopeFromMediaPathname(pathname: string) {
  const match =
    /^(?:timeline-videos|timeline-thumbnails)\/projects\/([^/]+)\/([^/]+)\//.exec(
      pathname,
    );
  return match ? { uid: match[1], projectId: match[2] } : null;
}

async function handleMediaRequest(request: Request, includeBody: boolean) {
  const pathname = new URL(request.url).searchParams.get("pathname");

  if (!isAllowedMediaPathname(pathname)) {
    return NextResponse.json({ error: "Invalid hosted media path." }, { status: 400 });
  }

  try {
    const { user, response } = await requireAuthUser();
    if (response || !user) {
      return response || NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const scope = projectScopeFromMediaPathname(pathname);
    if (scope && scope.uid !== user.uid) {
      return new NextResponse("Media not found.", { status: 404 });
    }
    if (scope) await requireProjectAssetScope(scope.projectId, user.uid);

    const media = await getMediaMetadata(pathname);
    if (!media) {
      return new NextResponse("Media not found.", { status: 404 });
    }

    const range = request.headers.get("range");
    if (range && media.contentType.startsWith("video/")) {
      const match = range.match(/bytes=(\d*)-(\d*)/);
      const start = match?.[1] ? Number(match[1]) : 0;
      const end = match?.[2] ? Number(match[2]) : media.size - 1;

      if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= media.size) {
        return new NextResponse(null, {
          status: 416,
          headers: {
            "Content-Range": `bytes */${media.size}`,
          },
        });
      }

      const chunkEnd = Math.min(end, media.size - 1);
      const chunkSize = chunkEnd - start + 1;

      return new NextResponse(
        includeBody ? createMediaReadStream(pathname, { start, end: chunkEnd }, media.bucketName) : null,
        {
          status: 206,
          headers: {
            "Accept-Ranges": "bytes",
            "Cache-Control": media.cacheControl,
            "Content-Length": String(chunkSize),
            "Content-Range": `bytes ${start}-${chunkEnd}/${media.size}`,
            "Content-Type": media.contentType,
          },
        },
      );
    }

    return new NextResponse(includeBody ? createMediaReadStream(pathname, undefined, media.bucketName) : null, {
      headers: {
        "Accept-Ranges": media.contentType.startsWith("video/") ? "bytes" : "none",
        "Cache-Control": media.cacheControl,
        "Content-Length": String(media.size),
        "Content-Type": media.contentType,
      },
    });
  } catch (error) {
    if (error instanceof ProjectAssetScopeError) {
      return new NextResponse("Media not found.", { status: 404 });
    }
    console.error("[GSTUDIO_FIREBASE_MEDIA_READ_ERROR]", error);
    return new NextResponse("Unable to load hosted media.", { status: 500 });
  }
}

export async function GET(request: Request) {
  return handleMediaRequest(request, true);
}

export async function HEAD(request: Request) {
  return handleMediaRequest(request, false);
}
