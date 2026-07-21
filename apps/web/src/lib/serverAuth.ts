import { createClient } from "@supabase/supabase-js";
import { prisma } from "./prisma";

// Server-side auth for API routes. The browser sends the Supabase access token
// as a Bearer header; we verify it and map it to (or create) our own User row.
//
// When Supabase isn't configured and ALLOW_DEV_USER=1 (local dev / CI), we fall
// back to a single shared dev user so the app is usable without a Supabase
// project. This fallback is refused in production.

export interface AuthedUser {
  id: string;
  authId: string;
  email: string | null;
}

const DEV_AUTH_ID = "dev-user";

async function ensureUser(authId: string, email: string | null): Promise<AuthedUser> {
  const user = await prisma.user.upsert({
    where: { authId },
    update: {},
    create: { authId, email: email ?? undefined },
  });
  return { id: user.id, authId: user.authId, email: user.email };
}

export async function getAuthedUser(req: Request): Promise<AuthedUser | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  const authHeader = req.headers.get("authorization");
  const token = authHeader?.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7)
    : null;

  if (url && anon && token) {
    const supabase = createClient(url, anon);
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) return null;
    return ensureUser(data.user.id, data.user.email ?? null);
  }

  // Dev fallback.
  const allowDev = process.env.ALLOW_DEV_USER === "1" && process.env.NODE_ENV !== "production";
  if (allowDev) {
    return ensureUser(DEV_AUTH_ID, "dev@local");
  }

  return null;
}
