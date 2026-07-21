// Import from specific engine modules (not the barrel) so we don't pull deck.ts
// — which uses node:crypto — into the client bundle.
import { evaluateBest, HAND_CATEGORY } from "@handhistory/engine/src/handEvaluator.js";
import type { Card as EngineCard, Suit } from "@handhistory/engine/src/types/card.js";
import type { CardValue } from "./cards";

// Adapter between our card model (rank 1-13 with 1=A, suit s/h/d/c) and the
// Meta-GEO poker engine (rank 2-14 with 14=A, suit spades/hearts/...). Lets us
// reuse the engine's hand evaluator to show the made hand at showdown.

const SUIT_MAP: Record<string, Suit> = {
  s: "spades",
  h: "hearts",
  d: "diamonds",
  c: "clubs",
};

function toEngineCard(card: CardValue): EngineCard {
  const rank = card.rank === 1 ? 14 : card.rank; // Ace high
  return { rank: rank as EngineCard["rank"], suit: SUIT_MAP[card.suit]! };
}

const CATEGORY_JA: Record<number, string> = {
  [HAND_CATEGORY.highCard]: "ハイカード",
  [HAND_CATEGORY.onePair]: "ワンペア",
  [HAND_CATEGORY.twoPair]: "ツーペア",
  [HAND_CATEGORY.threeOfAKind]: "スリーカード",
  [HAND_CATEGORY.straight]: "ストレート",
  [HAND_CATEGORY.flush]: "フラッシュ",
  [HAND_CATEGORY.fullHouse]: "フルハウス",
  [HAND_CATEGORY.fourOfAKind]: "フォーカード",
  [HAND_CATEGORY.straightFlush]: "ストレートフラッシュ",
};

/**
 * Best made hand name from hole + board cards, or null if fewer than 5 cards
 * are known (so the UI can hide it until there's a real hand to show).
 */
export function madeHandName(hole: CardValue[], board: CardValue[]): string | null {
  const all = [...hole, ...board];
  if (all.length < 5) return null;
  try {
    const best = evaluateBest(all.map(toEngineCard));
    return CATEGORY_JA[best.category] ?? null;
  } catch {
    return null;
  }
}
