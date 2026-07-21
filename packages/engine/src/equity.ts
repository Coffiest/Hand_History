import type { Card } from "./types/card.js";
import { RANKS, SUITS } from "./types/card.js";
import { compareHandRank, evaluateBest } from "./handEvaluator.js";

export interface EquityContender {
  readonly id: string;
  readonly holeCards: readonly [Card, Card];
}

export interface EquityInput {
  readonly contenders: readonly EquityContender[];
  /** ショーダウンの時点で既に開いていたボード(0〜5枚)。残りはランダムに決着したものとして扱う。 */
  readonly knownBoard: readonly Card[];
}

/** 未知カードが2枚以下なら全通り厳密列挙、それ以上はモンテカルロで近似する。 */
const EXACT_ENUMERATION_MAX_UNKNOWN = 2;
const MONTE_CARLO_SAMPLES = 200;

function cardKey(c: Card): string {
  return `${c.rank}${c.suit[0]}`;
}

function fullDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) for (const rank of RANKS) deck.push({ rank, suit });
  return deck;
}

function remainingDeck(used: readonly Card[]): Card[] {
  const usedKeys = new Set(used.map(cardKey));
  return fullDeck().filter((c) => !usedKeys.has(cardKey(c)));
}

/** n枚からk枚を選ぶ全組み合わせを列挙する(kは高々2程度を想定した簡易実装)。 */
function* combinations<T>(items: readonly T[], k: number): Generator<T[]> {
  if (k === 0) {
    yield [];
    return;
  }
  for (let i = 0; i <= items.length - k; i++) {
    for (const rest of combinations(items.slice(i + 1), k - 1)) {
      yield [items[i]!, ...rest];
    }
  }
}

function tallyOutcome(contenders: readonly EquityContender[], board: readonly Card[], tally: Map<string, number>): void {
  const ranks = contenders.map((c) => ({ id: c.id, rank: evaluateBest([...c.holeCards, ...board]) }));
  let bestIdx = [0];
  for (let i = 1; i < ranks.length; i++) {
    const cmp = compareHandRank(ranks[i]!.rank, ranks[bestIdx[0]!]!.rank);
    if (cmp > 0) bestIdx = [i];
    else if (cmp === 0) bestIdx.push(i);
  }
  const share = 1 / bestIdx.length;
  for (const idx of bestIdx) {
    const id = ranks[idx]!.id;
    tally.set(id, (tally.get(id) ?? 0) + share);
  }
}

/**
 * オールインEV計算: 既知のボードを固定し、残りの未知カードについて全ての(または十分な数の)
 * 決着パターンを試して各プレイヤーの勝率(タイは山分け)を推定する。
 * 未知カードが0枚(=リバーまで実際のアクションがあった場合)は、実際の結果と完全に一致する
 * 決定論的な計算になる(この場合の呼び出しは無駄だが害はない)。
 */
export function computeAllInEquity(input: EquityInput): Map<string, number> {
  const { contenders, knownBoard } = input;
  const tally = new Map<string, number>();
  for (const c of contenders) tally.set(c.id, 0);
  if (contenders.length === 0) return tally;
  if (contenders.length === 1) {
    tally.set(contenders[0]!.id, 1);
    return tally;
  }

  const unknownCount = 5 - knownBoard.length;
  const usedCards = contenders.flatMap((c) => c.holeCards).concat(knownBoard);
  const pool = remainingDeck(usedCards);

  let samples = 0;
  if (unknownCount <= EXACT_ENUMERATION_MAX_UNKNOWN) {
    for (const combo of combinations(pool, unknownCount)) {
      tallyOutcome(contenders, [...knownBoard, ...combo], tally);
      samples++;
    }
  } else {
    for (let i = 0; i < MONTE_CARLO_SAMPLES; i++) {
      const shuffled = [...pool];
      for (let j = shuffled.length - 1; j > 0; j--) {
        const k = Math.floor(Math.random() * (j + 1));
        [shuffled[j], shuffled[k]] = [shuffled[k]!, shuffled[j]!];
      }
      tallyOutcome(contenders, [...knownBoard, ...shuffled.slice(0, unknownCount)], tally);
      samples++;
    }
  }

  if (samples === 0) return tally;
  for (const [id, total] of tally) tally.set(id, total / samples);
  return tally;
}
