import { expect, test, type Locator, type Page } from "@playwright/test";

const STORY_URL = "/iframe.html?id=gstudio-timeline-smoothscrolllist--default&viewMode=story";
const FIRST_STORY_URL = "/iframe.html?id=gstudio-timeline-smoothscrolllist--first-clip-selected-at-timeline-start&viewMode=story";
const LAST_STORY_URL = "/iframe.html?id=gstudio-timeline-smoothscrolllist--last-clip-selected-at-timeline-end&viewMode=story";

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
  await expect(page.getByTestId("timeline-rendered-count")).toContainText("/1000 rendered");
  await expect(page.locator("[data-testid^='timeline-clip-']")).not.toHaveCount(1000);
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
