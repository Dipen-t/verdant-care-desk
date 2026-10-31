# Setup and deployment

## 1. Local development

Install Node 22 or later. From this directory:

```powershell
npm ci
Copy-Item .env.example .env
npm run dev
```

In a second terminal run `npm run dev:web`. The API listens on `http://127.0.0.1:3001`; Vite prints the frontend URL. If `.env` already exists, edit it rather than overwriting it. Stop/restart the API after environment changes.

With `DATABASE_URL` empty, the app creates persistent embedded PostgreSQL in `.data/verdant`. This is useful for local development and relational integration tests; the production process requires hosted PostgreSQL. The embedded database must have only one owning app process. Tests use an isolated in-memory database.

Local login is `agent@verdant.example` / `verdant-local-2026`, controlled by `LOCAL_AGENT_EMAIL`, `LOCAL_AGENT_PASSWORD` and `LOCAL_DEMO_AUTH=true`. These credentials are only a local development convenience. The production startup check rejects local authentication.

## 2. Configure a real LLM

Choose a provider supporting the OpenAI-compatible `/chat/completions` API and JSON object response mode. The default base URL targets OpenRouter; other compatible providers can be configured without changing application code. Set these values only in the ignored `.env` file:

```dotenv
LLM_BASE_URL=https://openrouter.ai/api/v1
LLM_API_KEY=your-provider-key
LLM_MODEL=your-provider-model-id
```

Obtain the API key and exact model identifier from your provider's console, and verify the model supports JSON output. The base URL excludes `/chat/completions`; the app appends it. Restart the server, send a customer message, and inspect the draft. If an earlier draft failed before configuration, use its Retry draft button.

The app intentionally does not provide fake replies when the key is absent, invalid, rate-limited or out of credit. Inspect server job logs and the agent's failure state. Provider support and quotas vary; test all five supplied sample messages with your selected model. Do not submit customer phone numbers to the LLM; this implementation only sends message text and sender roles from the same conversation.

For OpenRouter, `LLM_FALLBACK_MODELS` accepts comma-separated model IDs to try after transient errors. A primary ending in `:free` can only fall back to other free variants. Fallbacks share one generation timeout, and drafts record the model that actually served them. Reasoning is disabled for this short drafting workflow.

## 3. Supabase database and authentication

1. Create or select a Supabase project. Save its database password securely.
2. Get a PostgreSQL connection string from the project's Connect panel. Use a connection mode reachable by your host (the session pooler is useful for IPv4-only hosts). Copy the supplied TLS configuration; URL-encode special characters in the password. Set `DATABASE_URL` locally and on the host. Do not disable certificate verification to work around connectivity problems.
3. Set `SUPABASE_URL` to the project URL and `SUPABASE_PUBLISHABLE_KEY` to its publishable API key. The legacy `SUPABASE_ANON_KEY` is also accepted. The API uses the key to authenticate passwords through Supabase Auth. No elevated secret key is needed in the running app. Download the public CA certificate from **Database settings > SSL Configuration** and save it as `certs/supabase-ca.crt`; the server uses it to verify TLS for Supabase connections. Set `DATABASE_CA_CERT_PATH` to override the file location. The Docker image includes `certs/`.
4. Set `LOCAL_DEMO_AUTH=false`. The server automatically runs the idempotent initial schema at startup using its database connection. Tables have RLS enabled and direct anon/authenticated access revoked: the browser uses the API, not Supabase's table API. Use a dedicated server-only database role with required ownership/grants; do not put the database URL in frontend variables.
5. Provision the evaluator's agent account with the helper below. Disable public email signup in Supabase if it is not otherwise needed. Public signup would not grant an agent membership, but disabling it reduces unnecessary accounts.

For one-time agent creation, add `SUPABASE_SECRET_KEY` (or legacy `SUPABASE_SERVICE_ROLE_KEY`), `AGENT_EMAIL` and a strong `AGENT_PASSWORD` to your local ignored `.env`, then run:

```powershell
npm run agent:create
```

This creates a confirmed Supabase user and inserts its Verdant membership. Remove the service-role key after provisioning; never commit credentials. Keep `AGENT_EMAIL` and `AGENT_PASSWORD` in the server's secret configuration if using the Realtime bridge described below. If the user already exists, obtain its verified user ID in Supabase and insert its membership through the SQL editor:

```sql
INSERT INTO agent_memberships(user_id, brand_id)
VALUES ('verified-supabase-user-uuid', 'verdant-co')
ON CONFLICT DO NOTHING;
```

The API issues its own signed, HTTP-only, same-site, eight-hour agent cookie after successful Supabase password authentication. It rechecks membership on every agent request; removing the membership revokes app access. Supabase logout/session revocation alone does not immediately revoke this app cookie; shorter sessions or provider token validation are a production extension.

### Live updates and receipts

On Supabase, startup also applies `server/realtime.sql`: database triggers broadcast change metadata to the private `verdant:events` topic. Its subscription policy requires Verdant agent membership. The backend signs in using the existing `AGENT_EMAIL` and `AGENT_PASSWORD`, subscribes with that agent's JWT and relays scoped refresh events to authenticated browser sessions over SSE. Nearby events are batched; agent metadata targets the affected conversation, while customer events carry no identifiers. No Supabase token or elevated key is sent to the browser. Keep these credentials server-only; use a dedicated member account for a deployment.

`REALTIME_ENABLED=true` is the default. Set it to `false` to disable the Supabase bridge. In-process changes still notify connected browsers; periodic refresh also reconciles missed events. Allow long-lived HTTP responses through the deployment proxy and disable response buffering for event streams. The browser refreshes every 15 seconds while connected and every 3 seconds when disconnected.

Messages show one tick after saving, gray double ticks after the recipient app acknowledges receipt, and blue double ticks after the message is visible in the recipient's conversation. Receipts are authorized and persisted through the API; fetching a conversation alone does not mark it viewed. Repeated acknowledgments preserve the earliest timestamps and do not invalidate agent drafts. This tracks activity within this demo, rather than delivery through an external messaging provider.

## 4. Deploy the Node service

For a free Render deployment, the included `render.yaml` creates one Docker web service with `plan: free` and `/api/health` as its health check. It uses the existing Supabase project; it does not create a Render database, paid worker or persistent disk. Connect the GitHub repository as a Render Blueprint and supply the requested environment secrets in Render. The session secret is generated there. Do not upload the local `.env` file to GitHub. Free services can sleep while idle, pausing the worker and delaying the next visit; test a cold start before submission.

The Dockerfile builds the frontend and server into one image. Use a host that runs a persistent Node/Docker web service, forwards your public hostname, supports HTTPS, and reaches PostgreSQL. A sleeping free service pauses the in-process worker until the service wakes; use an always-running service for predictable draft latency. Confirm host pricing and behavior yourself before creating paid resources.

Build/start commands without Docker: `npm ci && npm run build`, then `npm start`. Set:

```dotenv
NODE_ENV=production
HOST=0.0.0.0
PORT=3001
LOCAL_DEMO_AUTH=false
DATABASE_URL=your-verified-TLS-postgres-connection-string
SUPABASE_URL=your-project-url
SUPABASE_ANON_KEY=your-anon-key
SESSION_SECRET=at-least-32-random-characters
WEBHOOK_SECRET=verdant-demo-secret-2026
LLM_BASE_URL=your-provider-base-url
LLM_API_KEY=your-key
LLM_MODEL=your-model-id
WORKER_ENABLED=true
```

Generate `SESSION_SECRET` with a password manager or `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`; store it in the host's secret manager. The public test webhook secret is mandated by the assessment. Real production integrations need private per-endpoint credentials and rotation.

The health endpoint is `/api/health`; the webhook is `https://YOUR-HOST/webhook`. Return HTTP 202 after the event/message/job transaction commits, HTTP 200 for an identical duplicate, and a non-success response for invalid requests or failed persistence. AI completion is asynchronous. Invalid JSON, signatures, brands and conflicting identifiers are rejected. Source timestamps are retained; transcript order follows stable database ingestion sequence.

The host must preserve the original request hostname for the same-origin checks on cookie APIs. Proxy headers are deliberately not trusted for client IP rate limits; for a deployment behind a trusted proxy, configure a verified proxy boundary rather than blindly trusting arbitrary forwarded headers. The included rate limiter is process-local. Add a shared limiter for multiple instances and configure proxy-aware IP handling before claiming production abuse protection.

## 5. Verify and submit

- Run `npm test` and `npm run build`.
- The integration suite uses real PostgreSQL semantics through PGlite, with an injected test draft generator. It does not evaluate live model quality or prove multi-connection locking on hosted PostgreSQL; repeat duplicate-delivery and approval-race checks against the deployed database.
- Open the deployed app in a fresh browser; send a sample as Aisha, sign in as the seeded agent, edit/approve the draft, and see the approved reply as Aisha.
- Run `npm run webhook:send -- https://YOUR-HOST/webhook` and verify the same flow.
- Run all five policy examples and a prompt-injection attempt with the actual provider. Also test exactly INR 3,000 for COD.
- Interrupt provider access, verify visible failure/retry, restore access and retry. Confirm the message is preserved.
- Ensure the GitHub repository excludes `.env`, `.data` and credentials. Share agent test credentials privately through the required submission channel, not in the public README.
- Record a video no longer than three minutes: customer send; agent sign-in/draft/edit/approval; customer reply; explain transactional jobs, full-policy prompting and one improvement.
- Resolve the conflicting form links with HR; submit app/repository/webhook/video links and test agent details through the correct form. Keep the deployment active until a hiring decision.

The current customer selector intentionally exposes shared fictional test identities to anyone who opens the demo. Signed cookies scope each request but do not verify real customer ownership. Never load real customer data into this sandbox.
