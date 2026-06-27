"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

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

export function TimelineRouteFadeController() {
  const pathname = usePathname();
  const didMountRef = useRef(false);

  useEffect(() => {
    const handlePopState = () => {
      if (!prefersReducedMotion()) {
        setTimelineFade("out");
      }
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true;
      return;
    }

    if (prefersReducedMotion()) {
      clearTimelineFade();
      return;
    }

    setTimelineFade("in");
    const timeoutId = window.setTimeout(clearTimelineFade, FADE_IN_MS);

    return () => window.clearTimeout(timeoutId);
  }, [pathname]);

  return null;
}
