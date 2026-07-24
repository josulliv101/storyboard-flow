import type { DispatchRejection } from "@storyboard/ui/dnd-collections";

import type { ToolResult } from "./types";

/** A successful tool result: a human summary plus the machine payload. */
export function toolOk(text: string, structuredContent?: unknown): ToolResult {
  return structuredContent === undefined
    ? { content: [{ type: "text", text }] }
    : { content: [{ type: "text", text }], structuredContent };
}

/** A tool-level error the agent should see and can act on. */
export function toolError(text: string): ToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

/**
 * Turn a `store.dispatch` rejection into an agent-facing sentence. Every
 * reducer/policy rejection reason maps to something the agent can correct; the
 * `blocked-by-policy` case is the app's un-hydrated-collection veto.
 */
export function describeDispatchRejection(error: DispatchRejection): string {
  switch (error.reason) {
    case "missing-node":
      return `No node with id "${error.nodeId}".`;
    case "target-not-collection":
      return `Target "${error.nodeId}" is a clip, not a collection — items can only go inside a collection.`;
    case "would-create-cycle":
      return `That move would nest "${error.nodeId}" inside itself.`;
    case "cannot-move-root":
      return `"${error.nodeId}" is a top-level timeline and can't be moved.`;
    case "duplicate-node-id":
      return `A node with id "${error.nodeId}" already exists.`;
    case "invalid-node-id":
      return "That node id is empty or blank.";
    case "invalid-node":
      return "The node failed validation.";
    case "blocked-by-policy":
      return (
        error.message ??
        `The target collection hasn't loaded yet (${error.blockedIds.join(", ")}). Open it first, then retry.`
      );
    default:
      return "The edit was refused.";
  }
}
