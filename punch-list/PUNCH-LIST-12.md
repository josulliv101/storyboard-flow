# Punch List 12

## PL12-005 — Retire the asset tray

- Status: Not started
- Area: `graph-asset-palette.tsx`, `timeline-sidebar.tsx`
- Blocked by: PL12-003, PL12-004

The tray browses a BYPRODUCT. Media enters this app by being dropped on the
board (`/api/timeline-media/upload`), and every asset is minted
`projectIds: [projectId]` — scoped to the project it was uploaded into, so
there is no cross-project reuse for the tray to serve. What it shows that the
board does not is orphans: assets in storage that no timeline references.

Once PL12-003 reclaims those, orphans stop accumulating and the tray has
nothing left of its own to show. PL12-004 gives the one remaining case — media
that is deleted but still recoverable — a better home.

What must NOT be lost with it: the ability to find something. That is a
separate need and a different target (clips on the board, searched by the
`title` PL11-004 added), not an asset browser. Log it as its own item rather
than smuggling it in here.

## PL12-004 — The trash becomes the recently-deleted surface

- Status: Not started
- Area: `trash-drawer.tsx`, `/api/trash`
- Blocked by: PL12-003

Two waiting rooms is one too many. PL12-003 marks an asset and deletes it 30
days later, but a mark with no UI is a clock nobody can see or act on, while
the trash is already a holding area with a restore control.

So the trash grows a "Recently deleted" section: assets carrying a tombstone,
with days remaining, and a restore that clears the tombstone. The file never
went anywhere during the window — restoring is bookkeeping, not a re-upload.

This is what the trash becomes once the tray is gone: the surface for
everything that is not currently on a board. It is also where the copy debt
is — the empty-trash confirm still promises that uploaded files stay in the
Assets library, which PL12-003 makes false.

## PL12-003 — Reference-counted asset deletion

- Status: Complete
- Area: `lib/assets/asset-references.ts` (new), `lib/asset-tombstones.ts`
  (new), `app/api/assets/reclaim/route.ts` (new), `/api/trash`,
  `firebase-timeline-store.ts`, both provider adapters, `vercel.json` (new)
- Screenshot: n/a (server-side)

Nothing in this app has ever reclaimed storage: both providers declare
`delete: false`, so a Cloudinary/S3 object outlives every timeline that
referenced it, forever. Emptying the trash is the moment the user says the
media is finished with, and today it is the moment the app forgets the media
exists while continuing to pay for it.

The naive version of this shipped once and was REVERTED as unsafe — see the
comment in `/api/trash`: one upload can back several clips (stable per-asset
clip ids mean placing an asset twice makes two clips of one file), and the bin
is per-USER (`trash-${uid}`) while an asset is per-project, so one bin spans
everything the user owns. Deleting the file behind a trashed clip could pull
it out from under a clip still on a board.

The rule is therefore REFERENCES, not the bin: an asset dies when nothing
points at it. `sourceAsset` is recorded on every clip minted from an asset for
exactly this ("the hook for re-linking, usage queries, and safe deletion
later").

And the delete is DEFERRED by 30 days, which buys more than user forgiveness:
the sweep re-checks references before it deletes, so the mark is advisory and
a scan that missed a reference self-corrects instead of losing a file. The
correctness requirement drops from "the scan must be right" to "the scan must
be roughly right".

Decisions:

- **The tombstone lives in Firestore**, keyed by `AssetSourceRef`
  (`{providerId, assetId}`), not as a vendor tag — Cloudinary tags and S3
  object tags would be two implementations of one idea, below a seam built to
  stop exactly that.
- **No Firestore TTL policy on it**, even though this repo already uses TTL
  (`mcpOAuthCodes`, `mcpOAuthRefreshTokens` in `firestore.indexes.json`). TTL
  would expire the RECORD and keep the FILE — precisely inverted. The
  tombstone must outlive its own deadline until a sweeper honours it.
- **A cron-triggered, token-guarded reclaim route**, daily against a 30-day
  window. Not a lazy sweep on a read path: round 12 took writes off read
  paths, and a user who does not sign in for two months would never reclaim.
- **Restore-from-trash is the only un-mark.** Once the tray is gone nothing
  else can resurrect an asset — a re-upload mints a NEW public id, so it could
  not match the tombstone anyway.
- **Scan, don't index.** "Is this referenced" reads the user's documents.
  Acceptable at empty-time and in a batched nightly sweep; a usage index
  (`assetId → documents`) is the follow-up if it gets slow, not the first
  build.

Acceptance criteria:

- Emptying the bin marks only assets NOTHING references; a file backing a clip
  still on a board is never marked. ✅
- The sweep re-checks references and deletes only what is still unreferenced
  after 30 days; a re-referenced asset loses its tombstone instead. ✅
- A failure to mark leaks storage rather than losing a file. ✅
- Restoring from the trash clears the tombstone — NOT BUILT, and it turned out
  not to be reachable: a tombstone only exists after the bin was emptied, and
  emptying leaves no entry to restore. The equivalent case (an asset marked,
  then re-placed from the tray) is covered by the sweep's re-check. An explicit
  un-mark control belongs with PL12-004, which is where a marked asset first
  becomes visible.

What was built:

- **`lib/assets/asset-references.ts`** — the pure rule, no Firestore and no
  clock: `assetRefKey` (both halves percent-encoded before joining on `|`, so
  no path-shaped Cloudinary id can fake the delimiter — and escaping `/` is
  also what makes it a legal Firestore document id), `assetCandidatesFromClips`,
  `unreferencedCandidates`.
- **`lib/asset-tombstones.ts`** — the records, in `gstudioAssetTombstones`,
  carrying `kind` because the sweep runs 30 days after the last clip that knew
  it. A re-mark restarts the clock, which is the correct reading rather than a
  shortcut: a tombstone is cleared the moment anything references the asset, so
  a second mark means it became unreferenced a second time.
- **`collectOwnedTimelineClips`** in the store — paged to exhaustion, ownership
  filtered IN the query, and reading `document.clips`, the legacy top-level
  `clips` AND `lastNonEmptyDocument` because `toTimelineDocument` will hand any
  of the three back as the live document. Past 5,000 documents it THROWS
  (`TimelineScanIncompleteError`) rather than returning what it has: an asset
  dies on the strength of "nothing references this", so a scan that stopped
  early is indistinguishable from a clean bill of health.
- **`AssetProvider.remove`** + `capabilities.delete` on both adapters, taking
  an OWNER context rather than a project one. Each refuses an id outside its
  owner's prefix (`gstudio/<uid>/`, `<prefix>/<uid>/` — the trailing slash is
  what stops `user-1` matching `user-10`), and S3's drops the listing cache so
  a deleted object stops being served.
- **`GET /api/assets/reclaim`** — cron-driven, `CRON_SECRET` bearer compared in
  constant time, 503 (never open) when unset. Groups due tombstones by owner,
  re-scans, spares what came back, deletes the rest. A failed scan skips that
  OWNER entirely; a failed vendor delete or an unconfigured provider leaves the
  tombstone due, because forgetting the intention would strand the file.

Both halves proven fail-first: without the reference check, emptying marks a
file two clips share (2 red); without the sweep's re-check, an asset back in use
is deleted (2 red).

Verified: app tsc clean, 521 app tests, lint clean (4 pre-existing `<img>`
warnings), graph-view e2e 101/101, and the live route answers 503 with no
`CRON_SECRET` configured.

Two things for the user to confirm before this does anything in production:

- `CRON_SECRET` must be set in the Vercel environment, or the sweep never runs
  (which is the safe direction — storage leaks, nothing is lost).
- `vercel.json` is at `apps/timeline-gstudio001/`, which assumes the Vercel
  project's Root Directory is that app. If the project deploys from the repo
  root instead, the cron entry has to move with it.

## PL12-002 — A longer active-tile bar

- Status: Complete
- URL: http://localhost:3000/timeline/project-1785180655904-uc9isj/graph
- Area: `timeline-sidebar.tsx`
- Screenshot: Not captured

The sky bar marking the active layout tile (grid / strip) went from `h-7` to
`h-9` — 28px to 36px, against a 56px pill inside a 71px tile.

Long enough to read as a bar rather than a tick, short enough that it still
marks a POSITION instead of drawing a second edge down the rail, which is the
whole reason the treatment is a bar and not a filled tile.

Verified live: the active tile's `::after` computes to 36px × 3px in
`oklch(0.828 0.111 230.318)` (sky-300), the idle tile has none, and the bar
follows the surface when the layout is switched.

## PL12-001 — The grid layout's glyph is nine cells

- Status: Complete
- URL: http://localhost:3000/timeline/project-1785180655904-uc9isj/graph
- Area: `timeline-sidebar.tsx`
- Screenshot: Not captured

Supplied as an SVG (`menu-grid-r`, SVG Repo): a 3×3 of filled 4-unit cells on a
24-unit box. It replaces lucide's `Table`, which drew a bordered frame divided
by rules — a spreadsheet, which is the wrong noun for a wall of cards.

Inlined as a local `GridLayoutGlyph` beside `FilmStripGlyph` rather than
shipped as a file: every other rail glyph is a component, and an `<img>` could
not take the rail's colour. Two changes to what was handed over, both
load-bearing:

- `fill="#000000"` → `fill="currentColor"`, so the glyph follows idle /
  hover / active with the rest of the rail. Verified live: zinc-400
  (`oklch(0.705 …)`) at rest, zinc-50 when the surface is active. Tailwind's
  `transition-colors` covers `fill`, so it cross-fades like its neighbours.
- The nine paths become nine `<rect>`s generated from one `[4, 10, 16]` track
  list — identical geometry, and it reads as the 3×3 it is meant to be.

It is the one glyph in the rail that ignores `SIDEBAR_GLYPH`'s
`[stroke-width:1.5]`, being filled rather than stroked. Worth a look on the
next pass: against the 1.5-stroke outlines around it a solid 3×3 carries more
weight, which PL11-001 spent effort taking out of the rail.

Acceptance criteria:

- The grid tile renders the nine-cell glyph at 28px.
- Its colour tracks the rail's idle, hover and active states.
- The `Grid layout` label and `aria-pressed` behaviour are unchanged (the e2e
  addresses the control by that name).
