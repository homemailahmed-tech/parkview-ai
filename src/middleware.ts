import { NextResponse, type NextRequest } from "next/server";
import { COOKIE_NAME, securityConfig, verifySessionToken } from "@/lib/security/session";
import { RateLimiter, clientIp, ruleFor } from "@/lib/security/rateLimit";

/**
 * Runs before every request:
 *  1. Rate-limits API routes (stricter for login routes).
 *  2. If DEMO_ACCESS_CODE is set, requires the demo access cookie for
 *     everything except the access page itself — a free substitute for
 *     Vercel's paid password protection.
 *  3. Marks every response noindex so the demo stays out of search engines.
 */
const limiter = new RateLimiter();
const PUBLIC_PATHS = ["/access", "/api/access", "/robots.txt"];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const r = ruleFor(pathname);
  if (r) {
    const wait = limiter.check(`${r.group}:${clientIp(req.headers)}`, r.rule);
    if (wait > 0) {
      return NextResponse.json({ error: "Too many requests — please wait and try again." }, { status: 429, headers: { "Retry-After": String(wait) } });
    }
  }

  const cfg = securityConfig();
  if (cfg.demoGate.enabled && !PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    const ok = await verifySessionToken(req.cookies.get(COOKIE_NAME.demo)?.value, "demo", cfg.demoGate.key!);
    if (!ok) {
      if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Demo access code required" }, { status: 401 });
      const url = req.nextUrl.clone();
      url.pathname = "/access";
      url.search = "";
      return NextResponse.redirect(url);
    }
  }

  const res = NextResponse.next();
  res.headers.set("X-Robots-Tag", "noindex, nofollow");
  return res;
}

export const config = {
  // Everything except Next.js build assets and the icon.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
