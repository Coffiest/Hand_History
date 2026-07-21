import { computeButtonAssignment } from "./buttonRotation.js";
import { getBlindLevel, STARTING_STACK, type BlindLevel } from "./blindStructure.js";
import { HandEngine } from "./handEngine.js";
import { findEmptySeat, findRebalanceMove, findTableToBreak } from "./tableBalancer.js";
import type { Card } from "./types/card.js";

interface TableSeatState {
  readonly playerId: string;
  stack: number;
}

interface TableState {
  readonly id: number;
  readonly seats: Map<number, TableSeatState>;
  previousBigBlindFixedPos: number | null;
}

export interface MultiTableSeatInput {
  readonly playerId: string;
  readonly displayName: string;
}

export interface MultiTableTournamentConfig {
  readonly tableSeatCount: number;
  readonly players: readonly MultiTableSeatInput[];
  readonly startingStack?: number;
}

export type MultiTableEvent =
  | {
      readonly type: "handStarted";
      readonly tableId: number;
      readonly handNumber: number;
      readonly level: BlindLevel;
      readonly buttonFixedPos: number;
      readonly smallBlindSeat: number | null;
      readonly bigBlindSeat: number;
    }
  | {
      readonly type: "handFinished";
      readonly tableId: number;
      readonly handNumber: number;
      readonly bustedPlayerIds: readonly string[];
    }
  | { readonly type: "tableBroken"; readonly tableId: number; readonly movedPlayerIds: readonly string[] }
  | {
      readonly type: "playerMoved";
      readonly playerId: string;
      readonly fromTableId: number;
      readonly toTableId: number;
      readonly toSeatIndex: number;
    };

export interface TableOccupant {
  readonly seatIndex: number;
  readonly playerId: string;
  readonly stack: number;
}

/**
 * MTT(複数テーブルトーナメント)の進行を管理する。単卓の Tournament クラスと異なり、
 * 複数の卓を横断する共有ブラインドクロックと、ハンドとハンドの間でのテーブル解体・
 * バランシングを扱う。1卓分のベッティング進行そのものは(単卓と同様に)HandEngineへ委譲する。
 *
 * サーバー側は卓ごとに `startNextHandOnTable` / `settleFinishedHandOnTable` を呼び出す
 * 想定(各卓が独立してハンドを進行しつつ、ハンド終了のたびに全体のバランスを整える)。
 */
export class MultiTableTournament {
  private readonly seatCount: number;
  private readonly startingStack: number;
  private tables: TableState[] = [];
  private nextTableId = 0;
  private levelIndex = 1;
  private handNumber = 0;
  private readonly events: MultiTableEvent[] = [];
  private readonly displayNames = new Map<string, string>();

  constructor(config: MultiTableTournamentConfig) {
    if (config.tableSeatCount < 2) throw new Error("tableSeatCount must be at least 2");
    this.seatCount = config.tableSeatCount;
    this.startingStack = config.startingStack ?? STARTING_STACK;
    for (const p of config.players) this.displayNames.set(p.playerId, p.displayName);

    const numTables = Math.max(1, Math.ceil(config.players.length / config.tableSeatCount));
    for (let t = 0; t < numTables; t++) {
      this.tables.push({ id: this.nextTableId++, seats: new Map(), previousBigBlindFixedPos: null });
    }

    const seatCounters = new Array(numTables).fill(0) as number[];
    config.players.forEach((p, i) => {
      const tableIdx = i % numTables;
      const table = this.tables[tableIdx]!;
      const seatIndex = seatCounters[tableIdx]!;
      seatCounters[tableIdx] = seatIndex + 1;
      table.seats.set(seatIndex, { playerId: p.playerId, stack: this.startingStack });
    });
  }

  getCurrentLevel(): BlindLevel {
    return getBlindLevel(this.levelIndex);
  }

  advanceToNextLevel(): void {
    this.levelIndex += 1;
  }

  getTableIds(): number[] {
    return this.tables.map((t) => t.id);
  }

  getTableOccupancy(tableId: number): TableOccupant[] {
    const table = this.requireTable(tableId);
    return [...table.seats.entries()].map(([seatIndex, s]) => ({ seatIndex, playerId: s.playerId, stack: s.stack }));
  }

  totalRemainingPlayers(): number {
    return this.tables.reduce((sum, t) => sum + t.seats.size, 0);
  }

  isTournamentOver(): boolean {
    return this.totalRemainingPlayers() <= 1;
  }

  getWinnerPlayerId(): string | null {
    if (!this.isTournamentOver()) return null;
    for (const t of this.tables) {
      for (const s of t.seats.values()) return s.playerId;
    }
    return null;
  }

  getDisplayName(playerId: string): string {
    return this.displayNames.get(playerId) ?? playerId;
  }

  /**
   * レイトレジストレーション: 進行中のトーナメントに開始スタックで途中参加させる。
   * ハンドとハンドの間(どの卓もハンド進行中でないタイミング)で呼び出すこと。
   * 空席のある卓のうち最も人数が少ない卓に着席し、満席なら新しい卓を増設する。
   */
  registerLatePlayer(player: MultiTableSeatInput): { tableId: number; seatIndex: number } {
    this.displayNames.set(player.playerId, player.displayName);

    let table = this.findTableWithMostRoom();
    if (!table) {
      table = { id: this.nextTableId++, seats: new Map(), previousBigBlindFixedPos: null };
      this.tables.push(table);
    }
    const seatIndex = findEmptySeat([...table.seats.keys()], this.seatCount)!;
    table.seats.set(seatIndex, { playerId: player.playerId, stack: this.startingStack });

    // 参加によって卓間の人数差が2以上になった場合に均す
    this.rebalanceTables();

    const finalTable = this.tables.find((t) => [...t.seats.values()].some((s) => s.playerId === player.playerId))!;
    const finalSeat = [...finalTable.seats.entries()].find(([, s]) => s.playerId === player.playerId)![0];
    return { tableId: finalTable.id, seatIndex: finalSeat };
  }

  getEvents(): readonly MultiTableEvent[] {
    return this.events;
  }

  private requireTable(tableId: number): TableState {
    const table = this.tables.find((t) => t.id === tableId);
    if (!table) throw new Error(`Unknown table ${tableId}`);
    return table;
  }

  /** 指定テーブルの次のハンドを開始する。呼び出し側でアクションを流し込んでいく。 */
  startNextHandOnTable(tableId: number, deck?: Card[]): HandEngine {
    const table = this.requireTable(tableId);
    if (table.seats.size < 2) {
      throw new Error(`Table ${tableId} does not have enough players to start a hand`);
    }

    const occupiedFixedPositions = new Set(table.seats.keys());
    const assignment = computeButtonAssignment({
      occupiedSeats: occupiedFixedPositions,
      seatCount: this.seatCount,
      previousBigBlindFixedPos: table.previousBigBlindFixedPos,
    });
    table.previousBigBlindFixedPos = assignment.bigBlindSeat;

    this.handNumber += 1;
    const level = this.getCurrentLevel();
    const hand = new HandEngine({
      seats: [...table.seats.entries()].map(([seatIndex, s]) => ({ seatIndex, playerId: s.playerId, stack: s.stack })),
      seatCount: this.seatCount,
      buttonFixedPos: assignment.buttonFixedPos,
      smallBlindSeat: assignment.smallBlindSeat,
      bigBlindSeat: assignment.bigBlindSeat,
      smallBlind: level.smallBlind,
      bigBlind: level.bigBlind,
      bbAnte: level.bbAnte,
      ...(deck ? { deck } : {}),
    });

    this.events.push({
      type: "handStarted",
      tableId,
      handNumber: this.handNumber,
      level,
      buttonFixedPos: assignment.buttonFixedPos,
      smallBlindSeat: assignment.smallBlindSeat,
      bigBlindSeat: assignment.bigBlindSeat,
    });
    return hand;
  }

  /** ハンド完了後に呼び出す。スタック反映・バスト処理・テーブル解体/バランシングまで行う。 */
  settleFinishedHandOnTable(tableId: number, hand: HandEngine): void {
    if (!hand.isHandComplete()) throw new Error("The hand has not finished yet");
    const table = this.requireTable(tableId);

    const stacks = hand.getStacks();
    const bustedPlayerIds: string[] = [];
    for (const [seatIndex, stack] of stacks) {
      const seat = table.seats.get(seatIndex);
      if (!seat) continue;
      seat.stack = stack;
      if (stack === 0) {
        bustedPlayerIds.push(seat.playerId);
        table.seats.delete(seatIndex);
      }
    }

    this.events.push({ type: "handFinished", tableId, handNumber: this.handNumber, bustedPlayerIds });
    this.rebalanceTables();
  }

  private rebalanceTables(): void {
    let guard = 0;
    while (guard++ < 1000) {
      const occupancy = this.tables.map((t) => ({ tableId: t.id, occupiedSeats: [...t.seats.keys()] }));
      const totalPlayers = this.totalRemainingPlayers();
      const breakTableId = findTableToBreak(occupancy, this.seatCount, totalPlayers);
      if (breakTableId === null) break;
      this.breakTable(breakTableId);
    }

    guard = 0;
    while (guard++ < 1000) {
      const occupancy = this.tables.map((t) => ({ tableId: t.id, occupiedSeats: [...t.seats.keys()] }));
      const move = findRebalanceMove(occupancy);
      if (!move) break;
      this.movePlayerBetweenTables(move.fromTableId, move.toTableId);
    }
  }

  private breakTable(tableId: number): void {
    const table = this.requireTable(tableId);
    const entries = [...table.seats.entries()];
    this.tables = this.tables.filter((t) => t.id !== tableId);

    const movedPlayerIds: string[] = [];
    for (const [, seat] of entries) {
      const destination = this.findTableWithMostRoom();
      if (!destination) throw new Error("No destination table with an empty seat found while breaking a table");
      const emptySeatIndex = findEmptySeat([...destination.seats.keys()], this.seatCount)!;
      destination.seats.set(emptySeatIndex, { playerId: seat.playerId, stack: seat.stack });
      movedPlayerIds.push(seat.playerId);
    }

    this.events.push({ type: "tableBroken", tableId, movedPlayerIds });
  }

  private movePlayerBetweenTables(fromTableId: number, toTableId: number): void {
    const from = this.requireTable(fromTableId);
    const to = this.requireTable(toTableId);
    const emptySeatOnTo = findEmptySeat([...to.seats.keys()], this.seatCount);
    if (emptySeatOnTo === null) return; // 理論上起きないはずだが、安全のためのno-op

    // 移動元テーブルの中で最もシートインデックスが大きいプレイヤーを動かす、という単純で決定的なルール。
    // 本来のTDAルールは「直後にブラインドを払わずに済むプレイヤー」を優先するが、簡略化している。
    const candidateSeatIndex = Math.max(...from.seats.keys());
    const movingSeat = from.seats.get(candidateSeatIndex)!;
    from.seats.delete(candidateSeatIndex);
    to.seats.set(emptySeatOnTo, movingSeat);

    this.events.push({
      type: "playerMoved",
      playerId: movingSeat.playerId,
      fromTableId,
      toTableId,
      toSeatIndex: emptySeatOnTo,
    });
  }

  /** 空きのあるテーブルのうち、最も人数が少ない(=最も空席が多い)ものを返す。均等に配るため。 */
  private findTableWithMostRoom(): TableState | null {
    let best: TableState | null = null;
    for (const t of this.tables) {
      if (t.seats.size >= this.seatCount) continue;
      if (!best || t.seats.size < best.seats.size) best = t;
    }
    return best;
  }
}
