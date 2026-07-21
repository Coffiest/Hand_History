import type { Card, Rank } from "./types/card.js";

export const HAND_CATEGORY = {
  highCard: 0,
  onePair: 1,
  twoPair: 2,
  threeOfAKind: 3,
  straight: 4,
  flush: 5,
  fullHouse: 6,
  fourOfAKind: 7,
  straightFlush: 8,
} as const;

export type HandCategory = (typeof HAND_CATEGORY)[keyof typeof HAND_CATEGORY];

export interface HandRank {
  readonly category: HandCategory;
  /** カテゴリ内での強さ比較用キッカー配列(降順、重要度が高い順) */
  readonly ranks: readonly number[];
}

export function compareHandRank(a: HandRank, b: HandRank): number {
  if (a.category !== b.category) return a.category - b.category;
  const len = Math.max(a.ranks.length, b.ranks.length);
  for (let i = 0; i < len; i++) {
    const av = a.ranks[i] ?? 0;
    const bv = b.ranks[i] ?? 0;
    if (av !== bv) return av - bv;
  }
  return 0;
}

function findStraightHigh(uniqueRanksDesc: readonly Rank[]): number | null {
  for (let i = 0; i <= uniqueRanksDesc.length - 5; i++) {
    const a = uniqueRanksDesc[i]!;
    const e = uniqueRanksDesc[i + 4]!;
    if (a - e === 4) return a;
  }
  // ホイール(A-5-4-3-2)。Aは1として扱い、5がストレートの最高位。
  const wheel: readonly Rank[] = [14, 5, 4, 3, 2];
  if (wheel.every((r) => uniqueRanksDesc.includes(r))) return 5;
  return null;
}

/** ちょうど5枚のカードを評価する */
export function evaluate5(cards: readonly Card[]): HandRank {
  if (cards.length !== 5) {
    throw new Error(`evaluate5 requires exactly 5 cards, got ${cards.length}`);
  }
  const ranksDesc = [...cards].map((c) => c.rank).sort((a, b) => b - a);
  const isFlush = cards.every((c) => c.suit === cards[0]!.suit);
  const uniqueRanksDesc = [...new Set(ranksDesc)].sort((a, b) => b - a);
  const straightHigh = findStraightHigh(uniqueRanksDesc);

  if (isFlush && straightHigh !== null) {
    return { category: HAND_CATEGORY.straightFlush, ranks: [straightHigh] };
  }

  const counts = new Map<Rank, number>();
  for (const r of ranksDesc) counts.set(r, (counts.get(r) ?? 0) + 1);
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const [g0, g1] = groups;

  if (g0![1] === 4) {
    const kicker = groups.find((g) => g[1] === 1)![0];
    return { category: HAND_CATEGORY.fourOfAKind, ranks: [g0![0], kicker] };
  }
  if (g0![1] === 3 && g1 && g1[1] >= 2) {
    return { category: HAND_CATEGORY.fullHouse, ranks: [g0![0], g1[0]] };
  }
  if (isFlush) {
    return { category: HAND_CATEGORY.flush, ranks: ranksDesc };
  }
  if (straightHigh !== null) {
    return { category: HAND_CATEGORY.straight, ranks: [straightHigh] };
  }
  if (g0![1] === 3) {
    const kickers = groups
      .filter((g) => g[1] === 1)
      .map((g) => g[0])
      .sort((a, b) => b - a);
    return { category: HAND_CATEGORY.threeOfAKind, ranks: [g0![0], ...kickers] };
  }
  if (g0![1] === 2 && g1 && g1[1] === 2) {
    const pairRanks = [g0![0], g1[0]].sort((a, b) => b - a);
    const kicker = groups.find((g) => g[1] === 1)![0];
    return { category: HAND_CATEGORY.twoPair, ranks: [...pairRanks, kicker] };
  }
  if (g0![1] === 2) {
    const kickers = groups
      .filter((g) => g[1] === 1)
      .map((g) => g[0])
      .sort((a, b) => b - a);
    return { category: HAND_CATEGORY.onePair, ranks: [g0![0], ...kickers] };
  }
  return { category: HAND_CATEGORY.highCard, ranks: ranksDesc };
}

function combinations<T>(items: readonly T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (items.length < k) return [];
  const [first, ...rest] = items;
  const withFirst = combinations(rest, k - 1).map((c) => [first as T, ...c]);
  const withoutFirst = combinations(rest, k);
  return [...withFirst, ...withoutFirst];
}

/** 5枚以上(通常7枚: ホール2+ボード5)のカードから最強の5枚の役を求める */
export function evaluateBest(cards: readonly Card[]): HandRank {
  if (cards.length < 5) {
    throw new Error(`evaluateBest requires at least 5 cards, got ${cards.length}`);
  }
  let best: HandRank | null = null;
  for (const combo of combinations(cards, 5)) {
    const rank = evaluate5(combo);
    if (best === null || compareHandRank(rank, best) > 0) {
      best = rank;
    }
  }
  return best!;
}
