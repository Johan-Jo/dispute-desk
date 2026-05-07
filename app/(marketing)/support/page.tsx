import type { Metadata } from "next";
import { LegalPageLayout, type LegalPageSection } from "@/components/legal/LegalPageLayout";
import { LegalSection } from "@/components/legal/LegalSection";
import { CTAFooter } from "@/components/legal/CTAFooter";

export const metadata: Metadata = {
  title: "Support – DisputeDesk",
  description:
    "How to reach DisputeDesk support, what response time to expect, and where to route billing, technical, and security issues.",
};

const LAST_UPDATED = "May 7, 2026";

const SECTIONS: LegalPageSection[] = [
  { id: "contact", title: "How to reach us" },
  { id: "response-times", title: "Response expectations" },
  { id: "issue-types", title: "What we help with" },
  { id: "billing", title: "Billing and subscriptions" },
  { id: "technical", title: "Technical troubleshooting" },
  { id: "security", title: "Security issues" },
  { id: "onboarding", title: "Onboarding help" },
  { id: "in-app-help", title: "In-app help" },
];

export default function SupportPage() {
  return (
    <LegalPageLayout
      title="Support"
      lastUpdated={LAST_UPDATED}
      sections={SECTIONS}
      intro={
        <p>
          DisputeDesk is built to be self-serve, but real chargeback
          questions come up. This page is the single place to figure out
          where to send each kind of request and how long to expect a
          response. We answer most questions within one business day.
        </p>
      }
    >
      <LegalSection id="contact" title="How to reach us">
        <p>
          For most questions, email{" "}
          <a href="mailto:support@disputedesk.app">support@disputedesk.app</a>.
          When relevant, include the affected store domain, dispute ID,
          and a screenshot — that lets us answer in one round-trip.
        </p>
        <p>
          Specialized inboxes route faster:
        </p>
        <ul>
          <li>
            <a href="mailto:billing@disputedesk.app">billing@disputedesk.app</a>{" "}
            — invoices, plan changes, refunds.
          </li>
          <li>
            <a href="mailto:security@disputedesk.app">security@disputedesk.app</a>{" "}
            — vulnerability reports, suspicious activity.
          </li>
          <li>
            <a href="mailto:privacy@disputedesk.app">privacy@disputedesk.app</a>{" "}
            — data subject requests, GDPR/CCPA inquiries.
          </li>
        </ul>
      </LegalSection>

      <LegalSection id="response-times" title="Response expectations">
        <ul>
          <li>
            <strong>First response</strong> within one business day for
            paid plans, two business days for free or trial accounts.
          </li>
          <li>
            <strong>Security reports</strong> acknowledged within five
            business days; see our <a href="/security">Security</a> page
            for the responsible disclosure process.
          </li>
          <li>
            <strong>Billing requests</strong> processed within two
            business days.
          </li>
          <li>
            <strong>Privacy requests</strong> confirmed within five
            business days; deletion completed within thirty days unless a
            legal hold applies.
          </li>
        </ul>
        <p>
          Business days are Monday through Friday, excluding public
          holidays. Time-sensitive incidents (active dispute deadline
          hours away, suspected security event) are prioritized.
        </p>
      </LegalSection>

      <LegalSection id="issue-types" title="What we help with">
        <ul>
          <li>
            <strong>Product questions</strong> — how a feature works, how
            to configure automation, where a setting lives.
          </li>
          <li>
            <strong>Evidence questions</strong> — why a particular field
            was or wasn&apos;t included, how the strength score is
            computed, what to upload for a specific dispute reason.
          </li>
          <li>
            <strong>Sync and data issues</strong> — disputes not
            appearing, evidence not saving, status looking wrong.
          </li>
          <li>
            <strong>Account and access</strong> — sign-in trouble, store
            switching, team access.
          </li>
        </ul>
        <p>
          We do not give legal advice and cannot tell you whether a
          specific dispute will be won — that decision is the
          cardholder&apos;s bank and the card network.
        </p>
      </LegalSection>

      <LegalSection id="billing" title="Billing and subscriptions">
        <p>
          Plan changes, top-ups, and cancellations are managed inside the
          app under <em>Settings → Billing</em> (also accessible from
          Shopify Admin). Invoices are issued through Shopify Billing and
          appear on your Shopify bill. For invoice copies, refund
          requests, or plan questions email{" "}
          <a href="mailto:billing@disputedesk.app">billing@disputedesk.app</a>.
        </p>
      </LegalSection>

      <LegalSection id="technical" title="Technical troubleshooting">
        <p>Common questions, in order of frequency:</p>
        <ul>
          <li>
            <strong>The app loads to a blank screen.</strong> Reload the
            app from Shopify Admin to refresh the embedded session token.
            If that doesn&apos;t resolve it, send us the store domain and
            a screenshot.
          </li>
          <li>
            <strong>A dispute isn&apos;t showing up.</strong> Click{" "}
            <em>Sync now</em> on the Disputes page. Webhooks usually
            ingest disputes within minutes; sync is the manual fallback.
          </li>
          <li>
            <strong>Evidence saved but Shopify shows it empty.</strong>{" "}
            Confirm your Shopify staff account has the{" "}
            <em>Manage orders information</em> permission. Without it,
            Shopify may accept our request and silently drop the data.
          </li>
          <li>
            <strong>An automated rule didn&apos;t fire.</strong> Open the
            dispute&apos;s timeline — the rule evaluation is recorded
            there with the reason a rule matched or skipped.
          </li>
        </ul>
        <p>
          If you&apos;re still stuck, send us the dispute ID and the
          timestamp of the issue and we&apos;ll trace it from the audit
          log.
        </p>
      </LegalSection>

      <LegalSection id="security" title="Security issues">
        <p>
          Suspected security vulnerabilities or active incidents go to{" "}
          <a href="mailto:security@disputedesk.app">security@disputedesk.app</a>.
          See our <a href="/security">Security</a> page for the
          responsible disclosure process. Please do not include exploit
          details in a general support ticket.
        </p>
      </LegalSection>

      <LegalSection id="onboarding" title="Onboarding help">
        <p>
          New stores are guided through a setup wizard inside the app
          (connect Shopify, set policies, install pack templates,
          configure automation rules, invite teammates). If a step is
          stuck or unclear, the wizard&apos;s &ldquo;Need help with this
          step?&rdquo; link drops a context note into your support ticket
          so we can pick up where you are without the back-and-forth.
        </p>
      </LegalSection>

      <LegalSection id="in-app-help" title="In-app help">
        <p>
          The app ships with an embedded Help section covering field
          mapping, automation rules, billing, and what happens after
          saving evidence. Open it from the sidebar. Articles are
          searchable and linked inline from the most relevant screens.
        </p>
      </LegalSection>

      <CTAFooter
        title="Still stuck?"
        description="Send us the store domain, dispute ID, and a screenshot. Most replies go out within one business day."
        primary={{ label: "Email support@disputedesk.app", href: "mailto:support@disputedesk.app" }}
        secondary={{ label: "Read the privacy policy", href: "/privacy" }}
      />
    </LegalPageLayout>
  );
}
