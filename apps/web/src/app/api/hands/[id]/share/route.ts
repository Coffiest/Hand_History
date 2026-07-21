import { NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/serverAuth";
import { ensureShareToken } from "@/lib/handRepo";

export const runtime = "nodejs";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const user = await getAuthedUser(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const token = await ensureShareToken(user.id, id);
  if (!token) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ token });
}
