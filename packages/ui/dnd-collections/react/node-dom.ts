"use client";

import { type NodeId } from "../core/graph";

const DEFAULT_FOCUS_TIMEOUT_MS = 1000;

/** Find a rendered node without requiring CSS.escape in older DOM hosts. */
export function findNodeElement(root: ParentNode, nodeId: NodeId): HTMLElement | null {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return root.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(nodeId)}"]`);
  }
  for (const candidate of root.querySelectorAll<HTMLElement>("[data-node-id]")) {
    if (candidate.dataset.nodeId === nodeId) return candidate;
  }
  return null;
}

/**
 * Focus a card now or when virtualization mounts it. Mutation observation is
 * tied to actual DOM readiness; the timeout is only a cleanup boundary.
 */
export function focusNodeWhenMounted(
  root: HTMLElement,
  nodeId: NodeId,
  options: Readonly<{ fallbackId?: NodeId; timeoutMs?: number }> = {}
): () => void {
  let active = true;
  let observer: MutationObserver | null = null;
  let frame = 0;
  let timeout = 0;

  const cleanup = () => {
    if (!active) return;
    active = false;
    observer?.disconnect();
    if (frame) cancelAnimationFrame(frame);
    if (timeout) window.clearTimeout(timeout);
  };

  const focusIfPresent = () => {
    if (!active) return;
    const card = findNodeElement(root, nodeId);
    if (!card) return;
    cleanup();
    card.focus();
  };

  observer = new MutationObserver(focusIfPresent);
  observer.observe(root, { childList: true, subtree: true });
  frame = requestAnimationFrame(focusIfPresent);
  timeout = window.setTimeout(() => {
    const fallback = options.fallbackId
      ? findNodeElement(root, options.fallbackId)
      : null;
    cleanup();
    fallback?.focus();
  }, options.timeoutMs ?? DEFAULT_FOCUS_TIMEOUT_MS);

  return cleanup;
}
