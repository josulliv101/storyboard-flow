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
