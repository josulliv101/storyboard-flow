import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";

// EXPLORATION: four candidate UIs for a video trim card's readout — full source
// length, in/out points, what's showing, and room to expand each side. Shown
// IN CONTEXT: each option is a real strip with neighbor clips on both sides, so
// we can see what the readout does to its neighbors (the ghost shoulders extend
// past the card — the real test is whether they collide with what's beside
// them). As you trim, the middle card shrinks and neighbors slide in, exactly
// like the live VirtualStrip. Story-local until one is chosen and promoted.

const PPS = 24; // px per second (matches the trim playground scale)
const FULL = 10; // source length of the trim-target clip, seconds

const dogFrames = [
  new URL("./fixtures/dog-tracking-2s.png", import.meta.url).href,
  new URL("./fixtures/dog-exit-4s.png", import.meta.url).href,
] as const;

// Distinct neighbor clips so card boundaries read clearly (each a different
// shot, and different from the dog frames on the trim-target).
const neighbors = [
  { name: "Laundry", seconds: 3, src: new URL("./fixtures/clip-field.jpg", import.meta.url).href },
  { name: "Woodcut", seconds: 5, src: new URL("./fixtures/clip-chop.jpg", import.meta.url).href },
] as const;
const neighborsRight = [
  { name: "Lineup", seconds: 4, src: new URL("./fixtures/clip-lineup.png", import.meta.url).href },
  { name: "Interview", seconds: 2, src: new URL("./fixtures/clip-portrait.png", import.meta.url).href },
] as const;

const frameCount = (seconds: number) => Math.max(1, Math.min(5, Math.round(seconds / 2)));

/** The bright, visible clip: a frame sequence scaled to `seconds * pps` wide. */
function Frames({
  seconds,
  pps = PPS,
  height = 56,
  className = "",
}: {
  seconds: number;
  pps?: number;
  height?: number;
  className?: string;
}) {
  const width = Math.max(6, seconds * pps);
  const count = Math.max(1, Math.min(10, Math.round(width / 46)));
  return (
    <span
      className={`flex overflow-hidden rounded-sm bg-muted ${className}`}
      style={{ width, height }}
    >
      {Array.from({ length: count }).map((_, i) => (
        <img
          key={i}
          src={dogFrames[i % dogFrames.length]}
          alt=""
          draggable={false}
          className="h-full min-w-0 flex-1 border-r border-background object-cover last:border-r-0"
        />
      ))}
    </span>
  );
}

/** A plain neighbor clip in the strip (no trim readout) — its own distinct shot. */
function NeighborCard({ seconds, name, src }: { seconds: number; name: string; src: string }) {
  return (
    <div className="shrink-0" style={{ width: seconds * PPS }}>
      <span className="block h-14 overflow-hidden rounded-sm bg-muted ring-1 ring-border">
        <img src={src} alt="" draggable={false} className="h-full w-full object-cover" />
      </span>
      <div className="mt-1 flex justify-between gap-1 text-[10px] text-muted-foreground">
        <span className="truncate">{name}</span>
        <span className="tabular-nums">{seconds}s</span>
      </div>
    </div>
  );
}

/** Faint, cut-off footage — the room available to expand into. */
function Shoulder({ seconds, side }: { seconds: number; side: "left" | "right" }) {
  return (
    <span className="relative block h-14 shrink-0" style={{ width: seconds * PPS }}>
      <span className="absolute -top-4 w-full text-center text-[9px] whitespace-nowrap text-muted-foreground">
        {seconds}s room
      </span>
      <span className="block h-14 overflow-hidden rounded-sm opacity-30 grayscale ring-1 ring-dashed ring-primary/50">
        <img
          src={dogFrames[side === "left" ? 0 : 1]}
          alt=""
          draggable={false}
          className="h-full w-full object-cover"
        />
      </span>
    </span>
  );
}

function Caption({ children }: { children: React.ReactNode }) {
  return <div className="mt-1 text-[10px] text-muted-foreground tabular-nums">{children}</div>;
}

/** The horizontal strip container. `overflow-visible` so a floating HUD/label
 *  above a card isn't clipped (fine here — the comparison strips fit the page). */
function Strip({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-1 overflow-visible rounded-lg border border-border bg-card/40 p-3 pt-16">
      {children}
    </div>
  );
}

type MiddleProps = { trimIn: number; trimOut: number };

// ── Option A — Ghost shoulders (always on), overlaying neighbors ───────────
function MiddleGhostShoulders({
  trimIn,
  trimOut,
  active = true,
  tooltip = false,
}: MiddleProps & { active?: boolean; tooltip?: boolean }) {
  const eff = FULL - trimIn - trimOut;
  return (
    <div className="relative shrink-0" style={{ width: eff * PPS }}>
      {active && trimIn > 0 && (
        <div className="absolute top-0 z-10" style={{ right: "100%" }}>
          <Shoulder seconds={trimIn} side="left" />
        </div>
      )}
      <Frames seconds={eff} className="relative z-20 ring-2 ring-primary" />
      {active && trimOut > 0 && (
        <div className="absolute top-0 z-10" style={{ left: "100%" }}>
          <Shoulder seconds={trimOut} side="right" />
        </div>
      )}
      {tooltip && (
        <span className="absolute -top-6 left-0 z-30 rounded bg-foreground px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap text-background shadow">
          showing {eff}s · {trimIn}s room ◀ ▶ {trimOut}s
        </span>
      )}
      <Caption>
        showing <span className="font-semibold text-foreground">{eff}s</span> · full {FULL}s
      </Caption>
    </div>
  );
}

// ── Option B — Numeric edge badges (stay within the card) ─────────────────
function MiddleBadges({ trimIn, trimOut }: MiddleProps) {
  const eff = FULL - trimIn - trimOut;
  return (
    <div className="relative shrink-0" style={{ width: eff * PPS }}>
      <span className="relative block">
        <Frames seconds={eff} className="ring-2 ring-primary" />
        {trimIn > 0 && (
          <span className="absolute top-1 left-1 rounded bg-background/85 px-1 py-0.5 text-[9px] font-semibold text-foreground shadow-sm">
            ◀{trimIn}s
          </span>
        )}
        {trimOut > 0 && (
          <span className="absolute top-1 right-1 rounded bg-background/85 px-1 py-0.5 text-[9px] font-semibold text-foreground shadow-sm">
            {trimOut}s▶
          </span>
        )}
      </span>
      <Caption>
        <span className="font-semibold text-foreground">{eff}s</span> / {FULL}s
      </Caption>
    </div>
  );
}

// ── Option C — Mini source ruler overlaid along the card's bottom ─────────
function MiddleRuler({ trimIn, trimOut }: MiddleProps) {
  const eff = FULL - trimIn - trimOut;
  const inPct = (trimIn / FULL) * 100;
  const outPct = (trimOut / FULL) * 100;
  return (
    <div className="relative shrink-0" style={{ width: eff * PPS }}>
      <span className="relative block">
        <Frames seconds={eff} className="ring-2 ring-primary" />
        {/* Full-source overview pinned to the bottom edge, inside the card. */}
        <span className="absolute inset-x-1 bottom-1 h-2 rounded bg-background/70 ring-1 ring-border">
          <span
            className="absolute inset-y-0 bg-primary/60"
            style={{ left: `${inPct}%`, right: `${outPct}%` }}
          />
          <span
            className="absolute inset-y-[-1px] w-0.5 -translate-x-1/2 rounded bg-primary"
            style={{ left: `${inPct}%` }}
          />
          <span
            className="absolute inset-y-[-1px] w-0.5 -translate-x-1/2 rounded bg-primary"
            style={{ left: `${100 - outPct}%` }}
          />
        </span>
      </span>
      <Caption>
        {eff}s in {FULL}s source
      </Caption>
    </div>
  );
}

// ── Option E — Transient HUD (all of the above, only while trimming) ──────
// A small floating tooltip above the card that appears ONLY during a trim: a
// mini source-map (room-in | showing | room-out over the full clip) plus the
// numbers. It floats over the card, never displacing neighbors, and vanishes
// at rest — so the strip stays clean and there is no collision.
function TrimHud({ trimIn, trimOut, eff }: { trimIn: number; trimOut: number; eff: number }) {
  const barW = 150;
  return (
    <div className="absolute -top-3 left-1/2 z-40 -translate-x-1/2 -translate-y-full">
      <div className="rounded-md border border-border bg-popover px-2.5 py-2 shadow-xl">
        {/* Full-source mini map: dim room on each side, bright window showing. */}
        <div
          className="flex h-2.5 items-stretch overflow-hidden rounded-sm ring-1 ring-border"
          style={{ width: barW }}
        >
          <span className="bg-foreground/25" style={{ width: (trimIn / FULL) * barW }} />
          <span className="bg-primary" style={{ width: (eff / FULL) * barW }} />
          <span className="bg-foreground/25" style={{ width: (trimOut / FULL) * barW }} />
        </div>
        <div className="mt-1.5 flex items-center justify-between gap-3 text-[10px] whitespace-nowrap tabular-nums">
          <span className={trimIn > 0 ? "text-foreground" : "text-muted-foreground/40"}>
            ◀ {trimIn.toFixed(1)}s room
          </span>
          <span className="font-semibold text-primary">{eff.toFixed(1)}s showing</span>
          <span className={trimOut > 0 ? "text-foreground" : "text-muted-foreground/40"}>
            {trimOut.toFixed(1)}s room ▶
          </span>
        </div>
        <div className="mt-0.5 text-center text-[9px] text-muted-foreground">
          of {FULL.toFixed(1)}s source
        </div>
      </div>
      {/* caret pointing down at the card */}
      <span className="absolute top-full left-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1 rotate-45 border-r border-b border-border bg-popover" />
    </div>
  );
}
function MiddleTrimHud({ trimIn, trimOut, active }: MiddleProps & { active: boolean }) {
  const eff = FULL - trimIn - trimOut;
  return (
    <div className="relative shrink-0" style={{ width: eff * PPS }}>
      <Frames seconds={eff} className={active ? "ring-2 ring-primary" : ""} />
      <Caption>{eff}s</Caption>
      {active && <TrimHud trimIn={trimIn} trimOut={trimOut} eff={eff} />}
    </div>
  );
}

// ── Option F — Full-clip overview strip (modeled on the app) ──────────────
// A dedicated detail strip for the SELECTED clip, in its own space above the
// timeline: the full source as a filmstrip with the showing window boxed and
// labeled, trimmed footage dimmed on each side. Answers everything at once and
// never touches the neighbors. The in-row clip gets thick edge handles + a
// showing/full pill, matching the reference UI.
function OverviewStrip({ trimIn, trimOut }: MiddleProps) {
  const eff = FULL - trimIn - trimOut;
  const scale = 56; // px/s — larger, detailed overview
  const boxLeft = trimIn * scale;
  return (
    <div className="mb-3 inline-flex items-center gap-2 rounded-xl border border-border bg-card/60 p-2">
      <span className="pl-1 text-[10px] font-semibold tracking-wide text-muted-foreground">
        START
      </span>
      <div className="relative overflow-hidden rounded-md" style={{ width: FULL * scale }}>
        <Frames seconds={FULL} pps={scale} height={52} />
        <div className="absolute inset-y-0 left-0 bg-background/55" style={{ width: boxLeft }} />
        <div
          className="absolute inset-y-0 right-0 bg-background/55"
          style={{ width: trimOut * scale }}
        />
        <div
          className="absolute inset-y-0 flex items-center justify-center rounded-md bg-yellow-400/5 ring-2 ring-yellow-400"
          style={{ left: boxLeft, width: eff * scale }}
        >
          <span className="rounded bg-background/85 px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap text-foreground shadow-sm tabular-nums">
            showing {eff.toFixed(2)}s · full {FULL.toFixed(2)}s
          </span>
        </div>
      </div>
    </div>
  );
}
/** The selected clip in-row: thick handles + showing/full pill (reference style). */
function TargetCardF({ trimIn, trimOut }: MiddleProps) {
  const eff = FULL - trimIn - trimOut;
  return (
    <div className="relative shrink-0" style={{ width: eff * PPS }}>
      <div className="relative overflow-hidden rounded-md ring-2 ring-yellow-400">
        <Frames seconds={eff} height={64} />
        <span className="absolute inset-y-0 left-0 w-2 bg-yellow-400" />
        <span className="absolute inset-y-0 left-0 w-[3px] bg-red-500" />
        <span className="absolute inset-y-0 right-0 w-2 bg-yellow-400" />
        <span className="absolute top-1 left-1 rounded bg-black/70 px-1.5 py-0.5 text-[9px] font-bold tracking-wide text-yellow-300">
          VIDEO
        </span>
        <span className="absolute right-1 bottom-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-white">
          {eff.toFixed(1)}s / {FULL.toFixed(1)}s
        </span>
      </div>
    </div>
  );
}

// ── Comparison harness ────────────────────────────────────────────────────
function ContextRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border-t border-border py-5 first:border-t-0">
      <div className="mb-2">
        <span className="text-sm font-semibold text-foreground">{label}</span>
        <span className="ml-2 text-xs text-muted-foreground">{hint}</span>
      </div>
      <Strip>
        {neighbors.map((n) => (
          <NeighborCard key={n.name} seconds={n.seconds} name={n.name} src={n.src} />
        ))}
        {children}
        {neighborsRight.map((n) => (
          <NeighborCard key={n.name} seconds={n.seconds} name={n.name} src={n.src} />
        ))}
      </Strip>
    </div>
  );
}

function TrimReadoutComparison() {
  const [trimIn, setTrimIn] = useState(2);
  const [trimOut, setTrimOut] = useState(1);
  const [trimming, setTrimming] = useState(true);
  const eff = FULL - trimIn - trimOut;
  const maxIn = FULL - trimOut - 1;
  const maxOut = FULL - trimIn - 1;

  return (
    <div className="max-w-4xl text-foreground">
      <h2 className="text-base font-semibold">Video trim readouts — in strip context</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        The highlighted middle clip is a {FULL}s source flanked by neighbor clips. Trim it and
        watch what each readout does to its neighbors — the real test for the ghost options.
      </p>

      <div className="sticky top-2 z-40 mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-md border border-border bg-card p-3 text-xs shadow-sm">
        <label className="flex items-center gap-2">
          Trim in
          <input
            type="range"
            min={0}
            max={maxIn}
            value={trimIn}
            onChange={(e) => setTrimIn(Number(e.target.value))}
          />
          <span className="w-6 tabular-nums">{trimIn}s</span>
        </label>
        <label className="flex items-center gap-2">
          Trim out
          <input
            type="range"
            min={0}
            max={maxOut}
            value={trimOut}
            onChange={(e) => setTrimOut(Number(e.target.value))}
          />
          <span className="w-6 tabular-nums">{trimOut}s</span>
        </label>
        <span className="tabular-nums text-muted-foreground">
          showing <span className="font-semibold text-foreground">{eff}s</span> · room L {trimIn}s /
          R {trimOut}s
        </span>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={trimming}
            onChange={(e) => setTrimming(e.target.checked)}
          />
          Simulate trimming (D &amp; E)
        </label>
      </div>

      <ContextRow label="A — Ghost shoulders (always on)" hint="dim cut-off footage overlays the neighbors">
        <MiddleGhostShoulders trimIn={trimIn} trimOut={trimOut} />
      </ContextRow>
      <ContextRow label="B — Numeric edge badges" hint="stays inside the card; neighbors untouched">
        <MiddleBadges trimIn={trimIn} trimOut={trimOut} />
      </ContextRow>
      <ContextRow label="C — Mini ruler (bottom overlay)" hint="in-card overview; neighbors untouched">
        <MiddleRuler trimIn={trimIn} trimOut={trimOut} />
      </ContextRow>
      <ContextRow
        label="D — Ghost + tooltip (only while trimming)"
        hint="clean at rest; shoulders appear only when active (toggle above)"
      >
        <MiddleGhostShoulders
          trimIn={trimIn}
          trimOut={trimOut}
          active={trimming}
          tooltip={trimming}
        />
      </ContextRow>
      <ContextRow
        label="E — Transient HUD (all-in-one, only while trimming)"
        hint="floating tooltip: mini source-map + room/showing/full numbers; clean at rest"
      >
        <MiddleTrimHud trimIn={trimIn} trimOut={trimOut} active={trimming} />
      </ContextRow>

      <div className="border-t border-border py-5">
        <div className="mb-2">
          <span className="text-sm font-semibold text-foreground">
            F — Full-clip overview strip (your app’s pattern)
          </span>
          <span className="ml-2 text-xs text-muted-foreground">
            dedicated detail strip above the row; shows the whole source + window; neighbors
            untouched
          </span>
        </div>
        <OverviewStrip trimIn={trimIn} trimOut={trimOut} />
        <Strip>
          {neighbors.map((n) => (
            <NeighborCard key={n.name} seconds={n.seconds} name={n.name} src={n.src} />
          ))}
          <TargetCardF trimIn={trimIn} trimOut={trimOut} />
          {neighborsRight.map((n) => (
            <NeighborCard key={n.name} seconds={n.seconds} name={n.name} src={n.src} />
          ))}
        </Strip>
      </div>
    </div>
  );
}

const meta = {
  title: "UI/DndCollectionsTrimReadouts",
  decorators: [
    (Story) => (
      <div className="min-h-screen bg-background p-8">
        <Story />
      </div>
    ),
  ],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** Play-less: a visual comparison playground, not an assertion suite. */
export const CompareInContext: Story = {
  render: () => <TrimReadoutComparison />,
};
