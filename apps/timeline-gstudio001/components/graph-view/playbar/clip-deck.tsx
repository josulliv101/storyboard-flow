"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { LOOKS, SECTIONS, SHOTS, clamp } from "./playbar-model";
import { PLAYBAR_CSS, PLAYBAR_SCOPE } from "./playbar-styles";

/**
 * THE REFERENCE DESIGN'S CLIP DECK, ported to React (PL15-030).
 *
 * Three cards across with the centre one active, swipeable with a fling, each
 * card carrying its own frame, cut and source readouts, trim strip with
 * handles, in/out fields and tags.
 *
 * THE CONTENT-AREA HEADER IS GONE, as asked: no "Takes" chip and no
 * "17 takes · 02:00" count. The deck is the whole component.
 *
 * THE GLIDE IS WRITTEN, NOT RENDERED. `deckPos` is a float that eases toward an
 * integer target, and every card's transform, opacity, brightness and z-index
 * is derived from it — sixty times a second. Routing that through state would
 * re-render seventeen cards per frame to move them; the cards are rendered once
 * and `layout()` writes their styles directly, which is what the reference does
 * and for the same reason.
 *
 * WHAT STATE IS FOR: which card is active, each clip's trim, and which one is
 * playing. Those change when a person does something.
 */

const MODELS = ["H3 4-ref", "ref2va", "minimax-h3", "comfy-cloud H3"] as const;
/** Frames sampled across a clip's source for its trim strip. */
const CELLS = 16;
/** How much of a card's width the next one sits away by, plus the gap. */
const CARD_GAP_PX = 18;
/** Eases `deckPos` toward its target; below this it has arrived. */
const GLIDE_RATE = 0.16;
const GLIDE_SETTLED = 0.002;
/** A press that moves less than this is a tap, not a swipe. */
const TAP_SLOP_PX = 4;
/** How far a fling is projected, in ms of travel at release velocity. */
const FLING_PROJECTION_MS = 160;

type Clip = Readonly<{
  index: number;
  name: string;
  /** The full source length, and the trimmed range inside it. */
  source: number;
  trimIn: number;
  trimOut: number;
  looks: readonly string[];
  tags: readonly string[];
}>;

/** Deterministic, exactly as the reference builds them — a story fixture must
 *  not wander between runs. */
const CLIPS: readonly Clip[] = SHOTS.map((shot) => {
  const i = shot.index;
  const duration = shot.end - shot.start;
  const head = Number((0.4 + ((i * 37) % 23) / 10).toFixed(2));
  const tail = Number((0.6 + ((i * 53) % 17) / 10).toFixed(2));
  const section = SECTIONS.find((s) => i >= s.first && i <= s.last)?.name ?? "";
  const model = MODELS[i % MODELS.length]!;
  return {
    index: i,
    name: `SH ${String(i + 1).padStart(2, "0")} — ${section} take (${model}, seed ${100 + ((i * 97) % 880)})`,
    source: Number((head + duration + tail).toFixed(2)),
    trimIn: head,
    trimOut: Number((head + duration).toFixed(2)),
    looks: shot.frames.map((frame) => frame.look),
    tags: [
      section.toLowerCase().replace(/\s+/g, "-"),
      `SH${String(i + 1).padStart(2, "0")}`,
      model.split(" ")[0]!.toLowerCase(),
    ],
  };
});

type Trim = Readonly<{ in: number; out: number }>;

export function ClipDeck({ className }: Readonly<{ className?: string }>) {
  const deckRef = useRef<HTMLDivElement | null>(null);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);
  const posRef = useRef(6); // boots on the shot the reference selects
  const targetRef = useRef(6);
  const rafRef = useRef(0);
  const dragRef = useRef<{
    startX: number;
    startPos: number;
    lastX: number;
    lastAt: number;
    velocity: number;
    moved: boolean;
    cardIndex: number | null;
  } | null>(null);
  const spacingRef = useRef(480);

  const [active, setActive] = useState(6);
  const [trims, setTrims] = useState<readonly Trim[]>(() =>
    CLIPS.map((clip) => ({ in: clip.trimIn, out: clip.trimOut })),
  );

  const reduced = useMemo(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    [],
  );

  /* ── the glide ──────────────────────────────────────────────────────── */

  const layout = useCallback(() => {
    const cards = cardRefs.current;
    const first = cards[0];
    if (first == null) return;
    const width = first.offsetWidth || 480;
    spacingRef.current = width * 0.93 + CARD_GAP_PX;
    const pos = posRef.current;
    const near = Math.round(clamp(pos, 0, CLIPS.length - 1));

    cards.forEach((card, i) => {
      if (card == null) return;
      const offset = i - pos;
      const distance = Math.abs(offset);
      const k = Math.min(distance, 1);
      card.style.transform = `translate(calc(-50% + ${offset * spacingRef.current}px), -50%) scale(${1 - k * 0.14})`;
      card.style.opacity = String(distance > 2 ? 0 : (1 - k * 0.16) * clamp(2 - distance, 0, 1));
      card.style.filter = `brightness(${1 - k * 0.22}) saturate(${1 - k * 0.08})`;
      card.style.zIndex = String(30 - Math.round(distance * 6));
      card.style.pointerEvents = distance > 1.6 ? "none" : "";
      card.classList.toggle("active", i === near);
    });
    return near;
  }, []);

  const animate = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    const step = () => {
      const delta = targetRef.current - posRef.current;
      if (Math.abs(delta) < GLIDE_SETTLED) {
        posRef.current = targetRef.current;
        const near = layout();
        if (near !== undefined) setActive(near);
        return;
      }
      posRef.current += delta * (reduced ? 1 : GLIDE_RATE);
      const near = layout();
      if (near !== undefined) setActive(near);
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
  }, [layout, reduced]);

  const goTo = useCallback(
    (index: number) => {
      targetRef.current = clamp(Math.round(index), 0, CLIPS.length - 1);
      if (dragRef.current === null) animate();
    },
    [animate],
  );

  useEffect(() => {
    layout();
    const onResize = () => layout();
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", onResize);
    };
  }, [layout]);

  /* ── swipe ──────────────────────────────────────────────────────────── */

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    // Controls inside a card are not a swipe surface.
    if (target.closest("input, button, .c-win, .c-tags") !== null) return;
    const card = target.closest<HTMLElement>(".clip");
    cancelAnimationFrame(rafRef.current);
    dragRef.current = {
      startX: event.clientX,
      startPos: posRef.current,
      lastX: event.clientX,
      lastAt: performance.now(),
      velocity: 0,
      moved: false,
      cardIndex: card === null ? null : Number(card.dataset.i),
    };
    // Capture is an ENHANCEMENT, not a requirement: it keeps the drag alive when
    // the pointer leaves the element. A browser that refuses it (or a
    // synthesised pointer, which has no capture to take) must still pan, so a
    // failure here cannot be allowed to abort the gesture.
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // No capture; the window-level listeners still see the drag through.
    }
    deckRef.current?.classList.add("dragging");
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (drag === null) return;
    const now = performance.now();
    const dt = now - drag.lastAt;
    if (dt > 0) drag.velocity = drag.velocity * 0.7 + ((event.clientX - drag.lastX) / dt) * 0.3;
    drag.lastX = event.clientX;
    drag.lastAt = now;
    posRef.current = clamp(
      drag.startPos - (event.clientX - drag.startX) / spacingRef.current,
      -0.5,
      CLIPS.length - 0.5,
    );
    if (!drag.moved && Math.abs(event.clientX - drag.startX) > TAP_SLOP_PX) drag.moved = true;
    const near = layout();
    if (near !== undefined) setActive(near);
  };

  const onPointerUp = () => {
    const drag = dragRef.current;
    if (drag === null) return;
    dragRef.current = null;
    deckRef.current?.classList.remove("dragging");
    if (!drag.moved) {
      // A tap on a side card brings it to the centre; on the centre it does
      // nothing, which is what makes tapping safe while reading one.
      if (drag.cardIndex !== null) goTo(drag.cardIndex);
      else animate();
      return;
    }
    // Project the throw: velocity is px/ms and a card is `spacing` px wide.
    goTo(posRef.current + (-drag.velocity * FLING_PROJECTION_MS) / spacingRef.current);
    animate();
  };

  /* ── trim ───────────────────────────────────────────────────────────── */

  const dragTrim = (index: number, edge: "in" | "out") => (event: React.PointerEvent) => {
    event.stopPropagation();
    event.preventDefault();
    const strip = (event.currentTarget as HTMLElement).closest<HTMLElement>(".c-strip");
    const clip = CLIPS[index];
    if (strip == null || clip === undefined) return;
    const box = strip.getBoundingClientRect();
    const move = (moveEvent: PointerEvent) => {
      const ratio = clamp((moveEvent.clientX - box.left) / box.width, 0, 1);
      const at = Number((ratio * clip.source).toFixed(2));
      setTrims((current) =>
        current.map((trim, i) => {
          if (i !== index) return trim;
          // A window cannot cross itself; a tenth of a second is the floor.
          return edge === "in"
            ? { ...trim, in: Math.min(at, trim.out - 0.1) }
            : { ...trim, out: Math.max(at, trim.in + 0.1) };
        }),
      );
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div className={[PLAYBAR_SCOPE, className ?? ""].join(" ").trim()}>
      <style>{PLAYBAR_CSS}</style>
      <main className="stage">
        <section className="area">
          <section
            className="deck"
            ref={deckRef}
            aria-label="Clip takes"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            <div className="deck-track">
              {CLIPS.map((clip, index) => {
                const trim = trims[index]!;
                const cut = Number((trim.out - trim.in).toFixed(2));
                const left = (trim.in / clip.source) * 100;
                const width = ((trim.out - trim.in) / clip.source) * 100;
                return (
                  <div
                    key={clip.index}
                    className={`clip${index === active ? " active" : ""}`}
                    data-i={index}
                    ref={(node) => {
                      cardRefs.current[index] = node;
                    }}
                  >
                    <header className="c-head">
                      <span className="c-id">clip {index + 1}</span>
                      <span className="c-dur">
                        <b className="c-trim">{cut.toFixed(2)}s</b>
                        <i>/</i>
                        <span className="c-srcd">{clip.source.toFixed(2)}s</span>
                      </span>
                      <button className="c-menu" title="Clip options" type="button">
                        ⋯
                      </button>
                    </header>

                    <h3 className="c-title" title={clip.name}>
                      {clip.name}
                    </h3>

                    <div className="c-view">
                      <div
                        className="c-frame cine"
                        style={{ background: LOOKS[clip.looks[0] ?? ""] }}
                      />
                    </div>

                    <div className="c-bar">
                      <button className="c-play" title="Play trimmed range" type="button">
                        <svg viewBox="0 0 12 12" aria-hidden="true">
                          <path d="M3 1.5v9l7.5-4.5z" />
                        </svg>
                      </button>
                      <span className="c-cut">
                        cut <b>0.00s</b>
                      </span>
                      <span className="c-srct">
                        src <b>{trim.in.toFixed(2)}s</b>
                      </span>
                    </div>

                    <div className="c-strip">
                      {Array.from({ length: CELLS }, (_, cell) => (
                        <div
                          key={cell}
                          className="c-cell"
                          style={{
                            background:
                              LOOKS[
                                clip.looks[Math.floor((cell / CELLS) * clip.looks.length)] ?? ""
                              ],
                          }}
                        />
                      ))}
                      <div className="c-shade l" style={{ width: `${left}%` }} />
                      <div
                        className="c-shade r"
                        style={{ left: `${left + width}%`, right: 0, width: "auto" }}
                      />
                      <div className="c-win" style={{ left: `${left}%`, width: `${width}%` }}>
                        <i className="c-h l" onPointerDown={dragTrim(index, "in")} />
                        <i className="c-h r" onPointerDown={dragTrim(index, "out")} />
                      </div>
                    </div>

                    <div className="c-io">
                      <label>in</label>
                      <input className="c-in" spellCheck={false} readOnly value={trim.in.toFixed(2)} />
                      <span className="arr">→</span>
                      <label>out</label>
                      <input
                        className="c-out"
                        spellCheck={false}
                        readOnly
                        value={trim.out.toFixed(2)}
                      />
                      <span className="c-total">{cut.toFixed(2)}s</span>
                    </div>

                    <div className="c-tags">
                      {clip.tags.map((tag) => (
                        <span key={tag} className="c-tag">
                          {tag}
                          <b>×</b>
                        </span>
                      ))}
                      <button className="c-add" title="Add tag" type="button">
                        +
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </section>
      </main>
    </div>
  );
}
