-- Dedicated inquiry-phase template variants.
--
-- Inquiries are conversational soft disputes — the cardholder's bank is
-- asking a question, not formally demanding a full evidence defense. Answering
-- well can close an inquiry before it becomes a chargeback. A lighter
-- template with 2–4 focused items is the right fit — merchants can respond
-- in minutes instead of assembling a full chargeback pack.
--
-- Until now reason_template_mappings pointed inquiry rows at the chargeback
-- templates (commit 8a6bf59). This migration adds 8 inquiry-specific
-- variants and repoints the inquiry mappings so inquiries get the lighter
-- flow while chargebacks keep the full defense pack.
--
-- Reason → inquiry template (UPDATE at the bottom of this file):
--   FRAUDULENT / UNRECOGNIZED / DEBIT_NOT_AUTHORIZED  -> fraud_inquiry
--   PRODUCT_NOT_RECEIVED                              -> pnr_inquiry
--   PRODUCT_UNACCEPTABLE                              -> not_as_described_inquiry
--   SUBSCRIPTION_CANCELED                             -> subscription_inquiry
--   CREDIT_NOT_PROCESSED                              -> refund_inquiry
--   DUPLICATE                                         -> duplicate_inquiry
--   NONCOMPLIANT                                      -> policy_forward_inquiry
--   CUSTOMER_INITIATED / GENERAL /                    -> general_inquiry
--   BANK_CANNOT_PROCESS / INCORRECT_ACCOUNT_DETAILS /
--   INSUFFICIENT_FUNDS
--
-- Digital Goods intentionally gets no inquiry variant — it's product-type
-- based, not dispute-reason based, and inquiries on digital goods are rare
-- enough that general_inquiry is a safe default.

-- ═══════════════════════════════════════════════════════════════════════
-- TEMPLATES
-- ═══════════════════════════════════════════════════════════════════════

INSERT INTO pack_templates (id, slug, dispute_type, is_recommended, status) VALUES
  ('a0000000-0000-0000-0000-000000000011', 'fraud_inquiry', 'FRAUD', false, 'active'),
  ('a0000000-0000-0000-0000-000000000012', 'pnr_inquiry', 'PNR', false, 'active'),
  ('a0000000-0000-0000-0000-000000000013', 'not_as_described_inquiry', 'NOT_AS_DESCRIBED', false, 'active'),
  ('a0000000-0000-0000-0000-000000000014', 'subscription_inquiry', 'SUBSCRIPTION', false, 'active'),
  ('a0000000-0000-0000-0000-000000000015', 'refund_inquiry', 'REFUND', false, 'active'),
  ('a0000000-0000-0000-0000-000000000016', 'duplicate_inquiry', 'DUPLICATE', false, 'active'),
  ('a0000000-0000-0000-0000-000000000017', 'policy_forward_inquiry', 'GENERAL', false, 'active'),
  ('a0000000-0000-0000-0000-000000000018', 'general_inquiry', 'GENERAL', false, 'active');

-- ═══════════════════════════════════════════════════════════════════════
-- TEMPLATE i18n (en-US)
-- ═══════════════════════════════════════════════════════════════════════

INSERT INTO pack_template_i18n (template_id, locale, name, short_description, works_best_for) VALUES
('a0000000-0000-0000-0000-000000000011', 'en-US',
 'Fraudulent / Unrecognized — Inquiry',
 'Light response pack for fraud and unrecognized-charge inquiries. Aims to confirm the charge was legitimate with minimal evidence so the inquiry closes without escalation.',
 'Pre-chargeback fraud inquiries where the cardholder is questioning whether they authorized the charge.'),
('a0000000-0000-0000-0000-000000000012', 'en-US',
 'Product Not Received — Inquiry',
 'Quick shipping-status response for pre-chargeback PNR inquiries. A tracking number and delivery confirmation is usually enough to close the question.',
 'Customer tells their bank they haven''t received the order before escalating to a chargeback.'),
('a0000000-0000-0000-0000-000000000013', 'en-US',
 'Product Unacceptable — Inquiry',
 'Brief response for quality / not-as-described inquiries. Focuses on what the customer bought and any return offer you''ve made.',
 'Customer complaint stage where a full return / refund conversation can resolve things.'),
('a0000000-0000-0000-0000-000000000014', 'en-US',
 'Subscription Canceled — Inquiry',
 'Short subscription-status response. Confirms whether the customer is still active or has cancelled, and when the most recent charge occurred.',
 'Inquiry about recurring charges before a formal chargeback is filed.'),
('a0000000-0000-0000-0000-000000000015', 'en-US',
 'Refund / Credit Not Processed — Inquiry',
 'Quick refund-status response. Tells the bank whether a refund is in progress, already processed, or not owed.',
 'Customer claims a refund was promised but not received — usually an accounting question.'),
('a0000000-0000-0000-0000-000000000016', 'en-US',
 'Duplicate / Incorrect Amount — Inquiry',
 'Short transaction-records response showing each charge is distinct or breaking down the disputed amount.',
 'Customer questioning whether they were double-charged or billed the wrong amount.'),
('a0000000-0000-0000-0000-000000000017', 'en-US',
 'Policy-Forward — Inquiry',
 'Lightweight policy response. Surfaces the most relevant policy the customer agreed to at checkout.',
 'Inquiries where a clear, published policy answers the question directly.'),
('a0000000-0000-0000-0000-000000000018', 'en-US',
 'General — Inquiry',
 'Minimal catch-all response for inquiries that don''t fit a specific template. One order summary plus any free-text context.',
 'Any inquiry not handled by a more specific template.');

-- ═══════════════════════════════════════════════════════════════════════
-- TEMPLATE i18n (pt-BR)
-- ═══════════════════════════════════════════════════════════════════════

INSERT INTO pack_template_i18n (template_id, locale, name, short_description, works_best_for) VALUES
('a0000000-0000-0000-0000-000000000011', 'pt-BR',
 'Fraudulento / Não reconhecido — Consulta',
 'Pacote de resposta leve para consultas sobre fraude ou cobrança não reconhecida. Visa confirmar que a cobrança foi legítima com o mínimo de evidências para encerrar a consulta antes de virar chargeback.',
 'Consultas pré-chargeback sobre fraude em que o titular do cartão está questionando se autorizou a cobrança.'),
('a0000000-0000-0000-0000-000000000012', 'pt-BR',
 'Produto Não Recebido — Consulta',
 'Resposta rápida de status de envio para consultas PNR pré-chargeback. Um número de rastreamento e confirmação de entrega geralmente basta para encerrar a questão.',
 'Cliente informa ao banco que não recebeu o pedido antes de escalar para um chargeback.'),
('a0000000-0000-0000-0000-000000000013', 'pt-BR',
 'Produto Não Conforme — Consulta',
 'Resposta breve para consultas sobre qualidade ou produto não conforme. Foca no que o cliente comprou e em qualquer oferta de devolução já feita.',
 'Fase de reclamação em que uma conversa sobre devolução ou reembolso pode resolver.'),
('a0000000-0000-0000-0000-000000000014', 'pt-BR',
 'Assinatura Cancelada — Consulta',
 'Resposta curta de status da assinatura. Confirma se o cliente ainda está ativo ou cancelou, e quando ocorreu a cobrança mais recente.',
 'Consulta sobre cobranças recorrentes antes de um chargeback formal.'),
('a0000000-0000-0000-0000-000000000015', 'pt-BR',
 'Reembolso / Crédito Não Processado — Consulta',
 'Resposta rápida sobre status de reembolso. Informa ao banco se um reembolso está em andamento, já foi processado ou não é devido.',
 'Cliente alega que um reembolso foi prometido mas não recebido — geralmente uma questão contábil.'),
('a0000000-0000-0000-0000-000000000016', 'pt-BR',
 'Duplicado / Valor Incorreto — Consulta',
 'Resposta curta com registros de transações mostrando que cada cobrança é distinta ou detalhando o valor contestado.',
 'Cliente questiona se foi cobrado duas vezes ou pelo valor errado.'),
('a0000000-0000-0000-0000-000000000017', 'pt-BR',
 'Baseado em Políticas — Consulta',
 'Resposta leve baseada em políticas. Apresenta a política mais relevante que o cliente aceitou no checkout.',
 'Consultas em que uma política clara e publicada responde à questão diretamente.'),
('a0000000-0000-0000-0000-000000000018', 'pt-BR',
 'Geral — Consulta',
 'Resposta mínima genérica para consultas que não se encaixam em um template específico. Um resumo do pedido mais qualquer contexto em texto livre.',
 'Qualquer consulta não tratada por um template mais específico.');

-- ═══════════════════════════════════════════════════════════════════════
-- SECTIONS (stable UUIDs for items-insert lookup)
-- ═══════════════════════════════════════════════════════════════════════

INSERT INTO pack_template_sections (id, template_id, title_key, title_default, sort) VALUES
  ('b0000000-0011-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000011', 'section_transaction_verification', 'Transaction Verification', 0),
  ('b0000000-0012-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000012', 'section_shipping_status', 'Shipping Status', 0),
  ('b0000000-0013-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000013', 'section_product_information', 'Product Information', 0),
  ('b0000000-0014-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000014', 'section_subscription_status', 'Subscription Status', 0),
  ('b0000000-0015-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000015', 'section_refund_status', 'Refund Status', 0),
  ('b0000000-0016-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000016', 'section_transaction_records_light', 'Transaction Records', 0),
  ('b0000000-0017-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000017', 'section_applicable_policy', 'Applicable Policy', 0),
  ('b0000000-0018-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000018', 'section_order_summary', 'Order Summary', 0);

-- ═══════════════════════════════════════════════════════════════════════
-- ITEMS (with collector_key set — uses the column added in 20260411120000)
-- ═══════════════════════════════════════════════════════════════════════

INSERT INTO pack_template_items (template_section_id, item_type, key, label_default, required, guidance_default, sort, collector_key) VALUES
-- Fraud inquiry
('b0000000-0011-0000-0000-000000000001', 'DOC_REQUIREMENT', 'order_confirmation', 'Order confirmation', true, 'Brief order summary showing the charge is legitimate.', 0, 'order_confirmation'),
('b0000000-0011-0000-0000-000000000001', 'DOC_REQUIREMENT', 'avs_cvv_match', 'AVS / CVV result', false, 'Payment verification data if readily available from your gateway.', 1, NULL),
('b0000000-0011-0000-0000-000000000001', 'DOC_REQUIREMENT', 'customer_account_info', 'Customer history', false, 'Note if this is a repeat customer in good standing.', 2, 'customer_communication'),

-- PNR inquiry
('b0000000-0012-0000-0000-000000000001', 'DOC_REQUIREMENT', 'tracking_number', 'Tracking status', true, 'Current tracking status from the carrier.', 0, 'shipping_tracking'),
('b0000000-0012-0000-0000-000000000001', 'DOC_REQUIREMENT', 'order_confirmation', 'Order and shipping timeline', true, 'Order date and when it shipped.', 1, 'order_confirmation'),
('b0000000-0012-0000-0000-000000000001', 'DOC_REQUIREMENT', 'customer_emails', 'Shipping notification', false, 'Shipping confirmation sent to the customer.', 2, 'customer_communication'),

-- Not as described inquiry
('b0000000-0013-0000-0000-000000000001', 'DOC_REQUIREMENT', 'order_confirmation', 'Order summary', true, 'Order summary with the product name the customer bought.', 0, 'order_confirmation'),
('b0000000-0013-0000-0000-000000000001', 'DOC_REQUIREMENT', 'product_description', 'Product description', false, 'Description the customer saw at the time of purchase.', 1, 'order_confirmation'),
('b0000000-0013-0000-0000-000000000001', 'NOTE', 'return_offered_note', 'Return offered', false, 'Note any return or exchange you have offered.', 2, NULL),

-- Subscription inquiry
('b0000000-0014-0000-0000-000000000001', 'DOC_REQUIREMENT', 'signup_confirmation', 'Signup confirmation', true, 'When and how the customer signed up.', 0, NULL),
('b0000000-0014-0000-0000-000000000001', 'DOC_REQUIREMENT', 'usage_activity', 'Most recent activity', false, 'Last login or service use, if applicable.', 1, NULL),
('b0000000-0014-0000-0000-000000000001', 'NOTE', 'cancellation_status_note', 'Cancellation status', true, 'Whether a cancellation request was received and when.', 2, NULL),

-- Refund inquiry
('b0000000-0015-0000-0000-000000000001', 'NOTE', 'processing_timeline_note', 'Refund status', true, 'Current status: processed, pending, or not applicable.', 0, NULL),
('b0000000-0015-0000-0000-000000000001', 'DOC_REQUIREMENT', 'refund_policy', 'Refund policy summary', false, 'Brief note on your refund policy.', 1, 'refund_policy'),
('b0000000-0015-0000-0000-000000000001', 'DOC_REQUIREMENT', 'customer_emails', 'Customer correspondence', false, 'Recent messages with the customer about the refund.', 2, 'customer_communication'),

-- Duplicate inquiry
('b0000000-0016-0000-0000-000000000001', 'DOC_REQUIREMENT', 'payment_records', 'Transaction list', true, 'All charges on this order showing each is distinct.', 0, 'order_confirmation'),
('b0000000-0016-0000-0000-000000000001', 'DOC_REQUIREMENT', 'order_itemization', 'Order breakdown', true, 'Line items and total for the charge in question.', 1, 'order_confirmation'),

-- Policy-forward inquiry
('b0000000-0017-0000-0000-000000000001', 'DOC_REQUIREMENT', 'relevant_policy', 'Relevant policy', true, 'The most applicable policy to this question.', 0, NULL),
('b0000000-0017-0000-0000-000000000001', 'DOC_REQUIREMENT', 'terms_acceptance', 'Customer acceptance', false, 'Proof the customer agreed to this policy at checkout.', 1, NULL),

-- General inquiry
('b0000000-0018-0000-0000-000000000001', 'DOC_REQUIREMENT', 'order_confirmation', 'Order summary', true, 'Brief order summary.', 0, 'order_confirmation'),
('b0000000-0018-0000-0000-000000000001', 'NOTE', 'additional_context', 'Additional context', false, 'Any other information relevant to this question.', 1, NULL);

-- ═══════════════════════════════════════════════════════════════════════
-- Section i18n (pt-BR)
-- ═══════════════════════════════════════════════════════════════════════

INSERT INTO pack_template_section_i18n (template_section_id, locale, title) VALUES
  ('b0000000-0011-0000-0000-000000000001', 'pt-BR', 'Verificação da Transação'),
  ('b0000000-0012-0000-0000-000000000001', 'pt-BR', 'Status do Envio'),
  ('b0000000-0013-0000-0000-000000000001', 'pt-BR', 'Informações do Produto'),
  ('b0000000-0014-0000-0000-000000000001', 'pt-BR', 'Status da Assinatura'),
  ('b0000000-0015-0000-0000-000000000001', 'pt-BR', 'Status do Reembolso'),
  ('b0000000-0016-0000-0000-000000000001', 'pt-BR', 'Registros de Transação'),
  ('b0000000-0017-0000-0000-000000000001', 'pt-BR', 'Política Aplicável'),
  ('b0000000-0018-0000-0000-000000000001', 'pt-BR', 'Resumo do Pedido');

-- ═══════════════════════════════════════════════════════════════════════
-- Item i18n (pt-BR) — matched by (template_section_id, key)
-- ═══════════════════════════════════════════════════════════════════════

INSERT INTO pack_template_item_i18n (template_item_id, locale, label, guidance)
SELECT pti.id, v.locale, v.label, v.guidance
FROM pack_template_items pti
JOIN (VALUES
  -- Fraud inquiry
  ('b0000000-0011-0000-0000-000000000001', 'order_confirmation', 'pt-BR', 'Confirmação do pedido', 'Resumo breve do pedido mostrando que a cobrança é legítima.'),
  ('b0000000-0011-0000-0000-000000000001', 'avs_cvv_match', 'pt-BR', 'Resultado AVS / CVV', 'Dados de verificação do pagamento, se disponíveis facilmente no gateway.'),
  ('b0000000-0011-0000-0000-000000000001', 'customer_account_info', 'pt-BR', 'Histórico do cliente', 'Anote se é um cliente recorrente em boa situação.'),

  -- PNR inquiry
  ('b0000000-0012-0000-0000-000000000001', 'tracking_number', 'pt-BR', 'Status do rastreamento', 'Status atual de rastreamento da transportadora.'),
  ('b0000000-0012-0000-0000-000000000001', 'order_confirmation', 'pt-BR', 'Linha do tempo do pedido e envio', 'Data do pedido e quando foi enviado.'),
  ('b0000000-0012-0000-0000-000000000001', 'customer_emails', 'pt-BR', 'Notificação de envio', 'Confirmação de envio enviada ao cliente.'),

  -- Not as described inquiry
  ('b0000000-0013-0000-0000-000000000001', 'order_confirmation', 'pt-BR', 'Resumo do pedido', 'Resumo do pedido com o nome do produto que o cliente comprou.'),
  ('b0000000-0013-0000-0000-000000000001', 'product_description', 'pt-BR', 'Descrição do produto', 'Descrição que o cliente viu no momento da compra.'),
  ('b0000000-0013-0000-0000-000000000001', 'return_offered_note', 'pt-BR', 'Devolução oferecida', 'Anote qualquer devolução ou troca que você tenha oferecido.'),

  -- Subscription inquiry
  ('b0000000-0014-0000-0000-000000000001', 'signup_confirmation', 'pt-BR', 'Confirmação de inscrição', 'Quando e como o cliente se inscreveu.'),
  ('b0000000-0014-0000-0000-000000000001', 'usage_activity', 'pt-BR', 'Atividade mais recente', 'Último login ou uso do serviço, se aplicável.'),
  ('b0000000-0014-0000-0000-000000000001', 'cancellation_status_note', 'pt-BR', 'Status do cancelamento', 'Se um pedido de cancelamento foi recebido e quando.'),

  -- Refund inquiry
  ('b0000000-0015-0000-0000-000000000001', 'processing_timeline_note', 'pt-BR', 'Status do reembolso', 'Status atual: processado, pendente ou não aplicável.'),
  ('b0000000-0015-0000-0000-000000000001', 'refund_policy', 'pt-BR', 'Resumo da política de reembolso', 'Nota breve sobre a sua política de reembolso.'),
  ('b0000000-0015-0000-0000-000000000001', 'customer_emails', 'pt-BR', 'Correspondência com o cliente', 'Mensagens recentes com o cliente sobre o reembolso.'),

  -- Duplicate inquiry
  ('b0000000-0016-0000-0000-000000000001', 'payment_records', 'pt-BR', 'Lista de transações', 'Todas as cobranças deste pedido mostrando que cada uma é distinta.'),
  ('b0000000-0016-0000-0000-000000000001', 'order_itemization', 'pt-BR', 'Detalhamento do pedido', 'Itens e total da cobrança em questão.'),

  -- Policy-forward inquiry
  ('b0000000-0017-0000-0000-000000000001', 'relevant_policy', 'pt-BR', 'Política relevante', 'A política mais aplicável a esta questão.'),
  ('b0000000-0017-0000-0000-000000000001', 'terms_acceptance', 'pt-BR', 'Aceitação do cliente', 'Prova de que o cliente concordou com esta política no checkout.'),

  -- General inquiry
  ('b0000000-0018-0000-0000-000000000001', 'order_confirmation', 'pt-BR', 'Resumo do pedido', 'Resumo breve do pedido.'),
  ('b0000000-0018-0000-0000-000000000001', 'additional_context', 'pt-BR', 'Contexto adicional', 'Qualquer outra informação relevante para esta questão.')
) AS v(template_section_id, key, locale, label, guidance)
  ON pti.template_section_id = v.template_section_id::uuid AND pti.key = v.key
ON CONFLICT (template_item_id, locale) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════
-- Repoint reason_template_mappings inquiry rows at the new inquiry variants
-- (chargeback rows keep their chargeback templates — only inquiry changes)
-- ═══════════════════════════════════════════════════════════════════════

UPDATE reason_template_mappings AS rtm
SET template_id = t.id, updated_at = now()
FROM pack_templates AS t
WHERE rtm.dispute_phase = 'inquiry'
  AND t.slug = 'fraud_inquiry'
  AND rtm.reason_code IN ('FRAUDULENT', 'UNRECOGNIZED', 'DEBIT_NOT_AUTHORIZED');

UPDATE reason_template_mappings AS rtm
SET template_id = t.id, updated_at = now()
FROM pack_templates AS t
WHERE rtm.dispute_phase = 'inquiry'
  AND t.slug = 'pnr_inquiry'
  AND rtm.reason_code = 'PRODUCT_NOT_RECEIVED';

UPDATE reason_template_mappings AS rtm
SET template_id = t.id, updated_at = now()
FROM pack_templates AS t
WHERE rtm.dispute_phase = 'inquiry'
  AND t.slug = 'not_as_described_inquiry'
  AND rtm.reason_code = 'PRODUCT_UNACCEPTABLE';

UPDATE reason_template_mappings AS rtm
SET template_id = t.id, updated_at = now()
FROM pack_templates AS t
WHERE rtm.dispute_phase = 'inquiry'
  AND t.slug = 'subscription_inquiry'
  AND rtm.reason_code = 'SUBSCRIPTION_CANCELED';

UPDATE reason_template_mappings AS rtm
SET template_id = t.id, updated_at = now()
FROM pack_templates AS t
WHERE rtm.dispute_phase = 'inquiry'
  AND t.slug = 'refund_inquiry'
  AND rtm.reason_code = 'CREDIT_NOT_PROCESSED';

UPDATE reason_template_mappings AS rtm
SET template_id = t.id, updated_at = now()
FROM pack_templates AS t
WHERE rtm.dispute_phase = 'inquiry'
  AND t.slug = 'duplicate_inquiry'
  AND rtm.reason_code = 'DUPLICATE';

UPDATE reason_template_mappings AS rtm
SET template_id = t.id, updated_at = now()
FROM pack_templates AS t
WHERE rtm.dispute_phase = 'inquiry'
  AND t.slug = 'policy_forward_inquiry'
  AND rtm.reason_code = 'NONCOMPLIANT';

UPDATE reason_template_mappings AS rtm
SET template_id = t.id, updated_at = now()
FROM pack_templates AS t
WHERE rtm.dispute_phase = 'inquiry'
  AND t.slug = 'general_inquiry'
  AND rtm.reason_code IN (
    'CUSTOMER_INITIATED',
    'GENERAL',
    'BANK_CANNOT_PROCESS',
    'INCORRECT_ACCOUNT_DETAILS',
    'INSUFFICIENT_FUNDS'
  );
