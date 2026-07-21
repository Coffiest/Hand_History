export type Suit = "spades" | "hearts" | "diamonds" | "clubs";

/** 2〜14 (14 = Ace) */
export type Rank = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14;

export interface Card {
  readonly rank: Rank;
  readonly suit: Suit;
}

export const SUITS: readonly Suit[] = ["spades", "hearts", "diamonds", "clubs"];
export const RANKS: readonly Rank[] = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];

/** チップレースやポットの端数配分で使うスート優先順(降順): spades > hearts > diamonds > clubs */
export const SUIT_PRIORITY: Readonly<Record<Suit, number>> = {
  spades: 4,
  hearts: 3,
  diamonds: 2,
  clubs: 1,
};

export function cardToString(card: Card): string {
  const rankStr =
    card.rank === 14 ? "A" : card.rank === 13 ? "K" : card.rank === 12 ? "Q" : card.rank === 11 ? "J" : String(card.rank);
  const suitChar = { spades: "s", hearts: "h", diamonds: "d", clubs: "c" }[card.suit];
  return `${rankStr}${suitChar}`;
}

const RANK_CHAR_TO_RANK: Readonly<Record<string, Rank>> = {
  A: 14,
  K: 13,
  Q: 12,
  J: 11,
  T: 10,
  "10": 10,
  "9": 9,
  "8": 8,
  "7": 7,
  "6": 6,
  "5": 5,
  "4": 4,
  "3": 3,
  "2": 2,
};

const SUIT_CHAR_TO_SUIT: Readonly<Record<string, Suit>> = {
  s: "spades",
  h: "hearts",
  d: "diamonds",
  c: "clubs",
};

/** cardToStringの逆変換。"As" → {rank:14, suit:"spades"}。不正な文字列はnullを返す。 */
export function parseCard(str: string): Card | null {
  const suitChar = str.slice(-1);
  const rankChar = str.slice(0, -1);
  const rank = RANK_CHAR_TO_RANK[rankChar];
  const suit = SUIT_CHAR_TO_SUIT[suitChar];
  if (rank === undefined || suit === undefined) return null;
  return { rank, suit };
}
