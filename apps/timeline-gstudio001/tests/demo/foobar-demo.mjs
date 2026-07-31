/**
 * Screen-recorded demo of the graph view's drag-and-drop, driven against the
 * REAL Next app on :3000 with the REAL "Foobar" project as its data.
 *
 * Not a test — a choreographed walkthrough. It lives outside `tests/e2e`
 * (playwright's testDir) on purpose so the suite never picks it up.
 *
 * The server surface is mocked with page.route() exactly the way
 * tests/e2e/graph-view.spec.ts mocks it, for the same reason: no session
 * cookie is needed and no real storage is read or written. The DOCUMENTS
 * served are the genuine Foobar ones, so the demo shows real footage.
 *
 *   node tests/demo/foobar-demo.mjs
 *
 * Output: tests/demo/out/<timestamp>/foobar-demo.webm (+ per-beat pngs).
 */

import { chromium } from "playwright";
import { mkdirSync, readdirSync, renameSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = "http://127.0.0.1:3000";

const PROJECT_ID = "project-1784393947379-3a6k68";
const USER_ID = "LIdEO2P4EwWsn0ux1WmRAOvTDXu2";
const TRASH_ID = `trash-${USER_ID}`;

const CAR_CHASE = "timeline-mrqmm4xxyqc9p6";
const MY_OLD = "timeline-mrw5pjun10npp2";
const NEW_TL = "timeline-ms8ydhgjubhi9k";
const FOOBAR_002 = "timeline-mrw5phknx4l9cc";
const FBI = "timeline-mrqmaifvzvdtrn";

const CLOUD = "https://res.cloudinary.com/drrxyckxi";
const IMG = `${CLOUD}/image/upload`;
const VID = `${CLOUD}/video/upload`;
const U = `timeline-gstudio001/${USER_ID}`;

// The three loose images in the project strip — the demo's moving pieces.
const IMG_YOUNG = `asset-${U}/col-1782648623885-ojcsg/Young_man_standing_brick_wall_202606170902-1782648646142-mrw5tqmop62c`;
const IMG_BANTU = `asset-${U}/Woman_with_Bantu_knots_smiling_202606170902-1782647817245-mrw5tyhjq96s`;
const IMG_CHAR = `asset-${U}/Character_views_from_all_sides_202607171739-1784394153054-mrqmabmhj13z`;

// ── Fixture documents (the real Foobar closure) ─────────────────────────────

const previewImage = (id, name, version, path, alt) => ({
  id,
  kind: "image",
  src: `${IMG}/v${version}/${U}/${path}.jpg`,
  poster: `${IMG}/w_640,h_360,c_fill,q_auto,f_auto/${U}/${path}`,
  alt,
});

const media = (id, kind, index, startTime, duration, src, poster, alt) => ({
  id,
  index,
  kind,
  src,
  poster,
  alt,
  aspect: 16 / 9,
  trackIndex: 0,
  startTime,
  duration,
  sourceDuration: duration,
  trimIn: 0,
  trimOut: 0,
});

const collection = (id, title, index, startTime, duration, itemCount, previewItems) => ({
  id,
  index,
  kind: "collection",
  title,
  childTimelineId: id,
  itemCount,
  previewItems,
  alt: `${title} collection`,
  aspect: 16 / 9,
  trackIndex: 0,
  startTime,
  duration,
  sourceDuration: duration,
  trimIn: 0,
  trimOut: 0,
});

const P_MAN_FADE = previewImage(
  `asset-${U}/New Collection/Man_with_high-top_fade_202606170902-1782647864376-mrw5u1wqsv50`,
  "man-fade",
  1782647862,
  "New%20Collection/Man_with_high-top_fade_202606170902-1782647864376",
  "Man with high-top fade",
);
const P_WOMAN_DARK = previewImage(
  `asset-${U}/Woman_with_dark_hair_202606070949-1784464015318-mrw5qv70conm`,
  "woman-dark",
  1784464010,
  "Woman_with_dark_hair_202606070949-1784464015318",
  "Woman with dark hair",
);
const P_ALLEY = previewImage(
  `asset-${U}/South_Asian_woman_in_alley_202606170902-1782651761356-mrw5r1nefjgb`,
  "alley",
  1782651759,
  "South_Asian_woman_in_alley_202606170902-1782651761356",
  "South Asian woman in alley",
);
const P_CHAR = previewImage(
  "image-ms8az5tarnhbxv",
  "char",
  1784394149,
  "Character_views_from_all_sides_202607171739-1784394153054",
  "Character views from all sides",
);
const P_VIDEO_138 = {
  id: "video-mrqmf3ebvcw3rb",
  kind: "video",
  src: `${VID}/v1784394503/${U}/Video-Project-138-1784394504452.mp4`,
  poster: `${VID}/so_0.35,w_640,h_360,c_fill,q_auto,f_jpg/${U}/Video-Project-138-1784394504452.jpg`,
  alt: "Video Project 138.mp4",
};
const P_VIDEO_139 = {
  id: "video-mrqmazo01mk2jy",
  kind: "video",
  src: `${VID}/v1784394312/${U}/Video-Project-139-1784394313093.mp4`,
  poster: `${VID}/so_0.35,w_640,h_360,c_fill,q_auto,f_jpg/${U}/Video-Project-139-1784394313093.jpg`,
  alt: "Video Project 139.mp4",
};
const P_VIDEO_137 = {
  id: "clip-1784394169274-lqxaxicq4",
  kind: "video",
  src: `${VID}/v1784394167/${U}/Video-Project-137-1784394169549.mp4`,
  poster: `${VID}/so_0.35,w_640,h_360,c_fill,q_auto,f_jpg/${U}/Video-Project-137-1784394169549.jpg`,
  alt: "Video Project 137.mp4",
};

/** A child timeline synthesized from the collection card's own previewItems.
 *  Those items ARE the child's contents, so the drill-in shows real footage;
 *  only the per-clip timings are regularized (the demo never reads them). */
function childFromPreview(id, title, previewItems) {
  let start = 0;
  const clips = previewItems.map((item, index) => {
    const clip = media(
      item.id,
      item.kind,
      index,
      start,
      4,
      item.src,
      item.poster,
      item.alt,
    );
    start += 4.12;
    return clip;
  });
  return { id, title, clips };
}

function buildDocuments() {
  // Clip durations drive strip card WIDTH (width = duration × px/s), and
  // Foobar's real spread (4s next to 54s) both dwarfs the strip with one card
  // and pushes the last two clips off-screen — where a drag silently grabs
  // nothing. A uniform 3s keeps all EIGHT cards on camera at the default
  // 50 px/s. The demo is about the drag mechanics, not the timings.
  const SLOT = 3;
  const GAP = 0.12;
  const at = (index) => index * (SLOT + GAP);
  const project = {
    id: PROJECT_ID,
    title: "Foobar",
    clips: [
      // `trashedAt` stripped from this one: it sits in the trash in the real
      // project, and a trashed clip does not render in the strip.
      collection(MY_OLD, "My Old Timeline", 0, at(0), SLOT, 2, [P_MAN_FADE, P_WOMAN_DARK]),
      media(IMG_YOUNG, "image", 1, at(1), SLOT,
        `${IMG}/v1782648643/${U}/col-1782648623885-ojcsg/Young_man_standing_brick_wall_202606170902-1782648646142.jpg`,
        `${IMG}/w_640,h_360,c_fill,q_auto,f_auto/${U}/col-1782648623885-ojcsg/Young_man_standing_brick_wall_202606170902-1782648646142`,
        "Young man standing at brick wall"),
      collection(NEW_TL, "New Timeline", 2, at(2), SLOT, 1, [P_VIDEO_138]),
      collection(CAR_CHASE, "Car Chase", 3, at(3), SLOT, 2, [P_VIDEO_139, P_VIDEO_137]),
      collection(FOOBAR_002, "My Foobar 002", 4, at(4), SLOT, 2, [P_ALLEY, P_CHAR]),
      media(IMG_BANTU, "image", 5, at(5), SLOT,
        `${IMG}/v1782647815/${U}/Woman_with_Bantu_knots_smiling_202606170902-1782647817245.jpg`,
        `${IMG}/w_640,h_360,c_fill,q_auto,f_auto/${U}/Woman_with_Bantu_knots_smiling_202606170902-1782647817245`,
        "Woman with Bantu knots smiling"),
      media(IMG_CHAR, "image", 6, at(6), SLOT,
        `${IMG}/v1784394149/${U}/Character_views_from_all_sides_202607171739-1784394153054.jpg`,
        `${IMG}/w_640,h_360,c_fill,q_auto,f_auto/${U}/Character_views_from_all_sides_202607171739-1784394153054`,
        "Character views from all sides"),
      collection(FBI, "FBI Interview", 7, at(7), SLOT, 1, []),
    ],
  };

  return new Map([
    [PROJECT_ID, project],
    // Car Chase is the demo's destination — its two real video clips.
    [CAR_CHASE, {
      id: CAR_CHASE,
      title: "Car Chase",
      clips: [
        media(P_VIDEO_139.id, "video", 0, 0, 6.03, P_VIDEO_139.src, P_VIDEO_139.poster, P_VIDEO_139.alt),
        media(P_VIDEO_137.id, "video", 1, 6.15, 5.53, P_VIDEO_137.src, P_VIDEO_137.poster, P_VIDEO_137.alt),
      ],
    }],
    [MY_OLD, childFromPreview(MY_OLD, "My Old Timeline", [P_MAN_FADE, P_WOMAN_DARK])],
    [NEW_TL, childFromPreview(NEW_TL, "New Timeline", [P_VIDEO_138])],
    [FOOBAR_002, childFromPreview(FOOBAR_002, "My Foobar 002", [P_ALLEY, P_CHAR])],
    [FBI, childFromPreview(FBI, "FBI Interview", [])],
    [TRASH_ID, { id: TRASH_ID, title: "Trash Bin", clips: [] }],
  ]);
}

/** Flatten the closure the way the real preview-manifest route does. */
function compileManifest(documents, rootId, revision) {
  const root = documents.get(rootId);
  if (!root) return null;
  const leaves = [];
  const walk = (documentId, path, offset) => {
    const doc = documents.get(documentId);
    if (!doc) return;
    for (const clip of doc.clips) {
      if (clip.kind === "collection") {
        walk(clip.childTimelineId, [...path, clip.childTimelineId], offset + clip.startTime);
        continue;
      }
      leaves.push({
        id: clip.id,
        collectionPath: path,
        kind: clip.kind,
        src: clip.src,
        poster: clip.poster,
        timelineStart: offset + clip.startTime,
        timelineDuration: clip.duration,
        sourceStart: clip.trimIn ?? 0,
        playbackRate: 1,
      });
    }
  };
  walk(rootId, [rootId], 0);
  return {
    projectId: rootId,
    projectRevision: revision,
    durationSeconds: root.clips.reduce((d, c) => Math.max(d, c.startTime + c.duration), 0),
    leaves: leaves.sort((a, b) => a.timelineStart - b.timelineStart),
    compiledAt: new Date().toISOString(),
  };
}

async function installGraphApi(page) {
  const documents = buildDocuments();
  const revisions = new Map([...documents.keys()].map((id) => [id, 1]));

  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      json: { user: { uid: USER_ID, email: "demo@local", name: "Demo", picture: null } },
    }),
  );
  await page.route("**/api/assets/marked**", (route) => route.fulfill({ json: { assets: [] } }));
  await page.route("**/api/assets**", (route) => route.fulfill({ json: { assets: [] } }));

  await page.route("**/api/timelines/*/preview-manifest", (route) => {
    const id = decodeURIComponent(new URL(route.request().url()).pathname.split("/").at(-2) ?? "");
    const manifest = compileManifest(documents, id, revisions.get(id) ?? 0);
    return manifest
      ? route.fulfill({ json: { manifest, missing: [] } })
      : route.fulfill({ status: 404, json: { error: "Timeline was not found." } });
  });

  await page.route("**/api/timelines/*", async (route) => {
    const request = route.request();
    const id = decodeURIComponent(new URL(request.url()).pathname.split("/").pop() ?? "");

    if (id === "batch" && request.method() === "POST") {
      const body = request.postDataJSON();
      const writes = (body.writes ?? []).filter((w) => w.document !== undefined);
      const results = [];
      for (const write of writes) {
        documents.set(write.document.id, write.document);
        const next = (revisions.get(write.document.id) ?? 0) + 1;
        revisions.set(write.document.id, next);
        results.push({ id: write.document.id, revision: next });
      }
      await route.fulfill({ json: { results } });
      return;
    }
    if (request.method() === "GET") {
      const doc = documents.get(id);
      return doc
        ? route.fulfill({ json: { document: doc, revision: revisions.get(id) ?? 0 } })
        : route.fulfill({ status: 404, json: { error: "Timeline was not found." } });
    }
    return route.continue();
  });

  return { documents };
}

// ── Demo choreography helpers ───────────────────────────────────────────────

const strip = (page, id) => page.locator(`[data-virtual-strip="${id}"]`);
const card = (page, stripId, nodeId) =>
  strip(page, stripId).locator(`[data-node-id="${nodeId}"]`);

const beat = (page, ms) => page.waitForTimeout(ms);

async function stripOrder(page, id) {
  return strip(page, id)
    .locator("[data-node-id]")
    .evaluateAll((els) => els.map((el) => el.dataset.nodeId ?? ""));
}

/** Commits animate displaced cards for 180ms and getBoundingClientRect
 *  INCLUDES the transform — measuring mid-FLIP aims a drag at a stale box. */
async function settleMoveAnimations(page) {
  await page
    .waitForFunction(
      () =>
        !document
          .getAnimations()
          .some(
            (a) =>
              !(a instanceof CSSAnimation) &&
              !(a instanceof CSSTransition) &&
              a.playState === "running",
          ),
      undefined,
      { timeout: 4000 },
    )
    .catch(() => {});
}

/**
 * Press-and-hold drag, paced for viewing rather than for speed: strip cards
 * arm at 250ms, so hold past it, travel in many small steps so the recording
 * shows continuous motion, dwell for the collision/intent to settle, release,
 * then outlast dnd-kit's 50ms post-drop click suppressor.
 */
async function holdDrag(page, source, target, targetXRatio = 0.5) {
  await source.waitFor({ state: "visible" });
  await target.waitFor({ state: "visible" });
  await settleMoveAnimations(page);
  const from = await source.boundingBox();
  const to = await target.boundingBox();
  if (!from || !to) throw new Error("drag endpoints not measurable");

  // A card scrolled past the strip's right edge is still "visible" to
  // Playwright and still has a box — but the mouse lands outside the viewport
  // and the drag does NOTHING, silently. That is exactly how the first run
  // produced two no-op beats and an unchanged order. Fail loudly instead.
  const size = page.viewportSize();
  for (const [label, box] of [["source", from], ["target", to]]) {
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    if (cx < 0 || cy < 0 || cx > size.width || cy > size.height) {
      throw new Error(
        `${label} centre (${Math.round(cx)},${Math.round(cy)}) is outside the ` +
          `${size.width}×${size.height} viewport — it is scrolled off the strip`,
      );
    }
  }

  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2, { steps: 18 });
  await beat(page, 320);
  await page.mouse.down();
  await beat(page, 520); // past the 250ms hold — the drag activates, visibly
  await page.mouse.move(
    to.x + to.width * targetXRatio,
    to.y + to.height / 2,
    { steps: 42 },
  );
  await beat(page, 620); // dwell: the drop indicator settles on camera
  await page.mouse.up();
  await beat(page, 260);
}

/** A cursor the recording can actually see — Playwright's video has none. */
async function installCursor(context) {
  await context.addInitScript(() => {
    const install = () => {
      if (document.getElementById("__demo_cursor")) return;
      const dot = document.createElement("div");
      dot.id = "__demo_cursor";
      Object.assign(dot.style, {
        position: "fixed",
        left: "-100px",
        top: "-100px",
        width: "20px",
        height: "20px",
        marginLeft: "-10px",
        marginTop: "-10px",
        borderRadius: "50%",
        pointerEvents: "none",
        zIndex: "2147483647",
        background: "rgba(56,189,248,0.30)",
        border: "2px solid rgba(56,189,248,0.95)",
        boxShadow: "0 0 0 1px rgba(0,0,0,0.35), 0 2px 10px rgba(0,0,0,0.45)",
        transition: "width .12s ease, height .12s ease, background .12s ease",
      });
      document.body.appendChild(dot);
      const size = (px, bg) => {
        dot.style.width = `${px}px`;
        dot.style.height = `${px}px`;
        dot.style.marginLeft = `${-px / 2}px`;
        dot.style.marginTop = `${-px / 2}px`;
        dot.style.background = bg;
      };
      addEventListener("mousemove", (e) => {
        dot.style.left = `${e.clientX}px`;
        dot.style.top = `${e.clientY}px`;
      }, true);
      addEventListener("mousedown", () => size(30, "rgba(56,189,248,0.75)"), true);
      addEventListener("mouseup", () => size(20, "rgba(56,189,248,0.30)"), true);
    };
    if (document.body) install();
    else addEventListener("DOMContentLoaded", install);
  });
}

// ── Run ─────────────────────────────────────────────────────────────────────

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const outDir = join(HERE, "out", stamp);
mkdirSync(outDir, { recursive: true });

const shots = [];
async function shot(page, name) {
  const file = join(outDir, `${shots.length.toString().padStart(2, "0")}-${name}.png`);
  await page.screenshot({ path: file });
  shots.push(file);
  console.log(`  shot → ${name}`);
}

const browser = await chromium.launch({ headless: true });
// 1080p, and not just for the output size: strip cards have a MINIMUM width
// (~210px) that no duration or zoom goes below, so eight of them need ~1680px
// of strip. At 1440 the last card sat off-screen, where a drag silently grabs
// nothing.
const context = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  recordVideo: { dir: outDir, size: { width: 1920, height: 1080 } },
  deviceScaleFactor: 1,
});
await installCursor(context);
const page = await context.newPage();
page.on("console", (m) => {
  if (m.type() === "error") console.log("  [console error]", m.text().slice(0, 200));
});
page.on("requestfailed", (r) => {
  if (r.url().includes("/api/")) console.log("  [req failed]", r.url(), r.failure()?.errorText);
});
page.on("response", (r) => {
  if (r.url().includes("/api/auth/me")) console.log("  [auth/me]", r.status());
});

/**
 * The root layout resolves `initialUser` SERVER-side from the session cookie,
 * which this run does not have — so the server always renders the sign-in
 * form, and only the client's background `/api/auth/me` revalidation (mocked
 * above) swaps in the real tree. That revalidation is a race the first run
 * happened to win and the second lost, so wait on it explicitly and give the
 * mount effect another chance rather than trusting one load.
 */
async function waitForAuthGate(page) {
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const opened = await page
      .locator(`[data-virtual-strip="${PROJECT_ID}"]`)
      .waitFor({ state: "visible", timeout: attempt === 1 ? 45000 : 20000 })
      .then(() => true)
      .catch(() => false);
    if (opened) return;
    console.log(`  auth gate still closed (attempt ${attempt}) — reloading`);
    await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
  }
  throw new Error("auth gate never opened — /api/auth/me revalidation never landed");
}

let failed = null;
try {
  await installGraphApi(page);

  console.log("· loading the Foobar graph view");
  await page.goto(`${BASE}/timeline/${PROJECT_ID}/graph?surface=strip`, {
    waitUntil: "domcontentloaded",
    timeout: 90000,
  });
  await waitForAuthGate(page);
  await card(page, PROJECT_ID, IMG_YOUNG).waitFor({ state: "visible", timeout: 60000 });
  // Let the real Cloudinary thumbnails paint before recording the action.
  await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
  await beat(page, 1200);
  await shot(page, "loaded");
  console.log("  order:", (await stripOrder(page, PROJECT_ID)).length, "cards");

  // Reveal the children tree — this is what fetches child documents, and a
  // collection must be HYDRATED before a drop into it is legal.
  const showChildren = page.getByRole("button", { name: "Show children timelines" });
  if (await showChildren.count()) {
    await showChildren.click();
    await beat(page, 1400);
    await shot(page, "children-shown");
  }

  const hydrated = strip(page, PROJECT_ID)
    .locator(`[data-node-id="${CAR_CHASE}"]`)
    .locator("[data-collection-metadata]");
  await hydrated
    .waitFor({ state: "visible", timeout: 15000 })
    .catch(() => console.log("  ! collection metadata row not found"));
  for (let i = 0; i < 30; i += 1) {
    if ((await hydrated.getAttribute("data-collection-hydrated")) === "true") break;
    await beat(page, 400);
  }
  console.log("  Car Chase hydrated:", await hydrated.getAttribute("data-collection-hydrated"));

  // ── Beat 1: reorder inside the project ───────────────────────────────────
  console.log("· beat 1 — reorder a clip");
  await beat(page, 800);
  await holdDrag(
    page,
    card(page, PROJECT_ID, IMG_CHAR),
    card(page, PROJECT_ID, IMG_YOUNG),
    0.15,
  );
  await settleMoveAnimations(page);
  await beat(page, 900);
  await shot(page, "beat1-reordered");
  console.log("  order now:", (await stripOrder(page, PROJECT_ID)).map((s) => s.slice(-12)));

  // ── Beat 2: drop a clip INTO the Car Chase collection ────────────────────
  console.log("· beat 2 — drag into the Car Chase collection");
  await beat(page, 700);
  await holdDrag(
    page,
    card(page, PROJECT_ID, IMG_BANTU),
    card(page, PROJECT_ID, CAR_CHASE),
    0.5,
  );
  await settleMoveAnimations(page);
  await beat(page, 1000);
  await shot(page, "beat2-nested");
  console.log("  order now:", (await stripOrder(page, PROJECT_ID)).map((s) => s.slice(-12)));

  // ── Beat 3: drill in and show it inside ──────────────────────────────────
  console.log("· beat 3 — open Car Chase");
  await beat(page, 600);
  await page.getByRole("button", { name: "Open Car Chase", exact: true }).first().click();
  await card(page, CAR_CHASE, IMG_BANTU).waitFor({ state: "visible", timeout: 20000 });
  await beat(page, 1600);
  await shot(page, "beat3-inside-collection");
  console.log("  inside Car Chase:", (await stripOrder(page, CAR_CHASE)).map((s) => s.slice(-12)));

  // ── Beat 4: drag it back out onto the parent breadcrumb ──────────────────
  console.log("· beat 4 — drag back out via the breadcrumb");
  const projectCrumb = page.locator(`[data-graph-ancestor-drop="${PROJECT_ID}"]`);
  await projectCrumb.waitFor({ state: "visible", timeout: 15000 });
  await beat(page, 800);
  await holdDrag(page, card(page, CAR_CHASE, IMG_BANTU), projectCrumb, 0.5);
  await settleMoveAnimations(page);
  await beat(page, 1200);
  await shot(page, "beat4-back-out");
  console.log("  inside Car Chase now:", (await stripOrder(page, CAR_CHASE)).map((s) => s.slice(-12)));

  await beat(page, 1400);
  console.log("· done");
} catch (error) {
  failed = error;
  console.error("!! demo failed:", error.message);
  await shot(page, "FAILURE").catch(() => {});
} finally {
  await context.close();
  await browser.close();
}

const webm = readdirSync(outDir).find((f) => f.endsWith(".webm"));
if (webm) {
  const named = join(outDir, "foobar-demo.webm");
  renameSync(join(outDir, webm), named);
  console.log(`\nvideo: ${named}`);
}
console.log(`shots: ${outDir}`);
if (failed) process.exitCode = 1;
