import { Suspense } from "react";

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
}: Readonly<{ path: readonly string[]; uid: string }>) {
  const payloads = await loadFocusPathPayloads(path, uid);
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

  return (
    <Suspense fallback={null}>
      <FocusPathStream path={activeTimelinePath.map(decodeURIComponent)} uid={user.uid} />
    </Suspense>
  );
}
