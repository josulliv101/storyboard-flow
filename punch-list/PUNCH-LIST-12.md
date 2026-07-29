# Punch List 12

## PL12-006 — Delete the browse seam the tray was the only user of

- Status: Complete
- Area: `app/api/assets/{route,providers}` (deleted), `lib/assets/path-folders`
  (deleted), `lib/assets/{types,provider,registry,cloudinary-provider,s3-provider}`,
  `docs/asset-providers.md`
- Screenshot: n/a (server-side)

PL12-005 left `/api/assets`, `/api/assets/providers`, `path-folders.ts` and both
adapters' `list()` standing with no consumer. This removes them.

What went: the two routes and their tests, the folder/tag/search derivations and
theirs, `Asset` / `AssetFolder` / `AssetPage` / `AssetQuery`, four of the five
capabilities, and the listing halves of both adapters — including S3's 30-second
listing cache, sibling-poster lookup and presigned URLs (so
`@aws-sdk/s3-request-presigner` left the app's dependencies with them). ~1,400
lines net.

What the seam says now, which is all the app actually asks of a provider:

```
AssetProvider = { id, label, capabilities: { delete }, remove?(ctx, target) }
```

Three consequences worth stating, because each was a deliberate call:

- **The registry is a lookup and nothing more.** `defaultProvider()` answered
  "who serves a request naming no provider" and `describeAll()` fed the picker;
  both were browse concerns. Every caller now arrives holding a `providerId` off
  a tombstone, so resolution is exact and registration order means nothing.
- **An empty registry is legal now.** It used to throw, because
  `defaultProvider()` had to have something to return. Empty simply means a
  deployment where nothing can be reclaimed.
- **`LIST_ONLY_CAPABILITIES` kept its name and lost its meaning** — it is now
  `{ delete: false }`, the starting point for a new adapter that cannot do
  anything yet. Renaming it is churn for a constant with one field; it is
  documented rather than disguised.

The one capability left still earns its keep: a provider that cannot delete must
say so rather than accept a reclaim request it will silently ignore. The
capability and the method are ONE claim, and since the registry cannot enforce
the pairing, each adapter's tests assert both.

Verified: app tsc clean, 485 app tests (was 534 — the 49 removed were browse
tests), lint clean (5 pre-existing `<img>` warnings), graph-view e2e 95/95, and
live: `/api/assets` and `/api/assets/providers` now 404 while
`/api/assets/marked` still answers 200 and `/api/assets/reclaim` still refuses
with 503.

TRAP, seen twice this session: the Browser pane's console buffer PRESERVES a
module-parse error from a mid-edit compile across reloads. It read as a live
syntax error in a file that compiles, whose component renders, and whose suite
passes through the same dev server. Prove it stale by exercising the component
rather than by re-reading the console.

## PL12-005 — Retire the asset tray

- Status: Complete (UI), with the server-side browse surface left standing —
  see the open question at the end
- URL: http://localhost:3000/timeline/project-1785180655904-uc9isj/graph
- Area: `graph-asset-palette.tsx` (deleted), `timeline-sidebar.tsx`,
  `graph-timeline-view.tsx`, `graph-native-drop.tsx`, `graph-preview.tsx`
- Screenshot: Not captured

The user's call on the one capability the tray uniquely had: **re-upload is the
answer.** An asset already in the library has no path back onto a board, and
that is accepted rather than replaced.

Checked before deleting anything, because it would have made this a bad idea:
**the file-drop upload path records `sourceAsset` itself**, from the upload
response — not from the palette. PL12-003 keeps its provenance.

Gone: the palette component, its mount, the sidebar's Assets launcher, the
`GRAPH_ASSETS_TOGGLE_EVENT` handoff, `assetsOpen` on the published view state,
`use-bottom-drawer-inset` (its only consumer), the app's `onPaletteDiscard`
wiring, and 7 palette-only e2e tests.

### The bug this uncovered

Two e2e tests pin the flat-mode drop translation — the deterministic bug from
PR #216, where a drop meant for Scene A landed in the project. Their drag source
was the palette, so they had to move to OS file drops. They failed, and not for
harness reasons:

**A file drop never reached `mapDropCommand`.** It dispatches its add straight
to the store, so only dnd-kit palette drags were ever translated. In flat mode
the strip is wrapped in `NativeDropStrip collectionId={focusedId}`, so a file
dropped between two of Scene A's clips inserted into the PROJECT at a flat
index. Pre-existing, and retiring the tray made it load-bearing: file drops are
now the only way to add media, so the whole add path sat on the unfixed side.

The first fix — translating inside `addNodes` — was wrong, and instructively:
it passed one test by accident. The anchor was ALREADY resolved in the wrong
space, so the number being translated was not a flat boundary at all.

`resolveDropAnchor` walked the mounted cards (the flat run) but looked each one
up among the collection's CHILDREN. In a flat run most cards are not children,
so `indexOfChildId` returned -1 and the scan walked straight past the card the
pointer was in front of, stopping at whichever later card happened to be a
direct child too — and recorded ITS neighbours. A drop after `c2` resolved to
`charlie`. The indicator, being pure geometry, kept pointing at the right gap
the whole time, so the line the user saw and the index that committed
disagreed — while `handleDrop`'s own comment promised they could not.

The fix is one idea in two places: **resolve the drop in whatever order the
strip is SHOWING.** `resolveDropAnchor` takes its index and neighbours from the
flat run when there is one, and `resolveAnchoredTarget` (was
`resolveAnchoredIndex`) re-reads them in that same space and runs
`resolveFlatDropTarget` — the same helper the dnd-kit path uses — returning a
PARENT as well as an index. Returning the parent is what keeps `addNodes` dumb:
an explicitly named parent is never re-interpreted, which is the mistake #216
was.

`useFlatItems` is the seam: the board publishes the flat run around the focused
surface and `null` around every sub-row, so "non-null" IS "this is the focused
flat strip" — no second flag to keep in step.

The e2e helper `dropOneFile` dispatches **dragover before drop**. A bare `drop`
never opens a drag session, so the anchor falls back to a stale index; the older
upload tests only get away with it because they drop at clientX 0.

Verified: app tsc clean, 534 app tests, lint clean (5 warnings, all
pre-existing `<img>`), graph-view e2e **95/95** (102 minus the 7 palette tests),
and live — the rail has no Assets tile, the trash drawer still opens, no console
errors.

### Open, and deliberately not decided here

`/api/assets`, `/api/assets/providers`, `lib/assets/path-folders.ts`, and both
adapters' `list()` now have NO consumer — the palette was the only one. That is
~700 lines of route and derivation plus ~350 of tests, and deleting it would
leave the provider seam as `{ id, label, capabilities.delete, remove }`, which
is honestly all the app still asks of a provider. It would also collapse the S3
adapter to a delete-only client.

Not done in this pass: it is a much larger architectural deletion than
"retire the tray", and the seam took five phases to build. Worth a decision of
its own.

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

- Status: Complete
- URL: http://localhost:3000/timeline/project-1785180655904-uc9isj/graph
- Area: `trash-drawer.tsx`, `app/api/assets/marked/route.ts` (new),
  `lib/asset-deletion-window.ts` (new), `lib/asset-tombstones.ts`
- Screenshot: Not captured

Two waiting rooms is one too many. PL12-003 marks an asset and deletes it 30
days later, but a mark with no UI is a clock nobody can see or act on, while
the trash is already a holding area with a restore control.

The drawer now carries both, bordered apart because they answer different
questions: what did I delete (and can put back), versus what is about to stop
existing. Each row shows the file, its name, `Deletes in N days`, and **Keep**.

The word is **Keep**, not Restore, and that is the honest one. Nothing moved
when the asset was marked — the file has been in the library the whole window —
so this withdraws an intention and puts nothing back on a timeline. Calling it
"restore" would promise a clip that never arrives.

**A tombstone has to carry its own display.** There is no clip left pointing at
a marked asset — that is what being marked MEANS — so nothing can be re-derived
from the graph and no provider call can be scoped to a project that no longer
references it. The mark therefore records `name` and `thumbnailUrl` at write
time, the same snapshot rule `TrashOrigin` follows. The file survives the whole
window, so its own URL keeps resolving right up until it doesn't.

Three smaller decisions:

- **Rounded UP.** 19.5 days left reads "20 days": the deadline is when deletion
  becomes ALLOWED, so rounding down would show "19" for something still safe.
  Zero says "Deletes any time now" rather than "0 days" — the actual moment is a
  cron schedule, and it is still recoverable, so the words must be neither a
  countdown nor an obituary.
- **A separate request with a separate failure.** The bin is the drawer's job;
  this section is an addition to it. A marked-list that fails to load shows
  nothing and leaves the bin working, where one combined error surface would let
  a broken side-panel hide the trash.
- **The big "Trash is empty" state now needs BOTH lists empty.** A bin with
  nothing in it but files on their way out is not an empty drawer, and saying so
  would hide the only thing there is still a decision to make about.

E2E TRAP worth keeping: the suite's palette mock is `**/api/assets**`, which
also matches `/api/assets/marked` — it would have answered the drawer with a
page of palette assets. Playwright matches handlers in REVERSE registration
order, so the fix is a narrower route registered after it (and a per-test
override registered after `installGraphApi`, not before).

Verified live against the running app with two seeded tombstones: the section
rendered, the labels read "Deletes in 1 day" / "Deletes in 26 days", Keep
cleared the mark on the server and dropped the row, and the other row was
untouched. Proven fail-first: with Keep not calling the server, the e2e's
payload assertion fails.

Not built, and named here rather than assumed: once PL12-005 retires the tray,
a kept asset has no way back onto a board. Whatever replaces the tray owes an
insertion path — this section is a decision surface, not an inserter.

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
