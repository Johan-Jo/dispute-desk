-- Signal Radar M1.5 — broaden the platform check constraint
-- so new adapters (Trustpilot, G2, Capterra, Stripe Community, PayPal
-- Community, BBB, Hacker News, Indie Hackers) can slot in without a
-- schema migration each time.

alter table signal_sources
  drop constraint if exists signal_sources_platform_check;

alter table signal_sources
  add constraint signal_sources_platform_check
  check (platform in (
    'reddit',
    'shopify_community',
    'app_store',
    'trustpilot',
    'g2',
    'capterra',
    'stripe_community',
    'paypal_community',
    'bbb',
    'hackernews',
    'indie_hackers'
  ));
