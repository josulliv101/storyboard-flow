import { StrictMode, useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { useApp } from "@modelcontextprotocol/ext-apps/react";

import "./styles.css";
import type { Project, Timeline, TimelineClip } from "./types";
import { parseToolJson } from "./types";

// The MCP Apps view. It is SELF-SUFFICIENT by necessity: the host's
// `ui/initialize` result carries only protocol/host info — never the arguments
// of the tool that opened it — so the view fetches its own data through
// `callServerTool` rather than waiting to be handed any.

function formatSeconds(total: number): string {
  if (!Number.isFinite(total) || total <= 0) return "0s";
  if (total < 60) return `${total.toFixed(1)}s`;
  const minutes = Math.floor(total / 60);
  const seconds = Math.round(total % 60);
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function clipLabel(clip: TimelineClip): string {
  if (clip.kind === "collection") return clip.title ?? "Collection";
  return clip.alt ?? clip.kind;
}

/** Poster for a clip: media uses its own art; a collection borrows its first
 *  preview item, which is what the app's own cards do. */
function clipPoster(clip: TimelineClip): string | undefined {
  if (clip.kind === "collection") {
    const first = clip.previewItems?.[0];
    return first?.poster ?? first?.src;
  }
  return clip.poster ?? clip.src;
}

function Clip({ clip, totalSeconds }: { clip: TimelineClip; totalSeconds: number }) {
  const duration = clip.duration ?? 0;
  // Width tracks duration so the strip reads as a real timeline — but CLAMPED
  // at both ends. Unbounded, one long clip (e.g. a 1:44 collection in a 3:34
  // timeline) swallows the row and squeezes everything else into slivers.
  const rawShare = totalSeconds > 0 ? (duration / totalSeconds) * 100 : 0;
  const share = Math.min(28, Math.max(9, rawShare));
  const poster = clipPoster(clip);
  const isCollection = clip.kind === "collection";

  return (
    <figure
      className={`clip${isCollection ? " clip--collection" : ""}`}
      style={{ flexBasis: `max(88px, ${share}%)` }}
      title={`${clipLabel(clip)} — ${formatSeconds(duration)}`}
    >
      <div className="clip__art">
        {poster ? (
          <img src={poster} alt="" loading="lazy" />
        ) : (
          <div className="clip__art--empty" aria-hidden="true" />
        )}
        <span className="clip__kind">{isCollection ? "collection" : clip.kind}</span>
        {isCollection && clip.itemCount !== undefined && (
          <span className="clip__count">{clip.itemCount}</span>
        )}
      </div>
      <figcaption className="clip__meta">
        {/* Two lines before truncating: single-line ellipsis reduced most
            names to "Youn…" / "FBI I…", which identifies nothing. */}
        <span className="clip__name">{clipLabel(clip)}</span>
        <span className="clip__time">{formatSeconds(duration)}</span>
      </figcaption>
    </figure>
  );
}

function TimelineStrip({ timeline }: { timeline: Timeline }) {
  const clips = timeline.clips ?? [];
  const total = useMemo(
    () => clips.reduce((sum, clip) => sum + (clip.duration ?? 0), 0),
    [clips],
  );

  if (clips.length === 0) {
    return <p className="muted">This timeline has no clips yet.</p>;
  }

  return (
    <>
      <div className="strip">
        {clips.map((clip, index) => (
          <Clip key={clip.id ?? index} clip={clip} totalSeconds={total} />
        ))}
      </div>
      <p className="muted">
        {clips.length} clip{clips.length === 1 ? "" : "s"} · {formatSeconds(total)} total
      </p>
    </>
  );
}

function App() {
  const { app, isConnected, error } = useApp({
    appInfo: { name: "storyboard-timeline", version: "1.0.0" },
    // No extra features declared: this view only reads, via callServerTool.
    capabilities: {},
    // Ask the host to size the frame to the content, so the widget doesn't
    // scroll inside a too-short iframe.
    autoResize: true,
  });

  const [projects, setProjects] = useState<Project[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<Timeline | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  // Tool errors come back as `isError` on the result, not as thrown
  // exceptions — transport failures throw. Both are surfaced to the user.
  const call = useCallback(
    async (name: string, args: Record<string, unknown>) => {
      if (!app) return null;
      const result = await app.callServerTool({ name, arguments: args });
      if (result.isError) throw new Error(`"${name}" failed.`);
      return parseToolJson(result);
    },
    [app],
  );

  useEffect(() => {
    if (!isConnected || !app) return;
    let cancelled = false;
    (async () => {
      try {
        setStatus("Loading projects…");
        const payload = await call("list_projects", {});
        if (cancelled) return;
        const list = (payload?.projects as Project[] | undefined) ?? [];
        setProjects(list);
        setSelectedId((current) => current ?? list[0]?.id ?? null);
        setStatus(null);
      } catch (loadError) {
        if (!cancelled) setStatus(loadError instanceof Error ? loadError.message : "Failed to load.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isConnected, app, call]);

  useEffect(() => {
    if (!isConnected || !app || !selectedId) return;
    let cancelled = false;
    (async () => {
      try {
        setStatus("Loading timeline…");
        const payload = await call("read_timeline", { timelineId: selectedId });
        if (cancelled) return;
        setTimeline((payload?.timeline as Timeline | undefined) ?? null);
        setStatus(null);
      } catch (loadError) {
        if (!cancelled) setStatus(loadError instanceof Error ? loadError.message : "Failed to load.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isConnected, app, selectedId, call]);

  if (error) return <p className="muted">Couldn&apos;t connect to the host: {error.message}</p>;
  if (!isConnected) return <p className="muted">Connecting…</p>;

  return (
    <main className="app">
      <header className="head">
        <h1>{timeline?.title ?? "Timeline"}</h1>
        {projects && projects.length > 1 && (
          <select
            aria-label="Project"
            value={selectedId ?? ""}
            onChange={(event) => setSelectedId(event.target.value)}
          >
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.title}
              </option>
            ))}
          </select>
        )}
      </header>

      {status && <p className="muted">{status}</p>}
      {timeline && !status && <TimelineStrip timeline={timeline} />}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
