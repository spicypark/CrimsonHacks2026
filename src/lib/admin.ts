import { timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

/** Constant-time check of the admin secret (from the /admin/[secret] URL or ?secret= on admin APIs). */
export function isAdmin(candidate: string | null | undefined): boolean {
  const secret = env.adminSecret;
  if (!secret || !candidate) return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}
