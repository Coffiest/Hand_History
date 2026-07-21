import { describe, expect, it } from "vitest";
import { MultiTableTournament } from "../src/multiTableTournament.js";
import { STARTING_STACK } from "../src/blindStructure.js";
import type { HandEngine } from "../src/handEngine.js";

/** シード付き擬似乱数(決定論的なテスト実行用) */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** MTTの構造(テーブル解体/バランシング)を検証するための、意図的に単純なランダムボット */
function playHandSimple(hand: HandEngine, rand: () => number): void {
  let guard = 0;
  while (!hand.isHandComplete()) {
    guard++;
    if (guard > 500) throw new Error("Hand did not complete within a reasonable number of actions");
    const seatIndex = hand.getActingSeatIndex();
    if (seatIndex === null) throw new Error("No acting seat but hand is not complete");

    const state = hand.getPublicState();
    const seat = state.seats.find((s) => s.seatIndex === seatIndex)!;
    const toCall = state.currentBetToMatch - seat.streetContribution;

    if (toCall <= 0) {
      hand.applyAction(seatIndex, { kind: "check" });
    } else if (toCall >= seat.stack) {
      hand.applyAction(seatIndex, rand() < 0.5 ? { kind: "allIn" } : { kind: "fold" });
    } else if (rand() < 0.65) {
      hand.applyAction(seatIndex, { kind: "call" });
    } else {
      hand.applyAction(seatIndex, { kind: "fold" });
    }
  }
}

describe("MultiTableTournament", () => {
  it("distributes players evenly across the initial tables", () => {
    const players = Array.from({ length: 20 }, (_, i) => ({ playerId: `p${i}`, displayName: `P${i}` }));
    const mtt = new MultiTableTournament({ tableSeatCount: 6, players });

    const tableIds = mtt.getTableIds();
    expect(tableIds).toHaveLength(4); // ceil(20/6) = 4

    const sizes = tableIds.map((id) => mtt.getTableOccupancy(id).length);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(20);
  });

  it("plays a full 20-player MTT down to a single winner, conserving chips and keeping tables balanced throughout", () => {
    const rand = mulberry32(2024);
    const players = Array.from({ length: 20 }, (_, i) => ({ playerId: `p${i}`, displayName: `P${i}` }));
    const mtt = new MultiTableTournament({ tableSeatCount: 6, players });
    const totalStartingChips = 20 * STARTING_STACK;

    let round = 0;
    const maxRounds = 3000;

    while (!mtt.isTournamentOver() && round < maxRounds) {
      round++;
      if (round % 12 === 0) mtt.advanceToNextLevel();

      for (const tableId of mtt.getTableIds()) {
        if (!mtt.getTableIds().includes(tableId)) continue; // このラウンド中に解体された可能性がある
        const occupancy = mtt.getTableOccupancy(tableId);
        if (occupancy.length < 2) continue;

        const hand = mtt.startNextHandOnTable(tableId);
        playHandSimple(hand, rand);
        mtt.settleFinishedHandOnTable(tableId, hand);

        // ハンド決済のたびに、テーブル間の人数差が1以下(バランシングが機能している)ことを検証
        const sizes = mtt.getTableIds().map((id) => mtt.getTableOccupancy(id).length);
        if (sizes.length >= 2) {
          expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
        }
        for (const size of sizes) {
          expect(size).toBeGreaterThanOrEqual(1);
          expect(size).toBeLessThanOrEqual(6);
        }

        // チップ保存則: 全テーブルの合計スタックは常に一定
        const totalChips = mtt
          .getTableIds()
          .flatMap((id) => mtt.getTableOccupancy(id))
          .reduce((sum, o) => sum + o.stack, 0);
        expect(totalChips).toBe(totalStartingChips);
      }
    }

    expect(mtt.isTournamentOver()).toBe(true);
    expect(round).toBeLessThan(maxRounds); // タイムアウトで終わっていないこと
    const winnerId = mtt.getWinnerPlayerId();
    expect(winnerId).not.toBeNull();

    const finalTableId = mtt.getTableIds()[0]!;
    const finalOccupancy = mtt.getTableOccupancy(finalTableId);
    expect(finalOccupancy).toHaveLength(1);
    expect(finalOccupancy[0]!.playerId).toBe(winnerId);
    expect(finalOccupancy[0]!.stack).toBe(totalStartingChips);
  });

  it("consolidates to one table once few enough players remain, even if they started on different tables", () => {
    // 7人 -> 6-maxなら2卓必要(ceil(7/6)=2)。1人バストすると6人になり1卓で足りるようになるため、
    // テーブル解体が発生して最終的に1卓に集約されるはず。
    const rand = mulberry32(7);
    const players = Array.from({ length: 7 }, (_, i) => ({ playerId: `p${i}`, displayName: `P${i}` }));
    const mtt = new MultiTableTournament({ tableSeatCount: 6, players, startingStack: 2000 });

    expect(mtt.getTableIds()).toHaveLength(2);

    let round = 0;
    while (mtt.getTableIds().length > 1 && round < 500) {
      round++;
      for (const tableId of mtt.getTableIds()) {
        if (!mtt.getTableIds().includes(tableId)) continue;
        const occupancy = mtt.getTableOccupancy(tableId);
        if (occupancy.length < 2) continue;
        const hand = mtt.startNextHandOnTable(tableId);
        playHandSimple(hand, rand);
        mtt.settleFinishedHandOnTable(tableId, hand);
      }
    }

    expect(mtt.getTableIds()).toHaveLength(1);
    const remainingPlayers = mtt.getTableOccupancy(mtt.getTableIds()[0]!).length;
    expect(remainingPlayers).toBeGreaterThanOrEqual(2);
    expect(remainingPlayers).toBeLessThanOrEqual(6);
  });
});
