import { expect, test, type Page } from '@playwright/test';

type Rect = {
  bottom: number;
  height: number;
  left: number;
  right: number;
  top: number;
  width: number;
};

type FrameMetrics = {
  cell: Rect;
  frame: Rect;
  graph: Rect | null;
  media: Rect[];
};

type LayoutMetrics = {
  aspectRatio: string;
  frames: FrameMetrics[];
  innerHeight: number;
  stage: Rect;
};

type StoryContract = {
  id: string;
  name: string;
  expectedAspectRatio: string;
  expectedDialogGridItems: boolean[];
  expectedFrameCount: number;
  expectedMediaCounts: number[];
};

const stories: StoryContract[] = [
  {
    id: 'editor-preview-dialog-grid-contract--graph-only-group-is-not-a-separate-preview',
    name: 'graph-only group attaches to the visual preview',
    expectedAspectRatio: '16:9',
    expectedDialogGridItems: [true],
    expectedFrameCount: 1,
    expectedMediaCounts: [1],
  },
  {
    id: 'editor-preview-dialog-grid-contract--two-media-items-share-the-left-two-thirds',
    name: 'two media items share the left two thirds',
    expectedAspectRatio: '16:9',
    expectedDialogGridItems: [true],
    expectedFrameCount: 1,
    expectedMediaCounts: [2],
  },
  {
    id: 'editor-preview-dialog-grid-contract--multiple-enabled-visual-groups-create-multiple-previews',
    name: 'multiple enabled visual groups create multiple previews',
    expectedAspectRatio: '16:9',
    expectedDialogGridItems: [true, true],
    expectedFrameCount: 2,
    expectedMediaCounts: [1, 1],
  },
  {
    id: 'editor-preview-dialog-grid-contract--per-group-dialog-grid-item-setting',
    name: 'dialog grid item is controlled per group',
    expectedAspectRatio: '16:9',
    expectedDialogGridItems: [true, false],
    expectedFrameCount: 2,
    expectedMediaCounts: [1, 2],
  },
  {
    id: 'editor-preview-dialog-grid-contract--extra-wide-multiple-previews-respect-aspect-ratio',
    name: 'extra-wide multiple previews respect aspect ratio',
    expectedAspectRatio: '21:9',
    expectedDialogGridItems: [true, true],
    expectedFrameCount: 2,
    expectedMediaCounts: [1, 2],
  },
  {
    id: 'editor-preview-dialog-grid-contract--viewport-height-resize-contract',
    name: 'single preview responds to viewport height',
    expectedAspectRatio: '16:9',
    expectedDialogGridItems: [true],
    expectedFrameCount: 1,
    expectedMediaCounts: [2],
  },
  {
    id: 'editor-preview-dialog-grid-contract--multiple-previews-resize-with-viewport-height',
    name: 'multiple previews respond to viewport height',
    expectedAspectRatio: '16:9',
    expectedDialogGridItems: [true, true],
    expectedFrameCount: 2,
    expectedMediaCounts: [1, 2],
  },
];

const storyPath = (storyId: string) => `/iframe.html?id=${storyId}&viewMode=story`;

function parseAspectRatio(value: string) {
  const [width, height] = value.split(':').map(Number);
  return width / height;
}

async function readLayout(page: Page): Promise<LayoutMetrics> {
  await page.waitForSelector('[data-testid="group-frame"]');

  return page.evaluate(() => {
    const required = (selector: string, root: ParentNode = document) => {
      const element = root.querySelector(selector);
      if (!element) {
        throw new Error(`Missing ${selector}`);
      }
      return element;
    };

    const toRect = (rect: DOMRect): Rect => ({
      bottom: rect.bottom,
      height: rect.height,
      left: rect.left,
      right: rect.right,
      top: rect.top,
      width: rect.width,
    });

    const stage = required('[data-testid="preview-stage"]');
    const cells = Array.from(document.querySelectorAll('[data-testid="group-cell"]'));
    const frames = Array.from(document.querySelectorAll('[data-testid="group-frame"]'));

    return {
      aspectRatio: stage.getAttribute('data-aspect-ratio') ?? '16:9',
      frames: frames.map((frame, index) => ({
        cell: toRect(cells[index].getBoundingClientRect()),
        frame: toRect(frame.getBoundingClientRect()),
        graph: frame.querySelector('[data-testid="graph-grid-item"]')
          ? toRect(required('[data-testid="graph-grid-item"]', frame).getBoundingClientRect())
          : null,
        media: Array.from(frame.querySelectorAll(':scope > [data-testid="media-grid-item"]'))
          .map((item) => toRect(item.getBoundingClientRect())),
      })),
      innerHeight: window.innerHeight,
      stage: toRect(stage.getBoundingClientRect()),
    };
  });
}

function expectClose(actual: number, expected: number, tolerance = 2) {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance);
}

function expectResponsiveLayout(metrics: LayoutMetrics, contract: StoryContract) {
  const aspectFactor = parseAspectRatio(contract.expectedAspectRatio);
  const expectedStageHeight = metrics.innerHeight - 64;

  expect(metrics.aspectRatio).toBe(contract.expectedAspectRatio);
  expect(metrics.frames).toHaveLength(contract.expectedFrameCount);
  expectClose(metrics.stage.height, expectedStageHeight);

  metrics.frames.forEach(({ cell, frame, graph, media }, index) => {
    const expectsDialogGridItem = contract.expectedDialogGridItems[index];
    const expectedFrameWidth = Math.min(cell.width, cell.height * aspectFactor);
    const expectedFrameHeight = Math.min(cell.height, cell.width / aspectFactor);
    const expectedVisualWidth = expectsDialogGridItem ? frame.width * (2 / 3) : frame.width;
    const expectedMediaWidth = expectedVisualWidth / Math.max(1, media.length);

    expect(media).toHaveLength(contract.expectedMediaCounts[index]);
    expectClose(frame.width, expectedFrameWidth);
    expectClose(frame.height, expectedFrameHeight);
    expectClose(frame.width / frame.height, aspectFactor, 0.03);

    expect(frame.left).toBeGreaterThanOrEqual(cell.left - 1);
    expect(frame.right).toBeLessThanOrEqual(cell.right + 1);
    expect(frame.top).toBeGreaterThanOrEqual(cell.top - 1);
    expect(frame.bottom).toBeLessThanOrEqual(cell.bottom + 1);

    if (expectsDialogGridItem) {
      expect(graph).not.toBeNull();
      expectClose(graph!.left, frame.left + frame.width * 2 / 3);
      expectClose(graph!.width, frame.width / 3);
      expectClose(graph!.height, frame.height);
      expect(graph!.right).toBeLessThanOrEqual(frame.right + 1);
    } else {
      expect(graph).toBeNull();
    }

    media.forEach((item, mediaIndex) => {
      expectClose(item.left, frame.left + expectedMediaWidth * mediaIndex);
      expectClose(item.width, expectedMediaWidth);
      expect(item.right).toBeLessThanOrEqual(frame.left + expectedVisualWidth + 1);
    });
  });
}

async function expectResponsiveLayoutEventually(page: Page, contract: StoryContract) {
  let latest: LayoutMetrics | undefined;

  await expect(async () => {
    latest = await readLayout(page);
    expectResponsiveLayout(latest, contract);
  }).toPass({ timeout: 5000 });

  return latest!;
}

test.describe('dialog preview layout contract stories', () => {
  for (const story of stories) {
    test(`${story.name}`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(storyPath(story.id));

      const tall = await expectResponsiveLayoutEventually(page, story);

      await page.setViewportSize({ width: 1440, height: 540 });
      const short = await expectResponsiveLayoutEventually(page, story);

      expect(short.stage.height).toBeLessThan(tall.stage.height);
    });
  }
});
