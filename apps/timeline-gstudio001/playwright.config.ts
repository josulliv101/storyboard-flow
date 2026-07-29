import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  // CAPPED, and deliberately not scaled to the core count. Every test in both
  // projects loads pages from ONE dev server process, so the bottleneck is
  // that server, not this machine's CPUs — and Playwright's default (half the
  // cores: 14 here) oversubscribes it badly enough to be self-defeating.
  //
  // Measured over the graph-view suite, 101 tests:
  //   14 workers — median test 15.3s, slowest 35.1s, 2 timeouts, 136s wall
  //    6 workers — median test  5.8s, slowest 13.0s, 0 timeouts, 102s wall
  //
  // Fewer workers is faster in wall clock AND stops the failures: past the
  // server's capacity the extra workers only queue on it. That queueing is
  // the whole story behind the suite's "1-4 tests time out per run, all green
  // in isolation" reputation — tests were dying on the 30s budget with a
  // median of 15s, so anything heavier than typical lost the race.
  workers: 6,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:6006",
    screenshot: "only-on-failure",
    trace: "on-first-retry",
  },
  webServer: [
    {
      // The chromium project's specs (dnd-collections, timeline-interactions)
      // target packages/ui story ids, which only the SHARED storybook
      // workspace serves — the app's own storybook (:6007) indexes app
      // component stories exclusively and cannot run these suites.
      command: "npm --prefix ../storybook run storybook -- --host 127.0.0.1",
      reuseExistingServer: !process.env.CI,
      timeout: 180000,
      url: "http://127.0.0.1:6006",
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
      // The per-test budget has to EXCEED navigationTimeout or that allowance
      // is unreachable: it was 60s against the default 30s test timeout, so a
      // navigation was always killed by the test long before its own limit,
      // and the intent below never actually applied. 60/45 keeps the same
      // shape with room left for the assertions that follow a cold load.
      // Not a way to let slow tests pass — with the worker cap above, the
      // slowest test in the suite is 13s, so this ceiling only ever catches a
      // genuine hang.
      timeout: 60000,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: "http://127.0.0.1:3000",
        // Dev-mode Next compiles routes on first hit; give cold navigations
        // room before the suite's own (tight) assertions take over.
        navigationTimeout: 45000,
      },
    },
  ],
});
