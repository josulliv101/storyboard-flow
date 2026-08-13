import { expect, test, type Locator, type Page } from '@playwright/test';
import { at } from "../../lib/test-support/at";

// E2E coverage for packages/ui/dnd-collections, driven with REAL mouse input
// against the Storybook iframe (the vitest story tests dispatch synthetic
// PointerEvents; this suite is the trusted-input layer on top). Uses the
// Playground story's standard fixture:
//   panel-a: [alpha, bravo, charlie, folder-f(f1), delta]
//   panel-b: [xray, yankee]
// with folder-f also mounted as its own panel.

const storyPath = (storyId: string) => `/iframe.html?id=${storyId}&viewMode=story`;
const PLAYGROUND = 'ui-dndcollections--playground';

const card = (page: Page, id: string): Locator => page.locator(`[data-node-id="${id}"]`);

async function panelOrder(page: Page, panelId: string): Promise<string[]> {
  return page
    .locator(`[data-panel-droppable="${panelId}"] [data-node-id]`)
    .evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.nodeId ?? ''));
}

/** Real-mouse drag with a settle dwell before release (dnd-kit measures on a cadence). */
async function mouseDrag(
  page: Page,
  source: Locator,
  target: Locator,
  targetXRatio = 0.5
): Promise<void> {
  await source.waitFor({ state: 'visible' });
  await target.waitFor({ state: 'visible' });
  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();
  expect(sourceBox).not.toBeNull();
  expect(targetBox).not.toBeNull();

  const startX = sourceBox!.x + sourceBox!.width / 2;
  const startY = sourceBox!.y + sourceBox!.height / 2;
  const endX = targetBox!.x + targetBox!.width * targetXRatio;
  const endY = targetBox!.y + targetBox!.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 10, startY, { steps: 3 }); // past activation distance
  await page.mouse.move(endX, endY, { steps: 12 });
  await page.waitForTimeout(150); // dwell: let collision/intent settle
  await page.mouse.up();
}

test.describe('DndCollections E2E', () => {
  test('virtual strip mounts/unmounts items under real wheel scroll', async ({ page }) => {
    await page.goto(storyPath('ui-dndcollectionsvirtual--virtual-playground'));
    const strip = page.locator('[data-virtual-strip="strip"]');
    await strip.locator('[data-node-id="m0"]').waitFor({ state: 'visible' });

    // 1,000 items exist in the graph; only a viewport's worth in the DOM.
    expect(await strip.locator('[data-node-id]').count()).toBeLessThan(50);

    await strip.hover();
    for (let i = 0; i < 8; i++) await page.mouse.wheel(8000, 0);

    // Far items mount, the start of the strip unmounts.
    await expect(strip.locator('[data-node-id="m0"]')).toHaveCount(0);
    await expect(async () => {
      const ids = await strip
        .locator('[data-node-id]')
        .evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.nodeId ?? ''));
      expect(ids.length).toBeGreaterThan(0);
      expect(ids.length).toBeLessThan(50);
      expect(ids.some((id) => Number(id.slice(1)) > 300)).toBe(true);
    }).toPass();
  });

  test('palette: real-mouse drag adds a new node into the panel', async ({ page }) => {
    await page.goto(storyPath('ui-dndcollectionspalette--palette-playground'));
    const palette = page.locator('[data-palette-item="new-image"]');
    const bravo = page.locator('[data-node-id="bravo"]');
    await bravo.waitFor({ state: 'visible' });

    // Drop on bravo's left half: the new node inserts before it.
    await mouseDrag(page, palette, bravo, 0.15);

    await expect(async () => {
      const ids = await panelOrder(page, 'panel-a');
      expect(ids).toHaveLength(4);
      expect(ids[1]).toMatch(/^img-/);
      expect(ids[2]).toBe('bravo');
    }).toPass();
  });

  test('palette: real-mouse drag adds a new collection that accepts drops', async ({ page }) => {
    await page.goto(storyPath('ui-dndcollectionspalette--palette-playground'));
    const palette = page.locator('[data-palette-item="new-collection"]');
    const charlie = page.locator('[data-node-id="charlie"]');
    await charlie.waitFor({ state: 'visible' });

    await mouseDrag(page, palette, charlie, 0.85);

    let newId = '';
    await expect(async () => {
      const ids = await panelOrder(page, 'panel-a');
      expect(ids).toHaveLength(4);
      expect(ids[3]).toMatch(/^col-/);
      newId = at(ids, 3);
    }).toPass();

    // The fresh collection is immediately droppable: nest alpha inside.
    await mouseDrag(page, card(page, 'alpha'), card(page, newId), 0.5);
    await expect(async () => {
      expect(await panelOrder(page, 'panel-a')).toHaveLength(3);
    }).toPass();
    await expect(card(page, newId)).toHaveAttribute('aria-label', /collection, 1 items/i);
  });

  test('virtual grid mounts/unmounts rows under real wheel scroll', async ({ page }) => {
    await page.goto(storyPath('ui-dndcollectionsvirtualgrid--grid-playground'));
    const grid = page.locator('[data-virtual-grid="grid"]');
    await grid.locator('[data-node-id="m0"]').waitFor({ state: 'visible' });

    expect(await grid.locator('[data-node-id]').count()).toBeLessThan(60);

    await grid.hover();
    for (let i = 0; i < 6; i++) await page.mouse.wheel(0, 5000);

    await expect(grid.locator('[data-node-id="m0"]')).toHaveCount(0);
    await expect(async () => {
      const ids = await grid
        .locator('[data-node-id]')
        .evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.nodeId ?? ''));
      expect(ids.length).toBeGreaterThan(0);
      expect(ids.length).toBeLessThan(60);
      expect(ids.some((id) => Number(id.slice(1)) > 300)).toBe(true);
    }).toPass();
  });

  test('strip pan: real-mouse flick on a card body scrolls with momentum, no drag/select', async ({
    page,
  }) => {
    await page.goto(storyPath('ui-dndcollectionsvirtual--virtual-playground'));
    const strip = page.locator('[data-virtual-strip="strip"]');
    const m3 = strip.locator('[data-node-id="m3"]');
    await m3.waitFor({ state: 'visible' });
    const box = await m3.boundingBox();
    const startX = box!.x + box!.width / 2;
    const y = box!.y + box!.height / 2;

    await page.mouse.move(startX, y);
    await page.mouse.down();
    for (let i = 1; i <= 4; i++) {
      await page.mouse.move(startX - i * 30, y);
      await page.waitForTimeout(16);
    }
    await page.mouse.up();

    // Panned while held, then keeps gliding after release.
    const atRelease = await strip.evaluate((el) => el.scrollLeft);
    expect(atRelease).toBeGreaterThan(80);
    await expect(async () => {
      expect(await strip.evaluate((el) => el.scrollLeft)).toBeGreaterThan(atRelease + 30);
    }).toPass();

    // The pan neither started an item drag nor selected the card (the
    // post-pan click is suppressed).
    expect(await page.locator('[data-testid="drag-ghost"]').count()).toBe(0);
    expect(await strip.locator('[data-selected]').count()).toBe(0);
  });

  test('strip hold-to-drag: real-mouse press-and-hold drags the item; fast flick pans', async ({
    page,
  }) => {
    await page.goto(storyPath('ui-dndcollectionsvirtual--hold-playground'));
    const strip = page.locator('[data-virtual-strip="strip"]');
    const m0 = strip.locator('[data-node-id="m0"]');
    await m0.waitFor({ state: 'visible' });

    // Press and HOLD the body past the 250ms delay, then drag to the m1/m2
    // gap: an item drag, not a pan.
    const m0Box = await m0.boundingBox();
    const m1Box = await strip.locator('[data-node-id="m1"]').boundingBox();
    const m2Box = await strip.locator('[data-node-id="m2"]').boundingBox();
    const gapX = (m1Box!.x + m1Box!.width + m2Box!.x) / 2;
    const gapY = m1Box!.y + m1Box!.height / 2;

    await page.mouse.move(m0Box!.x + m0Box!.width / 2, m0Box!.y + m0Box!.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(350); // past the hold delay — drag activates
    await page.mouse.move(gapX, gapY, { steps: 10 });
    await page.waitForTimeout(150);
    await page.mouse.up();

    await expect(async () => {
      const ids = await panelIds(strip);
      expect(ids.slice(0, 3)).toEqual(['m1', 'm0', 'm2']);
      expect(await strip.evaluate((el) => el.scrollLeft)).toBe(0); // no pan happened
    }).toPass();
    // Let dnd-kit's ~250ms DROP ANIMATION finish — the overlay ghost stays
    // mounted while it settles, and gesture 2 asserts on ghost count.
    await expect(page.locator('[data-testid="drag-ghost"]')).toHaveCount(0);

    // Fast flick (well under the delay): pans instead of dragging.
    const box = await strip.locator('[data-node-id="m3"]').boundingBox();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    for (let i = 1; i <= 4; i++) {
      await page.mouse.move(box!.x + box!.width / 2 - i * 30, box!.y + box!.height / 2);
      await page.waitForTimeout(16);
    }
    await page.mouse.up();
    await expect(async () => {
      expect(await strip.evaluate((el) => el.scrollLeft)).toBeGreaterThan(80);
    }).toPass();
    expect(await page.locator('[data-testid="drag-ghost"]').count()).toBe(0);

    async function panelIds(container: typeof strip) {
      return container
        .locator('[data-node-id]')
        .evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.nodeId ?? ''));
    }
  });

  test('virtual strip: auto-scroll carries a drag across the scroll boundary', async ({
    page,
  }) => {
    await page.goto(storyPath('ui-dndcollectionsvirtual--virtual-playground'));
    const strip = page.locator('[data-virtual-strip="strip"]');
    const m2Handle = strip.locator('[data-drag-handle="m2"]');
    await m2Handle.waitFor({ state: 'visible' });
    const stripBox = await strip.boundingBox();
    const box = await m2Handle.boundingBox();

    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    await page.mouse.move(box!.x + box!.width / 2 + 10, box!.y + 5, { steps: 3 });

    // Park inside the container's right edge: dnd-kit's auto-scroller takes
    // over, and the strip's boundary resolver reads scrollLeft live, so the
    // intent keeps tracking while content flies by.
    const edgeX = stripBox!.x + stripBox!.width - 10;
    const midY = stripBox!.y + stripBox!.height / 2;
    await page.mouse.move(edgeX, midY, { steps: 10 });
    for (let i = 0; i < 10; i++) {
      await page.waitForTimeout(100);
      await page.mouse.move(edgeX - (i % 2), midY); // keep events flowing
    }
    const scrolled = await strip.evaluate((el) => el.scrollLeft);
    expect(scrolled).toBeGreaterThan(300);
    await page.mouse.up();

    // The drop committed deep in the strip: back at the start, m2 is gone
    // from its old slot.
    await strip.evaluate((el) => {
      el.scrollLeft = 0;
    });
    await expect(async () => {
      const ids = await strip
        .locator('[data-node-id]')
        .evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.nodeId ?? ''));
      expect(ids.slice(0, 3)).toEqual(['m0', 'm1', 'm3']);
      expect(ids).not.toContain('m2');
    }).toPass();
  });

  test('virtual strip: drop at the left edge inserts at the start', async ({ page }) => {
    await page.goto(storyPath('ui-dndcollectionsvirtual--virtual-playground'));
    const strip = page.locator('[data-virtual-strip="strip"]');
    const m0 = strip.locator('[data-node-id="m0"]');
    const m3Handle = strip.locator('[data-drag-handle="m3"]');
    await m3Handle.waitFor({ state: 'visible' });
    const m0Box = await m0.boundingBox();
    const m3Box = await m3Handle.boundingBox();

    await page.mouse.move(m3Box!.x + m3Box!.width / 2, m3Box!.y + m3Box!.height / 2);
    await page.mouse.down();
    await page.mouse.move(m3Box!.x + m3Box!.width / 2 + 10, m3Box!.y + 5, { steps: 3 });
    // Container padding just left of the first card: boundary 0.
    await page.mouse.move(m0Box!.x - 4, m0Box!.y + m0Box!.height / 2, { steps: 12 });
    await page.waitForTimeout(150);
    await page.mouse.up();

    await expect(async () => {
      const ids = await strip
        .locator('[data-node-id]')
        .evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.nodeId ?? ''));
      expect(ids.slice(0, 4)).toEqual(['m3', 'm0', 'm1', 'm2']);
    }).toPass();
  });

  test('trim handle: real-mouse drag resizes live and commits on release', async ({ page }) => {
    // TrimPlayground is the play-less twin of TrimMediaWithHandles: same
    // graph/scale, but no play() to race a real-mouse drag on the handle.
    await page.goto(storyPath('ui-dndcollectionsvirtual--trim-playground'));

    const img = card(page, 'img');
    await img.waitFor({ state: 'visible' });
    const rightHandle = page.locator('[data-node-wrapper="img"] [data-trim-handle="right"]');
    await rightHandle.waitFor({ state: 'attached' });

    // 4s at 24px/s -> 96px.
    const initialBox = await img.boundingBox();
    expect(Math.round(initialBox!.width)).toBe(96);

    const handleBox = await rightHandle.boundingBox();
    const startX = handleBox!.x + handleBox!.width / 2;
    const startY = handleBox!.y + handleBox!.height / 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 48, startY, { steps: 12 });
    await page.waitForTimeout(150); // dwell: let the live preview settle

    // Live resize BEFORE release: +48px -> +2s -> 6s -> 144px, uncommitted.
    await expect(async () => {
      const box = await img.boundingBox();
      expect(Math.round(box!.width)).toBe(144);
    }).toPass();
    await expect(page.getByRole('button', { name: /undo/i })).toBeDisabled();

    await page.mouse.up();

    // Release commits it (no resize flash: same 144px as the live preview).
    await expect(page.getByRole('button', { name: /undo/i })).toBeEnabled();
    const committedBox = await img.boundingBox();
    expect(Math.round(committedBox!.width)).toBe(144);

    // Trims are ordinary undoable commands.
    await page.getByRole('button', { name: /undo/i }).click();
    await expect(async () => {
      const box = await img.boundingBox();
      expect(Math.round(box!.width)).toBe(96);
    }).toPass();
  });

  test('trim keyboard: real Alt+Shift+Arrow keys trim the focused card', async ({ page }) => {
    // Same play-less TrimPlayground fixture; here the trimming is real key
    // input (Alt+Shift+Arrow), the trusted-input twin of the KeyboardTrim
    // story. img 4s and vid 10s at 24px/s -> 96px / 240px.
    await page.goto(storyPath('ui-dndcollectionsvirtual--trim-playground'));

    const img = card(page, 'img');
    const vid = card(page, 'vid');
    await img.waitFor({ state: 'visible' });
    expect(Math.round((await img.boundingBox())!.width)).toBe(96);

    const widthOf = async (locator: Locator): Promise<number> =>
      Math.round((await locator.boundingBox())!.width);
    // Hold Alt+Shift, press an arrow, release — a real modifier chord.
    const trim = async (key: string): Promise<void> => {
      await page.keyboard.down('Alt');
      await page.keyboard.down('Shift');
      await page.keyboard.press(key);
      await page.keyboard.up('Shift');
      await page.keyboard.up('Alt');
    };

    // Focus the image card, then step its END edge: right lengthens (+1s ->
    // 120px), left shortens back.
    await img.click();
    await expect(img).toBeFocused();
    await trim('ArrowRight');
    await expect(async () => expect(await widthOf(img)).toBe(120)).toPass();
    await expect(page.getByRole('button', { name: /undo/i })).toBeEnabled();
    await trim('ArrowLeft');
    await expect(async () => expect(await widthOf(img)).toBe(96)).toPass();

    // Video END edge: left shortens (trim-out +1s -> 9s -> 216px). START edge:
    // up trims the start (trim-in +1s -> 8s -> 192px), down gives it back.
    await vid.click();
    await expect(vid).toBeFocused();
    await trim('ArrowLeft');
    await expect(async () => expect(await widthOf(vid)).toBe(216)).toPass();
    await trim('ArrowUp');
    await expect(async () => expect(await widthOf(vid)).toBe(192)).toPass();
    await trim('ArrowDown');
    await expect(async () => expect(await widthOf(vid)).toBe(216)).toPass();

    // Undo reverts the last trim (ordinary undoable command).
    await page.getByRole('button', { name: /undo/i }).click();
    await expect(async () => expect(await widthOf(vid)).toBe(192)).toPass();

    // Alt+Shift+End SLIDES the source window later (trim-in 1s -> 2s,
    // trim-out 1s -> 0s): the clip's width holds — the observable is the
    // floating overview, whose anchor (clipLeft - trimIn * pps) shifts left
    // by exactly the slide (24px at 24 px/s).
    const overview = page.locator('[data-trim-overview="vid"]');
    await overview.waitFor({ state: 'visible' });
    const overviewLeft0 = (await overview.boundingBox())!.x;
    // The undo click moved focus to the button — the chord needs the card.
    await vid.click();
    await expect(vid).toBeFocused();
    await trim('End');
    await expect(async () => {
      expect(Math.round((await overview.boundingBox())!.x)).toBe(Math.round(overviewLeft0 - 24));
    }).toPass();
    expect(await widthOf(vid)).toBe(192); // duration (and width) unchanged
  });

  test('trim overview: the showing window stays aligned to the clip during a real drag', async ({
    page,
  }) => {
    // TrimPlayground pre-selects "vid" (SelectOnMount), so the overview band
    // renders on load, directly above the video card. Its window's left/right
    // edges must pixel-match the card's own edges at rest AND live, mid-drag
    // — not just after the commit.
    await page.goto(storyPath('ui-dndcollectionsvirtual--trim-playground'));

    const vid = card(page, 'vid');
    const overviewWindow = page.locator('[data-trim-overview-window]');
    await vid.waitFor({ state: 'visible' });
    await overviewWindow.waitFor({ state: 'visible' });

    const expectAligned = async () => {
      const clipBox = (await vid.boundingBox())!;
      const windowBox = (await overviewWindow.boundingBox())!;
      expect(Math.round(windowBox.x)).toBe(Math.round(clipBox.x));
      expect(Math.round(windowBox.x + windowBox.width)).toBe(Math.round(clipBox.x + clipBox.width));
    };
    await expectAligned();

    const leftHandle = page.locator('[data-node-wrapper="vid"] [data-trim-handle="left"]');
    await leftHandle.waitFor({ state: 'attached' });
    const handleBox = (await leftHandle.boundingBox())!;
    const startX = handleBox.x + handleBox.width / 2;
    const startY = handleBox.y + handleBox.height / 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 24, startY, { steps: 12 }); // trimIn +1s, live
    await page.waitForTimeout(150); // dwell: let the live preview settle
    await expectAligned();

    await page.mouse.up();
    await expectAligned();
  });

  test('trim left-grows-left: real-mouse left drag anchors the right edge, pushes left neighbors', async ({
    page,
  }) => {
    // PhaseBPlayground is a scrollable strip with a video at index 3
    // (effective 7s -> 168px) flanked by image neighbors. Dragging its LEFT
    // handle left grows the clip toward the left: right edge anchored, left
    // neighbor pushed left, right neighbor stays put.
    await page.goto(storyPath('ui-dndcollectionsvirtual--phase-b-playground'));

    const vid = card(page, 'vid');
    await vid.waitFor({ state: 'visible' });
    const leftNeighbor = card(page, 'l2');
    const rightNeighbor = card(page, 'r0');
    await leftNeighbor.waitFor({ state: 'visible' });
    await rightNeighbor.waitFor({ state: 'visible' });

    expect(Math.round((await vid.boundingBox())!.width)).toBe(168);
    const vidBox0 = (await vid.boundingBox())!;
    const vidRight0 = vidBox0.x + vidBox0.width;
    const l2Right0 = (await leftNeighbor.boundingBox())!.x + (await leftNeighbor.boundingBox())!.width;
    const r0Left0 = (await rightNeighbor.boundingBox())!.x;

    const leftHandle = page.locator('[data-node-wrapper="vid"] [data-trim-handle="left"]');
    await leftHandle.waitFor({ state: 'attached' });
    const hb = (await leftHandle.boundingBox())!;
    const startX = hb.x + hb.width / 2;
    const startY = hb.y + hb.height / 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX - 48, startY, { steps: 12 }); // trim-in 3s -> 1s
    await page.waitForTimeout(150); // dwell

    // Live, before release: width grew to 216, right edge anchored, left
    // neighbor pushed left by ~48, right neighbor unmoved.
    await expect(async () => {
      expect(Math.round((await vid.boundingBox())!.width)).toBe(216);
    }).toPass();
    const vidBox1 = (await vid.boundingBox())!;
    expect(Math.abs(vidBox1.x + vidBox1.width - vidRight0)).toBeLessThanOrEqual(1);
    const l2Box1 = (await leftNeighbor.boundingBox())!;
    expect(Math.round(l2Box1.x + l2Box1.width)).toBe(Math.round(l2Right0 - 48));
    expect(Math.round((await rightNeighbor.boundingBox())!.x)).toBe(Math.round(r0Left0));
    await expect(page.getByRole('button', { name: /undo/i })).toBeDisabled();

    await page.mouse.up();

    // Commit holds the anchored position (no flash).
    await expect(page.getByRole('button', { name: /undo/i })).toBeEnabled();
    const vidBox2 = (await vid.boundingBox())!;
    expect(Math.round(vidBox2.width)).toBe(216);
    expect(Math.abs(vidBox2.x + vidBox2.width - vidRight0)).toBeLessThanOrEqual(1);

    // Undo reverts.
    await page.getByRole('button', { name: /undo/i }).click();
    await expect(async () => {
      expect(Math.round((await vid.boundingBox())!.width)).toBe(168);
    }).toPass();
  });

  test('trim left-shrink stays anchored: right edge held, left edge moves right, no scroll write', async ({
    page,
  }) => {
    // Regression for the reported inconsistency: at the strip start dragging
    // the left handle RIGHT (shrinking) used to clamp scrollLeft at 0 and
    // shrink the RIGHT edge inward. Now a composited transform anchors the
    // right edge with no per-frame scroll write (smooth + consistent).
    await page.goto(storyPath('ui-dndcollectionsvirtual--phase-b-playground'));

    const vid = card(page, 'vid');
    await vid.waitFor({ state: 'visible' });
    const strip = page.locator('[data-virtual-strip="strip"]');
    expect(await strip.evaluate((el) => el.scrollLeft)).toBe(0);

    const box0 = (await vid.boundingBox())!;
    const vidRight0 = box0.x + box0.width;
    const vidLeft0 = box0.x;

    const leftHandle = page.locator('[data-node-wrapper="vid"] [data-trim-handle="left"]');
    const hb = (await leftHandle.boundingBox())!;
    const startX = hb.x + hb.width / 2;
    const startY = hb.y + hb.height / 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 48, startY, { steps: 12 }); // trim-in 3s -> 5s
    await page.waitForTimeout(150);

    await expect(async () => {
      expect(Math.round((await vid.boundingBox())!.width)).toBe(120);
    }).toPass();
    const box1 = (await vid.boundingBox())!;
    // Right edge anchored; left edge moved right by the shrink; scroll untouched.
    expect(Math.abs(box1.x + box1.width - vidRight0)).toBeLessThanOrEqual(1);
    expect(Math.round(box1.x)).toBe(Math.round(vidLeft0 + 48));
    expect(await strip.evaluate((el) => el.scrollLeft)).toBe(0);

    await page.mouse.up();
    await expect(page.getByRole('button', { name: /undo/i })).toBeEnabled();
  });

  test('overview: right grip trims the clip; dragging the filmstrip moves the source window', async ({
    page,
  }) => {
    // OverviewPlayground pre-selects a video (full 10s, trim-in 2s, trim-out
    // 1.5s -> showing 6.5s -> 156px). The overview's amber grips trim; dragging
    // the filmstrip body moves the source window without changing duration.
    await page.goto(storyPath('ui-dndcollectionsvirtual--overview-playground'));

    const vid = card(page, 'vid');
    const overview = page.locator('[data-trim-overview]');
    const win = page.locator('[data-trim-overview-window]');
    await vid.waitFor({ state: 'visible' });
    await overview.waitFor({ state: 'visible' });
    expect(Math.round((await vid.boundingBox())!.width)).toBe(156);

    // Right grip in (left) 48px -> trim-out +2s -> showing 4.5s -> 108px.
    const rightGrip = page.locator('[data-trim-overview-handle="right"]');
    const g = (await rightGrip.boundingBox())!;
    await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
    await page.mouse.down();
    await page.mouse.move(g.x + g.width / 2 - 48, g.y + g.height / 2, { steps: 10 });
    await page.waitForTimeout(120);
    await expect(async () => {
      expect(Math.round((await vid.boundingBox())!.width)).toBe(108);
    }).toPass();
    const vb = (await vid.boundingBox())!;
    const wb = (await win.boundingBox())!;
    expect(Math.round(wb.x + wb.width)).toBe(Math.round(vb.x + vb.width)); // window on clip
    await page.mouse.up();
    await page.getByRole('button', { name: /undo/i }).click();
    await expect(async () => {
      expect(Math.round((await vid.boundingBox())!.width)).toBe(156);
    }).toPass();

    // Move: drag the filmstrip body (near its left, over the images) right 48px.
    // Duration unchanged; the clip doesn't move; the source strip slides right.
    const ob0 = (await overview.boundingBox())!;
    const vidLeft0 = (await vid.boundingBox())!.x;
    await page.mouse.move(ob0.x + 20, ob0.y + ob0.height / 2);
    await page.mouse.down();
    await page.mouse.move(ob0.x + 20 + 48, ob0.y + ob0.height / 2, { steps: 10 });
    await page.waitForTimeout(120);
    await expect(async () => {
      expect((await overview.boundingBox())!.x).toBeGreaterThan(ob0.x + 40);
    }).toPass();
    expect(Math.round((await vid.boundingBox())!.width)).toBe(156); // duration unchanged
    expect(Math.round((await vid.boundingBox())!.x)).toBe(Math.round(vidLeft0)); // clip unmoved
    const wb2 = (await win.boundingBox())!;
    expect(Math.round(wb2.x)).toBe(Math.round((await vid.boundingBox())!.x)); // window on clip
    await page.mouse.up();
    await expect(page.getByRole('button', { name: /undo/i })).toBeEnabled();
  });

  test('playhead overlay rides a live left-trim anchor and stays put on commit', async ({
    page,
  }) => {
    await page.goto(storyPath('ui-dndcollectionsvirtual--playhead-overlay-playground'));
    const strip = page.locator('[data-virtual-strip="strip"]');
    const video = card(page, 'vid');
    const playhead = page.locator('[data-playhead]');
    const leftHandle = video
      .locator('xpath=ancestor::*[@data-node-wrapper][1]')
      .locator('[data-trim-handle="left"]');
    await leftHandle.waitFor({ state: 'visible' });

    const videoBefore = (await video.boundingBox())!;
    const playheadBefore = (await playhead.boundingBox())!;
    const handleBox = (await leftHandle.boundingBox())!;
    const startX = handleBox.x + handleBox.width / 2;
    const startY = handleBox.y + handleBox.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX - 48, startY, { steps: 10 });

    await expect.poll(async () => Math.round((await video.boundingBox())!.width)).toBe(240);
    const videoLive = (await video.boundingBox())!;
    const playheadLive = (await playhead.boundingBox())!;
    expect(
      Math.abs(videoLive.x + videoLive.width - (videoBefore.x + videoBefore.width))
    ).toBeLessThanOrEqual(2);
    expect(Math.round(playheadLive.x - playheadBefore.x)).toBe(-48);

    await page.mouse.up();
    await expect
      .poll(async () => {
        const settled = (await playhead.boundingBox())!;
        return Math.abs(settled.x - playheadLive.x);
      })
      .toBeLessThanOrEqual(2);
    await expect
      .poll(() =>
        strip.locator('[role="row"]').evaluate((el) => getComputedStyle(el).transform)
      )
      .toBe('none');
  });

  test('real-mouse drag moves an item from a virtual strip into a virtual grid', async ({
    page,
  }) => {
    await page.goto(storyPath('ui-dndcollectionsvirtualgrid--strip-to-grid-playground'));
    const grid = page.locator('[data-virtual-grid="grid"]');
    await mouseDrag(page, page.locator('[data-drag-handle="s0"]'), card(page, 'g2'), 0.15);

    await expect
      .poll(async () =>
        grid.locator('[data-node-id]').evaluateAll((els) =>
          els.map((el) => (el as HTMLElement).dataset.nodeId ?? '')
        )
      )
      .toEqual(['g0', 'g1', 's0', 'g2', 'g3', 'g4', 'g5', 'g6', 'g7']);
    await expect(page.locator('[data-virtual-strip="strip"] [data-node-id="s0"]')).toHaveCount(0);
  });

  test('real-mouse trash drop is undoable', async ({ page }) => {
    await page.goto(storyPath('ui-dndcollectionspalette--palette-playground'));
    const trash = page.locator('[data-trash-target="trash"]');

    await mouseDrag(page, card(page, 'bravo'), trash);

    await expect.poll(() => panelOrder(page, 'panel-a')).toEqual(['alpha', 'charlie']);
    await expect(trash).toContainText(/trash \(1\)/i);

    await page.getByRole('button', { name: /undo/i }).click();
    await expect.poll(() => panelOrder(page, 'panel-a')).toEqual([
      'alpha',
      'bravo',
      'charlie',
    ]);
    await expect(trash).toHaveText(/^trash$/i);
  });

  test('reorders within a collection (drop on right half = after)', async ({ page }) => {
    await page.goto(storyPath(PLAYGROUND));

    await mouseDrag(page, card(page, 'alpha'), card(page, 'charlie'), 0.85);

    await expect(async () => {
      expect(await panelOrder(page, 'panel-a')).toEqual([
        'bravo',
        'charlie',
        'alpha',
        'folder-f',
        'delta',
      ]);
    }).toPass();
  });

  test('drop in the gap between two cards inserts between them, not at the end', async ({
    page,
  }) => {
    await page.goto(storyPath(PLAYGROUND));

    const bravo = card(page, 'bravo');
    const charlie = card(page, 'charlie');
    await charlie.waitFor({ state: 'visible' });
    const bravoBox = await bravo.boundingBox();
    const charlieBox = await charlie.boundingBox();

    // Midpoint of the horizontal gap: inside the panel droppable, over
    // neither card — the regression case where this used to append at end.
    const gapX = (bravoBox!.x + bravoBox!.width + charlieBox!.x) / 2;
    const gapY = bravoBox!.y + bravoBox!.height / 2;

    const deltaBox = await card(page, 'delta').boundingBox();
    await page.mouse.move(deltaBox!.x + deltaBox!.width / 2, deltaBox!.y + deltaBox!.height / 2);
    await page.mouse.down();
    await page.mouse.move(deltaBox!.x + deltaBox!.width / 2 + 10, deltaBox!.y + 5, { steps: 3 });
    await page.mouse.move(gapX, gapY, { steps: 12 });
    await page.waitForTimeout(150);
    await page.mouse.up();

    await expect(async () => {
      expect(await panelOrder(page, 'panel-a')).toEqual([
        'alpha',
        'bravo',
        'delta',
        'charlie',
        'folder-f',
      ]);
    }).toPass();
  });

  test('moves across collections (drop on left half = before)', async ({ page }) => {
    await page.goto(storyPath(PLAYGROUND));

    await mouseDrag(page, card(page, 'alpha'), card(page, 'yankee'), 0.15);

    await expect(async () => {
      expect(await panelOrder(page, 'panel-b')).toEqual(['xray', 'alpha', 'yankee']);
      expect(await panelOrder(page, 'panel-a')).toEqual(['bravo', 'charlie', 'folder-f', 'delta']);
    }).toPass();
  });

  test('nests into a collection card (drop dead-center)', async ({ page }) => {
    await page.goto(storyPath(PLAYGROUND));

    await mouseDrag(page, card(page, 'bravo'), card(page, 'folder-f'), 0.5);

    await expect(async () => {
      expect(await panelOrder(page, 'folder-f')).toEqual(['f1', 'bravo']);
      expect(await panelOrder(page, 'panel-a')).toEqual(['alpha', 'charlie', 'folder-f', 'delta']);
    }).toPass();
    // The collection card's accessible label reflects the new count.
    await expect(card(page, 'folder-f')).toHaveAttribute(
      'aria-label',
      /folder f \(collection, 2 items\)/i
    );
  });

  test('multi-select drags the whole selection with a count badge', async ({ page }) => {
    await page.goto(storyPath(PLAYGROUND));

    const alpha = card(page, 'alpha');
    const charlie = card(page, 'charlie');
    await alpha.click();
    await charlie.click({ modifiers: ['Control'] });
    await expect(alpha).toHaveAttribute('data-selected', 'true');
    await expect(charlie).toHaveAttribute('data-selected', 'true');

    // Drag alpha (a selected card) toward xray's left half — hold mid-drag to
    // verify the overlay badge, then release.
    const alphaBox = await alpha.boundingBox();
    const xrayBox = await card(page, 'xray').boundingBox();
    await page.mouse.move(alphaBox!.x + alphaBox!.width / 2, alphaBox!.y + alphaBox!.height / 2);
    await page.mouse.down();
    await page.mouse.move(alphaBox!.x + alphaBox!.width / 2 + 10, alphaBox!.y + 5, { steps: 3 });
    await page.mouse.move(xrayBox!.x + xrayBox!.width * 0.15, xrayBox!.y + xrayBox!.height / 2, {
      steps: 12,
    });
    await expect(page.locator('[data-testid="drag-ghost-count"]')).toHaveText('+1');
    await page.waitForTimeout(150);
    await page.mouse.up();

    await expect(async () => {
      expect(await panelOrder(page, 'panel-b')).toEqual(['alpha', 'charlie', 'xray', 'yankee']);
    }).toPass();
  });

  test('undo reverts a drag; redo replays it', async ({ page }) => {
    await page.goto(storyPath(PLAYGROUND));

    await mouseDrag(page, card(page, 'alpha'), card(page, 'yankee'), 0.85);
    await expect(async () => {
      expect(await panelOrder(page, 'panel-b')).toEqual(['xray', 'yankee', 'alpha']);
    }).toPass();

    await page.getByRole('button', { name: /undo/i }).click();
    await expect(async () => {
      expect(await panelOrder(page, 'panel-a')).toEqual([
        'alpha',
        'bravo',
        'charlie',
        'folder-f',
        'delta',
      ]);
      expect(await panelOrder(page, 'panel-b')).toEqual(['xray', 'yankee']);
    }).toPass();

    await page.getByRole('button', { name: /redo/i }).click();
    await expect(async () => {
      expect(await panelOrder(page, 'panel-b')).toEqual(['xray', 'yankee', 'alpha']);
    }).toPass();
  });

  test('cycle drop shows the invalid preview and rejects with a flash', async ({ page }) => {
    // NOTE: e2e must target PLAY-LESS stories. Storybook auto-runs a story's
    // play() on iframe load, and its synthetic pointer sequence interleaves
    // with Playwright's real mouse — a stray synthetic pointerup ends the
    // real drag mid-flight. CycleFixture is the play-less twin of
    // CycleRejectionFlash for exactly this reason.
    await page.goto(storyPath('ui-dndcollections--cycle-fixture'));

    const outer = card(page, 'outer');
    const inner = card(page, 'inner');
    await inner.waitFor({ state: 'visible' });

    const outerBox = await outer.boundingBox();
    const innerBox = await inner.boundingBox();

    await page.mouse.move(outerBox!.x + outerBox!.width / 2, outerBox!.y + outerBox!.height / 2);
    await page.mouse.down();
    await page.mouse.move(outerBox!.x + outerBox!.width / 2 + 10, outerBox!.y + 5, { steps: 3 });
    await page.mouse.move(innerBox!.x + innerBox!.width / 2, innerBox!.y + innerBox!.height / 2, {
      steps: 12,
    });

    // Live invalid preview while hovering.
    await expect(page.locator('[data-nest-state="invalid"]')).toBeVisible();
    await page.mouse.up();

    // Rejected: flash on the dragged card, graph unchanged.
    await expect(outer).toHaveAttribute('data-rejected', 'true');
    expect(await panelOrder(page, 'root')).toEqual(['outer', 'm1']);
    expect(await panelOrder(page, 'outer')).toEqual(['inner']);
  });
});
