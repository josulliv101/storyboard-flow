import { expect, test } from '@playwright/test';

const storyPath = (storyId: string) => `/iframe.html?id=${storyId}&viewMode=story`;

test.describe('MediaStrip E2E Reordering & Scroll Gestures', () => {
  
  test('pointer drag within strip', async ({ page }) => {
    await page.goto(storyPath('ui-mediastrip-mediastrip--reorderable-media-strips'));

    const handleA1 = page.locator('[data-reorder-handle="item-a1"]');
    const itemA2 = page.locator('[data-value="item-a2"]');

    await handleA1.waitFor({ state: 'visible' });
    await itemA2.waitFor({ state: 'visible' });

    const handleBox = await handleA1.boundingBox();
    const itemA2Box = await itemA2.boundingBox();

    expect(handleBox).not.toBeNull();
    expect(itemA2Box).not.toBeNull();

    const startX = handleBox!.x + handleBox!.width / 2;
    const startY = handleBox!.y + handleBox!.height / 2;
    const endX = itemA2Box!.x + itemA2Box!.width * 0.8;
    const endY = itemA2Box!.y + itemA2Box!.height / 2;

    // Perform drag
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(endX, endY, { steps: 10 });
    await page.mouse.up();

    // Verify visual order change: Item A2 should now be to the left of Item A1
    await expect(async () => {
      const boxA1 = await page.locator('[data-value="item-a1"]').boundingBox();
      const boxA2 = await page.locator('[data-value="item-a2"]').boundingBox();
      expect(boxA2!.x).toBeLessThan(boxA1!.x);
    }).toPass();
  });

  test('pointer drag across strips', async ({ page }) => {
    await page.goto(storyPath('ui-mediastrip-mediastrip--reorderable-media-strips'));

    const handleA1 = page.locator('[data-reorder-handle="item-a1"]');
    const itemB1 = page.locator('[data-value="item-b1"]');

    await handleA1.waitFor({ state: 'visible' });
    await itemB1.waitFor({ state: 'visible' });

    const handleBox = await handleA1.boundingBox();
    const itemB1Box = await itemB1.boundingBox();

    const startX = handleBox!.x + handleBox!.width / 2;
    const startY = handleBox!.y + handleBox!.height / 2;
    const endX = itemB1Box!.x + itemB1Box!.width / 2;
    const endY = itemB1Box!.y + itemB1Box!.height / 2;

    // Perform cross-strip drag
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(endX, endY, { steps: 10 });
    await page.mouse.up();

    // Verify item-a1 has moved into Strip B
    const stripB = page.locator('[data-testid="media-strip-strip-b"]');
    await expect(stripB.locator('[data-value="item-a1"]')).toBeVisible();
  });

  test('pointer drag into empty strip', async ({ page }) => {
    await page.goto(storyPath('ui-mediastrip-mediastrip--reorderable-media-strips'));

    const handleA1 = page.locator('[data-reorder-handle="item-a1"]');
    const stripC = page.locator('[data-testid="media-strip-strip-c"]');

    await handleA1.waitFor({ state: 'visible' });
    await stripC.waitFor({ state: 'visible' });

    const handleBox = await handleA1.boundingBox();
    const stripCBox = await stripC.boundingBox();

    const startX = handleBox!.x + handleBox!.width / 2;
    const startY = handleBox!.y + handleBox!.height / 2;
    const endX = stripCBox!.x + stripCBox!.width / 2;
    const endY = stripCBox!.y + stripCBox!.height / 2;

    // Perform drag into the empty strip C
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(endX, endY, { steps: 10 });
    await page.mouse.up();

    // Verify item-a1 has moved into Strip C
    await expect(stripC.locator('[data-value="item-a1"]')).toBeVisible();
  });

  test('drag-scroll inertia/click suppression & no accidental selection', async ({ page }) => {
    await page.goto(storyPath('ui-mediastrip-mediastrip--reorder-while-scrolled'));
    await page.reload();

    const viewport = page.locator('[data-slot="scroll-area-viewport"]');
    await viewport.waitFor({ state: 'visible' });

    // Explicitly reset scrollLeft to 0 to bypass potential browser scroll restoration
    await viewport.evaluate((el) => { el.scrollLeft = 0; });

    const viewportBox = await viewport.boundingBox();
    expect(viewportBox).not.toBeNull();

    // Check selection status of item-0 before drag
    const item0 = page.locator('[data-value="item-0"]');
    await item0.waitFor({ state: 'visible' });
    await expect(item0).toHaveAttribute('aria-pressed', 'false');

    // Drag scroll from right to left, targeting the bottom edge of the viewport
    // (blank padding/scrollbar area) to prevent pointer collision with item buttons.
    const startX = viewportBox!.x + viewportBox!.width * 0.8;
    const startY = viewportBox!.y + viewportBox!.height - 15;
    const endX = viewportBox!.x + viewportBox!.width * 0.2;
    const endY = startY;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(endX, endY, { steps: 15 });
    await page.mouse.up();

    // Verify that the viewport scrolled (scrollLeft is greater than 0)
    const scrollLeft = await viewport.evaluate((el) => el.scrollLeft);
    expect(scrollLeft).toBeGreaterThan(0);

    // Verify click suppression: Item 0 should NOT have been selected/pressed
    await expect(item0).toHaveAttribute('aria-pressed', 'false');
  });

  test('drag overlay follows cursor', async ({ page }) => {
    await page.goto(storyPath('ui-mediastrip-mediastrip--reorderable-media-strips'));

    const handleA1 = page.locator('[data-reorder-handle="item-a1"]');
    await handleA1.waitFor({ state: 'visible' });

    const handleBox = await handleA1.boundingBox();
    const startX = handleBox!.x + handleBox!.width / 2;
    const startY = handleBox!.y + handleBox!.height / 2;

    // Pick up the item and move it slightly
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    
    const dragX = startX + 150;
    const dragY = startY + 80;
    await page.mouse.move(dragX, dragY, { steps: 5 });

    // Assert that the drag overlay is rendered
    const overlay = page.locator('[data-testid="drag-overlay-item"]');
    await expect(overlay).toBeVisible();

    // Verify overlay follows coordinates (is positioned near the dragged mouse position)
    const overlayBox = await overlay.boundingBox();
    expect(overlayBox).not.toBeNull();
    // Allow generous tolerance for offset handle positioning relative to overlay center
    expect(Math.abs(overlayBox!.x - (dragX - overlayBox!.width / 2))).toBeLessThan(100);
    expect(Math.abs(overlayBox!.y - (dragY - overlayBox!.height / 2))).toBeLessThan(100);

    // Clean up
    await page.mouse.up();
    await expect(overlay).not.toBeVisible();
  });

  test('reorder while horizontally scrolled', async ({ page }) => {
    await page.goto(storyPath('ui-mediastrip-mediastrip--reorder-while-scrolled'));
    await page.reload();

    const viewport = page.locator('[data-slot="scroll-area-viewport"]');
    await viewport.waitFor({ state: 'visible' });

    // Programmatically scroll the viewport deep to the right
    await viewport.evaluate((el) => { el.scrollLeft = 800; });
    await expect(async () => {
      const scrollLeft = await viewport.evaluate((el) => el.scrollLeft);
      expect(scrollLeft).toBeGreaterThan(500);
    }).toPass();

    // Locate Item 10, which should now be visible and scroll-aligned
    const item10 = page.locator('[data-value="item-10"]');
    const handle10 = page.locator('[data-reorder-handle="item-10"]');
    const item11 = page.locator('[data-value="item-11"]');

    await item10.waitFor({ state: 'visible' });
    await handle10.waitFor({ state: 'visible' });
    await item11.waitFor({ state: 'visible' });

    const handleBox = await handle10.boundingBox();
    const item11Box = await item11.boundingBox();

    const startX = handleBox!.x + handleBox!.width / 2;
    const startY = handleBox!.y + handleBox!.height / 2;
    const endX = item11Box!.x + item11Box!.width * 0.8;
    const endY = item11Box!.y + item11Box!.height / 2;

    // Perform drag to reorder Item 10 past Item 11
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(endX, endY, { steps: 10 });
    await page.mouse.up();

    // Verify visual order change: Item 11 should now be to the left of Item 10
    await expect(async () => {
      const box10 = await page.locator('[data-value="item-10"]').boundingBox();
      const box11 = await page.locator('[data-value="item-11"]').boundingBox();
      expect(box11!.x).toBeLessThan(box10!.x);
    }).toPass();

    // Scroll position should not have jumped back to 0
    const scrollLeftAfter = await viewport.evaluate((el) => el.scrollLeft);
    expect(scrollLeftAfter).toBeGreaterThan(500);
  });

});
