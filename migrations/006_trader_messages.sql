-- v9 (owner's request, 7 Nov 2026): message the trader after a purchase or payment, on WhatsApp or the phone's own SMS.
-- 1) A trader can have several people (helpers who sell / collect money for him), each with a mobile number.
--    auto_send = this person gets the automatic message after a purchase/payment.
CREATE TABLE trader_contacts (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  trader_id   BIGINT NOT NULL REFERENCES traders(id),
  name        TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 60),
  mobile      TEXT NOT NULL CHECK (mobile ~ '^[6-9][0-9]{9}$'),
  note        TEXT,
  auto_send   BOOLEAN NOT NULL DEFAULT TRUE,
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  BIGINT REFERENCES users(id),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  BIGINT REFERENCES users(id)
);
CREATE INDEX trader_contacts_trader_idx ON trader_contacts(trader_id);
CREATE UNIQUE INDEX trader_contacts_active_mobile ON trader_contacts(trader_id, mobile) WHERE active;

-- 2) Existing trader phone numbers become the first person of that trader (only valid 10-digit mobiles).
INSERT INTO trader_contacts(trader_id, name, mobile, auto_send)
SELECT id, name, m, TRUE FROM (
  SELECT id, name, regexp_replace(regexp_replace(phone, '[^0-9]', '', 'g'), '^(91|0)(?=[0-9]{10}$)', '') AS m
    FROM traders WHERE phone IS NOT NULL
) x WHERE m ~ '^[6-9][0-9]{9}$';

-- 3) App-wide settings (owner only). messages = { auto, on_purchase, on_payment, signature }.
CREATE TABLE app_settings (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  BIGINT REFERENCES users(id)
);
INSERT INTO app_settings(key, value) VALUES ('messages', '{"auto": false, "on_purchase": true, "on_payment": true, "signature": "CMS"}');
