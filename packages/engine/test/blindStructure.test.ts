import { describe, expect, it } from "vitest";
import { BLIND_STRUCTURE, STARTING_STACK, getBlindLevel } from "../src/blindStructure.js";

describe("blind structure", () => {
  it("starts at 20,000 which is 100x the level-1 big blind", () => {
    expect(STARTING_STACK).toBe(20_000);
    expect(getBlindLevel(1)).toMatchObject({ smallBlind: 100, bigBlind: 200 });
    expect(STARTING_STACK / getBlindLevel(1).bigBlind).toBe(100);
  });

  it("applies the BB ante (equal to the big blind) at every level", () => {
    for (const level of BLIND_STRUCTURE) {
      expect(level.bbAnte).toBe(level.bigBlind);
    }
  });

  it("matches the specified 21-level structure exactly", () => {
    expect(BLIND_STRUCTURE).toHaveLength(21);
    expect(BLIND_STRUCTURE[20]).toMatchObject({ smallBlind: 25_000, bigBlind: 50_000 });
  });

  it("uses 5-minute levels throughout", () => {
    expect(BLIND_STRUCTURE.every((l) => l.durationMinutes === 5)).toBe(true);
  });

  it("keeps increasing blinds beyond the last defined level", () => {
    const last = getBlindLevel(21);
    const beyond = getBlindLevel(25);
    expect(beyond.bigBlind).toBeGreaterThan(last.bigBlind);
    expect(beyond.bbAnte).toBe(beyond.bigBlind);
  });

  it("throws for a level below 1", () => {
    expect(() => getBlindLevel(0)).toThrow();
  });
});
