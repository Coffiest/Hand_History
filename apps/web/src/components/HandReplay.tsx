"use client";

import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { PlayingCard } from "./PlayingCard";
import { cardDisplay } from "@/lib/cards";
import { madeHandName } from "@/lib/handEval";
import {
  ACTION_LABEL,
  STREETS,
  STREET_LABEL_JA,
  type StoredHand,
  type Street,
} from "@/lib/handTypes";

// Street-by-street animated replay. Shared by the private hand-detail page and
// the public share page. Cards deal in with a spring; a Play control steps the
// board street-by-street (the "animation" share format).

export function HandReplay({ hand }: { hand: StoredHand }) {
  const hole = useMemo(
    () => hand.cards.filter((c) => c.role === "hole").sort((a, b) => a.position - b.position),
    [hand],
  );
  const boardByStreet = useMemo(() => {
    const map: Record<Street, typeof hand.cards> = { preflop: [], flop: [], turn: [], river: [] };
    for (const c of hand.cards) {
      if (c.role === "board" && c.boardStreet) map[c.boardStreet].push(c);
    }
    for (const s of STREETS) map[s].sort((a, b) => a.position - b.position);
    return map;
  }, [hand]);

  const revealableStreets = STREETS.filter(
    (s) => boardByStreet[s].length > 0 || hand.actions.some((a) => a.street === s),
  );

  // Reveal step: 0 = hole only, then one per revealable street.
  const [step, setStep] = useState(revealableStreets.length);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!playing) return;
    if (step >= revealableStreets.length) {
      setPlaying(false);
      return;
    }
    const t = setTimeout(() => setStep((s) => s + 1), 1100);
    return () => clearTimeout(t);
  }, [playing, step, revealableStreets.length]);

  const play = () => {
    setStep(0);
    setPlaying(true);
  };

  const shownBoard = revealableStreets
    .slice(0, step)
    .flatMap((s) => boardByStreet[s]);
  const madeHand = madeHandName(hole, shownBoard);

  return (
    <div className="space-y-6">
      {/* Board table */}
      <div className="rounded-4xl bg-gradient-to-b from-suit-club/10 to-suit-club/5 ring-1 ring-suit-club/15 p-6">
        <div className="text-center mb-4">
          <span className="text-[11px] tracking-widest text-gray3 uppercase">Board</span>
        </div>
        <div className="flex items-center justify-center gap-2 min-h-[112px]">
          <AnimatePresence>
            {shownBoard.length > 0 ? (
              shownBoard.map((c, i) => (
                <motion.div key={`${c.rank}${c.suit}-${i}`} layout>
                  <PlayingCard card={c} size="lg" dealDelay={i * 0.08} />
                </motion.div>
              ))
            ) : (
              <span className="text-sm text-gray3">プリフロップ</span>
            )}
          </AnimatePresence>
        </div>

        {madeHand && (
          <div className="text-center mt-4">
            <span className="inline-block text-sm font-semibold text-gold-dark bg-gold/15 px-3 py-1 rounded-full">
              {madeHand}
            </span>
          </div>
        )}
      </div>

      {/* Hero hole cards */}
      <div className="flex flex-col items-center gap-2">
        <span className="text-[11px] tracking-widest text-gray3 uppercase">Hero</span>
        <div className="flex gap-2">
          {hole.length > 0 ? (
            hole.map((c, i) => <PlayingCard key={i} card={c} size="lg" dealDelay={i * 0.05} />)
          ) : (
            <>
              <PlayingCard empty size="lg" />
              <PlayingCard empty size="lg" />
            </>
          )}
        </div>
        {hand.heroPosition && <span className="text-xs text-gray2">{hand.heroPosition}</span>}
      </div>

      {/* Play control */}
      {revealableStreets.length > 0 && (
        <div className="flex justify-center">
          <button
            onClick={play}
            disabled={playing}
            className="rounded-full bg-ink text-white text-sm font-semibold px-6 py-2.5 active:scale-95 transition-transform disabled:opacity-50"
          >
            {playing ? "再生中…" : "▶ リプレイ"}
          </button>
        </div>
      )}

      {/* Action log */}
      <div className="space-y-3">
        {revealableStreets.map((street) => {
          const actions = hand.actions
            .filter((a) => a.street === street)
            .sort((a, b) => a.sequenceNumber - b.sequenceNumber);
          const board = boardByStreet[street];
          if (actions.length === 0 && board.length === 0) return null;
          return (
            <div key={street} className="rounded-2xl bg-white ring-1 ring-border p-4 shadow-card">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-sm font-semibold text-ink">{STREET_LABEL_JA[street]}</span>
                {board.length > 0 && (
                  <span className="flex gap-1">
                    {board.map((c, i) => (
                      <PlayingCard key={i} card={c} size="xs" />
                    ))}
                  </span>
                )}
              </div>
              {actions.length > 0 ? (
                <div className="space-y-1">
                  {actions.map((a, i) => (
                    <div key={i} className="text-sm text-gray2">
                      <span className="text-ink font-medium">{a.actorLabel}</span> · {ACTION_LABEL[a.kind]}
                      {a.toAmount != null ? ` ${a.toAmount}` : ""}
                    </div>
                  ))}
                </div>
              ) : (
                <span className="text-xs text-gray3">アクション記録なし</span>
              )}
            </div>
          );
        })}
      </div>

      {/* Result */}
      {(hand.potTotal != null || hand.resultAmount != null) && (
        <div className="flex items-center justify-center gap-6 text-center">
          {hand.potTotal != null && (
            <div>
              <div className="text-xs text-gray3">ポット</div>
              <div className="text-lg font-bold text-ink">{hand.potTotal}</div>
            </div>
          )}
          {hand.resultAmount != null && (
            <div>
              <div className="text-xs text-gray3">収支</div>
              <div className={`text-lg font-bold ${hand.resultAmount >= 0 ? "text-suit-club" : "text-suit-heart"}`}>
                {hand.resultAmount >= 0 ? "+" : ""}
                {hand.resultAmount}
              </div>
            </div>
          )}
        </div>
      )}

      {hand.notes && (
        <div className="rounded-2xl bg-surface p-4 text-sm text-gray2">{hand.notes}</div>
      )}
    </div>
  );
}
