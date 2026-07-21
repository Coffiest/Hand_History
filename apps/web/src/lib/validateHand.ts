import { SUIT_ORDER } from "./cards";
import { STREETS, type ActionKind, type HandPayload, type Street } from "./handTypes";

// Minimal validation of an incoming hand payload at the API boundary.

const ACTION_KINDS: ActionKind[] = [
  "fold",
  "check",
  "call",
  "bet",
  "raise",
  "allIn",
  "postSB",
  "postBB",
];

function intOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  return Number.isFinite(v) ? Math.trunc(v as number) : null;
}

export function parseHandPayload(input: unknown): HandPayload | { error: string } {
  if (typeof input !== "object" || input === null) return { error: "invalid body" };
  const b = input as Record<string, unknown>;

  const cardsIn = Array.isArray(b.cards) ? b.cards : [];
  const cards: HandPayload["cards"] = [];
  for (const raw of cardsIn) {
    const c = raw as Record<string, unknown>;
    const rank = Number(c.rank);
    const suit = String(c.suit);
    if (!Number.isInteger(rank) || rank < 1 || rank > 13) return { error: "bad card rank" };
    if (!SUIT_ORDER.includes(suit as never)) return { error: "bad card suit" };
    const role = c.role === "board" ? "board" : "hole";
    cards.push({
      role,
      boardStreet: (STREETS.includes(c.boardStreet as Street) ? c.boardStreet : null) as Street | null,
      position: Number.isInteger(c.position) ? (c.position as number) : cards.length,
      rank,
      suit: suit as HandPayload["cards"][number]["suit"],
      rankConfidence: typeof c.rankConfidence === "number" ? c.rankConfidence : null,
      suitConfidence: typeof c.suitConfidence === "number" ? c.suitConfidence : null,
      source: c.source === "manualOverride" ? "manualOverride" : "recognized",
    });
  }

  const actionsIn = Array.isArray(b.actions) ? b.actions : [];
  const actions: HandPayload["actions"] = [];
  for (const raw of actionsIn) {
    const a = raw as Record<string, unknown>;
    if (!STREETS.includes(a.street as Street)) return { error: "bad action street" };
    if (!ACTION_KINDS.includes(a.kind as ActionKind)) return { error: "bad action kind" };
    actions.push({
      sequenceNumber: Number.isInteger(a.sequenceNumber) ? (a.sequenceNumber as number) : actions.length,
      street: a.street as Street,
      kind: a.kind as ActionKind,
      toAmount: intOrNull(a.toAmount),
      actorLabel: typeof a.actorLabel === "string" && a.actorLabel ? a.actorLabel : "Hero",
    });
  }

  return {
    title: typeof b.title === "string" && b.title.trim() ? b.title.trim() : null,
    heroPosition: typeof b.heroPosition === "string" && b.heroPosition ? b.heroPosition : null,
    numPlayers: intOrNull(b.numPlayers),
    smallBlind: intOrNull(b.smallBlind),
    bigBlind: intOrNull(b.bigBlind),
    potTotal: intOrNull(b.potTotal),
    resultAmount: intOrNull(b.resultAmount),
    wonByFold: typeof b.wonByFold === "boolean" ? b.wonByFold : null,
    notes: typeof b.notes === "string" && b.notes.trim() ? b.notes.trim() : null,
    cards,
    actions,
  };
}
