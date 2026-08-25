"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { withViewTransition } from "@/lib/view-transition";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { useCollectionsStore } from "@storyboard/ui/dnd-collections";

import {
  GRAPH_ITEM_ACTION_EVENT,
  GRAPH_OPEN_ITEM_DETAILS_EVENT,
  type GraphItemAction,
} from "@/lib/graph-view-events";

/**
 * WHICH item has its details open (PL10-004 → PL11-002).
 *
 * It used to be a boolean mode paired with "whatever is selected", because the
 * only trigger was a toolbar button. The trigger now lives on the card itself,
 * and a card can be pressed without being the selection — so the open item is
 * named here rather than inferred. `null` is closed.
 *
 * IN THE URL, as `?details=<nodeId>` (PL15-029). It used to be session state,
 * and the reason it was is worth keeping even though the decision reversed:
 * the view costs a video element and a filmstrip, and surviving a reload means
 * paying that on a load where nobody asked for it.
 *
 * What changed is what the view IS. A modal is a state — something the board is
 * wearing. A view that replaces the content area is a PLACE, and a place that
 * cannot be linked to or backed out of is a broken one. Once details stopped
 * being an overlay, keeping the open item out of the URL stopped being thrift
 * and started being a missing feature.
 *
 * THE URL IS THE SOURCE OF TRUTH, with an optimistic value in front of it —
 * the same shape the graph's focus path uses, and for the same measured
 * reason: `router.push` does not commit until the App Router has answered the
 * RSC request for the segment, so publishing the id locally is what makes
 * opening feel immediate. The two agree by construction because the pending
 * value IS what was pushed, and it is dropped the moment a real URL change
 * arrives — a push landing, Back/Forward, or a deep link.
 *
 * OPEN AND CLOSE PUSH; SWITCHING CLIPS REPLACES. Opening is going somewhere, so
 * Back should leave — but swiping through eight clips should not leave eight
 * entries to walk back out through. Replace on a switch means Back always
 * returns to the board, from whichever clip you ended on.
 */
type ItemDetailsValue = Readonly<{
  openId: string | null;
  setOpenId: (next: string | null) => void;
}>;

const ItemDetailsContext = createContext<ItemDetailsValue | null>(null);

const CLOSED: ItemDetailsValue = { openId: null, setOpenId: () => {} };

/** The one spelling of the query key, so the reader and the writer agree. */
export const ITEM_DETAILS_PARAM = "details";

/**
 * THE CLICKED THUMBNAIL FLIES INTO THE VIEW (PL15-030).
 *
 * The flight starts HERE, and it has to. The details view replaced the board
 * rather than covering it (PL15-029), so by the time the view's own effect can
 * run the board is hidden — measured, the card still carried the hero name and
 * had ZERO WIDTH, so no "old" snapshot was ever taken and the morph was the
 * destination fading in by itself. This is the last moment the picture being
 * flown from is still on screen.
 *
 * `HERO` is the app's existing name, worn by the board card here and taken over
 * by the subject card's picture inside the details view. Only one element may
 * hold it, which the handover inside the callback guarantees.
 */
const HERO = "trim-subject";

/** The board card for this node, if it is on screen to fly from. */
function boardCard(id: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(id)}"]`);
}

export function ItemDetailsProvider({ children }: Readonly<{ children: ReactNode }>) {
  const router = useRouter();
  const pathname = usePathname();
  // The graph tree mounts client-only (`ssr: false` in client-graph-view), so
  // this has no prerender or Suspense implications — the same note the surface
  // and dev params carry.
  const searchParams = useSearchParams();
  const urlId = searchParams.get(ITEM_DETAILS_PARAM);

  // `undefined` means "nothing optimistic in flight"; `null` is the real value
  // "closed", which is why this is not just `string | null`.
  const [pending, setPending] = useState<string | null | undefined>(undefined);
  // Dropped DURING the render that sees a new URL rather than in an effect —
  // the documented adjust-state-on-change pattern used by the focus path, and
  // set-state-in-an-effect is a lint error here for exactly the extra render
  // it would cause.
  const [urlIdSeen, setUrlIdSeen] = useState(urlId);
  if (urlId !== urlIdSeen) {
    setUrlIdSeen(urlId);
    setPending(undefined);
  }
  const openId = pending === undefined ? urlId : pending;

  // THIS CALLBACK'S IDENTITY MUST NOT CHANGE, and the first version's did.
  //
  // `setOpenId` was a `useState` setter for its whole life, so every consumer
  // is entitled to treat it as stable — and one of them does, literally:
  // `useEffect(() => setOpenId(id), [id, setOpenId])`. Deriving it from
  // `openId`/`pathname`/`searchParams` gave it a new identity on every change
  // of the open item, which turned that effect into a loop that reopened the
  // clip you had just navigated away from. Four story tests caught it as
  // "clicking a neighbour does not advance", which is exactly what it looked
  // like from outside.
  //
  // The live values are read from a ref that an effect keeps current. One
  // render stale in principle, never in practice: effects run long before a
  // pointer can reach a control, and every caller here is a user gesture.
  const latest = useRef({ openId, pathname, searchParams });
  useEffect(() => {
    latest.current = { openId, pathname, searchParams };
  });

  const setOpenId = useCallback(
    (next: string | null) => {
      setPending(next);
      const { openId: current, pathname: path, searchParams: query } = latest.current;
      const params = new URLSearchParams(query.toString());
      if (next === null) params.delete(ITEM_DETAILS_PARAM);
      else params.set(ITEM_DETAILS_PARAM, next);
      const search = params.toString();
      const url = search ? `${path}?${search}` : path;
      const switching = next !== null && current !== null;
      // `scroll: false` on both: the App Router scrolls to top on a navigation
      // by default, and this one does not move the page — it changes what the
      // content area is showing.
      const commit = () => {
        if (switching) router.replace(url, { scroll: false });
        else router.push(url, { scroll: false });
      };

      // OPENING FROM THE BOARD IS THE ONLY FLIGHT. Switching between clips
      // already inside the view has no board card to come from, and closing is
      // the board returning rather than a picture travelling — the view owns
      // that one, where it still has itself on screen to fly from.
      const card =
        next === null || switching || typeof document === "undefined" ? null : boardCard(next);
      if (card === null) {
        setPending(next);
        commit();
        return;
      }

      card.style.setProperty("view-transition-name", HERO);
      void withViewTransition(
        () => {
        // The card gives the name up in the same frame the view takes it, so
        // exactly one element ever carries it. `withViewTransition` flushes
        // this synchronously — the browser captures the "after" state as soon
        // as the callback returns, and a queued update would leave nothing to
        // fly to.
          card.style.removeProperty("view-transition-name");
          setPending(next);
        },
        // RUNS EVEN UNDER REDUCED MOTION, asked for by name. The helper skips
        // entirely by default and that is right for things that slide about;
        // this is one picture becoming the same picture somewhere else, and it
        // is the only thing connecting the card you clicked to the view that
        // replaced it. Without it, opening a clip is a hard cut.
        { ignoreReducedMotion: true },
      );
      // The URL catches up after, and changes nothing anyone can see: `pending`
      // is already showing the view it names.
      commit();
    },
    [router],
  );

  const value = useMemo(() => ({ openId, setOpenId }), [openId, setOpenId]);
  return (
    <ItemDetailsContext.Provider value={value}>
      <ItemDetailsActionListener onOpen={setOpenId} />
      {children}
    </ItemDetailsContext.Provider>
  );
}

/**
 * Opens the details view, from either of its two triggers (PL13-009).
 *
 * The listener lives HERE rather than in the item-actions bridge, which is
 * mounted outside this provider and would only ever see the closed fallback.
 * The details feature owning its own trigger also means the rail knows nothing
 * about `openId` — it sends a verb and this decides what that means.
 *
 * TWO EVENTS, because there are two intents and only one of them has a
 * selection to read:
 *
 *   the Edit VERB acts on THE SELECTION. It reads it at the moment of the press
 *     rather than tracking it — the event IS the intent, and anything else
 *     would be a second copy of state the store already holds — and refuses
 *     anything that is not exactly one item. The sidebar disables the control
 *     past one, but a window event carries no proof of who sent it.
 *
 *   a CLICK ON A MEDIA CARD names its own item. A plain click opens a clip's
 *     editor without selecting it, so there is no selection here to read and
 *     the id travels with the request.
 */
function ItemDetailsActionListener({
  onOpen,
}: Readonly<{ onOpen: (id: string) => void }>) {
  const store = useCollectionsStore();

  useEffect(() => {
    const onAction = (event: Event) => {
      if ((event as CustomEvent<GraphItemAction>).detail !== "details") return;
      const selected = [...store.getSnapshot().interaction.selectedIds];
      if (selected.length !== 1) return;
      onOpen(selected[0] as string);
    };
    const onOpenOne = (event: Event) => {
      const nodeId = (event as CustomEvent<string>).detail;
      if (typeof nodeId === "string" && nodeId.length > 0) onOpen(nodeId);
    };
    window.addEventListener(GRAPH_ITEM_ACTION_EVENT, onAction);
    window.addEventListener(GRAPH_OPEN_ITEM_DETAILS_EVENT, onOpenOne);
    return () => {
      window.removeEventListener(GRAPH_ITEM_ACTION_EVENT, onAction);
      window.removeEventListener(GRAPH_OPEN_ITEM_DETAILS_EVENT, onOpenOne);
    };
  }, [store, onOpen]);

  return null;
}

/** Degrades to "never open" with no provider, so cards render standalone
 *  (stories, isolated surfaces) without one. */
export function useItemDetails(): ItemDetailsValue {
  return useContext(ItemDetailsContext) ?? CLOSED;
}
