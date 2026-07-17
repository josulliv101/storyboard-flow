import { expect, test, type Locator, type Page } from "@playwright/test";

// E2E for the graph project view (/timeline/[projectId]/graph) — the REAL
// Next app driven with real mouse input. The server surface the view touches
// (/api/auth/me, /api/timelines/[id], /api/assets) is mocked per-test with
// page.route(), so the suite exercises everything the Storybook layers can't:
// AuthGate, App Router layout persistence (undo across drill-in), the
// documents gateway with debounced patch-scoped PATCHes, the palette drawer,
// the trash root, and the preview playhead — without reading or writing any
// real storage.
//
// Selector contract (documented in packages/ui/dnd-collections/API.md):
//   [data-node-id] card buttons · [data-virtual-strip="<collectionId>"]
//   scroll containers · [data-palette-item] · [data-trash-target] ·
//   [data-graph-playhead] / [data-playhead-scrub] (app-side, graph view).
//
// Interaction contract: strip cards and palette thumbnails use press-and-hold
// drag activation (250ms) so fast swipes pan instead — every drag here holds
// past the delay before moving, then dwells before release (dnd-kit measures
// on a cadence; releasing early is the classic CI-only flake).

const PROJECT_ID = "project-e2e-1";
const CHILD_ID = "timeline-e2e-child";
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

function collectionClip(id: string, childTimelineId: string, index: number): FixtureClip {
  return {
    id,
    index,
    kind: "collection",
    title: "Scene A",
    childTimelineId,
    itemCount: 2,
    previewItems: [],
    alt: "Scene A",
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

// ── API mock ────────────────────────────────────────────────────────────────

type RecordedPatch = { id: string; clipIds: string[] };

type GraphApi = {
  documents: Map<string, FixtureDocument>;
  patches: RecordedPatch[];
  patchesFor: (id: string) => RecordedPatch[];
};

async function installGraphApi(
  page: Page,
  options: { blockChildDocument?: boolean } = {},
): Promise<GraphApi> {
  const documents = buildFixtureDocuments();
  const patches: RecordedPatch[] = [];

  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      json: { user: { uid: USER_ID, email: "e2e@test.local", name: "E2E", picture: null } },
    }),
  );

  await page.route("**/api/assets**", (route) =>
    route.fulfill({
      json: {
        assets: [
          {
            id: "img-1",
            pathname: "fixtures/sunset.jpg",
            url: PIXEL,
            thumbnailUrl: PIXEL,
            resourceType: "image",
            width: 1600,
            height: 900,
          },
          {
            id: "vid-1",
            pathname: "fixtures/clip.mp4",
            url: PIXEL,
            thumbnailUrl: PIXEL,
            resourceType: "video",
            width: 1920,
            height: 1080,
            // Real duration from the Cloudinary Search API listing — a
            // dropped video must land at this length, not the 8s default.
            duration: 12.4,
          },
        ],
      },
    }),
  );

  await page.route("**/api/timelines/*", async (route) => {
    const request = route.request();
    const id = decodeURIComponent(new URL(request.url()).pathname.split("/").pop() ?? "");

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
      await route.fulfill({ json: { document: doc } });
      return;
    }

    if (request.method() === "PATCH") {
      const body = request.postDataJSON() as { document?: FixtureDocument };
      if (!body.document || body.document.id !== id) {
        await route.fulfill({ status: 400, json: { error: "Bad document." } });
        return;
      }
      documents.set(id, body.document);
      patches.push({ id, clipIds: body.document.clips.map((clip) => clip.id) });
      await route.fulfill({ json: { document: body.document } });
      return;
    }

    await route.continue();
  });

  return { documents, patches, patchesFor: (id) => patches.filter((patch) => patch.id === id) };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const strip = (page: Page, collectionId: string): Locator =>
  page.locator(`[data-virtual-strip="${collectionId}"]`);

async function stripOrder(page: Page, collectionId: string): Promise<string[]> {
  return strip(page, collectionId)
    .locator("[data-node-id]")
    .evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.nodeId ?? ""));
}

async function openGraph(page: Page): Promise<void> {
  await page.goto(GRAPH_URL);
  await strip(page, PROJECT_ID)
    .locator('[data-node-id="alpha"]')
    .waitFor({ state: "visible", timeout: 30000 });
}

/** Press-and-hold drag: hold past the 250ms activation delay, travel, dwell,
 *  release. Used for strip cards AND palette thumbnails (both hold-marked). */
async function holdDrag(
  page: Page,
  source: Locator,
  target: Locator,
  targetXRatio = 0.5,
): Promise<void> {
  await source.waitFor({ state: "visible" });
  await target.waitFor({ state: "visible" });
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
}

const undoButton = (page: Page): Locator => page.getByRole("button", { name: /undo/i });

// The sidebar ALSO has an "Assets" button (the drawer-handoff one) — scope
// to the main region to hit the graph header's own toggles.
const headerToggle = (page: Page, label: string): Locator =>
  page.getByRole("main").getByRole("button", { name: label, exact: true });

// ── Tests ───────────────────────────────────────────────────────────────────

test.describe("graph view E2E", () => {
  test("boots from persisted documents and hydrates the visible sub-timeline", async ({
    page,
  }) => {
    await installGraphApi(page);
    await openGraph(page);

    // Focused strip: the project's clips in stored order; the collection
    // clip's node id IS its child timeline id (adapter identity rule).
    expect(await stripOrder(page, PROJECT_ID)).toEqual(["alpha", "bravo", CHILD_ID, "charlie"]);

    // Eager hydration: the visible collection loads its own clips and the
    // inline sub-timeline strip renders them.
    const section = page.locator('section[aria-label="Sub-timeline: Scene A"]');
    await expect(section).toBeVisible();
    await expect
      .poll(() => stripOrder(page, CHILD_ID), { timeout: 15000 })
      .toEqual(["c1", "c2"]);
  });

  test("hold-drag reorder persists a patch-scoped write to only the touched document", async ({
    page,
  }) => {
    const api = await installGraphApi(page);
    await openGraph(page);
    await expect.poll(() => stripOrder(page, CHILD_ID), { timeout: 15000 }).toEqual(["c1", "c2"]);
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

    // The gateway debounces ~900ms, then PATCHes the project document with
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

  test("undo history survives drill-in navigation (the layout-persistence invariant)", async ({
    page,
  }) => {
    const api = await installGraphApi(page);
    await openGraph(page);
    await expect.poll(() => stripOrder(page, CHILD_ID), { timeout: 15000 }).toEqual(["c1", "c2"]);
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
    await page
      .locator('section[aria-label="Sub-timeline: Scene A"]')
      .getByRole("button", { name: "Focus" })
      .click();
    await page.waitForURL(`**${GRAPH_URL}/${CHILD_ID}`);
    await expect.poll(() => stripOrder(page, CHILD_ID)).toEqual(["c1", "c2"]);

    // The reorder made in the PROJECT focus is still undoable here.
    await expect(undoButton(page)).toBeEnabled();
    await undoButton(page).click();

    await page.goBack();
    await page.waitForURL(`**${GRAPH_URL}`);
    await expect
      .poll(() => stripOrder(page, PROJECT_ID))
      .toEqual(["alpha", "bravo", CHILD_ID, "charlie"]);

    // The undo also persisted: the last project PATCH restores stored order.
    await expect
      .poll(() => api.patchesFor(PROJECT_ID).at(-1)?.clipIds, { timeout: 5000 })
      .toEqual(["alpha", "bravo", "clip-scene", "charlie"]);
  });

  test("palette drag mints a fresh node from an asset and persists it", async ({ page }) => {
    const api = await installGraphApi(page);
    await openGraph(page);
    await expect.poll(() => stripOrder(page, CHILD_ID), { timeout: 15000 }).toEqual(["c1", "c2"]);

    await headerToggle(page, "Assets").click();
    const drawer = page.getByRole("dialog", { name: "Asset palette" });
    await expect(drawer).toBeVisible();

    // Drop on bravo's left half: the new node inserts before it.
    const thumbnail = drawer.locator('[data-palette-item="asset-img-1"]');
    await holdDrag(page, thumbnail, strip(page, PROJECT_ID).locator('[data-node-id="bravo"]'), 0.15);

    await expect
      .poll(() => stripOrder(page, PROJECT_ID))
      .toEqual(["alpha", expect.stringMatching(/^asset-img-1/), "bravo", CHILD_ID, "charlie"]);

    // The bridge claims the parked palette detail BEFORE the first write, so
    // the persisted clip already carries the asset's src.
    await expect
      .poll(() => api.patchesFor(PROJECT_ID).at(-1)?.clipIds.length, { timeout: 5000 })
      .toBe(5);
    const stored = api.documents.get(PROJECT_ID);
    const persisted = stored?.clips.find((clip) => clip.id.startsWith("asset-img-1"));
    expect(persisted).toBeDefined();
    expect(persisted?.kind).toBe("image");
    expect(persisted?.src).toBe(PIXEL);

    // A VIDEO asset lands at its REAL listed duration, not the default.
    await holdDrag(
      page,
      drawer.locator('[data-palette-item="asset-vid-1"]'),
      strip(page, PROJECT_ID).locator('[data-node-id="charlie"]'),
      0.85,
    );
    await expect
      .poll(() => api.patchesFor(PROJECT_ID).at(-1)?.clipIds.length, { timeout: 5000 })
      .toBe(6);
    const video = api.documents
      .get(PROJECT_ID)
      ?.clips.find((clip) => clip.id.startsWith("asset-vid-1"));
    expect(video).toBeDefined();
    expect(video?.kind).toBe("video");
    expect(video?.sourceDuration).toBe(12.4);
    expect(video?.duration).toBe(12.4); // untrimmed: full source length
  });

  test("trash drop moves across roots, persists BOTH documents, and undoes", async ({
    page,
  }) => {
    const api = await installGraphApi(page);
    await openGraph(page);
    await expect.poll(() => stripOrder(page, CHILD_ID), { timeout: 15000 }).toEqual(["c1", "c2"]);

    const trash = page.locator(`[data-trash-target="${TRASH_ID}"]`);
    await holdDrag(page, strip(page, PROJECT_ID).locator('[data-node-id="bravo"]'), trash);

    await expect
      .poll(() => stripOrder(page, PROJECT_ID))
      .toEqual(["alpha", CHILD_ID, "charlie"]);

    // A cross-root move is patch-scoped like any other: source AND target
    // documents both write.
    await expect
      .poll(() => api.patchesFor(TRASH_ID).at(-1)?.clipIds, { timeout: 5000 })
      .toEqual(["bravo"]);
    await expect
      .poll(() => api.patchesFor(PROJECT_ID).at(-1)?.clipIds, { timeout: 5000 })
      .toEqual(["alpha", "clip-scene", "charlie"]);

    // Trash drops are ordinary undoable moves.
    await undoButton(page).click();
    await expect
      .poll(() => stripOrder(page, PROJECT_ID))
      .toEqual(["alpha", "bravo", CHILD_ID, "charlie"]);
    await expect
      .poll(() => api.patchesFor(TRASH_ID).at(-1)?.clipIds, { timeout: 5000 })
      .toEqual([]);
  });

  test("drop into an un-hydrated collection bounces and never writes its document", async ({
    page,
  }) => {
    const api = await installGraphApi(page, { blockChildDocument: true });
    await openGraph(page);
    const projectStrip = strip(page, PROJECT_ID);

    // The child document never loads: the collection stays a placeholder.
    await expect(projectStrip.locator(`[data-node-id="${CHILD_ID}"]`)).toContainText(
      "Open to load",
    );

    // Nest alpha into the placeholder (drop dead-center): the persistence
    // bridge bounces it — undone on the spot with a rejection flash.
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

  test("preview mode: playhead with triangle cap, drag-to-scrub, no layout blowout", async ({
    page,
  }) => {
    await installGraphApi(page);
    await openGraph(page);
    await expect.poll(() => stripOrder(page, CHILD_ID), { timeout: 15000 }).toEqual(["c1", "c2"]);

    await headerToggle(page, "Preview").click();

    // Playhead visuals ride the strip's presentational overlay; the triangle
    // cap is a zero-size bordered div (attached, not "visible").
    const playhead = page.locator("[data-graph-playhead]");
    await expect(playhead).toBeVisible();
    await expect(playhead.locator("div")).toHaveCount(1);

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

    // Scrub: press the band over the strip's top edge and drag right — the
    // playhead follows the pointer through the time↔x map. hover() first:
    // the pane above settles its layout asynchronously, and hover waits for
    // the band's bounding box to be STABLE before positioning the mouse
    // (raw mouse coordinates measured earlier land on a card instead).
    const band = page.locator("[data-playhead-scrub]");
    await band.hover({ position: { x: 60, y: 6 } });
    await page.mouse.down();
    const bandBox = await band.boundingBox();
    expect(bandBox).not.toBeNull();
    await page.mouse.move(bandBox!.x + 260, bandBox!.y + 6, { steps: 10 });
    await page.mouse.up();

    await expect.poll(translateX).toBeGreaterThan(before + 100);

    // Drill-in RESETS the persistent preview clock: the layout (and with it
    // the time channel) survives navigation, but a different focused
    // timeline is a different clock — without the reset the transport would
    // park at "long-timeline-time / short-timeline-duration".
    await strip(page, PROJECT_ID).locator(`[data-node-id="${CHILD_ID}"]`).click();
    await page.keyboard.press("o");
    await page.waitForURL(`**${GRAPH_URL}/${CHILD_ID}`);
    await expect.poll(translateX).toBeLessThan(20);
  });

  test("grid mode: playhead rides cells, scrubs horizontally and jumps rows", async ({
    page,
  }) => {
    // Narrow viewport → few responsive columns, so the 4 project clips wrap
    // onto at least two rows (needed to exercise the vertical row scrub).
    await page.setViewportSize({ width: 420, height: 900 });
    await installGraphApi(page);
    await openGraph(page);
    await expect.poll(() => stripOrder(page, CHILD_ID), { timeout: 15000 }).toEqual(["c1", "c2"]);

    // Switch the focused surface to grid, then turn Preview on.
    await page
      .getByRole("group", { name: "Focused timeline layout" })
      .getByRole("button", { name: "grid" })
      .click();
    await headerToggle(page, "Preview").click();

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

    // Positions are taken RELATIVE TO THE SCRUB SURFACE, which overlays the
    // grid exactly — so its interior offsets are layout-independent (the
    // preview pane above settles asynchronously and shifts absolute page
    // coords). scrub.hover() also waits for a stable box before pressing.
    // Content geometry: 9px border+padding, cell 160×96, 8px gap → row pitch
    // 104, a cell's vertical center ≈ 9 + 48 = 57 below the scrub top.
    const scrub = page.locator("[data-grid-scrub]");
    const ROW0_Y = 57;
    const ROW1_Y = 57 + 104;

    // Horizontal scrub across row 0 → x advances, still on row 0.
    await scrub.hover({ position: { x: 30, y: ROW0_Y } });
    await page.mouse.down();
    const sb = (await scrub.boundingBox())!;
    await page.mouse.move(sb.x + 150, sb.y + ROW0_Y, { steps: 8 });
    await page.mouse.up();
    await expect.poll(async () => (await translate()).x).toBeGreaterThan(100);
    expect((await translate()).y).toBeLessThan(52); // still the first row

    // Vertical scrub: press into the SECOND row → the playhead jumps a row
    // down (time lands on a later clip). This is the grid-only affordance.
    await scrub.hover({ position: { x: 89, y: ROW1_Y } });
    await page.mouse.down();
    await page.mouse.move(sb.x + 93, sb.y + ROW1_Y, { steps: 4 });
    await page.mouse.up();
    await expect.poll(async () => (await translate()).y).toBeGreaterThan(80);

    // Wheel over the scrub surface scrolls the GRID and consumes the event
    // (preventDefault), so the browser doesn't ALSO scroll the surrounding
    // page — the double-scroll regression. At the grid's boundary the
    // handler stands down and the event keeps its default action. Asserted
    // via defaultPrevented observed at window (the app scrolls in an inner
    // container, so window.scrollY can't witness the default either way).
    await page.evaluate(() => {
      const log: boolean[] = [];
      (window as unknown as { __wheelLog: boolean[] }).__wheelLog = log;
      window.addEventListener("wheel", (event) => log.push(event.defaultPrevented), {
        passive: true,
      });
    });
    const wheelLog = () =>
      page.evaluate(() => (window as unknown as { __wheelLog: boolean[] }).__wheelLog);
    const gridScrollTop = () => grid.evaluate((el) => el.scrollTop);

    await scrub.hover({ position: { x: 89, y: ROW0_Y } });
    await page.mouse.wheel(0, 100);
    await expect.poll(gridScrollTop).toBeGreaterThan(0);
    await expect
      .poll(async () => {
        const log = await wheelLog();
        return log.length > 0 && log.every(Boolean);
      })
      .toBe(true); // consumed: grid scrolled, default prevented

    // Grid is at its boundary now: the next wheel is NOT consumed.
    await page.mouse.wheel(0, 400);
    await expect.poll(async () => (await wheelLog()).includes(false)).toBe(true);
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
    await page.goto(`${GRAPH_URL}/${CHILD_ID}`);
    await expect
      .poll(() => stripOrder(page, CHILD_ID), { timeout: 15000 })
      .toEqual(["c1", "c2"]);
    await expect(page.getByText("Unknown timeline")).toHaveCount(0);
  });

  test("keyboard: O on a focused collection card drills into it", async ({ page }) => {
    await installGraphApi(page);
    await openGraph(page);
    await expect.poll(() => stripOrder(page, CHILD_ID), { timeout: 15000 }).toEqual(["c1", "c2"]);

    // Click selects and focuses the card (no drag: item drags need a hold);
    // "O" is the keyboard twin of the double-click open.
    await strip(page, PROJECT_ID).locator(`[data-node-id="${CHILD_ID}"]`).click();
    await page.keyboard.press("o");

    await page.waitForURL(`**${GRAPH_URL}/${CHILD_ID}`);
    await expect.poll(() => stripOrder(page, CHILD_ID)).toEqual(["c1", "c2"]);
  });
});
