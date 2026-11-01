/**
 * Where a configured endpoint really points. Labels depend on this, not on the configured
 * provider name: a local server imitating Meta's API must never be shown as "Live Meta AI".
 *  - "meta-official": https on Meta's own host (api.meta.ai / *.meta.ai)
 *  - "third-party":   another public https host (e.g. Groq, OpenRouter serving a Meta open-weight model)
 *  - "local":         localhost, private networks, plain http, or anything unparsable — a test endpoint
 */
export type EndpointTrust = "meta-official" | "third-party" | "local";

export function endpointTrust(baseUrl: string): EndpointTrust {
  let u: URL;
  try {
    u = new URL(baseUrl);
  } catch {
    return "local";
  }
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (u.protocol !== "https:") return "local";
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h === "::1" || h === "0.0.0.0") return "local";
  if (/^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || /^169\.254\./.test(h)) return "local";
  if (h === "meta.ai" || h.endsWith(".meta.ai")) return "meta-official";
  return "third-party";
}
