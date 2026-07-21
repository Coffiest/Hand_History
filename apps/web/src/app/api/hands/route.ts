import { NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/serverAuth";
import { createHand, listHands } from "@/lib/handRepo";
import { parseHandPayload } from "@/lib/validateHand";

export const runtime = "nodejs";

export async function GET(req: Request): Promise<Response> {
  const user = await getAuthedUser(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const hands = await listHands(user.id);
  return NextResponse.json({ hands });
}

export async function POST(req: Request): Promise<Response> {
  const user = await getAuthedUser(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = parseHandPayload(body);
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 422 });

  const hand = await createHand(user.id, parsed);
  return NextResponse.json({ hand }, { status: 201 });
}
