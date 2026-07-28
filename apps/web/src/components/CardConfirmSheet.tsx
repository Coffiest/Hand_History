"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { PlayingCard } from "./PlayingCard";
import { ManualCardPicker } from "./ManualCardPicker";
import { AlertIcon, TrashIcon } from "./icons";
import { cardDisplay, type CardValue, type SuitCode } from "@/lib/cards";
import type { RecognizedCard } from "@/lib/recognitionApi";

// Bottom sheet shown right after a scan. The live camera stays visible behind
// it, so accepting a result drops the user straight back into scanning.
//
// Cards the model was unsure about are singled out rather than making the user
// re-check everything; the rest can be accepted as-is.

export type CardRole = "hole" | "board";

export interface ConfirmCard extends CardValue {
  rankConfidence: number | null;
  suitConfidence: number | null;
  source: "recognized" | "manualOverride";
  accepted: boolean;
}

function fromRecognized(c: RecognizedCard): ConfirmCard {
  return {
    rank: c.rank ?? 1,
    suit: c.suit as SuitCode,
    rankConfidence: c.rank_confidence,
    suitConfidence: c.suit_confidence,
    source: "recognized",
    accepted: c.accepted && c.rank !== null,
  };
}

/** 2 cards is a hand, 3-5 is a board. The user can override on the sheet. */
export function roleForCount(count: number): CardRole {
  return count === 2 ? "hole" : "board";
}

function needsCheck(card: ConfirmCard): boolean {
  return !card.accepted && card.source !== "manualOverride";
}

export function CardConfirmSheet({
  recognized,
  onConfirm,
  onRetake,
  onShowDebug,
}: {
  recognized: RecognizedCard[];
  onConfirm: (cards: ConfirmCard[], role: CardRole) => void;
  onRetake: () => void;
  /** Opens the stage-by-stage view of how this read was produced. */
  onShowDebug?: () => void;
}) {
  const [cards, setCards] = useState<ConfirmCard[]>(recognized.map(fromRecognized));
  const [role, setRole] = useState<CardRole>(roleForCount(recognized.length));
  const [editing, setEditing] = useState<number | null>(null);

  const uncertain = cards.filter(needsCheck).length;

  const updateCard = (i: number, value: CardValue) => {
    setCards((prev) =>
      prev.map((c, idx) => (idx === i ? { ...c, ...value, source: "manualOverride", accepted: true } : c)),
    );
    setEditing(null);
  };

  const removeCard = (i: number) => setCards((prev) => prev.filter((_, idx) => idx !== i));

  return (
    <motion.div
      className="fixed inset-x-0 bottom-0 z-50 rounded-t-3xl bg-bg shadow-lift max-h-[82vh] flex flex-col"
      initial={{ y: "100%" }}
      animate={{ y: 0 }}
      exit={{ y: "100%" }}
      transition={{ type: "spring", stiffness: 360, damping: 34 }}
    >
      {/* Grabber */}
      <div className="pt-3 pb-1 flex justify-center shrink-0">
        <div className="h-1.5 w-10 rounded-full bg-border" />
      </div>

      {/* Where these cards will be recorded */}
      <div className="px-5 pt-2 pb-3 shrink-0">
        <div className="flex rounded-2xl bg-surface ring-1 ring-border p-1">
          {(["hole", "board"] as const).map((r) => (
            <button
              key={r}
              onClick={() => setRole(r)}
              className={`flex-1 py-2 rounded-xl text-sm font-semibold transition-colors ${
                role === r ? "bg-white text-ink shadow-card" : "text-gray3"
              }`}
            >
              {r === "hole" ? "ホールカード" : "ボード"}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 pb-2">
        {uncertain > 0 && (
          <div className="mb-4 flex items-start gap-2 rounded-2xl bg-gold/10 text-gold-dark text-sm px-4 py-3">
            <span className="mt-0.5 shrink-0">
              <AlertIcon size={18} />
            </span>
            <span>
              あやしいカードが{uncertain}枚あります。金色の枠のカードをタップして直してください。
            </span>
          </div>
        )}

        <div className="flex flex-wrap justify-center gap-4">
          {cards.map((card, i) => (
            <motion.div key={i} layout className="flex flex-col items-center gap-1.5">
              <button
                onClick={() => setEditing(i)}
                className={`rounded-2xl p-1 transition-shadow ${
                  needsCheck(card) ? "ring-2 ring-gold shadow-lift" : "ring-1 ring-transparent"
                }`}
              >
                <PlayingCard card={card} size="lg" dealDelay={i * 0.05} />
              </button>
              <span className="text-sm font-semibold text-ink">{cardDisplay(card)}</span>
              {needsCheck(card) ? (
                <span className="text-[11px] font-medium text-gold-dark">タップで修正</span>
              ) : card.source === "manualOverride" ? (
                <span className="text-[11px] text-gray3">手動修正</span>
              ) : (
                <span className="text-[11px] text-gray3">タップで修正</span>
              )}
              {cards.length > 1 && (
                <button
                  onClick={() => removeCard(i)}
                  aria-label={`${cardDisplay(card)} を削除`}
                  className="text-gray3 p-1 active:scale-90 transition-transform"
                >
                  <TrashIcon size={15} />
                </button>
              )}
            </motion.div>
          ))}
        </div>
      </div>

      {onShowDebug && (
        <button
          onClick={onShowDebug}
          className="shrink-0 mx-5 mb-1 text-[11px] text-gray2 underline underline-offset-4 py-1.5"
        >
          認識の詳細を見る（切り抜き・数字画像）
        </button>
      )}

      <div className="p-5 pb-safe flex gap-3 shrink-0 border-t border-border">
        <button
          onClick={onRetake}
          className="flex-1 py-3.5 rounded-2xl bg-surface text-gray2 font-medium ring-1 ring-border active:scale-[0.98] transition-transform"
        >
          撮り直す
        </button>
        <button
          onClick={() => onConfirm(cards, role)}
          disabled={cards.length === 0}
          className="flex-[2] py-3.5 rounded-2xl bg-gold text-black font-semibold disabled:opacity-40 active:scale-[0.98] transition-transform"
        >
          {role === "hole" ? "ホールカードとして記録" : "ボードとして記録"}
        </button>
      </div>

      <AnimatePresence>
        {editing !== null && (
          <ManualCardPicker
            initial={cards[editing]}
            onDone={(v) => updateCard(editing, v)}
            onCancel={() => setEditing(null)}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}
