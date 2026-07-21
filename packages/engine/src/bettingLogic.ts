import type { RaiseLegality } from "./types/action.js";

/**
 * オールイン(または通常のベット/レイズ)を「ショートコール」「フルレイズ」「不完全レイズ」に
 * 分類する。TDA Rule 47(Re-Opening the Bet)相当。
 *
 * - ショートコール: 増分が0以下(単にコールした、またはコール額未満のオールイン)。レイズではない。
 * - フルレイズ: 増分がそのストリートの直近の正当なレイズ幅以上。ベッティングを完全に再オープンする。
 * - 不完全レイズ: 増分がレイズ幅未満。既にこのストリートでアクション済みのプレイヤーは
 *   フォールドかコールのみ可能(再レイズ不可)。
 */
export function classifyRaise(params: {
  /** そのアクションでストリートに積み上がる合計額(絶対額) */
  toAmount: number;
  /** アクション前の、そのストリートでの最高ベット額 */
  currentBetToMatch: number;
  /** そのストリートで直近に成立した正当なフルレイズの増分 */
  roundLastFullRaiseSize: number;
}): RaiseLegality {
  const increment = params.toAmount - params.currentBetToMatch;
  if (increment <= 0) {
    return { type: "callShort" };
  }
  if (increment >= params.roundLastFullRaiseSize) {
    return { type: "fullRaise", reopensBetting: true, newMinRaiseSize: increment };
  }
  return {
    type: "incompleteRaise",
    reopensBettingForActedPlayers: false,
    minRaiseSizeIfReopened: params.roundLastFullRaiseSize,
  };
}

export function minRaiseToAmount(currentBetToMatch: number, lastFullRaiseSize: number): number {
  return currentBetToMatch + lastFullRaiseSize;
}
