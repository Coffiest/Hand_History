// Plain-text hand-history exporter (human-readable). JSON export is handled
// separately by the API; this is for quick copy-to-clipboard sharing.

import { cardDisplay } from "./cards";
import { ACTION_LABEL, STREET_LABEL_JA, STREETS, type HandPayload, type Street } from "./handTypes";

function holeCardsText(hand: HandPayload): string {
  const hole = hand.cards
    .filter((c) => c.role === "hole")
    .sort((a, b) => a.position - b.position)
    .map(cardDisplay)
    .join(" ");
  return hole || "—";
}

function boardText(hand: HandPayload, street: Street): string {
  return hand.cards
    .filter((c) => c.role === "board" && c.boardStreet === street)
    .sort((a, b) => a.position - b.position)
    .map(cardDisplay)
    .join(" ");
}

function actionsText(hand: HandPayload, street: Street): string[] {
  return hand.actions
    .filter((a) => a.street === street)
    .sort((a, b) => a.sequenceNumber - b.sequenceNumber)
    .map((a) => {
      const amount = a.toAmount != null ? ` ${a.toAmount}` : "";
      return `  ${a.actorLabel}: ${ACTION_LABEL[a.kind]}${amount}`;
    });
}

export function handToPlainText(hand: HandPayload): string {
  const lines: string[] = [];
  lines.push(hand.title || "ハンドヒストリー");

  const meta: string[] = [];
  if (hand.heroPosition) meta.push(`Position: ${hand.heroPosition}`);
  if (hand.numPlayers) meta.push(`${hand.numPlayers}-handed`);
  if (hand.smallBlind && hand.bigBlind) meta.push(`Blinds: ${hand.smallBlind}/${hand.bigBlind}`);
  if (meta.length) lines.push(meta.join("  |  "));

  lines.push("");
  lines.push(`Hero: ${holeCardsText(hand)}`);

  for (const street of STREETS) {
    const board = boardText(hand, street);
    const actions = actionsText(hand, street);
    if (!board && actions.length === 0 && street !== "preflop") continue;

    let header = STREET_LABEL_JA[street];
    if (board) header += ` [${board}]`;
    lines.push("");
    lines.push(header);
    if (actions.length) lines.push(...actions);
  }

  if (hand.potTotal != null || hand.resultAmount != null) {
    lines.push("");
    const parts: string[] = [];
    if (hand.potTotal != null) parts.push(`Pot: ${hand.potTotal}`);
    if (hand.resultAmount != null) {
      const sign = hand.resultAmount >= 0 ? "+" : "";
      parts.push(`Result: ${sign}${hand.resultAmount}`);
    }
    lines.push(parts.join("  |  "));
  }

  if (hand.notes) {
    lines.push("");
    lines.push(`Notes: ${hand.notes}`);
  }

  return lines.join("\n");
}
