import { NextResponse } from "next/server";

import type { TimelineDocument } from "@/components/timeline/types";
import {
  getFirebaseTimelineDocument,
  saveFirebaseTimelineDocument,
  deleteFirebaseTimelineDocument,
} from "@/lib/firebase-timeline-store";
import { getTimelineDocument } from "@/lib/timeline-documents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isValidTimelineId(id: string) {
  return /^[a-zA-Z0-9_-]+$/.test(id);
}

function storageErrorResponse(error: unknown, fallback: string) {
  const message =
    error instanceof Error &&
    (error.message.startsWith("Firebase Storage is not configured") ||
      error.message.includes("timed out"))
      ? error.message
      : fallback;

  console.error("[GSTUDIO_TIMELINE_STORAGE_ERROR]", error);
  return NextResponse.json({ error: message }, { status: 500 });
}

function isTimelineDocument(value: unknown): value is TimelineDocument {
  if (!value || typeof value !== "object") return false;
  const document = value as Partial<TimelineDocument>;

  return (
    typeof document.id === "string" &&
    typeof document.title === "string" &&
    Array.isArray(document.clips)
  );
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    if (!isValidTimelineId(id)) {
      return NextResponse.json({ error: "Invalid timeline id." }, { status: 400 });
    }

    const firebaseDocument = await getFirebaseTimelineDocument(id);
    if (firebaseDocument) {
      return NextResponse.json({ document: firebaseDocument });
    }

    const fallbackDocument = getTimelineDocument(id);
    if (!fallbackDocument) {
      return NextResponse.json({ error: "Timeline was not found." }, { status: 404 });
    }

    const savedDocument = await saveFirebaseTimelineDocument(fallbackDocument);
    return NextResponse.json({ document: savedDocument });
  } catch (error) {
    return storageErrorResponse(error, "Unable to load the timeline document.");
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    if (!isValidTimelineId(id)) {
      return NextResponse.json({ error: "Invalid timeline id." }, { status: 400 });
    }

    const body = (await request.json().catch(() => ({}))) as {
      document?: unknown;
    };

    if (!isTimelineDocument(body.document) || body.document.id !== id) {
      return NextResponse.json({ error: "A valid timeline document is required." }, { status: 400 });
    }

    const savedDocument = await saveFirebaseTimelineDocument(body.document);
    return NextResponse.json({ document: savedDocument });
  } catch (error) {
    return storageErrorResponse(error, "Unable to save the timeline document.");
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    if (!isValidTimelineId(id)) {
      return NextResponse.json({ error: "Invalid timeline id." }, { status: 400 });
    }

    await deleteFirebaseTimelineDocument(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    return storageErrorResponse(error, "Unable to delete the timeline document.");
  }
}
