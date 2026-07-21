import { describe, expect, it } from "vitest";
import { computeTargetTableCount, findEmptySeat, findRebalanceMove, findTableToBreak } from "../src/tableBalancer.js";

describe("computeTargetTableCount", () => {
  it("rounds up to the number of tables needed", () => {
    expect(computeTargetTableCount(12, 6)).toBe(2);
    expect(computeTargetTableCount(13, 6)).toBe(3);
    expect(computeTargetTableCount(6, 6)).toBe(1);
    expect(computeTargetTableCount(1, 6)).toBe(1);
    expect(computeTargetTableCount(0, 6)).toBe(0);
  });
});

describe("findTableToBreak", () => {
  it("returns null when the table count already matches the target", () => {
    const tables = [
      { tableId: 0, occupiedSeats: [0, 1, 2, 3, 4, 5] },
      { tableId: 1, occupiedSeats: [0, 1, 2, 3, 4] },
    ];
    expect(findTableToBreak(tables, 6, 11)).toBeNull();
  });

  it("breaks the smallest table when there are more tables than needed", () => {
    const tables = [
      { tableId: 0, occupiedSeats: [0, 1, 2, 3, 4, 5] },
      { tableId: 1, occupiedSeats: [0, 1] }, // only 2 left here
    ];
    // 8 players total fit on a single 6-max table's worth of "target" only if <=6; here totalPlayers=8 -> target=ceil(8/6)=2
    // so with 2 tables this should NOT break yet
    expect(findTableToBreak(tables, 6, 8)).toBeNull();

    // once totalPlayers drops to 6, one table is enough -> break the smaller one
    expect(findTableToBreak(tables, 6, 6)).toBe(1);
  });

  it("prefers breaking the higher tableId on a tie", () => {
    const tables = [
      { tableId: 0, occupiedSeats: [0, 1] },
      { tableId: 1, occupiedSeats: [0, 1] },
    ];
    expect(findTableToBreak(tables, 6, 4)).toBe(1);
  });
});

describe("findRebalanceMove", () => {
  it("returns null with a single table", () => {
    expect(findRebalanceMove([{ tableId: 0, occupiedSeats: [0, 1, 2] }])).toBeNull();
  });

  it("returns null when tables are within 1 of each other", () => {
    const tables = [
      { tableId: 0, occupiedSeats: [0, 1, 2, 3, 4] },
      { tableId: 1, occupiedSeats: [0, 1, 2, 3] },
    ];
    expect(findRebalanceMove(tables)).toBeNull();
  });

  it("moves a player from the fullest to the emptiest table when the gap is 2 or more", () => {
    const tables = [
      { tableId: 0, occupiedSeats: [0, 1, 2, 3, 4, 5] },
      { tableId: 1, occupiedSeats: [0, 1, 2] },
    ];
    expect(findRebalanceMove(tables)).toEqual({ fromTableId: 0, toTableId: 1 });
  });
});

describe("findEmptySeat", () => {
  it("finds the lowest-index empty seat", () => {
    expect(findEmptySeat([0, 2, 3], 6)).toBe(1);
    expect(findEmptySeat([], 6)).toBe(0);
  });

  it("returns null when the table is full", () => {
    expect(findEmptySeat([0, 1, 2, 3, 4, 5], 6)).toBeNull();
  });
});
