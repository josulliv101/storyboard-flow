#!/usr/bin/env node
/**
 * How many lines of REAL CODE each source file holds, biggest first.
 *
 * A script rather than a one-off (PL15-013), for the reason
 * `find-unreachable-ui.mjs` is one: this is a question worth asking again after
 * the next round of work, not a number produced once and pasted into a chat.
 *
 * WHAT COUNTS. A line counts when, after comments and whitespace are removed,
 * something is left. Comments are not code — line comments, block comments and
 * JSDoc alike, including the middle lines of a block, which carry no marker of
 * their own and are the bulk of the commentary in this repo. Blank lines are
 * not code. A line holding code AND a trailing comment counts once.
 *
 * WHY A SCANNER AND NOT A REGEX. `const url = "https://x"` is not a comment,
 * and neither is `` `${a}//${b}` ``, and a regex literal can contain both
 * quotes and slashes. Stripping with a pattern gets all three wrong and
 * undercounts exactly the files that do the most string work. This walks the
 * text once, tracking whether it is inside a string, a template, a regex or a
 * comment — which is the smallest thing that is actually correct.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs", ".css"]);

/**
 * Directories never descended into.
 *
 * `.next` earns its place twice: it holds build output, and `.next/standalone`
 * is a COMPLETE SECOND COPY of the app. Counting it would silently double every
 * file in `apps/timeline-gstudio001` and the totals would look plausible.
 */
const SKIP_DIRECTORIES = new Set([
  "node_modules",
  ".next",
  ".next-dev",
  ".git",
  "dist",
  "build",
  "coverage",
  "storybook-static",
  "playwright-report",
  "test-results",
  ".turbo",
  ".vercel",
]);

/**
 * A file that exists to check another one.
 *
 * EXCLUDED BY DEFAULT. They were counted and marked `T`, on the reasoning that
 * a 3,000-line stories file is a different fact about a codebase than a
 * 3,000-line component — which is true, and is exactly why they do not belong
 * in the same list. Mixed in they dominate it: the largest file in this repo is
 * the e2e suite, and two of the top three are stories, so a list meant to show
 * where the CODE is was mostly showing where the tests are.
 *
 * `--tests` puts them back for the times that is the question being asked.
 */
function isCoverage(path) {
  const name = path.slice(path.lastIndexOf("/") + 1);
  return (
    // By NAME: the three suffixes the suites actually use.
    /\.(test|spec|stories)\.[cm]?[jt]sx?$/.test(name) ||
    // By PLACE. The filename pattern alone let `tests/demo/foobar-demo.mjs`
    // through — 475 lines of harness sitting fifteenth in a list of
    // application code, because it is neither a `.test.` nor a `.spec.` nor a
    // `.stories.` file. Anything living in a test directory is test-related
    // whatever it is called, and `test-support` is the same case one level up:
    // it exists only to be imported BY tests.
    /(^|\/)(tests?|__tests__|e2e|test-support|fixtures)\//.test(path) ||
    // By JOB, for the handful that are neither. A runner's config and a
    // stories helper are not application code by any reading.
    /^(vitest|playwright)\.config\./.test(name) ||
    /^(smoke-test|stories-helpers)\./.test(name)
  );
}


const INCLUDE_TESTS = process.argv.includes("--tests");

function sourceFiles(dir, found = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRECTORIES.has(entry.name)) continue;
      sourceFiles(join(dir, entry.name), found);
      continue;
    }
    if (!entry.isFile()) continue;
    const dot = entry.name.lastIndexOf(".");
    if (dot < 0) continue;
    if (!SOURCE_EXTENSIONS.has(entry.name.slice(dot))) continue;
    found.push(join(dir, entry.name));
  }
  return found;
}

/**
 * Lines with code left on them once comments are gone.
 *
 * The scanner is deliberately small and its states are the ones that can hide
 * a `//`: a quoted string, a template (which can nest expressions holding more
 * strings, so `${` depth is tracked), a regex literal, and the two comment
 * kinds. Anything it does not recognise is code, which is the safe direction to
 * be wrong in — a mis-scan over-counts rather than quietly reporting a file as
 * mostly prose.
 */
export function codeLines(text) {
  const lines = text.split(/\r?\n/);
  let inBlock = false;
  let count = 0;

  for (const line of lines) {
    let out = "";
    let i = 0;
    while (i < line.length) {
      const two = line.slice(i, i + 2);
      if (inBlock) {
        if (two === "*/") {
          inBlock = false;
          i += 2;
        } else {
          i += 1;
        }
        continue;
      }
      if (two === "/*") {
        inBlock = true;
        i += 2;
        continue;
      }
      if (two === "//") break; // rest of the line is comment
      const ch = line[i];
      if (ch === '"' || ch === "'" || ch === "`") {
        // Consume the literal whole, so a `//` or `/*` inside it is never seen
        // as a comment. Unterminated (a template spanning lines) simply ends
        // the line, which still leaves the code before it counted.
        const quote = ch;
        out += ch;
        i += 1;
        while (i < line.length) {
          if (line[i] === "\\") {
            i += 2;
            continue;
          }
          if (line[i] === quote) {
            i += 1;
            break;
          }
          i += 1;
        }
        out += "x";
        continue;
      }
      out += ch;
      i += 1;
    }
    if (out.trim().length > 0) count += 1;
  }
  return count;
}

function main() {
  const files = sourceFiles(ROOT)
    .map((absolute) => {
      const path = relative(ROOT, absolute).split(sep).join("/");
      return {
        path,
        lines: codeLines(readFileSync(absolute, "utf8")),
        total: statSync(absolute).size,
        coverage: isCoverage(path),
      };
    })
    .filter((file) => file.lines > 0)
    .filter((file) => INCLUDE_TESTS || !file.coverage)
    // Descending by code lines; path as the tie-break so two runs over an
    // unchanged tree print the same list.
    .sort((a, b) => b.lines - a.lines || a.path.localeCompare(b.path));

  const width = String(files[0]?.lines ?? 0).length;
  for (const file of files) {
    const slash = file.path.lastIndexOf("/");
    const name = slash < 0 ? file.path : file.path.slice(slash + 1);
    const where = slash < 0 ? "." : file.path.slice(0, slash);
    const mark = INCLUDE_TESTS ? `  ${file.coverage ? "T" : " "}` : "";
    console.log(`${String(file.lines).padStart(width)}${mark}  ${name}  —  ${where}`);
  }

  const sum = (list) => list.reduce((n, f) => n + f.lines, 0);
  console.log("");
  console.log(`${files.length} files, ${sum(files)} lines of code`);
  if (!INCLUDE_TESTS) {
    console.log("  tests and stories excluded — pass --tests to include them");
  }
}

// Only when RUN, not when imported. `codeLines` is exported so its handling of
// strings, templates and regexes can be checked directly, and an import that
// printed the whole tree as a side effect would make that impossible.
if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
