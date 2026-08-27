#!/usr/bin/env node
// Reachability audit for the Media Monster app (apps/timeline-gstudio001).
//
// The sibling script, find-unreachable-ui.mjs, answers this question for
// `packages/ui` by seeding from the specifiers app code imports. That works
// there because a package's contract IS its import surface. An app has no
// import surface — nothing imports an app — so the same trick seeds from
// nothing and reports the entire app as dead.
//
// AN APP'S CONTRACT IS ITS ENTRY POINTS. Next's App Router decides what runs
// by FILENAME: a `page.tsx` is a route because of where it sits, not because
// something imported it. So the seed set is every file Next will pick up on
// its own, and "reachable" means "transitively imported by one of those".
//
// This gap is why ~2,700 lines of dead code accumulated in components/graph-
// view unnoticed (PRs #557, #558): a port replaced the play bar and deleted
// nothing, and no tool in the repo could see it. tsc, lint and the test suite
// all stay green over an unimported file, because an unimported file is never
// in the compilation at all.
//
//   node scripts/find-unreachable-app.mjs           # summary + per-dir totals
//   node scripts/find-unreachable-app.mjs --list    # name every file
//   node scripts/find-unreachable-app.mjs --dir components/graph-view
//
// RUN `tsc --noUnusedLocals` FIRST, AND RUN THIS AGAIN AFTER. The two tools see
// different halves of the same rot and neither finds it alone:
//
//   AN UNUSED IMPORT STILL COUNTS AS REACHABILITY. `import { Thing } from
//   "./thing"` makes thing.ts reachable to any import walker — this one
//   included — whether or not `Thing` is ever referenced. So a live file
//   holding a dead import keeps a whole subtree looking alive.
//
// Measured on the day this was written: against main, this script found FOUR
// orphaned modules (3,585 lines). The clean-up that followed found SEVENTEEN.
// The other thirteen only became visible once `tsc --noUnusedLocals` had
// removed the dead imports that were propping them up — and then only one ring
// at a time, because each deletion orphans the next. Five rounds to converge.
//
//   npx tsc --noEmit --noUnusedLocals --noUnusedParameters   # debris in LIVE files
//   node scripts/find-unreachable-app.mjs                    # whole files
//   ...repeat until both are quiet.
//
// `--dir` answers the question worth asking before deleting a folder: is ANY
// file inside it reachable? One hit means the folder cannot go wholesale.
// Exits 1 in that case, so it can gate a script.
//
// THREE BUCKETS, because "unused" is two different findings and conflating
// them is how you delete a component and its only coverage in one commit:
//
//   live            reachable from a route. Product code.
//   cover-only      reachable ONLY from a story, a test or an e2e spec. This
//                   is dead PRODUCT code that still has something exercising
//                   it — the deletion is correct but it takes the cover with
//                   it, so the cover is the thing to read first.
//   orphaned        reachable from nothing at all. Nothing renders it, nothing
//                   tests it, nothing has imported it since whenever.
//
// LIMITS, so nobody trusts this further than it goes:
//   - Static analysis of `from "…"` and `import("…")` only. A specifier built
//     at runtime is invisible, and so is anything reached by string name.
//   - Only .ts/.tsx are walked and reported. A .css imported for side effects
//     is neither followed nor listed.
//   - Bare specifiers leave the app on purpose: `@storyboard/*` and node_
//     modules are somebody else's reachability question. Run `npm run
//     audit:ui` for packages/ui.
//   - A route is an entry point even when nothing links to it. That is the
//     POINT — `/oauth/authorize` is advertised as `authorization_endpoint` in
//     lib/oauth/metadata.ts and entered from outside the app entirely.
//   - Always follow a deletion with the real check: tsc, both vitest projects,
//     and the story suite.

import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

const APP = 'apps/timeline-gstudio001';

/**
 * Files Next runs without anyone importing them.
 *
 * The App Router's whole convention: these names, anywhere under `app/`, are
 * entry points by position. Miss one and everything it alone reaches reports
 * as orphaned — which is a false positive that costs a real deletion, so this
 * list is deliberately generous. Extras are harmless (a name that does not
 * exist simply never matches); omissions are not.
 */
const ROUTE_FILES = new Set([
  'page.tsx', 'page.ts',
  'layout.tsx', 'layout.ts',
  'route.ts', 'route.tsx',
  'template.tsx',
  'loading.tsx',
  'error.tsx',
  'global-error.tsx',
  'not-found.tsx',
  'default.tsx',
  'sitemap.ts',
  'robots.ts',
  'manifest.ts',
  'icon.tsx', 'icon.ts',
  'apple-icon.tsx', 'apple-icon.ts',
  'opengraph-image.tsx', 'opengraph-image.ts',
  'twitter-image.tsx', 'twitter-image.ts',
]);

/** Entry points that sit at the app root rather than under `app/`. */
const ROOT_ENTRIES = [
  'middleware.ts',
  'instrumentation.ts',
  'instrumentation-client.ts',
  'next.config.ts',
];

/**
 * Tooling entry points — real entries, but not the app.
 *
 * Bucketed away rather than seeded: a component reachable only from
 * `vitest.config.ts` is not shipped code, and folding these into the live set
 * would hide exactly the files this script exists to find.
 */
const CONFIG_FILES = new Set([
  'next.config.ts', 'vitest.config.ts', 'playwright.config.ts',
  'eslint.config.mjs', 'postcss.config.mjs', 'next-env.d.ts',
]);

/**
 * Directories whose files are entry points of their own, run by something
 * other than Next.
 *
 * Each of these reported as ORPHANED on the first run, and every one was a
 * false positive — the kind that makes a tool worth ignoring. `.storybook/`
 * is the app's own Storybook (port 6007), started by a script rather than
 * imported. `scripts/` holds maintenance CLIs invoked by hand; nothing
 * importing `remove-dangling-collection-references.ts` is the normal state of
 * a one-off repair tool, not evidence it is dead.
 */
const TOOLING_DIRS = ['/.storybook/', '/scripts/'];

/**
 * Test INFRASTRUCTURE that carries no `.test.` in its name.
 *
 * `lib/test-support/at.ts` is imported by tests and by nothing else, which is
 * exactly correct for what it is. Left in the cover-only bucket it reads as a
 * finding, and the finding would be wrong.
 */
const COVER_DIRS = ['/lib/test-support/', '/tests/'];

const EXTS = ['.ts', '.tsx'];
const SKIP_DIRS = new Set([
  'node_modules', '.next', '.next-dev', '.next-turbo-probe',
  'storybook-static', 'playwright-report', 'test-results', 'dist',
]);

const slash = (file) => file.split(path.sep).join('/');
const isStory = (file) => /\.stories\.tsx?$/.test(file);
const isTest = (file) => /\.test\.tsx?$/.test(file);
const isE2E = (file) => slash(file).includes('/tests/e2e/');
const isSpec = (file) => /\.spec\.tsx?$/.test(file);
/** Anything whose job is to check other code, rather than to ship. */
const isCover = (file) =>
  isStory(file) || isTest(file) || isE2E(file) || isSpec(file) ||
  COVER_DIRS.some((dir) => slash(file).includes(dir));
const isConfig = (file) =>
  CONFIG_FILES.has(path.basename(file)) ||
  TOOLING_DIRS.some((dir) => slash(file).includes(dir));

function walkFiles(dir) {
  const out = [];
  (function rec(current) {
    if (!fs.existsSync(current)) return;
    for (const name of fs.readdirSync(current)) {
      if (SKIP_DIRS.has(name)) continue;
      const full = path.join(current, name);
      if (fs.statSync(full).isDirectory()) rec(full);
      else if (/\.tsx?$/.test(name)) out.push(path.normalize(full));
    }
  })(dir);
  return out;
}

function resolveFile(base) {
  for (const ext of EXTS) if (fs.existsSync(base + ext)) return path.normalize(base + ext);
  for (const ext of EXTS) {
    const index = path.join(base, 'index' + ext);
    if (fs.existsSync(index)) return path.normalize(index);
  }
  if (fs.existsSync(base) && fs.statSync(base).isFile()) return path.normalize(base);
  return null;
}

/**
 * Resolve one specifier to a file INSIDE the app, or null.
 *
 * `@/` is the app's own root (tsconfig paths). Everything else bare —
 * `@storyboard/ui`, `react`, `firebase` — leaves the app, and leaving is the
 * answer: this script's question stops at the app boundary.
 */
function resolveSpec(from, spec) {
  if (spec.startsWith('.')) return resolveFile(path.join(path.dirname(from), spec));
  if (spec.startsWith('@/')) return resolveFile(path.join(APP, spec.slice(2)));
  return null;
}

function specifiersIn(file) {
  const src = fs.readFileSync(file, 'utf8');
  const specs = [];
  for (const match of src.matchAll(/from\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g)) {
    specs.push(match[1] ?? match[2]);
  }
  return specs;
}

/** Transitive closure of a seed set, following only imports that stay in the app. */
function closureOf(seeds) {
  const queue = [...seeds];
  const seen = new Set();
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file) || !fs.existsSync(file)) continue;
    seen.add(file);
    for (const spec of specifiersIn(file)) {
      const resolved = resolveSpec(file, spec);
      if (resolved) queue.push(resolved);
    }
  }
  return seen;
}

/** Every file Next itself will run, with nothing having imported it. */
export function entryPoints() {
  const seeds = [];
  for (const file of walkFiles(path.join(APP, 'app'))) {
    if (ROUTE_FILES.has(path.basename(file))) seeds.push(file);
  }
  for (const name of ROOT_ENTRIES) {
    const full = path.join(APP, name);
    if (fs.existsSync(full)) seeds.push(path.normalize(full));
  }
  return seeds;
}

export function classify() {
  const all = walkFiles(APP);
  const live = closureOf(entryPoints());

  // Seeded from every cover file on disk, so a component reachable only
  // through a story lands in `coverOnly` rather than looking orphaned.
  const covered = closureOf(all.filter(isCover));

  const rest = all.filter((file) => !live.has(file));
  return {
    all,
    live: all.filter((file) => live.has(file)),
    cover: rest.filter(isCover),
    config: rest.filter((file) => !isCover(file) && isConfig(file)),
    coverOnly: rest.filter((file) => !isCover(file) && !isConfig(file) && covered.has(file)),
    orphaned: rest.filter((file) => !isCover(file) && !isConfig(file) && !covered.has(file)),
  };
}

function main() {
  const args = process.argv.slice(2);
  const dirs = args.flatMap((arg, i) => (arg === '--dir' ? [args[i + 1]] : [])).filter(Boolean);
  const listAll = args.includes('--list');

  const loc = (file) => fs.readFileSync(file, 'utf8').split('\n').length;
  const sum = (files) => files.reduce((total, file) => total + loc(file), 0);
  const row = (label, files) =>
    console.log(`${label.padEnd(24)}${String(files.length).padStart(4)} files  ${String(sum(files)).padStart(6)} lines`);

  if (dirs.length > 0) {
    const live = closureOf(entryPoints());
    let blocked = false;
    for (const dir of dirs) {
      const files = walkFiles(path.join(APP, dir)).filter((file) => !isCover(file));
      const reachable = files.filter((file) => live.has(file));
      blocked ||= reachable.length > 0;
      // "0 of 0 reachable" is not a verdict. A folder holding only stories and
      // tests filters down to nothing here, and calling that "deletable" would
      // be the tool recommending you delete a test suite.
      const verdict = reachable.length
        ? 'KEEP — still reached from a route'
        : files.length === 0
          ? 'no product files here (all cover, or empty)'
          : 'deletable';
      console.log(
        `${dir.padEnd(30)} ${String(files.length).padStart(4)} files  ` +
          `${String(reachable.length).padStart(3)} reachable  ${verdict}`,
      );
      for (const file of reachable.slice(0, 8)) console.log('    reachable:', slash(file));
    }
    process.exitCode = blocked ? 1 : 0;
    return;
  }

  const { all, live, cover, config, coverOnly, orphaned } = classify();

  console.log(`${APP}\n`);
  console.log(`entry points             ${String(entryPoints().length).padStart(4)} routes + root files\n`);
  row('total .ts/.tsx', all);
  row('live (from a route)', live);
  row('cover (story/test/e2e)', cover);
  row('config / tooling', config);
  row('reached ONLY by cover', coverOnly);
  row('orphaned entirely', orphaned);

  const byDir = new Map();
  for (const file of [...coverOnly, ...orphaned]) {
    const parts = slash(file).split('/');
    const dir = parts.slice(2, 4).join('/') || '(root)';
    byDir.set(dir, (byDir.get(dir) ?? 0) + loc(file));
  }
  if (byDir.size > 0) {
    console.log('\nunreachable source by directory:');
    for (const [dir, lines] of [...byDir].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(lines).padStart(6)}  ${dir}`);
    }
  }

  if (coverOnly.length > 0) {
    console.log('\nreached ONLY by a story/test — dead product code, but covered:');
    for (const file of coverOnly.sort()) console.log(`  ${String(loc(file)).padStart(5)}  ${slash(file)}`);
  }
  if (orphaned.length > 0) {
    console.log('\nORPHANED — nothing reaches these at all:');
    for (const file of orphaned.sort()) console.log(`  ${String(loc(file)).padStart(5)}  ${slash(file)}`);
  }

  if (listAll) {
    console.log('\nlive files:');
    for (const file of live.sort()) console.log('  ', slash(file));
  }
}

// pathToFileURL, not a hand-built "file://" — a Windows path becomes
// file:///C:/… (three slashes), so string concatenation never matches and the
// CLI would silently no-op.
if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
