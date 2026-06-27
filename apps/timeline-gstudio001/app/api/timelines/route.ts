import { NextResponse } from "next/server";

import {
  createFirebaseTimelineProject,
  listFirebaseTimelineProjects,
} from "@/lib/firebase-timeline-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function storageErrorResponse(error: unknown, fallback: string) {
  const message =
    error instanceof Error &&
    (error.message.startsWith("Firebase Storage is not configured") ||
      error.message.includes("timed out"))
      ? error.message
      : fallback;

  console.error("[GSTUDIO_PROJECTS_ERROR]", error);
  return NextResponse.json({ error: message }, { status: 500 });
}

export async function GET() {
  try {
    return NextResponse.json({ projects: await listFirebaseTimelineProjects() });
  } catch (error) {
    return storageErrorResponse(error, "Unable to load timeline projects.");
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { title?: unknown };
    const title = typeof body.title === "string" ? body.title : undefined;
    const project = await createFirebaseTimelineProject(title);

    return NextResponse.json({ project }, { status: 201 });
  } catch (error) {
    return storageErrorResponse(error, "Unable to create a timeline project.");
  }
}
