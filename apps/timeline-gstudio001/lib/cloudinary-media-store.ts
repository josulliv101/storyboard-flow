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

export async function uploadCloudinaryMedia(
  filename: string,
  data: Buffer,
  explicitContentType?: string,
): Promise<CloudinaryMediaUpload> {
  const config = getCloudinaryConfig();
  const contentType = getMediaContentType(filename, explicitContentType);
  const resourceType = isVideoContent(filename, contentType) ? "video" : "image";
  const timestamp = Math.floor(Date.now() / 1000);
  const publicId = `${sanitizePublicId(filename)}-${Date.now()}`;
  const params = {
    folder: config.folder,
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

  return {
    pathname: body.public_id,
    url: body.secure_url,
    thumbnailPathname: thumbnailUrl ? `${body.public_id}.jpg` : undefined,
    thumbnailUrl,
    contentType,
    size: body.bytes ?? data.byteLength,
  };
}
