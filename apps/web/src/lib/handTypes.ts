// Shared hand-history shapes used by the API routes, recording UI, and replay.

import type { CardValue } from "./cards";

export type Street = "preflop" | "flop" | "turn" | "river";
export type ActionKind =
  | "fold"
  | "check"
  | "call"
  | "bet"
  | "raise"
  | "allIn"
  | "postSB"
  | "postBB";

export const STREETS: Street[] = ["preflop", "flop", "turn", "river"];

export const STREET_LABEL_JA: Record<Street, string> = {
  preflop: "プリフロップ",
  flop: "フロップ",
  turn: "ターン",
  river: "リバー",
};

export const ACTION_LABEL: Record<ActionKind, string> = {
  fold: "fold",
  check: "check",
  call: "call",
  bet: "bet",
  raise: "raise",
  allIn: "all-in",
  postSB: "SB",
  postBB: "BB",
};

export interface RecordedCard extends CardValue {
  role: "hole" | "board";
  boardStreet: Street | null;
  position: number;
  rankConfidence: number | null;
  suitConfidence: number | null;
  source: "recognized" | "manualOverride";
}

export interface RecordedAction {
  sequenceNumber: number;
  street: Street;
  kind: ActionKind;
  toAmount: number | null;
  actorLabel: string;
}

export interface HandPayload {
  title: string | null;
  heroPosition: string | null;
  numPlayers: number | null;
  smallBlind: number | null;
  bigBlind: number | null;
  potTotal: number | null;
  resultAmount: number | null;
  wonByFold: boolean | null;
  notes: string | null;
  cards: RecordedCard[];
  actions: RecordedAction[];
}

export interface StoredHand extends HandPayload {
  id: string;
  createdAt: string;
  shareToken: string | null;
  favorite: boolean;
}
