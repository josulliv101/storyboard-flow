import { useCallback, useState } from "react";

/**
 * Manages the board's aria-live announcer text.
 *
 * aria-live regions only re-announce when the text content actually changes,
 * so repeating the same message (e.g. two rejected moves in a row) would be
 * silent. Toggling a trailing zero-width space makes the content "new" to
 * the screen reader without changing what it speaks.
 */
export function useMediaStripAnnouncements() {
  const [announcement, setAnnouncement] = useState<string>("");

  const announce = useCallback((message: string) => {
    setAnnouncement((prev) => {
      if (prev === message) {
        return message + "​";
      }
      if (prev === message + "​") {
        return message;
      }
      return message;
    });
  }, []);

  return { announcement, announce };
}
