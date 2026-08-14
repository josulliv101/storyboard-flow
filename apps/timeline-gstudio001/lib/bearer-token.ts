import { timingSafeEqual } from "node:crypto";

/**
 * Constant-time Bearer token check for MACHINE callers — the cron sweep and
 * the render worker.
 *
 * Extracted when the render worker became the second caller. It is four lines,
 * and four lines of security primitive copied twice is exactly the shape that
 * drifts: one copy grows a `!==` fast path, or forgets the length check that
 * makes `timingSafeEqual` safe to call at all (it throws on a length
 * mismatch), and nothing fails visibly.
 *
 * `left.length === right.length &&` is load-bearing for that reason, and it
 * also means length is NOT protected — comparing a 10-byte guess against a
 * 40-byte secret returns immediately. That is the standard trade and it is
 * fine: the secret's length is not the secret.
 */
export function bearerTokenMatches(header: string | null, secret: string): boolean {
  const presented = header?.startsWith("Bearer ") === true ? header.slice(7) : "";
  const left = Buffer.from(presented);
  const right = Buffer.from(secret);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * A configured secret, or null.
 *
 * Null must mean REFUSE, never "allow anyone" — these endpoints delete files
 * and start renders. Callers return 503 rather than 401 for it, because an
 * unconfigured deployment is a deployment problem, not a bad credential.
 *
 * An empty string counts as unset: a secret set to "" in an env file is a
 * mistake, and treating it as a valid credential would make `Bearer ` (with
 * nothing after it) authenticate.
 */
export function configuredSecret(value: string | undefined): string | null {
  return value === undefined || value.length === 0 ? null : value;
}
