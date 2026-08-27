"use client";

import { type NodeId } from "@storyboard/collections-core/graph";

const DEFAULT_FOCUS_TIMEOUT_MS = 1000;

/**
 * Opt a subtree OUT of the package's keyboard delegation. Put it on any
 * wrapper whose keys belong to the consumer — a widget the editable-element
 * check below can't recognize (a custom combobox, a canvas editor, a
 * third-party control).
 */
export const KEYBOARD_IGNORE_ATTRIBUTE = "data-collections-keyboard-ignore";

const EDITABLE_SELECTOR = [
  "input",
  "textarea",
  "select",
  "[contenteditable=''],[contenteditable='true'],[contenteditable='plaintext-only']",
  `[${KEYBOARD_IGNORE_ATTRIBUTE}]`,
].join(",");

/**
 * Whether a key event belongs to the element the user is typing in, rather
 * than to the collection.
 *
 * The compound primitives explicitly promise interactive controls INSIDE
 * cards, and the package's own delegation contradicted that: the Alt chords
 * walk up to the nearest card wrapper, and virtual views intercept bare
 * arrows bubbling from any descendant. So an <input> in a card had its arrow
 * keys stolen to move focus, and Alt+Arrow reordered the card instead of
 * reaching the control. Both now consult this first.
 *
 * Deliberately checks ancestors, not just the target: the focused element may
 * be a child of the editable host (contenteditable especially).
 */
export function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return target.closest(EDITABLE_SELECTOR) !== null;
}

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
