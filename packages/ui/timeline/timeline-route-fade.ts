"use client";

const FADE_OUT_MS = 120;
const FADE_IN_MS = 180;

function clearTimelineFade() {
  delete document.documentElement.dataset.timelineRouteFade;
}

function setTimelineFade(phase: "in" | "out") {
  document.documentElement.dataset.timelineRouteFade = phase;
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function startTimelineFadeNavigation({
  navigate,
}: {
  navigate: () => void;
}) {
  if (prefersReducedMotion()) {
    navigate();
    return;
  }

  setTimelineFade("out");

  window.setTimeout(() => {
    navigate();
    window.setTimeout(clearTimelineFade, FADE_IN_MS + 200);
  }, FADE_OUT_MS);
}
