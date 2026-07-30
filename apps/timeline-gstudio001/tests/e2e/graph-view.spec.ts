import { expect, test, type Locator, type Page } from "@playwright/test";

// E2E for the graph project view (/timeline/[projectId]/graph) — the REAL
// Next app driven with real mouse input. The server surface the view touches
// (/api/auth/me, /api/timelines/[id], /api/timelines/batch, /api/assets) is
// mocked per-test with page.route(), so the suite exercises everything the
// Storybook layers can't: AuthGate, App Router layout persistence (undo
// across drill-in), the documents gateway's debounced ATOMIC batch writes
// with expected revisions, the trash root, and the
// preview playhead — without reading or writing any real storage.
//
// Selector contract (documented in packages/ui/dnd-collections/API.md):
//   [data-node-id] card buttons · [data-virtual-strip="<collectionId>"]
//   scroll containers · [data-trash-target] ·
//   [data-graph-playhead] / [data-graph-seek-rail] (app-side, graph view).
//
// Interaction contract: strip cards use press-and-hold
// drag activation (250ms) so fast swipes pan instead — every drag here holds
// past the delay before moving, then dwells before release (dnd-kit measures
// on a cadence; releasing early is the classic CI-only flake).

const PROJECT_ID = "project-e2e-1";
const CHILD_ID = "timeline-e2e-child";
const GRANDCHILD_ID = "timeline-e2e-grandchild";
const USER_ID = "e2e-user";
const TRASH_ID = `trash-${USER_ID}`;
const GRAPH_URL = `/timeline/${PROJECT_ID}/graph`;

// Deterministic 1x1 pixel — keeps <img> loads local and instant.
const PIXEL =
  "data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==";

// ── Fixture documents ───────────────────────────────────────────────────────

type FixtureClip = Record<string, unknown> & { id: string };
type FixtureDocument = { id: string; title: string; clips: FixtureClip[] };

function mediaClip(
  id: string,
  kind: "image" | "video",
  index: number,
  duration: number,
  sourceDuration = duration,
): FixtureClip {
  return {
    id,
    index,
    kind,
    src: PIXEL,
    poster: PIXEL,
    alt: id,
    aspect: 16 / 9,
    trackIndex: 0,
    startTime: 1 + index * 5,
    duration,
    sourceDuration,
    trimIn: 0,
    trimOut: sourceDuration - duration,
  };
}

function collectionClip(
  id: string,
  childTimelineId: string,
  index: number,
  name = "Scene A",
  itemCount = 2,
): FixtureClip {
  return {
    id,
    index,
    kind: "collection",
    title: name,
    childTimelineId,
    itemCount,
    previewItems: [],
    alt: name,
    aspect: 16 / 9,
    trackIndex: 0,
    startTime: 1 + index * 5,
    duration: 3,
    sourceDuration: 3,
    trimIn: 0,
    trimOut: 0,
  };
}

function buildFixtureDocuments(): Map<string, FixtureDocument> {
  return new Map<string, FixtureDocument>([
    [
      PROJECT_ID,
      {
        id: PROJECT_ID,
        title: "E2E Project",
        clips: [
          mediaClip("alpha", "video", 0, 6, 8),
          mediaClip("bravo", "image", 1, 4),
          collectionClip("clip-scene", CHILD_ID, 2),
          mediaClip("charlie", "image", 3, 4),
        ],
      },
    ],
    [
      CHILD_ID,
      {
        id: CHILD_ID,
        title: "Scene A",
        clips: [mediaClip("c1", "image", 0, 4), mediaClip("c2", "video", 1, 5, 6)],
      },
    ],
    [TRASH_ID, { id: TRASH_ID, title: "Trash Bin", clips: [] }],
  ]);
}

/** Flatten the fixture closure the way the real preview-manifest route does
 *  (fixtures are untrimmed, so every leaf plays at rate 1). */
function compileFixtureManifest(
  documents: Map<string, FixtureDocument>,
  rootId: string,
  revision: number,
) {
  const root = documents.get(rootId);
  if (!root) return null;
  type Leaf = Record<string, unknown>;
  const leaves: Leaf[] = [];
  const walk = (documentId: string, path: string[], offset: number) => {
    const doc = documents.get(documentId);
    if (!doc) return;
    for (const clip of doc.clips) {
      if (clip.kind === "collection") {
        const childId = clip.childTimelineId as string;
        walk(childId, [...path, childId], offset + (clip.startTime as number));
        continue;
      }
      leaves.push({
        id: clip.id,
        collectionPath: path,
        kind: clip.kind,
        src: clip.src,
        poster: clip.poster,
        timelineStart: offset + (clip.startTime as number),
        timelineDuration: clip.duration,
        sourceStart: clip.trimIn ?? 0,
        playbackRate: 1,
      });
    }
  };
  walk(rootId, [rootId], 0);
  const durationSeconds = root.clips.reduce(
    (duration, clip) =>
      Math.max(duration, (clip.startTime as number) + (clip.duration as number)),
    0,
  );
  return {
    projectId: rootId,
    projectRevision: revision,
    durationSeconds,
    leaves: leaves.sort(
      (a, b) => (a.timelineStart as number) - (b.timelineStart as number),
    ),
    compiledAt: new Date().toISOString(),
  };
}

// ── API mock ────────────────────────────────────────────────────────────────

type RecordedPatch = { id: string; clipIds: string[] };

type GraphApi = {
  documents: Map<string, FixtureDocument>;
  /** Live compare-and-set ledger — a test can bump it to stand in for another
   *  writer having saved since this session read the document. */
  revisions: Map<string, number>;
  /** One entry per document write, in arrival order (batch writes fan out). */
  patches: RecordedPatch[];
  patchesFor: (id: string) => RecordedPatch[];
  /** The document ids each POST /api/timelines/batch carried — the
   *  atomicity witness: docs written by one change must share a batch. */
  batches: string[][];
};

async function installGraphApi(
  page: Page,
  options: { blockChildDocument?: boolean } = {},
): Promise<GraphApi> {
  const documents = buildFixtureDocuments();
  const patches: RecordedPatch[] = [];
  const batches: string[][] = [];
  // Served on GET and enforced on batch writes, like the real API: the
  // gateway must round-trip these as expectedRevision.
  const revisions = new Map<string, number>([...documents.keys()].map((id) => [id, 1]));

  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      json: { user: { uid: USER_ID, email: "e2e@test.local", name: "E2E", picture: null } },
    }),
  );

  // The trash drawer's recently-deleted list. Empty by default; the test that
  // cares overrides it — and must register AFTER this one, because Playwright
  // matches handlers in reverse registration order.
  await page.route("**/api/assets/marked**", (route) =>
    route.fulfill({ json: { assets: [] } }),
  );

  // Two-segment path, so the generic single-segment mock below never sees it.
  await page.route("**/api/timelines/*/preview-manifest", (route) => {
    const id = decodeURIComponent(
      new URL(route.request().url()).pathname.split("/").at(-2) ?? "",
    );
    const manifest = compileFixtureManifest(documents, id, revisions.get(id) ?? 0);
    if (!manifest) {
      return route.fulfill({ status: 404, json: { error: "Timeline was not found." } });
    }
    return route.fulfill({ json: { manifest, missing: [] } });
  });

  await page.route("**/api/timelines/*", async (route) => {
    const request = route.request();
    const id = decodeURIComponent(new URL(request.url()).pathname.split("/").pop() ?? "");

    // The graph gateway's write path: ONE atomic batch per debounce window,
    // each write carrying the expectedRevision its GET served. Mirrors the
    // real endpoint: a conflict rejects the whole batch, success bumps and
    // returns every revision.
    if (id === "batch" && request.method() === "POST") {
      const body = request.postDataJSON() as {
        writes?: { document?: FixtureDocument; expectedRevision?: number }[];
      };
      const writes = (body.writes ?? []).filter(
        (write): write is { document: FixtureDocument; expectedRevision?: number } =>
          write.document !== undefined,
      );
      const conflicts = writes.flatMap((write) => {
        const actual = revisions.get(write.document.id) ?? 0;
        return write.expectedRevision !== undefined && write.expectedRevision !== actual
          ? [{ id: write.document.id, actualRevision: actual }]
          : [];
      });
      if (conflicts.length > 0) {
        await route.fulfill({ status: 409, json: { error: "Write conflict.", conflicts } });
        return;
      }
      const results: { id: string; revision: number }[] = [];
      for (const write of writes) {
        documents.set(write.document.id, write.document);
        const next = (revisions.get(write.document.id) ?? 0) + 1;
        revisions.set(write.document.id, next);
        patches.push({
          id: write.document.id,
          clipIds: write.document.clips.map((clip) => clip.id),
        });
        results.push({ id: write.document.id, revision: next });
      }
      batches.push(writes.map((write) => write.document.id));
      await route.fulfill({ json: { results } });
      return;
    }

    if (options.blockChildDocument && id === CHILD_ID && request.method() === "GET") {
      // Simulate the fetch-latency window the bounce policy exists for: the
      // child document never arrives, so its collection stays un-hydrated.
      await route.abort("failed");
      return;
    }

    if (request.method() === "GET") {
      const doc = documents.get(id);
      if (!doc) {
        await route.fulfill({ status: 404, json: { error: "Timeline was not found." } });
        return;
      }
      await route.fulfill({ json: { document: doc, revision: revisions.get(id) ?? 0 } });
      return;
    }

    await route.continue();
  });

  return {
    documents,
    revisions,
    patches,
    patchesFor: (id) => patches.filter((patch) => patch.id === id),
    batches,
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const strip = (page: Page, collectionId: string): Locator =>
  page.locator(`[data-virtual-strip="${collectionId}"]`);

async function stripOrder(page: Page, collectionId: string): Promise<string[]> {
  return strip(page, collectionId)
    .locator("[data-node-id]")
    .evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.nodeId ?? ""));
}

/** Grid-surface twin of `stripOrder` — the strip locator finds nothing once
 *  the surface toggle switches to grid. */
async function gridOrder(page: Page, collectionId: string): Promise<string[]> {
  return page
    .locator(`[data-virtual-grid="${collectionId}"]`)
    .locator("[data-node-id]")
    .evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.nodeId ?? ""));
}

async function openGraph(page: Page): Promise<void> {
  // GRID is the bare-URL load default; this suite's tests are written
  // against strips, so land directly in strip layout via the deep-link
  // param (the same one the sidebar's Strip icon uses off-graph).
  await page.goto(`${GRAPH_URL}?surface=strip`);
  await strip(page, PROJECT_ID)
    .locator('[data-node-id="alpha"]')
    .waitFor({ state: "visible", timeout: 30000 });
  // Children timelines are OFF by default now; this suite predates that
  // and reads the tree throughout, so reveal it through the real control
  // (the sidebar's children icon).
  await page.getByRole("button", { name: "Show children timelines" }).click();
}

/** A collection card's metadata row in the project strip, which carries
 *  `data-collection-hydrated` — whether its numbers come from live children
 *  or from the stored summary. Hydration decides whether a drop into the
 *  collection is legal, and nothing else on the card shows it. */
function placeholderCard(page: Page, collectionId: string) {
  return strip(page, PROJECT_ID)
    .locator(`[data-node-id="${collectionId}"]`)
    .locator("[data-collection-metadata]");
}

/** The ruler toggle only mounts in FLAT mode (a ruler is one continuous time
 *  axis, which only the flat run is), so every ruler test enters flat first. */
async function enableRuler(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Show all items in order" }).click();
  await page.getByRole("button", { name: /show time ruler/i }).click();
}

/** Sub-graph rows start COLLAPSED — expand one to reveal its (lazy-hydrated)
 *  strip and its own nested rows. `.first()` guards against nested rows once
 *  children exist under the same section name. */
async function expandSubGraph(page: Page, name: string): Promise<void> {
  await page
    .locator(`section[aria-label="Sub-timeline: ${name}"]`)
    .getByRole("button", { name: "Expand" })
    .first()
    .click();
}

/**
 * Wait for FLIP move animations to finish before measuring card geometry.
 *
 * Commits (drop, undo, redo) animate every displaced card for 180ms via
 * element.animate — and getBoundingClientRect INCLUDES the transform, so a
 * drag measured mid-FLIP reads boxes up to a full slot away from where the
 * cards land. That was a real ~1-in-2 flake: a drop aimed at a card's
 * dead-center released at a stale coordinate and resolved to a different
 * intent entirely. CSS animations/transitions are excluded — spinners and
 * pulses are infinite and would never settle.
 */
async function settleMoveAnimations(page: Page): Promise<void> {
  await page.waitForFunction(
    () =>
      !document
        .getAnimations()
        .some(
          (animation) =>
            !(animation instanceof CSSAnimation) &&
            !(animation instanceof CSSTransition) &&
            animation.playState === "running",
        ),
    undefined,
    { timeout: 3000 },
  );
}

/**
 * Opens an item's details the way a user does now (PL13-009): SELECT the card,
 * then press Edit in the rail's contextual item actions. The per-card trigger
 * is gone — details is an item action, and the selection is its input.
 */
async function openItemDetails(page: Page, nodeId: string): Promise<void> {
  const card = page.locator(`[data-node-id="${nodeId}"]`).first();
  // Retried, for the reason this suite already documents elsewhere: cards use
  // press-and-hold to drag, so under load a plain click can outlast the 250ms
  // threshold, become a grab, and have its click — correctly — suppressed.
  // Asserting the selection here also means a failure says WHICH half broke,
  // rather than timing out on a rail control that only exists once something
  // is selected.
  await expect(async () => {
    await card.click();
    await expect(card).toHaveAttribute("data-selected", "true", { timeout: 700 });
  }).toPass({ timeout: 10000 });
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await settleViewTransition(page);
}

/**
 * Waits out a CSS view transition. While one runs, the browser paints a
 * SNAPSHOT of the page over the real DOM — and a snapshot is an image, so
 * every real pointer event during it lands on `<html>` instead of on whatever
 * is visible. Interacting mid-transition therefore does nothing at all, which
 * reads as a dead control rather than as a timing problem.
 */
async function settleViewTransition(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      // The app flags the root while a transition is in flight. Polling
      // `getAnimations()` alone is a RACE: those animations do not exist until
      // the browser has captured a frame, so a poll landing between the click
      // and the capture sees none, reports "settled", and the drag that
      // follows lands on the snapshot — i.e. on <html> — doing nothing at all.
      // The flag is set synchronously, before the transition starts.
      if (document.documentElement.dataset.viewTransition) return false;
      return !document.getAnimations().some((animation) => {
        // `pseudoElement` lives on KeyframeEffect, not the AnimationEffect
        // base the DOM types expose here.
        const effect = animation.effect as KeyframeEffect | null;
        return effect?.pseudoElement?.startsWith("::view-transition") ?? false;
      });
    },
    undefined,
    { timeout: 5000 },
  );
}

/** Press-and-hold drag: hold past the 250ms activation delay, travel, dwell,
 *  release. Used for strip cards (hold-marked). */
async function holdDrag(
  page: Page,
  source: Locator,
  target: Locator,
  targetXRatio = 0.5,
): Promise<void> {
  await source.waitFor({ state: "visible" });
  await target.waitFor({ state: "visible" });
  await settleMoveAnimations(page);
  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();
  expect(sourceBox).not.toBeNull();
  expect(targetBox).not.toBeNull();

  await page.mouse.move(
    sourceBox!.x + sourceBox!.width / 2,
    sourceBox!.y + sourceBox!.height / 2,
  );
  await page.mouse.down();
  await page.waitForTimeout(400); // past the hold delay — the drag activates
  await page.mouse.move(
    targetBox!.x + targetBox!.width * targetXRatio,
    targetBox!.y + targetBox!.height / 2,
    { steps: 12 },
  );
  await page.waitForTimeout(150); // dwell: let collision/intent settle
  await page.mouse.up();
  // dnd-kit's pointer sensor keeps a document-capture click SUPPRESSOR armed
  // for 50ms after release (AbstractPointerSensor.detach defers
  // documentListeners.removeAll) so the drag's own trailing click cannot
  // select/open. Any button clicked inside that window is silently eaten —
  // its click propagates past window but is stopped before React's root
  // handler. Outlast the window before handing control back.
  await page.waitForTimeout(80);
}

const undoButton = (page: Page): Locator => page.getByRole("button", { name: /undo/i });
const redoButton = (page: Page): Locator => page.getByRole("button", { name: /redo/i });

// The layout switch lives in the SIDEBAR now (its top icons drive the graph
// surface through the event bridge); the breadcrumb row has no toggle.
const surfaceButton = (page: Page, surface: "strip" | "grid"): Locator =>
  page.getByRole("button", {
    name: surface === "grid" ? "Grid layout" : "Strip layout",
    exact: true,
  });

// The preview toggle is an ICON button whose accessible name flips with
// state ("Show preview" / "Hide preview") — a fixed exact label can't find
// it. It lives in the SIDEBAR now (first icon under the separator), so no
// main-region scoping.
const previewToggle = (page: Page): Locator =>
  page.getByRole("button", { name: /(show|hide) preview/i });

/**
 * One OS file drop onto a surface's native drop zone, at an exact clientX.
 *
 * A file drop is dispatched, not mouse-driven, so it settles deterministically
 * — no dnd-kit measure cadence to race, which is why the flat-drop tests below
 * need no retries where their palette-drag ancestors did.
 */
async function dropOneFile(page: Page, collectionId: string, clientX: number): Promise<void> {
  const transfer = await page.evaluateHandle(() => {
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array([137, 80, 78, 71])], "dropped.png", { type: "image/png" }));
    return dt;
  });
  const zone = page.locator(`[data-native-drop="${collectionId}"]`);
  // dragover FIRST, at the same x. The drop handler resolves its anchor from
  // geometry the drag SESSION measures, and a bare `drop` never opens one — the
  // anchor then falls back to a stale index and the drop lands somewhere the
  // pointer never was. (Dropping at clientX 0 hides this, which is why the
  // upload tests above get away with it.)
  await zone.dispatchEvent("dragover", { dataTransfer: transfer, clientX });
  await zone.dispatchEvent("drop", { dataTransfer: transfer, clientX });
}

// Drilling in. The sub-timeline ROW no longer offers this — its folder toggle
// opens the timeline in place, and the second control that navigated away was
// removed deliberately (see graph-sub-timelines). The collection CARD's own
// open button is the affordance now, so navigation tests go through it.
const drillButton = (page: Page, timelineName: string): Locator =>
  page.getByRole("button", { name: `Open ${timelineName}`, exact: true }).first();

// ── Tests ───────────────────────────────────────────────────────────────────

test.describe("graph view E2E", () => {
  test("sub-graph rows start collapsed and lazy-hydrate on expand", async ({ page }) => {
    await installGraphApi(page);
    await openGraph(page);

    // Focused strip: the project's clips in stored order; the collection
    // clip's node id IS its child timeline id (adapter identity rule).
    expect(await stripOrder(page, PROJECT_ID)).toEqual(["alpha", "bravo", CHILD_ID, "charlie"]);

    // The sub-graph row is present but COLLAPSED — its strip is not rendered
    // and its clips have not been fetched. The count badge comes from the
    // parent's stored summary without a fetch.
    const section = page.locator('section[aria-label="Sub-timeline: Scene A"]');
    await expect(section).toBeVisible();
    await expect(strip(page, CHILD_ID)).toHaveCount(0);

    // Expanding lazy-hydrates the row: its inline strip appears with its clips.
    await expandSubGraph(page, "Scene A");
    await expect
      .poll(() => stripOrder(page, CHILD_ID), { timeout: 15000 })
      .toEqual(["c1", "c2"]);

    // The strip's left edge lines up with the LABEL (past the folder icon),
    // not with the section's left edge.
    const labelBox = await section.getByRole("heading", { name: "Scene A" }).boundingBox();
    const stripBox = await strip(page, CHILD_ID).boundingBox();
    expect(labelBox).not.toBeNull();
    expect(stripBox).not.toBeNull();
    expect(Math.abs(stripBox!.x - labelBox!.x)).toBeLessThanOrEqual(2);
  });

  test("sub-graphs nest recursively: expanding a child reveals its own collapsed children", async ({
    page,
  }) => {
    const api = await installGraphApi(page);
    // Scene A gains a nested collection "Scene B" (grandchild of the project),
    // which itself holds one clip. The tree must reveal it collapsed under
    // Scene A, and only load its clips when IT is expanded in turn.
    api.documents
      .get(CHILD_ID)!
      .clips.push(collectionClip("clip-nested", GRANDCHILD_ID, 2, "Scene B", 1));
    api.documents.set(GRANDCHILD_ID, {
      id: GRANDCHILD_ID,
      title: "Scene B",
      clips: [mediaClip("g1", "image", 0, 4)],
    });

    await openGraph(page);

    // Top level collapsed: only Scene A's row exists; Scene B is not rendered
    // yet (it lives inside the un-expanded Scene A).
    await expect(page.locator('section[aria-label="Sub-timeline: Scene A"]')).toBeVisible();
    await expect(page.locator('section[aria-label="Sub-timeline: Scene B"]')).toHaveCount(0);

    // Expand Scene A → its strip loads AND a nested, COLLAPSED Scene B row
    // appears. Scene B's own strip is not rendered until it is expanded.
    await expandSubGraph(page, "Scene A");
    await expect
      .poll(() => stripOrder(page, CHILD_ID), { timeout: 15000 })
      .toEqual(["c1", "c2", GRANDCHILD_ID]);
    await expect(page.locator('section[aria-label="Sub-timeline: Scene B"]')).toBeVisible();
    await expect(strip(page, GRANDCHILD_ID)).toHaveCount(0);

    // Expand Scene B → the recursion's second level lazy-hydrates its clips.
    await expandSubGraph(page, "Scene B");
    await expect
      .poll(() => stripOrder(page, GRANDCHILD_ID), { timeout: 15000 })
      .toEqual(["g1"]);

    // PL9-006: every row leads with a tree elbow, at every depth — and it
    // takes width, so the thing to guard is that the preview frames still
    // land on ONE vertical line across depths (the column the nested panels'
    // negative right inset exists to keep straight).
    for (const label of ["Scene A", "Scene B"]) {
      await expect(
        page.locator(`section[aria-label="Sub-timeline: ${label}"] [data-subtimeline-elbow]`).first(),
      ).toBeVisible();
    }
    const thumbRights = await page
      .locator("[data-subtimeline-thumbs]")
      .evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().right)));
    expect(thumbRights.length).toBeGreaterThan(1);
    expect(new Set(thumbRights).size).toBe(1);
  });

  test("a collection id containing a comma is one row, not two broken ones", async ({ page }) => {
    // The core allows ANY non-whitespace string as a NodeId. The sub-graph
    // tree used to subscribe to `ids.join(",")` and rebuild the list with
    // `split(",")`, so an id like this was torn into two ids addressing
    // nothing — the row would vanish and its strip would never hydrate.
    const COMMA_ID = "timeline-e2e,comma";
    const api = await installGraphApi(page);
    api.documents
      .get(PROJECT_ID)!
      .clips.push(collectionClip("clip-comma", COMMA_ID, 3, "Scene Comma", 1));
    api.documents.set(COMMA_ID, {
      id: COMMA_ID,
      title: "Scene Comma",
      clips: [mediaClip("k1", "image", 0, 4)],
    });

    await openGraph(page);

    // Exactly one row for it, and it is addressable by its real id.
    await expect(page.locator('section[aria-label="Sub-timeline: Scene Comma"]')).toHaveCount(1);
    // The torn ids ("timeline-e2e" / "comma") must not have produced rows.
    await expect(page.locator('section[aria-label^="Sub-timeline: "]')).toHaveCount(2);

    // And it behaves like any other row: expanding lazy-hydrates its clips.
    await expandSubGraph(page, "Scene Comma");
    await expect
      .poll(() => stripOrder(page, COMMA_ID), { timeout: 15000 })
      .toEqual(["k1"]);
  });

  test("drilling into a collection id containing a slash hydrates it", async ({ page }) => {
    // HydrationController used to round-trip the focus path through
    // `segments.join("/")` / `.split("/")`. A NodeId may contain any
    // non-whitespace character, so "scene/a" was torn into "scene" + "a" —
    // neither of which is in the graph — and the drill-in reported an unknown
    // timeline while priming the wrong documents. Navigation itself was
    // always fine: it encodes each segment, so the id rides the URL as
    // "scene%2Fa" and is one path segment.
    const SLASH_ID = "scene/a";
    const api = await installGraphApi(page);
    api.documents
      .get(PROJECT_ID)!
      .clips.push(collectionClip("clip-slash", SLASH_ID, 3, "Scene Slash", 1));
    api.documents.set(SLASH_ID, {
      id: SLASH_ID,
      title: "Scene Slash",
      clips: [mediaClip("s1", "image", 0, 4)],
    });

    await openGraph(page);
    await drillButton(page, "Scene Slash").click();

    // One encoded segment in the URL, not two.
    await page.waitForURL(`**${GRAPH_URL}/${encodeURIComponent(SLASH_ID)}`);

    // The focused timeline actually hydrated — the old code surfaced an
    // "Unknown timeline" panel here instead.
    await expect(page.getByText("Unknown timeline")).toHaveCount(0);
    await expect.poll(() => stripOrder(page, SLASH_ID), { timeout: 15000 }).toEqual(["s1"]);
  });

  test("renaming a sub-graph in place persists to the child document title", async ({ page }) => {
    const api = await installGraphApi(page);
    await openGraph(page);

    // Double-click the (collapsed) row's name → inline edit; commit with Enter.
    const section = page.locator('section[aria-label="Sub-timeline: Scene A"]');
    await section.getByRole("heading", { name: "Scene A" }).dblclick();
    const input = page.getByRole("textbox", { name: "Timeline name" });
    await input.fill("Opening Scene");
    await input.press("Enter");

    // The label updates immediately (display name reads the gateway title).
    await expect(page.locator('section[aria-label="Sub-timeline: Opening Scene"]')).toBeVisible();

    // The CHILD document — the source of truth the server derives parents from
    // — is persisted with the new title.
    await expect
      .poll(() => api.documents.get(CHILD_ID)?.title, { timeout: 5000 })
      .toBe("Opening Scene");

    // The GRAPH node was renamed too, which is what the card's accessible
    // name, the drag ghost, and every DnD announcement read. Renaming used to
    // update only the document, so the visible title changed while screen
    // readers kept hearing "Scene A" indefinitely.
    const card = strip(page, PROJECT_ID).locator(`[data-node-id="${CHILD_ID}"]`);
    await expect(card).toHaveAttribute("aria-label", /^Opening Scene \(collection/);

    // Undo restores BOTH representations rather than splitting them again.
    await undoButton(page).click();
    await expect(card).toHaveAttribute("aria-label", /^Scene A \(collection/);
    await expect
      .poll(() => api.documents.get(CHILD_ID)?.title, { timeout: 5000 })
      .toBe("Scene A");
  });

  test("renaming a collection CARD in place persists and renames its graph node", async ({
    page,
  }) => {
    const api = await installGraphApi(page);
    await openGraph(page);
    const card = strip(page, PROJECT_ID).locator(`[data-node-id="${CHILD_ID}"]`);
    await expect(card).toHaveAttribute("aria-label", /^Scene A \(collection/);

    // Double-click the card's name label → inline editor; commit with Enter.
    await card.getByText("Scene A", { exact: true }).dblclick();
    const editor = page.getByRole("textbox", { name: "Timeline name" });
    await editor.fill("Heist Plan");
    await editor.press("Enter");

    // node.name (the accessible name, ghost, and announcements) updates at once.
    await expect(card).toHaveAttribute("aria-label", /^Heist Plan \(collection/);
    // And the child document — the source of truth — is persisted.
    await expect
      .poll(() => api.documents.get(CHILD_ID)?.title, { timeout: 5000 })
      .toBe("Heist Plan");
  });

  test("keyboard rename: a rename request opens the card's inline editor (no pointer)", async ({
    page,
  }) => {
    const api = await installGraphApi(page);
    await openGraph(page);
    const card = strip(page, PROJECT_ID).locator(`[data-node-id="${CHILD_ID}"]`);
    await expect(card).toHaveAttribute("aria-label", /^Scene A \(collection/);

    // F2 on a focused collection card is the pointerless twin of double-clicking
    // the label: OpenKeyBoundary turns it into this rename request, which the
    // card's inline editor opens off. We drive the request directly here — the
    // F2 keydown itself rides the same OpenKeyBoundary the O-key test covers,
    // and is verified with a real keypress (Playwright's Chromium doesn't
    // deliver the F2 function key to the page).
    await page.evaluate(
      (id) =>
        window.dispatchEvent(
          new CustomEvent("graph-view:rename-item", { detail: { nodeId: id, site: "card" } }),
        ),
      CHILD_ID,
    );

    // EXACTLY one editor. Scene A has a card AND a sub-timeline row mounted for
    // the same node id, and an unaddressed broadcast opened both: each editor
    // focuses itself on mount and commits on blur, so they closed each other
    // and F2 did nothing at all. The count is the regression — `fill` below
    // would fail on a strict-mode violation, but only by accident.
    const editor = page.getByRole("textbox", { name: "Timeline name" });
    await expect(editor).toHaveCount(1);
    await editor.fill("Heist Plan");
    await editor.press("Enter");

    await expect(card).toHaveAttribute("aria-label", /^Heist Plan \(collection/);
    await expect
      .poll(() => api.documents.get(CHILD_ID)?.title, { timeout: 5000 })
      .toBe("Heist Plan");
  });

  test("composed collection card: interactive controls are siblings of the surface, never nested", async ({
    page,
  }) => {
    await installGraphApi(page);
    await openGraph(page);
    const surface = strip(page, PROJECT_ID).locator(`[data-node-id="${CHILD_ID}"]`);
    const wrapper = strip(page, PROJECT_ID).locator(`[data-node-wrapper="${CHILD_ID}"]`);
    await surface.waitFor({ state: "visible" });

    // The selection surface is a real <button> with NO interactive content
    // inside it — nested interactive semantics are invalid HTML and read as
    // an ambiguous a11y tree (review finding 1). The folder control and the
    // rename editor compose as SIBLINGS via the package's item-shell seam.
    await expect(surface).toHaveJSProperty("tagName", "BUTTON");
    await expect(
      surface.locator("button, [role='button'], input, textarea, select, a[href], [tabindex]"),
    ).toHaveCount(0);

    // The drill affordance is a REAL button (not a role="button" span).
    const folder = wrapper.getByRole("button", { name: /^Open / });
    await expect(folder).toHaveJSProperty("tagName", "BUTTON");

    // The rename editor is a REAL input, and it never lands inside the surface.
    await surface.getByText("Scene A", { exact: true }).dblclick();
    const editor = wrapper.getByRole("textbox", { name: "Timeline name" });
    await expect(editor).toHaveJSProperty("tagName", "INPUT");
    await expect(surface.locator("input")).toHaveCount(0);
    await editor.press("Escape");
    await expect(editor).toHaveCount(0);
  });

  test("a collection card hold-drags to reorder, like any clip", async ({ page }) => {
    // The composed collection item routes its pointer drag through the
    // selection surface (SelectionSurface dragActivation="hold") instead of
    // NodeCard's body — this pins that the hold sensor wiring survived the
    // recomposition end to end, persistence included. Press the LABEL strip
    // at the bottom of the card, not the centre: the centre is the folder
    // button, which is click-only territory (its press has never been able
    // to start a card drag) — the body around it is what drags.
    const api = await installGraphApi(page);
    await openGraph(page);
    const projectStrip = strip(page, PROJECT_ID);
    const card = projectStrip.locator(`[data-node-id="${CHILD_ID}"]`);
    const target = projectStrip.locator('[data-node-id="charlie"]');
    await card.waitFor({ state: "visible" });
    await settleMoveAnimations(page);
    const cardBox = (await card.boundingBox())!;
    const targetBox = (await target.boundingBox())!;

    await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height - 8);
    await page.mouse.down();
    await page.waitForTimeout(400); // past the hold-activation delay
    // Drop on charlie's right half: the collection lands after it.
    await page.mouse.move(
      targetBox.x + targetBox.width * 0.85,
      targetBox.y + targetBox.height / 2,
      { steps: 12 },
    );
    await page.waitForTimeout(150); // dwell: let collision/intent settle
    await page.mouse.up();
    await page.waitForTimeout(80); // outlast dnd-kit's click suppressor

    await expect
      .poll(() => stripOrder(page, PROJECT_ID))
      .toEqual(["alpha", "bravo", "charlie", CHILD_ID]);
    await expect
      .poll(() => api.patchesFor(PROJECT_ID).length, { timeout: 5000 })
      .toBeGreaterThan(0);
    const patch = api.patchesFor(PROJECT_ID).at(-1);
    expect(patch?.clipIds).toEqual(["alpha", "bravo", "charlie", "clip-scene"]);
  });

  test("only the current BREADCRUMB edits in place; every ancestor links to its view", async ({
    page,
  }) => {
    const api = await installGraphApi(page);
    await openGraph(page);
    // Drill into the child collection so it is the focused (current) crumb.
    // The folder button is a SIBLING of the card's selection surface (a real
    // <button> can't nest in a button), so scope at the item wrapper.
    await strip(page, PROJECT_ID)
      .locator(`[data-node-wrapper="${CHILD_ID}"]`)
      .getByRole("button", { name: "Open Scene A" })
      .click();
    const trail = page.getByRole("navigation", { name: "Timeline focus path" });
    await expect(trail).toContainText("Scene A");

    // One click edits the current crumb; Enter commits.
    await trail.getByRole("button", { name: "Rename Scene A" }).click();
    const editor = page.getByRole("textbox", { name: "Rename Scene A" });
    await editor.fill("Getaway");
    await editor.press("Enter");

    await expect(trail).toContainText("Getaway");
    await expect
      .poll(() => api.documents.get(CHILD_ID)?.title, { timeout: 5000 })
      .toBe("Getaway");

    // Ancestors are navigation links, not rename controls.
    const rootCrumb = trail.getByRole("link", { name: "E2E Project" });
    await expect(rootCrumb).toHaveAttribute("href", `/timeline/${PROJECT_ID}/graph`);
    await expect(trail.getByRole("button", { name: "Rename E2E Project" })).toHaveCount(0);
    await rootCrumb.click();
    await expect(page).toHaveURL(new RegExp(`/timeline/${PROJECT_ID}/graph$`));
    await expect(
      page
        .getByRole("navigation", { name: "Timeline focus path" })
        .getByRole("button", { name: "Rename E2E Project" }),
    ).toBeVisible();
  });

  test("the details modal can disable and re-enable its item", async ({ page }) => {
    // PL14-001. An ACTION whose label flips, matching the rail's item-actions
    // toggle — not a switch, because two controls for one concept should look
    // like one concept.
    await installGraphApi(page);
    await openGraph(page);
    await openItemDetails(page, "alpha");
    await settleViewTransition(page);

    const toggle = page.locator("[data-item-details-disable]");
    await expect(toggle).toHaveText("Disable");
    await expect(toggle).toHaveAttribute("aria-pressed", "false");

    await toggle.click();
    await expect(toggle).toHaveText("Enable");
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    // The card behind the modal agrees — this is one graph, not a modal-local
    // flag. `data-disabled` rides the CONTENT span inside the dnd button, not
    // the button itself (same locator the disabled-clip test uses).
    const alphaCard = page.locator('[data-node-id="alpha"]');
    await expect(alphaCard.locator('[data-disabled="true"]')).toBeVisible();

    // The modal's SCOPED undo covers it: `useScopedHistory` already accepted
    // `set-node-disabled` naming a single node, so this needed no new wiring —
    // which is the reason the command is dispatched that way.
    await page.locator("[data-item-details-undo]").click();
    await expect(toggle).toHaveText("Disable");
    await expect(alphaCard.locator('[data-disabled="true"]')).toHaveCount(0);
  });

  test("board options live in the icon rail, below the trash", async ({ page }) => {
    // PL14-005. The menu is rendered by the BOARD and portalled into a slot the
    // rail publishes, so it keeps its real props while its trigger sits with
    // the rail's other tiles. A null slot would fail silently — no menu, no
    // error — which is what these assertions exist to catch.
    await installGraphApi(page);
    await openGraph(page);

    const trigger = page.getByRole("button", { name: "Board options" });
    await expect(trigger).toHaveCount(1);

    // In the rail's slot, and no longer in the board header.
    expect(
      await trigger.evaluate((el) => !!el.closest("#graph-board-menu-slot")),
    ).toBe(true);
    await expect(
      page.locator("header").getByRole("button", { name: "Board options" }),
    ).toHaveCount(0);

    // Below the trash tile and above the account one — the position asked for.
    const top = async (name: string) =>
      (await page.getByRole("button", { name }).boundingBox())!.y;
    expect(await top("Board options")).toBeGreaterThan(await top("Trash"));
    expect(await top("Board options")).toBeLessThan(await top("Account"));

    // And it still opens, with its contents intact. `side="right"` matters
    // here: an end-aligned menu on a 72px rail would open off-screen.
    await trigger.click();
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    await expect(menu).toContainText("Thumbnail size");
    const box = (await menu.boundingBox())!;
    expect(box.x).toBeGreaterThan(0);
    expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  });

  test("focused strip and grid surfaces have no outer shell padding", async ({ page }) => {
    await installGraphApi(page);
    await openGraph(page);

    // The gear now lives in the icon rail (PL14-005); it is still the settings
    // glyph and still the only one.
    await expect(page.getByRole("button", { name: "Board options" }).locator("svg"))
      .toHaveClass(/lucide-settings/);
    await expect(page.getByRole("button", { name: "Settings" })).toHaveCount(0);

    const boxStyles = (selector: string) =>
      page.locator(selector).evaluate((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return {
          padding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft],
          border: [
            style.borderTopWidth,
            style.borderRightWidth,
            style.borderBottomWidth,
            style.borderLeftWidth,
          ],
          left: rect.left,
          right: rect.right,
        };
      });

    const headerBox = await boxStyles("[data-graph-board-header]");
    await expect(page.locator("[data-board-header-edge-occluder]")).toHaveCount(2);
    const stripBox = await boxStyles(`[data-virtual-strip="${PROJECT_ID}"]`);
    expect(stripBox.padding).toEqual(["0px", "0px", "0px", "0px"]);
    expect(stripBox.border).toEqual(["0px", "0px", "0px", "0px"]);
    expect(stripBox.left).toBeCloseTo(headerBox.left, 1);
    expect(stripBox.right).toBeCloseTo(headerBox.right, 1);

    await surfaceButton(page, "grid").click();
    await expect(page.locator('[data-focused-surface-shell="grid"]')).toBeVisible();
    const gridBox = await boxStyles(`[data-virtual-grid="${PROJECT_ID}"]`);
    expect(gridBox.padding).toEqual(["0px", "0px", "0px", "0px"]);
    expect(gridBox.border).toEqual(["0px", "0px", "0px", "0px"]);
    expect(gridBox.left).toBeCloseTo(headerBox.left, 1);
    expect(gridBox.right).toBeCloseTo(headerBox.right, 1);
  });

  test("selected borders stay inside left and right grid edges", async ({ page }) => {
    await installGraphApi(page);
    await openGraph(page);
    await surfaceButton(page, "grid").click();

    const grid = page.locator(`[data-virtual-grid="${PROJECT_ID}"]`);
    const leftCard = grid.locator('[data-node-id="alpha"]');
    const rightCard = grid.locator('[data-node-id="charlie"]');
    const collectionCard = grid.locator(`[data-node-id="${CHILD_ID}"]`);

    await leftCard.click();
    await expect(leftCard.locator(".ring-inset")).toHaveCount(1);

    await rightCard.click();
    await expect(rightCard.locator(".ring-inset")).toHaveCount(1);

    await collectionCard.click({ position: { x: 10, y: 10 } });
    await expect(collectionCard).toHaveClass(/ring-inset/);
  });

  test("surface toggle is page-wide: sub-graph rows follow grid/strip mode", async ({ page }) => {
    await installGraphApi(page);
    await openGraph(page);
    await expandSubGraph(page, "Scene A");
    await expect
      .poll(() => stripOrder(page, CHILD_ID), { timeout: 15000 })
      .toEqual(["c1", "c2"]);

    const childStrip = page.locator(`[data-virtual-strip="${CHILD_ID}"]`);
    const childGrid = page.locator(`[data-virtual-grid="${CHILD_ID}"]`);

    // openGraph lands in strip mode: the child row is a strip.
    await expect(childStrip).toBeVisible();
    await expect(childGrid).toHaveCount(0);

    // Sidebar Grid icon → the child follows the page-wide surface, not just
    // the focus.
    await surfaceButton(page, "grid").click();
    await expect(childGrid).toBeVisible();
    await expect(childStrip).toHaveCount(0);

    // Back to strip → the child follows again.
    await surfaceButton(page, "strip").click();
    await expect(childStrip).toBeVisible();
    await expect(childGrid).toHaveCount(0);
  });

  test("grid is the bare-URL default; the sidebar owns layout and the strip-only ruler toggle", async ({
    page,
  }) => {
    await installGraphApi(page);
    // No ?surface param: the graph must land in GRID layout, with the
    // sidebar's Grid icon pressed and no ruler toggle (grid has no time
    // axis; the breadcrumb row hosts neither control anymore).
    await page.goto(GRAPH_URL);
    await expect(page.locator(`[data-virtual-grid="${PROJECT_ID}"]`)).toBeVisible();
    await expect(surfaceButton(page, "grid")).toHaveAttribute("aria-pressed", "true");
    await expect(surfaceButton(page, "strip")).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByRole("button", { name: /show time ruler/i })).toHaveCount(0);

    // Children timelines are opt-in: OFF by default, mounted by the
    // sidebar's children icon.
    await expect(
      page.getByRole("button", { name: "Show children timelines" }),
    ).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator('section[aria-label^="Sub-timeline"]')).toHaveCount(0);

    // Strip icon → strip layout. The ruler toggle is scoped to FLAT mode, so
    // a plain strip still shows no ruler control.
    await surfaceButton(page, "strip").click();
    await expect(strip(page, PROJECT_ID)).toBeVisible();
    await expect(surfaceButton(page, "strip")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: /show time ruler/i })).toHaveCount(0);

    // Flat mode is what mints a single continuous time axis, and only then
    // does the ruler toggle appear — below the flat icon in the rail.
    const flatToggle = page.getByRole("button", { name: "Show all items in order" });
    await flatToggle.click();
    const rulerToggle = page.getByRole("button", { name: /show time ruler/i });
    await expect(rulerToggle).toBeVisible();

    // It toggles the real ruler and reads back pressed.
    await rulerToggle.click();
    await expect(page.getByRole("button", { name: /hide time ruler/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.locator("[data-graph-ruler]").first()).toBeVisible();

    // Leaving flat mode takes the ruler with it: the control unmounts and the
    // ruler it armed stops painting, so no strip is left ruled with no way
    // back.
    await page.getByRole("button", { name: "Show collections" }).click();
    await expect(page.getByRole("button", { name: /time ruler/i })).toHaveCount(0);
    await expect(page.locator("[data-graph-ruler]")).toHaveCount(0);
  });

  test("preview height is the user's: tree growth never steals it, and a toggle restores it", async ({
    page,
  }) => {
    await installGraphApi(page);
    await openGraph(page);
    // A short viewport so the board content reliably overflows and the page can
    // scroll PAST the preview (the sticky-pin assertion below needs that). The
    // preview's own height is a fixed model value, independent of viewport, so
    // the height-persistence checks are unaffected. (The old always-present
    // bottom trash panel used to guarantee this height — gone in R5 #5 — and
    // the dev-only SyncPanel stopped shortening the page further in R7 #1,
    // hence 480, not 560: the page must out-scroll the preview by 40px.)
    await page.setViewportSize({ width: 1280, height: 480 });
    await previewToggle(page).click();

    const divider = page.getByRole("separator", { name: "Resize workbench display" });
    await expect(divider).toBeVisible();
    const heightOf = async () => Number(await divider.getAttribute("aria-valuenow"));
    await expect.poll(heightOf).toBeGreaterThan(0);
    const initial = await heightOf();

    // The 16px box is the DRAG TARGET and never changes; the visible band is
    // smaller and centred inside it (8px at desktop, 12 where it has to hold
    // the grip), so the space above it reads as clearance under the preview.
    expect(
      await divider.evaluate((el) => Math.round(el.getBoundingClientRect().height)),
    ).toBe(16);
    expect(
      await divider
        .locator("[data-divider-line]")
        .evaluate((el) => Math.round(el.getBoundingClientRect().height)),
    ).toBe(8);
    // The grip is for coarse pointers only: present in the DOM, not painted
    // at desktop width.
    await expect(divider.locator("[data-divider-grip]")).toBeHidden();
    const splitPane = page.getByTestId("workbench-split-pane");
    const displaySurface = page.getByTestId("workbench-display-surface");
    expect(
      await splitPane.evaluate((element) => getComputedStyle(element).overflowX),
    ).toBe("visible");
    await expect(page.locator("[data-preview-edge-occluder]")).toHaveCount(2);
    expect(
      await displaySurface.evaluate(
        (element) => getComputedStyle(element).borderBottomWidth,
      ),
    ).toBe("0px");
    const dividerLine = divider.locator("[data-divider-line]");
    await expect(dividerLine).toHaveCount(1);
    expect(
      await dividerLine.evaluate((element) => getComputedStyle(element).backgroundImage),
    ).toContain("linear-gradient");
    // The band is painted by a gradient built from `currentColor`, so COLOR
    // is what hover changes. (This read used to be `backgroundColor`, which
    // is transparent on a gradient-backed element in both states — the
    // assertion could not fail and, once the gradient landed, could not pass
    // either.)
    const dividerLineColor = () =>
      dividerLine.evaluate((el) => getComputedStyle(el).color);
    const restLineColor = await dividerLineColor();
    await divider.hover({ position: { x: 20, y: 10 } });
    await expect.poll(dividerLineColor).not.toBe(restLineColor);
    await page.mouse.move(0, 0); // unhover before the resize steps below

    // Expanding a sub-graph grows the content BELOW the preview. The preview
    // used to be fitted to whatever the lower pane left over, so it shrank —
    // its height must now be untouched by content changes.
    await expandSubGraph(page, "Scene A");
    await expect.poll(() => stripOrder(page, CHILD_ID), { timeout: 15000 }).toEqual(["c1", "c2"]);
    await page.waitForTimeout(300); // let any resize observers settle
    expect(await heightOf()).toBe(initial);

    // The document remains the one vertical scroll owner. Once it scrolls
    // past the preview's natural position, the preview + resize handle stay
    // pinned to the viewport instead of disappearing with the graph below.
    const previewRegion = page.getByTestId("workbench-preview-region");
    const main = page.getByRole("main");
    // The expand click above may have auto-scrolled its button into view
    // (the shorter viewport makes that likely) — measure the preview's
    // NATURAL top from an unscrolled page.
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    const naturalTop = await previewRegion.evaluate(
      (element) => element.getBoundingClientRect().top,
    );
    expect(naturalTop).toBeGreaterThan(0);
    await page.evaluate((top) => window.scrollTo({ top, behavior: "instant" }), naturalTop + 40);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    await expect
      .poll(() => previewRegion.evaluate((element) => element.getBoundingClientRect().top))
      .toBeCloseTo(0, 0);
    expect(await main.evaluate((element) => getComputedStyle(element).overflowY)).toBe("visible");
    expect(await main.evaluate((element) => element.scrollTop)).toBe(0);

    // Closing and reopening the preview restores the same height. From the
    // top of the page again: reopening while scroll-pinned lets the pane
    // clamp against the pinned layout, which is a different question than
    // height persistence.
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    // KEYBOARD activation for the off/on cycle: a mouse click here made the
    // runner scroll the page mid-toggle (the fresh pane then mounted pinned
    // and clamped the restored height — a different question than height
    // persistence, which is this test's subject).
    await previewToggle(page).focus();
    await page.keyboard.press("Enter");
    await expect(divider).toHaveCount(0);
    await previewToggle(page).focus();
    await page.keyboard.press("Enter");
    await expect(divider).toBeVisible();
    await expect.poll(heightOf).toBe(initial);
  });

  test("opening preview preserves a long strip's horizontal scroll position", async ({
    page,
  }) => {
    await installGraphApi(page);
    await page.setViewportSize({ width: 640, height: 800 });
    await openGraph(page);

    const projectStrip = strip(page, PROJECT_ID);
    const before = await projectStrip.evaluate((element) => {
      const maxScroll = element.scrollWidth - element.clientWidth;
      if (maxScroll <= 0) throw new Error("Fixture strip does not overflow horizontally.");
      element.scrollLeft = Math.round(maxScroll * 0.7);
      element.dataset.scrollIdentityWitness = "same-node";
      return element.scrollLeft;
    });
    expect(before).toBeGreaterThan(0);

    await previewToggle(page).click();
    await expect(page.getByTestId("workbench-display-surface")).toBeVisible();

    await expect(projectStrip).toHaveAttribute("data-scroll-identity-witness", "same-node");
    await expect
      .poll(() => projectStrip.evaluate((element) => element.scrollLeft))
      .toBe(before);
  });

  test("hold-drag reorder persists a patch-scoped write to only the touched document", async ({
    page,
  }) => {
    const api = await installGraphApi(page);
    await openGraph(page);
    const projectStrip = strip(page, PROJECT_ID);

    // Drop on charlie's right half: alpha lands after it.
    await holdDrag(
      page,
      projectStrip.locator('[data-node-id="alpha"]'),
      projectStrip.locator('[data-node-id="charlie"]'),
      0.85,
    );
    await expect
      .poll(() => stripOrder(page, PROJECT_ID))
      .toEqual(["bravo", CHILD_ID, "charlie", "alpha"]);

    // The gateway debounces ~900ms, then writes the project document with
    // the reordered clips — the collection clip under its ORIGINAL clip id
    // (sourceClipId round-trip) — and touches nothing else.
    await expect
      .poll(() => api.patchesFor(PROJECT_ID).length, { timeout: 5000 })
      .toBeGreaterThan(0);
    const patch = api.patchesFor(PROJECT_ID).at(-1);
    expect(patch?.clipIds).toEqual(["bravo", "clip-scene", "charlie", "alpha"]);
    expect(api.patchesFor(CHILD_ID)).toHaveLength(0);
    expect(api.patchesFor(TRASH_ID)).toHaveLength(0);
  });

  test("the drag ghost is a fixed compact 16:9 thumbnail, not the card's duration-relative width", async ({
    page,
  }) => {
    await installGraphApi(page);
    await openGraph(page);
    const projectStrip = strip(page, PROJECT_ID);

    // alpha is the longest clip (6s), so its strip card is the widest — the
    // exact case that used to spawn a giant ghost burying the drop targets.
    const alpha = projectStrip.locator('[data-node-id="alpha"]');
    await alpha.waitFor({ state: "visible" });
    await settleMoveAnimations(page);
    const alphaBox = (await alpha.boundingBox())!;

    // Hold the drag OPEN (no release) so the live ghost can be measured. Grab
    // the card's centre, activate past the hold delay, then travel right.
    await page.mouse.move(
      alphaBox.x + alphaBox.width / 2,
      alphaBox.y + alphaBox.height / 2,
    );
    await page.mouse.down();
    await page.waitForTimeout(400); // past the hold-activation delay
    const cursorX = alphaBox.x + alphaBox.width / 2 + 60;
    const cursorY = alphaBox.y + alphaBox.height / 2;
    await page.mouse.move(cursorX, cursorY, { steps: 8 });
    await page.waitForTimeout(200); // let the overlay mount + its scale-in settle

    const ghost = page.locator("[data-drag-ghost-width]");
    await expect(ghost).toBeVisible();
    const ghostBox = (await ghost.boundingBox())!;

    // Fixed 72×40 (16:9) regardless of the card: a compact landscape thumbnail
    // of the item, materially narrower than the wide source card — proof the
    // ghost is not sized to the clip's duration. The ratio also excludes the
    // old square (1:1) shape.
    expect(ghostBox.width).toBeGreaterThan(64);
    expect(ghostBox.width).toBeLessThan(80);
    const ghostRatio = ghostBox.width / ghostBox.height;
    expect(ghostRatio).toBeGreaterThan(1.6);
    expect(ghostRatio).toBeLessThan(2.0);
    expect(alphaBox.width).toBeGreaterThan(ghostBox.width + 40);

    // And it rides under the cursor: its centre tracks the pointer on BOTH
    // axes (a fixed-height ghost re-centres vertically on the grab too).
    const ghostCentreX = ghostBox.x + ghostBox.width / 2;
    const ghostCentreY = ghostBox.y + ghostBox.height / 2;
    expect(Math.abs(ghostCentreX - cursorX)).toBeLessThan(24);
    expect(Math.abs(ghostCentreY - cursorY)).toBeLessThan(24);

    await page.mouse.up();
    await page.waitForTimeout(80);
  });

  test("grid mode: hold-drag reorders a cell, parity with the strip", async ({
    page,
  }) => {
    const api = await installGraphApi(page);
    await openGraph(page);
    // Switch the surface to grid; the cards become grid cells (same NodeCard,
    // now with "hold" drag activation so a press-and-hold reorders).
    await surfaceButton(page, "grid").click();
    const projectGrid = page.locator(`[data-virtual-grid="${PROJECT_ID}"]`);
    await expect(projectGrid).toBeVisible();

    // Hold-drag alpha onto charlie's right half — alpha lands after charlie,
    // exactly as the strip reorder does.
    await holdDrag(
      page,
      projectGrid.locator('[data-node-id="alpha"]'),
      projectGrid.locator('[data-node-id="charlie"]'),
      0.85,
    );
    await expect
      .poll(() => gridOrder(page, PROJECT_ID))
      .toEqual(["bravo", CHILD_ID, "charlie", "alpha"]);

    // Same patch-scoped write as the strip: only the project document changes.
    await expect
      .poll(() => api.patchesFor(PROJECT_ID).length, { timeout: 5000 })
      .toBeGreaterThan(0);
    expect(api.patchesFor(CHILD_ID)).toHaveLength(0);
  });

  test("undo history survives drill-in navigation (the layout-persistence invariant)", async ({
    page,
  }) => {
    const api = await installGraphApi(page);
    await openGraph(page);
    const projectStrip = strip(page, PROJECT_ID);

    await holdDrag(
      page,
      projectStrip.locator('[data-node-id="alpha"]'),
      projectStrip.locator('[data-node-id="charlie"]'),
      0.85,
    );
    await expect
      .poll(() => stripOrder(page, PROJECT_ID))
      .toEqual(["bravo", CHILD_ID, "charlie", "alpha"]);

    // Drill into Scene A: a real App Router navigation — the page remounts,
    // the LAYOUT (provider, graph, history) persists.
    await drillButton(page, "Scene A").click();
    await page.waitForURL(`**${GRAPH_URL}/${CHILD_ID}`);
    await expect.poll(() => stripOrder(page, CHILD_ID)).toEqual(["c1", "c2"]);

    // The reorder made in the PROJECT focus is still undoable here.
    await expect(undoButton(page)).toBeEnabled();
    await undoButton(page).click();

    await page.goBack();
    // `*` tail: openGraph lands with ?surface=strip, and BACK returns to it.
    await page.waitForURL(`**${GRAPH_URL}*`);
    await expect
      .poll(() => stripOrder(page, PROJECT_ID))
      .toEqual(["alpha", "bravo", CHILD_ID, "charlie"]);

    // The undo also persisted: the last project PATCH restores stored order.
    await expect
      .poll(() => api.patchesFor(PROJECT_ID).at(-1)?.clipIds, { timeout: 5000 })
      .toEqual(["alpha", "bravo", "clip-scene", "charlie"]);
  });

  test("trash drop moves across roots, persists BOTH documents, and undoes", async ({
    page,
  }) => {
    const api = await installGraphApi(page);
    await openGraph(page);
    // Trash is a wide drop zone centred in the breadcrumb row now: invisible
    // (opacity 0) until a card drag starts, then it fades in. It stays laid
    // out while hidden, so holdDrag can target it, and the drag makes it
    // interactive before the drop.
    const trash = page.locator(`[data-graph-sidebar-trash="${TRASH_ID}"]`);
    await holdDrag(page, strip(page, PROJECT_ID).locator('[data-node-id="bravo"]'), trash);

    await expect
      .poll(() => stripOrder(page, PROJECT_ID))
      .toEqual(["alpha", CHILD_ID, "charlie"]);

    // The arrival lands twice over: the trash DRAWER button (sidebar chrome)
    // plays its one-shot pop — the class rides the drag→count-growth
    // announcement, so it proves the whole seam fired.
    await expect(
      page.getByRole("button", { name: "Trash", exact: true }).locator(".animate-trash-arrival"),
    ).toBeAttached();

    // A cross-root move is patch-scoped like any other: source AND target
    // documents both write.
    await expect
      .poll(() => api.patchesFor(TRASH_ID).at(-1)?.clipIds, { timeout: 5000 })
      .toEqual(["bravo"]);
    await expect
      .poll(() => api.patchesFor(PROJECT_ID).at(-1)?.clipIds, { timeout: 5000 })
      .toEqual(["alpha", "clip-scene", "charlie"]);
    // ATOMICITY: both halves of the move traveled in the SAME batch request —
    // a crash between two independent PATCHes could persist half a move.
    expect(
      api.batches.some(
        (batch) => batch.includes(TRASH_ID) && batch.includes(PROJECT_ID),
      ),
    ).toBe(true);

    // Trash drops are ordinary undoable moves.
    await undoButton(page).click();
    await expect
      .poll(() => stripOrder(page, PROJECT_ID))
      .toEqual(["alpha", "bravo", CHILD_ID, "charlie"]);
    await expect
      .poll(() => api.patchesFor(TRASH_ID).at(-1)?.clipIds, { timeout: 5000 })
      .toEqual([]);
  });

  test("dropping a card on an ancestor breadcrumb crumb moves it up a level (no crumb at the root)", async ({
    page,
  }) => {
    const api = await installGraphApi(page);

    // At the ROOT the focused crumb is the ONLY crumb — there are no ANCESTOR
    // crumbs to drop on (nowhere up to go).
    await page.goto(`${GRAPH_URL}?surface=strip`);
    await strip(page, PROJECT_ID)
      .locator('[data-node-id="alpha"]')
      .waitFor({ state: "visible", timeout: 30000 });
    await expect(page.locator("[data-graph-ancestor-drop]")).toHaveCount(0);

    // Drill into the child: the PROJECT crumb (its parent) becomes an ancestor
    // drop target — the trail itself is the "move up a level" control now.
    await page.goto(`${GRAPH_URL}/${encodeURIComponent(CHILD_ID)}?surface=strip`);
    await strip(page, CHILD_ID)
      .locator('[data-node-id="c1"]')
      .waitFor({ state: "visible", timeout: 30000 });
    expect(await stripOrder(page, CHILD_ID)).toEqual(["c1", "c2"]);
    const projectCrumb = page.locator(`[data-graph-ancestor-drop="${PROJECT_ID}"]`);
    await expect(projectCrumb).toHaveCount(1);

    // Drag c1 up onto the project (parent) crumb → it leaves the focused child
    // and lands in the parent collection.
    await holdDrag(page, strip(page, CHILD_ID).locator('[data-node-id="c1"]'), projectCrumb);

    // The focused child now holds only c2…
    await expect.poll(() => stripOrder(page, CHILD_ID)).toEqual(["c2"]);

    // …and both documents persist the move, in ONE atomic batch: c1 removed
    // from the child, appended to the parent.
    await expect
      .poll(() => api.patchesFor(CHILD_ID).at(-1)?.clipIds, { timeout: 5000 })
      .toEqual(["c2"]);
    await expect
      .poll(() => api.patchesFor(PROJECT_ID).at(-1)?.clipIds, { timeout: 5000 })
      .toEqual(["alpha", "bravo", "clip-scene", "charlie", "c1"]);
    expect(
      api.batches.some(
        (batch) => batch.includes(CHILD_ID) && batch.includes(PROJECT_ID),
      ),
    ).toBe(true);

    // Ordinary undoable move.
    await undoButton(page).click();
    await expect.poll(() => stripOrder(page, CHILD_ID)).toEqual(["c1", "c2"]);
  });

  test("every ancestor is a drop target: a card jumps multiple levels to a grandparent crumb", async ({
    page,
  }) => {
    const api = await installGraphApi(page);
    // Build PROJECT → Scene A (child) → Scene B (grandchild, holds g1).
    api.documents
      .get(CHILD_ID)!
      .clips.push(collectionClip("clip-nested", GRANDCHILD_ID, 2, "Scene B", 1));
    api.documents.set(GRANDCHILD_ID, {
      id: GRANDCHILD_ID,
      title: "Scene B",
      clips: [mediaClip("g1", "image", 0, 4)],
    });

    // Focus TWO levels deep, on Scene B, via a deep link.
    await page.goto(
      `${GRAPH_URL}/${encodeURIComponent(CHILD_ID)}/${encodeURIComponent(GRANDCHILD_ID)}?surface=strip`,
    );
    await strip(page, GRANDCHILD_ID)
      .locator('[data-node-id="g1"]')
      .waitFor({ state: "visible", timeout: 30000 });

    // BOTH ancestors are drop targets — the project (root) and Scene A (parent).
    await expect(page.locator("[data-graph-ancestor-drop]")).toHaveCount(2);
    const projectCrumb = page.locator(`[data-graph-ancestor-drop="${PROJECT_ID}"]`);
    await expect(projectCrumb).toHaveCount(1);
    await expect(page.locator(`[data-graph-ancestor-drop="${CHILD_ID}"]`)).toHaveCount(1);

    // Drop g1 on the PROJECT crumb → it jumps TWO levels up, from Scene B
    // straight to the project, in a single motion.
    await holdDrag(page, strip(page, GRANDCHILD_ID).locator('[data-node-id="g1"]'), projectCrumb);
    await expect.poll(() => stripOrder(page, GRANDCHILD_ID)).toEqual([]);
    await expect
      .poll(() => api.patchesFor(GRANDCHILD_ID).at(-1)?.clipIds, { timeout: 5000 })
      .toEqual([]);
    await expect
      .poll(() => api.patchesFor(PROJECT_ID).at(-1)?.clipIds, { timeout: 5000 })
      .toEqual(["alpha", "bravo", "clip-scene", "charlie", "g1"]);
  });

  test("a breadcrumb moves the board without waiting for the server", async ({ page }) => {
    const api = await installGraphApi(page);
    api.documents
      .get(CHILD_ID)!
      .clips.push(collectionClip("clip-nested", GRANDCHILD_ID, 2, "Scene B", 1));
    api.documents.set(GRANDCHILD_ID, {
      id: GRANDCHILD_ID,
      title: "Scene B",
      clips: [mediaClip("g1", "image", 0, 4)],
    });

    await page.goto(
      `${GRAPH_URL}/${encodeURIComponent(CHILD_ID)}/${encodeURIComponent(GRANDCHILD_ID)}?surface=strip`,
    );
    await strip(page, GRANDCHILD_ID)
      .locator('[data-node-id="g1"]')
      .waitFor({ state: "visible", timeout: 30000 });

    // STALL every RSC navigation request. A focus change needs NOTHING from
    // the server — the graph is already in memory and the page segment only
    // primes documents the client can fetch itself — so the board must move
    // regardless. This is precisely what a plain <Link> crumb could not do:
    // it cannot repaint until the App Router commits the new pathname, and
    // that commit waits on this very request. Asserting the mechanism rather
    // than a stopwatch, because a timing budget would be flaky and would not
    // fail at all on a fast local server.
    await page.route(/_rsc=/, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      await route.abort().catch(() => {});
    });

    await page.locator(`[data-graph-ancestor-drop="${CHILD_ID}"] a`).click();

    // Scene A's own clips are on screen well inside the stall.
    await expect(strip(page, CHILD_ID).locator('[data-node-id="c1"]')).toBeVisible({
      timeout: 1500,
    });
    await page.unroute(/_rsc=/);
  });

  test("hovering a drop zone highlights the parent crumb / animates the sidebar trash icon", async ({
    page,
  }) => {
    await installGraphApi(page);
    // Drill in so an ancestor crumb (the project) exists to drop on.
    await page.goto(`${GRAPH_URL}/${encodeURIComponent(CHILD_ID)}?surface=strip`);
    const c1 = strip(page, CHILD_ID).locator('[data-node-id="c1"]');
    await c1.waitFor({ state: "visible", timeout: 30000 });
    await settleMoveAnimations(page);

    // The project (ancestor) crumb IS the "move up" drop target; its link
    // carries the hover underline.
    const parentZone = page.locator(`[data-graph-ancestor-drop="${PROJECT_ID}"]`);
    const parentCrumb = parentZone.locator("a");
    const trashZone = page.locator(`[data-graph-sidebar-trash="${TRASH_ID}"]`);
    // The drawer button's icon is a COMPOSED glyph (a folder with a trash can
    // in it), so the animation rides its wrapper — not an <svg>.
    const trashIcon = page.locator('[data-sidebar-icon="trash"]');

    // Pick c1 up (hold to activate), then hold it — no release — over each zone.
    const box = (await c1.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(400);

    // The middle summary + right toolbar fade out under the drag readout (both
    // DragChromeFade wrappers); the breadcrumb, the drop target, stays.
    const chromeFades = page.locator("[data-drag-chrome-fade]");
    await expect(chromeFades).toHaveCount(2);
    for (const fade of await chromeFades.all()) {
      await expect(fade).toHaveAttribute("data-faded", "true");
    }

    // PL14-009: while a drag is live, an ancestor crumb takes a faint FILL as
    // well as its dotted underline — the pointer is still on the card here, so
    // this is the "droppable, not hovered" state. A background is what makes
    // the crumb read as a region you can drop into; an underline alone is a
    // mark on text. Layout-neutral by design (see AncestorCrumb).
    await expect
      .poll(async () => (await parentCrumb.getAttribute("class")) ?? "")
      .toContain("bg-zinc-800/50");
    expect(
      await parentCrumb.evaluate((el) => getComputedStyle(el).backgroundColor),
    ).not.toBe("rgba(0, 0, 0, 0)");

    // Over MOVE-TO-PARENT → the parent crumb lights up; trash icon still calm.
    const pz = (await parentZone.boundingBox())!;
    await page.mouse.move(pz.x + pz.width / 2, pz.y + pz.height / 2, { steps: 12 });
    await expect
      .poll(async () => (await parentCrumb.getAttribute("class")) ?? "")
      .toContain("decoration-sky-400");
    // …and the fill steps up to the sky tint, so hovered still outranks merely
    // droppable (PL14-009).
    await expect(parentCrumb).toHaveClass(/bg-sky-500\/15/);
    await expect(trashIcon).not.toHaveClass(/animate-trash-hover-attention/);

    // The ghost covers the crumb, so the trash slot borrows its pixels to name
    // the destination: "Drop into {crumb title}".
    const crumbLabel = (await parentCrumb.innerText()).trim();
    await expect(trashZone).toHaveAttribute("data-drop-state", "hint");
    await expect(trashZone).toContainText("Drop into");
    await expect(trashZone).toContainText(crumbLabel);

    // Over MOVE-TO-TRASH → the sidebar trash icon animates; crumb highlight clears.
    const tz = (await trashZone.boundingBox())!;
    await page.mouse.move(tz.x + tz.width / 2, tz.y + tz.height / 2, { steps: 12 });
    await expect(trashIcon).toHaveClass(/animate-trash-hover-attention/);
    await expect
      .poll(async () => (await parentCrumb.getAttribute("class")) ?? "")
      .not.toContain("decoration-sky-400");

    // The trash IS the target now, so the slot is the trash again — not a
    // destination hint.
    await expect(trashZone).toHaveAttribute("data-drop-state", "over");
    await expect(trashZone).toContainText("Move to trash");

    // Release back on the source — no move — and the trash animation stops.
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(80);
    await expect(trashIcon).not.toHaveClass(/animate-trash-hover-attention/);
    // Chrome returns once the drag ends.
    for (const fade of await chromeFades.all()) {
      await expect(fade).toHaveAttribute("data-faded", "false");
    }
    expect(await stripOrder(page, CHILD_ID)).toEqual(["c1", "c2"]);
  });

  test("drop into an un-hydrated collection bounces and never writes its document", async ({
    page,
  }) => {
    const api = await installGraphApi(page, { blockChildDocument: true });
    await openGraph(page);
    const projectStrip = strip(page, PROJECT_ID);

    // The child document never loads: the collection stays a placeholder.
    // (Read off `data-collection-hydrated`. This used to assert the card's
    // "Open to load" text, which PL6-001 deleted when it made the empty
    // collection preview icon-only — a placeholder and a loaded collection
    // now look the same, so the attribute is the signal.)
    await expect(placeholderCard(page, CHILD_ID)).toHaveAttribute(
      "data-collection-hydrated",
      "false",
    );

    // Nest alpha into the placeholder (drop dead-center): the commandPolicy
    // refuses it BEFORE it commits, with a rejection flash.
    await holdDrag(
      page,
      projectStrip.locator('[data-node-id="alpha"]'),
      projectStrip.locator(`[data-node-id="${CHILD_ID}"]`),
      0.5,
    );

    await expect(projectStrip.locator('[data-node-id="alpha"]')).toHaveAttribute(
      "data-rejected",
      "true",
    );
    await expect
      .poll(() => stripOrder(page, PROJECT_ID))
      .toEqual(["alpha", "bravo", CHILD_ID, "charlie"]);

    // The un-hydrated document is never written (the write guard), and no
    // project write may drop alpha.
    await page.waitForTimeout(1500); // outlast the write debounce
    expect(api.patchesFor(CHILD_ID)).toHaveLength(0);
    for (const patch of api.patchesFor(PROJECT_ID)) {
      expect(patch.clipIds).toContain("alpha");
    }
  });

  test("a refused drop leaves the redo branch intact", async ({ page }) => {
    // The regression behind the pre-commit commandPolicy. The old design let
    // the drop commit and undid it from the persistence bridge; the commit
    // cleared the redo branch on its way in, so a refused drop silently ate
    // the user's redoable work and left ITSELF queued for redo.
    await installGraphApi(page, { blockChildDocument: true });
    await openGraph(page);
    const projectStrip = strip(page, PROJECT_ID);

    // Action A: move alpha to the end, then undo it so A is redoable.
    await holdDrag(
      page,
      projectStrip.locator('[data-node-id="alpha"]'),
      projectStrip.locator('[data-node-id="charlie"]'),
      0.85,
    );
    await expect
      .poll(() => stripOrder(page, PROJECT_ID))
      .toEqual(["bravo", CHILD_ID, "charlie", "alpha"]);
    await undoButton(page).click();
    await expect
      .poll(() => stripOrder(page, PROJECT_ID))
      .toEqual(["alpha", "bravo", CHILD_ID, "charlie"]);
    await expect(redoButton(page)).toBeEnabled();

    // The premise: the child is STILL an un-hydrated placeholder here, after
    // the drag/undo above. Without this the drop below would be legal and the
    // test would pass while exercising nothing.
    await expect(placeholderCard(page, CHILD_ID)).toHaveAttribute(
      "data-collection-hydrated",
      "false",
    );

    // Now attempt a drop the policy refuses. Must be alpha (index 0, the
    // same drag the bounce test above proves NESTS) — a node adjacent to the
    // placeholder resolves dead-center as a same-position no-op instead,
    // which the reducer rejects for unrelated reasons and would make this
    // test pass without ever exercising the veto.
    await holdDrag(
      page,
      projectStrip.locator('[data-node-id="alpha"]'),
      projectStrip.locator(`[data-node-id="${CHILD_ID}"]`),
      0.5,
    );
    // Pin the premise: the VETO fired (its message reaches both the live
    // region and the toast — .first() tolerates either), not some other
    // rejection that would leave redo intact for the wrong reason.
    await expect(
      page.getByText(/drop again once its clips appear/i).first(),
    ).toBeVisible();
    // The refusal itself is covered by the bounce test above; here the point
    // is only that nothing landed (the flash is a 600ms window — too racy to
    // assert after the extra interactions this test needs).
    await expect
      .poll(() => stripOrder(page, PROJECT_ID))
      .toEqual(["alpha", "bravo", CHILD_ID, "charlie"]);

    // A is STILL what redo replays — not the refused drop, and not nothing.
    await expect(redoButton(page)).toBeEnabled();
    await redoButton(page).click();
    await expect
      .poll(() => stripOrder(page, PROJECT_ID))
      .toEqual(["bravo", CHILD_ID, "charlie", "alpha"]);
    await expect(redoButton(page)).toBeDisabled();
  });

  test("the preview OPENS at its height instead of animating into it", async ({ page }) => {
    await installGraphApi(page);
    await openGraph(page);

    // Listen before the toggle: the mount-time sizing pass measures the real
    // height a frame or two after the placeholder one paints, so a height
    // transition armed at mount plays as a visible shrink — every first open,
    // and only the first (a reopen restores the remembered height).
    await page.evaluate(() => {
      const runs: string[] = [];
      (window as unknown as { __heightRuns: string[] }).__heightRuns = runs;
      document.addEventListener(
        "transitionrun",
        (event) => {
          if ((event as TransitionEvent).propertyName === "height") runs.push("height");
        },
        true,
      );
    });

    await previewToggle(page).click();
    await expect(page.locator('[data-testid="workbench-display-canvas"]')).toBeVisible();
    await page.waitForTimeout(500);

    const runs = await page.evaluate(
      () => (window as unknown as { __heightRuns: string[] }).__heightRuns,
    );
    expect(runs).toEqual([]);

    // The transition is still armed afterwards, for a viewport clamp.
    const pane = page.locator('[data-testid="workbench-preview-region"] > div').first();
    await expect(pane).toHaveClass(/transition-\[height\]/);
  });

  test("a dropped card animates out of the ghost, not back to where it started", async ({
    page,
  }) => {
    await installGraphApi(page);
    await openGraph(page);
    const projectStrip = strip(page, PROJECT_ID);
    const alpha = projectStrip.locator('[data-node-id="alpha"]');
    const charlie = projectStrip.locator('[data-node-id="charlie"]');
    await settleMoveAnimations(page);

    // Record every Web Animation started during the drop instead of racing a
    // 180ms window with getAnimations().
    await page.evaluate(() => {
      const recorded: { duration: unknown; transforms: string[] }[] = [];
      (window as unknown as { __drops: typeof recorded }).__drops = recorded;
      const original = Element.prototype.animate;
      Element.prototype.animate = function (keyframes, options) {
        const frames = Array.isArray(keyframes) ? keyframes : [];
        recorded.push({
          duration:
            typeof options === "number" ? options : (options as KeyframeAnimationOptions)?.duration,
          transforms: frames
            .map((frame) => (frame as Keyframe)?.transform)
            .filter((value): value is string => typeof value === "string"),
        });
        return original.call(this, keyframes, options);
      };
    });

    const from = (await alpha.boundingBox())!;
    const to = (await charlie.boundingBox())!;
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(400);
    await page.mouse.move(to.x + to.width * 0.8, to.y + to.height / 2, { steps: 12 });
    await page.waitForTimeout(150);
    await page.mouse.up();
    await page.waitForTimeout(120);

    const drops = await page.evaluate(
      () => (window as unknown as { __drops: { duration: unknown; transforms: string[] }[] }).__drops,
    );
    const moves = drops.filter((entry) => entry.transforms.some((t) => t.includes("translate")));
    expect(moves.length).toBeGreaterThan(0);

    // dnd-kit's default drop animation (250ms) would fly the ghost BACK to
    // the drag's origin while the card FLIPs forward — two motions crossing.
    // It is switched off, so nothing runs at that duration.
    expect(moves.some((entry) => entry.duration === 250)).toBe(false);

    // The dropped card starts from the ghost's box: a fractional scale (the
    // ghost is 72px wide, the card is not). Displaced siblings animate at
    // scale(1, 1), so this is exactly the dropped card's signature.
    const grewFromGhost = moves.some((entry) =>
      entry.transforms.some((t) => /scale\(0?\.\d+/.test(t)),
    );
    expect(grewFromGhost).toBe(true);

    // And the move itself still committed.
    await expect
      .poll(() => stripOrder(page, PROJECT_ID))
      .toEqual(["bravo", CHILD_ID, "charlie", "alpha"]);
  });

  test("drilling in doesn't wait for the server, and keeps the preview pane alive", async ({
    page,
  }) => {
    await installGraphApi(page);
    await openGraph(page);
    await previewToggle(page).click();
    await expect(page.locator('[data-testid="workbench-display-canvas"]')).toBeVisible();

    // Tag the live canvas. A remounted pane mints a fresh one, so the tag
    // surviving the drill IS the "no teardown" assertion.
    await page.evaluate(() => {
      document
        .querySelector('[data-testid="workbench-display-canvas"]')
        ?.setAttribute("data-alive", "1");
    });

    // Hold the App Router's RSC request for this navigation. The focus change
    // needs nothing from it (the graph is in memory; the route only primes
    // documents), so the board must move well before it answers.
    await page.route("**/graph/**", async (route) => {
      if (!route.request().url().includes("_rsc=")) return route.continue();
      await new Promise((resolve) => setTimeout(resolve, 2000));
      await route.continue();
    });

    await page.getByRole("button", { name: "Open Scene A" }).first().click();
    // Well inside the 2s the server response is held for.
    await expect(page.getByText("Scene A", { exact: true }).first()).toBeVisible({
      timeout: 900,
    });
    await expect(strip(page, PROJECT_ID)).toHaveCount(0, { timeout: 900 });

    // Same canvas element as before the drill: no black flash, no re-decode,
    // and the height the user chose survives.
    await expect(page.locator('[data-testid="workbench-display-canvas"]')).toHaveAttribute(
      "data-alive",
      "1",
    );
    // The URL still lands once the held response arrives.
    await expect
      .poll(() => new URL(page.url()).pathname, { timeout: 8000 })
      .toBe(`/timeline/${PROJECT_ID}/graph/${CHILD_ID}`);
  });

  test("preview mode: capless playhead line, drag-to-scrub, no layout blowout", async ({
    page,
  }) => {
    await installGraphApi(page);
    await openGraph(page);
    await previewToggle(page).click();

    // The pane upgrades to the server-compiled full-depth manifest read
    // model once it lands (until then the live projection plays).
    await expect(page.locator("[data-preview-source]")).toHaveAttribute(
      "data-preview-source",
      "manifest",
    );

    // Playhead visuals ride the strip's presentational overlay. The line is
    // a bare stem — no cap children: the seek rail's circular thumb above
    // is the playhead's head.
    const playhead = page.locator("[data-graph-playhead]");
    await expect(playhead).toBeVisible();
    await expect(playhead.locator("div")).toHaveCount(0);

    // The preview pane must not blow the page out horizontally (the
    // minmax(0,1fr) grid-track regression).
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);

    const translateX = () =>
      playhead.evaluate((el) => {
        const match = /translateX\(([-\d.]+)px\)/.exec((el as HTMLElement).style.transform);
        return match ? Number(match[1]) : 0;
      });
    const before = await translateX();

    // Scrub: press the SEEK RAIL riding the strip's top padding band and
    // drag right — the playhead follows the pointer through the time↔x
    // map. hover() first: the pane above settles its layout asynchronously,
    // and hover waits for the rail's bounding box to be STABLE before
    // positioning the mouse (raw coordinates measured earlier land on a
    // card instead).
    const stripRail = page.getByRole("slider", { name: "Seek preview" });
    await stripRail.hover({ position: { x: 60, y: 4 } });
    await page.mouse.down();
    const railBox = await stripRail.boundingBox();
    expect(railBox).not.toBeNull();
    await page.mouse.move(railBox!.x + 260, railBox!.y + 4, { steps: 10 });
    await page.mouse.up();

    await expect.poll(translateX).toBeGreaterThan(before + 100);

    // LOCKSTEP: the rail scrolls with the strip's content, so its thumb
    // (last div inside the rail) sits directly above the playhead line.
    const stripThumbBox = (await stripRail.locator("[data-rail-thumb]").boundingBox())!;
    const lineBox = (await playhead.boundingBox())!;
    expect(
      Math.abs(stripThumbBox.x + stripThumbBox.width / 2 - (lineBox.x + 1)),
    ).toBeLessThanOrEqual(2);

    // And STRIP media cards inset their artwork like the grid's (~6px
    // frame) — full-bleed pressed the pixels into the rail here too.
    const stripMedia = strip(page, PROJECT_ID).locator('[data-node-id="alpha"]');
    const stripImgBox = (await stripMedia.locator("img").first().boundingBox())!;
    const stripCardBox = (await stripMedia.boundingBox())!;
    expect(stripImgBox.y - stripCardBox.y).toBeGreaterThanOrEqual(5);

    // Drill-in RESETS the persistent preview clock: the layout (and with it
    // the time channel) survives navigation, but a different focused
    // timeline is a different clock — without the reset the transport would
    // park at "long-timeline-time / short-timeline-duration". The collection
    // card's folder button drills (the interaction model's pointer path).
    await strip(page, PROJECT_ID)
      .locator(`[data-node-wrapper="${CHILD_ID}"]`)
      .getByRole("button", { name: /^Open / })
      .click();
    await page.waitForURL(`**${GRAPH_URL}/${CHILD_ID}`);
    await expect.poll(translateX).toBeLessThan(20);
  });

  test("preview transport stays static in the divider with time aligned right", async ({
    page,
  }) => {
    await installGraphApi(page);
    await openGraph(page);
    await previewToggle(page).click();

    const surface = page.getByTestId("workbench-display-surface");
    const canvas = page.getByTestId("workbench-display-canvas");
    const controls = page.getByTestId("workbench-preview-controls");
    const buttonGroup = controls.locator("[data-transport-button-group]");
    const primaryControl = controls.locator("[data-transport-primary-control]");
    const time = page.getByTestId("workbench-preview-time");
    const divider = page.getByRole("separator", {
      name: "Resize workbench display",
    });
    const dividerLine = divider.locator("[data-divider-line]");
    const playButton = page.getByRole("button", {
      name: "Play workbench preview",
    });

    expect(await controls.evaluate((element) => getComputedStyle(element).position)).toBe(
      "absolute",
    );
    await expect(controls).toHaveAttribute("data-transport-layout", "static");
    await expect(page.getByRole("button", { name: "Previous workbench clip" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Next workbench clip" })).toBeVisible();
    await expect(time).toContainText("/");
    await expect(controls.locator("[data-transport-capsule]")).toHaveCount(0);
    // Grip marks are the coarse-pointer affordance; this runs at desktop
    // width, where the hover brighten does the job and the grip stays unpainted.
    await expect(divider.locator("[data-divider-grip]")).toBeHidden();
    // RESTING (nothing hovered): background-free. The ACTIVE invert to a white
    // disc is covered by the WorkbenchSplitPane story, which can hover the
    // preview deterministically.
    expect(
      await primaryControl.evaluate(
        (element) => getComputedStyle(element).backgroundColor,
      ),
    ).toBe("rgba(0, 0, 0, 0)");

    // All three 44px hit targets remain centered on the divider's visible
    // band, while their own chrome stays deliberately compact.
    const [surfaceBox, canvasBox, groupBox, dividerBox, dividerLineBox, timeBox] =
      await Promise.all([
        surface.boundingBox(),
        canvas.boundingBox(),
        buttonGroup.boundingBox(),
        divider.boundingBox(),
        dividerLine.boundingBox(),
        time.boundingBox(),
      ]);
    expect(surfaceBox).not.toBeNull();
    expect(canvasBox).not.toBeNull();
    expect(groupBox).not.toBeNull();
    expect(dividerBox).not.toBeNull();
    expect(dividerLineBox).not.toBeNull();
    expect(timeBox).not.toBeNull();
    // The BOX is the hit target and never changes; the visible band is
    // smaller and centred on one fixed mid-line, so its height can differ by
    // breakpoint (8 here at desktop, 12 where it hosts the grip) with nothing
    // else moving.
    expect(dividerBox!.height).toBe(16);
    expect(dividerLineBox!.height).toBe(8);
    expect(dividerLineBox!.y + dividerLineBox!.height / 2).toBeCloseTo(dividerBox!.y + 10, 0);
    expect(groupBox!.width).toBe(132);
    expect(groupBox!.height).toBe(44);
    // Centered on the BAND, not on the box.
    expect(dividerLineBox!.y + dividerLineBox!.height / 2).toBeCloseTo(
      groupBox!.y + groupBox!.height / 2,
      0,
    );
    expect(canvasBox!.y + canvasBox!.height).toBeCloseTo(dividerBox!.y, 0);
    expect(
      Math.abs(timeBox!.x + timeBox!.width - (surfaceBox!.x + surfaceBox!.width - 12)),
    ).toBeLessThanOrEqual(1);

    const [previousVisualBox, playVisualBox, nextVisualBox] = await Promise.all([
      page
        .getByRole("button", { name: "Previous workbench clip" })
        .locator("span")
        .boundingBox(),
      page
        .getByRole("button", { name: "Play workbench preview" })
        .locator("span")
        .boundingBox(),
      page
        .getByRole("button", { name: "Next workbench clip" })
        .locator("span")
        .boundingBox(),
    ]);
    expect(previousVisualBox).not.toBeNull();
    expect(playVisualBox).not.toBeNull();
    expect(nextVisualBox).not.toBeNull();
    expect(
      playVisualBox!.x +
        playVisualBox!.width / 2 -
        (previousVisualBox!.x + previousVisualBox!.width / 2),
    ).toBeCloseTo(36, 0);
    expect(
      nextVisualBox!.x +
        nextVisualBox!.width / 2 -
        (playVisualBox!.x + playVisualBox!.width / 2),
    ).toBeCloseTo(36, 0);

    // Divider hover does not resize or move the transport.
    await divider.hover({ position: { x: 20, y: 6 } });
    const groupAfterHover = await buttonGroup.boundingBox();
    expect(groupAfterHover).not.toBeNull();
    expect(groupAfterHover!.x).toBeCloseTo(groupBox!.x, 0);
    expect(groupAfterHover!.y).toBeCloseTo(groupBox!.y, 0);
    expect(groupAfterHover!.width).toBe(groupBox!.width);
    expect(groupAfterHover!.height).toBe(groupBox!.height);

    const overhangPaintsAboveLowerContent = await playButton.evaluate((element) => {
      const buttonBox = element.getBoundingClientRect();
      const controls = element.closest("[data-testid='workbench-preview-controls']");
      const hit = document.elementFromPoint(
        buttonBox.left + buttonBox.width / 2,
        buttonBox.bottom - 2,
      );
      return controls === hit || controls?.contains(hit) === true;
    });
    expect(overhangPaintsAboveLowerContent).toBe(true);

    // Keyboard focus follows the visible previous/play/next DOM order without
    // changing the transport's dimensions.
    const stripButton = page.getByRole("button", {
      name: "Strip layout",
      exact: true,
    });
    await stripButton.focus();
    let playHasFocus = false;
    for (let step = 0; step < 16 && !playHasFocus; step += 1) {
      await page.keyboard.press("Tab");
      playHasFocus = await playButton.evaluate(
        (element) => document.activeElement === element,
      );
    }
    expect(playHasFocus).toBe(true);
    expect(await playButton.evaluate((element) => element.matches(":focus-visible"))).toBe(
      true,
    );
    await expect(controls).toHaveAttribute("data-transport-layout", "static");
    const groupAfterFocus = await buttonGroup.boundingBox();
    expect(groupAfterFocus).not.toBeNull();
    expect(groupAfterFocus!.width).toBe(groupBox!.width);
    expect(groupAfterFocus!.height).toBe(groupBox!.height);

    // Clicking the transport must not engage the divider's resize gesture.
    const surfaceHeightBeforePlay = await divider.getAttribute("aria-valuenow");
    await playButton.click();
    await expect(surface).toHaveAttribute("data-preview-playing", "true");
    await expect(divider).toHaveAttribute("aria-valuenow", surfaceHeightBeforePlay!);

    // The rest of the divider remains a resize target.
    const dividerBoxAfterPlay = await divider.boundingBox();
    expect(dividerBoxAfterPlay).not.toBeNull();
    await page.mouse.move(
      dividerBoxAfterPlay!.x + 20,
      dividerBoxAfterPlay!.y + dividerBoxAfterPlay!.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      dividerBoxAfterPlay!.x + 20,
      dividerBoxAfterPlay!.y + dividerBoxAfterPlay!.height / 2 + 24,
    );
    await page.mouse.up();
    await expect
      .poll(() => divider.getAttribute("aria-valuenow"))
      .not.toBe(surfaceHeightBeforePlay);
  });

  test("preview surface is a pointer shortcut that activates the compact control", async ({
    page,
  }) => {
    const api = await installGraphApi(page);
    // The fixture's video src is intentionally a tiny image data URI. Use the
    // same first clip as an image here so the canvas can draw a real rectangle
    // without reaching the network.
    api.documents.get(PROJECT_ID)!.clips[0]!.kind = "image";
    api.documents.get(PROJECT_ID)!.clips[0]!.startTime = 0;
    await openGraph(page);
    await previewToggle(page).click();

    const surface = page.getByTestId("workbench-display-surface");
    const canvas = page.getByTestId("workbench-display-canvas");
    const controls = page.getByTestId("workbench-preview-controls");
    const primaryControl = controls.locator("[data-transport-primary-control]");
    const primaryColor = () =>
      primaryControl.evaluate((element) => getComputedStyle(element).color);
    const restingColor = await primaryColor();

    await expect(canvas).toHaveAttribute("data-preview-playback-surface-ready", "true");

    const canvasBox = await canvas.boundingBox();
    expect(canvasBox).not.toBeNull();
    const playbackCenter = {
      x: canvasBox!.width / 2,
      y: canvasBox!.height / 2,
    };
    const emptyGutter = {
      x: 2,
      y: canvasBox!.height / 2,
    };

    await expect(canvas).toHaveAttribute("data-preview-playback-shortcut", "true");
    await expect(canvas).not.toHaveAttribute("tabindex");

    // Letterbox space is deliberately inert.
    await canvas.hover({ position: emptyGutter });
    expect(await canvas.evaluate((element) => getComputedStyle(element).cursor)).toBe(
      "default",
    );
    await expect.poll(primaryColor).toBe(restingColor);
    await canvas.click({ position: emptyGutter });
    await expect(surface).toHaveAttribute("data-preview-playing", "false");

    // The shortcut begins only inside the centered rendered-media rectangle.
    await canvas.hover({ position: playbackCenter });
    expect(await canvas.evaluate((element) => getComputedStyle(element).cursor)).toBe(
      "pointer",
    );
    await expect(controls).toHaveAttribute("data-transport-layout", "static");
    await expect.poll(primaryColor).not.toBe(restingColor);

    await canvas.click({ position: playbackCenter });
    await expect(surface).toHaveAttribute("data-preview-playing", "true");
    await expect(
      page.getByRole("button", { name: "Pause workbench preview" }),
    ).toBeVisible();
    await expect(controls).toHaveAttribute("data-transport-layout", "static");

    await canvas.click({ position: playbackCenter });
    await expect(surface).toHaveAttribute("data-preview-playing", "false");
    await expect(
      page.getByRole("button", { name: "Play workbench preview" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Strip layout", exact: true }).hover();
    await expect.poll(primaryColor).toBe(restingColor);
  });

  test("preview divider transport keeps all controls visible for touch", async ({
    page,
  }) => {
    const devtools = await page.context().newCDPSession(page);
    await devtools.send("Emulation.setTouchEmulationEnabled", {
      enabled: true,
      maxTouchPoints: 5,
    });
    const api = await installGraphApi(page);
    api.documents.get(PROJECT_ID)!.clips[0]!.kind = "image";
    api.documents.get(PROJECT_ID)!.clips[0]!.startTime = 0;
    await openGraph(page);
    await previewToggle(page).click();

    expect(
      await page.evaluate(
        () => window.matchMedia("(hover: hover) and (pointer: fine)").matches,
      ),
    ).toBe(false);

    const controls = page.getByTestId("workbench-preview-controls");
    const buttonGroup = controls.locator("[data-transport-button-group]");
    await expect(controls).toHaveAttribute("data-transport-layout", "static");
    await expect
      .poll(() =>
        buttonGroup.evaluate((element) => Math.round(element.getBoundingClientRect().width)),
      )
      .toBe(132);
    await expect(page.getByRole("button", { name: "Previous workbench clip" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Next workbench clip" })).toBeVisible();
    await expect(page.getByTestId("workbench-preview-time")).toBeVisible();

    const canvas = page.getByTestId("workbench-display-canvas");
    await expect(canvas).toHaveAttribute("data-preview-playback-surface-ready", "true");
    const canvasBox = await canvas.boundingBox();
    expect(canvasBox).not.toBeNull();
    const playbackCenter = {
      x: canvasBox!.width / 2,
      y: canvasBox!.height / 2,
    };
    await canvas.click({ position: playbackCenter });
    await expect(page.getByTestId("workbench-display-surface")).toHaveAttribute(
      "data-preview-playing",
      "true",
    );
    await expect(controls).toHaveAttribute("data-transport-layout", "static");
    await canvas.click({ position: playbackCenter });
    await expect(page.getByTestId("workbench-display-surface")).toHaveAttribute(
      "data-preview-playing",
      "false",
    );

    await page.getByRole("button", { name: "Play workbench preview" }).click();
    await expect
      .poll(() =>
        buttonGroup.evaluate((element) => Math.round(element.getBoundingClientRect().width)),
      )
      .toBe(132);
    await expect(page.getByRole("button", { name: "Previous workbench clip" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Next workbench clip" })).toBeVisible();

    await page.getByTestId("workbench-display-canvas").click({
      position: playbackCenter,
    });
    await expect(controls).toHaveAttribute("data-transport-layout", "static");
  });

  test("strip seek rail auto-pans at the scroller's edge while scrubbing", async ({
    page,
  }) => {
    // Viewport narrow enough that the 4-clip strip overflows its scroller —
    // without overflow the pan has nothing to reveal.
    await page.setViewportSize({ width: 560, height: 800 });
    await installGraphApi(page);
    await openGraph(page);
    await previewToggle(page).click();

    const rail = page.getByRole("slider", { name: "Seek preview" });
    await expect(rail).toBeVisible();
    const scroller = strip(page, PROJECT_ID);
    expect(
      await scroller.evaluate((el) => el.scrollWidth - el.clientWidth),
    ).toBeGreaterThan(150);

    // Press the rail, then park the pointer at the scroller's RIGHT edge:
    // the pan loop must keep scrolling the strip AND advancing the scrub
    // while the pointer sits perfectly still — that is the "show more items
    // and keep scrubbing" contract.
    await rail.hover({ position: { x: 40, y: 4 } });
    await page.mouse.down();
    const scrollerBox = (await scroller.boundingBox())!;
    await page.mouse.move(
      scrollerBox.x + scrollerBox.width - 8,
      scrollerBox.y + 5,
      { steps: 6 },
    );
    const scrollAt = () => scroller.evaluate((el) => el.scrollLeft);
    const valueNow = () => rail.evaluate((el) => Number(el.getAttribute("aria-valuenow")));
    await expect.poll(scrollAt).toBeGreaterThan(60);
    const midScroll = await scrollAt();
    const midValue = await valueNow();
    await expect.poll(scrollAt).toBeGreaterThan(midScroll + 40); // still panning
    await expect.poll(valueNow).toBeGreaterThan(midValue); // still scrubbing

    // Reverse: park at the LEFT edge — the strip pans back the other way.
    await page.mouse.move(scrollerBox.x + 8, scrollerBox.y + 5, { steps: 6 });
    const highScroll = await scrollAt();
    await expect.poll(scrollAt).toBeLessThan(highScroll - 40);
    await page.mouse.up();
  });

  test("grid mode with preview: seek rail scrubs (pointer + keyboard); cards keep select, drill and hold-drag", async ({
    page,
  }) => {
    // Narrow viewport → few responsive columns, so the 4 project clips wrap
    // onto at least two rows (needed to see the line change rows on seek).
    await page.setViewportSize({ width: 420, height: 900 });
    await installGraphApi(page);
    await openGraph(page);
    // Switch the surface to grid, then turn Preview on.
    await surfaceButton(page, "grid").click();
    await previewToggle(page).click();

    const playhead = page.locator("[data-graph-grid-playhead]");
    await expect(playhead).toBeVisible();

    const grid = page.locator("[data-virtual-grid]");
    // Fewer than 4 columns guarantees a second row for the 4 project clips.
    const cols = Number(await grid.getAttribute("data-grid-columns"));
    expect(cols).toBeGreaterThanOrEqual(1);
    expect(cols).toBeLessThan(4);

    const translate = () =>
      playhead.evaluate((el) => {
        const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec((el as HTMLElement).style.transform);
        return m ? { x: Number(m[1]), y: Number(m[2]) } : { x: 0, y: 0 };
      });

    // The scrub control: one seek rail PER ROW, each in the gap above its
    // row, mapping exactly that row's cells — so the thumb rides in
    // lockstep above the playhead line on EVERY row of a multi-row grid.
    // Cards own all their pixels (the old full-cover surface ate every
    // pointerdown — R7 #5/#6/#7); the line is a passive indicator.
    const rows = Math.ceil(4 / cols);
    expect(rows).toBeGreaterThanOrEqual(2); // multi-row is the case under test
    const rails = page.locator("[data-graph-seek-rail]");
    await expect(rails).toHaveCount(rows);
    const rail0 = page.getByRole("slider", { name: "Seek preview, row 1" });
    const lastRail = page.getByRole("slider", { name: `Seek preview, row ${rows}` });
    await expect(rail0).toBeVisible();

    // Each rail spans exactly ITS row's cells: row 0 is full (cols cells),
    // the LAST row holds the remainder. Measure lands async
    // (ResizeObserver + MutationObserver), hence polls.
    const cellW = Number(await grid.getAttribute("data-grid-cell-width"));
    const lastRowCells = 4 - cols * (rows - 1);
    await expect
      .poll(async () => (await rail0.boundingBox())!.width)
      .toBeCloseTo(cols * (cellW + 8) - 8, 0);
    await expect
      .poll(async () => (await lastRail.boundingBox())!.width)
      .toBeCloseTo(lastRowCells * (cellW + 8) - 8, 0);

    // Press row 0's rail → the line lands on row 0, thumb IN LOCKSTEP
    // directly above it (same content x — the whole point of per-row
    // rails); the last row's rail shows no thumb (time is not inside it).
    await rail0.hover({ position: { x: 30, y: 4 } });
    await page.mouse.down();
    await page.mouse.up();
    await expect.poll(async () => (await translate()).y).toBeLessThan(52); // row 0
    const thumbOf = (rail: Locator) => rail.locator("[data-rail-thumb]");
    const lockstep = async () => {
      const thumb = (await thumbOf(rail0).boundingBox())!;
      const line = (await playhead.boundingBox())!;
      return Math.abs(thumb.x + thumb.width / 2 - (line.x + 1));
    };
    await expect.poll(lockstep).toBeLessThanOrEqual(2);
    await expect(thumbOf(lastRail)).not.toBeVisible(); // parked rows sit empty

    // Press the LAST row's rail → the playhead SUMMONS into that row and
    // the thumbs swap; still nothing on the grid got selected. Scroll it into
    // view first — a multi-row grid can push the last row below the fold, and
    // a raw mouse.click at an off-screen coordinate would hit nothing.
    await lastRail.scrollIntoViewIfNeeded();
    const lastBox = (await lastRail.boundingBox())!;
    await page.mouse.click(lastBox.x + lastBox.width / 2, lastBox.y + 4);
    await expect.poll(async () => (await translate()).y).toBeGreaterThan(80);
    await expect(thumbOf(lastRail)).toBeVisible();
    await expect(thumbOf(rail0)).not.toBeVisible();
    await expect(grid.locator('[data-selected="true"]')).toHaveCount(0);

    // CUMULATIVE fill: with the playhead on the last row, every EARLIER
    // row's rail reads fully scrubbed-through — the rails stack up into one
    // segmented progress bar. (The fill is the rail's first div child.)
    const fillOf = (rail: Locator) => rail.locator("[data-rail-fill]");
    const rail0Box = (await rail0.boundingBox())!;
    await expect
      .poll(async () => (await fillOf(rail0).boundingBox())!.width)
      .toBeCloseTo(rail0Box.width, 0);

    // CONTINUATION: a drag is not caged by its rail. Dragging the LAST
    // rail left PAST its head backs the scrub into earlier rows' clips…
    await lastRail.hover({ position: { x: 10, y: 4 } });
    await page.mouse.down();
    await page.mouse.move(lastBox.x - cellW, lastBox.y + 4, { steps: 6 });
    // Row pitch is MEASURED, not assumed. This used to hardcode 108 — the
    // `md` cell height plus the gap — so it silently described a layout the
    // app had moved on from, and failed the moment grid cells were rebuilt
    // taller to distinguish the surface from the strip. Cell height is a
    // per-size constant (ITEM_SIZE_DIMENSIONS); read it off the rendered card
    // the same way `cellW` is read off the grid.
    const rowPitch =
      (await grid.locator("[data-node-id]").first().boundingBox())!.height + 8;
    await expect
      .poll(async () => (await translate()).y)
      .toBeLessThan((rows - 1) * rowPitch - 20); // strictly above the last row
    await page.mouse.up();

    // …and overshooting row 0's tail runs forward into the next row.
    await rail0.hover({ position: { x: 30, y: 4 } });
    await page.mouse.down();
    await page.mouse.move(rail0Box.x + rail0Box.width + 60, rail0Box.y + 4, { steps: 6 });
    await expect.poll(async () => (await translate()).y).toBeGreaterThan(80);
    await page.mouse.up();

    // Ticks sit on REAL cell edges: pressing row 0's first tick parks the
    // line exactly at the second clip's cell origin, whatever that clip's
    // duration. (Float coordinates on purpose: an integer-rounded press can
    // slip off the 8px gap the tick centres on.) Row 0 has interior ticks
    // only when it holds more than one cell.
    if (cols > 1) {
      const tickBox = (await rail0.locator("span").first().boundingBox())!;
      await page.mouse.click(tickBox.x + tickBox.width / 2, tickBox.y + 3);
      await expect.poll(async () => (await translate()).x).toBeCloseTo(cellW + 8, 0);
      expect((await translate()).y).toBeCloseTo(0, 0);
    }

    // KEYBOARD: each rail is a slider over ITS row's time window — Home
    // rewinds the row, arrows nudge by a second, End jumps to the row's
    // tail. aria-valuenow tracks the clock, row-relative.
    const valueNow = () => rail0.evaluate((el) => Number(el.getAttribute("aria-valuenow")));
    await rail0.focus();
    await page.keyboard.press("Home");
    await expect.poll(valueNow).toBe(0);
    await expect.poll(async () => (await translate()).x).toBeLessThan(5); // line rewound too
    const max = await rail0.evaluate((el) => Number(el.getAttribute("aria-valuemax")));
    await page.keyboard.press("ArrowRight");
    await expect.poll(valueNow).toBe(Math.min(1, max));
    await page.keyboard.press("End");
    await expect.poll(valueNow).toBe(max);

    // Grids are CONTENT-HEIGHT (the `height` prop is only a max): every row
    // gets room and the PAGE owns vertical scroll. Nothing may consume the
    // wheel — asserted via defaultPrevented observed at window.
    expect(await grid.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(1);

    await page.evaluate(() => {
      const log: boolean[] = [];
      (window as unknown as { __wheelLog: boolean[] }).__wheelLog = log;
      window.addEventListener("wheel", (event) => log.push(event.defaultPrevented), {
        passive: true,
      });
    });
    const wheelLog = () =>
      page.evaluate(() => (window as unknown as { __wheelLog: boolean[] }).__wheelLog);

    await grid.hover({ position: { x: 89, y: 59 } });
    await page.mouse.wheel(0, 100);
    // NOT consumed: the event keeps its default (the page scroll), and the
    // grid itself never moved.
    await expect.poll(async () => (await wheelLog()).includes(false)).toBe(true);
    expect(await grid.evaluate((el) => el.scrollTop)).toBe(0);
    // Rewind the page scroll the wheel just caused before measuring cards.
    await page.evaluate(() => window.scrollTo(0, 0));

    // With the surface gone the cards OWN their pixels again, preview on:

    // Media cards inset their artwork like collection cards do (~6px
    // frame, BOTH surfaces), so both card kinds read as the same height
    // and the artwork stays clear of the rail above.
    const alpha = grid.locator('[data-node-id="alpha"]');
    const alphaImgBox = (await alpha.locator("img").first().boundingBox())!;
    const alphaBox = (await alpha.boundingBox())!;
    expect(alphaImgBox.y - alphaBox.y).toBeGreaterThanOrEqual(5);

    // SELECT (R7 #7): a plain click toggles selection. (Retried: under load
    // a press can outlast the 250ms hold threshold and become a grab, whose
    // click is — correctly — suppressed.)
    await expect(async () => {
      await alpha.click();
      await expect(alpha).toHaveAttribute("data-selected", "true", { timeout: 700 });
    }).toPass({ timeout: 10000 });

    // HOLD-DRAG (R7 #6): press-and-hold alpha, travel past bravo → reorder.
    const bravo = grid.locator('[data-node-id="bravo"]');
    await holdDrag(page, alpha, bravo, 0.9);
    await expect
      .poll(() => gridOrder(page, PROJECT_ID))
      .toEqual(["bravo", "alpha", CHILD_ID, "charlie"]);

    // DRILL (R7 #5): the collection card's folder button navigates.
    const collectionWrapper = grid.locator(`[data-node-wrapper="${CHILD_ID}"]`);
    await expect(async () => {
      await collectionWrapper.getByRole("button", { name: /^Open / }).click();
      await page.waitForURL(`**${GRAPH_URL}/${CHILD_ID}`, { timeout: 3000 });
    }).toPass({ timeout: 15000 });
  });

  test("a trashed item restores into the timeline you are looking at", async ({ page }) => {
    const api = await installGraphApi(page);
    await openGraph(page);

    // Delete bravo from the project…
    const bravo = strip(page, PROJECT_ID).locator('[data-node-id="bravo"]');
    await expect(async () => {
      await bravo.click();
      await expect(bravo).toHaveAttribute("data-selected", "true", { timeout: 700 });
    }).toPass({ timeout: 10000 });
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await expect
      .poll(() => stripOrder(page, PROJECT_ID))
      .toEqual(["alpha", CHILD_ID, "charlie"]);

    // …drill into the child, so "where it came from" and "where I am" differ…
    await page.getByRole("button", { name: "Open Scene A" }).first().click();
    await expect(strip(page, PROJECT_ID)).toHaveCount(0);
    await expect.poll(() => stripOrder(page, CHILD_ID)).toEqual(["c1", "c2"]);

    // …and restore it from the trash drawer. The drawer reads the trash
    // document from the server when it opens, so wait for the debounced write
    // rather than racing it.
    await expect
      .poll(() => api.patchesFor(TRASH_ID).at(-1)?.clipIds, { timeout: 5000 })
      .toEqual(["bravo"]);
    await page.getByRole("button", { name: "Trash", exact: true }).click();
    // "Add <name> to <timeline>" — the drawer stopped saying "Restore" when it
    // became one row per image: putting an image back is an insert into the
    // timeline you are looking at, not an undo of where it came from.
    const restore = page.getByRole("button", { name: /^Add bravo to/ });
    await expect(restore).toBeVisible();
    await restore.click();

    // It lands in the collection now open — not back where it was deleted
    // from — and the row leaves the drawer.
    await expect.poll(() => stripOrder(page, CHILD_ID)).toEqual(["c1", "c2", "bravo"]);
    await expect(restore).toHaveCount(0);

    // Both documents persist the move, and it is an ordinary undoable step.
    await expect.poll(() => api.patchesFor(CHILD_ID).at(-1)?.clipIds, { timeout: 5000 }).toEqual([
      "c1",
      "c2",
      "bravo",
    ]);
    await expect.poll(() => api.patchesFor(TRASH_ID).at(-1)?.clipIds, { timeout: 5000 }).toEqual([]);
    // Close the drawer first — its backdrop covers the whole page, sidebar
    // included, so nothing behind it is clickable.
    await page.getByRole("button", { name: "Close trash" }).click();
    await undoButton(page).click();
    await expect.poll(() => stripOrder(page, CHILD_ID)).toEqual(["c1", "c2"]);
  });

  test("the trash lists files on their way out, and Keep withdraws the mark", async ({
    page,
  }) => {
    const marked = [
      {
        providerId: "cloudinary",
        assetId: "gstudio/user/folder/orphan.png",
        kind: "image",
        name: "Beach, take 3",
        thumbnailUrl: "",
        markedAtMs: Date.now(),
        deleteAfterMs: Date.now() + 24 * 60 * 60 * 1000,
      },
      {
        providerId: "cloudinary",
        assetId: "gstudio/user/folder/spare.mp4",
        kind: "video",
        name: "Unused take",
        thumbnailUrl: "",
        markedAtMs: Date.now(),
        deleteAfterMs: Date.now() + 26 * 24 * 60 * 60 * 1000,
      },
    ];
    const kept: { providerId: string; assetId: string }[] = [];
    await installGraphApi(page);
    // AFTER installGraphApi, deliberately: handlers match in reverse
    // registration order, so the empty default it installs would otherwise
    // win over this one.
    await page.route("**/api/assets/marked**", (route) => {
      if (route.request().method() === "DELETE") {
        const body = route.request().postDataJSON() as {
          assets?: { providerId: string; assetId: string }[];
        };
        kept.push(...(body.assets ?? []));
        return route.fulfill({ json: { success: true, kept: 1 } });
      }
      return route.fulfill({
        json: {
          assets: marked.filter(
            (asset) => !kept.some((ref) => ref.assetId === asset.assetId),
          ),
        },
      });
    });

    await page.goto(GRAPH_URL);
    // The rail's drawer button only mounts once the board is up.
    await expect(page.locator(`[data-virtual-grid="${PROJECT_ID}"]`)).toBeVisible();
    await page.getByRole("button", { name: "Trash", exact: true }).click();

    // The bin and this section answer different questions, so both are here:
    // what did I delete, and what is about to stop existing.
    await expect(page.getByRole("heading", { name: "Recently deleted files" })).toBeVisible();
    await expect(page.getByText("Deletes in 1 day")).toBeVisible();
    await expect(page.getByText("Deletes in 26 days")).toBeVisible();

    // "Keep" withdraws the mark — the file never moved, so nothing is restored
    // and nothing returns to a timeline.
    const keep = page.getByRole("button", { name: "Keep Beach, take 3" });
    await keep.click();
    await expect(keep).toHaveCount(0);
    expect(kept).toEqual([
      { providerId: "cloudinary", assetId: "gstudio/user/folder/orphan.png" },
    ]);
    // The other one is untouched: Keep is per-row, not a blanket reprieve.
    await expect(page.getByRole("button", { name: "Keep Unused take" })).toBeVisible();
  });

  test("crafted focus URLs are rejected; valid deep links still work", async ({ page }) => {
    await installGraphApi(page);

    // A media clip's id is not a timeline — kind check.
    await page.goto(`${GRAPH_URL}/alpha`);
    await expect(page.getByText("Unknown timeline")).toBeVisible();

    // The trash root exists in the graph but is NOT a child of the project —
    // chain check (same guard covers any collection loaded elsewhere).
    await page.goto(`${GRAPH_URL}/${TRASH_ID}`);
    await expect(page.getByText("Unknown timeline")).toBeVisible();

    // A skipped level breaks the chain: the child's clips are not children
    // of the project directly... but a LEGITIMATE deep link to the child
    // itself passes every edge and hydrates on boot.
    await page.goto(`${GRAPH_URL}/${CHILD_ID}?surface=strip`);
    await expect
      .poll(() => stripOrder(page, CHILD_ID), { timeout: 15000 })
      .toEqual(["c1", "c2"]);
    await expect(page.getByText("Unknown timeline")).toHaveCount(0);
  });

  test("keyboard: O on a focused collection card drills into it", async ({ page }) => {
    await installGraphApi(page);
    await openGraph(page);
    // Keyboard-pure path: FOCUS the card (a click would drill immediately
    // now — the pointer twin below) and press the open key.
    await strip(page, PROJECT_ID).locator(`[data-node-id="${CHILD_ID}"]`).focus();
    await page.keyboard.press("o");

    await page.waitForURL(`**${GRAPH_URL}/${CHILD_ID}`);
    await expect.poll(() => stripOrder(page, CHILD_ID)).toEqual(["c1", "c2"]);
  });

  test("Delete moves the whole selection to trash as ONE undoable step", async ({ page }) => {
    await installGraphApi(page);
    await openGraph(page);
    const projectStrip = strip(page, PROJECT_ID);
    const alpha = projectStrip.locator('[data-node-id="alpha"]');
    const bravo = projectStrip.locator('[data-node-id="bravo"]');

    // Build a two-card selection: plain click selects, Ctrl+click adds.
    // (Retried like the interaction-model test: under load a press can
    // outlast the 250ms hold threshold and become a grab, whose click is —
    // correctly — suppressed.)
    await expect(async () => {
      await alpha.click();
      await expect(alpha).toHaveAttribute("data-selected", "true", { timeout: 700 });
    }).toPass({ timeout: 10000 });
    await expect(async () => {
      await bravo.click({ modifiers: ["Control"] });
      await expect(bravo).toHaveAttribute("data-selected", "true", { timeout: 700 });
    }).toPass({ timeout: 10000 });

    await page.keyboard.press("Delete");
    await expect.poll(() => stripOrder(page, PROJECT_ID)).toEqual([CHILD_ID, "charlie"]);
    // The toast is the trash confirmation now — the always-visible bottom-right
    // count panel was removed (R5 #5); trash lives in the sidebar and only
    // surfaces during a drag.
    await expect(page.getByText("Moved 2 items to trash.").first()).toBeVisible();

    // ONE undo restores the whole selection — the delete was a single
    // command, not one history entry per card.
    await undoButton(page).click();
    await expect
      .poll(() => stripOrder(page, PROJECT_ID))
      .toEqual(["alpha", "bravo", CHILD_ID, "charlie"]);
    await expect(undoButton(page)).toBeDisabled();
  });

  test("a disabled clip keeps its slot: the rail marks it, scrubbing lands in it grayed, and play jumps it", async ({
    page,
  }) => {
    await installGraphApi(page);
    await openGraph(page);
    const bravo = strip(page, PROJECT_ID).locator('[data-node-id="bravo"]');

    // Disable the middle clip through the sidebar action.
    await expect(async () => {
      await bravo.click();
      await expect(bravo).toHaveAttribute("data-selected", "true", { timeout: 700 });
    }).toPass({ timeout: 10000 });
    await page.getByRole("button", { name: "More item actions" }).click();
    await page.getByRole("menuitem", { name: "Disable", exact: true }).click();

    // The card stays exactly where it was, muted and badged — never removed.
    // `data-disabled` rides the CONTENT span inside the dnd button, not the
    // button itself (which carries dnd-kit's own aria-disabled).
    await expect(bravo.locator('[data-disabled="true"]')).toBeVisible();
    await expect(bravo.locator('[data-disabled-chip="self"]')).toHaveText("DISABLED");
    const disabledContent = bravo.locator('[data-disabled="true"]');
    await expect(disabledContent).toHaveClass(/ring-amber-300\/65/);
    const disabledVisuals = disabledContent.locator('[data-disabled-visuals="true"]');
    await expect
      .poll(() => disabledVisuals.evaluate((element) => getComputedStyle(element).filter))
      .toContain("grayscale");
    await expect
      .poll(() =>
        disabledVisuals.evaluate((element) => Number(getComputedStyle(element).opacity)),
      )
      .toBeLessThan(1);
    const disabledChip = disabledContent.locator('[data-disabled-chip="self"]');
    await expect
      .poll(() => disabledChip.evaluate((element) => getComputedStyle(element).opacity))
      .toBe("1");
    await expect
      .poll(() => disabledChip.evaluate((element) => getComputedStyle(element).filter))
      .toBe("none");
    await expect
      .poll(() =>
        disabledChip.evaluate((element) => {
          const style = getComputedStyle(element);
          return [style.right, style.bottom];
        }),
      )
      .toEqual(["8px", "8px"]);
    const mediaKind = disabledContent.locator("[data-media-kind]");
    await expect(mediaKind).toHaveText("IMAGE");
    await expect
      .poll(() => mediaKind.evaluate((element) => getComputedStyle(element).opacity))
      .toBe("1");
    await expect
      .poll(() => mediaKind.evaluate((element) => getComputedStyle(element).filter))
      .toBe("none");
    await expect.poll(() => stripOrder(page, PROJECT_ID)).toEqual([
      "alpha",
      "bravo",
      CHILD_ID,
      "charlie",
    ]);

    // Deselect: a live selection swaps the sidebar's layout controls (the
    // preview toggle among them) for the item-action cluster.
    // (Deselecting REMOVES data-selected rather than setting it false, so the
    // aria state is what to wait on.)
    await expect(async () => {
      await bravo.click();
      await expect(bravo).toHaveAttribute("aria-pressed", "false", { timeout: 700 });
    }).toPass({ timeout: 10000 });

    await previewToggle(page).click();
    const rail = page.locator("[data-graph-seek-rail]").first();
    await expect(rail).toBeVisible();
    // The skip is visible in the scrubber before anything is played.
    await expect(page.locator("[data-rail-skip]").first()).toBeVisible();

    // SCRUB into the disabled clip: allowed, and the frame reads as excluded.
    // Its span is the second card's, so a press around 40% of the rail lands
    // inside it; nudge along the rail until the badge shows.
    const badge = page.getByTestId("workbench-display-disabled");
    const box = (await rail.boundingBox())!;
    await expect(async () => {
      for (const fraction of [0.3, 0.35, 0.4, 0.45, 0.5]) {
        await page.mouse.move(box.x + box.width * fraction, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.up();
        if (await badge.isVisible()) return;
      }
      throw new Error("never scrubbed into the disabled clip");
    }).toPass({ timeout: 10000 });

    // PLAY from inside it: the playhead must leave the span immediately rather
    // than sit through the clip's full duration showing a held frame. The
    // badge clearing IS the jump — it only shows while the clock is inside a
    // disabled clip.
    await page.getByRole("button", { name: "Play workbench preview" }).click();
    await expect(badge).toBeHidden({ timeout: 2000 });
  });

  test("selecting a clip switches the rail to item actions; Duplicate clones it after itself; Delete returns to normal", async ({
    page,
  }) => {
    const api = await installGraphApi(page);
    await openGraph(page);
    const alpha = strip(page, PROJECT_ID).locator('[data-node-id="alpha"]');

    // Normal rail: layout controls present, no item actions.
    await expect(page.getByRole("button", { name: "Grid layout" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Duplicate", exact: true })).toHaveCount(0);

    // Select alpha → the contextual cluster switches to item actions, the
    // layout controls give way, and Paste is absent while the clipboard is empty.
    await expect(async () => {
      await alpha.click();
      await expect(alpha).toHaveAttribute("data-selected", "true", { timeout: 700 });
    }).toPass({ timeout: 10000 });
    await expect(page.getByRole("button", { name: "More item actions" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Duplicate", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Grid layout" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Paste", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Copy", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Cut", exact: true })).toBeVisible();
    await expect(page.locator("[data-item-actions-cluster] + div")).toHaveClass(
      /bg-amber-300\/65/,
    );

    // Duplicate → the clone lands right AFTER alpha (index 1), and the focused
    // document persists the add (one write, five clips).
    await page.getByRole("button", { name: "More item actions" }).click();
    await page.getByRole("menuitem", { name: "Duplicate", exact: true }).click();
    await expect.poll(() => stripOrder(page, PROJECT_ID)).toHaveLength(5);
    const order = await stripOrder(page, PROJECT_ID);
    expect(order[0]).toBe("alpha");
    expect(order[1]).not.toBe("alpha");
    expect(order[2]).toBe("bravo");
    await expect.poll(() => api.patchesFor(PROJECT_ID).at(-1)?.clipIds.length).toBe(5);

    // Delete removes the (now-selected) clone and returns to the normal rail.
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await expect
      .poll(() => stripOrder(page, PROJECT_ID))
      .toEqual(["alpha", "bravo", CHILD_ID, "charlie"]);
    await expect(page.getByRole("button", { name: "Grid layout" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Duplicate", exact: true })).toHaveCount(0);
  });

  test("Copy a clip, drill into a collection, and Paste it there — the rail stays available across the drill-in", async ({
    page,
  }) => {
    const api = await installGraphApi(page);
    await openGraph(page);
    const alpha = strip(page, PROJECT_ID).locator('[data-node-id="alpha"]');

    await expect(async () => {
      await alpha.click();
      await expect(alpha).toHaveAttribute("data-selected", "true", { timeout: 700 });
    }).toPass({ timeout: 10000 });

    // Copy → Paste becomes enabled.
    await page.getByRole("button", { name: "Copy", exact: true }).click();
    await expect(page.getByRole("button", { name: "Paste", exact: true })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Copy", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Cut", exact: true })).toHaveCount(0);

    // Drill into the child collection. The clipboard is a module singleton, so
    // it survives the client-side navigation: the rail stays in item mode with
    // Paste available even though the selection is now out of view. The
    // SELECTION survives the navigation too — see the placement test below for
    // why the paste must ignore it here and append into the focused child.
    await page.getByRole("button", { name: "Open Scene A" }).first().click();
    await strip(page, CHILD_ID)
      .locator('[data-node-id="c1"]')
      .waitFor({ state: "visible", timeout: 30000 });
    await expect(page.getByRole("button", { name: "Paste", exact: true })).toBeEnabled();

    // Paste → alpha's clone appends into the child (after c1/c2), the child
    // document gets a write, and the rail returns to normal.
    await page.getByRole("button", { name: "Paste", exact: true }).click();
    await expect.poll(() => stripOrder(page, CHILD_ID)).toHaveLength(3);
    expect((await stripOrder(page, CHILD_ID)).slice(0, 2)).toEqual(["c1", "c2"]);
    await expect.poll(() => api.patchesFor(CHILD_ID).at(-1)?.clipIds.length).toBe(3);
    await expect(page.getByRole("button", { name: "Grid layout" })).toBeVisible();
  });

  test("Paste lands AFTER the selected card, and a selection left above the focus never hijacks it", async ({
    page,
  }) => {
    // Paste follows the same placement rule as the Collection tool: after the
    // most recently selected card, in THAT card's strip — but only while that
    // strip sits inside the focused collection's subtree (i.e. is on the
    // board). It used to always append to the focused collection.
    const api = await installGraphApi(page);
    await openGraph(page);
    const projectStrip = strip(page, PROJECT_ID);
    const alpha = projectStrip.locator('[data-node-id="alpha"]');

    await expect(async () => {
      await alpha.click();
      await expect(alpha).toHaveAttribute("data-selected", "true", { timeout: 700 });
    }).toPass({ timeout: 10000 });
    await page.getByRole("button", { name: "Copy", exact: true }).click();
    await expect(page.getByRole("button", { name: "Paste", exact: true })).toBeEnabled();

    // alpha is still selected and still on screen → its clone lands at index 1,
    // not at the end of the strip.
    await page.getByRole("button", { name: "Paste", exact: true }).click();
    await expect.poll(() => stripOrder(page, PROJECT_ID)).toHaveLength(5);
    const order = await stripOrder(page, PROJECT_ID);
    expect(order[0]).toBe("alpha");
    expect(order[1]).not.toBe("alpha");
    expect(order.slice(2)).toEqual(["bravo", CHILD_ID, "charlie"]);
    // And it IS alpha's clone sitting there, not some other entry.
    await expect(projectStrip.getByRole("button", { name: "alpha", exact: true })).toHaveCount(2);

    // Now the drill-in wrinkle: selection SURVIVES navigation in this app, so
    // a naive "after the selection" would fire this paste back into the
    // project, at a card the user can no longer see.
    const charlie = projectStrip.locator('[data-node-id="charlie"]');
    await expect(async () => {
      await charlie.click();
      await expect(charlie).toHaveAttribute("data-selected", "true", { timeout: 700 });
    }).toPass({ timeout: 10000 });
    await page.getByRole("button", { name: "Copy", exact: true }).click();

    await page.getByRole("button", { name: "Open Scene A" }).first().click();
    // The route change itself, not a CHILD card appearing — a sub-row strip
    // can be on screen before any navigation happens.
    await expect(strip(page, PROJECT_ID)).toHaveCount(0);
    await strip(page, CHILD_ID)
      .locator('[data-node-id="c1"]')
      .waitFor({ state: "visible", timeout: 30000 });
    await page.getByRole("button", { name: "Paste", exact: true }).click();

    // Appended into the FOCUSED child, after its own cards…
    await expect.poll(() => stripOrder(page, CHILD_ID)).toHaveLength(3);
    expect((await stripOrder(page, CHILD_ID)).slice(0, 2)).toEqual(["c1", "c2"]);
    await expect(
      strip(page, CHILD_ID).getByRole("button", { name: "charlie", exact: true }),
    ).toBeVisible();
    // …and the project never grew a sixth clip. Checked on the WRITES because
    // the project strip is off-screen now; the child's write lands in the same
    // debounced batch, so by the time it is recorded a hijacked project write
    // would have been too. (Ancestor summary re-writes are expected — a
    // project patch is fine as long as it still carries five clips.)
    await expect.poll(() => api.patchesFor(CHILD_ID).at(-1)?.clipIds.length).toBe(3);
    expect(api.patchesFor(PROJECT_ID).some((patch) => patch.clipIds.length > 5)).toBe(false);
  });

  test("Cut removes the clip but keeps it on the clipboard; Paste relocates it", async ({
    page,
  }) => {
    await installGraphApi(page);
    await openGraph(page);
    const bravo = strip(page, PROJECT_ID).locator('[data-node-id="bravo"]');

    await expect(async () => {
      await bravo.click();
      await expect(bravo).toHaveAttribute("data-selected", "true", { timeout: 700 });
    }).toPass({ timeout: 10000 });

    // Cut → bravo leaves the project strip (moved to trash), but the clipboard
    // keeps an independent copy, so the rail stays in item mode with Paste on.
    await page.getByRole("button", { name: "Cut", exact: true }).click();
    await expect
      .poll(() => stripOrder(page, PROJECT_ID))
      .toEqual(["alpha", CHILD_ID, "charlie"]);
    await expect(page.getByRole("button", { name: "Paste", exact: true })).toBeEnabled();

    // Paste into the child collection → the cut clip lands there (a move).
    await page.getByRole("button", { name: "Open Scene A" }).first().click();
    await strip(page, CHILD_ID)
      .locator('[data-node-id="c1"]')
      .waitFor({ state: "visible", timeout: 30000 });
    await page.getByRole("button", { name: "Paste", exact: true }).click();
    await expect.poll(() => stripOrder(page, CHILD_ID)).toHaveLength(3);
    // The pasted card IS bravo's clone (same name, fresh id) — not just "some
    // third child": a paste inserting the wrong entry would still pass a bare
    // length check.
    const pasted = strip(page, CHILD_ID).getByRole("button", { name: "bravo", exact: true });
    await expect(pasted).toBeVisible();
    await expect(pasted).not.toHaveAttribute("data-node-id", "bravo");
    await expect(page.getByRole("button", { name: "Grid layout" })).toBeVisible();
  });

  test("keyboard: Ctrl+C copies and Ctrl+V pastes after a drill-in (focus on <body>)", async ({
    page,
  }) => {
    await installGraphApi(page);
    await openGraph(page);
    const alpha = strip(page, PROJECT_ID).locator('[data-node-id="alpha"]');

    await expect(async () => {
      await alpha.click();
      await expect(alpha).toHaveAttribute("data-selected", "true", { timeout: 700 });
    }).toPass({ timeout: 10000 });

    // Ctrl+C — the copy toast is the only visible change, plus Paste arming.
    await page.keyboard.press("Control+c");
    await expect(page.getByText("Copied 1 item.").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Paste", exact: true })).toBeEnabled();

    // Drill in — focus drops to <body> here, which is exactly why the
    // shortcut listener is window-level and not a board-subtree boundary.
    await page.getByRole("button", { name: "Open Scene A" }).first().click();
    await strip(page, CHILD_ID)
      .locator('[data-node-id="c1"]')
      .waitFor({ state: "visible", timeout: 30000 });

    await page.keyboard.press("Control+v");
    await expect.poll(() => stripOrder(page, CHILD_ID)).toHaveLength(3);
    await expect(
      strip(page, CHILD_ID).getByRole("button", { name: "alpha", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Grid layout" })).toBeVisible();
  });

  test("keyboard: Ctrl+D duplicates in place, Ctrl+X cuts the copy back out", async ({
    page,
  }) => {
    await installGraphApi(page);
    await openGraph(page);
    const bravo = strip(page, PROJECT_ID).locator('[data-node-id="bravo"]');

    await expect(async () => {
      await bravo.click();
      await expect(bravo).toHaveAttribute("data-selected", "true", { timeout: 700 });
    }).toPass({ timeout: 10000 });

    // Ctrl+D → the clone lands right after bravo and becomes the selection.
    await page.keyboard.press("Control+d");
    await expect.poll(() => stripOrder(page, PROJECT_ID)).toHaveLength(5);
    const order = await stripOrder(page, PROJECT_ID);
    expect(order[1]).toBe("bravo");
    expect(order[3]).toBe(CHILD_ID);

    // Ctrl+X cuts the selected clone: gone from the strip, Paste armed.
    await page.keyboard.press("Control+x");
    await expect
      .poll(() => stripOrder(page, PROJECT_ID))
      .toEqual(["alpha", "bravo", CHILD_ID, "charlie"]);
    await expect(page.getByRole("button", { name: "Paste", exact: true })).toBeEnabled();
  });

  test("multi-select Duplicate in one parent is ONE undoable step", async ({ page }) => {
    await installGraphApi(page);
    await openGraph(page);
    const projectStrip = strip(page, PROJECT_ID);
    const alpha = projectStrip.locator('[data-node-id="alpha"]');
    const bravo = projectStrip.locator('[data-node-id="bravo"]');

    await expect(async () => {
      await alpha.click();
      await expect(alpha).toHaveAttribute("data-selected", "true", { timeout: 700 });
    }).toPass({ timeout: 10000 });
    await expect(async () => {
      await bravo.click({ modifiers: ["Control"] });
      await expect(bravo).toHaveAttribute("data-selected", "true", { timeout: 700 });
    }).toPass({ timeout: 10000 });

    // Both copies land as one contiguous block after the LAST source (bravo),
    // keeping the sources' relative order.
    await page.getByRole("button", { name: "More item actions" }).click();
    await page.getByRole("menuitem", { name: "Duplicate", exact: true }).click();
    await expect.poll(() => stripOrder(page, PROJECT_ID)).toHaveLength(6);
    const order = await stripOrder(page, PROJECT_ID);
    expect(order.slice(0, 2)).toEqual(["alpha", "bravo"]);
    expect(order.slice(4)).toEqual([CHILD_ID, "charlie"]);
    expect(order[2]).not.toBe(order[3]);

    // ONE undo reverses the whole duplicate — one gesture, one history entry
    // (per parent; both sources share the project here).
    await undoButton(page).click();
    await expect
      .poll(() => stripOrder(page, PROJECT_ID))
      .toEqual(["alpha", "bravo", CHILD_ID, "charlie"]);
    await expect(undoButton(page)).toBeDisabled();
  });

  test("interaction model: click toggles selection + trim handles, hold-grab release does neither, collection body selects and its folder button drills", async ({
    page,
  }) => {
    await installGraphApi(page);
    await openGraph(page);
    // bravo is an IMAGE: selected images grow exactly ONE handle (the end
    // edge) — a video would grow two.
    const bravo = strip(page, PROJECT_ID).locator('[data-node-id="bravo"]');
    const bravoWrapper = strip(page, PROJECT_ID).locator('[data-node-wrapper="bravo"]');

    // Unselected media: no trim handles — the edges are plain card body.
    await expect(bravoWrapper.locator("[data-trim-handle]")).toHaveCount(0);

    // A real click toggles selection ON, and the handle grows in. (Retried:
    // under CI load a press can outlast the 250ms hold threshold, becoming a
    // hold-grab whose click is — correctly — suppressed.)
    await expect(async () => {
      await bravo.click();
      await expect(bravo).toHaveAttribute("data-selected", "true", { timeout: 700 });
    }).toPass({ timeout: 10000 });
    await expect(bravoWrapper.locator("[data-trim-handle]")).toHaveCount(1);

    // Press-and-hold released IN PLACE is a grab, not a click: the trailing
    // click is suppressed, so the selection (and handles) stay put.
    const box = (await bravo.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(400); // past the 250ms hold activation
    await page.mouse.up();
    await expect(bravo).toHaveAttribute("data-selected", "true");
    await expect(bravoWrapper.locator("[data-trim-handle]")).toHaveCount(1);

    // Click again: toggles OFF, handles gone. (Same accidental-hold retry.)
    await expect(async () => {
      await bravo.click();
      await expect(bravo).not.toHaveAttribute("data-selected", "true", { timeout: 700 });
    }).toPass({ timeout: 10000 });
    await expect(bravoWrapper.locator("[data-trim-handle]")).toHaveCount(0);

    // A collection card's BODY selects (like any clip); only its folder
    // button drills in. Click the label strip (below the centred button) to
    // hit the body, and confirm it selects WITHOUT navigating.
    const collectionCard = strip(page, PROJECT_ID).locator(`[data-node-id="${CHILD_ID}"]`);
    const cardBox = (await collectionCard.boundingBox())!;
    await expect(async () => {
      await collectionCard.click({ position: { x: cardBox.width / 2, y: cardBox.height - 4 } });
      await expect(collectionCard).toHaveAttribute("data-selected", "true", { timeout: 700 });
    }).toPass({ timeout: 10000 });
    // Query-tolerant: openGraph lands with ?surface=strip on the same path.
    await expect(page).toHaveURL(new RegExp(`${GRAPH_URL}(\\?.*)?$`));

    // The folder button is the pointer twin of O: it DRILLS IN. It is a real
    // <button> SIBLING of the selection surface (nesting one in the card
    // button would be invalid HTML), so find it via the item wrapper.
    const collectionWrapper = strip(page, PROJECT_ID).locator(
      `[data-node-wrapper="${CHILD_ID}"]`,
    );
    await expect(async () => {
      await collectionWrapper.getByRole("button", { name: /^Open / }).click();
      await page.waitForURL(`**${GRAPH_URL}/${CHILD_ID}`, { timeout: 3000 });
    }).toPass({ timeout: 15000 });
    await expect.poll(() => stripOrder(page, CHILD_ID)).toEqual(["c1", "c2"]);
  });

  test("duplicate media ids across documents demote instead of blanking the collection", async ({
    page,
  }) => {
    const api = await installGraphApi(page);
    // The child document reuses the PROJECT's "alpha" clip id — the legacy
    // views mint stable per-asset ids, so the same asset in two documents
    // produces exactly this. Before demotion, hydrating the child failed
    // wholesale and silently: the card said "3 items", the drill-in showed 0.
    api.documents.get(CHILD_ID)!.clips.push(mediaClip("alpha", "image", 2, 4));

    await openGraph(page);
    await expandSubGraph(page, "Scene A");

    // The child hydrates FULLY: its own clips plus the demoted duplicate.
    await expect
      .poll(() => stripOrder(page, CHILD_ID), { timeout: 15000 })
      .toEqual(["c1", "c2", expect.stringMatching(/^dup:/)]);
    // And no hydration error is on the banner.
    await expect(page.getByText(/could not load its clips/)).toHaveCount(0);

    // A reorder in the child persists the ORIGINAL stored id, not the
    // demoted node id.
    await holdDrag(
      page,
      strip(page, CHILD_ID).locator('[data-node-id="c1"]'),
      strip(page, CHILD_ID).locator('[data-node-id="c2"]'),
      0.85,
    );
    await expect
      .poll(() => api.patchesFor(CHILD_ID).at(-1)?.clipIds, { timeout: 5000 })
      .toEqual(["c2", "c1", "alpha"]);
  });

  test("native drops: sidebar tools and OS files land as nodes and persist", async ({
    page,
  }) => {
    const api = await installGraphApi(page);
    let uploads = 0;
    await page.route("**/api/timeline-media/upload", (route) => {
      uploads += 1;
      return route.fulfill({
        json: { pathname: `upload-${uploads}.png`, url: PIXEL, thumbnailUrl: PIXEL },
      });
    });
    await openGraph(page);
    const dropZone = page.locator(`[data-native-drop="${PROJECT_ID}"]`);

    // 1) Sidebar COLLECTION tool (the only palette tool): mints a new
    //    collection at the drop position (clientX 0 = before the first
    //    card) AND creates its (empty) child document in the SAME atomic
    //    batch as the parent update — a drill-in can never 404 on a
    //    half-created collection.
    const collectionTransfer = await page.evaluateHandle(() => {
      const transfer = new DataTransfer();
      transfer.setData("application/x-gstudio-type", "collection");
      return transfer;
    });
    await dropZone.dispatchEvent("drop", { dataTransfer: collectionTransfer, clientX: 0 });
    await expect
      .poll(() => stripOrder(page, PROJECT_ID).then((order) => order[0]))
      .toMatch(/^timeline-/);
    await expect
      .poll(
        () =>
          api.patches.find((patch) => /^timeline-/.test(patch.id) && patch.clipIds.length === 0)
            ?.id ?? null,
        { timeout: 5000 },
      )
      .not.toBeNull();
    const newChildId = api.patches.find((patch) => /^timeline-/.test(patch.id))!.id;
    expect(
      api.batches.some((batch) => batch.includes(newChildId) && batch.includes(PROJECT_ID)),
    ).toBe(true);

    // 2) OS FILE drop, several at once: both upload and land as ONE commit.
    const fileTransfer = await page.evaluateHandle(() => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([new Uint8Array([137, 80, 78, 71])], "photo-a.png", { type: "image/png" }));
      transfer.items.add(new File([new Uint8Array([137, 80, 78, 71])], "photo-b.png", { type: "image/png" }));
      return transfer;
    });
    await dropZone.dispatchEvent("drop", { dataTransfer: fileTransfer, clientX: 0 });
    // 4 fixture clips + collection tool + 2 files = 7.
    await expect
      .poll(() => stripOrder(page, PROJECT_ID).then((order) => order.length), { timeout: 10000 })
      .toBe(7);
    expect(uploads).toBe(2);

    // Both files persisted into the project document in one write.
    await expect
      .poll(() => api.patchesFor(PROJECT_ID).at(-1)?.clipIds.length, { timeout: 5000 })
      .toBe(7);

    // The whole file drop is ONE undoable step.
    await undoButton(page).click();
    await expect
      .poll(() => stripOrder(page, PROJECT_ID).then((order) => order.length))
      .toBe(5);
  });

  test("an undecodable video fails ALONE — its siblings in the same drop still land", async ({
    page,
  }) => {
    // A multi-file drop must degrade per FILE. The chain under test is a real
    // one with no coverage before this: `probeVideoFile` swallows a decode
    // failure and resolves a NULL poster, the client then omits the thumbnail
    // part, and the upload route refuses a video that arrives without one
    // (400, "Video uploads require a generated thumbnail"). That refusal has
    // to land in the failing file's own result and nowhere else — the pool
    // runs MAX_CONCURRENT_MEDIA workers, so a failure that escaped its worker
    // would abandon whatever its siblings had already uploaded.
    const api = await installGraphApi(page);
    const attempts: string[] = [];
    await page.route("**/api/timeline-media/upload", async (route) => {
      const body = route.request().postData() ?? "";
      const isVideo = /name="filename"[\s\S]*?\.mp4/.test(body);
      const hasThumbnail = /name="thumbnail"/.test(body);
      attempts.push(isVideo ? "video" : "image");
      // Mirror the route: a video with no generated poster is rejected.
      if (isVideo && !hasThumbnail) {
        return route.fulfill({
          status: 400,
          json: { error: "Video uploads require a generated thumbnail." },
        });
      }
      // Slow enough that the sibling is genuinely in flight when the video
      // fails, so a failure escaping its worker would strand a live upload.
      await new Promise((resolve) => setTimeout(resolve, 250));
      return route.fulfill({
        json: { pathname: `upload-${attempts.length}.png`, url: PIXEL, thumbnailUrl: PIXEL },
      });
    });
    await openGraph(page);
    const dropZone = page.locator(`[data-native-drop="${PROJECT_ID}"]`);

    const transfer = await page.evaluateHandle(() => {
      const value = new DataTransfer();
      // Four bytes claiming to be an mp4: the demuxer errors, so the probe
      // comes back with no poster frame.
      value.items.add(new File([new Uint8Array([0, 1, 2, 3])], "broken.mp4", { type: "video/mp4" }));
      value.items.add(
        new File([new Uint8Array([137, 80, 78, 71])], "photo.png", { type: "image/png" }),
      );
      return value;
    });
    await dropZone.dispatchEvent("drop", { dataTransfer: transfer, clientX: 0 });

    // The good file lands anyway: 4 fixture clips + photo.png = 5.
    await expect
      .poll(() => stripOrder(page, PROJECT_ID).then((order) => order.length), { timeout: 15000 })
      .toBe(5);

    // The failure is reported as ITS OWN file, not as a dead drop.
    await expect(page.locator("[data-native-drop-status]")).toContainText("broken.mp4");

    // Both were attempted — the image was never cancelled on the video's way
    // down — and the survivor is a committed clip, not just a card on screen.
    expect(attempts).toHaveLength(2);
    await expect
      .poll(() => api.patchesFor(PROJECT_ID).at(-1)?.clipIds.length, { timeout: 5000 })
      .toBe(5);
  });

  test("sidebar tools insert from the KEYBOARD, with no pointer involved", async ({ page }) => {
    // The palette used to be pointer-only: its tiles were <div role="button">
    // whose Enter/Space did nothing but show a "drag this" toast, and actual
    // insertion needed a native drag carrying a custom DataTransfer. Keyboard
    // and assistive-tech users could not create anything at all.
    await installGraphApi(page);
    await openGraph(page);

    const collectionTool = page.getByRole("button", { name: /add collection/i });
    await expect(collectionTool).toBeVisible();

    // Reach it by TABBING — it must be in the focus order, not just clickable.
    await collectionTool.focus();
    await expect(collectionTool).toBeFocused();
    await page.keyboard.press("Enter");

    // Appended to the end of the focused timeline.
    await expect
      .poll(() => stripOrder(page, PROJECT_ID))
      .toEqual(["alpha", "bravo", CHILD_ID, "charlie", expect.stringMatching(/^timeline-/)]);

    // Space is the other native activation key, and must not be swallowed.
    await collectionTool.focus();
    await page.keyboard.press(" ");
    await expect
      .poll(() => stripOrder(page, PROJECT_ID).then((order) => order.length))
      .toBe(6);

    // It is an ordinary undoable commit, exactly like the drop path.
    await undoButton(page).click();
    await expect
      .poll(() => stripOrder(page, PROJECT_ID).then((order) => order.length))
      .toBe(5);

    // And it persists.
    await expect
      .poll(() => stripOrder(page, PROJECT_ID).then((order) => order.at(-1)), { timeout: 5000 })
      .toMatch(/^timeline-/);
  });

  test("the collection tool lands AFTER the selected card, in that card's own strip", async ({
    page,
  }) => {
    await installGraphApi(page);
    await openGraph(page);

    // Select bravo (a media clip: click toggles selection, no drill)…
    await strip(page, PROJECT_ID).locator('[data-node-id="bravo"]').click();
    await expect(strip(page, PROJECT_ID).locator('[data-node-id="bravo"]')).toHaveAttribute(
      "data-selected",
      "true",
    );

    // …then CLICK the sidebar tool: sidebar clicks never clear selection,
    // so the new collection lands right after bravo, not at the end.
    const collectionTool = page.getByRole("button", { name: /add collection/i });
    await collectionTool.click();
    await expect
      .poll(() => stripOrder(page, PROJECT_ID))
      .toEqual([
        "alpha",
        "bravo",
        expect.stringMatching(/^timeline-/),
        CHILD_ID,
        "charlie",
      ]);

    // The selected card may live in ANY strip: select c1 in the CHILD
    // timeline — the insert follows the selection there, not the focus.
    await expandSubGraph(page, "Scene A");
    await expect
      .poll(() => stripOrder(page, CHILD_ID), { timeout: 15000 })
      .toEqual(["c1", "c2"]);
    await strip(page, CHILD_ID).locator('[data-node-id="c1"]').click();
    await collectionTool.click();
    await expect
      .poll(() => stripOrder(page, CHILD_ID))
      .toEqual(["c1", expect.stringMatching(/^timeline-/), "c2"]);

    // The focused root gained exactly the ONE insert from before.
    await expect
      .poll(() => stripOrder(page, PROJECT_ID).then((order) => order.length))
      .toBe(5);

    // …but only strips INSIDE the focused subtree count. Select charlie in the
    // project, then drill into Scene A: the selection survives the navigation,
    // and the tool must append into the collection now open rather than plant
    // the new timeline back where the user came from (same rule as Paste).
    await strip(page, PROJECT_ID).locator('[data-node-id="charlie"]').click();
    await page.getByRole("button", { name: "Open Scene A" }).first().click();
    // Wait on the PROJECT strip leaving, not on a CHILD card appearing: the
    // Scene A sub-row is expanded above, so its strip is already on the page
    // and that wait would pass without the route having changed at all —
    // letting the tool click race the navigation (it did, first run).
    await expect(strip(page, PROJECT_ID)).toHaveCount(0);
    await collectionTool.click();
    await expect
      .poll(() => stripOrder(page, CHILD_ID))
      .toEqual([
        "c1",
        expect.stringMatching(/^timeline-/),
        "c2",
        expect.stringMatching(/^timeline-/),
      ]);
  });

  test("keyboard insertion works in grid mode too", async ({ page }) => {
    // Grid mode has its own native drop target now (NativeDropGrid), but the
    // sidebar tools must ALSO insert via plain keyboard activation — the
    // insert bridge is mounted for both surfaces either way.
    await installGraphApi(page);
    await openGraph(page);
    await surfaceButton(page, "grid").click();
    await expect(page.locator(`[data-native-drop="${PROJECT_ID}"]`)).toHaveCount(1);

    await page.getByRole("button", { name: /add collection/i }).focus();
    await page.keyboard.press("Enter");

    await expect
      .poll(() => gridOrder(page, PROJECT_ID).then((order) => order.at(-1) ?? ""))
      .toMatch(/^timeline-/);
  });

  test("native grid collection drop centers its indicator in the chosen gap and inserts there", async ({
    page,
  }) => {
    await installGraphApi(page);
    await openGraph(page);
    await surfaceButton(page, "grid").click();

    const dropZone = page.locator(`[data-native-drop="${PROJECT_ID}"]`);
    const grid = page.locator(`[data-virtual-grid="${PROJECT_ID}"]`);
    const alphaBox = (await grid.locator('[data-node-id="alpha"]').boundingBox())!;
    const bravoBox = (await grid.locator('[data-node-id="bravo"]').boundingBox())!;
    const point = {
      x: (alphaBox.x + alphaBox.width + bravoBox.x) / 2,
      y: bravoBox.y + bravoBox.height / 2,
    };

    const accepted = await dropZone.evaluate((element, position) => {
      const transfer = new DataTransfer();
      transfer.setData("application/x-gstudio-type", "collection");
      const event = new DragEvent("dragover", {
        bubbles: true,
        cancelable: true,
        clientX: position.x,
        clientY: position.y,
        dataTransfer: transfer,
      });
      return !element.dispatchEvent(event);
    }, point);
    expect(accepted).toBe(true);

    const indicator = dropZone.locator("[data-native-drop-indicator]");
    await expect(indicator).toBeVisible();
    const indicatorBox = (await indicator.boundingBox())!;
    expect(indicatorBox.x + indicatorBox.width / 2).toBeCloseTo(point.x, 0);
    // …and it must sit ON the row it marks. The line is positioned by a
    // transform measured from the wrapper's origin, so an unanchored
    // `absolute` resolved to its static position — the wrapper's LAST child,
    // i.e. below the whole grid — and the line drew a grid's height too low
    // while still passing the x check above.
    expect(indicatorBox.y).toBeCloseTo(bravoBox.y, 0);
    expect(indicatorBox.height).toBeCloseTo(bravoBox.height, 0);
    // It also has to paint ABOVE the grid. elementFromPoint can't confirm
    // that (the line is pointer-events-none, so hit-testing looks straight
    // through it), so pin the stacking instead: a positive z-index on a
    // later sibling of a z-auto grid puts the line in the positive layer.
    const stacking = await indicator.evaluate((line) => {
      const zone = line.closest("[data-native-drop]")!;
      const grid = zone.querySelector("[data-virtual-grid]")!;
      return {
        lineZ: Number(getComputedStyle(line).zIndex),
        gridZ: getComputedStyle(grid).zIndex,
        lineIsLaterSibling:
          Boolean(grid.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING),
      };
    });
    expect(stacking.lineZ).toBeGreaterThan(0);
    expect(stacking.gridZ).toBe("auto");
    expect(stacking.lineIsLaterSibling).toBe(true);

    const transfer = await page.evaluateHandle(() => {
      const value = new DataTransfer();
      value.setData("application/x-gstudio-type", "collection");
      return value;
    });
    await dropZone.dispatchEvent("drop", {
      dataTransfer: transfer,
      clientX: point.x,
      clientY: point.y,
    });

    await expect
      .poll(() => gridOrder(page, PROJECT_ID))
      .toEqual(["alpha", expect.stringMatching(/^timeline-/), "bravo", CHILD_ID, "charlie"]);
    await expect(indicator).toHaveCount(0);
  });

  test("a deep breadcrumb folds its middle crumbs behind a reachable ellipsis", async ({
    page,
  }) => {
    // PL8-002. Every ancestor used to render, so a deep path crowded the
    // header out. The root and the focused crumb are never folded, and the
    // immediate parent stays visible — the folded ones stay REACHABLE.
    const api = await installGraphApi(page);
    const DEPTH_IDS = ["timeline-d1", "timeline-d2", "timeline-d3", "timeline-d4"];
    const TITLES = ["Depth One", "Depth Two", "Depth Three", "Depth Four"];
    // project → d1 → d2 → d3 → d4
    api.documents.get(PROJECT_ID)!.clips.push(
      collectionClip("clip-d1", DEPTH_IDS[0], 9, TITLES[0], 1),
    );
    DEPTH_IDS.forEach((id, index) => {
      const child = DEPTH_IDS[index + 1];
      api.documents.set(id, {
        id,
        title: TITLES[index],
        clips: child
          ? [collectionClip(`clip-${child}`, child, 0, TITLES[index + 1], 1)]
          : [mediaClip("deep-leaf", "image", 0, 4)],
      });
    });

    await page.goto(`${GRAPH_URL}/${DEPTH_IDS.join("/")}?surface=strip`);
    await expect(strip(page, DEPTH_IDS[3])).toBeVisible({ timeout: 30000 });

    const trail = page.getByRole("navigation", { name: "Timeline focus path" });
    const overflow = trail.locator("[data-graph-crumb-overflow]");

    // Three ancestors (d1, d2, d3) is past the threshold: the first two fold.
    await expect(overflow).toBeVisible();
    await expect(overflow).toHaveAttribute("aria-label", /2 hidden timelines/i);
    await expect(trail.getByRole("link", { name: TITLES[0] })).toHaveCount(0);
    await expect(trail.getByRole("link", { name: TITLES[1] })).toHaveCount(0);
    // Kept: the root crumb, the immediate parent, and the focused crumb.
    await expect(trail.getByRole("link", { name: "E2E Project" })).toBeVisible();
    await expect(trail.getByRole("link", { name: TITLES[2] })).toBeVisible();
    await expect(trail).toContainText(TITLES[3]);

    // The folded levels are reachable: open the menu and navigate to one.
    await overflow.click();
    const hidden = page.getByRole("menuitem", { name: TITLES[1] });
    await expect(hidden).toBeVisible();
    await hidden.click();
    await page.waitForURL(`**${GRAPH_URL}/${DEPTH_IDS[0]}/${DEPTH_IDS[1]}`);

    // Two ancestors left — under the threshold, so nothing folds now.
    await expect(trail.locator("[data-graph-crumb-overflow]")).toHaveCount(0);
    await expect(trail.getByRole("link", { name: TITLES[0] })).toBeVisible();
  });

  test("scrubbing across an empty collection keeps the playhead under the pointer", async ({
    page,
  }) => {
    // PL9-005. An empty collection is WIDTH with no TIME, so every x across it
    // maps to one instant — and a playhead driven by that instant can only
    // paint at one edge while the pointer crosses the rest.
    const api = await installGraphApi(page);
    const EMPTY_ID = "timeline-e2e-empty";
    api.documents.get(PROJECT_ID)!.clips.push(
      collectionClip("clip-empty", EMPTY_ID, 9, "Nothing Here", 0),
      // Trailing content so the empty card is not the LAST thing in the
      // strip: parked at the timeline's end it sits in the rail's edge
      // auto-pan zone, and the content sliding under a stationary pointer
      // moves the line's viewport x backwards — the pan working correctly,
      // but indistinguishable here from the bug under test.
      mediaClip("tail-1", "image", 10, 4),
      mediaClip("tail-2", "image", 11, 4),
    );
    api.documents.set(EMPTY_ID, { id: EMPTY_ID, title: "Nothing Here", clips: [] });
    await openGraph(page);
    await previewToggle(page).click();

    const emptyCard = strip(page, PROJECT_ID).locator(`[data-node-id="${EMPTY_ID}"]`);
    await emptyCard.scrollIntoViewIfNeeded();
    await expect(emptyCard).toBeVisible();
    // Centre it, so neither end of the crossing lands in the pan zone.
    await strip(page, PROJECT_ID).evaluate((el, id) => {
      const card = el.querySelector(`[data-node-id="${id}"]`) as HTMLElement | null;
      if (card) el.scrollLeft += card.getBoundingClientRect().left
        - el.getBoundingClientRect().left
        - (el.clientWidth - card.getBoundingClientRect().width) / 2;
    }, EMPTY_ID);
    const card = (await emptyCard.boundingBox())!;
    const rail = page.getByRole("slider", { name: "Seek preview" }).first();
    const railBox = (await rail.boundingBox())!;
    const line = page.locator("[data-graph-playhead]").first();
    const y = railBox.y + railBox.height / 2;

    // Press at the empty card's left edge, then walk across it.
    await page.mouse.move(card.x + 2, y);
    await page.mouse.down();
    const samples: number[] = [];
    for (const fraction of [0.25, 0.5, 0.75, 0.95]) {
      await page.mouse.move(card.x + card.width * fraction, y, { steps: 4 });
      const lineBox = (await line.boundingBox())!;
      samples.push(lineBox.x);
    }
    await page.mouse.up();

    // The line tracked the pointer across the card instead of pinning to one
    // edge: each sample is further right than the last, and the last one is
    // near the card's far side rather than back at its start.
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]).toBeGreaterThan(samples[i - 1]);
    }
    expect(samples[samples.length - 1]).toBeGreaterThan(card.x + card.width * 0.6);
  });

  test("the GRID playhead also stays under the pointer over an empty collection", async ({
    page,
  }) => {
    // PL9-005's other half: `buildGridPlayheadMap.posAt` collapses a
    // zero-duration CELL exactly as the strip map collapses a zero-width span.
    const api = await installGraphApi(page);
    const EMPTY_ID = "timeline-e2e-empty-grid";
    api.documents.get(PROJECT_ID)!.clips.push(
      collectionClip("clip-empty-grid", EMPTY_ID, 9, "Nothing Here", 0),
    );
    api.documents.set(EMPTY_ID, { id: EMPTY_ID, title: "Nothing Here", clips: [] });
    await page.goto(GRAPH_URL);
    await expect(page.locator(`[data-virtual-grid="${PROJECT_ID}"]`)).toBeVisible();
    await previewToggle(page).click();

    const emptyCell = page
      .locator(`[data-virtual-grid="${PROJECT_ID}"] [data-node-id="${EMPTY_ID}"]`);
    await expect(emptyCell).toBeVisible();
    const cell = (await emptyCell.boundingBox())!;
    // The rail for the row the empty cell is in.
    const rails = page.locator("[data-graph-seek-rail]");
    const railCount = await rails.count();
    let rail = rails.first();
    for (let i = 0; i < railCount; i++) {
      const box = (await rails.nth(i).boundingBox())!;
      if (box.y < cell.y && box.y > cell.y - 60) rail = rails.nth(i);
    }
    const railBox = (await rail.boundingBox())!;
    // The grid's marker is its own element — the strip's [data-graph-playhead]
    // does not exist here.
    const line = page.locator("[data-graph-grid-playhead]").first();
    const y = railBox.y + railBox.height / 2;

    await page.mouse.move(cell.x + 2, y);
    await page.mouse.down();
    const samples: number[] = [];
    for (const fraction of [0.3, 0.6, 0.9]) {
      await page.mouse.move(cell.x + cell.width * fraction, y, { steps: 4 });
      samples.push((await line.boundingBox())!.x);
    }
    await page.mouse.up();

    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]).toBeGreaterThan(samples[i - 1]);
    }
    expect(samples[samples.length - 1]).toBeGreaterThan(cell.x + cell.width * 0.5);
  });

  test("every surface ends with an add-timeline slot that appends there", async ({ page }) => {
    // PL9-001. The sidebar tool lands next to the SELECTION; this appends to
    // the surface it sits in, which is what "one more, at the end" means.
    const api = await installGraphApi(page);
    await openGraph(page);
    await expandSubGraph(page, "Scene A");
    await expect.poll(() => stripOrder(page, CHILD_ID), { timeout: 15000 }).toEqual(["c1", "c2"]);

    // One per surface: the focused strip and the expanded child's strip.
    await expect(page.locator("[data-add-collection-slot]")).toHaveCount(2);

    // It is NOT an item — the surfaces still report only their real cards.
    expect(await stripOrder(page, PROJECT_ID)).toEqual(["alpha", "bravo", CHILD_ID, "charlie"]);

    // Selecting a card elsewhere must not steer where it lands.
    await strip(page, PROJECT_ID).locator('[data-node-id="alpha"]').click();
    await expect(strip(page, PROJECT_ID).locator('[data-node-id="alpha"]')).toHaveAttribute(
      "data-selected",
      "true",
    );

    // Append into the CHILD's strip: it lands last there, and the project is
    // untouched.
    await page
      .locator(`[data-add-collection-slot="${CHILD_ID}"]`)
      .click();
    await expect
      .poll(() => stripOrder(page, CHILD_ID), { timeout: 10000 })
      .toEqual(["c1", "c2", expect.stringMatching(/^timeline-/)]);
    expect(await stripOrder(page, PROJECT_ID)).toEqual([
      "alpha",
      "bravo",
      CHILD_ID,
      "charlie",
    ]);

    // It persists like any other insert, and undo takes it back.
    await expect
      .poll(() => api.patchesFor(CHILD_ID).at(-1)?.clipIds?.length, { timeout: 10000 })
      .toBe(3);
    await undoButton(page).click();
    await expect.poll(() => stripOrder(page, CHILD_ID)).toEqual(["c1", "c2"]);
  });

  test("a scrub drag shows the timestamp at the playhead, and only then", async ({ page }) => {
    // PL9-003. The transport's clock is up in the preview chrome; mid-drag the
    // number has to be where the pointer is.
    await installGraphApi(page);
    await openGraph(page);
    await previewToggle(page).click();
    const rail = page.getByRole("slider", { name: "Seek preview" }).first();
    await expect(rail).toBeVisible();
    const readout = page.locator("[data-rail-time]");

    // Not on hover, and not while parked.
    await rail.hover();
    await expect(readout).toHaveCount(0);

    const box = (await rail.boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.25, box.y + box.height / 2);
    await page.mouse.down();
    await expect(readout).toHaveCount(1);
    const atQuarter = await readout.textContent();
    expect(atQuarter).toMatch(/^\d+(\.\d+)?s$/);

    // It tracks the drag: further along the rail reads a later time.
    await page.mouse.move(box.x + box.width * 0.75, box.y + box.height / 2, { steps: 8 });
    await expect
      .poll(async () => Number.parseFloat((await readout.textContent()) ?? "0"))
      .toBeGreaterThan(Number.parseFloat(atQuarter ?? "0"));

    // It rides WITH the thumb rather than sitting in a fixed corner.
    const thumbBox = (await page.locator("[data-rail-thumb]").first().boundingBox())!;
    const readoutBox = (await readout.boundingBox())!;
    expect(Math.abs(readoutBox.x + readoutBox.width / 2 - (thumbBox.x + thumbBox.width / 2)))
      .toBeLessThan(40);
    // ABOVE the thumb (PL11-013), not below it: the pointer is on the rail,
    // so a label underneath sits behind the user's own hand. It clears the
    // thumb entirely rather than merely being higher-centred.
    expect(readoutBox.y + readoutBox.height).toBeLessThanOrEqual(thumbBox.y + 1);

    // Gone on release.
    await page.mouse.up();
    await expect(readout).toHaveCount(0);
  });

  test("hovering a child row's folder calls out its collection card", async ({ page }) => {
    // PL9-002, revising PL8-012: ONE direction now, and the card is called out
    // by an animation rather than its icon changing. PL10-001 made that
    // animation an elastic SCALE on the card itself (the old inset glow
    // overlay is gone), so the marker moved onto the card.
    await installGraphApi(page);
    await openGraph(page); // children timelines on
    const cardIcon = page.getByRole("button", { name: "Open Scene A" }).first();
    const rowFolder = page
      .locator('section[aria-label="Sub-timeline: Scene A"]')
      .getByRole("button", { name: "Expand" })
      .first();
    const calledOut = page.locator(".is-called-out-card");

    await expect(calledOut).toHaveCount(0);

    // A NEIGHBOUR card, to prove the call-out moves nothing but itself, and
    // the called-out card's own resting box to compare against afterwards.
    const neighbour = strip(page, PROJECT_ID).locator('[data-node-id="alpha"]');
    const card = strip(page, PROJECT_ID).locator(`[data-node-id="${CHILD_ID}"]`);
    const neighbourBefore = (await neighbour.boundingBox())!;
    const cardBefore = (await card.boundingBox())!;

    // Row folder → the matching card, and only that one.
    await rowFolder.hover();
    await expect(calledOut).toHaveCount(1);
    const inCard = await calledOut.evaluate((el) =>
      el.closest("[data-node-wrapper]")?.querySelector("[data-node-id]")?.getAttribute("data-node-id"),
    );
    expect(inCard).toBe(CHILD_ID);

    // The class is not the point — the KEYFRAMES are. Assert the card is
    // actually running them, and that they scale it (an animation whose name
    // resolves but whose rule was renamed away would still pass on class
    // presence alone).
    const running = await calledOut.evaluate((el) => {
      const style = getComputedStyle(el);
      return {
        name: style.animationName,
        scales: el.getAnimations().some((animation) =>
          (animation as CSSAnimation).animationName === "collection-paired-callout",
        ),
      };
    });
    expect(running.name).toBe("collection-paired-callout");
    expect(running.scales).toBe(true);

    // It is a TRANSFORM, so it reflows nothing: the neighbour must not budge
    // while the called-out card is mid-animation. (The called-out card's own
    // box does change under the scale — that is the effect, and measuring it
    // mid-flight would only race the keyframes.)
    const neighbourDuring = (await neighbour.boundingBox())!;
    expect(neighbourDuring.x).toBeCloseTo(neighbourBefore.x, 0);
    expect(neighbourDuring.width).toBeCloseTo(neighbourBefore.width, 0);

    // PL10-002: a flick still plays the whole animation. The pointer is gone
    // and the call-out is still on the card — without the hold it would be
    // torn off mid-keyframe, one or two frames in.
    await page.mouse.move(0, 0);
    expect(await calledOut.count()).toBe(1);

    // ...and then it ends on its own.
    await expect(calledOut).toHaveCount(0);
    // And the card comes back to exactly the box it started in.
    const cardAfter = (await card.boundingBox())!;
    const neighbourAfter = (await neighbour.boundingBox())!;
    expect(neighbourAfter.x).toBeCloseTo(neighbourBefore.x, 0);
    expect(cardAfter.x).toBeCloseTo(cardBefore.x, 0);
    expect(cardAfter.width).toBeCloseTo(cardBefore.width, 0);

    // The reverse direction is GONE: hovering the card touches nothing.
    await cardIcon.hover();
    await expect(calledOut).toHaveCount(0);
    await expect(rowFolder).not.toHaveAttribute("data-collection-paired", "true");

    // And with the tree hidden there is no row to hover from at all.
    await page.mouse.move(0, 0);
    await page.getByRole("button", { name: "Hide children timelines" }).click();
    await expect(page.locator('section[aria-label^="Sub-timeline"]')).toHaveCount(0);
    await expect(calledOut).toHaveCount(0);
  });

  test("the trim view opens as a modal and hands the hero name back", async ({ page }) => {
    // PL10-008. Trimming moved into a modal the card grows into, so the board
    // stops competing with it. The load-bearing invariant is the view
    // transition's: exactly ONE element may carry the shared
    // `view-transition-name` at a time — leave it on both and the browser
    // silently skips the morph on the NEXT open, which looks like nothing at
    // all rather than like a bug.
    await installGraphApi(page);
    await openGraph(page);

    const alpha = strip(page, PROJECT_ID).locator('[data-node-id="alpha"]');
    await expect(async () => {
      await alpha.click();
      await expect(alpha).toHaveAttribute("data-selected", "true", { timeout: 700 });
    }).toPass({ timeout: 10000 });
    await expect(page.locator("[data-item-details]")).toHaveCount(0);

    const heroCount = () =>
      page.evaluate(
        () =>
          [...document.querySelectorAll<HTMLElement>("*")].filter(
            (el) => el.style?.viewTransitionName === "trim-subject",
          ).length,
      );
    expect(await heroCount()).toBe(0);

    await openItemDetails(page, "alpha");
    const modal = page.getByRole("dialog");
    await expect(modal).toHaveCount(1);
    // Only the modal's frame holds the name while it is open — the card gave
    // it up in the same frame.
    expect(await heroCount()).toBe(1);
    expect(
      await page.locator("[data-item-details-frame]").evaluate((el) =>
        el instanceof HTMLElement ? el.style.viewTransitionName : "",
      ),
    ).toBe("trim-subject");

    // The whole source is in there, and it is the only map on the page.
    const maps = page.locator("[data-trim-overview]");
    await expect(maps).toHaveCount(1);
    expect(await maps.evaluate((el) => !!el.closest("[data-item-details]"))).toBe(true);
    const windowBox = (await page.locator("[data-trim-overview-window]").boundingBox())!;
    const mapBox = (await maps.boundingBox())!;
    expect(windowBox.width / mapBox.width).toBeCloseTo(6 / 8, 1);

    // The grips trim from in here, at the modal's scale.
    // A view transition holds a SNAPSHOT over the page while it runs, and a
    // snapshot is an image: real input during those ~260ms lands on <html>,
    // not on anything in the modal. Settle it before touching the grips —
    // without this the drag below silently does nothing, which looks exactly
    // like a broken gesture.
    await settleViewTransition(page);

    const grip = page.locator('[data-trim-overview-handle="right"]');
    const gripBox = (await grip.boundingBox())!;
    await page.mouse.move(gripBox.x + gripBox.width / 2, gripBox.y + gripBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(gripBox.x - 40, gripBox.y + gripBox.height / 2, { steps: 6 });
    await expect(page.locator("[data-item-details-edge]")).toHaveCount(1);
    await page.mouse.up();
    await expect
      .poll(async () => (await page.locator("[data-trim-overview-window]").boundingBox())!.width)
      .toBeLessThan(windowBox.width - 5);

    // Escape closes it and the name goes back where it came from — nothing
    // may be left holding it, or the next open has two.
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-item-details]")).toHaveCount(0);
    await expect.poll(heroCount).toBe(0);

    // And it reopens, which is what a stranded name would have broken.
    await openItemDetails(page, "alpha");
    await expect(page.getByRole("dialog")).toHaveCount(1);
    expect(await heroCount()).toBe(1);
  });

  test("closing the modal morphs back to the card, it does not just vanish", async ({ page }) => {
    // PL14-004. Opening grows the card into the modal; closing has to run the
    // same morph in reverse or the modal just disappears, which reads as a
    // different interaction from the one that opened it.
    //
    // Asserted THROUGH the API rather than by watching pixels: a transition
    // that starts and is then skipped looks identical to one that never ran,
    // and `getAnimations()` cannot tell them apart either — the animations only
    // exist after the browser captures a frame. `ready` resolving is the signal
    // that the morph is actually going to play.
    await installGraphApi(page);
    await openGraph(page);

    // View transitions are SKIPPED outright in a hidden document, so a run
    // where this is not "visible" proves nothing in either direction.
    expect(await page.evaluate(() => document.visibilityState)).toBe("visible");

    await openItemDetails(page, "alpha");
    await settleViewTransition(page);

    await page.evaluate(() => {
      const probe: {
        calls: number;
        skipped: boolean | null;
        heroHolderAtReady: string | null;
        modalPresentAtCapture: boolean | null;
      } = { calls: 0, skipped: null, heroHolderAtReady: null, modalPresentAtCapture: null };
      (window as unknown as { __closeProbe: typeof probe }).__closeProbe = probe;
      const doc = document as Document & {
        startViewTransition: (cb: () => void) => { ready: Promise<void> };
      };
      const original = doc.startViewTransition.bind(doc);
      doc.startViewTransition = (callback: () => void) => {
        probe.calls += 1;
        // THE assertion. The browser captures the "before" frame when this is
        // called, and the callback is what removes the modal — so the modal has
        // to still be here right now. If it unmounted on an earlier render, a
        // transition still runs and still resolves, but it has nothing to morph
        // FROM and the close reads as a hard cut.
        probe.modalPresentAtCapture = !!document.querySelector("[data-item-details]");
        const transition = original(callback);
        transition.ready.then(
          () => {
            probe.skipped = false;
            // By `ready` the callback has run, so whoever holds the name now
            // is what the modal is morphing INTO.
            const holder = [...document.querySelectorAll<HTMLElement>("*")].find(
              (el) => el.style?.viewTransitionName === "trim-subject",
            );
            probe.heroHolderAtReady =
              holder?.closest("[data-node-id]")?.getAttribute("data-node-id") ?? null;
          },
          () => {
            probe.skipped = true;
          },
        );
        return transition;
      };
    });

    await page.keyboard.press("Escape");
    await expect(page.locator("[data-item-details]")).toHaveCount(0);

    type CloseProbe = Readonly<{
      calls: number;
      skipped: boolean | null;
      heroHolderAtReady: string | null;
      modalPresentAtCapture: boolean | null;
    }>;
    const probe = await page
      .waitForFunction((): CloseProbe | null => {
        const p = (window as unknown as { __closeProbe: CloseProbe }).__closeProbe;
        return p.calls > 0 && p.skipped !== null ? p : null;
      })
      .then((handle) => handle.jsonValue() as Promise<CloseProbe>);

    // A transition ran, it PLAYED rather than being skipped, the modal was
    // still on screen to be captured, and the thing it played into was alpha's
    // card — the spot the modal came from.
    expect(probe.calls).toBe(1);
    expect(probe.skipped).toBe(false);
    expect(probe.modalPresentAtCapture).toBe(true);
    expect(probe.heroHolderAtReady).toBe("alpha");

    // And nothing is left holding it, so the next open still morphs.
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            [...document.querySelectorAll<HTMLElement>("*")].filter(
              (el) => el.style?.viewTransitionName === "trim-subject",
            ).length,
        ),
      )
      .toBe(0);
  });

  test("item details open from the GRID too, and for a still", async ({ page }) => {
    // PL10-012. Details are not a trimming idea: a grid card has no trim
    // handles at all, and an image has no source window — but both have a
    // name, a duration, and whatever an item grows next. Both open the view.
    await installGraphApi(page);
    await page.goto(`${GRAPH_URL}?surface=grid`);
    await expect(page.locator(`[data-virtual-grid="${PROJECT_ID}"]`)).toHaveCount(1);

    // bravo is an IMAGE, and we are in the grid — the two things the old
    // trim-only toggle refused.
    const bravo = page.locator('[data-node-id="bravo"]');
    // No control on the card at all now (PL13-009): details is an item action
    // in the rail, so the card carries nothing for it. This assertion used to
    // be a reveal dance (idle → hover → away → focus), then a flat "visible at
    // rest" when card controls became permanent — and it is now the absence
    // that matters, because a standing mark on every card for a rarely-opened
    // view was what sent this to the rail.
    await expect(page.locator("[data-item-details-trigger]")).toHaveCount(0);

    // Opening still selects the card — from the rail it is the selection that
    // names the item, so the board's readouts and the view cannot disagree.
    await openItemDetails(page, "bravo");
    await expect(bravo).toHaveAttribute("data-selected", "true");

    const details = page.getByRole("dialog");
    await expect(details).toHaveCount(1);
    await expect(details).toContainText("bravo");
    // A still: its own image, no source map, and the duration it holds.
    await expect(page.locator("[data-trim-overview]")).toHaveCount(0);
    await expect(details).toContainText("still");
    await expect(details.locator("img")).toHaveCount(1);

    // The name is editable here as well — the point of the view generalizing.
    // One click, like the breadcrumb crumb (PL14-010).
    await details.getByRole("button", { name: "Rename bravo" }).click();
    const editor = page.getByRole("textbox", { name: "Clip name" });
    await editor.fill("Establishing shot");
    await editor.press("Enter");
    await expect(details).toContainText("Establishing shot");

    await page.keyboard.press("Escape");
    await expect(page.locator("[data-item-details]")).toHaveCount(0);

    // Keyboard reachable — through the RAIL now (PL13-009). The card used to
    // carry a trigger as the tab stop after itself; details moved off the card,
    // so the route is the one every other item action already uses: select,
    // then the contextual cluster.
    //
    // What is worth asserting is the half that CHANGED: the control is an
    // ordinary focusable button that opens on Enter, with no pointer involved.
    // Selecting is done by click here rather than by Space — Space-selects-a-
    // card is the package's own grammar with its own coverage, and threading it
    // through a modal close and a re-render made this test flaky about
    // something it was not testing.
    await expect(async () => {
      await bravo.click();
      await expect(bravo).toHaveAttribute("data-selected", "true", { timeout: 700 });
    }).toPass({ timeout: 10000 });
    const edit = page.getByRole("button", { name: "Edit", exact: true });
    await edit.focus();
    await expect(edit).toBeFocused();
    await page.keyboard.press("Enter");
    await settleViewTransition(page);
    await expect(page.getByRole("dialog")).toHaveCount(1);
  });

  test("F2 renames a media card in place", async ({ page }) => {
    // PL11-005. Naming a run of similar-looking clips should be arrow → F2 →
    // type → Enter → arrow. The editor is a SIBLING of NodeCard, because that
    // shell is a <button> and an <input> inside it is invalid content.
    const api = await installGraphApi(page);
    await openGraph(page);

    const alpha = strip(page, PROJECT_ID).locator('[data-node-id="alpha"]');
    await expect(async () => {
      await alpha.click();
      await expect(alpha).toHaveAttribute("data-selected", "true", { timeout: 700 });
    }).toPass({ timeout: 10000 });

    // No label yet: nobody has named it.
    await expect(strip(page, PROJECT_ID).locator('[data-node-id="alpha"] [data-clip-title]'))
      .toHaveCount(0);

    await alpha.focus();
    await page.keyboard.press("F2");
    const editor = page.getByRole("textbox", { name: "Clip name" });
    await expect(editor).toBeFocused();
    await editor.fill("Jake looks up");
    await editor.press("Enter");

    // The card carries it, and so does the stored document — as `title`.
    await expect(
      strip(page, PROJECT_ID).locator('[data-node-wrapper="alpha"] [data-clip-title]'),
    ).toHaveText("Jake looks up");
    await expect
      .poll(
        () => api.documents.get(PROJECT_ID)?.clips.find((clip) => clip.id === "alpha")?.title,
        { timeout: 5000 },
      )
      .toBe("Jake looks up");

    // Escape abandons an edit rather than committing it.
    await alpha.focus();
    await page.keyboard.press("F2");
    const second = page.getByRole("textbox", { name: "Clip name" });
    await second.fill("Discarded");
    await second.press("Escape");
    await expect(
      strip(page, PROJECT_ID).locator('[data-node-wrapper="alpha"] [data-clip-title]'),
    ).toHaveText("Jake looks up");
  });

  test("typed in/out points trim exactly", async ({ page }) => {
    // PL11-006. A pixel is worth ~0.11s in the details view and more on the
    // board, so an exact edge was unreachable by pointer. Typed fields
    // dispatch the SAME update-media the grips do.
    const api = await installGraphApi(page);
    await openGraph(page);

    // alpha: 6s showing of an 8s source, so in 0.00 → out 6.00.
    const alpha = strip(page, PROJECT_ID).locator('[data-node-id="alpha"]');
    await expect(async () => {
      await alpha.click();
      await expect(alpha).toHaveAttribute("data-selected", "true", { timeout: 700 });
    }).toPass({ timeout: 10000 });
    await openItemDetails(page, "alpha");

    const inField = page.locator('[data-trim-field="in"]');
    const outField = page.locator('[data-trim-field="out"]');
    await expect(inField).toHaveValue("0.00");
    await expect(outField).toHaveValue("6.00");

    await inField.fill("1.37");
    await inField.press("Enter");
    await expect.poll(
      () => api.documents.get(PROJECT_ID)?.clips.find((c) => c.id === "alpha")?.trimIn,
      { timeout: 5000 },
    ).toBeCloseTo(1.37, 2);

    await outField.fill("4.2");
    await outField.press("Enter");
    await expect.poll(
      () => api.documents.get(PROJECT_ID)?.clips.find((c) => c.id === "alpha")?.trimOut,
      { timeout: 5000 },
    ).toBeCloseTo(3.8, 2);
    // 4.2 − 1.37, exactly — the point of typing it.
    await expect.poll(
      () => api.documents.get(PROJECT_ID)?.clips.find((c) => c.id === "alpha")?.duration,
      { timeout: 5000 },
    ).toBeCloseTo(2.83, 2);

    // Nonsense is CLAMPED, not refused: an out point before the in point is a
    // typo, and snapping is faster to correct than an error message.
    await outField.fill("0.1");
    await outField.press("Enter");
    await expect.poll(async () => Number(await outField.inputValue())).toBeGreaterThan(1.37);

    // Escape abandons an edit rather than committing it.
    const committed = await inField.inputValue();
    await inField.fill("9.99");
    await inField.press("Escape");
    await expect(inField).toHaveValue(committed);
  });

  test("? opens the shortcuts sheet, and typing never does", async ({ page }) => {
    // PL11-007. Hold-to-drag, O, F2 and the whole Alt layer are invisible
    // without this.
    await installGraphApi(page);
    await openGraph(page);

    const sheet = page.locator("[data-graph-shortcuts]");
    await expect(sheet).toHaveCount(0);

    await page.keyboard.press("?");
    await expect(sheet).toHaveCount(1);
    // A sample of rows, each of which corresponds to a real handler.
    await expect(sheet).toContainText("Undo");
    await expect(sheet).toContainText("Rename in place");
    await expect(sheet).toContainText("Slide the source window, same duration");

    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);

    // Not while typing: a "?" in the rename field is a question mark.
    const alpha = strip(page, PROJECT_ID).locator('[data-node-id="alpha"]');
    await expect(async () => {
      await alpha.click();
      await expect(alpha).toHaveAttribute("data-selected", "true", { timeout: 700 });
    }).toPass({ timeout: 10000 });
    await alpha.focus();
    await page.keyboard.press("F2");
    const editor = page.getByRole("textbox", { name: "Clip name" });
    await editor.fill("What?");
    await expect(sheet).toHaveCount(0);
    await expect(editor).toHaveValue("What?");
    await editor.press("Escape");
  });

  test("undo survives a reload", async ({ page }) => {
    // PL11-008. The app autosaves and history lived only in memory, so a
    // refresh made every committed mistake permanent. The stack is written to
    // sessionStorage and restored on boot; `undo` still verifies each entry
    // against the live graph, so a stale one is refused rather than applied.
    await installGraphApi(page);
    await openGraph(page);

    const alpha = strip(page, PROJECT_ID).locator('[data-node-id="alpha"]');
    await expect(async () => {
      await alpha.click();
      await expect(alpha).toHaveAttribute("data-selected", "true", { timeout: 700 });
    }).toPass({ timeout: 10000 });
    await openItemDetails(page, "alpha");

    // A typed trim is the cleanest edit to assert on: exact, and one commit.
    const inField = page.locator('[data-trim-field="in"]');
    await inField.fill("2.00");
    await inField.press("Enter");
    await expect
      .poll(() => page.locator('[data-trim-field="in"]').inputValue(), { timeout: 5000 })
      .toBe("2.00");
    await page.keyboard.press("Escape");

    // Reload: in memory this stack would be gone.
    await page.reload();
    await strip(page, PROJECT_ID)
      .locator('[data-node-id="alpha"]')
      .waitFor({ state: "visible", timeout: 30000 });

    await page.keyboard.press("Control+z");

    // Back to where it started, in the graph AND on the way to the server.
    await expect(async () => {
      await strip(page, PROJECT_ID).locator('[data-node-id="alpha"]').click();
      await expect(strip(page, PROJECT_ID).locator('[data-node-id="alpha"]'))
        .toHaveAttribute("data-selected", "true", { timeout: 700 });
    }).toPass({ timeout: 10000 });
    await openItemDetails(page, "alpha");
    await expect.poll(() => page.locator('[data-trim-field="in"]').inputValue(), {
      timeout: 5000,
    }).toBe("0.00");
  });

  test("without hover, the details trigger stays visible", async ({ browser }) => {
    // PL11-011. The trigger hides itself until the card is hovered — which on
    // a touch device means it hides forever, and it is the only way into the
    // details view. The HIDING is therefore gated on hover existing at all.
    //
    // A real touch CONTEXT, not `Emulation.setEmulatedMedia`: that API leaves
    // `(hover: hover)` matching in this Chromium, so it would have proved
    // nothing. `hasTouch` drives the same device emulation a phone gets, and
    // the media query answers accordingly.
    const context = await browser.newContext({ hasTouch: true, isMobile: true });
    const page = await context.newPage();
    try {
      await installGraphApi(page);
      await openGraph(page);

      expect(
        await page.evaluate(() => window.matchMedia("(hover: none)").matches),
      ).toBe(true);

      // The per-card trigger is gone (PL13-009), and with it the failure this
      // test was written for: a control that hid until hover was unreachable
      // where hover does not exist. What still needs guarding is the ROUTE —
      // select, then Edit — working on a device that cannot hover, since the
      // rail is now the only way in.
      await expect(page.locator("[data-item-details-trigger]")).toHaveCount(0);

      await page.locator('[data-node-id="alpha"]').first().tap();
      const edit = page.getByRole("button", { name: "Edit", exact: true });
      await expect(edit).toBeEnabled();
      await edit.tap();
      await expect(page.getByRole("dialog")).toHaveCount(1);
    } finally {
      await context.close();
    }
  });

  test("a collection opens its own details view", async ({ page }) => {
    // PL11-012. Drilling in already answers "what is in here", so this answers
    // what you would otherwise drill in and back out to learn: how much is
    // inside, how long it runs, whether it is loaded — plus a rename.
    const api = await installGraphApi(page);
    await openGraph(page);

    const details = page.locator("[data-item-details]");
    await expect(details).toHaveCount(0);

    await openItemDetails(page, CHILD_ID);
    await expect(details).toHaveCount(1);
    await expect(details).toHaveAttribute("data-item-details-kind", "collection");
    await expect(details).toContainText("Scene A");
    // Its facts, not a clip's: no trim fields anywhere in here.
    await expect(page.locator("[data-trim-field]")).toHaveCount(0);
    await expect(details).toContainText("items");

    // Rename lands the same way it does from the card — through the child
    // document's title, which is the source of truth for a collection's name.
    await details.getByRole("button", { name: "Rename Scene A" }).click();
    const editor = page.getByRole("textbox", { name: "Timeline name" });
    await editor.fill("Opening beat");
    await editor.press("Enter");
    await expect(details).toContainText("Opening beat");
    await expect
      .poll(() => api.documents.get(CHILD_ID)?.title, { timeout: 5000 })
      .toBe("Opening beat");

    // And it can hand off to the thing it describes.
    await page.locator("[data-item-details-open]").click();
    await expect(details).toHaveCount(0);
    await page.waitForURL(`**${GRAPH_URL}/${CHILD_ID}`);
  });

  test("the header says whether the work is saved", async ({ page }) => {
    // PL11-003. The app autosaves on a 900ms debounce and used to say nothing
    // about it — and undo history dies on reload, so "did that save?" is a
    // question with consequences.
    await installGraphApi(page);
    await openGraph(page);

    const status = page.locator("[data-save-status]");
    // Nothing written yet: no claim either way.
    await expect(status).toHaveCount(0);

    // Any edit puts it into flight. A trim commits on release.
    const alpha = strip(page, PROJECT_ID).locator('[data-node-id="alpha"]');
    const wrapper = strip(page, PROJECT_ID).locator('[data-node-wrapper="alpha"]');
    await expect(async () => {
      await alpha.click();
      await expect(alpha).toHaveAttribute("data-selected", "true", { timeout: 700 });
    }).toPass({ timeout: 10000 });
    const handle = wrapper.locator("[data-trim-handle]").last();
    const handleBox = (await handle.boundingBox())!;
    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(handleBox.x - 30, handleBox.y + handleBox.height / 2, { steps: 6 });
    await page.mouse.up();

    // "Saving…" covers both halves of the write path — the debounce window and
    // the batch in flight — so the poll is on the STATE, not on catching a
    // particular instant of it.
    await expect.poll(() => status.getAttribute("data-save-status"), { timeout: 3000 })
      .toBe("saving");
    await expect.poll(() => status.getAttribute("data-save-status"), { timeout: 8000 })
      .toBe("saved");
    await expect(status).toContainText("Saved");

    // It OWNS the centre slot while it speaks: the clip/duration readout is
    // displaced, not pushed aside, and comes back when the flash ends.
    await expect(page.locator("[data-focused-aggregate], [data-selection-summary]"))
      .toHaveCount(0);
    await expect(status).toHaveCount(0, { timeout: 6000 });
    await expect(page.locator("[data-selection-summary]")).toHaveCount(1);
  });

  test("ctrl+z undoes and ctrl+shift+z redoes from the keyboard", async ({ page }) => {
    // PL10-009. Undo/redo had NO keyboard binding — only the toolbar buttons,
    // which is fine until something covers them (the trim modal) or the page
    // scrolls them away.
    await installGraphApi(page);
    await openGraph(page);

    const alpha = strip(page, PROJECT_ID).locator('[data-node-id="alpha"]');
    const wrapper = strip(page, PROJECT_ID).locator('[data-node-wrapper="alpha"]');
    await expect(async () => {
      await alpha.click();
      await expect(alpha).toHaveAttribute("data-selected", "true", { timeout: 700 });
    }).toPass({ timeout: 10000 });

    const widthNow = async () => (await alpha.boundingBox())!.width;
    const original = await widthNow();

    // Trim the out edge in, which commits on release.
    const handle = wrapper.locator("[data-trim-handle]").last();
    const handleBox = (await handle.boundingBox())!;
    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(handleBox.x - 40, handleBox.y + handleBox.height / 2, { steps: 6 });
    await page.mouse.up();
    await expect.poll(widthNow).toBeLessThan(original - 10);
    const trimmed = await widthNow();

    await page.keyboard.press("Control+z");
    await expect.poll(widthNow).toBeCloseTo(original, 0);

    await page.keyboard.press("Control+Shift+z");
    await expect.poll(widthNow).toBeCloseTo(trimmed, 0);

    // Ctrl+Y is the Windows spelling of redo; after an undo it must land the
    // same way.
    await page.keyboard.press("Control+z");
    await expect.poll(widthNow).toBeCloseTo(original, 0);
    await page.keyboard.press("Control+y");
    await expect.poll(widthNow).toBeCloseTo(trimmed, 0);
  });

  test("the modal's undo is scoped to this clip's own trims", async ({ page }) => {
    // PL10-009. History is global and linear, so a bare undo in a modal would
    // reach past the scrim — undoing something on the board that the user
    // cannot see. These step back through THIS clip's trims and then stop.
    await installGraphApi(page);
    await openGraph(page);

    // An edit on a DIFFERENT node first: this is what the modal's undo must
    // refuse to touch.
    const bravo = strip(page, PROJECT_ID).locator('[data-node-id="bravo"]');
    const bravoWrapper = strip(page, PROJECT_ID).locator('[data-node-wrapper="bravo"]');
    await expect(async () => {
      await bravo.click();
      await expect(bravo).toHaveAttribute("data-selected", "true", { timeout: 700 });
    }).toPass({ timeout: 10000 });
    const bravoHandle = bravoWrapper.locator("[data-trim-handle]").last();
    const bravoBox = (await bravoHandle.boundingBox())!;
    await page.mouse.move(bravoBox.x + bravoBox.width / 2, bravoBox.y + bravoBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(bravoBox.x - 30, bravoBox.y + bravoBox.height / 2, { steps: 6 });
    await page.mouse.up();
    const bravoWidth = (await bravo.boundingBox())!.width;

    const alpha = strip(page, PROJECT_ID).locator('[data-node-id="alpha"]');
    await expect(async () => {
      await alpha.click();
      await expect(alpha).toHaveAttribute("data-selected", "true", { timeout: 700 });
    }).toPass({ timeout: 10000 });
    await openItemDetails(page, "alpha");

    const undo = page.locator("[data-item-details-undo]");
    const redo = page.locator("[data-item-details-redo]");
    // The newest entry is bravo's trim, not this clip's — so undo is offered
    // for nothing, even though the store itself can undo.
    await expect(undo).toBeDisabled();
    await expect(redo).toBeDisabled();

    // Trim in here, and it lights up.
    const grip = page.locator('[data-trim-overview-handle="right"]');
    const gripBox = (await grip.boundingBox())!;
    const windowWidth = async () =>
      (await page.locator("[data-trim-overview-window]").boundingBox())!.width;
    const before = await windowWidth();
    await page.mouse.move(gripBox.x + gripBox.width / 2, gripBox.y + gripBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(gripBox.x - 40, gripBox.y + gripBox.height / 2, { steps: 6 });
    await page.mouse.up();
    await expect.poll(windowWidth).toBeLessThan(before - 5);
    await expect(undo).toBeEnabled();

    // One press steps that trim back, and then the boundary is reached again:
    // bravo's edit is next in the stack and must stay out of reach.
    await undo.click();
    await expect.poll(windowWidth).toBeCloseTo(before, 0);
    await expect(undo).toBeDisabled();
    await expect(redo).toBeEnabled();
    expect((await bravo.boundingBox())!.width).toBeCloseTo(bravoWidth, 0);

    // Redo puts this clip's trim back, and spends the only redo it had.
    await redo.click();
    await expect.poll(windowWidth).toBeLessThan(before - 5);
    await expect(redo).toBeDisabled();
  });

  test("renaming a clip in the modal reaches the stored document", async ({ page }) => {
    // PL10-010. A media node's name IS the clip's stored `alt` — the adapter
    // reads `name: clip.alt` and writes `alt: detail?.alt ?? node.name`. Every
    // loaded clip has `detail.alt` set, so renaming the GRAPH alone would look
    // right and then be overwritten by the stored alt on the next write. The
    // assertion that matters is therefore on the DOCUMENT, not the header.
    const api = await installGraphApi(page);
    await openGraph(page);

    const alpha = strip(page, PROJECT_ID).locator('[data-node-id="alpha"]');
    await expect(async () => {
      await alpha.click();
      await expect(alpha).toHaveAttribute("data-selected", "true", { timeout: 700 });
    }).toPass({ timeout: 10000 });
    await openItemDetails(page, "alpha");

    const storedClip = () =>
      api.documents.get(PROJECT_ID)?.clips.find((clip) => clip.id === "alpha");
    const storedTitle = () => storedClip()?.title;
    expect(storedTitle()).toBeUndefined();
    expect(storedClip()?.alt).toBe("alpha");

    // Click the name once, type, Enter.
    await page
      .locator("[data-item-details]")
      .getByRole("button", { name: "Rename alpha" })
      .click();
    const editor = page.getByRole("textbox", { name: "Clip name" });
    await expect(editor).toBeVisible();
    await editor.fill("Belushi close-up");
    await editor.press("Enter");

    // The graph took it...
    await expect(page.locator("[data-item-details]")).toContainText("Belushi close-up");
    // ...and so did the write, once the gateway's debounce flushes — as
    // `title`, with `alt` untouched. Renaming a clip must not rewrite the
    // accessibility description derived from its source (PL11-004).
    await expect.poll(storedTitle, { timeout: 5000 }).toBe("Belushi close-up");
    expect(storedClip()?.alt).toBe("alpha");

    // And the card now shows it, because someone chose it. Unnamed cards
    // stay bare — that is what keeps a two-thousand-clip library from
    // reading as a rename backlog.
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-item-details]")).toHaveCount(0);
    await expect(strip(page, PROJECT_ID).locator('[data-node-id="alpha"] [data-clip-title]'))
      .toHaveText("Belushi close-up");
    await expect(strip(page, PROJECT_ID).locator('[data-node-id="bravo"] [data-clip-title]'))
      .toHaveCount(0);
    await openItemDetails(page, "alpha");

    // Escape cancels an edit instead of closing the modal — the capture-phase
    // key handler has to yield to the editor.
    await page
      .locator("[data-item-details]")
      .getByRole("button", { name: "Rename Belushi close-up" })
      .click();
    const reopened = page.getByRole("textbox", { name: "Clip name" });
    await reopened.fill("Discarded");
    await reopened.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await expect(page.locator("[data-item-details]")).toContainText("Belushi close-up");
    expect(storedTitle()).toBe("Belushi close-up");
  });

  test("with the preview OPEN, a trim drag takes the pane instead of floating a panel", async ({
    page,
  }) => {
    // PL14-006, and the other half of round 5's item 3 — deferred then, asked
    // for now. The floating panel exists because there was nowhere else to put
    // the frame; an open preview IS somewhere else, and two copies of the same
    // frame is one too many.
    await installGraphApi(page);
    await openGraph(page);

    // Open the pane BEFORE selecting: the rail swaps to the item-actions
    // cluster while anything is selected, so the preview toggle is not there
    // to click afterwards.
    const canvas = page.getByTestId("workbench-display-canvas");
    await previewToggle(page).click();
    await expect(canvas).toBeVisible();

    const alpha = strip(page, PROJECT_ID).locator('[data-node-id="alpha"]');
    const wrapper = strip(page, PROJECT_ID).locator('[data-node-wrapper="alpha"]');
    await expect(async () => {
      await alpha.click();
      await expect(alpha).toHaveAttribute("data-selected", "true", { timeout: 700 });
    }).toPass({ timeout: 10000 });

    // Where the clock stands before the drag — it must not move.
    const timeBefore = await page.getByTestId("workbench-preview-time").textContent();

    const handle = wrapper.locator("[data-trim-handle]").last();
    const box = (await handle.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x - 24, box.y + box.height / 2, { steps: 6 });

    // The PANE was asked for the frame, and the floating panel stood down.
    // There is no second element anywhere: the pane's own canvas draws this,
    // from the video element it already had cached.
    const surface = page.getByTestId("workbench-display-surface");
    await expect(surface).toHaveAttribute("data-frame-override", "alpha");
    await expect(page.locator("[data-trim-edge-frame]")).toHaveCount(0);
    await expect(page.locator("[data-trim-preview-overlay]")).toHaveCount(0);

    // WHAT THIS DOES NOT PROVE, stated so nobody reads more into it: that the
    // canvas is painting the right frame. Which pixels a canvas holds is not
    // readable back, and this fixture's "video" is a 1x1 GIF data URL that
    // never reaches HAVE_CURRENT_DATA — no frame decodes here at all. The
    // attribute pins the REQUEST reaching the pane; the drawing is the pane's
    // existing, already-covered path (`syncActiveVideo` → `drawActiveFrame`),
    // and the picture itself needs a human with a real video.
    //
    // An earlier version of this test asserted an overlay's bounding box
    // matched the canvas's, which passed while the overlay sat BEHIND the pane
    // at z-30. Geometry is not visibility, and a witness that says "asked" is
    // worth more than one that says "positioned".

    // THE constraint carried over from round 5: the clock does not move while
    // the pane is borrowed. Asserted DURING the gesture, which is the only
    // window where it means anything — releasing commits the trim, and a
    // committed trim changes the timeline's total duration on purpose, so the
    // readout is expected to differ afterwards.
    expect(await page.getByTestId("workbench-preview-time").textContent()).toBe(timeBefore);

    await page.mouse.up();
    // Released, the pane goes back to being the pane — the override clears and
    // the clock owns the picture again.
    await expect(surface).not.toHaveAttribute("data-frame-override", /.*/);
    await expect(canvas).toBeVisible();
  });

  test("a trim drag floats the edge frame above the clip", async ({ page }) => {
    // PL10-005/007. The live frame is its own small surface: sized to the
    // breadcrumb row (a size reference, not a location — it follows the CLIP,
    // which in a nested strip is nowhere near the header) with the edge being
    // dragged pinned to the matching edge of the frame.
    await installGraphApi(page);
    await openGraph(page);

    const alpha = strip(page, PROJECT_ID).locator('[data-node-id="alpha"]');
    const wrapper = strip(page, PROJECT_ID).locator('[data-node-wrapper="alpha"]');
    await expect(async () => {
      await alpha.click();
      await expect(alpha).toHaveAttribute("data-selected", "true", { timeout: 700 });
    }).toPass({ timeout: 10000 });
    await expect(page.locator("[data-trim-edge-frame]")).toHaveCount(0);

    // Drag the OUT edge in. A video shows two handles; the second is the back
    // edge (the first is the front/in edge).
    const handle = wrapper.locator("[data-trim-handle]").last();
    const handleBox = (await handle.boundingBox())!;
    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(handleBox.x - 24, handleBox.y + handleBox.height / 2, { steps: 6 });

    const frame = page.locator('[data-trim-edge-frame="right"]');
    await expect(frame).toHaveCount(1);

    const band = (await page.locator("[data-graph-board-header]").boundingBox())!;
    const frameBox = (await frame.boundingBox())!;
    const cardBox = (await alpha.boundingBox())!;
    // Sized to the breadcrumb row, and 16:9 from that.
    expect(frameBox.height).toBeCloseTo(band.height, 0);
    expect(frameBox.width).toBeCloseTo(Math.round((band.height * 16) / 9), 0);
    // Placed against the CLIP: sitting just above it, not in the header band.
    expect(frameBox.y + frameBox.height).toBeCloseTo(cardBox.y - 8, 0);
    // Out-edge drag: the frame's RIGHT edge rides the clip's right edge.
    expect(frameBox.x + frameBox.width).toBeCloseTo(cardBox.x + cardBox.width, 0);

    await page.mouse.up();
    // It belongs to the gesture, and goes with it.
    await expect(frame).toHaveCount(0);
  });

  test("the call-out's scale never grows a scroll area", async ({ page }) => {
    // PL10-003. A transform that spills past its box counts as SCROLLABLE
    // overflow, so the call-out used to grow whichever scroller held the card
    // and flash a scrollbar for the length of the animation. The card's
    // wrapper is `overflow: clip` (with a margin wide enough for the growth
    // and for the drop bars) so nothing above it ever hears about the scale.
    await installGraphApi(page);
    await openGraph(page);
    const rowFolder = page
      .locator('section[aria-label="Sub-timeline: Scene A"]')
      .getByRole("button", { name: "Expand" })
      .first();

    await rowFolder.hover();
    await expect(page.locator(".is-called-out-card")).toHaveCount(1);

    // Measure every ancestor at rest and at the animation's peak. Pausing the
    // animation is what makes this deterministic — sampling a 320ms one-shot
    // from the test side would race it.
    const changed = await page.evaluate(() => {
      const card = document.querySelector(".is-called-out-card");
      if (!card) return ["no call-out"];
      const animation = card.getAnimations()[0];
      if (!animation) return ["no animation"];
      const chain: Element[] = [];
      // Start ABOVE the clip box itself: a clip container still reports its
      // own scrollWidth, it just stops handing it upward, and that upward
      // propagation is the whole bug.
      for (let n = card.closest("[data-node-wrapper]")?.parentElement; n; n = n.parentElement) {
        chain.push(n);
      }
      const snap = () => chain.map((n) => `${n.scrollWidth}x${n.scrollHeight}`);
      animation.pause();
      animation.currentTime = 0;
      const rest = snap();
      animation.currentTime = 128; // the 1.06 peak
      const peak = snap();
      animation.play();
      return peak.flatMap((size, i) =>
        size === rest[i]
          ? []
          : [`${chain[i].tagName}.${chain[i].className}: ${rest[i]} -> ${size}`],
      );
    });
    expect(changed).toEqual([]);
  });

  test("clicking away anywhere that is not a control clears the selection", async ({
    page,
  }) => {
    // PL8-001. The surfaces already cleared on their own empty space; this is
    // the rest of the screen — the board's padding, the header, the space
    // beside the strip — which left "nothing selected" unreachable unless the
    // user found the right pixel inside a strip.
    await installGraphApi(page);
    await openGraph(page);
    const alpha = strip(page, PROJECT_ID).locator('[data-node-id="alpha"]');
    const header = page.getByRole("navigation", { name: "Timeline focus path" });

    const select = async () => {
      await alpha.click();
      await expect(alpha).toHaveAttribute("data-selected", "true");
    };

    // A CONTROL is an action, not a click-away. The sidebar's Copy button
    // only exists WHILE something is selected, which makes it the sharpest
    // case available: if the click cleared, the button it was on would vanish.
    await select();
    await page.getByRole("button", { name: "Copy", exact: true }).click();
    await expect(alpha).toHaveAttribute("data-selected", "true");

    // A card click still replaces rather than clears.
    const bravo = strip(page, PROJECT_ID).locator('[data-node-id="bravo"]');
    await bravo.click();
    await expect(bravo).toHaveAttribute("data-selected", "true");
    await expect(alpha).not.toHaveAttribute("data-selected", "true");

    // The breadcrumb row's own empty space — chrome, but not a control.
    const headerBox = (await header.boundingBox())!;
    await page.mouse.click(headerBox.x + headerBox.width - 4, headerBox.y + headerBox.height / 2);
    await expect(bravo).not.toHaveAttribute("data-selected", "true");

    // And well outside any surface: the page margin below the board.
    await select();
    const viewport = page.viewportSize()!;
    await page.mouse.click(viewport.width - 8, viewport.height - 8);
    await expect(alpha).not.toHaveAttribute("data-selected", "true");
  });

  test("the children toggle says so when the timeline has no child timelines", async ({
    page,
  }) => {
    // PL7-004: with the toggle on and nothing to show, the board used to
    // render nothing at all, so the control read as broken.
    const api = await installGraphApi(page);
    const project = api.documents.get(PROJECT_ID)!;
    // Media only — no collections, so the tree has no rows to draw.
    project.clips = [mediaClip("alpha", "video", 0, 6, 8), mediaClip("bravo", "image", 1, 4)];
    await page.goto(`${GRAPH_URL}?surface=strip`);
    await strip(page, PROJECT_ID)
      .locator('[data-node-id="alpha"]')
      .waitFor({ state: "visible", timeout: 30000 });

    const empty = page.locator("[data-subtimelines-empty]");
    const childrenToggle = page.getByRole("button", { name: "Show children timelines" });
    // OFF: nothing renders — the empty state belongs to the ON state only.
    await expect(empty).toHaveCount(0);

    await childrenToggle.click();
    await expect(empty).toBeVisible();
    await expect(empty).toContainText(/no child timelines/i);

    // Adding a collection replaces it with the real row, no reload.
    await page.getByRole("button", { name: /add collection/i }).click();
    await expect(empty).toHaveCount(0);
    await expect(page.locator('section[aria-label^="Sub-timeline"]')).toHaveCount(1);

    // Turning the toggle back off leaves neither.
    await page.getByRole("button", { name: "Hide children timelines" }).click();
    await expect(empty).toHaveCount(0);
    await expect(page.locator('section[aria-label^="Sub-timeline"]')).toHaveCount(0);
  });

  test("every drop zone announces itself for the whole native drag", async ({ page }) => {
    // PL7-003: before this, the only feedback was the insertion line, which
    // appears after the pointer has already found a target. Now a droppable
    // drag anywhere on the page outlines every zone, and the one under the
    // pointer is filled in.
    await installGraphApi(page);
    await openGraph(page);
    await expandSubGraph(page, "Scene A");
    await expect.poll(() => stripOrder(page, CHILD_ID), { timeout: 15000 }).toEqual(["c1", "c2"]);

    const zones = page.locator("[data-native-drop]");
    await expect.poll(() => zones.count()).toBeGreaterThan(1);
    const armed = page.locator("[data-native-drop-armed]");
    const hovered = page.locator("[data-native-drop-hovered]");
    await expect(armed).toHaveCount(0);

    // A drag that is over the PAGE but not over any zone: every zone arms,
    // none is hovered. The header is a safe "not a drop zone" target.
    const dragOverPage = () =>
      page.evaluate(() => {
        const transfer = new DataTransfer();
        transfer.setData("application/x-gstudio-type", "collection");
        document.body.dispatchEvent(
          new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: transfer }),
        );
      });
    await dragOverPage();
    const zoneCount = await zones.count();
    await expect(armed).toHaveCount(zoneCount);
    await expect(hovered).toHaveCount(0);

    // Layout must not move as the affordance comes and goes — the ring and
    // tint are drawn outside the box, so the cards keep their coordinates.
    const box = (await page.locator(`[data-native-drop="${PROJECT_ID}"]`).boundingBox())!;

    // Now over one zone specifically: it alone reads hovered.
    await page.locator(`[data-native-drop="${PROJECT_ID}"]`).evaluate((zone, point) => {
      const transfer = new DataTransfer();
      transfer.setData("application/x-gstudio-type", "collection");
      zone.dispatchEvent(
        new DragEvent("dragover", {
          bubbles: true,
          cancelable: true,
          dataTransfer: transfer,
          clientX: point.x,
          clientY: point.y,
        }),
      );
    }, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
    await expect(hovered).toHaveCount(1);
    await expect(armed).toHaveCount(zoneCount);
    const armedBox = (await page.locator(`[data-native-drop="${PROJECT_ID}"]`).boundingBox())!;
    expect(armedBox.x).toBeCloseTo(box.x, 0);
    expect(armedBox.y).toBeCloseTo(box.y, 0);
    expect(armedBox.width).toBeCloseTo(box.width, 0);

    // The drag ending anywhere disarms everything — no residue.
    await page.evaluate(() => window.dispatchEvent(new DragEvent("dragend")));
    await expect(armed).toHaveCount(0);
    await expect(hovered).toHaveCount(0);
  });

  test("a 2xx upload with no usable url adds nothing and says so", async ({ page }) => {
    // The upload SUCCEEDS as far as HTTP is concerned but the body has no
    // url. Because `src` is optional on a media node, this used to commit and
    // persist a sourceless clip with no error shown anywhere.
    const api = await installGraphApi(page);
    await page.route("**/api/timeline-media/upload", (route) =>
      route.fulfill({ json: { pathname: "media/orphan.png" } }),
    );
    await openGraph(page);
    const dropZone = page.locator(`[data-native-drop="${PROJECT_ID}"]`);

    const fileTransfer = await page.evaluateHandle(() => {
      const transfer = new DataTransfer();
      transfer.items.add(
        new File([new Uint8Array([137, 80, 78, 71])], "orphan.png", { type: "image/png" }),
      );
      return transfer;
    });
    await dropZone.dispatchEvent("drop", { dataTransfer: fileTransfer, clientX: 0 });

    // The failure is surfaced in the drop zone's live region...
    await expect(page.locator("[data-native-drop-status]")).toContainText(/could not be uploaded/i);
    // ...and the strip is untouched.
    expect(await stripOrder(page, PROJECT_ID)).toEqual([
      "alpha",
      "bravo",
      CHILD_ID,
      "charlie",
    ]);
    // Nothing was persisted either.
    await page.waitForTimeout(1500); // outlast the write debounce
    expect(api.patchesFor(PROJECT_ID)).toHaveLength(0);
  });

  test("a drop larger than the concurrency limit keeps file order", async ({ page }) => {
    // The pipeline no longer runs every file at once — it runs a bounded pool
    // (MAX_CONCURRENT_MEDIA = 3). Completion order therefore differs from
    // input order, and the nodes must still be added in FILE order. Staggered
    // upload latency makes the difference observable: without order-preserving
    // collection, the slow first file would land last.
    await installGraphApi(page);
    let seen = 0;
    let inFlight = 0;
    let peakInFlight = 0;
    await page.route("**/api/timeline-media/upload", async (route) => {
      const index = seen++;
      inFlight += 1;
      peakInFlight = Math.max(peakInFlight, inFlight);
      // First file is the slowest, so a completion-ordered result would
      // reverse it to the end.
      await new Promise((resolve) => setTimeout(resolve, index === 0 ? 400 : 20));
      inFlight -= 1;
      return route.fulfill({
        json: { pathname: `p-${index}.png`, url: `${PIXEL}#file-${index}` },
      });
    });
    await openGraph(page);
    const dropZone = page.locator(`[data-native-drop="${PROJECT_ID}"]`);

    const fileTransfer = await page.evaluateHandle(() => {
      const transfer = new DataTransfer();
      for (const name of ["f0.png", "f1.png", "f2.png", "f3.png", "f4.png"]) {
        transfer.items.add(
          new File([new Uint8Array([137, 80, 78, 71])], name, { type: "image/png" }),
        );
      }
      return transfer;
    });
    // clientX 0 = insert before the first card, so the batch leads the strip.
    await dropZone.dispatchEvent("drop", { dataTransfer: fileTransfer, clientX: 0 });

    await expect
      .poll(() => stripOrder(page, PROJECT_ID).then((order) => order.length), { timeout: 15000 })
      .toBe(9);

    // The five new cards lead the strip, and their names are in file order.
    const names = await strip(page, PROJECT_ID)
      .locator("[data-node-id]")
      .evaluateAll((els) => els.map((el) => el.getAttribute("aria-label") ?? ""));
    expect(names.slice(0, 5)).toEqual(["f0.png", "f1.png", "f2.png", "f3.png", "f4.png"]);

    // And the pool was actually bounded — this is the half that `Promise.all`
    // would fail, since it preserves order but starts all five at once.
    expect(peakInFlight).toBeLessThanOrEqual(3);
    expect(seen).toBe(5);
  });

  test("dragover measures once per drag session, not once per event", async ({ page }) => {
    // Every accepted dragover used to call getBoundingClientRect on the
    // wrapper AND every mounted card, then setState — forcing layout at the
    // event rate. Geometry is now measured once per session and the indicator
    // is resolved at most once per frame.
    await page.addInitScript(() => {
      const original = Element.prototype.getBoundingClientRect;
      (window as unknown as { __rectCalls: number }).__rectCalls = 0;
      Element.prototype.getBoundingClientRect = function patched() {
        (window as unknown as { __rectCalls: number }).__rectCalls += 1;
        return original.call(this);
      };
    });
    await installGraphApi(page);
    await openGraph(page);
    const dropZone = page.locator(`[data-native-drop="${PROJECT_ID}"]`);
    const box = (await dropZone.boundingBox())!;

    const EVENTS = 40;
    const measured = await page.evaluate(
      async ({ count, left, width }) => {
        const zone = document.querySelector("[data-native-drop]");
        if (!zone) throw new Error("no drop zone");
        const transfer = new DataTransfer();
        transfer.setData("application/x-gstudio-type", "collection");

        const win = window as unknown as { __rectCalls: number };
        win.__rectCalls = 0;
        for (let i = 0; i < count; i++) {
          zone.dispatchEvent(
            new DragEvent("dragover", {
              dataTransfer: transfer,
              bubbles: true,
              cancelable: true,
              clientX: left + (width * i) / count,
              clientY: 0,
            }),
          );
        }
        // Let the coalescing frame(s) run.
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        return win.__rectCalls;
      },
      { count: EVENTS, left: box.x, width: box.width },
    );

    // One pass over a 4-card strip is ~5 reads. The old path did that per
    // event (~200 for 40 events); anything at or below one-per-event is a
    // decisive separation while leaving room for unrelated app measurement.
    expect(measured).toBeLessThan(EVENTS);

    // And it still works: the indicator is showing.
    await expect(page.locator("[data-native-drop-indicator]")).toHaveCount(1);
  });

  test("a slow drop lands at the boundary the user chose, not a stale index", async ({ page }) => {
    // The insertion point is captured at DROP but committed after the upload
    // finishes. If the strip is edited meanwhile, a bare numeric index names
    // a different gap than the one the user dropped into — so the drop is
    // anchored to its neighbouring node ids instead.
    await installGraphApi(page);
    let release: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/api/timeline-media/upload", async (route) => {
      await held; // hold the upload open while we reorder underneath it
      return route.fulfill({ json: { pathname: "p.png", url: PIXEL } });
    });
    await openGraph(page);
    const projectStrip = strip(page, PROJECT_ID);

    // Drop between bravo (index 1) and the child collection (index 2).
    const bravoBox = (await projectStrip.locator('[data-node-id="bravo"]').boundingBox())!;
    const dropX = bravoBox.x + bravoBox.width - 2;
    const fileTransfer = await page.evaluateHandle(() => {
      const transfer = new DataTransfer();
      transfer.items.add(
        new File([new Uint8Array([137, 80, 78, 71])], "late.png", { type: "image/png" }),
      );
      return transfer;
    });
    await page
      .locator(`[data-native-drop="${PROJECT_ID}"]`)
      .dispatchEvent("drop", { dataTransfer: fileTransfer, clientX: dropX });

    // While the upload is held, move alpha to the END. Every index shifts
    // down by one, so a stale index 2 would now point AFTER the collection.
    await holdDrag(
      page,
      projectStrip.locator('[data-node-id="alpha"]'),
      projectStrip.locator('[data-node-id="charlie"]'),
      0.85,
    );
    await expect
      .poll(() => stripOrder(page, PROJECT_ID))
      .toEqual(["bravo", CHILD_ID, "charlie", "alpha"]);

    release!();

    // Anchored: still immediately after bravo, which is where it was dropped.
    await expect
      .poll(() => stripOrder(page, PROJECT_ID), { timeout: 15000 })
      .toEqual(["bravo", expect.stringMatching(/^image-/), CHILD_ID, "charlie", "alpha"]);
  });

  test("a failed drop's error survives a later drop succeeding", async ({ page }) => {
    // Several drops can be live at once, but they used to share ONE status
    // slot: whichever finished last wrote it, so a successful second drop
    // erased the first drop's error and the user never learned it failed.
    await installGraphApi(page);
    let uploads = 0;
    await page.route("**/api/timeline-media/upload", async (route) => {
      const index = uploads++;
      // Order matters: the failure must settle FIRST and the success AFTER,
      // so the success is what would overwrite the error. (Reversed, a shared
      // slot also ends up showing the error and the test proves nothing.)
      if (index === 0) return route.fulfill({ status: 500, body: "nope" });
      await new Promise((resolve) => setTimeout(resolve, 400));
      return route.fulfill({ json: { pathname: `ok-${index}.png`, url: PIXEL } });
    });
    await openGraph(page);
    const dropZone = page.locator(`[data-native-drop="${PROJECT_ID}"]`);

    const makeTransfer = (name: string) =>
      page.evaluateHandle((fileName) => {
        const transfer = new DataTransfer();
        transfer.items.add(
          new File([new Uint8Array([137, 80, 78, 71])], fileName, { type: "image/png" }),
        );
        return transfer;
      }, name);

    await dropZone.dispatchEvent("drop", { dataTransfer: await makeTransfer("bad.png"), clientX: 0 });
    await dropZone.dispatchEvent("drop", { dataTransfer: await makeTransfer("good.png"), clientX: 0 });

    // The good file lands...
    await expect
      .poll(() => stripOrder(page, PROJECT_ID).then((order) => order.length), { timeout: 15000 })
      .toBe(5);

    // ...and the failure is STILL reported rather than being cleared by it.
    await expect(page.locator("[data-native-drop-status]")).toContainText(
      /could not be uploaded/i,
    );
  });

  test("a remote clip survives the local edit that follows a write conflict", async ({ page }) => {
    // The data-loss path this guards: clip writes are whole-collection
    // projections of the LIVE GRAPH. On a 409 the gateway reloads the
    // document, but the graph keeps the pre-conflict local edit — so the next
    // edit used to re-project that stale collection against the now-fresh
    // revision, which the server accepts, deleting the other writer's clip.
    const api = await installGraphApi(page);
    await openGraph(page);
    const projectStrip = strip(page, PROJECT_ID);

    // Another writer saves first: a new clip lands and the revision moves on.
    api.documents.get(PROJECT_ID)!.clips.push(mediaClip("remote-clip", "image", 4, 4));
    api.revisions.set(PROJECT_ID, (api.revisions.get(PROJECT_ID) ?? 1) + 1);

    // Local edit #1 → save → loses compare-and-set.
    await holdDrag(
      page,
      projectStrip.locator('[data-node-id="alpha"]'),
      projectStrip.locator('[data-node-id="charlie"]'),
      0.85,
    );
    await expect
      .poll(() => stripOrder(page, PROJECT_ID))
      .toEqual(["bravo", CHILD_ID, "charlie", "alpha"]);
    await expect(page.getByText(/changed in another view/i)).toBeVisible({ timeout: 15000 });

    // Local edit #2, after the conflict. This is the write that used to
    // clobber the remote clip.
    await holdDrag(
      page,
      projectStrip.locator('[data-node-id="bravo"]'),
      projectStrip.locator('[data-node-id="charlie"]'),
      0.85,
    );
    await page.waitForTimeout(2000); // outlast the debounce and any retry

    // The stored document still holds the other writer's clip.
    expect(api.documents.get(PROJECT_ID)!.clips.map((clip) => clip.id)).toContain("remote-clip");
    // And no write for the project landed after the conflict.
    const wroteWithoutRemote = api
      .patchesFor(PROJECT_ID)
      .some((patch) => !patch.clipIds.includes("remote-clip"));
    expect(wroteWithoutRemote).toBe(false);
  });

  test("a failed drop reports alongside later progress, then expires", async ({ page }) => {
    // Errors used to be recorded and never removed, and to beat progress
    // outright in aggregation — so one failure pinned a red banner for the
    // life of the component and hid every upload after it.
    await installGraphApi(page);
    let uploads = 0;
    let holdSecond: (() => void) | undefined;
    const secondHeld = new Promise<void>((resolve) => {
      holdSecond = resolve;
    });
    await page.route("**/api/timeline-media/upload", async (route) => {
      const index = uploads++;
      if (index === 0) return route.fulfill({ status: 500, body: "nope" });
      await secondHeld;
      return route.fulfill({ json: { pathname: `ok-${index}.png`, url: PIXEL } });
    });
    await openGraph(page);
    const dropZone = page.locator(`[data-native-drop="${PROJECT_ID}"]`);
    const status = page.locator("[data-native-drop-status]");

    const transfer = (name: string) =>
      page.evaluateHandle((fileName) => {
        const t = new DataTransfer();
        t.items.add(new File([new Uint8Array([137, 80, 78, 71])], fileName, { type: "image/png" }));
        return t;
      }, name);

    // Drop 1 fails.
    await dropZone.dispatchEvent("drop", { dataTransfer: await transfer("bad.png"), clientX: 0 });
    await expect(status).toContainText(/could not be uploaded/i);

    // Drop 2 starts while the failure is still showing: BOTH are reported,
    // so the new upload is not hidden behind the old error.
    await dropZone.dispatchEvent("drop", { dataTransfer: await transfer("good.png"), clientX: 0 });
    await expect(status).toContainText(/Uploading 1 file/i);
    await expect(status).toContainText(/could not be uploaded/i);

    holdSecond!();
    await expect
      .poll(() => stripOrder(page, PROJECT_ID).then((order) => order.length), { timeout: 15000 })
      .toBe(5);

    // And the failure clears itself rather than living until unmount.
    await expect(status).not.toContainText(/could not be uploaded/i, { timeout: 15000 });
    await expect(status).toHaveText("");
  });

  test("the collection tool in the breadcrumb row is a drag source, uncovered by the drop-zone layer", async ({ page }) => {
    // The tool keeps BOTH affordances after moving to the header: keyboard
    // activation (covered elsewhere) and native drag. Playwright's synthetic
    // mouse cannot drive a native HTML5 drag, so this asserts the next best
    // thing: the element is still draggable and its dragstart still loads the
    // DataTransfer the drop targets read.
    await installGraphApi(page);
    await openGraph(page);

    const collectionTool = page.getByRole("button", { name: /add collection/i });
    await expect(collectionTool).toHaveAttribute("draggable", "true");

    const carried = await collectionTool.evaluate((el) => {
      const transfer = new DataTransfer();
      el.dispatchEvent(new DragEvent("dragstart", { dataTransfer: transfer, bubbles: true }));
      return transfer.getData("application/x-gstudio-type");
    });
    expect(carried).toBe("collection");

    // ...and the button must actually RECEIVE that dragstart under a real
    // pointer. dispatchEvent above bypasses hit-testing, so it can't catch a
    // regression where an overlay eats the gesture — the breadcrumb drop-zone
    // layer sits over this same row. Assert hit-testing: the topmost element at
    // the tool's own centre is the tool itself, which holds only while the idle
    // drop-zone layer stays pointer-events-none.
    const onThisTool = await collectionTool.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return el.contains(top);
    });
    expect(onThisTool).toBe(true);
  });

  test("the ruler renders on EVERY displayed strip, not just the focused one", async ({
    page,
  }) => {
    await installGraphApi(page);
    await openGraph(page);
    // Ruler lives in flat mode and is off by default; turn both on.
    await enableRuler(page);
    await expect(page.locator("[data-graph-ruler]")).toHaveCount(1);

    // Expand a sub-collection — its strip must get its OWN ruler (R6 #1), so a
    // focused strip + one expanded child strip = two rulers.
    await expandSubGraph(page, "Scene A");
    await expect.poll(() => stripOrder(page, CHILD_ID)).toEqual(["c1", "c2"]);
    await expect.poll(() => page.locator("[data-graph-ruler]").count()).toBeGreaterThanOrEqual(2);
  });

  test("ruler ticks are windowed to the visible strip, not the whole timeline", async ({
    page,
  }) => {
    const api = await installGraphApi(page);
    // A LONG project: 300 clips ≈ 1,200s ≈ 50,000px of strip at the default
    // zoom. Unwindowed, the ruler minted one div per finest step across the
    // whole duration (~4,800 ticks); windowed, tick count follows the
    // viewport. `alpha` stays first so openGraph's readiness wait holds.
    const project = api.documents.get(PROJECT_ID)!;
    project.clips = [
      mediaClip("alpha", "video", 0, 6, 8),
      ...Array.from({ length: 299 }, (_, i) => mediaClip(`long-${i}`, "image", i + 1, 4)),
    ];
    await openGraph(page);
    await enableRuler(page);
    const ruler = page.locator("[data-graph-ruler]");
    await expect(ruler).toHaveCount(1);

    // Ticks translate within the strip's content coordinates; read each
    // tick's x off its transform.
    const tickXsInRange = (fromX: number, toX: number) =>
      ruler.locator("> div").evaluateAll(
        (els, range) =>
          els.filter((el) => {
            const match = /translateX\(([\d.]+)px\)/.exec((el as HTMLElement).style.transform);
            return match !== null && +match[1] >= range.fromX && +match[1] <= range.toX;
          }).length,
        { fromX, toX },
      );

    // Near the origin: ticks exist. Far to the right (x ≈ 30,000, ~750s in):
    // NONE exist yet — the unwindowed ruler had them all.
    await expect.poll(() => tickXsInRange(0, 600)).toBeGreaterThan(5);
    await expect.poll(() => tickXsInRange(30_000, 32_000)).toBe(0);
    const beforeScroll = await ruler.locator("> div").count();
    expect(beforeScroll).toBeLessThan(800);

    // Scroll the strip deep into the timeline: the window follows and ticks
    // materialize under the new viewport — still bounded, never the full set.
    await strip(page, PROJECT_ID).evaluate((el) => {
      el.scrollLeft = 30_000;
    });
    await expect.poll(() => tickXsInRange(30_000, 32_000)).toBeGreaterThan(5);
    const afterScroll = await ruler.locator("> div").count();
    expect(afterScroll).toBeLessThan(800);
  });

  test("flat mode shows the whole closure in order, with no collections", async ({ page }) => {
    await installGraphApi(page);
    await openGraph(page);

    // Nested reading: the project's four direct children, one of them a
    // collection card.
    expect(await stripOrder(page, PROJECT_ID)).toEqual([
      "alpha",
      "bravo",
      CHILD_ID,
      "charlie",
    ]);

    const flat = page.getByRole("button", { name: "Show all items in order" });
    await expect(flat).toBeVisible();
    await flat.click();

    // Flat reading: Scene A is walked THROUGH — its clips take its place, in
    // order, and the collection card itself is gone.
    await expect
      .poll(() => stripOrder(page, PROJECT_ID), { timeout: 15000 })
      .toEqual(["alpha", "bravo", "c1", "c2", "charlie"]);

    // The time overlays now measure the FLAT run rather than the focused
    // collection's direct children, so the ruler rules the cards on screen.
    await page.getByRole("button", { name: /show time ruler/i }).click();
    await expect(page.locator("[data-graph-ruler]")).toHaveCount(1);

    // Leaving flat mode restores the nested reading — and takes the ruler
    // with it, since the ruler is scoped to the flat run.
    await page.getByRole("button", { name: "Show collections" }).click();
    await expect
      .poll(() => stripOrder(page, PROJECT_ID))
      .toEqual(["alpha", "bravo", CHILD_ID, "charlie"]);
    await expect(page.locator("[data-graph-ruler]")).toHaveCount(0);
  });

  test("flat mode keeps expanded child playheads synchronized with preview", async ({
    page,
  }) => {
    await installGraphApi(page);
    await openGraph(page);
    await expandSubGraph(page, "Scene A");
    await expect.poll(() => stripOrder(page, CHILD_ID)).toEqual(["c1", "c2"]);

    await previewToggle(page).click();
    await expect(page.locator("[data-preview-source]")).toHaveAttribute(
      "data-preview-source",
      "manifest",
    );
    await page.getByRole("button", { name: "Show all items in order" }).click();
    await expect
      .poll(() => stripOrder(page, PROJECT_ID), { timeout: 15000 })
      .toEqual(["alpha", "bravo", "c1", "c2", "charlie"]);

    const focusedRail = page.getByRole("slider", {
      name: "Seek preview",
      exact: true,
    });
    const childRail = page.getByRole("slider", {
      name: "Seek preview in Scene A",
      exact: true,
    });
    const maxOf = (rail: Locator) =>
      rail.evaluate((element) => Number(element.getAttribute("aria-valuemax")));

    // The focused rail measures the flat closure. The expanded child remains
    // structured, so its rail must cover only Scene A instead of inheriting
    // the focused run's full timing map.
    const focusedMax = await maxOf(focusedRail);
    const childMax = await maxOf(childRail);
    expect(childMax).toBeGreaterThan(0);
    expect(childMax).toBeLessThan(focusedMax);

    // Seeking the child to its start uses Scene A's GLOBAL manifest window:
    // its own playhead lands at x=0 while Preview draws that first child clip.
    await childRail.focus();
    await page.keyboard.press("Home");
    await expect(childRail).toHaveAttribute("aria-valuenow", "0.0");

    const childSection = page.locator(`section[aria-label="Sub-timeline: Scene A"]`);
    const childPlayhead = childSection.locator("[data-graph-playhead]");
    await expect(childPlayhead).toBeVisible();
    await expect
      .poll(() =>
        childPlayhead.evaluate((element) => {
          const match = /translateX\(([-\d.]+)px\)/.exec(
            (element as HTMLElement).style.transform,
          );
          return match ? Number(match[1]) : Number.POSITIVE_INFINITY;
        }),
      )
      .toBeLessThan(5);
    await expect(page.getByTestId("workbench-display-canvas")).toHaveAttribute(
      "aria-label",
      "c1 preview",
    );
  });

  test("flat cards name their collection, and reveal it", async ({ page }) => {
    await installGraphApi(page);
    await openGraph(page);

    // Nested: every card's parent IS the focused timeline, so nothing is
    // labelled — the mode needs no flag to stay quiet here.
    await expect(page.locator("[data-provenance]")).toHaveCount(0);

    await page.getByRole("button", { name: "Show all items in order" }).click();
    await expect
      .poll(() => stripOrder(page, PROJECT_ID), { timeout: 15000 })
      .toEqual(["alpha", "bravo", "c1", "c2", "charlie"]);

    // Only the cards drawn from a NESTED collection carry a label: c1/c2 live
    // in Scene A, while alpha/bravo/charlie are the focused timeline's own.
    const labels = page.locator("[data-provenance]");
    await expect(labels).toHaveCount(2);
    await expect(labels.first()).toHaveText("Scene A");
    await expect(
      strip(page, PROJECT_ID).locator('[data-node-id="alpha"] [data-provenance]'),
    ).toHaveCount(0);

    // Double-click reveals — a span, not a button, because it renders inside
    // the card's selection button and nesting interactive semantics is
    // invalid. (The O key is its keyboard twin; see OpenKeyBoundary.)
    await labels.first().dblclick();
    await page.waitForURL(`**${GRAPH_URL}/${CHILD_ID}`);
    await expect.poll(() => stripOrder(page, CHILD_ID)).toEqual(["c1", "c2"]);
  });

  // These two were PALETTE drags until the asset tray was retired (PL12-005).
  // They are OS FILE DROPS now, which is not a like-for-like swap and is the
  // point: a file drop dispatches its add through the store directly, so it
  // never passed through `mapDropCommand` and never got the flat translation.
  // With the palette gone that is the ONLY way to add media, so the path the
  // translation guards has to be the path the tests drive.
  //
  // HISTORY worth keeping: these were failing DETERMINISTICALLY once before,
  // because the flat translator ran on every drop command — including the
  // card-relative ones that were already correct — and re-read a
  // parent-relative index as a flat-run boundary.
  test.describe(() => {
    test("in flat mode a file drop joins the LEFT neighbour's collection", async ({
      page,
    }) => {
      const api = await installGraphApi(page);
      await page.route("**/api/timeline-media/upload", (route) =>
        route.fulfill({ json: { pathname: "dropped.png", url: PIXEL } }),
      );
      await openGraph(page);
      await page.getByRole("button", { name: "Show all items in order" }).click();
      await expect
        .poll(() => stripOrder(page, PROJECT_ID), { timeout: 15000 })
        .toEqual(["alpha", "bravo", "c1", "c2", "charlie"]);
      // Closure hydration mutates the graph as each collection lands, and the
      // flat run is derived from it — measure after it settles.
      await expect(
        page.getByRole("button", { name: "Show collections" }),
      ).toHaveAttribute("aria-busy", "false");

      // Drop on c2's RIGHT half — the boundary just after it. c2 lives in
      // Scene A, so the new clip belongs to Scene A, NOT to the focused
      // project whose collection the drop names.
      const c2Box = (await strip(page, PROJECT_ID).locator('[data-node-id="c2"]').boundingBox())!;
      await dropOneFile(page, PROJECT_ID, c2Box.x + c2Box.width * 0.85);

      // It landed in the CHILD document, after c2 — the flat index was
      // translated, not taken literally.
      await expect
        .poll(() => api.patchesFor(CHILD_ID).at(-1)?.clipIds, { timeout: 8000 })
        .toHaveLength(3);
      const childIds = api.patchesFor(CHILD_ID).at(-1)!.clipIds!;
      expect(childIds.slice(0, 2)).toEqual(["c1", "c2"]);

      // And the project did NOT gain it — the untranslated command would have
      // inserted here, at a flat index inside the wrong parent.
      const projectIds = api.patchesFor(PROJECT_ID).at(-1)?.clipIds;
      if (projectIds) expect(projectIds).toHaveLength(4);
    });

    test("in flat mode a drop in the GAP is still translated off the flat run", async ({
      page,
    }) => {
      // The other half: with the pointer over no card, the boundary falls
      // between two cards of the same collection. Translated, its left
      // neighbour is c1, so the clip joins Scene A after c1.
      const api = await installGraphApi(page);
      await page.route("**/api/timeline-media/upload", (route) =>
        route.fulfill({ json: { pathname: "dropped.png", url: PIXEL } }),
      );
      await openGraph(page);
      await page.getByRole("button", { name: "Show all items in order" }).click();
      await expect
        .poll(() => stripOrder(page, PROJECT_ID), { timeout: 15000 })
        .toEqual(["alpha", "bravo", "c1", "c2", "charlie"]);
      await expect(
        page.getByRole("button", { name: "Show collections" }),
      ).toHaveAttribute("aria-busy", "false");

      const c1Box = (await strip(page, PROJECT_ID).locator('[data-node-id="c1"]').boundingBox())!;
      const c2Box = (await strip(page, PROJECT_ID).locator('[data-node-id="c2"]').boundingBox())!;
      const gapX = (c1Box.x + c1Box.width + c2Box.x) / 2;
      expect(gapX).toBeGreaterThan(c1Box.x + c1Box.width);
      expect(gapX).toBeLessThan(c2Box.x);
      await dropOneFile(page, PROJECT_ID, gapX);

      // Scene A gained it, between c1 and c2.
      await expect
        .poll(() => api.patchesFor(CHILD_ID).at(-1)?.clipIds, { timeout: 8000 })
        .toHaveLength(3);
      const childIds = api.patchesFor(CHILD_ID).at(-1)!.clipIds!;
      expect(childIds[0]).toBe("c1");
      expect(childIds[2]).toBe("c2");
    });
  });

  // The seek rail's marks are PER ITEM — one boundary tick between every pair
  // of cards — so unwindowed they scale with clip count, which is precisely
  // the cost the strip's card virtualizer exists to avoid. It matters most for
  // a flattened all-items strip, where the count is a whole project's rather
  // than one collection's.
  test("seek rail marks are windowed to the visible strip, not the whole timeline", async ({
    page,
  }) => {
    const api = await installGraphApi(page);
    const project = api.documents.get(PROJECT_ID)!;
    project.clips = [
      mediaClip("alpha", "video", 0, 6, 8),
      ...Array.from({ length: 299 }, (_, i) => mediaClip(`long-${i}`, "image", i + 1, 4)),
    ];
    await openGraph(page);
    // The rail is the PREVIEW's scrubber — it only mounts with the pane open.
    await previewToggle(page).click();

    const rail = page.locator("[data-graph-seek-rail][data-strip-rail]");
    await expect(rail).toHaveCount(1);
    // The rail's content layer holds the boundary ticks; each is absolutely
    // positioned at a content x.
    const markCount = () => rail.locator("span[aria-hidden='true']").count();

    // 300 cards would be 299 boundary ticks unwindowed. Windowed, the count
    // follows the viewport — generously bounded so this pins the ORDER of
    // magnitude rather than an exact layout.
    await expect.poll(markCount).toBeLessThan(120);
    await expect.poll(markCount).toBeGreaterThan(0);

    // Scrolling deep into the timeline keeps it bounded — the window moves,
    // it does not accumulate.
    await strip(page, PROJECT_ID).evaluate((el) => {
      el.scrollLeft = 30_000;
    });
    await expect.poll(markCount).toBeLessThan(120);
  });
});
