-- CMS ખરીદી ડાયરી — initial schema
-- Money: NUMERIC(14,2) rupees. Quantity: NUMERIC(12,3) in the vegetable's unit.
-- Financial rows are never hard-deleted: they are voided (voided_at/voided_by/void_reason).

CREATE TABLE users (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name          TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 60),
  mobile        TEXT NOT NULL UNIQUE CHECK (mobile ~ '^[6-9][0-9]{9}$'),
  pin_hash      TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('owner','entry','viewer')),
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  failed_attempts INT NOT NULL DEFAULT 0,
  locked_until  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   TEXT NOT NULL UNIQUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL,
  user_agent   TEXT
);
CREATE INDEX sessions_user_idx ON sessions(user_id);

CREATE TABLE auth_failures (
  id  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ip  TEXT NOT NULL,
  at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX auth_failures_ip_at_idx ON auth_failures(ip, at);

CREATE TABLE vegetables (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name       TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 60),
  name_key   TEXT NOT NULL UNIQUE,
  unit       TEXT NOT NULL DEFAULT 'kg' CHECK (unit IN ('kg','નંગ','ડઝન','મણ','બોક્સ','થેલી','જુડી')),
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by BIGINT REFERENCES users(id)
);

CREATE TABLE traders (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name            TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  name_key        TEXT NOT NULL UNIQUE,
  phone           TEXT CHECK (phone IS NULL OR phone ~ '^[0-9+ -]{6,16}$'),
  -- positive = we owe the trader; negative = advance paid to the trader
  opening_balance NUMERIC(14,2) NOT NULL DEFAULT 0,
  note            TEXT,
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      BIGINT REFERENCES users(id),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by      BIGINT REFERENCES users(id)
);

-- Columns shared by every financial / stock record table.
-- (written out per table; Postgres has no table inheritance we want here)

CREATE TABLE purchases (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entry_date   DATE NOT NULL,
  trader_id    BIGINT NOT NULL REFERENCES traders(id),
  bill_no      TEXT,
  note         TEXT,
  total_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  client_id    UUID UNIQUE,
  import_key   TEXT UNIQUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by   BIGINT REFERENCES users(id),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by   BIGINT REFERENCES users(id),
  voided_at    TIMESTAMPTZ,
  voided_by    BIGINT REFERENCES users(id),
  void_reason  TEXT
);
CREATE INDEX purchases_date_idx ON purchases(entry_date);
CREATE INDEX purchases_trader_idx ON purchases(trader_id);

CREATE TABLE purchase_lines (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  purchase_id  BIGINT NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  line_no      INT NOT NULL,
  vegetable_id BIGINT NOT NULL REFERENCES vegetables(id),
  qty          NUMERIC(12,3) NOT NULL CHECK (qty > 0),
  rate         NUMERIC(12,2) NOT NULL CHECK (rate >= 0),
  amount       NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
  UNIQUE (purchase_id, line_no)
);
CREATE INDEX purchase_lines_veg_idx ON purchase_lines(vegetable_id);

CREATE TABLE sales (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entry_date   DATE NOT NULL,
  vegetable_id BIGINT NOT NULL REFERENCES vegetables(id),
  qty          NUMERIC(12,3) NOT NULL CHECK (qty > 0),
  rate         NUMERIC(12,2) NOT NULL CHECK (rate >= 0),
  gross        NUMERIC(14,2) NOT NULL CHECK (gross >= 0),
  discount     NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (discount >= 0),
  amount       NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
  payment_mode TEXT NOT NULL DEFAULT 'રોકડ' CHECK (payment_mode IN ('રોકડ','UPI','બેંક','અન્ય')),
  customer     TEXT,
  note         TEXT,
  client_id    UUID UNIQUE,
  import_key   TEXT UNIQUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by   BIGINT REFERENCES users(id),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by   BIGINT REFERENCES users(id),
  voided_at    TIMESTAMPTZ,
  voided_by    BIGINT REFERENCES users(id),
  void_reason  TEXT,
  CHECK (discount <= gross),
  CHECK (amount = gross - discount)
);
CREATE INDEX sales_date_idx ON sales(entry_date);
CREATE INDEX sales_veg_idx ON sales(vegetable_id);

CREATE TABLE waste (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entry_date   DATE NOT NULL,
  vegetable_id BIGINT NOT NULL REFERENCES vegetables(id),
  qty          NUMERIC(12,3) NOT NULL CHECK (qty > 0),
  est_rate     NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (est_rate >= 0),
  reason       TEXT NOT NULL,
  client_id    UUID UNIQUE,
  import_key   TEXT UNIQUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by   BIGINT REFERENCES users(id),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by   BIGINT REFERENCES users(id),
  voided_at    TIMESTAMPTZ,
  voided_by    BIGINT REFERENCES users(id),
  void_reason  TEXT
);
CREATE INDEX waste_date_idx ON waste(entry_date);
CREATE INDEX waste_veg_idx ON waste(vegetable_id);

CREATE TABLE purchase_returns (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entry_date   DATE NOT NULL,
  trader_id    BIGINT NOT NULL REFERENCES traders(id),
  vegetable_id BIGINT NOT NULL REFERENCES vegetables(id),
  qty          NUMERIC(12,3) NOT NULL CHECK (qty > 0),
  rate         NUMERIC(12,2) NOT NULL CHECK (rate >= 0),
  amount       NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
  note         TEXT,
  client_id    UUID UNIQUE,
  import_key   TEXT UNIQUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by   BIGINT REFERENCES users(id),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by   BIGINT REFERENCES users(id),
  voided_at    TIMESTAMPTZ,
  voided_by    BIGINT REFERENCES users(id),
  void_reason  TEXT
);
CREATE INDEX purchase_returns_date_idx ON purchase_returns(entry_date);
CREATE INDEX purchase_returns_trader_idx ON purchase_returns(trader_id);

CREATE TABLE stock_adjustments (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entry_date   DATE NOT NULL,
  vegetable_id BIGINT NOT NULL REFERENCES vegetables(id),
  qty          NUMERIC(12,3) NOT NULL CHECK (qty <> 0),
  reason       TEXT NOT NULL CHECK (length(btrim(reason)) >= 2),
  client_id    UUID UNIQUE,
  import_key   TEXT UNIQUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by   BIGINT REFERENCES users(id),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by   BIGINT REFERENCES users(id),
  voided_at    TIMESTAMPTZ,
  voided_by    BIGINT REFERENCES users(id),
  void_reason  TEXT
);
CREATE INDEX stock_adjustments_date_idx ON stock_adjustments(entry_date);

CREATE TABLE stock_counts (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  count_date     DATE NOT NULL,
  vegetable_id   BIGINT NOT NULL REFERENCES vegetables(id),
  calculated_qty NUMERIC(12,3),
  physical_qty   NUMERIC(12,3) NOT NULL CHECK (physical_qty >= 0),
  note           TEXT,
  import_key     TEXT UNIQUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by     BIGINT REFERENCES users(id),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by     BIGINT REFERENCES users(id),
  UNIQUE (count_date, vegetable_id)
);

-- Manually entered closing stock value (₹) per day (owner's decision: typed daily).
CREATE TABLE day_closings (
  close_date          DATE PRIMARY KEY,
  closing_stock_value NUMERIC(14,2) NOT NULL CHECK (closing_stock_value >= 0),
  note                TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by          BIGINT REFERENCES users(id),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by          BIGINT REFERENCES users(id)
);

CREATE TABLE payments (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entry_date  DATE NOT NULL,
  trader_id   BIGINT NOT NULL REFERENCES traders(id),
  amount      NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  method      TEXT NOT NULL CHECK (method IN ('રોકડ','UPI','બેંક','ચેક','અન્ય')),
  reference   TEXT,
  note        TEXT,
  purchase_id BIGINT REFERENCES purchases(id),
  client_id   UUID UNIQUE,
  import_key  TEXT UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  BIGINT REFERENCES users(id),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  BIGINT REFERENCES users(id),
  voided_at   TIMESTAMPTZ,
  voided_by   BIGINT REFERENCES users(id),
  void_reason TEXT
);
CREATE INDEX payments_date_idx ON payments(entry_date);
CREATE INDEX payments_trader_idx ON payments(trader_id);
CREATE INDEX payments_purchase_idx ON payments(purchase_id);

CREATE TABLE trader_adjustments (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entry_date  DATE NOT NULL,
  trader_id   BIGINT NOT NULL REFERENCES traders(id),
  -- positive increases what we owe, negative decreases it
  amount      NUMERIC(14,2) NOT NULL CHECK (amount <> 0),
  reason      TEXT NOT NULL CHECK (length(btrim(reason)) >= 2),
  client_id   UUID UNIQUE,
  import_key  TEXT UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  BIGINT REFERENCES users(id),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  BIGINT REFERENCES users(id),
  voided_at   TIMESTAMPTZ,
  voided_by   BIGINT REFERENCES users(id),
  void_reason TEXT
);
CREATE INDEX trader_adjustments_trader_idx ON trader_adjustments(trader_id);

CREATE TABLE expenses (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entry_date  DATE NOT NULL,
  category    TEXT NOT NULL CHECK (length(btrim(category)) BETWEEN 1 AND 40),
  amount      NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  note        TEXT,
  purchase_id BIGINT REFERENCES purchases(id),
  client_id   UUID UNIQUE,
  import_key  TEXT UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  BIGINT REFERENCES users(id),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  BIGINT REFERENCES users(id),
  voided_at   TIMESTAMPTZ,
  voided_by   BIGINT REFERENCES users(id),
  void_reason TEXT
);
CREATE INDEX expenses_date_idx ON expenses(entry_date);

CREATE TABLE market_prices (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  obs_date     DATE NOT NULL,
  market       TEXT NOT NULL CHECK (length(btrim(market)) BETWEEN 1 AND 40),
  vegetable_id BIGINT NOT NULL REFERENCES vegetables(id),
  unit         TEXT NOT NULL DEFAULT 'kg',
  price        NUMERIC(12,2) NOT NULL CHECK (price >= 0),
  grade        TEXT,
  source       TEXT,
  client_id    UUID UNIQUE,
  import_key   TEXT UNIQUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by   BIGINT REFERENCES users(id),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by   BIGINT REFERENCES users(id),
  voided_at    TIMESTAMPTZ,
  voided_by    BIGINT REFERENCES users(id),
  void_reason  TEXT
);
CREATE INDEX market_prices_veg_date_idx ON market_prices(vegetable_id, obs_date);

CREATE TABLE plans (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  plan_date    DATE NOT NULL,
  vegetable_id BIGINT NOT NULL REFERENCES vegetables(id),
  qty          NUMERIC(12,3) CHECK (qty IS NULL OR qty >= 0),
  rate         NUMERIC(12,2) CHECK (rate IS NULL OR rate >= 0),
  note         TEXT,
  client_id    UUID UNIQUE,
  import_key   TEXT UNIQUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by   BIGINT REFERENCES users(id),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by   BIGINT REFERENCES users(id),
  voided_at    TIMESTAMPTZ,
  voided_by    BIGINT REFERENCES users(id),
  void_reason  TEXT
);
CREATE INDEX plans_date_idx ON plans(plan_date);

CREATE TABLE audit_log (
  id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id   BIGINT REFERENCES users(id),
  action    TEXT NOT NULL,
  entity    TEXT NOT NULL,
  entity_id TEXT,
  before    JSONB,
  after     JSONB,
  reason    TEXT
);
CREATE INDEX audit_log_entity_idx ON audit_log(entity, entity_id);
CREATE INDEX audit_log_at_idx ON audit_log(at);

CREATE TABLE import_batches (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by BIGINT REFERENCES users(id),
  source     TEXT NOT NULL,
  file_hash  TEXT NOT NULL,
  summary    JSONB NOT NULL
);

-- Every quantity movement, excluding voided records. Positive = into stock.
CREATE VIEW stock_moves AS
  SELECT pl.vegetable_id, p.entry_date AS d, pl.qty AS qty, 'purchase'::text AS kind
    FROM purchase_lines pl JOIN purchases p ON p.id = pl.purchase_id WHERE p.voided_at IS NULL
  UNION ALL
  SELECT vegetable_id, entry_date, -qty, 'sale' FROM sales WHERE voided_at IS NULL
  UNION ALL
  SELECT vegetable_id, entry_date, -qty, 'waste' FROM waste WHERE voided_at IS NULL
  UNION ALL
  SELECT vegetable_id, entry_date, -qty, 'return' FROM purchase_returns WHERE voided_at IS NULL
  UNION ALL
  SELECT vegetable_id, entry_date, qty, 'adjust' FROM stock_adjustments WHERE voided_at IS NULL;
