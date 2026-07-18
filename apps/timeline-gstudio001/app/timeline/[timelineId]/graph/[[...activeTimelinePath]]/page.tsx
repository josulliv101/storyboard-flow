import { Suspense } from "react";
import { headers } from "next/headers";

import { GraphGatewayPrimer } from "@/components/graph-view/graph-gateway-primer";
import { getAuthUser } from "@/lib/firebase-auth-session";
import { loadFocusPathPayloads } from "@/lib/graph-rsc-payloads";

// This page REMOUNTS on every focus navigation (App Router keys pages by
// their dynamic params) — nothing stateful can live here; the whole
// interactive tree is mounted once by ../layout.tsx. What the remount IS
// good for: streaming this navigation's focus-path documents from the
// server under Suspense, so the client's hydration finds them already
// primed in the gateway instead of fetching. Best-effort — no session or
// a lost race just means the client's fetch-on-demand path covers it.

async function FocusPathStream({
  path,
  uid,
  focusedOnly,
}: Readonly<{ path: readonly string[]; uid: string; focusedOnly: boolean }>) {
  const payloads = await loadFocusPathPayloads(path, uid, { focusedOnly });
  if (payloads.length === 0) return null;
  return <GraphGatewayPrimer payloads={payloads} />;
}

export default async function GraphViewPage({
  params,
}: {
  params: Promise<{ timelineId: string; activeTimelinePath?: string[] }>;
}) {
  const { activeTimelinePath = [] } = await params;
  if (activeTimelinePath.length === 0) return null;

  const user = await getAuthUser();
  if (!user) return null;

  // Soft navigations arrive as RSC flight requests (the `RSC` header): the
  // client already holds the ancestors from boot and earlier navigations,
  // so only the newly focused tail is served. A document load (deep link)
  // has no such header and gets the full path. Header absent when
  // expected = full path — the safe direction (extra data, never less).
  const requestHeaders = await headers();
  const softNavigation = requestHeaders.get("rsc") === "1";

  return (
    <Suspense fallback={null}>
      <FocusPathStream
        path={activeTimelinePath.map(decodeURIComponent)}
        uid={user.uid}
        focusedOnly={softNavigation}
      />
    </Suspense>
  );
}
