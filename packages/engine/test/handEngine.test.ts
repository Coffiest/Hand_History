import { describe, expect, it } from "vitest";
import { HandEngine } from "../src/handEngine.js";
import { createOrderedDeck } from "../src/deck.js";
import type { Card } from "../src/types/card.js";

function c(spec: string): Card {
  const rankChar = spec.slice(0, -1);
  const suitChar = spec.slice(-1);
  const rank = ({ A: 14, K: 13, Q: 12, J: 11, T: 10 } as Record<string, number>)[rankChar] ?? Number(rankChar);
  const suit = ({ s: "spades", h: "hearts", d: "diamonds", c: "clubs" } as const)[suitChar as "s" | "h" | "d" | "c"];
  return { rank: rank as Card["rank"], suit };
}

/** 指定した順番のカードを先頭に配置し、残りは未使用の標準デッキで埋めた52枚のデッキを作る */
function fixedDeck(...specs: string[]): Card[] {
  const prefix = specs.map(c);
  const usedKeys = new Set(prefix.map((card) => `${card.rank}${card.suit}`));
  const rest = createOrderedDeck().filter((card) => !usedKeys.has(`${card.rank}${card.suit}`));
  return [...prefix, ...rest];
}

describe("HandEngine — uncontested pot via fold", () => {
  it("awards the pot (including the BB ante) to the last player standing", () => {
    const deck = fixedDeck(); // カードは使われないので順序は無関係
    const engine = new HandEngine({
      seats: [
        { seatIndex: 0, playerId: "P0", stack: 5000 },
        { seatIndex: 1, playerId: "P1", stack: 5000 },
        { seatIndex: 2, playerId: "P2", stack: 5000 },
      ],
      seatCount: 3,
      buttonFixedPos: 0,
      smallBlindSeat: 1,
      bigBlindSeat: 2,
      smallBlind: 50,
      bigBlind: 100,
      bbAnte: 100,
      deck,
    });

    // preflopOrder = [0(UTG), 1(SB), 2(BB)]
    expect(engine.getActingSeatIndex()).toBe(0);
    engine.applyAction(0, { kind: "fold" });
    expect(engine.getActingSeatIndex()).toBe(1);
    engine.applyAction(1, { kind: "fold" });

    expect(engine.isHandComplete()).toBe(true);
    const result = engine.getResult();
    expect(result.wonByFold).toBe(true);

    const stacks = engine.getStacks();
    expect(stacks.get(0)).toBe(5000); // UTGは何も拠出していない
    expect(stacks.get(1)).toBe(4950); // SBは50を失う
    expect(stacks.get(2)).toBe(5050); // BBはSBの50を獲得(自分の拠出は全額返る)

    // チップ保存則
    expect([...stacks.values()].reduce((a, b) => a + b, 0)).toBe(15000);

    // GEO記録用: ショーダウンしていなくても全員のホールカードを取得できる
    const allHoleCards = engine.getAllHoleCards();
    expect(allHoleCards.get(0)).toHaveLength(2);
    expect(allHoleCards.get(1)).toHaveLength(2);
    expect(allHoleCards.get(2)).toHaveLength(2);
  });
});

describe("HandEngine — side pot with a short all-in", () => {
  it("creates a layered side pot and awards each layer to its best eligible hand", () => {
    // postflopOrder = [1, 2, 0] なので、ホールカードは (P1, P2, P0) の順に2巡配られる
    const deck = fixedDeck(
      "Ks",
      "2c",
      "As",
      "Kh",
      "7d",
      "Ah", // holes: P1=KsKh, P2=2c7d, P0=AsAh
      "Qd", // burn
      "3d",
      "4h",
      "9s", // flop
      "Jd", // burn
      "Th", // turn
      "9d", // burn
      "Jc", // river
    );

    const engine = new HandEngine({
      seats: [
        { seatIndex: 0, playerId: "P0", stack: 300 },
        { seatIndex: 1, playerId: "P1", stack: 5000 },
        { seatIndex: 2, playerId: "P2", stack: 5000 },
      ],
      seatCount: 3,
      buttonFixedPos: 0,
      smallBlindSeat: 1,
      bigBlindSeat: 2,
      smallBlind: 50,
      bigBlind: 100,
      bbAnte: 0,
      deck,
    });

    // Preflop: P0(UTG) shoves for its whole 300 stack, both others call.
    engine.applyAction(0, { kind: "allIn" });
    engine.applyAction(1, { kind: "call" });
    engine.applyAction(2, { kind: "call" });

    // Flop: P0 is all-in and sits out; P1 bets, P2 calls.
    expect(engine.getStreet()).toBe("flop");
    expect(engine.getActingSeatIndex()).toBe(1);
    engine.applyAction(1, { kind: "bet", toAmount: 500 });
    engine.applyAction(2, { kind: "call" });

    // Turn / river: both check through to showdown.
    expect(engine.getStreet()).toBe("turn");
    engine.applyAction(1, { kind: "check" });
    engine.applyAction(2, { kind: "check" });
    expect(engine.getStreet()).toBe("river");
    engine.applyAction(1, { kind: "check" });
    engine.applyAction(2, { kind: "check" });

    expect(engine.isHandComplete()).toBe(true);
    const result = engine.getResult();
    expect(result.wonByFold).toBe(false);
    expect(result.pots).toHaveLength(2);
    expect(result.pots[0]).toEqual({ amount: 900, eligiblePlayerIds: ["P0", "P1", "P2"] });
    expect(result.pots[1]).toEqual({ amount: 1000, eligiblePlayerIds: ["P1", "P2"] });

    // P0 has AA (best overall) -> wins the main pot only.
    // P1 has KK (2nd best, but P0 is not eligible for the side pot) -> wins the side pot.
    expect(result.payouts.get("P0")).toBe(900);
    expect(result.payouts.get("P1")).toBe(1000);
    expect(result.payouts.get("P2")).toBeUndefined();

    const stacks = engine.getStacks();
    expect(stacks.get(0)).toBe(900); // 300 committed, won the 900 main pot
    expect(stacks.get(1)).toBe(5200); // 5000 - 800 committed + 1000 side pot
    expect(stacks.get(2)).toBe(4200); // 5000 - 800 committed, won nothing

    expect([...stacks.values()].reduce((a, b) => a + b, 0)).toBe(10300);
  });
});

describe("HandEngine — incomplete raise re-opening rule (TDA Rule 47)", () => {
  it("does not let an already-acted player re-raise after facing a short all-in raise", () => {
    const deck = fixedDeck(); // カード内容は無関係(ショーダウンまで進めない)
    const engine = new HandEngine({
      seats: [
        { seatIndex: 0, playerId: "P0", stack: 1000 },
        { seatIndex: 1, playerId: "P1", stack: 5000 },
        { seatIndex: 2, playerId: "P2", stack: 550 },
      ],
      seatCount: 3,
      buttonFixedPos: 0,
      smallBlindSeat: 1,
      bigBlindSeat: 2,
      smallBlind: 50,
      bigBlind: 100,
      bbAnte: 0,
      deck,
    });

    // P0 (UTG) opens to 400 -> full raise, min-raise-size becomes 300 (400-100).
    engine.applyAction(0, { kind: "raise", toAmount: 400 });
    // P1 (SB) calls 400.
    engine.applyAction(1, { kind: "call" });
    // P2 (BB) shoves for its remaining stack: total 550, increment over 400 is only 150 < 300
    // -> incomplete raise, does not reopen the betting for P0/P1.
    engine.applyAction(2, { kind: "allIn" });

    // Action returns to P0, who already acted this street.
    expect(engine.getActingSeatIndex()).toBe(0);
    expect(() => engine.applyAction(0, { kind: "raise", toAmount: 900 })).toThrow(/not reopened/);

    // P0 may still fold or call.
    engine.applyAction(0, { kind: "call" });
    expect(engine.getActingSeatIndex()).toBe(1);
    // P1 also already acted and faced only the incomplete raise -> cannot re-raise either.
    expect(() => engine.applyAction(1, { kind: "raise", toAmount: 900 })).toThrow(/not reopened/);
    engine.applyAction(1, { kind: "call" });

    expect(engine.isHandComplete() || engine.getStreet() !== "preflop").toBe(true);
  });

  it("allows a full raise to reopen betting for players who already acted", () => {
    const deck = fixedDeck();
    const engine = new HandEngine({
      seats: [
        { seatIndex: 0, playerId: "P0", stack: 5000 },
        { seatIndex: 1, playerId: "P1", stack: 5000 },
        { seatIndex: 2, playerId: "P2", stack: 5000 },
      ],
      seatCount: 3,
      buttonFixedPos: 0,
      smallBlindSeat: 1,
      bigBlindSeat: 2,
      smallBlind: 50,
      bigBlind: 100,
      bbAnte: 0,
      deck,
    });

    // P0 calls the BB (limps).
    engine.applyAction(0, { kind: "call" });
    // P1 (SB) completes.
    engine.applyAction(1, { kind: "call" });
    // P2 (BB) raises to 500 -> full raise, reopens betting for everyone.
    engine.applyAction(2, { kind: "raise", toAmount: 500 });

    // P0 already acted (limped) but the raise was a full raise, so P0 may re-raise now.
    expect(engine.getActingSeatIndex()).toBe(0);
    expect(() => engine.applyAction(0, { kind: "raise", toAmount: 1200 })).not.toThrow();
  });
});

describe("HandEngine — short-stacked BB posts less than the SB (regression)", () => {
  it("sets currentBetToMatch to the larger of the two actual posted amounts, not just the BB's", () => {
    // Heads-up: BB's whole stack (300) is smaller than the SB's post (500), which can happen
    // once blinds have escalated far beyond a short stack. currentBetToMatch must reflect the
    // larger of what was actually posted, or the SB would illegally be allowed to "check" a bet
    // that doesn't match their own contribution (and downstream chip accounting breaks).
    const deck = fixedDeck();
    const engine = new HandEngine({
      seats: [
        { seatIndex: 0, playerId: "SB", stack: 5000 },
        { seatIndex: 1, playerId: "BB", stack: 300 },
      ],
      seatCount: 2,
      buttonFixedPos: 0,
      smallBlindSeat: 0,
      bigBlindSeat: 1,
      smallBlind: 500,
      bigBlind: 1000,
      bbAnte: 0,
      deck,
    });

    const state = engine.getPublicState();
    expect(state.currentBetToMatch).toBe(500);

    const bbSeat = state.seats.find((s) => s.seatIndex === 1)!;
    expect(bbSeat.status).toBe("allIn");
    expect(bbSeat.streetContribution).toBe(300);

    // SB already matches currentBetToMatch (500 == 500), so checking must be legal.
    expect(engine.getActingSeatIndex()).toBe(0);
    expect(() => engine.applyAction(0, { kind: "check" })).not.toThrow();

    // BB is all-in, but SB still has chips behind, so SB must check down every remaining street.
    while (!engine.isHandComplete()) {
      expect(engine.getActingSeatIndex()).toBe(0);
      engine.applyAction(0, { kind: "check" });
    }

    const stacks = engine.getStacks();
    expect([...stacks.values()].reduce((a, b) => a + b, 0)).toBe(5300);
  });
});
