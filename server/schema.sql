CREATE TABLE IF NOT EXISTS brands (id text PRIMARY KEY);
INSERT INTO brands VALUES ('verdant-co') ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS agent_memberships (
  user_id text NOT NULL, brand_id text NOT NULL REFERENCES brands(id), PRIMARY KEY(user_id,brand_id)
);
CREATE TABLE IF NOT EXISTS customers (
  id uuid PRIMARY KEY, brand_id text NOT NULL REFERENCES brands(id), external_id text NOT NULL,
  name text NOT NULL, phone text NOT NULL, UNIQUE(brand_id,external_id), UNIQUE(id,brand_id)
);
CREATE TABLE IF NOT EXISTS conversations (
  id uuid PRIMARY KEY, brand_id text NOT NULL, customer_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed')),
  version integer NOT NULL DEFAULT 0, last_activity_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(customer_id,brand_id) REFERENCES customers(id,brand_id), UNIQUE(id,brand_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS one_open_conversation ON conversations(brand_id,customer_id) WHERE status='open';
CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY, brand_id text NOT NULL, conversation_id uuid NOT NULL,
  external_id text, sender text NOT NULL CHECK(sender IN ('customer','agent')), text text NOT NULL,
  source_at timestamptz NOT NULL, received_at timestamptz NOT NULL DEFAULT now(),
  sequence bigint GENERATED ALWAYS AS IDENTITY, agent_id text,
  FOREIGN KEY(conversation_id,brand_id) REFERENCES conversations(id,brand_id),
  UNIQUE(brand_id,external_id), UNIQUE(id,brand_id)
);
CREATE INDEX IF NOT EXISTS conversation_messages ON messages(conversation_id,sequence);
CREATE INDEX IF NOT EXISTS conversation_activity ON conversations(brand_id,last_activity_at DESC);
CREATE TABLE IF NOT EXISTS webhook_events (
  brand_id text NOT NULL REFERENCES brands(id), event_id text NOT NULL, payload_hash text NOT NULL,
  message_id uuid NOT NULL REFERENCES messages(id), received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(brand_id,event_id)
);
CREATE TABLE IF NOT EXISTS drafts (
  id uuid PRIMARY KEY, brand_id text NOT NULL, conversation_id uuid NOT NULL,
  trigger_message_id uuid NOT NULL UNIQUE REFERENCES messages(id),
  state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','generating','ready','failed','used')),
  original_text text, policy_ids jsonb NOT NULL DEFAULT '[]', needs_review boolean NOT NULL DEFAULT false,
  reason_code text, context_version integer NOT NULL, model text, kb_version text NOT NULL DEFAULT '2026-01',
  prompt_version text NOT NULL DEFAULT 'v1', approved_message_id uuid UNIQUE REFERENCES messages(id),
  approved_by text, approved_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(conversation_id,brand_id) REFERENCES conversations(id,brand_id)
);
CREATE TABLE IF NOT EXISTS draft_jobs (
  id uuid PRIMARY KEY, draft_id uuid NOT NULL UNIQUE REFERENCES drafts(id),
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','done','failed')),
  attempts integer NOT NULL DEFAULT 0, next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz, claim_token uuid, error_code text, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS due_draft_jobs ON draft_jobs(status,next_attempt_at);
CREATE TABLE IF NOT EXISTS message_receipts (
  message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  recipient_type text NOT NULL CHECK(recipient_type IN ('customer','agent')),
  recipient_id text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  read_at timestamptz,
  PRIMARY KEY(message_id,recipient_type,recipient_id),
  CHECK(read_at IS NULL OR read_at >= received_at)
);
-- API owns access. No direct browser table access is granted, including on Supabase.
ALTER TABLE brands ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE draft_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_receipts ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON brands,agent_memberships,customers,conversations,messages,webhook_events,drafts,draft_jobs,message_receipts FROM anon,authenticated;
  END IF;
END $$;
