-- v6.1: per purchase line — number of mudda (parcels) and whether the 6% commission is
-- already included in the rate ("ભેગું") or must be added on top ("અલગ").
-- amount = qty × rate + commission_amount  (so bill totals and trader balances include the commission).
ALTER TABLE purchase_lines
  ADD COLUMN mudda INT CHECK (mudda IS NULL OR mudda >= 0),
  ADD COLUMN commission_excl BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN commission_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (commission_amount >= 0);
