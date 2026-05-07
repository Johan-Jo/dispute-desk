import type { Metadata } from "next";
import { LegalPageLayout, type LegalPageSection } from "@/components/legal/LegalPageLayout";
import { LegalSection } from "@/components/legal/LegalSection";
import { CTAFooter } from "@/components/legal/CTAFooter";

export const metadata: Metadata = {
  title: "Data Retention – DisputeDesk",
  description:
    "How long DisputeDesk keeps each category of data, how merchant deletion requests are handled, and how Shopify shop/redact webhooks are processed.",
};

const LAST_UPDATED = "May 7, 2026";

const SECTIONS: LegalPageSection[] = [
  { id: "categories", title: "Retention categories" },
  { id: "dispute-data", title: "Dispute and evidence data" },
  { id: "operational-logs", title: "Operational logs and audit events" },
  { id: "evidence-files", title: "Evidence files" },
  { id: "merchant-account", title: "Merchant account data" },
  { id: "backups", title: "Backups" },
  { id: "deletion-workflows", title: "Deletion workflows" },
  { id: "merchant-deletion", title: "Merchant deletion requests" },
  { id: "shop-redact", title: "Shopify shop/redact handling" },
  { id: "customer-redact", title: "Shopify customers/redact handling" },
  { id: "gdpr-retention", title: "GDPR-related retention" },
  { id: "contact", title: "Contact" },
];

export default function DataRetentionPage() {
  return (
    <LegalPageLayout
      title="Data Retention"
      lastUpdated={LAST_UPDATED}
      sections={SECTIONS}
      intro={
        <p>
          This page is the operational companion to our{" "}
          <a href="/privacy">Privacy Policy</a>. It states how long
          DisputeDesk keeps each category of data, how deletion requests
          are honored, and exactly what happens when Shopify sends one of
          its GDPR webhooks. The intent is to be specific enough that you
          can plan around it.
        </p>
      }
    >
      <LegalSection id="categories" title="Retention categories">
        <p>
          We retain data only for as long as it serves a documented purpose:
          to deliver the service, to keep an auditable trail of what was
          submitted on a merchant&apos;s behalf, to comply with financial-
          recordkeeping and tax obligations, or to satisfy a legal hold.
          When the purpose ends, the data is deleted or anonymized.
        </p>
      </LegalSection>

      <LegalSection id="dispute-data" title="Dispute and evidence data">
        <p>
          We retain dispute records (reason, amount, timestamps, status,
          outcome) and the evidence packs we generated for them for{" "}
          <strong>seven (7) years after the dispute is resolved</strong>.
          This window aligns with the financial-recordkeeping practices
          most merchants must satisfy and lets you demonstrate dispute
          history if challenged by a card network or regulator.
        </p>
      </LegalSection>

      <LegalSection id="operational-logs" title="Operational logs and audit events">
        <p>
          Audit events (who took which action, when, against which
          resource) are retained alongside the dispute they reference and
          deleted on the same schedule. Personal identifiers inside an
          audit event are removed if the underlying customer record is
          redacted; the audit trail itself remains as proof that the
          action occurred.
        </p>
      </LegalSection>

      <LegalSection id="evidence-files" title="Evidence files">
        <p>
          Files merchants upload as evidence (receipts, screenshots,
          customer communication, signed contracts) are stored in private
          object storage scoped to the owning shop and the owning pack.
          Files are retained on the same seven-year window as the dispute
          they belong to. Files orphaned by a deleted pack are removed by
          a maintenance job.
        </p>
      </LegalSection>

      <LegalSection id="merchant-account" title="Merchant account data">
        <p>
          Merchant account records (email, password hash, plan, language
          preference) are retained while the account is active. After
          account closure, account records are deleted within{" "}
          <strong>ninety (90) days</strong> unless an active legal hold
          applies.
        </p>
      </LegalSection>

      <LegalSection id="backups" title="Backups">
        <p>
          Our managed database provider takes encrypted backups for
          disaster recovery. Backups are retained for a rolling window
          consistent with the provider&apos;s standard policy and are not
          used for any other purpose. Data deleted from the live database
          may persist in backups until those backups age out of the
          rolling window; restoration from backup is reserved for genuine
          recovery scenarios and is logged.
        </p>
      </LegalSection>

      <LegalSection id="deletion-workflows" title="Deletion workflows">
        <p>
          Two paths produce deletions:
        </p>
        <ul>
          <li>
            <strong>Scheduled.</strong> Records that have aged past their
            retention window are removed by maintenance jobs. The job logs
            what was deleted and when.
          </li>
          <li>
            <strong>On request.</strong> Merchant deletion requests and
            Shopify GDPR redact webhooks both trigger an immediate
            cascade. The cascade is idempotent — running it twice
            produces the same end state.
          </li>
        </ul>
      </LegalSection>

      <LegalSection id="merchant-deletion" title="Merchant deletion requests">
        <p>
          Merchants can request deletion of their account and all
          associated data by emailing{" "}
          <a href="mailto:privacy@disputedesk.app">privacy@disputedesk.app</a>{" "}
          from the address on file. We confirm the request, run the
          deletion cascade across our database, and confirm completion
          within thirty days. Operational backups age out on the
          provider&apos;s standard rotation.
        </p>
      </LegalSection>

      <LegalSection id="shop-redact" title="Shopify shop/redact handling">
        <p>
          Forty-eight hours after a merchant uninstalls DisputeDesk from a
          store, Shopify sends our endpoint a <code>shop/redact</code>{" "}
          webhook. On receipt:
        </p>
        <ul>
          <li>
            We verify the request signature against our Shopify webhook
            secret. Unsigned or invalid requests are rejected with HTTP
            401.
          </li>
          <li>
            We resolve the shop record in our database and delete all data
            associated with that shop in dependency order: evidence
            files, evidence packs, disputes, jobs, audit events,
            sessions, and finally the shop record itself.
          </li>
          <li>
            We acknowledge the webhook with HTTP 200 and a count of rows
            removed per table.
          </li>
        </ul>
        <p>
          Re-delivery is a no-op. Operational backups age out on the
          standard rotation.
        </p>
      </LegalSection>

      <LegalSection id="customer-redact" title="Shopify customers/redact handling">
        <p>
          When Shopify sends a <code>customers/redact</code> webhook for a
          customer of one of your stores, we anonymize that customer&apos;s
          identifying fields across our database for that store:
        </p>
        <ul>
          <li>
            <code>customer_email</code> and <code>customer_display_name</code>{" "}
            on matching dispute rows are set to <code>null</code>.
          </li>
          <li>
            JSON snapshots inside evidence packs are recursively scrubbed:
            email and name fields that match the redact target are
            replaced with a redacted marker.
          </li>
          <li>
            A compliance audit row records that the redaction occurred.
            That row deliberately does not contain the customer&apos;s
            email or name.
          </li>
        </ul>
      </LegalSection>

      <LegalSection id="gdpr-retention" title="GDPR-related retention">
        <p>
          Where GDPR applies, we process personal data only for the
          purposes documented in our <a href="/privacy">Privacy Policy</a>{" "}
          and only for as long as those purposes require. Where retention
          is required by law (for example, financial recordkeeping
          obligations on the merchant), we keep the minimum dataset
          necessary to satisfy the obligation and remove identifying
          fields where possible.
        </p>
      </LegalSection>

      <LegalSection id="contact" title="Contact">
        <p>
          Questions about retention, deletion, or how a particular dataset
          is handled:{" "}
          <a href="mailto:privacy@disputedesk.app">privacy@disputedesk.app</a>.
        </p>
      </LegalSection>

      <CTAFooter
        title="Need a record removed?"
        description="Email us from the address on file with the details of your request. We confirm receipt within five business days and complete deletion within thirty days."
        primary={{ label: "Email privacy@disputedesk.app", href: "mailto:privacy@disputedesk.app" }}
        secondary={{ label: "Read the privacy policy", href: "/privacy" }}
      />
    </LegalPageLayout>
  );
}
