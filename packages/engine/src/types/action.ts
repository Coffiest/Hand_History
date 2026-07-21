export type ActionKind = "fold" | "check" | "call" | "bet" | "raise" | "allIn" | "postBlind" | "postAnte";

export interface PlayerAction {
  readonly kind: ActionKind;
  /** bet/raise/allIn の場合、そのアクションでストリートに積み上がる合計額(ストリート内の絶対額) */
  readonly toAmount?: number;
}

export type Street = "preflop" | "flop" | "turn" | "river" | "showdown";

/**
 * TDA Rule 47(Re-Opening the Bet)相当: 不完全レイズの扱いを表す判定結果。
 */
export type RaiseLegality =
  | { type: "callShort" }
  | { type: "fullRaise"; reopensBetting: true; newMinRaiseSize: number }
  | { type: "incompleteRaise"; reopensBettingForActedPlayers: false; minRaiseSizeIfReopened: number };
