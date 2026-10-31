# Live integration verification

Verified on 31 October 2026 with fictional assessment data. The README remains deferred as requested.

## Connected services

- Supabase Session pooler: database connection and all nine application tables verified.
- PostgreSQL transport: Node-to-pooler TLS encryption and certificate authorization both verified using the dashboard-downloaded public Supabase CA. `pg_stat_ssl` through the pooler describes its separate upstream connection; it is not the measurement used to claim client-side TLS.
- Supabase Auth: dedicated `assessment-agent@verdant.example` account created with explicit user approval, confirmed without sending email, and granted only the application's Verdant membership.
- Generated agent credentials are stored only in ignored `.env` as `AGENT_EMAIL` and `AGENT_PASSWORD`. `LOCAL_DEMO_AUTH=false` enables real Supabase password sign-in.
- OpenRouter: configured Gemma free endpoint returned upstream shared-pool rate limits. A free Nemotron 3.5 Super VL fallback successfully generated real drafts. The primary setting was retained; fallback configuration is explicit in `.env`.

## Live AI evaluation

The five assessment examples, exactly INR 3,000 COD, and an instruction-override attempt each returned schema-valid replies through the actual application provider adapter. All seven observed requests were served by `nvidia/nemotron-3.5-super-vl:free`.

Observed policy behavior: return conditions and COD boundaries were retained; Dubai coverage was acknowledged as unknown; address changes remained conditional; the medical concern was marked for review; the instruction-override attempt did not produce a claim that a refund or address change had been performed. The medical draft included general safety language, so its human-review requirement remains important. These are observed examples, not a guarantee for every future model output.

## Hosted end-to-end check

Using the real Supabase database, real Supabase authentication and real LLM calls:

1. A signed webhook saved a fictional customer message and durable draft job.
2. Redelivery of the identical event was suppressed.
3. The worker generated and saved a real AI draft, including the actual served model.
4. The approved agent account signed in through the app's login endpoint.
5. Two simultaneous approvals of an edited draft saved exactly one agent reply.
6. The customer endpoint returned the exact edited reply and no draft fields.

The test records remain as synthetic demo conversation data. No real customer channel was contacted.

## Live notifications and message receipts

Private Supabase Broadcast subscription authenticated with the existing approved agent account was verified. An end-to-end database broadcast reached the server bridge and authorized HTTP event streams. The live check confirmed customer streams exclude other customers and draft events, anonymous streams return 401, and customer refresh payloads contain only `{}`; agent payloads include only authorized conversation IDs and change kinds. Polling remains a fallback when the stream disconnects.

Receipt timestamps are persisted separately from conversation versions. A single tick means saved, gray double ticks mean the recipient app acknowledged receipt, and blue double ticks mean the incoming message was visible in the recipient's active conversation. Viewing requires a visible document and a short visibility dwell. Browser checks against hosted Supabase verified both customer-to-agent and agent-to-customer states, including a received message remaining gray while offscreen. These are in-app acknowledgments, not external WhatsApp delivery receipts.

All 32 automated tests, TypeScript checking and the production build passed, including receipt scope, monotonic timestamps, duplicate acknowledgments, visibility and event filtering.

## Still required before submission

The demo video remains. The repository is now public, and the user explicitly requested publishing the existing assessment demo login in README.md. That login was checked against the deployed app before publication; no additional account was created. Database, API and Supabase admin credentials remain private. Free-model capacity and account quotas can affect future availability.

## Public deployment

On 31 October 2026, Render deployed commit `5f2bc1e` as one Docker **Free** web service in the user-approved My Projects workspace. No paid database, disk or separate worker was created. The existing Supabase project supplies storage, authentication and Realtime. The Supabase admin key was excluded from Render.

- App: https://verdant-care-desk.onrender.com
- Webhook: https://verdant-care-desk.onrender.com/webhook
- Public repository: https://github.com/Dipen-t/verdant-care-desk
- Health path: `/api/health`

Checks through the public HTTPS service passed: customer send and idempotent retry; actual AI draft generation; authenticated agent review; concurrent identical approvals yielding one edited reply; customer-safe transcript; persisted receipts; signed webhook and duplicate suppression; and private Supabase broadcasts reaching authorized SSE streams. Anonymous streams returned 401, customer streams excluded draft activity and other customers. Verification used Maya's fictional test conversation and left the user's pending Aisha draft untouched.

Render Free can sleep when idle, pausing the worker until the service wakes. A first visit may therefore take around a minute. Cold-start behavior after a full idle period has not been separately timed.

## Code-quality follow-up

Session validation and authorization are isolated in `server/sessions.ts`; stream lifecycle and bounded batching live in `server/eventStreams.ts`. Agent change metadata targets refetches: receipts skip inbox reloads and changes in other conversations skip the current transcript. Nearby duplicate notifications are coalesced, reconnects trigger full reconciliation, and polling remains the recovery path. Stream tests cover batching, privacy, large bursts and revocation. API responses default to `unknown`; sessions, provider login and receipt query results have explicit validation or types. Notification failures emit rate-limited, data-free warnings.

Versioned migrations, full database row typing, pagination and operational load testing remain production follow-ups.

