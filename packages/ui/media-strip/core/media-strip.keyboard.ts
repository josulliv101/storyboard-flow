import { type KeyboardReorderAction } from "./media-strip.types";

/**
 * Keys the reorder handle intercepts (preventDefault + stopPropagation),
 * given whether a keyboard reorder session is currently active. Arrows are
 * blocked even when idle so a stray arrow press on the handle doesn't
 * trigger the ToggleGroup's roving focus navigation, and Enter/Space are
 * blocked so they pick up/drop instead of firing the button's default
 * action. Home/End/N/U/Escape are only meaningful mid-session, so when idle
 * they keep their defaults (e.g. page scroll).
 */
export const IDLE_INTERCEPTED_KEYS: readonly string[] = [
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Enter",
  " ",
];

export const SESSION_INTERCEPTED_KEYS: readonly string[] = [
  ...IDLE_INTERCEPTED_KEYS,
  "Home",
  "End",
  "Escape",
  "n",
  "N",
  "u",
  "U",
];

/**
 * Pure `event.key` -> `KeyboardReorderAction` mapping for an active
 * keyboard reorder session. Returns `null` when idle (nothing to map to —
 * starting a session isn't itself a `KeyboardReorderAction`) or for keys
 * with no session meaning. Split out of use-reorder-keyboard.ts so this
 * mapping is directly unit-testable without React or a DOM event.
 */
export function getKeyboardReorderAction(
  key: string,
  isKeyboardReordering: boolean
): KeyboardReorderAction | null {
  if (!isKeyboardReordering) return null;

  switch (key) {
    case "ArrowLeft":
      return "move-left";
    case "ArrowRight":
      return "move-right";
    case "ArrowUp":
      return "move-up";
    case "ArrowDown":
      return "move-down";
    case "Home":
      return "move-home";
    case "End":
      return "move-end";
    case "Escape":
      return "cancel";
    case "Enter":
    case " ":
      return "confirm";
    default: {
      const lower = key.toLowerCase();
      if (lower === "n") return "nest";
      if (lower === "u") return "move-to-parent";
      return null;
    }
  }
}
