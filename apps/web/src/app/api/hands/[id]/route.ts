import { NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/serverAuth";
import { deleteHand, getHand } from "@/lib/handRepo";

export const runtime = "nodejs";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const user = await getAuthedUser(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const hand = await getHand(user.id, id);
  if (!hand) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ hand });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const user = await getAuthedUser(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const ok = await deleteHand(user.id, id);
  if (!ok) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
