import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useApp, useHostStyles } from "@modelcontextprotocol/ext-apps/react";
import type { App as McpApp } from "@modelcontextprotocol/ext-apps";

import { fetchProjects, fetchTimeline, loadSession, reportViewToModel, saveSession } from "../bridge/host";
import { registerViewTools } from "../tools/view-tools";
import { TimelineStrip } from "../views/TimelineStrip";
import type { Project, Timeline, TimelineClip } from "../types";
import {
  currentRoute,
  currentTimelineId,
  describeView,
  initialViewState,
  viewReducer,
} from "./view-state";

export function App() {
  const [state, dispatch] = useReducer(viewReducer, initialViewState);
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [timeline, setTimeline] = useState<Timeline | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Tool handlers must read the CURRENT timeline, but they are registered once
  // before connect. A ref gives them a live window onto state without
  // re-registering (and without going stale in a closure).
  const timelineRef = useRef<Timeline | null>(null);
  timelineRef.current = timeline;

  const { app, isConnected, error } = useApp({
    appInfo: { name: "storyboard-timeline", version: "1.0.0" },
    // Declaring tools is what lets the model drive the view; without it the
    // host never asks this iframe for a tool list.
    capabilities: { tools: { listChanged: true } },
    // Size the frame to the content so the widget doesn't scroll vertically
    // inside a too-short iframe.
    autoResize: true,
    onAppCreated: (created: McpApp) => {
      // Before connect(): the handshake advertises the tool list, and one-shot
      // notifications can fire the moment it completes.
      registerViewTools(created, {
        dispatch,
        getTimeline: () => timelineRef.current,
      });
    },
  });

  // Adopt the host's palette, type, and radii. The stylesheet reads every token
  // through `var(--token, fallback)`, so a host that publishes none leaves the
  // widget on its own theme.
  useHostStyles(app);

  // --- Load the project list, then restore where the user left off ----------
  useEffect(() => {
    if (!isConnected || !app) return;
    let cancelled = false;

    (async () => {
      try {
        setStatus("Loading projects…");
        const list = await fetchProjects(app);
        if (cancelled) return;
        setProjects(list);

        const restored = loadSession();
        const restoredId =
          restored?.projectId && list.some((project) => project.id === restored.projectId)
            ? restored.projectId
            : null;
        const projectId = restoredId ?? list[0]?.id ?? null;
        if (projectId) dispatch({ type: "set-project", projectId });

        setStatus(null);
        setLoadError(null);
      } catch (caught) {
        if (cancelled) return;
        setStatus(null);
        setLoadError(caught instanceof Error ? caught.message : "Failed to load projects.");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isConnected, app]);

  // --- Load whichever document the current route points at ------------------
  const activeTimelineId = currentTimelineId(state);

  useEffect(() => {
    if (!isConnected || !app || !activeTimelineId) return;
    let cancelled = false;

    (async () => {
      try {
        setStatus("Loading timeline…");
        const loaded = await fetchTimeline(app, activeTimelineId);
        if (cancelled) return;
        setTimeline(loaded);
        setStatus(null);
        setLoadError(null);
      } catch (caught) {
        if (cancelled) return;
        setStatus(null);
        setLoadError(caught instanceof Error ? caught.message : "Failed to load the timeline.");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isConnected, app, activeTimelineId]);

  // --- Keep the session and the model in step with the view -----------------
  useEffect(() => {
    saveSession({ projectId: state.projectId });
  }, [state.projectId]);

  useEffect(() => {
    if (!app || !isConnected || !timeline) return;
    void reportViewToModel(app, describeView(state, timeline));
  }, [app, isConnected, state, timeline]);

  const route = currentRoute(state);
  const clips = useMemo(() => timeline?.clips ?? [], [timeline]);

  const onSelect = useCallback((clip: TimelineClip) => {
    dispatch({ type: "focus-clip", clipId: clip.id ?? null });
  }, []);

  const onOpen = useCallback((clip: TimelineClip) => {
    if (!clip.childTimelineId) return;
    dispatch({
      type: "open-collection",
      timelineId: clip.childTimelineId,
      title: clip.title ?? "Collection",
    });
  }, []);

  if (error) {
    return <p className="muted">Couldn&apos;t connect to the host: {error.message}</p>;
  }
  if (!isConnected) return <p className="muted">Connecting…</p>;

  return (
    <main className="app">
      <header className="head">
        {route.name === "detail" && (
          <button
            type="button"
            className="button button--back"
            onClick={() => dispatch({ type: "back" })}
          >
            ‹ Back
          </button>
        )}

        <h1>{route.name === "detail" ? route.title : (timeline?.title ?? "Timeline")}</h1>

        {route.name === "strip" && projects && projects.length > 1 && (
          <select
            aria-label="Project"
            value={state.projectId ?? ""}
            onChange={(event) =>
              dispatch({ type: "set-project", projectId: event.target.value })
            }
          >
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.title}
              </option>
            ))}
          </select>
        )}
      </header>

      {loadError && (
        <p className="notice notice--error" role="alert">
          {loadError}
        </p>
      )}
      {status && <p className="muted">{status}</p>}

      {!status && !loadError && timeline && (
        <TimelineStrip
          clips={clips}
          selectedClipId={state.focusedClipId}
          onSelect={onSelect}
          onOpen={onOpen}
        />
      )}
    </main>
  );
}
