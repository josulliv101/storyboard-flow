/**
 * Read a request body as a JSON OBJECT, or `{}` when it isn't one.
 *
 * Every route used to do this inline:
 *
 *     const body = (await request.json().catch(() => ({}))) as { writes?: … };
 *
 * which reads as safe and is not. `JSON.parse("null")` succeeds, so a literal
 * `null` body skips the `.catch` entirely, `body` is `null`, and the very next
 * property access throws a TypeError — caught by the route's outer handler and
 * reported as a 500. A malformed request should be a 400. The same shape
 * appeared in six routes (both auth routes, both timelines routes, the batch
 * endpoint, and trash), so all six answered 500 to `null`, `[]`, `"x"`, and
 * `42`.
 *
 * Returning `Record<string, unknown>` rather than an asserted shape is the
 * other half: callers must narrow each field they read, which is what they
 * were already doing by hand (`typeof body.title === "string"`) under a cast
 * that claimed the narrowing had happened.
 */
export async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  const parsed: unknown = await request.json().catch(() => null);
  // Arrays are objects; a JSON array body is still not the record any of these
  // routes expects, so it degrades to empty like every other non-object.
  return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}
