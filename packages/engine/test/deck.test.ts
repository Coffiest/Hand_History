import { describe, expect, it } from "vitest";
import { cardToString } from "../src/types/card.js";
import { createOrderedDeck, createShuffledDeck, Dealer, shuffleDeck } from "../src/deck.js";

describe("deck", () => {
  it("contains 52 unique cards", () => {
    const deck = createOrderedDeck();
    expect(deck).toHaveLength(52);
    const unique = new Set(deck.map(cardToString));
    expect(unique.size).toBe(52);
  });

  it("shuffling preserves the same set of cards", () => {
    const original = createOrderedDeck();
    const shuffled = shuffleDeck(original);
    expect(shuffled).toHaveLength(52);
    expect(new Set(shuffled.map(cardToString))).toEqual(new Set(original.map(cardToString)));
  });

  it("produces a different order most of the time", () => {
    const a = createShuffledDeck();
    const b = createShuffledDeck();
    expect(a.map(cardToString).join(",")).not.toBe(b.map(cardToString).join(","));
  });
});

describe("Dealer", () => {
  it("draws the requested number of cards and reduces the remaining count", () => {
    const dealer = new Dealer(createOrderedDeck());
    expect(dealer.remaining).toBe(52);
    const cards = dealer.draw(2);
    expect(cards).toHaveLength(2);
    expect(dealer.remaining).toBe(50);
  });

  it("burns exactly one card", () => {
    const dealer = new Dealer(createOrderedDeck());
    dealer.burn();
    expect(dealer.remaining).toBe(51);
  });

  it("throws when drawing more cards than remain", () => {
    const dealer = new Dealer(createOrderedDeck());
    expect(() => dealer.draw(53)).toThrow();
  });
});
