import { compareHandRank, type HandRank } from "./handEvaluator.js";

export interface Pot {
  readonly amount: number;
  /** このポットを争う権利があるプレイヤー(フォールドしていない拠出者) */
  readonly eligiblePlayerIds: readonly string[];
}

/**
 * 各プレイヤーの「そのハンドでの拠出累計額」から、レイヤー方式でメインポット/サイドポットを構築する。
 * docs/POKER_RULES.md 1章参照。
 *
 * フォールドしたプレイヤーの拠出はポットに残るが、eligiblePlayerIds には含めない
 * (取り分の権利を失うだけで拠出自体は減らない)。
 */
export function buildPots(
  contributions: ReadonlyMap<string, number>,
  foldedPlayerIds: ReadonlySet<string>,
): Pot[] {
  const remaining = new Map(contributions);
  const pots: Pot[] = [];

  while ([...remaining.values()].some((v) => v > 0)) {
    const payers = [...remaining.entries()].filter(([, v]) => v > 0).map(([id]) => id);
    const layerAmount = Math.min(...payers.map((id) => remaining.get(id)!));

    let potAmount = 0;
    const eligible: string[] = [];
    for (const id of payers) {
      const take = Math.min(layerAmount, remaining.get(id)!);
      potAmount += take;
      remaining.set(id, remaining.get(id)! - take);
      if (!foldedPlayerIds.has(id)) eligible.push(id);
    }
    pots.push({ amount: potAmount, eligiblePlayerIds: eligible });
  }

  return pots;
}

export interface SettlementInput {
  readonly pots: readonly Pot[];
  readonly handRanks: ReadonlyMap<string, HandRank>;
  /**
   * ボタンから見て時計回り(アクション順)のプレイヤーID順序。
   * 端数チップ配分(ボタンに一番近い勝者から配る)の基準に使う。
   */
  readonly seatOrderFromButton: readonly string[];
}

/** 各ポットをショーダウンの結果に基づいて清算し、プレイヤーごとの受取額を返す */
export function settlePots(input: SettlementInput): Map<string, number> {
  const payouts = new Map<string, number>();
  const addPayout = (id: string, amount: number) => payouts.set(id, (payouts.get(id) ?? 0) + amount);

  for (const pot of input.pots) {
    if (pot.eligiblePlayerIds.length === 0) continue;

    let bestRank: HandRank | null = null;
    for (const id of pot.eligiblePlayerIds) {
      const rank = input.handRanks.get(id);
      if (!rank) continue;
      if (!bestRank || compareHandRank(rank, bestRank) > 0) bestRank = rank;
    }
    if (!bestRank) continue;

    const winners = pot.eligiblePlayerIds.filter((id) => {
      const rank = input.handRanks.get(id);
      return rank !== undefined && compareHandRank(rank, bestRank!) === 0;
    });

    const share = Math.floor(pot.amount / winners.length);
    let remainder = pot.amount - share * winners.length;
    for (const w of winners) addPayout(w, share);

    const orderedWinners = input.seatOrderFromButton.filter((id) => winners.includes(id));
    let i = 0;
    while (remainder > 0) {
      const w = orderedWinners[i % orderedWinners.length]!;
      addPayout(w, 1);
      remainder--;
      i++;
    }
  }

  return payouts;
}
