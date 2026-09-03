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
  /**
   * DEV AND BUILD GET SEPARATE DIRECTORIES.
   *
   * They shared `.next` until now, which is the default and is wrong for a
   * checkout anyone runs both in: `next build` writes over the artifacts the
   * running dev server is serving from, and the dev server does not notice —
   * it keeps serving a directory that is being rewritten underneath it. The
   * symptom is "the dev server stopped working" with nothing in its log,
   * because from its side nothing failed.
   *
   * MEASURED HERE rather than assumed: after one `next dev` and one
   * `npm run build` against the same `.next`, that directory held BOTH a
   * `dev/` and a `build/` subtree plus a `BUILD_ID` from the production run.
   *
   * `apps/timeline-gstudio001` has carried this split for exactly this reason
   * and it should have come over with the shell. `NEXT_DIST_DIR` overrides it
   * so a SECOND dev server can run beside the usual one — needed to compare
   * two branches on one checkout without stopping the server you are working
   * in, which is the other way two Next processes end up sharing a directory.
   */
  distDir:
    process.env.NEXT_DIST_DIR ??
    (process.env.NODE_ENV === "development" ? ".next-dev" : ".next"),
};

export default nextConfig;
