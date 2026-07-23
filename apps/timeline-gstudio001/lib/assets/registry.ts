// THE registry instance the API routes resolve providers from. Server-only by
// composition: the adapters registered here read env config and call vendor
// APIs. Registration order is preference order — the first entry is what a
// request that names no provider gets.
//
// Adding a provider = one adapter file + one entry here. The S3 adapter
// (decided 2026-07-23: the second provider, proving the seam) lands as
// exactly that pair.

import { cloudinaryAssetProvider } from "./cloudinary-provider";
import { createAssetProviderRegistry } from "./provider";

export const assetProviders = createAssetProviderRegistry([cloudinaryAssetProvider]);
