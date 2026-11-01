import type { LiveAIConfig } from "./config";
import { AIProviderError, errorFromStatus } from "./errors";

/**
 * Muse Voice Transcribe 1.0 — file endpoint, per Meta's model cookbook
 * (06_muse_voice/01_voice_api_fundamentals): POST {base}/asr/transcribe with a Bearer key and
 * a multipart body: a JSON part "request" ({mode, model, audioEncoding:"WAV", languageBias?,
 * keywords?}) and the WAV in part "audio". Response: {sessionId, transcript, audioDurationMs}.
 * Speech-to-text only — it does not speak.
 */
export const VOICE_MODEL = "muse-voice-transcribe-1.0";

export interface TranscribeOptions {
  /** e.g. ["english"]; omit to let the model detect the language. */
  languageBias?: string[];
  /** Words to bias recognition toward (names, place names). */
  keywords?: string[];
  timeoutMs?: number;
}

export interface Transcript {
  transcript: string;
  audioDurationMs?: number;
  sessionId?: string;
  latencyMs: number;
}

export async function transcribeWav(cfg: Pick<LiveAIConfig, "baseUrl" | "apiKey">, wav: Uint8Array, opts: TranscribeOptions = {}, fetchImpl: typeof fetch = fetch): Promise<Transcript> {
  const request: Record<string, unknown> = { mode: "PUSH_TO_TALK", model: VOICE_MODEL, audioEncoding: "WAV" };
  if (opts.languageBias?.length) request.languageBias = opts.languageBias;
  if (opts.keywords?.length) request.keywords = opts.keywords.slice(0, 20);
  const form = new FormData();
  form.append("request", new Blob([JSON.stringify(request)], { type: "application/json" }));
  form.append("audio", new Blob([new Uint8Array(wav)], { type: "audio/wav" }), "speech.wav");

  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 30_000);
  let res: Response;
  try {
    res = await fetchImpl(`${cfg.baseUrl.replace(/\/+$/, "")}/asr/transcribe`, { method: "POST", headers: { Authorization: `Bearer ${cfg.apiKey}` }, body: form, signal: controller.signal });
  } catch (e) {
    if (controller.signal.aborted) throw new AIProviderError("timeout", "no transcription within the time limit");
    throw new AIProviderError("unavailable", `could not reach the transcription service (${(e as Error).message})`);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw errorFromStatus(res.status, cfg.apiKey ? detail.split(cfg.apiKey).join("[redacted]") : detail);
  }
  const body = (await res.json().catch(() => null)) as { transcript?: unknown; audioDurationMs?: unknown; sessionId?: unknown } | null;
  if (!body || typeof body.transcript !== "string") throw new AIProviderError("bad_response", "transcription response had no transcript");
  return {
    transcript: body.transcript.trim().slice(0, 4000),
    audioDurationMs: typeof body.audioDurationMs === "number" ? body.audioDurationMs : undefined,
    sessionId: typeof body.sessionId === "string" ? body.sessionId : undefined,
    latencyMs: Date.now() - started,
  };
}
