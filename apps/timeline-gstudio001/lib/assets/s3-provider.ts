// Amazon S3 behind the neutral seam — the seam's second adapter, and the
// proof it isn't Cloudinary-shaped: an S3 bucket is a flat namespace of
// path-shaped KEYS, so folder browsing falls out of the same
// `pageFromFlatListing` derivation, and everything S3 cannot do (tags on a
// listing, media dimensions, durations) is simply declared off or omitted
// rather than faked.
//
// Env-configured (no per-user OAuth — that is its own future track):
//   S3_ASSETS_BUCKET       required — registers the provider when present
//   S3_ASSETS_REGION       required
//   S3_ASSETS_PREFIX       optional key prefix ("media/"); the browse root
//   S3_ASSETS_PUBLIC_URL   optional public/CDN base; when absent, URLs are
//                          presigned GETs (private buckets work untouched)
// Credentials ride the SDK's default chain (AWS_ACCESS_KEY_ID / role / …).
//
// Objects are listed from the configured bucket but exposed only beneath
// `<prefix>/<uid>/<projectId>/`, matching the Cloudinary ownership boundary.

import { pageFromFlatListing, pageFromSearch } from "./path-folders";
import type { AssetProvider } from "./provider";
import type { Asset, AssetKind } from "./types";

export const S3_PROVIDER_ID = "s3";

/** One listed object, reduced to what the mapping needs — the injection
 *  point that keeps the adapter unit-testable without the SDK. */
export type S3ObjectSummary = Readonly<{
  key: string;
  size?: number;
  lastModified?: string;
}>;

export type S3Deps = Readonly<{
  listObjects: () => Promise<readonly S3ObjectSummary[]>;
  /** A browser-usable URL for an object key (public base or presigned). */
  urlFor: (key: string) => Promise<string>;
}>;

export type S3Config = Readonly<{
  bucket: string;
  region: string;
  prefix: string;
  publicUrlBase: string | null;
}>;

const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "gif", "webp", "avif"]);
const VIDEO_EXTENSIONS = new Set(["mp4", "webm", "mov", "m4v"]);
/** Sibling-poster convention: `clip.mp4` uses `clip.jpg`/`clip.png`/… from
 *  the same folder as its thumbnail when one exists. S3 has no transformation
 *  service, so a poster either sits next to the video or there isn't one. */
const POSTER_EXTENSIONS = ["jpg", "jpeg", "png", "webp"];

function extensionOf(key: string): string {
  const name = key.split("/").pop() ?? key;
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
}

function kindOf(key: string): AssetKind | null {
  const extension = extensionOf(key);
  if (IMAGE_EXTENSIONS.has(extension)) return "image";
  if (VIDEO_EXTENSIONS.has(extension)) return "video";
  return null;
}

export function readS3Config(
  env: Readonly<Record<string, string | undefined>> = process.env,
): S3Config | null {
  const bucket = env.S3_ASSETS_BUCKET;
  const region = env.S3_ASSETS_REGION;
  if (!bucket || !region) return null;
  const rawPrefix = env.S3_ASSETS_PREFIX ?? "";
  return {
    bucket,
    region,
    // Normalized to "segment/segment/" (or "") so key math never sees a
    // doubled or missing slash whatever the env author typed.
    prefix: rawPrefix.replace(/^\/+|\/+$/g, "") + (rawPrefix.trim() ? "/" : ""),
    publicUrlBase: env.S3_ASSETS_PUBLIC_URL?.replace(/\/+$/, "") ?? null,
  };
}

/** 30s listing cache — the palette refetches per folder navigation, and each
 *  uncached hit is a full paginated ListObjectsV2 sweep. Promise-cached so a
 *  burst shares one in-flight listing, same pattern as the Cloudinary store. */
const LISTING_TTL_MS = 30_000;

async function mapObjects(
  objects: readonly S3ObjectSummary[],
  scopePrefix: string,
  projectId: string,
  urlFor: (key: string) => Promise<string>,
): Promise<Asset[]> {
  // Key set for the sibling-poster lookup, before any filtering: the poster
  // image is itself a listable asset AND the video's thumbnail — hiding it
  // from the listing would guess at intent, so it stays visible.
  const keys = new Set(objects.map((object) => object.key));
  const assets: Asset[] = [];
  for (const object of objects) {
    const kind = kindOf(object.key);
    // Not renderable media (manifests, sidecar files, "directory" markers) —
    // skipped rather than surfaced as broken tiles.
    if (kind === null) continue;
    if (!object.key.startsWith(scopePrefix)) continue;
    const relative = object.key.slice(scopePrefix.length);
    const segments = relative.split("/").filter((segment) => segment.length > 0);
    if (segments.length === 0) continue;

    const src = await urlFor(object.key);
    let thumbnailUrl = kind === "image" ? src : "";
    if (kind === "video") {
      const stem = object.key.slice(0, object.key.length - extensionOf(object.key).length - 1);
      const posterKey = POSTER_EXTENSIONS.map((ext) => `${stem}.${ext}`).find((candidate) =>
        keys.has(candidate),
      );
      if (posterKey !== undefined) thumbnailUrl = await urlFor(posterKey);
    }

    assets.push({
      id: object.key,
      providerId: S3_PROVIDER_ID,
      projectIds: [projectId],
      name: segments[segments.length - 1],
      kind,
      src,
      // "" when a video has no sibling poster — the palette renders a
      // labelled tile for that, per the degradation contract.
      thumbnailUrl,
      folderPath: segments.slice(0, -1),
      tags: [],
      ...(object.size === undefined ? {} : { bytes: object.size }),
      ...(object.lastModified === undefined ? {} : { createdAt: object.lastModified }),
    });
  }
  return assets;
}

/** The REAL deps, built on first use: the SDK loads lazily so a deployment
 *  without S3 configured never pays for it, and everything stays behind the
 *  `S3Deps` seam the unit tests inject through. */
function createSdkDeps(config: S3Config): S3Deps {
  type SdkHandles = {
    send: (input: { prefix: string; token?: string }) => Promise<{
      objects: S3ObjectSummary[];
      nextToken?: string;
    }>;
    presign: (key: string) => Promise<string>;
  };
  let handlesPromise: Promise<SdkHandles> | null = null;
  const handles = () =>
    (handlesPromise ??= (async () => {
      const [{ S3Client, ListObjectsV2Command, GetObjectCommand }, { getSignedUrl }] =
        await Promise.all([import("@aws-sdk/client-s3"), import("@aws-sdk/s3-request-presigner")]);
      const client = new S3Client({ region: config.region });
      return {
        send: async ({ prefix, token }) => {
          const output = await client.send(
            new ListObjectsV2Command({
              Bucket: config.bucket,
              Prefix: prefix,
              MaxKeys: 1000,
              ...(token === undefined ? {} : { ContinuationToken: token }),
            }),
          );
          return {
            objects: (output.Contents ?? []).flatMap((entry) =>
              entry.Key === undefined
                ? []
                : [
                    {
                      key: entry.Key,
                      ...(entry.Size === undefined ? {} : { size: entry.Size }),
                      ...(entry.LastModified === undefined
                        ? {}
                        : { lastModified: entry.LastModified.toISOString() }),
                    },
                  ],
            ),
            nextToken: output.NextContinuationToken,
          };
        },
        presign: (key) =>
          getSignedUrl(
            client,
            new GetObjectCommand({ Bucket: config.bucket, Key: key }),
            { expiresIn: 3600 },
          ),
      };
    })());

  return {
    listObjects: async () => {
      const sdk = await handles();
      const objects: S3ObjectSummary[] = [];
      let token: string | undefined;
      let pages = 0;
      do {
        const page = await sdk.send({ prefix: config.prefix, token });
        objects.push(...page.objects);
        token = page.nextToken;
        pages += 1;
      } while (token !== undefined && pages < 10);
      return objects;
    },
    urlFor: (key) => {
      if (config.publicUrlBase !== null) {
        // Encode per segment; the "/" separators are real path structure.
        const encoded = key.split("/").map(encodeURIComponent).join("/");
        return Promise.resolve(`${config.publicUrlBase}/${encoded}`);
      }
      return handles().then((sdk) => sdk.presign(key));
    },
  };
}

/**
 * Null when the env doesn't configure S3 — the registry then simply doesn't
 * register it, so the picker never offers a dead provider.
 */
export function createS3AssetProvider(
  env: Readonly<Record<string, string | undefined>> = process.env,
  depsOverride?: S3Deps,
): AssetProvider | null {
  const config = readS3Config(env);
  if (config === null) return null;
  const deps = depsOverride ?? createSdkDeps(config);

  let cached: { at: number; objects: Promise<readonly S3ObjectSummary[]> } | null = null;
  const listing = () => {
    if (cached !== null && Date.now() - cached.at < LISTING_TTL_MS) return cached.objects;
    const objects = deps.listObjects();
    // A failed sweep must not poison the cache window with a rejection.
    objects.catch(() => {
      cached = null;
    });
    cached = { at: Date.now(), objects };
    return objects;
  };

  return {
    id: S3_PROVIDER_ID,
    label: `S3 (${config.bucket})`,
    capabilities: {
      folders: true,
      // Object tags need a GetObjectTagging call PER OBJECT — unaffordable
      // on a listing, so the capability is honestly off and the palette's
      // Folders/Tags toggle disappears for this provider.
      tags: false,
      // Same in-memory derivation over the same full listing that folders
      // come from (pageFromSearch) — S3 has no search API, but none is
      // needed, so this is exactly as complete as browsing is here.
      search: true,
      upload: false,
      delete: false,
    },
    async list(ctx, query) {
      const objects = await listing();
      const scopePrefix = `${config.prefix}${ctx.uid}/${ctx.projectId}/`;
      const assets = await mapObjects(
        objects,
        scopePrefix,
        ctx.projectId,
        deps.urlFor,
      );
      // Search outranks browsing: a query spans the whole library, so scoping
      // it to the folder the user was standing in would hide the hits.
      if (query.search !== undefined && query.search.trim().length > 0) {
        return pageFromSearch(assets, query);
      }
      // tagPath can arrive despite the capability (the contract: ignore,
      // never throw) — without tags every asset would sit at the tags root,
      // which is just the folder-flat view, so serve folders regardless.
      return pageFromFlatListing(assets, query);
    },
  };
}
