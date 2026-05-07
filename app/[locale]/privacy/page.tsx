/**
 * Privacy Policy page — Shopify App Store readiness.
 *
 * ⚠️  [REVIEW WITH COUNSEL]  ⚠️
 * This policy was drafted to satisfy Shopify App Store submission
 * requirements + GDPR + CCPA disclosure obligations for an app that
 * accesses Protected Customer Data (orders, customer info, dispute
 * evidence). It MUST be reviewed by qualified legal counsel before
 * relying on it for compliance — language about retention, DSAR
 * procedures, sub-processor relationships, and data-location claims
 * carries real liability if inaccurate.
 *
 * Maintenance:
 *   - Sub-processor list (§5) must stay in sync with actual vendors.
 *     If you add or remove a service that processes user data, update
 *     this file in the same commit.
 *   - Bump POLICY_LAST_UPDATED whenever any substantive change is made.
 *   - Single English source — other locales fall back to English with
 *     a note. Translations require qualified legal review per locale
 *     (machine translation is not safe for legal text).
 */

import { hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { routing } from "@/i18n/routing";
import type { PathLocale } from "@/lib/i18n/pathLocales";

const POLICY_LAST_UPDATED = "May 7, 2026";
const CONTACT_EMAIL = "privacy@disputedesk.app";
const COMPANY_NAME = "DisputeDesk";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale: localeParam } = await params;
  if (!hasLocale(routing.locales, localeParam)) {
    return {};
  }
  return {
    title: "Privacy Policy — DisputeDesk",
    description:
      "How DisputeDesk collects, uses, and protects merchant and customer data when handling Shopify chargeback evidence.",
  };
}

export default async function PrivacyPage({ params }: Props) {
  const { locale: localeParam } = await params;
  if (!hasLocale(routing.locales, localeParam)) {
    notFound();
  }
  const pathLocale = localeParam as PathLocale;
  setRequestLocale(pathLocale);
  const isEnglish = pathLocale === "en";

  return (
    <main className="mx-auto max-w-3xl px-4 py-16">
      <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
        Privacy Policy
      </h1>
      <p className="mt-2 text-sm text-slate-500">
        Last updated: {POLICY_LAST_UPDATED}
      </p>

      {!isEnglish && (
        <div className="mt-6 rounded-md border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
          This policy is currently maintained in English. A localized version is
          not yet available; the English text below is authoritative for all
          users.
        </div>
      )}

      <div className="prose prose-slate mt-8 max-w-none text-sm leading-relaxed">
        <h2>1. Who we are</h2>
        <p>
          {COMPANY_NAME} (&ldquo;we&rdquo;, &ldquo;our&rdquo;, &ldquo;us&rdquo;) provides a Shopify app and
          web portal that helps merchants build and submit chargeback evidence
          inside Shopify Admin. This policy explains what data we collect, why
          we collect it, who we share it with, and how long we keep it.
        </p>
        <p>
          When we process data <em>on behalf of</em> a merchant (e.g. customer
          orders pulled from the merchant&rsquo;s Shopify store), we act as a{" "}
          <strong>data processor</strong> and the merchant is the controller.
          When we process data about the merchant themselves (e.g. their
          billing email, app preferences), we act as the controller.
        </p>

        <h2>2. Data we collect</h2>
        <p>We collect the following categories:</p>
        <ul>
          <li>
            <strong>Merchant account data</strong> — email address, password
            hash (via Supabase Auth), connected Shopify store domain, plan
            preferences, language preference (cookie: <code>dd_locale</code>).
          </li>
          <li>
            <strong>Shopify store metadata</strong> — store domain, store name,
            currency, OAuth scopes granted, billing plan status.
          </li>
          <li>
            <strong>Order and customer data (Protected Customer Data)</strong>{" "}
            — for disputes that arrive at the store, we read the linked order
            (line items, totals, fulfillment details, billing/shipping
            addresses) and the customer&rsquo;s email and display name. This is
            used solely to assemble chargeback evidence.
          </li>
          <li>
            <strong>Dispute evidence content</strong> — text and files the
            merchant uploads or that we collect from Shopify (tracking
            numbers, policy snapshots, customer communication, payment
            authorization details such as AVS/CVV result codes).
          </li>
          <li>
            <strong>IP intelligence</strong> — when an order has a recorded
            client IP, we may query{" "}
            <a href="https://ipinfo.io" rel="noopener noreferrer">
              IPinfo
            </a>{" "}
            to enrich the dispute evidence with geolocation and VPN/proxy
            indicators. We do not store the raw client IP beyond what
            Shopify already records on the order.
          </li>
          <li>
            <strong>Operational telemetry</strong> — audit events
            (who did what, when), job execution logs, and webhook delivery
            records. These do not contain customer-identifying data beyond
            references to internal IDs.
          </li>
          <li>
            <strong>Cookies</strong> — see §6.
          </li>
        </ul>

        <h2>3. How we use this data</h2>
        <ul>
          <li>
            <strong>Service delivery.</strong> Build evidence packs for
            chargebacks, render PDFs, save evidence to Shopify, send email
            alerts the merchant has opted into (new dispute, evidence ready,
            deadline reminders).
          </li>
          <li>
            <strong>Compliance and audit.</strong> Maintain records of when
            evidence was generated and submitted, so merchants and we can
            demonstrate due process if a card network or regulator asks.
          </li>
          <li>
            <strong>Service improvement.</strong> Aggregate, non-identifying
            metrics (e.g. dispute volume, win rates) inform product
            decisions. We do not sell personal data and do not use customer
            data to train AI models.
          </li>
          <li>
            <strong>Security.</strong> Detect abuse, authenticate users,
            enforce rate limits.
          </li>
        </ul>

        <h2>4. Legal bases (GDPR)</h2>
        <ul>
          <li>
            <strong>Contract.</strong> Processing merchant account data and
            Shopify store data is necessary to provide the service the
            merchant signed up for.
          </li>
          <li>
            <strong>Legitimate interest.</strong> Processing customer/order
            data on behalf of merchants to defend chargebacks is in the
            merchant&rsquo;s legitimate interest as the data controller; we
            process under a Data Processing Agreement with each merchant.
          </li>
          <li>
            <strong>Consent.</strong> Optional analytics cookies require
            opt-in via the cookie banner.
          </li>
          <li>
            <strong>Legal obligation.</strong> Some retention is required for
            financial recordkeeping and chargeback dispute defense.
          </li>
        </ul>

        <h2>5. Sub-processors</h2>
        <p>We rely on the following service providers to operate the app:</p>
        <ul>
          <li>
            <strong>Shopify, Inc.</strong> — host platform; source of order +
            customer + dispute data.
          </li>
          <li>
            <strong>Supabase (Supabase, Inc.)</strong> — managed Postgres
            database, authentication, file storage. Customer data is stored
            in the Supabase project region selected for our deployment.
          </li>
          <li>
            <strong>Vercel, Inc.</strong> — application hosting and edge
            delivery.
          </li>
          <li>
            <strong>Resend (Resend, Inc.)</strong> — transactional email
            delivery (welcome, password reset, dispute alerts, GDPR
            notifications).
          </li>
          <li>
            <strong>IPinfo (IPinfo, Inc.)</strong> — IP geolocation lookups
            for dispute evidence enrichment. We send only the order&rsquo;s
            client IP; no PII is sent.
          </li>
          <li>
            <strong>OpenAI</strong> — AI generation for the public
            Resources Hub article pipeline. <em>No customer or order data
            from any merchant store is sent to OpenAI</em>; the integration
            is scoped to public marketing content.
          </li>
          <li>
            <strong>Cal.com</strong> — demo booking on the marketing site
            (only the prospective customer&rsquo;s name + email entered into
            the booking form is processed).
          </li>
        </ul>
        <p>
          We add or remove sub-processors when our service requirements
          change. Material changes are reflected in this policy.
        </p>

        <h2>6. Cookies and similar technologies</h2>
        <ul>
          <li>
            <strong>Essential.</strong> Authentication cookies (Supabase),
            language preference (<code>dd_locale</code>), Shopify session
            cookies inside the embedded app. Without these the service
            cannot function.
          </li>
          <li>
            <strong>Analytics (opt-in).</strong> Google Analytics 4 loads
            only after a visitor accepts the cookie banner on the marketing
            site. Default state is denied; the banner can be reopened from
            the footer.
          </li>
        </ul>

        <h2>7. Data retention</h2>
        <ul>
          <li>
            <strong>Dispute and evidence data.</strong> Retained for{" "}
            <strong>seven (7) years</strong> after the dispute is resolved.
            This aligns with common financial-recordkeeping windows and
            allows merchants to demonstrate dispute history if challenged
            by a card network or regulator.
          </li>
          <li>
            <strong>Merchant account data.</strong> Retained while the
            merchant has an active account. Deleted within 90 days of
            account closure unless required for ongoing legal,
            regulatory, or audit obligations.
          </li>
          <li>
            <strong>Audit logs.</strong> Retained for the same window as
            the disputes they reference. Personal identifiers are removed
            on customer redaction (see §9) but the audit trail itself is
            preserved.
          </li>
          <li>
            <strong>Uninstalled stores.</strong> When a merchant uninstalls
            the app, Shopify sends us a <code>shop/redact</code> webhook
            48 hours later. We delete all data associated with that store
            on receipt.
          </li>
        </ul>

        <h2>8. Where data is stored</h2>
        <p>
          Application infrastructure and database storage are provided by
          Supabase and Vercel. Data may be processed in the regions where
          those vendors operate. We do not transfer personal data to
          jurisdictions without an adequate level of protection or an
          equivalent safeguard (e.g. Standard Contractual Clauses for
          EU&rarr;US transfers).
        </p>

        <h2>9. Your rights</h2>
        <p>
          Under GDPR (EU/UK), CCPA (California), and similar privacy laws
          you have rights to:
        </p>
        <ul>
          <li>Know what personal data we hold about you</li>
          <li>Request a copy of that data (data portability)</li>
          <li>Correct inaccurate data</li>
          <li>Request erasure (right to be forgotten)</li>
          <li>Restrict or object to processing</li>
          <li>Withdraw consent for analytics cookies at any time</li>
          <li>Lodge a complaint with your local supervisory authority</li>
        </ul>
        <p>
          <strong>For Shopify customers:</strong> requests should normally
          be directed to the merchant whose store you purchased from — they
          are the data controller. Shopify forwards verified erasure
          requests to apps automatically; we honor them within 30 days.
        </p>
        <p>
          <strong>For merchants:</strong> email{" "}
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> from the
          email associated with your account.
        </p>
        <p>
          <strong>CCPA notice (California residents):</strong> we do not sell
          personal information and have not done so in the preceding 12
          months. We do not knowingly collect personal information from
          children under 16.
        </p>

        <h2>10. Security</h2>
        <p>
          We use industry-standard safeguards including HTTPS in transit,
          encryption at rest for sensitive fields (AES-256-GCM), least-
          privilege database access via Supabase Row-Level Security, and
          short-lived authentication tokens. No system is perfectly secure;
          if you suspect a security issue please email{" "}
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
        </p>

        <h2>11. Changes to this policy</h2>
        <p>
          We will update this page when our practices change. Material
          changes will be highlighted; the &ldquo;Last updated&rdquo; date
          at the top reflects the most recent revision. Continued use of
          the service after a material change constitutes acceptance.
        </p>

        <h2>12. Contact</h2>
        <p>
          Questions, complaints, or requests:{" "}
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
        </p>
      </div>
    </main>
  );
}
