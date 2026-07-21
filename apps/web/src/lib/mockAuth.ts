"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "./useAuth";

// Mock authentication for the pre-Supabase phase: any input logs in. The
// session is a simple localStorage record on this device. When Supabase is
// configured later, real sessions take precedence and this remains a fallback.

const KEY = "hh_mock_user_v1";

export interface MockUser {
  email: string;
  name: string;
  loggedInAt: string;
}

export function getMockUser(): MockUser | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as MockUser) : null;
  } catch {
    return null;
  }
}

export function mockLogin(email: string): MockUser {
  const user: MockUser = {
    email: email.trim() || "guest@example.com",
    name: email.split("@")[0] || "guest",
    loggedInAt: new Date().toISOString(),
  };
  window.localStorage.setItem(KEY, JSON.stringify(user));
  return user;
}

export function mockLogout(): void {
  window.localStorage.removeItem(KEY);
}

/**
 * Client-side login gate. Redirects to /login when neither a mock session nor
 * a real Supabase session exists. Returns true once the check passed.
 */
export function useRequireLogin(): boolean {
  const router = useRouter();
  const auth = useAuth();
  const [ok, setOk] = useState(false);

  useEffect(() => {
    if (auth.loading) return;
    if (getMockUser() || auth.session) {
      setOk(true);
    } else {
      router.replace("/login");
    }
  }, [auth.loading, auth.session, router]);

  return ok;
}
