import { NextResponse } from "next/server";
import { selectProvider, transcribeSpeech } from "@/lib/ai/service";
import { inspectWav, MAX_SECONDS } from "@/lib/voice/wav";

const MAX_BYTES = 2 * 1024 * 1024; // about 60 s of 16 kHz mono 16-bit audio
// Only "english" is a documented languageBias value (Meta cookbook); otherwise the model auto-detects.
const LANGS = new Set(["english", "auto"]);

/** POST audio/wav (mono, 16-bit, 16/24 kHz, ≤ 60 s). Optional ?lang=english. Returns the transcript for review. */
export async function POST(req: Request) {
  const len = Number(req.headers.get("content-length") ?? "0");
  if (len > MAX_BYTES) return NextResponse.json({ error: "Recording too large (max about 60 seconds)" }, { status: 413 });
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.length === 0) return NextResponse.json({ error: "No audio received" }, { status: 400 });
  if (bytes.length > MAX_BYTES) return NextResponse.json({ error: "Recording too large (max about 60 seconds)" }, { status: 413 });
  const info = inspectWav(bytes);
  if ("error" in info) return NextResponse.json({ error: `Unsupported audio: ${info.error}` }, { status: 415 });
  if (info.durationMs > MAX_SECONDS * 1000) return NextResponse.json({ error: `Recording longer than ${MAX_SECONDS} seconds` }, { status: 400 });
  if (info.durationMs < 300) return NextResponse.json({ error: "Recording too short" }, { status: 400 });
  const lang = (new URL(req.url).searchParams.get("lang") ?? "auto").toLowerCase();
  const languageBias = LANGS.has(lang) && lang !== "auto" ? [lang] : undefined;
  const result = await transcribeSpeech(selectProvider(), bytes, { languageBias, keywords: ["Parkside"] });
  return NextResponse.json(result, { status: result.ok ? 200 : 503 });
}
