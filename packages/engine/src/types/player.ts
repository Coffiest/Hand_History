import type { Card } from "./card.js";

export type SeatIndex = number;

export type PlayerStatus =
  | "active"
  | "folded"
  | "allIn"
  | "sittingOut"
  | "bustedOut"
  | "empty";

export interface Seat {
  readonly index: SeatIndex;
  playerId: string | null;
  status: PlayerStatus;
  stack: number;
  /** このハンドで賭けた累計額(ストリートをまたいだハンド全体の拠出額。サイドポット計算に使用) */
  handContribution: number;
  /** 現在のベッティングラウンドで賭けた額 */
  streetContribution: number;
  holeCards: Card[];
  /** このベッティングラウンドで既にアクション済みか(不完全レイズの再オープン判定に使用) */
  hasActedThisStreet: boolean;
  isDisconnected: boolean;
}

export interface PlayerAccount {
  readonly id: string;
  readonly displayName: string;
}
