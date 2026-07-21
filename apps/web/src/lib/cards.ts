// Card domain helpers shared across the UI, recognition client, and exporters.
// Rank is 1-13 (1=A, 11=J, 12=Q, 13=K) to match both the recognition backend and
// the card image asset names (`public/cards/{rank}{suit}.png`).

export type SuitCode = "s" | "h" | "d" | "c";

export const SUIT_ORDER: SuitCode[] = ["s", "h", "d", "c"];

export const SUIT_GLYPH: Record<SuitCode, string> = { s: "♠", h: "♥", d: "♦", c: "♣" };

export const SUIT_NAME_JA: Record<SuitCode, string> = {
  s: "スペード",
  h: "ハート",
  d: "ダイヤ",
  c: "クラブ",
};

/** 4-colour deck: spade black, heart red, diamond blue, club green. */
export const SUIT_COLOR: Record<SuitCode, string> = {
  s: "#1D1D1F",
  h: "#E53E3A",
  d: "#2563EB",
  c: "#16A34A",
};

export const RANKS: number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];

export function rankLabel(rank: number): string {
  if (rank === 1) return "A";
  if (rank === 11) return "J";
  if (rank === 12) return "Q";
  if (rank === 13) return "K";
  return String(rank);
}

export interface CardValue {
  rank: number; // 1-13
  suit: SuitCode;
}

/** Asset / canonical code, e.g. {13,'h'} → "13h". */
export function cardCode(card: CardValue): string {
  return `${card.rank}${card.suit}`;
}

/** Human label, e.g. {13,'h'} → "K♥". */
export function cardDisplay(card: CardValue): string {
  return `${rankLabel(card.rank)}${SUIT_GLYPH[card.suit]}`;
}

export function parseCardCode(code: string): CardValue | null {
  const suit = code.slice(-1) as SuitCode;
  const rank = Number(code.slice(0, -1));
  if (!SUIT_ORDER.includes(suit)) return null;
  if (!Number.isInteger(rank) || rank < 1 || rank > 13) return null;
  return { rank, suit };
}
