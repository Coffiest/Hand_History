/**
 * デッドボタン方式によるボタン/SB/BB決定ロジック。
 * docs/POKER_RULES.md 4章参照。
 *
 * 原則: BBは必ず固定シート順で「本来の順番」のプレイヤー(着席中の次の席)が払う。
 * SB・ボタンはBBから遡って固定シート順で1つずつ前の席に割り当てるため、
 * 直前にバストしたプレイヤーの席に当たった場合はSBが「デッド」(そのハンドはSB徴収なし)
 * になったり、ボタンが空席(デッドボタン)になったりすることがある。
 *
 * ヘッズアップ(着席2人)ではデッドボタンの概念自体が適用されず、SB=ボタンとなる。
 */

export interface ButtonAssignment {
  readonly buttonFixedPos: number;
  readonly smallBlindSeat: number | null; // null = デッドスモールブラインド(このハンドはSB徴収なし)
  readonly bigBlindSeat: number;
  readonly buttonIsDead: boolean;
}

function nextOccupiedAfter(
  fixedPos: number,
  occupiedSeats: ReadonlySet<number>,
  seatCount: number,
): number {
  for (let step = 1; step <= seatCount; step++) {
    const candidate = (fixedPos + step) % seatCount;
    if (occupiedSeats.has(candidate)) return candidate;
  }
  throw new Error("No occupied seats found");
}

export function computeButtonAssignment(params: {
  readonly occupiedSeats: ReadonlySet<number>;
  readonly seatCount: number;
  readonly previousBigBlindFixedPos: number | null;
}): ButtonAssignment {
  const { occupiedSeats, seatCount } = params;
  if (occupiedSeats.size < 2) {
    throw new Error("At least 2 occupied seats are required to assign button/blinds");
  }

  // 初回ハンド: 便宜上、最小の席番号の一つ前を基準にBBを決定する(最小席がBBになる)
  const basePos = params.previousBigBlindFixedPos ?? ((Math.min(...occupiedSeats) - 1 + seatCount) % seatCount);
  const bigBlindSeat = nextOccupiedAfter(basePos, occupiedSeats, seatCount);

  if (occupiedSeats.size === 2) {
    const buttonSeat = [...occupiedSeats].find((s) => s !== bigBlindSeat)!;
    return {
      buttonFixedPos: buttonSeat,
      smallBlindSeat: buttonSeat, // ヘッズアップ: SB = ボタン
      bigBlindSeat,
      buttonIsDead: false,
    };
  }

  const sbFixedPos = (bigBlindSeat - 1 + seatCount) % seatCount;
  const buttonFixedPos = (sbFixedPos - 1 + seatCount) % seatCount;

  return {
    buttonFixedPos,
    smallBlindSeat: occupiedSeats.has(sbFixedPos) ? sbFixedPos : null,
    bigBlindSeat,
    buttonIsDead: !occupiedSeats.has(buttonFixedPos),
  };
}
