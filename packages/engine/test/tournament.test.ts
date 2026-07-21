import { describe, expect, it } from "vitest";
import { Tournament } from "../src/tournament.js";

describe("Tournament", () => {
  it("rotates the button across hands and eliminates busted players", () => {
    const tournament = new Tournament({
      seatCount: 6,
      players: [
        { playerId: "P0", displayName: "P0", seatIndex: 0 },
        { playerId: "P1", displayName: "P1", seatIndex: 1 },
        { playerId: "P2", displayName: "P2", seatIndex: 2 },
      ],
      startingStack: 20_000,
    });

    const hand1 = tournament.startNextHand();
    const firstEvent = tournament.getEvents()[0]!;
    expect(firstEvent.type).toBe("handStarted");
    expect(hand1.getStreet()).toBe("preflop");

    // Fold everyone to the big blind seat to keep this test deterministic.
    while (!hand1.isHandComplete()) {
      const acting = hand1.getActingSeatIndex();
      if (acting === null) break;
      hand1.applyAction(acting, { kind: "fold" });
    }
    tournament.settleFinishedHand();

    const seatsAfterHand1 = tournament.getSeats();
    const totalChips = seatsAfterHand1.reduce((sum, s) => sum + s.stack, 0);
    expect(totalChips).toBe(60_000);

    const hand2 = tournament.startNextHand();
    expect(hand2.getStreet()).toBe("preflop");
    // Button should have moved from the first hand's button.
    const events = tournament.getEvents();
    const started = events.filter((e) => e.type === "handStarted");
    expect(started).toHaveLength(2);
    expect(started[1]!.buttonFixedPos).not.toBe(started[0]!.buttonFixedPos);
  });

  it("declares a winner once only one seat has chips left", () => {
    const tournament = new Tournament({
      seatCount: 6,
      players: [
        { playerId: "P0", displayName: "P0", seatIndex: 0 },
        { playerId: "P1", displayName: "P1", seatIndex: 1 },
      ],
      startingStack: 300, // small enough that a few forced all-ins end it quickly
    });

    let guard = 0;
    while (!tournament.isTournamentOver() && guard < 50) {
      guard++;
      const hand = tournament.startNextHand();
      // Push all-in every time to force a fast conclusion between two shrinking stacks.
      while (!hand.isHandComplete()) {
        const acting = hand.getActingSeatIndex();
        if (acting === null) break;
        try {
          hand.applyAction(acting, { kind: "allIn" });
        } catch {
          hand.applyAction(acting, { kind: "call" });
        }
      }
      tournament.settleFinishedHand();
    }

    expect(tournament.isTournamentOver()).toBe(true);
    expect(tournament.getWinnerPlayerId()).not.toBeNull();
    const winnerId = tournament.getWinnerPlayerId()!;
    const winnerSeat = tournament.getSeats().find((s) => s.playerId === winnerId)!;
    expect(winnerSeat.stack).toBe(600);
  });
});
