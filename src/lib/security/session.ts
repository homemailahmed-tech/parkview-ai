/**
 * Minimal signed-cookie sessions using Web Crypto (works in Next.js edge
 * middleware and Node). No database: a token is `kind.expiry.signature`,
 * signed with HMAC-SHA-256 over a key derived from the access code (and the
 * optional SESSION_SECRET). Changing the code invalidates every session.
 */
export type SessionKind = "demo" | "owner";

export const COOKIE_NAME: Record<SessionKind, string> = { demo: "hai_demo", owner: "hai_owner" };
export const SESSION_TTL_SECONDS: Record<SessionKind, number> = { demo: 7 * 24 * 3600, owner: 12 * 3600 };
export const MIN_CODE_LENGTH = 8;

const enc = new TextEncoder();

async function hmacHex(key: string, message: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(message)));
  return Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Compares a submitted code with the configured one without leaking timing information. */
export async function codesMatch(input: string, expected: string): Promise<boolean> {
  if (!input || !expected) return false;
  const [a, b] = await Promise.all([hmacHex("code-compare", input), hmacHex("code-compare", expected)]);
  return constantTimeEqual(a, b);
}

export function signingKey(kind: SessionKind, code: string, sessionSecret = ""): string {
  return `hospitality-ai|${kind}|${sessionSecret}|${code}`;
}

export async function createSessionToken(kind: SessionKind, key: string, now = Date.now()): Promise<string> {
  const exp = Math.floor(now / 1000) + SESSION_TTL_SECONDS[kind];
  return `${kind}.${exp}.${await hmacHex(key, `${kind}.${exp}`)}`;
}

export async function verifySessionToken(token: string | undefined, kind: SessionKind, key: string, now = Date.now()): Promise<boolean> {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== kind || !/^\d+$/.test(parts[1])) return false;
  if (Number(parts[1]) < Math.floor(now / 1000)) return false;
  return constantTimeEqual(parts[2], await hmacHex(key, `${parts[0]}.${parts[1]}`));
}

export interface SecurityEnv {
  DEMO_ACCESS_CODE?: string;
  OWNER_ACCESS_CODE?: string;
  SESSION_SECRET?: string;
  DEMO_PUBLIC_OWNER_MODE?: string;
  NODE_ENV?: string;
}

export interface SecurityConfig {
  /** Site-wide access code required before anything loads. */
  demoGate: { enabled: boolean; key?: string; code?: string };
  /** Owner login available (owner-only controls unlock after it). */
  ownerLogin: { enabled: boolean; key?: string; code?: string };
  /** Visitors may switch to owner role in their own private browser sandbox without a code. */
  publicOwnerMode: boolean;
  warnings: string[];
}

export function securityConfig(env: SecurityEnv = process.env as SecurityEnv): SecurityConfig {
  const warnings: string[] = [];
  const secret = (env.SESSION_SECRET ?? "").trim();
  const read = (name: "DEMO_ACCESS_CODE" | "OWNER_ACCESS_CODE", kind: SessionKind) => {
    const code = (env[name] ?? "").trim();
    if (!code) return { enabled: false };
    if (code.length < MIN_CODE_LENGTH) {
      warnings.push(`${name} is shorter than ${MIN_CODE_LENGTH} characters and has been ignored`);
      return { enabled: false };
    }
    return { enabled: true, code, key: signingKey(kind, code, secret) };
  };
  const demoGate = read("DEMO_ACCESS_CODE", "demo");
  const ownerLogin = read("OWNER_ACCESS_CODE", "owner");
  if (demoGate.enabled && ownerLogin.enabled && demoGate.code === ownerLogin.code) {
    warnings.push("OWNER_ACCESS_CODE must differ from DEMO_ACCESS_CODE — owner login disabled");
    ownerLogin.enabled = false;
  }
  // Local development (next dev) keeps the old convenience of switching freely.
  const publicOwnerMode = env.DEMO_PUBLIC_OWNER_MODE?.trim().toLowerCase() === "true" || env.NODE_ENV === "development";
  return { demoGate, ownerLogin, publicOwnerMode, warnings };
}

/** Reads one cookie from a Cookie header. */
export function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

export function sessionCookie(kind: SessionKind, token: string, secure: boolean): string {
  return `${COOKIE_NAME[kind]}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL_SECONDS[kind]}${secure ? "; Secure" : ""}`;
}

export function clearCookie(kind: SessionKind, secure: boolean): string {
  return `${COOKIE_NAME[kind]}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? "; Secure" : ""}`;
}

/** True when the request carries a valid owner session. */
export async function isOwnerRequest(req: Request, cfg: SecurityConfig = securityConfig()): Promise<boolean> {
  if (!cfg.ownerLogin.enabled || !cfg.ownerLogin.key) return false;
  return verifySessionToken(readCookie(req.headers.get("cookie"), COOKIE_NAME.owner), "owner", cfg.ownerLogin.key);
}
