-- Pack template localization seed for sv, de, es, fr.
--
-- Background: the prior pt-BR seed (20260411130000_pack_template_localization.sql)
-- referenced the section / item layout of migration 019, which is now stale.
-- Live production has 18 templates (10 chargeback + 8 inquiry variants from
-- migration 20260411150000_inquiry_template_variants.sql), and several
-- chargeback templates were restructured by migration
-- 20260517120000_align_chargeback_templates_with_v2_pipeline.sql so the section
-- titles, sort orders, and item keys differ materially from the 019 baseline
-- (e.g. template 1 sections are now "Payment Authentication" / "Order Context"
-- / "Customer History" / "Delivery, if shipped" — NOT "Order Verification" /
-- "Delivery Proof" / "Customer Communication").
--
-- This migration seeds Swedish (sv), German (de), Spanish (es), and French (fr)
-- translations for every template, section, and item that exists in the live
-- production schema, sourced directly from the database dumps in
-- scripts/sql/_dump-templates-en.json / _dump-sections.json / _dump-items.json.
--
-- Family-name terminology is aligned with messages/{locale}.json `coverage.family*`
-- so the same dispute family reads consistently across the library, dispute
-- detail header, and embedded help articles. All inserts use ON CONFLICT
-- DO NOTHING so the migration is safe to re-run.

-- ═══════════════════════════════════════════════════════════════════════
-- SWEDISH (sv) — templates
-- ═══════════════════════════════════════════════════════════════════════

INSERT INTO pack_template_i18n (template_id, locale, name, short_description, works_best_for, preview_note) VALUES
('a0000000-0000-0000-0000-000000000001', 'sv',
 'Bedrägeri / Ej auktoriserad — Standard',
 'Samlar in alla autentiserings- och ordersignaler som v2 kan läsa från Shopify: AVS/CVV, 3-D Secure (när tillgängligt), Shopifys bedrägerigranskning, IP-plats, matchning mellan fakturerings- och leveransadress, återkommande kund och kundkorrespondens. Leveransbevis ingår om ordern har skickats.',
 'Chargebacks där kortinnehavaren påstår att de inte auktoriserade transaktionen.',
 'Hämtas automatiskt från Shopify- och betaldata — ingen handlaruppladdning krävs.'),
('a0000000-0000-0000-0000-000000000002', 'sv',
 'Produkt ej mottagen — Med spårning',
 'Starkt evidenspaket för PNR-ärenden när Shopify har transportörsspårning. Hämtar orderbekräftelse, spårningsstatus och leveransbekräftelse (med signatur/foto när transportören tillhandahåller det) direkt från Shopify.',
 'Ärenden där kunden påstår icke-leverans men spårningen visar lyckad leverans.',
 'Fungerar bäst när Shopifys leveransdata visar att ordern har levererats.'),
('a0000000-0000-0000-0000-000000000003', 'sv',
 'Produkt ej mottagen — Utan spårning / Svagt bevis',
 'För PNR-ärenden där spårning inte är tillgänglig från Shopify. Hämtar order- och policyutdrag automatiskt och ber handlaren ladda upp eventuella fraktetiketter, partiell spårning eller kontextnoteringar.',
 'PNR-ärenden med saknad eller begränsad fraktdokumentation.',
 'Använd när Shopify saknar spårning — du laddar upp det du har.'),
('a0000000-0000-0000-0000-000000000004', 'sv',
 'Produkt ej enligt beskrivning — Kvalitetsproblem',
 'För ärenden där kunden påstår att produkten inte motsvarar beskrivningen. Hämtar orderdetaljer, utdrag ur chargebackpolicy och kundkorrespondens från Shopify; ber handlaren ladda upp produktfoton och skärmdumpar av produktsidan som visar att annonsen var korrekt.',
 'Ärenden där kunder påstår att produkten skiljer sig från det som annonserades.',
 NULL),
('a0000000-0000-0000-0000-000000000005', 'sv',
 'Prenumeration avslutad — Heltäckande',
 'För prenumerationsärenden. Hämtar ordern för den omtvistade debiteringen, utdrag ur avbokningspolicy och eventuell Shopify-korrespondens automatiskt; ber handlaren ladda upp prenumerationsvillkor, användningsloggar, förnyelsepåminnelser och en notering om avbokningsstatus eftersom inget av detta har en Shopify-källa.',
 'Ärenden om återkommande debiteringar efter att kunden påstår att de har avslutat sin prenumeration.',
 NULL),
('a0000000-0000-0000-0000-000000000006', 'sv',
 'Chargeback / Kredit ej behandlad — Standard',
 'För ärenden där kunden påstår att en utlovad chargeback inte har gjorts. Hämtar ordern, Shopifys chargebackpost (order.refunds), utdrag ur chargebackpolicy och eventuell Shopify-korrespondens automatiskt; ber handlaren ladda upp externt kreditbevis enbart om krediten utfärdades utanför Shopify.',
 'Ärenden där kunden påstår att en chargeback utlovats men inte mottagits.',
 NULL),
('a0000000-0000-0000-0000-000000000007', 'sv',
 'Dubbeldebitering / Felaktigt belopp',
 'För ärenden som påstår dubbel debitering eller felaktigt fakturerat belopp. Hämtar Shopify-ordern och dess artikelspecifikation automatiskt; ber handlaren ladda upp externa gateway-loggar eller separata fakturor eftersom DisputeDesk inte hämtar råa loggar från betalgatewayen.',
 'Ärenden som påstår dubbeldebitering eller fel debiterat belopp.',
 NULL),
('a0000000-0000-0000-0000-000000000008', 'sv',
 'Digitala varor / Tjänst levererad',
 'För ärenden om digitala produkter eller tjänster. Hämtar ordern och utdrag ur chargebackpolicy från Shopify; ber handlaren ladda upp leveransmejl, åtkomstloggar och licensaktiveringsbevis eftersom inget av detta har en Shopify-källa.',
 'Ärenden som rör digitala nedladdningar, SaaS-åtkomst eller onlinetjänster.',
 NULL),
('a0000000-0000-0000-0000-000000000009', 'sv',
 'Policybaserad (Returer / Avbokning / Frakt)',
 'För ärenden där ditt starkaste försvar är tydliga, publicerade policyer. Hämtar utdrag ur retur-, avboknings- och fraktpolicyer från handlarbutiken automatiskt; ber handlaren ladda upp accepterande bevis när det behövs.',
 'Ärenden där handlarens policyer tydligt stöder debiteringen och accepterades av kunden.',
 NULL),
('a0000000-0000-0000-0000-000000000010', 'sv',
 'Allmän — Brett paket',
 'Flexibelt paket för ärendetyper som inte passar i en specifik mall. Hämtar ordern, tillgänglig frakt/leverans från Shopify, utdrag ur butikspolicyer och Shopify-korrespondens automatiskt; handlaren kan lägga till en kontextnotering vid behov.',
 'Vilken ärendetyp som helst där en mer specifik mall inte finns tillgänglig.',
 NULL),
('a0000000-0000-0000-0000-000000000011', 'sv',
 'Bedrägeri / Ej auktoriserad — Förfrågan',
 'Lätt svarspaket för bedrägeri- och okända-debiteringsfrågor. Syftet är att bekräfta att debiteringen var legitim med minimala bevis så att förfrågan stängs utan eskalering.',
 'Förfrågningar före chargeback där kortinnehavaren ifrågasätter om de auktoriserade debiteringen.',
 NULL),
('a0000000-0000-0000-0000-000000000012', 'sv',
 'Produkt ej mottagen — Förfrågan',
 'Snabbt svar om leveransstatus för PNR-förfrågningar före chargeback. Ett spårningsnummer och en leveransbekräftelse räcker oftast för att stänga frågan.',
 'Kunden meddelar sin bank att de inte har fått ordern innan ärendet eskaleras till chargeback.',
 NULL),
('a0000000-0000-0000-0000-000000000013', 'sv',
 'Produkt ej acceptabel — Förfrågan',
 'Kort svar för förfrågningar om kvalitet eller "ej enligt beskrivning". Fokuserar på vad kunden köpte och eventuellt returerbjudande du har lämnat.',
 'Klagomålsskede där en fullständig retur- eller chargebackskonversation kan lösa saken.',
 NULL),
('a0000000-0000-0000-0000-000000000014', 'sv',
 'Prenumeration avslutad — Förfrågan',
 'Kort svar om prenumerationsstatus. Bekräftar om kunden fortfarande är aktiv eller har avslutat, och när den senaste debiteringen skedde.',
 'Förfrågan om återkommande debiteringar innan ett formellt chargeback-ärende öppnas.',
 NULL),
('a0000000-0000-0000-0000-000000000015', 'sv',
 'Chargeback / Kredit ej behandlad — Förfrågan',
 'Snabbt svar om chargebacksstatus. Talar om för banken om en chargeback är på väg, redan behandlad eller inte aktuell.',
 'Kunden påstår att en chargeback utlovats men inte mottagits — oftast en bokföringsfråga.',
 NULL),
('a0000000-0000-0000-0000-000000000016', 'sv',
 'Dubbeldebitering / Felaktigt belopp — Förfrågan',
 'Kort svar med transaktionsposter som visar att varje debitering är separat eller som bryter ner det omtvistade beloppet.',
 'Kunden ifrågasätter om de blivit dubbeldebiterade eller fakturerats fel belopp.',
 NULL),
('a0000000-0000-0000-0000-000000000017', 'sv',
 'Policybaserad — Förfrågan',
 'Lättviktigt policysvar. Lyfter fram den mest relevanta policy som kunden godkände i kassan.',
 'Förfrågningar där en tydlig, publicerad policy besvarar frågan direkt.',
 NULL),
('a0000000-0000-0000-0000-000000000018', 'sv',
 'Allmän — Förfrågan',
 'Minimalt brett svar för förfrågningar som inte passar i en specifik mall. En ordersammanfattning plus eventuell fritextkontext.',
 'Vilken förfrågan som helst som inte hanteras av en mer specifik mall.',
 NULL)
ON CONFLICT (template_id, locale) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════
-- SWEDISH (sv) — section titles
-- ═══════════════════════════════════════════════════════════════════════

INSERT INTO pack_template_section_i18n (template_section_id, locale, title) VALUES
-- Template 1: Fraudulent / Unrecognized — Standard
('b0000000-0001-0000-0000-000000000001', 'sv', 'Betalautentisering'),
('b0000000-0001-0000-0000-000000000002', 'sv', 'Orderkontext'),
('b0000000-0001-0000-0000-000000000003', 'sv', 'Kundhistorik'),
('b0000000-0001-0000-0000-000000000004', 'sv', 'Leverans, om skickat'),
-- Template 2: PNR — With Tracking
('b0000000-0002-0000-0000-000000000001', 'sv', 'Orderuppgifter'),
('b0000000-0002-0000-0000-000000000002', 'sv', 'Frakt och spårning'),
('b0000000-0002-0000-0000-000000000003', 'sv', 'Leveransbekräftelse'),
('b0000000-0002-0000-0000-000000000004', 'sv', 'Kundkommunikation'),
-- Template 3: PNR — No Tracking / Weak Proof
('b0000000-0003-0000-0000-000000000001', 'sv', 'Orderuppgifter'),
('b0000000-0003-0000-0000-000000000002', 'sv', 'Tillgängliga fraktbevis'),
('b0000000-0003-0000-0000-000000000003', 'sv', 'Policyer och villkor'),
-- Template 4: Not as Described — Quality Issues
('b0000000-0004-0000-0000-000000000001', 'sv', 'Orderuppgifter'),
('b0000000-0004-0000-0000-000000000002', 'sv', 'Produktbevis'),
('b0000000-0004-0000-0000-000000000003', 'sv', 'Retur- och chargebackpolicy'),
('b0000000-0004-0000-0000-000000000004', 'sv', 'Kundkommunikation'),
-- Template 5: Subscription Canceled — Comprehensive
('b0000000-0005-0000-0000-000000000001', 'sv', 'Orderuppgifter'),
('b0000000-0005-0000-0000-000000000002', 'sv', 'Prenumerationsbevis'),
('b0000000-0005-0000-0000-000000000003', 'sv', 'Policyer och villkor'),
('b0000000-0005-0000-0000-000000000004', 'sv', 'Kundkommunikation'),
-- Template 6: Refund / Credit Not Processed
('b0000000-0006-0000-0000-000000000001', 'sv', 'Orderuppgifter'),
('b0000000-0006-0000-0000-000000000002', 'sv', 'Chargebackpost'),
('b0000000-0006-0000-0000-000000000003', 'sv', 'Chargebackpolicy'),
('b0000000-0006-0000-0000-000000000004', 'sv', 'Kundkommunikation'),
-- Template 7: Duplicate / Incorrect Amount
('b0000000-0007-0000-0000-000000000001', 'sv', 'Orderuppgifter'),
('b0000000-0007-0000-0000-000000000002', 'sv', 'Externa transaktionsposter'),
-- Template 8: Digital Goods
('b0000000-0008-0000-0000-000000000001', 'sv', 'Orderuppgifter'),
('b0000000-0008-0000-0000-000000000002', 'sv', 'Leverans- och åtkomstbevis'),
('b0000000-0008-0000-0000-000000000003', 'sv', 'Villkor och policyer'),
-- Template 9: Policy-Forward
('b0000000-0009-0000-0000-000000000001', 'sv', 'Butikspolicyer'),
('b0000000-0009-0000-0000-000000000002', 'sv', 'Kundens godkännande'),
-- Template 10: General Catch-all
('b0000000-0010-0000-0000-000000000001', 'sv', 'Orderuppgifter'),
('b0000000-0010-0000-0000-000000000002', 'sv', 'Frakt och leverans'),
('b0000000-0010-0000-0000-000000000003', 'sv', 'Policyer och villkor'),
('b0000000-0010-0000-0000-000000000004', 'sv', 'Kundkommunikation'),
-- Template 11: Fraud Inquiry
('b0000000-0011-0000-0000-000000000001', 'sv', 'Transaktionsverifiering'),
-- Template 12: PNR Inquiry
('b0000000-0012-0000-0000-000000000001', 'sv', 'Fraktstatus'),
-- Template 13: Product Unacceptable Inquiry
('b0000000-0013-0000-0000-000000000001', 'sv', 'Produktinformation'),
-- Template 14: Subscription Inquiry
('b0000000-0014-0000-0000-000000000001', 'sv', 'Prenumerationsstatus'),
-- Template 15: Refund Inquiry
('b0000000-0015-0000-0000-000000000001', 'sv', 'Chargebackstatus'),
-- Template 16: Duplicate Inquiry
('b0000000-0016-0000-0000-000000000001', 'sv', 'Transaktionsposter'),
-- Template 17: Policy Inquiry
('b0000000-0017-0000-0000-000000000001', 'sv', 'Tillämplig policy'),
-- Template 18: General Inquiry
('b0000000-0018-0000-0000-000000000001', 'sv', 'Ordersammanfattning')
ON CONFLICT (template_section_id, locale) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════
-- SWEDISH (sv) — item labels + guidance
-- ═══════════════════════════════════════════════════════════════════════

INSERT INTO pack_template_item_i18n (template_item_id, locale, label, guidance)
SELECT pti.id, v.locale, v.label, v.guidance
FROM pack_template_items pti
JOIN (VALUES
  -- Template 1, section 1: Payment Authentication
  ('b0000000-0001-0000-0000-000000000001', 'avs_cvv_match', 'sv', 'AVS/CVV-verifiering', 'Matchningskoder för adress och CVV från betalauktoriseringen, hämtade från Shopify-ordern.'),
  ('b0000000-0001-0000-0000-000000000001', 'tds_authentication', 'sv', '3-D Secure-autentisering, om tillgänglig', 'När Shopify Payments exponerar ett 3-D Secure-resultat på kvittot inkluderar vi det. Alla gateways exponerar inte detta.'),
  ('b0000000-0001-0000-0000-000000000001', 'fraud_risk_screening', 'sv', 'Shopifys bedrägerigranskning', 'Shopifys riskbedömning före auktorisering för denna order.'),
  -- Template 1, section 2: Order Context
  ('b0000000-0001-0000-0000-000000000002', 'order_confirmation', 'sv', 'Orderbekräftelse', 'Ordernummer, datum, artiklar, totaler och kunduppgifter från Shopify-ordern.'),
  ('b0000000-0001-0000-0000-000000000002', 'billing_address_match', 'sv', 'Matchning mellan fakturerings- och leveransadress', 'Jämför fakturerings- och leveransadress på Shopify-ordern på stads- och landsnivå.'),
  ('b0000000-0001-0000-0000-000000000002', 'ip_location_check', 'sv', 'IP-plats jämfört med faktureringsland', 'Slår upp IP-adressen i kassan till en region och jämför med faktureringslandet.'),
  -- Template 1, section 3: Customer History
  ('b0000000-0001-0000-0000-000000000003', 'customer_account_info', 'sv', 'Signal för återkommande kund', 'Om kunden har tidigare ordrar i butiken. Tillför vikt när det finns.'),
  ('b0000000-0001-0000-0000-000000000003', 'customer_communication', 'sv', 'Kundkorrespondens från Shopifys tidslinje/anteckningar', 'Eventuella meddelanden, ordernoteringar eller köparattribut som Shopify har fångat upp.'),
  -- Template 1, section 4: Delivery, if shipped
  ('b0000000-0001-0000-0000-000000000004', 'shipping_tracking', 'sv', 'Fraktspårning', 'Transportörens spårning från Shopify-leveransen, om ordern har skickats.'),
  ('b0000000-0001-0000-0000-000000000004', 'delivery_proof', 'sv', 'Leveranssignatur eller foto', 'Signaturbekräftelse eller leveransfoto från transportören, när det tillhandahålls.'),

  -- Template 2, section 1: Order Basics
  ('b0000000-0002-0000-0000-000000000001', 'order_confirmation', 'sv', 'Orderbekräftelse', 'Ordernummer, datum, artiklar och leveransadress från Shopify-ordern.'),
  -- Template 2, section 2: Shipping & Tracking
  ('b0000000-0002-0000-0000-000000000002', 'shipping_tracking', 'sv', 'Status för fraktspårning', 'Spårningsnummer och aktuell status från Shopify-leveransen.'),
  -- Template 2, section 3: Delivery Confirmation
  ('b0000000-0002-0000-0000-000000000003', 'delivery_proof', 'sv', 'Leveransbekräftelse', 'Leveransstatus från transportören (samt signatur/foto när tillgängligt) från Shopify-leveransen.'),
  -- Template 2, section 4: Customer Communication
  ('b0000000-0002-0000-0000-000000000004', 'customer_communication', 'sv', 'Kundkorrespondens', 'Meddelanden och ordernoteringar efter köpet som Shopify har fångat upp.'),

  -- Template 3, section 1: Order Basics
  ('b0000000-0003-0000-0000-000000000001', 'order_confirmation', 'sv', 'Orderbekräftelse', 'Ordernummer, datum, artiklar och adresser från Shopify-ordern.'),
  -- Template 3, section 2: Available Shipping Evidence
  ('b0000000-0003-0000-0000-000000000002', 'shipping_receipt', 'sv', 'Fraktkvitto eller etikett', 'Ladda upp eventuella fraktetiketter, kvitton eller leveransmanifest du har utanför Shopify.'),
  ('b0000000-0003-0000-0000-000000000002', 'partial_tracking', 'sv', 'Partiella spårningsdata (om sådana finns)', 'Ladda upp eventuella transportörsavläsningar eller överlämningsbevis, även om de är ofullständiga.'),
  ('b0000000-0003-0000-0000-000000000002', 'shipping_method_note', 'sv', 'Notering: förklara fraktmetoden som använts', 'Beskriv fraktmetoden och varför fullständig spårning kan saknas.'),
  -- Template 3, section 3: Policies & Terms
  ('b0000000-0003-0000-0000-000000000003', 'shipping_policy', 'sv', 'Fraktpolicy', 'Publicerat utdrag ur fraktpolicyn från handlarbutiken.'),
  ('b0000000-0003-0000-0000-000000000003', 'refund_policy', 'sv', 'Chargebackpolicy', 'Publicerat utdrag ur chargebackpolicyn från handlarbutiken.'),

  -- Template 4, section 1: Order Basics
  ('b0000000-0004-0000-0000-000000000001', 'order_confirmation', 'sv', 'Orderbekräftelse', 'Orderdetaljer, artiklar och produkttitel från Shopify-ordern.'),
  -- Template 4, section 2: Product Evidence
  ('b0000000-0004-0000-0000-000000000002', 'product_page_screenshot', 'sv', 'Skärmdump av produktsida', 'Ladda upp en skärmdump av produktsidan som den såg ut vid köptillfället.'),
  ('b0000000-0004-0000-0000-000000000002', 'product_photos', 'sv', 'Produktfoton', 'Ladda upp foton av den faktiskt skickade produkten (kvalitetskontrollbilder).'),
  -- Template 4, section 3: Returns & Refund Policy
  ('b0000000-0004-0000-0000-000000000003', 'refund_policy', 'sv', 'Retur- och chargebackpolicy', 'Publicerat utdrag ur chargebackpolicyn från handlarbutiken.'),
  ('b0000000-0004-0000-0000-000000000003', 'return_offered_note', 'sv', 'Notering: erbjöds en retur eller ett byte?', 'Dokumentera om du erbjöd retur, byte eller delvis chargeback.'),
  -- Template 4, section 4: Customer Communication
  ('b0000000-0004-0000-0000-000000000004', 'customer_communication', 'sv', 'Kundkorrespondens', 'Meddelanden och ordernoteringar om kvalitetsklagomålet, från Shopify.'),

  -- Template 5, section 1: Order Basics
  ('b0000000-0005-0000-0000-000000000001', 'order_confirmation', 'sv', 'Orderbekräftelse', 'Orderpost för den omtvistade debiteringen, från Shopify-ordern.'),
  -- Template 5, section 2: Subscription Evidence
  ('b0000000-0005-0000-0000-000000000002', 'subscription_agreement', 'sv', 'Prenumerationsavtal / villkor', 'Ladda upp villkoren som kunden accepterade vid registreringen, inklusive faktureringscykel och avbokningspolicy.'),
  ('b0000000-0005-0000-0000-000000000002', 'usage_logs', 'sv', 'Loggar för tjänsteanvändning', 'Ladda upp bevis på att kunden använde tjänsten eller produkten efter den omtvistade debiteringsdagen.'),
  ('b0000000-0005-0000-0000-000000000002', 'renewal_notifications', 'sv', 'E-post med förnyelsepåminnelser', 'Ladda upp e-post som skickats före förnyelsen och som påminde kunden om kommande debiteringar.'),
  ('b0000000-0005-0000-0000-000000000002', 'cancellation_status_note', 'sv', 'Notering: status för avbokningsbegäran', 'Dokumentera om en avbokning togs emot och när, eller att ingen avbokning skickades in.'),
  -- Template 5, section 3: Policies & Terms
  ('b0000000-0005-0000-0000-000000000003', 'cancellation_policy', 'sv', 'Avbokningspolicy', 'Publicerat utdrag ur avbokningspolicyn från handlarbutiken.'),
  ('b0000000-0005-0000-0000-000000000003', 'refund_policy', 'sv', 'Chargebackpolicy', 'Publicerat utdrag ur chargebackpolicyn från handlarbutiken.'),
  -- Template 5, section 4: Customer Communication
  ('b0000000-0005-0000-0000-000000000004', 'customer_communication', 'sv', 'Kundkorrespondens', 'Meddelanden och ordernoteringar om avbokningen, från Shopify.'),

  -- Template 6, section 1: Order Basics
  ('b0000000-0006-0000-0000-000000000001', 'order_confirmation', 'sv', 'Orderbekräftelse', 'Orderdetaljer och totaler från Shopify-ordern.'),
  -- Template 6, section 2: Refund Record
  ('b0000000-0006-0000-0000-000000000002', 'refund_record', 'sv', 'Shopifys chargebackpost', 'Chargebackhistorik inbäddad i Shopify-ordern (datum, belopp, notering) — om en chargeback finns på ordern inkluderar vi den.'),
  ('b0000000-0006-0000-0000-000000000002', 'credit_statement', 'sv', 'Extern kredit / butikskreditpost', 'Ladda upp bevis på eventuell kredit som utfärdats utanför Shopify (butikskredit, presentkort, kredit utanför plattformen).'),
  ('b0000000-0006-0000-0000-000000000002', 'processing_timeline_note', 'sv', 'Notering: tidslinje för chargeback', 'Förklara typisk handläggningstid för chargebackar och om ärendet ligger inom det fönstret.'),
  -- Template 6, section 3: Refund Policy
  ('b0000000-0006-0000-0000-000000000003', 'refund_policy', 'sv', 'Chargebacks- / returpolicy', 'Publicerat utdrag ur chargebackpolicyn från handlarbutiken.'),
  -- Template 6, section 4: Customer Communication
  ('b0000000-0006-0000-0000-000000000004', 'customer_communication', 'sv', 'Kundkorrespondens om chargebacken', 'Meddelanden och ordernoteringar som rör chargebacken, från Shopify.'),

  -- Template 7, section 1: Order Basics
  ('b0000000-0007-0000-0000-000000000001', 'order_confirmation', 'sv', 'Orderbekräftelse', 'Orderdetaljer, totaler och skapandedatum från Shopify-ordern.'),
  ('b0000000-0007-0000-0000-000000000001', 'order_itemization', 'sv', 'Specifikation av ordern', 'Specifikation rad för rad som visar vad beloppet täcker, från Shopify-ordern.'),
  -- Template 7, section 2: External Transaction Records
  ('b0000000-0007-0000-0000-000000000002', 'payment_records', 'sv', 'Extern transaktionslogg från betalgateway', 'Ladda upp loggar från betalgatewayen som visar att varje debitering är separat (vi hämtar inte gateway-loggar automatiskt).'),
  ('b0000000-0007-0000-0000-000000000002', 'invoice_receipts', 'sv', 'Separata fakturor för varje debitering', 'Ladda upp separata fakturor som bevisar att varje debitering motsvarar en annan order eller orderrad.'),
  ('b0000000-0007-0000-0000-000000000002', 'auth_vs_capture_note', 'sv', 'Notering: auktorisering kontra debitering', 'Förklara om den dubbla synligheten är en auktoriseringsreservation snarare än en faktisk debitering.'),

  -- Template 8, section 1: Order Basics
  ('b0000000-0008-0000-0000-000000000001', 'order_confirmation', 'sv', 'Orderbekräftelse', 'Orderdetaljer från Shopify-ordern.'),
  -- Template 8, section 2: Delivery & Access Evidence
  ('b0000000-0008-0000-0000-000000000002', 'download_link_email', 'sv', 'E-post med nedladdningslänk / åtkomst', 'Ladda upp e-postmeddelandet till kunden med nedladdningslänkar eller åtkomstuppgifter.'),
  ('b0000000-0008-0000-0000-000000000002', 'access_logs', 'sv', 'Åtkomst- eller nedladdningsloggar', 'Ladda upp serverloggar som visar att kunden öppnade eller laddade ner den digitala produkten.'),
  ('b0000000-0008-0000-0000-000000000002', 'license_activation', 'sv', 'Aktiveringspost för licensnyckel', 'Ladda upp posten som visar att licensnyckeln aktiverades av kunden.'),
  -- Template 8, section 3: Terms & Policies
  ('b0000000-0008-0000-0000-000000000003', 'refund_policy', 'sv', 'Policy för digital leverans / chargeback', 'Publicerat utdrag ur chargebackpolicyn från handlarbutiken (täcker villkor om icke-chargebacksbara digitala varor när det är tillämpligt).'),

  -- Template 9, section 1: Store Policies
  ('b0000000-0009-0000-0000-000000000001', 'refund_policy', 'sv', 'Chargebacks- / returpolicy', 'Publicerat utdrag ur chargebackpolicyn från handlarbutiken.'),
  ('b0000000-0009-0000-0000-000000000001', 'cancellation_policy', 'sv', 'Avbokningspolicy', 'Publicerat utdrag ur avbokningspolicyn från handlarbutiken.'),
  ('b0000000-0009-0000-0000-000000000001', 'shipping_policy', 'sv', 'Fraktpolicy', 'Publicerat utdrag ur fraktpolicyn från handlarbutiken.'),
  -- Template 9, section 2: Customer Acceptance
  ('b0000000-0009-0000-0000-000000000002', 'checkout_terms', 'sv', 'Bevis på accept av villkor i kassan', 'Ladda upp en skärmdump eller logg som visar att kunden accepterade villkoren i kassan.'),
  ('b0000000-0009-0000-0000-000000000002', 'terms_of_service', 'sv', 'Användarvillkor', 'Ladda upp det fullständiga ToS-dokumentet som kunden accepterade.'),

  -- Template 10, section 1: Order Basics
  ('b0000000-0010-0000-0000-000000000001', 'order_confirmation', 'sv', 'Orderbekräftelse', 'Orderdetaljer, artiklar och kunduppgifter från Shopify-ordern.'),
  -- Template 10, section 2: Shipping & Delivery
  ('b0000000-0010-0000-0000-000000000002', 'shipping_tracking', 'sv', 'Fraktspårning (om tillämpligt)', 'Transportörens spårning från Shopify-leveransen, om ordern har skickats.'),
  ('b0000000-0010-0000-0000-000000000002', 'delivery_proof', 'sv', 'Leveransbekräftelse', 'Leveransstatus från transportören enligt Shopify-leveransen, när det är tillgängligt.'),
  -- Template 10, section 3: Policies & Terms
  ('b0000000-0010-0000-0000-000000000003', 'refund_policy', 'sv', 'Chargebackpolicy', 'Publicerat utdrag ur chargebackpolicyn från handlarbutiken.'),
  ('b0000000-0010-0000-0000-000000000003', 'shipping_policy', 'sv', 'Fraktpolicy', 'Publicerat utdrag ur fraktpolicyn från handlarbutiken.'),
  ('b0000000-0010-0000-0000-000000000003', 'cancellation_policy', 'sv', 'Avbokningspolicy', 'Publicerat utdrag ur avbokningspolicyn från handlarbutiken.'),
  -- Template 10, section 4: Customer Communication
  ('b0000000-0010-0000-0000-000000000004', 'customer_communication', 'sv', 'Kundkorrespondens', 'Meddelanden och ordernoteringar som Shopify har fångat upp.'),
  ('b0000000-0010-0000-0000-000000000004', 'additional_context', 'sv', 'Ytterligare kontext eller bevis', 'Lägg till andra relevanta noteringar eller ladda upp extra filer som stöder ditt ärende.'),

  -- Template 11: Fraud Inquiry
  ('b0000000-0011-0000-0000-000000000001', 'order_confirmation', 'sv', 'Orderbekräftelse', 'Kort ordersammanfattning som visar att debiteringen är legitim.'),
  ('b0000000-0011-0000-0000-000000000001', 'customer_account_info', 'sv', 'Kundhistorik', 'Notera om detta är en återkommande kund i gott anseende.'),
  -- Template 12: PNR Inquiry
  ('b0000000-0012-0000-0000-000000000001', 'tracking_number', 'sv', 'Spårningsstatus', 'Aktuell spårningsstatus från transportören.'),
  ('b0000000-0012-0000-0000-000000000001', 'order_confirmation', 'sv', 'Order- och frakttidslinje', 'Orderdatum och när den skickades.'),
  ('b0000000-0012-0000-0000-000000000001', 'customer_emails', 'sv', 'Fraktnotis', 'Fraktbekräftelse som skickats till kunden.'),
  -- Template 13: Product Unacceptable Inquiry
  ('b0000000-0013-0000-0000-000000000001', 'order_confirmation', 'sv', 'Ordersammanfattning', 'Ordersammanfattning med namnet på produkten kunden köpte.'),
  ('b0000000-0013-0000-0000-000000000001', 'product_description', 'sv', 'Produktbeskrivning', 'Beskrivningen som kunden såg vid köptillfället.'),
  ('b0000000-0013-0000-0000-000000000001', 'return_offered_note', 'sv', 'Retur erbjuden', 'Notera eventuell retur eller byte du har erbjudit.'),
  -- Template 14: Subscription Inquiry
  ('b0000000-0014-0000-0000-000000000001', 'signup_confirmation', 'sv', 'Registreringsbekräftelse', 'När och hur kunden registrerade sig.'),
  ('b0000000-0014-0000-0000-000000000001', 'usage_activity', 'sv', 'Senaste aktiviteten', 'Senaste inloggning eller tjänsteanvändning, om tillämpligt.'),
  ('b0000000-0014-0000-0000-000000000001', 'cancellation_status_note', 'sv', 'Avbokningsstatus', 'Om en avbokningsbegäran togs emot och när.'),
  -- Template 15: Refund Inquiry
  ('b0000000-0015-0000-0000-000000000001', 'processing_timeline_note', 'sv', 'Chargebackstatus', 'Aktuell status: behandlad, pågående eller inte tillämplig.'),
  ('b0000000-0015-0000-0000-000000000001', 'refund_policy', 'sv', 'Sammanfattning av chargebackpolicy', 'Kort notering om din chargebackpolicy.'),
  ('b0000000-0015-0000-0000-000000000001', 'customer_emails', 'sv', 'Kundkorrespondens', 'Senaste meddelanden med kunden om chargebacken.'),
  -- Template 16: Duplicate Inquiry
  ('b0000000-0016-0000-0000-000000000001', 'payment_records', 'sv', 'Transaktionslista', 'Alla debiteringar på denna order som visar att varje debitering är separat.'),
  ('b0000000-0016-0000-0000-000000000001', 'order_itemization', 'sv', 'Specifikation av ordern', 'Orderrader och totalbelopp för debiteringen i fråga.'),
  -- Template 17: Policy Inquiry
  ('b0000000-0017-0000-0000-000000000001', 'relevant_policy', 'sv', 'Relevant policy', 'Den policy som är mest tillämplig på denna fråga.'),
  ('b0000000-0017-0000-0000-000000000001', 'terms_acceptance', 'sv', 'Kundens godkännande', 'Bevis på att kunden accepterade denna policy i kassan.'),
  -- Template 18: General Inquiry
  ('b0000000-0018-0000-0000-000000000001', 'order_confirmation', 'sv', 'Ordersammanfattning', 'Kort ordersammanfattning.'),
  ('b0000000-0018-0000-0000-000000000001', 'additional_context', 'sv', 'Ytterligare kontext', 'Annan information som är relevant för denna fråga.')
) AS v(template_section_id, key, locale, label, guidance)
  ON pti.template_section_id = v.template_section_id::uuid AND pti.key = v.key
ON CONFLICT (template_item_id, locale) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════
-- GERMAN (de) — templates
-- ═══════════════════════════════════════════════════════════════════════

INSERT INTO pack_template_i18n (template_id, locale, name, short_description, works_best_for, preview_note) VALUES
('a0000000-0000-0000-0000-000000000001', 'de',
 'Betrug / Nicht autorisiert — Standard',
 'Erfasst alle Authentifizierungs- und Bestellsignale, die v2 aus Shopify lesen kann: AVS/CVV, 3-D Secure (sofern verfügbar), Shopify-Betrugsprüfung, IP-Standort, Übereinstimmung von Rechnungs- und Lieferadresse, Stammkundenhistorie und Kundenkorrespondenz. Liefernachweise werden einbezogen, wenn die Bestellung versendet wurde.',
 'Rückbuchungen, bei denen der Karteninhaber angibt, die Transaktion nicht autorisiert zu haben.',
 'Wird automatisch aus Shopify- und Zahlungsdaten erfasst — kein Upload durch den Händler erforderlich.'),
('a0000000-0000-0000-0000-000000000002', 'de',
 'Produkt nicht erhalten — Mit Sendungsverfolgung',
 'Starkes Nachweispaket für PNR-Fälle, wenn Shopify eine Sendungsverfolgung des Versanddienstleisters bereitstellt. Erfasst Bestellbestätigung, Sendungsverfolgungsstatus und Zustellbestätigung (mit Unterschrift/Foto, sofern vom Versanddienstleister bereitgestellt) direkt aus Shopify.',
 'Fälle, in denen die Kundin oder der Kunde Nichtzustellung behauptet, die Sendungsverfolgung aber eine erfolgreiche Zustellung zeigt.',
 'Am besten, wenn die Shopify-Fulfillment-Daten zeigen, dass die Bestellung zugestellt wurde.'),
('a0000000-0000-0000-0000-000000000003', 'de',
 'Produkt nicht erhalten — Ohne Sendungsverfolgung / Schwacher Nachweis',
 'Für PNR-Fälle, in denen aus Shopify keine Sendungsverfolgung verfügbar ist. Erfasst Bestell- und Richtlinien-Snapshots automatisch und bittet den Händler, vorhandene Versandetiketten, Teilnachverfolgungen oder Kontextnotizen hochzuladen.',
 'PNR-Fälle mit fehlender oder eingeschränkter Versanddokumentation.',
 'Verwenden Sie diese Vorlage, wenn Shopify keine Sendungsverfolgung kennt — Sie laden hoch, was Sie haben.'),
('a0000000-0000-0000-0000-000000000004', 'de',
 'Produkt nicht wie beschrieben — Qualitätsmängel',
 'Für Fälle, in denen behauptet wird, das Produkt entspreche nicht der Beschreibung. Erfasst Bestelldetails, Snapshot der Rückerstattungsrichtlinie und Kundenkorrespondenz aus Shopify; bittet den Händler, Produktfotos und Screenshots der Produktseite hochzuladen, die belegen, dass das Inserat korrekt war.',
 'Fälle, in denen Kundinnen und Kunden behaupten, das Produkt unterscheide sich von dem, was beworben wurde.',
 NULL),
('a0000000-0000-0000-0000-000000000005', 'de',
 'Abonnement gekündigt — Umfassend',
 'Für Abonnement-Fälle. Erfasst die Bestellung der strittigen Belastung, Snapshots der Kündigungs- und Rückerstattungsrichtlinien sowie vorhandene Shopify-Korrespondenz automatisch; bittet den Händler, Abonnementbedingungen, Nutzungsprotokolle, Verlängerungs-E-Mails und eine Notiz zum Kündigungsstatus hochzuladen, da hierfür kein Shopify-Connector existiert.',
 'Fälle mit wiederkehrenden Belastungen, nachdem die Kundin oder der Kunde behauptet, das Abonnement gekündigt zu haben.',
 NULL),
('a0000000-0000-0000-0000-000000000006', 'de',
 'Rückerstattung / Gutschrift nicht verarbeitet — Standard',
 'Für Fälle, in denen behauptet wird, eine zugesagte Rückerstattung sei nicht erfolgt. Erfasst die Bestellung, den Shopify-Rückerstattungseintrag (order.refunds), den Snapshot der Rückerstattungsrichtlinie und vorhandene Shopify-Korrespondenz automatisch; bittet den Händler nur dann um einen externen Gutschriftsnachweis, wenn die Gutschrift außerhalb von Shopify erteilt wurde.',
 'Fälle, in denen die Kundin oder der Kunde behauptet, eine Rückerstattung sei zugesagt, aber nicht erfolgt.',
 NULL),
('a0000000-0000-0000-0000-000000000007', 'de',
 'Doppelte Belastung / Falscher Betrag',
 'Für Fälle mit angeblicher Doppelbelastung oder falsch berechnetem Betrag. Erfasst die Shopify-Bestellung und deren Positionsaufstellung automatisch; bittet den Händler, externe Gateway-Protokolle oder separate Rechnungen hochzuladen, da DisputeDesk keine rohen Zahlungs-Gateway-Protokolle abruft.',
 'Fälle mit Behauptungen über Doppelbelastung oder falsch berechnetem Betrag.',
 NULL),
('a0000000-0000-0000-0000-000000000008', 'de',
 'Digitale Güter / Dienstleistung erbracht',
 'Für Fälle zu digitalen Produkten oder Dienstleistungen. Erfasst Bestellung und Snapshot der Rückerstattungsrichtlinie aus Shopify; bittet den Händler, Liefer-E-Mails, Zugriffsprotokolle und Lizenzaktivierungen hochzuladen, da hierfür kein Shopify-Connector existiert.',
 'Fälle rund um digitale Downloads, SaaS-Zugänge oder Online-Dienste.',
 NULL),
('a0000000-0000-0000-0000-000000000009', 'de',
 'Richtlinienbasiert (Rückgabe / Kündigung / Versand)',
 'Für Fälle, in denen die stärkste Verteidigung klare, veröffentlichte Richtlinien sind. Erfasst Snapshots der Rückerstattungs-, Kündigungs- und Versandrichtlinien aus dem Händler-Shop automatisch; bittet den Händler bei Bedarf um Akzeptanznachweise.',
 'Fälle, in denen die Richtlinien des Händlers die Belastung klar stützen und von der Kundin oder dem Kunden akzeptiert wurden.',
 NULL),
('a0000000-0000-0000-0000-000000000010', 'de',
 'Allgemein — Universalpaket',
 'Flexibles Paket für Fallarten, die zu keiner spezifischen Vorlage passen. Erfasst die Bestellung, verfügbare Versand-/Fulfillment-Daten aus Shopify, Snapshots der Shop-Richtlinien und Shopify-Korrespondenz automatisch; der Händler kann bei Bedarf eine zusätzliche Kontextnotiz ergänzen.',
 'Jede Fallart, für die keine spezifischere Vorlage verfügbar ist.',
 NULL),
('a0000000-0000-0000-0000-000000000011', 'de',
 'Betrug / Nicht autorisiert — Voranfrage',
 'Schlankes Antwortpaket für Anfragen zu Betrug und nicht erkannten Belastungen. Ziel ist es, mit minimalen Nachweisen zu bestätigen, dass die Belastung legitim war, damit die Anfrage ohne Eskalation geschlossen wird.',
 'Pre-Chargeback-Anfragen zu Betrug, bei denen der Karteninhaber hinterfragt, ob er die Belastung autorisiert hat.',
 NULL),
('a0000000-0000-0000-0000-000000000012', 'de',
 'Produkt nicht erhalten — Voranfrage',
 'Schnelle Antwort zum Versandstatus für PNR-Voranfragen vor einer Rückbuchung. Eine Sendungsnummer und eine Zustellbestätigung genügen meist, um die Frage zu klären.',
 'Die Kundin oder der Kunde teilt der Bank mit, dass die Bestellung nicht angekommen ist, bevor eine Rückbuchung eröffnet wird.',
 NULL),
('a0000000-0000-0000-0000-000000000013', 'de',
 'Produkt nicht akzeptabel — Voranfrage',
 'Kurze Antwort auf Anfragen zu Qualität oder „nicht wie beschrieben". Konzentriert sich darauf, was die Kundin oder der Kunde gekauft hat, und auf ein eventuell unterbreitetes Rückgabeangebot.',
 'Beschwerdestadium, in dem ein vollständiges Rückgabe-/Rückerstattungsgespräch die Sache klären kann.',
 NULL),
('a0000000-0000-0000-0000-000000000014', 'de',
 'Abonnement gekündigt — Voranfrage',
 'Kurze Antwort zum Abonnementstatus. Bestätigt, ob die Kundin oder der Kunde noch aktiv ist oder gekündigt hat und wann die letzte Belastung erfolgt ist.',
 'Anfrage zu wiederkehrenden Belastungen, bevor ein formaler Rückbuchungsfall eröffnet wird.',
 NULL),
('a0000000-0000-0000-0000-000000000015', 'de',
 'Rückerstattung / Gutschrift nicht verarbeitet — Voranfrage',
 'Schnelle Antwort zum Rückerstattungsstatus. Teilt der Bank mit, ob eine Rückerstattung läuft, bereits erfolgt ist oder nicht geschuldet wird.',
 'Die Kundin oder der Kunde behauptet, eine Rückerstattung sei zugesagt, aber nicht erfolgt — meist eine Buchhaltungsfrage.',
 NULL),
('a0000000-0000-0000-0000-000000000016', 'de',
 'Doppelte Belastung / Falscher Betrag — Voranfrage',
 'Kurze Antwort mit Transaktionsdaten, die zeigt, dass jede Belastung eigenständig ist, oder die den strittigen Betrag aufschlüsselt.',
 'Die Kundin oder der Kunde hinterfragt, ob doppelt belastet oder ein falscher Betrag berechnet wurde.',
 NULL),
('a0000000-0000-0000-0000-000000000017', 'de',
 'Richtlinienbasiert — Voranfrage',
 'Leichtgewichtige Richtlinien-Antwort. Hebt die relevanteste Richtlinie hervor, der die Kundin oder der Kunde im Checkout zugestimmt hat.',
 'Anfragen, bei denen eine klare, veröffentlichte Richtlinie die Frage direkt beantwortet.',
 NULL),
('a0000000-0000-0000-0000-000000000018', 'de',
 'Allgemein — Voranfrage',
 'Minimale Universalantwort für Anfragen, die zu keiner spezifischen Vorlage passen. Eine Bestellzusammenfassung plus optionaler Freitextkontext.',
 'Jede Anfrage, die nicht von einer spezifischeren Vorlage abgedeckt wird.',
 NULL)
ON CONFLICT (template_id, locale) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════
-- GERMAN (de) — section titles
-- ═══════════════════════════════════════════════════════════════════════

INSERT INTO pack_template_section_i18n (template_section_id, locale, title) VALUES
-- Template 1
('b0000000-0001-0000-0000-000000000001', 'de', 'Zahlungsauthentifizierung'),
('b0000000-0001-0000-0000-000000000002', 'de', 'Bestellkontext'),
('b0000000-0001-0000-0000-000000000003', 'de', 'Kundenhistorie'),
('b0000000-0001-0000-0000-000000000004', 'de', 'Zustellung, sofern versendet'),
-- Template 2
('b0000000-0002-0000-0000-000000000001', 'de', 'Bestellgrunddaten'),
('b0000000-0002-0000-0000-000000000002', 'de', 'Versand und Sendungsverfolgung'),
('b0000000-0002-0000-0000-000000000003', 'de', 'Zustellbestätigung'),
('b0000000-0002-0000-0000-000000000004', 'de', 'Kundenkommunikation'),
-- Template 3
('b0000000-0003-0000-0000-000000000001', 'de', 'Bestellgrunddaten'),
('b0000000-0003-0000-0000-000000000002', 'de', 'Vorhandene Versandnachweise'),
('b0000000-0003-0000-0000-000000000003', 'de', 'Richtlinien und Bedingungen'),
-- Template 4
('b0000000-0004-0000-0000-000000000001', 'de', 'Bestellgrunddaten'),
('b0000000-0004-0000-0000-000000000002', 'de', 'Produktnachweise'),
('b0000000-0004-0000-0000-000000000003', 'de', 'Rückgabe- und Rückerstattungsrichtlinie'),
('b0000000-0004-0000-0000-000000000004', 'de', 'Kundenkommunikation'),
-- Template 5
('b0000000-0005-0000-0000-000000000001', 'de', 'Bestellgrunddaten'),
('b0000000-0005-0000-0000-000000000002', 'de', 'Abonnement-Nachweise'),
('b0000000-0005-0000-0000-000000000003', 'de', 'Richtlinien und Bedingungen'),
('b0000000-0005-0000-0000-000000000004', 'de', 'Kundenkommunikation'),
-- Template 6
('b0000000-0006-0000-0000-000000000001', 'de', 'Bestellgrunddaten'),
('b0000000-0006-0000-0000-000000000002', 'de', 'Rückerstattungseintrag'),
('b0000000-0006-0000-0000-000000000003', 'de', 'Rückerstattungsrichtlinie'),
('b0000000-0006-0000-0000-000000000004', 'de', 'Kundenkommunikation'),
-- Template 7
('b0000000-0007-0000-0000-000000000001', 'de', 'Bestellgrunddaten'),
('b0000000-0007-0000-0000-000000000002', 'de', 'Externe Transaktionsdaten'),
-- Template 8
('b0000000-0008-0000-0000-000000000001', 'de', 'Bestellgrunddaten'),
('b0000000-0008-0000-0000-000000000002', 'de', 'Liefer- und Zugriffsnachweise'),
('b0000000-0008-0000-0000-000000000003', 'de', 'Bedingungen und Richtlinien'),
-- Template 9
('b0000000-0009-0000-0000-000000000001', 'de', 'Shop-Richtlinien'),
('b0000000-0009-0000-0000-000000000002', 'de', 'Akzeptanz durch die Kundin oder den Kunden'),
-- Template 10
('b0000000-0010-0000-0000-000000000001', 'de', 'Bestellgrunddaten'),
('b0000000-0010-0000-0000-000000000002', 'de', 'Versand und Zustellung'),
('b0000000-0010-0000-0000-000000000003', 'de', 'Richtlinien und Bedingungen'),
('b0000000-0010-0000-0000-000000000004', 'de', 'Kundenkommunikation'),
-- Template 11
('b0000000-0011-0000-0000-000000000001', 'de', 'Transaktionsverifizierung'),
-- Template 12
('b0000000-0012-0000-0000-000000000001', 'de', 'Versandstatus'),
-- Template 13
('b0000000-0013-0000-0000-000000000001', 'de', 'Produktinformationen'),
-- Template 14
('b0000000-0014-0000-0000-000000000001', 'de', 'Abonnementstatus'),
-- Template 15
('b0000000-0015-0000-0000-000000000001', 'de', 'Rückerstattungsstatus'),
-- Template 16
('b0000000-0016-0000-0000-000000000001', 'de', 'Transaktionsdaten'),
-- Template 17
('b0000000-0017-0000-0000-000000000001', 'de', 'Anwendbare Richtlinie'),
-- Template 18
('b0000000-0018-0000-0000-000000000001', 'de', 'Bestellzusammenfassung')
ON CONFLICT (template_section_id, locale) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════
-- GERMAN (de) — item labels + guidance
-- ═══════════════════════════════════════════════════════════════════════

INSERT INTO pack_template_item_i18n (template_item_id, locale, label, guidance)
SELECT pti.id, v.locale, v.label, v.guidance
FROM pack_template_items pti
JOIN (VALUES
  -- Template 1, section 1
  ('b0000000-0001-0000-0000-000000000001', 'avs_cvv_match', 'de', 'AVS/CVV-Verifizierung', 'Übereinstimmungscodes für Adresse und CVV aus der Zahlungsautorisierung, aus der Shopify-Bestellung gelesen.'),
  ('b0000000-0001-0000-0000-000000000001', 'tds_authentication', 'de', '3-D-Secure-Authentifizierung, sofern verfügbar', 'Wenn Shopify Payments ein 3-D-Secure-Ergebnis im Beleg ausweist, wird es einbezogen. Nicht alle Gateways stellen dies bereit.'),
  ('b0000000-0001-0000-0000-000000000001', 'fraud_risk_screening', 'de', 'Shopify-Betrugsprüfung', 'Shopifys Risikobewertung vor der Autorisierung für diese Bestellung.'),
  -- Template 1, section 2
  ('b0000000-0001-0000-0000-000000000002', 'order_confirmation', 'de', 'Bestellbestätigung', 'Bestellnummer, Datum, Positionen, Summen und Kundendaten aus der Shopify-Bestellung.'),
  ('b0000000-0001-0000-0000-000000000002', 'billing_address_match', 'de', 'Übereinstimmung von Rechnungs- und Lieferadresse', 'Vergleicht Rechnungs- und Lieferadresse der Shopify-Bestellung auf Stadt-/Länderebene.'),
  ('b0000000-0001-0000-0000-000000000002', 'ip_location_check', 'de', 'IP-Standort vs. Rechnungsland', 'Ordnet die Checkout-IP einer Region zu und vergleicht sie mit dem Rechnungsland.'),
  -- Template 1, section 3
  ('b0000000-0001-0000-0000-000000000003', 'customer_account_info', 'de', 'Stammkunden-Signal', 'Ob die Kundin oder der Kunde bereits frühere Bestellungen in diesem Shop hat. Stärkt den Fall, wenn vorhanden.'),
  ('b0000000-0001-0000-0000-000000000003', 'customer_communication', 'de', 'Kundenkorrespondenz aus Shopify-Zeitleiste/Notizen', 'Alle von Shopify erfassten Nachrichten, Bestellnotizen oder Käufermerkmale.'),
  -- Template 1, section 4
  ('b0000000-0001-0000-0000-000000000004', 'shipping_tracking', 'de', 'Sendungsverfolgung', 'Sendungsverfolgung des Versanddienstleisters aus dem Shopify-Fulfillment, sofern die Bestellung versendet wurde.'),
  ('b0000000-0001-0000-0000-000000000004', 'delivery_proof', 'de', 'Zustellunterschrift oder -foto', 'Unterschriftsbestätigung oder Zustellfoto des Versanddienstleisters, sofern bereitgestellt.'),

  -- Template 2, section 1
  ('b0000000-0002-0000-0000-000000000001', 'order_confirmation', 'de', 'Bestellbestätigung', 'Bestellnummer, Datum, Positionen und Lieferadresse aus der Shopify-Bestellung.'),
  -- Template 2, section 2
  ('b0000000-0002-0000-0000-000000000002', 'shipping_tracking', 'de', 'Status der Sendungsverfolgung', 'Sendungsnummer und aktueller Status aus dem Shopify-Fulfillment.'),
  -- Template 2, section 3
  ('b0000000-0002-0000-0000-000000000003', 'delivery_proof', 'de', 'Zustellbestätigung', 'Vom Versanddienstleister gemeldeter Zustellstatus (mit Unterschrift/Foto, sofern verfügbar) aus dem Shopify-Fulfillment.'),
  -- Template 2, section 4
  ('b0000000-0002-0000-0000-000000000004', 'customer_communication', 'de', 'Kundenkorrespondenz', 'Nachrichten und Bestellnotizen nach dem Kauf, von Shopify erfasst.'),

  -- Template 3, section 1
  ('b0000000-0003-0000-0000-000000000001', 'order_confirmation', 'de', 'Bestellbestätigung', 'Bestellnummer, Datum, Positionen und Adressen aus der Shopify-Bestellung.'),
  -- Template 3, section 2
  ('b0000000-0003-0000-0000-000000000002', 'shipping_receipt', 'de', 'Versandbeleg oder -etikett', 'Laden Sie vorhandene Versandetiketten, Belege oder Fulfillment-Manifeste außerhalb von Shopify hoch.'),
  ('b0000000-0003-0000-0000-000000000002', 'partial_tracking', 'de', 'Teilweise Sendungsverfolgungsdaten (falls vorhanden)', 'Laden Sie vorhandene Scans oder Übergabenachweise hoch, auch wenn diese unvollständig sind.'),
  ('b0000000-0003-0000-0000-000000000002', 'shipping_method_note', 'de', 'Hinweis: verwendete Versandmethode erläutern', 'Beschreiben Sie die Versandmethode und warum eine vollständige Sendungsverfolgung möglicherweise nicht verfügbar ist.'),
  -- Template 3, section 3
  ('b0000000-0003-0000-0000-000000000003', 'shipping_policy', 'de', 'Versandrichtlinie', 'Veröffentlichter Snapshot der Versandrichtlinie aus dem Händler-Shop.'),
  ('b0000000-0003-0000-0000-000000000003', 'refund_policy', 'de', 'Rückerstattungsrichtlinie', 'Veröffentlichter Snapshot der Rückerstattungsrichtlinie aus dem Händler-Shop.'),

  -- Template 4, section 1
  ('b0000000-0004-0000-0000-000000000001', 'order_confirmation', 'de', 'Bestellbestätigung', 'Bestelldetails, Positionen und Produkttitel aus der Shopify-Bestellung.'),
  -- Template 4, section 2
  ('b0000000-0004-0000-0000-000000000002', 'product_page_screenshot', 'de', 'Screenshot der Produktseite', 'Laden Sie einen Screenshot der Produktseite hoch, wie sie zum Kaufzeitpunkt aussah.'),
  ('b0000000-0004-0000-0000-000000000002', 'product_photos', 'de', 'Produktfotos', 'Laden Sie Fotos des tatsächlich versendeten Produkts hoch (Qualitätskontrollbilder).'),
  -- Template 4, section 3
  ('b0000000-0004-0000-0000-000000000003', 'refund_policy', 'de', 'Rückgabe- / Rückerstattungsrichtlinie', 'Veröffentlichter Snapshot der Rückerstattungsrichtlinie aus dem Händler-Shop.'),
  ('b0000000-0004-0000-0000-000000000003', 'return_offered_note', 'de', 'Hinweis: wurde eine Rückgabe oder ein Umtausch angeboten?', 'Dokumentieren Sie, ob Sie eine Rückgabe, einen Umtausch oder eine Teilrückerstattung angeboten haben.'),
  -- Template 4, section 4
  ('b0000000-0004-0000-0000-000000000004', 'customer_communication', 'de', 'Kundenkorrespondenz', 'Nachrichten und Bestellnotizen zur Qualitätsbeschwerde aus Shopify.'),

  -- Template 5, section 1
  ('b0000000-0005-0000-0000-000000000001', 'order_confirmation', 'de', 'Bestellbestätigung', 'Bestelleintrag für die strittige Belastung aus der Shopify-Bestellung.'),
  -- Template 5, section 2
  ('b0000000-0005-0000-0000-000000000002', 'subscription_agreement', 'de', 'Abonnementvereinbarung / -bedingungen', 'Laden Sie die Bedingungen hoch, denen die Kundin oder der Kunde bei der Anmeldung zugestimmt hat, einschließlich Abrechnungszyklus und Kündigungsrichtlinie.'),
  ('b0000000-0005-0000-0000-000000000002', 'usage_logs', 'de', 'Nutzungsprotokolle des Dienstes', 'Laden Sie Belege hoch, dass die Kundin oder der Kunde den Dienst oder das Produkt nach dem strittigen Belastungsdatum genutzt hat.'),
  ('b0000000-0005-0000-0000-000000000002', 'renewal_notifications', 'de', 'Verlängerungs-Erinnerungs-E-Mails', 'Laden Sie E-Mails hoch, die vor der Verlängerung an die Kundin oder den Kunden gesendet wurden, um auf bevorstehende Belastungen hinzuweisen.'),
  ('b0000000-0005-0000-0000-000000000002', 'cancellation_status_note', 'de', 'Hinweis: Status der Kündigungsanfrage', 'Dokumentieren Sie, ob und wann eine Kündigung eingegangen ist, oder dass keine Kündigung eingereicht wurde.'),
  -- Template 5, section 3
  ('b0000000-0005-0000-0000-000000000003', 'cancellation_policy', 'de', 'Kündigungsrichtlinie', 'Veröffentlichter Snapshot der Kündigungsrichtlinie aus dem Händler-Shop.'),
  ('b0000000-0005-0000-0000-000000000003', 'refund_policy', 'de', 'Rückerstattungsrichtlinie', 'Veröffentlichter Snapshot der Rückerstattungsrichtlinie aus dem Händler-Shop.'),
  -- Template 5, section 4
  ('b0000000-0005-0000-0000-000000000004', 'customer_communication', 'de', 'Kundenkorrespondenz', 'Nachrichten und Bestellnotizen zur Kündigung aus Shopify.'),

  -- Template 6, section 1
  ('b0000000-0006-0000-0000-000000000001', 'order_confirmation', 'de', 'Bestellbestätigung', 'Bestelldetails und Summen aus der Shopify-Bestellung.'),
  -- Template 6, section 2
  ('b0000000-0006-0000-0000-000000000002', 'refund_record', 'de', 'Shopify-Rückerstattungseintrag', 'In der Shopify-Bestellung hinterlegter Rückerstattungsverlauf (Datum, Betrag, Notiz) — sofern eine Rückerstattung auf der Bestellung besteht, wird sie einbezogen.'),
  ('b0000000-0006-0000-0000-000000000002', 'credit_statement', 'de', 'Externe Gutschrift / Shop-Guthaben-Eintrag', 'Laden Sie Belege für eine außerhalb von Shopify erteilte Gutschrift hoch (Shop-Guthaben, Geschenkkarte, Off-Platform-Gutschrift).'),
  ('b0000000-0006-0000-0000-000000000002', 'processing_timeline_note', 'de', 'Hinweis: Bearbeitungszeit der Rückerstattung', 'Erklären Sie die typische Bearbeitungszeit für Rückerstattungen und ob der Fall innerhalb dieses Zeitraums liegt.'),
  -- Template 6, section 3
  ('b0000000-0006-0000-0000-000000000003', 'refund_policy', 'de', 'Rückerstattungs- / Rückgaberichtlinie', 'Veröffentlichter Snapshot der Rückerstattungsrichtlinie aus dem Händler-Shop.'),
  -- Template 6, section 4
  ('b0000000-0006-0000-0000-000000000004', 'customer_communication', 'de', 'Kundenkorrespondenz zur Rückerstattung', 'Nachrichten und Bestellnotizen, die die Rückerstattung betreffen, aus Shopify.'),

  -- Template 7, section 1
  ('b0000000-0007-0000-0000-000000000001', 'order_confirmation', 'de', 'Bestellbestätigung', 'Bestelldetails, Summen und Erstellungsdatum aus der Shopify-Bestellung.'),
  ('b0000000-0007-0000-0000-000000000001', 'order_itemization', 'de', 'Positionsaufstellung der Bestellung', 'Aufstellung Zeile für Zeile, die zeigt, was der Betrag abdeckt, aus der Shopify-Bestellung.'),
  -- Template 7, section 2
  ('b0000000-0007-0000-0000-000000000002', 'payment_records', 'de', 'Externes Zahlungs-Gateway-Transaktionsprotokoll', 'Laden Sie Gateway-Protokolle hoch, die zeigen, dass jede Belastung eigenständig ist (wir ziehen keine Gateway-Protokolle automatisch).'),
  ('b0000000-0007-0000-0000-000000000002', 'invoice_receipts', 'de', 'Separate Rechnungen für jede Belastung', 'Laden Sie separate Rechnungen hoch, die belegen, dass jede Belastung einer anderen Bestellung oder Position entspricht.'),
  ('b0000000-0007-0000-0000-000000000002', 'auth_vs_capture_note', 'de', 'Hinweis: Autorisierung vs. Belastung', 'Erläutern Sie, ob die scheinbare Doppelbelastung eine Autorisierungsreservierung statt einer tatsächlichen Belastung ist.'),

  -- Template 8, section 1
  ('b0000000-0008-0000-0000-000000000001', 'order_confirmation', 'de', 'Bestellbestätigung', 'Bestelldetails aus der Shopify-Bestellung.'),
  -- Template 8, section 2
  ('b0000000-0008-0000-0000-000000000002', 'download_link_email', 'de', 'Download-Link / Zugangs-E-Mail', 'Laden Sie die E-Mail an die Kundin oder den Kunden mit Download-Links oder Zugangsdaten hoch.'),
  ('b0000000-0008-0000-0000-000000000002', 'access_logs', 'de', 'Zugriffs- oder Download-Protokolle', 'Laden Sie Server-Protokolle hoch, die zeigen, dass die Kundin oder der Kunde auf das digitale Produkt zugegriffen oder es heruntergeladen hat.'),
  ('b0000000-0008-0000-0000-000000000002', 'license_activation', 'de', 'Eintrag zur Lizenzschlüsselaktivierung', 'Laden Sie den Datensatz hoch, der zeigt, dass der Lizenzschlüssel von der Kundin oder dem Kunden aktiviert wurde.'),
  -- Template 8, section 3
  ('b0000000-0008-0000-0000-000000000003', 'refund_policy', 'de', 'Digitale Liefer- / Rückerstattungsrichtlinie', 'Veröffentlichter Snapshot der Rückerstattungsrichtlinie aus dem Händler-Shop (deckt nicht erstattbare Bedingungen für digitale Güter ab, sofern zutreffend).'),

  -- Template 9, section 1
  ('b0000000-0009-0000-0000-000000000001', 'refund_policy', 'de', 'Rückerstattungs- / Rückgaberichtlinie', 'Veröffentlichter Snapshot der Rückerstattungsrichtlinie aus dem Händler-Shop.'),
  ('b0000000-0009-0000-0000-000000000001', 'cancellation_policy', 'de', 'Kündigungsrichtlinie', 'Veröffentlichter Snapshot der Kündigungsrichtlinie aus dem Händler-Shop.'),
  ('b0000000-0009-0000-0000-000000000001', 'shipping_policy', 'de', 'Versandrichtlinie', 'Veröffentlichter Snapshot der Versandrichtlinie aus dem Händler-Shop.'),
  -- Template 9, section 2
  ('b0000000-0009-0000-0000-000000000002', 'checkout_terms', 'de', 'Nachweis der Akzeptanz im Checkout', 'Laden Sie einen Screenshot oder ein Protokoll hoch, das zeigt, dass die Kundin oder der Kunde den Bedingungen im Checkout zugestimmt hat.'),
  ('b0000000-0009-0000-0000-000000000002', 'terms_of_service', 'de', 'Nutzungsbedingungen', 'Laden Sie das vollständige ToS-Dokument hoch, dem die Kundin oder der Kunde zugestimmt hat.'),

  -- Template 10, section 1
  ('b0000000-0010-0000-0000-000000000001', 'order_confirmation', 'de', 'Bestellbestätigung', 'Bestelldetails, Positionen und Kundendaten aus der Shopify-Bestellung.'),
  -- Template 10, section 2
  ('b0000000-0010-0000-0000-000000000002', 'shipping_tracking', 'de', 'Sendungsverfolgung (sofern zutreffend)', 'Sendungsverfolgung des Versanddienstleisters aus dem Shopify-Fulfillment, sofern die Bestellung versendet wurde.'),
  ('b0000000-0010-0000-0000-000000000002', 'delivery_proof', 'de', 'Zustellbestätigung', 'Zustellstatus des Versanddienstleisters aus dem Shopify-Fulfillment, sofern verfügbar.'),
  -- Template 10, section 3
  ('b0000000-0010-0000-0000-000000000003', 'refund_policy', 'de', 'Rückerstattungsrichtlinie', 'Veröffentlichter Snapshot der Rückerstattungsrichtlinie aus dem Händler-Shop.'),
  ('b0000000-0010-0000-0000-000000000003', 'shipping_policy', 'de', 'Versandrichtlinie', 'Veröffentlichter Snapshot der Versandrichtlinie aus dem Händler-Shop.'),
  ('b0000000-0010-0000-0000-000000000003', 'cancellation_policy', 'de', 'Kündigungsrichtlinie', 'Veröffentlichter Snapshot der Kündigungsrichtlinie aus dem Händler-Shop.'),
  -- Template 10, section 4
  ('b0000000-0010-0000-0000-000000000004', 'customer_communication', 'de', 'Kundenkorrespondenz', 'Von Shopify erfasste Nachrichten und Bestellnotizen.'),
  ('b0000000-0010-0000-0000-000000000004', 'additional_context', 'de', 'Zusätzlicher Kontext oder Nachweis', 'Fügen Sie weitere relevante Notizen hinzu oder laden Sie ergänzende Dateien hoch, die Ihren Fall stützen.'),

  -- Template 11
  ('b0000000-0011-0000-0000-000000000001', 'order_confirmation', 'de', 'Bestellbestätigung', 'Kurze Bestellzusammenfassung, die zeigt, dass die Belastung legitim ist.'),
  ('b0000000-0011-0000-0000-000000000001', 'customer_account_info', 'de', 'Kundenhistorie', 'Notieren Sie, ob es sich um eine Stammkundin oder einen Stammkunden in gutem Stand handelt.'),
  -- Template 12
  ('b0000000-0012-0000-0000-000000000001', 'tracking_number', 'de', 'Sendungsstatus', 'Aktueller Sendungsverfolgungsstatus des Versanddienstleisters.'),
  ('b0000000-0012-0000-0000-000000000001', 'order_confirmation', 'de', 'Bestell- und Versand-Zeitleiste', 'Bestelldatum und Zeitpunkt des Versands.'),
  ('b0000000-0012-0000-0000-000000000001', 'customer_emails', 'de', 'Versandbenachrichtigung', 'An die Kundin oder den Kunden gesendete Versandbestätigung.'),
  -- Template 13
  ('b0000000-0013-0000-0000-000000000001', 'order_confirmation', 'de', 'Bestellzusammenfassung', 'Bestellzusammenfassung mit dem Produktnamen, den die Kundin oder der Kunde gekauft hat.'),
  ('b0000000-0013-0000-0000-000000000001', 'product_description', 'de', 'Produktbeschreibung', 'Beschreibung, die die Kundin oder der Kunde zum Kaufzeitpunkt gesehen hat.'),
  ('b0000000-0013-0000-0000-000000000001', 'return_offered_note', 'de', 'Rückgabe angeboten', 'Vermerken Sie jede angebotene Rückgabe oder jeden Umtausch.'),
  -- Template 14
  ('b0000000-0014-0000-0000-000000000001', 'signup_confirmation', 'de', 'Anmeldebestätigung', 'Wann und wie die Kundin oder der Kunde sich angemeldet hat.'),
  ('b0000000-0014-0000-0000-000000000001', 'usage_activity', 'de', 'Letzte Aktivität', 'Letzter Login oder letzte Nutzung des Dienstes, sofern zutreffend.'),
  ('b0000000-0014-0000-0000-000000000001', 'cancellation_status_note', 'de', 'Kündigungsstatus', 'Ob und wann eine Kündigungsanfrage eingegangen ist.'),
  -- Template 15
  ('b0000000-0015-0000-0000-000000000001', 'processing_timeline_note', 'de', 'Rückerstattungsstatus', 'Aktueller Status: verarbeitet, ausstehend oder nicht zutreffend.'),
  ('b0000000-0015-0000-0000-000000000001', 'refund_policy', 'de', 'Zusammenfassung der Rückerstattungsrichtlinie', 'Kurze Notiz zu Ihrer Rückerstattungsrichtlinie.'),
  ('b0000000-0015-0000-0000-000000000001', 'customer_emails', 'de', 'Kundenkorrespondenz', 'Aktuelle Nachrichten mit der Kundin oder dem Kunden zur Rückerstattung.'),
  -- Template 16
  ('b0000000-0016-0000-0000-000000000001', 'payment_records', 'de', 'Transaktionsliste', 'Alle Belastungen zu dieser Bestellung, die zeigen, dass jede eigenständig ist.'),
  ('b0000000-0016-0000-0000-000000000001', 'order_itemization', 'de', 'Bestellaufstellung', 'Positionen und Gesamtsumme der betreffenden Belastung.'),
  -- Template 17
  ('b0000000-0017-0000-0000-000000000001', 'relevant_policy', 'de', 'Relevante Richtlinie', 'Die für diese Frage am ehesten anwendbare Richtlinie.'),
  ('b0000000-0017-0000-0000-000000000001', 'terms_acceptance', 'de', 'Akzeptanz durch die Kundin oder den Kunden', 'Nachweis, dass die Kundin oder der Kunde dieser Richtlinie im Checkout zugestimmt hat.'),
  -- Template 18
  ('b0000000-0018-0000-0000-000000000001', 'order_confirmation', 'de', 'Bestellzusammenfassung', 'Kurze Bestellzusammenfassung.'),
  ('b0000000-0018-0000-0000-000000000001', 'additional_context', 'de', 'Zusätzlicher Kontext', 'Weitere für diese Frage relevante Informationen.')
) AS v(template_section_id, key, locale, label, guidance)
  ON pti.template_section_id = v.template_section_id::uuid AND pti.key = v.key
ON CONFLICT (template_item_id, locale) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════
-- SPANISH (es) — templates
-- ═══════════════════════════════════════════════════════════════════════

INSERT INTO pack_template_i18n (template_id, locale, name, short_description, works_best_for, preview_note) VALUES
('a0000000-0000-0000-0000-000000000001', 'es',
 'Fraude / No autorizado — Estándar',
 'Recopila todas las señales de autenticación y de pedido que v2 puede leer desde Shopify: AVS/CVV, 3-D Secure (cuando está disponible), análisis de fraude de Shopify, ubicación IP, coincidencia entre dirección de facturación y envío, historial de cliente recurrente y correspondencia con el cliente. La evidencia de envío se incluye si el pedido fue enviado.',
 'Contracargos en los que el titular de la tarjeta afirma no haber autorizado la transacción.',
 'Se recopila automáticamente desde Shopify y los datos de pago — no se requiere carga del comerciante.'),
('a0000000-0000-0000-0000-000000000002', 'es',
 'Producto no recibido — Con seguimiento',
 'Paquete de evidencia sólido para casos de PNR cuando Shopify dispone de seguimiento del transportista. Recopila la confirmación del pedido, el estado del seguimiento y la confirmación de entrega (con firma o foto cuando el transportista las proporciona) directamente desde Shopify.',
 'Casos en los que el cliente afirma no haber recibido el pedido pero el seguimiento muestra una entrega exitosa.',
 'Funciona mejor cuando los datos de envío de Shopify muestran que el pedido fue entregado.'),
('a0000000-0000-0000-0000-000000000003', 'es',
 'Producto no recibido — Sin seguimiento / Prueba débil',
 'Para casos de PNR en los que el seguimiento no está disponible desde Shopify. Recopila automáticamente capturas del pedido y de las políticas y pide al comerciante que cargue cualquier etiqueta de envío, seguimiento parcial o nota de contexto.',
 'Casos de PNR con documentación de envío ausente o limitada.',
 'Úselo cuando Shopify no tenga seguimiento — usted cargará lo que tenga.'),
('a0000000-0000-0000-0000-000000000004', 'es',
 'Producto inaceptable / No conforme a la descripción — Problemas de calidad',
 'Para casos que alegan que el producto no coincide con su descripción. Recopila detalles del pedido, captura de la política de reembolso y correspondencia con el cliente desde Shopify; pide al comerciante que cargue fotos del producto y capturas del anuncio que demuestren que la publicación era precisa.',
 'Casos en los que los clientes afirman que el producto difiere de lo que se anunció.',
 NULL),
('a0000000-0000-0000-0000-000000000005', 'es',
 'Suscripción cancelada — Integral',
 'Para casos de suscripción. Recopila automáticamente el pedido del cargo en disputa, capturas de las políticas de cancelación y reembolso y cualquier correspondencia de Shopify; pide al comerciante que cargue los términos de la suscripción, registros de uso, avisos de renovación y una nota sobre el estado de la cancelación, ya que ninguno de estos elementos cuenta con un recopilador de Shopify.',
 'Casos con cargos recurrentes después de que el cliente afirma haber cancelado su suscripción.',
 NULL),
('a0000000-0000-0000-0000-000000000006', 'es',
 'Reembolso / Crédito no procesado — Estándar',
 'Para casos en los que se alega que no se ha emitido un reembolso prometido. Recopila automáticamente el pedido, el registro de reembolso de Shopify (order.refunds), la captura de la política de reembolso y cualquier correspondencia de Shopify; pide al comerciante un comprobante de crédito externo solo cuando el crédito se emitió fuera de Shopify.',
 'Casos en los que el cliente afirma que se le prometió un reembolso pero no lo recibió.',
 NULL),
('a0000000-0000-0000-0000-000000000007', 'es',
 'Cargo duplicado / Importe incorrecto',
 'Para casos que alegan cargo duplicado o importe facturado incorrecto. Recopila automáticamente el pedido de Shopify y su detalle por artículo; pide al comerciante que cargue registros externos de la pasarela o facturas separadas, ya que DisputeDesk no extrae los registros en bruto de la pasarela de pago.',
 'Casos que alegan doble cargo o importe facturado erróneo.',
 NULL),
('a0000000-0000-0000-0000-000000000008', 'es',
 'Bienes digitales / Servicio entregado',
 'Para casos sobre productos o servicios digitales. Recopila el pedido y la captura de la política de reembolso desde Shopify; pide al comerciante que cargue los correos de entrega, registros de acceso y constancias de activación de licencia, ya que ninguno de estos elementos cuenta con un recopilador de Shopify.',
 'Casos relacionados con descargas digitales, acceso a SaaS o servicios en línea.',
 NULL),
('a0000000-0000-0000-0000-000000000009', 'es',
 'Basado en políticas (Devoluciones / Cancelación / Envío)',
 'Para casos en los que su defensa más sólida son políticas claras y publicadas. Recopila automáticamente capturas de las políticas de reembolso, cancelación y envío de la tienda; pide al comerciante que cargue la prueba de aceptación cuando sea necesario.',
 'Casos en los que las políticas del comerciante respaldan claramente el cargo y fueron aceptadas por el cliente.',
 NULL),
('a0000000-0000-0000-0000-000000000010', 'es',
 'General — Comodín',
 'Paquete flexible para tipos de caso que no encajan en una plantilla específica. Recopila automáticamente el pedido, los datos de envío o cumplimiento disponibles en Shopify, capturas de las políticas de la tienda y la correspondencia de Shopify; el comerciante puede añadir una nota de contexto adicional cuando lo necesite.',
 'Cualquier tipo de caso para el que no exista una plantilla más específica.',
 NULL),
('a0000000-0000-0000-0000-000000000011', 'es',
 'Fraude / No autorizado — Consulta',
 'Paquete de respuesta ligero para consultas de fraude y cargos no reconocidos. Busca confirmar con evidencia mínima que el cargo fue legítimo para que la consulta se cierre sin escalar.',
 'Consultas previas al contracargo en las que el titular cuestiona si autorizó el cargo.',
 NULL),
('a0000000-0000-0000-0000-000000000012', 'es',
 'Producto no recibido — Consulta',
 'Respuesta rápida sobre el estado del envío para consultas previas al contracargo. Un número de seguimiento y una confirmación de entrega suelen ser suficientes para cerrar la pregunta.',
 'El cliente informa a su banco de que no ha recibido el pedido antes de escalar a un contracargo.',
 NULL),
('a0000000-0000-0000-0000-000000000013', 'es',
 'Producto inaceptable — Consulta',
 'Respuesta breve para consultas sobre calidad o "no conforme a la descripción". Se centra en lo que el cliente compró y en cualquier oferta de devolución que usted haya hecho.',
 'Fase de reclamación en la que una conversación completa de devolución o reembolso puede resolver la situación.',
 NULL),
('a0000000-0000-0000-0000-000000000014', 'es',
 'Suscripción cancelada — Consulta',
 'Respuesta breve sobre el estado de la suscripción. Confirma si el cliente sigue activo o ha cancelado y cuándo se produjo el cargo más reciente.',
 'Consulta sobre cargos recurrentes antes de que se presente formalmente un contracargo.',
 NULL),
('a0000000-0000-0000-0000-000000000015', 'es',
 'Reembolso / Crédito no procesado — Consulta',
 'Respuesta rápida sobre el estado del reembolso. Indica al banco si un reembolso está en curso, ya procesado o no corresponde.',
 'El cliente afirma que se prometió un reembolso pero no se ha recibido — habitualmente una cuestión contable.',
 NULL),
('a0000000-0000-0000-0000-000000000016', 'es',
 'Cargo duplicado / Importe incorrecto — Consulta',
 'Respuesta breve con los registros de transacciones que muestran que cada cargo es distinto o que detallan el importe en disputa.',
 'El cliente cuestiona si se le ha cobrado dos veces o si se le ha facturado un importe incorrecto.',
 NULL),
('a0000000-0000-0000-0000-000000000017', 'es',
 'Basado en políticas — Consulta',
 'Respuesta ligera basada en políticas. Muestra la política más relevante que el cliente aceptó en el momento del pago.',
 'Consultas en las que una política clara y publicada responde directamente a la pregunta.',
 NULL),
('a0000000-0000-0000-0000-000000000018', 'es',
 'General — Consulta',
 'Respuesta comodín mínima para consultas que no encajan en una plantilla específica. Un resumen del pedido junto con cualquier contexto de texto libre.',
 'Cualquier consulta no cubierta por una plantilla más específica.',
 NULL)
ON CONFLICT (template_id, locale) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════
-- SPANISH (es) — section titles
-- ═══════════════════════════════════════════════════════════════════════

INSERT INTO pack_template_section_i18n (template_section_id, locale, title) VALUES
-- Template 1
('b0000000-0001-0000-0000-000000000001', 'es', 'Autenticación del pago'),
('b0000000-0001-0000-0000-000000000002', 'es', 'Contexto del pedido'),
('b0000000-0001-0000-0000-000000000003', 'es', 'Historial del cliente'),
('b0000000-0001-0000-0000-000000000004', 'es', 'Entrega, si se envió'),
-- Template 2
('b0000000-0002-0000-0000-000000000001', 'es', 'Datos del pedido'),
('b0000000-0002-0000-0000-000000000002', 'es', 'Envío y seguimiento'),
('b0000000-0002-0000-0000-000000000003', 'es', 'Confirmación de entrega'),
('b0000000-0002-0000-0000-000000000004', 'es', 'Comunicación con el cliente'),
-- Template 3
('b0000000-0003-0000-0000-000000000001', 'es', 'Datos del pedido'),
('b0000000-0003-0000-0000-000000000002', 'es', 'Evidencia de envío disponible'),
('b0000000-0003-0000-0000-000000000003', 'es', 'Políticas y condiciones'),
-- Template 4
('b0000000-0004-0000-0000-000000000001', 'es', 'Datos del pedido'),
('b0000000-0004-0000-0000-000000000002', 'es', 'Evidencia del producto'),
('b0000000-0004-0000-0000-000000000003', 'es', 'Política de devoluciones y reembolsos'),
('b0000000-0004-0000-0000-000000000004', 'es', 'Comunicación con el cliente'),
-- Template 5
('b0000000-0005-0000-0000-000000000001', 'es', 'Datos del pedido'),
('b0000000-0005-0000-0000-000000000002', 'es', 'Evidencia de la suscripción'),
('b0000000-0005-0000-0000-000000000003', 'es', 'Políticas y condiciones'),
('b0000000-0005-0000-0000-000000000004', 'es', 'Comunicación con el cliente'),
-- Template 6
('b0000000-0006-0000-0000-000000000001', 'es', 'Datos del pedido'),
('b0000000-0006-0000-0000-000000000002', 'es', 'Registro del reembolso'),
('b0000000-0006-0000-0000-000000000003', 'es', 'Política de reembolso'),
('b0000000-0006-0000-0000-000000000004', 'es', 'Comunicación con el cliente'),
-- Template 7
('b0000000-0007-0000-0000-000000000001', 'es', 'Datos del pedido'),
('b0000000-0007-0000-0000-000000000002', 'es', 'Registros externos de transacción'),
-- Template 8
('b0000000-0008-0000-0000-000000000001', 'es', 'Datos del pedido'),
('b0000000-0008-0000-0000-000000000002', 'es', 'Evidencia de entrega y acceso'),
('b0000000-0008-0000-0000-000000000003', 'es', 'Condiciones y políticas'),
-- Template 9
('b0000000-0009-0000-0000-000000000001', 'es', 'Políticas de la tienda'),
('b0000000-0009-0000-0000-000000000002', 'es', 'Aceptación por el cliente'),
-- Template 10
('b0000000-0010-0000-0000-000000000001', 'es', 'Datos del pedido'),
('b0000000-0010-0000-0000-000000000002', 'es', 'Envío y entrega'),
('b0000000-0010-0000-0000-000000000003', 'es', 'Políticas y condiciones'),
('b0000000-0010-0000-0000-000000000004', 'es', 'Comunicación con el cliente'),
-- Template 11
('b0000000-0011-0000-0000-000000000001', 'es', 'Verificación de la transacción'),
-- Template 12
('b0000000-0012-0000-0000-000000000001', 'es', 'Estado del envío'),
-- Template 13
('b0000000-0013-0000-0000-000000000001', 'es', 'Información del producto'),
-- Template 14
('b0000000-0014-0000-0000-000000000001', 'es', 'Estado de la suscripción'),
-- Template 15
('b0000000-0015-0000-0000-000000000001', 'es', 'Estado del reembolso'),
-- Template 16
('b0000000-0016-0000-0000-000000000001', 'es', 'Registros de transacciones'),
-- Template 17
('b0000000-0017-0000-0000-000000000001', 'es', 'Política aplicable'),
-- Template 18
('b0000000-0018-0000-0000-000000000001', 'es', 'Resumen del pedido')
ON CONFLICT (template_section_id, locale) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════
-- SPANISH (es) — item labels + guidance
-- ═══════════════════════════════════════════════════════════════════════

INSERT INTO pack_template_item_i18n (template_item_id, locale, label, guidance)
SELECT pti.id, v.locale, v.label, v.guidance
FROM pack_template_items pti
JOIN (VALUES
  -- Template 1, section 1
  ('b0000000-0001-0000-0000-000000000001', 'avs_cvv_match', 'es', 'Verificación AVS/CVV', 'Códigos de coincidencia de dirección y CVV de la autorización del pago, leídos desde el pedido de Shopify.'),
  ('b0000000-0001-0000-0000-000000000001', 'tds_authentication', 'es', 'Autenticación 3-D Secure, si está disponible', 'Cuando Shopify Payments expone un resultado de 3-D Secure en el recibo, lo incluimos. No todas las pasarelas lo exponen.'),
  ('b0000000-0001-0000-0000-000000000001', 'fraud_risk_screening', 'es', 'Análisis de fraude de Shopify', 'Evaluación de riesgo previa a la autorización que Shopify hace de este pedido.'),
  -- Template 1, section 2
  ('b0000000-0001-0000-0000-000000000002', 'order_confirmation', 'es', 'Confirmación del pedido', 'Número de pedido, fecha, artículos, totales y datos del cliente del pedido de Shopify.'),
  ('b0000000-0001-0000-0000-000000000002', 'billing_address_match', 'es', 'Coincidencia entre dirección de facturación y envío', 'Compara las direcciones de facturación y envío del pedido de Shopify a nivel de ciudad y país.'),
  ('b0000000-0001-0000-0000-000000000002', 'ip_location_check', 'es', 'Ubicación IP frente al país de facturación', 'Resuelve la IP del proceso de pago a una región y la compara con el país de facturación.'),
  -- Template 1, section 3
  ('b0000000-0001-0000-0000-000000000003', 'customer_account_info', 'es', 'Señal de cliente recurrente', 'Indica si el cliente tiene pedidos anteriores en esta tienda. Suma peso cuando existe.'),
  ('b0000000-0001-0000-0000-000000000003', 'customer_communication', 'es', 'Correspondencia del cliente desde la línea de tiempo o notas de Shopify', 'Cualquier mensaje, nota de pedido o atributo del comprador capturado por Shopify.'),
  -- Template 1, section 4
  ('b0000000-0001-0000-0000-000000000004', 'shipping_tracking', 'es', 'Seguimiento del envío', 'Seguimiento del transportista desde el cumplimiento de Shopify, si el pedido fue enviado.'),
  ('b0000000-0001-0000-0000-000000000004', 'delivery_proof', 'es', 'Firma o foto de entrega', 'Confirmación de firma o foto de entrega del transportista, cuando este la proporciona.'),

  -- Template 2, section 1
  ('b0000000-0002-0000-0000-000000000001', 'order_confirmation', 'es', 'Confirmación del pedido', 'Número de pedido, fecha, artículos y dirección de envío del pedido de Shopify.'),
  -- Template 2, section 2
  ('b0000000-0002-0000-0000-000000000002', 'shipping_tracking', 'es', 'Estado del seguimiento del envío', 'Número de seguimiento y estado actual del cumplimiento de Shopify.'),
  -- Template 2, section 3
  ('b0000000-0002-0000-0000-000000000003', 'delivery_proof', 'es', 'Confirmación de entrega', 'Estado de entrega informado por el transportista (y firma o foto cuando estén disponibles) desde el cumplimiento de Shopify.'),
  -- Template 2, section 4
  ('b0000000-0002-0000-0000-000000000004', 'customer_communication', 'es', 'Correspondencia con el cliente', 'Mensajes posteriores a la compra y notas del pedido capturados por Shopify.'),

  -- Template 3, section 1
  ('b0000000-0003-0000-0000-000000000001', 'order_confirmation', 'es', 'Confirmación del pedido', 'Número de pedido, fecha, artículos y direcciones del pedido de Shopify.'),
  -- Template 3, section 2
  ('b0000000-0003-0000-0000-000000000002', 'shipping_receipt', 'es', 'Recibo o etiqueta de envío', 'Cargue cualquier etiqueta de envío, recibo o manifiesto de cumplimiento que tenga fuera de Shopify.'),
  ('b0000000-0003-0000-0000-000000000002', 'partial_tracking', 'es', 'Datos parciales de seguimiento (si existen)', 'Cargue cualquier escaneo del transportista o prueba de entrega de paquete, aunque sea incompleta.'),
  ('b0000000-0003-0000-0000-000000000002', 'shipping_method_note', 'es', 'Nota: explique el método de envío utilizado', 'Describa el método de envío y por qué puede no haber seguimiento completo disponible.'),
  -- Template 3, section 3
  ('b0000000-0003-0000-0000-000000000003', 'shipping_policy', 'es', 'Política de envío', 'Captura publicada de la política de envío de la tienda.'),
  ('b0000000-0003-0000-0000-000000000003', 'refund_policy', 'es', 'Política de reembolso', 'Captura publicada de la política de reembolso de la tienda.'),

  -- Template 4, section 1
  ('b0000000-0004-0000-0000-000000000001', 'order_confirmation', 'es', 'Confirmación del pedido', 'Detalles del pedido, artículos y título del producto del pedido de Shopify.'),
  -- Template 4, section 2
  ('b0000000-0004-0000-0000-000000000002', 'product_page_screenshot', 'es', 'Captura de pantalla de la página del producto', 'Cargue una captura del anuncio del producto tal como aparecía en el momento de la compra.'),
  ('b0000000-0004-0000-0000-000000000002', 'product_photos', 'es', 'Fotografías del producto', 'Cargue fotografías del producto realmente enviado (imágenes de control de calidad).'),
  -- Template 4, section 3
  ('b0000000-0004-0000-0000-000000000003', 'refund_policy', 'es', 'Política de devolución o reembolso', 'Captura publicada de la política de reembolso de la tienda.'),
  ('b0000000-0004-0000-0000-000000000003', 'return_offered_note', 'es', 'Nota: ¿se ofreció devolución o cambio?', 'Documente si ofreció devolución, cambio o reembolso parcial.'),
  -- Template 4, section 4
  ('b0000000-0004-0000-0000-000000000004', 'customer_communication', 'es', 'Correspondencia con el cliente', 'Mensajes y notas del pedido sobre la queja de calidad, desde Shopify.'),

  -- Template 5, section 1
  ('b0000000-0005-0000-0000-000000000001', 'order_confirmation', 'es', 'Confirmación del pedido', 'Registro del pedido del cargo en disputa, desde el pedido de Shopify.'),
  -- Template 5, section 2
  ('b0000000-0005-0000-0000-000000000002', 'subscription_agreement', 'es', 'Acuerdo o condiciones de la suscripción', 'Cargue las condiciones que el cliente aceptó al registrarse, incluyendo el ciclo de facturación y la política de cancelación.'),
  ('b0000000-0005-0000-0000-000000000002', 'usage_logs', 'es', 'Registros de uso del servicio', 'Cargue evidencia de que el cliente usó el servicio o producto después de la fecha del cargo en disputa.'),
  ('b0000000-0005-0000-0000-000000000002', 'renewal_notifications', 'es', 'Correos de aviso de renovación', 'Cargue los correos enviados antes de la renovación recordando al cliente los próximos cargos.'),
  ('b0000000-0005-0000-0000-000000000002', 'cancellation_status_note', 'es', 'Nota: estado de la solicitud de cancelación', 'Documente si se recibió una cancelación y cuándo, o que no se presentó ninguna cancelación.'),
  -- Template 5, section 3
  ('b0000000-0005-0000-0000-000000000003', 'cancellation_policy', 'es', 'Política de cancelación', 'Captura publicada de la política de cancelación de la tienda.'),
  ('b0000000-0005-0000-0000-000000000003', 'refund_policy', 'es', 'Política de reembolso', 'Captura publicada de la política de reembolso de la tienda.'),
  -- Template 5, section 4
  ('b0000000-0005-0000-0000-000000000004', 'customer_communication', 'es', 'Correspondencia con el cliente', 'Mensajes y notas del pedido sobre la cancelación, desde Shopify.'),

  -- Template 6, section 1
  ('b0000000-0006-0000-0000-000000000001', 'order_confirmation', 'es', 'Confirmación del pedido', 'Detalles del pedido y totales del pedido de Shopify.'),
  -- Template 6, section 2
  ('b0000000-0006-0000-0000-000000000002', 'refund_record', 'es', 'Registro de reembolso de Shopify', 'Historial de reembolsos incrustado en el pedido de Shopify (fecha, importe, nota) — si existe un reembolso en el pedido, lo incluimos.'),
  ('b0000000-0006-0000-0000-000000000002', 'credit_statement', 'es', 'Registro de crédito externo / crédito en tienda', 'Cargue el comprobante de cualquier crédito emitido fuera de Shopify (crédito en tienda, tarjeta regalo, crédito fuera de la plataforma).'),
  ('b0000000-0006-0000-0000-000000000002', 'processing_timeline_note', 'es', 'Nota: plazo de procesamiento del reembolso', 'Explique el tiempo habitual de procesamiento del reembolso y si el caso está dentro de esa ventana.'),
  -- Template 6, section 3
  ('b0000000-0006-0000-0000-000000000003', 'refund_policy', 'es', 'Política de reembolso o devolución', 'Captura publicada de la política de reembolso de la tienda.'),
  -- Template 6, section 4
  ('b0000000-0006-0000-0000-000000000004', 'customer_communication', 'es', 'Correspondencia con el cliente sobre el reembolso', 'Mensajes y notas del pedido relacionados con el reembolso, desde Shopify.'),

  -- Template 7, section 1
  ('b0000000-0007-0000-0000-000000000001', 'order_confirmation', 'es', 'Confirmación del pedido', 'Detalles del pedido, totales y fecha de creación del pedido de Shopify.'),
  ('b0000000-0007-0000-0000-000000000001', 'order_itemization', 'es', 'Detalle por artículo del pedido', 'Desglose línea por línea que muestra lo que cubre el importe, desde el pedido de Shopify.'),
  -- Template 7, section 2
  ('b0000000-0007-0000-0000-000000000002', 'payment_records', 'es', 'Registro externo de la pasarela de pago', 'Cargue registros de la pasarela que muestren que cada cargo es distinto (no obtenemos los registros de la pasarela automáticamente).'),
  ('b0000000-0007-0000-0000-000000000002', 'invoice_receipts', 'es', 'Facturas separadas por cada cargo', 'Cargue facturas separadas que prueben que cada cargo corresponde a un pedido o artículo distinto.'),
  ('b0000000-0007-0000-0000-000000000002', 'auth_vs_capture_note', 'es', 'Nota: autorización frente a captura', 'Explique si la duplicación aparente es una retención de autorización en lugar de un cargo real.'),

  -- Template 8, section 1
  ('b0000000-0008-0000-0000-000000000001', 'order_confirmation', 'es', 'Confirmación del pedido', 'Detalles del pedido del pedido de Shopify.'),
  -- Template 8, section 2
  ('b0000000-0008-0000-0000-000000000002', 'download_link_email', 'es', 'Correo con enlace de descarga / acceso', 'Cargue el correo enviado al cliente que contiene los enlaces de descarga o las credenciales de acceso.'),
  ('b0000000-0008-0000-0000-000000000002', 'access_logs', 'es', 'Registros de acceso o descarga', 'Cargue registros del servidor que muestren que el cliente accedió o descargó el producto digital.'),
  ('b0000000-0008-0000-0000-000000000002', 'license_activation', 'es', 'Registro de activación de la clave de licencia', 'Cargue el registro que muestre que la clave de licencia fue activada por el cliente.'),
  -- Template 8, section 3
  ('b0000000-0008-0000-0000-000000000003', 'refund_policy', 'es', 'Política de entrega digital o reembolso', 'Captura publicada de la política de reembolso de la tienda (cubre las condiciones de no reembolso de bienes digitales cuando aplique).'),

  -- Template 9, section 1
  ('b0000000-0009-0000-0000-000000000001', 'refund_policy', 'es', 'Política de reembolso o devolución', 'Captura publicada de la política de reembolso de la tienda.'),
  ('b0000000-0009-0000-0000-000000000001', 'cancellation_policy', 'es', 'Política de cancelación', 'Captura publicada de la política de cancelación de la tienda.'),
  ('b0000000-0009-0000-0000-000000000001', 'shipping_policy', 'es', 'Política de envío', 'Captura publicada de la política de envío de la tienda.'),
  -- Template 9, section 2
  ('b0000000-0009-0000-0000-000000000002', 'checkout_terms', 'es', 'Prueba de aceptación de términos en el pago', 'Cargue una captura o registro que muestre que el cliente aceptó los términos al pagar.'),
  ('b0000000-0009-0000-0000-000000000002', 'terms_of_service', 'es', 'Términos del servicio', 'Cargue el documento completo de los Términos que el cliente aceptó.'),

  -- Template 10, section 1
  ('b0000000-0010-0000-0000-000000000001', 'order_confirmation', 'es', 'Confirmación del pedido', 'Detalles del pedido, artículos y datos del cliente del pedido de Shopify.'),
  -- Template 10, section 2
  ('b0000000-0010-0000-0000-000000000002', 'shipping_tracking', 'es', 'Seguimiento del envío (si aplica)', 'Seguimiento del transportista desde el cumplimiento de Shopify, si el pedido fue enviado.'),
  ('b0000000-0010-0000-0000-000000000002', 'delivery_proof', 'es', 'Confirmación de entrega', 'Estado de entrega del transportista desde el cumplimiento de Shopify, cuando esté disponible.'),
  -- Template 10, section 3
  ('b0000000-0010-0000-0000-000000000003', 'refund_policy', 'es', 'Política de reembolso', 'Captura publicada de la política de reembolso de la tienda.'),
  ('b0000000-0010-0000-0000-000000000003', 'shipping_policy', 'es', 'Política de envío', 'Captura publicada de la política de envío de la tienda.'),
  ('b0000000-0010-0000-0000-000000000003', 'cancellation_policy', 'es', 'Política de cancelación', 'Captura publicada de la política de cancelación de la tienda.'),
  -- Template 10, section 4
  ('b0000000-0010-0000-0000-000000000004', 'customer_communication', 'es', 'Correspondencia con el cliente', 'Mensajes y notas del pedido capturados por Shopify.'),
  ('b0000000-0010-0000-0000-000000000004', 'additional_context', 'es', 'Contexto o evidencia adicional', 'Añada cualquier otra nota relevante o cargue archivos adicionales que respalden su caso.'),

  -- Template 11
  ('b0000000-0011-0000-0000-000000000001', 'order_confirmation', 'es', 'Confirmación del pedido', 'Resumen breve del pedido que muestra que el cargo es legítimo.'),
  ('b0000000-0011-0000-0000-000000000001', 'customer_account_info', 'es', 'Historial del cliente', 'Indique si se trata de un cliente recurrente en buen estado.'),
  -- Template 12
  ('b0000000-0012-0000-0000-000000000001', 'tracking_number', 'es', 'Estado del seguimiento', 'Estado actual del seguimiento del transportista.'),
  ('b0000000-0012-0000-0000-000000000001', 'order_confirmation', 'es', 'Línea de tiempo del pedido y envío', 'Fecha del pedido y momento del envío.'),
  ('b0000000-0012-0000-0000-000000000001', 'customer_emails', 'es', 'Notificación de envío', 'Confirmación de envío enviada al cliente.'),
  -- Template 13
  ('b0000000-0013-0000-0000-000000000001', 'order_confirmation', 'es', 'Resumen del pedido', 'Resumen del pedido con el nombre del producto que compró el cliente.'),
  ('b0000000-0013-0000-0000-000000000001', 'product_description', 'es', 'Descripción del producto', 'Descripción que vio el cliente en el momento de la compra.'),
  ('b0000000-0013-0000-0000-000000000001', 'return_offered_note', 'es', 'Devolución ofrecida', 'Indique cualquier devolución o cambio que haya ofrecido.'),
  -- Template 14
  ('b0000000-0014-0000-0000-000000000001', 'signup_confirmation', 'es', 'Confirmación de registro', 'Cuándo y cómo se registró el cliente.'),
  ('b0000000-0014-0000-0000-000000000001', 'usage_activity', 'es', 'Actividad más reciente', 'Último inicio de sesión o uso del servicio, si aplica.'),
  ('b0000000-0014-0000-0000-000000000001', 'cancellation_status_note', 'es', 'Estado de la cancelación', 'Si se recibió una solicitud de cancelación y cuándo.'),
  -- Template 15
  ('b0000000-0015-0000-0000-000000000001', 'processing_timeline_note', 'es', 'Estado del reembolso', 'Estado actual: procesado, pendiente o no aplica.'),
  ('b0000000-0015-0000-0000-000000000001', 'refund_policy', 'es', 'Resumen de la política de reembolso', 'Nota breve sobre su política de reembolso.'),
  ('b0000000-0015-0000-0000-000000000001', 'customer_emails', 'es', 'Correspondencia con el cliente', 'Mensajes recientes con el cliente sobre el reembolso.'),
  -- Template 16
  ('b0000000-0016-0000-0000-000000000001', 'payment_records', 'es', 'Lista de transacciones', 'Todos los cargos de este pedido que muestran que cada uno es distinto.'),
  ('b0000000-0016-0000-0000-000000000001', 'order_itemization', 'es', 'Detalle del pedido', 'Artículos y total del cargo en cuestión.'),
  -- Template 17
  ('b0000000-0017-0000-0000-000000000001', 'relevant_policy', 'es', 'Política relevante', 'La política más aplicable a esta cuestión.'),
  ('b0000000-0017-0000-0000-000000000001', 'terms_acceptance', 'es', 'Aceptación por el cliente', 'Prueba de que el cliente aceptó esta política al pagar.'),
  -- Template 18
  ('b0000000-0018-0000-0000-000000000001', 'order_confirmation', 'es', 'Resumen del pedido', 'Resumen breve del pedido.'),
  ('b0000000-0018-0000-0000-000000000001', 'additional_context', 'es', 'Contexto adicional', 'Cualquier otra información relevante para esta cuestión.')
) AS v(template_section_id, key, locale, label, guidance)
  ON pti.template_section_id = v.template_section_id::uuid AND pti.key = v.key
ON CONFLICT (template_item_id, locale) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════
-- FRENCH (fr) — templates
-- ═══════════════════════════════════════════════════════════════════════

INSERT INTO pack_template_i18n (template_id, locale, name, short_description, works_best_for, preview_note) VALUES
('a0000000-0000-0000-0000-000000000001', 'fr',
 'Fraude / Non autorisé — Standard',
 'Collecte tous les signaux d''authentification et de commande que v2 peut lire depuis Shopify : AVS/CVV, 3-D Secure (lorsque disponible), filtrage anti-fraude Shopify, localisation IP, correspondance entre l''adresse de facturation et celle de livraison, historique de client récurrent et correspondance client. La preuve de livraison est incluse si la commande a été expédiée.',
 'Rétrofacturations dans lesquelles le titulaire de la carte affirme ne pas avoir autorisé la transaction.',
 'Collecté automatiquement depuis Shopify et les données de paiement — aucun téléchargement marchand requis.'),
('a0000000-0000-0000-0000-000000000002', 'fr',
 'Produit non reçu — Avec suivi',
 'Dossier de preuves solide pour les cas PNR lorsque Shopify dispose d''un suivi du transporteur. Collecte la confirmation de commande, le statut de suivi et la confirmation de livraison (avec signature ou photo lorsque le transporteur les fournit) directement depuis Shopify.',
 'Cas dans lesquels le client affirme la non-livraison alors que le suivi montre une livraison réussie.',
 'Optimal lorsque les données d''exécution Shopify montrent que la commande a été livrée.'),
('a0000000-0000-0000-0000-000000000003', 'fr',
 'Produit non reçu — Sans suivi / Preuve faible',
 'Pour les cas PNR pour lesquels le suivi n''est pas disponible depuis Shopify. Collecte automatiquement les instantanés de commande et de politiques, et demande au marchand de téléverser toute étiquette d''expédition, suivi partiel ou note de contexte.',
 'Cas PNR avec une documentation d''expédition manquante ou limitée.',
 'À utiliser lorsque Shopify ne dispose pas de suivi — vous téléverserez ce dont vous disposez.'),
('a0000000-0000-0000-0000-000000000004', 'fr',
 'Produit non conforme / Pas comme décrit — Problèmes de qualité',
 'Pour les cas affirmant que le produit ne correspond pas à sa description. Collecte les détails de la commande, l''instantané de la politique de remboursement et la correspondance client depuis Shopify ; demande au marchand de téléverser des photos du produit et des captures d''écran de l''annonce prouvant que cette dernière était exacte.',
 'Cas dans lesquels les clients affirment que le produit diffère de ce qui a été annoncé.',
 NULL),
('a0000000-0000-0000-0000-000000000005', 'fr',
 'Abonnement annulé — Complet',
 'Pour les cas d''abonnement. Collecte automatiquement la commande du débit contesté, les instantanés des politiques d''annulation et de remboursement ainsi que toute correspondance Shopify ; demande au marchand de téléverser les conditions d''abonnement, les journaux d''utilisation, les e-mails de renouvellement et une note sur l''état de l''annulation, car aucun de ces éléments n''est pris en charge par un collecteur Shopify.',
 'Cas de débits récurrents après que le client affirme avoir annulé son abonnement.',
 NULL),
('a0000000-0000-0000-0000-000000000006', 'fr',
 'Remboursement / Crédit non traité — Standard',
 'Pour les cas affirmant qu''un remboursement promis n''a pas été émis. Collecte automatiquement la commande, l''enregistrement de remboursement Shopify (order.refunds), l''instantané de la politique de remboursement et toute correspondance Shopify ; demande au marchand de téléverser une preuve de crédit externe uniquement lorsque ce crédit a été émis en dehors de Shopify.',
 'Cas dans lesquels le client affirme qu''un remboursement a été promis mais non reçu.',
 NULL),
('a0000000-0000-0000-0000-000000000007', 'fr',
 'Double facturation / Montant incorrect',
 'Pour les cas alléguant un double débit ou un montant facturé incorrect. Collecte automatiquement la commande Shopify et son détail par article ; demande au marchand de téléverser des journaux de passerelle externes ou des factures séparées, car DisputeDesk ne récupère pas les journaux bruts de la passerelle de paiement.',
 'Cas alléguant un double débit ou un montant facturé erroné.',
 NULL),
('a0000000-0000-0000-0000-000000000008', 'fr',
 'Biens numériques / Service rendu',
 'Pour les cas portant sur des produits ou services numériques. Collecte la commande et l''instantané de la politique de remboursement depuis Shopify ; demande au marchand de téléverser les e-mails de livraison, les journaux d''accès et les enregistrements d''activation de licence, car aucun de ces éléments n''est pris en charge par un collecteur Shopify.',
 'Cas concernant les téléchargements numériques, l''accès SaaS ou les services en ligne.',
 NULL),
('a0000000-0000-0000-0000-000000000009', 'fr',
 'Axé sur les politiques (Retours / Annulation / Expédition)',
 'Pour les cas dans lesquels votre meilleure défense réside dans des politiques claires et publiées. Collecte automatiquement les instantanés des politiques de remboursement, d''annulation et d''expédition de la boutique du marchand ; demande au marchand de téléverser une preuve d''acceptation lorsque cela est nécessaire.',
 'Cas dans lesquels les politiques du marchand soutiennent clairement le débit et ont été acceptées par le client.',
 NULL),
('a0000000-0000-0000-0000-000000000010', 'fr',
 'Général — Polyvalent',
 'Dossier flexible pour les types de cas qui n''entrent dans aucun modèle spécifique. Collecte automatiquement la commande, les données d''expédition/d''exécution disponibles dans Shopify, les instantanés des politiques de la boutique et la correspondance Shopify ; le marchand peut ajouter une note de contexte supplémentaire si nécessaire.',
 'Tout type de cas pour lequel un modèle plus spécifique n''est pas disponible.',
 NULL),
('a0000000-0000-0000-0000-000000000011', 'fr',
 'Fraude / Non autorisé — Demande préalable',
 'Dossier de réponse léger pour les demandes préalables liées à la fraude et aux débits non reconnus. Vise à confirmer, avec un minimum de preuves, que le débit était légitime afin que la demande se clôture sans escalade.',
 'Demandes pré-rétrofacturation dans lesquelles le titulaire de la carte se demande s''il a autorisé le débit.',
 NULL),
('a0000000-0000-0000-0000-000000000012', 'fr',
 'Produit non reçu — Demande préalable',
 'Réponse rapide sur le statut d''expédition pour les demandes PNR pré-rétrofacturation. Un numéro de suivi et une confirmation de livraison suffisent généralement à clôturer la question.',
 'Le client indique à sa banque qu''il n''a pas reçu la commande avant d''engager une rétrofacturation.',
 NULL),
('a0000000-0000-0000-0000-000000000013', 'fr',
 'Produit non acceptable — Demande préalable',
 'Réponse brève aux demandes portant sur la qualité ou « pas comme décrit ». Se concentre sur ce que le client a acheté et sur toute offre de retour que vous lui avez faite.',
 'Phase de réclamation dans laquelle une conversation complète sur le retour ou le remboursement peut résoudre la situation.',
 NULL),
('a0000000-0000-0000-0000-000000000014', 'fr',
 'Abonnement annulé — Demande préalable',
 'Réponse brève sur le statut de l''abonnement. Confirme si le client est toujours actif ou a annulé, ainsi que la date du dernier débit.',
 'Demande portant sur des débits récurrents avant l''ouverture formelle d''une rétrofacturation.',
 NULL),
('a0000000-0000-0000-0000-000000000015', 'fr',
 'Remboursement / Crédit non traité — Demande préalable',
 'Réponse rapide sur le statut du remboursement. Indique à la banque si un remboursement est en cours, déjà traité ou non dû.',
 'Le client affirme qu''un remboursement lui a été promis mais qu''il ne l''a pas reçu — il s''agit généralement d''une question comptable.',
 NULL),
('a0000000-0000-0000-0000-000000000016', 'fr',
 'Double facturation / Montant incorrect — Demande préalable',
 'Réponse brève avec les enregistrements de transactions montrant que chaque débit est distinct ou détaillant le montant contesté.',
 'Le client se demande s''il a été débité deux fois ou facturé d''un montant incorrect.',
 NULL),
('a0000000-0000-0000-0000-000000000017', 'fr',
 'Axé sur les politiques — Demande préalable',
 'Réponse légère fondée sur la politique. Met en avant la politique la plus pertinente que le client a acceptée lors du paiement.',
 'Demandes pour lesquelles une politique claire et publiée répond directement à la question.',
 NULL),
('a0000000-0000-0000-0000-000000000018', 'fr',
 'Général — Demande préalable',
 'Réponse polyvalente minimale pour les demandes qui n''entrent dans aucun modèle spécifique. Un résumé de commande et tout contexte au format libre.',
 'Toute demande non couverte par un modèle plus spécifique.',
 NULL)
ON CONFLICT (template_id, locale) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════
-- FRENCH (fr) — section titles
-- ═══════════════════════════════════════════════════════════════════════

INSERT INTO pack_template_section_i18n (template_section_id, locale, title) VALUES
-- Template 1
('b0000000-0001-0000-0000-000000000001', 'fr', 'Authentification du paiement'),
('b0000000-0001-0000-0000-000000000002', 'fr', 'Contexte de la commande'),
('b0000000-0001-0000-0000-000000000003', 'fr', 'Historique du client'),
('b0000000-0001-0000-0000-000000000004', 'fr', 'Livraison, si expédiée'),
-- Template 2
('b0000000-0002-0000-0000-000000000001', 'fr', 'Informations de la commande'),
('b0000000-0002-0000-0000-000000000002', 'fr', 'Expédition et suivi'),
('b0000000-0002-0000-0000-000000000003', 'fr', 'Confirmation de livraison'),
('b0000000-0002-0000-0000-000000000004', 'fr', 'Communication client'),
-- Template 3
('b0000000-0003-0000-0000-000000000001', 'fr', 'Informations de la commande'),
('b0000000-0003-0000-0000-000000000002', 'fr', 'Preuves d''expédition disponibles'),
('b0000000-0003-0000-0000-000000000003', 'fr', 'Politiques et conditions'),
-- Template 4
('b0000000-0004-0000-0000-000000000001', 'fr', 'Informations de la commande'),
('b0000000-0004-0000-0000-000000000002', 'fr', 'Preuves liées au produit'),
('b0000000-0004-0000-0000-000000000003', 'fr', 'Politique de retours et remboursements'),
('b0000000-0004-0000-0000-000000000004', 'fr', 'Communication client'),
-- Template 5
('b0000000-0005-0000-0000-000000000001', 'fr', 'Informations de la commande'),
('b0000000-0005-0000-0000-000000000002', 'fr', 'Preuves liées à l''abonnement'),
('b0000000-0005-0000-0000-000000000003', 'fr', 'Politiques et conditions'),
('b0000000-0005-0000-0000-000000000004', 'fr', 'Communication client'),
-- Template 6
('b0000000-0006-0000-0000-000000000001', 'fr', 'Informations de la commande'),
('b0000000-0006-0000-0000-000000000002', 'fr', 'Enregistrement du remboursement'),
('b0000000-0006-0000-0000-000000000003', 'fr', 'Politique de remboursement'),
('b0000000-0006-0000-0000-000000000004', 'fr', 'Communication client'),
-- Template 7
('b0000000-0007-0000-0000-000000000001', 'fr', 'Informations de la commande'),
('b0000000-0007-0000-0000-000000000002', 'fr', 'Enregistrements de transactions externes'),
-- Template 8
('b0000000-0008-0000-0000-000000000001', 'fr', 'Informations de la commande'),
('b0000000-0008-0000-0000-000000000002', 'fr', 'Preuves de livraison et d''accès'),
('b0000000-0008-0000-0000-000000000003', 'fr', 'Conditions et politiques'),
-- Template 9
('b0000000-0009-0000-0000-000000000001', 'fr', 'Politiques de la boutique'),
('b0000000-0009-0000-0000-000000000002', 'fr', 'Acceptation par le client'),
-- Template 10
('b0000000-0010-0000-0000-000000000001', 'fr', 'Informations de la commande'),
('b0000000-0010-0000-0000-000000000002', 'fr', 'Expédition et livraison'),
('b0000000-0010-0000-0000-000000000003', 'fr', 'Politiques et conditions'),
('b0000000-0010-0000-0000-000000000004', 'fr', 'Communication client'),
-- Template 11
('b0000000-0011-0000-0000-000000000001', 'fr', 'Vérification de la transaction'),
-- Template 12
('b0000000-0012-0000-0000-000000000001', 'fr', 'Statut d''expédition'),
-- Template 13
('b0000000-0013-0000-0000-000000000001', 'fr', 'Informations sur le produit'),
-- Template 14
('b0000000-0014-0000-0000-000000000001', 'fr', 'Statut de l''abonnement'),
-- Template 15
('b0000000-0015-0000-0000-000000000001', 'fr', 'Statut du remboursement'),
-- Template 16
('b0000000-0016-0000-0000-000000000001', 'fr', 'Enregistrements de transactions'),
-- Template 17
('b0000000-0017-0000-0000-000000000001', 'fr', 'Politique applicable'),
-- Template 18
('b0000000-0018-0000-0000-000000000001', 'fr', 'Résumé de la commande')
ON CONFLICT (template_section_id, locale) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════
-- FRENCH (fr) — item labels + guidance
-- ═══════════════════════════════════════════════════════════════════════

INSERT INTO pack_template_item_i18n (template_item_id, locale, label, guidance)
SELECT pti.id, v.locale, v.label, v.guidance
FROM pack_template_items pti
JOIN (VALUES
  -- Template 1, section 1
  ('b0000000-0001-0000-0000-000000000001', 'avs_cvv_match', 'fr', 'Vérification AVS/CVV', 'Codes de correspondance d''adresse et de CVV issus de l''autorisation du paiement, lus depuis la commande Shopify.'),
  ('b0000000-0001-0000-0000-000000000001', 'tds_authentication', 'fr', 'Authentification 3-D Secure, si disponible', 'Lorsque Shopify Payments expose un résultat 3-D Secure sur le reçu, nous l''incluons. Toutes les passerelles ne l''exposent pas.'),
  ('b0000000-0001-0000-0000-000000000001', 'fraud_risk_screening', 'fr', 'Filtrage anti-fraude Shopify', 'Évaluation des risques effectuée par Shopify avant l''autorisation pour cette commande.'),
  -- Template 1, section 2
  ('b0000000-0001-0000-0000-000000000002', 'order_confirmation', 'fr', 'Confirmation de commande', 'Numéro de commande, date, articles, totaux et coordonnées client issus de la commande Shopify.'),
  ('b0000000-0001-0000-0000-000000000002', 'billing_address_match', 'fr', 'Correspondance entre adresse de facturation et de livraison', 'Compare les adresses de facturation et de livraison de la commande Shopify au niveau de la ville et du pays.'),
  ('b0000000-0001-0000-0000-000000000002', 'ip_location_check', 'fr', 'Localisation IP par rapport au pays de facturation', 'Associe l''IP du paiement à une région et la compare au pays de facturation.'),
  -- Template 1, section 3
  ('b0000000-0001-0000-0000-000000000003', 'customer_account_info', 'fr', 'Signal de client récurrent', 'Indique si le client a déjà passé commande dans cette boutique. Renforce le dossier lorsque c''est le cas.'),
  ('b0000000-0001-0000-0000-000000000003', 'customer_communication', 'fr', 'Correspondance client depuis le fil ou les notes Shopify', 'Tous les messages, notes de commande ou attributs acheteur capturés par Shopify.'),
  -- Template 1, section 4
  ('b0000000-0001-0000-0000-000000000004', 'shipping_tracking', 'fr', 'Suivi de l''expédition', 'Suivi du transporteur issu de l''exécution Shopify, si la commande a été expédiée.'),
  ('b0000000-0001-0000-0000-000000000004', 'delivery_proof', 'fr', 'Signature ou photo de livraison', 'Confirmation de signature ou photo de livraison du transporteur, lorsque ce dernier les fournit.'),

  -- Template 2, section 1
  ('b0000000-0002-0000-0000-000000000001', 'order_confirmation', 'fr', 'Confirmation de commande', 'Numéro de commande, date, articles et adresse de livraison issus de la commande Shopify.'),
  -- Template 2, section 2
  ('b0000000-0002-0000-0000-000000000002', 'shipping_tracking', 'fr', 'Statut du suivi d''expédition', 'Numéro de suivi et statut actuel issus de l''exécution Shopify.'),
  -- Template 2, section 3
  ('b0000000-0002-0000-0000-000000000003', 'delivery_proof', 'fr', 'Confirmation de livraison', 'Statut de livraison communiqué par le transporteur (avec signature ou photo si disponibles) issu de l''exécution Shopify.'),
  -- Template 2, section 4
  ('b0000000-0002-0000-0000-000000000004', 'customer_communication', 'fr', 'Correspondance client', 'Messages et notes de commande post-achat capturés par Shopify.'),

  -- Template 3, section 1
  ('b0000000-0003-0000-0000-000000000001', 'order_confirmation', 'fr', 'Confirmation de commande', 'Numéro de commande, date, articles et adresses issus de la commande Shopify.'),
  -- Template 3, section 2
  ('b0000000-0003-0000-0000-000000000002', 'shipping_receipt', 'fr', 'Reçu ou étiquette d''expédition', 'Téléversez toute étiquette d''expédition, reçu ou manifeste d''exécution dont vous disposez en dehors de Shopify.'),
  ('b0000000-0003-0000-0000-000000000002', 'partial_tracking', 'fr', 'Données de suivi partielles (le cas échéant)', 'Téléversez tout scan transporteur ou preuve de remise, même incomplète.'),
  ('b0000000-0003-0000-0000-000000000002', 'shipping_method_note', 'fr', 'Note : expliquez la méthode d''expédition utilisée', 'Décrivez la méthode d''expédition et la raison pour laquelle le suivi complet peut être indisponible.'),
  -- Template 3, section 3
  ('b0000000-0003-0000-0000-000000000003', 'shipping_policy', 'fr', 'Politique d''expédition', 'Instantané publié de la politique d''expédition de la boutique.'),
  ('b0000000-0003-0000-0000-000000000003', 'refund_policy', 'fr', 'Politique de remboursement', 'Instantané publié de la politique de remboursement de la boutique.'),

  -- Template 4, section 1
  ('b0000000-0004-0000-0000-000000000001', 'order_confirmation', 'fr', 'Confirmation de commande', 'Détails de commande, articles et titre du produit issus de la commande Shopify.'),
  -- Template 4, section 2
  ('b0000000-0004-0000-0000-000000000002', 'product_page_screenshot', 'fr', 'Capture d''écran de la page produit', 'Téléversez une capture d''écran de la fiche produit telle qu''elle apparaissait au moment de l''achat.'),
  ('b0000000-0004-0000-0000-000000000002', 'product_photos', 'fr', 'Photographies du produit', 'Téléversez des photos du produit réellement expédié (images de contrôle qualité).'),
  -- Template 4, section 3
  ('b0000000-0004-0000-0000-000000000003', 'refund_policy', 'fr', 'Politique de retour ou de remboursement', 'Instantané publié de la politique de remboursement de la boutique.'),
  ('b0000000-0004-0000-0000-000000000003', 'return_offered_note', 'fr', 'Note : un retour ou un échange a-t-il été proposé ?', 'Documentez si vous avez proposé un retour, un échange ou un remboursement partiel.'),
  -- Template 4, section 4
  ('b0000000-0004-0000-0000-000000000004', 'customer_communication', 'fr', 'Correspondance client', 'Messages et notes de commande concernant la réclamation sur la qualité, depuis Shopify.'),

  -- Template 5, section 1
  ('b0000000-0005-0000-0000-000000000001', 'order_confirmation', 'fr', 'Confirmation de commande', 'Enregistrement de la commande du débit contesté, depuis la commande Shopify.'),
  -- Template 5, section 2
  ('b0000000-0005-0000-0000-000000000002', 'subscription_agreement', 'fr', 'Contrat ou conditions d''abonnement', 'Téléversez les conditions que le client a acceptées lors de l''inscription, y compris le cycle de facturation et la politique d''annulation.'),
  ('b0000000-0005-0000-0000-000000000002', 'usage_logs', 'fr', 'Journaux d''utilisation du service', 'Téléversez la preuve que le client a utilisé le service ou le produit après la date du débit contesté.'),
  ('b0000000-0005-0000-0000-000000000002', 'renewal_notifications', 'fr', 'E-mails de notification de renouvellement', 'Téléversez les e-mails envoyés avant le renouvellement rappelant au client les débits à venir.'),
  ('b0000000-0005-0000-0000-000000000002', 'cancellation_status_note', 'fr', 'Note : statut de la demande d''annulation', 'Documentez si une annulation a été reçue et quand, ou qu''aucune annulation n''a été soumise.'),
  -- Template 5, section 3
  ('b0000000-0005-0000-0000-000000000003', 'cancellation_policy', 'fr', 'Politique d''annulation', 'Instantané publié de la politique d''annulation de la boutique.'),
  ('b0000000-0005-0000-0000-000000000003', 'refund_policy', 'fr', 'Politique de remboursement', 'Instantané publié de la politique de remboursement de la boutique.'),
  -- Template 5, section 4
  ('b0000000-0005-0000-0000-000000000004', 'customer_communication', 'fr', 'Correspondance client', 'Messages et notes de commande concernant l''annulation, depuis Shopify.'),

  -- Template 6, section 1
  ('b0000000-0006-0000-0000-000000000001', 'order_confirmation', 'fr', 'Confirmation de commande', 'Détails de la commande et totaux issus de la commande Shopify.'),
  -- Template 6, section 2
  ('b0000000-0006-0000-0000-000000000002', 'refund_record', 'fr', 'Enregistrement de remboursement Shopify', 'Historique de remboursement intégré à la commande Shopify (date, montant, note) — si un remboursement figure sur la commande, nous l''incluons.'),
  ('b0000000-0006-0000-0000-000000000002', 'credit_statement', 'fr', 'Crédit externe / enregistrement de crédit boutique', 'Téléversez la preuve de tout crédit émis en dehors de Shopify (crédit boutique, carte cadeau, crédit hors plateforme).'),
  ('b0000000-0006-0000-0000-000000000002', 'processing_timeline_note', 'fr', 'Note : délai de traitement du remboursement', 'Expliquez le délai habituel de traitement des remboursements et indiquez si le dossier se situe dans cette fenêtre.'),
  -- Template 6, section 3
  ('b0000000-0006-0000-0000-000000000003', 'refund_policy', 'fr', 'Politique de remboursement ou de retour', 'Instantané publié de la politique de remboursement de la boutique.'),
  -- Template 6, section 4
  ('b0000000-0006-0000-0000-000000000004', 'customer_communication', 'fr', 'Correspondance client concernant le remboursement', 'Messages et notes de commande liés au remboursement, depuis Shopify.'),

  -- Template 7, section 1
  ('b0000000-0007-0000-0000-000000000001', 'order_confirmation', 'fr', 'Confirmation de commande', 'Détails, totaux et date de création de la commande Shopify.'),
  ('b0000000-0007-0000-0000-000000000001', 'order_itemization', 'fr', 'Détail par article de la commande', 'Décomposition ligne par ligne montrant ce que couvre le montant, issue de la commande Shopify.'),
  -- Template 7, section 2
  ('b0000000-0007-0000-0000-000000000002', 'payment_records', 'fr', 'Journal externe de la passerelle de paiement', 'Téléversez les journaux de la passerelle de paiement montrant que chaque débit est distinct (nous ne récupérons pas automatiquement les journaux de la passerelle).'),
  ('b0000000-0007-0000-0000-000000000002', 'invoice_receipts', 'fr', 'Factures séparées pour chaque débit', 'Téléversez des factures séparées prouvant que chaque débit correspond à une commande ou à un article distinct.'),
  ('b0000000-0007-0000-0000-000000000002', 'auth_vs_capture_note', 'fr', 'Note : autorisation par rapport à capture', 'Expliquez si l''apparente duplication correspond à une retenue d''autorisation plutôt qu''à un débit réel.'),

  -- Template 8, section 1
  ('b0000000-0008-0000-0000-000000000001', 'order_confirmation', 'fr', 'Confirmation de commande', 'Détails de la commande issus de la commande Shopify.'),
  -- Template 8, section 2
  ('b0000000-0008-0000-0000-000000000002', 'download_link_email', 'fr', 'E-mail de lien de téléchargement / accès', 'Téléversez l''e-mail envoyé au client contenant les liens de téléchargement ou les identifiants d''accès.'),
  ('b0000000-0008-0000-0000-000000000002', 'access_logs', 'fr', 'Journaux d''accès ou de téléchargement', 'Téléversez les journaux serveur montrant que le client a accédé au produit numérique ou l''a téléchargé.'),
  ('b0000000-0008-0000-0000-000000000002', 'license_activation', 'fr', 'Enregistrement d''activation de la clé de licence', 'Téléversez l''enregistrement montrant que la clé de licence a été activée par le client.'),
  -- Template 8, section 3
  ('b0000000-0008-0000-0000-000000000003', 'refund_policy', 'fr', 'Politique de livraison numérique ou de remboursement', 'Instantané publié de la politique de remboursement de la boutique (couvre les conditions non remboursables des biens numériques lorsque cela s''applique).'),

  -- Template 9, section 1
  ('b0000000-0009-0000-0000-000000000001', 'refund_policy', 'fr', 'Politique de remboursement ou de retour', 'Instantané publié de la politique de remboursement de la boutique.'),
  ('b0000000-0009-0000-0000-000000000001', 'cancellation_policy', 'fr', 'Politique d''annulation', 'Instantané publié de la politique d''annulation de la boutique.'),
  ('b0000000-0009-0000-0000-000000000001', 'shipping_policy', 'fr', 'Politique d''expédition', 'Instantané publié de la politique d''expédition de la boutique.'),
  -- Template 9, section 2
  ('b0000000-0009-0000-0000-000000000002', 'checkout_terms', 'fr', 'Preuve d''acceptation des conditions au paiement', 'Téléversez une capture d''écran ou un journal montrant que le client a accepté les conditions au moment du paiement.'),
  ('b0000000-0009-0000-0000-000000000002', 'terms_of_service', 'fr', 'Conditions d''utilisation', 'Téléversez le document complet des conditions auxquelles le client a souscrit.'),

  -- Template 10, section 1
  ('b0000000-0010-0000-0000-000000000001', 'order_confirmation', 'fr', 'Confirmation de commande', 'Détails de commande, articles et coordonnées client issus de la commande Shopify.'),
  -- Template 10, section 2
  ('b0000000-0010-0000-0000-000000000002', 'shipping_tracking', 'fr', 'Suivi d''expédition (le cas échéant)', 'Suivi du transporteur issu de l''exécution Shopify, si la commande a été expédiée.'),
  ('b0000000-0010-0000-0000-000000000002', 'delivery_proof', 'fr', 'Confirmation de livraison', 'Statut de livraison du transporteur issu de l''exécution Shopify, lorsqu''il est disponible.'),
  -- Template 10, section 3
  ('b0000000-0010-0000-0000-000000000003', 'refund_policy', 'fr', 'Politique de remboursement', 'Instantané publié de la politique de remboursement de la boutique.'),
  ('b0000000-0010-0000-0000-000000000003', 'shipping_policy', 'fr', 'Politique d''expédition', 'Instantané publié de la politique d''expédition de la boutique.'),
  ('b0000000-0010-0000-0000-000000000003', 'cancellation_policy', 'fr', 'Politique d''annulation', 'Instantané publié de la politique d''annulation de la boutique.'),
  -- Template 10, section 4
  ('b0000000-0010-0000-0000-000000000004', 'customer_communication', 'fr', 'Correspondance client', 'Messages et notes de commande capturés par Shopify.'),
  ('b0000000-0010-0000-0000-000000000004', 'additional_context', 'fr', 'Contexte ou preuve supplémentaire', 'Ajoutez toute autre note pertinente ou téléversez des fichiers supplémentaires qui soutiennent votre dossier.'),

  -- Template 11
  ('b0000000-0011-0000-0000-000000000001', 'order_confirmation', 'fr', 'Confirmation de commande', 'Bref résumé de commande montrant que le débit est légitime.'),
  ('b0000000-0011-0000-0000-000000000001', 'customer_account_info', 'fr', 'Historique du client', 'Notez s''il s''agit d''un client récurrent en bonne et due forme.'),
  -- Template 12
  ('b0000000-0012-0000-0000-000000000001', 'tracking_number', 'fr', 'Statut du suivi', 'Statut de suivi actuel du transporteur.'),
  ('b0000000-0012-0000-0000-000000000001', 'order_confirmation', 'fr', 'Chronologie de la commande et de l''expédition', 'Date de commande et moment de l''expédition.'),
  ('b0000000-0012-0000-0000-000000000001', 'customer_emails', 'fr', 'Notification d''expédition', 'Confirmation d''expédition envoyée au client.'),
  -- Template 13
  ('b0000000-0013-0000-0000-000000000001', 'order_confirmation', 'fr', 'Résumé de commande', 'Résumé de commande indiquant le nom du produit acheté par le client.'),
  ('b0000000-0013-0000-0000-000000000001', 'product_description', 'fr', 'Description du produit', 'Description que le client a vue au moment de l''achat.'),
  ('b0000000-0013-0000-0000-000000000001', 'return_offered_note', 'fr', 'Retour proposé', 'Indiquez tout retour ou échange que vous avez proposé.'),
  -- Template 14
  ('b0000000-0014-0000-0000-000000000001', 'signup_confirmation', 'fr', 'Confirmation d''inscription', 'Quand et comment le client s''est inscrit.'),
  ('b0000000-0014-0000-0000-000000000001', 'usage_activity', 'fr', 'Activité la plus récente', 'Dernière connexion ou utilisation du service, le cas échéant.'),
  ('b0000000-0014-0000-0000-000000000001', 'cancellation_status_note', 'fr', 'Statut de l''annulation', 'Si une demande d''annulation a été reçue et à quel moment.'),
  -- Template 15
  ('b0000000-0015-0000-0000-000000000001', 'processing_timeline_note', 'fr', 'Statut du remboursement', 'Statut actuel : traité, en attente ou non applicable.'),
  ('b0000000-0015-0000-0000-000000000001', 'refund_policy', 'fr', 'Résumé de la politique de remboursement', 'Brève note sur votre politique de remboursement.'),
  ('b0000000-0015-0000-0000-000000000001', 'customer_emails', 'fr', 'Correspondance client', 'Messages récents avec le client concernant le remboursement.'),
  -- Template 16
  ('b0000000-0016-0000-0000-000000000001', 'payment_records', 'fr', 'Liste des transactions', 'Tous les débits sur cette commande montrant que chacun est distinct.'),
  ('b0000000-0016-0000-0000-000000000001', 'order_itemization', 'fr', 'Détail de la commande', 'Articles et total du débit concerné.'),
  -- Template 17
  ('b0000000-0017-0000-0000-000000000001', 'relevant_policy', 'fr', 'Politique pertinente', 'La politique la plus applicable à cette question.'),
  ('b0000000-0017-0000-0000-000000000001', 'terms_acceptance', 'fr', 'Acceptation par le client', 'Preuve que le client a accepté cette politique au moment du paiement.'),
  -- Template 18
  ('b0000000-0018-0000-0000-000000000001', 'order_confirmation', 'fr', 'Résumé de commande', 'Bref résumé de commande.'),
  ('b0000000-0018-0000-0000-000000000001', 'additional_context', 'fr', 'Contexte supplémentaire', 'Toute autre information pertinente pour cette question.')
) AS v(template_section_id, key, locale, label, guidance)
  ON pti.template_section_id = v.template_section_id::uuid AND pti.key = v.key
ON CONFLICT (template_item_id, locale) DO NOTHING;
