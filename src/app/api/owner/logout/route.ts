import { NextResponse } from "next/server";
import { clearCookie } from "@/lib/security/session";
import { isSecureRequest } from "@/lib/security/http";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const res = NextResponse.json({ ok: true });
  res.headers.append("Set-Cookie", clearCookie("owner", isSecureRequest(req)));
  return res;
}
