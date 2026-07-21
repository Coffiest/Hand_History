import { describe, expect, it } from "vitest";
import { computeButtonAssignment } from "../src/buttonRotation.js";

describe("computeButtonAssignment", () => {
  it("advances BB to the next occupied seat in fixed rotation, full 6-max", () => {
    const occupied = new Set([0, 1, 2, 3, 4, 5]);
    const assignment = computeButtonAssignment({
      occupiedSeats: occupied,
      seatCount: 6,
      previousBigBlindFixedPos: 2,
    });
    expect(assignment.bigBlindSeat).toBe(3);
    expect(assignment.smallBlindSeat).toBe(2);
    expect(assignment.buttonFixedPos).toBe(1);
    expect(assignment.buttonIsDead).toBe(false);
  });

  it("wraps around the table", () => {
    const occupied = new Set([0, 1, 2, 3, 4, 5]);
    const assignment = computeButtonAssignment({
      occupiedSeats: occupied,
      seatCount: 6,
      previousBigBlindFixedPos: 5,
    });
    expect(assignment.bigBlindSeat).toBe(0);
    expect(assignment.smallBlindSeat).toBe(5);
    expect(assignment.buttonFixedPos).toBe(4);
  });

  it("produces a dead button when the seat right before SB just busted", () => {
    // Seat 1 busted. Previous BB was seat 2, so new BB should be seat 3 (next occupied).
    // SB should be seat 2 (still occupied), button should be seat 1 -> empty -> dead button.
    const occupied = new Set([0, 2, 3, 4, 5]); // seat 1 is empty
    const assignment = computeButtonAssignment({
      occupiedSeats: occupied,
      seatCount: 6,
      previousBigBlindFixedPos: 2,
    });
    expect(assignment.bigBlindSeat).toBe(3);
    expect(assignment.smallBlindSeat).toBe(2);
    expect(assignment.buttonFixedPos).toBe(1);
    expect(assignment.buttonIsDead).toBe(true);
  });

  it("produces a dead small blind when the seat right before BB just busted", () => {
    // Seat 2 busted (was going to be SB). Previous BB was seat 1, so new BB is next occupied = seat 3.
    // SB slot (seat 2) is empty -> dead SB. Button (seat 1) is occupied -> real button, not dead.
    const occupied = new Set([0, 1, 3, 4, 5]); // seat 2 is empty
    const assignment = computeButtonAssignment({
      occupiedSeats: occupied,
      seatCount: 6,
      previousBigBlindFixedPos: 1,
    });
    expect(assignment.bigBlindSeat).toBe(3);
    expect(assignment.smallBlindSeat).toBeNull();
    expect(assignment.buttonFixedPos).toBe(1);
    expect(assignment.buttonIsDead).toBe(false);
  });

  it("assigns SB = button in heads-up play", () => {
    const occupied = new Set([2, 5]);
    const assignment = computeButtonAssignment({
      occupiedSeats: occupied,
      seatCount: 6,
      previousBigBlindFixedPos: 2,
    });
    expect(assignment.bigBlindSeat).toBe(5);
    expect(assignment.buttonFixedPos).toBe(2);
    expect(assignment.smallBlindSeat).toBe(2);
    expect(assignment.buttonIsDead).toBe(false);
  });

  it("throws with fewer than 2 occupied seats", () => {
    expect(() =>
      computeButtonAssignment({ occupiedSeats: new Set([0]), seatCount: 6, previousBigBlindFixedPos: 0 }),
    ).toThrow();
  });
});
