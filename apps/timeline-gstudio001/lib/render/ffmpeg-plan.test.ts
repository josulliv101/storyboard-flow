import { describe, expect, it } from "vitest";

// The worker is a standalone process, so its planner is a .mjs module — but it
// is the part most able to be subtly wrong, so it is covered by the app suite
// rather than only by looking at the output file.
import {
  atempoChain,
  concatArgs,
  concatListFile,
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
