"use client";

import {
  createHand as apiCreate,
  deleteHand as apiDelete,
  fetchHand as apiGet,
  fetchHands as apiList,
  toggleFavorite as apiToggleFavorite,
} from "./apiClient";
import type { HandPayload, StoredHand } from "./handTypes";

// Hand storage with a device-local fallback. The server API (Postgres) is used
// when reachable; when it isn't (e.g. production before the database is
// configured), hands are stored in localStorage so the app is fully usable
// right now. Local-only hands merge into the list alongside server hands.

const KEY = "hh_local_hands_v1";

function readLocal(): StoredHand[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as StoredHand[]) : [];
  } catch {
    return [];
  }
}

function writeLocal(hands: StoredHand[]): void {
  window.localStorage.setItem(KEY, JSON.stringify(hands));
}

function byNewest(a: StoredHand, b: StoredHand): number {
  return b.createdAt.localeCompare(a.createdAt);
}

export async function saveHand(payload: HandPayload): Promise<StoredHand> {
  try {
    return await apiCreate(payload);
  } catch {
    const hand: StoredHand = {
      ...payload,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      shareToken: null,
      favorite: false,
    };
    writeLocal([hand, ...readLocal()]);
    return hand;
  }
}

export async function listHands(): Promise<StoredHand[]> {
  const local = readLocal();
  try {
    const server = await apiList();
    const localOnly = local.filter((l) => !server.some((s) => s.id === l.id));
    return [...localOnly, ...server].sort(byNewest);
  } catch {
    return [...local].sort(byNewest);
  }
}

export async function getHand(id: string): Promise<StoredHand | null> {
  try {
    return await apiGet(id);
  } catch {
    return readLocal().find((h) => h.id === id) ?? null;
  }
}

export async function removeHand(id: string): Promise<void> {
  try {
    await apiDelete(id);
  } catch {
    /* server unreachable or local-only hand */
  }
  writeLocal(readLocal().filter((h) => h.id !== id));
}

export async function setFavorite(id: string, favorite: boolean): Promise<void> {
  try {
    await apiToggleFavorite(id, favorite);
  } catch {
    writeLocal(readLocal().map((h) => (h.id === id ? { ...h, favorite } : h)));
  }
}
