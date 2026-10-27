# AI provider switchboard: verified facts (October 2026)

`AI_MODE` selects the language provider: `simulation` (the default), `meta-model-api`, `groq`, `openrouter`, or `open-weight`.
All providers use the same OpenAI-compatible Chat Completions call and the same validation.

**Deterministic code always decides prices, rooms, availability and approvals.** The AI only handles wording and interpretation.

## How this was verified

This build environment's network policy blocked direct access to `dev.meta.ai`, `console.groq.com` and `openrouter.ai`.
The facts below come from web-search results quoting each provider's **official** pages, linked below.
They were not copied from generated examples. Model availability changes quickly. Before choosing a model, the owner should press
**List available Meta models** (Overview → AI provider, owner only). It reads the account's live model list for free.

## Comparison

| | Meta Model API | GroqCloud | OpenRouter |
| --- | --- | --- | --- |
| Endpoint | `https://api.meta.ai/v1/chat/completions` | `https://api.groq.com/openai/v1/chat/completions` | `https://openrouter.ai/api/v1/chat/completions` |
| Auth | `Authorization: Bearer <key>` | `Authorization: Bearer <GROQ_API_KEY>` (keys: console.groq.com/keys) | `Authorization: Bearer <key>`. Optional `HTTP-Referer` and `X-OpenRouter-Title` |
| Meta model ids | `muse-spark-1.3` (Meta docs example) | `meta-models/muse-spark-open`: **limited preview, organisation approval required**. Public Llama ids (`llama-3.1-8b-instant`, `llama-3.3-70b-versatile`, Llama 4 Scout/Maverick) are listed on Groq's deprecation page as **shut down for free/developer tiers** (Llama 4 Maverick on 2026-03-09, Llama 4 Scout on 2026-07-17, Llama 3.1 8B and 3.3 70B on 2026-08-16) | `meta/muse-spark-open` (**paid**). `meta-llama/*:free` variants were historically free, but an unofficial source reports deprecation on 2026-07-19, so the status is unverified |
| Price | Paid per token. Hackathon credits reported as $150 per selected builder (secondary sources) | Free tier with rate limits. No published price for Muse Spark Open preview | `meta/muse-spark-open`: $1.25 per million input tokens, $4.25 per million output. `:free` ids: $0, limited to 20 requests/min and 50/day (1,000/day after buying $10 of credits) |
| Hackathon status | **Eligible.** This is the hackathon's own model platform (Muse Spark series) | Meta open-weight model, so plausibly eligible. Groq is not among the partner hosts named in published material (Baseten, Modal, Fireworks), so confirm with organisers | Same as Groq. Hosted Muse Spark via a router may not count as the Meta Model API, so confirm with organisers |
| Free *Meta* model usable today? | No (credits, not free) | **Only if Groq approves preview access** | **Only if a `:free` Meta id is still listed** (check catalogue) |

## Eligibility labelling in the app

| Model class | Example | Shown as |
| --- | --- | --- |
| Meta Model API | `muse-spark-1.3` on `meta-model-api` | **✓ Live Meta AI · Meta Model API · muse-spark-1.3** |
| Meta open-weight | `meta-models/muse-spark-open` on Groq | **✓ Live Meta AI (open-weight) · Meta open-weight via Groq** |
| Non-Meta development model | `openai/gpt-oss-120b`, `openrouter/free` | Refused by default. With `AI_ALLOW_NON_META_DEV_MODEL=true`: **DEV MODEL · not Meta AI · not hackathon-eligible** |
| Simulation | — | **SIMULATION · not Meta AI** |

`openrouter/free` is classed as non-Meta because it routes to a random free model, which may not be a Meta model.
Llama Guard ids are classed as non-chat and refused.

## Cost guards

- OpenRouter is **free-only by default**. A non-`:free` id is refused unless `OPENROUTER_FREE_ONLY=false`, which needs owner approval.
  The app never sends a fallback-model list, so OpenRouter cannot silently switch to a paid model.
- `AI_DAILY_CALL_LIMIT` caps live calls per server instance per day.
- The model list check uses `GET /models`, which spends no tokens. The connection test makes one small call, and both are owner-token gated.
- Free tiers on routers may log prompts. Use fictional data only.

## Sources

- Meta Model API, Chat completion: https://dev.meta.ai/docs/protocols/chat-completions
- Meta, Muse Spark Open on Groq (run inference): https://dev.meta.ai/docs/muse-spark-open/deploy
- Groq OpenAI compatibility: https://console.groq.com/docs/openai
- Groq model deprecations: https://console.groq.com/docs/deprecations
- Groq models: https://console.groq.com/docs/models
- Groq Muse Spark Open model card: https://console.groq.com/docs/model/meta-models/muse-spark-open
- Groq rate limits: https://console.groq.com/docs/rate-limits
- OpenRouter quickstart: https://openrouter.ai/docs/quickstart
- OpenRouter app attribution headers: https://openrouter.ai/docs/app-attribution
- OpenRouter Muse Spark Open: https://openrouter.ai/meta/muse-spark-open
- OpenRouter free-tier limits: https://openrouter.ai/blog/tutorials/free-llm-apis-compared/
- Hackathon overview (Cerebral Valley): https://cerebralvalley.ai/e/meta-ai-developer-hackathon
