import { describe, expect, test } from "vitest";
import {
  getKeyboardReorderAction,
  IDLE_INTERCEPTED_KEYS,
  SESSION_INTERCEPTED_KEYS,
} from "./media-strip.keyboard";

describe("getKeyboardReorderAction", () => {
  test("returns null for any key when idle (no active session)", () => {
    expect(getKeyboardReorderAction("ArrowLeft", false)).toBeNull();
    expect(getKeyboardReorderAction("Enter", false)).toBeNull();
    expect(getKeyboardReorderAction("n", false)).toBeNull();
  });

  test("maps arrow keys to move actions during an active session", () => {
    expect(getKeyboardReorderAction("ArrowLeft", true)).toBe("move-left");
    expect(getKeyboardReorderAction("ArrowRight", true)).toBe("move-right");
    expect(getKeyboardReorderAction("ArrowUp", true)).toBe("move-up");
    expect(getKeyboardReorderAction("ArrowDown", true)).toBe("move-down");
  });

  test("maps Home/End to move-home/move-end", () => {
    expect(getKeyboardReorderAction("Home", true)).toBe("move-home");
    expect(getKeyboardReorderAction("End", true)).toBe("move-end");
  });

  test("maps 'n'/'N' to nest, case-insensitively", () => {
    expect(getKeyboardReorderAction("n", true)).toBe("nest");
    expect(getKeyboardReorderAction("N", true)).toBe("nest");
  });

  test("maps 'u'/'U' to move-to-parent, case-insensitively", () => {
    expect(getKeyboardReorderAction("u", true)).toBe("move-to-parent");
    expect(getKeyboardReorderAction("U", true)).toBe("move-to-parent");
  });

  test("maps Escape to cancel", () => {
    expect(getKeyboardReorderAction("Escape", true)).toBe("cancel");
  });

  test("maps Enter and Space to confirm", () => {
    expect(getKeyboardReorderAction("Enter", true)).toBe("confirm");
    expect(getKeyboardReorderAction(" ", true)).toBe("confirm");
  });

  test("returns null for keys with no session meaning", () => {
    expect(getKeyboardReorderAction("Tab", true)).toBeNull();
    expect(getKeyboardReorderAction("a", true)).toBeNull();
    expect(getKeyboardReorderAction("Backspace", true)).toBeNull();
  });
});

describe("IDLE_INTERCEPTED_KEYS / SESSION_INTERCEPTED_KEYS", () => {
  test("session keys are a superset of idle keys", () => {
    for (const key of IDLE_INTERCEPTED_KEYS) {
      expect(SESSION_INTERCEPTED_KEYS).toContain(key);
    }
  });

  test("session keys add the session-only controls", () => {
    expect(SESSION_INTERCEPTED_KEYS).toEqual(
      expect.arrayContaining(["Home", "End", "Escape", "n", "N", "u", "U"])
    );
  });

  test("idle keys don't include session-only controls", () => {
    expect(IDLE_INTERCEPTED_KEYS).not.toContain("Home");
    expect(IDLE_INTERCEPTED_KEYS).not.toContain("Escape");
    expect(IDLE_INTERCEPTED_KEYS).not.toContain("n");
  });
});
