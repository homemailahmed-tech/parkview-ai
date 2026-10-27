import { describe, expect, it, vi } from "vitest";
import { MetaLlamaProvider, isEligibleMetaModel, parseJsonObject } from "@/lib/ai/metaLlamaProvider";
import { containsFigures, draftQuoteIntro, interpretEnquiry, selectProvider } from "@/lib/ai/service";

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

function mockFetch(content: string, status = 200) {
  return vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status })) as unknown as typeof fetch;
}

describe("provider selection", () => {
  it("defaults to clearly labelled simulation mode", () => {
    const sel = selectProvider({});
    expect(sel.primary.info.kind).toBe("simulation");
    expect(sel.primary.info.label).toMatch(/Simulation/);
  });

  it("refuses to start Meta mode without credentials", () => {
    const sel = selectProvider({ AI_MODE: "meta" });
    expect(sel.primary.info.kind).toBe("simulation");
    expect(sel.configIssue).toMatch(/needs base URL/);
  });

  it("only accepts Meta Llama models", () => {
    expect(isEligibleMetaModel("accounts/fireworks/models/llama-v3p3-70b-instruct")).toBe(true);
    expect(isEligibleMetaModel("Llama-4-Maverick-17B-128E-Instruct-FP8")).toBe(true);
    expect(isEligibleMetaModel("claude-sonnet")).toBe(false);
    expect(isEligibleMetaModel("gpt-4o")).toBe(false);
    const sel = selectProvider({ AI_MODE: "meta", META_LLAMA_BASE_URL: "https://x", META_LLAMA_API_KEY: "k", META_LLAMA_MODEL: "claude-x" });
    expect(sel.primary.info.kind).toBe("simulation");
    expect(sel.configIssue).toMatch(/not a Meta Llama model/);
  });
});

describe("Meta Llama provider (mocked HTTP — no live call)", () => {
  const make = (fetchImpl: typeof fetch) =>
    new MetaLlamaProvider({ baseUrl: "https://example.invalid/v1", apiKey: "test-key", model: "llama-test", fetchImpl });

  it("sends an OpenAI-compatible request and parses JSON", async () => {
    const f = mockFetch('```json\n{"checkIn":"2026-12-12","checkOut":"2026-12-14","adults":4}\n```');
    const p = make(f);
    const out = await p.interpretEnquiry("hi", ctx);
    expect(out).toEqual({ checkIn: "2026-12-12", checkOut: "2026-12-14", adults: 4 });
    const [url, init] = (f as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0];
    expect(url).toBe("https://example.invalid/v1/chat/completions");
    expect(JSON.parse(init.body as string).model).toBe("llama-test");
    expect(p.info.verified).toBe(true);
  });

  it("validates model output deterministically", async () => {
    const f = mockFetch('{"checkIn":"2026-12-12","nights":2,"adults":"lots"}');
    const sel = { primary: make(f), simulation: selectProvider({}).simulation };
    const r = await interpretEnquiry(sel, "text", ctx);
    expect(r.source).toBe("meta");
    expect(r.data.check.value.checkOut).toBe("2026-12-14");
    expect(r.data.check.missing).toContain("number of adults");
    expect(r.data.units).toEqual([]);
  });

  it("falls back to simulation on HTTP errors and says so", async () => {
    const sel = { primary: make(mockFetch("", 500)), simulation: selectProvider({}).simulation };
    const r = await interpretEnquiry(sel, "2 adults 12-14 December", ctx);
    expect(r.source).toBe("simulation");
    expect(r.fallbackReason).toMatch(/HTTP 500/);
  });

  it("replaces AI wording that contains figures", async () => {
    const sel = { primary: make(mockFetch("Your stay costs R2400, a bargain!")), simulation: selectProvider({}).simulation };
    const r = await draftQuoteIntro(sel, draftInput);
    expect(r.source).toBe("simulation");
    expect(r.fallbackReason).toMatch(/figures/);
    expect(containsFigures(r.data)).toBe(false);
  });

  it("parseJsonObject rejects non-JSON", () => {
    expect(() => parseJsonObject("no json here")).toThrow();
  });
});
