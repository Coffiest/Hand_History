/**
 * SnG(6-max)標準ブラインド構造。
 *
 * 運営(ユーザー)から指定された実際の構造をそのまま定義している。
 * 変更したい場合はこの配列を直接編集するだけでよい(ロジック側の変更は不要)。
 *
 * ルール:
 * - 開始スタック: 20,000点 (= 100BB, BB=200)
 * - BBアンテ方式: 各ハンド、ビッグブラインドの席のプレイヤーだけが
 *   「ビッグブラインドと同額」のアンテを追加で払う(他のプレイヤーは個別にアンテを払わない)。
 *   常時アンテが発生する(スキップされるレベルはない)。
 * - 1レベル = 5分
 * - 定義された最終レベルを超えた場合は `getBlindLevel` が自動的にパターンを継続する
 *   (優勝者が決まるまでブラインドは上昇し続ける)。
 */

export interface BlindLevel {
  readonly level: number;
  readonly smallBlind: number;
  readonly bigBlind: number;
  /** BBアンテ額。BBの席のプレイヤーのみが追加で払う。常に bigBlind と同額。 */
  readonly bbAnte: number;
  readonly durationMinutes: number;
}

export const STARTING_STACK = 20_000;

const RAW_LEVELS: readonly (readonly [smallBlind: number, bigBlind: number])[] = [
  [100, 200],
  [200, 300],
  [200, 400],
  [300, 600],
  [400, 800],
  [500, 1_000],
  [600, 1_200],
  [1_000, 1_500],
  [1_000, 2_000],
  [1_500, 3_000],
  [2_000, 4_000],
  [2_500, 5_000],
  [3_000, 6_000],
  [4_000, 8_000],
  [5_000, 10_000],
  [6_000, 12_000],
  [10_000, 15_000],
  [10_000, 20_000],
  [15_000, 30_000],
  [20_000, 40_000],
  [25_000, 50_000],
];

export const LEVEL_DURATION_MINUTES = 5;

export const BLIND_STRUCTURE: readonly BlindLevel[] = RAW_LEVELS.map(([smallBlind, bigBlind], i) => ({
  level: i + 1,
  smallBlind,
  bigBlind,
  bbAnte: bigBlind,
  durationMinutes: LEVEL_DURATION_MINUTES,
}));

/**
 * 定義済みレベルを超えた場合のフォールバック継続ロジック。
 * 直近3レベルの平均成長率をもとに、SB/BBそれぞれを「きりのよい」単位に丸めながら上昇させる。
 * 優勝が決まるまでトーナメントを止めないための保険であり、正式な構造は上の配列が正。
 */
function extrapolateLevel(levelIndex: number): BlindLevel {
  const last = BLIND_STRUCTURE[BLIND_STRUCTURE.length - 1]!;
  const prev = BLIND_STRUCTURE[BLIND_STRUCTURE.length - 4] ?? BLIND_STRUCTURE[0]!;
  const stepsFromLast = levelIndex - last.level;
  const growthPerStep = Math.pow(last.bigBlind / prev.bigBlind, 1 / 3);

  const roundToNiceUnit = (value: number): number => {
    const magnitude = Math.pow(10, Math.max(0, Math.floor(Math.log10(value)) - 1));
    return Math.round(value / magnitude) * magnitude;
  };

  const rawBigBlind = last.bigBlind * Math.pow(growthPerStep, stepsFromLast);
  const bigBlind = roundToNiceUnit(rawBigBlind);
  const smallBlind = roundToNiceUnit(bigBlind / 2);

  return {
    level: levelIndex,
    smallBlind,
    bigBlind,
    bbAnte: bigBlind,
    durationMinutes: LEVEL_DURATION_MINUTES,
  };
}

export function getBlindLevel(levelIndex: number): BlindLevel {
  if (levelIndex < 1) {
    throw new Error(`levelIndex must be >= 1, got ${levelIndex}`);
  }
  const defined = BLIND_STRUCTURE[levelIndex - 1];
  if (defined) return defined;
  return extrapolateLevel(levelIndex);
}
