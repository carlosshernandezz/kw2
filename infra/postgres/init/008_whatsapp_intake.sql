BEGIN;

CREATE TABLE IF NOT EXISTS whatsapp_reporters (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  operator_id bigint REFERENCES operators(id),
  display_name text NOT NULL,
  phone_e164 text NOT NULL UNIQUE CHECK (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS whatsapp_messages (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  whatsapp_message_id text NOT NULL UNIQUE,
  phone_number_id text,
  sender_wa_id text NOT NULL,
  sender_profile_name text,
  reporter_id bigint REFERENCES whatsapp_reporters(id),
  message_type text NOT NULL,
  message_text text,
  media_id text,
  media_mime_type text,
  media_sha256 text,
  media_storage_key text,
  reply_to_message_id text,
  received_at timestamptz NOT NULL,
  processing_status text NOT NULL DEFAULT 'received'
    CHECK (processing_status IN ('received', 'media_downloaded', 'ready', 'needs_review', 'processed', 'ignored', 'failed')),
  processing_error text,
  raw_payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS operation_intakes (
  id bigint GENERATED ALWAYS AS IDENTITY (START WITH 1000) PRIMARY KEY,
  whatsapp_message_id bigint NOT NULL UNIQUE REFERENCES whatsapp_messages(id),
  reported_by_id bigint REFERENCES whatsapp_reporters(id),
  reported_for text,
  source_text text,
  status text NOT NULL DEFAULT 'received'
    CHECK (status IN ('received', 'interpreting', 'needs_information', 'ready_for_review', 'approved', 'rejected', 'failed')),
  extracted_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  confidence numeric(5,4) CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_received
  ON whatsapp_messages (received_at DESC);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_status
  ON whatsapp_messages (processing_status, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_operation_intakes_status
  ON operation_intakes (status, created_at DESC);

INSERT INTO schema_migrations (version)
VALUES ('008_whatsapp_intake')
ON CONFLICT (version) DO NOTHING;

COMMIT;
