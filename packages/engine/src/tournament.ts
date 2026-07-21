import { computeButtonAssignment } from "./buttonRotation.js";
import { getBlindLevel, STARTING_STACK, type BlindLevel } from "./blindStructure.js";
import { HandEngine, type HandResult } from "./handEngine.js";
import type { Card } from "./types/card.js";

export interface TournamentSeatState {
  readonly seatIndex: number;
  readonly playerId: string;
  readonly displayName: string;
  stack: number;
  bustedAtHand: number | null;
}

export interface TournamentConfig {
  readonly seatCount: number;
  readonly players: readonly { playerId: string; displayName: string; seatIndex: number }[];
  readonly startingStack?: number;
}

export interface HandStartedEvent {
  readonly type: "handStarted";
  readonly handNumber: number;
  readonly level: BlindLevel;
  readonly buttonFixedPos: number;
  readonly smallBlindSeat: number | null;
  readonly bigBlindSeat: number;
}

export interface HandFinishedEvent {
  readonly type: "handFinished";
  readonly handNumber: number;
  readonly result: HandResult;
  readonly bustedSeats: readonly number[];
}

export type TournamentEvent = HandStartedEvent | HandFinishedEvent;

/**
 * SnG(単卓)トーナメントの進行を管理する。ブラインドレベルの実際の経過時間管理や
 * ネットワーク越しのアクション入力は呼び出し側(サーバー)の責務とし、ここでは
 * 「次のハンドを組み立てる」「結果を反映する」という純粋な状態遷移のみを扱う。
 */
export class Tournament {
  private readonly seatCount: number;
  private readonly seats = new Map<number, TournamentSeatState>();
  private handNumber = 0;
  private levelIndex = 1;
  private previousBigBlindFixedPos: number | null = null;
  private readonly events: TournamentEvent[] = [];
  private currentHand: HandEngine | null = null;
  private currentHandButtonInfo: { buttonFixedPos: number; smallBlindSeat: number | null; bigBlindSeat: number } | null =
    null;

  constructor(config: TournamentConfig) {
    this.seatCount = config.seatCount;
    const startingStack = config.startingStack ?? STARTING_STACK;
    for (const p of config.players) {
      if (p.seatIndex < 0 || p.seatIndex >= this.seatCount) {
        throw new Error(`seatIndex ${p.seatIndex} is out of range for a ${this.seatCount}-max table`);
      }
      this.seats.set(p.seatIndex, {
        seatIndex: p.seatIndex,
        playerId: p.playerId,
        displayName: p.displayName,
        stack: startingStack,
        bustedAtHand: null,
      });
    }
  }

  getCurrentLevel(): BlindLevel {
    return getBlindLevel(this.levelIndex);
  }

  advanceToNextLevel(): void {
    this.levelIndex += 1;
  }

  private occupiedSeats(): TournamentSeatState[] {
    return [...this.seats.values()].filter((s) => s.bustedAtHand === null);
  }

  isTournamentOver(): boolean {
    return this.occupiedSeats().length <= 1;
  }

  getWinnerPlayerId(): string | null {
    const remaining = this.occupiedSeats();
    return remaining.length === 1 ? remaining[0]!.playerId : null;
  }

  getSeats(): readonly TournamentSeatState[] {
    return [...this.seats.values()];
  }

  getEvents(): readonly TournamentEvent[] {
    return this.events;
  }

  /** 次のハンドを開始する(ボタン移動 + HandEngine構築)。呼び出し側でアクションを流し込んでいく。 */
  startNextHand(deck?: Card[]): HandEngine {
    if (this.isTournamentOver()) throw new Error("Tournament is already over");
    if (this.currentHand && !this.currentHand.isHandComplete()) {
      throw new Error("The current hand has not finished yet");
    }

    this.handNumber += 1;
    const occupied = this.occupiedSeats();
    const occupiedFixedPositions = new Set(occupied.map((s) => s.seatIndex));

    const assignment = computeButtonAssignment({
      occupiedSeats: occupiedFixedPositions,
      seatCount: this.seatCount,
      previousBigBlindFixedPos: this.previousBigBlindFixedPos,
    });
    this.previousBigBlindFixedPos = assignment.bigBlindSeat;
    this.currentHandButtonInfo = assignment;

    const level = this.getCurrentLevel();
    const hand = new HandEngine({
      seats: occupied.map((s) => ({ seatIndex: s.seatIndex, playerId: s.playerId, stack: s.stack })),
      seatCount: this.seatCount,
      buttonFixedPos: assignment.buttonFixedPos,
      smallBlindSeat: assignment.smallBlindSeat,
      bigBlindSeat: assignment.bigBlindSeat,
      smallBlind: level.smallBlind,
      bigBlind: level.bigBlind,
      bbAnte: level.bbAnte,
      ...(deck ? { deck } : {}),
    });

    this.currentHand = hand;
    this.events.push({
      type: "handStarted",
      handNumber: this.handNumber,
      level,
      buttonFixedPos: assignment.buttonFixedPos,
      smallBlindSeat: assignment.smallBlindSeat,
      bigBlindSeat: assignment.bigBlindSeat,
    });
    return hand;
  }

  /** ハンド完了後に呼び出し、スタックをトーナメント状態へ反映し、バストしたプレイヤーを除外する */
  settleFinishedHand(): void {
    const hand = this.currentHand;
    if (!hand) throw new Error("No hand in progress");
    if (!hand.isHandComplete()) throw new Error("The current hand has not finished yet");

    const stacks = hand.getStacks();
    const bustedSeats: number[] = [];
    for (const [seatIndex, stack] of stacks) {
      const seat = this.seats.get(seatIndex)!;
      seat.stack = stack;
      if (stack === 0) {
        seat.bustedAtHand = this.handNumber;
        bustedSeats.push(seatIndex);
      }
    }

    this.events.push({
      type: "handFinished",
      handNumber: this.handNumber,
      result: hand.getResult(),
      bustedSeats,
    });
    this.currentHand = null;
    this.currentHandButtonInfo = null;
  }
}
