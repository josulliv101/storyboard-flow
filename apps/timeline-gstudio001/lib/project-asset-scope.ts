import "server-only";

import { getFirebaseTimelineDocument } from "./firebase-timeline-store";
import { TimelineAccessDeniedError } from "./timeline-ownership";

const PROJECT_ID_PATTERN = /^project-[a-zA-Z0-9_-]{1,160}$/;

export class ProjectAssetScopeError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404,
  ) {
    super(message);
    this.name = "ProjectAssetScopeError";
  }
}

/**
 * Resolve and authorize the root project that owns an asset request.
 *
 * The ownership read prevents a caller from using another project id as an
 * escape hatch into a different asset folder.
 */
export async function requireProjectAssetScope(
  value: unknown,
  uid: string,
): Promise<string> {
  if (typeof value !== "string" || !PROJECT_ID_PATTERN.test(value)) {
    throw new ProjectAssetScopeError("A valid projectId is required.", 400);
  }

  try {
    const project = await getFirebaseTimelineDocument(value, uid);
    if (project === null) {
      throw new ProjectAssetScopeError(`Project "${value}" was not found.`, 404);
    }
  } catch (error) {
    if (error instanceof ProjectAssetScopeError) throw error;
    if (error instanceof TimelineAccessDeniedError) {
      throw new ProjectAssetScopeError(`Project "${value}" was not found.`, 404);
    }
    throw error;
  }

  return value;
}
