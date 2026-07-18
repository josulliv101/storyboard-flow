// The stored document/clip model types live in @storyboard/timeline-model
// (framework-free, shared with server routes and the graph adapter) — re-
// exported so every existing "@storyboard/ui/timeline/types" import keeps
// working. Only view-layer types remain defined here.
export * from "@storyboard/timeline-model/types";

export type TrimScrubPreview = {
  clipIndex: number;
  time: number;
};

export type VideoSourceWindowEditMode = "move" | "center" | "left" | "right";

export type MediaSpec =
  | { kind: "image"; aspect: number }
  | { kind: "video"; aspect: number; src: string; duration?: number };
