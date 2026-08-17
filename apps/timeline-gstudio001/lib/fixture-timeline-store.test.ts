import { mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { TimelineDocument } from "@storyboard/timeline-model/types";

vi.mock("server-only", () => ({}));

import {
  fixtureCreateProject,
  fixtureDeleteDocument,
  fixtureReadEntry,
  fixtureStoreEnabled,
  fixtureStoreIsGenerated,
  fixtureWriteDocuments,
} from "./fixture-timeline-store";

// AUTO-FLUSH: an offline write reaches the file, so "Saved" in the UI means
// saved.
//
// This is a regression test in the strict sense — the behaviour it asserts did
// not exist and its absence was invisible from the app. Writes went to an
// in-memory Map, the save indicator reported success, and a restart discarded
// the work. Nothing in the UI distinguished "saved to memory" from "saved", so
// the only place that difference can be pinned down is here.

const scratch = mkdtempSync(join(tmpdir(), "gstudio-flush-"));

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** A fresh fixture file, and the store pointed at it. Each test gets its own so
 *  the module's `globalThis` state cannot leak between them — the mtime check is
 *  what rebuilds it, and a new path always differs. */
function useFixtureFile(name: string, contents: unknown): string {
  const path = join(scratch, name);
  writeFileSync(path, `${JSON.stringify(contents, null, 2)}\n`, "utf8");
  vi.stubEnv("GSTUDIO_FIXTURE_TIMELINES", path);
  return path;
}

const read = (path: string) =>
  JSON.parse(readFileSync(path, "utf8")) as {
    projectId?: string;
    documents: Record<string, TimelineDocument & { isProject?: boolean }>;
  };

const doc = (id: string, title: string): TimelineDocument => ({ id, title, clips: [] });

beforeEach(() => {
  vi.unstubAllEnvs();
});

describe("offline auto-flush", () => {
  it("writes a document straight through to the file", () => {
    const path = useFixtureFile("local-1.json", {
      projectId: "project-a",
      documents: { "project-a": { id: "project-a", title: "Demo", clips: [], isProject: true } },
    });

    fixtureWriteDocuments([doc("t-new", "Fubar")]);

    expect(Object.keys(read(path).documents).sort()).toEqual(["project-a", "t-new"]);
    expect(read(path).documents["t-new"]?.title).toBe("Fubar");
  });

  it("keeps projectId, which a save would otherwise strip out of the file", () => {
    const path = useFixtureFile("local-2.json", {
      projectId: "project-a",
      documents: { "project-a": { id: "project-a", title: "Demo", clips: [], isProject: true } },
    });

    fixtureWriteDocuments([doc("t-new", "Fubar")]);

    expect(read(path).projectId).toBe("project-a");
  });

  it("does not serve one fixture file's board for another with the same mtime", () => {
    // The state cache was keyed on mtime ALONE, which is unsound the moment the
    // configured path changes: filesystem timestamps are coarse, so two files
    // written in the same tick are indistinguishable and the store hands back
    // the previous file's documents. Auto-flush made that worse than a stale
    // read — the wrong board then gets WRITTEN to the new file.
    //
    // `utimesSync` forces the collision rather than hoping for it. Two files
    // written milliseconds apart usually collide on Windows anyway, which is
    // exactly why this needs pinning instead of leaving to luck.
    const stamp = new Date(1_700_000_000_000);

    const first = join(scratch, "collide-a.json");
    writeFileSync(
      first,
      JSON.stringify({ documents: { "doc-a": { id: "doc-a", title: "From A", clips: [] } } }),
      "utf8",
    );
    const second = join(scratch, "collide-b.json");
    writeFileSync(
      second,
      JSON.stringify({ documents: { "doc-b": { id: "doc-b", title: "From B", clips: [] } } }),
      "utf8",
    );
    utimesSync(first, stamp, stamp);
    utimesSync(second, stamp, stamp);

    vi.stubEnv("GSTUDIO_FIXTURE_TIMELINES", first);
    expect(fixtureReadEntry("doc-a")?.document.title).toBe("From A");

    vi.stubEnv("GSTUDIO_FIXTURE_TIMELINES", second);
    // Same mtime, different file: without the path in the cache key this reads
    // A's board — `doc-b` comes back null and `doc-a` is still visible.
    expect(fixtureReadEntry("doc-b")?.document.title).toBe("From B");
    expect(fixtureReadEntry("doc-a")).toBeNull();
  });

  it("flushes a delete", () => {
    const path = useFixtureFile("local-4.json", {
      documents: {
        "project-a": { id: "project-a", title: "Demo", clips: [], isProject: true },
        "t-doomed": { id: "t-doomed", title: "Doomed", clips: [] },
      },
    });

    fixtureDeleteDocument("t-doomed");

    expect(Object.keys(read(path).documents)).toEqual(["project-a"]);
  });

  it("flushes a created project", () => {
    const path = useFixtureFile("local-5.json", { documents: {} });

    fixtureCreateProject("project-new", "Fresh");

    expect(read(path).documents["project-new"]).toMatchObject({
      id: "project-new",
      title: "Fresh",
      isProject: true,
    });
  });

  it.each(["scale-probe.json", "dev-timelines.json"])(
    "NEVER writes the generated fixture %s",
    (name) => {
      const original = {
        documents: { "project-a": { id: "project-a", title: "Baseline", clips: [], isProject: true } },
      };
      const path = useFixtureFile(name, original);

      expect(fixtureStoreIsGenerated()).toBe(true);
      fixtureWriteDocuments([doc("t-new", "Should not land")]);

      // The write took effect in MEMORY — the board still works, exactly as it
      // did before auto-flush existed…
      expect(fixtureReadEntry("t-new")?.document.title).toBe("Should not land");
      // …and the read-volume baseline on disk is untouched.
      expect(read(path)).toEqual(original);
    },
  );

  it("is off entirely when no fixture path is configured", () => {
    vi.stubEnv("GSTUDIO_FIXTURE_TIMELINES", "");
    expect(fixtureStoreEnabled()).toBe(false);
  });
});
