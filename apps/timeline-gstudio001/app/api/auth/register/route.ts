import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  return NextResponse.json(
    { error: "Password registration is disabled. Use email-link sign-in." },
    { status: 410 },
  );
}
