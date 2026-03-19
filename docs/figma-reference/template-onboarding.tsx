import React from 'react';
import { Modal } from './ui/modal';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { CheckCircle2, Globe, FileText, Shield } from 'lucide-react';

interface TemplateOnboardingProps {
  isOpen: boolean;
  onClose: () => void;
  onComplete: (data: OnboardingData) => void;
}

interface OnboardingData {
  storeLanguage: string;
  selectedTemplates: string[];
  policies: {
    shipping: string;
    returns: string;
    cancellation: string;
  };
}

const recommendedTemplates = [
  {
    id: 'TPL-001',
    name: 'Product Not Received — With Tracking',
    disputeType: 'Product Not Received',
    recommended: true,
  },
  {
    id: 'TPL-002',
    name: 'Fraudulent Transaction — Standard',
    disputeType: 'Fraudulent',
    recommended: true,
  },
  {
    id: 'TPL-003',
    name: 'Not as Described — Quality Issues',
    disputeType: 'Product Unacceptable',
    recommended: true,
  },
  {
    id: 'TPL-004',
    name: 'Subscription Cancellation — Comprehensive',
    disputeType: 'Subscription Canceled',
    recommended: false,
  },
  {
    id: 'TPL-006',
    name: 'Refund Already Processed',
    disputeType: 'Credit Not Processed',
    recommended: false,
  },
];

const languages = [
  { value: 'en', label: 'English' },
  { value: 'fr', label: 'Français' },
  { value: 'es', label: 'Español' },
  { value: 'pt', label: 'Português' },
  { value: 'de', label: 'Deutsch' },
  { value: 'it', label: 'Italiano' },
  { value: 'nl', label: 'Nederlands' },
];

export function TemplateOnboarding({ isOpen, onClose, onComplete }: TemplateOnboardingProps) {
  const [step, setStep] = React.useState(1);
  const [storeLanguage, setStoreLanguage] = React.useState('en');
  const [selectedTemplates, setSelectedTemplates] = React.useState<string[]>(['TPL-001', 'TPL-002', 'TPL-003']);
  const [policies, setPolicies] = React.useState({
    shipping: '',
    returns: '',
    cancellation: '',
  });

  const handleComplete = () => {
    onComplete({
      storeLanguage,
      selectedTemplates,
      policies,
    });
    onClose();
  };

  const toggleTemplate = (templateId: string) => {
    if (selectedTemplates.includes(templateId)) {
      setSelectedTemplates(selectedTemplates.filter(id => id !== templateId));
    } else {
      setSelectedTemplates([...selectedTemplates, templateId]);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Get started with evidence packs"
      description={`Step ${step} of 3`}
      size="lg"
      footer={
        <>
          {step > 1 && (
            <Button variant="ghost" onClick={() => setStep(step - 1)}>
              Back
            </Button>
          )}
          <div className="flex-1" />
          {step < 3 ? (
            <Button variant="primary" onClick={() => setStep(step + 1)}>
              Continue
            </Button>
          ) : (
            <Button variant="primary" onClick={handleComplete}>
              Install Templates
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-6">
        {/* Progress Indicators */}
        <div className="flex items-center gap-2 mb-8">
          {[1, 2, 3].map((num) => (
            <React.Fragment key={num}>
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold transition-colors ${
                  num === step
                    ? 'bg-[#1D4ED8] text-white'
                    : num < step
                    ? 'bg-[#22C55E] text-white'
                    : 'bg-[#F6F8FB] text-[#667085]'
                }`}
              >
                {num < step ? <CheckCircle2 className="w-5 h-5" /> : num}
              </div>
              {num < 3 && (
                <div
                  className={`flex-1 h-1 rounded-full transition-colors ${
                    num < step ? 'bg-[#22C55E]' : 'bg-[#E5E7EB]'
                  }`}
                />
              )}
            </React.Fragment>
          ))}
        </div>

        {/* Step 1: Language Selection */}
        {step === 1 && (
          <div className="space-y-6">
            <div className="text-center mb-8">
              <div className="w-16 h-16 bg-[#DBEAFE] rounded-full flex items-center justify-center mx-auto mb-4">
                <Globe className="w-8 h-8 text-[#1D4ED8]" />
              </div>
              <h3 className="text-xl font-bold text-[#0B1220] mb-2">Select your store language</h3>
              <p className="text-[#667085]">
                This helps us customize evidence narratives and translations for your region
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {languages.map((lang) => (
                <button
                  key={lang.value}
                  onClick={() => setStoreLanguage(lang.value)}
                  className={`p-4 border-2 rounded-lg text-left transition-all ${
                    storeLanguage === lang.value
                      ? 'border-[#1D4ED8] bg-[#EFF6FF]'
                      : 'border-[#E5E7EB] hover:border-[#1D4ED8]/30'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-[#0B1220]">{lang.label}</span>
                    {storeLanguage === lang.value && (
                      <CheckCircle2 className="w-5 h-5 text-[#1D4ED8]" />
                    )}
                  </div>
                </button>
              ))}
            </div>

            <div className="bg-[#F6F8FB] border border-[#E5E7EB] rounded-lg p-4">
              <p className="text-sm text-[#667085]">
                You can change this later in Settings. We'll always include an English summary for bank reviewers.
              </p>
            </div>
          </div>
        )}

        {/* Step 2: Template Selection */}
        {step === 2 && (
          <div className="space-y-6">
            <div className="text-center mb-8">
              <div className="w-16 h-16 bg-[#DCFCE7] rounded-full flex items-center justify-center mx-auto mb-4">
                <FileText className="w-8 h-8 text-[#22C55E]" />
              </div>
              <h3 className="text-xl font-bold text-[#0B1220] mb-2">Pick recommended templates</h3>
              <p className="text-[#667085]">
                Select the evidence packs you want to install. You can add more later.
              </p>
            </div>

            <div className="space-y-3">
              {recommendedTemplates.map((template) => (
                <div
                  key={template.id}
                  onClick={() => toggleTemplate(template.id)}
                  className={`p-4 border-2 rounded-lg cursor-pointer transition-all ${
                    selectedTemplates.includes(template.id)
                      ? 'border-[#1D4ED8] bg-[#EFF6FF]'
                      : 'border-[#E5E7EB] hover:border-[#1D4ED8]/30'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        checked={selectedTemplates.includes(template.id)}
                        onChange={() => toggleTemplate(template.id)}
                        className="w-5 h-5 text-[#1D4ED8] border-[#E5E7EB] rounded focus:ring-2 focus:ring-[#1D4ED8] mt-0.5"
                      />
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <h4 className="font-medium text-[#0B1220]">{template.name}</h4>
                          {template.recommended && (
                            <Badge variant="default" className="text-xs">Recommended</Badge>
                          )}
                        </div>
                        <p className="text-sm text-[#667085]">{template.disputeType}</p>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="bg-[#EFF6FF] border border-[#BFDBFE] rounded-lg p-4">
              <p className="text-sm text-[#1D4ED8]">
                <strong>{selectedTemplates.length} templates selected.</strong> All templates will be installed as drafts and can be customized before activating.
              </p>
            </div>
          </div>
        )}

        {/* Step 3: Policy Links */}
        {step === 3 && (
          <div className="space-y-6">
            <div className="text-center mb-8">
              <div className="w-16 h-16 bg-[#FEF3C7] rounded-full flex items-center justify-center mx-auto mb-4">
                <Shield className="w-8 h-8 text-[#F59E0B]" />
              </div>
              <h3 className="text-xl font-bold text-[#0B1220] mb-2">Link your store policies</h3>
              <p className="text-[#667085]">
                These will be automatically attached to evidence packs when relevant
              </p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-[#0B1220] mb-2">
                  Shipping Policy URL
                </label>
                <input
                  type="url"
                  value={policies.shipping}
                  onChange={(e) => setPolicies({ ...policies, shipping: e.target.value })}
                  placeholder="https://yourstore.com/policies/shipping"
                  className="w-full px-4 py-2.5 border border-[#E5E7EB] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1D4ED8] focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[#0B1220] mb-2">
                  Return/Refund Policy URL
                </label>
                <input
                  type="url"
                  value={policies.returns}
                  onChange={(e) => setPolicies({ ...policies, returns: e.target.value })}
                  placeholder="https://yourstore.com/policies/refunds"
                  className="w-full px-4 py-2.5 border border-[#E5E7EB] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1D4ED8] focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[#0B1220] mb-2">
                  Cancellation Policy URL
                </label>
                <input
                  type="url"
                  value={policies.cancellation}
                  onChange={(e) => setPolicies({ ...policies, cancellation: e.target.value })}
                  placeholder="https://yourstore.com/policies/cancellation"
                  className="w-full px-4 py-2.5 border border-[#E5E7EB] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1D4ED8] focus:border-transparent"
                />
              </div>
            </div>

            <div className="bg-[#F6F8FB] border border-[#E5E7EB] rounded-lg p-4">
              <p className="text-sm text-[#667085]">
                <strong>Optional:</strong> You can skip this step and add policy links later from the Policies page.
              </p>
            </div>

            <div className="bg-[#DCFCE7] border border-[#BBF7D0] rounded-lg p-4">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-[#22C55E] flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-[#0B1220] mb-1">Ready to install</p>
                  <p className="text-sm text-[#667085]">
                    {selectedTemplates.length} templates will be installed as drafts. Review and activate them when you're ready.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
