"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { PlayingCard } from "./PlayingCard";
import { ManualCardPicker } from "./ManualCardPicker";
import { cardDisplay, type CardValue, type SuitCode } from "@/lib/cards";
import type { RecognizedCard } from "@/lib/recognitionApi";

// Shown after recognition: displays each detected card big, with a confidence
// badge, and lets the user fix any card by hand before accepting. Cards whose
// rank couldn't be determined (rank === null) start flagged for correction.

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

function ConfidenceBadge({ card }: { card: ConfirmCard }) {
  if (card.source === "manualOverride") {
    return <span className="text-[11px] font-medium text-gray2">手動修正</span>;
  }
  const conf = Math.min(card.rankConfidence ?? 0, card.suitConfidence ?? 0);
  const ok = card.accepted;
  return (
    <span
      className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${
        ok ? "bg-suit-club/10 text-suit-club" : "bg-gold/15 text-gold-dark"
      }`}
    >
      {ok ? "確度 高" : "要確認"} {Math.round(conf * 100)}%
    </span>
  );
}

export function CardConfirmSheet({
  recognized,
  expectedCount,
  onConfirm,
  onRetake,
}: {
  recognized: RecognizedCard[];
  expectedCount?: number;
  onConfirm: (cards: ConfirmCard[]) => void;
  onRetake: () => void;
}) {
  const [cards, setCards] = useState<ConfirmCard[]>(recognized.map(fromRecognized));
  const [editing, setEditing] = useState<number | null>(null);

  const countMismatch = expectedCount != null && cards.length !== expectedCount;
  const anyNeedsCheck = cards.some((c) => !c.accepted && c.source !== "manualOverride");

  const updateCard = (i: number, value: CardValue) => {
    setCards((prev) =>
      prev.map((c, idx) =>
        idx === i ? { ...c, ...value, source: "manualOverride", accepted: true } : c,
      ),
    );
    setEditing(null);
  };

  const removeCard = (i: number) => setCards((prev) => prev.filter((_, idx) => idx !== i));

  return (
    <div className="fixed inset-0 z-50 bg-bg flex flex-col">
      <div className="p-5 text-center border-b border-border">
        <h2 className="text-lg font-semibold text-ink">認識結果を確認</h2>
        <p className="text-sm text-gray2">タップして修正できます</p>
      </div>

      <div className="flex-1 overflow-y-auto p-5">
        {countMismatch && (
          <div className="mb-4 rounded-2xl bg-gold/10 text-gold-dark text-sm px-4 py-3 text-center">
            {expectedCount}枚のはずが{cards.length}枚検出されました。撮り直すか、下で修正してください。
          </div>
        )}

        <div className="flex flex-wrap justify-center gap-4">
          {cards.map((card, i) => (
            <motion.button
              key={i}
              layout
              onClick={() => setEditing(i)}
              className="flex flex-col items-center gap-2"
            >
              <div className={`rounded-2xl p-1 ${!card.accepted && card.source !== "manualOverride" ? "ring-2 ring-gold" : ""}`}>
                <PlayingCard card={card} size="xl" dealDelay={i * 0.06} />
              </div>
              <span className="text-sm font-semibold text-ink">{cardDisplay(card)}</span>
              <ConfidenceBadge card={card} />
              <span className="text-[11px] text-gold-dark underline">修正</span>
            </motion.button>
          ))}
        </div>

        {cards.length > 1 && (
          <div className="mt-6 text-center">
            <p className="text-xs text-gray3 mb-2">余分に検出された場合は長押しではなくタップ後に削除できます</p>
            <div className="flex flex-wrap justify-center gap-2">
              {cards.map((c, i) => (
                <button
                  key={i}
                  onClick={() => removeCard(i)}
                  className="text-xs px-3 py-1.5 rounded-full bg-surface ring-1 ring-border text-gray2"
                >
                  {cardDisplay(c)} を削除
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="p-5 pb-safe border-t border-border flex gap-3">
        <button onClick={onRetake} className="flex-1 h-13 py-3.5 rounded-2xl bg-surface text-gray2 font-medium ring-1 ring-border">
          撮り直す
        </button>
        <button
          onClick={() => onConfirm(cards)}
          disabled={cards.length === 0}
          className="flex-[2] py-3.5 rounded-2xl bg-gold text-black font-semibold disabled:opacity-40"
        >
          {anyNeedsCheck ? "このまま使う" : "確定する"}
        </button>
      </div>

      {editing !== null && (
        <ManualCardPicker
          initial={cards[editing]}
          onDone={(v) => updateCard(editing, v)}
          onCancel={() => setEditing(null)}
        />
      )}
    </div>
  );
}
