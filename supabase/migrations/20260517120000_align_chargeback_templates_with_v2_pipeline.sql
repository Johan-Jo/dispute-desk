-- Align the 10 chargeback templates (T1–T10) with what the v2 evidence
-- pipeline actually collects.
--
-- Why this exists: the seed in 019_seed_global_templates.sql predates the
-- v2.1 family + strategy layer and v2.2 claim-type decoupling. As a result
-- the merchant-facing "What DisputeDesk will collect" section both omits
-- signals we DO collect (3DS-if-available, Shopify fraud screening,
-- IP-location, billing/shipping address match, repeat-customer,
-- order.refunds[]) and promises items we DO NOT collect (carrier-website
-- screenshots, gateway transaction logs, device fingerprints, subscription
-- signup confirmations, digital-goods access logs).
--
-- This migration:
--   • DELETE+reinsert sections + items for the 10 chargeback templates by
--     template UUID. Item/section deletes cascade to pack_template_item_i18n
--     and pack_template_section_i18n via FK ON DELETE CASCADE, so the
--     reinsert is fully idempotent on re-run.
--   • Re-seeds pt-BR localizations for the new sections and items.
--   • Updates pack_template_i18n short_description / preview_note where the
--     old copy mentions evidence we no longer claim to collect.
--   • Fixes one inquiry-template bug: T11 fraud_inquiry's
--     customer_account_info had collector_key='customer_communication',
--     should be 'customer_account_info' (the prior-order count lives on
--     orderSource → customer.numberOfOrders, not on the comm collector).
--
-- Guiding rule: collector_key describes the evidence CAPABILITY, not the
-- source file. Refund evidence uses `refund_record` even though the data
-- flows through orderSource.ts; repeat-customer uses `customer_account_info`
-- not `order_confirmation`.
--
-- An item is marked automatic only when a current collector truly produces
-- that evidence. Conditional evidence (e.g. 3-D Secure when Shopify exposes
-- it on the receipt) is labeled "if available" and stays required=false.
-- Genuine merchant-upload items keep collector_key=NULL.

-- ═══════════════════════════════════════════════════════════════════════
-- Wipe T1–T10 sections (items + i18n cascade via FK ON DELETE CASCADE)
-- ═══════════════════════════════════════════════════════════════════════

DELETE FROM pack_template_sections WHERE template_id IN (
  'a0000000-0000-0000-0000-000000000001',
  'a0000000-0000-0000-0000-000000000002',
  'a0000000-0000-0000-0000-000000000003',
  'a0000000-0000-0000-0000-000000000004',
  'a0000000-0000-0000-0000-000000000005',
  'a0000000-0000-0000-0000-000000000006',
  'a0000000-0000-0000-0000-000000000007',
  'a0000000-0000-0000-0000-000000000008',
  'a0000000-0000-0000-0000-000000000009',
  'a0000000-0000-0000-0000-000000000010'
);

-- ═══════════════════════════════════════════════════════════════════════
-- T1: Fraudulent / Unrecognized — canonical example
-- ═══════════════════════════════════════════════════════════════════════

INSERT INTO pack_template_sections (id, template_id, title_key, title_default, sort) VALUES
  ('b0000000-0001-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'section_payment_authentication', 'Payment Authentication', 0),
  ('b0000000-0001-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'section_order_context', 'Order Context', 1),
  ('b0000000-0001-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 'section_customer_history', 'Customer History', 2),
  ('b0000000-0001-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000001', 'section_delivery_if_shipped', 'Delivery, if shipped', 3);

INSERT INTO pack_template_items (template_section_id, item_type, key, label_default, required, guidance_default, sort, collector_key) VALUES
  ('b0000000-0001-0000-0000-000000000001', 'DOC_REQUIREMENT', 'avs_cvv_match', 'AVS/CVV verification', true, 'Address and CVV match codes from the payment authorization, read from the Shopify order.', 0, 'payment_authentication'),
  ('b0000000-0001-0000-0000-000000000001', 'DOC_REQUIREMENT', 'tds_authentication', '3-D Secure authentication, if available', false, 'When Shopify Payments exposes a 3-D Secure result on the receipt, we include it. Not all gateways expose this.', 1, 'tds_authentication'),
  ('b0000000-0001-0000-0000-000000000001', 'DOC_REQUIREMENT', 'fraud_risk_screening', 'Shopify fraud screening', false, 'Shopify''s pre-authorization risk assessment for this order.', 2, 'fraud_risk_screening'),
  ('b0000000-0001-0000-0000-000000000002', 'DOC_REQUIREMENT', 'order_confirmation', 'Order confirmation', true, 'Order number, date, line items, totals, and customer details from the Shopify order.', 0, 'order_confirmation'),
  ('b0000000-0001-0000-0000-000000000002', 'DOC_REQUIREMENT', 'billing_address_match', 'Billing/shipping address match', false, 'Compares billing and shipping addresses on the Shopify order at city/country level.', 1, 'billing_address_match'),
  ('b0000000-0001-0000-0000-000000000002', 'DOC_REQUIREMENT', 'ip_location_check', 'IP location vs billing country', false, 'Resolves the checkout IP to a region and compares against the billing country.', 2, 'ip_location_check'),
  ('b0000000-0001-0000-0000-000000000003', 'DOC_REQUIREMENT', 'customer_account_info', 'Repeat-customer signal', false, 'Whether the customer has prior orders with this store. Adds weight when present.', 0, 'customer_account_info'),
  ('b0000000-0001-0000-0000-000000000003', 'DOC_REQUIREMENT', 'customer_communication', 'Customer correspondence from Shopify timeline/notes', false, 'Any messages, order notes, or buyer attributes captured by Shopify.', 1, 'customer_communication'),
  ('b0000000-0001-0000-0000-000000000004', 'DOC_REQUIREMENT', 'shipping_tracking', 'Shipping tracking', false, 'Carrier tracking from the Shopify fulfillment, if the order was shipped.', 0, 'shipping_tracking'),
  ('b0000000-0001-0000-0000-000000000004', 'DOC_REQUIREMENT', 'delivery_proof', 'Delivery signature or photo', false, 'Signature confirmation or carrier delivery photo, when the carrier provides it.', 1, 'delivery_proof');

UPDATE pack_template_i18n
SET short_description = 'Pulls every authentication and order signal v2 can read from Shopify: AVS/CVV, 3-D Secure (when available), Shopify fraud screening, IP-location, billing/shipping match, repeat-customer history, and customer correspondence. Shipping evidence is included when the order was shipped.',
    preview_note = 'Automatically collected from Shopify and payment data — no merchant upload required.'
WHERE template_id = 'a0000000-0000-0000-0000-000000000001' AND locale = 'en-US';

UPDATE pack_template_i18n
SET short_description = 'Coleta todos os sinais de autenticação e pedido que o v2 consegue ler da Shopify: AVS/CVV, 3-D Secure (quando disponível), triagem antifraude da Shopify, localização por IP, correspondência de endereço, histórico de cliente recorrente e correspondência do cliente. Evidência de envio incluída quando o pedido foi enviado.',
    preview_note = 'Coletado automaticamente da Shopify e dos dados de pagamento — não requer upload do comerciante.'
WHERE template_id = 'a0000000-0000-0000-0000-000000000001' AND locale = 'pt-BR';

INSERT INTO pack_template_section_i18n (template_section_id, locale, title) VALUES
  ('b0000000-0001-0000-0000-000000000001', 'pt-BR', 'Autenticação de Pagamento'),
  ('b0000000-0001-0000-0000-000000000002', 'pt-BR', 'Contexto do Pedido'),
  ('b0000000-0001-0000-0000-000000000003', 'pt-BR', 'Histórico do Cliente'),
  ('b0000000-0001-0000-0000-000000000004', 'pt-BR', 'Entrega, se enviado');

-- ═══════════════════════════════════════════════════════════════════════
-- T2: Product Not Received — With Tracking
-- ═══════════════════════════════════════════════════════════════════════

INSERT INTO pack_template_sections (id, template_id, title_key, title_default, sort) VALUES
  ('b0000000-0002-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000002', 'section_order_basics', 'Order Basics', 0),
  ('b0000000-0002-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000002', 'section_shipping_tracking', 'Shipping & Tracking', 1),
  ('b0000000-0002-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000002', 'section_delivery_confirmation', 'Delivery Confirmation', 2),
  ('b0000000-0002-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000002', 'section_customer_comms', 'Customer Communication', 3);

INSERT INTO pack_template_items (template_section_id, item_type, key, label_default, required, guidance_default, sort, collector_key) VALUES
  ('b0000000-0002-0000-0000-000000000001', 'DOC_REQUIREMENT', 'order_confirmation', 'Order confirmation', true, 'Order number, date, line items, and shipping address from the Shopify order.', 0, 'order_confirmation'),
  ('b0000000-0002-0000-0000-000000000002', 'DOC_REQUIREMENT', 'shipping_tracking', 'Shipping tracking status', true, 'Tracking number and current status from the Shopify fulfillment.', 0, 'shipping_tracking'),
  ('b0000000-0002-0000-0000-000000000003', 'DOC_REQUIREMENT', 'delivery_proof', 'Delivery confirmation', true, 'Carrier-reported delivery status (and signature/photo when available) from the Shopify fulfillment.', 0, 'delivery_proof'),
  ('b0000000-0002-0000-0000-000000000004', 'DOC_REQUIREMENT', 'customer_communication', 'Customer correspondence', false, 'Post-purchase messages and order notes captured by Shopify.', 0, 'customer_communication');

UPDATE pack_template_i18n
SET short_description = 'Strong evidence package for PNR disputes when Shopify has carrier tracking. Pulls order confirmation, tracking status, and delivery confirmation (with signature/photo when the carrier provides it) directly from Shopify.',
    preview_note = 'Best when Shopify fulfillment data shows the order was delivered.'
WHERE template_id = 'a0000000-0000-0000-0000-000000000002' AND locale = 'en-US';

UPDATE pack_template_i18n
SET short_description = 'Pacote de evidências robusto para disputas PNR quando a Shopify tem rastreamento da transportadora. Puxa confirmação do pedido, status de rastreamento e confirmação de entrega (com assinatura/foto quando a transportadora fornece) diretamente da Shopify.',
    preview_note = 'Melhor quando os dados de fulfillment da Shopify mostram que o pedido foi entregue.'
WHERE template_id = 'a0000000-0000-0000-0000-000000000002' AND locale = 'pt-BR';

INSERT INTO pack_template_section_i18n (template_section_id, locale, title) VALUES
  ('b0000000-0002-0000-0000-000000000001', 'pt-BR', 'Dados do Pedido'),
  ('b0000000-0002-0000-0000-000000000002', 'pt-BR', 'Envio e Rastreamento'),
  ('b0000000-0002-0000-0000-000000000003', 'pt-BR', 'Confirmação de Entrega'),
  ('b0000000-0002-0000-0000-000000000004', 'pt-BR', 'Comunicação com o Cliente');

-- ═══════════════════════════════════════════════════════════════════════
-- T3: Product Not Received — No Tracking / Weak Proof
-- ═══════════════════════════════════════════════════════════════════════

INSERT INTO pack_template_sections (id, template_id, title_key, title_default, sort) VALUES
  ('b0000000-0003-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000003', 'section_order_basics', 'Order Basics', 0),
  ('b0000000-0003-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000003', 'section_shipping_evidence', 'Available Shipping Evidence', 1),
  ('b0000000-0003-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000003', 'section_policies', 'Policies & Terms', 2);

INSERT INTO pack_template_items (template_section_id, item_type, key, label_default, required, guidance_default, sort, collector_key) VALUES
  ('b0000000-0003-0000-0000-000000000001', 'DOC_REQUIREMENT', 'order_confirmation', 'Order confirmation', true, 'Order number, date, line items, and addresses from the Shopify order.', 0, 'order_confirmation'),
  ('b0000000-0003-0000-0000-000000000002', 'DOC_REQUIREMENT', 'shipping_receipt', 'Shipping receipt or label', false, 'Upload any shipping label, receipt, or fulfillment manifest you have outside Shopify.', 0, NULL),
  ('b0000000-0003-0000-0000-000000000002', 'DOC_REQUIREMENT', 'partial_tracking', 'Partial tracking data (if any)', false, 'Upload any carrier scans or hand-off proof, even if incomplete.', 1, NULL),
  ('b0000000-0003-0000-0000-000000000002', 'NOTE', 'shipping_method_note', 'Note: explain shipping method used', false, 'Describe the shipping method and why full tracking may be unavailable.', 2, NULL),
  ('b0000000-0003-0000-0000-000000000003', 'DOC_REQUIREMENT', 'shipping_policy', 'Shipping policy', true, 'Published shipping policy snapshot from the merchant store.', 0, 'shipping_policy'),
  ('b0000000-0003-0000-0000-000000000003', 'DOC_REQUIREMENT', 'refund_policy', 'Refund policy', false, 'Published refund policy snapshot from the merchant store.', 1, 'refund_policy');

UPDATE pack_template_i18n
SET short_description = 'For PNR disputes where tracking is unavailable from Shopify. Pulls order and policy snapshots automatically, and asks the merchant to upload any shipping label, partial tracking, or context note.',
    preview_note = 'Use when Shopify has no fulfillment tracking — you''ll upload what you have.'
WHERE template_id = 'a0000000-0000-0000-0000-000000000003' AND locale = 'en-US';

UPDATE pack_template_i18n
SET short_description = 'Para disputas PNR onde o rastreamento não está disponível na Shopify. Coleta automaticamente o pedido e as políticas, e pede ao comerciante para enviar qualquer etiqueta de envio, rastreamento parcial ou nota de contexto.',
    preview_note = 'Use quando a Shopify não tiver rastreamento de fulfillment — você enviará o que tiver.'
WHERE template_id = 'a0000000-0000-0000-0000-000000000003' AND locale = 'pt-BR';

INSERT INTO pack_template_section_i18n (template_section_id, locale, title) VALUES
  ('b0000000-0003-0000-0000-000000000001', 'pt-BR', 'Dados do Pedido'),
  ('b0000000-0003-0000-0000-000000000002', 'pt-BR', 'Evidências de Envio Disponíveis'),
  ('b0000000-0003-0000-0000-000000000003', 'pt-BR', 'Políticas e Termos');

-- ═══════════════════════════════════════════════════════════════════════
-- T4: Not as Described — Quality Issues
-- ═══════════════════════════════════════════════════════════════════════

INSERT INTO pack_template_sections (id, template_id, title_key, title_default, sort) VALUES
  ('b0000000-0004-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000004', 'section_order_basics', 'Order Basics', 0),
  ('b0000000-0004-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000004', 'section_product_evidence', 'Product Evidence', 1),
  ('b0000000-0004-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000004', 'section_returns_refund', 'Returns & Refund Policy', 2),
  ('b0000000-0004-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000004', 'section_customer_comms', 'Customer Communication', 3);

INSERT INTO pack_template_items (template_section_id, item_type, key, label_default, required, guidance_default, sort, collector_key) VALUES
  ('b0000000-0004-0000-0000-000000000001', 'DOC_REQUIREMENT', 'order_confirmation', 'Order confirmation', true, 'Order details, line items, and product title from the Shopify order.', 0, 'order_confirmation'),
  ('b0000000-0004-0000-0000-000000000002', 'DOC_REQUIREMENT', 'product_page_screenshot', 'Product page screenshot', false, 'Upload a screenshot of the product listing as it appeared at time of purchase.', 0, NULL),
  ('b0000000-0004-0000-0000-000000000002', 'DOC_REQUIREMENT', 'product_photos', 'Product photographs', false, 'Upload photos of the actual product shipped (quality control images).', 1, NULL),
  ('b0000000-0004-0000-0000-000000000003', 'DOC_REQUIREMENT', 'refund_policy', 'Return / refund policy', true, 'Published refund policy snapshot from the merchant store.', 0, 'refund_policy'),
  ('b0000000-0004-0000-0000-000000000003', 'NOTE', 'return_offered_note', 'Note: was a return or exchange offered?', false, 'Document whether you offered a return, exchange, or partial refund.', 1, NULL),
  ('b0000000-0004-0000-0000-000000000004', 'DOC_REQUIREMENT', 'customer_communication', 'Customer correspondence', false, 'Messages and order notes about the quality complaint, from Shopify.', 0, 'customer_communication');

UPDATE pack_template_i18n
SET short_description = 'For disputes claiming the product does not match its description. Pulls order details, refund policy snapshot, and customer correspondence from Shopify; asks the merchant to upload product photos and listing screenshots that prove the listing was accurate.'
WHERE template_id = 'a0000000-0000-0000-0000-000000000004' AND locale = 'en-US';

UPDATE pack_template_i18n
SET short_description = 'Para disputas alegando que o produto não corresponde à descrição. Coleta detalhes do pedido, snapshot da política de reembolso e correspondência do cliente da Shopify; pede ao comerciante para enviar fotos do produto e capturas de tela do anúncio que provem que o anúncio estava correto.'
WHERE template_id = 'a0000000-0000-0000-0000-000000000004' AND locale = 'pt-BR';

INSERT INTO pack_template_section_i18n (template_section_id, locale, title) VALUES
  ('b0000000-0004-0000-0000-000000000001', 'pt-BR', 'Dados do Pedido'),
  ('b0000000-0004-0000-0000-000000000002', 'pt-BR', 'Evidências do Produto'),
  ('b0000000-0004-0000-0000-000000000003', 'pt-BR', 'Política de Devolução e Reembolso'),
  ('b0000000-0004-0000-0000-000000000004', 'pt-BR', 'Comunicação com o Cliente');

-- ═══════════════════════════════════════════════════════════════════════
-- T5: Subscription Canceled — Comprehensive
-- ═══════════════════════════════════════════════════════════════════════

INSERT INTO pack_template_sections (id, template_id, title_key, title_default, sort) VALUES
  ('b0000000-0005-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000005', 'section_order_basics', 'Order Basics', 0),
  ('b0000000-0005-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000005', 'section_subscription_evidence', 'Subscription Evidence', 1),
  ('b0000000-0005-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000005', 'section_policies', 'Policies & Terms', 2),
  ('b0000000-0005-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000005', 'section_customer_comms', 'Customer Communication', 3);

INSERT INTO pack_template_items (template_section_id, item_type, key, label_default, required, guidance_default, sort, collector_key) VALUES
  ('b0000000-0005-0000-0000-000000000001', 'DOC_REQUIREMENT', 'order_confirmation', 'Order confirmation', true, 'Order record for the disputed charge, from the Shopify order.', 0, 'order_confirmation'),
  ('b0000000-0005-0000-0000-000000000002', 'DOC_REQUIREMENT', 'subscription_agreement', 'Subscription agreement / terms', true, 'Upload the terms the customer agreed to at signup, including billing cycle and cancellation policy.', 0, NULL),
  ('b0000000-0005-0000-0000-000000000002', 'DOC_REQUIREMENT', 'usage_logs', 'Service usage logs', false, 'Upload evidence the customer used the service or product after the disputed charge date.', 1, NULL),
  ('b0000000-0005-0000-0000-000000000002', 'DOC_REQUIREMENT', 'renewal_notifications', 'Renewal notification emails', false, 'Upload emails sent before renewal reminding the customer of upcoming charges.', 2, NULL),
  ('b0000000-0005-0000-0000-000000000002', 'NOTE', 'cancellation_status_note', 'Note: cancellation request status', false, 'Document whether a cancellation was received and when, or that no cancellation was submitted.', 3, NULL),
  ('b0000000-0005-0000-0000-000000000003', 'DOC_REQUIREMENT', 'cancellation_policy', 'Cancellation policy', true, 'Published cancellation policy snapshot from the merchant store.', 0, 'cancellation_policy'),
  ('b0000000-0005-0000-0000-000000000003', 'DOC_REQUIREMENT', 'refund_policy', 'Refund policy', false, 'Published refund policy snapshot from the merchant store.', 1, 'refund_policy'),
  ('b0000000-0005-0000-0000-000000000004', 'DOC_REQUIREMENT', 'customer_communication', 'Customer correspondence', false, 'Messages and order notes about the cancellation, from Shopify.', 0, 'customer_communication');

UPDATE pack_template_i18n
SET short_description = 'For subscription disputes. Pulls the disputed-charge order, cancellation/refund policy snapshots, and any Shopify correspondence automatically; asks the merchant to upload subscription terms, usage logs, renewal notices, and a cancellation-status note since none of those have a Shopify collector.'
WHERE template_id = 'a0000000-0000-0000-0000-000000000005' AND locale = 'en-US';

UPDATE pack_template_i18n
SET short_description = 'Para disputas de assinatura. Coleta automaticamente o pedido da cobrança disputada, snapshots de política de cancelamento/reembolso e qualquer correspondência da Shopify; pede ao comerciante para enviar os termos da assinatura, logs de uso, avisos de renovação e uma nota sobre o status de cancelamento, já que nenhum desses tem um coletor da Shopify.'
WHERE template_id = 'a0000000-0000-0000-0000-000000000005' AND locale = 'pt-BR';

INSERT INTO pack_template_section_i18n (template_section_id, locale, title) VALUES
  ('b0000000-0005-0000-0000-000000000001', 'pt-BR', 'Dados do Pedido'),
  ('b0000000-0005-0000-0000-000000000002', 'pt-BR', 'Evidências da Assinatura'),
  ('b0000000-0005-0000-0000-000000000003', 'pt-BR', 'Políticas e Termos'),
  ('b0000000-0005-0000-0000-000000000004', 'pt-BR', 'Comunicação com o Cliente');

-- ═══════════════════════════════════════════════════════════════════════
-- T6: Refund / Credit Not Processed — Standard
-- ═══════════════════════════════════════════════════════════════════════

INSERT INTO pack_template_sections (id, template_id, title_key, title_default, sort) VALUES
  ('b0000000-0006-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000006', 'section_order_basics', 'Order Basics', 0),
  ('b0000000-0006-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000006', 'section_refund_record', 'Refund Record', 1),
  ('b0000000-0006-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000006', 'section_policies', 'Refund Policy', 2),
  ('b0000000-0006-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000006', 'section_customer_comms', 'Customer Communication', 3);

INSERT INTO pack_template_items (template_section_id, item_type, key, label_default, required, guidance_default, sort, collector_key) VALUES
  ('b0000000-0006-0000-0000-000000000001', 'DOC_REQUIREMENT', 'order_confirmation', 'Order confirmation', true, 'Order details and totals from the Shopify order.', 0, 'order_confirmation'),
  ('b0000000-0006-0000-0000-000000000002', 'DOC_REQUIREMENT', 'refund_record', 'Shopify refund record', true, 'Refund history embedded in the Shopify order (date, amount, note) — if a refund exists on the order, we include it.', 0, 'refund_record'),
  ('b0000000-0006-0000-0000-000000000002', 'DOC_REQUIREMENT', 'credit_statement', 'External credit / store credit record', false, 'Upload proof of any credit issued outside of Shopify (store credit, gift card, off-platform credit).', 1, NULL),
  ('b0000000-0006-0000-0000-000000000002', 'NOTE', 'processing_timeline_note', 'Note: refund processing timeline', false, 'Explain typical refund processing time and whether it falls within that window.', 2, NULL),
  ('b0000000-0006-0000-0000-000000000003', 'DOC_REQUIREMENT', 'refund_policy', 'Refund / return policy', true, 'Published refund policy snapshot from the merchant store.', 0, 'refund_policy'),
  ('b0000000-0006-0000-0000-000000000004', 'DOC_REQUIREMENT', 'customer_communication', 'Customer correspondence about refund', false, 'Messages and order notes discussing the refund, from Shopify.', 0, 'customer_communication');

UPDATE pack_template_i18n
SET short_description = 'For disputes claiming a promised refund was not issued. Pulls the order, the Shopify refund record (order.refunds), the refund-policy snapshot, and any Shopify correspondence automatically; asks the merchant to upload external credit proof only when the credit was issued outside Shopify.'
WHERE template_id = 'a0000000-0000-0000-0000-000000000006' AND locale = 'en-US';

UPDATE pack_template_i18n
SET short_description = 'Para disputas alegando que um reembolso prometido não foi emitido. Coleta automaticamente o pedido, o registro de reembolso da Shopify (order.refunds), o snapshot da política de reembolso e qualquer correspondência da Shopify; pede ao comerciante para enviar prova de crédito externo apenas quando o crédito foi emitido fora da Shopify.'
WHERE template_id = 'a0000000-0000-0000-0000-000000000006' AND locale = 'pt-BR';

INSERT INTO pack_template_section_i18n (template_section_id, locale, title) VALUES
  ('b0000000-0006-0000-0000-000000000001', 'pt-BR', 'Dados do Pedido'),
  ('b0000000-0006-0000-0000-000000000002', 'pt-BR', 'Registro de Reembolso'),
  ('b0000000-0006-0000-0000-000000000003', 'pt-BR', 'Política de Reembolso'),
  ('b0000000-0006-0000-0000-000000000004', 'pt-BR', 'Comunicação com o Cliente');

-- ═══════════════════════════════════════════════════════════════════════
-- T7: Duplicate / Incorrect Amount
-- ═══════════════════════════════════════════════════════════════════════

INSERT INTO pack_template_sections (id, template_id, title_key, title_default, sort) VALUES
  ('b0000000-0007-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000007', 'section_order_basics', 'Order Basics', 0),
  ('b0000000-0007-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000007', 'section_external_records', 'External Transaction Records', 1);

INSERT INTO pack_template_items (template_section_id, item_type, key, label_default, required, guidance_default, sort, collector_key) VALUES
  ('b0000000-0007-0000-0000-000000000001', 'DOC_REQUIREMENT', 'order_confirmation', 'Order confirmation', true, 'Order details, totals, and creation date from the Shopify order.', 0, 'order_confirmation'),
  ('b0000000-0007-0000-0000-000000000001', 'DOC_REQUIREMENT', 'order_itemization', 'Itemized order breakdown', true, 'Line-by-line breakdown showing what the amount covers, from the Shopify order.', 1, 'order_confirmation'),
  ('b0000000-0007-0000-0000-000000000002', 'DOC_REQUIREMENT', 'payment_records', 'External payment gateway transaction log', false, 'Upload payment-gateway logs showing each charge is distinct (we do not pull gateway logs automatically).', 0, NULL),
  ('b0000000-0007-0000-0000-000000000002', 'DOC_REQUIREMENT', 'invoice_receipts', 'Separate invoices for each charge', false, 'Upload separate invoices proving each charge corresponds to a different order or line item.', 1, NULL),
  ('b0000000-0007-0000-0000-000000000002', 'NOTE', 'auth_vs_capture_note', 'Note: authorization vs. capture', false, 'Explain whether the duplicate appearance is an authorization hold vs. an actual charge.', 2, NULL);

UPDATE pack_template_i18n
SET short_description = 'For disputes alleging a duplicate charge or incorrect billing amount. Pulls the Shopify order and itemization automatically; asks the merchant to upload external gateway logs or separate invoices since DisputeDesk does not pull raw payment-gateway logs.'
WHERE template_id = 'a0000000-0000-0000-0000-000000000007' AND locale = 'en-US';

UPDATE pack_template_i18n
SET short_description = 'Para disputas alegando cobrança duplicada ou valor incorreto. Coleta automaticamente o pedido e a discriminação da Shopify; pede ao comerciante para enviar logs externos do gateway ou faturas separadas, já que o DisputeDesk não puxa logs brutos do gateway de pagamento.'
WHERE template_id = 'a0000000-0000-0000-0000-000000000007' AND locale = 'pt-BR';

INSERT INTO pack_template_section_i18n (template_section_id, locale, title) VALUES
  ('b0000000-0007-0000-0000-000000000001', 'pt-BR', 'Dados do Pedido'),
  ('b0000000-0007-0000-0000-000000000002', 'pt-BR', 'Registros Externos de Transação');

-- ═══════════════════════════════════════════════════════════════════════
-- T8: Digital Goods / Service Delivered
-- ═══════════════════════════════════════════════════════════════════════

INSERT INTO pack_template_sections (id, template_id, title_key, title_default, sort) VALUES
  ('b0000000-0008-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000008', 'section_order_basics', 'Order Basics', 0),
  ('b0000000-0008-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000008', 'section_delivery_evidence', 'Delivery & Access Evidence', 1),
  ('b0000000-0008-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000008', 'section_policies', 'Terms & Policies', 2);

INSERT INTO pack_template_items (template_section_id, item_type, key, label_default, required, guidance_default, sort, collector_key) VALUES
  ('b0000000-0008-0000-0000-000000000001', 'DOC_REQUIREMENT', 'order_confirmation', 'Order confirmation', true, 'Order details from the Shopify order.', 0, 'order_confirmation'),
  ('b0000000-0008-0000-0000-000000000002', 'DOC_REQUIREMENT', 'download_link_email', 'Download link / access email', true, 'Upload the email sent to the customer containing download links or access credentials.', 0, NULL),
  ('b0000000-0008-0000-0000-000000000002', 'DOC_REQUIREMENT', 'access_logs', 'Access or download logs', false, 'Upload server logs showing the customer accessed or downloaded the digital product.', 1, NULL),
  ('b0000000-0008-0000-0000-000000000002', 'DOC_REQUIREMENT', 'license_activation', 'License key activation record', false, 'Upload the record showing the license key was activated by the customer.', 2, NULL),
  ('b0000000-0008-0000-0000-000000000003', 'DOC_REQUIREMENT', 'refund_policy', 'Digital delivery / refund policy', true, 'Published refund policy snapshot from the merchant store (covers digital-goods non-refundable terms when applicable).', 0, 'refund_policy');

UPDATE pack_template_i18n
SET short_description = 'For disputes on digital products or services. Pulls the order and refund-policy snapshot from Shopify; asks the merchant to upload delivery emails, access logs, and license activation records since none of those have a Shopify collector.'
WHERE template_id = 'a0000000-0000-0000-0000-000000000008' AND locale = 'en-US';

UPDATE pack_template_i18n
SET short_description = 'Para disputas sobre produtos ou serviços digitais. Coleta o pedido e o snapshot da política de reembolso da Shopify; pede ao comerciante para enviar e-mails de entrega, logs de acesso e registros de ativação de licença, já que nenhum desses tem um coletor da Shopify.'
WHERE template_id = 'a0000000-0000-0000-0000-000000000008' AND locale = 'pt-BR';

INSERT INTO pack_template_section_i18n (template_section_id, locale, title) VALUES
  ('b0000000-0008-0000-0000-000000000001', 'pt-BR', 'Dados do Pedido'),
  ('b0000000-0008-0000-0000-000000000002', 'pt-BR', 'Evidências de Entrega e Acesso'),
  ('b0000000-0008-0000-0000-000000000003', 'pt-BR', 'Termos e Políticas');

-- ═══════════════════════════════════════════════════════════════════════
-- T9: Policy-Forward (Returns / Cancellation / Shipping)
-- ═══════════════════════════════════════════════════════════════════════

INSERT INTO pack_template_sections (id, template_id, title_key, title_default, sort) VALUES
  ('b0000000-0009-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000009', 'section_policies', 'Store Policies', 0),
  ('b0000000-0009-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000009', 'section_acceptance_proof', 'Customer Acceptance', 1);

INSERT INTO pack_template_items (template_section_id, item_type, key, label_default, required, guidance_default, sort, collector_key) VALUES
  ('b0000000-0009-0000-0000-000000000001', 'DOC_REQUIREMENT', 'refund_policy', 'Refund / return policy', true, 'Published refund policy snapshot from the merchant store.', 0, 'refund_policy'),
  ('b0000000-0009-0000-0000-000000000001', 'DOC_REQUIREMENT', 'cancellation_policy', 'Cancellation policy', true, 'Published cancellation policy snapshot from the merchant store.', 1, 'cancellation_policy'),
  ('b0000000-0009-0000-0000-000000000001', 'DOC_REQUIREMENT', 'shipping_policy', 'Shipping policy', true, 'Published shipping policy snapshot from the merchant store.', 2, 'shipping_policy'),
  ('b0000000-0009-0000-0000-000000000002', 'DOC_REQUIREMENT', 'checkout_terms', 'Checkout terms acceptance proof', false, 'Upload a screenshot or log showing the customer accepted terms at checkout.', 0, NULL),
  ('b0000000-0009-0000-0000-000000000002', 'DOC_REQUIREMENT', 'terms_of_service', 'Terms of service', false, 'Upload the full ToS document the customer agreed to.', 1, NULL);

UPDATE pack_template_i18n
SET short_description = 'For disputes where your strongest defense is clear, published policies. Pulls refund, cancellation, and shipping policy snapshots from the merchant store automatically; asks the merchant to upload acceptance proof when needed.'
WHERE template_id = 'a0000000-0000-0000-0000-000000000009' AND locale = 'en-US';

UPDATE pack_template_i18n
SET short_description = 'Para disputas em que sua defesa mais forte são políticas claras e publicadas. Coleta automaticamente snapshots das políticas de reembolso, cancelamento e envio da loja; pede ao comerciante para enviar prova de aceitação quando necessário.'
WHERE template_id = 'a0000000-0000-0000-0000-000000000009' AND locale = 'pt-BR';

INSERT INTO pack_template_section_i18n (template_section_id, locale, title) VALUES
  ('b0000000-0009-0000-0000-000000000001', 'pt-BR', 'Políticas da Loja'),
  ('b0000000-0009-0000-0000-000000000002', 'pt-BR', 'Aceitação pelo Cliente');

-- ═══════════════════════════════════════════════════════════════════════
-- T10: General Catch-all
-- ═══════════════════════════════════════════════════════════════════════

INSERT INTO pack_template_sections (id, template_id, title_key, title_default, sort) VALUES
  ('b0000000-0010-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000010', 'section_order_basics', 'Order Basics', 0),
  ('b0000000-0010-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000010', 'section_shipping_delivery', 'Shipping & Delivery', 1),
  ('b0000000-0010-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000010', 'section_policies', 'Policies & Terms', 2),
  ('b0000000-0010-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000010', 'section_customer_comms', 'Customer Communication', 3);

INSERT INTO pack_template_items (template_section_id, item_type, key, label_default, required, guidance_default, sort, collector_key) VALUES
  ('b0000000-0010-0000-0000-000000000001', 'DOC_REQUIREMENT', 'order_confirmation', 'Order confirmation', true, 'Order details, line items, and customer details from the Shopify order.', 0, 'order_confirmation'),
  ('b0000000-0010-0000-0000-000000000002', 'DOC_REQUIREMENT', 'shipping_tracking', 'Shipping tracking (if applicable)', false, 'Carrier tracking from the Shopify fulfillment, if the order was shipped.', 0, 'shipping_tracking'),
  ('b0000000-0010-0000-0000-000000000002', 'DOC_REQUIREMENT', 'delivery_proof', 'Delivery confirmation', false, 'Carrier delivery status from the Shopify fulfillment, when available.', 1, 'delivery_proof'),
  ('b0000000-0010-0000-0000-000000000003', 'DOC_REQUIREMENT', 'refund_policy', 'Refund policy', false, 'Published refund policy snapshot from the merchant store.', 0, 'refund_policy'),
  ('b0000000-0010-0000-0000-000000000003', 'DOC_REQUIREMENT', 'shipping_policy', 'Shipping policy', false, 'Published shipping policy snapshot from the merchant store.', 1, 'shipping_policy'),
  ('b0000000-0010-0000-0000-000000000003', 'DOC_REQUIREMENT', 'cancellation_policy', 'Cancellation policy', false, 'Published cancellation policy snapshot from the merchant store.', 2, 'cancellation_policy'),
  ('b0000000-0010-0000-0000-000000000004', 'DOC_REQUIREMENT', 'customer_communication', 'Customer correspondence', false, 'Messages and order notes captured by Shopify.', 0, 'customer_communication'),
  ('b0000000-0010-0000-0000-000000000004', 'NOTE', 'additional_context', 'Additional context or evidence', false, 'Add any other relevant notes or upload extra files that support your case.', 1, NULL);

UPDATE pack_template_i18n
SET short_description = 'Flexible package for dispute types that don''t fit a specific template. Pulls the order, any available Shopify shipping/fulfillment, store-policy snapshots, and Shopify correspondence automatically; the merchant can add an additional-context note as needed.'
WHERE template_id = 'a0000000-0000-0000-0000-000000000010' AND locale = 'en-US';

UPDATE pack_template_i18n
SET short_description = 'Pacote flexível para tipos de disputa que não se encaixam em um template específico. Coleta automaticamente o pedido, qualquer envio/fulfillment disponível na Shopify, snapshots de políticas da loja e correspondência da Shopify; o comerciante pode adicionar uma nota de contexto conforme necessário.'
WHERE template_id = 'a0000000-0000-0000-0000-000000000010' AND locale = 'pt-BR';

INSERT INTO pack_template_section_i18n (template_section_id, locale, title) VALUES
  ('b0000000-0010-0000-0000-000000000001', 'pt-BR', 'Dados do Pedido'),
  ('b0000000-0010-0000-0000-000000000002', 'pt-BR', 'Envio e Entrega'),
  ('b0000000-0010-0000-0000-000000000003', 'pt-BR', 'Políticas e Termos'),
  ('b0000000-0010-0000-0000-000000000004', 'pt-BR', 'Comunicação com o Cliente');

-- ═══════════════════════════════════════════════════════════════════════
-- pt-BR item-label localization for the new rows
-- ═══════════════════════════════════════════════════════════════════════

INSERT INTO pack_template_item_i18n (template_item_id, locale, label, guidance)
SELECT pti.id, v.locale, v.label, v.guidance
FROM pack_template_items pti
JOIN (VALUES
  -- T1 Fraud / Unrecognized
  ('b0000000-0001-0000-0000-000000000001', 'avs_cvv_match', 'pt-BR', 'Verificação AVS/CVV', 'Códigos de correspondência de endereço e CVV da autorização do pagamento, lidos do pedido Shopify.'),
  ('b0000000-0001-0000-0000-000000000001', 'tds_authentication', 'pt-BR', 'Autenticação 3-D Secure, se disponível', 'Quando o Shopify Payments expõe o resultado 3-D Secure no recibo, incluímos. Nem todos os gateways expõem isso.'),
  ('b0000000-0001-0000-0000-000000000001', 'fraud_risk_screening', 'pt-BR', 'Triagem antifraude da Shopify', 'Avaliação de risco pré-autorização da Shopify para este pedido.'),
  ('b0000000-0001-0000-0000-000000000002', 'order_confirmation', 'pt-BR', 'Confirmação do pedido', 'Número do pedido, data, itens, totais e detalhes do cliente do pedido Shopify.'),
  ('b0000000-0001-0000-0000-000000000002', 'billing_address_match', 'pt-BR', 'Correspondência de endereço de cobrança/entrega', 'Compara endereços de cobrança e entrega no pedido Shopify em nível de cidade/país.'),
  ('b0000000-0001-0000-0000-000000000002', 'ip_location_check', 'pt-BR', 'Localização por IP vs país de cobrança', 'Resolve o IP do checkout para uma região e compara com o país de cobrança.'),
  ('b0000000-0001-0000-0000-000000000003', 'customer_account_info', 'pt-BR', 'Sinal de cliente recorrente', 'Se o cliente tem pedidos anteriores nesta loja. Adiciona peso quando presente.'),
  ('b0000000-0001-0000-0000-000000000003', 'customer_communication', 'pt-BR', 'Correspondência do cliente da linha do tempo/notas da Shopify', 'Quaisquer mensagens, notas de pedido ou atributos do comprador capturados pela Shopify.'),
  ('b0000000-0001-0000-0000-000000000004', 'shipping_tracking', 'pt-BR', 'Rastreamento de envio', 'Rastreamento da transportadora do fulfillment Shopify, se o pedido foi enviado.'),
  ('b0000000-0001-0000-0000-000000000004', 'delivery_proof', 'pt-BR', 'Assinatura ou foto de entrega', 'Confirmação de assinatura ou foto de entrega da transportadora, quando fornecido.'),

  -- T2 PNR With Tracking
  ('b0000000-0002-0000-0000-000000000001', 'order_confirmation', 'pt-BR', 'Confirmação do pedido', 'Número do pedido, data, itens e endereço de entrega do pedido Shopify.'),
  ('b0000000-0002-0000-0000-000000000002', 'shipping_tracking', 'pt-BR', 'Status de rastreamento do envio', 'Número de rastreamento e status atual do fulfillment Shopify.'),
  ('b0000000-0002-0000-0000-000000000003', 'delivery_proof', 'pt-BR', 'Confirmação de entrega', 'Status de entrega informado pela transportadora (com assinatura/foto quando disponível) do fulfillment Shopify.'),
  ('b0000000-0002-0000-0000-000000000004', 'customer_communication', 'pt-BR', 'Correspondência com o cliente', 'Mensagens pós-compra e notas de pedido capturadas pela Shopify.'),

  -- T3 PNR Weak Proof
  ('b0000000-0003-0000-0000-000000000001', 'order_confirmation', 'pt-BR', 'Confirmação do pedido', 'Número do pedido, data, itens e endereços do pedido Shopify.'),
  ('b0000000-0003-0000-0000-000000000002', 'shipping_receipt', 'pt-BR', 'Recibo ou etiqueta de envio', 'Envie qualquer etiqueta de envio, recibo ou manifesto de fulfillment que você tenha fora da Shopify.'),
  ('b0000000-0003-0000-0000-000000000002', 'partial_tracking', 'pt-BR', 'Dados parciais de rastreamento (se houver)', 'Envie quaisquer leituras da transportadora ou prova de envio, mesmo que incompletas.'),
  ('b0000000-0003-0000-0000-000000000002', 'shipping_method_note', 'pt-BR', 'Nota: explicar o método de envio usado', 'Descreva o método de envio e por que o rastreamento completo pode estar indisponível.'),
  ('b0000000-0003-0000-0000-000000000003', 'shipping_policy', 'pt-BR', 'Política de envio', 'Snapshot da política de envio publicada da loja do comerciante.'),
  ('b0000000-0003-0000-0000-000000000003', 'refund_policy', 'pt-BR', 'Política de reembolso', 'Snapshot da política de reembolso publicada da loja do comerciante.'),

  -- T4 Not as Described
  ('b0000000-0004-0000-0000-000000000001', 'order_confirmation', 'pt-BR', 'Confirmação do pedido', 'Detalhes do pedido, itens e título do produto do pedido Shopify.'),
  ('b0000000-0004-0000-0000-000000000002', 'product_page_screenshot', 'pt-BR', 'Captura de tela da página do produto', 'Envie uma captura de tela do anúncio do produto como apareceu no momento da compra.'),
  ('b0000000-0004-0000-0000-000000000002', 'product_photos', 'pt-BR', 'Fotografias do produto', 'Envie fotos do produto real enviado (imagens de controle de qualidade).'),
  ('b0000000-0004-0000-0000-000000000003', 'refund_policy', 'pt-BR', 'Política de devolução / reembolso', 'Snapshot da política de reembolso publicada da loja do comerciante.'),
  ('b0000000-0004-0000-0000-000000000003', 'return_offered_note', 'pt-BR', 'Nota: foi oferecida uma devolução ou troca?', 'Documente se você ofereceu uma devolução, troca ou reembolso parcial.'),
  ('b0000000-0004-0000-0000-000000000004', 'customer_communication', 'pt-BR', 'Correspondência com o cliente', 'Mensagens e notas de pedido sobre a reclamação de qualidade, da Shopify.'),

  -- T5 Subscription Canceled
  ('b0000000-0005-0000-0000-000000000001', 'order_confirmation', 'pt-BR', 'Confirmação do pedido', 'Registro do pedido para a cobrança disputada, do pedido Shopify.'),
  ('b0000000-0005-0000-0000-000000000002', 'subscription_agreement', 'pt-BR', 'Acordo / termos de assinatura', 'Envie os termos que o cliente aceitou na inscrição, incluindo ciclo de cobrança e política de cancelamento.'),
  ('b0000000-0005-0000-0000-000000000002', 'usage_logs', 'pt-BR', 'Logs de uso do serviço', 'Envie evidência de que o cliente usou o serviço ou produto após a data da cobrança disputada.'),
  ('b0000000-0005-0000-0000-000000000002', 'renewal_notifications', 'pt-BR', 'E-mails de notificação de renovação', 'Envie e-mails enviados antes da renovação lembrando o cliente de cobranças futuras.'),
  ('b0000000-0005-0000-0000-000000000002', 'cancellation_status_note', 'pt-BR', 'Nota: status do pedido de cancelamento', 'Documente se um cancelamento foi recebido e quando, ou que nenhum cancelamento foi enviado.'),
  ('b0000000-0005-0000-0000-000000000003', 'cancellation_policy', 'pt-BR', 'Política de cancelamento', 'Snapshot da política de cancelamento publicada da loja do comerciante.'),
  ('b0000000-0005-0000-0000-000000000003', 'refund_policy', 'pt-BR', 'Política de reembolso', 'Snapshot da política de reembolso publicada da loja do comerciante.'),
  ('b0000000-0005-0000-0000-000000000004', 'customer_communication', 'pt-BR', 'Correspondência com o cliente', 'Mensagens e notas de pedido sobre o cancelamento, da Shopify.'),

  -- T6 Refund / Credit Not Processed
  ('b0000000-0006-0000-0000-000000000001', 'order_confirmation', 'pt-BR', 'Confirmação do pedido', 'Detalhes e totais do pedido Shopify.'),
  ('b0000000-0006-0000-0000-000000000002', 'refund_record', 'pt-BR', 'Registro de reembolso da Shopify', 'Histórico de reembolso embutido no pedido Shopify (data, valor, nota) — se houver reembolso no pedido, incluímos.'),
  ('b0000000-0006-0000-0000-000000000002', 'credit_statement', 'pt-BR', 'Registro de crédito / crédito externo', 'Envie prova de qualquer crédito emitido fora da Shopify (crédito na loja, vale-presente, crédito fora da plataforma).'),
  ('b0000000-0006-0000-0000-000000000002', 'processing_timeline_note', 'pt-BR', 'Nota: cronograma de processamento do reembolso', 'Explique o tempo típico de processamento de reembolso e se está dentro dessa janela.'),
  ('b0000000-0006-0000-0000-000000000003', 'refund_policy', 'pt-BR', 'Política de reembolso / devolução', 'Snapshot da política de reembolso publicada da loja do comerciante.'),
  ('b0000000-0006-0000-0000-000000000004', 'customer_communication', 'pt-BR', 'Correspondência com o cliente sobre o reembolso', 'Mensagens e notas de pedido discutindo o reembolso, da Shopify.'),

  -- T7 Duplicate / Incorrect Amount
  ('b0000000-0007-0000-0000-000000000001', 'order_confirmation', 'pt-BR', 'Confirmação do pedido', 'Detalhes do pedido, totais e data de criação do pedido Shopify.'),
  ('b0000000-0007-0000-0000-000000000001', 'order_itemization', 'pt-BR', 'Detalhamento do pedido por item', 'Detalhamento linha a linha mostrando o que o valor cobre, do pedido Shopify.'),
  ('b0000000-0007-0000-0000-000000000002', 'payment_records', 'pt-BR', 'Log externo de transações do gateway de pagamento', 'Envie logs do gateway de pagamento mostrando que cada cobrança é distinta (não puxamos logs do gateway automaticamente).'),
  ('b0000000-0007-0000-0000-000000000002', 'invoice_receipts', 'pt-BR', 'Faturas separadas para cada cobrança', 'Envie faturas separadas comprovando que cada cobrança corresponde a um pedido ou item diferente.'),
  ('b0000000-0007-0000-0000-000000000002', 'auth_vs_capture_note', 'pt-BR', 'Nota: autorização vs. captura', 'Explique se a aparência duplicada é uma retenção de autorização vs. uma cobrança real.'),

  -- T8 Digital Goods
  ('b0000000-0008-0000-0000-000000000001', 'order_confirmation', 'pt-BR', 'Confirmação do pedido', 'Detalhes do pedido Shopify.'),
  ('b0000000-0008-0000-0000-000000000002', 'download_link_email', 'pt-BR', 'E-mail de link de download / acesso', 'Envie o e-mail enviado ao cliente contendo links de download ou credenciais de acesso.'),
  ('b0000000-0008-0000-0000-000000000002', 'access_logs', 'pt-BR', 'Logs de acesso ou download', 'Envie logs do servidor mostrando que o cliente acessou ou baixou o produto digital.'),
  ('b0000000-0008-0000-0000-000000000002', 'license_activation', 'pt-BR', 'Registro de ativação de chave de licença', 'Envie o registro mostrando que a chave de licença foi ativada pelo cliente.'),
  ('b0000000-0008-0000-0000-000000000003', 'refund_policy', 'pt-BR', 'Política de entrega digital / reembolso', 'Snapshot da política de reembolso publicada da loja do comerciante (cobre termos não reembolsáveis de bens digitais quando aplicável).'),

  -- T9 Policy-Forward
  ('b0000000-0009-0000-0000-000000000001', 'refund_policy', 'pt-BR', 'Política de reembolso / devolução', 'Snapshot da política de reembolso publicada da loja do comerciante.'),
  ('b0000000-0009-0000-0000-000000000001', 'cancellation_policy', 'pt-BR', 'Política de cancelamento', 'Snapshot da política de cancelamento publicada da loja do comerciante.'),
  ('b0000000-0009-0000-0000-000000000001', 'shipping_policy', 'pt-BR', 'Política de envio', 'Snapshot da política de envio publicada da loja do comerciante.'),
  ('b0000000-0009-0000-0000-000000000002', 'checkout_terms', 'pt-BR', 'Prova de aceitação dos termos no checkout', 'Envie uma captura de tela ou log mostrando que o cliente aceitou os termos no checkout.'),
  ('b0000000-0009-0000-0000-000000000002', 'terms_of_service', 'pt-BR', 'Termos de serviço', 'Envie o documento completo de Termos de Serviço que o cliente concordou.'),

  -- T10 General Catch-all
  ('b0000000-0010-0000-0000-000000000001', 'order_confirmation', 'pt-BR', 'Confirmação do pedido', 'Detalhes do pedido, itens e detalhes do cliente do pedido Shopify.'),
  ('b0000000-0010-0000-0000-000000000002', 'shipping_tracking', 'pt-BR', 'Rastreamento de envio (se aplicável)', 'Rastreamento da transportadora do fulfillment Shopify, se o pedido foi enviado.'),
  ('b0000000-0010-0000-0000-000000000002', 'delivery_proof', 'pt-BR', 'Confirmação de entrega', 'Status de entrega da transportadora do fulfillment Shopify, quando disponível.'),
  ('b0000000-0010-0000-0000-000000000003', 'refund_policy', 'pt-BR', 'Política de reembolso', 'Snapshot da política de reembolso publicada da loja do comerciante.'),
  ('b0000000-0010-0000-0000-000000000003', 'shipping_policy', 'pt-BR', 'Política de envio', 'Snapshot da política de envio publicada da loja do comerciante.'),
  ('b0000000-0010-0000-0000-000000000003', 'cancellation_policy', 'pt-BR', 'Política de cancelamento', 'Snapshot da política de cancelamento publicada da loja do comerciante.'),
  ('b0000000-0010-0000-0000-000000000004', 'customer_communication', 'pt-BR', 'Correspondência com o cliente', 'Mensagens e notas de pedido capturadas pela Shopify.'),
  ('b0000000-0010-0000-0000-000000000004', 'additional_context', 'pt-BR', 'Contexto ou evidência adicional', 'Adicione qualquer outra nota relevante ou envie arquivos extras que apoiem seu caso.')
) AS v(template_section_id, key, locale, label, guidance)
  ON pti.template_section_id = v.template_section_id::uuid AND pti.key = v.key
ON CONFLICT (template_item_id, locale) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════
-- T11 fraud_inquiry: fix wrong collector_key on customer_account_info
-- ═══════════════════════════════════════════════════════════════════════

UPDATE pack_template_items
SET collector_key = 'customer_account_info'
WHERE template_section_id = 'b0000000-0011-0000-0000-000000000001'
  AND key = 'customer_account_info';
