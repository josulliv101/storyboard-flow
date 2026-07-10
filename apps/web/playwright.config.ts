import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:6006',
    screenshot: 'on',
    trace: 'on-first-retry',
  },
  webServer: {
    // Runs with cwd = apps/web, which has no "storybook" script — target
    // the storybook workspace directly.
    command: 'npm --prefix ../storybook run storybook -- --host 127.0.0.1',
    reuseExistingServer: !process.env.CI,
    timeout: 180000,
    url: 'http://127.0.0.1:6006',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
