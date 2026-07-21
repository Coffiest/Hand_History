import { describe, expect, it } from "vitest";
import { computeAllInEquity } from "../src/equity.js";
import { parseCard } from "../src/types/card.js";

function cards(str: string): [ReturnType<typeof parseCard>, ReturnType<typeof parseCard>] {
  const [a, b] = str.split(" ");
  return [parseCard(a!), parseCard(b!)];
}

describe("computeAllInEquity", () => {
  it("gives a sole contender 100% equity", () => {
    const equity = computeAllInEquity({
      contenders: [{ id: "a", holeCards: cards("As Ks") as [any, any] }],
      knownBoard: [],
    });
    expect(equity.get("a")).toBe(1);
  });

  it("resolves a fully-known board deterministically (river all-in)", () => {
    // a: AsAh full house on this board, b: KsKh trips only -> a wins outright
    const board = ["2s", "2h", "2c", "9d", "5c"].map((c) => parseCard(c)!);
    const equity = computeAllInEquity({
      contenders: [
        { id: "a", holeCards: cards("As Ah") as [any, any] },
        { id: "b", holeCards: cards("Ks Kh") as [any, any] },
      ],
      knownBoard: board,
    });
    expect(equity.get("a")).toBe(1);
    expect(equity.get("b")).toBe(0);
  });

  it("splits equity 50/50 for two hands guaranteed to chop (royal flush plays entirely off the board)", () => {
    const board = ["Ah", "Kh", "Qh", "Jh", "Th"].map((c) => parseCard(c)!);
    const equity = computeAllInEquity({
      contenders: [
        { id: "a", holeCards: cards("2s 3c") as [any, any] },
        { id: "b", holeCards: cards("4d 5s") as [any, any] },
      ],
      knownBoard: board,
    });
    expect(equity.get("a")).toBeCloseTo(0.5, 5);
    expect(equity.get("b")).toBeCloseTo(0.5, 5);
  });

  it("gives AA a big preflop equity edge over KK (exact enumeration would be ~82%, Monte Carlo should be close)", () => {
    const equity = computeAllInEquity({
      contenders: [
        { id: "aa", holeCards: cards("Ac Ad") as [any, any] },
        { id: "kk", holeCards: cards("Kc Kd") as [any, any] },
      ],
      knownBoard: [],
    });
    expect(equity.get("aa")!).toBeGreaterThan(0.68);
    expect(equity.get("kk")!).toBeLessThan(0.32);
  });

  it("exactly enumerates a turn all-in (1 unknown card) and sums equities to 1", () => {
    const board = ["9s", "4h", "2c", "Kd"].map((c) => parseCard(c)!);
    const equity = computeAllInEquity({
      contenders: [
        { id: "a", holeCards: cards("Ts Js") as [any, any] },
        { id: "b", holeCards: cards("9c 9d") as [any, any] },
      ],
      knownBoard: board,
    });
    const total = [...equity.values()].reduce((s, v) => s + v, 0);
    expect(total).toBeCloseTo(1, 5);
  });
});
