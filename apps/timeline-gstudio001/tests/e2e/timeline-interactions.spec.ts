import { expect, test, type Locator, type Page } from "@playwright/test";

const STORY_URL = "/iframe.html?id=gstudio-timeline-smoothscrolllist--default&viewMode=story";
const COLLECTION_STORY_URL = "/iframe.html?id=gstudio-timeline-smoothscrolllist--collection-timeline&viewMode=story";
const THUMBNAIL_STORY_URL = "/iframe.html?id=gstudio-timeline-smoothscrolllist--thumbnail-mode&viewMode=story";
const FIRST_STORY_URL = "/iframe.html?id=gstudio-timeline-smoothscrolllist--first-clip-selected-at-timeline-start&viewMode=story";
const LAST_STORY_URL = "/iframe.html?id=gstudio-timeline-smoothscrolllist--last-clip-selected-at-timeline-end&viewMode=story";
const MULTIPLE_TIMELINES_URL = "/iframe.html?id=gstudio-timeline-smoothscrolllist--multiple-timelines&viewMode=story";
const MULTIPLE_THUMBNAIL_TIMELINES_URL = "/iframe.html?id=gstudio-timeline-smoothscrolllist--multiple-timelines-thumbnail&viewMode=story";
const THUMBNAIL_VIRTUALIZED_URL = "/iframe.html?id=gstudio-timeline-smoothscrolllist--virtualized-thousand-clips-thumbnail&viewMode=story";

async function dragBy(page: Page, locator: Locator, dx: number, dy = 0) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("Timeline control is not visible");

  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 12 });
  await page.mouse.up();
}

async function dragFromVisibleRightEdge(page: Page, locator: Locator, dx: number) {
  const box = await locator.boundingBox();
  const viewport = page.viewportSize();
  if (!box || !viewport) throw new Error("Timeline edge control is not visible");

  const x = Math.max(2, Math.min(box.x + box.width - 2, viewport.width - 2));
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y, { steps: 12 });
  await page.mouse.up();
}

async function beginLiftedReorder(page: Page, locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("Timeline clip is not visible");

  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y - 60, { steps: 6 });
}

async function numberAttribute(locator: Locator, name: string) {
  const value = await locator.getAttribute(name);
  if (value === null) throw new Error(`Missing ${name}`);
  return Number(value);
}

async function openStory(page: Page, url: string) {
  await page.goto(url);
  await expect(page.getByTestId("timeline-editor")).toBeVisible();
}

async function revealTimelineEnd(page: Page) {
  const viewport = page.getByTestId("timeline-scroll-viewport");
  await viewport.evaluate((element) => {
    element.style.scrollBehavior = "auto";
    element.scrollLeft = Number.MAX_SAFE_INTEGER;
    element.dispatchEvent(new Event("scroll"));
  });
}

async function scrollTimelineUntilVisible(
  page: Page,
  locator: Locator,
  direction: "left" | "right" = "right",
) {
  const viewport = page.getByTestId("timeline-scroll-viewport");

  for (let attempt = 0; attempt < 24; attempt += 1) {
    if ((await locator.count()) > 0) {
      const target = locator.first();
      await target.scrollIntoViewIfNeeded();
      if (await target.isVisible()) return;
    }

    const moved = await viewport.evaluate((element, scrollDirection) => {
      element.style.scrollBehavior = "auto";
      const previous = element.scrollLeft;
      const step = Math.max(160, element.clientWidth * 0.7);
      const next =
        scrollDirection === "left"
          ? Math.max(0, previous - step)
          : Math.min(element.scrollWidth - element.clientWidth, previous + step);
      element.scrollLeft = next;
      element.dispatchEvent(new Event("scroll"));
      return element.scrollLeft !== previous;
    }, direction);

    if (!moved) break;
    await page.waitForTimeout(50);
  }

  await expect(locator.first()).toBeVisible();
}

async function openLastStory(page: Page) {
  await openStory(page, LAST_STORY_URL);
  await expect(page.getByTestId("timeline-clip-11")).toHaveAttribute("data-selected", "true");
  await expect.poll(() => numberAttribute(page.getByTestId("timeline-editor"), "data-last-overhang")).toBeGreaterThan(0);
}

test.beforeEach(async ({ page }) => {
  await openStory(page, STORY_URL);
});

test("selects a clip and exposes its source filmstrip", async ({ page }) => {
  const clip = page.getByTestId("timeline-clip-0");
  await clip.click();

  await expect(clip).toHaveAttribute("data-selected", "true");
  await expect(page.getByTestId("timeline-source-filmstrip")).toBeVisible();
});

test("collection cards expand inline and collapse back to a collection card", async ({ page }) => {
  await openStory(page, COLLECTION_STORY_URL);
  const editor = page.getByTestId("timeline-editor");
  if ((await editor.getAttribute("data-playbar-area")) !== "true") {
    await page.getByRole("switch", { name: "Play bar" }).click();
  }
  const initialItemCount = await numberAttribute(editor, "data-item-count");

  const collection = page.getByTestId("timeline-clip-4").first();
  await collection.scrollIntoViewIfNeeded();
  await collection.click();
  await expect(collection).toHaveAttribute("data-selected", "true");
  await expect(
    page.locator('[data-testid="timeline-source-filmstrip"][data-clip-index="4"]'),
  ).toHaveCount(0);

  const toggle = collection.getByTestId("timeline-collection-expand-toggle");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  await expect.poll(() => numberAttribute(editor, "data-item-count")).toBeGreaterThan(initialItemCount);
  await expect(page.locator('[data-testid="timeline-editor"][data-timeline-id="scene-a"]')).toHaveCount(0);

  const collapseCard = page.locator(
    '[data-testid^="timeline-clip-"][data-view-role="collection-collapse"][data-expansion-key="root-scene-a"]',
  );
  await expect(collapseCard).toBeVisible();
  await expect(page.getByTestId("timeline-expanded-collection-bar-lane")).toHaveCount(0);
  await expect(
    collapseCard.getByTestId("timeline-expanded-collection-breadcrumb"),
  ).toHaveAttribute("data-depth", "1");
  await expect(
    collapseCard.locator('[data-testid="timeline-expanded-collection-breadcrumb-shape"][data-depth-level="0"]').first(),
  ).toBeVisible();
  await expect(collapseCard.getByTestId("timeline-collection-expand-toggle")).toHaveAttribute("aria-expanded", "true");
  const sceneAChild = page.locator(
    '[data-testid^="timeline-clip-"][data-view-role="expanded-child"][data-source-timeline-id="scene-a"]',
  ).first();
  await expect(sceneAChild).toBeVisible();
  await expect(sceneAChild.getByTestId("timeline-expanded-collection-breadcrumb")).toHaveAttribute("data-depth", "1");

  const nestedCollection = page.locator(
    '[data-testid^="timeline-clip-"][data-source-clip-id="scene-a-nested-collection"]',
  );
  await scrollTimelineUntilVisible(page, nestedCollection);
  await expect(nestedCollection.getByTestId("timeline-expanded-collection-breadcrumb")).toHaveAttribute("data-depth", "1");
  const nestedToggle = nestedCollection.getByTestId("timeline-collection-expand-toggle");
  await expect(nestedToggle).toHaveAttribute("aria-expanded", "false");
  await nestedToggle.click();
  await expect(nestedToggle).toHaveAttribute("aria-expanded", "true");

  const nestedCollapseCard = page.locator(
    '[data-testid^="timeline-clip-"][data-view-role="collection-collapse"][data-expansion-key="root-scene-a/scene-a-nested-collection"]',
  );
  await expect(nestedCollapseCard).toBeVisible();
  await expect(nestedCollapseCard.getByTestId("timeline-expanded-collection-breadcrumb")).toHaveAttribute("data-depth", "2");
  await expect(
    nestedCollapseCard.locator('[data-testid="timeline-expanded-collection-breadcrumb-shape"][data-depth-level="0"]').first(),
  ).toBeVisible();
  await expect(
    nestedCollapseCard.locator('[data-testid="timeline-expanded-collection-breadcrumb-shape"][data-depth-level="1"]').first(),
  ).toBeVisible();
  const sceneADetailsChild = page.locator(
    '[data-testid^="timeline-clip-"][data-view-role="expanded-child"][data-source-timeline-id="scene-a-details"]',
  ).first();
  await expect(sceneADetailsChild).toBeVisible();
  await expect(sceneADetailsChild.getByTestId("timeline-expanded-collection-breadcrumb")).toHaveAttribute("data-depth", "2");
  await expect(page.locator('[data-testid="timeline-editor"][data-timeline-id="scene-a-details"]')).toHaveCount(0);

  await nestedCollapseCard.getByTestId("timeline-collection-expand-toggle").click();
  await expect(
    page.locator('[data-testid^="timeline-clip-"][data-view-role="expanded-child"][data-source-timeline-id="scene-a-details"]'),
  ).toHaveCount(0);

  await scrollTimelineUntilVisible(page, collapseCard, "left");
  await collapseCard.getByTestId("timeline-collection-expand-toggle").click();
  await expect.poll(() => numberAttribute(editor, "data-item-count")).toBe(initialItemCount);
  await expect(
    page.locator('[data-testid^="timeline-clip-"][data-view-role="expanded-child"][data-source-timeline-id="scene-a"]'),
  ).toHaveCount(0);
});

test("collection edge thumbnails expose editable first and last child clips inline", async ({ page }) => {
  await openStory(page, COLLECTION_STORY_URL);
  const editor = page.getByTestId("timeline-editor");
  const initialItemCount = await numberAttribute(editor, "data-item-count");
  const rootCollection = () =>
    page
      .locator(
        '[data-testid^="timeline-clip-"][data-source-clip-id="root-scene-a"][data-view-role=""]',
      )
      .first();

  const collection = rootCollection();
  await collection.scrollIntoViewIfNeeded();

  const firstButton = collection.locator(
    '[data-testid="timeline-collection-preview-endpoint"][data-endpoint="first"]',
  );
  await expect(firstButton).toHaveAttribute("aria-pressed", "false");
  await firstButton.click();
  await expect.poll(() => numberAttribute(editor, "data-item-count")).toBe(initialItemCount + 1);

  const firstEndpointClips = page.locator(
    '[data-testid^="timeline-clip-"][data-view-role="collection-endpoint"][data-view-endpoint="first"][data-source-timeline-id="scene-a"][data-source-clip-id="scene-a-clip-0"]',
  );
  await expect(firstEndpointClips).toHaveCount(1);
  const firstEndpoint = firstEndpointClips.first();
  await expect(firstEndpoint).toBeVisible();
  expect(await numberAttribute(firstEndpoint, "data-clip-index")).toBeLessThan(
    await numberAttribute(rootCollection(), "data-clip-index"),
  );

  await firstEndpoint.click();
  await expect(firstEndpoint).toHaveAttribute("data-selected", "true");
  await expect(page.getByTestId("timeline-trim-left")).toBeVisible();
  await expect(page.getByTestId("timeline-trim-right")).toBeVisible();

  const collectionAfterFirst = rootCollection();
  await collectionAfterFirst.scrollIntoViewIfNeeded();
  await expect(
    collectionAfterFirst.locator(
      '[data-testid="timeline-collection-preview-endpoint"][data-endpoint="first"]',
    ),
  ).toHaveAttribute("aria-pressed", "true");
  await collectionAfterFirst
    .locator('[data-testid="timeline-collection-preview-endpoint"][data-endpoint="first"]')
    .click();
  await expect.poll(() => numberAttribute(editor, "data-item-count")).toBe(initialItemCount);
  await expect(firstEndpointClips).toHaveCount(0);

  const collectionBeforeLast = rootCollection();
  await collectionBeforeLast.scrollIntoViewIfNeeded();
  const lastButton = collectionBeforeLast.locator(
    '[data-testid="timeline-collection-preview-endpoint"][data-endpoint="last"]',
  );
  await expect(lastButton).toHaveAttribute("aria-pressed", "false");
  await lastButton.click();
  await expect.poll(() => numberAttribute(editor, "data-item-count")).toBe(initialItemCount + 1);

  const lastEndpointClips = page.locator(
    '[data-testid^="timeline-clip-"][data-view-role="collection-endpoint"][data-view-endpoint="last"][data-source-timeline-id="scene-a"][data-source-clip-id="scene-a-clip-8"]',
  );
  await expect(lastEndpointClips).toHaveCount(1);
  const lastEndpoint = lastEndpointClips.first();
  await lastEndpoint.scrollIntoViewIfNeeded();
  expect(await numberAttribute(lastEndpoint, "data-clip-index")).toBeGreaterThan(
    await numberAttribute(rootCollection(), "data-clip-index"),
  );

  await lastEndpoint.click();
  await expect(lastEndpoint).toHaveAttribute("data-selected", "true");
  await expect(page.getByTestId("timeline-trim-left")).toBeVisible();
  await expect(page.getByTestId("timeline-trim-right")).toBeVisible();

  const collectionAfterLast = rootCollection();
  await collectionAfterLast.scrollIntoViewIfNeeded();
  await collectionAfterLast
    .locator('[data-testid="timeline-collection-preview-endpoint"][data-endpoint="last"]')
    .click();
  await expect.poll(() => numberAttribute(editor, "data-item-count")).toBe(initialItemCount);
  await expect(lastEndpointClips).toHaveCount(0);
});

test("selected image source filmstrip handles resize the image duration", async ({ page }) => {
  await openStory(page, COLLECTION_STORY_URL);
  const editor = page.getByTestId("timeline-editor");
  if ((await editor.getAttribute("data-playbar-area")) !== "true") {
    await page.getByRole("switch", { name: "Play bar" }).click();
  }

  const imageClip = page.getByTestId("timeline-clip-5").first();
  await imageClip.scrollIntoViewIfNeeded();
  await imageClip.click();
  const initialDuration = await numberAttribute(imageClip, "data-duration");

  await expect(page.getByTestId("timeline-source-filmstrip")).toHaveAttribute("data-clip-index", "5");
  await dragBy(page, page.getByTestId("timeline-source-trim-right"), 80);

  await expect.poll(() => numberAttribute(imageClip, "data-duration")).toBeGreaterThan(initialDuration);
});

test("filmstrip setting shows passive read-only filmstrips for inactive video clips", async ({ page }) => {
  const editor = page.getByTestId("timeline-editor");

  await expect(editor).toHaveAttribute("data-passive-filmstrips", "false");
  await expect(page.getByTestId("timeline-passive-filmstrip")).toHaveCount(0);

  await page.getByRole("switch", { name: "Filmstrips" }).click();

  await expect(editor).toHaveAttribute("data-passive-filmstrips", "true");
  await expect(page.getByTestId("timeline-passive-filmstrip").first()).toBeVisible();
  await expect(page.getByTestId("timeline-source-trim-left")).toHaveCount(0);
  await expect(page.getByTestId("timeline-source-trim-right")).toHaveCount(0);
});

test("grid mode is available only when the timeline is in thumbnail mode", async ({ page }) => {
  const editor = page.getByTestId("timeline-editor");

  await expect(page.getByRole("switch", { name: "Grid Mode" })).toHaveCount(0);

  await openStory(page, THUMBNAIL_STORY_URL);
  const gridSwitch = page.getByRole("switch", { name: "Grid Mode" });
  await expect(gridSwitch).toBeVisible();

  await gridSwitch.click();
  await expect(editor).toHaveAttribute("data-grid-mode", "true");
  const columns = await numberAttribute(editor, "data-grid-columns");
  const totalCount = await numberAttribute(editor, "data-item-count");
  await expect.poll(() => numberAttribute(editor, "data-grid-rows")).toBe(
    Math.ceil(totalCount / columns),
  );

});

test("grid mode fits all items in viewport-width rows", async ({ page }) => {
  await openStory(page, THUMBNAIL_STORY_URL);
  const editor = page.getByTestId("timeline-editor");
  const viewport = page.getByTestId("timeline-scroll-viewport");

  await page.getByRole("switch", { name: "Grid Mode" }).click();
  await expect(editor).toHaveAttribute("data-grid-mode", "true");

  const columns = await numberAttribute(editor, "data-grid-columns");
  const rows = await numberAttribute(editor, "data-grid-rows");
  const totalCount = await numberAttribute(editor, "data-item-count");
  const viewportWidth = await numberAttribute(editor, "data-viewport-width");
  expect(columns).toBeGreaterThan(1);
  expect(rows).toBe(Math.ceil(totalCount / columns));
  await expect.poll(() => numberAttribute(editor, "data-max-scroll")).toBe(0);

  const firstClip = page.getByTestId("timeline-clip-0");
  const lastClipInFirstRow = page.getByTestId(`timeline-clip-${columns - 1}`);
  const firstClipInSecondRow = page.getByTestId(`timeline-clip-${columns}`);
  await expect(firstClip).toBeVisible();
  await expect(lastClipInFirstRow).toBeVisible();
  await expect(firstClipInSecondRow).toBeVisible();

  const firstBox = await firstClip.boundingBox();
  const lastFirstRowBox = await lastClipInFirstRow.boundingBox();
  const secondRowBox = await firstClipInSecondRow.boundingBox();
  if (!firstBox || !lastFirstRowBox || !secondRowBox) {
    throw new Error("Grid clips are not visible");
  }

  expect(lastFirstRowBox.x + lastFirstRowBox.width - firstBox.x).toBeCloseTo(
    viewportWidth,
    0,
  );
  expect(secondRowBox.y).toBeGreaterThan(firstBox.y);
  expect(secondRowBox.x).toBeCloseTo(firstBox.x, 0);

  const initialScroll = await numberAttribute(viewport, "data-scroll-left");
  await dragBy(page, viewport, -300);
  await expect.poll(() => numberAttribute(viewport, "data-scroll-left")).toBe(initialScroll);
});

test("grid mode virtualizes rows for huge item counts", async ({ page }) => {
  await page.goto(THUMBNAIL_VIRTUALIZED_URL);
  const editor = page.getByTestId("timeline-editor");
  const viewport = page.getByTestId("timeline-scroll-viewport");

  await page.getByRole("switch", { name: "Grid Mode" }).click();
  await expect(editor).toHaveAttribute("data-grid-mode", "true");

  const totalCount = await numberAttribute(editor, "data-item-count");
  await expect.poll(() => numberAttribute(editor, "data-max-scroll")).toBe(0);
  await expect.poll(() => numberAttribute(editor, "data-max-scroll-top")).toBeGreaterThan(0);
  await expect.poll(() => page.locator("[data-testid^='timeline-clip-']").count()).toBeLessThan(totalCount);

  await viewport.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    window.scrollTo({ top: document.documentElement.scrollHeight });
    window.dispatchEvent(new Event("scroll"));
  });

  await expect.poll(() => numberAttribute(viewport, "data-scroll-top")).toBeGreaterThan(0);
  await expect.poll(() => viewport.evaluate((element) => element.scrollTop)).toBe(0);
  await expect(page.getByTestId(`timeline-clip-${totalCount - 1}`)).toBeVisible();
});

test("grid mode virtualizes independently for multiple timelines", async ({ page }) => {
  await page.goto(MULTIPLE_THUMBNAIL_TIMELINES_URL);
  const editors = page.getByTestId("timeline-editor");
  const firstEditor = editors.nth(0);
  const secondEditor = editors.nth(1);

  await expect(firstEditor).toBeVisible();
  await expect(secondEditor).toBeVisible();

  await page.getByRole("switch", { name: "Grid Mode" }).nth(0).click();
  await page.getByRole("switch", { name: "Grid Mode" }).nth(1).click();

  await expect(firstEditor).toHaveAttribute("data-grid-mode", "true");
  await expect(secondEditor).toHaveAttribute("data-grid-mode", "true");
  await expect.poll(() => numberAttribute(firstEditor, "data-scroll-top")).toBeGreaterThanOrEqual(0);
  await expect.poll(() => numberAttribute(secondEditor, "data-scroll-top")).toBeLessThan(0);

  await secondEditor.evaluate((element) => {
    element.scrollIntoView({ block: "start" });
    window.dispatchEvent(new Event("scroll"));
  });

  await expect.poll(() => numberAttribute(secondEditor, "data-scroll-top")).toBeGreaterThanOrEqual(0);
  await expect(secondEditor.getByTestId("timeline-clip-0")).toBeVisible();
});

test("passive filmstrip is hidden for the active video clip", async ({ page }) => {
  await page.getByRole("switch", { name: "Filmstrips" }).click();
  await expect(page.locator('[data-testid="timeline-passive-filmstrip"][data-clip-index="0"]')).toBeVisible();

  await page.getByTestId("timeline-clip-0").click();

  await expect(page.getByTestId("timeline-source-filmstrip")).toHaveAttribute("data-clip-index", "0");
  await expect(page.locator('[data-testid="timeline-passive-filmstrip"][data-clip-index="0"]')).toHaveCount(0);
  await expect(page.getByTestId("timeline-source-trim-left")).toBeVisible();
  await expect(page.getByTestId("timeline-source-trim-right")).toBeVisible();
});

test("play bar setting hides the bar area above timeline items", async ({ page }) => {
  const editor = page.getByTestId("timeline-editor");
  const firstClip = page.getByTestId("timeline-clip-0");
  const initialHeight = await numberAttribute(editor, "data-timeline-height");

  await expect(editor).toHaveAttribute("data-playbar-area", "true");
  await expect(page.getByTestId("timeline-passive-filmstrip").first()).toBeVisible();

  await page.getByRole("switch", { name: "Play bar" }).click();

  await expect(editor).toHaveAttribute("data-playbar-area", "false");
  await expect(page.getByTestId("timeline-passive-filmstrip")).toHaveCount(0);
  await expect(page.getByTestId("timeline-source-filmstrip")).toHaveCount(0);
  await expect(page.getByRole("switch", { name: "Filmstrips" })).toHaveCount(0);
  await expect.poll(() => numberAttribute(editor, "data-timeline-height")).toBeLessThan(initialHeight);

  await firstClip.click();
  await expect(firstClip).toHaveAttribute("data-selected", "true");
  await expect(page.getByTestId("timeline-source-filmstrip")).toHaveCount(0);
});

test("selecting a video hides all passive filmstrips", async ({ page }) => {
  await page.getByRole("switch", { name: "Filmstrips" }).click();
  await page.getByTestId("timeline-clip-0").click();

  await expect(page.getByTestId("timeline-source-filmstrip")).toHaveAttribute("data-clip-index", "0");
  await expect(page.getByTestId("timeline-passive-filmstrip")).toHaveCount(0);
});

test("dragging a passive filmstrip scrubs with the playhead without panning the timeline", async ({ page }) => {
  const viewport = page.getByTestId("timeline-scroll-viewport");
  await page.getByRole("switch", { name: "Filmstrips" }).click();

  const firstFilmstrip = page.locator(
    '[data-testid="timeline-passive-filmstrip"][data-clip-index="0"]',
  );
  const nextFilmstrip = page.locator(
    '[data-testid="timeline-passive-filmstrip"][data-clip-index="4"]',
  );
  await expect(firstFilmstrip).toBeVisible();
  await expect(nextFilmstrip).toBeVisible();

  const firstBox = await firstFilmstrip.boundingBox();
  const nextBox = await nextFilmstrip.boundingBox();
  if (!firstBox || !nextBox) throw new Error("Passive filmstrips are not visible");
  const initialScroll = await numberAttribute(viewport, "data-scroll-left");

  await page.mouse.move(firstBox.x + firstBox.width / 2, firstBox.y + firstBox.height / 2);
  await page.mouse.down();
  await expect(page.getByTestId("timeline-passive-scrub-overlay")).toHaveCount(0);
  const playhead = page.getByTestId("timeline-playhead");
  await expect(playhead).toBeVisible();
  const initialPlayheadLeft = await playhead.evaluate((element) => element.style.left);

  await page.mouse.move(nextBox.x + nextBox.width / 2, nextBox.y + nextBox.height / 2, { steps: 12 });

  await expect.poll(() => playhead.evaluate((element) => element.style.left)).not.toBe(initialPlayheadLeft);
  await expect.poll(() => numberAttribute(viewport, "data-scroll-left")).toBe(initialScroll);

  await page.mouse.up();
  await expect(page.getByTestId("timeline-passive-scrub-overlay")).toHaveCount(0);
});

test("left trim grows the first clip into available source", async ({ page }) => {
  const clip = page.getByTestId("timeline-clip-0");
  await clip.click();
  const initialDuration = await numberAttribute(clip, "data-duration");
  const initialTrimIn = await numberAttribute(clip, "data-trim-in");

  await dragBy(page, page.getByTestId("timeline-trim-left"), -40);

  await expect.poll(() => numberAttribute(clip, "data-duration")).toBeGreaterThan(initialDuration);
  await expect.poll(() => numberAttribute(clip, "data-trim-in")).toBeLessThan(initialTrimIn);
});

test("right trim changes duration and keeps source accounting valid", async ({ page }) => {
  const clip = page.getByTestId("timeline-clip-0");
  await clip.click();
  const initialDuration = await numberAttribute(clip, "data-duration");

  await dragBy(page, page.getByTestId("timeline-trim-right"), 40);

  await expect.poll(() => numberAttribute(clip, "data-duration")).toBeGreaterThan(initialDuration);
  const sourceDuration = await numberAttribute(clip, "data-source-duration");
  const trimIn = await numberAttribute(clip, "data-trim-in");
  const duration = await numberAttribute(clip, "data-duration");
  const trimOut = await numberAttribute(clip, "data-trim-out");
  expect(trimIn + duration + trimOut).toBeCloseTo(sourceDuration, 4);
});

test("keyboard nudge trims by the configured pixel step", async ({ page }) => {
  const clip = page.getByTestId("timeline-clip-0");
  await clip.click();
  const initialDuration = await numberAttribute(clip, "data-duration");

  const leftHandle = page.getByTestId("timeline-trim-left");
  await leftHandle.focus();
  await leftHandle.press("ArrowRight");

  await expect.poll(() => numberAttribute(clip, "data-duration")).toBeLessThan(initialDuration);
});

test("pans with a real pointer drag and virtualizes a large list", async ({ page }) => {
  await page.goto("/iframe.html?id=gstudio-timeline-smoothscrolllist--virtualized-thousand-clips&viewMode=story");
  const viewport = page.getByTestId("timeline-scroll-viewport");
  const initialScroll = await numberAttribute(viewport, "data-scroll-left");

  await dragBy(page, viewport, -300);

  await expect.poll(() => numberAttribute(viewport, "data-scroll-left")).toBeGreaterThan(initialScroll);
  await expect(page.locator("[data-testid^='timeline-clip-']")).not.toHaveCount(1000);
});

test("horizontal drag on a clip pans instead of reordering", async ({ page }) => {
  const viewport = page.getByTestId("timeline-scroll-viewport");
  const clip = page.locator('[data-clip-id="clip-0"]');
  const initialScroll = await numberAttribute(viewport, "data-scroll-left");

  await dragBy(page, clip, -240);

  await expect.poll(() => numberAttribute(viewport, "data-scroll-left")).toBeGreaterThan(initialScroll);
  await expect(clip).toHaveAttribute("data-clip-index", "0");
  await expect(page.getByTestId("timeline-editor")).toHaveAttribute("data-reordering", "false");
});

test("upward lift on a clip reorders it in the timeline", async ({ page }) => {
  const editor = page.getByTestId("timeline-editor");
  const clip = page.locator('[data-clip-id="clip-0"]');
  const target = page.locator('[data-clip-id="clip-3"]');
  const clipBox = await clip.boundingBox();
  const targetBox = await target.boundingBox();
  if (!clipBox || !targetBox) throw new Error("Timeline clips are not visible");

  const startX = clipBox.x + clipBox.width / 2;
  const startY = clipBox.y + clipBox.height / 2;
  const targetX = targetBox.x + targetBox.width / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX, startY - 60, { steps: 6 });
  await expect(editor).toHaveAttribute("data-reordering", "true");
  await page.mouse.move(targetX, startY - 60, { steps: 12 });
  await page.mouse.up();

  await expect(editor).toHaveAttribute("data-reordering", "false");
  await expect(clip).not.toHaveAttribute("data-clip-index", "0");
});

test("lifted reorder hides passive filmstrips while dragging", async ({ page }) => {
  const editor = page.getByTestId("timeline-editor");
  const clip = page.locator('[data-clip-id="clip-0"]');

  await page.getByRole("switch", { name: "Filmstrips" }).click();
  await expect(page.getByTestId("timeline-passive-filmstrip").first()).toBeVisible();

  await beginLiftedReorder(page, clip);

  await expect(editor).toHaveAttribute("data-reordering", "true");
  await expect(page.getByTestId("timeline-passive-filmstrip")).toHaveCount(0);
  await expect(page.getByTestId("timeline-source-filmstrip")).toHaveCount(0);

  await page.mouse.up();
  await expect(editor).toHaveAttribute("data-reordering", "false");
});

test("lifted reorder hides the selected source filmstrip while dragging", async ({ page }) => {
  const editor = page.getByTestId("timeline-editor");
  const clip = page.locator('[data-clip-id="clip-0"]');

  await clip.click();
  await expect(page.getByTestId("timeline-source-filmstrip")).toHaveAttribute("data-clip-index", "0");

  await beginLiftedReorder(page, clip);

  await expect(editor).toHaveAttribute("data-reordering", "true");
  await expect(page.getByTestId("timeline-source-filmstrip")).toHaveCount(0);
  await expect(page.getByTestId("timeline-passive-filmstrip")).toHaveCount(0);

  await page.mouse.up();
  await expect(editor).toHaveAttribute("data-reordering", "false");
});

test("lifted reorder auto-scrolls when dragged past the visible timeline edge", async ({ page }) => {
  const editor = page.getByTestId("timeline-editor");
  const viewport = page.getByTestId("timeline-scroll-viewport");
  const clip = page.locator('[data-clip-id="clip-0"]');
  const clipBox = await clip.boundingBox();
  const viewportBox = await viewport.boundingBox();
  if (!clipBox || !viewportBox) throw new Error("Timeline clips are not visible");

  const startX = clipBox.x + clipBox.width / 2;
  const startY = clipBox.y + clipBox.height / 2;
  const initialScroll = await numberAttribute(viewport, "data-scroll-left");

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX, startY - 60, { steps: 6 });
  await expect(editor).toHaveAttribute("data-reordering", "true");
  await page.mouse.move(viewportBox.x + viewportBox.width + 80, startY - 60, { steps: 12 });

  await expect.poll(() => numberAttribute(viewport, "data-scroll-left")).toBeGreaterThan(initialScroll);
  await page.mouse.up();

  await expect(editor).toHaveAttribute("data-reordering", "false");
  await expect(clip).not.toHaveAttribute("data-clip-index", "0");
});

test("preserves time-space behavior after zoom changes", async ({ page }) => {
  const editor = page.getByTestId("timeline-editor");
  const zoom = page.getByLabel("Zoom");
  await zoom.fill("200");

  await expect(editor).toHaveAttribute("data-zoom", "200");
  const clip = page.getByTestId("timeline-clip-0");
  await clip.click();
  const initialDuration = await numberAttribute(clip, "data-duration");
  await dragBy(page, page.getByTestId("timeline-trim-right"), 40);

  await expect.poll(() => numberAttribute(clip, "data-duration")).toBeCloseTo(initialDuration + 0.2, 1);
});

test.describe("first item edge behavior", () => {
  test("selection creates left source overhang without moving before time zero", async ({ page }) => {
    await openStory(page, FIRST_STORY_URL);
    const editor = page.getByTestId("timeline-editor");
    const clip = page.getByTestId("timeline-clip-0");
    const viewport = page.getByTestId("timeline-scroll-viewport");

    await expect(clip).toHaveAttribute("data-start-time", "0");
    await expect.poll(() => numberAttribute(editor, "data-first-overhang")).toBeGreaterThan(0);
    const overhang = await numberAttribute(editor, "data-first-overhang");
    const scrollLeft = await numberAttribute(viewport, "data-scroll-left");
    expect(scrollLeft).toBeCloseTo(overhang, 0);
  });

  test("left trim grows only toward the boundary and keeps the first clip anchored", async ({ page }) => {
    await openStory(page, FIRST_STORY_URL);
    const clip = page.getByTestId("timeline-clip-0");
    const nextClip = page.getByTestId("timeline-clip-1");
    const initialDuration = await numberAttribute(clip, "data-duration");
    const initialNextStart = await numberAttribute(nextClip, "data-start-time");

    await dragBy(page, page.getByTestId("timeline-trim-left"), -80);

    await expect(clip).toHaveAttribute("data-start-time", "0");
    await expect.poll(() => numberAttribute(clip, "data-duration")).toBeGreaterThan(initialDuration);
    await expect.poll(() => numberAttribute(nextClip, "data-start-time")).toBeGreaterThan(initialNextStart);
  });

  test("first source-left handle clamps at the beginning of the media", async ({ page }) => {
    await openStory(page, FIRST_STORY_URL);
    const clip = page.getByTestId("timeline-clip-0");

    await dragBy(page, page.getByTestId("timeline-source-trim-left"), -1000);

    await expect.poll(() => numberAttribute(clip, "data-trim-in")).toBe(0);
    await expect(clip).toHaveAttribute("data-start-time", "0");
  });

  test("deselecting the first clip removes its special overhang", async ({ page }) => {
    await openStory(page, FIRST_STORY_URL);
    const editor = page.getByTestId("timeline-editor");
    const clip = page.getByTestId("timeline-clip-0");
    await expect.poll(() => numberAttribute(editor, "data-first-overhang")).toBeGreaterThan(0);

    await clip.click();

    await expect(editor).toHaveAttribute("data-selected-index", "");
    await expect.poll(() => numberAttribute(editor, "data-first-overhang")).toBe(0);
  });
});

test.describe("last item edge behavior", () => {
  test("selection creates right source overhang for the last clip", async ({ page }) => {
    await openLastStory(page);
    const editor = page.getByTestId("timeline-editor");
    const lastClip = page.getByTestId("timeline-clip-11");

    await expect(lastClip).toHaveAttribute("data-selected", "true");
    await expect.poll(() => numberAttribute(editor, "data-last-overhang")).toBeGreaterThan(0);
    await expect(page.getByTestId("timeline-source-filmstrip")).toHaveAttribute("data-clip-index", "11");
  });

  test("right trim extends the last clip and timeline end together", async ({ page }) => {
    await openLastStory(page);
    const editor = page.getByTestId("timeline-editor");
    const lastClip = page.getByTestId("timeline-clip-11");
    const initialDuration = await numberAttribute(lastClip, "data-duration");
    const initialTimelineWidth = await numberAttribute(editor, "data-timeline-width");
    const initialOverhang = await numberAttribute(editor, "data-last-overhang");
    await revealTimelineEnd(page);

    await dragFromVisibleRightEdge(page, page.getByTestId("timeline-trim-right"), 80);

    await expect.poll(() => numberAttribute(lastClip, "data-duration")).toBeGreaterThan(initialDuration);
    await expect.poll(() => numberAttribute(editor, "data-last-overhang")).toBeLessThan(initialOverhang);
    await expect.poll(async () => (
      Math.abs(await numberAttribute(editor, "data-timeline-width") - initialTimelineWidth) <= 1
    )).toBe(true);
  });

  test("last source-right handle clamps at the media end", async ({ page }) => {
    await openLastStory(page);
    const lastClip = page.getByTestId("timeline-clip-11");
    await revealTimelineEnd(page);

    await dragFromVisibleRightEdge(page, page.getByTestId("timeline-source-trim-right"), 1000);

    await expect.poll(() => numberAttribute(lastClip, "data-trim-out")).toBe(0);
    const sourceDuration = await numberAttribute(lastClip, "data-source-duration");
    const trimIn = await numberAttribute(lastClip, "data-trim-in");
    const duration = await numberAttribute(lastClip, "data-duration");
    expect(trimIn + duration).toBeCloseTo(sourceDuration, 4);
  });

  test("shrinking the last clip never leaves scroll beyond the new timeline end", async ({ page }) => {
    await openLastStory(page);
    const editor = page.getByTestId("timeline-editor");
    const viewport = page.getByTestId("timeline-scroll-viewport");

    await dragBy(page, page.getByTestId("timeline-trim-right"), -160);

    await expect.poll(async () => {
      const scrollLeft = await numberAttribute(viewport, "data-scroll-left");
      const maxScroll = await numberAttribute(editor, "data-max-scroll");
      return scrollLeft <= maxScroll + 1;
    }).toBe(true);
  });

  test("deselecting the last clip removes right overhang without invalid scroll", async ({ page }) => {
    await openLastStory(page);
    const editor = page.getByTestId("timeline-editor");
    const viewport = page.getByTestId("timeline-scroll-viewport");
    const lastClip = page.getByTestId("timeline-clip-11");
    await expect.poll(() => numberAttribute(editor, "data-last-overhang")).toBeGreaterThan(0);

    await lastClip.click();

    await expect.poll(() => numberAttribute(editor, "data-last-overhang")).toBe(0);
    await expect.poll(() => viewport.evaluate((element) => (
      element.scrollLeft <= element.scrollWidth - element.clientWidth + 1
    ))).toBe(true);
  });
});
