"use client";

import { useEffect } from "react";

import {
  graphDocumentsGateway,
  type GraphServerPayload,
} from "@/lib/graph-documents-gateway";

/**
 * Feeds RSC-delivered payloads (focus-path streams) into the documents
 * gateway. Priming is guarded inside the gateway (never over local edits,
 * never regressing the revision ledger), and everything downstream —
 * hydration, details, validation — flows through the existing seams
 * reading the gateway cache, so this component carries DATA only, no
 * semantics. Rendered by the (remounting) page, outside the provider tree
 * on purpose: it touches nothing but the module-level gateway.
 */
export function GraphGatewayPrimer({
  payloads,
}: Readonly<{ payloads: readonly GraphServerPayload[] }>) {
  useEffect(() => {
    for (const payload of payloads) {
      graphDocumentsGateway.prime(payload.document, payload.revision, payload.forUid);
    }
  }, [payloads]);

  return null;
}
