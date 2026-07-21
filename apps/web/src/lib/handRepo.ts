import { randomUUID } from "crypto";
import { prisma } from "./prisma";
import type { HandPayload, RecordedAction, RecordedCard, StoredHand, Street } from "./handTypes";
import type { SuitCode } from "./cards";

// Server-side hand persistence. Converts between Prisma rows and the shared
// HandPayload / StoredHand shapes used by the UI.

type PrismaHandWithRelations = Awaited<ReturnType<typeof findHandRow>>;

function findHandRow(id: string) {
  return prisma.hand.findUnique({
    where: { id },
    include: { cards: true, actions: true },
  });
}

function serialize(hand: NonNullable<PrismaHandWithRelations>): StoredHand {
  const cards: RecordedCard[] = hand.cards
    .map((c) => ({
      role: c.role as "hole" | "board",
      boardStreet: (c.boardStreet as Street | null) ?? null,
      position: c.position,
      rank: c.rank,
      suit: c.suit as SuitCode,
      rankConfidence: c.rankConfidence,
      suitConfidence: c.suitConfidence,
      source: c.source as "recognized" | "manualOverride",
    }))
    .sort((a, b) => a.position - b.position);

  const actions: RecordedAction[] = hand.actions
    .map((a) => ({
      sequenceNumber: a.sequenceNumber,
      street: a.street as Street,
      kind: a.kind as RecordedAction["kind"],
      toAmount: a.toAmount,
      actorLabel: a.actorLabel,
    }))
    .sort((a, b) => a.sequenceNumber - b.sequenceNumber);

  return {
    id: hand.id,
    createdAt: hand.createdAt.toISOString(),
    shareToken: hand.shareToken,
    favorite: hand.favorite,
    title: hand.title,
    heroPosition: hand.heroPosition,
    numPlayers: hand.numPlayers,
    smallBlind: hand.smallBlind,
    bigBlind: hand.bigBlind,
    potTotal: hand.potTotal,
    resultAmount: hand.resultAmount,
    wonByFold: hand.wonByFold,
    notes: hand.notes,
    cards,
    actions,
  };
}

export async function createHand(userId: string, payload: HandPayload): Promise<StoredHand> {
  const hand = await prisma.hand.create({
    data: {
      userId,
      title: payload.title,
      heroPosition: payload.heroPosition,
      numPlayers: payload.numPlayers,
      smallBlind: payload.smallBlind,
      bigBlind: payload.bigBlind,
      potTotal: payload.potTotal,
      resultAmount: payload.resultAmount,
      wonByFold: payload.wonByFold,
      notes: payload.notes,
      cards: {
        create: payload.cards.map((c) => ({
          role: c.role,
          boardStreet: c.boardStreet,
          position: c.position,
          rank: c.rank,
          suit: c.suit,
          rankConfidence: c.rankConfidence,
          suitConfidence: c.suitConfidence,
          source: c.source,
        })),
      },
      actions: {
        create: payload.actions.map((a) => ({
          sequenceNumber: a.sequenceNumber,
          street: a.street,
          kind: a.kind,
          toAmount: a.toAmount,
          actorLabel: a.actorLabel,
        })),
      },
    },
    include: { cards: true, actions: true },
  });
  return serialize(hand);
}

export async function listHands(userId: string): Promise<StoredHand[]> {
  const hands = await prisma.hand.findMany({
    where: { userId },
    include: { cards: true, actions: true },
    orderBy: { createdAt: "desc" },
  });
  return hands.map(serialize);
}

export async function getHand(userId: string, id: string): Promise<StoredHand | null> {
  const hand = await findHandRow(id);
  if (!hand || hand.userId !== userId) return null;
  return serialize(hand);
}

export async function deleteHand(userId: string, id: string): Promise<boolean> {
  const hand = await prisma.hand.findUnique({ where: { id } });
  if (!hand || hand.userId !== userId) return false;
  await prisma.hand.delete({ where: { id } });
  return true;
}

export async function ensureShareToken(userId: string, id: string): Promise<string | null> {
  const hand = await prisma.hand.findUnique({ where: { id } });
  if (!hand || hand.userId !== userId) return null;
  if (hand.shareToken) return hand.shareToken;
  const token = randomUUID().replace(/-/g, "");
  await prisma.hand.update({ where: { id }, data: { shareToken: token } });
  return token;
}

export async function getHandByShareToken(token: string): Promise<StoredHand | null> {
  const hand = await prisma.hand.findUnique({
    where: { shareToken: token },
    include: { cards: true, actions: true },
  });
  if (!hand) return null;
  return serialize(hand);
}
