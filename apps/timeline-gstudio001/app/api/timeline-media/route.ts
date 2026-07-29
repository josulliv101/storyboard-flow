import { NextResponse } from "next/server";

import {
  createMediaReadStream,
  getMediaMetadata,
  isAllowedMediaPathname,
} from "@/lib/firebase-media-store";
import { requireAuthUser } from "@/lib/firebase-auth-session";
import { parseRangeHeader } from "@/lib/http-range";
import {
  ProjectAssetScopeError,
  requireProjectAssetScope,
} from "@/lib/project-asset-scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Every byte this route serves passed an auth check, so no response from it may
 * be stored in a SHARED cache: a CDN or corporate proxy keys on URL alone and
 * would hand one user's media to the next requester without re-running that
 * check. Thumbnails are written to storage with
 * `public, max-age=31536000, immutable` (fine for the object, wrong for this
 * response), so the stored directive is overridden here rather than merely
 * fixed at upload time — that way EXISTING objects are covered too, not just
 * ones uploaded after this deploy.
 */
function toPrivateCacheControl(stored: string | undefined) {
  if (!stored) return "private, no-cache";
  // Drop any existing cacheability directive — `public` because it is wrong
  // here, `private` so re-asserting it below cannot double it up — and keep
  // every freshness directive (max-age, immutable, no-cache…) as stored.
  const preserved = stored
    .split(",")
    .map((directive) => directive.trim())
    .filter((directive) => {
      const normalized = directive.toLowerCase();
      return normalized !== "public" && normalized !== "private";
    });
  return ["private", ...preserved].join(", ");
}

/**
 * The owner and project a stored object belongs to, read out of its path.
 *
 * Every object this app writes is scoped (`scopeStoragePathname` in the upload
 * route puts `projects/<uid>/<projectId>/` after the prefix), so a path that
 * does NOT parse is one no upload path here produces — a legacy object, a
 * manual upload, a migration. Those used to be served to any signed-in caller:
 * both checks below were conditional on `scope`, so an unparseable path
 * skipped authorization entirely and the only remaining gate was
 * `isAllowedMediaPathname`, a prefix test. Guessing the name was the whole
 * difficulty, which is obscurity, not authorization. Null now DENIES.
 */
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
    // Deny by default: an unparseable path is not an authorized path.
    const scope = projectScopeFromMediaPathname(pathname);
    if (!scope || scope.uid !== user.uid) {
      return new NextResponse("Media not found.", { status: 404 });
    }
    await requireProjectAssetScope(scope.projectId, user.uid);

    const media = await getMediaMetadata(pathname);
    if (!media) {
      return new NextResponse("Media not found.", { status: 404 });
    }

    const cacheControl = toPrivateCacheControl(media.cacheControl);

    if (media.contentType.startsWith("video/")) {
      const range = parseRangeHeader(request.headers.get("range"), media.size);

      if (range.type === "unsatisfiable") {
        return new NextResponse(null, {
          status: 416,
          headers: {
            "Content-Range": `bytes */${media.size}`,
          },
        });
      }

      if (range.type === "satisfiable") {
        const chunkSize = range.end - range.start + 1;

        return new NextResponse(
          includeBody
            ? createMediaReadStream(pathname, { start: range.start, end: range.end }, media.bucketName)
            : null,
          {
            status: 206,
            headers: {
              "Accept-Ranges": "bytes",
              "Cache-Control": cacheControl,
              "Content-Length": String(chunkSize),
              "Content-Range": `bytes ${range.start}-${range.end}/${media.size}`,
              "Content-Type": media.contentType,
              // The stored contentType came from the uploader. Even with the
              // upload route's allowlist, this response must never be sniffed
              // into something executable on our own origin.
              "X-Content-Type-Options": "nosniff",
            },
          },
        );
      }
      // "ignore" falls through to the full 200 representation below.
    }

    return new NextResponse(includeBody ? createMediaReadStream(pathname, undefined, media.bucketName) : null, {
      headers: {
        "Accept-Ranges": media.contentType.startsWith("video/") ? "bytes" : "none",
        "Cache-Control": cacheControl,
        "Content-Length": String(media.size),
        "Content-Type": media.contentType,
        "X-Content-Type-Options": "nosniff",
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
