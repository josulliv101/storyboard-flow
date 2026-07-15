"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";

import { type NodeId } from "../core/graph";
import { type LiveTrim } from "./trim-preview-context";

// Live trim values for CONSUMER content — delivered over a ref-backed
// emitter, deliberately outside the store. Live trims must never notify the
// store (that is what keeps bystander cards frozen during a drag), and the
// shell doesn't re-render mid-gesture either, so live values cannot flow to
// content as props. `useLiveTrim(id)` is the opt-in: content that calls it
// re-renders per pointer move — but ONLY the trimmed card's content, the one
// card that is supposed to be changing. Everything else stays still.
//
// The gesture (useTrimPointerDrag) publishes alongside the view's
// TrimPreview: the live split per move, and `null` on abort, no-op, AND
// successful commit (the committed node then carries the same values the
// last preview showed, so there is no flash).

export type LiveTrimChannel = Readonly<{
  publish: (nodeId: NodeId, live: LiveTrim | null) => void;
  subscribe: (listener: (nodeId: NodeId, live: LiveTrim | null) => void) => () => void;
}>;

const NOOP_CHANNEL: LiveTrimChannel = {
  publish: () => {},
  subscribe: () => () => {},
};

export const LiveTrimChannelContext = createContext<LiveTrimChannel>(NOOP_CHANNEL);

/** One stable channel per provider instance (mirrors the announce channel). */
export function useCreateLiveTrimChannel(): LiveTrimChannel {
  const channelRef = useRef<LiveTrimChannel | null>(null);
  if (channelRef.current === null) {
    const listeners = new Set<(nodeId: NodeId, live: LiveTrim | null) => void>();
    channelRef.current = {
      publish: (nodeId, live) => {
        for (const listener of listeners) listener(nodeId, live);
      },
      subscribe: (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    };
  }
  return channelRef.current;
}

/** The gesture side of the channel (internal — trim gestures publish here). */
export function useLiveTrimPublisher(): LiveTrimChannel["publish"] {
  return useContext(LiveTrimChannelContext).publish;
}

/**
 * The live trim split of a node mid-gesture, or null at rest. Opt-in for
 * content components that render live readouts (a duration pill tracking the
 * drag): subscribing re-renders THIS component per pointer move — scope it
 * to a leaf (the readout), not your whole card, if the card is expensive.
 */
export function useLiveTrim(nodeId: NodeId): LiveTrim | null {
  const channel = useContext(LiveTrimChannelContext);
  const [live, setLive] = useState<LiveTrim | null>(null);
  useEffect(() => {
    // A gesture can't be mid-flight for a node whose readout just mounted,
    // and unmount drops the subscription — no stale state either side.
    return channel.subscribe((id, next) => {
      if (id !== nodeId) return;
      setLive((current) => (current === next ? current : next));
    });
  }, [channel, nodeId]);
  return live;
}
