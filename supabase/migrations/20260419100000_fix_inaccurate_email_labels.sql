-- Two seed labels in the Fraudulent / Unrecognized template (b0000000-0001-…)
-- promised "email" / "screenshot" artifacts that the auto-collectors do not
-- actually produce:
--   - order_confirmation collects the structured Shopify order record
--     (line items, totals, billing/shipping cities, customer tenure),
--     not an email or screenshot.
--   - customer_emails is satisfied by Shopify timeline events, order/
--     customer notes, and buyer attributes — not just emails.
--
-- Other templates already use the corrected labels ("Order confirmation",
-- "Customer correspondence"); this aligns the unauthorized-transaction
-- template with them and updates the pt-BR localizations to match.

-- English (label_default + guidance) for template 1
UPDATE pack_template_items
SET label_default = 'Order confirmation',
    guidance_default = 'Order number, date, items, and billing address.'
WHERE template_section_id = 'b0000000-0001-0000-0000-000000000001'
  AND key = 'order_confirmation';

UPDATE pack_template_items
SET label_default = 'Customer correspondence',
    guidance_default = 'Any messages exchanged with the customer regarding this order.'
WHERE template_section_id = 'b0000000-0001-0000-0000-000000000003'
  AND key = 'customer_emails';

-- Portuguese (pt-BR) localizations
UPDATE pack_template_item_i18n
SET label = 'Confirmação do pedido',
    guidance = 'Número do pedido, data, itens e endereço de cobrança.'
WHERE locale = 'pt-BR'
  AND template_item_id IN (
    SELECT id FROM pack_template_items
    WHERE template_section_id = 'b0000000-0001-0000-0000-000000000001'
      AND key = 'order_confirmation'
  );

UPDATE pack_template_item_i18n
SET label = 'Correspondência com o cliente',
    guidance = 'Quaisquer mensagens trocadas com o cliente sobre este pedido.'
WHERE locale = 'pt-BR'
  AND template_item_id IN (
    SELECT id FROM pack_template_items
    WHERE template_section_id = 'b0000000-0001-0000-0000-000000000003'
      AND key = 'customer_emails'
  );
