import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:6007",
    screenshot: "only-on-failure",
    trace: "on-first-retry",
  },
  webServer: [
    {
      command: "npm run storybook -- --host 127.0.0.1",
      reuseExistingServer: !process.env.CI,
      timeout: 120000,
      url: "http://127.0.0.1:6007",
    },
    {
      // The graph-view suite runs against the real Next app: its API surface
      // (auth, timeline documents, assets) is mocked per-test with
      // page.route(), so no real storage is read or written.
      //
      // reuseExistingServer is true even in CI on purpose: two `next dev`
      // processes sharing one .next directory corrupt each other, so if a
      // dev server is already up we must ride it, never boot a second one.
      command: "npm run dev",
      reuseExistingServer: true,
      timeout: 180000,
      url: "http://127.0.0.1:3000",
    },
  ],
  projects: [
    {
      name: "chromium",
      testIgnore: /graph-view/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "graph-view",
      testMatch: /graph-view/,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: "http://127.0.0.1:3000",
        // Dev-mode Next compiles routes on first hit; give cold navigations
        // room before the suite's own (tight) assertions take over.
        navigationTimeout: 60000,
      },
    },
  ],
});
