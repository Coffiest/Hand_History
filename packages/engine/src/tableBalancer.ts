/**
 * MTT(複数テーブルトーナメント)における、テーブル解体(テーブルブレイク)と
 * テーブルバランシングの判定ロジック。実際の座席移動やハンド進行は multiTableTournament.ts
 * が担当し、ここでは「何を」すべきかの判定のみを行う純粋関数として切り出す(テスト容易性のため)。
 *
 * ルール(TDA準拠の簡略版):
 * - テーブル解体はハンドとハンドの間にのみ行う(このモジュールはそのタイミングでのみ呼ばれる前提)
 * - 現在のテーブル数が「必要な最小テーブル数」を上回っていれば、一番人数の少ないテーブルを解体する
 * - 解体対象がない場合、最大人数のテーブルと最小人数のテーブルの差が2以上あればリバランス(1人移動)する
 */

export interface TableOccupancy {
  readonly tableId: number;
  readonly occupiedSeats: readonly number[];
}

export function computeTargetTableCount(totalPlayers: number, seatsPerTable: number): number {
  if (totalPlayers <= 0) return 0;
  return Math.ceil(totalPlayers / seatsPerTable);
}

/** 解体すべきテーブルがあればそのtableIdを返す(無ければnull)。同数の場合はtableIdが最大のものを優先して解体する。 */
export function findTableToBreak(
  tables: readonly TableOccupancy[],
  seatsPerTable: number,
  totalPlayers: number,
): number | null {
  const target = computeTargetTableCount(totalPlayers, seatsPerTable);
  if (tables.length <= target) return null;

  const smallest = [...tables].sort(
    (a, b) => a.occupiedSeats.length - b.occupiedSeats.length || b.tableId - a.tableId,
  )[0];
  return smallest ? smallest.tableId : null;
}

export interface RebalanceMove {
  readonly fromTableId: number;
  readonly toTableId: number;
}

/** リバランス(1人移動)が必要ならその移動元/移動先テーブルを返す。不要ならnull。 */
export function findRebalanceMove(tables: readonly TableOccupancy[]): RebalanceMove | null {
  if (tables.length < 2) return null;

  const sorted = [...tables].sort((a, b) => b.occupiedSeats.length - a.occupiedSeats.length);
  const fullest = sorted[0]!;
  const emptiest = sorted[sorted.length - 1]!;

  if (fullest.occupiedSeats.length - emptiest.occupiedSeats.length >= 2) {
    return { fromTableId: fullest.tableId, toTableId: emptiest.tableId };
  }
  return null;
}

/** テーブル内の空席のうち、最小のシートインデックスを返す(無ければnull)。 */
export function findEmptySeat(occupiedSeats: readonly number[], seatsPerTable: number): number | null {
  const occupied = new Set(occupiedSeats);
  for (let i = 0; i < seatsPerTable; i++) {
    if (!occupied.has(i)) return i;
  }
  return null;
}
