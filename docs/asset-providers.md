# Asset providers

The asset panel is provider-agnostic. Everything above the seam —
`/api/assets`, the graph palette, the (future) panel UI — speaks the neutral
shapes in `apps/timeline-gstudio001/lib/assets/types.ts`; a backend joins by
implementing one interface and registering one line.

## The seam

- **`Asset` / `AssetFolder` / `AssetPage` / `AssetQuery`** (`lib/assets/types.ts`)
  — the neutral model. Isomorphic: client components render these.
- **`AssetProvider`** (`lib/assets/provider.ts`) — `descriptor + list(ctx, query)`.
  `ctx` carries the signed-in uid today; per-user OAuth credentials
  (Drive/Dropbox) arrive there when that track lands.
- **`assetProviders`** (`lib/assets/registry.ts`) — the server-only instance.
  Registration order is preference order; the first entry answers requests
  that name no provider. Adding a provider = one adapter file + one entry.

**Capabilities are the degradation contract.** Each provider declares
`{ folders, tags, search, upload, delete }` and the UI renders only what is
true — a provider without folders gets a flat panel, one without upload gets
no drop zone. Declare a capability only when `list()` (etc.) actually honours
it. Providers must *ignore* query fields outside their capabilities, never
throw: capabilities gate the UI, not the wire.

**Identity.** `Asset.id` is the provider's own durable id (Cloudinary public
id, S3 object key). Anywhere two providers can meet, pair it with
`providerId` — that pair is `AssetSourceRef`, and it is **recorded on every
clip minted from an asset** (`sourceAsset` on the stored model, round-tripped
through the graph's details side-table like `poster`). `src` is how a clip
renders; `sourceAsset` is what it is — the hook for re-linking, usage
queries, and safe deletion later.

## Wire protocol

`GET /api/assets?provider=<id>&folder=<seg>&folder=<seg>&browse=1&limit=<n>`

- `folder` repeats one param per **path segment**, so a segment containing
  `/` can never fake a boundary (NodeId lesson: assume ids contain your
  delimiter).
- No `folder`/`browse` → the **flat** listing (every asset — today's palette
  view). `browse=1` alone → the **root** folder. Flat is a view; root is a
  place.
- Response: `{ providerId, capabilities, assets, folders, nextCursor? }`.

`GET /api/assets/providers` → `{ providers: AssetProviderDescriptor[] }` for
the picker.

## Hierarchy and tags

Both browse modes reduce to a path of segments, so one breadcrumb/list UI
serves both; only the source differs:

- **Folders** — real containment (`Asset.folderPath`). Path-based backends
  (Cloudinary public ids, S3 keys) derive browsing from key prefixes via the
  shared `pageFromFlatListing` (`lib/assets/path-folders.ts`); a provider
  with a native prefix/delimiter query should translate `AssetQuery` into it
  and skip the in-memory fallback.
- **Tags** — flat labels on `Asset.tags`; a `/` inside a tag is the
  pseudo-hierarchy separator the tags browse mode nests on (`scene/heist`).

## Phasing

1. ✅ Seam + Cloudinary adapter + neutral API + `sourceAsset` provenance
   (this document's landing change).
2. ✅ Folder browsing UI — the palette always browses (root on open; flat is
   no longer a palette view), folder tiles lead the rail, the breadcrumb
   climbs back, and visited pages answer from an in-drawer cache. A provider
   without folders reports none and the same view IS its flat listing.
3. ✅ Tags mode — the Cloudinary listing carries tags (Admin API `tags=true`,
   Search API `with_field: "tags"`), `AssetQuery.tagPath` browses the
   pseudo-hierarchy (`?mode=tags&tag=<seg>&tag=<seg>`; none = the tags root,
   where UNTAGGED assets sit beside the top-level groups), and the palette
   grows a capability-gated Folders/Tags toggle. An asset tagged twice lives
   in both places; folder placement is invisible in tag space.
4. ✅ **S3 adapter** + provider picker. `lib/assets/s3-provider.ts` maps
   object keys to neutral assets (folders from the key path via the same
   `pageFromFlatListing`), env-configured (`S3_ASSETS_BUCKET` /
   `S3_ASSETS_REGION`, optional `S3_ASSETS_PREFIX` and `S3_ASSETS_PUBLIC_URL`;
   URLs are presigned GETs when no public base is set, so private buckets
   work). The SDK loads lazily and the deps (`listObjects` / `urlFor`) are
   injectable, so the adapter unit-tests without AWS. The provider registers
   only when the bucket is configured; the palette's picker `<select>`
   appears only when more than one provider is installed. Upload/delete
   through the seam is still ahead (both providers declare them off).
5. Retire the legacy drawer's bespoke virtual-timeline folder pipeline
   (`/api/timelines/asset-library-*`) onto the seam.

## Enabling S3

Set in the app's environment:

```
S3_ASSETS_BUCKET=my-media-bucket
S3_ASSETS_REGION=us-east-1
S3_ASSETS_PREFIX=media/            # optional — the browse root inside the bucket
S3_ASSETS_PUBLIC_URL=https://cdn…  # optional — omit for presigned private URLs
```

Credentials ride the AWS SDK default chain (`AWS_ACCESS_KEY_ID` /
`AWS_SECRET_ACCESS_KEY`, or an instance role). With the bucket set, the
provider registers and the palette shows an "Asset source" picker. The
bucket is app-level (every signed-in user sees the same bucket); per-user
buckets would be the OAuth track's concern.

Out of scope until its own track: per-user OAuth providers (token storage,
refresh, connect/disconnect UI). The `AssetContext` parameter is where those
credentials will arrive; nothing above the seam changes.
