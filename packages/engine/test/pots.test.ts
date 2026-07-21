import { describe, expect, it } from "vitest";
import { buildPots, settlePots } from "../src/pots.js";
import { HAND_CATEGORY, type HandRank } from "../src/handEvaluator.js";

describe("buildPots", () => {
  it("builds a single main pot when all contributions are equal", () => {
    const contributions = new Map([
      ["A", 100],
      ["B", 100],
      ["C", 100],
    ]);
    const pots = buildPots(contributions, new Set());
    expect(pots).toHaveLength(1);
    expect(pots[0]).toEqual({ amount: 300, eligiblePlayerIds: ["A", "B", "C"] });
  });

  it("layers a side pot when one player is short all-in", () => {
    // A busts for 50, B and C both put in 200
    const contributions = new Map([
      ["A", 50],
      ["B", 200],
      ["C", 200],
    ]);
    const pots = buildPots(contributions, new Set());
    expect(pots).toHaveLength(2);
    expect(pots[0]).toEqual({ amount: 150, eligiblePlayerIds: ["A", "B", "C"] }); // 50*3
    expect(pots[1]).toEqual({ amount: 300, eligiblePlayerIds: ["B", "C"] }); // (200-50)*2
  });

  it("excludes folded players from eligibility but keeps their chips in the pot", () => {
    const contributions = new Map([
      ["A", 100],
      ["B", 100],
      ["C", 100],
    ]);
    const pots = buildPots(contributions, new Set(["B"]));
    expect(pots).toHaveLength(1);
    expect(pots[0]!.amount).toBe(300);
    expect(pots[0]!.eligiblePlayerIds).toEqual(["A", "C"]);
  });

  it("handles three-way all-in with three distinct stack sizes", () => {
    const contributions = new Map([
      ["A", 50],
      ["B", 150],
      ["C", 300],
    ]);
    const pots = buildPots(contributions, new Set());
    expect(pots).toHaveLength(3);
    expect(pots[0]).toEqual({ amount: 150, eligiblePlayerIds: ["A", "B", "C"] }); // 50*3
    expect(pots[1]).toEqual({ amount: 200, eligiblePlayerIds: ["B", "C"] }); // (150-50)*2
    expect(pots[2]).toEqual({ amount: 150, eligiblePlayerIds: ["C"] }); // (300-150)*1
  });
});

function rank(category: number, ...ranks: number[]): HandRank {
  return { category: category as HandRank["category"], ranks };
}

describe("settlePots", () => {
  it("awards the whole pot to the single best hand", () => {
    const pots = buildPots(
      new Map([
        ["A", 100],
        ["B", 100],
      ]),
      new Set(),
    );
    const handRanks = new Map([
      ["A", rank(HAND_CATEGORY.onePair, 10)],
      ["B", rank(HAND_CATEGORY.highCard, 14)],
    ]);
    const payouts = settlePots({ pots, handRanks, seatOrderFromButton: ["A", "B"] });
    expect(payouts.get("A")).toBe(200);
    expect(payouts.get("B")).toBeUndefined();
  });

  it("splits a pot evenly with no remainder", () => {
    const pots = buildPots(
      new Map([
        ["A", 100],
        ["B", 100],
      ]),
      new Set(),
    );
    const handRanks = new Map([
      ["A", rank(HAND_CATEGORY.onePair, 10)],
      ["B", rank(HAND_CATEGORY.onePair, 10)],
    ]);
    const payouts = settlePots({ pots, handRanks, seatOrderFromButton: ["A", "B"] });
    expect(payouts.get("A")).toBe(100);
    expect(payouts.get("B")).toBe(100);
  });

  it("gives the odd chip to the winner closest to the button (first in seat order)", () => {
    // 4人が均等に100ずつ拠出(単一ポット400)。うち3人が役でタイし、1人(D)は負け。
    // 400を3等分すると133あまり1 -> 端数はボタンに一番近い勝者から配る。
    const pots = buildPots(
      new Map([
        ["A", 100],
        ["B", 100],
        ["C", 100],
        ["D", 100],
      ]),
      new Set(),
    );
    const handRanks = new Map([
      ["A", rank(HAND_CATEGORY.onePair, 10)],
      ["B", rank(HAND_CATEGORY.onePair, 10)],
      ["C", rank(HAND_CATEGORY.onePair, 10)],
      ["D", rank(HAND_CATEGORY.highCard, 14)],
    ]);
    const payouts = settlePots({ pots, handRanks, seatOrderFromButton: ["B", "C", "A", "D"] });
    expect(payouts.get("B")).toBe(134);
    expect(payouts.get("C")).toBe(133);
    expect(payouts.get("A")).toBe(133);
    expect(payouts.get("D")).toBeUndefined();
  });

  it("settles a layered side pot with different winners per layer", () => {
    // A all-in for 50 with the best hand overall; B and C both cover 200 but B has 2nd best, C worst
    const pots = buildPots(
      new Map([
        ["A", 50],
        ["B", 200],
        ["C", 200],
      ]),
      new Set(),
    );
    const handRanks = new Map([
      ["A", rank(HAND_CATEGORY.straight, 10)],
      ["B", rank(HAND_CATEGORY.onePair, 9)],
      ["C", rank(HAND_CATEGORY.highCard, 14)],
    ]);
    const payouts = settlePots({ pots, handRanks, seatOrderFromButton: ["A", "B", "C"] });
    expect(payouts.get("A")).toBe(150); // wins main pot only (50*3)
    expect(payouts.get("B")).toBe(300); // wins the side pot (150*2) since A isn't eligible
    expect(payouts.get("C")).toBeUndefined();
  });
});
