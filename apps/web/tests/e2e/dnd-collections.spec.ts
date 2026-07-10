import { expect, test, type Locator, type Page } from '@playwright/test';

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

  test('virtual strip: auto-scroll carries a drag across the scroll boundary', async ({
    page,
  }) => {
    await page.goto(storyPath('ui-dndcollectionsvirtual--virtual-playground'));
    const strip = page.locator('[data-virtual-strip="strip"]');
    const m2 = strip.locator('[data-node-id="m2"]');
    await m2.waitFor({ state: 'visible' });
    const stripBox = await strip.boundingBox();
    const box = await m2.boundingBox();

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
    const m3 = strip.locator('[data-node-id="m3"]');
    await m3.waitFor({ state: 'visible' });
    const m0Box = await m0.boundingBox();
    const m3Box = await m3.boundingBox();

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
