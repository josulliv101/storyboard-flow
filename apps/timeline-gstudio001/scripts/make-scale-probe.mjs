// A synthetic project of KNOWN SHAPE, for measuring read volume.
//
//   node scripts/make-scale-probe.mjs
//   # then point GSTUDIO_FIXTURE_TIMELINES at fixtures/scale-probe.json,
//   # set GSTUDIO_COUNT_READS=1, load the board, and read the last
//   # [READTOTAL n] line off the server log.
//
// 151 documents: 50 scenes, each with 2 sub-collections, each with 3 clips.
// The depth matters more than the width — the cost being measured is a SUBTREE
// walk per served document, so a flat project of 151 would understate it.
//
// The output is gitignored: it is an instrument, not content. Regenerate it
// when you need it.
//
// What it has already shown, so a re-run has something to compare against:
// one page load cost 58 requests / ~430 reads before the batch-read endpoint,
// and 31 requests / ~250 after.

import { writeFileSync } from "node:fs";
const PROJECT = "project-scale-probe";
const documents = {};
const clip = (id, i, extra = {}) => ({
  id, index: i, alt: id, aspect: 16/9, trackIndex: 0, startTime: 0,
  duration: 4, sourceDuration: 4, trimIn: 0, trimOut: 0, ...extra,
});
// 50 scenes, each holding 2 sub-collections, each holding 3 media = realistic depth 3.
const top = [];
for (let sc = 1; sc <= 50; sc++) {
  const sceneId = `t-scene-${sc}`;
  const subs = [];
  for (let sub = 1; sub <= 2; sub++) {
    const subId = `t-sub-${sc}-${sub}`;
    documents[subId] = { id: subId, title: `Sub ${sc}.${sub}`, clips:
      [1,2,3].map((m, i) => clip(`${subId}-m${m}`, i, { kind: "image", src: "x", poster: "x" })) };
    subs.push(clip(`${sceneId}-c${sub}`, sub - 1, { kind: "collection", title: `Sub ${sc}.${sub}`, childTimelineId: subId, itemCount: 3, previewItems: [], duration: 3, sourceDuration: 3 }));
  }
  documents[sceneId] = { id: sceneId, title: `Scene ${sc}`, clips: subs };
  top.push(clip(`${PROJECT}-c${sc}`, sc - 1, { kind: "collection", title: `Scene ${sc}`, childTimelineId: sceneId, itemCount: 2, previewItems: [], duration: 3, sourceDuration: 3 }));
}
documents[PROJECT] = { id: PROJECT, title: "Scale probe", isProject: true, clips: top };
writeFileSync("fixtures/scale-probe.json", JSON.stringify({ projectId: PROJECT, documents }, null, 2));
console.log("documents:", Object.keys(documents).length);
