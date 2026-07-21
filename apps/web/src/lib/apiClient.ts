"use client";

import { getSupabaseClient } from "./supabaseClient";
import type { HandPayload, StoredHand } from "./handTypes";

// Authenticated fetch helper: attaches the Supabase access token so API routes
// can identify the user. Works without Supabase in dev (server allows a dev user).
async function authHeaders(): Promise<Record<string, string>> {
  const supabase = getSupabaseClient();
  if (!supabase) return {};
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { authorization: `Bearer ${token}` } : {};
}

export async function createHand(payload: HandPayload): Promise<StoredHand> {
  const res = await fetch("/api/hands", {
    method: "POST",
    headers: { "content-type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`保存に失敗しました (${res.status})`);
  const data = await res.json();
  return data.hand as StoredHand;
}

export async function fetchHands(): Promise<StoredHand[]> {
  const res = await fetch("/api/hands", { headers: await authHeaders() });
  if (!res.ok) throw new Error(`読み込みに失敗しました (${res.status})`);
  const data = await res.json();
  return data.hands as StoredHand[];
}

export async function fetchHand(id: string): Promise<StoredHand> {
  const res = await fetch(`/api/hands/${id}`, { headers: await authHeaders() });
  if (!res.ok) throw new Error(`読み込みに失敗しました (${res.status})`);
  const data = await res.json();
  return data.hand as StoredHand;
}

export async function deleteHand(id: string): Promise<void> {
  const res = await fetch(`/api/hands/${id}`, { method: "DELETE", headers: await authHeaders() });
  if (!res.ok) throw new Error(`削除に失敗しました (${res.status})`);
}

export async function createShareToken(id: string): Promise<string> {
  const res = await fetch(`/api/hands/${id}/share`, { method: "POST", headers: await authHeaders() });
  if (!res.ok) throw new Error(`共有リンクの作成に失敗しました (${res.status})`);
  const data = await res.json();
  return data.token as string;
}
