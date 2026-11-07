-- v9.2 (owner's request, 7 Nov 2026): ઉધાર customers can be renamed and deleted; entries can be edited.
-- A deleted customer is kept (hidden) with all his entries marked removed, so nothing is lost by mistake.
ALTER TABLE customers ADD COLUMN deleted_at TIMESTAMPTZ;
ALTER TABLE customers ADD COLUMN deleted_by BIGINT REFERENCES users(id);
ALTER TABLE customers ADD COLUMN updated_at TIMESTAMPTZ;
ALTER TABLE customers ADD COLUMN updated_by BIGINT REFERENCES users(id);
ALTER TABLE credit_entries ADD COLUMN updated_at TIMESTAMPTZ;
ALTER TABLE credit_entries ADD COLUMN updated_by BIGINT REFERENCES users(id);
