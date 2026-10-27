import { securityConfig } from "@/lib/security/session";
import { loginWithCode } from "@/lib/security/http";

export const dynamic = "force-dynamic";

/** Owner login: exchanges OWNER_ACCESS_CODE for a 12-hour HttpOnly owner session. */
export async function POST(req: Request) {
  return loginWithCode(req, "owner", securityConfig().ownerLogin);
}
