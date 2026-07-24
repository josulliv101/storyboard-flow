// THE registry instance the API routes resolve providers from. Server-only by
// composition: the adapters registered here read env config and call vendor
// APIs. Registration order is preference order — the first entry is what a
// request that names no provider gets.
//
// Adding a provider = one adapter file + one entry here.

import { cloudinaryAssetProvider } from "./cloudinary-provider";
import { createAssetProviderRegistry, type AssetProvider } from "./provider";
import { createS3AssetProvider } from "./s3-provider";

// Cloudinary is always present (it's env-or-nothing at call time, but the
// adapter registers unconditionally); S3 only appears when its bucket is
// configured, so an unconfigured deployment never offers a dead provider in
// the picker. `createS3AssetProvider` returns null in that case.
const providers: AssetProvider[] = [cloudinaryAssetProvider];
const s3Provider = createS3AssetProvider();
if (s3Provider !== null) providers.push(s3Provider);

export const assetProviders = createAssetProviderRegistry(providers);
