/**
 * Trash-bin document id for a graph session, or `null` when there is no
 * session to own one.
 *
 * The distinction that matters: a signed-in user with an empty-string uid is
 * still signed in — only a `null` uid means signed out. A truthiness check
 * (`uid ? ... : null`) would collapse an empty-string uid onto the signed-out
 * case, and the boot effect returns early when the trash id is `null`, so the
 * graph would never leave its loading state for such a user. Gate on `null`
 * explicitly, mirroring `bootSessionKey`'s null-vs-empty handling.
 */
export function trashDocumentId(uid: string | null): string | null {
  return uid === null ? null : `trash-${uid}`;
}
