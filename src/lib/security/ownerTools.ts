import { NextResponse } from "next/server";
import { codesMatch, isOwnerRequest, securityConfig } from "./session";

/**
 * Guards owner-only server tools (live connection test, model catalogue).
 * Allowed with a valid owner session, or the legacy AI_CONNECTION_TEST_TOKEN.
 * Returns a response to send when access is refused, otherwise null.
 */
export async function requireOwner(req: Request, body: { token?: unknown }): Promise<NextResponse | null> {
  const cfg = securityConfig();
  const token = process.env.AI_CONNECTION_TEST_TOKEN;
  if (!cfg.ownerLogin.enabled && !token) {
    return NextResponse.json({ ok: false, detail: "Owner tools are disabled (set OWNER_ACCESS_CODE)" }, { status: 403 });
  }
  if (await isOwnerRequest(req, cfg)) return null;
  if (token && typeof body.token === "string" && (await codesMatch(body.token, token))) return null;
  return NextResponse.json({ ok: false, detail: "Owner login required" }, { status: 401 });
}

export function ownerToolsEnabled(): boolean {
  return securityConfig().ownerLogin.enabled || Boolean(process.env.AI_CONNECTION_TEST_TOKEN);
}
