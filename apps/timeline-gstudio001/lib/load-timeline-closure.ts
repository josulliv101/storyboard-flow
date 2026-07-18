import "server-only";

import type { TimelineDocument } from "@storyboard/timeline-model/types";

import { getFirebaseTimelineDocument } from "./firebase-timeline-store";

// The nested document closure for a timeline: the root plus every document
// reachable through collection clips, breadth-first with a visited set (a
// reference cycle in stored data terminates the WALK here; the manifest
// compiler still refuses to flatten it). A child that fails to load —
// missing, or another user's — is substituted with an EMPTY document and
// reported, so a dangling reference degrades that branch to silence
// instead of failing the whole preview.

export async function loadTimelineClosure(
  rootId: string,
  requesterUid: string,
): Promise<{ documents: Record<string, TimelineDocument>; missing: string[] }> {
  const documents: Record<string, TimelineDocument> = {};
  const missing: string[] = [];
  const queue: string[] = [rootId];
  const seen = new Set<string>([rootId]);

  while (queue.length > 0) {
    const id = queue.shift();
    if (id === undefined) break;
    const document = await getFirebaseTimelineDocument(id, requesterUid).catch(() => null);
    if (!document) {
      if (id !== rootId) {
        missing.push(id);
        documents[id] = { id, title: "", clips: [] };
        continue;
      }
      // A missing ROOT is the caller's 404 to raise, not ours to hide.
      documents[id] = { id, title: "", clips: [] };
      missing.push(id);
      continue;
    }
    documents[id] = document;
    for (const clip of document.clips) {
      if (clip.kind !== "collection" || !clip.childTimelineId) continue;
      if (seen.has(clip.childTimelineId)) continue;
      seen.add(clip.childTimelineId);
      queue.push(clip.childTimelineId);
    }
  }

  return { documents, missing };
}
