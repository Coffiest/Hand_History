"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import {
  RANKS,
  SUIT_COLOR,
  SUIT_GLYPH,
  SUIT_ORDER,
  rankLabel,
  type CardValue,
  type SuitCode,
} from "@/lib/cards";

// Suit-then-rank picker. Reused for correcting a misrecognised card and for
// entering a card by hand. Big touch targets, Apple-native rounding.
export function ManualCardPicker({
  initial,
  onDone,
  onCancel,
}: {
  initial?: CardValue | null;
  onDone: (card: CardValue) => void;
  onCancel: () => void;
}) {
  const [suit, setSuit] = useState<SuitCode | null>(initial?.suit ?? null);
  const [rank, setRank] = useState<number | null>(initial?.rank ?? null);

  const canConfirm = suit !== null && rank !== null;

  return (
    <div className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center">
      <motion.div
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        className="w-full sm:max-w-md bg-bg rounded-t-4xl sm:rounded-4xl p-6 pb-safe shadow-lift"
      >
        <div className="text-center mb-5">
          <h3 className="text-lg font-semibold text-ink">カードを選択</h3>
          <p className="text-sm text-gray2">スートと数字を選んでください</p>
        </div>

        {/* Suits */}
        <div className="grid grid-cols-4 gap-3 mb-5">
          {SUIT_ORDER.map((s) => (
            <button
              key={s}
              onClick={() => setSuit(s)}
              className={`h-16 rounded-2xl text-3xl flex items-center justify-center transition-all ${
                suit === s ? "bg-white ring-2 ring-gold shadow-card scale-105" : "bg-surface ring-1 ring-border"
              }`}
              style={{ color: SUIT_COLOR[s] }}
            >
              {SUIT_GLYPH[s]}
            </button>
          ))}
        </div>

        {/* Ranks */}
        <div className="grid grid-cols-5 gap-2.5 mb-6">
          {RANKS.map((r) => (
            <button
              key={r}
              onClick={() => setRank(r)}
              className={`h-12 rounded-xl font-semibold transition-all ${
                rank === r ? "bg-gold text-black shadow-card scale-105" : "bg-surface text-ink ring-1 ring-border"
              }`}
            >
              {rankLabel(r)}
            </button>
          ))}
        </div>

        <div className="flex gap-3">
          <button onClick={onCancel} className="flex-1 h-12 rounded-2xl bg-surface text-gray2 font-medium ring-1 ring-border">
            キャンセル
          </button>
          <button
            onClick={() => canConfirm && onDone({ suit: suit!, rank: rank! })}
            disabled={!canConfirm}
            className="flex-1 h-12 rounded-2xl bg-ink text-white font-semibold disabled:opacity-30"
          >
            決定
          </button>
        </div>
      </motion.div>
    </div>
  );
}
