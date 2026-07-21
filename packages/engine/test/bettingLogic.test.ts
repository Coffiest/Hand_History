import { describe, expect, it } from "vitest";
import { classifyRaise, minRaiseToAmount } from "../src/bettingLogic.js";

describe("classifyRaise", () => {
  it("classifies a plain call as callShort", () => {
    const result = classifyRaise({ toAmount: 400, currentBetToMatch: 400, roundLastFullRaiseSize: 400 });
    expect(result.type).toBe("callShort");
  });

  it("classifies a full raise that meets or exceeds the minimum raise size", () => {
    // BB=400, someone raises to 1200 (increment 800 >= min raise 400)
    const result = classifyRaise({ toAmount: 1200, currentBetToMatch: 400, roundLastFullRaiseSize: 400 });
    expect(result).toEqual({ type: "fullRaise", reopensBetting: true, newMinRaiseSize: 800 });
  });

  it("classifies a short all-in raise as incomplete and does not reopen for acted players", () => {
    // currentBetToMatch=400, min raise size=400 (i.e. next legal raise must reach 800)
    // a player goes all-in for 550 (increment 150 < 400)
    const result = classifyRaise({ toAmount: 550, currentBetToMatch: 400, roundLastFullRaiseSize: 400 });
    expect(result).toEqual({
      type: "incompleteRaise",
      reopensBettingForActedPlayers: false,
      minRaiseSizeIfReopened: 400,
    });
  });

  it("classifies an all-in exactly equal to the minimum raise as a full raise", () => {
    const result = classifyRaise({ toAmount: 800, currentBetToMatch: 400, roundLastFullRaiseSize: 400 });
    expect(result).toEqual({ type: "fullRaise", reopensBetting: true, newMinRaiseSize: 400 });
  });
});

describe("minRaiseToAmount", () => {
  it("adds the last full raise size on top of the current bet", () => {
    expect(minRaiseToAmount(400, 400)).toBe(800);
    expect(minRaiseToAmount(1200, 800)).toBe(2000);
  });
});
