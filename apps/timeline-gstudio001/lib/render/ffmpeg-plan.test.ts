import { describe, expect, it } from "vitest";

// The worker is a standalone process, so its planner is a .mjs module — but it
// is the part most able to be subtly wrong, so it is covered by the app suite
// rather than only by looking at the output file.
import {
  atempoChain,
  concatArgs,
  concatListFile,
  layerRectPixels,
  mixArgs,
  segmentArgs,
  segmentFraction,
} from "../../scripts/render-worker/ffmpeg-plan.mjs";

const FORMAT = { width: 1152, height: 480, fps: 24 };

const cut = (over: Record<string, unknown> = {}) => ({
  src: "https://cdn.test/a.mp4",
  kind: "video",
  sourceStart: 0,
  outputDuration: 4,
  playbackRate: 1,
  outputStart: 0,
  ...over,
});

/** The value ffmpeg would receive for a flag, i.e. the token after it. */
const valueAfter = (args: string[], flag: string) => args[args.indexOf(flag) + 1];
/** Every value given for a flag that appears more than once (-map, -i, -t). */
const allValuesAfter = (args: string[], flag: string) =>
  args.flatMap((token, index) => (token === flag ? [args[index + 1] as string] : []));

describe("segmentArgs — every segment must be concat-compatible", () => {
  it("normalises size, rate, pixel format and codecs identically for each kind", () => {
    const kinds = [
      segmentArgs(cut(), FORMAT, "/tmp/0.mp4", { hasAudio: true }),
      segmentArgs(cut({ kind: "image", src: "https://cdn.test/a.png" }), FORMAT, "/tmp/1.mp4"),
      segmentArgs(cut({ kind: "audio", src: "https://cdn.test/a.wav" }), FORMAT, "/tmp/2.mp4"),
    ] as string[][];
    for (const args of kinds) {
      expect(valueAfter(args, "-c:v")).toBe("libx264");
      expect(valueAfter(args, "-pix_fmt")).toBe("yuv420p");
      expect(valueAfter(args, "-r")).toBe("24");
      expect(valueAfter(args, "-c:a")).toBe("aac");
      expect(valueAfter(args, "-ar")).toBe("48000");
      expect(valueAfter(args, "-ac")).toBe("2");
    }
  });

  it("gives EVERY segment exactly one video and one audio map", () => {
    // One silent clip in a sequence must not silence everything after it.
    const kinds = [
      segmentArgs(cut(), FORMAT, "/tmp/0.mp4", { hasAudio: true }),
      segmentArgs(cut(), FORMAT, "/tmp/0.mp4", { hasAudio: false }),
      segmentArgs(cut({ kind: "image" }), FORMAT, "/tmp/1.mp4"),
      segmentArgs(cut({ kind: "audio" }), FORMAT, "/tmp/2.mp4"),
    ] as string[][];
    for (const args of kinds) {
      const maps = allValuesAfter(args, "-map");
      expect(maps).toHaveLength(2);
      expect(maps.filter((m) => m.includes(":v:"))).toHaveLength(1);
      expect(maps.filter((m) => m.includes(":a:"))).toHaveLength(1);
      // A `?` would quietly yield a segment with no audio stream at all.
      expect(maps.some((m) => m.endsWith("?"))).toBe(false);
    }
  });

  it("takes the SOURCE audio when it has some, and adds no silent input", () => {
    const args = segmentArgs(cut(), FORMAT, "/tmp/0.mp4", { hasAudio: true }) as string[];
    expect(allValuesAfter(args, "-map")).toEqual(["0:v:0", "0:a:0"]);
    expect(args.join(" ")).not.toContain("anullsrc");
  });

  it("SYNTHESISES silence for a source with none", () => {
    const args = segmentArgs(cut(), FORMAT, "/tmp/0.mp4", { hasAudio: false }) as string[];
    expect(allValuesAfter(args, "-map")).toEqual(["0:v:0", "1:a:0"]);
    expect(args.join(" ")).toContain("anullsrc");
  });

  it("defaults to NO source audio when the caller did not probe", () => {
    // Safer direction: a silent track over a clip that had sound is a missing
    // sound; a missing stream breaks the concat for everything after it.
    const args = segmentArgs(cut(), FORMAT, "/tmp/0.mp4") as string[];
    expect(allValuesAfter(args, "-map")).toEqual(["0:v:0", "1:a:0"]);
  });

  it("seeks BEFORE the input, so a long source does not decode from zero", () => {
    const args = segmentArgs(
      cut({ sourceStart: 30 }),
      FORMAT,
      "/tmp/0.mp4",
      { hasAudio: true },
    ) as string[];
    expect(args.indexOf("-ss")).toBeLessThan(args.indexOf("-i"));
    expect(valueAfter(args, "-ss")).toBe("30");
  });

  it("consumes duration x rate of SOURCE for a rate-scaled cut", () => {
    const args = segmentArgs(
      cut({ outputDuration: 4, playbackRate: 2 }),
      FORMAT,
      "/tmp/0.mp4",
      { hasAudio: true },
    ) as string[];
    // 4s of output at 2x needs 8s of source.
    expect(valueAfter(args, "-t")).toBe("8");
    expect(valueAfter(args, "-vf")).toContain("setpts=PTS/2");
    expect(valueAfter(args, "-filter:a")).toBe("atempo=2");
  });

  it("does not add a rate filter at normal speed", () => {
    const args = segmentArgs(cut(), FORMAT, "/tmp/0.mp4", { hasAudio: true }) as string[];
    expect(args).not.toContain("-filter:a");
    expect(valueAfter(args, "-vf")).not.toContain("setpts");
  });

  it("treats a nonsense rate as normal speed rather than dividing by zero", () => {
    const args = segmentArgs(
      cut({ playbackRate: 0 }),
      FORMAT,
      "/tmp/0.mp4",
      { hasAudio: true },
    ) as string[];
    expect(valueAfter(args, "-vf")).not.toContain("setpts");
    expect(valueAfter(args, "-t")).toBe("4");
  });

  it("fits without cropping, and pins the pixel aspect", () => {
    const args = segmentArgs(cut(), FORMAT, "/tmp/0.mp4", { hasAudio: true }) as string[];
    const vf = valueAfter(args, "-vf") as string;
    expect(vf).toContain("force_original_aspect_ratio=decrease");
    expect(vf).toContain("pad=1152:480");
    expect(vf).toContain("setsar=1");
  });

  it("holds an image for its full span", () => {
    const args = segmentArgs(
      cut({ kind: "image", outputDuration: 3.5 }),
      FORMAT,
      "/tmp/1.mp4",
    ) as string[];
    expect(args).toContain("-loop");
    expect(allValuesAfter(args, "-t")).toEqual(["3.5", "3.5"]);
  });

  it("plays an audio-only cut over black at the output size", () => {
    const args = segmentArgs(
      cut({ kind: "audio", src: "https://cdn.test/vo.wav" }),
      FORMAT,
      "/tmp/2.mp4",
    ) as string[];
    expect(args.join(" ")).toContain("color=c=black:s=1152x480:r=24");
    expect(allValuesAfter(args, "-map")).toEqual(["0:v:0", "1:a:0"]);
  });
});

describe("atempoChain", () => {
  it("passes an in-range rate straight through", () => {
    expect(atempoChain(1.5)).toBe("atempo=1.5");
    expect(atempoChain(0.75)).toBe("atempo=0.75");
  });

  it("CHAINS past the filter's 2.0 ceiling rather than clamping", () => {
    // Clamping would desync audio from a picture scaled by the full factor.
    expect(atempoChain(4)).toBe("atempo=2.0,atempo=2");
    expect(atempoChain(3)).toBe("atempo=2.0,atempo=1.5");
  });

  it("chains past the 0.5 floor the same way", () => {
    expect(atempoChain(0.25)).toBe("atempo=0.5,atempo=0.5");
  });

  it("multiplies back out to the rate it was asked for", () => {
    for (const rate of [0.3, 0.5, 1, 2, 3, 5.5, 8]) {
      const product = atempoChain(rate)
        .split(",")
        .reduce((total, step) => total * Number(step.split("=")[1]), 1);
      expect(product).toBeCloseTo(rate, 5);
    }
  });
});

describe("concatListFile", () => {
  it("quotes each path on its own line", () => {
    expect(concatListFile(["/tmp/0.mp4", "/tmp/1.mp4"])).toBe(
      "file '/tmp/0.mp4'\nfile '/tmp/1.mp4'\n",
    );
  });

  it("ESCAPES an apostrophe, which would otherwise truncate the list", () => {
    // ffmpeg's parser treats a bare quote as a delimiter — an unescaped path
    // loses that shot and every one after it, silently.
    expect(concatListFile(["/tmp/joe's cut.mp4"])).toBe("file '/tmp/joe'\\''s cut.mp4'\n");
  });
});

describe("concatArgs", () => {
  it("remuxes rather than re-encoding, and allows absolute paths", () => {
    const args = concatArgs("/tmp/list.txt", "/tmp/out.mp4") as string[];
    expect(valueAfter(args, "-c")).toBe("copy");
    expect(valueAfter(args, "-safe")).toBe("0");
    expect(valueAfter(args, "-movflags")).toBe("+faststart");
  });
});

describe("segmentFraction", () => {
  it("advances with the segments and never reaches 1 before the concat", () => {
    expect(segmentFraction(0, 4)).toBeCloseTo(0.2375, 4);
    expect(segmentFraction(3, 4)).toBe(0.95);
  });

  it("is zero for nothing to do, rather than dividing by zero", () => {
    expect(segmentFraction(0, 0)).toBe(0);
  });
});

describe("mixArgs — layers under the picture", () => {
  const layer = (path: string, outputStart: number) => ({ path, outputStart });
  const args = (layers: { path: string; outputStart: number }[]) =>
    mixArgs("/tmp/picture.mp4", layers, "/tmp/out.mp4") as string[] | null;

  it("is NULL with nothing to mix, so the concat IS the finished file", () => {
    // Re-encoding to add nothing would cost a whole generation of the film.
    expect(args([])).toBeNull();
  });

  it("delays each layer to its own start, in MILLISECONDS and per channel", () => {
    // A single adelay value delays only the first channel — not a late start
    // but a stereo image sliding apart.
    const filter = valueAfter(args([layer("/tmp/vo.mp4", 1.5)])!, "-filter_complex");
    expect(filter).toContain("[1:a]adelay=1500|1500[l1]");
  });

  it("rounds a fractional start to a whole millisecond", () => {
    const filter = valueAfter(args([layer("/tmp/vo.mp4", 2.0004)])!, "-filter_complex");
    expect(filter).toContain("adelay=2000|2000");
  });

  it("never delays by a negative amount", () => {
    const filter = valueAfter(args([layer("/tmp/vo.mp4", -1)])!, "-filter_complex");
    expect(filter).toContain("adelay=0|0");
  });

  it("MIXES WITHOUT NORMALISING — a bed must not halve the dialogue", () => {
    // amix normalises by default, dividing every input by the input count.
    const filter = valueAfter(args([layer("/tmp/bed.mp4", 0)])!, "-filter_complex");
    expect(filter).toContain("normalize=0");
  });

  it("follows the PICTURE's length, not the longest layer", () => {
    const filter = valueAfter(args([layer("/tmp/bed.mp4", 0)])!, "-filter_complex");
    expect(filter).toContain("duration=first");
  });

  it("mixes the picture's own audio in with the layers", () => {
    const filter = valueAfter(args([layer("/tmp/bed.mp4", 0)])!, "-filter_complex");
    expect(filter).toContain("[0:a][l1]amix=inputs=2");
  });

  it("takes several layers — a VO over a bed", () => {
    const out = args([layer("/tmp/bed.mp4", 0), layer("/tmp/vo.mp4", 3)])!;
    const filter = valueAfter(out, "-filter_complex");
    expect(filter).toContain("[1:a]adelay=0|0[l1]");
    expect(filter).toContain("[2:a]adelay=3000|3000[l2]");
    expect(filter).toContain("[0:a][l1][l2]amix=inputs=3");
    expect(allValuesAfter(out, "-i")).toEqual(["/tmp/picture.mp4", "/tmp/bed.mp4", "/tmp/vo.mp4"]);
  });

  it("COPIES the video rather than re-encoding the whole film to add sound", () => {
    const out = args([layer("/tmp/bed.mp4", 0)])!;
    expect(valueAfter(out, "-c:v")).toBe("copy");
    expect(allValuesAfter(out, "-map")).toEqual(["0:v", "[aout]"]);
  });
});

// COMPOSITING. A layer that was given a rectangle is drawn INTO the picture,
// not merely mixed under it. Everything above still holds for a layer without
// one, which is what keeps the copy fast path — and every layer written before
// this feature.

describe("layerRectPixels", () => {
  it("turns a normalized frame into output pixels", () => {
    const rect = layerRectPixels({ x: 0.5, y: 0.5, width: 0.25 }, 16 / 9, FORMAT);
    expect(rect.width).toBe(288); // 0.25 x 1152
    expect(rect.x).toBe(576); // 0.5 x 1152
    expect(rect.y).toBe(240); // 0.5 x 480
  });

  it("keeps the CLIP's shape, so an inset is never stretched", () => {
    const rect = layerRectPixels({ x: 0, y: 0, width: 0.25 }, 16 / 9, FORMAT);
    expect(rect.width / rect.height).toBeCloseTo(16 / 9, 1);
    const tall = layerRectPixels({ x: 0, y: 0, width: 0.25 }, 9 / 16, FORMAT);
    expect(tall.width / tall.height).toBeCloseTo(9 / 16, 1);
  });

  it("ROUNDS EVERYTHING EVEN — libx264 refuses an odd dimension in yuv420p", () => {
    // 0.3 x 1152 is 345.6, and the height that follows is not an integer
    // either. An encode fails outright on this, so it is arithmetic that has
    // to be right rather than a matter of taste.
    for (const width of [0.3, 0.17, 0.43, 0.29]) {
      const rect = layerRectPixels({ x: 0.31, y: 0.37, width }, 16 / 9, FORMAT);
      for (const value of [rect.width, rect.height, rect.x, rect.y]) {
        expect(value % 2).toBe(0);
      }
    }
  });

  it("NUDGES A RECTANGLE BACK INSIDE the frame rather than letting it be cropped", () => {
    // A frame written at one output size, rendered at another. ffmpeg's
    // overlay silently crops whatever hangs off the edge, so an inset that
    // half-left the frame would come out sliced with nothing to say why.
    const rect = layerRectPixels({ x: 0.95, y: 0.95, width: 0.3 }, 16 / 9, FORMAT);
    expect(rect.x + rect.width).toBeLessThanOrEqual(FORMAT.width);
    expect(rect.y + rect.height).toBeLessThanOrEqual(FORMAT.height);
  });

  it("survives a nonsense aspect instead of producing a zero-size box", () => {
    const rect = layerRectPixels({ x: 0, y: 0, width: 0.3 }, 0, FORMAT);
    expect(rect.width).toBeGreaterThan(0);
    expect(rect.height).toBeGreaterThan(0);
  });
});

describe("mixArgs — compositing a framed layer", () => {
  const framed = (over: Record<string, unknown> = {}) => ({
    path: "/tmp/pip.mp4",
    outputStart: 2,
    outputDuration: 3,
    trackIndex: 1,
    rect: { x: 800, y: 300, width: 288, height: 162 },
    ...over,
  });

  it("KEEPS THE COPY when no layer has a rectangle", () => {
    // The whole reason compositing is opt-in. A bed and a voiceover must not
    // start costing a re-encode of the entire film.
    const out = mixArgs("/tmp/picture.mp4", [{ path: "/tmp/bed.mp4", outputStart: 0 }], "/tmp/o.mp4")!;
    expect(valueAfter(out, "-c:v")).toBe("copy");
    expect(allValuesAfter(out, "-map")).toEqual(["0:v", "[aout]"]);
  });

  it("overlays at the rectangle's own pixels, and re-encodes", () => {
    const out = mixArgs("/tmp/picture.mp4", [framed()], "/tmp/o.mp4")!;
    const filter = valueAfter(out, "-filter_complex")!;
    expect(filter).toContain("[0:v][1:v]overlay=800:300");
    expect(allValuesAfter(out, "-map")).toEqual(["[vout]", "[aout]"]);
    expect(valueAfter(out, "-c:v")).toBe("libx264");
  });

  it("adds NO SCALE — the segment was already encoded at the inset's size", () => {
    // Scaling here would drag the letterbox bars a full-frame normalisation
    // adds along with the picture.
    expect(valueAfter(mixArgs("/tmp/p.mp4", [framed()], "/tmp/o.mp4")!, "-filter_complex")).not.toContain(
      "scale=",
    );
  });

  it("adds NO EXTRA INPUT — the overlay reads a stream already there", () => {
    const out = mixArgs("/tmp/picture.mp4", [framed()], "/tmp/o.mp4")!;
    expect(allValuesAfter(out, "-i")).toEqual(["/tmp/picture.mp4", "/tmp/pip.mp4"]);
  });

  it("ENABLES ONLY OVER ITS OWN SPAN, so an inset is a clip and not a watermark", () => {
    // Without `enable` the overlay appears at t=0 and stays for the whole
    // film — which looks like a bug in the timeline rather than in the filter.
    const filter = valueAfter(mixArgs("/tmp/p.mp4", [framed()], "/tmp/o.mp4")!, "-filter_complex")!;
    expect(filter).toContain("enable='between(t,2,5)'");
  });

  it("still mixes the framed layer's SOUND, not just its picture", () => {
    const filter = valueAfter(mixArgs("/tmp/p.mp4", [framed()], "/tmp/o.mp4")!, "-filter_complex")!;
    expect(filter).toContain("[1:a]adelay=2000|2000[l1]");
    expect(filter).toContain("amix=inputs=2:duration=first:normalize=0[aout]");
  });

  it("draws the LOWEST lane last, so it ends up on top", () => {
    // The same rule the board and the player use for lanes.
    const filter = valueAfter(
      mixArgs(
        "/tmp/p.mp4",
        [framed({ path: "/tmp/low.mp4", trackIndex: 1 }), framed({ path: "/tmp/high.mp4", trackIndex: 3 })],
        "/tmp/o.mp4",
      )!,
      "-filter_complex",
    )!;
    // Lane 3 composites first (input 2), lane 1 second (input 1) and wins.
    expect(filter.indexOf("[2:v]overlay")).toBeLessThan(filter.indexOf("[1:v]overlay"));
    expect(filter).toContain("[vout]");
  });

  it("chains several overlays through intermediate labels", () => {
    const filter = valueAfter(
      mixArgs("/tmp/p.mp4", [framed({ trackIndex: 1 }), framed({ trackIndex: 2 })], "/tmp/o.mp4")!,
      "-filter_complex",
    )!;
    expect(filter).toContain("[v0]");
    expect(filter).toContain("[vout]");
  });

  it("mixes an UNFRAMED layer's sound while compositing a framed one", () => {
    const out = mixArgs(
      "/tmp/p.mp4",
      [{ path: "/tmp/bed.mp4", outputStart: 0 }, framed()],
      "/tmp/o.mp4",
    )!;
    const filter = valueAfter(out, "-filter_complex")!;
    // Three audio streams in the mix…
    expect(filter).toContain("amix=inputs=3");
    // …and exactly one overlay: the bed has no picture to draw.
    expect(filter.match(/overlay=/g)).toHaveLength(1);
  });

  it("does NOT carry -shortest, which would end the film early", () => {
    // `encodeArgs` has it, for the segments' synthesised silence. Against
    // `amix=duration=first` it would end the output at whichever stream
    // finished first rather than at the picture.
    expect(mixArgs("/tmp/p.mp4", [framed()], "/tmp/o.mp4")!).not.toContain("-shortest");
  });
});
