-- Klarna-specific inquiry template variants.
--
-- The card/generic inquiry templates (20260411150000_inquiry_template_variants)
-- foreground card constructs — e.g. the fraud inquiry asks for AVS/CVV — which
-- are MEANINGLESS for Klarna (a BNPL/local method with no card network exposed).
-- When a Klarna dispute is an inquiry, it still deserves a light 2–4 item
-- response, but keyed to what KLARNA actually adjudicates on (verified against
-- docs.klarna.com — see docs/klarna-dispute-handling-reference.md): a genuine
-- Proof of Delivery for goods-not-received, refund record/entitlement for
-- refund-not-processed, resolution-offered for not-as-described, delivery +
-- identity (never card auth) for unauthorized, and order breakdown for duplicate.
--
-- These templates are NOT wired into reason_template_mappings (that table is
-- keyed on (reason_code, dispute_phase) with no payment-method dimension —
-- repointing it would wrongly catch card inquiries too). Instead buildPack
-- swaps to the matching Klarna inquiry template dynamically when
-- paymentContext.family === 'klarna' AND phase === 'inquiry'
-- (see lib/packs/klarnaInquiryTemplate.ts). Card inquiries and all chargebacks
-- are untouched.
--
-- Reason → Klarna inquiry template (resolved in code, not via mappings):
--   PRODUCT_NOT_RECEIVED                              -> klarna_pnr_inquiry
--   CREDIT_NOT_PROCESSED                              -> klarna_refund_inquiry
--   PRODUCT_UNACCEPTABLE                              -> klarna_not_as_described_inquiry
--   FRAUDULENT / UNRECOGNIZED / DEBIT_NOT_AUTHORIZED  -> klarna_unauthorized_inquiry
--   DUPLICATE                                         -> klarna_duplicate_inquiry
--   (anything else)                                   -> falls back to the card general_inquiry
--
-- IMPORTANT: no item here uses avs_cvv_match / tds_authentication /
-- fraud_risk_screening / ip_location_check — those are card/fraud signals that
-- do not exist for Klarna.

-- ═══════════════════════════════════════════════════════════════════════
-- TEMPLATES
-- ═══════════════════════════════════════════════════════════════════════

INSERT INTO pack_templates (id, slug, dispute_type, is_recommended, status) VALUES
  ('a0000000-0000-0000-0000-000000000c01', 'klarna_pnr_inquiry', 'PRODUCT_NOT_RECEIVED', false, 'active'),
  ('a0000000-0000-0000-0000-000000000c02', 'klarna_refund_inquiry', 'CREDIT_NOT_PROCESSED', false, 'active'),
  ('a0000000-0000-0000-0000-000000000c03', 'klarna_not_as_described_inquiry', 'PRODUCT_UNACCEPTABLE', false, 'active'),
  ('a0000000-0000-0000-0000-000000000c04', 'klarna_unauthorized_inquiry', 'FRAUDULENT', false, 'active'),
  ('a0000000-0000-0000-0000-000000000c05', 'klarna_duplicate_inquiry', 'DUPLICATE', false, 'active')
ON CONFLICT (id) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════
-- TEMPLATE i18n — en-US canonical + 6 active app locales (en/de/es/fr/pt/sv)
-- ═══════════════════════════════════════════════════════════════════════

INSERT INTO pack_template_i18n (template_id, locale, name, short_description, works_best_for) VALUES
-- PNR
('a0000000-0000-0000-0000-000000000c01', 'en-US', 'Product Not Received — Klarna Inquiry',
 'Light Klarna response for pre-chargeback not-received inquiries. Foregrounds a genuine proof of delivery (carrier, tracking, delivery date, address, recipient) — a tracking link alone is not enough for Klarna.',
 'Klarna inquiries where the customer says the order was not received.'),
('a0000000-0000-0000-0000-000000000c01', 'en', 'Product Not Received — Klarna Inquiry',
 'Light Klarna response for pre-chargeback not-received inquiries. Foregrounds a genuine proof of delivery (carrier, tracking, delivery date, address, recipient) — a tracking link alone is not enough for Klarna.',
 'Klarna inquiries where the customer says the order was not received.'),
('a0000000-0000-0000-0000-000000000c01', 'de', 'Produkt nicht erhalten — Klarna-Anfrage',
 'Leichte Klarna-Antwort für Nicht-erhalten-Anfragen vor dem Chargeback. Stellt einen echten Zustellnachweis in den Vordergrund (Zusteller, Sendungsverfolgung, Zustelldatum, Adresse, Empfänger) — ein Tracking-Link allein reicht Klarna nicht.',
 'Klarna-Anfragen, bei denen der Kunde angibt, die Bestellung nicht erhalten zu haben.'),
('a0000000-0000-0000-0000-000000000c01', 'es', 'Producto no recibido — Consulta de Klarna',
 'Respuesta ligera de Klarna para consultas de no recibido previas al contracargo. Prioriza una prueba de entrega real (transportista, seguimiento, fecha, dirección, destinatario) — un enlace de seguimiento por sí solo no basta para Klarna.',
 'Consultas de Klarna donde el cliente dice que no recibió el pedido.'),
('a0000000-0000-0000-0000-000000000c01', 'fr', 'Produit non reçu — Demande Klarna',
 'Réponse Klarna légère pour les demandes de non-réception avant rétrofacturation. Met en avant une véritable preuve de livraison (transporteur, suivi, date, adresse, destinataire) — un lien de suivi seul ne suffit pas pour Klarna.',
 'Demandes Klarna où le client indique ne pas avoir reçu la commande.'),
('a0000000-0000-0000-0000-000000000c01', 'pt', 'Produto não recebido — Consulta Klarna',
 'Resposta leve da Klarna para consultas de não recebimento antes do chargeback. Prioriza uma prova de entrega real (transportadora, rastreamento, data, endereço, destinatário) — um link de rastreamento sozinho não basta para a Klarna.',
 'Consultas Klarna em que o cliente diz que não recebeu o pedido.'),
('a0000000-0000-0000-0000-000000000c01', 'sv', 'Produkt ej mottagen — Klarna-förfrågan',
 'Lätt Klarna-svar för ej-mottagen-förfrågningar före återkrav. Lyfter fram ett riktigt leveransbevis (transportör, spårning, datum, adress, mottagare) — enbart en spårningslänk räcker inte för Klarna.',
 'Klarna-förfrågningar där kunden uppger att beställningen inte mottagits.'),
-- Refund
('a0000000-0000-0000-0000-000000000c02', 'en-US', 'Refund Not Processed — Klarna Inquiry',
 'Light Klarna refund-status response. States whether a refund was processed, is pending, or was not owed, tied to the Klarna order.',
 'Klarna inquiries where the customer says a refund was not processed.'),
('a0000000-0000-0000-0000-000000000c02', 'en', 'Refund Not Processed — Klarna Inquiry',
 'Light Klarna refund-status response. States whether a refund was processed, is pending, or was not owed, tied to the Klarna order.',
 'Klarna inquiries where the customer says a refund was not processed.'),
('a0000000-0000-0000-0000-000000000c02', 'de', 'Rückerstattung nicht bearbeitet — Klarna-Anfrage',
 'Leichte Klarna-Antwort zum Rückerstattungsstatus. Gibt an, ob eine Rückerstattung erfolgt ist, aussteht oder nicht geschuldet war — bezogen auf die Klarna-Bestellung.',
 'Klarna-Anfragen, bei denen der Kunde angibt, eine Rückerstattung sei nicht erfolgt.'),
('a0000000-0000-0000-0000-000000000c02', 'es', 'Reembolso no procesado — Consulta de Klarna',
 'Respuesta ligera de Klarna sobre el estado del reembolso. Indica si un reembolso se procesó, está pendiente o no correspondía, vinculado al pedido de Klarna.',
 'Consultas de Klarna donde el cliente dice que no se procesó un reembolso.'),
('a0000000-0000-0000-0000-000000000c02', 'fr', 'Remboursement non traité — Demande Klarna',
 'Réponse Klarna légère sur le statut du remboursement. Indique si un remboursement a été traité, est en attente ou n’était pas dû, lié à la commande Klarna.',
 'Demandes Klarna où le client indique qu’un remboursement n’a pas été traité.'),
('a0000000-0000-0000-0000-000000000c02', 'pt', 'Reembolso não processado — Consulta Klarna',
 'Resposta leve da Klarna sobre o status do reembolso. Informa se um reembolso foi processado, está pendente ou não era devido, vinculado ao pedido Klarna.',
 'Consultas Klarna em que o cliente diz que um reembolso não foi processado.'),
('a0000000-0000-0000-0000-000000000c02', 'sv', 'Återbetalning ej behandlad — Klarna-förfrågan',
 'Lätt Klarna-svar om återbetalningsstatus. Anger om en återbetalning behandlats, väntar eller inte skulle utgå, kopplat till Klarna-beställningen.',
 'Klarna-förfrågningar där kunden uppger att en återbetalning inte behandlats.'),
-- Not as described
('a0000000-0000-0000-0000-000000000c03', 'en-US', 'Product Not as Described — Klarna Inquiry',
 'Light Klarna response for quality / not-as-described inquiries. Foregrounds the order, the resolution offered (repair, replacement, or refund), and any return label.',
 'Klarna inquiries about item quality or not-as-described.'),
('a0000000-0000-0000-0000-000000000c03', 'en', 'Product Not as Described — Klarna Inquiry',
 'Light Klarna response for quality / not-as-described inquiries. Foregrounds the order, the resolution offered (repair, replacement, or refund), and any return label.',
 'Klarna inquiries about item quality or not-as-described.'),
('a0000000-0000-0000-0000-000000000c03', 'de', 'Produkt nicht wie beschrieben — Klarna-Anfrage',
 'Leichte Klarna-Antwort für Qualitäts- / Nicht-wie-beschrieben-Anfragen. Stellt die Bestellung, die angebotene Lösung (Reparatur, Ersatz oder Rückerstattung) und ein etwaiges Rücksendeetikett in den Vordergrund.',
 'Klarna-Anfragen zur Produktqualität oder Nicht-wie-beschrieben.'),
('a0000000-0000-0000-0000-000000000c03', 'es', 'Producto no conforme — Consulta de Klarna',
 'Respuesta ligera de Klarna para consultas de calidad o no conforme. Prioriza el pedido, la solución ofrecida (reparación, reemplazo o reembolso) y cualquier etiqueta de devolución.',
 'Consultas de Klarna sobre la calidad del producto o no conforme.'),
('a0000000-0000-0000-0000-000000000c03', 'fr', 'Produit non conforme — Demande Klarna',
 'Réponse Klarna légère pour les demandes de qualité / non conforme. Met en avant la commande, la solution proposée (réparation, remplacement ou remboursement) et toute étiquette de retour.',
 'Demandes Klarna sur la qualité du produit ou non conforme.'),
('a0000000-0000-0000-0000-000000000c03', 'pt', 'Produto não conforme — Consulta Klarna',
 'Resposta leve da Klarna para consultas de qualidade ou não conforme. Prioriza o pedido, a solução oferecida (reparo, troca ou reembolso) e qualquer etiqueta de devolução.',
 'Consultas Klarna sobre qualidade do produto ou não conforme.'),
('a0000000-0000-0000-0000-000000000c03', 'sv', 'Produkt ej som beskriven — Klarna-förfrågan',
 'Lätt Klarna-svar för kvalitets- / ej-som-beskriven-förfrågningar. Lyfter fram beställningen, den erbjudna lösningen (reparation, ersättning eller återbetalning) och eventuell returetikett.',
 'Klarna-förfrågningar om produktkvalitet eller ej som beskriven.'),
-- Unauthorized
('a0000000-0000-0000-0000-000000000c04', 'en-US', 'Unauthorized Purchase — Klarna Inquiry',
 'Light Klarna response for unauthorized-purchase inquiries. Foregrounds delivery to the customer and account/identity — never card authentication (which does not exist for Klarna).',
 'Klarna inquiries where the customer says they did not authorize the purchase.'),
('a0000000-0000-0000-0000-000000000c04', 'en', 'Unauthorized Purchase — Klarna Inquiry',
 'Light Klarna response for unauthorized-purchase inquiries. Foregrounds delivery to the customer and account/identity — never card authentication (which does not exist for Klarna).',
 'Klarna inquiries where the customer says they did not authorize the purchase.'),
('a0000000-0000-0000-0000-000000000c04', 'de', 'Nicht autorisierter Kauf — Klarna-Anfrage',
 'Leichte Klarna-Antwort für Anfragen zu nicht autorisierten Käufen. Stellt die Zustellung an den Kunden und Konto/Identität in den Vordergrund — niemals Karten-Authentifizierung (die es bei Klarna nicht gibt).',
 'Klarna-Anfragen, bei denen der Kunde den Kauf nicht autorisiert haben will.'),
('a0000000-0000-0000-0000-000000000c04', 'es', 'Compra no autorizada — Consulta de Klarna',
 'Respuesta ligera de Klarna para consultas de compra no autorizada. Prioriza la entrega al cliente y la cuenta/identidad — nunca la autenticación de tarjeta (que no existe en Klarna).',
 'Consultas de Klarna donde el cliente dice que no autorizó la compra.'),
('a0000000-0000-0000-0000-000000000c04', 'fr', 'Achat non autorisé — Demande Klarna',
 'Réponse Klarna légère pour les demandes d’achat non autorisé. Met en avant la livraison au client et le compte/l’identité — jamais l’authentification par carte (qui n’existe pas pour Klarna).',
 'Demandes Klarna où le client indique ne pas avoir autorisé l’achat.'),
('a0000000-0000-0000-0000-000000000c04', 'pt', 'Compra não autorizada — Consulta Klarna',
 'Resposta leve da Klarna para consultas de compra não autorizada. Prioriza a entrega ao cliente e a conta/identidade — nunca a autenticação de cartão (que não existe na Klarna).',
 'Consultas Klarna em que o cliente diz que não autorizou a compra.'),
('a0000000-0000-0000-0000-000000000c04', 'sv', 'Obehörigt köp — Klarna-förfrågan',
 'Lätt Klarna-svar för förfrågningar om obehörigt köp. Lyfter fram leverans till kunden och konto/identitet — aldrig kortautentisering (som inte finns för Klarna).',
 'Klarna-förfrågningar där kunden uppger att köpet inte auktoriserats.'),
-- Duplicate
('a0000000-0000-0000-0000-000000000c05', 'en-US', 'Duplicate / Incorrect Amount — Klarna Inquiry',
 'Light Klarna response showing each charge is distinct or breaking down the disputed amount, tied to the Klarna order.',
 'Klarna inquiries about a double charge or an incorrect amount.'),
('a0000000-0000-0000-0000-000000000c05', 'en', 'Duplicate / Incorrect Amount — Klarna Inquiry',
 'Light Klarna response showing each charge is distinct or breaking down the disputed amount, tied to the Klarna order.',
 'Klarna inquiries about a double charge or an incorrect amount.'),
('a0000000-0000-0000-0000-000000000c05', 'de', 'Doppelbuchung / Falscher Betrag — Klarna-Anfrage',
 'Leichte Klarna-Antwort, die zeigt, dass jede Buchung eigenständig ist, oder den strittigen Betrag aufschlüsselt — bezogen auf die Klarna-Bestellung.',
 'Klarna-Anfragen zu einer Doppelbuchung oder einem falschen Betrag.'),
('a0000000-0000-0000-0000-000000000c05', 'es', 'Duplicado / Importe incorrecto — Consulta de Klarna',
 'Respuesta ligera de Klarna que muestra que cada cargo es distinto o desglosa el importe en disputa, vinculado al pedido de Klarna.',
 'Consultas de Klarna sobre un cargo doble o un importe incorrecto.'),
('a0000000-0000-0000-0000-000000000c05', 'fr', 'Doublon / Montant incorrect — Demande Klarna',
 'Réponse Klarna légère montrant que chaque débit est distinct ou détaillant le montant contesté, lié à la commande Klarna.',
 'Demandes Klarna sur un double débit ou un montant incorrect.'),
('a0000000-0000-0000-0000-000000000c05', 'pt', 'Duplicado / Valor incorreto — Consulta Klarna',
 'Resposta leve da Klarna mostrando que cada cobrança é distinta ou detalhando o valor contestado, vinculado ao pedido Klarna.',
 'Consultas Klarna sobre uma cobrança dupla ou um valor incorreto.'),
('a0000000-0000-0000-0000-000000000c05', 'sv', 'Dubblett / Felaktigt belopp — Klarna-förfrågan',
 'Lätt Klarna-svar som visar att varje debitering är separat eller specificerar det omtvistade beloppet, kopplat till Klarna-beställningen.',
 'Klarna-förfrågningar om en dubbeldebitering eller ett felaktigt belopp.')
ON CONFLICT (template_id, locale) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════
-- SECTIONS (one per template)
-- ═══════════════════════════════════════════════════════════════════════

INSERT INTO pack_template_sections (id, template_id, title_key, title_default, sort) VALUES
  ('b0000000-0c01-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000c01', 'section_shipping_status', 'Shipping Status', 0),
  ('b0000000-0c02-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000c02', 'section_refund_status', 'Refund Status', 0),
  ('b0000000-0c03-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000c03', 'section_product_information', 'Product Information', 0),
  ('b0000000-0c04-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000c04', 'section_transaction_verification', 'Transaction Verification', 0),
  ('b0000000-0c05-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000c05', 'section_transaction_records_light', 'Transaction Records', 0)
ON CONFLICT (id) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════
-- ITEMS — Klarna-relevant collectors ONLY (no avs_cvv / 3DS / fraud / ip)
-- ═══════════════════════════════════════════════════════════════════════

INSERT INTO pack_template_items (template_section_id, item_type, key, label_default, required, guidance_default, sort, collector_key) VALUES
-- Klarna PNR inquiry — Proof of Delivery is what Klarna weighs
('b0000000-0c01-0000-0000-000000000001', 'DOC_REQUIREMENT', 'tracking_number', 'Tracking status', true, 'Current carrier tracking status and number for this order.', 0, 'shipping_tracking'),
('b0000000-0c01-0000-0000-000000000001', 'DOC_REQUIREMENT', 'delivery_proof', 'Proof of delivery', true, 'Delivery date, delivery address, and recipient/signature where available. Klarna does not accept a tracking link alone.', 1, 'delivery_proof'),
('b0000000-0c01-0000-0000-000000000001', 'DOC_REQUIREMENT', 'shipping_notification', 'Shipping notification', false, 'Shipping confirmation sent to the customer.', 2, 'customer_communication'),

-- Klarna refund inquiry
('b0000000-0c02-0000-0000-000000000001', 'DOC_REQUIREMENT', 'refund_record', 'Refund status', true, 'Whether a refund was processed, is pending, or was not owed — with amount and date if issued.', 0, 'refund_record'),
('b0000000-0c02-0000-0000-000000000001', 'DOC_REQUIREMENT', 'refund_policy', 'Refund / return policy', false, 'The refund or return policy the customer accepted at checkout.', 1, 'refund_policy'),
('b0000000-0c02-0000-0000-000000000001', 'DOC_REQUIREMENT', 'customer_emails', 'Customer correspondence', false, 'Recent messages with the customer about the refund.', 2, 'customer_communication'),

-- Klarna not-as-described inquiry
('b0000000-0c03-0000-0000-000000000001', 'DOC_REQUIREMENT', 'order_confirmation', 'Order summary', true, 'Order summary with the product the customer bought.', 0, 'order_confirmation'),
('b0000000-0c03-0000-0000-000000000001', 'NOTE', 'resolution_offered_note', 'Resolution offered', true, 'Any repair, replacement, or refund you offered, and when.', 1, NULL),
('b0000000-0c03-0000-0000-000000000001', 'DOC_REQUIREMENT', 'return_policy', 'Return label / policy', false, 'Return label provided or the applicable return policy.', 2, 'shipping_policy'),

-- Klarna unauthorized inquiry — delivery + identity, NEVER card auth
('b0000000-0c04-0000-0000-000000000001', 'DOC_REQUIREMENT', 'delivery_to_customer', 'Delivery to the customer', true, 'Proof the order was delivered to the customer''s address (carrier, date, address).', 0, 'delivery_proof'),
('b0000000-0c04-0000-0000-000000000001', 'DOC_REQUIREMENT', 'customer_account_info', 'Account / order history', false, 'Customer account identity and prior order history, if a repeat customer.', 1, 'customer_account_info'),
('b0000000-0c04-0000-0000-000000000001', 'DOC_REQUIREMENT', 'customer_ack', 'Customer correspondence', false, 'Any message from the customer acknowledging the order.', 2, 'customer_communication'),

-- Klarna duplicate inquiry
('b0000000-0c05-0000-0000-000000000001', 'DOC_REQUIREMENT', 'payment_records', 'Transaction list', true, 'All charges on this order showing each is distinct.', 0, 'order_confirmation'),
('b0000000-0c05-0000-0000-000000000001', 'DOC_REQUIREMENT', 'order_itemization', 'Order breakdown', true, 'Line items and total for the charge in question, tied to the Klarna order.', 1, 'order_confirmation')
ON CONFLICT DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════
-- Section i18n — 6 active locales (short codes). Titles reuse the shared
-- section vocabulary from the card inquiry variants.
-- ═══════════════════════════════════════════════════════════════════════

INSERT INTO pack_template_section_i18n (template_section_id, locale, title) VALUES
  ('b0000000-0c01-0000-0000-000000000001', 'en', 'Shipping Status'),
  ('b0000000-0c01-0000-0000-000000000001', 'de', 'Versandstatus'),
  ('b0000000-0c01-0000-0000-000000000001', 'es', 'Estado del envío'),
  ('b0000000-0c01-0000-0000-000000000001', 'fr', 'Statut de l’expédition'),
  ('b0000000-0c01-0000-0000-000000000001', 'pt', 'Status do envio'),
  ('b0000000-0c01-0000-0000-000000000001', 'sv', 'Fraktstatus'),
  ('b0000000-0c02-0000-0000-000000000001', 'en', 'Refund Status'),
  ('b0000000-0c02-0000-0000-000000000001', 'de', 'Rückerstattungsstatus'),
  ('b0000000-0c02-0000-0000-000000000001', 'es', 'Estado del reembolso'),
  ('b0000000-0c02-0000-0000-000000000001', 'fr', 'Statut du remboursement'),
  ('b0000000-0c02-0000-0000-000000000001', 'pt', 'Status do reembolso'),
  ('b0000000-0c02-0000-0000-000000000001', 'sv', 'Återbetalningsstatus'),
  ('b0000000-0c03-0000-0000-000000000001', 'en', 'Product Information'),
  ('b0000000-0c03-0000-0000-000000000001', 'de', 'Produktinformationen'),
  ('b0000000-0c03-0000-0000-000000000001', 'es', 'Información del producto'),
  ('b0000000-0c03-0000-0000-000000000001', 'fr', 'Informations sur le produit'),
  ('b0000000-0c03-0000-0000-000000000001', 'pt', 'Informações do produto'),
  ('b0000000-0c03-0000-0000-000000000001', 'sv', 'Produktinformation'),
  ('b0000000-0c04-0000-0000-000000000001', 'en', 'Transaction Verification'),
  ('b0000000-0c04-0000-0000-000000000001', 'de', 'Transaktionsprüfung'),
  ('b0000000-0c04-0000-0000-000000000001', 'es', 'Verificación de la transacción'),
  ('b0000000-0c04-0000-0000-000000000001', 'fr', 'Vérification de la transaction'),
  ('b0000000-0c04-0000-0000-000000000001', 'pt', 'Verificação da transação'),
  ('b0000000-0c04-0000-0000-000000000001', 'sv', 'Transaktionsverifiering'),
  ('b0000000-0c05-0000-0000-000000000001', 'en', 'Transaction Records'),
  ('b0000000-0c05-0000-0000-000000000001', 'de', 'Transaktionsnachweise'),
  ('b0000000-0c05-0000-0000-000000000001', 'es', 'Registros de transacciones'),
  ('b0000000-0c05-0000-0000-000000000001', 'fr', 'Registres de transactions'),
  ('b0000000-0c05-0000-0000-000000000001', 'pt', 'Registros de transações'),
  ('b0000000-0c05-0000-0000-000000000001', 'sv', 'Transaktionsposter')
ON CONFLICT (template_section_id, locale) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════
-- Item i18n — 6 active locales, matched by (template_section_id, key)
-- ═══════════════════════════════════════════════════════════════════════

INSERT INTO pack_template_item_i18n (template_item_id, locale, label, guidance)
SELECT pti.id, v.locale, v.label, v.guidance
FROM pack_template_items pti
JOIN (VALUES
  -- PNR
  ('b0000000-0c01-0000-0000-000000000001', 'tracking_number', 'en', 'Tracking status', 'Current carrier tracking status and number for this order.'),
  ('b0000000-0c01-0000-0000-000000000001', 'tracking_number', 'de', 'Sendungsstatus', 'Aktueller Sendungsstatus und Trackingnummer für diese Bestellung.'),
  ('b0000000-0c01-0000-0000-000000000001', 'tracking_number', 'es', 'Estado del seguimiento', 'Estado y número de seguimiento actuales del transportista para este pedido.'),
  ('b0000000-0c01-0000-0000-000000000001', 'tracking_number', 'fr', 'Statut du suivi', 'Statut et numéro de suivi actuels du transporteur pour cette commande.'),
  ('b0000000-0c01-0000-0000-000000000001', 'tracking_number', 'pt', 'Status do rastreamento', 'Status e número de rastreamento atuais da transportadora para este pedido.'),
  ('b0000000-0c01-0000-0000-000000000001', 'tracking_number', 'sv', 'Spårningsstatus', 'Aktuell spårningsstatus och spårningsnummer för denna beställning.'),
  ('b0000000-0c01-0000-0000-000000000001', 'delivery_proof', 'en', 'Proof of delivery', 'Delivery date, delivery address, and recipient/signature where available. Klarna does not accept a tracking link alone.'),
  ('b0000000-0c01-0000-0000-000000000001', 'delivery_proof', 'de', 'Zustellnachweis', 'Zustelldatum, Zustelladresse und Empfänger/Unterschrift, sofern verfügbar. Klarna akzeptiert keinen reinen Tracking-Link.'),
  ('b0000000-0c01-0000-0000-000000000001', 'delivery_proof', 'es', 'Prueba de entrega', 'Fecha de entrega, dirección y destinatario/firma cuando estén disponibles. Klarna no acepta solo un enlace de seguimiento.'),
  ('b0000000-0c01-0000-0000-000000000001', 'delivery_proof', 'fr', 'Preuve de livraison', 'Date de livraison, adresse et destinataire/signature si disponibles. Klarna n’accepte pas un simple lien de suivi.'),
  ('b0000000-0c01-0000-0000-000000000001', 'delivery_proof', 'pt', 'Prova de entrega', 'Data de entrega, endereço e destinatário/assinatura quando disponíveis. A Klarna não aceita apenas um link de rastreamento.'),
  ('b0000000-0c01-0000-0000-000000000001', 'delivery_proof', 'sv', 'Leveransbevis', 'Leveransdatum, leveransadress och mottagare/signatur när tillgängligt. Klarna godtar inte enbart en spårningslänk.'),
  ('b0000000-0c01-0000-0000-000000000001', 'shipping_notification', 'en', 'Shipping notification', 'Shipping confirmation sent to the customer.'),
  ('b0000000-0c01-0000-0000-000000000001', 'shipping_notification', 'de', 'Versandbenachrichtigung', 'An den Kunden gesendete Versandbestätigung.'),
  ('b0000000-0c01-0000-0000-000000000001', 'shipping_notification', 'es', 'Notificación de envío', 'Confirmación de envío enviada al cliente.'),
  ('b0000000-0c01-0000-0000-000000000001', 'shipping_notification', 'fr', 'Notification d’expédition', 'Confirmation d’expédition envoyée au client.'),
  ('b0000000-0c01-0000-0000-000000000001', 'shipping_notification', 'pt', 'Notificação de envio', 'Confirmação de envio enviada ao cliente.'),
  ('b0000000-0c01-0000-0000-000000000001', 'shipping_notification', 'sv', 'Fraktavisering', 'Fraktbekräftelse som skickats till kunden.'),
  -- Refund
  ('b0000000-0c02-0000-0000-000000000001', 'refund_record', 'en', 'Refund status', 'Whether a refund was processed, is pending, or was not owed — with amount and date if issued.'),
  ('b0000000-0c02-0000-0000-000000000001', 'refund_record', 'de', 'Rückerstattungsstatus', 'Ob eine Rückerstattung erfolgt ist, aussteht oder nicht geschuldet war — mit Betrag und Datum, falls erfolgt.'),
  ('b0000000-0c02-0000-0000-000000000001', 'refund_record', 'es', 'Estado del reembolso', 'Si un reembolso se procesó, está pendiente o no correspondía — con importe y fecha si se emitió.'),
  ('b0000000-0c02-0000-0000-000000000001', 'refund_record', 'fr', 'Statut du remboursement', 'Si un remboursement a été traité, est en attente ou n’était pas dû — avec montant et date le cas échéant.'),
  ('b0000000-0c02-0000-0000-000000000001', 'refund_record', 'pt', 'Status do reembolso', 'Se um reembolso foi processado, está pendente ou não era devido — com valor e data, se emitido.'),
  ('b0000000-0c02-0000-0000-000000000001', 'refund_record', 'sv', 'Återbetalningsstatus', 'Om en återbetalning behandlats, väntar eller inte skulle utgå — med belopp och datum om utförd.'),
  ('b0000000-0c02-0000-0000-000000000001', 'refund_policy', 'en', 'Refund / return policy', 'The refund or return policy the customer accepted at checkout.'),
  ('b0000000-0c02-0000-0000-000000000001', 'refund_policy', 'de', 'Rückerstattungs-/Rückgaberichtlinie', 'Die vom Kunden beim Checkout akzeptierte Rückerstattungs- oder Rückgaberichtlinie.'),
  ('b0000000-0c02-0000-0000-000000000001', 'refund_policy', 'es', 'Política de reembolso/devolución', 'La política de reembolso o devolución que el cliente aceptó al pagar.'),
  ('b0000000-0c02-0000-0000-000000000001', 'refund_policy', 'fr', 'Politique de remboursement/retour', 'La politique de remboursement ou de retour acceptée par le client au paiement.'),
  ('b0000000-0c02-0000-0000-000000000001', 'refund_policy', 'pt', 'Política de reembolso/devolução', 'A política de reembolso ou devolução que o cliente aceitou no checkout.'),
  ('b0000000-0c02-0000-0000-000000000001', 'refund_policy', 'sv', 'Återbetalnings-/returpolicy', 'Den återbetalnings- eller returpolicy kunden godkände i kassan.'),
  ('b0000000-0c02-0000-0000-000000000001', 'customer_emails', 'en', 'Customer correspondence', 'Recent messages with the customer about the refund.'),
  ('b0000000-0c02-0000-0000-000000000001', 'customer_emails', 'de', 'Kundenkorrespondenz', 'Aktuelle Nachrichten mit dem Kunden zur Rückerstattung.'),
  ('b0000000-0c02-0000-0000-000000000001', 'customer_emails', 'es', 'Correspondencia con el cliente', 'Mensajes recientes con el cliente sobre el reembolso.'),
  ('b0000000-0c02-0000-0000-000000000001', 'customer_emails', 'fr', 'Correspondance client', 'Messages récents avec le client concernant le remboursement.'),
  ('b0000000-0c02-0000-0000-000000000001', 'customer_emails', 'pt', 'Correspondência com o cliente', 'Mensagens recentes com o cliente sobre o reembolso.'),
  ('b0000000-0c02-0000-0000-000000000001', 'customer_emails', 'sv', 'Kundkorrespondens', 'Senaste meddelanden med kunden om återbetalningen.'),
  -- Not as described
  ('b0000000-0c03-0000-0000-000000000001', 'order_confirmation', 'en', 'Order summary', 'Order summary with the product the customer bought.'),
  ('b0000000-0c03-0000-0000-000000000001', 'order_confirmation', 'de', 'Bestellübersicht', 'Bestellübersicht mit dem vom Kunden gekauften Produkt.'),
  ('b0000000-0c03-0000-0000-000000000001', 'order_confirmation', 'es', 'Resumen del pedido', 'Resumen del pedido con el producto que compró el cliente.'),
  ('b0000000-0c03-0000-0000-000000000001', 'order_confirmation', 'fr', 'Récapitulatif de commande', 'Récapitulatif de la commande avec le produit acheté par le client.'),
  ('b0000000-0c03-0000-0000-000000000001', 'order_confirmation', 'pt', 'Resumo do pedido', 'Resumo do pedido com o produto que o cliente comprou.'),
  ('b0000000-0c03-0000-0000-000000000001', 'order_confirmation', 'sv', 'Beställningssammanfattning', 'Beställningssammanfattning med produkten kunden köpte.'),
  ('b0000000-0c03-0000-0000-000000000001', 'resolution_offered_note', 'en', 'Resolution offered', 'Any repair, replacement, or refund you offered, and when.'),
  ('b0000000-0c03-0000-0000-000000000001', 'resolution_offered_note', 'de', 'Angebotene Lösung', 'Jede angebotene Reparatur, Ersatzlieferung oder Rückerstattung und wann.'),
  ('b0000000-0c03-0000-0000-000000000001', 'resolution_offered_note', 'es', 'Solución ofrecida', 'Cualquier reparación, reemplazo o reembolso que ofreciste, y cuándo.'),
  ('b0000000-0c03-0000-0000-000000000001', 'resolution_offered_note', 'fr', 'Solution proposée', 'Toute réparation, tout remplacement ou remboursement proposé, et quand.'),
  ('b0000000-0c03-0000-0000-000000000001', 'resolution_offered_note', 'pt', 'Solução oferecida', 'Qualquer reparo, troca ou reembolso que você ofereceu, e quando.'),
  ('b0000000-0c03-0000-0000-000000000001', 'resolution_offered_note', 'sv', 'Erbjuden lösning', 'Eventuell reparation, ersättning eller återbetalning du erbjöd, och när.'),
  ('b0000000-0c03-0000-0000-000000000001', 'return_policy', 'en', 'Return label / policy', 'Return label provided or the applicable return policy.'),
  ('b0000000-0c03-0000-0000-000000000001', 'return_policy', 'de', 'Rücksendeetikett / Richtlinie', 'Bereitgestelltes Rücksendeetikett oder die geltende Rückgaberichtlinie.'),
  ('b0000000-0c03-0000-0000-000000000001', 'return_policy', 'es', 'Etiqueta / política de devolución', 'Etiqueta de devolución proporcionada o la política de devolución aplicable.'),
  ('b0000000-0c03-0000-0000-000000000001', 'return_policy', 'fr', 'Étiquette / politique de retour', 'Étiquette de retour fournie ou la politique de retour applicable.'),
  ('b0000000-0c03-0000-0000-000000000001', 'return_policy', 'pt', 'Etiqueta / política de devolução', 'Etiqueta de devolução fornecida ou a política de devolução aplicável.'),
  ('b0000000-0c03-0000-0000-000000000001', 'return_policy', 'sv', 'Returetikett / policy', 'Tillhandahållen returetikett eller gällande returpolicy.'),
  -- Unauthorized
  ('b0000000-0c04-0000-0000-000000000001', 'delivery_to_customer', 'en', 'Delivery to the customer', 'Proof the order was delivered to the customer''s address (carrier, date, address).'),
  ('b0000000-0c04-0000-0000-000000000001', 'delivery_to_customer', 'de', 'Zustellung an den Kunden', 'Nachweis der Zustellung an die Adresse des Kunden (Zusteller, Datum, Adresse).'),
  ('b0000000-0c04-0000-0000-000000000001', 'delivery_to_customer', 'es', 'Entrega al cliente', 'Prueba de que el pedido se entregó en la dirección del cliente (transportista, fecha, dirección).'),
  ('b0000000-0c04-0000-0000-000000000001', 'delivery_to_customer', 'fr', 'Livraison au client', 'Preuve que la commande a été livrée à l’adresse du client (transporteur, date, adresse).'),
  ('b0000000-0c04-0000-0000-000000000001', 'delivery_to_customer', 'pt', 'Entrega ao cliente', 'Prova de que o pedido foi entregue no endereço do cliente (transportadora, data, endereço).'),
  ('b0000000-0c04-0000-0000-000000000001', 'delivery_to_customer', 'sv', 'Leverans till kunden', 'Bevis på att beställningen levererades till kundens adress (transportör, datum, adress).'),
  ('b0000000-0c04-0000-0000-000000000001', 'customer_account_info', 'en', 'Account / order history', 'Customer account identity and prior order history, if a repeat customer.'),
  ('b0000000-0c04-0000-0000-000000000001', 'customer_account_info', 'de', 'Konto / Bestellhistorie', 'Kontoidentität und frühere Bestellhistorie, falls Stammkunde.'),
  ('b0000000-0c04-0000-0000-000000000001', 'customer_account_info', 'es', 'Cuenta / historial de pedidos', 'Identidad de la cuenta e historial de pedidos previos, si es cliente recurrente.'),
  ('b0000000-0c04-0000-0000-000000000001', 'customer_account_info', 'fr', 'Compte / historique de commandes', 'Identité du compte et historique des commandes précédentes, si client fidèle.'),
  ('b0000000-0c04-0000-0000-000000000001', 'customer_account_info', 'pt', 'Conta / histórico de pedidos', 'Identidade da conta e histórico de pedidos anteriores, se cliente recorrente.'),
  ('b0000000-0c04-0000-0000-000000000001', 'customer_account_info', 'sv', 'Konto / orderhistorik', 'Kontoidentitet och tidigare orderhistorik, om återkommande kund.'),
  ('b0000000-0c04-0000-0000-000000000001', 'customer_ack', 'en', 'Customer correspondence', 'Any message from the customer acknowledging the order.'),
  ('b0000000-0c04-0000-0000-000000000001', 'customer_ack', 'de', 'Kundenkorrespondenz', 'Jede Nachricht des Kunden, die die Bestellung bestätigt.'),
  ('b0000000-0c04-0000-0000-000000000001', 'customer_ack', 'es', 'Correspondencia con el cliente', 'Cualquier mensaje del cliente que reconozca el pedido.'),
  ('b0000000-0c04-0000-0000-000000000001', 'customer_ack', 'fr', 'Correspondance client', 'Tout message du client reconnaissant la commande.'),
  ('b0000000-0c04-0000-0000-000000000001', 'customer_ack', 'pt', 'Correspondência com o cliente', 'Qualquer mensagem do cliente reconhecendo o pedido.'),
  ('b0000000-0c04-0000-0000-000000000001', 'customer_ack', 'sv', 'Kundkorrespondens', 'Eventuellt meddelande från kunden som bekräftar beställningen.'),
  -- Duplicate
  ('b0000000-0c05-0000-0000-000000000001', 'payment_records', 'en', 'Transaction list', 'All charges on this order showing each is distinct.'),
  ('b0000000-0c05-0000-0000-000000000001', 'payment_records', 'de', 'Transaktionsliste', 'Alle Buchungen dieser Bestellung, die zeigen, dass jede eigenständig ist.'),
  ('b0000000-0c05-0000-0000-000000000001', 'payment_records', 'es', 'Lista de transacciones', 'Todos los cargos de este pedido mostrando que cada uno es distinto.'),
  ('b0000000-0c05-0000-0000-000000000001', 'payment_records', 'fr', 'Liste des transactions', 'Tous les débits de cette commande montrant que chacun est distinct.'),
  ('b0000000-0c05-0000-0000-000000000001', 'payment_records', 'pt', 'Lista de transações', 'Todas as cobranças deste pedido mostrando que cada uma é distinta.'),
  ('b0000000-0c05-0000-0000-000000000001', 'payment_records', 'sv', 'Transaktionslista', 'Alla debiteringar på denna beställning som visar att varje är separat.'),
  ('b0000000-0c05-0000-0000-000000000001', 'order_itemization', 'en', 'Order breakdown', 'Line items and total for the charge in question, tied to the Klarna order.'),
  ('b0000000-0c05-0000-0000-000000000001', 'order_itemization', 'de', 'Bestellaufschlüsselung', 'Positionen und Gesamtbetrag der betreffenden Buchung, bezogen auf die Klarna-Bestellung.'),
  ('b0000000-0c05-0000-0000-000000000001', 'order_itemization', 'es', 'Desglose del pedido', 'Líneas y total del cargo en cuestión, vinculados al pedido de Klarna.'),
  ('b0000000-0c05-0000-0000-000000000001', 'order_itemization', 'fr', 'Détail de la commande', 'Lignes et total du débit concerné, liés à la commande Klarna.'),
  ('b0000000-0c05-0000-0000-000000000001', 'order_itemization', 'pt', 'Detalhamento do pedido', 'Itens e total da cobrança em questão, vinculados ao pedido Klarna.'),
  ('b0000000-0c05-0000-0000-000000000001', 'order_itemization', 'sv', 'Orderspecifikation', 'Rader och totalsumma för den aktuella debiteringen, kopplat till Klarna-beställningen.')
) AS v(template_section_id, key, locale, label, guidance)
  ON pti.template_section_id = v.template_section_id::uuid AND pti.key = v.key
ON CONFLICT (template_item_id, locale) DO NOTHING;
