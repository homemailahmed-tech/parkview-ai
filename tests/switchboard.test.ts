import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { resolveAIConfig, GROQ_DEFAULT_BASE_URL, OPENROUTER_DEFAULT_BASE_URL, type AIEnv } from "@/lib/ai/config";
import { classifyModel } from "@/lib/ai/eligibility";
import { fetchCatalog } from "@/lib/ai/catalog";
import { CallBudget } from "@/lib/ai/budget";
import { explainOptions, interpretEnquiry, selectProvider } from "@/lib/ai/service";

const ctx = { today: "2026-10-27", propertyName: "Parkside Demo Guest House" };
const KEY = "test-key-switchboard-0001";

function mockFetch(content: string, status = 200) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return status === 200
      ? new Response(JSON.stringify({ id: "r1", choices: [{ message: { content } }] }), { status })
      : new Response("nope", { status });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const run = (env: AIEnv, fetchImpl: typeof fetch) => selectProvider(env, { fetchImpl, sleep: async () => {}, budget: new CallBudget(100) });
const extraction = '{"checkIn":"2026-12-12","checkOut":"2026-12-14","adults":2}';

describe("model classification", () => {
  it("separates eligible Meta models from non-Meta development models", () => {
    expect(classifyModel("meta-model-api", "muse-spark-1.3").modelClass).toBe("meta-model-api");
    expect(classifyModel("groq", "meta-models/muse-spark-open").modelClass).toBe("meta-open-weight");
    expect(classifyModel("openrouter", "meta/muse-spark-open").modelClass).toBe("meta-open-weight");
    expect(classifyModel("openrouter", "meta-llama/llama-3.3-70b-instruct:free").modelClass).toBe("meta-open-weight");
    for (const m of ["openai/gpt-oss-120b", "qwen/qwen3.6-27b", "openrouter/free", "google/gemma-4-26b-a4b-it:free", "meta-llama/llama-guard-4-12b"]) {
      expect(classifyModel("openrouter", m).modelClass).toBe("non-meta-dev");
    }
  });

  it("flags hosted Muse Spark via a third-party router as needing confirmation", () => {
    expect(classifyModel("openrouter", "meta/muse-spark-1.3").note).toMatch(/confirm eligibility/);
  });
});

describe("switchboard configuration", () => {
  it("GroqCloud: documented base URL, key and model required, no default model", () => {
    const c = resolveAIConfig({ AI_MODE: "groq" });
    expect(c.mode).toBe("simulation");
    expect(c.issues).toContain("GROQ_API_KEY is not set");
    expect(c.issues.join()).toMatch(/GROQ_MODEL is not set/);
    expect(c.candidate?.baseUrl).toBe(GROQ_DEFAULT_BASE_URL);
    const ok = resolveAIConfig({ AI_MODE: "groq", GROQ_API_KEY: KEY, GROQ_MODEL: "meta-models/muse-spark-open" });
    expect(ok.mode).toBe("groq");
    expect(ok.live?.modelClass).toBe("meta-open-weight");
    expect(ok.live?.label).toBe("Meta open-weight via Groq");
  });

  it("OpenRouter: free-only by default so a paid model cannot start by accident", () => {
    const paid = resolveAIConfig({ AI_MODE: "openrouter", OPENROUTER_API_KEY: KEY, OPENROUTER_MODEL: "meta/muse-spark-open" });
    expect(paid.mode).toBe("simulation");
    expect(paid.issues.join()).toMatch(/not a ":free" variant/);
    const approved = resolveAIConfig({ AI_MODE: "openrouter", OPENROUTER_API_KEY: KEY, OPENROUTER_MODEL: "meta/muse-spark-open", OPENROUTER_FREE_ONLY: "false" });
    expect(approved.mode).toBe("openrouter");
    const free = resolveAIConfig({ AI_MODE: "openrouter", OPENROUTER_API_KEY: KEY, OPENROUTER_MODEL: "meta-llama/llama-3.3-70b-instruct:free" });
    expect(free.mode).toBe("openrouter");
    expect(free.live?.baseUrl).toBe(OPENROUTER_DEFAULT_BASE_URL);
    expect(free.warnings.join()).toMatch(/rate-limited/);
  });

  it("refuses non-Meta models unless a development stand-in is explicitly enabled", () => {
    const env = { AI_MODE: "groq", GROQ_API_KEY: KEY, GROQ_MODEL: "openai/gpt-oss-120b" };
    expect(resolveAIConfig(env).mode).toBe("simulation");
    const dev = resolveAIConfig({ ...env, AI_ALLOW_NON_META_DEV_MODEL: "true" });
    expect(dev.mode).toBe("groq");
    expect(dev.live?.modelClass).toBe("non-meta-dev");
    expect(dev.live?.label).toMatch(/non-Meta dev model/);
    expect(dev.warnings.join()).toMatch(/NOT a Meta model/);
  });

  it("never allows a dev stand-in on the Meta Model API", () => {
    expect(resolveAIConfig({ AI_MODE: "meta-model-api", META_MODEL_API_KEY: KEY, META_MODEL_API_MODEL: "gpt-4o", AI_ALLOW_NON_META_DEV_MODEL: "true" }).mode).toBe("simulation");
  });

  it("lists every mode in the unknown-mode message", () => {
    expect(resolveAIConfig({ AI_MODE: "bard" }).issues[0]).toMatch(/simulation, meta-model-api, groq, openrouter, open-weight/);
  });
});

describe("switchboard calls (mocked HTTP, no paid calls)", () => {
  it("Groq: correct endpoint, auth and labelled as Meta open-weight", async () => {
    const { fetchImpl, calls } = mockFetch(extraction);
    const r = await interpretEnquiry(run({ AI_MODE: "groq", GROQ_API_KEY: KEY, GROQ_MODEL: "meta-models/muse-spark-open" }, fetchImpl), "2 adults", ctx);
    expect(calls[0].url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.model).toBe("meta-models/muse-spark-open");
    for (const banned of ["logprobs", "logit_bias", "top_logprobs", "n"]) expect(body[banned]).toBeUndefined();
    expect(r.source).toBe("meta");
    expect(r.provider).toBe("groq");
    expect(r.modelClass).toBe("meta-open-weight");
  });

  it("OpenRouter: correct endpoint and optional attribution headers", async () => {
    const { fetchImpl, calls } = mockFetch(extraction);
    const env = { AI_MODE: "openrouter", OPENROUTER_API_KEY: KEY, OPENROUTER_MODEL: "meta-llama/llama-3.3-70b-instruct:free", OPENROUTER_APP_URL: "https://example.org", OPENROUTER_APP_TITLE: "Hospitality AI" };
    const r = await interpretEnquiry(run(env, fetchImpl), "2 adults", ctx);
    expect(calls[0].url).toBe("https://openrouter.ai/api/v1/chat/completions");
    const h = calls[0].init.headers as Record<string, string>;
    expect(h["HTTP-Referer"]).toBe("https://example.org");
    expect(h["X-OpenRouter-Title"]).toBe("Hospitality AI");
    expect(r.source).toBe("meta");
    expect(r.provider).toBe("openrouter");
  });

  it("a non-Meta dev model is labelled dev-model, never Meta", async () => {
    const { fetchImpl } = mockFetch("A neutral explanation.");
    const sel = run({ AI_MODE: "openrouter", OPENROUTER_API_KEY: KEY, OPENROUTER_MODEL: "google/gemma-4-26b-a4b-it:free", AI_ALLOW_NON_META_DEV_MODEL: "true" }, fetchImpl);
    const r = await explainOptions(sel, { guestName: "x", options: [], comparison: "c", roomNames: {} });
    expect(r.source).toBe("dev-model");
    expect(r.modelClass).toBe("non-meta-dev");
  });

  it("simulation is never labelled as Meta", async () => {
    const r = await interpretEnquiry(run({}, mockFetch("{}").fetchImpl), "2 adults 12-14 December", ctx);
    expect(r.source).toBe("simulation");
    expect(r.modelClass).toBeUndefined();
  });

  it("provider failure (e.g. Groq 401) falls back to labelled simulation", async () => {
    const { fetchImpl } = mockFetch("", 401);
    const r = await interpretEnquiry(run({ AI_MODE: "groq", GROQ_API_KEY: KEY, GROQ_MODEL: "meta-models/muse-spark-open" }, fetchImpl), "2 adults 12-14 December", ctx);
    expect(r.source).toBe("simulation");
    expect(r.fallbackReason).toMatch(/Groq.*401/);
  });
});

describe("free catalogue check (GET /models, no tokens)", () => {
  const cfg = (over: AIEnv) => resolveAIConfig(over).candidate!;

  it("OpenRouter: finds Meta models and which are free", async () => {
    const f = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: [
            { id: "meta-llama/llama-3.3-70b-instruct:free", pricing: { prompt: "0", completion: "0" } },
            { id: "meta/muse-spark-open", pricing: { prompt: "0.00000125", completion: "0.00000425" } },
            { id: "google/gemma-4-26b-a4b-it:free", pricing: { prompt: "0", completion: "0" } },
          ],
        }),
      ),
    ) as unknown as typeof fetch;
    const r = await fetchCatalog(cfg({ AI_MODE: "openrouter", OPENROUTER_API_KEY: KEY, OPENROUTER_MODEL: "meta-llama/llama-3.3-70b-instruct:free" }), f);
    expect(r.ok).toBe(true);
    expect(r.totalModels).toBe(3);
    expect(r.metaModels).toEqual([
      { id: "meta-llama/llama-3.3-70b-instruct:free", modelClass: "meta-open-weight", free: true },
      { id: "meta/muse-spark-open", modelClass: "meta-open-weight", free: false },
    ]);
    expect(r.configuredModelListed).toBe(true);
    expect((f as unknown as { mock: { calls: [string][] } }).mock.calls[0][0]).toBe("https://openrouter.ai/api/v1/models");
  });

  it("Groq: reports when the configured Meta model is not available to this account", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ data: [{ id: "openai/gpt-oss-120b" }, { id: "qwen/qwen3.6-27b" }] }))) as unknown as typeof fetch;
    const r = await fetchCatalog(cfg({ AI_MODE: "groq", GROQ_API_KEY: KEY, GROQ_MODEL: "meta-models/muse-spark-open" }), f);
    expect(r.ok).toBe(true);
    expect(r.metaModels).toEqual([]);
    expect(r.configuredModelListed).toBe(false);
  });

  it("handles invalid keys, bad formats and timeouts", async () => {
    const c = cfg({ AI_MODE: "groq", GROQ_API_KEY: KEY });
    expect((await fetchCatalog(c, vi.fn(async () => new Response("", { status: 401 })) as unknown as typeof fetch)).detail).toMatch(/401/);
    expect((await fetchCatalog(c, vi.fn(async () => new Response("{}")) as unknown as typeof fetch)).detail).toMatch(/format/);
    const hang = vi.fn(
      (_u: string, init: RequestInit) =>
        new Promise<Response>((_, reject) => init.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })))),
    ) as unknown as typeof fetch;
    expect((await fetchCatalog(c, hang, 20)).detail).toMatch(/timed out/);
  });
});

describe("API routes", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("/api/ai/catalog is owner-token gated", async () => {
    const { POST } = await import("@/app/api/ai/catalog/route");
    const req = (token: string) => new Request("http://x", { method: "POST", body: JSON.stringify({ token }) });
    expect((await POST(req("x"))).status).toBe(403);
    vi.stubEnv("AI_CONNECTION_TEST_TOKEN", "owner");
    expect((await POST(req("wrong"))).status).toBe(401);
    expect((await (await POST(req("owner"))).json()).detail).toMatch(/simulation/);
  });

  it("/api/ai/status shows the model class and never the key", async () => {
    vi.stubEnv("AI_MODE", "groq");
    vi.stubEnv("GROQ_API_KEY", KEY);
    vi.stubEnv("GROQ_MODEL", "meta-models/muse-spark-open");
    const { GET } = await import("@/app/api/ai/status/route");
    const text = await (await GET()).text();
    expect(text).not.toContain(KEY);
    expect(JSON.parse(text).ai.modelClass).toBe("meta-open-weight");
  });
});

describe("secret hygiene", () => {
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = path.join(dir, f);
      return statSync(p).isDirectory() ? files(p) : [p];
    });
  const root = path.resolve(__dirname, "..");

  it("browser components never read environment variables", () => {
    for (const f of files(path.join(root, "src/components"))) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(/process\.env/);
    }
  });

  it("no API key is exposed through NEXT_PUBLIC_ variables or logged", () => {
    expect(readFileSync(path.join(root, ".env.example"), "utf8")).not.toMatch(/NEXT_PUBLIC_.*KEY/);
    for (const f of files(path.join(root, "src"))) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(/console\.(log|info|debug|warn|error)\([^)]*(apiKey|API_KEY)/);
    }
  });
});
