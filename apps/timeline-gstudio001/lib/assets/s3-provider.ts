// Amazon S3 behind the neutral seam.
//
// It was the seam's second adapter and its proof that the model was not
// Cloudinary-shaped: a bucket is a flat namespace of path-shaped KEYS, so
// folder browsing fell out of the same derivation. That browsing is gone with
// the asset tray (PL12-005/006), and what remains is the half the reclaim sweep
// uses — deleting one object, refusing anything outside its owner's prefix.
//
// Env-configured (no per-user OAuth — that is its own future track):
//   S3_ASSETS_BUCKET       required — registers the provider when present
//   S3_ASSETS_REGION       required
//   S3_ASSETS_PREFIX       optional key prefix ("media/")
// Credentials ride the SDK's default chain (AWS_ACCESS_KEY_ID / role / …).
//
// Objects live under `<prefix>/<uid>/<projectId>/`, which is the ownership
// boundary a delete is held to.

import type { AssetProvider } from "./provider";

export const S3_PROVIDER_ID = "s3";

export type S3Deps = Readonly<{
  /** Permanently remove one object. S3's DeleteObject is idempotent —
   *  deleting a key that isn't there succeeds — which is exactly the contract
   *  the provider's `remove` wants. */
  deleteObject: (key: string) => Promise<void>;
}>;

export type S3Config = Readonly<{
  bucket: string;
  region: string;
  prefix: string;
}>;

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
  };
}

/** The REAL deps, built on first use: the SDK loads lazily so a deployment
 *  without S3 configured never pays for it, and everything stays behind the
 *  `S3Deps` seam the unit tests inject through. */
function createSdkDeps(config: S3Config): S3Deps {
  let clientPromise: Promise<(key: string) => Promise<void>> | null = null;
  const remover = () =>
    (clientPromise ??= (async () => {
      const { S3Client, DeleteObjectCommand } = await import("@aws-sdk/client-s3");
      const client = new S3Client({ region: config.region });
      return async (key: string) => {
        await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
      };
    })());

  return { deleteObject: (key) => remover().then((remove) => remove(key)) };
}

/**
 * Null when the env doesn't configure S3 — the registry then simply doesn't
 * register it, and a tombstone naming this provider is skipped by the sweep
 * (left due) rather than acted on blindly.
 */
export function createS3AssetProvider(
  env: Readonly<Record<string, string | undefined>> = process.env,
  depsOverride?: S3Deps,
): AssetProvider | null {
  const config = readS3Config(env);
  if (config === null) return null;
  const deps = depsOverride ?? createSdkDeps(config);

  return {
    id: S3_PROVIDER_ID,
    label: `S3 (${config.bucket})`,
    capabilities: { delete: true },
    async remove(ctx, target) {
      // Keys live under `<prefix>/<uid>/<projectId>/`, so that is the boundary
      // a delete is held to. `kind` is unused: S3 addresses an object by key
      // alone.
      const ownerPrefix = `${config.prefix}${ctx.uid}/`;
      if (!target.assetId.startsWith(ownerPrefix)) {
        throw new Error("Refusing to delete an S3 object outside the owner's prefix.");
      }
      await deps.deleteObject(target.assetId);
    },
  };
}
