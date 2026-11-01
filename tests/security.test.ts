import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import {
  COOKIE_NAME,
  codesMatch,
  createSessionToken,
  securityConfig,
  signingKey,
  verifySessionToken,
} from "@/lib/security/session";
import { RateLimiter, ruleFor } from "@/lib/security/rateLimit";

const DEMO = "demo-code-1234";
const OWNER = "owner-code-5678";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

let ipSeq = 0;
const ip = () => `10.0.0.${++ipSeq}`;
const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://localhost${url}`, { method: "POST", body: JSON.stringify(body), headers: { "x-real-ip": ip(), ...headers } });

describe("signed sessions", () => {
  const key = signingKey("owner", OWNER);

  it("accepts a fresh token and rejects tampering, wrong kind, wrong key and expiry", async () => {
    const now = Date.parse("2026-10-27T10:00:00Z");
    const t = await createSessionToken("owner", key, now);
    expect(await verifySessionToken(t, "owner", key, now)).toBe(true);
    expect(await verifySessionToken(t.slice(0, -1) + (t.endsWith("a") ? "b" : "a"), "owner", key, now)).toBe(false);
    expect(await verifySessionToken(t.replace(/^owner/, "demo"), "demo", key, now)).toBe(false);
    expect(await verifySessionToken(t, "owner", signingKey("owner", "other-code-999"), now)).toBe(false);
    expect(await verifySessionToken(t, "owner", key, now + 13 * 3600_000)).toBe(false);
    expect(await verifySessionToken(undefined, "owner", key, now)).toBe(false);
    expect(await verifySessionToken("garbage", "owner", key, now)).toBe(false);
  });

  it("compares codes exactly", async () => {
    expect(await codesMatch(OWNER, OWNER)).toBe(true);
    expect(await codesMatch(OWNER.toUpperCase(), OWNER)).toBe(false);
    expect(await codesMatch("", OWNER)).toBe(false);
  });

  it("ignores weak or duplicated codes", () => {
    expect(securityConfig({ OWNER_ACCESS_CODE: "1234" }).ownerLogin.enabled).toBe(false);
    expect(securityConfig({ OWNER_ACCESS_CODE: "1234" }).warnings[0]).toMatch(/shorter than 8/);
    const same = securityConfig({ DEMO_ACCESS_CODE: DEMO, OWNER_ACCESS_CODE: DEMO });
    expect(same.ownerLogin.enabled).toBe(false);
    expect(same.demoGate.enabled).toBe(true);
  });

  it("owner mode is locked by default in production", () => {
    const c = securityConfig({ NODE_ENV: "production" });
    expect(c.ownerLogin.enabled).toBe(false);
    expect(c.publicOwnerMode).toBe(false);
    expect(securityConfig({ NODE_ENV: "production", DEMO_PUBLIC_OWNER_MODE: "true" }).publicOwnerMode).toBe(true);
  });
});

describe("rate limiting", () => {
  it("blocks after the limit and resets after the window", () => {
    let now = 0;
    const rl = new RateLimiter(() => now);
    const rule = { limit: 2, windowMs: 1000 };
    expect(rl.check("a", rule)).toBe(0);
    expect(rl.check("a", rule)).toBe(0);
    expect(rl.check("a", rule)).toBeGreaterThan(0);
    expect(rl.check("b", rule)).toBe(0);
    now = 1001;
    expect(rl.check("a", rule)).toBe(0);
  });

  it("uses strict limits for login routes", () => {
    expect(ruleFor("/api/owner/login")?.rule.limit).toBe(10);
    expect(ruleFor("/api/access")?.group).toBe("login");
    expect(ruleFor("/")).toBeNull();
  });
});

describe("middleware", () => {
  const req = (p: string, headers: Record<string, string> = {}) => new NextRequest(`http://localhost${p}`, { headers: { "x-real-ip": ip(), ...headers } });

  it("leaves the site open (but noindex) when no demo code is set", async () => {
    const { middleware } = await import("@/middleware");
    const res = await middleware(req("/"));
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Robots-Tag")).toMatch(/noindex/);
  });

  it("with DEMO_ACCESS_CODE: redirects pages, refuses APIs, allows the access page and valid cookies", async () => {
    vi.stubEnv("DEMO_ACCESS_CODE", DEMO);
    const { middleware } = await import("@/middleware");
    const page = await middleware(req("/"));
    expect(page.status).toBe(307);
    expect(page.headers.get("location")).toBe("http://localhost/access");
    expect((await middleware(req("/api/ai/status"))).status).toBe(401);
    expect((await middleware(req("/access"))).status).toBe(200);
    expect((await middleware(req("/api/access"))).status).toBe(200);
    const token = await createSessionToken("demo", signingKey("demo", DEMO));
    expect((await middleware(req("/", { cookie: `${COOKIE_NAME.demo}=${token}` }))).status).toBe(200);
  });

  it("rate-limits repeated login attempts from one address", async () => {
    const { middleware } = await import("@/middleware");
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) statuses.push((await middleware(new NextRequest("http://localhost/api/owner/login", { method: "POST", headers: { "x-real-ip": "203.0.113.9" } }))).status);
    expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true);
    expect(statuses[10]).toBe(429);
  });
});

describe("owner login and owner-only tools", () => {
  async function loginCookie(): Promise<string> {
    const { POST } = await import("@/app/api/owner/login/route");
    const res = await POST(post("/api/owner/login", { code: OWNER }));
    expect(res.status).toBe(200);
    const set = res.headers.get("set-cookie")!;
    expect(set).toMatch(/HttpOnly/);
    expect(set).toMatch(/SameSite=Strict/);
    return set.split(";")[0];
  }

  it("owner login is unavailable unless OWNER_ACCESS_CODE is set", async () => {
    const { POST } = await import("@/app/api/owner/login/route");
    expect((await POST(post("/api/owner/login", { code: "anything" }))).status).toBe(404);
  });

  it("rejects a wrong code and accepts the right one", async () => {
    vi.stubEnv("OWNER_ACCESS_CODE", OWNER);
    const { POST } = await import("@/app/api/owner/login/route");
    expect((await POST(post("/api/owner/login", { code: "wrong-code-0000" }))).status).toBe(401);
    const cookie = await loginCookie();
    const { GET } = await import("@/app/api/owner/session/route");
    const anon = await (await GET(new Request("http://localhost/api/owner/session"))).json();
    expect(anon).toEqual({ owner: false, ownerLoginEnabled: true, publicOwnerMode: false });
    const owner = await (await GET(new Request("http://localhost/api/owner/session", { headers: { cookie } }))).json();
    expect(owner.owner).toBe(true);
  });

  it("owner tools require an owner session", async () => {
    vi.stubEnv("OWNER_ACCESS_CODE", OWNER);
    const { POST: catalog } = await import("@/app/api/ai/catalog/route");
    const { POST: test } = await import("@/app/api/ai/test/route");
    expect((await catalog(post("/api/ai/catalog", {}))).status).toBe(401);
    expect((await test(post("/api/ai/test", {}))).status).toBe(401);
    const cookie = await loginCookie();
    const ok = await test(post("/api/ai/test", {}, { cookie }));
    expect(ok.status).toBe(200);
    expect((await ok.json()).provider).toBe("simulation"); // no live provider: nothing billable happens
    expect((await catalog(post("/api/ai/catalog", {}, { cookie }))).status).toBe(200);
  });

  it("logout clears the cookie", async () => {
    const { POST } = await import("@/app/api/owner/logout/route");
    const res = await POST(new Request("http://localhost/api/owner/logout", { method: "POST" }));
    expect(res.headers.get("set-cookie")).toMatch(/hai_owner=; .*Max-Age=0/);
  });

  it("demo access code exchange works the same way", async () => {
    vi.stubEnv("DEMO_ACCESS_CODE", DEMO);
    const { POST } = await import("@/app/api/access/route");
    expect((await POST(post("/api/access", { code: "nope-nope-nope" }))).status).toBe(401);
    const ok = await POST(post("/api/access", { code: DEMO }));
    expect(ok.status).toBe(200);
    expect(ok.headers.get("set-cookie")).toMatch(/^hai_demo=demo\./);
  });
});

describe("deployment hygiene", () => {
  const root = path.resolve(__dirname, "..");
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = path.join(dir, f);
      return statSync(p).isDirectory() ? files(p) : [p];
    });

  it("sends security headers including a strict CSP", async () => {
    // @ts-expect-error — plain .mjs config without type declarations
    const cfg = (await import("../next.config.mjs")).default;
    const headers = (await cfg.headers())[0].headers as { key: string; value: string }[];
    const get = (k: string) => headers.find((h) => h.key === k)?.value ?? "";
    expect(get("Content-Security-Policy")).toMatch(/frame-ancestors 'none'/);
    expect(get("Content-Security-Policy")).toMatch(/connect-src 'self'/);
    expect(get("X-Frame-Options")).toBe("DENY");
    expect(get("X-Robots-Tag")).toMatch(/noindex/);
  });

  it("keeps env files out of git", () => {
    const gi = readFileSync(path.join(root, ".gitignore"), "utf8");
    expect(gi).toMatch(/^\.env$/m);
    expect(gi).toMatch(/^\.env\.\*$/m);
    expect(gi).toMatch(/^!\.env\.example$/m);
  });

  it("names only the fictional demo property", () => {
    for (const f of files(path.join(root, "src"))) {
      const text = readFileSync(f, "utf8");
      // Standalone region code only — "ukzn" (University of KwaZulu-Natal) is a legitimate concierge keyword.
      expect(text, f).not.toMatch(new RegExp(Buffer.from("XGJLWk5cYg==", "base64").toString("utf8")));
      // Any "<Name> Guest House" must be the fictional demo property.
      for (const m of text.matchAll(/\b((?:[A-Z][\w'-]+ ){1,3})Guest House\b/g)) expect(m[0], f).toBe("Parkside Demo Guest House");
    }
  });
});
