import { NextResponse } from "next/server";
import { isOwnerRequest, securityConfig } from "@/lib/security/session";

export const dynamic = "force-dynamic";

/** Tells the browser whether owner controls may be shown. Never reveals codes. */
export async function GET(req: Request) {
  const cfg = securityConfig();
  return NextResponse.json({
    owner: await isOwnerRequest(req, cfg),
    ownerLoginEnabled: cfg.ownerLogin.enabled,
    publicOwnerMode: cfg.publicOwnerMode,
  });
}
