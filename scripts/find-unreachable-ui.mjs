#!/usr/bin/env node
// Reachability audit for packages/ui.
//
// The package has no `exports` map and its `index.ts` barrel is imported by
// NOTHING (the only bare "@storyboard/ui" string in the repo is
// `transpilePackages` in next.config.ts, which is build config, not an
// import). Consumers reach in by subpath instead, so the package's real
// contract is the handful of "@storyboard/ui/<subpath>" specifiers that
// appear in app code. Everything not transitively imported from one of those
// is dead — but a barrel `export *` makes it LOOK live to grep, which is how
// ~23k LOC accumulated unnoticed.
//
// This walks it properly: seed from the specifiers real app code imports,
// follow relative and alias imports transitively, then diff against every
// file on disk.
//
//   node scripts/find-unreachable-ui.mjs            # summary + per-dir totals
//   node scripts/find-unreachable-ui.mjs --list     # every unreachable file
//   node scripts/find-unreachable-ui.mjs --dir wheel-picker [--dir charts]
//
// `--dir` answers the only question that matters before deleting a folder:
// is ANY file inside it reachable? One hit means the folder cannot go
// wholesale. (This is what caught `drag-drop`, which looks unused by alias
// grep but is imported relatively from timeline/clip.)
//
// LIMITS, so nobody trusts this further than it goes:
//   - Static analysis of `from "…"` and `import("…")` specifiers only. A path
//     built at runtime, or a side-effect CSS import, is invisible to it.
//   - Stories are excluded from the SEED set on purpose: a story importing a
//     component does not make that component product code. They are reported
//     separately so you can see the coverage that would go with a deletion.
//   - Always follow a deletion with the real check: tsc, both vitest
//     projects, and a Storybook build.

import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

const UI = 'packages/ui';
/** Where "real app code" lives — the roots whose imports define the contract. */
const APP_ROOTS = [
  'apps/timeline-gstudio001',
  'packages/timeline-widget',
  'packages/timeline-domain',
];
const EXTS = ['.ts', '.tsx'];
const SKIP_DIRS = new Set(['node_modules', '.next', '.next-dev', 'storybook-static', 'dist']);

const slash = (file) => file.split(path.sep).join('/');
const isStory = (file) => /\.stories\.tsx?$/.test(file);
const isTest = (file) => /\.test\.tsx?$/.test(file);

export function walkFiles(dir, { skipStories = false } = {}) {
  const out = [];
  (function rec(current) {
    if (!fs.existsSync(current)) return;
    for (const name of fs.readdirSync(current)) {
      if (SKIP_DIRS.has(name)) continue;
      const full = path.join(current, name);
      if (fs.statSync(full).isDirectory()) rec(full);
      else if (/\.tsx?$/.test(name) && !(skipStories && isStory(name))) out.push(path.normalize(full));
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

const resolveRelative = (from, spec) => resolveFile(path.join(path.dirname(from), spec));

function resolveAlias(spec) {
  if (!spec.startsWith('@storyboard/ui')) return null;
  const rest = spec.slice('@storyboard/ui'.length).replace(/^\//, '');
  return resolveFile(rest === '' ? path.join(UI, 'index') : path.join(UI, rest));
}

function specifiersIn(file) {
  const src = fs.readFileSync(file, 'utf8');
  const specs = [];
  for (const match of src.matchAll(/from\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g)) {
    specs.push(match[1] ?? match[2]);
  }
  return specs;
}

/** Every packages/ui file transitively imported by real (non-story) app code. */
export function reachableUiFiles() {
  const queue = [];
  for (const root of APP_ROOTS) {
    for (const file of walkFiles(root, { skipStories: true })) {
      for (const spec of specifiersIn(file)) {
        const resolved = resolveAlias(spec);
        if (resolved) queue.push(resolved);
      }
    }
  }

  const seen = new Set();
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file) || !fs.existsSync(file)) continue;
    seen.add(file);
    for (const spec of specifiersIn(file)) {
      const resolved = spec.startsWith('.') ? resolveRelative(file, spec) : resolveAlias(spec);
      if (resolved) queue.push(resolved);
    }
  }
  return seen;
}

function main() {
  const args = process.argv.slice(2);
  const dirs = args.flatMap((arg, i) => (arg === '--dir' ? [args[i + 1]] : [])).filter(Boolean);
  const listAll = args.includes('--list');

  const seen = reachableUiFiles();
  const loc = (file) => fs.readFileSync(file, 'utf8').split('\n').length;
  const sum = (files) => files.reduce((total, file) => total + loc(file), 0);

  if (dirs.length > 0) {
    let blocked = false;
    for (const dir of dirs) {
      const files = walkFiles(path.join(UI, dir));
      const live = files.filter((file) => seen.has(file));
      blocked ||= live.length > 0;
      console.log(
        `${dir.padEnd(18)} ${String(files.length).padStart(4)} files  ` +
          `${String(live.length).padStart(3)} reachable  ` +
          (live.length ? 'KEEP — still imported' : 'deletable'),
      );
      for (const file of live.slice(0, 8)) console.log('    reachable:', slash(file));
    }
    process.exitCode = blocked ? 1 : 0;
    return;
  }

  const all = walkFiles(UI);
  const live = all.filter((file) => seen.has(file));
  const dead = all.filter((file) => !seen.has(file));
  const deadSrc = dead.filter((file) => !isStory(file) && !isTest(file));

  console.log(`packages/ui total      ${String(all.length).padStart(4)} files  ${sum(all)} LOC`);
  console.log(`reachable from app     ${String(live.length).padStart(4)} files  ${sum(live)} LOC`);
  console.log(`unreachable source     ${String(deadSrc.length).padStart(4)} files  ${sum(deadSrc)} LOC`);
  console.log(
    `unreachable stories    ${String(dead.filter(isStory).length).padStart(4)} files  ` +
      `${sum(dead.filter(isStory))} LOC`,
  );
  console.log(
    `unreachable tests      ${String(dead.filter(isTest).length).padStart(4)} files  ` +
      `${sum(dead.filter(isTest))} LOC`,
  );

  const byDir = new Map();
  for (const file of deadSrc) {
    const dir = slash(file).split('/')[2] ?? '(root)';
    byDir.set(dir, (byDir.get(dir) ?? 0) + loc(file));
  }
  if (byDir.size > 0) {
    console.log('\nunreachable source by directory:');
    for (const [dir, lines] of [...byDir].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(lines).padStart(6)}  ${dir}`);
    }
  }

  if (listAll) {
    console.log('\nunreachable files:');
    for (const file of dead.sort()) console.log('  ', slash(file));
  }
}

// pathToFileURL, not a hand-built "file://" — a Windows path becomes
// file:///C:/… (three slashes), so string concatenation never matches and the
// CLI would silently no-op.
if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
