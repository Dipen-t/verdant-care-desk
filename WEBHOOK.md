# How to test the webhook

The webhook receives customer messages from another system. It is a **POST endpoint**, not a webpage. Opening its URL in a browser sends GET and shows `Endpoint not found`; this does not mean the POST endpoint is broken.

## 1. Send a message from your terminal

You need Node.js 22 or above and a copy of this repository. Open a terminal in the project folder and run:

```powershell
npm ci
npm run webhook:send -- https://verdant-care-desk.onrender.com/webhook
```

Run `npm ci` only when setting up the project or after its dependencies change. You do not need to start the app locally or supply LLM/database credentials to send this test request.

The command sends this message as Aisha Khan:

> Hi, my order #4471 has not arrived. Can I change the address?

To send your own question, put it in quotes after the URL:

```powershell
npm run webhook:send -- https://verdant-care-desk.onrender.com/webhook "What is your return policy?"
```

The [test script](scripts/send-webhook.ts) creates new IDs, uses the current time, calculates the signature and sends the request. It uses the assessment's test secret, `verdant-demo-secret-2026`, unless your local `.env` overrides `WEBHOOK_SECRET`. For the deployed demo, any override must match that test secret. This is a public assessment secret, not a production credential.

For a locally running API, use:

```powershell
npm run webhook:send -- http://127.0.0.1:3001/webhook "What is your return policy?"
```

## 2. Check the response and the app

A new valid message returns HTTP **202**, followed by a response like:

```json
{
  "duplicate": false,
  "messageId": "<saved-message-uuid>",
  "conversationId": "<conversation-uuid>"
}
```

202 means the message and its AI task were saved. The AI draft is generated afterwards; it may take a little time.

Open [the deployed app](https://verdant-care-desk.onrender.com), switch to **Agent**, and sign in with the [demo login in the README](README.md#deployed-app-login). Open **Aisha Khan** to see the message and its draft. The original customer question appears above each draft. Edit the draft and click **Approve reply**. Switch to **Customer** and choose Aisha from the visible **Test customer** dropdown to see the approved reply. Drafts are never shown to the customer. Tap or click a message's ticks to see whether it was saved, received or viewed.

## 3. Exact request format

Method and URL:

```text
POST https://verdant-care-desk.onrender.com/webhook
```

Example JSON body:

```json
{
  "event_id": "evt_test_001",
  "type": "message.received",
  "brand_id": "verdant-co",
  "timestamp": "2026-10-31T12:00:00+05:30",
  "customer": {
    "id": "cust_1042",
    "name": "Aisha Khan",
    "phone": "+919800000001"
  },
  "message": {
    "id": "msg_test_001",
    "type": "text",
    "text": "What is your return policy?"
  }
}
```

Use a new `event_id` and message `id` for each new message. Keep the customer ID the same to append to that customer's conversation. Use a current ISO timestamp, including its timezone. Message text must contain 1–4,000 characters. This demo accepts only `verdant-co`, `message.received` and text messages.

Required headers:

```text
Content-Type: application/json
X-Signature: sha256=<64-character hexadecimal signature>
```

Calculate HMAC-SHA256 over the **exact body bytes being sent**, using `verdant-demo-secret-2026` as the key. The header needs the `sha256=` prefix. Signing one JSON string and then changing its spaces, newlines or text will make the signature invalid. A plain hash of the body is not enough.

The test script uses these Node.js steps:

```js
const body = JSON.stringify(payload);
const signature = createHmac('sha256', 'verdant-demo-secret-2026')
  .update(body)
  .digest('hex');
```

Here `payload` is the JSON object above and `createHmac` comes from `node:crypto`. Send that same `body` string with `X-Signature: sha256=${signature}`. If using Postman or another client, it must calculate the header from its exact outgoing raw body too.

## Responses and common problems

| Result | Meaning |
| --- | --- |
| 202, `duplicate: false` | New message and AI task saved |
| 200, `duplicate: true` | Identical event/message was already saved; no extra message or AI task created |
| 400 | Invalid JSON, missing fields or unsupported values |
| 401 | Missing or incorrect signature |
| 409 | An existing event/message ID was reused with different content |
| 429 | Too many requests; wait and retry |
| GET shows `Endpoint not found` | Use the signed POST command above |

The Free Render server can take around a minute to wake up after being idle. An AI provider failure can leave a saved message with a failed draft; the agent can retry it. A successful 202 response does not guarantee that AI generation has already finished.
