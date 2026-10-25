-- v6: simple daily accounting.
-- Papa sells many items at many prices, so selling is no longer recorded item by item.
-- Instead, one total "amount received from customers" is typed for each day.
-- (Old per-item sales rows stay in the database and are still counted for their dates.)
CREATE TABLE day_sales (
  sale_date   DATE PRIMARY KEY,
  amount      NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  BIGINT REFERENCES users(id),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  BIGINT REFERENCES users(id)
);
