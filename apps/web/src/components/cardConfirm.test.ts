import { describe, expect, it } from "vitest";
import { reviewTarget, roleForCount, type ConfirmCard } from "./CardConfirmSheet";

// The sheet points the user at whichever half of a flagged card is doubtful.
// Getting this wrong is worse than saying nothing: telling someone to check the
// rank when the suit is the shaky one sends them looking in the wrong place.

function card(over: Partial<ConfirmCard> = {}): ConfirmCard {
  return {
    rank: 1,
    suit: "s",
    rankConfidence: 0.98,
    suitConfidence: 0.95,
    suitMargin: 0.9,
    source: "recognized",
    accepted: true,
    ...over,
  };
}

describe("reviewTarget", () => {
  it("says nothing about a card the server accepted", () => {
    expect(reviewTarget(card())).toBeNull();
  });

  it("says nothing about a card the user set by hand", () => {
    expect(reviewTarget(card({ accepted: false, source: "manualOverride" }))).toBeNull();
  });

  it("points at the suit when the runner-up is close behind", () => {
    // The real misread: read as clubs at 0.44 with spades at 0.35.
    expect(reviewTarget(card({ accepted: false, suitConfidence: 0.44, suitMargin: 0.1 })))
      .toBe("suit");
  });

  it("points at the suit when its top probability is a coin toss", () => {
    expect(reviewTarget(card({ accepted: false, suitConfidence: 0.5, suitMargin: 0.4 })))
      .toBe("suit");
  });

  it("points at the rank when the suit read was decisive", () => {
    // Flagged despite a clean suit means the rank is what the server doubted.
    expect(reviewTarget(card({ accepted: false, rankConfidence: 0.4 }))).toBe("rank");
  });

  it("falls back to the whole card when the server sent no margin", () => {
    // Older servers omit suit_margin; a healthy confidence still reads as rank.
    expect(reviewTarget(card({ accepted: false, suitMargin: null }))).toBe("rank");
  });
});

describe("roleForCount", () => {
  it("treats two cards as a hand and three to five as a board", () => {
    expect(roleForCount(2)).toBe("hole");
    for (const n of [1, 3, 4, 5]) expect(roleForCount(n)).toBe("board");
  });
});
