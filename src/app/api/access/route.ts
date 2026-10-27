import { securityConfig } from "@/lib/security/session";
import { loginWithCode } from "@/lib/security/http";

export const dynamic = "force-dynamic";

/** Exchanges the demo access code (DEMO_ACCESS_CODE) for an HttpOnly session cookie. */
export async function POST(req: Request) {
  return loginWithCode(req, "demo", securityConfig().demoGate);
}
