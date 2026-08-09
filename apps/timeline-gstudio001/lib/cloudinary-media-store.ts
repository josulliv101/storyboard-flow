import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { encodePublicIdPath } from "./cloudinary-public-id";

import { getMediaContentType } from "./firebase-media-store";

export type CloudinaryMediaUpload = {
  pathname: string;
  url: string;
  thumbnailPathname?: string;
  thumbnailUrl?: string;
  contentType?: string;
  size?: number;
};

export class CloudinaryUploadError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "CloudinaryUploadError";
  }
}

export type CloudinaryAsset = {
  id: string;
  pathname: string;
  url: string;
  thumbnailUrl: string;
  resourceType: "image" | "video";
  format?: string;
  width?: number;
  height?: number;
  size?: number;
  createdAt?: string;
  relativePath?: string;
  /** Real media duration in seconds — videos only, from the Search API
   *  listing (the Admin API list endpoint doesn't return it). */
  duration?: number;
  /** Cloudinary tags — the asset panel's tag pseudo-hierarchy browses them. */
  tags?: string[];
};

type CloudinaryConfig = {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
  folder: string;
};

type CloudinaryUploadResponse = {
  bytes?: number;
  done?: boolean;
  format?: string;
  public_id: string;
  resource_type: "image" | "video" | "raw";
  secure_url: string;
};

type CloudinaryUploadApiResponse = Partial<CloudinaryUploadResponse> & {
  error?: { message?: string };
};

// Cloudinary requires chunked uploads above 100 MB. Starting at one 20 MB
// chunk also makes medium/large video uploads more tolerant of transient
// network failures without adding requests for ordinary images and clips.
const CLOUDINARY_UPLOAD_CHUNK_BYTES = 20 * 1024 * 1024;

type CloudinaryResource = {
  bytes?: number;
  created_at?: string;
  duration?: number;
  format?: string;
  height?: number;
  public_id: string;
  resource_type: "image" | "video" | "raw";
  secure_url: string;
  tags?: string[];
  width?: number;
};

type CloudinaryListResponse = {
  next_cursor?: string;
  resources?: CloudinaryResource[];
  error?: { message?: string };
};

export function hasCloudinaryConfig() {
  return !!process.env.CLOUDINARY_URL;
}

function getCloudinaryConfig(): CloudinaryConfig {
  const cloudinaryUrl = process.env.CLOUDINARY_URL;

  if (!cloudinaryUrl) {
    throw new Error("Cloudinary is not configured. Add CLOUDINARY_URL to the environment.");
  }

  const parsed = new URL(cloudinaryUrl);
  if (parsed.protocol !== "cloudinary:" || !parsed.hostname || !parsed.username || !parsed.password) {
    throw new Error("CLOUDINARY_URL must look like cloudinary://API_KEY:API_SECRET@CLOUD_NAME.");
  }

  return {
    cloudName: parsed.hostname,
    apiKey: decodeURIComponent(parsed.username),
    apiSecret: decodeURIComponent(parsed.password),
    folder: process.env.CLOUDINARY_FOLDER || "timeline-gstudio001",
  };
}

function signCloudinaryParams(params: Record<string, string | number>, apiSecret: string) {
  const payload = Object.entries(params)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");

  return createHash("sha1")
    .update(`${payload}${apiSecret}`)
    .digest("hex");
}

/**
 * Cloudinary's `resource_type`, which is NOT the clip kind.
 *
 * Cloudinary serves AUDIO under `video` — there is no separate audio resource
 * type, and its destroy endpoint is keyed on this value. So an .flac is
 * "video" here and that is correct. Callers deriving a CLIP kind must look at
 * the extension/format instead of this (see `audioExtension`).
 */
function isVideoContent(filename: string, contentType: string) {
  return (
    contentType.startsWith("video/") ||
    contentType.startsWith("audio/") ||
    /\.(mp4|webm|mov)$/i.test(filename) ||
    AUDIO_EXTENSIONS.test(filename)
  );
}

/** Extensions that make an asset AUDIO for clip purposes (#309). */
export const AUDIO_EXTENSIONS = /\.(flac|wav|mp3|m4a|aac|ogg|oga|opus)$/i;

/** True when this asset should become an audio CLIP, whatever Cloudinary calls it. */
export function isAudioAsset(pathnameOrFormat: string) {
  return AUDIO_EXTENSIONS.test(pathnameOrFormat) ||
    AUDIO_EXTENSIONS.test(`.${pathnameOrFormat}`);
}

function sanitizePublicId(filename: string) {
  const withoutExtension = filename
    .replace(/\\/g, "/")
    .split("/")
    .pop()
    ?.replace(/\.[^/.]+$/, "");

  return (withoutExtension || `upload-${Date.now()}`)
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .slice(0, 90);
}

function cloudinaryVideoThumbnailUrl(config: CloudinaryConfig, publicId: string) {
  return `https://res.cloudinary.com/${config.cloudName}/video/upload/so_0.35,w_640,h_360,c_fill,q_auto,f_jpg/${encodePublicIdPath(publicId)}.jpg`;
}

function cloudinaryImageThumbnailUrl(config: CloudinaryConfig, publicId: string) {
  return `https://res.cloudinary.com/${config.cloudName}/image/upload/w_640,h_360,c_fill,q_auto,f_auto/${encodePublicIdPath(publicId)}`;
}

function toAsset(
  config: CloudinaryConfig,
  resource: CloudinaryResource,
  scopePrefix?: string,
): CloudinaryAsset | null {
  if (resource.resource_type !== "image" && resource.resource_type !== "video") return null;

  const prefix = scopePrefix ? `${scopePrefix}/` : `${config.folder}/`;
  const relativePath = resource.public_id.startsWith(prefix)
    ? resource.public_id.slice(prefix.length)
    : resource.public_id;

  return {
    id: resource.public_id,
    pathname: resource.public_id,
    url: resource.secure_url,
    thumbnailUrl:
      resource.resource_type === "video"
        ? cloudinaryVideoThumbnailUrl(config, resource.public_id)
        : cloudinaryImageThumbnailUrl(config, resource.public_id),
    resourceType: resource.resource_type,
    format: resource.format,
    width: resource.width,
    height: resource.height,
    size: resource.bytes,
    createdAt: resource.created_at,
    relativePath,
    duration: resource.resource_type === "video" ? resource.duration : undefined,
    tags: resource.tags ?? [],
  };
}

async function listCloudinaryResources(
  config: CloudinaryConfig,
  resourceType: "image" | "video",
  folderPrefix: string,
  relativePrefix: string,
) {
  const assets: CloudinaryAsset[] = [];
  let nextCursor: string | undefined;
  let pageCount = 0;

  do {
    const params = new URLSearchParams({
      prefix: `${folderPrefix}/`,
      max_results: "100",
      direction: "desc",
      // Include each resource's tag list — the asset panel's tags browse
      // mode groups on them.
      tags: "true",
    });

    if (nextCursor) {
      params.set("next_cursor", nextCursor);
    }

    const response = await fetch(
      `https://api.cloudinary.com/v1_1/${config.cloudName}/resources/${resourceType}/upload?${params.toString()}`,
      {
        headers: {
          Authorization: `Basic ${Buffer.from(`${config.apiKey}:${config.apiSecret}`).toString("base64")}`,
        },
        cache: "no-store",
      },
    );
    const body = (await response.json().catch(() => null)) as CloudinaryListResponse | null;

    if (!response.ok || !body) {
      throw new Error(body?.error?.message || `Cloudinary asset listing failed with ${response.status}.`);
    }

    assets.push(
      ...(body.resources || [])
        .map((resource) => toAsset(config, resource, relativePrefix))
        .filter((asset): asset is CloudinaryAsset => !!asset),
    );
    nextCursor = body.next_cursor;
    pageCount += 1;
  } while (nextCursor && pageCount < 5);

  return assets;
}

/**
 * Video listing goes through the Search API instead of the Admin list: only
 * search results carry `duration` (the list endpoint ignores even an explicit
 * `fields=duration` — verified against the live API), and real durations are
 * what lets a dropped video land at its true length instead of a default.
 */
async function searchCloudinaryVideos(
  config: CloudinaryConfig,
  folderPrefix: string,
  relativePrefix: string,
) {
  const assets: CloudinaryAsset[] = [];
  let nextCursor: string | undefined;
  let pageCount = 0;

  do {
    const response = await fetch(
      `https://api.cloudinary.com/v1_1/${config.cloudName}/resources/search`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${config.apiKey}:${config.apiSecret}`).toString("base64")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          expression: `public_id:${folderPrefix}/* AND resource_type:video`,
          max_results: 100,
          // Tag lists ride along like duration does — see the function
          // comment for why videos use Search in the first place.
          with_field: "tags",
          ...(nextCursor ? { next_cursor: nextCursor } : {}),
        }),
        cache: "no-store",
      },
    );
    const body = (await response.json().catch(() => null)) as CloudinaryListResponse | null;

    if (!response.ok || !body) {
      throw new Error(body?.error?.message || `Cloudinary video search failed with ${response.status}.`);
    }

    assets.push(
      ...(body.resources || [])
        .map((resource) => toAsset(config, resource, relativePrefix))
        .filter((asset): asset is CloudinaryAsset => !!asset),
    );
    nextCursor = body.next_cursor;
    pageCount += 1;
  } while (nextCursor && pageCount < 5);

  return assets;
}

// Per-user/project TTL cache over the requested asset listing. Timeline
// healing can still request the user's full legacy listing by omitting a
// project id, but the asset API always supplies one. The graph view's eager
// hydration can GET
// dozens of timelines in one burst — without this each GET pays multiple
// paginated Cloudinary API calls (rate-limit and latency risk). Caching the
// PROMISE also dedupes the burst: concurrent callers share one in-flight
// listing. Uploads and deletes invalidate, so a fresh listing follows any
// change a user makes through this app.
const ASSET_LIST_TTL_MS = 60_000;
const assetListCache = new Map<string, { at: number; promise: Promise<CloudinaryAsset[]> }>();

const assetListCacheKey = (userId: string, projectId?: string) =>
  `${userId}\u0000${projectId ?? ""}`;

function invalidateAssetListCache(userId?: string) {
  if (!userId) {
    assetListCache.clear();
    return;
  }
  const prefix = `${userId}\u0000`;
  for (const key of assetListCache.keys()) {
    if (key.startsWith(prefix)) assetListCache.delete(key);
  }
}

/**
 * The public-id prefix every one of a user's assets sits under.
 *
 * Exported so a DELETE can prove an id belongs to the user asking, without
 * re-deriving the layout at the call site. A public id is a path and this app
 * builds it as `<folder>/<uid>/<projectId>/…` (see `listCloudinaryAssetsUncached`
 * and the upload path); the trailing slash is what stops `uid` matching
 * `uid-2`.
 */
export function cloudinaryUserPrefix(userId: string) {
  return `${getCloudinaryConfig().folder}/${userId}/`;
}

export async function listCloudinaryAssets(userId: string, projectId?: string) {
  const key = assetListCacheKey(userId, projectId);
  const cached = assetListCache.get(key);
  if (cached && Date.now() - cached.at < ASSET_LIST_TTL_MS) return cached.promise;

  const promise = listCloudinaryAssetsUncached(userId, projectId);
  assetListCache.set(key, { at: Date.now(), promise });
  // Failures are never cached — the next caller retries immediately.
  promise.catch(() => assetListCache.delete(key));
  return promise;
}

async function listCloudinaryAssetsUncached(userId: string, projectId?: string) {
  const config = getCloudinaryConfig();
  const scopeFolder = [config.folder, userId, projectId].filter(Boolean).join("/");
  const [images, videos] = await Promise.all([
    listCloudinaryResources(config, "image", scopeFolder, scopeFolder),
    // Degrade to the duration-less Admin list if search is unavailable —
    // consumers fall back to default durations, nothing else changes.
    searchCloudinaryVideos(config, scopeFolder, scopeFolder).catch((error) => {
      console.warn("[GSTUDIO_CLOUDINARY_SEARCH_FALLBACK]", error);
      return listCloudinaryResources(config, "video", scopeFolder, scopeFolder);
    }),
  ]);

  return [...images, ...videos].sort((left, right) => {
    const leftTime = left.createdAt ? new Date(left.createdAt).getTime() : 0;
    const rightTime = right.createdAt ? new Date(right.createdAt).getTime() : 0;
    return rightTime - leftTime;
  });
}

export type CloudinaryUploadTicket = {
  uploadUrl: string;
  /** Every form field except `file`, which the uploader appends itself. */
  fields: Record<string, string>;
  /** Full stored public id (`folder/name`) — the durable `assetId`. */
  publicId: string;
  resourceType: "image" | "video";
  expiresAt: string;
};

/** Cloudinary rejects a stale timestamp; this is what the caller is told so it
 *  can fail early rather than at upload time. */
const UPLOAD_TICKET_TTL_SECONDS = 15 * 60;

/**
 * A signed ticket for uploading ONE file straight to Cloudinary.
 *
 * The point is that the bytes never pass through this server: an agent tool
 * cannot carry a 20 MB render as a JSON argument. The signature still comes
 * from here, so the server keeps deciding WHERE the file lands.
 *
 * `folder` and `public_id` are derived, never taken from the caller. The
 * deletion rules refuse any id outside `<folder>/<uid>/` (see
 * docs/asset-providers.md), so a caller-chosen path would either break reclaim
 * or let one account write into another's prefix. Layout matches
 * `uploadCloudinaryMedia` exactly, and both use the same `sanitizePublicId`.
 */
export function createCloudinaryUploadTicket(
  filename: string,
  userId: string,
  projectId: string,
): CloudinaryUploadTicket {
  const config = getCloudinaryConfig();
  const contentType = getMediaContentType(filename);
  const resourceType: "image" | "video" = isVideoContent(filename, contentType)
    ? "video"
    : "image";

  const folder = `${config.folder}/${userId}/${projectId}`;
  const name = `${sanitizePublicId(filename)}-${Date.now()}`;
  const timestamp = Math.floor(Date.now() / 1000);
  const params = { folder, public_id: name, timestamp };

  return {
    uploadUrl: `https://api.cloudinary.com/v1_1/${config.cloudName}/${resourceType}/upload`,
    fields: {
      api_key: config.apiKey,
      folder,
      public_id: name,
      timestamp: String(timestamp),
      signature: signCloudinaryParams(params, config.apiSecret),
    },
    publicId: `${folder}/${name}`,
    resourceType,
    expiresAt: new Date((timestamp + UPLOAD_TICKET_TTL_SECONDS) * 1000).toISOString(),
  };
}

/** Drop the cached asset listing so a just-uploaded file is visible at once —
 *  the direct-upload path never touches `uploadCloudinaryMedia`, which is what
 *  normally invalidates it. Without this, `attach_media` can look for a file
 *  that is genuinely there and not find it. */
export function forgetCloudinaryAssetList(userId: string) {
  invalidateAssetListCache(userId);
}

export async function uploadCloudinaryMedia(
  filename: string,
  data: Buffer,
  explicitContentType?: string,
  userId?: string,
  projectId?: string,
  folderPath?: string,
): Promise<CloudinaryMediaUpload> {
  const config = getCloudinaryConfig();
  const contentType = getMediaContentType(filename, explicitContentType);
  const resourceType = isVideoContent(filename, contentType) ? "video" : "image";
  const timestamp = Math.floor(Date.now() / 1000);
  const publicId = `${sanitizePublicId(filename)}-${Date.now()}`;

  let folder = config.folder;
  if (userId) {
    folder = `${config.folder}/${userId}`;
    if (projectId) {
      folder = `${folder}/${projectId}`;
    }
    if (folderPath) {
      const segments = folderPath
        .replace(/\\/g, "/")
        .split("/")
        .map((segment) => segment.trim())
        .filter((segment) => segment.length > 0);
      if (segments.some((segment) => segment === "." || segment === "..")) {
        throw new Error("Asset folder paths cannot contain relative segments.");
      }
      if (segments.length > 0) folder = `${folder}/${segments.join("/")}`;
    }
  }

  const params = {
    folder,
    public_id: publicId,
    timestamp,
  };
  const signature = signCloudinaryParams(params, config.apiSecret);
  const uploadUrl =
    `https://api.cloudinary.com/v1_1/${config.cloudName}/${resourceType}/upload`;
  const uploadId = randomUUID();
  let body: CloudinaryUploadApiResponse | null = null;

  for (let start = 0; start < data.byteLength; start += CLOUDINARY_UPLOAD_CHUNK_BYTES) {
    const endExclusive = Math.min(start + CLOUDINARY_UPLOAD_CHUNK_BYTES, data.byteLength);
    const isChunked = data.byteLength > CLOUDINARY_UPLOAD_CHUNK_BYTES;
    const uploadForm = new FormData();
    const uploadBlob = new Blob(
      [new Uint8Array(data.subarray(start, endExclusive))],
      { type: contentType },
    );

    uploadForm.append("file", uploadBlob, filename);
    uploadForm.append("api_key", config.apiKey);
    uploadForm.append("folder", params.folder);
    uploadForm.append("public_id", params.public_id);
    uploadForm.append("timestamp", String(params.timestamp));
    uploadForm.append("signature", signature);

    const response = await fetch(uploadUrl, {
      method: "POST",
      body: uploadForm,
      headers: isChunked
        ? {
            "Content-Range": `bytes ${start}-${endExclusive - 1}/${data.byteLength}`,
            "X-Unique-Upload-Id": uploadId,
          }
        : undefined,
    });

    body = (await response.json().catch(() => null)) as
      | CloudinaryUploadApiResponse
      | null;

    if (!response.ok) {
      const fallback =
        response.status === 413
          ? "Cloudinary rejected the file because it exceeds this account's upload-size limit."
          : `Cloudinary upload failed with ${response.status}.`;
      throw new CloudinaryUploadError(body?.error?.message || fallback, response.status);
    }

    if (endExclusive < data.byteLength && body?.done !== false) {
      throw new Error("Cloudinary ended a chunked upload before the complete file was sent.");
    }
  }

  if (!body?.secure_url || !body.public_id || !body.resource_type) {
    throw new Error("Cloudinary completed the upload without returning a usable media URL.");
  }

  const thumbnailUrl =
    resourceType === "video"
      ? cloudinaryVideoThumbnailUrl(config, body.public_id)
      : undefined;

  invalidateAssetListCache(userId);

  return {
    pathname: body.public_id,
    url: body.secure_url,
    thumbnailPathname: thumbnailUrl ? `${body.public_id}.jpg` : undefined,
    thumbnailUrl,
    contentType,
    size: body.bytes ?? data.byteLength,
  };
}

export async function deleteCloudinaryAsset(publicId: string, resourceType: "image" | "video") {
  const config = getCloudinaryConfig();
  const timestamp = Math.floor(Date.now() / 1000);

  const params = {
    public_id: publicId,
    timestamp,
  };

  const signature = signCloudinaryParams(params, config.apiSecret);

  const form = new FormData();
  form.append("public_id", publicId);
  form.append("api_key", config.apiKey);
  form.append("timestamp", String(timestamp));
  form.append("signature", signature);

  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${config.cloudName}/${resourceType}/destroy`,
    {
      method: "POST",
      body: form,
    }
  );

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || "Failed to delete Cloudinary asset.");
  }

  // No uid in this signature; the public_id embeds it but parsing is
  // brittle. Deletes are rare — clear every user's cached listing.
  invalidateAssetListCache();

  return await response.json();
}
