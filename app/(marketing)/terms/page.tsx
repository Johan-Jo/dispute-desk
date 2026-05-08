import type { Metadata } from "next";
import { LegalPageLayout, type LegalPageSection } from "@/components/legal/LegalPageLayout";
import { LegalSection } from "@/components/legal/LegalSection";
import { CTAFooter } from "@/components/legal/CTAFooter";

export const metadata: Metadata = {
  title: "Terms of Service – DisputeDesk",
  description:
    "Terms governing use of DisputeDesk, the Shopify app for automated chargeback evidence generation.",
};

const LAST_UPDATED = "May 7, 2026";

const SECTIONS: LegalPageSection[] = [
  { id: "service-overview", title: "Service overview" },
  { id: "automation", title: "How automation works" },
  { id: "no-guarantee", title: "No guarantee of dispute outcomes" },
  { id: "merchant-responsibilities", title: "Merchant responsibilities" },
  { id: "billing", title: "Subscription and billing" },
  { id: "acceptable-use", title: "Acceptable use" },
  { id: "availability", title: "Service availability" },
  { id: "liability", title: "Limitation of liability" },
  { id: "ip", title: "Intellectual property" },
  { id: "termination", title: "Suspension and termination" },
  { id: "uninstall", title: "Your right to uninstall" },
  { id: "changes", title: "Changes to these terms" },
  { id: "support", title: "Support" },
  { id: "contact", title: "Contact" },
];

export default function TermsPage() {
  return (
    <LegalPageLayout
      title="Terms of Service"
      lastUpdated={LAST_UPDATED}
      sections={SECTIONS}
      intro={
        <p>
          These terms govern your use of DisputeDesk. By installing the app on
          a Shopify store or creating a DisputeDesk account, you agree to them
          on behalf of yourself and the business you represent. They apply
          alongside Shopify&apos;s own merchant terms.
        </p>
      }
    >
      <LegalSection id="service-overview" title="Service overview">
        <p>
          DisputeDesk is a Shopify app and web portal that helps merchants
          generate, review, and submit chargeback evidence to Shopify. It
          reads order, customer, and dispute data from Shopify, assembles a
          structured evidence pack, and saves the pack into the
          merchant&apos;s Shopify dispute response.
        </p>
        <p>
          DisputeDesk does not transmit responses to card networks directly.
          The actual submission to Visa, Mastercard, or other networks
          happens inside Shopify Admin (either when a merchant clicks
          submit, or automatically on the dispute&apos;s due date — Shopify
          decides this).
        </p>
      </LegalSection>

      <LegalSection id="automation" title="How automation works">
        <p>
          DisputeDesk can be configured to build and save evidence packs
          automatically when a new dispute arrives. Automation can be
          enabled per dispute reason family (for example, fraud cases set to
          auto-pack while subscription disputes go to review). When
          automation is on, the system applies merchant-defined rules to
          decide whether to auto-save evidence or park the case for manual
          review. Audit events record every automated action.
        </p>
      </LegalSection>

      <LegalSection id="no-guarantee" title="No guarantee of dispute outcomes">
        <p>
          Chargeback outcomes are decided by the cardholder&apos;s bank and
          the relevant card network. DisputeDesk does not represent that any
          dispute will be won, that win rates will improve, or that a
          particular set of evidence will be accepted. The service helps
          merchants assemble and submit organized evidence efficiently;
          it does not control the result.
        </p>
      </LegalSection>

      <LegalSection id="merchant-responsibilities" title="Merchant responsibilities">
        <ul>
          <li>
            <strong>Accuracy.</strong> Information you provide (uploaded
            files, policies, manual notes) must be truthful and reflect the
            actual transaction. Submitting false evidence may constitute
            fraud and is prohibited.
          </li>
          <li>
            <strong>Authority.</strong> You are responsible for ensuring you
            have the right to submit the data on the connected store and
            that you comply with applicable consumer-protection, privacy,
            and recordkeeping laws.
          </li>
          <li>
            <strong>Account security.</strong> Keep your DisputeDesk
            credentials and any Shopify staff accounts authorized to use
            the app secure.
          </li>
          <li>
            <strong>Customer data.</strong> When DisputeDesk processes
            Shopify customer data on your behalf, you are the data
            controller and remain responsible for honoring data subject
            rights, statutory disclosures, and applicable retention rules.
          </li>
        </ul>
      </LegalSection>

      <LegalSection id="billing" title="Subscription and billing">
        <p>
          DisputeDesk is offered on a subscription basis through Shopify
          Billing. Your plan, included pack quota, and price are shown when
          you subscribe. Subscriptions renew automatically until cancelled.
          You can change or cancel your plan at any time from inside the
          app or Shopify Admin; cancellation takes effect at the end of the
          current billing cycle. We do not offer refunds for partial
          billing cycles unless required by law.
        </p>
      </LegalSection>

      <LegalSection id="acceptable-use" title="Acceptable use">
        <p>You agree not to:</p>
        <ul>
          <li>
            Use the service to submit evidence you know to be false,
            misleading, or fabricated.
          </li>
          <li>
            Attempt to access another merchant&apos;s data, reverse-engineer
            the platform, or interfere with normal operation.
          </li>
          <li>
            Resell, rebrand, or sublicense access to the service without
            our written agreement.
          </li>
          <li>
            Use the service in a way that violates Shopify&apos;s API terms,
            applicable law, or the rights of a third party.
          </li>
        </ul>
      </LegalSection>

      <LegalSection id="availability" title="Service availability">
        <p>
          We aim for high availability but do not guarantee uninterrupted
          service. Maintenance windows, third-party outages (Shopify,
          Supabase, Vercel), and unforeseen incidents may interrupt access.
          The service is provided on an &ldquo;as is&rdquo; and &ldquo;as
          available&rdquo; basis to the maximum extent permitted by law.
        </p>
      </LegalSection>

      <LegalSection id="liability" title="Limitation of liability">
        <p>
          To the maximum extent permitted by law, DisputeDesk is not liable
          for: lost dispute outcomes, lost revenue, lost data, or any
          indirect, incidental, special, consequential, or punitive
          damages arising from your use of the service. Where liability
          cannot be excluded, our aggregate liability is limited to the
          fees you paid us in the twelve months preceding the event giving
          rise to the claim.
        </p>
      </LegalSection>

      <LegalSection id="ip" title="Intellectual property">
        <p>
          DisputeDesk, including the platform, code, branding, and
          documentation, is and remains our intellectual property. You retain
          ownership of the data you upload and the evidence you generate. You
          grant us a limited license to process your data solely as needed to
          deliver the service. We may use de-identified, aggregated metrics
          (e.g. dispute volume per industry) for internal analytics and
          public communication.
        </p>
      </LegalSection>

      <LegalSection id="termination" title="Suspension and termination">
        <p>
          We may suspend or terminate your access if you breach these terms,
          if your account presents a security or legal risk, or if your
          billing fails and is not cured. We will give you reasonable notice
          where practical. Termination does not waive accrued obligations
          (for example, fees already due).
        </p>
      </LegalSection>

      <LegalSection id="uninstall" title="Your right to uninstall">
        <p>
          You may uninstall DisputeDesk from a connected store at any time
          from Shopify Admin. On uninstall, our access to the store ends
          immediately. Shopify sends us a <code>shop/redact</code> webhook
          forty-eight hours later; on receipt we delete all data associated
          with that store.
        </p>
      </LegalSection>

      <LegalSection id="changes" title="Changes to these terms">
        <p>
          We may update these terms from time to time. The &ldquo;Last
          updated&rdquo; date at the top reflects the most recent change.
          Material changes will be highlighted in the app or by email.
          Continued use of the service after a material change constitutes
          acceptance.
        </p>
      </LegalSection>

      <LegalSection id="support" title="Support">
        <p>
          For help with the product, see our <a href="/support">Support</a>{" "}
          page or email{" "}
          <a href="mailto:support@disputedesk.app">support@disputedesk.app</a>.
        </p>
      </LegalSection>

      <LegalSection id="contact" title="Contact">
        <p>
          Questions about these terms:{" "}
          <a href="mailto:support@disputedesk.app">support@disputedesk.app</a>.
          For privacy or data-protection inquiries, see the{" "}
          <a href="/privacy">Privacy Policy</a>.
        </p>
      </LegalSection>

      <CTAFooter
        title="Questions about these terms?"
        description="We're happy to clarify anything in these terms. Most replies go out the same business day."
        primary={{ label: "Email support@disputedesk.app", href: "mailto:support@disputedesk.app" }}
        secondary={{ label: "Read the privacy policy", href: "/privacy" }}
      />
    </LegalPageLayout>
  );
}
