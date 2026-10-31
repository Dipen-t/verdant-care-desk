# Assessment compliance and UI review

Reviewed against the six-page supplied assessment on 31 October 2026. This distinguishes implementation from verification: code existing does not establish that a hosted service or a real model works.

## Requirements

| PDF requirement | Implementation | Verification / remaining work |
| --- | --- | --- |
| JSON message webhook with raw-body HMAC-SHA256 and the supplied secret | `/webhook` verifies `X-Signature`; validates the documented payload; returns 202 after a committed transaction | Signature, tampering, duplicates and HTTP receipt covered by integration tests; repeat on public deployment |
| Relational storage of customer ID/name/phone, conversation, text/time/sender | PostgreSQL schema; Supabase database connected with verified client TLS | Relational tests and hosted end-to-end flow pass; hosted concurrent approval creates one reply |
| One open conversation per customer; append later messages | Partial unique index and transactional ingestion | Repeated-message and concurrent-ingestion tests |
| AI suggestion for each incoming customer message using only the supplied policies | Durable per-message draft job; versioned full-policy prompt; real provider adapter and explicit free fallback | All five examples plus COD boundary and instruction-override cases evaluated with real model calls; see LIVE_VERIFICATION.md for observed behavior and limits |
| Save a draft with the message it answers; never send it automatically | Draft foreign key to trigger message; only approval inserts an agent reply | Integration tests cover isolation and approval |
| Only signed-in agents can see all conversations | Supabase password sign-in, agent session and explicit membership | Dedicated agent provisioned with user approval; hosted login and protected endpoints verified |
| Customer name, latest-message preview, time; newest activity first | Inbox rows with all three; database orders by last activity | Implemented; inspect hosted behavior after deployment |
| All conversation messages in order; editable draft and Approve button | Ordered transcript; inline reply composer; selector when several drafts are waiting | UI states checked with fixtures; hosted API flow verified editing and approval of a real model draft |
| Approve saves edited text and marks the draft used | Transactional approval; original AI text retained | Approval, duplicate clicks and changed-context conflicts covered by tests |
| Top-level Customer / Agent switch | Visible persistent header switch | Browser verification |
| Select a test customer OR enter name/phone | Three selectable fictional test customers | Satisfies the allowed choice; custom customer creation is not required |
| Customer sees own conversation and approved replies, never drafts | Scoped customer session and explicit customer-safe API projection | Integration tests; browser end-to-end check |
| Customer send follows the same saving and AI behavior as a webhook | Both call the same ingestion transaction and create the same type of job | Integration tests |
| Customer requires no sign-in; agent does | Public test-customer selector; separate agent login | Browser verification |
| Deployed working app, test agent details, webhook URL | Render Free app deployed; URLs in LIVE_VERIFICATION.md | Public customer/approval/webhook/live flow verified; share evaluator credentials privately |
| GitHub repository with no secrets and example environment file | Private Dipen-t/verdant-care-desk repository; `.env.example`, ignored `.env` | Files checked for saved secrets before upload; evaluator repository access still required |
| Short README covering local run, decisions, cuts, AI assistance, both questions | README plus a separate detailed setup guide | Final candidate review and one-page presentation check remain |
| Demo video <=3 minutes | Recording checklist in setup guide | **Not recorded** |

The PDF does not require a polished visual design, real WhatsApp integration, attachments or multilingual support. The user has independently requested a clearer, more usable interface, so this redesign improves the requested core workflow without adding those features.

## Problems corrected in the first UI

- The introductory marketing column consumed space needed for messaging and pushed the composer off-screen on phones.
- Conversation, AI draft and policies occupied three separate areas. Reading, editing and approving required too much visual movement.
- The mobile inbox became a horizontal list above a long stacked conversation and draft area. It lacked a clear inbox-to-thread navigation model.
- Small text and repeated explanatory labels reduced readability. The customer saw operational language unrelated to sending a message.
- Switching views or conversations could lose unsent edits. New arrivals could scroll a reader away from older messages.

## New interaction structure

- Customer: a single chat, compact test-customer selector, readable message bubbles, and a composer that remains at the bottom of the available viewport. Sample messages are optional and open from one button.
- Agent on desktop: conversation list beside a thread, with the draft immediately below its messages. Sources and the full policy list are available on demand.
- Agent on a phone: open a conversation from the inbox; return using the explicit Back to inbox button. The inbox and thread do not compete for the same small viewport.
- Preserve unsent customer and agent text in tab-scoped session storage. Keep approval explicit, preserve stale-context confirmation, and show a clear approval result.
- Desktop Enter sends; Shift+Enter inserts a line. On touch devices, Enter inserts a line and the Send button submits. IME composition does not trigger a send.
- Scroll only the message transcript. Readers viewing earlier messages get a New messages button instead of being pulled to the bottom.

## References and adaptation

- [Intercom Inbox](https://www.intercom.com/helpdesk/inbox): conversation-focused shared inbox. Adapted the list-to-thread relationship without bringing in unrelated assignment, reporting or channel controls.
- [Intercom Copilot FAQs](https://www.intercom.com/help/en/articles/9121381-copilot-faqs): answers can be edited in the composer before sending, and their sources are inspectable. Adapted editable inline drafts and collapsible policy references; retained the assessment's explicit approval action.
- [Front composer](https://help.front.com/en/articles/2097): reply composition within the conversation workflow. Adapted a familiar bottom composer and retention of unsent edits; omitted rich-text and channel switching because they are outside the brief.
- [Zendesk Agent Workspace](https://support.zendesk.com/hc/en-us/articles/4408821259930-About-the-Zendesk-Agent-Workspace/): conversation and reply work within one workspace. Adapted keeping messages and reply controls together.

These references informed the interaction choices. The redesign does not copy their full enterprise navigation or use screenshots as application assets.

## Submission ambiguities

The email and PDF contain different form links, and the form the user inspected has no assessment-link fields. Confirm the correct channel with HR before submission. The seven-day deadline depends on the actual receipt date; the sample event timestamp does not establish it.

## Alignment with the supplied job description

| Technology / area | Decision for this assessment |
| --- | --- |
| React | Used for both customer and agent interfaces |
| Supabase / PostgreSQL | Target hosted relational database; embedded PostgreSQL remains a local-development convenience |
| Supabase Auth | Hosted password authentication and scoped membership provisioned and verified |
| Supabase Realtime | Private database broadcasts relayed through authorized SSE; persisted received/viewed receipts; polling fallback |
| Webhooks | Implemented signed inbound endpoint, shared ingestion, deduplication and durable drafting jobs |
| OpenRouter | Real free-model drafting verified with explicit fallback and served-model recording |
| DeepInfra | An alternative compatible provider configuration, subject to model/JSON-mode support; no unnecessary multi-provider fallback layer |
| Edge Functions / RPCs | Optional future deployment choices. Existing database transactions already supply atomic ingestion/approval; migrating them just to tick a technology box is unnecessary |
| Qdrant / RAG | Deferred. Seven small policies fit in context. Add retrieval when knowledge volume, measured quality, cost or latency warrants it |
| WhatsApp / Shopify / Meta / Instagram | Future adapters feeding the ingestion service, with separate authorization for real order access. No integration or live order data is claimed |
| Reliability / security / scalability | Database constraints, signed ingestion, scoped access, recoverable jobs and race-safe approvals demonstrate these fundamentals. Hosted concurrency, operational alerts and production limits still need verification |

The job description informs stack alignment; it does not add requirements to the assignment.

## Verification of this redesign

- TypeScript/production build passed; all 32 integration/delivery/provider/receipt/stream tests passed, including lost-acknowledgment reconciliation, safe restoration of interrupted sends, bounded fallback, actual served-model recording, receipt isolation and monotonic timestamps.
- Desktop browser: customer chat and agent inbox inspected at 1242px viewport width.
- Browser using an isolated in-memory database and explicitly injected fixture generator: edited an agent draft, switched conversations and verified the edit survived, approved it, and verified the exact edited reply in the customer view. Unsent customer text survived switching views.
- A same-origin iframe on the test server exercised the actual app at a 320px viewport: inbox list, conversation, reply composer and Back to inbox navigation inspected. This fixture route is temporary test tooling, not included in the production server.
- Browser fixture results establish UI behavior only. Subsequent live Supabase/Auth/LLM verification is recorded separately in LIVE_VERIFICATION.md; model and free-tier availability can change.

Customer usability follow-up: demo controls now live in a closed settings menu; empty chats offer starter questions that fill, rather than send, the composer. Per-message Sending/Sent/Retry states use an outbox persisted for the browser tab and customer. A saved request ID reconciles responses lost in transit, preserving idempotent retries. A server-stop/restart browser check verified visible failure, automatic banner recovery and a single saved message after explicit retry. A 320x320 viewport verified that the composer remains visible with reduced vertical space; this simulates keyboard space and is not a physical-device keyboard test.
