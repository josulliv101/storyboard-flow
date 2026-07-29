# Asset providers

A provider is a media backend behind a neutral seam. Everything above it speaks
the shapes in `apps/timeline-gstudio001/lib/assets/types.ts`; a backend joins by
implementing one interface and registering one line.

The seam is much smaller than it was. It was built over five phases to serve
BROWSING — folders, tags, search, pagination, a provider picker — for the asset
tray. The tray was retired in PL12-005 (media enters this app by being dropped
on the board, and assets are project-scoped, so there was no reuse for a browser
to serve), and PL12-006 removed the browse half that had no consumer left:
`/api/assets`, `/api/assets/providers`, `lib/assets/path-folders.ts`, both
adapters' `list()`, and the `Asset` / `AssetFolder` / `AssetPage` / `AssetQuery`
model. Git history has all of it if browsing ever returns.

## The seam today

- **`AssetSourceRef`** (`lib/assets/types.ts`) — `{ providerId, assetId }`, the
  durable identity of a file. **Recorded on every clip minted from an upload**
  (`sourceAsset` on the stored model, round-tripped through the graph's details
  side-table like `poster`). `src` is how a clip renders; this is what it IS,
  and it is what reference-counted deletion counts.
- **`AssetProvider`** (`lib/assets/provider.ts`) — a descriptor plus one
  optional method, `remove(ctx, { assetId, kind })`. `ctx` carries the signed-in
  uid today; per-user OAuth credentials (Drive/Dropbox) arrive there when that
  track lands.
- **`assetProviders`** (`lib/assets/registry.ts`) — the server-only instance,
  now a lookup by id and nothing more. Every caller arrives holding a
  `providerId` off a tombstone, so resolution is exact and registration order
  means nothing.

**Capabilities are the degradation contract**, and there is one left:
`{ delete }`. Declare it only when `remove` is actually implemented — the
registry cannot enforce the pairing, so it is the adapter's own tests that
must. A provider that cannot delete says so rather than accepting a reclaim
request it will silently ignore.

**Deletion rules both adapters follow.** An id outside the owner's prefix is
REFUSED (`<folder>/<uid>/` for Cloudinary, `<prefix>/<uid>/` for S3 — the
trailing slash is what stops `user-1` matching `user-10`). A missing asset is a
SUCCESS: the desired end state is "this file is not there", and a sweep that
threw on an already-deleted object would jam behind it forever.

## Reclaiming storage

Nothing deleted an uploaded file until PL12-003, so a Cloudinary/S3 object
outlived every timeline that referenced it. The rule is REFERENCES, and it runs
in two halves:

- **Marking** — `DELETE /api/trash` (emptying the bin) scans the owner's
  documents and writes a tombstone for each trashed clip's `sourceAsset` that no
  surviving clip points at. `lib/assets/asset-references.ts` holds the pure
  rule; `lib/asset-tombstones.ts` the records.
- **Sweeping** — `GET /api/assets/reclaim`, cron-driven (`vercel.json`,
  `CRON_SECRET`), takes tombstones past their 30-day grace period,
  **re-checks references**, and deletes only what is still unreferenced.
  Anything back in use loses its tombstone instead.

`GET /api/assets/marked` serves the trash drawer's recently-deleted list, and
`DELETE` on the same route is "Keep" — it drops marks, never files.

Three properties worth preserving if this is ever rewritten:

- The re-check is what lets the marking scan be merely careful. A mark is an
  intention, never an authority.
- Every failure leaks storage rather than losing a file: an un-provenanced clip
  names no asset and is never marked; an incomplete document scan throws
  (`TimelineScanIncompleteError`) instead of reporting "unreferenced"; a failed
  vendor delete leaves the tombstone due.
- The tombstone collection must NOT get a Firestore TTL policy. TTL would expire
  the record and strand the file — the exact inverse of the job.

## The vendor stores

`listCloudinaryAssets` survives in exactly two places, both outside this seam:
the upload route's neighbourhood and `serve-timeline`'s document HEALING
(validating a stored clip's media still exists). Uploading is likewise still
direct — `/api/timeline-media/upload` talks to the vendor store, and it is what
stamps `sourceAsset` onto the clip it mints. Moving upload behind the seam is
the obvious next phase if a second upload target ever appears.

## Enabling S3

Set in the app's environment:

```
S3_ASSETS_BUCKET=my-media-bucket
S3_ASSETS_REGION=us-east-1
S3_ASSETS_PREFIX=media/            # optional key prefix
```

Credentials ride the AWS SDK default chain (`AWS_ACCESS_KEY_ID` /
`AWS_SECRET_ACCESS_KEY`, or an instance role). With the bucket set, the provider
registers and can delete objects the sweep asks it to. The bucket is app-level;
per-user buckets would be the OAuth track's concern.

`S3_ASSETS_PUBLIC_URL` is gone with the listing — nothing builds a browse URL
any more, so no presigning either (`@aws-sdk/s3-request-presigner` was dropped
from the app's dependencies).

Out of scope until its own track: per-user OAuth providers (token storage,
refresh, connect/disconnect UI). The context parameter is where those
credentials will arrive; nothing above the seam changes.
