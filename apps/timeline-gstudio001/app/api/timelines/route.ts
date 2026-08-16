import { NextResponse } from "next/server";

import { readJsonObject } from "@/lib/read-json-body";

import {
  createFirebaseTimelineProject,
  listFirebaseTimelineProjects,
} from "@/lib/firebase-timeline-store";
import { requireAuthUser } from "@/lib/firebase-auth-session";
import { clientFacingStorageMessage } from "@/lib/firestore-failure";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function storageErrorResponse(error: unknown, fallback: string) {
  const message = clientFacingStorageMessage(error, fallback);

  console.error("[GSTUDIO_PROJECTS_ERROR]", error);
  return NextResponse.json({ error: message }, { status: 500 });
}

export async function GET() {
  try {
    const { user, response } = await requireAuthUser();
    if (response || !user) return response || NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    return NextResponse.json({ projects: await listFirebaseTimelineProjects(user.uid) });
  } catch (error) {
    return storageErrorResponse(error, "Unable to load timeline projects.");
  }
}

export async function POST(request: Request) {
  try {
    const { user, response } = await requireAuthUser();
    if (response || !user) return response || NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await readJsonObject(request);
    const title = typeof body.title === "string" ? body.title : undefined;
    const project = await createFirebaseTimelineProject(user.uid, title);

    return NextResponse.json({ project }, { status: 201 });
  } catch (error) {
    return storageErrorResponse(error, "Unable to create a timeline project.");
  }
}
