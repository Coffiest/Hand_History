import { NextResponse } from "next/server";
import { getHandByShareToken } from "@/lib/handRepo";

export const runtime = "nodejs";

// Public — no auth. Returns a shared hand by its opaque token.
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }): Promise<Response> {
  const { token } = await params;
  const hand = await getHandByShareToken(token);
  if (!hand) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ hand });
}
