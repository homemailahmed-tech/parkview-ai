import { afterEach, describe, expect, it, vi } from "vitest";

const KEY = "sk-very-secret-test-key-123456";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("API routes", () => {
  it("/api/ai/status reports live configuration without leaking the key", async () => {
    vi.stubEnv("AI_MODE", "meta-model-api");
    vi.stubEnv("META_MODEL_API_KEY", KEY);
    const { GET } = await import("@/app/api/ai/status/route");
    const text = await (await GET()).text();
    expect(text).not.toContain(KEY);
    const body = JSON.parse(text);
    expect(body.ai.provider).toBe("meta-model-api");
    expect(body.ai.model).toBe("muse-spark-1.3");
    expect(body.ai.connectionTestEnabled).toBe(false);
  });

  it("/api/ai/test is disabled unless a test token is configured, and checks it", async () => {
    const { POST } = await import("@/app/api/ai/test/route");
    const req = (token: string) => new Request("http://x/api/ai/test", { method: "POST", body: JSON.stringify({ token }) });
    expect((await POST(req("anything"))).status).toBe(403);
    vi.stubEnv("AI_CONNECTION_TEST_TOKEN", "owner-token");
    expect((await POST(req("wrong"))).status).toBe(401);
    const ok = await POST(req("owner-token"));
    expect(ok.status).toBe(200);
    expect((await ok.json()).provider).toBe("simulation"); // no live provider configured: no billable call made
  });

  it("/api/ai/interpret validates input and answers in simulation by default", async () => {
    const { POST } = await import("@/app/api/ai/interpret/route");
    expect((await POST(new Request("http://x", { method: "POST", body: "{}" }))).status).toBe(400);
    const res = await POST(new Request("http://x", { method: "POST", body: JSON.stringify({ text: "2 adults 12-14 December", today: "2026-10-27" }) }));
    const body = await res.json();
    expect(body.source).toBe("simulation");
    expect(body.data.check.value.adults).toBe(2);
  });
});
