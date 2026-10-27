# Activating real Meta AI

The app runs in **simulation mode** until you complete one of the two routes below. Nothing here costs money until a key is added
and a live call is made. Please approve any spend first.

## Route A: Meta Model API (Muse Spark 1.3), recommended

1. **Owner:** create a Meta Model API key in Meta's developer console (`dev.meta.ai`). Use hackathon credits if they are granted.
   Note: Meta's docs describe the API as a preview for US developers, so check that your account can use it.
2. Put the key on the server only, in `.env.local` locally or the host's environment-variable settings, never in git:
   ```
   AI_MODE=meta-model-api
   META_MODEL_API_KEY=<your key>
   # defaults, only change if Meta's docs say otherwise:
   # META_MODEL_API_BASE_URL=https://api.meta.ai/v1
   # META_MODEL_API_MODEL=muse-spark-1.3
   AI_DAILY_CALL_LIMIT=100
   AI_CONNECTION_TEST_TOKEN=<long random string>
   ```
3. Restart the app. The **Overview → AI provider** panel should show *Meta Model API · muse-spark-1.3* with no configuration issues.
4. Switch to **Owner**, enter the test token and press **Test live connection**. This makes one small billable call.
   - ✓ Connected: live AI is working.
   - `credentials rejected (HTTP 401/403)`: the key is wrong, revoked or not enabled for the API.
   - `rate limited or out of credits (HTTP 429)`: check credits or quota.
   - `request rejected (HTTP 400/404)`: check the model id and base URL against Meta's current docs.
5. Run the demo flow. AI outputs should now read **✓ Live Meta AI · Meta Model API · muse-spark-1.3**. Anything tagged
   *SIMULATION* came from the fallback, and the reason is shown next to it.

Avoid `*-contributor` model variants with real guest data: they may let Meta train on prompts and completions.

## Route B: Meta open-weight model on an approved host

Use this route with partner credits from, for example, Fireworks, Baseten, Modal or Together for **Muse Spark Open** or Llama:

```
AI_MODE=open-weight
OPEN_WEIGHT_BASE_URL=<host's OpenAI-compatible base URL, e.g. https://api.fireworks.ai/inference/v1>
OPEN_WEIGHT_API_KEY=<host key>
OPEN_WEIGHT_MODEL=<host's exact model id for Muse Spark Open or a Llama model>
OPEN_WEIGHT_HOST_LABEL=Fireworks
```

If the host's model id contains neither "muse-spark-open" nor "llama" (e.g. a custom Baseten deployment name), add the exact id to
`AI_EXTRA_ALLOWED_MODELS`. Non-Meta models are refused unless explicitly enabled as a labelled development stand-in.

## Route C: GroqCloud (free tier, Meta model only if your account has access)

1. Owner creates a key at console.groq.com/keys. Groq documents a free plan; check its current terms.
2. Set `AI_MODE=groq`, `GROQ_API_KEY`, `AI_CONNECTION_TEST_TOKEN`. Leave `GROQ_MODEL` empty at first.
3. Overview → AI provider → **List available Meta models**. This is free and spends no tokens.
4. If a Meta model is listed (e.g. `meta-models/muse-spark-open` after Groq approves preview access), set `GROQ_MODEL` to it,
   restart, then **Test live connection**. If no Meta model is listed, Groq cannot serve this demo yet.

## Route D: OpenRouter (free `:free` models only, by default)

1. Owner creates a key at openrouter.ai/keys.
2. Set `AI_MODE=openrouter`, `OPENROUTER_API_KEY`, `AI_CONNECTION_TEST_TOKEN`, then press **List available Meta models**.
3. If a Meta model is shown as **free**, set `OPENROUTER_MODEL` to that exact id (ending in `:free`).
   Paid ids such as `meta/muse-spark-open` are refused unless `OPENROUTER_FREE_ONLY=false`. Set that only after approving spend.

Before relying on Groq or OpenRouter for judging, confirm with the organisers that a Meta open-weight model served there meets the
official rules. See `docs/AI_PROVIDERS.md`.

## Settings to tune once a live endpoint is known

| Variable | Default | When to change |
| --- | --- | --- |
| `AI_JSON_MODE` | `auto` | Set `prompt` if the endpoint rejects `response_format`. Set `response_format` if it is confirmed supported. |
| `AI_TIMEOUT_MS` | `20000` | Raise it if responses are slow. |
| `AI_MAX_RETRIES` | `1` | Retries apply to HTTP 429, 5xx, timeouts and network errors only. |
| `AI_MAX_OUTPUT_TOKENS` | `800` | Lower it to save cost. |
| `AI_DAILY_CALL_LIMIT` | `200` | This is a hard cap per server instance per day. Use a low value for public demos. |

## What the AI is never allowed to decide

Final prices, room capacities, availability, allocations and booking status always come from deterministic code. The model only reads
enquiries, explains options, writes a greeting and interprets concierge questions. Every output is validated before use.
