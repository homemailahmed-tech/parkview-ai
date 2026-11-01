import { afterEach, describe, expect, it, vi } from "vitest";
import { downsample, encodeWav16, inspectWav } from "@/lib/voice/wav";
import { transcribeWav, VOICE_MODEL } from "@/lib/ai/voice";
import { selectProvider, transcribeSpeech } from "@/lib/ai/service";
import { CallBudget } from "@/lib/ai/budget";

const KEY = "voice-test-key-not-real-12345";
const tone = (secs: number, rate = 16000) => Float32Array.from({ length: Math.round(secs * rate) }, (_, i) => 0.3 * Math.sin((2 * Math.PI * 440 * i) / rate));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("WAV encoding for Muse Voice Transcribe (mono 16-bit, 16 kHz)", () => {
  it("encodes a valid mono 16-bit WAV that inspectWav accepts", () => {
    const wav = encodeWav16(tone(1.5), 16000);
    const info = inspectWav(wav);
    expect("error" in info).toBe(false);
    if (!("error" in info)) {
      expect(info).toMatchObject({ channels: 1, sampleRate: 16000, bitsPerSample: 16 });
      expect(info.durationMs).toBe(1500);
    }
  });

  it("downsamples a 48 kHz recording to 16 kHz without changing its duration", () => {
    const out = downsample(tone(2, 48000), 48000, 16000);
    expect(out.length).toBe(32000);
    expect(Math.max(...out)).toBeLessThanOrEqual(0.31);
  });

  it("clips out-of-range samples instead of wrapping", () => {
    const wav = encodeWav16(Float32Array.from([2, -2]), 16000);
    const v = new DataView(wav.buffer);
    expect(v.getInt16(44, true)).toBe(32767);
    expect(v.getInt16(46, true)).toBe(-32768);
  });

  it("rejects what the endpoint would not accept: not WAV, stereo, 8-bit, 44.1 kHz", () => {
    expect(inspectWav(new TextEncoder().encode("hello world, definitely not a wav file at all......"))).toEqual({ error: "not a WAV file" });
    const stereo = encodeWav16(tone(0.5), 16000); new DataView(stereo.buffer).setUint16(22, 2, true);
    expect(inspectWav(stereo)).toEqual({ error: "audio must be mono" });
    const eightBit = encodeWav16(tone(0.5), 16000); new DataView(eightBit.buffer).setUint16(34, 8, true);
    expect(inspectWav(eightBit)).toEqual({ error: "audio must be 16-bit" });
    expect(inspectWav(encodeWav16(tone(0.5, 44100), 44100))).toEqual({ error: "audio must be 16 kHz or 24 kHz" });
  });
});

describe("Muse Voice Transcribe client (mocked HTTP — the request contract from Meta's cookbook)", () => {
  function capture(response: () => Response) {
    const calls: { url: string; init: RequestInit }[] = [];
    const f = vi.fn(async (url: string, init: RequestInit) => { calls.push({ url, init }); return response(); }) as unknown as typeof fetch;
    return { f, calls };
  }

  it("POSTs multipart {request JSON, audio WAV} to /asr/transcribe with a Bearer key", async () => {
    const { f, calls } = capture(() => new Response(JSON.stringify({ sessionId: "s-1", transcript: " Sawubona, 12 netball girls ", audioDurationMs: 4200 }), { status: 200 }));
    const t = await transcribeWav({ baseUrl: "https://api.meta.ai/v1/", apiKey: KEY }, encodeWav16(tone(1), 16000), { languageBias: ["english"], keywords: ["Parkside"] }, f);
    expect(calls[0].url).toBe("https://api.meta.ai/v1/asr/transcribe");
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
    const form = calls[0].init.body as FormData;
    const req = JSON.parse(await (form.get("request") as Blob).text());
    expect(req).toEqual({ mode: "PUSH_TO_TALK", model: VOICE_MODEL, audioEncoding: "WAV", languageBias: ["english"], keywords: ["Parkside"] });
    const audio = form.get("audio") as Blob;
    expect(audio.type).toBe("audio/wav");
    expect("error" in inspectWav(new Uint8Array(await audio.arrayBuffer()))).toBe(false);
    expect(t).toMatchObject({ transcript: "Sawubona, 12 netball girls", audioDurationMs: 4200, sessionId: "s-1" });
  });

  it("maps 401 to a credential error without echoing the key, and rejects a body without a transcript", async () => {
    const bad = capture(() => new Response(`invalid key ${KEY}`, { status: 401 }));
    await expect(transcribeWav({ baseUrl: "https://api.meta.ai/v1", apiKey: KEY }, encodeWav16(tone(1), 16000), {}, bad.f)).rejects.toThrow(/credentials rejected/);
    await transcribeWav({ baseUrl: "https://api.meta.ai/v1", apiKey: KEY }, encodeWav16(tone(1), 16000), {}, bad.f).catch((e) => expect(String(e.message)).not.toContain(KEY));
    const empty = capture(() => new Response(JSON.stringify({ sessionId: "x" }), { status: 200 }));
    await expect(transcribeWav({ baseUrl: "https://api.meta.ai/v1", apiKey: KEY }, encodeWav16(tone(1), 16000), {}, empty.f)).rejects.toThrow(/no transcript/);
  });

  it("is never simulated: without live Meta mode it refuses and makes no request", async () => {
    const { f, calls } = capture(() => new Response("{}"));
    const r = await transcribeSpeech(selectProvider({}), encodeWav16(tone(1), 16000), {}, f);
    expect(r).toMatchObject({ ok: false, source: "none" });
    expect(r.reason).toMatch(/live Meta mode/);
    expect(calls).toHaveLength(0);
  });

  it("is only offered on the Meta Model API route, counts against the live-call budget, and labels live results", async () => {
    const ok = capture(() => new Response(JSON.stringify({ transcript: "two adults" }), { status: 200 }));
    const sel = { ...selectProvider({ AI_MODE: "meta-model-api", META_MODEL_API_KEY: KEY } as never), budget: new CallBudget(1) };
    const first = await transcribeSpeech(sel, encodeWav16(tone(1), 16000), {}, ok.f);
    expect(first).toMatchObject({ ok: true, source: "meta", model: "muse-voice-transcribe-1.0", transcript: "two adults" });
    const second = await transcribeSpeech(sel, encodeWav16(tone(1), 16000), {}, ok.f);
    expect(second.ok).toBe(false);
    expect(second.reason).toMatch(/limit/);
    expect(ok.calls).toHaveLength(1);
    const groq = selectProvider({ AI_MODE: "groq", GROQ_API_KEY: KEY, GROQ_MODEL: "meta-llama/llama-4-scout" } as never);
    expect((await transcribeSpeech(groq, encodeWav16(tone(1), 16000), {}, ok.f)).ok).toBe(false);
  });
});

describe("/api/ai/transcribe route", () => {
  const post = async (body: BodyInit, url = "http://x/api/ai/transcribe") => {
    const { POST } = await import("@/app/api/ai/transcribe/route");
    return POST(new Request(url, { method: "POST", body, headers: { "Content-Type": "audio/wav" } }));
  };

  it("rejects empty, non-WAV, too-short and too-long audio before any model call", async () => {
    expect((await post(new Uint8Array(0))).status).toBe(400);
    expect((await post("not audio at all, just some text padding to 44 bytes......")).status).toBe(415);
    expect((await post(new Uint8Array(encodeWav16(tone(0.1), 16000)))).status).toBe(400);
    expect((await post(new Uint8Array(encodeWav16(tone(61), 16000)))).status).toBe(400);
  });

  it("answers 503 with a clear reason in simulation mode (no fake transcript)", async () => {
    const res = await post(new Uint8Array(encodeWav16(tone(1), 16000)));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.transcript).toBeUndefined();
  });
});

describe("browser permissions for voice", () => {
  it("allows the microphone for this site only; camera, location and payment stay blocked", async () => {
    const { readFileSync } = await import("node:fs");
    const cfg = readFileSync(new URL("../next.config.mjs", import.meta.url), "utf8");
    const m = /Permissions-Policy", value: "([^"]+)"/.exec(cfg);
    expect(m?.[1]).toBe("camera=(), microphone=(self), geolocation=(), payment=(), usb=()");
  });
});
