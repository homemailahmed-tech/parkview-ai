import { describe, expect, it, vi } from "vitest";
import { MetaAIProvider, parseJsonObject } from "@/lib/ai/metaProvider";
import { checkModelEligibility } from "@/lib/ai/eligibility";
import { resolveAIConfig, type LiveAIConfig } from "@/lib/ai/config";
import { CallBudget } from "@/lib/ai/budget";
import { SimulationProvider } from "@/lib/ai/simulationProvider";
import {
  connectionTest,
  containsFigures,
  draftQuoteIntro,
  explainOptions,
  interpretConcierge,
  interpretEnquiry,
  selectProvider,
  type ProviderSelection,
} from "@/lib/ai/service";

const ctx = { today: "2026-10-27", propertyName: "Parkside Demo Guest House" };
const draftInput = {
  guestName: "Thandi",
  checkIn: "2026-12-10",
  checkOut: "2026-12-12",
  optionTitle: "Option A · Most efficient",
  roomNames: ["Room 8"],
  notes: [],
  propertyName: "Parkside Demo Guest House",
};
const noSleep = async () => {};

type Call = { url: string; init: RequestInit; body: Record<string, unknown> };

/** Scripted fetch: each entry is a Response factory or an Error to throw. */
function scriptedFetch(script: (() => Response | Promise<Response>)[] | (() => Response | Promise<Response>)) {
  const calls: Call[] = [];
  let i = 0;
  const f = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init, body: JSON.parse(String(init.body)) });
    const step = Array.isArray(script) ? script[Math.min(i++, script.length - 1)] : script;
    return step();
  });
  return { fetchImpl: f as unknown as typeof fetch, calls };
}

const ok = (content: string, extra: Record<string, unknown> = {}) => () =>
  new Response(JSON.stringify({ id: "resp_123", model: "muse-spark-1.3", choices: [{ message: { content } }], ...extra }), { status: 200 });
const status = (code: number, text = "error") => () => new Response(text, { status: code });

const liveCfg = (over: Partial<LiveAIConfig> = {}): LiveAIConfig => ({
  provider: "meta-model-api",
  label: "Meta Model API",
  hostLabel: "Meta",
  baseUrl: "https://api.meta.ai/v1",
  apiKey: "test-key-not-real",
  model: "muse-spark-1.3",
  jsonMode: "auto",
  timeoutMs: 5_000,
  maxRetries: 1,
  maxOutputTokens: 800,
  ...over,
});

function selection(fetchImpl: typeof fetch, over: Partial<LiveAIConfig> = {}, budget = new CallBudget(1000)): ProviderSelection {
  const simulation = new SimulationProvider();
  return {
    primary: new MetaAIProvider(liveCfg(over), { fetchImpl, sleep: noSleep }),
    simulation,
    config: { mode: "meta-model-api", issues: [], warnings: [] },
    budget,
  };
}

// ---------------------------------------------------------------------------

describe("model eligibility (not restricted to Llama)", () => {
  it("accepts Meta Model API models such as Muse Spark", () => {
    expect(checkModelEligibility("meta-model-api", "muse-spark-1.3").eligible).toBe(true);
    expect(checkModelEligibility("meta-model-api", "muse-spark-1.1").eligible).toBe(true);
  });

  it("accepts Meta open-weight models on approved hosts", () => {
    expect(checkModelEligibility("open-weight", "accounts/fireworks/models/muse-spark-open").eligible).toBe(true);
    expect(checkModelEligibility("open-weight", "meta-models/Muse-Spark-Open-816B-A42B").eligible).toBe(true);
    expect(checkModelEligibility("open-weight", "Llama-4-Maverick-17B-128E-Instruct-FP8").eligible).toBe(true);
  });

  it("always rejects non-Meta models, even if allow-listed", () => {
    for (const m of ["claude-sonnet-4", "gpt-4o", "gemini-2.5-pro", "mistral-large", "qwen3-235b", "deepseek-v3"]) {
      expect(checkModelEligibility("open-weight", m, [m]).eligible).toBe(false);
      expect(checkModelEligibility("meta-model-api", m).eligible).toBe(false);
    }
  });

  it("lets the owner allow-list a host-specific Meta deployment name", () => {
    expect(checkModelEligibility("open-weight", "my-baseten-deployment").eligible).toBe(false);
    expect(checkModelEligibility("open-weight", "my-baseten-deployment", ["my-baseten-deployment"]).eligible).toBe(true);
  });
});

describe("configuration", () => {
  it("defaults to simulation with no issues", () => {
    const c = resolveAIConfig({});
    expect(c.mode).toBe("simulation");
    expect(c.issues).toEqual([]);
  });

  it("uses documented Meta Model API defaults (api.meta.ai/v1, muse-spark-1.3)", () => {
    const c = resolveAIConfig({ AI_MODE: "meta-model-api", META_MODEL_API_KEY: "k" });
    expect(c.mode).toBe("meta-model-api");
    expect(c.live?.baseUrl).toBe("https://api.meta.ai/v1");
    expect(c.live?.model).toBe("muse-spark-1.3");
    expect(c.live?.jsonMode).toBe("auto");
  });

  it("stays in simulation and explains why when the key is missing", () => {
    const c = resolveAIConfig({ AI_MODE: "meta-model-api" });
    expect(c.mode).toBe("simulation");
    expect(c.issues).toContain("META_MODEL_API_KEY is not set");
    const sel = selectProvider({ AI_MODE: "meta-model-api" });
    expect(sel.primary.info.kind).toBe("simulation");
    expect(sel.configIssue).toMatch(/META_MODEL_API_KEY/);
  });

  it("configures an open-weight host", () => {
    const c = resolveAIConfig({
      AI_MODE: "open-weight",
      OPEN_WEIGHT_BASE_URL: "https://api.fireworks.ai/inference/v1",
      OPEN_WEIGHT_API_KEY: "k",
      OPEN_WEIGHT_MODEL: "accounts/fireworks/models/muse-spark-open",
      OPEN_WEIGHT_HOST_LABEL: "Fireworks",
    });
    expect(c.mode).toBe("open-weight");
    expect(c.live?.label).toBe("Meta open-weight via Fireworks");
  });

  it("still accepts the Mission 1 META_LLAMA_* variables, with a deprecation warning", () => {
    const c = resolveAIConfig({ AI_MODE: "meta", META_LLAMA_BASE_URL: "https://x.example/v1", META_LLAMA_API_KEY: "k", META_LLAMA_MODEL: "llama-test" });
    expect(c.mode).toBe("open-weight");
    expect(c.warnings.join()).toMatch(/deprecated/);
  });

  it("rejects non-https URLs, unknown modes and ineligible models", () => {
    expect(resolveAIConfig({ AI_MODE: "open-weight", OPEN_WEIGHT_BASE_URL: "http://evil.example", OPEN_WEIGHT_API_KEY: "k", OPEN_WEIGHT_MODEL: "llama" }).issues.join()).toMatch(/https/);
    expect(resolveAIConfig({ AI_MODE: "turbo" }).issues.join()).toMatch(/Unknown AI_MODE/);
    expect(resolveAIConfig({ AI_MODE: "meta-model-api", META_MODEL_API_KEY: "k", META_MODEL_API_MODEL: "claude-x" }).mode).toBe("simulation");
  });

  it("warns about contributor (training-data) model variants and non-Meta base URLs", () => {
    const c = resolveAIConfig({ AI_MODE: "meta-model-api", META_MODEL_API_KEY: "k", META_MODEL_API_MODEL: "muse-spark-1.3-contributor", META_MODEL_API_BASE_URL: "https://proxy.example/v1" });
    expect(c.warnings.join()).toMatch(/training/);
    expect(c.warnings.join()).toMatch(/not Meta's api\.meta\.ai/);
  });

  it("clamps tuning values", () => {
    const c = resolveAIConfig({ AI_MODE: "meta-model-api", META_MODEL_API_KEY: "k", AI_TIMEOUT_MS: "5", AI_MAX_RETRIES: "99", AI_JSON_MODE: "weird" });
    expect(c.live?.timeoutMs).toBe(2000);
    expect(c.live?.maxRetries).toBe(3);
    expect(c.live?.jsonMode).toBe("auto");
  });
});

describe("live provider with mocked responses", () => {
  it("sends a Chat Completions request to the Meta Model API", async () => {
    const { fetchImpl, calls } = scriptedFetch(ok('{"checkIn":"2026-12-12","checkOut":"2026-12-14","adults":4}'));
    const r = await interpretEnquiry(selection(fetchImpl), "4 adults 12-14 Dec", ctx);
    expect(calls[0].url).toBe("https://api.meta.ai/v1/chat/completions");
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer test-key-not-real");
    expect(calls[0].body.model).toBe("muse-spark-1.3");
    expect(calls[0].body.response_format).toEqual({ type: "json_object" });
    expect(r.source).toBe("meta");
    expect(r.provider).toBe("meta-model-api");
    expect(r.call?.responseId).toBe("resp_123");
    expect(r.data.check.value.adults).toBe(4);
    expect(r.data.units.length).toBeGreaterThan(0);
  });

  it("works against an open-weight host", async () => {
    const { fetchImpl, calls } = scriptedFetch(ok('{"categories":["beaches"],"withChildren":true}'));
    const r = await interpretConcierge(
      selection(fetchImpl, { provider: "open-weight", label: "Meta open-weight via Fireworks", baseUrl: "https://api.fireworks.ai/inference/v1/", model: "accounts/fireworks/models/muse-spark-open" }),
      { question: "beach with kids", categories: ["beaches", "family"] },
    );
    expect(calls[0].url).toBe("https://api.fireworks.ai/inference/v1/chat/completions");
    expect(r.provider).toBe("open-weight");
    expect(r.data.categories).toEqual(["beaches"]);
  });

  it("still validates model output deterministically", async () => {
    const { fetchImpl } = scriptedFetch(ok('Sure! ```json\n{"checkIn":"2026-12-12","nights":2,"adults":"lots"}\n```'));
    const r = await interpretEnquiry(selection(fetchImpl), "text", ctx);
    expect(r.source).toBe("meta");
    expect(r.data.check.value.checkOut).toBe("2026-12-14");
    expect(r.data.check.missing).toContain("number of adults");
    expect(r.data.units).toEqual([]);
  });

  it("labels simulation output as simulation, never as Meta", async () => {
    const sel = selectProvider({});
    const r = await explainOptions(sel, { guestName: "x", options: [], comparison: "c", roomNames: {} });
    expect(r.source).toBe("simulation");
    expect(r.provider).toBe("simulation");
    expect(r.call).toBeUndefined();
  });
});

describe("failures fall back to clearly labelled simulation", () => {
  it("invalid credentials (401): no retry, labelled fallback, key not leaked", async () => {
    const { fetchImpl, calls } = scriptedFetch(status(401, "invalid api key test-key-not-real"));
    const r = await interpretEnquiry(selection(fetchImpl), "2 adults 12-14 December", ctx);
    expect(calls).toHaveLength(1);
    expect(r.source).toBe("simulation");
    expect(r.fallbackReason).toMatch(/credentials rejected \(HTTP 401\)/);
    expect(r.fallbackReason).not.toContain("test-key-not-real");
    expect(r.data.check.value.adults).toBe(2); // simulation still answered
  });

  it("timeout: aborts, retries once, then falls back", async () => {
    const hang = () =>
      new Promise<Response>((_, reject) => {
        // Never resolves on its own; rejects when the client aborts.
        setTimeout(() => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), 200);
      });
    const { fetchImpl, calls } = scriptedFetch(hang);
    const r = await draftQuoteIntro(selection(fetchImpl, { timeoutMs: 20 }), draftInput);
    expect(calls).toHaveLength(2);
    expect(r.source).toBe("simulation");
    expect(r.fallbackReason).toMatch(/no response within/);
  });

  it("service unavailable (503) twice: falls back after the retry", async () => {
    const { fetchImpl, calls } = scriptedFetch(status(503));
    const r = await explainOptions(selection(fetchImpl), { guestName: "x", options: [], comparison: "c", roomNames: {} });
    expect(calls).toHaveLength(2);
    expect(r.fallbackReason).toMatch(/service unavailable \(HTTP 503\)/);
  });

  it("network failure (DNS/offline): falls back", async () => {
    const { fetchImpl } = scriptedFetch(() => {
      throw new TypeError("fetch failed");
    });
    const r = await explainOptions(selection(fetchImpl, { maxRetries: 0 }), { guestName: "x", options: [], comparison: "c", roomNames: {} });
    expect(r.fallbackReason).toMatch(/could not reach the service/);
  });

  it("rate limited (429) then success: recovers on retry", async () => {
    const { fetchImpl, calls } = scriptedFetch([status(429), ok("Welcome, we look forward to hosting you.")]);
    const r = await draftQuoteIntro(selection(fetchImpl), draftInput);
    expect(calls).toHaveLength(2);
    expect(r.source).toBe("meta");
    expect(r.call?.attempts).toBe(2);
  });

  it("auto JSON mode: retries once without response_format on HTTP 400", async () => {
    const { fetchImpl, calls } = scriptedFetch([status(400, "unknown parameter response_format"), ok('{"adults":2,"checkIn":"2026-12-12","checkOut":"2026-12-13"}')]);
    const r = await interpretEnquiry(selection(fetchImpl), "2 adults", ctx);
    expect(calls[0].body.response_format).toBeDefined();
    expect(calls[1].body.response_format).toBeUndefined();
    expect(calls[1].body.max_tokens).toBeUndefined();
    expect(r.source).toBe("meta");
  });

  it("prompt JSON mode never sends response_format", async () => {
    const { fetchImpl, calls } = scriptedFetch(ok('{"adults":2}'));
    await interpretEnquiry(selection(fetchImpl, { jsonMode: "prompt" }), "2 adults", ctx);
    expect(calls[0].body.response_format).toBeUndefined();
  });

  it("malformed or empty model replies fall back", async () => {
    for (const reply of [ok("I cannot help with that"), ok("{not json}"), () => new Response(JSON.stringify({ choices: [] }), { status: 200 }), () => new Response("<html>", { status: 200 })]) {
      const { fetchImpl } = scriptedFetch(reply);
      const r = await interpretEnquiry(selection(fetchImpl), "2 adults 12-14 December", ctx);
      expect(r.source).toBe("simulation");
      expect(r.fallbackReason).toBeTruthy();
    }
  });

  it("replaces AI wording that contains figures", async () => {
    const { fetchImpl } = scriptedFetch(ok("Your stay costs R2400, a bargain!"));
    const r = await draftQuoteIntro(selection(fetchImpl), draftInput);
    expect(r.source).toBe("simulation");
    expect(r.fallbackReason).toMatch(/figures/);
    expect(containsFigures(r.data)).toBe(false);
  });

  it("stops live calls once the daily budget is spent", async () => {
    const { fetchImpl, calls } = scriptedFetch(ok("Hello and welcome."));
    const sel = selection(fetchImpl, {}, new CallBudget(1));
    expect((await draftQuoteIntro(sel, draftInput)).source).toBe("meta");
    const second = await draftQuoteIntro(sel, draftInput);
    expect(second.source).toBe("simulation");
    expect(second.fallbackReason).toMatch(/AI_DAILY_CALL_LIMIT/);
    expect(calls).toHaveLength(1);
  });

  it("budget resets each UTC day", () => {
    let now = new Date("2026-10-27T10:00:00Z");
    const b = new CallBudget(1, () => now);
    expect(b.take()).toBe(true);
    expect(b.take()).toBe(false);
    now = new Date("2026-10-28T00:00:01Z");
    expect(b.take()).toBe(true);
  });
});

describe("connection test", () => {
  it("reports success with latency for a live provider", async () => {
    const { fetchImpl } = scriptedFetch(ok("Hello from Meta."));
    const r = await connectionTest(selection(fetchImpl));
    expect(r.ok).toBe(true);
    expect(r.model).toBe("muse-spark-1.3");
  });

  it("reports invalid credentials clearly", async () => {
    const { fetchImpl } = scriptedFetch(status(401));
    const r = await connectionTest(selection(fetchImpl));
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/401/);
  });

  it("explains that simulation mode has nothing to test", async () => {
    const r = await connectionTest(selectProvider({}));
    expect(r.ok).toBe(false);
    expect(r.provider).toBe("simulation");
  });
});

describe("parseJsonObject", () => {
  it("rejects non-JSON", () => {
    expect(() => parseJsonObject("no json here")).toThrow();
    expect(parseJsonObject('noise {"a":1} noise')).toEqual({ a: 1 });
  });
});
