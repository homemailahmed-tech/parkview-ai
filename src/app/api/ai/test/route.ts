import { NextResponse } from "next/server";
import { connectionTest, selectProvider } from "@/lib/ai/service";

export const dynamic = "force-dynamic";

/**
 * Owner-only live connection test: makes ONE small (billable) model call.
 * Disabled unless AI_CONNECTION_TEST_TOKEN is set; the caller must send it.
 */
export async function POST(req: Request) {
  const expected = process.env.AI_CONNECTION_TEST_TOKEN;
  if (!expected) return NextResponse.json({ ok: false, detail: "Connection test is disabled (AI_CONNECTION_TEST_TOKEN not set)" }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as { token?: unknown };
  if (body.token !== expected) return NextResponse.json({ ok: false, detail: "Invalid test token" }, { status: 401 });
  return NextResponse.json(await connectionTest(selectProvider()));
}
