import { NextResponse } from "next/server";
import { codesMatch, createSessionToken, sessionCookie, type SessionKind } from "./session";

export function isSecureRequest(req: Request): boolean {
  return new URL(req.url).protocol === "https:";
}

/** Shared handler for code-based logins (demo access and owner login). */
export async function loginWithCode(req: Request, kind: SessionKind, cfg: { enabled: boolean; key?: string; code?: string }): Promise<NextResponse> {
  if (!cfg.enabled || !cfg.key || !cfg.code) return NextResponse.json({ ok: false, error: "Not enabled on this deployment" }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { code?: unknown };
  const code = typeof body.code === "string" ? body.code.trim().slice(0, 200) : "";
  if (!(await codesMatch(code, cfg.code))) return NextResponse.json({ ok: false, error: "Incorrect code" }, { status: 401 });
  const res = NextResponse.json({ ok: true });
  res.headers.append("Set-Cookie", sessionCookie(kind, await createSessionToken(kind, cfg.key), isSecureRequest(req)));
  return res;
}
