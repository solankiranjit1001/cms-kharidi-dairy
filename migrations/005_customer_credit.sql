-- v8: ઉધાર (credit given to our customers). A separate book: it is NOT part of the day result,
-- purchases, trader accounts or any existing report (owner's decision).
CREATE TABLE customers (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name       TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  name_key   TEXT NOT NULL UNIQUE,
  phone      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by BIGINT REFERENCES users(id)
);

-- kind 'credit' = goods given on credit (has item lines); 'receipt' = money received back from the customer.
CREATE TABLE credit_entries (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entry_date  DATE NOT NULL,
  customer_id BIGINT NOT NULL REFERENCES customers(id),
  kind        TEXT NOT NULL CHECK (kind IN ('credit', 'receipt')),
  amount      NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  note        TEXT,
  client_id   UUID UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  BIGINT REFERENCES users(id),
  voided_at   TIMESTAMPTZ,
  voided_by   BIGINT REFERENCES users(id)
);
CREATE INDEX credit_entries_customer_idx ON credit_entries(customer_id, entry_date);

CREATE TABLE credit_lines (
  id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entry_id  BIGINT NOT NULL REFERENCES credit_entries(id) ON DELETE CASCADE,
  line_no   INT NOT NULL,
  item      TEXT NOT NULL CHECK (length(btrim(item)) BETWEEN 1 AND 60),
  qty       NUMERIC(12,3) NOT NULL CHECK (qty > 0),
  rate      NUMERIC(12,2) NOT NULL CHECK (rate >= 0),
  amount    NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
  UNIQUE (entry_id, line_no)
);
