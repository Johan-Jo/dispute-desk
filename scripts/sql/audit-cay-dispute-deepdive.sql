-- Deep-dive #4: hunt for ANY card fingerprint in all 67 raw snapshots + time span + type split.
select
  count(*)                                                                       as total,
  min(created_at)                                                                as earliest,
  max(created_at)                                                                as latest,
  count(*) filter (where raw_snapshot::text ~* 'visa|mastercard|amex|american express|discover|cardBrand|networkReasonCode') as raw_mentions_card,
  count(*) filter (where raw_snapshot::text ~* '"type": ?"CHARGEBACK"')          as chargebacks,
  count(*) filter (where raw_snapshot::text ~* '"type": ?"INQUIRY"')             as inquiries
from disputes d
where d.shop_id = 'c497df8d-632d-49da-b385-eb523f57f341';
