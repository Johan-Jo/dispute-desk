-- 019: Seed global pack templates (10 templates)
-- Each template includes: i18n (en-US + fr-FR for >=4), sections, and items.

-- ─── Helper: deterministic UUIDs for cross-referencing ──────────────
-- We use fixed UUIDs so sections can reference their template and items
-- can reference their section within a single migration.

-- ═══════════════════════════════════════════════════════════════════════
-- TEMPLATE 1: Fraudulent / Unrecognized — Standard (recommended)
-- ═══════════════════════════════════════════════════════════════════════

INSERT INTO pack_templates (id, slug, dispute_type, is_recommended)
VALUES ('a0000000-0000-0000-0000-000000000001', 'fraud_standard', 'FRAUD', true);

INSERT INTO pack_template_i18n (template_id, locale, name, short_description, works_best_for, preview_note) VALUES
('a0000000-0000-0000-0000-000000000001', 'en-US',
 'Fraudulent / Unrecognized — Standard',
 'Comprehensive evidence package for fraudulent or unrecognized transaction disputes. Covers AVS match, IP geolocation, delivery confirmation, and customer interaction history.',
 'Chargebacks where the cardholder claims they did not authorize the transaction.',
 'Includes sections for order verification, delivery proof, and customer communication logs.'),
('a0000000-0000-0000-0000-000000000001', 'fr-FR',
 'Fraude / Non reconnu — Standard',
 'Pack de preuves complet pour les litiges de transactions frauduleuses ou non reconnues. Couvre la correspondance AVS, la géolocalisation IP, la confirmation de livraison et l''historique des interactions client.',
 'Contestations où le titulaire de la carte prétend ne pas avoir autorisé la transaction.',
 NULL);

-- Sections
INSERT INTO pack_template_sections (id, template_id, title_key, title_default, sort) VALUES
('b0000000-0001-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'section_order_verification', 'Order Verification', 0),
('b0000000-0001-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'section_delivery_proof', 'Delivery Proof', 1),
('b0000000-0001-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 'section_customer_comms', 'Customer Communication', 2);

-- Items
INSERT INTO pack_template_items (template_section_id, item_type, key, label_default, required, guidance_default, sort) VALUES
('b0000000-0001-0000-0000-000000000001', 'DOC_REQUIREMENT', 'order_confirmation', 'Order confirmation', true, 'Order number, date, items, and billing address.', 0),
('b0000000-0001-0000-0000-000000000001', 'DOC_REQUIREMENT', 'avs_cvv_match', 'AVS/CVV verification result', true, 'Screenshot from payment gateway showing AVS and CVV match status.', 1),
('b0000000-0001-0000-0000-000000000001', 'DOC_REQUIREMENT', 'ip_geolocation', 'IP geolocation data', false, 'Show IP address used at checkout maps to cardholder region.', 2),
('b0000000-0001-0000-0000-000000000001', 'NOTE', 'device_fingerprint', 'Device fingerprint or prior purchase history', false, 'If available, include device ID match with previous legitimate orders.', 3),
('b0000000-0001-0000-0000-000000000002', 'DOC_REQUIREMENT', 'tracking_proof', 'Shipping tracking confirmation', true, 'Carrier tracking showing delivery to the address on the order.', 0),
('b0000000-0001-0000-0000-000000000002', 'DOC_REQUIREMENT', 'delivery_signature', 'Delivery signature or photo', false, 'Signature confirmation or carrier delivery photo if available.', 1),
('b0000000-0001-0000-0000-000000000003', 'DOC_REQUIREMENT', 'customer_emails', 'Customer correspondence', false, 'Any messages exchanged with the customer regarding this order.', 0),
('b0000000-0001-0000-0000-000000000003', 'DOC_REQUIREMENT', 'customer_account_info', 'Customer account details', false, 'Account creation date, login history, previous orders from same account.', 1);


-- ═══════════════════════════════════════════════════════════════════════
-- TEMPLATE 2: Product Not Received — With Tracking (recommended)
-- ═══════════════════════════════════════════════════════════════════════

INSERT INTO pack_templates (id, slug, dispute_type, is_recommended)
VALUES ('a0000000-0000-0000-0000-000000000002', 'pnr_with_tracking', 'PNR', true);

INSERT INTO pack_template_i18n (template_id, locale, name, short_description, works_best_for, preview_note) VALUES
('a0000000-0000-0000-0000-000000000002', 'en-US',
 'Product Not Received — With Tracking',
 'Strong evidence package for PNR disputes when you have carrier tracking showing delivery. Focuses on tracking proof, delivery confirmation, and shipping timeline.',
 'Disputes where the customer claims non-delivery but tracking shows successful delivery.',
 'Best win-rate template for PNR when tracking data is available.'),
('a0000000-0000-0000-0000-000000000002', 'fr-FR',
 'Produit non reçu — Avec suivi',
 'Pack de preuves solide pour les litiges PNR lorsque vous disposez du suivi transporteur montrant la livraison. Axé sur la preuve de suivi, la confirmation de livraison et le calendrier d''expédition.',
 'Litiges où le client prétend ne pas avoir reçu le produit mais le suivi montre une livraison réussie.',
 NULL);

INSERT INTO pack_template_sections (id, template_id, title_key, title_default, sort) VALUES
('b0000000-0002-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000002', 'section_order_basics', 'Order Basics', 0),
('b0000000-0002-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000002', 'section_shipping_tracking', 'Shipping & Tracking', 1),
('b0000000-0002-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000002', 'section_delivery_confirmation', 'Delivery Confirmation', 2),
('b0000000-0002-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000002', 'section_customer_comms', 'Customer Communication', 3);

INSERT INTO pack_template_items (template_section_id, item_type, key, label_default, required, guidance_default, sort) VALUES
('b0000000-0002-0000-0000-000000000001', 'DOC_REQUIREMENT', 'order_confirmation', 'Order confirmation', true, 'Include order number, date, items, and shipping address.', 0),
('b0000000-0002-0000-0000-000000000001', 'DOC_REQUIREMENT', 'billing_shipping_match', 'Billing/shipping address comparison', false, 'Show billing and shipping addresses match or explain discrepancy.', 1),
('b0000000-0002-0000-0000-000000000002', 'DOC_REQUIREMENT', 'tracking_number', 'Carrier tracking number & timeline', true, 'Full tracking history from carrier showing shipment to delivery.', 0),
('b0000000-0002-0000-0000-000000000002', 'DOC_REQUIREMENT', 'carrier_confirmation', 'Carrier delivery confirmation page', true, 'Screenshot of carrier website showing "Delivered" status.', 1),
('b0000000-0002-0000-0000-000000000003', 'DOC_REQUIREMENT', 'delivery_photo', 'Delivery photo or signature', false, 'Proof of delivery image or signed receipt from carrier.', 0),
('b0000000-0002-0000-0000-000000000003', 'DOC_REQUIREMENT', 'delivery_address_match', 'Address match confirmation', true, 'Show delivery address matches the shipping address on the order.', 1),
('b0000000-0002-0000-0000-000000000004', 'DOC_REQUIREMENT', 'customer_emails', 'Customer correspondence', false, 'Any post-purchase emails or messages exchanged with customer.', 0);


-- ═══════════════════════════════════════════════════════════════════════
-- TEMPLATE 3: Product Not Received — No Tracking / Weak Proof
-- ═══════════════════════════════════════════════════════════════════════

INSERT INTO pack_templates (id, slug, dispute_type, is_recommended)
VALUES ('a0000000-0000-0000-0000-000000000003', 'pnr_weak_proof', 'PNR', false);

INSERT INTO pack_template_i18n (template_id, locale, name, short_description, works_best_for) VALUES
('a0000000-0000-0000-0000-000000000003', 'en-US',
 'Product Not Received — No Tracking / Weak Proof',
 'Evidence package for PNR disputes where tracking data is unavailable or incomplete. Relies on shipping receipts, policy documentation, and customer interaction records.',
 'PNR disputes with missing or limited shipping documentation.');

INSERT INTO pack_template_sections (id, template_id, title_key, title_default, sort) VALUES
('b0000000-0003-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000003', 'section_order_basics', 'Order Basics', 0),
('b0000000-0003-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000003', 'section_shipping_evidence', 'Available Shipping Evidence', 1),
('b0000000-0003-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000003', 'section_policies', 'Policies & Terms', 2);

INSERT INTO pack_template_items (template_section_id, item_type, key, label_default, required, guidance_default, sort) VALUES
('b0000000-0003-0000-0000-000000000001', 'DOC_REQUIREMENT', 'order_confirmation', 'Order confirmation', true, 'Order number, date, items, and addresses.', 0),
('b0000000-0003-0000-0000-000000000001', 'DOC_REQUIREMENT', 'payment_receipt', 'Payment processing receipt', true, 'Gateway transaction record showing successful charge.', 1),
('b0000000-0003-0000-0000-000000000002', 'DOC_REQUIREMENT', 'shipping_receipt', 'Shipping receipt or label', true, 'Proof that the order was shipped (label, receipt, manifest).', 0),
('b0000000-0003-0000-0000-000000000002', 'DOC_REQUIREMENT', 'partial_tracking', 'Partial tracking data (if any)', false, 'Any available carrier scans, even if incomplete.', 1),
('b0000000-0003-0000-0000-000000000002', 'NOTE', 'shipping_method_note', 'Note: explain shipping method used', false, 'Describe the shipping method and why full tracking may be unavailable.', 2),
('b0000000-0003-0000-0000-000000000003', 'DOC_REQUIREMENT', 'shipping_policy', 'Shipping policy', true, 'Published shipping policy from your store.', 0),
('b0000000-0003-0000-0000-000000000003', 'DOC_REQUIREMENT', 'terms_of_service', 'Terms of service', false, 'Relevant terms the customer agreed to at checkout.', 1);


-- ═══════════════════════════════════════════════════════════════════════
-- TEMPLATE 4: Not as Described — Quality Issues (recommended)
-- ═══════════════════════════════════════════════════════════════════════

INSERT INTO pack_templates (id, slug, dispute_type, is_recommended)
VALUES ('a0000000-0000-0000-0000-000000000004', 'not_as_described_quality', 'NOT_AS_DESCRIBED', true);

INSERT INTO pack_template_i18n (template_id, locale, name, short_description, works_best_for) VALUES
('a0000000-0000-0000-0000-000000000004', 'en-US',
 'Not as Described — Quality Issues',
 'Evidence package for disputes claiming the product does not match its description or has quality defects. Focuses on product listing accuracy, quality control, and return policy compliance.',
 'Disputes where customers claim the product differs from what was advertised.'),
('a0000000-0000-0000-0000-000000000004', 'fr-FR',
 'Non conforme à la description — Problèmes de qualité',
 'Pack de preuves pour les litiges alléguant que le produit ne correspond pas à sa description ou présente des défauts de qualité. Axé sur l''exactitude de l''annonce, le contrôle qualité et le respect de la politique de retour.',
 'Litiges où les clients prétendent que le produit diffère de ce qui était annoncé.');

INSERT INTO pack_template_sections (id, template_id, title_key, title_default, sort) VALUES
('b0000000-0004-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000004', 'section_product_listing', 'Product Listing & Description', 0),
('b0000000-0004-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000004', 'section_fulfillment', 'Fulfillment & Delivery', 1),
('b0000000-0004-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000004', 'section_returns_refund', 'Returns & Refund Policy', 2),
('b0000000-0004-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000004', 'section_customer_comms', 'Customer Communication', 3);

INSERT INTO pack_template_items (template_section_id, item_type, key, label_default, required, guidance_default, sort) VALUES
('b0000000-0004-0000-0000-000000000001', 'DOC_REQUIREMENT', 'product_page_screenshot', 'Product page screenshot', true, 'Screenshot of the product listing as it appeared at time of purchase.', 0),
('b0000000-0004-0000-0000-000000000001', 'DOC_REQUIREMENT', 'product_description', 'Product description text', true, 'Full product description, specifications, and any disclaimers.', 1),
('b0000000-0004-0000-0000-000000000001', 'DOC_REQUIREMENT', 'product_photos', 'Product photographs', false, 'Photos of the actual product shipped (quality control images).', 2),
('b0000000-0004-0000-0000-000000000002', 'DOC_REQUIREMENT', 'packing_slip', 'Packing slip / invoice', true, 'Document showing items packed and shipped match the order.', 0),
('b0000000-0004-0000-0000-000000000002', 'DOC_REQUIREMENT', 'tracking_proof', 'Delivery tracking', false, 'Carrier tracking showing successful delivery.', 1),
('b0000000-0004-0000-0000-000000000003', 'DOC_REQUIREMENT', 'return_policy', 'Return / refund policy', true, 'Published policy that was active at the time of purchase.', 0),
('b0000000-0004-0000-0000-000000000003', 'NOTE', 'return_offered_note', 'Note: was a return or exchange offered?', false, 'Document whether you offered a return, exchange, or partial refund.', 1),
('b0000000-0004-0000-0000-000000000004', 'DOC_REQUIREMENT', 'customer_emails', 'Customer correspondence', false, 'Emails or messages discussing the product quality concern.', 0);


-- ═══════════════════════════════════════════════════════════════════════
-- TEMPLATE 5: Subscription Canceled — Comprehensive (recommended)
-- ═══════════════════════════════════════════════════════════════════════

INSERT INTO pack_templates (id, slug, dispute_type, is_recommended)
VALUES ('a0000000-0000-0000-0000-000000000005', 'subscription_canceled', 'SUBSCRIPTION', true);

INSERT INTO pack_template_i18n (template_id, locale, name, short_description, works_best_for) VALUES
('a0000000-0000-0000-0000-000000000005', 'en-US',
 'Subscription Canceled — Comprehensive',
 'Evidence package for subscription-related disputes. Covers subscription terms, cancellation policy compliance, usage logs, and notification history.',
 'Disputes involving recurring charges after the customer claims they canceled their subscription.'),
('a0000000-0000-0000-0000-000000000005', 'fr-FR',
 'Abonnement résilié — Complet',
 'Pack de preuves pour les litiges liés aux abonnements. Couvre les conditions d''abonnement, le respect de la politique d''annulation, les journaux d''utilisation et l''historique des notifications.',
 'Litiges impliquant des frais récurrents après que le client prétend avoir résilié son abonnement.');

INSERT INTO pack_template_sections (id, template_id, title_key, title_default, sort) VALUES
('b0000000-0005-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000005', 'section_subscription_terms', 'Subscription Terms', 0),
('b0000000-0005-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000005', 'section_usage_activity', 'Usage & Activity', 1),
('b0000000-0005-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000005', 'section_cancellation', 'Cancellation & Notifications', 2);

INSERT INTO pack_template_items (template_section_id, item_type, key, label_default, required, guidance_default, sort) VALUES
('b0000000-0005-0000-0000-000000000001', 'DOC_REQUIREMENT', 'subscription_agreement', 'Subscription agreement / terms', true, 'The terms the customer agreed to when subscribing, including billing cycle and cancellation policy.', 0),
('b0000000-0005-0000-0000-000000000001', 'DOC_REQUIREMENT', 'signup_confirmation', 'Sign-up confirmation', true, 'Email or receipt confirming the customer enrolled in the subscription.', 1),
('b0000000-0005-0000-0000-000000000001', 'DOC_REQUIREMENT', 'billing_history', 'Billing history', false, 'Record of past successful charges on this subscription.', 2),
('b0000000-0005-0000-0000-000000000002', 'DOC_REQUIREMENT', 'usage_logs', 'Service usage logs', true, 'Evidence the customer used the service/product after the disputed charge date.', 0),
('b0000000-0005-0000-0000-000000000002', 'DOC_REQUIREMENT', 'login_activity', 'Login / access activity', false, 'Account login records showing continued access.', 1),
('b0000000-0005-0000-0000-000000000003', 'DOC_REQUIREMENT', 'cancellation_policy', 'Cancellation policy', true, 'Published cancellation policy and required notice period.', 0),
('b0000000-0005-0000-0000-000000000003', 'DOC_REQUIREMENT', 'renewal_notifications', 'Renewal notification emails', false, 'Emails sent before renewal reminding the customer of upcoming charges.', 1),
('b0000000-0005-0000-0000-000000000003', 'NOTE', 'cancellation_status_note', 'Note: cancellation request status', false, 'Document whether a cancellation was received and when, or that no cancellation was submitted.', 2);


-- ═══════════════════════════════════════════════════════════════════════
-- TEMPLATE 6: Refund / Credit Not Processed — Standard
-- ═══════════════════════════════════════════════════════════════════════

INSERT INTO pack_templates (id, slug, dispute_type, is_recommended)
VALUES ('a0000000-0000-0000-0000-000000000006', 'credit_not_processed', 'REFUND', false);

INSERT INTO pack_template_i18n (template_id, locale, name, short_description, works_best_for) VALUES
('a0000000-0000-0000-0000-000000000006', 'en-US',
 'Refund / Credit Not Processed — Standard',
 'Evidence package for disputes claiming a promised refund or credit was not issued. Focuses on refund policy, processing records, and communication trail.',
 'Disputes where the customer claims a refund was promised but not received.');

INSERT INTO pack_template_sections (id, template_id, title_key, title_default, sort) VALUES
('b0000000-0006-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000006', 'section_refund_policy', 'Refund Policy & Terms', 0),
('b0000000-0006-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000006', 'section_processing_records', 'Processing Records', 1),
('b0000000-0006-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000006', 'section_customer_comms', 'Customer Communication', 2);

INSERT INTO pack_template_items (template_section_id, item_type, key, label_default, required, guidance_default, sort) VALUES
('b0000000-0006-0000-0000-000000000001', 'DOC_REQUIREMENT', 'refund_policy', 'Refund / return policy', true, 'Published refund policy active at time of purchase.', 0),
('b0000000-0006-0000-0000-000000000001', 'DOC_REQUIREMENT', 'terms_acceptance', 'Proof customer accepted terms', false, 'Checkbox confirmation, click-wrap, or terms page the customer saw.', 1),
('b0000000-0006-0000-0000-000000000002', 'DOC_REQUIREMENT', 'refund_receipt', 'Refund transaction receipt', true, 'Payment gateway record showing the refund was processed, with date and amount.', 0),
('b0000000-0006-0000-0000-000000000002', 'DOC_REQUIREMENT', 'credit_statement', 'Credit / store credit record', false, 'If a store credit was issued instead of a refund, provide the record.', 1),
('b0000000-0006-0000-0000-000000000002', 'NOTE', 'processing_timeline_note', 'Note: refund processing timeline', false, 'Explain typical refund processing time and whether it falls within that window.', 2),
('b0000000-0006-0000-0000-000000000003', 'DOC_REQUIREMENT', 'customer_emails', 'Customer correspondence about refund', true, 'Emails discussing the refund request and any responses sent.', 0);


-- ═══════════════════════════════════════════════════════════════════════
-- TEMPLATE 7: Duplicate / Incorrect Amount
-- ═══════════════════════════════════════════════════════════════════════

INSERT INTO pack_templates (id, slug, dispute_type, is_recommended)
VALUES ('a0000000-0000-0000-0000-000000000007', 'duplicate_incorrect', 'DUPLICATE', false);

INSERT INTO pack_template_i18n (template_id, locale, name, short_description, works_best_for) VALUES
('a0000000-0000-0000-0000-000000000007', 'en-US',
 'Duplicate / Incorrect Amount',
 'Evidence package for disputes alleging a duplicate charge or incorrect billing amount. Focuses on transaction records, order itemization, and pricing verification.',
 'Disputes claiming double-charge or wrong amount billed.');

INSERT INTO pack_template_sections (id, template_id, title_key, title_default, sort) VALUES
('b0000000-0007-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000007', 'section_transaction_records', 'Transaction Records', 0),
('b0000000-0007-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000007', 'section_order_details', 'Order Itemization', 1);

INSERT INTO pack_template_items (template_section_id, item_type, key, label_default, required, guidance_default, sort) VALUES
('b0000000-0007-0000-0000-000000000001', 'DOC_REQUIREMENT', 'payment_records', 'Payment gateway transaction log', true, 'Full list of charges for this customer/order showing each is distinct.', 0),
('b0000000-0007-0000-0000-000000000001', 'DOC_REQUIREMENT', 'invoice_receipts', 'Invoice or receipt for each charge', true, 'Separate invoices proving each charge corresponds to a different order or line item.', 1),
('b0000000-0007-0000-0000-000000000001', 'NOTE', 'auth_vs_capture_note', 'Note: authorization vs. capture', false, 'Explain if the duplicate appearance is an authorization hold vs. actual charge.', 2),
('b0000000-0007-0000-0000-000000000002', 'DOC_REQUIREMENT', 'order_itemization', 'Itemized order breakdown', true, 'Line-by-line breakdown showing the correct amount and what it covers.', 0),
('b0000000-0007-0000-0000-000000000002', 'DOC_REQUIREMENT', 'pricing_screenshot', 'Pricing page or cart screenshot', false, 'Screenshot of prices at time of purchase confirming correct amount.', 1);


-- ═══════════════════════════════════════════════════════════════════════
-- TEMPLATE 8: Digital Goods / Service Delivered
-- ═══════════════════════════════════════════════════════════════════════

INSERT INTO pack_templates (id, slug, dispute_type, is_recommended)
VALUES ('a0000000-0000-0000-0000-000000000008', 'digital_goods', 'DIGITAL', false);

INSERT INTO pack_template_i18n (template_id, locale, name, short_description, works_best_for) VALUES
('a0000000-0000-0000-0000-000000000008', 'en-US',
 'Digital Goods / Service Delivered',
 'Evidence package for disputes on digital products or services. Focuses on download/access logs, usage records, and delivery confirmation of digital content.',
 'Disputes involving digital downloads, SaaS access, or online services.');

INSERT INTO pack_template_sections (id, template_id, title_key, title_default, sort) VALUES
('b0000000-0008-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000008', 'section_delivery_access', 'Delivery & Access', 0),
('b0000000-0008-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000008', 'section_usage_records', 'Usage Records', 1),
('b0000000-0008-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000008', 'section_terms_policies', 'Terms & Policies', 2);

INSERT INTO pack_template_items (template_section_id, item_type, key, label_default, required, guidance_default, sort) VALUES
('b0000000-0008-0000-0000-000000000001', 'DOC_REQUIREMENT', 'download_link_email', 'Download link / access email', true, 'Email sent to customer containing download links or access credentials.', 0),
('b0000000-0008-0000-0000-000000000001', 'DOC_REQUIREMENT', 'access_logs', 'Access or download logs', true, 'Server logs showing the customer accessed or downloaded the digital product.', 1),
('b0000000-0008-0000-0000-000000000001', 'DOC_REQUIREMENT', 'ip_match', 'IP address match', false, 'Show the IP accessing the product matches the customer''s known IP.', 2),
('b0000000-0008-0000-0000-000000000002', 'DOC_REQUIREMENT', 'usage_activity', 'Product usage activity', false, 'Logs or analytics showing the customer used the digital product or service.', 0),
('b0000000-0008-0000-0000-000000000002', 'DOC_REQUIREMENT', 'license_activation', 'License key activation record', false, 'Record showing the license key was activated by the customer.', 1),
('b0000000-0008-0000-0000-000000000003', 'DOC_REQUIREMENT', 'digital_delivery_policy', 'Digital delivery / refund policy', true, 'Published policy for digital goods, including non-refundable terms if applicable.', 0),
('b0000000-0008-0000-0000-000000000003', 'DOC_REQUIREMENT', 'terms_acceptance', 'Proof of terms acceptance', false, 'Evidence the customer accepted terms before purchase (checkbox, click-wrap).', 1);


-- ═══════════════════════════════════════════════════════════════════════
-- TEMPLATE 9: Policy-Forward (Returns / Cancellation / Shipping)
-- ═══════════════════════════════════════════════════════════════════════

INSERT INTO pack_templates (id, slug, dispute_type, is_recommended)
VALUES ('a0000000-0000-0000-0000-000000000009', 'policy_forward', 'GENERAL', false);

INSERT INTO pack_template_i18n (template_id, locale, name, short_description, works_best_for) VALUES
('a0000000-0000-0000-0000-000000000009', 'en-US',
 'Policy-Forward (Returns / Cancellation / Shipping)',
 'Policy-centric evidence package ideal when your strongest defense is clear, published policies. Collects return, cancellation, and shipping policies with proof of customer acceptance.',
 'Disputes where the merchant''s policies clearly support the charge and were accepted by the customer.');

INSERT INTO pack_template_sections (id, template_id, title_key, title_default, sort) VALUES
('b0000000-0009-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000009', 'section_return_policy', 'Return Policy', 0),
('b0000000-0009-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000009', 'section_cancellation_policy', 'Cancellation Policy', 1),
('b0000000-0009-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000009', 'section_shipping_policy', 'Shipping Policy', 2),
('b0000000-0009-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000009', 'section_acceptance_proof', 'Customer Acceptance', 3);

INSERT INTO pack_template_items (template_section_id, item_type, key, label_default, required, guidance_default, sort) VALUES
('b0000000-0009-0000-0000-000000000001', 'DOC_REQUIREMENT', 'return_policy', 'Return policy document', true, 'Full return policy as published on your website.', 0),
('b0000000-0009-0000-0000-000000000001', 'DOC_REQUIREMENT', 'return_policy_url', 'Return policy URL / page screenshot', false, 'Screenshot showing the policy is publicly accessible on your site.', 1),
('b0000000-0009-0000-0000-000000000002', 'DOC_REQUIREMENT', 'cancellation_policy', 'Cancellation policy document', true, 'Full cancellation policy including notice periods and conditions.', 0),
('b0000000-0009-0000-0000-000000000003', 'DOC_REQUIREMENT', 'shipping_policy', 'Shipping policy document', true, 'Published shipping policy with delivery timeframes and carrier info.', 0),
('b0000000-0009-0000-0000-000000000004', 'DOC_REQUIREMENT', 'checkout_terms', 'Checkout terms acceptance proof', true, 'Screenshot or log showing the customer accepted terms at checkout.', 0),
('b0000000-0009-0000-0000-000000000004', 'DOC_REQUIREMENT', 'terms_of_service', 'Terms of service', false, 'Full ToS document the customer agreed to.', 1);


-- ═══════════════════════════════════════════════════════════════════════
-- TEMPLATE 10: General Catch-all
-- ═══════════════════════════════════════════════════════════════════════

INSERT INTO pack_templates (id, slug, dispute_type, is_recommended)
VALUES ('a0000000-0000-0000-0000-000000000010', 'general_catchall', 'GENERAL', false);

INSERT INTO pack_template_i18n (template_id, locale, name, short_description, works_best_for) VALUES
('a0000000-0000-0000-0000-000000000010', 'en-US',
 'General Catch-all',
 'Flexible evidence package for dispute types that don''t fit neatly into other categories. Covers order basics, any available shipping data, relevant policies, and customer communication.',
 'Any dispute type where a more specific template is not available.');

INSERT INTO pack_template_sections (id, template_id, title_key, title_default, sort) VALUES
('b0000000-0010-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000010', 'section_order_basics', 'Order Basics', 0),
('b0000000-0010-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000010', 'section_shipping_delivery', 'Shipping & Delivery', 1),
('b0000000-0010-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000010', 'section_policies', 'Policies & Terms', 2),
('b0000000-0010-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000010', 'section_customer_comms', 'Customer Communication', 3);

INSERT INTO pack_template_items (template_section_id, item_type, key, label_default, required, guidance_default, sort) VALUES
('b0000000-0010-0000-0000-000000000001', 'DOC_REQUIREMENT', 'order_confirmation', 'Order confirmation', true, 'Order number, date, items ordered, and customer details.', 0),
('b0000000-0010-0000-0000-000000000001', 'DOC_REQUIREMENT', 'payment_receipt', 'Payment receipt', true, 'Gateway transaction record for the charge in question.', 1),
('b0000000-0010-0000-0000-000000000002', 'DOC_REQUIREMENT', 'tracking_proof', 'Shipping tracking (if applicable)', false, 'Carrier tracking information if physical goods were shipped.', 0),
('b0000000-0010-0000-0000-000000000002', 'DOC_REQUIREMENT', 'delivery_confirmation', 'Delivery confirmation', false, 'Proof of delivery if available.', 1),
('b0000000-0010-0000-0000-000000000003', 'DOC_REQUIREMENT', 'relevant_policy', 'Most relevant policy', true, 'The policy most applicable to this dispute (return, shipping, ToS, etc.).', 0),
('b0000000-0010-0000-0000-000000000004', 'DOC_REQUIREMENT', 'customer_emails', 'Customer correspondence', false, 'Any relevant communication with the customer.', 0),
('b0000000-0010-0000-0000-000000000004', 'NOTE', 'additional_context', 'Additional context or evidence', false, 'Any other relevant evidence or notes that support your case.', 1);
