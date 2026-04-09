-- Phase-aware reason-to-template default mapping.
-- Each Shopify dispute reason can have one default template per dispute phase.
-- dispute_phase: 'inquiry' (review-first triage) or 'chargeback' (evidence-defense).
-- Mapping changes are non-retroactive: they affect future default selection only.

CREATE TABLE reason_template_mappings (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reason_code     text NOT NULL,
  dispute_phase   text NOT NULL CHECK (dispute_phase IN ('inquiry', 'chargeback')),
  template_id     uuid REFERENCES pack_templates(id) ON DELETE SET NULL,
  label           text NOT NULL,
  family          text NOT NULL,
  is_active       boolean NOT NULL DEFAULT true,
  notes           text,
  updated_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE(reason_code, dispute_phase)
);

CREATE INDEX idx_rtm_reason ON reason_template_mappings(reason_code);
CREATE INDEX idx_rtm_template ON reason_template_mappings(template_id);
CREATE INDEX idx_rtm_phase ON reason_template_mappings(dispute_phase);

ALTER TABLE reason_template_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full_access_reason_template_mappings"
  ON reason_template_mappings FOR ALL USING (true) WITH CHECK (true);

CREATE TRIGGER trg_rtm_updated_at
  BEFORE UPDATE ON reason_template_mappings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Seed all 14 Shopify dispute reasons for BOTH phases (28 rows).
-- Chargeback rows: is_active = true, template_id = NULL (unmapped, ready for admin config).
-- Inquiry rows: is_active = true, template_id = NULL (unmapped, ready for future config).

INSERT INTO reason_template_mappings (reason_code, dispute_phase, label, family) VALUES
  ('BANK_CANNOT_PROCESS',        'chargeback', 'Bank Cannot Process',        'Technical'),
  ('CREDIT_NOT_PROCESSED',       'chargeback', 'Credit Not Processed',       'Refund'),
  ('CUSTOMER_INITIATED',         'chargeback', 'Customer Initiated',         'General'),
  ('DEBIT_NOT_AUTHORIZED',       'chargeback', 'Debit Not Authorized',       'Authorization'),
  ('DUPLICATE',                  'chargeback', 'Duplicate',                  'Billing'),
  ('FRAUDULENT',                 'chargeback', 'Fraudulent',                 'Fraud'),
  ('GENERAL',                    'chargeback', 'General',                    'General'),
  ('INCORRECT_ACCOUNT_DETAILS',  'chargeback', 'Incorrect Account Details',  'Technical'),
  ('INSUFFICIENT_FUNDS',         'chargeback', 'Insufficient Funds',         'Billing'),
  ('NONCOMPLIANT',               'chargeback', 'Noncompliant',               'Compliance'),
  ('PRODUCT_NOT_RECEIVED',       'chargeback', 'Product Not Received',       'Fulfillment'),
  ('PRODUCT_UNACCEPTABLE',       'chargeback', 'Product Unacceptable',       'Quality'),
  ('SUBSCRIPTION_CANCELED',      'chargeback', 'Subscription Canceled',      'Subscription'),
  ('UNRECOGNIZED',               'chargeback', 'Unrecognized',               'Fraud'),
  ('BANK_CANNOT_PROCESS',        'inquiry', 'Bank Cannot Process',           'Technical'),
  ('CREDIT_NOT_PROCESSED',       'inquiry', 'Credit Not Processed',          'Refund'),
  ('CUSTOMER_INITIATED',         'inquiry', 'Customer Initiated',            'General'),
  ('DEBIT_NOT_AUTHORIZED',       'inquiry', 'Debit Not Authorized',          'Authorization'),
  ('DUPLICATE',                  'inquiry', 'Duplicate',                     'Billing'),
  ('FRAUDULENT',                 'inquiry', 'Fraudulent',                    'Fraud'),
  ('GENERAL',                    'inquiry', 'General',                       'General'),
  ('INCORRECT_ACCOUNT_DETAILS',  'inquiry', 'Incorrect Account Details',     'Technical'),
  ('INSUFFICIENT_FUNDS',         'inquiry', 'Insufficient Funds',            'Billing'),
  ('NONCOMPLIANT',               'inquiry', 'Noncompliant',                  'Compliance'),
  ('PRODUCT_NOT_RECEIVED',       'inquiry', 'Product Not Received',          'Fulfillment'),
  ('PRODUCT_UNACCEPTABLE',       'inquiry', 'Product Unacceptable',          'Quality'),
  ('SUBSCRIPTION_CANCELED',      'inquiry', 'Subscription Canceled',         'Subscription'),
  ('UNRECOGNIZED',               'inquiry', 'Unrecognized',                  'Fraud');
