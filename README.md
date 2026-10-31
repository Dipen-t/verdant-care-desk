# Verdant care desk

A support app for Verdant & Co. Customers send messages, AI suggests replies, and agents check, edit and approve them. Customers see only approved replies.

## Run on your computer

You need Node.js 22 or above.

1. Run `npm ci` to install the packages.
2. Copy `.env.example` to `.env`. If `.env` already exists, keep it. Add your `LLM_API_KEY` and `LLM_MODEL`; OpenRouter is the default provider.
3. Run `npm run dev`. In a second terminal, run `npm run dev:web` and open the link it shows.

For local testing, leave `DATABASE_URL` empty and use `LOCAL_DEMO_AUTH=true`. Data stays in `.data/verdant`. Agent login: `agent@verdant.example` / `verdant-local-2026`.

Check with `npm test` and build with `npm run build`. Stop the development API before running the build with `npm start`. Test the webhook with `npm run webhook:send -- http://127.0.0.1:3001/webhook`. See [SETUP.md](SETUP.md) for Supabase and hosting steps. Never upload `.env` or API keys to GitHub.

## Main choices

React/TypeScript handle the screens, Fastify handles requests, and PostgreSQL stores data. One service keeps setup simple.

App and webhook messages follow the same steps. Signatures check webhook requests; message IDs prevent duplicates. Messages are saved with pending AI tasks, so an AI failure does not lose them. Failed tasks can retry. Approval checks for new messages and prevents duplicate replies.

AI gets all seven policies with each request. A search system becomes useful when policies grow too large or expensive to send together. Questions outside the policies and medical concerns need review. AI cannot access or change orders.

Supabase handles agent sign-in and live updates. Ticks show whether a message was saved, received or viewed. Regular background checks recover missed updates.

Left out: real WhatsApp sending, attachments, multiple languages and multiple brands. Customers are sample identities. Smaller message batches and better monitoring are future work.

## What has been checked

All 32 tests and the build pass. Supabase sign-in, database storage, real AI replies, duplicate approval handling and live updates were checked. See [LIVE_VERIFICATION.md](LIVE_VERIFICATION.md). Public hosting and testing on the hosted link are still pending.

## AI help

Codex helped with research, code and tests. Its first database setup used the wrong method to run several SQL statements together. Switching to the correct method fixed it.

## Two questions

**What if something fails at 2 a.m.?** If the message was saved, the agent can still see it; the AI task can retry or show a failure with a Retry option. Logs contain IDs and error codes to help find the problem, and unfinished tasks can recover after restart. If saving itself fails, the webhook returns an error so the sender can try again.

**What would change for 20 brands?** First, make sure each agent can access only their own brand's customers, messages and policies. Then give each brand its own policies, webhook credentials and usage limits to keep their data separate and control costs.
