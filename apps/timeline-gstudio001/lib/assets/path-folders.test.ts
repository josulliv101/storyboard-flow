import { describe, expect, it } from "vitest";

import { pageFromFlatListing, pageFromSearch, pageFromTagListing } from "./path-folders";
import type { Asset } from "./types";

function asset(id: string, folderPath: string[], tags: string[] = []): Asset {
  return {
    id,
    providerId: "test",
    name: id,
    kind: "image",
    src: `https://cdn.test/${id}`,
    thumbnailUrl: `https://cdn.test/${id}.thumb`,
    folderPath,
    tags,
  };
}

const LISTING = [
  asset("root-a", []),
  asset("root-b", []),
  asset("scenes-1", ["Scenes"]),
  asset("scenes-2", ["Scenes"]),
  asset("heist-1", ["Scenes", "Heist"]),
  asset("props-1", ["Props"]),
];

describe("pageFromFlatListing", () => {
  it("flat query (folder undefined) returns EVERY asset plus top-level folder rows", () => {
    const page = pageFromFlatListing(LISTING, {});
    expect(page.assets.map((entry) => entry.id)).toEqual([
      "root-a",
      "root-b",
      "scenes-1",
      "scenes-2",
      "heist-1",
      "props-1",
    ]);
    expect(page.folders).toEqual([
      { name: "Props", path: ["Props"] },
      { name: "Scenes", path: ["Scenes"] },
    ]);
  });

  it("root browse ([]) returns only root-level assets — flat and root are distinct", () => {
    const page = pageFromFlatListing(LISTING, { folder: [] });
    expect(page.assets.map((entry) => entry.id)).toEqual(["root-a", "root-b"]);
    expect(page.folders.map((folder) => folder.name)).toEqual(["Props", "Scenes"]);
  });

  it("a folder lists its DIRECT assets and direct subfolders only", () => {
    const page = pageFromFlatListing(LISTING, { folder: ["Scenes"] });
    // heist-1 is deeper — it appears through its subfolder row, which is what
    // makes drill-in mean something.
    expect(page.assets.map((entry) => entry.id)).toEqual(["scenes-1", "scenes-2"]);
    expect(page.folders).toEqual([{ name: "Heist", path: ["Scenes", "Heist"] }]);
  });

  it("a leaf folder lists assets and no subfolders", () => {
    const page = pageFromFlatListing(LISTING, { folder: ["Scenes", "Heist"] });
    expect(page.assets.map((entry) => entry.id)).toEqual(["heist-1"]);
    expect(page.folders).toEqual([]);
  });

  it("an unknown folder is empty, not an error", () => {
    const page = pageFromFlatListing(LISTING, { folder: ["Nope"] });
    expect(page.assets).toEqual([]);
    expect(page.folders).toEqual([]);
  });

  it("limit caps assets but never hides folder rows", () => {
    const page = pageFromFlatListing(LISTING, { limit: 1 });
    expect(page.assets.map((entry) => entry.id)).toEqual(["root-a"]);
    expect(page.folders.length).toBe(2);
  });

  it("a same-named folder at two depths stays two folders", () => {
    const listing = [asset("a", ["X"]), asset("b", ["Y", "X"])];
    expect(pageFromFlatListing(listing, {}).folders.map((folder) => folder.path)).toEqual([
      ["X"],
      ["Y"],
    ]);
    expect(pageFromFlatListing(listing, { folder: ["Y"] }).folders).toEqual([
      { name: "X", path: ["Y", "X"] },
    ]);
  });
});

describe("pageFromTagListing", () => {
  // Folders play no part in tag space: every asset here lives at folder root
  // so any grouping observed comes from tags alone.
  const TAGGED = [
    asset("untagged", []),
    asset("hero", [], ["hero"]),
    asset("heist-1", [], ["scene/heist"]),
    asset("heist-hero", [], ["scene/heist", "hero"]),
    asset("chase-1", [], ["scene/chase"]),
  ];

  it("the tags root shows UNTAGGED assets beside the top-level tag groups", () => {
    const page = pageFromTagListing(TAGGED, { tagPath: [] });
    expect(page.assets.map((entry) => entry.id)).toEqual(["untagged"]);
    expect(page.folders).toEqual([
      { name: "hero", path: ["hero"] },
      { name: "scene", path: ["scene"] },
    ]);
  });

  it("a tag path matches assets carrying EXACTLY that tag, with subgroups below", () => {
    // "scene" itself tags nothing here — its page is pure navigation.
    const scene = pageFromTagListing(TAGGED, { tagPath: ["scene"] });
    expect(scene.assets).toEqual([]);
    expect(scene.folders.map((folder) => folder.name)).toEqual(["chase", "heist"]);

    const heist = pageFromTagListing(TAGGED, { tagPath: ["scene", "heist"] });
    expect(heist.assets.map((entry) => entry.id)).toEqual(["heist-1", "heist-hero"]);
    expect(heist.folders).toEqual([]);
  });

  it("an asset tagged twice lives in BOTH places — the difference from folders", () => {
    const hero = pageFromTagListing(TAGGED, { tagPath: ["hero"] });
    expect(hero.assets.map((entry) => entry.id)).toEqual(["hero", "heist-hero"]);
  });

  it("defaults a missing tagPath to the root and honours limit", () => {
    const page = pageFromTagListing(TAGGED, {});
    expect(page.assets.map((entry) => entry.id)).toEqual(["untagged"]);
    const limited = pageFromTagListing(TAGGED, { tagPath: ["scene", "heist"], limit: 1 });
    expect(limited.assets.map((entry) => entry.id)).toEqual(["heist-1"]);
  });
});

describe("pageFromSearch", () => {
  const listing = [
    ...LISTING,
    asset("Bank_Heist_01", ["Scenes", "Heist"], ["scene/heist"]),
    asset("alleyway-shot", ["Exteriors"]),
  ];

  it("matches the NAME, case-insensitively", () => {
    const page = pageFromSearch(listing, { folderPath: [], search: "heist" } as never);
    expect(page.assets.map((a) => a.id)).toContain("Bank_Heist_01");
    expect(page.assets.map((a) => a.id)).toContain("heist-1");
  });

  it("matches the FOLDER path — people search for where they filed it", () => {
    const page = pageFromSearch(listing, { folderPath: [], search: "exteriors" } as never);
    expect(page.assets.map((a) => a.id)).toEqual(["alleyway-shot"]);
  });

  it("matches TAGS", () => {
    const page = pageFromSearch(listing, { folderPath: [], search: "scene/heist" } as never);
    expect(page.assets.map((a) => a.id)).toEqual(["Bank_Heist_01"]);
  });

  it("returns a FLAT page — a search spans the library, so folders are meaningless", () => {
    const page = pageFromSearch(listing, { folderPath: [], search: "scenes" } as never);
    expect(page.folders).toEqual([]);
    expect(page.assets.length).toBeGreaterThan(0);
  });

  it("treats a blank or whitespace-only term as NOT searching", () => {
    // The route already refuses to set `search` for these, but the provider
    // is reachable directly — and "match nothing" would empty the panel for
    // someone who merely cleared the box.
    expect(pageFromSearch(listing, { folderPath: [], search: "" } as never).assets).toEqual([]);
    expect(pageFromSearch(listing, { folderPath: [], search: "   " } as never).assets).toEqual([]);
    expect(pageFromSearch(listing, { folderPath: [] } as never).assets).toEqual([]);
  });

  it("honours the limit", () => {
    const page = pageFromSearch(listing, { folderPath: [], search: "e", limit: 2 } as never);
    expect(page.assets).toHaveLength(2);
  });

  it("returns nothing for a term that matches nothing", () => {
    expect(
      pageFromSearch(listing, { folderPath: [], search: "zzzznope" } as never).assets,
    ).toEqual([]);
  });
});

describe("pagination", () => {
  const many = Array.from({ length: 25 }, (_, i) =>
    asset(`a${String(i).padStart(2, "0")}`, ["Bulk"]),
  );

  it("tiles the listing exactly — no gaps, no repeats", () => {
    const walked: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = pageFromFlatListing(many, {
        folderPath: [],
        folder: ["Bulk"],
        limit: 10,
        ...(cursor === undefined ? {} : { cursor }),
      } as never);
      walked.push(...page.assets.map((a) => a.id));
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor !== undefined && pages < 10);

    expect(pages).toBe(3);
    expect(walked).toEqual(many.map((a) => a.id));
    expect(new Set(walked).size).toBe(walked.length);
  });

  it("omits nextCursor on the LAST page, so paging terminates", () => {
    const last = pageFromFlatListing(many, {
      folderPath: [],
      folder: ["Bulk"],
      limit: 10,
      cursor: "20",
    } as never);
    expect(last.assets).toHaveLength(5);
    expect(last.nextCursor).toBeUndefined();
  });

  it("returns folders on the FIRST page only", () => {
    const first = pageFromFlatListing(many, { folderPath: [], limit: 10 } as never);
    const second = pageFromFlatListing(many, {
      folderPath: [],
      limit: 10,
      cursor: "10",
    } as never);
    expect(first.folders.length).toBeGreaterThan(0);
    // The place does not change because the user asked for more of its
    // contents; redrawing the folder row under every page would.
    expect(second.folders).toEqual([]);
  });

  it("treats an unparseable cursor as the first page rather than throwing", () => {
    const page = pageFromFlatListing(many, {
      folderPath: [],
      folder: ["Bulk"],
      limit: 10,
      cursor: "not-a-number",
    } as never);
    expect(page.assets.map((a) => a.id)).toEqual(many.slice(0, 10).map((a) => a.id));
  });

  it("returns an empty terminal page for a cursor past the end", () => {
    const page = pageFromFlatListing(many, {
      folderPath: [],
      folder: ["Bulk"],
      limit: 10,
      cursor: "9999",
    } as never);
    expect(page.assets).toEqual([]);
    expect(page.nextCursor).toBeUndefined();
  });

  it("paginates SEARCH results too", () => {
    const first = pageFromSearch(many, { folderPath: [], search: "a0", limit: 4 } as never);
    expect(first.assets).toHaveLength(4);
    expect(first.nextCursor).toBe("4");
  });
});
