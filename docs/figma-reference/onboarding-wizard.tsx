import React, { useState } from 'react';
import { Check, ChevronRight, ChevronLeft, Shield, Link as LinkIcon, Zap, FileText, X, Search, Bell, Home, ShoppingCart, Package, Users, BarChart, Target, Settings as SettingsIcon, FileCheck, Layers, Upload, Eye, Sparkles } from 'lucide-react';

interface OnboardingWizardProps {
  currentStep: number;
  onStepChange: (step: number) => void;
  onComplete: () => void;
  onSkip: () => void;
  onNavigate?: (path: string) => void;
}

export default function OnboardingWizard({ currentStep, onStepChange, onComplete, onSkip, onNavigate }: OnboardingWizardProps) {
  const [selectedReason, setSelectedReason] = useState<string>('');
  const [selectedGoal, setSelectedGoal] = useState<string>('');
  const [selectedPolicy, setSelectedPolicy] = useState<string>('');
  const [policyChoice, setPolicyChoice] = useState<'own' | 'templates' | 'mix' | ''>('');
  const [mixedPolicies, setMixedPolicies] = useState({
    shipping: 'url' as 'url' | 'upload' | 'template',
    refund: 'url' as 'url' | 'upload' | 'template',
    terms: 'url' as 'url' | 'upload' | 'template',
    privacy: 'url' as 'url' | 'upload' | 'template',
  });
  const [previewTemplate, setPreviewTemplate] = useState<'shipping' | 'refund' | 'terms' | 'privacy' | null>(null);
  const [selectedTemplates, setSelectedTemplates] = useState<{
    shipping: boolean;
    refund: boolean;
    terms: boolean;
    privacy: boolean;
  }>({
    shipping: false,
    refund: false,
    terms: false,
    privacy: false,
  });
  const [showTemplateLibrary, setShowTemplateLibrary] = useState(false);
  const [installedPacks, setInstalledPacks] = useState<string[]>([]);
  const [configuringPack, setConfiguringPack] = useState<string | null>(null);
  const [packWizardStep, setPackWizardStep] = useState<'evidence' | 'sources' | 'review' | 'activate'>('evidence');
  const [selectedEvidence, setSelectedEvidence] = useState<string[]>([
    'order-details', 'customer-info', 'shipping-info', 'product-info', 'policies', 'payment-proof'
  ]);

  const totalSteps = 6;

  const evidencePackTemplates = [
    {
      id: 'quality-issues',
      title: 'Not as Described — Quality Issues',
      description: 'Evidence package for disputes claiming the product does not match its description or has quality defects. Focuses on product listing accuracy, quality control, and return policy compliance.',
    },
    {
      id: 'subscription-canceled',
      title: 'Subscription Canceled — Comprehensive',
      description: 'Evidence package for subscription-related disputes. Covers subscription terms, cancellation policy compliance, usage logs, and notification history.',
    },
    {
      id: 'pnr-with-tracking',
      title: 'Product Not Received — With Tracking',
      description: 'Strong evidence package for PNR disputes when you have carrier tracking showing delivery. Focuses on tracking proof, delivery confirmation, and shipping timeline.',
    },
    {
      id: 'fraudulent-standard',
      title: 'Fraudulent / Unrecognized — Standard',
      description: 'Comprehensive evidence package for fraudulent or unrecognized transaction disputes. Covers AVS match, IP geolocation, delivery confirmation, and customer interaction history.',
    },
    {
      id: 'digital-goods',
      title: 'Digital Goods / Service Delivered',
      description: 'Evidence package for disputes on digital products or services. Focuses on download/access logs, usage records, and delivery confirmation of digital content.',
    },
    {
      id: 'policy-forward',
      title: 'Policy-Forward (Returns / Cancellation / Shipping)',
      description: 'Policy-centric evidence package ideal when your strongest defense is clear, published policies. Collects return, cancellation, and shipping policies with proof of customer acceptance.',
    },
    {
      id: 'general-catch-all',
      title: 'General Catch-all',
      description: 'Flexible evidence package for dispute types that don\'t fit neatly into other categories. Covers order basics, any available shipping data, relevant policies, and customer communication.',
    },
    {
      id: 'pnr-no-tracking',
      title: 'Product Not Received — No Tracking / Weak Proof',
      description: 'Evidence package for PNR disputes where tracking data is unavailable or incomplete. Relies on shipping receipts, policy documentation, and customer interaction records.',
    },
    {
      id: 'credit-not-processed',
      title: 'Refund / Credit Not Processed — Standard',
      description: 'Evidence package for disputes claiming a promised refund or credit was not issued. Focuses on refund policy, processing records, and communication trail.',
    },
    {
      id: 'duplicate-amount',
      title: 'Duplicate / Incorrect Amount',
      description: 'Evidence package for disputes alleging a duplicate charge or incorrect billing amount. Focuses on transaction records, order itemization, and pricing verification.',
    },
  ];

  const steps = [
    { number: 1, title: 'Sync disputes', icon: LinkIcon },
    { number: 2, title: 'Set policies', icon: FileCheck },
    { number: 3, title: 'Generate packs', icon: FileText },
    { number: 4, title: 'Add rules', icon: Zap },
    { number: 5, title: 'Add team', icon: Users },
  ];

  const templateContent = {
    shipping: {
      title: 'Shipping & Delivery Policy',
      description: 'Professional shipping policy template covering processing times, shipping zones, tracking, and delivery expectations',
      content: `# Shipping & Delivery Policy

## Processing Time
Orders are typically processed within 1-2 business days (excluding weekends and holidays) after receiving your order confirmation email. You will receive another notification when your order has shipped.

## Shipping Rates & Delivery Estimates
Shipping charges for your order will be calculated and displayed at checkout.

**Domestic Shipping (United States):**
- Standard Shipping (5-7 business days): $5.99
- Expedited Shipping (2-3 business days): $12.99
- Express Shipping (1-2 business days): $24.99

**International Shipping:**
International shipping times and rates vary by destination and will be calculated at checkout.

## Shipment Confirmation & Order Tracking
You will receive a Shipment Confirmation email once your order has shipped containing your tracking number(s). The tracking number will be active within 24 hours.

## Customs, Duties and Taxes
We are not responsible for any customs and taxes applied to your order. All fees imposed during or after shipping are the responsibility of the customer.

## Damages
We are not liable for any products damaged or lost during shipping. If you received your order damaged, please contact the shipment carrier to file a claim.

## Lost or Stolen Packages
We are not responsible for lost or stolen packages. If your tracking information states that your package was delivered but you have not received it, please contact the shipping carrier.`
    },
    refund: {
      title: 'Returns & Refunds Policy',
      description: 'Professional return/refund policy covering return window, conditions, refund process, and restocking fees',
      content: `# Returns & Refunds Policy

## Return Window
You have 30 calendar days to return an item from the date you received it. To be eligible for a return, your item must be unused and in the same condition that you received it. Your item must be in the original packaging.

## Return Process
To initiate a return, please contact us at returns@yourstore.com with your order number and reason for return. We will provide you with a return authorization and shipping instructions.

**Return Shipping:**
You will be responsible for paying for your own shipping costs for returning your item. Shipping costs are non-refundable. If you receive a refund, the cost of return shipping will be deducted from your refund.

## Refund Processing
Once we receive your item, we will inspect it and notify you that we have received your returned item. We will immediately notify you on the status of your refund after inspecting the item.

If your return is approved, we will initiate a refund to your original method of payment. You will receive the credit within 5-10 business days, depending on your card issuer's policies.

## Non-Returnable Items
The following items cannot be returned:
- Gift cards
- Downloadable software products
- Personal care items
- Items marked as final sale

## Exchanges
We only replace items if they are defective or damaged. If you need to exchange it for the same item, contact us at returns@yourstore.com.

## Restocking Fee
A 15% restocking fee may be applied to returns of opened or used items.`
    },
    terms: {
      title: 'Terms of Service',
      description: 'Professional terms of service covering usage rights, account terms, prohibited conduct, and legal disclaimers',
      content: `# Terms of Service

## Agreement to Terms
By accessing and using this website, you accept and agree to be bound by the terms and provision of this agreement.

## Use License
Permission is granted to temporarily download one copy of the materials on our website for personal, non-commercial transitory viewing only. This is the grant of a license, not a transfer of title, and under this license you may not:
- Modify or copy the materials
- Use the materials for any commercial purpose or for any public display
- Attempt to reverse engineer any software contained on our website
- Remove any copyright or other proprietary notations from the materials
- Transfer the materials to another person or "mirror" the materials on any other server

## Account Terms
If you create an account on our website, you are responsible for maintaining the security of your account and you are fully responsible for all activities that occur under the account. You must immediately notify us of any unauthorized uses of your account or any other breaches of security.

## Prohibited Conduct
You agree not to use our website to:
- Violate any applicable law or regulation
- Infringe upon the rights of others
- Distribute spam or unsolicited messages
- Upload or transmit viruses or malicious code
- Attempt to gain unauthorized access to our systems

## Disclaimer
The materials on our website are provided on an 'as is' basis. We make no warranties, expressed or implied, and hereby disclaim and negate all other warranties including, without limitation, implied warranties or conditions of merchantability, fitness for a particular purpose, or non-infringement of intellectual property or other violation of rights.

## Limitations
In no event shall our company or its suppliers be liable for any damages (including, without limitation, damages for loss of data or profit, or due to business interruption) arising out of the use or inability to use our website.

## Revisions
We may revise these terms of service at any time without notice. By using this website you are agreeing to be bound by the then current version of these terms of service.`
    },
    privacy: {
      title: 'Privacy Policy',
      description: 'Professional privacy policy covering data collection, usage, storage, third-party sharing, and user rights',
      content: `# Privacy Policy

## Information We Collect
We collect information from you when you register on our site, place an order, subscribe to our newsletter, or fill out a form. When ordering or registering, you may be asked to enter your name, email address, mailing address, phone number, or credit card information.

## How We Use Your Information
We may use the information we collect from you in the following ways:
- To personalize your experience and respond to your individual needs
- To improve our website offerings based on your feedback
- To process transactions quickly and efficiently
- To send periodic emails regarding your order or other products and services
- To administer a contest, promotion, survey or other site feature

## Data Protection
We implement a variety of security measures to maintain the safety of your personal information. We use secure servers and encrypt sensitive information transmitted online. Your personal information is contained behind secured networks and is only accessible by a limited number of persons who have special access rights.

## Third-Party Disclosure
We do not sell, trade, or otherwise transfer your personally identifiable information to outside parties unless we provide users with advance notice. This does not include website hosting partners and other parties who assist us in operating our website, conducting our business, or serving our users, so long as those parties agree to keep this information confidential.

## Third-Party Links
Occasionally, at our discretion, we may include or offer third-party products or services on our website. These third-party sites have separate and independent privacy policies. We have no responsibility or liability for the content and activities of these linked sites.

## Cookies
We use cookies to help us remember and process the items in your shopping cart, understand and save your preferences for future visits, and compile aggregate data about site traffic and interaction.

## Your Rights
You have the right to:
- Access the personal data we hold about you
- Request correction of inaccurate data
- Request deletion of your data
- Object to processing of your data
- Request restriction of processing
- Data portability

To exercise these rights, please contact us at privacy@yourstore.com.

## Changes to This Policy
We reserve the right to update this privacy policy at any time. When we do, we will revise the updated date at the bottom of this page. We encourage you to check this page periodically for changes.

Last Updated: ${new Date().toLocaleDateString()}`
    }
  };

  const handleNext = () => {
    if (currentStep < totalSteps) {
      onStepChange(currentStep + 1);
    } else {
      onComplete();
    }
  };

  const handleBack = () => {
    if (currentStep > 0) {
      onStepChange(currentStep - 1);
    }
  };

  return (
    <div className="min-h-screen bg-[#F1F2F4]">
      {/* Shopify Top Bar */}
      <div className="bg-[#1A1A1A] text-white h-14 flex items-center px-4 border-b border-[#303030]">
        <div className="flex items-center gap-4 flex-1">
          {/* Shopify Logo */}
          <svg className="w-8 h-8" viewBox="0 0 32 32" fill="currentColor">
            <path d="M24.373 9.076c-.024-.165-.154-.265-.293-.265-.024 0-2.482-.13-2.482-.13s-1.61-1.564-1.78-1.733c-.172-.17-.507-.118-.64-.082 0 0-.32.1-.857.268-.078-.23-.186-.517-.332-.824-.455-1.013-1.127-1.55-1.942-1.55-.055 0-.112.006-.17.012-.03-.04-.062-.078-.096-.116C15.276 3.923 14.556 3.61 13.66 3.61c-1.775 0-3.526 1.326-4.93 3.732-.99 1.694-1.738 3.81-1.942 5.49-1.67.516-2.842.877-2.876.89-.848.264-.872.29-.982 1.087C2.843 15.44 0 30.824 0 30.824l19.26 3.334 9.003-2.224s-3.865-26.31-3.89-26.474zM17.97 7.74c-.48.15-.997.31-1.545.478V7.82c0-.842-.115-1.52-.306-2.062.825.12 1.43.976 1.85 1.983zm-3.116-.733c-.266.824-.61 1.752-.997 2.697-.76-2.915-2.063-4.32-3.014-4.83.206-.013.403-.02.59-.02 1.478 0 2.595.76 3.42 2.153zm-4.818.24c-.69.216-1.44.45-2.233.696.673-2.597 1.938-3.85 3.25-4.315-.668.642-1.372 1.91-2.017 3.62z"/>
          </svg>
          
          {/* Search */}
          <div className="flex-1 max-w-md">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search"
                className="w-full bg-[#303030] border border-[#404040] rounded-lg pl-10 pr-4 py-1.5 text-sm text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#008060]"
              />
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <button className="text-gray-300 hover:text-white">
            <Bell className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 bg-[#5E4DB2] rounded-full flex items-center justify-center text-xs font-semibold">
              SE
            </div>
            <span className="text-sm">saraeverine</span>
          </div>
        </div>
      </div>

      <div className="flex">
        {/* Shopify Left Sidebar */}
        <div className="w-60 bg-[#F7F8FA] border-r border-[#E1E3E5] min-h-[calc(100vh-56px)]">
          <nav className="p-2">
            <div className="mb-6">
              <div className="space-y-0.5">
                {[
                  { icon: Home, label: 'Home' },
                  { icon: ShoppingCart, label: 'Orders' },
                  { icon: Package, label: 'Products' },
                  { icon: Users, label: 'Customers' },
                  { icon: BarChart, label: 'Analytics' },
                ].map((item) => (
                  <button
                    key={item.label}
                    className="w-full flex items-center gap-3 px-3 py-2 text-sm text-[#202223] hover:bg-[#E3E5E7] rounded-lg transition-colors"
                  >
                    <item.icon className="w-5 h-5 text-[#6D7175]" />
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Apps Section */}
            <div className="mb-3">
              <button className="w-full flex items-center justify-between px-3 py-2 text-sm text-[#6D7175] hover:text-[#202223] transition-colors">
                <span className="font-medium">Apps</span>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>

            {/* DisputeDesk App */}
            <div className="mb-3">
              <div className="flex items-center justify-between px-3 py-2 bg-[#E3E5E7] rounded-lg">
                <div className="flex items-center gap-2">
                  <Shield className="w-4 h-4 text-[#6D7175]" />
                  <span className="text-sm font-medium text-[#202223]">DisputeDesk</span>
                </div>
                <button className="text-[#6D7175] hover:text-[#202223]">
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Setup Progress Indicator */}
            <div className="pl-3">
              <div className="px-3 py-2 text-xs text-[#6D7175] bg-[#FFF9E6] rounded-lg border border-[#E3D18A]">
                <div className="flex items-center gap-2 mb-1">
                  <div className="w-3 h-3 border-2 border-[#D97706] border-t-transparent rounded-full animate-spin"></div>
                  <span className="font-medium text-[#202223]">Setup in progress</span>
                </div>
                <div className="text-[#6D7175]">Step {currentStep} of {totalSteps}</div>
              </div>
            </div>
          </nav>
        </div>

        {/* Main Content Area */}
        <div className="flex-1 min-h-[calc(100vh-56px)] overflow-y-auto bg-[#F1F2F4]">
          <div className="max-w-4xl mx-auto px-8 py-12">
            {/* Progress Steps */}
            <div className="mb-12">
              <div className="flex items-center justify-between mb-3">
                {steps.map((step, index) => {
                  const Icon = step.icon;
                  const isActive = currentStep === step.number;
                  const isCompleted = currentStep > step.number;

                  return (
                    <div key={step.number} className="flex items-center flex-1 last:flex-none">
                      <div className="flex flex-col items-center">
                        <div
                          className={`w-10 h-10 rounded-full flex items-center justify-center mb-2 transition-colors ${
                            isCompleted
                              ? 'bg-[#059669] text-white'
                              : isActive
                              ? 'bg-[#1D4ED8] text-white'
                              : 'bg-white border-2 border-[#E1E3E5] text-[#8C9196]'
                          }`}
                        >
                          {isCompleted ? (
                            <Check className="w-5 h-5" />
                          ) : (
                            <Icon className="w-5 h-5" />
                          )}
                        </div>
                        <span
                          className={`text-xs font-medium ${
                            isActive ? 'text-[#202223]' : 'text-[#8C9196]'
                          }`}
                        >
                          {step.title}
                        </span>
                      </div>
                      {index < steps.length - 1 && (
                        <div className="flex-1 h-0.5 bg-[#E1E3E5] mx-4 mb-8">
                          <div
                            className="h-full bg-[#059669] transition-all duration-300"
                            style={{ width: isCompleted ? '100%' : '0%' }}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Step Content */}
            <div className="bg-white border border-[#E1E3E5] rounded-lg shadow-sm p-8">
              {/* Step 0: Welcome Screen */}
              {currentStep === 0 && (
                <div className="max-w-2xl mx-auto">
                  <div className="text-center mb-10">
                    <div className="w-20 h-20 bg-gradient-to-br from-[#1D4ED8] to-[#1e40af] rounded-2xl flex items-center justify-center mx-auto mb-6">
                      <Shield className="w-10 h-10 text-white" />
                    </div>
                    <h1 className="text-3xl font-semibold text-[#202223] mb-3">
                      Welcome to DisputeDesk
                    </h1>
                    <p className="text-lg text-[#6D7175]">
                      Let's get you set up in just a few minutes
                    </p>
                  </div>

                  <div className="bg-[#F7F8FA] border border-[#E1E3E5] rounded-lg p-6 mb-8">
                    <h3 className="text-base font-semibold text-[#202223] mb-4">
                      What you'll accomplish in this setup:
                    </h3>
                    <div className="space-y-4">
                      <div className="flex items-start gap-3">
                        <div className="w-6 h-6 bg-[#1D4ED8] text-white rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">
                          1
                        </div>
                        <div>
                          <p className="text-sm font-medium text-[#202223]">Sync your disputes</p>
                          <p className="text-xs text-[#6D7175] mt-0.5">
                            Import existing disputes from your Shopify store
                          </p>
                        </div>
                      </div>

                      <div className="flex items-start gap-3">
                        <div className="w-6 h-6 bg-[#1D4ED8] text-white rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">
                          2
                        </div>
                        <div>
                          <p className="text-sm font-medium text-[#202223]">Add your business policies</p>
                          <p className="text-xs text-[#6D7175] mt-0.5">
                            Link shipping, refund, and other policies for evidence packs
                          </p>
                        </div>
                      </div>

                      <div className="flex items-start gap-3">
                        <div className="w-6 h-6 bg-[#1D4ED8] text-white rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">
                          3
                        </div>
                        <div>
                          <p className="text-sm font-medium text-[#202223]">Generate evidence packs</p>
                          <p className="text-xs text-[#6D7175] mt-0.5">
                            Create templates for organizing dispute evidence
                          </p>
                        </div>
                      </div>

                      <div className="flex items-start gap-3">
                        <div className="w-6 h-6 bg-[#1D4ED8] text-white rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">
                          4
                        </div>
                        <div>
                          <p className="text-sm font-medium text-[#202223]">Set up automation rules</p>
                          <p className="text-xs text-[#6D7175] mt-0.5">
                            Automatically route disputes based on type and criteria
                          </p>
                        </div>
                      </div>

                      <div className="flex items-start gap-3">
                        <div className="w-6 h-6 bg-[#1D4ED8] text-white rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">
                          5
                        </div>
                        <div>
                          <p className="text-sm font-medium text-[#202223]">Invite your team</p>
                          <p className="text-xs text-[#6D7175] mt-0.5">
                            Add team members to collaborate on dispute management
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-4 mb-8">
                    <div className="text-center p-4 border border-[#E1E3E5] rounded-lg">
                      <div className="text-2xl font-bold text-[#1D4ED8] mb-1">5 mins</div>
                      <div className="text-xs text-[#6D7175]">Setup time</div>
                    </div>
                    <div className="text-center p-4 border border-[#E1E3E5] rounded-lg">
                      <div className="text-2xl font-bold text-[#1D4ED8] mb-1">5 steps</div>
                      <div className="text-xs text-[#6D7175]">To complete</div>
                    </div>
                    <div className="text-center p-4 border border-[#E1E3E5] rounded-lg">
                      <div className="text-2xl font-bold text-[#1D4ED8] mb-1">100%</div>
                      <div className="text-xs text-[#6D7175]">Automated</div>
                    </div>
                  </div>

                  <div className="bg-[#EFF6FF] border border-[#BFDBFE] rounded-lg p-5">
                    <div className="flex items-start gap-3">
                      <svg className="w-5 h-5 text-[#1D4ED8] flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <div>
                        <h4 className="text-sm font-semibold text-[#1E40AF] mb-1">
                          You can skip any step
                        </h4>
                        <p className="text-sm text-[#1E40AF]">
                          All settings can be configured later from the Settings page. This wizard helps you get started quickly.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Step 1: Sync disputes */}
              {currentStep === 1 && (
                <div className="max-w-2xl mx-auto">
                  <div className="text-center mb-8">
                    <div className="w-16 h-16 bg-gradient-to-br from-[#059669] to-[#10B981] rounded-2xl flex items-center justify-center mx-auto mb-4">
                      <Check className="w-8 h-8 text-white" />
                    </div>
                    <h2 className="text-2xl font-semibold text-[#202223] mb-2">
                      Disputes synced successfully
                    </h2>
                    <p className="text-base text-[#6D7175]">
                      We've imported your existing disputes from Shopify
                    </p>
                  </div>

                  <div className="border border-[#BBF7D0] bg-[#F0FDF4] rounded-lg p-6 mb-6">
                    <div className="flex items-start gap-4">
                      <div className="w-12 h-12 bg-[#059669] rounded-full flex items-center justify-center flex-shrink-0">
                        <Check className="w-6 h-6 text-white" />
                      </div>
                      <div className="flex-1">
                        <h3 className="text-base font-semibold text-[#065F46] mb-2">
                          Successfully synced!
                        </h3>
                        <p className="text-sm text-[#047857] mb-3">
                          We found <strong>12 disputes</strong> in your Shopify store. These are now available in DisputeDesk.
                        </p>
                        <div className="bg-white/60 rounded-lg p-3 text-xs text-[#047857]">
                          <div className="flex justify-between mb-1">
                            <span>Total disputes:</span>
                            <span className="font-semibold">12</span>
                          </div>
                          <div className="flex justify-between">
                            <span>Last sync:</span>
                            <span className="font-semibold">Just now</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3 mb-6">
                    <div className="flex items-center justify-between p-4 rounded-lg border border-[#BBF7D0] bg-[#F0FDF4]">
                      <div className="flex items-center gap-3">
                        <Check className="w-5 h-5 text-[#059669]" />
                        <div>
                          <div className="font-medium text-[#065F46]">Fraudulent</div>
                          <div className="text-sm text-[#047857]">5 disputes found</div>
                        </div>
                      </div>
                      <div className="px-2 py-1 rounded text-xs font-medium bg-[#059669] text-white">
                        Synced
                      </div>
                    </div>

                    <div className="flex items-center justify-between p-4 rounded-lg border border-[#BBF7D0] bg-[#F0FDF4]">
                      <div className="flex items-center gap-3">
                        <Check className="w-5 h-5 text-[#059669]" />
                        <div>
                          <div className="font-medium text-[#065F46]">Product not received</div>
                          <div className="text-sm text-[#047857]">4 disputes found</div>
                        </div>
                      </div>
                      <div className="px-2 py-1 rounded text-xs font-medium bg-[#059669] text-white">
                        Synced
                      </div>
                    </div>

                    <div className="flex items-center justify-between p-4 rounded-lg border border-[#BBF7D0] bg-[#F0FDF4]">
                      <div className="flex items-center gap-3">
                        <Check className="w-5 h-5 text-[#059669]" />
                        <div>
                          <div className="font-medium text-[#065F46]">Product unacceptable</div>
                          <div className="text-sm text-[#047857]">2 disputes found</div>
                        </div>
                      </div>
                      <div className="px-2 py-1 rounded text-xs font-medium bg-[#059669] text-white">
                        Synced
                      </div>
                    </div>

                    <div className="flex items-center justify-between p-4 rounded-lg border border-[#BBF7D0] bg-[#F0FDF4]">
                      <div className="flex items-center gap-3">
                        <Check className="w-5 h-5 text-[#059669]" />
                        <div>
                          <div className="font-medium text-[#065F46]">Credit not processed</div>
                          <div className="text-sm text-[#047857]">1 dispute found</div>
                        </div>
                      </div>
                      <div className="px-2 py-1 rounded text-xs font-medium bg-[#059669] text-white">
                        Synced
                      </div>
                    </div>
                  </div>

                  <div className="bg-[#F7F8FA] border border-[#E1E3E5] rounded-lg p-4">
                    <div className="flex items-start gap-3">
                      <svg className="w-5 h-5 text-[#1D4ED8] flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <div>
                        <h4 className="text-sm font-semibold text-[#202223] mb-1">
                          Auto-sync enabled
                        </h4>
                        <p className="text-sm text-[#6D7175]">
                          New disputes will automatically sync to DisputeDesk when they arrive in Shopify.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Step 2: Set policies */}
              {currentStep === 2 && (
                <div className="max-w-2xl mx-auto">
                  <div className="text-center mb-8">
                    <div className="w-16 h-16 bg-gradient-to-br from-[#F59E0B] to-[#D97706] rounded-2xl flex items-center justify-center mx-auto mb-4">
                      <FileCheck className="w-8 h-8 text-white" />
                    </div>
                    <h2 className="text-2xl font-semibold text-[#202223] mb-2">
                      Add business policies
                    </h2>
                    <p className="text-base text-[#6D7175]">
                      Choose how you want to handle your store policies
                    </p>
                  </div>

                  {!policyChoice && (
                    <>
                      {/* Choice Cards */}
                      <div className="grid grid-cols-3 gap-4 mb-6">
                        <button
                          onClick={() => setPolicyChoice('own')}
                          className="border-2 border-[#E1E3E5] rounded-lg p-5 text-center hover:border-[#1D4ED8] hover:bg-[#EFF6FF] transition-all group"
                        >
                          <div className="w-12 h-12 bg-[#F7F8FA] group-hover:bg-[#1D4ED8] rounded-lg flex items-center justify-center mx-auto mb-3 transition-colors">
                            <LinkIcon className="w-6 h-6 text-[#6D7175] group-hover:text-white transition-colors" />
                          </div>
                          <h3 className="text-sm font-semibold text-[#202223] mb-1.5">
                            Use your own
                          </h3>
                          <p className="text-xs text-[#6D7175]">
                            Link existing policy pages
                          </p>
                        </button>

                        <button
                          onClick={() => setPolicyChoice('templates')}
                          className="border-2 border-[#E1E3E5] rounded-lg p-5 text-center hover:border-[#1D4ED8] hover:bg-[#EFF6FF] transition-all group"
                        >
                          <div className="w-12 h-12 bg-[#F7F8FA] group-hover:bg-[#1D4ED8] rounded-lg flex items-center justify-center mx-auto mb-3 transition-colors">
                            <Zap className="w-6 h-6 text-[#6D7175] group-hover:text-white transition-colors" />
                          </div>
                          <h3 className="text-sm font-semibold text-[#202223] mb-1.5">
                            Use templates
                          </h3>
                          <p className="text-xs text-[#6D7175]">
                            Generate professional policies
                          </p>
                        </button>

                        <button
                          onClick={() => setPolicyChoice('mix')}
                          className="border-2 border-[#E1E3E5] rounded-lg p-5 text-center hover:border-[#1D4ED8] hover:bg-[#EFF6FF] transition-all group"
                        >
                          <div className="w-12 h-12 bg-[#F7F8FA] group-hover:bg-[#1D4ED8] rounded-lg flex items-center justify-center mx-auto mb-3 transition-colors">
                            <Layers className="w-6 h-6 text-[#6D7175] group-hover:text-white transition-colors" />
                          </div>
                          <h3 className="text-sm font-semibold text-[#202223] mb-1.5">
                            Mix & match
                          </h3>
                          <p className="text-xs text-[#6D7175]">
                            Combine your own and templates
                          </p>
                        </button>
                      </div>

                      <div className="bg-[#F7F8FA] border border-[#E1E3E5] rounded-lg p-4">
                        <div className="flex items-start gap-3">
                          <svg className="w-5 h-5 text-[#6D7175] flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          <div>
                            <h4 className="text-sm font-semibold text-[#202223] mb-1">
                              Why policies matter
                            </h4>
                            <p className="text-sm text-[#6D7175]">
                              Store policies are automatically included in evidence packs to strengthen your dispute responses and demonstrate clear terms to customers.
                            </p>
                          </div>
                        </div>
                      </div>
                    </>
                  )}

                  {/* Own Policies Form */}
                  {policyChoice === 'own' && (
                    <>
                      <div className="mb-6">
                        <button
                          onClick={() => setPolicyChoice('')}
                          className="flex items-center gap-2 text-sm text-[#1D4ED8] hover:text-[#1e40af] transition-colors"
                        >
                          <ChevronLeft className="w-4 h-4" />
                          Back to options
                        </button>
                      </div>

                      <div className="bg-[#EFF6FF] border border-[#BFDBFE] rounded-lg p-5 mb-6">
                        <div className="flex items-start gap-3">
                          <div className="w-10 h-10 bg-[#1D4ED8] rounded-full flex items-center justify-center flex-shrink-0">
                            <LinkIcon className="w-5 h-5 text-white" />
                          </div>
                          <div className="flex-1">
                            <h3 className="text-sm font-semibold text-[#1E40AF] mb-1">
                              Link or upload your policies
                            </h3>
                            <p className="text-sm text-[#1E40AF]">
                              Provide a URL to your policy page or upload a PDF/document for each policy.
                            </p>
                          </div>
                        </div>
                      </div>

                      <div className="space-y-5 mb-6">
                        {/* Shipping Policy */}
                        <div className="border border-[#E1E3E5] rounded-lg p-4">
                          <div className="flex items-start justify-between mb-3">
                            <div>
                              <h4 className="text-sm font-semibold text-[#202223] mb-1">
                                Shipping Policy
                                <span className="text-[#DC2626] ml-1">*</span>
                              </h4>
                              <p className="text-xs text-[#6D7175]">
                                Required for "Product not received" disputes
                              </p>
                            </div>
                          </div>

                          <div className="flex gap-2 mb-3">
                            <button
                              onClick={() => setMixedPolicies({ ...mixedPolicies, shipping: 'url' })}
                              className={`flex-1 px-3 py-2 border-2 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-2 ${
                                mixedPolicies.shipping === 'url'
                                  ? 'border-[#1D4ED8] bg-[#EFF6FF] text-[#1D4ED8]'
                                  : 'border-[#E1E3E5] text-[#6D7175] hover:border-[#C9CCCF]'
                              }`}
                            >
                              <LinkIcon className="w-4 h-4" />
                              Link URL
                            </button>
                            <button
                              onClick={() => setMixedPolicies({ ...mixedPolicies, shipping: 'upload' })}
                              className={`flex-1 px-3 py-2 border-2 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-2 ${
                                mixedPolicies.shipping === 'upload'
                                  ? 'border-[#1D4ED8] bg-[#EFF6FF] text-[#1D4ED8]'
                                  : 'border-[#E1E3E5] text-[#6D7175] hover:border-[#C9CCCF]'
                              }`}
                            >
                              <Upload className="w-4 h-4" />
                              Upload file
                            </button>
                          </div>

                          {mixedPolicies.shipping === 'url' && (
                            <input
                              type="url"
                              placeholder="https://saraeverine.myshopify.com/policies/shipping"
                              className="w-full px-4 py-2.5 border border-[#C9CCCF] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#008060] focus:border-transparent"
                            />
                          )}
                          {mixedPolicies.shipping === 'upload' && (
                            <div className="border-2 border-dashed border-[#C9CCCF] rounded-lg p-6 text-center hover:border-[#1D4ED8] hover:bg-[#F7F8FA] transition-all cursor-pointer">
                              <Upload className="w-8 h-8 text-[#6D7175] mx-auto mb-2" />
                              <p className="text-sm font-medium text-[#202223] mb-1">Click to upload or drag and drop</p>
                              <p className="text-xs text-[#6D7175]">PDF, DOC, or DOCX (max 5MB)</p>
                            </div>
                          )}
                        </div>

                        {/* Return/Refund Policy */}
                        <div className="border border-[#E1E3E5] rounded-lg p-4">
                          <div className="flex items-start justify-between mb-3">
                            <div>
                              <h4 className="text-sm font-semibold text-[#202223] mb-1">
                                Return/Refund Policy
                                <span className="text-[#DC2626] ml-1">*</span>
                              </h4>
                              <p className="text-xs text-[#6D7175]">
                                Required for "Product unacceptable" disputes
                              </p>
                            </div>
                          </div>

                          <div className="flex gap-2 mb-3">
                            <button
                              onClick={() => setMixedPolicies({ ...mixedPolicies, refund: 'url' })}
                              className={`flex-1 px-3 py-2 border-2 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-2 ${
                                mixedPolicies.refund === 'url'
                                  ? 'border-[#1D4ED8] bg-[#EFF6FF] text-[#1D4ED8]'
                                  : 'border-[#E1E3E5] text-[#6D7175] hover:border-[#C9CCCF]'
                              }`}
                            >
                              <LinkIcon className="w-4 h-4" />
                              Link URL
                            </button>
                            <button
                              onClick={() => setMixedPolicies({ ...mixedPolicies, refund: 'upload' })}
                              className={`flex-1 px-3 py-2 border-2 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-2 ${
                                mixedPolicies.refund === 'upload'
                                  ? 'border-[#1D4ED8] bg-[#EFF6FF] text-[#1D4ED8]'
                                  : 'border-[#E1E3E5] text-[#6D7175] hover:border-[#C9CCCF]'
                              }`}
                            >
                              <Upload className="w-4 h-4" />
                              Upload file
                            </button>
                          </div>

                          {mixedPolicies.refund === 'url' && (
                            <input
                              type="url"
                              placeholder="https://saraeverine.myshopify.com/policies/refunds"
                              className="w-full px-4 py-2.5 border border-[#C9CCCF] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#008060] focus:border-transparent"
                            />
                          )}
                          {mixedPolicies.refund === 'upload' && (
                            <div className="border-2 border-dashed border-[#C9CCCF] rounded-lg p-6 text-center hover:border-[#1D4ED8] hover:bg-[#F7F8FA] transition-all cursor-pointer">
                              <Upload className="w-8 h-8 text-[#6D7175] mx-auto mb-2" />
                              <p className="text-sm font-medium text-[#202223] mb-1">Click to upload or drag and drop</p>
                              <p className="text-xs text-[#6D7175]">PDF, DOC, or DOCX (max 5MB)</p>
                            </div>
                          )}
                        </div>

                        {/* Terms of Service */}
                        <div className="border border-[#E1E3E5] rounded-lg p-4">
                          <div className="flex items-start justify-between mb-3">
                            <div>
                              <h4 className="text-sm font-semibold text-[#202223] mb-1">
                                Terms of Service
                              </h4>
                              <p className="text-xs text-[#6D7175]">
                                Optional - Included in all evidence packs
                              </p>
                            </div>
                          </div>

                          <div className="flex gap-2 mb-3">
                            <button
                              onClick={() => setMixedPolicies({ ...mixedPolicies, terms: 'url' })}
                              className={`flex-1 px-3 py-2 border-2 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-2 ${
                                mixedPolicies.terms === 'url'
                                  ? 'border-[#1D4ED8] bg-[#EFF6FF] text-[#1D4ED8]'
                                  : 'border-[#E1E3E5] text-[#6D7175] hover:border-[#C9CCCF]'
                              }`}
                            >
                              <LinkIcon className="w-4 h-4" />
                              Link URL
                            </button>
                            <button
                              onClick={() => setMixedPolicies({ ...mixedPolicies, terms: 'upload' })}
                              className={`flex-1 px-3 py-2 border-2 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-2 ${
                                mixedPolicies.terms === 'upload'
                                  ? 'border-[#1D4ED8] bg-[#EFF6FF] text-[#1D4ED8]'
                                  : 'border-[#E1E3E5] text-[#6D7175] hover:border-[#C9CCCF]'
                              }`}
                            >
                              <Upload className="w-4 h-4" />
                              Upload file
                            </button>
                          </div>

                          {mixedPolicies.terms === 'url' && (
                            <input
                              type="url"
                              placeholder="https://saraeverine.myshopify.com/policies/terms"
                              className="w-full px-4 py-2.5 border border-[#C9CCCF] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#008060] focus:border-transparent"
                            />
                          )}
                          {mixedPolicies.terms === 'upload' && (
                            <div className="border-2 border-dashed border-[#C9CCCF] rounded-lg p-6 text-center hover:border-[#1D4ED8] hover:bg-[#F7F8FA] transition-all cursor-pointer">
                              <Upload className="w-8 h-8 text-[#6D7175] mx-auto mb-2" />
                              <p className="text-sm font-medium text-[#202223] mb-1">Click to upload or drag and drop</p>
                              <p className="text-xs text-[#6D7175]">PDF, DOC, or DOCX (max 5MB)</p>
                            </div>
                          )}
                        </div>

                        {/* Privacy Policy */}
                        <div className="border border-[#E1E3E5] rounded-lg p-4">
                          <div className="flex items-start justify-between mb-3">
                            <div>
                              <h4 className="text-sm font-semibold text-[#202223] mb-1">
                                Privacy Policy
                              </h4>
                              <p className="text-xs text-[#6D7175]">
                                Optional - Shows data protection commitment
                              </p>
                            </div>
                          </div>

                          <div className="flex gap-2 mb-3">
                            <button
                              onClick={() => setMixedPolicies({ ...mixedPolicies, privacy: 'url' })}
                              className={`flex-1 px-3 py-2 border-2 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-2 ${
                                mixedPolicies.privacy === 'url'
                                  ? 'border-[#1D4ED8] bg-[#EFF6FF] text-[#1D4ED8]'
                                  : 'border-[#E1E3E5] text-[#6D7175] hover:border-[#C9CCCF]'
                              }`}
                            >
                              <LinkIcon className="w-4 h-4" />
                              Link URL
                            </button>
                            <button
                              onClick={() => setMixedPolicies({ ...mixedPolicies, privacy: 'upload' })}
                              className={`flex-1 px-3 py-2 border-2 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-2 ${
                                mixedPolicies.privacy === 'upload'
                                  ? 'border-[#1D4ED8] bg-[#EFF6FF] text-[#1D4ED8]'
                                  : 'border-[#E1E3E5] text-[#6D7175] hover:border-[#C9CCCF]'
                              }`}
                            >
                              <Upload className="w-4 h-4" />
                              Upload file
                            </button>
                          </div>

                          {mixedPolicies.privacy === 'url' && (
                            <input
                              type="url"
                              placeholder="https://saraeverine.myshopify.com/policies/privacy"
                              className="w-full px-4 py-2.5 border border-[#C9CCCF] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#008060] focus:border-transparent"
                            />
                          )}
                          {mixedPolicies.privacy === 'upload' && (
                            <div className="border-2 border-dashed border-[#C9CCCF] rounded-lg p-6 text-center hover:border-[#1D4ED8] hover:bg-[#F7F8FA] transition-all cursor-pointer">
                              <Upload className="w-8 h-8 text-[#6D7175] mx-auto mb-2" />
                              <p className="text-sm font-medium text-[#202223] mb-1">Click to upload or drag and drop</p>
                              <p className="text-xs text-[#6D7175]">PDF, DOC, or DOCX (max 5MB)</p>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="bg-[#EFF6FF] border border-[#BFDBFE] rounded-lg p-4">
                        <div className="flex items-start gap-3">
                          <svg className="w-5 h-5 text-[#1D4ED8] flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          <div>
                            <h4 className="text-sm font-semibold text-[#1E40AF] mb-1">
                              Your policies are automatically included
                            </h4>
                            <p className="text-sm text-[#1E40AF]">
                              DisputeDesk will attach the relevant policies to each evidence pack based on the dispute type.
                            </p>
                          </div>
                        </div>
                      </div>
                    </>
                  )}

                  {/* Template Option */}
                  {policyChoice === 'templates' && (
                    <>
                      <div className="mb-6">
                        <button
                          onClick={() => setPolicyChoice('')}
                          className="flex items-center gap-2 text-sm text-[#1D4ED8] hover:text-[#1e40af] transition-colors"
                        >
                          <ChevronLeft className="w-4 h-4" />
                          Back to options
                        </button>
                      </div>

                      <div className="bg-[#EFF6FF] border border-[#BFDBFE] rounded-lg p-5 mb-6">
                        <div className="flex items-start gap-3">
                          <div className="w-10 h-10 bg-[#1D4ED8] rounded-full flex items-center justify-center flex-shrink-0">
                            <Zap className="w-5 h-5 text-white" />
                          </div>
                          <div className="flex-1">
                            <h3 className="text-sm font-semibold text-[#1E40AF] mb-1">
                              Professional policy templates
                            </h3>
                            <p className="text-sm text-[#1E40AF]">
                              Our templates are professionally written and cover all essential points for chargeback protection. Customize them to match your business.
                            </p>
                          </div>
                        </div>
                      </div>

                      <div className="space-y-3 mb-6">
                        <div className="border border-[#E1E3E5] rounded-lg p-4 hover:border-[#1D4ED8] transition-colors">
                          <div className="flex items-start justify-between mb-3">
                            <div className="flex items-start gap-3">
                              <FileText className="w-5 h-5 text-[#1D4ED8] flex-shrink-0 mt-0.5" />
                              <div>
                                <h4 className="text-sm font-semibold text-[#202223] mb-1">
                                  Shipping & Delivery Policy
                                </h4>
                                <p className="text-xs text-[#6D7175]">
                                  Processing times, shipping zones, tracking, and delivery expectations
                                </p>
                              </div>
                            </div>
                            <span className="px-2 py-1 bg-[#DCFCE7] text-[#059669] text-xs font-medium rounded flex-shrink-0">
                              Required
                            </span>
                          </div>
                          <div className="flex gap-2">
                            <button 
                              onClick={() => setPreviewTemplate('shipping')}
                              className="flex-1 px-4 py-2 bg-[#F7F8FA] hover:bg-[#E1E3E5] border border-[#E1E3E5] text-sm font-medium text-[#202223] rounded-lg transition-colors"
                            >
                              Preview Template
                            </button>
                            <button 
                              onClick={() => setSelectedTemplates({ ...selectedTemplates, shipping: !selectedTemplates.shipping })}
                              className={`flex-1 px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                                selectedTemplates.shipping
                                  ? 'bg-[#22C55E] text-white hover:bg-[#16A34A]'
                                  : 'bg-[#1D4ED8] text-white hover:bg-[#1e40af]'
                              }`}
                            >
                              {selectedTemplates.shipping ? 'Selected ✓' : 'Use Template'}
                            </button>
                          </div>
                        </div>

                        <div className="border border-[#E1E3E5] rounded-lg p-4 hover:border-[#1D4ED8] transition-colors">
                          <div className="flex items-start justify-between mb-3">
                            <div className="flex items-start gap-3">
                              <FileText className="w-5 h-5 text-[#1D4ED8] flex-shrink-0 mt-0.5" />
                              <div>
                                <h4 className="text-sm font-semibold text-[#202223] mb-1">
                                  Returns & Refunds Policy
                                </h4>
                                <p className="text-xs text-[#6D7175]">
                                  Return window, conditions, refund process, and restocking fees
                                </p>
                              </div>
                            </div>
                            <span className="px-2 py-1 bg-[#DCFCE7] text-[#059669] text-xs font-medium rounded flex-shrink-0">
                              Required
                            </span>
                          </div>
                          <div className="flex gap-2">
                            <button 
                              onClick={() => setPreviewTemplate('refund')}
                              className="flex-1 px-4 py-2 bg-[#F7F8FA] hover:bg-[#E1E3E5] border border-[#E1E3E5] text-sm font-medium text-[#202223] rounded-lg transition-colors"
                            >
                              Preview Template
                            </button>
                            <button 
                              onClick={() => setSelectedTemplates({ ...selectedTemplates, refund: !selectedTemplates.refund })}
                              className={`flex-1 px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                                selectedTemplates.refund
                                  ? 'bg-[#22C55E] text-white hover:bg-[#16A34A]'
                                  : 'bg-[#1D4ED8] text-white hover:bg-[#1e40af]'
                              }`}
                            >
                              {selectedTemplates.refund ? 'Selected ✓' : 'Use Template'}
                            </button>
                          </div>
                        </div>

                        <div className="border border-[#E1E3E5] rounded-lg p-4 hover:border-[#1D4ED8] transition-colors">
                          <div className="flex items-start justify-between mb-3">
                            <div className="flex items-start gap-3">
                              <FileText className="w-5 h-5 text-[#6D7175] flex-shrink-0 mt-0.5" />
                              <div>
                                <h4 className="text-sm font-semibold text-[#202223] mb-1">
                                  Terms of Service
                                </h4>
                                <p className="text-xs text-[#6D7175]">
                                  Usage terms, liability limitations, and dispute resolution
                                </p>
                              </div>
                            </div>
                            <span className="px-2 py-1 bg-[#F1F2F4] text-[#6D7175] text-xs font-medium rounded flex-shrink-0">
                              Optional
                            </span>
                          </div>
                          <div className="flex gap-2">
                            <button 
                              onClick={() => setPreviewTemplate('terms')}
                              className="flex-1 px-4 py-2 bg-[#F7F8FA] hover:bg-[#E1E3E5] border border-[#E1E3E5] text-sm font-medium text-[#202223] rounded-lg transition-colors"
                            >
                              Preview Template
                            </button>
                            <button 
                              onClick={() => setSelectedTemplates({ ...selectedTemplates, terms: !selectedTemplates.terms })}
                              className={`flex-1 px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                                selectedTemplates.terms
                                  ? 'bg-[#22C55E] text-white hover:bg-[#16A34A]'
                                  : 'bg-[#1D4ED8] text-white hover:bg-[#1e40af]'
                              }`}
                            >
                              {selectedTemplates.terms ? 'Selected ✓' : 'Use Template'}
                            </button>
                          </div>
                        </div>

                        <div className="border border-[#E1E3E5] rounded-lg p-4 hover:border-[#1D4ED8] transition-colors">
                          <div className="flex items-start justify-between mb-3">
                            <div className="flex items-start gap-3">
                              <FileText className="w-5 h-5 text-[#6D7175] flex-shrink-0 mt-0.5" />
                              <div>
                                <h4 className="text-sm font-semibold text-[#202223] mb-1">
                                  Privacy Policy
                                </h4>
                                <p className="text-xs text-[#6D7175]">
                                  Data collection, usage, storage, and customer rights
                                </p>
                              </div>
                            </div>
                            <span className="px-2 py-1 bg-[#F1F2F4] text-[#6D7175] text-xs font-medium rounded flex-shrink-0">
                              Optional
                            </span>
                          </div>
                          <div className="flex gap-2">
                            <button 
                              onClick={() => setPreviewTemplate('privacy')}
                              className="flex-1 px-4 py-2 bg-[#F7F8FA] hover:bg-[#E1E3E5] border border-[#E1E3E5] text-sm font-medium text-[#202223] rounded-lg transition-colors"
                            >
                              Preview Template
                            </button>
                            <button 
                              onClick={() => setSelectedTemplates({ ...selectedTemplates, privacy: !selectedTemplates.privacy })}
                              className={`flex-1 px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                                selectedTemplates.privacy
                                  ? 'bg-[#22C55E] text-white hover:bg-[#16A34A]'
                                  : 'bg-[#1D4ED8] text-white hover:bg-[#1e40af]'
                              }`}
                            >
                              {selectedTemplates.privacy ? 'Selected ✓' : 'Use Template'}
                            </button>
                          </div>
                        </div>
                      </div>

                      <div className="bg-[#FFF4E5] border border-[#FFCC80] rounded-lg p-4">
                        <div className="flex items-start gap-3">
                          <svg className="w-5 h-5 text-[#B95000] flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          <div>
                            <h4 className="text-sm font-semibold text-[#202223] mb-1">
                              Customize after generation
                            </h4>
                            <p className="text-sm text-[#6D7175]">
                              Templates will be generated and published to your store. You can edit them anytime from your Shopify admin or DisputeDesk settings.
                            </p>
                          </div>
                        </div>
                      </div>
                    </>
                  )}

                  {/* Mix & Match Option */}
                  {policyChoice === 'mix' && (
                    <>
                      <div className="mb-6">
                        <button
                          onClick={() => setPolicyChoice('')}
                          className="flex items-center gap-2 text-sm text-[#1D4ED8] hover:text-[#1e40af] transition-colors"
                        >
                          <ChevronLeft className="w-4 h-4" />
                          Back to options
                        </button>
                      </div>

                      <div className="bg-[#EFF6FF] border border-[#BFDBFE] rounded-lg p-5 mb-6">
                        <div className="flex items-start gap-3">
                          <div className="w-10 h-10 bg-[#1D4ED8] rounded-full flex items-center justify-center flex-shrink-0">
                            <Layers className="w-5 h-5 text-white" />
                          </div>
                          <div className="flex-1">
                            <h3 className="text-sm font-semibold text-[#1E40AF] mb-1">
                              Mix and match your policies
                            </h3>
                            <p className="text-sm text-[#1E40AF]">
                              Choose for each policy whether to link a URL, upload a file, or use our professional template.
                            </p>
                          </div>
                        </div>
                      </div>

                      <div className="space-y-5 mb-6">
                        {/* Shipping Policy */}
                        <div className="border border-[#E1E3E5] rounded-lg p-5">
                          <div className="flex items-start justify-between mb-4">
                            <div>
                              <h4 className="text-sm font-semibold text-[#202223] mb-1">
                                Shipping Policy
                                <span className="text-[#DC2626] ml-1">*</span>
                              </h4>
                              <p className="text-xs text-[#6D7175]">
                                Required for "Product not received" disputes
                              </p>
                            </div>
                            <span className="px-2 py-1 bg-[#DCFCE7] text-[#059669] text-xs font-medium rounded">
                              Required
                            </span>
                          </div>

                          <div className="grid grid-cols-3 gap-2 mb-4">
                            <button
                              onClick={() => setMixedPolicies({ ...mixedPolicies, shipping: 'url' })}
                              className={`px-3 py-2.5 border-2 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-1.5 ${
                                mixedPolicies.shipping === 'url'
                                  ? 'border-[#1D4ED8] bg-[#EFF6FF] text-[#1D4ED8]'
                                  : 'border-[#E1E3E5] text-[#6D7175] hover:border-[#C9CCCF]'
                              }`}
                            >
                              <LinkIcon className="w-3.5 h-3.5" />
                              Link URL
                            </button>
                            <button
                              onClick={() => setMixedPolicies({ ...mixedPolicies, shipping: 'upload' })}
                              className={`px-3 py-2.5 border-2 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-1.5 ${
                                mixedPolicies.shipping === 'upload'
                                  ? 'border-[#1D4ED8] bg-[#EFF6FF] text-[#1D4ED8]'
                                  : 'border-[#E1E3E5] text-[#6D7175] hover:border-[#C9CCCF]'
                              }`}
                            >
                              <Upload className="w-3.5 h-3.5" />
                              Upload
                            </button>
                            <button
                              onClick={() => setMixedPolicies({ ...mixedPolicies, shipping: 'template' })}
                              className={`px-3 py-2.5 border-2 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-1.5 ${
                                mixedPolicies.shipping === 'template'
                                  ? 'border-[#1D4ED8] bg-[#EFF6FF] text-[#1D4ED8]'
                                  : 'border-[#E1E3E5] text-[#6D7175] hover:border-[#C9CCCF]'
                              }`}
                            >
                              <Zap className="w-3.5 h-3.5" />
                              Template
                            </button>
                          </div>

                          {mixedPolicies.shipping === 'url' && (
                            <input
                              type="url"
                              placeholder="https://saraeverine.myshopify.com/policies/shipping"
                              className="w-full px-4 py-2.5 border border-[#C9CCCF] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#008060] focus:border-transparent"
                            />
                          )}
                          {mixedPolicies.shipping === 'upload' && (
                            <div className="border-2 border-dashed border-[#C9CCCF] rounded-lg p-6 text-center hover:border-[#1D4ED8] hover:bg-[#F7F8FA] transition-all cursor-pointer">
                              <Upload className="w-8 h-8 text-[#6D7175] mx-auto mb-2" />
                              <p className="text-sm font-medium text-[#202223] mb-1">Click to upload or drag and drop</p>
                              <p className="text-xs text-[#6D7175]">PDF, DOC, or DOCX (max 5MB)</p>
                            </div>
                          )}
                          {mixedPolicies.shipping === 'template' && (
                            <div className="space-y-3">
                              <div className="bg-[#F7F8FA] rounded-lg p-3 text-xs text-[#6D7175]">
                                Professional shipping policy template covering processing times, shipping zones, tracking, and delivery expectations
                              </div>
                              <div className="flex gap-2">
                                <button 
                                  onClick={() => setPreviewTemplate('shipping')}
                                  className="flex-1 px-4 py-2 bg-white hover:bg-[#F7F8FA] border border-[#E1E3E5] text-sm font-medium text-[#202223] rounded-lg transition-colors"
                                >
                                  Preview
                                </button>
                                <button 
                                  className="flex-1 px-4 py-2 bg-white hover:bg-[#F7F8FA] border border-[#E1E3E5] text-sm font-medium text-[#202223] rounded-lg transition-colors"
                                >
                                  Edit template
                                </button>
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Return/Refund Policy */}
                        <div className="border border-[#E1E3E5] rounded-lg p-5">
                          <div className="flex items-start justify-between mb-4">
                            <div>
                              <h4 className="text-sm font-semibold text-[#202223] mb-1">
                                Return/Refund Policy
                                <span className="text-[#DC2626] ml-1">*</span>
                              </h4>
                              <p className="text-xs text-[#6D7175]">
                                Required for "Product unacceptable" disputes
                              </p>
                            </div>
                            <span className="px-2 py-1 bg-[#DCFCE7] text-[#059669] text-xs font-medium rounded">
                              Required
                            </span>
                          </div>

                          <div className="grid grid-cols-3 gap-2 mb-4">
                            <button
                              onClick={() => setMixedPolicies({ ...mixedPolicies, refund: 'url' })}
                              className={`px-3 py-2.5 border-2 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-1.5 ${
                                mixedPolicies.refund === 'url'
                                  ? 'border-[#1D4ED8] bg-[#EFF6FF] text-[#1D4ED8]'
                                  : 'border-[#E1E3E5] text-[#6D7175] hover:border-[#C9CCCF]'
                              }`}
                            >
                              <LinkIcon className="w-3.5 h-3.5" />
                              Link URL
                            </button>
                            <button
                              onClick={() => setMixedPolicies({ ...mixedPolicies, refund: 'upload' })}
                              className={`px-3 py-2.5 border-2 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-1.5 ${
                                mixedPolicies.refund === 'upload'
                                  ? 'border-[#1D4ED8] bg-[#EFF6FF] text-[#1D4ED8]'
                                  : 'border-[#E1E3E5] text-[#6D7175] hover:border-[#C9CCCF]'
                              }`}
                            >
                              <Upload className="w-3.5 h-3.5" />
                              Upload
                            </button>
                            <button
                              onClick={() => setMixedPolicies({ ...mixedPolicies, refund: 'template' })}
                              className={`px-3 py-2.5 border-2 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-1.5 ${
                                mixedPolicies.refund === 'template'
                                  ? 'border-[#1D4ED8] bg-[#EFF6FF] text-[#1D4ED8]'
                                  : 'border-[#E1E3E5] text-[#6D7175] hover:border-[#C9CCCF]'
                              }`}
                            >
                              <Zap className="w-3.5 h-3.5" />
                              Template
                            </button>
                          </div>

                          {mixedPolicies.refund === 'url' && (
                            <input
                              type="url"
                              placeholder="https://saraeverine.myshopify.com/policies/refunds"
                              className="w-full px-4 py-2.5 border border-[#C9CCCF] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#008060] focus:border-transparent"
                            />
                          )}
                          {mixedPolicies.refund === 'upload' && (
                            <div className="border-2 border-dashed border-[#C9CCCF] rounded-lg p-6 text-center hover:border-[#1D4ED8] hover:bg-[#F7F8FA] transition-all cursor-pointer">
                              <Upload className="w-8 h-8 text-[#6D7175] mx-auto mb-2" />
                              <p className="text-sm font-medium text-[#202223] mb-1">Click to upload or drag and drop</p>
                              <p className="text-xs text-[#6D7175]">PDF, DOC, or DOCX (max 5MB)</p>
                            </div>
                          )}
                          {mixedPolicies.refund === 'template' && (
                            <div className="space-y-3">
                              <div className="bg-[#F7F8FA] rounded-lg p-3 text-xs text-[#6D7175]">
                                Professional return/refund policy covering return window, conditions, refund process, and restocking fees
                              </div>
                              <div className="flex gap-2">
                                <button 
                                  onClick={() => setPreviewTemplate('refund')}
                                  className="flex-1 px-4 py-2 bg-white hover:bg-[#F7F8FA] border border-[#E1E3E5] text-sm font-medium text-[#202223] rounded-lg transition-colors"
                                >
                                  Preview
                                </button>
                                <button 
                                  className="flex-1 px-4 py-2 bg-white hover:bg-[#F7F8FA] border border-[#E1E3E5] text-sm font-medium text-[#202223] rounded-lg transition-colors"
                                >
                                  Edit template
                                </button>
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Terms of Service */}
                        <div className="border border-[#E1E3E5] rounded-lg p-5">
                          <div className="flex items-start justify-between mb-4">
                            <div>
                              <h4 className="text-sm font-semibold text-[#202223] mb-1">
                                Terms of Service
                              </h4>
                              <p className="text-xs text-[#6D7175]">
                                Included in all evidence packs when available
                              </p>
                            </div>
                            <span className="px-2 py-1 bg-[#F1F2F4] text-[#6D7175] text-xs font-medium rounded">
                              Optional
                            </span>
                          </div>

                          <div className="grid grid-cols-3 gap-2 mb-4">
                            <button
                              onClick={() => setMixedPolicies({ ...mixedPolicies, terms: 'url' })}
                              className={`px-3 py-2.5 border-2 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-1.5 ${
                                mixedPolicies.terms === 'url'
                                  ? 'border-[#1D4ED8] bg-[#EFF6FF] text-[#1D4ED8]'
                                  : 'border-[#E1E3E5] text-[#6D7175] hover:border-[#C9CCCF]'
                              }`}
                            >
                              <LinkIcon className="w-3.5 h-3.5" />
                              Link URL
                            </button>
                            <button
                              onClick={() => setMixedPolicies({ ...mixedPolicies, terms: 'upload' })}
                              className={`px-3 py-2.5 border-2 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-1.5 ${
                                mixedPolicies.terms === 'upload'
                                  ? 'border-[#1D4ED8] bg-[#EFF6FF] text-[#1D4ED8]'
                                  : 'border-[#E1E3E5] text-[#6D7175] hover:border-[#C9CCCF]'
                              }`}
                            >
                              <Upload className="w-3.5 h-3.5" />
                              Upload
                            </button>
                            <button
                              onClick={() => setMixedPolicies({ ...mixedPolicies, terms: 'template' })}
                              className={`px-3 py-2.5 border-2 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-1.5 ${
                                mixedPolicies.terms === 'template'
                                  ? 'border-[#1D4ED8] bg-[#EFF6FF] text-[#1D4ED8]'
                                  : 'border-[#E1E3E5] text-[#6D7175] hover:border-[#C9CCCF]'
                              }`}
                            >
                              <Zap className="w-3.5 h-3.5" />
                              Template
                            </button>
                          </div>

                          {mixedPolicies.terms === 'url' && (
                            <input
                              type="url"
                              placeholder="https://saraeverine.myshopify.com/policies/terms"
                              className="w-full px-4 py-2.5 border border-[#C9CCCF] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#008060] focus:border-transparent"
                            />
                          )}
                          {mixedPolicies.terms === 'upload' && (
                            <div className="border-2 border-dashed border-[#C9CCCF] rounded-lg p-6 text-center hover:border-[#1D4ED8] hover:bg-[#F7F8FA] transition-all cursor-pointer">
                              <Upload className="w-8 h-8 text-[#6D7175] mx-auto mb-2" />
                              <p className="text-sm font-medium text-[#202223] mb-1">Click to upload or drag and drop</p>
                              <p className="text-xs text-[#6D7175]">PDF, DOC, or DOCX (max 5MB)</p>
                            </div>
                          )}
                          {mixedPolicies.terms === 'template' && (
                            <div className="space-y-3">
                              <div className="bg-[#F7F8FA] rounded-lg p-3 text-xs text-[#6D7175]">
                                Professional terms of service covering usage rights, account terms, prohibited conduct, and legal disclaimers
                              </div>
                              <div className="flex gap-2">
                                <button 
                                  onClick={() => setPreviewTemplate('terms')}
                                  className="flex-1 px-4 py-2 bg-white hover:bg-[#F7F8FA] border border-[#E1E3E5] text-sm font-medium text-[#202223] rounded-lg transition-colors"
                                >
                                  Preview
                                </button>
                                <button 
                                  className="flex-1 px-4 py-2 bg-white hover:bg-[#F7F8FA] border border-[#E1E3E5] text-sm font-medium text-[#202223] rounded-lg transition-colors"
                                >
                                  Edit template
                                </button>
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Privacy Policy */}
                        <div className="border border-[#E1E3E5] rounded-lg p-5">
                          <div className="flex items-start justify-between mb-4">
                            <div>
                              <h4 className="text-sm font-semibold text-[#202223] mb-1">
                                Privacy Policy
                              </h4>
                              <p className="text-xs text-[#6D7175]">
                                Shows commitment to customer data protection
                              </p>
                            </div>
                            <span className="px-2 py-1 bg-[#F1F2F4] text-[#6D7175] text-xs font-medium rounded">
                              Optional
                            </span>
                          </div>

                          <div className="grid grid-cols-3 gap-2 mb-4">
                            <button
                              onClick={() => setMixedPolicies({ ...mixedPolicies, privacy: 'url' })}
                              className={`px-3 py-2.5 border-2 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-1.5 ${
                                mixedPolicies.privacy === 'url'
                                  ? 'border-[#1D4ED8] bg-[#EFF6FF] text-[#1D4ED8]'
                                  : 'border-[#E1E3E5] text-[#6D7175] hover:border-[#C9CCCF]'
                              }`}
                            >
                              <LinkIcon className="w-3.5 h-3.5" />
                              Link URL
                            </button>
                            <button
                              onClick={() => setMixedPolicies({ ...mixedPolicies, privacy: 'upload' })}
                              className={`px-3 py-2.5 border-2 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-1.5 ${
                                mixedPolicies.privacy === 'upload'
                                  ? 'border-[#1D4ED8] bg-[#EFF6FF] text-[#1D4ED8]'
                                  : 'border-[#E1E3E5] text-[#6D7175] hover:border-[#C9CCCF]'
                              }`}
                            >
                              <Upload className="w-3.5 h-3.5" />
                              Upload
                            </button>
                            <button
                              onClick={() => setMixedPolicies({ ...mixedPolicies, privacy: 'template' })}
                              className={`px-3 py-2.5 border-2 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-1.5 ${
                                mixedPolicies.privacy === 'template'
                                  ? 'border-[#1D4ED8] bg-[#EFF6FF] text-[#1D4ED8]'
                                  : 'border-[#E1E3E5] text-[#6D7175] hover:border-[#C9CCCF]'
                              }`}
                            >
                              <Zap className="w-3.5 h-3.5" />
                              Template
                            </button>
                          </div>

                          {mixedPolicies.privacy === 'url' && (
                            <input
                              type="url"
                              placeholder="https://saraeverine.myshopify.com/policies/privacy"
                              className="w-full px-4 py-2.5 border border-[#C9CCCF] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#008060] focus:border-transparent"
                            />
                          )}
                          {mixedPolicies.privacy === 'upload' && (
                            <div className="border-2 border-dashed border-[#C9CCCF] rounded-lg p-6 text-center hover:border-[#1D4ED8] hover:bg-[#F7F8FA] transition-all cursor-pointer">
                              <Upload className="w-8 h-8 text-[#6D7175] mx-auto mb-2" />
                              <p className="text-sm font-medium text-[#202223] mb-1">Click to upload or drag and drop</p>
                              <p className="text-xs text-[#6D7175]">PDF, DOC, or DOCX (max 5MB)</p>
                            </div>
                          )}
                          {mixedPolicies.privacy === 'template' && (
                            <div className="space-y-3">
                              <div className="bg-[#F7F8FA] rounded-lg p-3 text-xs text-[#6D7175]">
                                Professional privacy policy covering data collection, usage, storage, third-party sharing, and user rights
                              </div>
                              <div className="flex gap-2">
                                <button 
                                  onClick={() => setPreviewTemplate('privacy')}
                                  className="flex-1 px-4 py-2 bg-white hover:bg-[#F7F8FA] border border-[#E1E3E5] text-sm font-medium text-[#202223] rounded-lg transition-colors"
                                >
                                  Preview
                                </button>
                                <button 
                                  className="flex-1 px-4 py-2 bg-white hover:bg-[#F7F8FA] border border-[#E1E3E5] text-sm font-medium text-[#202223] rounded-lg transition-colors"
                                >
                                  Edit template
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="bg-[#F7F8FA] border border-[#E1E3E5] rounded-lg p-4">
                        <div className="flex items-start gap-3">
                          <svg className="w-5 h-5 text-[#6D7175] flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          <div>
                            <h4 className="text-sm font-semibold text-[#202223] mb-1">
                              Best of both worlds
                            </h4>
                            <p className="text-sm text-[#6D7175]">
                              Link the policies you already have and let DisputeDesk generate the ones you're missing.
                            </p>
                          </div>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Step 3: Generate packs - Template Library */}
              {currentStep === 3 && (
                <div className="max-w-3xl mx-auto">
                  <div className="text-center mb-8">
                    <div className="w-16 h-16 bg-gradient-to-br from-[#F59E0B] to-[#D97706] rounded-2xl flex items-center justify-center mx-auto mb-4">
                      <FileText className="w-8 h-8 text-white" />
                    </div>
                    <h2 className="text-2xl font-semibold text-[#202223] mb-2">
                      Install Evidence Pack Templates
                    </h2>
                    <p className="text-base text-[#6D7175]">
                      Install expert-built packs for common dispute types. Each template includes optimized document collection and policies.
                    </p>
                  </div>

                  {/* Template Library */}
                  <div className="space-y-3 mb-6">
                      {evidencePackTemplates.map((template) => (
                        <div
                          key={template.id}
                          className={`border rounded-lg p-4 transition-all ${
                            installedPacks.includes(template.id)
                              ? 'border-[#22C55E] bg-[#F0FDF4]'
                              : 'border-[#E1E3E5] hover:border-[#1D4ED8]'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex-1">
                              <h3 className="text-sm font-semibold text-[#0B1220] mb-1.5">
                                {template.title}
                              </h3>
                              <p className="text-sm text-[#667085] leading-relaxed">
                                {template.description}
                              </p>
                            </div>
                            <button
                              onClick={() => {
                                if (!installedPacks.includes(template.id)) {
                                  // Start the embedded template setup wizard
                                  setConfiguringPack(template.id);
                                  setPackWizardStep('evidence');
                                }
                              }}
                              className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors flex-shrink-0 ${
                                installedPacks.includes(template.id)
                                  ? 'bg-[#22C55E] text-white cursor-default'
                                  : 'bg-[#0B1220] text-white hover:bg-[#1D4ED8]'
                              }`}
                              disabled={installedPacks.includes(template.id)}
                            >
                              {installedPacks.includes(template.id) ? 'Installed ✓' : 'Install'}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>

                  {/* Selection Summary */}
                    <div className="bg-[#EFF6FF] border border-[#BFDBFE] rounded-lg p-4">
                      <div className="flex items-start gap-3">
                        <svg className="w-5 h-5 text-[#1D4ED8] flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <div>
                          <h4 className="text-sm font-semibold text-[#1E40AF] mb-1">
                            {installedPacks.length === 0 ? 'Select templates to install' : `${installedPacks.length} ${installedPacks.length === 1 ? 'pack' : 'packs'} installed`}
                          </h4>
                          <p className="text-sm text-[#1E40AF]">
                            Click "Install" on any template to configure it. You can reconfigure or add automation rules later.
                          </p>
                        </div>
                      </div>
                    </div>
                </div>
              )}

              {/* Step 4: Add rules */}
              {currentStep === 4 && (
                <div className="max-w-2xl mx-auto">
                  <div className="text-center mb-8">
                    <div className="w-16 h-16 bg-gradient-to-br from-[#F59E0B] to-[#D97706] rounded-2xl flex items-center justify-center mx-auto mb-4">
                      <Zap className="w-8 h-8 text-white" />
                    </div>
                    <h2 className="text-2xl font-semibold text-[#202223] mb-2">
                      Create your first rule
                    </h2>
                    <p className="text-base text-[#6D7175]">
                      Rules automatically route disputes to evidence packs or the review queue
                    </p>
                  </div>

                  <div className="space-y-4 mb-6">
                    <button
                      onClick={() => setSelectedReason('fraudulent')}
                      className={`w-full border-2 rounded-lg p-5 text-left transition-all ${
                        selectedReason === 'fraudulent'
                          ? 'border-[#1D4ED8] bg-[#EFF6FF]'
                          : 'border-[#E1E3E5] hover:border-[#C9CCCF]'
                      }`}
                    >
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex items-center gap-3">
                          <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                            selectedReason === 'fraudulent'
                              ? 'border-[#1D4ED8] bg-[#1D4ED8]'
                              : 'border-[#C9CCCF]'
                          }`}>
                            {selectedReason === 'fraudulent' && (
                              <div className="w-2 h-2 bg-white rounded-full"></div>
                            )}
                          </div>
                          <h3 className="text-base font-semibold text-[#202223]">
                            Auto-pack fraudulent disputes
                          </h3>
                        </div>
                      </div>
                      <p className="text-sm text-[#6D7175] ml-8">
                        When a <strong>Fraudulent</strong> dispute arrives, automatically create an evidence pack with order confirmation, tracking, and customer communication.
                      </p>
                    </button>

                    <button
                      onClick={() => setSelectedReason('not_received')}
                      className={`w-full border-2 rounded-lg p-5 text-left transition-all ${
                        selectedReason === 'not_received'
                          ? 'border-[#1D4ED8] bg-[#EFF6FF]'
                          : 'border-[#E1E3E5] hover:border-[#C9CCCF]'
                      }`}
                    >
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex items-center gap-3">
                          <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                            selectedReason === 'not_received'
                              ? 'border-[#1D4ED8] bg-[#1D4ED8]'
                              : 'border-[#C9CCCF]'
                          }`}>
                            {selectedReason === 'not_received' && (
                              <div className="w-2 h-2 bg-white rounded-full"></div>
                            )}
                          </div>
                          <h3 className="text-base font-semibold text-[#202223]">
                            Route "Not Received" to Review Queue
                          </h3>
                        </div>
                      </div>
                      <p className="text-sm text-[#6D7175] ml-8">
                        When a <strong>Product not received</strong> dispute arrives, send it to the review queue for manual inspection before creating a pack.
                      </p>
                    </button>

                    <button
                      onClick={() => setSelectedReason('all_auto')}
                      className={`w-full border-2 rounded-lg p-5 text-left transition-all ${
                        selectedReason === 'all_auto'
                          ? 'border-[#1D4ED8] bg-[#EFF6FF]'
                          : 'border-[#E1E3E5] hover:border-[#C9CCCF]'
                      }`}
                    >
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex items-center gap-3">
                          <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                            selectedReason === 'all_auto'
                              ? 'border-[#1D4ED8] bg-[#1D4ED8]'
                              : 'border-[#C9CCCF]'
                          }`}>
                            {selectedReason === 'all_auto' && (
                              <div className="w-2 h-2 bg-white rounded-full"></div>
                            )}
                          </div>
                          <h3 className="text-base font-semibold text-[#202223]">
                            Auto-pack all disputes
                          </h3>
                        </div>
                      </div>
                      <p className="text-sm text-[#6D7175] ml-8">
                        Automatically create evidence packs for <strong>all dispute types</strong>. You can review and refine packs before submitting.
                      </p>
                    </button>
                  </div>

                  <div className="bg-[#FFF4E5] border border-[#FFCC80] rounded-lg p-4">
                    <div className="flex items-start gap-3">
                      <svg className="w-5 h-5 text-[#B95000] flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <div>
                        <h4 className="text-sm font-semibold text-[#202223] mb-1">
                          You can change this later
                        </h4>
                        <p className="text-sm text-[#6D7175]">
                          Create unlimited rules from the Rules page. First matching rule wins.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Step 5: Add team */}
              {currentStep === 5 && (
                <div className="text-center max-w-2xl mx-auto">
                  <div className="w-16 h-16 bg-gradient-to-br from-[#10B981] to-[#059669] rounded-2xl flex items-center justify-center mx-auto mb-6">
                    <Users className="w-8 h-8 text-white" />
                  </div>
                  <h2 className="text-2xl font-semibold text-[#202223] mb-4">
                    Invite team members
                  </h2>
                  <p className="text-base text-[#6D7175] mb-8 leading-relaxed">
                    Invite your team members to help manage disputes and automate processes.
                  </p>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
                    <div className="border border-[#E1E3E5] rounded-lg p-5 text-left">
                      <div className="w-10 h-10 bg-[#DCFCE7] rounded-lg flex items-center justify-center mb-4">
                        <Check className="w-5 h-5 text-[#059669]" />
                      </div>
                      <h3 className="text-sm font-semibold text-[#202223] mb-2">Store connected</h3>
                      <p className="text-xs text-[#6D7175]">
                        saraeverine.myshopify.com
                      </p>
                    </div>

                    <div className="border border-[#E1E3E5] rounded-lg p-5 text-left">
                      <div className="w-10 h-10 bg-[#DCFCE7] rounded-lg flex items-center justify-center mb-4">
                        <Check className="w-5 h-5 text-[#059669]" />
                      </div>
                      <h3 className="text-sm font-semibold text-[#202223] mb-2">Rule configured</h3>
                      <p className="text-xs text-[#6D7175]">
                        {selectedReason === 'fraudulent' && 'Auto-pack fraudulent disputes'}
                        {selectedReason === 'not_received' && 'Route "Not Received" to review'}
                        {selectedReason === 'all_auto' && 'Auto-pack all disputes'}
                        {!selectedReason && 'Ready to create rules'}
                      </p>
                    </div>
                  </div>

                  <div className="bg-[#F7F8FA] border border-[#E1E3E5] rounded-lg p-6 text-left mb-8">
                    <h3 className="text-base font-semibold text-[#202223] mb-4">What happens next?</h3>
                    <ul className="space-y-3">
                      <li className="flex items-start gap-3">
                        <div className="w-6 h-6 bg-[#1D4ED8] text-white rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0">
                          1
                        </div>
                        <div className="flex-1">
                          <p className="text-sm text-[#202223] font-medium">New dispute arrives</p>
                          <p className="text-xs text-[#6D7175]">Shopify notifies DisputeDesk via webhook</p>
                        </div>
                      </li>
                      <li className="flex items-start gap-3">
                        <div className="w-6 h-6 bg-[#1D4ED8] text-white rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0">
                          2
                        </div>
                        <div className="flex-1">
                          <p className="text-sm text-[#202223] font-medium">Evidence pack is created</p>
                          <p className="text-xs text-[#6D7175]">Based on your rules and dispute type</p>
                        </div>
                      </li>
                      <li className="flex items-start gap-3">
                        <div className="w-6 h-6 bg-[#1D4ED8] text-white rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0">
                          3
                        </div>
                        <div className="flex-1">
                          <p className="text-sm text-[#202223] font-medium">Review and submit</p>
                          <p className="text-xs text-[#6D7175]">Check completeness, then submit from Shopify Admin</p>
                        </div>
                      </li>
                    </ul>
                  </div>
                </div>
              )}

              {/* Navigation Buttons */}
              <div className="flex items-center justify-between pt-6 border-t border-[#E1E3E5] mt-8">
                <button
                  onClick={handleBack}
                  disabled={currentStep === 0}
                  className={`px-4 py-2 text-sm font-medium rounded-lg flex items-center gap-2 transition-colors ${
                    currentStep === 0
                      ? 'text-[#8C9196] cursor-not-allowed'
                      : 'text-[#202223] hover:bg-[#F7F8FA]'
                  }`}
                >
                  <ChevronLeft className="w-4 h-4" />
                  Back
                </button>

                <div className="flex items-center gap-3">
                  {currentStep < totalSteps ? (
                    <>
                      {currentStep > 0 && (
                        <button
                          onClick={onSkip}
                          className="px-4 py-2 text-sm font-medium text-[#6D7175] hover:text-[#202223] transition-colors"
                        >
                          Skip for now
                        </button>
                      )}
                      <button
                        onClick={handleNext}
                        className="px-6 py-2 rounded-lg text-sm font-semibold flex items-center gap-2 transition-colors bg-[#1D4ED8] text-white hover:bg-[#1e40af]"
                      >
                        {currentStep === 0 ? 'Get Started' : 'Continue'}
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={onComplete}
                      className="px-6 py-2 bg-[#059669] text-white rounded-lg text-sm font-semibold hover:bg-[#047857] transition-colors flex items-center gap-2"
                    >
                      Go to Dashboard
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Pack Configuration Wizard - Embedded Template Setup */}
      {configuringPack && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl max-w-5xl w-full max-h-[90vh] overflow-hidden flex flex-col shadow-2xl">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-[#E1E3E5] flex items-center justify-between bg-[#F7F8FA]">
              <div>
                <h2 className="text-xl font-bold text-[#0B1220]">
                  Configure: {evidencePackTemplates.find(t => t.id === configuringPack)?.title}
                </h2>
                <p className="text-sm text-[#667085] mt-1">
                  Complete the setup to activate this evidence pack
                </p>
              </div>
              <button
                onClick={() => {
                  setConfiguringPack(null);
                  setPackWizardStep('evidence');
                }}
                className="text-[#667085] hover:text-[#0B1220] transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Progress Bar */}
            <div className="px-6 py-3 bg-white border-b border-[#E1E3E5]">
              <div className="flex items-center gap-2 mb-2">
                {['evidence', 'sources', 'review', 'activate'].map((step, index) => {
                  const stepTitles = {
                    evidence: 'Choose Evidence',
                    sources: 'Set Sources',
                    review: 'Review',
                    activate: 'Activate'
                  };
                  const currentIndex = ['evidence', 'sources', 'review', 'activate'].indexOf(packWizardStep);
                  const isActive = packWizardStep === step;
                  const isCompleted = index < currentIndex;
                  
                  return (
                    <React.Fragment key={step}>
                      <div className="flex items-center gap-2">
                        <div className={`flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold ${
                          isCompleted ? 'bg-[#22C55E] text-white' :
                          isActive ? 'bg-[#1D4ED8] text-white' :
                          'bg-[#E1E3E5] text-[#667085]'
                        }`}>
                          {isCompleted ? <Check className="w-4 h-4" /> : index + 1}
                        </div>
                        <span className={`text-xs font-medium ${
                          isActive ? 'text-[#0B1220]' : 'text-[#667085]'
                        }`}>
                          {stepTitles[step as keyof typeof stepTitles]}
                        </span>
                      </div>
                      {index < 3 && (
                        <div className={`flex-1 h-0.5 ${
                          index < currentIndex ? 'bg-[#22C55E]' : 'bg-[#E1E3E5]'
                        }`} />
                      )}
                    </React.Fragment>
                  );
                })}
              </div>
            </div>

            {/* Modal Content */}
            <div className="flex-1 overflow-y-auto px-6 py-6">
              {packWizardStep === 'evidence' && (
                <div className="space-y-4">
                  <div>
                    <h3 className="font-semibold text-[#0B1220] mb-2">Select Evidence Types to Collect</h3>
                    <p className="text-sm text-[#667085] mb-4">
                      Choose which evidence types this pack should automatically gather when a dispute occurs.
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    {[
                      { id: 'order-details', title: 'Order Details', description: 'Order number, date, amount, status', recommended: true },
                      { id: 'customer-info', title: 'Customer Information', description: 'Name, email, billing address, history', recommended: true },
                      { id: 'shipping-info', title: 'Shipping Information', description: 'Tracking, carrier, delivery confirmation', recommended: true },
                      { id: 'product-info', title: 'Product Information', description: 'Product name, SKU, description, images', recommended: true },
                      { id: 'policies', title: 'Store Policies', description: 'Shipping, return, refund, terms of service', recommended: true },
                      { id: 'communication', title: 'Customer Communication', description: 'Email exchanges and support tickets', recommended: false },
                      { id: 'payment-proof', title: 'Payment Proof', description: 'Transaction ID, payment method, authorization', recommended: true },
                      { id: 'custom-fields', title: 'Custom Fields', description: 'Additional evidence for your business', recommended: false }
                    ].map((evidenceType) => (
                      <label
                        key={evidenceType.id}
                        className={`relative flex items-start gap-3 p-4 border-2 rounded-lg cursor-pointer transition-all ${
                          selectedEvidence.includes(evidenceType.id)
                            ? 'border-[#1D4ED8] bg-[#EFF6FF]'
                            : 'border-[#E1E3E5] hover:border-[#C9CCCF]'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={selectedEvidence.includes(evidenceType.id)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedEvidence([...selectedEvidence, evidenceType.id]);
                            } else {
                              setSelectedEvidence(selectedEvidence.filter(id => id !== evidenceType.id));
                            }
                          }}
                          className="w-5 h-5 text-[#1D4ED8] border-[#C9CCCF] rounded focus:ring-[#1D4ED8] mt-0.5"
                        />
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold text-[#0B1220]">
                              {evidenceType.title}
                            </span>
                            {evidenceType.recommended && (
                              <span className="px-2 py-0.5 bg-[#FEF3C7] text-[#92400E] text-xs font-medium rounded">
                                Recommended
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-[#667085] mt-1">
                            {evidenceType.description}
                          </p>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {packWizardStep === 'sources' && (
                <div className="space-y-4">
                  <div>
                    <h3 className="font-semibold text-[#0B1220] mb-2">Configure Evidence Sources</h3>
                    <p className="text-sm text-[#667085] mb-4">
                      Set where each evidence type will be collected from. Most are automatically gathered from Shopify.
                    </p>
                  </div>

                  <div className="space-y-3">
                    {selectedEvidence.map((evidenceId) => {
                      const evidenceTitles: Record<string, string> = {
                        'order-details': 'Order Details',
                        'customer-info': 'Customer Information',
                        'shipping-info': 'Shipping Information',
                        'product-info': 'Product Information',
                        'policies': 'Store Policies',
                        'communication': 'Customer Communication',
                        'payment-proof': 'Payment Proof',
                        'custom-fields': 'Custom Fields'
                      };

                      const isAuto = ['order-details', 'customer-info', 'shipping-info', 'product-info', 'payment-proof'].includes(evidenceId);

                      return (
                        <div key={evidenceId} className="border border-[#E1E3E5] rounded-lg p-4">
                          <div className="flex items-center justify-between">
                            <div>
                              <h4 className="text-sm font-semibold text-[#0B1220]">
                                {evidenceTitles[evidenceId]}
                              </h4>
                              <p className="text-xs text-[#667085] mt-1">
                                {isAuto ? 'Automatically collected from Shopify API' : 'Requires manual configuration'}
                              </p>
                            </div>
                            <div className={`px-3 py-1.5 rounded-lg text-xs font-medium ${
                              isAuto
                                ? 'bg-[#DCFCE7] text-[#166534]'
                                : 'bg-[#FEF3C7] text-[#92400E]'
                            }`}>
                              {isAuto ? '✓ Auto-Collect' : 'Manual Setup'}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {packWizardStep === 'review' && (
                <div className="space-y-4">
                  <div>
                    <h3 className="font-semibold text-[#0B1220] mb-2">Review Automation Setup</h3>
                    <p className="text-sm text-[#667085] mb-4">
                      Here's how this pack will work when a matching dispute arrives.
                    </p>
                  </div>

                  <div className="border border-[#E1E3E5] rounded-lg p-5 space-y-4">
                    <div className="flex items-start gap-3">
                      <div className="w-8 h-8 rounded-full bg-[#EFF6FF] flex items-center justify-center flex-shrink-0">
                        <span className="text-sm font-bold text-[#1D4ED8]">1</span>
                      </div>
                      <div>
                        <h4 className="text-sm font-semibold text-[#0B1220]">Dispute Detected</h4>
                        <p className="text-xs text-[#667085] mt-1">
                          When a new dispute arrives matching the criteria, DisputeDesk automatically triggers this pack.
                        </p>
                      </div>
                    </div>

                    <div className="flex items-start gap-3">
                      <div className="w-8 h-8 rounded-full bg-[#EFF6FF] flex items-center justify-center flex-shrink-0">
                        <span className="text-sm font-bold text-[#1D4ED8]">2</span>
                      </div>
                      <div>
                        <h4 className="text-sm font-semibold text-[#0B1220]">Evidence Collection</h4>
                        <p className="text-xs text-[#667085] mt-1">
                          The system gathers {selectedEvidence.length} evidence type(s) from configured sources, including order details, shipping info, and customer data.
                        </p>
                      </div>
                    </div>

                    <div className="flex items-start gap-3">
                      <div className="w-8 h-8 rounded-full bg-[#EFF6FF] flex items-center justify-center flex-shrink-0">
                        <span className="text-sm font-bold text-[#1D4ED8]">3</span>
                      </div>
                      <div>
                        <h4 className="text-sm font-semibold text-[#0B1220]">Pack Assembly</h4>
                        <p className="text-xs text-[#667085] mt-1">
                          All evidence is compiled into a submission-ready pack, formatted according to card network requirements.
                        </p>
                      </div>
                    </div>

                    <div className="flex items-start gap-3">
                      <div className="w-8 h-8 rounded-full bg-[#DCFCE7] flex items-center justify-center flex-shrink-0">
                        <Check className="w-4 h-4 text-[#166534]" />
                      </div>
                      <div>
                        <h4 className="text-sm font-semibold text-[#0B1220]">Ready for Review</h4>
                        <p className="text-xs text-[#667085] mt-1">
                          You'll be notified to review and approve the pack before submission. You can make any final edits if needed.
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="bg-[#F6F8FB] border border-[#E1E3E5] rounded-lg p-4">
                    <div className="flex items-start gap-3">
                      <Sparkles className="w-5 h-5 text-[#1D4ED8] flex-shrink-0 mt-0.5" />
                      <div>
                        <h4 className="text-sm font-medium text-[#0B1220]">Pro Tip</h4>
                        <p className="text-xs text-[#667085] mt-1">
                          You can always manually edit any pack before submission, even if it was auto-generated.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {packWizardStep === 'activate' && (
                <div className="space-y-4">
                  <div className="text-center py-8">
                    <div className="w-16 h-16 bg-[#DCFCE7] rounded-full flex items-center justify-center mx-auto mb-4">
                      <Check className="w-8 h-8 text-[#166534]" />
                    </div>
                    <h3 className="font-bold text-[#0B1220] text-lg mb-2">Pack Ready to Activate</h3>
                    <p className="text-sm text-[#667085] mb-6 max-w-md mx-auto">
                      Your evidence pack "{evidencePackTemplates.find(t => t.id === configuringPack)?.title}" is configured and ready to use.
                    </p>

                    <div className="bg-[#F6F8FB] border border-[#E1E3E5] rounded-lg p-4 max-w-md mx-auto mb-6">
                      <div className="grid grid-cols-2 gap-4 text-left">
                        <div>
                          <p className="text-xs text-[#667085]">Evidence Types</p>
                          <p className="text-sm font-semibold text-[#0B1220]">{selectedEvidence.length} selected</p>
                        </div>
                        <div>
                          <p className="text-xs text-[#667085]">Auto-Collection</p>
                          <p className="text-sm font-semibold text-[#0B1220]">Enabled</p>
                        </div>
                        <div>
                          <p className="text-xs text-[#667085]">Status</p>
                          <p className="text-sm font-semibold text-[#22C55E]">Ready</p>
                        </div>
                        <div>
                          <p className="text-xs text-[#667085]">Applies To</p>
                          <p className="text-sm font-semibold text-[#0B1220]">Manual</p>
                        </div>
                      </div>
                    </div>

                    <div className="bg-[#EFF6FF] border border-[#BFDBFE] rounded-lg p-4 max-w-md mx-auto text-left">
                      <div className="flex items-start gap-3">
                        <svg className="w-5 h-5 text-[#1D4ED8] flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <div>
                          <p className="text-xs font-medium text-[#1D4ED8]">What happens next?</p>
                          <p className="text-xs text-[#4A5F8A] mt-1">
                            This pack will be available in your Evidence Packs library. You can apply it manually to disputes or set up automation rules later.
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-4 border-t border-[#E1E3E5] bg-[#F7F8FA] flex items-center justify-between">
              <button
                onClick={() => {
                  if (packWizardStep === 'evidence') {
                    setConfiguringPack(null);
                    setPackWizardStep('evidence');
                  } else {
                    const steps: Array<'evidence' | 'sources' | 'review' | 'activate'> = ['evidence', 'sources', 'review', 'activate'];
                    const currentIndex = steps.indexOf(packWizardStep);
                    if (currentIndex > 0) {
                      setPackWizardStep(steps[currentIndex - 1]);
                    }
                  }
                }}
                className="px-5 py-2.5 border border-[#E1E3E5] text-sm font-medium text-[#0B1220] rounded-lg hover:bg-white transition-colors flex items-center gap-2"
              >
                <ChevronLeft className="w-4 h-4" />
                {packWizardStep === 'evidence' ? 'Cancel' : 'Back'}
              </button>
              
              <button
                onClick={() => {
                  const steps: Array<'evidence' | 'sources' | 'review' | 'activate'> = ['evidence', 'sources', 'review', 'activate'];
                  const currentIndex = steps.indexOf(packWizardStep);
                  
                  if (packWizardStep === 'activate') {
                    // Complete and mark as installed
                    if (!installedPacks.includes(configuringPack!)) {
                      setInstalledPacks([...installedPacks, configuringPack!]);
                    }
                    setConfiguringPack(null);
                    setPackWizardStep('evidence');
                  } else if (currentIndex < steps.length - 1) {
                    setPackWizardStep(steps[currentIndex + 1]);
                  }
                }}
                className="px-6 py-2.5 bg-[#1D4ED8] text-white text-sm font-medium rounded-lg hover:bg-[#1e40af] transition-colors flex items-center gap-2"
              >
                {packWizardStep === 'activate' ? (
                  <>
                    <Check className="w-4 h-4" />
                    Activate Pack
                  </>
                ) : (
                  <>
                    Continue
                    <ChevronRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Template Library Modal */}
      {showTemplateLibrary && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl max-w-2xl w-full max-h-[85vh] overflow-hidden flex flex-col shadow-2xl">
            {/* Modal Header */}
            <div className="px-6 py-5 border-b border-[#E1E3E5] flex items-center justify-between bg-[#F7F8FA]">
              <div>
                <h2 className="text-xl font-bold text-[#0B1220]">Template Library</h2>
                <p className="text-sm text-[#667085] mt-1">
                  Install expert-built packs for common dispute types. Customize them to match your policies.
                </p>
              </div>
              <button
                onClick={() => setShowTemplateLibrary(false)}
                className="text-[#667085] hover:text-[#0B1220] transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Content */}
            <div className="flex-1 overflow-y-auto px-6 py-4">
              <div className="space-y-3">
                {evidencePackTemplates.map((template) => (
                  <div
                    key={template.id}
                    className="border border-[#E1E3E5] rounded-lg p-4 hover:border-[#1D4ED8] transition-colors"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <h3 className="text-sm font-semibold text-[#0B1220] mb-1.5">
                          {template.title}
                        </h3>
                        <p className="text-sm text-[#667085] leading-relaxed">
                          {template.description}
                        </p>
                      </div>
                      <button
                        onClick={() => {
                          if (installedPacks.includes(template.id)) {
                            setInstalledPacks(installedPacks.filter(id => id !== template.id));
                          } else {
                            setInstalledPacks([...installedPacks, template.id]);
                          }
                        }}
                        className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors flex-shrink-0 ${
                          installedPacks.includes(template.id)
                            ? 'bg-[#22C55E] text-white hover:bg-[#16A34A]'
                            : 'bg-[#0B1220] text-white hover:bg-[#1D4ED8]'
                        }`}
                      >
                        {installedPacks.includes(template.id) ? 'Installed ✓' : 'Install'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-4 border-t border-[#E1E3E5] bg-[#F7F8FA]">
              <div className="flex items-center justify-between">
                <p className="text-sm text-[#667085]">
                  {installedPacks.length} {installedPacks.length === 1 ? 'pack' : 'packs'} selected
                </p>
                <button
                  onClick={() => setShowTemplateLibrary(false)}
                  className="px-6 py-2.5 bg-[#1D4ED8] text-white rounded-lg text-sm font-medium hover:bg-[#1e40af] transition-colors"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Template Preview Modal */}
      {previewTemplate && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-[#E1E3E5] flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-[#202223]">
                  {templateContent[previewTemplate].title}
                </h3>
                <p className="text-sm text-[#6D7175] mt-1">
                  {templateContent[previewTemplate].description}
                </p>
              </div>
              <button
                onClick={() => setPreviewTemplate(null)}
                className="text-[#6D7175] hover:text-[#202223] transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto px-6 py-6">
              <div className="prose prose-sm max-w-none">
                <pre className="whitespace-pre-wrap font-sans text-sm text-[#202223] leading-relaxed">
                  {templateContent[previewTemplate].content}
                </pre>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-4 border-t border-[#E1E3E5] flex items-center justify-between bg-[#F7F8FA]">
              <div className="flex items-center gap-2 text-sm text-[#6D7175]">
                <FileText className="w-4 h-4" />
                <span>This template can be customized after setup</span>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setPreviewTemplate(null)}
                  className="px-4 py-2 text-sm font-medium text-[#202223] hover:bg-[#E1E3E5] rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    setMixedPolicies({ ...mixedPolicies, [previewTemplate]: 'template' });
                    setPolicyChoice('mix');
                    setPreviewTemplate(null);
                  }}
                  className="px-4 py-2 bg-[#1D4ED8] hover:bg-[#1e40af] text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-2"
                >
                  <Check className="w-4 h-4" />
                  Select This Template
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}