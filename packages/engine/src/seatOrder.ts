/**
 * 固定シート位置(0..seatCount-1)の円環上で、buttonFixedPos の次から時計回りに
 * 着席している(occupiedSeats に含まれる)席だけを並べた順序を返す。
 * buttonFixedPos 自体が空席(デッドボタン)でも問題なく機能する。
 */
export function orderedSeatsFromButton(
  occupiedSeats: readonly number[],
  buttonFixedPos: number,
  seatCount: number,
): number[] {
  const occupiedSet = new Set(occupiedSeats);
  const result: number[] = [];
  for (let step = 1; step <= seatCount; step++) {
    const candidate = (buttonFixedPos + step) % seatCount;
    if (occupiedSet.has(candidate)) result.push(candidate);
  }
  return result;
}

export interface StreetOrder {
  readonly preflopOrder: readonly number[];
  readonly postflopOrder: readonly number[];
}

/**
 * ボタン位置・SB(デッドスモールブラインドならnull)・BBから、プリフロップ/ポストフロップの
 * アクション順を決定する。
 *
 * ヘッズアップ(着席2人)は特殊ルール: SB=ボタンがプリフロップ最初にアクションし、
 * ポストフロップは最後にアクションする。
 */
export function computeStreetOrder(params: {
  readonly occupiedSeats: readonly number[];
  readonly buttonFixedPos: number;
  readonly smallBlindSeat: number | null;
  readonly bigBlindSeat: number;
  readonly seatCount: number;
}): StreetOrder {
  const { occupiedSeats, buttonFixedPos, smallBlindSeat, bigBlindSeat, seatCount } = params;
  const postflopOrder = orderedSeatsFromButton(occupiedSeats, buttonFixedPos, seatCount);

  if (occupiedSeats.length === 2 && smallBlindSeat === buttonFixedPos) {
    // ヘッズアップ: postflopOrder = [BB, SB(=button)]。プリフロップはSBが先にアクション。
    return {
      preflopOrder: [smallBlindSeat, bigBlindSeat],
      postflopOrder,
    };
  }

  const bbIndex = postflopOrder.indexOf(bigBlindSeat);
  if (bbIndex === -1) throw new Error("bigBlindSeat must be an occupied seat");
  const preflopOrder = [...postflopOrder.slice(bbIndex + 1), ...postflopOrder.slice(0, bbIndex + 1)];

  return { preflopOrder, postflopOrder };
}
