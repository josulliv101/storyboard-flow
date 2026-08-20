// Regenerates `fixtures/dev-timelines.json` — the offline board.
//
//   node scripts/make-dev-fixture.mjs
//
// The JSON is CHECKED IN, so running this is only needed when you want
// different dummy content. Everything here is deterministic: no clock, no
// randomness, no network. Re-running produces a byte-identical file, so a
// regeneration shows up in a diff only when the content actually changed.
//
// Thumbnails are inline SVG data URIs rather than the 1x1 transparent pixel the
// e2e fixtures use. That matters for the job this serves: e2e asserts against
// the DOM and does not care what an image looks like, while this exists to be
// LOOKED AT — a board of identical blank squares would tell you nothing about
// whether a layout change worked.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "dev-timelines.json");

const PALETTE = [
  ["#1e3a5f", "#7dd3fc"],
  ["#3f2d56", "#c4b5fd"],
  ["#14532d", "#86efac"],
  ["#5c2e2e", "#fca5a5"],
  ["#4a3c17", "#fde047"],
  ["#164e63", "#67e8f9"],
];

/** A labelled 16:9 card as a data URI. Base64, not raw utf8: an inline SVG
 *  carries `#` in every colour, which terminates a data URI early. */
function thumbnail(label, seed, kind) {
  const [bg, fg] = PALETTE[seed % PALETTE.length];
  const glyph = kind === "audio" ? "♪" : kind === "video" ? "▶" : "▣";
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180">` +
    `<rect width="320" height="180" fill="${bg}"/>` +
    `<text x="26" y="96" font-family="monospace" font-size="54" fill="${fg}">${glyph}</text>` +
    `<text x="86" y="88" font-family="monospace" font-size="19" fill="${fg}">${label}</text>` +
    `<text x="86" y="112" font-family="monospace" font-size="13" fill="${fg}" opacity="0.65">${kind}</text>` +
    `</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}

let clipSeed = 0;

// A few real-looking tags, spread deterministically. Without ANY tags the
// board's filter control renders nothing at all — correct behaviour (an empty
// filter menu is worse than no control), but it makes the control impossible to
// look at offline, which is the one thing this fixture exists for.
const TAGS = [
  ["keeper"],
  ["wan2.1", "keeper"],
  ["minimax-h3"],
  ["needs-retake"],
  ["wan2.1"],
  ["minimax-h3", "keeper"],
];

function mediaClip(id, label, kind, index, duration, options = {}) {
  const seed = clipSeed++;
  const sourceDuration = options.sourceDuration ?? duration;
  return {
    id,
    index,
    kind,
    alt: label,
    tags: TAGS[seed % TAGS.length],
    src: thumbnail(label, seed, kind),
    // Audio must NOT carry a poster: the field exists on the shared type, and a
    // poster minted for a sound file is a broken image wherever a card paints
    // one. Mirrors the same rule in the e2e fixtures.
    ...(kind === "audio" ? {} : { poster: thumbnail(label, seed, kind) }),
    aspect: 16 / 9,
    trackIndex: options.lane ?? 0,
    ...(options.placedStart === undefined ? {} : { placedStart: options.placedStart }),
    startTime: 0,
    duration,
    sourceDuration,
    trimIn: 0,
    trimOut: sourceDuration - duration,
  };
}

function collectionClip(id, childTimelineId, title, index, itemCount) {
  return {
    id,
    index,
    kind: "collection",
    title,
    childTimelineId,
    itemCount,
    // Left empty on purpose: the serve path DERIVES collection previews from
    // the child documents bottom-up, so a stored value here would be the stale
    // copy that derivation exists to replace.
    previewItems: [],
    alt: title,
    aspect: 16 / 9,
    trackIndex: 0,
    startTime: 0,
    duration: 3,
    sourceDuration: 3,
    trimIn: 0,
    trimOut: 0,
  };
}

const PROJECT_ID = "project-dev-fixture";
const documents = {};

/** One scene: a few shots, and for scene 2 a bed on lane 1 so the lane rows,
 *  the layered-playback path and the waveform lane all have something to draw
 *  offline — those are the newest surfaces and the easiest to leave untested. */
function scene(n, title, shots, extras = []) {
  const id = `timeline-dev-scene-${n}`;
  documents[id] = {
    id,
    title,
    clips: [
      ...shots.map((shot, i) =>
        mediaClip(`${id}-s${i + 1}`, shot.label, shot.kind, i, shot.duration),
      ),
      ...extras.map((extra, i) =>
        mediaClip(`${id}-x${i + 1}`, extra.label, extra.kind, shots.length + i, extra.duration, {
          lane: extra.lane,
          placedStart: extra.placedStart,
        }),
      ),
    ],
  };
  return id;
}

const sceneOne = scene(1, "Scene 1 — The Approach", [
  { label: "Wide, van pulls in", kind: "video", duration: 6 },
  { label: "Pat at the wheel", kind: "video", duration: 4 },
  { label: "Door plate", kind: "image", duration: 3 },
]);

const sceneTwo = scene(
  2,
  "Scene 2 — The Briefing",
  [
    { label: "Pat, medium", kind: "video", duration: 5 },
    { label: "Brian, reverse", kind: "video", duration: 5 },
    { label: "Two-shot", kind: "video", duration: 7 },
  ],
  [
    // Lane 1, starting under the second shot rather than at zero — a bed that
    // is time-placed is the case the picture-hold logic actually has to answer.
    { label: "Room tone bed", kind: "audio", duration: 12, lane: 1, placedStart: 5 },
  ],
);

const sceneThree = scene(3, "Scene 3 — Outside", [
  { label: "Street, dusk", kind: "image", duration: 4 },
  { label: "They leave", kind: "video", duration: 5 },
]);

documents[PROJECT_ID] = {
  id: PROJECT_ID,
  title: "Dev Fixture — offline board",
  isProject: true,
  clips: [
    mediaClip("dev-cold-open", "Cold open", "video", 0, 5),
    collectionClip("dev-c1", sceneOne, "Scene 1 — The Approach", 1, 3),
    collectionClip("dev-c2", sceneTwo, "Scene 2 — The Briefing", 2, 4),
    collectionClip("dev-c3", sceneThree, "Scene 3 — Outside", 3, 2),
    mediaClip("dev-tail", "End card", "image", 4, 3),
  ],
};

writeFileSync(OUT, `${JSON.stringify({ projectId: PROJECT_ID, documents }, null, 2)}\n`, "utf8");
console.log(`wrote ${OUT}`);
console.log(`  ${Object.keys(documents).length} documents, project ${PROJECT_ID}`);
