-- v10 (owner's request, 7 Nov 2026): ઘર ખર્ચ — the family's home income & expenses, like Khatabook's cash book.
-- A separate book: NOT part of the business day result, purchases, trader accounts or ઉધાર.
-- "head" = where the income came from / what the money was spent on (never a person's account).
CREATE TABLE home_entries (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entry_date  DATE NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('income', 'expense')),
  amount      NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  head        TEXT NOT NULL CHECK (length(btrim(head)) BETWEEN 1 AND 60),
  mode        TEXT NOT NULL DEFAULT 'રોકડ' CHECK (mode IN ('રોકડ', 'ઓનલાઇન')),
  note        TEXT,
  client_id   UUID UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  BIGINT REFERENCES users(id),
  updated_at  TIMESTAMPTZ,
  updated_by  BIGINT REFERENCES users(id),
  voided_at   TIMESTAMPTZ,
  voided_by   BIGINT REFERENCES users(id)
);
CREATE INDEX home_entries_date_idx ON home_entries(entry_date) WHERE voided_at IS NULL;
