-- Track when a shop wins their first chargeback dispute.
-- Used to trigger the feedback/rating banner in the embedded app.
ALTER TABLE shops ADD COLUMN IF NOT EXISTS first_win_at TIMESTAMPTZ;
