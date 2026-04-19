-- Localization support for pack template section titles + item labels.
--
-- Before this migration pack_template_sections.title_default and
-- pack_template_items.label_default / guidance_default were the only
-- strings available — English only. Library pack detail pages showed
-- those English strings mixed into otherwise-translated embedded UI.
--
-- This migration adds two per-locale override tables (falls back to the
-- *_default columns when no row for the requested locale exists) and
-- seeds Portuguese (pt-BR) translations for all ten global templates
-- so the merchant pt-BR experience is no longer bilingual.
--
-- Other locales (de-DE, es-ES, fr-FR, sv-SE) continue to fall back to
-- the English defaults until translated in a follow-up.

CREATE TABLE pack_template_section_i18n (
  template_section_id uuid NOT NULL REFERENCES pack_template_sections(id) ON DELETE CASCADE,
  locale              text NOT NULL,
  title               text NOT NULL,
  PRIMARY KEY (template_section_id, locale)
);

CREATE INDEX idx_ptsi18n_section_locale ON pack_template_section_i18n(template_section_id, locale);

CREATE TABLE pack_template_item_i18n (
  template_item_id  uuid NOT NULL REFERENCES pack_template_items(id) ON DELETE CASCADE,
  locale            text NOT NULL,
  label             text NOT NULL,
  guidance          text,
  PRIMARY KEY (template_item_id, locale)
);

CREATE INDEX idx_ptii18n_item_locale ON pack_template_item_i18n(template_item_id, locale);

ALTER TABLE pack_template_section_i18n ENABLE ROW LEVEL SECURITY;
ALTER TABLE pack_template_item_i18n ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full_access_pack_template_section_i18n"
  ON pack_template_section_i18n FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "service_role_full_access_pack_template_item_i18n"
  ON pack_template_item_i18n FOR ALL USING (true) WITH CHECK (true);

-- ═══════════════════════════════════════════════════════════════════════
-- Portuguese (pt-BR) template name + short description
-- ═══════════════════════════════════════════════════════════════════════

INSERT INTO pack_template_i18n (template_id, locale, name, short_description, works_best_for, preview_note) VALUES
('a0000000-0000-0000-0000-000000000001', 'pt-BR',
 'Fraudulento / Não reconhecido — Padrão',
 'Pacote de evidências abrangente para disputas de transações fraudulentas ou não reconhecidas. Cobre correspondência AVS, geolocalização IP, confirmação de entrega e histórico de interação com o cliente.',
 'Chargebacks em que o titular do cartão afirma não ter autorizado a transação.',
 'Inclui seções de verificação do pedido, prova de entrega e registros de comunicação com o cliente.'),
('a0000000-0000-0000-0000-000000000002', 'pt-BR',
 'Produto Não Recebido — Com Rastreamento',
 'Pacote de evidências robusto para disputas PNR quando você tem rastreamento da transportadora mostrando a entrega. Focado em prova de rastreamento, confirmação de entrega e cronograma de envio.',
 'Disputas em que o cliente alega não entrega mas o rastreamento mostra entrega bem-sucedida.',
 'Melhor template em taxa de sucesso para PNR quando dados de rastreamento estão disponíveis.'),
('a0000000-0000-0000-0000-000000000003', 'pt-BR',
 'Produto Não Recebido — Sem Rastreamento / Prova Fraca',
 'Pacote de evidências para disputas PNR onde dados de rastreamento estão indisponíveis ou incompletos. Baseia-se em recibos de envio, documentação de política e registros de interação com o cliente.',
 'Disputas PNR com documentação de envio ausente ou limitada.',
 NULL),
('a0000000-0000-0000-0000-000000000004', 'pt-BR',
 'Não Conforme à Descrição — Problemas de Qualidade',
 'Pacote de evidências para disputas que alegam que o produto não corresponde à descrição ou apresenta defeitos de qualidade. Focado na precisão do anúncio, controle de qualidade e conformidade com a política de devolução.',
 'Disputas em que os clientes alegam que o produto difere do que foi anunciado.',
 NULL),
('a0000000-0000-0000-0000-000000000005', 'pt-BR',
 'Assinatura Cancelada — Abrangente',
 'Pacote de evidências para disputas relacionadas a assinaturas. Cobre termos de assinatura, conformidade com a política de cancelamento, logs de uso e histórico de notificações.',
 'Disputas envolvendo cobranças recorrentes após o cliente alegar ter cancelado sua assinatura.',
 NULL),
('a0000000-0000-0000-0000-000000000006', 'pt-BR',
 'Reembolso / Crédito Não Processado — Padrão',
 'Pacote de evidências para disputas que alegam que um reembolso ou crédito prometido não foi emitido. Focado em política de reembolso, registros de processamento e histórico de comunicação.',
 'Disputas em que o cliente alega que um reembolso foi prometido mas não recebido.',
 NULL),
('a0000000-0000-0000-0000-000000000007', 'pt-BR',
 'Duplicado / Valor Incorreto',
 'Pacote de evidências para disputas alegando cobrança duplicada ou valor de cobrança incorreto. Focado em registros de transação, detalhamento do pedido e verificação de preços.',
 'Disputas alegando cobrança dupla ou valor errado.',
 NULL),
('a0000000-0000-0000-0000-000000000008', 'pt-BR',
 'Bens Digitais / Serviço Entregue',
 'Pacote de evidências para disputas sobre produtos ou serviços digitais. Focado em logs de download/acesso, registros de uso e confirmação de entrega de conteúdo digital.',
 'Disputas envolvendo downloads digitais, acesso SaaS ou serviços online.',
 NULL),
('a0000000-0000-0000-0000-000000000009', 'pt-BR',
 'Baseado em Políticas (Devoluções / Cancelamento / Envio)',
 'Pacote de evidências centrado em políticas, ideal quando sua defesa mais forte são políticas claras e publicadas. Coleta políticas de devolução, cancelamento e envio com prova de aceitação pelo cliente.',
 'Disputas em que as políticas do comerciante claramente apoiam a cobrança e foram aceitas pelo cliente.',
 NULL),
('a0000000-0000-0000-0000-000000000010', 'pt-BR',
 'Geral — Curinga',
 'Pacote de evidências flexível para tipos de disputa que não se encaixam em outras categorias. Cobre dados básicos do pedido, quaisquer dados de envio disponíveis, políticas relevantes e comunicação com o cliente.',
 'Qualquer tipo de disputa em que um template mais específico não esteja disponível.',
 NULL)
ON CONFLICT (template_id, locale) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════
-- Portuguese (pt-BR) section titles
-- Section UUIDs are stable (hardcoded in migration 019).
-- ═══════════════════════════════════════════════════════════════════════

INSERT INTO pack_template_section_i18n (template_section_id, locale, title) VALUES
-- Template 1: Fraudulent / Unrecognized
('b0000000-0001-0000-0000-000000000001', 'pt-BR', 'Verificação do Pedido'),
('b0000000-0001-0000-0000-000000000002', 'pt-BR', 'Prova de Entrega'),
('b0000000-0001-0000-0000-000000000003', 'pt-BR', 'Comunicação com o Cliente'),
-- Template 2: PNR With Tracking
('b0000000-0002-0000-0000-000000000001', 'pt-BR', 'Dados do Pedido'),
('b0000000-0002-0000-0000-000000000002', 'pt-BR', 'Envio e Rastreamento'),
('b0000000-0002-0000-0000-000000000003', 'pt-BR', 'Confirmação de Entrega'),
('b0000000-0002-0000-0000-000000000004', 'pt-BR', 'Comunicação com o Cliente'),
-- Template 3: PNR Weak Proof
('b0000000-0003-0000-0000-000000000001', 'pt-BR', 'Dados do Pedido'),
('b0000000-0003-0000-0000-000000000002', 'pt-BR', 'Evidências de Envio Disponíveis'),
('b0000000-0003-0000-0000-000000000003', 'pt-BR', 'Políticas e Termos'),
-- Template 4: Not as Described
('b0000000-0004-0000-0000-000000000001', 'pt-BR', 'Anúncio e Descrição do Produto'),
('b0000000-0004-0000-0000-000000000002', 'pt-BR', 'Cumprimento e Entrega'),
('b0000000-0004-0000-0000-000000000003', 'pt-BR', 'Política de Devolução e Reembolso'),
('b0000000-0004-0000-0000-000000000004', 'pt-BR', 'Comunicação com o Cliente'),
-- Template 5: Subscription Canceled
('b0000000-0005-0000-0000-000000000001', 'pt-BR', 'Termos da Assinatura'),
('b0000000-0005-0000-0000-000000000002', 'pt-BR', 'Uso e Atividade'),
('b0000000-0005-0000-0000-000000000003', 'pt-BR', 'Cancelamento e Notificações'),
-- Template 6: Refund / Credit Not Processed
('b0000000-0006-0000-0000-000000000001', 'pt-BR', 'Política de Reembolso e Termos'),
('b0000000-0006-0000-0000-000000000002', 'pt-BR', 'Registros de Processamento'),
('b0000000-0006-0000-0000-000000000003', 'pt-BR', 'Comunicação com o Cliente'),
-- Template 7: Duplicate / Incorrect Amount
('b0000000-0007-0000-0000-000000000001', 'pt-BR', 'Registros de Transação'),
('b0000000-0007-0000-0000-000000000002', 'pt-BR', 'Detalhamento do Pedido'),
-- Template 8: Digital Goods
('b0000000-0008-0000-0000-000000000001', 'pt-BR', 'Entrega e Acesso'),
('b0000000-0008-0000-0000-000000000002', 'pt-BR', 'Registros de Uso'),
('b0000000-0008-0000-0000-000000000003', 'pt-BR', 'Termos e Políticas'),
-- Template 9: Policy-Forward
('b0000000-0009-0000-0000-000000000001', 'pt-BR', 'Política de Devolução'),
('b0000000-0009-0000-0000-000000000002', 'pt-BR', 'Política de Cancelamento'),
('b0000000-0009-0000-0000-000000000003', 'pt-BR', 'Política de Envio'),
('b0000000-0009-0000-0000-000000000004', 'pt-BR', 'Aceitação pelo Cliente'),
-- Template 10: General Catch-all
('b0000000-0010-0000-0000-000000000001', 'pt-BR', 'Dados do Pedido'),
('b0000000-0010-0000-0000-000000000002', 'pt-BR', 'Envio e Entrega'),
('b0000000-0010-0000-0000-000000000003', 'pt-BR', 'Políticas e Termos'),
('b0000000-0010-0000-0000-000000000004', 'pt-BR', 'Comunicação com o Cliente')
ON CONFLICT (template_section_id, locale) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════
-- Portuguese (pt-BR) item labels + guidance
-- Items use generated UUIDs so we match by (template_section_id, key).
-- ═══════════════════════════════════════════════════════════════════════

INSERT INTO pack_template_item_i18n (template_item_id, locale, label, guidance)
SELECT pti.id, v.locale, v.label, v.guidance
FROM pack_template_items pti
JOIN (VALUES
  -- Template 1: Fraudulent / Unrecognized
  ('b0000000-0001-0000-0000-000000000001', 'order_confirmation', 'pt-BR', 'Confirmação do pedido', 'Número do pedido, data, itens e endereço de cobrança.'),
  ('b0000000-0001-0000-0000-000000000001', 'avs_cvv_match', 'pt-BR', 'Resultado da verificação AVS/CVV', 'Captura de tela do gateway de pagamento mostrando o status de correspondência AVS e CVV.'),
  ('b0000000-0001-0000-0000-000000000001', 'ip_geolocation', 'pt-BR', 'Dados de geolocalização do IP', 'Mostre que o endereço IP usado no checkout corresponde à região do titular do cartão.'),
  ('b0000000-0001-0000-0000-000000000001', 'device_fingerprint', 'pt-BR', 'Impressão digital do dispositivo ou histórico de compras anteriores', 'Se disponível, inclua a correspondência de ID do dispositivo com pedidos legítimos anteriores.'),
  ('b0000000-0001-0000-0000-000000000002', 'tracking_proof', 'pt-BR', 'Confirmação de rastreamento de envio', 'Rastreamento da transportadora mostrando entrega no endereço do pedido.'),
  ('b0000000-0001-0000-0000-000000000002', 'delivery_signature', 'pt-BR', 'Assinatura ou foto de entrega', 'Confirmação de assinatura ou foto de entrega da transportadora, se disponível.'),
  ('b0000000-0001-0000-0000-000000000003', 'customer_emails', 'pt-BR', 'Correspondência com o cliente', 'Quaisquer mensagens trocadas com o cliente sobre este pedido.'),
  ('b0000000-0001-0000-0000-000000000003', 'customer_account_info', 'pt-BR', 'Detalhes da conta do cliente', 'Data de criação da conta, histórico de login, pedidos anteriores da mesma conta.'),

  -- Template 2: PNR With Tracking
  ('b0000000-0002-0000-0000-000000000001', 'order_confirmation', 'pt-BR', 'Confirmação do pedido', 'Inclua o número do pedido, data, itens e endereço de entrega.'),
  ('b0000000-0002-0000-0000-000000000001', 'billing_shipping_match', 'pt-BR', 'Comparação de endereço de cobrança / entrega', 'Mostre que os endereços de cobrança e entrega correspondem ou explique a discrepância.'),
  ('b0000000-0002-0000-0000-000000000002', 'tracking_number', 'pt-BR', 'Número de rastreamento e linha do tempo da transportadora', 'Histórico completo de rastreamento da transportadora mostrando envio até a entrega.'),
  ('b0000000-0002-0000-0000-000000000002', 'carrier_confirmation', 'pt-BR', 'Página de confirmação de entrega da transportadora', 'Captura de tela do site da transportadora mostrando o status "Entregue".'),
  ('b0000000-0002-0000-0000-000000000003', 'delivery_photo', 'pt-BR', 'Foto ou assinatura de entrega', 'Imagem de prova de entrega ou recibo assinado da transportadora.'),
  ('b0000000-0002-0000-0000-000000000003', 'delivery_address_match', 'pt-BR', 'Confirmação de correspondência de endereço', 'Mostre que o endereço de entrega corresponde ao endereço no pedido.'),
  ('b0000000-0002-0000-0000-000000000004', 'customer_emails', 'pt-BR', 'Correspondência com o cliente', 'Quaisquer e-mails ou mensagens pós-compra trocadas com o cliente.'),

  -- Template 3: PNR Weak Proof
  ('b0000000-0003-0000-0000-000000000001', 'order_confirmation', 'pt-BR', 'Confirmação do pedido', 'Número do pedido, data, itens e endereços.'),
  ('b0000000-0003-0000-0000-000000000001', 'payment_receipt', 'pt-BR', 'Recibo de processamento de pagamento', 'Registro de transação do gateway mostrando cobrança bem-sucedida.'),
  ('b0000000-0003-0000-0000-000000000002', 'shipping_receipt', 'pt-BR', 'Recibo ou etiqueta de envio', 'Prova de que o pedido foi enviado (etiqueta, recibo, manifesto).'),
  ('b0000000-0003-0000-0000-000000000002', 'partial_tracking', 'pt-BR', 'Dados parciais de rastreamento (se houver)', 'Quaisquer leituras da transportadora disponíveis, mesmo que incompletas.'),
  ('b0000000-0003-0000-0000-000000000002', 'shipping_method_note', 'pt-BR', 'Nota: explicar o método de envio usado', 'Descreva o método de envio e por que o rastreamento completo pode estar indisponível.'),
  ('b0000000-0003-0000-0000-000000000003', 'shipping_policy', 'pt-BR', 'Política de envio', 'Política de envio publicada da sua loja.'),
  ('b0000000-0003-0000-0000-000000000003', 'terms_of_service', 'pt-BR', 'Termos de serviço', 'Termos relevantes que o cliente aceitou no checkout.'),

  -- Template 4: Not as Described
  ('b0000000-0004-0000-0000-000000000001', 'product_page_screenshot', 'pt-BR', 'Captura de tela da página do produto', 'Captura de tela do anúncio do produto como apareceu no momento da compra.'),
  ('b0000000-0004-0000-0000-000000000001', 'product_description', 'pt-BR', 'Texto da descrição do produto', 'Descrição completa do produto, especificações e quaisquer isenções.'),
  ('b0000000-0004-0000-0000-000000000001', 'product_photos', 'pt-BR', 'Fotografias do produto', 'Fotos do produto real enviado (imagens de controle de qualidade).'),
  ('b0000000-0004-0000-0000-000000000002', 'packing_slip', 'pt-BR', 'Nota de embalagem / fatura', 'Documento mostrando que os itens embalados e enviados correspondem ao pedido.'),
  ('b0000000-0004-0000-0000-000000000002', 'tracking_proof', 'pt-BR', 'Rastreamento de entrega', 'Rastreamento da transportadora mostrando entrega bem-sucedida.'),
  ('b0000000-0004-0000-0000-000000000003', 'return_policy', 'pt-BR', 'Política de devolução / reembolso', 'Política publicada que estava ativa no momento da compra.'),
  ('b0000000-0004-0000-0000-000000000003', 'return_offered_note', 'pt-BR', 'Nota: foi oferecida uma devolução ou troca?', 'Documente se você ofereceu uma devolução, troca ou reembolso parcial.'),
  ('b0000000-0004-0000-0000-000000000004', 'customer_emails', 'pt-BR', 'Correspondência com o cliente', 'E-mails ou mensagens discutindo a preocupação sobre a qualidade do produto.'),

  -- Template 5: Subscription Canceled
  ('b0000000-0005-0000-0000-000000000001', 'subscription_agreement', 'pt-BR', 'Acordo / termos de assinatura', 'Os termos que o cliente aceitou ao assinar, incluindo ciclo de cobrança e política de cancelamento.'),
  ('b0000000-0005-0000-0000-000000000001', 'signup_confirmation', 'pt-BR', 'Confirmação de inscrição', 'E-mail ou recibo confirmando que o cliente aderiu à assinatura.'),
  ('b0000000-0005-0000-0000-000000000001', 'billing_history', 'pt-BR', 'Histórico de cobrança', 'Registro de cobranças bem-sucedidas anteriores nesta assinatura.'),
  ('b0000000-0005-0000-0000-000000000002', 'usage_logs', 'pt-BR', 'Logs de uso do serviço', 'Evidência de que o cliente usou o serviço / produto após a data da cobrança contestada.'),
  ('b0000000-0005-0000-0000-000000000002', 'login_activity', 'pt-BR', 'Atividade de login / acesso', 'Registros de login da conta mostrando acesso contínuo.'),
  ('b0000000-0005-0000-0000-000000000003', 'cancellation_policy', 'pt-BR', 'Política de cancelamento', 'Política de cancelamento publicada e período de aviso necessário.'),
  ('b0000000-0005-0000-0000-000000000003', 'renewal_notifications', 'pt-BR', 'E-mails de notificação de renovação', 'E-mails enviados antes da renovação lembrando o cliente de cobranças futuras.'),
  ('b0000000-0005-0000-0000-000000000003', 'cancellation_status_note', 'pt-BR', 'Nota: status do pedido de cancelamento', 'Documente se um cancelamento foi recebido e quando, ou que nenhum cancelamento foi enviado.'),

  -- Template 6: Refund / Credit Not Processed
  ('b0000000-0006-0000-0000-000000000001', 'refund_policy', 'pt-BR', 'Política de reembolso / devolução', 'Política de reembolso publicada ativa no momento da compra.'),
  ('b0000000-0006-0000-0000-000000000001', 'terms_acceptance', 'pt-BR', 'Prova de aceitação dos termos pelo cliente', 'Confirmação de checkbox, click-wrap ou página de termos que o cliente viu.'),
  ('b0000000-0006-0000-0000-000000000002', 'refund_receipt', 'pt-BR', 'Recibo da transação de reembolso', 'Registro do gateway de pagamento mostrando que o reembolso foi processado, com data e valor.'),
  ('b0000000-0006-0000-0000-000000000002', 'credit_statement', 'pt-BR', 'Registro de crédito / crédito na loja', 'Se um crédito na loja foi emitido em vez de um reembolso, forneça o registro.'),
  ('b0000000-0006-0000-0000-000000000002', 'processing_timeline_note', 'pt-BR', 'Nota: cronograma de processamento do reembolso', 'Explique o tempo típico de processamento de reembolso e se está dentro dessa janela.'),
  ('b0000000-0006-0000-0000-000000000003', 'customer_emails', 'pt-BR', 'Correspondência com o cliente sobre o reembolso', 'E-mails discutindo o pedido de reembolso e quaisquer respostas enviadas.'),

  -- Template 7: Duplicate / Incorrect Amount
  ('b0000000-0007-0000-0000-000000000001', 'payment_records', 'pt-BR', 'Log de transações do gateway de pagamento', 'Lista completa de cobranças para este cliente / pedido mostrando que cada uma é distinta.'),
  ('b0000000-0007-0000-0000-000000000001', 'invoice_receipts', 'pt-BR', 'Fatura ou recibo para cada cobrança', 'Faturas separadas comprovando que cada cobrança corresponde a um pedido ou item diferente.'),
  ('b0000000-0007-0000-0000-000000000001', 'auth_vs_capture_note', 'pt-BR', 'Nota: autorização vs. captura', 'Explique se a aparência duplicada é uma retenção de autorização vs. cobrança real.'),
  ('b0000000-0007-0000-0000-000000000002', 'order_itemization', 'pt-BR', 'Detalhamento do pedido por item', 'Detalhamento linha a linha mostrando o valor correto e o que ele cobre.'),
  ('b0000000-0007-0000-0000-000000000002', 'pricing_screenshot', 'pt-BR', 'Captura de tela de preço ou carrinho', 'Captura de tela de preços no momento da compra confirmando o valor correto.'),

  -- Template 8: Digital Goods
  ('b0000000-0008-0000-0000-000000000001', 'download_link_email', 'pt-BR', 'Link de download / e-mail de acesso', 'E-mail enviado ao cliente contendo links de download ou credenciais de acesso.'),
  ('b0000000-0008-0000-0000-000000000001', 'access_logs', 'pt-BR', 'Logs de acesso ou download', 'Logs do servidor mostrando que o cliente acessou ou baixou o produto digital.'),
  ('b0000000-0008-0000-0000-000000000001', 'ip_match', 'pt-BR', 'Correspondência de endereço IP', 'Mostre que o IP acessando o produto corresponde ao IP conhecido do cliente.'),
  ('b0000000-0008-0000-0000-000000000002', 'usage_activity', 'pt-BR', 'Atividade de uso do produto', 'Logs ou análises mostrando que o cliente usou o produto ou serviço digital.'),
  ('b0000000-0008-0000-0000-000000000002', 'license_activation', 'pt-BR', 'Registro de ativação de chave de licença', 'Registro mostrando que a chave de licença foi ativada pelo cliente.'),
  ('b0000000-0008-0000-0000-000000000003', 'digital_delivery_policy', 'pt-BR', 'Política de entrega / reembolso digital', 'Política publicada para bens digitais, incluindo termos não reembolsáveis, se aplicável.'),
  ('b0000000-0008-0000-0000-000000000003', 'terms_acceptance', 'pt-BR', 'Prova de aceitação dos termos', 'Evidência de que o cliente aceitou os termos antes da compra (checkbox, click-wrap).'),

  -- Template 9: Policy-Forward
  ('b0000000-0009-0000-0000-000000000001', 'return_policy', 'pt-BR', 'Documento da política de devolução', 'Política de devolução completa conforme publicada em seu site.'),
  ('b0000000-0009-0000-0000-000000000001', 'return_policy_url', 'pt-BR', 'URL / captura de tela da página da política de devolução', 'Captura de tela mostrando que a política é publicamente acessível em seu site.'),
  ('b0000000-0009-0000-0000-000000000002', 'cancellation_policy', 'pt-BR', 'Documento da política de cancelamento', 'Política de cancelamento completa incluindo períodos de aviso e condições.'),
  ('b0000000-0009-0000-0000-000000000003', 'shipping_policy', 'pt-BR', 'Documento da política de envio', 'Política de envio publicada com prazos de entrega e informações da transportadora.'),
  ('b0000000-0009-0000-0000-000000000004', 'checkout_terms', 'pt-BR', 'Prova de aceitação dos termos no checkout', 'Captura de tela ou log mostrando que o cliente aceitou os termos no checkout.'),
  ('b0000000-0009-0000-0000-000000000004', 'terms_of_service', 'pt-BR', 'Termos de serviço', 'Documento completo dos Termos que o cliente concordou.'),

  -- Template 10: General Catch-all
  ('b0000000-0010-0000-0000-000000000001', 'order_confirmation', 'pt-BR', 'Confirmação do pedido', 'Número do pedido, data, itens pedidos e detalhes do cliente.'),
  ('b0000000-0010-0000-0000-000000000001', 'payment_receipt', 'pt-BR', 'Recibo de pagamento', 'Registro de transação do gateway para a cobrança em questão.'),
  ('b0000000-0010-0000-0000-000000000002', 'tracking_proof', 'pt-BR', 'Rastreamento de envio (se aplicável)', 'Informações de rastreamento da transportadora se bens físicos foram enviados.'),
  ('b0000000-0010-0000-0000-000000000002', 'delivery_confirmation', 'pt-BR', 'Confirmação de entrega', 'Prova de entrega, se disponível.'),
  ('b0000000-0010-0000-0000-000000000003', 'relevant_policy', 'pt-BR', 'Política mais relevante', 'A política mais aplicável a esta disputa (devolução, envio, Termos de Serviço, etc.).'),
  ('b0000000-0010-0000-0000-000000000004', 'customer_emails', 'pt-BR', 'Correspondência com o cliente', 'Qualquer comunicação relevante com o cliente.'),
  ('b0000000-0010-0000-0000-000000000004', 'additional_context', 'pt-BR', 'Contexto ou evidência adicional', 'Qualquer outra evidência ou nota relevante que apoie seu caso.')
) AS v(template_section_id, key, locale, label, guidance)
  ON pti.template_section_id = v.template_section_id::uuid AND pti.key = v.key
ON CONFLICT (template_item_id, locale) DO NOTHING;
