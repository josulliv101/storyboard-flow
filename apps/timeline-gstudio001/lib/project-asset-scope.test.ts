import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  result: { id: "project-a" } as { id: string } | null,
  denied: false,
}));

vi.mock("server-only", () => ({}));
vi.mock("./firebase-timeline-store", async () => {
  const { TimelineAccessDeniedError } =
    await vi.importActual<typeof import("./timeline-ownership")>("./timeline-ownership");
  return {
    readStoredTimelineDocument: async (id: string) => {
      if (state.denied) throw new TimelineAccessDeniedError(id);
      return state.result;
    },
  };
});

import {
  ProjectAssetScopeError,
  requireProjectAssetScope,
} from "./project-asset-scope";

beforeEach(() => {
  state.result = { id: "project-a" };
  state.denied = false;
});

describe("requireProjectAssetScope", () => {
  it("accepts an owned root project", async () => {
    await expect(requireProjectAssetScope("project-a", "user-a")).resolves.toBe(
      "project-a",
    );
  });

  it.each([null, "", "timeline-child", "project-a/../project-b"])(
    "rejects an invalid project boundary (%s)",
    async (value) => {
      await expect(requireProjectAssetScope(value, "user-a")).rejects.toMatchObject({
        status: 400,
      } satisfies Partial<ProjectAssetScopeError>);
    },
  );

  it("rejects a missing project", async () => {
    state.result = null;
    await expect(
      requireProjectAssetScope("project-missing", "user-a"),
    ).rejects.toMatchObject({ status: 404 } satisfies Partial<ProjectAssetScopeError>);
  });

  it("does not expose a project owned by someone else", async () => {
    state.denied = true;
    await expect(
      requireProjectAssetScope("project-b", "user-a"),
    ).rejects.toMatchObject({ status: 404 } satisfies Partial<ProjectAssetScopeError>);
  });
});
