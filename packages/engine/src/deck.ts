import { randomInt } from "node:crypto";
import { RANKS, SUITS, type Card } from "./types/card.js";

export function createOrderedDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ rank, suit });
    }
  }
  return deck;
}

/**
 * Fisher-Yatesシャッフル。node:crypto の randomInt (棄却法により偏りなし) を使用するため、
 * ゲームの公正性が要求されるディーリングに適している。
 */
export function shuffleDeck(deck: readonly Card[]): Card[] {
  const shuffled = [...deck];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = randomInt(0, i + 1);
    const tmp = shuffled[i]!;
    shuffled[i] = shuffled[j]!;
    shuffled[j] = tmp;
  }
  return shuffled;
}

export function createShuffledDeck(): Card[] {
  return shuffleDeck(createOrderedDeck());
}

export class Dealer {
  private cards: Card[];

  constructor(deck: Card[] = createShuffledDeck()) {
    this.cards = deck;
  }

  get remaining(): number {
    return this.cards.length;
  }

  draw(count: number): Card[] {
    if (count > this.cards.length) {
      throw new Error(`Cannot draw ${count} cards, only ${this.cards.length} remaining`);
    }
    return this.cards.splice(0, count);
  }

  /** TDAルール: バーンカードは各ストリート開示前に1枚捨てる */
  burn(): void {
    if (this.cards.length === 0) {
      throw new Error("Cannot burn from an empty deck");
    }
    this.cards.splice(0, 1);
  }
}
