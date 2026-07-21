import { describe, expect, it } from "vitest";
import { HAND_CATEGORY, compareHandRank, evaluate5, evaluateBest } from "../src/handEvaluator.js";
import type { Card } from "../src/types/card.js";

function c(spec: string): Card {
  const rankChar = spec.slice(0, -1);
  const suitChar = spec.slice(-1);
  const rank = ({ A: 14, K: 13, Q: 12, J: 11, T: 10 } as Record<string, number>)[rankChar] ?? Number(rankChar);
  const suit = ({ s: "spades", h: "hearts", d: "diamonds", c: "clubs" } as const)[suitChar as "s" | "h" | "d" | "c"];
  return { rank: rank as Card["rank"], suit };
}

function hand(...specs: string[]): Card[] {
  return specs.map(c);
}

describe("evaluate5", () => {
  it("recognizes a straight flush", () => {
    const r = evaluate5(hand("9s", "8s", "7s", "6s", "5s"));
    expect(r.category).toBe(HAND_CATEGORY.straightFlush);
    expect(r.ranks[0]).toBe(9);
  });

  it("recognizes the wheel (A-5) straight as 5-high", () => {
    const r = evaluate5(hand("As", "2h", "3d", "4c", "5s"));
    expect(r.category).toBe(HAND_CATEGORY.straight);
    expect(r.ranks[0]).toBe(5);
  });

  it("recognizes the wheel straight flush", () => {
    const r = evaluate5(hand("As", "2s", "3s", "4s", "5s"));
    expect(r.category).toBe(HAND_CATEGORY.straightFlush);
    expect(r.ranks[0]).toBe(5);
  });

  it("recognizes four of a kind", () => {
    const r = evaluate5(hand("9s", "9h", "9d", "9c", "2s"));
    expect(r.category).toBe(HAND_CATEGORY.fourOfAKind);
    expect(r.ranks).toEqual([9, 2]);
  });

  it("recognizes a full house", () => {
    const r = evaluate5(hand("9s", "9h", "9d", "2c", "2s"));
    expect(r.category).toBe(HAND_CATEGORY.fullHouse);
    expect(r.ranks).toEqual([9, 2]);
  });

  it("recognizes a flush over a straight", () => {
    const r = evaluate5(hand("2s", "5s", "9s", "Js", "Ks"));
    expect(r.category).toBe(HAND_CATEGORY.flush);
  });

  it("recognizes two pair with correct kicker", () => {
    const r = evaluate5(hand("9s", "9h", "5d", "5c", "Ks"));
    expect(r.category).toBe(HAND_CATEGORY.twoPair);
    expect(r.ranks).toEqual([9, 5, 13]);
  });

  it("recognizes high card", () => {
    const r = evaluate5(hand("2s", "5h", "9d", "Jc", "Ks"));
    expect(r.category).toBe(HAND_CATEGORY.highCard);
  });
});

describe("compareHandRank", () => {
  it("ranks a flush above a straight", () => {
    const flush = evaluate5(hand("2s", "5s", "9s", "Js", "Ks"));
    const straight = evaluate5(hand("9s", "8h", "7d", "6c", "5s"));
    expect(compareHandRank(flush, straight)).toBeGreaterThan(0);
  });

  it("breaks ties on kickers within the same category", () => {
    const acePair = evaluate5(hand("As", "Ah", "2d", "5c", "9s"));
    const kingPair = evaluate5(hand("Ks", "Kh", "2d", "5c", "9s"));
    expect(compareHandRank(acePair, kingPair)).toBeGreaterThan(0);
  });
});

describe("evaluateBest", () => {
  it("finds the best 5-card hand out of 7 cards", () => {
    // Only 4 spades (no flush), but 9-8-7-6-5 forms a straight
    const cards = hand("9s", "8s", "7s", "6s", "5h", "3d", "Kc");
    const r = evaluateBest(cards);
    expect(r.category).toBe(HAND_CATEGORY.straight);
    expect(r.ranks[0]).toBe(9);
  });

  it("prefers a full house over a flush when both are available across 7 cards", () => {
    const cards = hand("As", "Ah", "Ad", "Ks", "Kh", "2s", "3s");
    const r = evaluateBest(cards);
    expect(r.category).toBe(HAND_CATEGORY.fullHouse);
    expect(r.ranks).toEqual([14, 13]);
  });

  it("ignores the two lowest kickers when 7 cards produce high card only", () => {
    const cards = hand("2s", "5h", "9d", "Jc", "Kd", "3s", "4h");
    const r = evaluateBest(cards);
    expect(r.category).toBe(HAND_CATEGORY.highCard);
    expect(r.ranks).toEqual([13, 11, 9, 5, 4]);
  });
});
