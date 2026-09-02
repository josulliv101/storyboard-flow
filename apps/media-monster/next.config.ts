import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * NO GENERATED AGENT FILES.
   *
   * Next 16 writes `AGENTS.md` and `CLAUDE.md` into this directory on every
   * `next dev`. This repo has an instruction hierarchy that takes precedence
   * CLOSEST to the files being edited, so a generated app-level file silently
   * outranks the root `CLAUDE.md` and `AGENTS.md` for everything under
   * `apps/media-monster/` — with Next's boilerplate rather than this team's,
   * and its own text asks to be committed.
   *
   * Carried over from `apps/timeline-gstudio001`, where it was found the hard
   * way. `create-next-app --no-agents-md` only skips the one written at scaffold
   * time; this is the one written on every dev run.
   */
  agentRules: false,
  reactStrictMode: true,
};

export default nextConfig;
