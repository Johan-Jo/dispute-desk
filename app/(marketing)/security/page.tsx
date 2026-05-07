import type { Metadata } from "next";
import { LegalPageLayout, type LegalPageSection } from "@/components/legal/LegalPageLayout";
import { LegalSection } from "@/components/legal/LegalSection";
import { CTAFooter } from "@/components/legal/CTAFooter";

export const metadata: Metadata = {
  title: "Security – DisputeDesk",
  description:
    "How DisputeDesk protects merchant and Shopify customer data: encryption, access controls, monitoring, and responsible disclosure.",
};

const LAST_UPDATED = "May 7, 2026";

const SECTIONS: LegalPageSection[] = [
  { id: "encryption", title: "Encryption in transit and at rest" },
  { id: "https", title: "HTTPS everywhere" },
  { id: "infrastructure", title: "Infrastructure protections" },
  { id: "access-controls", title: "Access controls" },
  { id: "production-access", title: "Production access restrictions" },
  { id: "secrets", title: "Environment and secret management" },
  { id: "monitoring", title: "Monitoring and logging" },
  { id: "gdpr-webhooks", title: "Shopify GDPR webhook support" },
  { id: "merchant-authorized", title: "Merchant-authorized access only" },
  { id: "incident-response", title: "Incident response" },
  { id: "responsible-disclosure", title: "Responsible disclosure" },
  { id: "contact", title: "Contact" },
];

export default function SecurityPage() {
  return (
    <LegalPageLayout
      title="Security"
      lastUpdated={LAST_UPDATED}
      sections={SECTIONS}
      intro={
        <p>
          Security is foundational to a chargeback platform. This page
          describes the technical and operational safeguards we use to
          protect merchant accounts, Shopify customer data, and the
          evidence DisputeDesk generates on a merchant&apos;s behalf. We
          state only what is true today; we do not claim certifications we
          do not hold.
        </p>
      }
    >
      <LegalSection id="encryption" title="Encryption in transit and at rest">
        <p>
          All traffic to and from the application is encrypted using TLS 1.2
          or higher. Data at rest in our managed Postgres database is
          encrypted at the storage layer by our infrastructure provider.
          Sensitive application-layer fields (for example, third-party API
          tokens such as Shopify access tokens) are additionally encrypted
          using AES-256-GCM with rotated keys before being written to the
          database.
        </p>
      </LegalSection>

      <LegalSection id="https" title="HTTPS everywhere">
        <p>
          The marketing site, embedded Shopify app, merchant portal, and
          all webhook endpoints are served only over HTTPS. HTTP requests
          are redirected. Cookies that carry session state are marked{" "}
          <code>Secure</code> and use the strictest <code>SameSite</code>{" "}
          attribute the embedded context allows.
        </p>
      </LegalSection>

      <LegalSection id="infrastructure" title="Infrastructure protections">
        <p>
          Application hosting runs on Vercel; database, authentication, and
          private file storage run on Supabase. Both providers operate
          isolated tenant environments, automated patching, network-level
          firewalling, and DDoS protection. We rely on those providers&apos;
          documented controls and revisit our choice of provider as our
          security posture matures.
        </p>
      </LegalSection>

      <LegalSection id="access-controls" title="Access controls">
        <p>
          Database access is governed by Supabase Row-Level Security
          policies that scope reads and writes to the owning shop. The
          embedded Shopify app, merchant portal, and internal admin panel
          each authenticate via independent paths (Shopify session token,
          Supabase Auth, Supabase Auth + an internal grants table). Cross-
          shop reads are blocked at the middleware layer by an explicit
          shop-identity guard.
        </p>
      </LegalSection>

      <LegalSection id="production-access" title="Production access restrictions">
        <p>
          Production database and infrastructure credentials are limited
          to the smallest set of operators required to run the service.
          Service-role credentials are never exposed to client code; only
          server-side runtimes hold them. Local development runs against a
          separate environment and never reads or writes production data.
        </p>
      </LegalSection>

      <LegalSection id="secrets" title="Environment and secret management">
        <p>
          Secrets are stored in the deployment platform&apos;s encrypted
          environment variable store and injected into the application at
          runtime. Secrets are never committed to source control; a
          machine-checked guard fails the build if a known secret pattern
          appears in tracked files. Secret rotation is performed when a
          provider notifies us of an incident, when a contributor with
          access leaves, or on a periodic schedule, whichever comes first.
        </p>
      </LegalSection>

      <LegalSection id="monitoring" title="Monitoring and logging">
        <p>
          The platform writes structured operational logs for every
          dispute synced, every evidence pack built, every Shopify
          mutation, and every webhook processed. Audit events record who
          (merchant, system, internal admin) took what action against
          which resource, with timestamps. Logs are retained alongside the
          dispute record they reference and are available to merchants
          inside the dispute timeline.
        </p>
      </LegalSection>

      <LegalSection id="gdpr-webhooks" title="Shopify GDPR webhook support">
        <p>
          DisputeDesk subscribes to and handles Shopify&apos;s mandatory
          GDPR webhooks: <code>customers/data_request</code>,{" "}
          <code>customers/redact</code>, and <code>shop/redact</code>.
          Each handler verifies the HMAC signature on the request before
          taking any action. The redact handlers are idempotent — a
          redelivered webhook produces the same end state as a single
          delivery. See the <a href="/data-retention">Data Retention</a>{" "}
          page for what each webhook does in detail.
        </p>
      </LegalSection>

      <LegalSection id="merchant-authorized" title="Merchant-authorized access only">
        <p>
          We access Shopify data only inside stores where a merchant has
          installed our app and granted the documented OAuth scopes. We do
          not access Shopify data for stores where the app is not
          installed. We do not aggregate Shopify customer data across
          merchants. We do not sell customer data to anyone. We do not
          train AI models on customer data.
        </p>
      </LegalSection>

      <LegalSection id="incident-response" title="Incident response">
        <p>
          If we become aware of a security incident affecting merchant or
          customer data, we triage the impact, contain the cause, restore
          normal operation, and notify affected merchants without undue
          delay. Notice will include a description of what happened, what
          data was affected, what we have done in response, and what
          merchants should consider doing. We comply with applicable
          breach-notification laws.
        </p>
      </LegalSection>

      <LegalSection id="responsible-disclosure" title="Responsible disclosure">
        <p>
          If you believe you have found a security vulnerability in
          DisputeDesk, please report it to{" "}
          <a href="mailto:security@disputedesk.app">security@disputedesk.app</a>.
          Please give us a reasonable opportunity to investigate and
          remediate before any public disclosure. We commit to:
        </p>
        <ul>
          <li>Acknowledging your report within five business days.</li>
          <li>
            Working with you in good faith to understand the issue and its
            impact.
          </li>
          <li>
            Not taking legal action against researchers who follow this
            process, act in good faith, and avoid privacy violations,
            destruction of data, or service disruption.
          </li>
        </ul>
      </LegalSection>

      <LegalSection id="contact" title="Contact">
        <p>
          Security questions and vulnerability reports:{" "}
          <a href="mailto:security@disputedesk.app">security@disputedesk.app</a>.
        </p>
      </LegalSection>

      <CTAFooter
        title="Have a security question?"
        description="Acknowledged within five business days. Use a different channel if your report is time-sensitive — we monitor the security inbox first."
        primary={{ label: "Email security@disputedesk.app", href: "mailto:security@disputedesk.app" }}
        secondary={{ label: "Read the privacy policy", href: "/privacy" }}
      />
    </LegalPageLayout>
  );
}
