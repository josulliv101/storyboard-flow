/**
 * THE REFERENCE DESIGN'S FIXTURE, as typed data (PL15-030).
 *
 * The shots, their frames, the named sections and the procedural "looks" that
 * stand in for thumbnails. Deterministic and self-contained, which is what the
 * storybook workspace requires of every fixture — nothing here fetches.
 *
 * A LOOK IS A CSS BACKGROUND, and that is the whole seam for real media: each
 * frame is a box that takes a background, so swapping these for poster URLs is
 * a change of value, not of structure. The reference says so in its own
 * comment and it is worth keeping true.
 */

/** Pixels per second. The strip's entire geometry is this times a duration. */
export const PIXELS_PER_SECOND = 44;

/** The sequence's length, in seconds. */
export const SEQUENCE_SECONDS = 120;

export const FRAMES_PER_SECOND = 24;

export const LOOKS: Readonly<Record<string, string>> = {
  fadeOut: "radial-gradient(120% 110% at 50% 45%, #0d0f14 0%, #05060a 60%, #020304 100%)",
  nightBlack: "radial-gradient(120% 100% at 32% 42%, #131722 0%, #0a0d13 45%, #04050a 100%)",
  nightBlack2: "radial-gradient(110% 100% at 68% 40%, #10141d 0%, #080a10 50%, #030408 100%)",
  screenGlow:
    "linear-gradient(78deg, rgba(4,6,10,.96) 0%, rgba(4,6,10,.96) 46%, rgba(4,6,10,0) 60%), radial-gradient(42% 58% at 70% 46%, #cdeeff 0%, #7cc7e4 30%, #1c4a5e 62%, #071018 88%, #04070b 100%)",
  darkGlance: "radial-gradient(55% 78% at 72% 48%, #3d4b58 0%, #1a232c 46%, #070b10 100%)",
  listener:
    "linear-gradient(84deg, rgba(6,6,10,.92) 0%, rgba(6,6,10,0) 34%), radial-gradient(62% 86% at 60% 44%, #c4a9a4 0%, #8a656b 30%, #3a2a33 62%, #120d13 100%)",
  emberProfile:
    "radial-gradient(30% 55% at 22% 30%, rgba(255,171,94,.45) 0%, rgba(255,171,94,0) 70%), radial-gradient(62% 88% at 34% 55%, #c1662b 0%, #7c3d18 38%, #2b1309 72%, #0b0502 100%)",
  faceWarmC: "radial-gradient(52% 72% at 52% 44%, #eda65e 0%, #b06a2c 36%, #401e0c 74%, #100702 100%)",
  faceWarmSad: "radial-gradient(48% 66% at 47% 42%, #d69150 0%, #94571f 40%, #33170a 76%, #0d0602 100%)",
  goldenPair:
    "radial-gradient(26% 60% at 80% 50%, rgba(10,6,3,.9) 0%, rgba(10,6,3,0) 70%), radial-gradient(70% 96% at 26% 48%, #f2b873 0%, #bd7a3c 40%, #4a220e 78%, #140903 100%)",
  gruffClose: "radial-gradient(58% 80% at 56% 46%, #d99b58 0%, #9a5c26 38%, #38190a 74%, #0e0603 100%)",
  redheadTurn:
    "radial-gradient(24% 34% at 46% 20%, rgba(224,108,54,.55) 0%, rgba(224,108,54,0) 70%), radial-gradient(56% 78% at 48% 50%, #cf8e4d 0%, #8f5522 42%, #331708 76%, #0d0502 100%)",
  duoProfiles:
    "radial-gradient(24% 62% at 74% 52%, rgba(6,4,3,.92) 0%, rgba(6,4,3,0) 66%), radial-gradient(64% 90% at 30% 50%, #d79a56 0%, #9a5c24 40%, #3a1b0a 76%, #0f0603 100%)",
  greenShirt:
    "linear-gradient(0deg, rgba(30,44,26,.85) 0%, rgba(30,44,26,0) 30%), radial-gradient(60% 82% at 46% 40%, #e0a869 0%, #9c6330 40%, #33190b 76%, #0e0603 100%)",
  shadowHat:
    "radial-gradient(30% 60% at 84% 46%, rgba(255,158,84,.4) 0%, rgba(255,158,84,0) 60%), radial-gradient(70% 100% at 40% 55%, #241811 0%, #120b07 55%, #060303 100%)",
  carCool:
    "radial-gradient(30% 44% at 20% 62%, rgba(255,176,112,.3) 0%, rgba(255,176,112,0) 70%), radial-gradient(64% 86% at 66% 40%, #47617c 0%, #22303f 46%, #0a0f15 100%)",
  startled: "radial-gradient(50% 70% at 60% 44%, #e9b98a 0%, #a3703f 40%, #3a2313 74%, #0f0905 100%)",
  duskWide:
    "linear-gradient(90deg, rgba(5,6,9,.9) 0%, rgba(5,6,9,0) 40%), radial-gradient(92% 120% at 82% 42%, #ff9d54 0%, #a04c1e 42%, #2a1208 76%, #090402 100%)",
  streetDay:
    "linear-gradient(0deg, rgba(40,36,30,.7) 0%, rgba(40,36,30,0) 35%), radial-gradient(80% 100% at 50% 30%, #cfd8de 0%, #9aa4ad 40%, #55534e 75%, #2a2621 100%)",
  storefront:
    "linear-gradient(0deg, rgba(30,20,10,.75) 0%, rgba(30,20,10,0) 40%), radial-gradient(70% 90% at 55% 45%, #e8b459 0%, #b57e2e 40%, #5a3a14 78%, #1d1206 100%)",
  bwPlate: "linear-gradient(100deg, #0f0f10 0%, #2c2c2e 28%, #bfbfc2 52%, #39393b 78%, #121213 100%)",
  vanPop: "radial-gradient(46% 70% at 42% 55%, #e5762b 0%, #a34d15 45%, #402209 78%, #120a04 100%)",
};

/** One frame inside a shot: how long it holds, and what it looks like. */
export type PlaybarFrame = Readonly<{ seconds: number; look: string }>;

export type PlaybarShot = Readonly<{
  index: number;
  /** Start and end on the sequence clock. */
  start: number;
  end: number;
  frames: readonly PlaybarFrame[];
}>;

export type PlaybarSection = Readonly<{
  name: string;
  /** Inclusive shot indices. */
  first: number;
  last: number;
  start: number;
  end: number;
}>;

const RAW_SHOTS: ReadonlyArray<Readonly<{ start: number; frames: readonly [number, string][] }>> = [
  { start: 0, frames: [[3.2, "fadeOut"], [3.3, "nightBlack2"]] },
  { start: 6.5, frames: [[2.8, "duskWide"], [2.7, "emberProfile"]] },
  { start: 12, frames: [[7.6, "nightBlack"]] },
  { start: 19.6, frames: [[1.1, "darkGlance"], [1.4, "screenGlow"]] },
  { start: 22.1, frames: [[3.5, "listener"]] },
  { start: 25.6, frames: [[2.8, "emberProfile"], [2.9, "faceWarmC"], [2.7, "faceWarmSad"]] },
  { start: 34.0, frames: [[2.1, "goldenPair"], [2.5, "gruffClose"]] },
  { start: 38.6, frames: [[1.7, "redheadTurn"], [1.9, "duoProfiles"], [1.9, "faceWarmSad"]] },
  { start: 44.1, frames: [[2.9, "greenShirt"], [2.7, "shadowHat"], [2.9, "redheadTurn"]] },
  { start: 52.6, frames: [[3.4, "carCool"], [3.3, "startled"]] },
  { start: 59.3, frames: [[3.4, "faceWarmC"], [3.3, "nightBlack2"]] },
  { start: 66.0, frames: [[3.0, "darkGlance"], [3.0, "listener"], [3.0, "emberProfile"]] },
  { start: 75.0, frames: [[4.2, "carCool"], [4.3, "goldenPair"]] },
  { start: 83.5, frames: [[2.8, "faceWarmSad"], [2.9, "duoProfiles"], [2.8, "greenShirt"]] },
  { start: 92.0, frames: [[4.5, "streetDay"], [4.5, "vanPop"]] },
  { start: 101.0, frames: [[3.1, "storefront"], [3.2, "streetDay"], [3.2, "bwPlate"]] },
  { start: 110.5, frames: [[5.0, "storefront"], [4.5, "streetDay"]] },
];

export const SHOTS: readonly PlaybarShot[] = RAW_SHOTS.map((raw, index) => {
  const frames = raw.frames.map(([seconds, look]) => ({ seconds, look }));
  return {
    index,
    start: raw.start,
    end: raw.start + frames.reduce((total, frame) => total + frame.seconds, 0),
    frames,
  };
});

const RAW_SECTIONS: ReadonlyArray<Readonly<{ name: string; first: number; last: number }>> = [
  { name: "Cold Open", first: 0, last: 2 },
  { name: "Boards", first: 3, last: 9 },
  { name: "Reference", first: 10, last: 13 },
  { name: "Locations", first: 14, last: 16 },
];

export const SECTIONS: readonly PlaybarSection[] = RAW_SECTIONS.map((raw) => ({
  ...raw,
  start: SHOTS[raw.first]!.start,
  end: SHOTS[raw.last]!.end,
}));

/** `mm:ss:ff`, frames included — the reference's own readout. */
export function timecode(seconds: number): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    pad(Math.floor(seconds / 60)) +
    ":" +
    pad(Math.floor(seconds % 60)) +
    ":" +
    pad(Math.floor((seconds % 1) * FRAMES_PER_SECOND))
  );
}

export const clamp = (value: number, low: number, high: number) =>
  Math.min(high, Math.max(low, value));

/** Which shot covers a moment, and the look showing at it. */
export function frameAt(seconds: number): Readonly<{ shot: PlaybarShot; look: string }> {
  const found = SHOTS.find((shot) => seconds >= shot.start && seconds < shot.end);
  const shot = found ?? SHOTS[SHOTS.length - 1]!;
  let into = seconds - shot.start;
  for (const frame of shot.frames) {
    if (into < frame.seconds) return { shot, look: frame.look };
    into -= frame.seconds;
  }
  return { shot, look: shot.frames[shot.frames.length - 1]!.look };
}
