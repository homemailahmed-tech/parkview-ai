import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { endpointTrust } from "@/lib/ai/endpoint";
import { selectProvider, interpretEnquiry, draftClarification, transcribeSpeech } from "@/lib/ai/service";
import { reserve, settle, spentUSD, chatWorstUSD, PRICES } from "@/lib/ai/spendLedger";
import { encodeWav16 } from "@/lib/voice/wav";
import { SourceTag } from "@/components/ui";

/*
 * Labelling rules (owner requirement, 1 Nov 2026):
 *  - "✓ Live Meta AI" ONLY for a successful response from Meta's own endpoint (https://api.meta.ai).
 *  - A local or non-Meta endpoint — e.g. a mock imitating Meta — is "LOCAL TEST — MOCK RESPONSE".
 *  - A failed live call falls back to "SIMULATION" with the reason; voice shows no transcript.
 * And the spend ledger: hard caps checked before every request.
 */

const ctx = { today: "2026-11-01", propertyName: "Parkside Demo Guest House" };
const KEY = "label-test-key-not-real-777";
const chatOK = (content: string) => vi.fn(async () => new Response(JSON.stringify({ id: "chatcmpl-x", model: "muse-spark-1.3", choices: [{ message: { content }, finish_reason: "stop" }], usage: { prompt_tokens: 200, completion_tokens: 300 } }), { status: 200 })) as unknown as typeof fetch;
const env = (base?: string, extra: Record<string, string> = {}) => ({ AI_MODE: "meta-model-api", META_MODEL_API_KEY: KEY, AI_MAX_RETRIES: "0", AI_JSON_MODE: "prompt", ...(base ? { META_MODEL_API_BASE_URL: base } : {}), ...extra }) as never;
const tag = (source: "simulation" | "meta" | "dev-model" | "test" | "manual") => renderToStaticMarkup(createElement(SourceTag, { source, label: "Meta Model API", model: "muse-spark-1.3" }));

afterEach(() => vi.unstubAllEnvs());

describe("endpoint trust", () => {
  it("only Meta's own https host is official; local, private, http and unparsable endpoints are local", () => {
    expect(endpointTrust("https://api.meta.ai/v1")).toBe("meta-official");
    expect(endpointTrust("https://api.groq.com/openai/v1")).toBe("third-party");
    for (const u of ["http://127.0.0.1:8899/v1", "https://localhost/v1", "https://192.168.1.5/v1", "https://10.0.0.2", "https://172.20.0.1", "http://api.meta.ai/v1", "not a url"]) expect(endpointTrust(u), u).toBe("local");
  });
});

describe("source labels: mock vs simulation vs failure vs live", () => {
  it("LIVE: a response from https://api.meta.ai is 'meta'", async () => {
    const r = await interpretEnquiry(selectProvider(env(), { fetchImpl: chatOK('{"adults":2}') }), "2 adults", ctx);
    expect(r.source).toBe("meta");
  });

  it("MOCK: the same reply from a local endpoint is 'test', never 'meta'", async () => {
    const sel = selectProvider(env("http://127.0.0.1:8899/v1"), { fetchImpl: chatOK('{"adults":2}') });
    expect(sel.primary.info.kind).toBe("test");
    expect(sel.primary.info.label).toMatch(/LOCAL TEST endpoint \(127\.0\.0\.1:8899\)/);
    const r = await interpretEnquiry(sel, "2 adults", ctx);
    expect(r.source).toBe("test");
    const c = await draftClarification(sel, { guestName: "A", propertyName: "P", questions: ["Which date?"], guestMessage: "hi" });
    expect(c.source).toBe("test");
  });

  it("MOCK: a non-Meta https host configured as the Meta Model API is also 'test'", () => {
    expect(selectProvider(env("https://imitation-api.example.com/v1")).primary.info.kind).toBe("test");
  });

  it("FAILED: a failed live call falls back to labelled SIMULATION with the reason", async () => {
    const down = vi.fn(async () => new Response("unavailable", { status: 503 })) as unknown as typeof fetch;
    const r = await interpretEnquiry(selectProvider(env(), { fetchImpl: down }), "2 adults 12-14 December", ctx);
    expect(r.source).toBe("simulation");
    expect(r.fallbackReason).toMatch(/failed .*503/);
  });

  it("SIMULATION: no live mode configured is 'simulation'", async () => {
    expect((await interpretEnquiry(selectProvider({}), "2 adults", ctx)).source).toBe("simulation");
  });

  it("VOICE: Meta endpoint -> 'meta'; local mock -> 'test'; failure or no live mode -> 'none' with no transcript", async () => {
    const wav = encodeWav16(new Float32Array(16000), 16000);
    const ok = vi.fn(async () => new Response(JSON.stringify({ transcript: "two adults" }), { status: 200 })) as unknown as typeof fetch;
    expect((await transcribeSpeech(selectProvider(env()), wav, {}, ok)).source).toBe("meta");
    const mock = await transcribeSpeech(selectProvider(env("http://127.0.0.1:8899/v1")), wav, {}, ok);
    expect(mock.source).toBe("test");
    const fail = await transcribeSpeech(selectProvider(env()), wav, {}, vi.fn(async () => new Response("x", { status: 500 })) as unknown as typeof fetch);
    expect(fail).toMatchObject({ ok: false, source: "none" });
    expect(fail.transcript).toBeUndefined();
    expect((await transcribeSpeech(selectProvider({}), wav, {}, ok)).source).toBe("none");
  });

  it("UI: only 'meta' renders 'Live Meta AI'; 'test' renders the LOCAL TEST — MOCK RESPONSE badge", () => {
    expect(tag("meta")).toMatch(/✓ Live Meta AI/);
    for (const s of ["test", "simulation", "dev-model", "manual"] as const) expect(tag(s), s).not.toMatch(/Live Meta AI/);
    expect(tag("test")).toMatch(/LOCAL TEST — MOCK RESPONSE · not Meta AI/);
    expect(tag("simulation")).toMatch(/SIMULATION · not Meta AI/);
  });

  it("status route reports a local endpoint as kind 'test'", async () => {
    vi.stubEnv("AI_MODE", "meta-model-api");
    vi.stubEnv("META_MODEL_API_KEY", KEY);
    vi.stubEnv("META_MODEL_API_BASE_URL", "http://127.0.0.1:8899/v1");
    vi.resetModules();
    const { GET } = await import("@/app/api/ai/status/route");
    const body = await (await GET()).json();
    expect(body.ai.kind).toBe("test");
    expect(JSON.stringify(body)).not.toContain(KEY);
  });
});

describe("spend ledger: hard caps before every request", () => {
  const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ledger-")), "ledger.json");

  it("refuses the call that would exceed the call limit, before any HTTP request", async () => {
    const file = tmp();
    const f = chatOK('{"adults":2}');
    const sel = selectProvider(env(undefined, { AI_SPEND_LEDGER: file, AI_SPEND_MAX_CALLS: "2", AI_SPEND_MAX_USD: "1" }), { fetchImpl: f });
    expect((await interpretEnquiry(sel, "2 adults", ctx)).source).toBe("meta");
    expect((await interpretEnquiry(sel, "2 adults", ctx)).source).toBe("meta");
    const third = await interpretEnquiry(sel, "2 adults", ctx);
    expect(third.source).toBe("simulation");
    expect(third.fallbackReason).toMatch(/local spend cap reached: 2 calls/);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("enforces per-kind limits (owner: at most 6 Muse Spark and 2 voice calls)", () => {
    const cfg = { file: tmp(), maxCalls: 8, maxUSD: 1, maxByKind: { chat: 6, voice: 2 } };
    reserve(cfg, "voice", 0.0001); reserve(cfg, "voice", 0.0001);
    expect(() => reserve(cfg, "voice", 0.0001)).toThrow(/2 voice calls used/);
    for (let i = 0; i < 6; i++) reserve(cfg, "chat", 0.001);
    expect(() => reserve(cfg, "chat", 0.001)).toThrow(/8 calls used|6 chat calls used/);
    const env2 = selectProvider(env(undefined, { AI_SPEND_LEDGER: tmp(), AI_SPEND_MAX_CALLS: "8", AI_SPEND_MAX_USD: "0.04", AI_SPEND_MAX_CHAT: "6", AI_SPEND_MAX_VOICE: "2" }));
    expect(env2.config.live?.spend?.maxByKind).toEqual({ chat: 6, voice: 2 });
  });

  it("refuses a call whose worst case would exceed the money cap", () => {
    const file = tmp();
    const cfg = { file, maxCalls: 8, maxUSD: 0.01 };
    reserve(cfg, "chat", 0.006);
    expect(() => reserve(cfg, "chat", 0.006)).toThrow(/US\$0\.01 would be exceeded/);
  });

  it("persists across restarts and settles to the actual cost", () => {
    const file = tmp();
    const cfg = { file, maxCalls: 3, maxUSD: 0.04 };
    const e = reserve(cfg, "chat", 0.006);
    settle(cfg, e.n, { status: 200, costUSD: 0.0022 });
    const reloaded = JSON.parse(fs.readFileSync(file, "utf8"));
    expect(spentUSD(reloaded)).toBeCloseTo(0.0022, 6);
    reserve(cfg, "voice", 0.001);
    reserve(cfg, "chat", 0.001);
    expect(() => reserve(cfg, "chat", 0.0001)).toThrow(/3 calls used/);
  });

  it("voice uploads are metered too and refused at the cap with no request", async () => {
    const file = tmp();
    const ok = vi.fn(async () => new Response(JSON.stringify({ transcript: "x", audioDurationMs: 1000 }), { status: 200 })) as unknown as typeof fetch;
    const sel = selectProvider(env(undefined, { AI_SPEND_LEDGER: file, AI_SPEND_MAX_CALLS: "1", AI_SPEND_MAX_USD: "1" }));
    const wav = encodeWav16(new Float32Array(16000), 16000);
    expect((await transcribeSpeech(sel, wav, {}, ok)).ok).toBe(true);
    const second = await transcribeSpeech(sel, wav, {}, ok);
    expect(second.ok).toBe(false);
    expect(second.reason).toMatch(/spend cap/);
    expect(ok).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fs.readFileSync(file, "utf8")).calls[0].costUSD).toBeCloseTo(1000 * PRICES.audioPerMs, 9);
  });

  it("Stage 4 (8 calls, US$0.04, max_tokens 1200) and Stage 5 (8 calls, US$0.045, max_tokens 900) caps hold even at worst case", () => {
    const stage4 = { file: tmp(), maxCalls: 8, maxUSD: 0.04 };
    const chat4 = chatWorstUSD(3000, 1200); // generous prompt size
    let n = 0;
    try { for (;;) { reserve(stage4, n % 4 === 0 ? "voice" : "chat", n % 4 === 0 ? 10_000 * PRICES.audioPerMs : chat4); n++; } } catch (e) { expect(String(e)).toMatch(/spend cap/); }
    expect(spentUSD(JSON.parse(fs.readFileSync(stage4.file, "utf8")))).toBeLessThanOrEqual(0.04);
    expect(n).toBeLessThanOrEqual(8);
    const stage5 = { file: tmp(), maxCalls: 8, maxUSD: 0.045 };
    let m = 0;
    try { for (;;) { reserve(stage5, "chat", chatWorstUSD(3000, 900)); m++; } } catch { /* cap */ }
    expect(m).toBeLessThanOrEqual(8);
    expect(spentUSD(JSON.parse(fs.readFileSync(stage5.file, "utf8")))).toBeLessThanOrEqual(0.045);
  });
});
