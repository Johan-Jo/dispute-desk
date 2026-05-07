import type { Metadata } from "next";
import { LegalPageLayout, type LegalPageSection } from "@/components/legal/LegalPageLayout";
import { LegalSection } from "@/components/legal/LegalSection";
import { CTAFooter } from "@/components/legal/CTAFooter";

export const metadata: Metadata = {
  title: "Privacy Policy – DisputeDesk",
  description:
    "How DisputeDesk collects, uses, retains, and protects merchant and Shopify customer data when handling chargeback evidence.",
};

const LAST_UPDATED = "May 7, 2026";

const SECTIONS: LegalPageSection[] = [
  { id: "information-collected", title: "Information we collect" },
  { id: "merchant-account-data", title: "Merchant account data" },
  { id: "shopify-data", title: "Shopify order and dispute data" },
  { id: "technical-logs", title: "Technical logs" },
  { id: "evidence-processing", title: "Evidence and document processing" },
  { id: "shopify-authorized-access", title: "Shopify-authorized access" },
  { id: "how-used", title: "How we use information" },
  { id: "data-sharing", title: "Data sharing" },
  { id: "service-providers", title: "Service providers" },
  { id: "gdpr-support", title: "GDPR support" },
  { id: "customer-data-requests", title: "Customer data requests" },
  { id: "customer-redact-requests", title: "Customer redact requests" },
  { id: "shop-redact-requests", title: "Shop redact requests" },
  { id: "security", title: "Security" },
  { id: "retention", title: "Retention overview" },
  { id: "international-transfers", title: "International transfers" },
  { id: "childrens-privacy", title: "Children's privacy" },
  { id: "updates", title: "Policy updates" },
  { id: "contact", title: "Contact" },
];

export default function PrivacyPage() {
  return (
    <LegalPageLayout
      title="Privacy Policy"
      lastUpdated={LAST_UPDATED}
      sections={SECTIONS}
      intro={
        <p>
          DisputeDesk helps Shopify merchants build and submit chargeback evidence
          inside Shopify Admin. This policy explains what data we collect, why we
          collect it, who we share it with, and how long we keep it. We process
          merchant data to deliver our service and process Shopify customer data
          only on the merchant&apos;s behalf, never for our own purposes.
        </p>
      }
    >
      <LegalSection id="information-collected" title="Information we collect">
        <p>
          We collect three categories of data: information you give us when you
          sign up for DisputeDesk, information Shopify passes to us when you
          install the app on a store, and operational data we generate as the
          service runs. Each category is described in the sections below.
        </p>
      </LegalSection>

      <LegalSection id="merchant-account-data" title="Merchant account data">
        <p>
          When you create a DisputeDesk account we store your email address, an
          encrypted password hash (handled by Supabase Auth), the Shopify store(s)
          you connect, your billing plan and trial status, language preference,
          and notification preferences. We use this information to authenticate
          you, send transactional email related to your account, and present a
          localized interface.
        </p>
      </LegalSection>

      <LegalSection id="shopify-data" title="Shopify order and dispute data">
        <p>
          When a chargeback or inquiry arrives at a connected store, DisputeDesk
          reads the linked order from Shopify so it can assemble evidence. The
          fields we read include: order number, totals, line items, fulfillment
          and tracking details, billing and shipping addresses, payment method
          summary (AVS/CVV result codes, card brand, last four), the
          customer&apos;s email and display name on the order, and the dispute
          itself (reason, amount, due date, status). We never read products,
          customers, or orders outside the dispute workflow we were authorized
          for.
        </p>
      </LegalSection>

      <LegalSection id="technical-logs" title="Technical logs">
        <p>
          The platform writes operational telemetry to support engineering
          (audit events of who did what, job execution records, webhook
          delivery records). Telemetry references resources by internal ID
          rather than by personal identifiers wherever possible. When IP
          addresses are recorded for security purposes, they are retained
          only as long as necessary for that purpose.
        </p>
      </LegalSection>

      <LegalSection id="evidence-processing" title="Evidence and document processing">
        <p>
          To build evidence, DisputeDesk may also process: files merchants or
          their staff upload (delivery receipts, customer communication
          screenshots, signed contracts), policy snapshots taken from the
          store&apos;s public policy pages, and IP geolocation lookups (we send
          the order&apos;s recorded client IP to IPinfo to enrich the evidence
          with location and proxy/VPN signals). Uploaded files are stored in
          private object storage and signed short-lived URLs are used to
          reference them inside Shopify-bound evidence so file bytes are never
          exposed to the issuer or third parties.
        </p>
      </LegalSection>

      <LegalSection id="shopify-authorized-access" title="Shopify-authorized access">
        <p>
          DisputeDesk only accesses data inside Shopify stores where the
          merchant has installed our app and granted the documented OAuth
          scopes. The minimum scope set is published in our App Store listing
          and in our public source configuration. We do not request, store, or
          process Shopify data for stores where the app is not installed.
        </p>
      </LegalSection>

      <LegalSection id="how-used" title="How we use information">
        <ul>
          <li>
            <strong>Service delivery</strong> — generate evidence packs, render
            PDFs, save evidence into the merchant&apos;s Shopify dispute
            response, send transactional alerts the merchant has opted into
            (new dispute, evidence ready, deadline reminder).
          </li>
          <li>
            <strong>Audit and compliance</strong> — keep records that show what
            was generated, when it was submitted, and on whose behalf.
          </li>
          <li>
            <strong>Security and abuse prevention</strong> — authenticate
            users, enforce rate limits, detect and stop misuse.
          </li>
          <li>
            <strong>Service improvement</strong> — aggregate and de-identify
            metrics (e.g. dispute volume, win rates by reason). We do not sell
            personal data and we do not train AI models on customer data.
          </li>
        </ul>
      </LegalSection>

      <LegalSection id="data-sharing" title="Data sharing">
        <p>
          We do not sell personal data. We do not share Shopify customer data
          with advertisers or marketing networks. We share data only with the
          service providers listed below, where strictly required to operate
          the platform; and with Shopify itself, when we send evidence into the
          merchant&apos;s Shopify dispute response on their behalf.
        </p>
      </LegalSection>

      <LegalSection id="service-providers" title="Service providers">
        <ul>
          <li>
            <strong>Shopify, Inc.</strong> — host platform; source of order,
            customer, and dispute data.
          </li>
          <li>
            <strong>Supabase</strong> — managed Postgres database,
            authentication, private file storage.
          </li>
          <li>
            <strong>Vercel</strong> — application hosting and content delivery.
          </li>
          <li>
            <strong>Resend</strong> — transactional email (welcome, password
            reset, dispute alerts, GDPR notifications to merchants).
          </li>
          <li>
            <strong>IPinfo</strong> — IP geolocation lookups against the
            order&apos;s recorded client IP. No PII is sent.
          </li>
          <li>
            <strong>OpenAI</strong> — used only by our public Resources Hub
            article pipeline. No Shopify customer data, order data, or evidence
            content is ever sent to OpenAI.
          </li>
          <li>
            <strong>Cal.com</strong> — demo booking on the marketing site;
            processes only the prospect&apos;s name and email.
          </li>
        </ul>
        <p>
          We add or remove providers as the service evolves. Material changes
          are reflected on this page.
        </p>
      </LegalSection>

      <LegalSection id="gdpr-support" title="GDPR support">
        <p>
          DisputeDesk supports the merchant&apos;s GDPR obligations. When we
          process Shopify customer data on a merchant&apos;s behalf we act as
          the data <strong>processor</strong>; the merchant is the data{" "}
          <strong>controller</strong>. We process under a Data Processing
          Agreement on request. When we process the merchant&apos;s own account
          data we act as the data controller.
        </p>
      </LegalSection>

      <LegalSection id="customer-data-requests" title="Customer data requests">
        <p>
          When Shopify forwards a <code>customers/data_request</code> webhook
          for a customer of one of your stores, we acknowledge the request,
          record it in our audit log, and notify the merchant by email so the
          merchant can respond directly to the customer within their statutory
          window. The merchant remains the data controller.
        </p>
      </LegalSection>

      <LegalSection id="customer-redact-requests" title="Customer redact requests">
        <p>
          When Shopify forwards a <code>customers/redact</code> webhook, we
          locate every record in our database that references the
          customer&apos;s email or full name within that store and replace the
          identifying fields with redacted markers. Both the structured
          dispute record and the JSON snapshot inside the evidence pack are
          scrubbed. We keep operational audit records that show the
          redaction occurred but those records do not contain the
          customer&apos;s name or email.
        </p>
      </LegalSection>

      <LegalSection id="shop-redact-requests" title="Shop redact requests">
        <p>
          When Shopify forwards a <code>shop/redact</code> webhook (sent 48
          hours after a merchant uninstalls the app), we delete all data
          associated with that store. This cascade covers disputes, evidence
          packs, evidence files, jobs, audit events, sessions, and the store
          record itself. The cascade is idempotent — a redelivered webhook is
          a no-op.
        </p>
      </LegalSection>

      <LegalSection id="security" title="Security">
        <p>
          Customer data is protected by HTTPS in transit, encryption at rest
          for sensitive fields, least-privilege access via Supabase Row-Level
          Security, short-lived authentication tokens, and tightly scoped
          OAuth credentials. See our <a href="/security">Security</a> page for
          details on infrastructure protections, access controls, and
          responsible disclosure.
        </p>
      </LegalSection>

      <LegalSection id="retention" title="Retention overview">
        <p>
          Dispute and evidence data are kept for seven years after the
          dispute is resolved, aligning with common financial-recordkeeping
          windows. Merchant accounts are deleted within ninety days of account
          closure unless an active legal hold applies. When a store is
          uninstalled we delete its data on receipt of the{" "}
          <code>shop/redact</code> webhook from Shopify (48 hours
          post-uninstall). Full retention windows by data category are on the{" "}
          <a href="/data-retention">Data Retention</a> page.
        </p>
      </LegalSection>

      <LegalSection id="international-transfers" title="International transfers">
        <p>
          Application infrastructure and database storage are operated by
          Supabase and Vercel. Data may be processed in the regions in which
          those vendors operate. Where data is transferred between
          jurisdictions, we rely on legally appropriate safeguards (such as
          Standard Contractual Clauses for transfers from the EU to the US).
        </p>
      </LegalSection>

      <LegalSection id="childrens-privacy" title="Children's privacy">
        <p>
          DisputeDesk is a business-facing product. We do not knowingly
          collect personal information from children under 16. If you believe
          a child has interacted with our service, contact us and we will
          remove the data.
        </p>
      </LegalSection>

      <LegalSection id="updates" title="Policy updates">
        <p>
          We update this page when our practices change. The &ldquo;Last
          updated&rdquo; date at the top reflects the most recent revision.
          Material changes will be highlighted; continued use of the service
          after a material change constitutes acceptance.
        </p>
      </LegalSection>

      <LegalSection id="contact" title="Contact">
        <p>
          For privacy questions or to exercise your rights, contact{" "}
          <a href="mailto:privacy@disputedesk.app">privacy@disputedesk.app</a>.
          Shopify customers should normally contact the merchant whose store
          they purchased from — the merchant is the data controller.
        </p>
      </LegalSection>

      <CTAFooter
        title="Have a privacy question?"
        description="We respond to privacy inquiries within five business days. Send us the details of your request and we'll route it to the right person."
        primary={{ label: "Email privacy@disputedesk.app", href: "mailto:privacy@disputedesk.app" }}
        secondary={{ label: "See our security practices", href: "/security" }}
      />
    </LegalPageLayout>
  );
}
