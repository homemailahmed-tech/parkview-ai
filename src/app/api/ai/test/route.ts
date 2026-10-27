import { NextResponse } from "next/server";
import { connectionTest, selectProvider } from "@/lib/ai/service";
import { requireOwner } from "@/lib/security/ownerTools";

export const dynamic = "force-dynamic";

/** Owner-only live connection test: makes ONE small model call. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { token?: unknown };
  const refused = await requireOwner(req, body);
  if (refused) return refused;
  return NextResponse.json(await connectionTest(selectProvider()));
}
