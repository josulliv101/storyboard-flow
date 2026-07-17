import "server-only";

import { createHash } from "node:crypto";

import { getMediaContentType } from "./firebase-media-store";

export type CloudinaryMediaUpload = {
  pathname: string;
  url: string;
  thumbnailPathname?: string;
  thumbnailUrl?: string;
  contentType?: string;
  size?: number;
};

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
};

type CloudinaryConfig = {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
  folder: string;
};

type CloudinaryUploadResponse = {
  bytes?: number;
  format?: string;
  public_id: string;
  resource_type: "image" | "video" | "raw";
  secure_url: string;
};

type CloudinaryResource = {
  bytes?: number;
  created_at?: string;
  duration?: number;
  format?: string;
  height?: number;
  public_id: string;
  resource_type: "image" | "video" | "raw";
  secure_url: string;
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

function isVideoContent(filename: string, contentType: string) {
  return contentType.startsWith("video/") || /\.(mp4|webm|mov)$/i.test(filename);
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
  return `https://res.cloudinary.com/${config.cloudName}/video/upload/so_0.35,w_640,h_360,c_fill,q_auto,f_jpg/${publicId}.jpg`;
}

function cloudinaryImageThumbnailUrl(config: CloudinaryConfig, publicId: string) {
  return `https://res.cloudinary.com/${config.cloudName}/image/upload/w_640,h_360,c_fill,q_auto,f_auto/${publicId}`;
}

function toAsset(
  config: CloudinaryConfig,
  resource: CloudinaryResource,
  userId?: string,
): CloudinaryAsset | null {
  if (resource.resource_type !== "image" && resource.resource_type !== "video") return null;

  const prefix = userId ? `${config.folder}/${userId}/` : `${config.folder}/`;
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
  };
}

async function listCloudinaryResources(
  config: CloudinaryConfig,
  resourceType: "image" | "video",
  folderPrefix: string,
  userId: string,
) {
  const assets: CloudinaryAsset[] = [];
  let nextCursor: string | undefined;
  let pageCount = 0;

  do {
    const params = new URLSearchParams({
      prefix: `${folderPrefix}/`,
      max_results: "100",
      direction: "desc",
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
        .map((resource) => toAsset(config, resource, userId))
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
  userId: string,
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
        .map((resource) => toAsset(config, resource, userId))
        .filter((asset): asset is CloudinaryAsset => !!asset),
    );
    nextCursor = body.next_cursor;
    pageCount += 1;
  } while (nextCursor && pageCount < 5);

  return assets;
}

// Per-user TTL cache over the full asset listing. Every timeline GET runs a
// listing for document healing, and the graph view's eager hydration can GET
// dozens of timelines in one burst — without this each GET pays multiple
// paginated Cloudinary API calls (rate-limit and latency risk). Caching the
// PROMISE also dedupes the burst: concurrent callers share one in-flight
// listing. Uploads and deletes invalidate, so a fresh listing follows any
// change a user makes through this app.
const ASSET_LIST_TTL_MS = 60_000;
const assetListCache = new Map<string, { at: number; promise: Promise<CloudinaryAsset[]> }>();

function invalidateAssetListCache(userId?: string) {
  if (userId) assetListCache.delete(userId);
  else assetListCache.clear();
}

export async function listCloudinaryAssets(userId: string) {
  const cached = assetListCache.get(userId);
  if (cached && Date.now() - cached.at < ASSET_LIST_TTL_MS) return cached.promise;

  const promise = listCloudinaryAssetsUncached(userId);
  assetListCache.set(userId, { at: Date.now(), promise });
  // Failures are never cached — the next caller retries immediately.
  promise.catch(() => assetListCache.delete(userId));
  return promise;
}

async function listCloudinaryAssetsUncached(userId: string) {
  const config = getCloudinaryConfig();
  const userFolder = `${config.folder}/${userId}`;
  const [images, videos] = await Promise.all([
    listCloudinaryResources(config, "image", userFolder, userId),
    // Degrade to the duration-less Admin list if search is unavailable —
    // consumers fall back to default durations, nothing else changes.
    searchCloudinaryVideos(config, userFolder, userId).catch((error) => {
      console.warn("[GSTUDIO_CLOUDINARY_SEARCH_FALLBACK]", error);
      return listCloudinaryResources(config, "video", userFolder, userId);
    }),
  ]);

  return [...images, ...videos].sort((left, right) => {
    const leftTime = left.createdAt ? new Date(left.createdAt).getTime() : 0;
    const rightTime = right.createdAt ? new Date(right.createdAt).getTime() : 0;
    return rightTime - leftTime;
  });
}

export async function uploadCloudinaryMedia(
  filename: string,
  data: Buffer,
  explicitContentType?: string,
  userId?: string,
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
    if (folderPath) {
      folder = `${folder}/${folderPath}`;
    }
  }

  const params = {
    folder,
    public_id: publicId,
    timestamp,
  };
  const signature = signCloudinaryParams(params, config.apiSecret);
  const uploadForm = new FormData();
  const uploadBlob = new Blob([new Uint8Array(data)], { type: contentType });

  uploadForm.append("file", uploadBlob, filename);
  uploadForm.append("api_key", config.apiKey);
  uploadForm.append("folder", params.folder);
  uploadForm.append("public_id", params.public_id);
  uploadForm.append("timestamp", String(params.timestamp));
  uploadForm.append("signature", signature);

  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${config.cloudName}/${resourceType}/upload`,
    {
      method: "POST",
      body: uploadForm,
    },
  );

  const body = (await response.json().catch(() => null)) as
    | (CloudinaryUploadResponse & { error?: { message?: string } })
    | null;

  if (!response.ok || !body?.secure_url) {
    throw new Error(body?.error?.message || `Cloudinary upload failed with ${response.status}.`);
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
