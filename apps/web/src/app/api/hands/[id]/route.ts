import { NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/serverAuth";
import { deleteHand, getHand } from "@/lib/handRepo";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const user = await getAuthedUser(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  const body = await req.json().catch(() => null);
  if (typeof body?.favorite !== "boolean") {
    return NextResponse.json({ error: "favorite (boolean) required" }, { status: 422 });
  }

  const hand = await prisma.hand.findUnique({ where: { id } });
  if (!hand || hand.userId !== user.id) return NextResponse.json({ error: "not found" }, { status: 404 });

  await prisma.hand.update({ where: { id }, data: { favorite: body.favorite } });
  return NextResponse.json({ ok: true, favorite: body.favorite });
}

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
