import React, { useState } from 'react';
import { ArrowLeft, CheckCircle2, Circle, Download, Info, ShoppingBag, FileText, Clock, DollarSign, User, Package, Shield, Link as LinkIcon, Search, Bell } from 'lucide-react';

type WizardStep = 'evidence' | 'sources' | 'review' | 'activate';

interface TemplateSetupWizardProps {
  templateType?: 'general' | 'product-not-received' | 'fraudulent' | 'duplicate';
  onComplete?: () => void;
  onBack?: () => void;
}

const evidenceTypes = [
  {
    id: 'order-details',
    icon: ShoppingBag,
    title: 'Order Details',
    description: 'Order number, date, amount, and status',
    autoCollected: true,
    recommended: true
  },
  {
    id: 'customer-info',
    icon: User,
    title: 'Customer Information',
    description: 'Name, email, billing address, and account history',
    autoCollected: true,
    recommended: true
  },
  {
    id: 'shipping-info',
    icon: Package,
    title: 'Shipping Information',
    description: 'Tracking number, carrier, delivery confirmation',
    autoCollected: true,
    recommended: true
  },
  {
    id: 'product-info',
    icon: FileText,
    title: 'Product Information',
    description: 'Product name, SKU, description, images',
    autoCollected: true,
    recommended: true
  },
  {
    id: 'policies',
    icon: Shield,
    title: 'Store Policies',
    description: 'Shipping, return, refund, and terms of service',
    autoCollected: false,
    recommended: true
  },
  {
    id: 'communication',
    icon: FileText,
    title: 'Customer Communication',
    description: 'Email exchanges and support tickets',
    autoCollected: false,
    recommended: false
  },
  {
    id: 'payment-proof',
    icon: DollarSign,
    title: 'Payment Proof',
    description: 'Transaction ID, payment method, authorization',
    autoCollected: true,
    recommended: true
  },
  {
    id: 'custom-fields',
    icon: FileText,
    title: 'Custom Fields',
    description: 'Additional evidence specific to your business',
    autoCollected: false,
    recommended: false
  }
];

const evidenceSources = {
  'order-details': [
    { name: 'Shopify Order API', type: 'auto', status: 'connected' },
    { name: 'Manual Upload', type: 'manual', status: 'available' }
  ],
  'customer-info': [
    { name: 'Shopify Customer API', type: 'auto', status: 'connected' },
    { name: 'Manual Upload', type: 'manual', status: 'available' }
  ],
  'shipping-info': [
    { name: 'Shopify Fulfillment API', type: 'auto', status: 'connected' },
    { name: 'Carrier Integration', type: 'auto', status: 'not-configured' },
    { name: 'Manual Upload', type: 'manual', status: 'available' }
  ],
  'product-info': [
    { name: 'Shopify Product API', type: 'auto', status: 'connected' },
    { name: 'Manual Upload', type: 'manual', status: 'available' }
  ],
  'policies': [
    { name: 'Policy URLs', type: 'manual', status: 'requires-setup' },
    { name: 'Uploaded Documents', type: 'manual', status: 'available' }
  ],
  'communication': [
    { name: 'Email Archive', type: 'manual', status: 'available' },
    { name: 'Support Ticket Export', type: 'manual', status: 'available' }
  ],
  'payment-proof': [
    { name: 'Shopify Payment API', type: 'auto', status: 'connected' },
    { name: 'Manual Upload', type: 'manual', status: 'available' }
  ],
  'custom-fields': [
    { name: 'Manual Upload', type: 'manual', status: 'available' }
  ]
};

export function TemplateSetupWizard({ templateType = 'general', onComplete, onBack }: TemplateSetupWizardProps) {
  const [currentStep, setCurrentStep] = useState<WizardStep>('evidence');
  const [selectedEvidence, setSelectedEvidence] = useState<string[]>(
    evidenceTypes.filter(e => e.recommended).map(e => e.id)
  );
  const [configuredSources, setConfiguredSources] = useState<Record<string, string[]>>({});

  const steps = [
    { id: 'evidence' as WizardStep, title: 'Choose evidence to collect', description: 'Select which evidence types this template should gather' },
    { id: 'sources' as WizardStep, title: 'Set evidence sources', description: 'Configure where each evidence type comes from' },
    { id: 'review' as WizardStep, title: 'Review how automation works', description: 'Understand the automatic collection process' },
    { id: 'activate' as WizardStep, title: 'Activate template', description: 'Make this template live for matching disputes' }
  ];

  const currentStepIndex = steps.findIndex(s => s.id === currentStep);
  const progress = ((currentStepIndex + 1) / steps.length) * 100;

  const toggleEvidence = (evidenceId: string) => {
    setSelectedEvidence(prev =>
      prev.includes(evidenceId)
        ? prev.filter(id => id !== evidenceId)
        : [...prev, evidenceId]
    );
  };

  const handleContinue = () => {
    const stepOrder: WizardStep[] = ['evidence', 'sources', 'review', 'activate'];
    const currentIndex = stepOrder.indexOf(currentStep);
    if (currentIndex < stepOrder.length - 1) {
      setCurrentStep(stepOrder[currentIndex + 1]);
    } else if (onComplete) {
      onComplete();
    }
  };

  const handleBack = () => {
    const stepOrder: WizardStep[] = ['evidence', 'sources', 'review', 'activate'];
    const currentIndex = stepOrder.indexOf(currentStep);
    if (currentIndex > 0) {
      setCurrentStep(stepOrder[currentIndex - 1]);
    }
  };

  const getTemplateTypeName = () => {
    const names = {
      'general': 'General',
      'product-not-received': 'Product Not Received',
      'fraudulent': 'Fraudulent',
      'duplicate': 'Duplicate Charge'
    };
    return names[templateType];
  };

  return (
    <div className="min-h-screen bg-[#F6F8FB]">
      {/* Shopify Top Bar - Fixed */}
      <div className="fixed top-0 left-0 right-0 bg-[#1A1A1A] text-white h-14 flex items-center px-4 border-b border-[#303030] z-50">
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

      {/* Content with top padding to account for fixed bar */}
      <div className="pt-14">
        {/* Top Banner */}
        <div className="bg-[#5B7FBA] text-white px-6 py-3.5">
          <div className="max-w-7xl mx-auto">
            <p className="text-sm font-medium text-center opacity-95">
              Template Setup Wizard — Complete these steps to activate your template
            </p>
          </div>
        </div>

        {/* Header */}
        <div className="bg-white border-b border-[#E1E3E5]">
          <div className="max-w-7xl mx-auto px-6 py-4">
            <button
              onClick={onBack}
              className="flex items-center gap-2 text-sm text-[#6D7175] hover:text-[#202223] transition-colors mb-4"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to Evidence Packs
            </button>

            <h1 className="text-2xl font-bold text-[#0B1220] mb-2">
              Set up your evidence template
            </h1>
            <p className="text-sm text-[#6D7175] mb-4">
              This template tells DisputeDesk what evidence to collect when this dispute type appears. Once complete, matching disputes can be prepared automatically.
            </p>

            <div className="flex items-center gap-6 text-xs text-[#6D7175]">
              <div>
                <span className="font-medium">Dispute type:</span>{' '}
                <span className="text-[#202223]">{getTemplateTypeName()}</span>
              </div>
              <div>
                <span className="font-medium">Status:</span>{' '}
                <span className="px-2.5 py-1 bg-[#FEF3C7] text-[#92400E] rounded-md text-xs font-medium">
                  Draft
                </span>
              </div>
              <div>
                <span className="font-medium">Created:</span>{' '}
                <span className="text-[#202223]">Mar 18, 2026, 02:14 PM</span>
              </div>
            </div>
          </div>
        </div>

        {/* Info Banner */}
        <div className="bg-white border-b border-[#E1E3E5]">
          <div className="max-w-7xl mx-auto px-6 py-4">
            <div className="flex items-start gap-3 p-3.5 bg-[#F0F7FF] border border-[#D4E5F7] rounded-lg">
              <Info className="w-5 h-5 text-[#5B7FBA] flex-shrink-0 mt-0.5" />
              <p className="text-sm text-[#4A5F8A]">
                You started from a recommended template. You can customize it before using it.
              </p>
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className="max-w-7xl mx-auto px-6 py-8">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left Sidebar - Steps */}
            <div className="lg:col-span-1">
              <div className="bg-white rounded-xl border border-[#E1E3E5] p-6">
                <div className="space-y-4">
                  {steps.map((step, index) => {
                    const isActive = step.id === currentStep;
                    const isCompleted = index < currentStepIndex;
                    
                    return (
                      <button
                        key={step.id}
                        onClick={() => setCurrentStep(step.id)}
                        className={`w-full text-left flex items-start gap-3 p-3 rounded-lg transition-all ${
                          isActive
                            ? 'bg-[#EFF6FF] border-2 border-[#1D4ED8]'
                            : 'hover:bg-[#F7F8FA]'
                        }`}
                      >
                        <div className="flex-shrink-0 mt-0.5">
                          {isCompleted ? (
                            <div className="w-6 h-6 rounded-full bg-[#5FB78E] flex items-center justify-center">
                              <CheckCircle2 className="w-4 h-4 text-white" />
                            </div>
                          ) : (
                            <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center text-xs font-bold ${
                              isActive
                                ? 'border-[#1D4ED8] bg-[#1D4ED8] text-white'
                                : 'border-[#C9CCCF] text-[#6D7175]'
                            }`}>
                              {index + 1}
                            </div>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className={`text-sm font-semibold mb-0.5 ${
                            isActive ? 'text-[#1D4ED8]' : 'text-[#202223]'
                          }`}>
                            {step.title}
                          </h3>
                          <p className="text-xs text-[#6D7175] leading-relaxed">
                            {step.description}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>

                {/* Progress Card */}
                <div className="mt-6 pt-6 border-t border-[#E1E3E5]">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-semibold text-[#202223]">Setup progress</span>
                    <span className="text-sm font-bold text-[#1D4ED8]">{Math.round(progress)}%</span>
                  </div>
                  <div className="w-full h-2 bg-[#E1E3E5] rounded-full overflow-hidden mb-4">
                    <div 
                      className="h-full bg-[#1D4ED8] rounded-full transition-all duration-300"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <div className="space-y-2 text-xs">
                    {steps.map((step, index) => {
                      const isCompleted = index < currentStepIndex;
                      const isActive = index === currentStepIndex;
                      return (
                        <div key={step.id} className="flex items-center gap-2">
                          {isCompleted ? (
                            <CheckCircle2 className="w-4 h-4 text-[#5FB78E]" />
                          ) : isActive ? (
                            <Circle className="w-4 h-4 text-[#1D4ED8] fill-[#1D4ED8]" />
                          ) : (
                            <Circle className="w-4 h-4 text-[#C9CCCF]" />
                          )}
                          <span className={isCompleted ? 'text-[#6D7175] line-through' : 'text-[#202223]'}>
                            {step.title}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  <div className="mt-6 pt-6 border-t border-[#E1E3E5] space-y-2">
                    <p className="text-xs font-semibold text-[#202223] mb-2">Template status</p>
                    <div className="px-3 py-2 bg-[#FEF3C7] border border-[#FDE68A] rounded-lg">
                      <div className="flex items-center gap-2">
                        <Clock className="w-4 h-4 text-[#92400E]" />
                        <span className="text-xs font-medium text-[#92400E]">In progress</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="mt-6 pt-6 border-t border-[#E1E3E5] space-y-2">
                  <button
                    onClick={onBack}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm text-[#6D7175] hover:text-[#202223] hover:bg-[#F7F8FA] rounded-lg transition-colors"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    Back to templates
                  </button>
                  <button className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm text-[#6D7175] hover:text-[#202223] hover:bg-[#F7F8FA] rounded-lg transition-colors">
                    <Download className="w-4 h-4" />
                    Export a PDF copy
                  </button>
                </div>
              </div>
            </div>

            {/* Main Content Area */}
            <div className="lg:col-span-2">
              <div className="bg-white rounded-xl border border-[#E1E3E5] p-6">
                {/* Step 1: Choose Evidence */}
                {currentStep === 'evidence' && (
                  <div>
                    <h2 className="text-lg font-bold text-[#0B1220] mb-2">
                      Choose evidence to collect
                    </h2>
                    <p className="text-sm text-[#6D7175] mb-6">
                      Select the types of evidence DisputeDesk should look for when this dispute type appears.
                    </p>

                    {/* Auto-collected from Shopify */}
                    <div className="mb-6">
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="text-sm font-semibold text-[#202223]">
                          Auto-collected from Shopify
                        </h3>
                        <span className="text-xs text-[#6D7175]">
                          {evidenceTypes.filter(e => e.autoCollected && selectedEvidence.includes(e.id)).length} selected
                        </span>
                      </div>
                      <p className="text-xs text-[#6D7175] mb-4">
                        These evidence types are pulled from your{' '}
                        <span className="text-[#1D4ED8] underline cursor-pointer">store details</span>{' '}
                        when a dispute matches this template.
                      </p>

                      <div className="space-y-3">
                        {evidenceTypes.filter(e => e.autoCollected).map((evidence) => {
                          const Icon = evidence.icon;
                          const isSelected = selectedEvidence.includes(evidence.id);

                          return (
                            <label
                              key={evidence.id}
                              className={`flex items-start gap-4 p-4 border-2 rounded-lg cursor-pointer transition-all ${
                                isSelected
                                  ? 'border-[#1D4ED8] bg-[#EFF6FF]'
                                  : 'border-[#E1E3E5] hover:border-[#C9CCCF] hover:bg-[#F7F8FA]'
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => toggleEvidence(evidence.id)}
                                className="mt-1 w-4 h-4 text-[#1D4ED8] border-[#C9CCCF] rounded focus:ring-[#1D4ED8]"
                              />
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1">
                                  <Icon className="w-4 h-4 text-[#1D4ED8]" />
                                  <h4 className="text-sm font-semibold text-[#202223]">
                                    {evidence.title}
                                  </h4>
                                  {evidence.recommended && (
                                    <span className="px-2 py-0.5 bg-[#A8D5BA] text-[#1E5631] text-xs font-medium rounded-full">
                                      Recommended
                                    </span>
                                  )}
                                </div>
                                <p className="text-xs text-[#6D7175]">
                                  {evidence.description}
                                </p>
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    </div>

                    {/* Manual Collection */}
                    <div>
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="text-sm font-semibold text-[#202223]">
                          Manual collection
                        </h3>
                        <span className="text-xs text-[#6D7175]">
                          {evidenceTypes.filter(e => !e.autoCollected && selectedEvidence.includes(e.id)).length} selected
                        </span>
                      </div>
                      <p className="text-xs text-[#6D7175] mb-4">
                        These evidence types require manual upload or configuration.
                      </p>

                      <div className="space-y-3">
                        {evidenceTypes.filter(e => !e.autoCollected).map((evidence) => {
                          const Icon = evidence.icon;
                          const isSelected = selectedEvidence.includes(evidence.id);

                          return (
                            <label
                              key={evidence.id}
                              className={`flex items-start gap-4 p-4 border-2 rounded-lg cursor-pointer transition-all ${
                                isSelected
                                  ? 'border-[#1D4ED8] bg-[#EFF6FF]'
                                  : 'border-[#E1E3E5] hover:border-[#C9CCCF] hover:bg-[#F7F8FA]'
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => toggleEvidence(evidence.id)}
                                className="mt-1 w-4 h-4 text-[#1D4ED8] border-[#C9CCCF] rounded focus:ring-[#1D4ED8]"
                              />
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1">
                                  <Icon className="w-4 h-4 text-[#6D7175]" />
                                  <h4 className="text-sm font-semibold text-[#202223]">
                                    {evidence.title}
                                  </h4>
                                  {evidence.recommended && (
                                    <span className="px-2 py-0.5 bg-[#22C55E] text-white text-xs font-medium rounded-full">
                                      Recommended
                                    </span>
                                  )}
                                </div>
                                <p className="text-xs text-[#6D7175]">
                                  {evidence.description}
                                </p>
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}

                {/* Step 2: Set Sources */}
                {currentStep === 'sources' && (
                  <div>
                    <h2 className="text-lg font-bold text-[#0B1220] mb-2">
                      Set evidence sources
                    </h2>
                    <p className="text-sm text-[#6D7175] mb-6">
                      Configure where each type of evidence will come from.
                    </p>

                    <div className="space-y-6">
                      {selectedEvidence.map(evidenceId => {
                        const evidence = evidenceTypes.find(e => e.id === evidenceId);
                        const sources = evidenceSources[evidenceId as keyof typeof evidenceSources] || [];
                        const Icon = evidence?.icon || FileText;

                        return (
                          <div key={evidenceId} className="border border-[#E1E3E5] rounded-lg p-4">
                            <div className="flex items-center gap-2 mb-4">
                              <Icon className="w-5 h-5 text-[#1D4ED8]" />
                              <h3 className="text-sm font-semibold text-[#202223]">
                                {evidence?.title}
                              </h3>
                            </div>

                            <div className="space-y-2">
                              {sources.map((source, idx) => (
                                <div
                                  key={idx}
                                  className="flex items-center justify-between p-3 bg-[#F7F8FA] rounded-lg"
                                >
                                  <div className="flex items-center gap-3">
                                    <LinkIcon className="w-4 h-4 text-[#6D7175]" />
                                    <div>
                                      <p className="text-sm font-medium text-[#202223]">
                                        {source.name}
                                      </p>
                                      <p className="text-xs text-[#6D7175]">
                                        {source.type === 'auto' ? 'Automatic' : 'Manual'}
                                      </p>
                                    </div>
                                  </div>
                                  <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                                    source.status === 'connected'
                                      ? 'bg-[#DCFCE7] text-[#166534]'
                                      : source.status === 'requires-setup'
                                      ? 'bg-[#FEF3C7] text-[#92400E]'
                                      : 'bg-[#E1E3E5] text-[#6D7175]'
                                  }`}>
                                    {source.status === 'connected' ? 'Connected' :
                                     source.status === 'requires-setup' ? 'Setup Required' :
                                     source.status === 'not-configured' ? 'Not Configured' :
                                     'Available'}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Step 3: Review Automation */}
                {currentStep === 'review' && (
                  <div>
                    <h2 className="text-lg font-bold text-[#0B1220] mb-2">
                      Review how automation works
                    </h2>
                    <p className="text-sm text-[#6D7175] mb-6">
                      Here's how DisputeDesk will handle disputes matching this template.
                    </p>

                    <div className="space-y-4">
                      <div className="flex items-start gap-4 p-4 bg-[#EFF6FF] border border-[#BFDBFE] rounded-lg">
                        <div className="w-8 h-8 rounded-full bg-[#1D4ED8] text-white flex items-center justify-center font-bold text-sm flex-shrink-0">
                          1
                        </div>
                        <div>
                          <h3 className="text-sm font-semibold text-[#202223] mb-1">
                            Dispute Detection
                          </h3>
                          <p className="text-sm text-[#6D7175]">
                            When a new dispute arrives, DisputeDesk checks if it matches this template type ({getTemplateTypeName()}).
                          </p>
                        </div>
                      </div>

                      <div className="flex items-start gap-4 p-4 bg-[#EFF6FF] border border-[#BFDBFE] rounded-lg">
                        <div className="w-8 h-8 rounded-full bg-[#1D4ED8] text-white flex items-center justify-center font-bold text-sm flex-shrink-0">
                          2
                        </div>
                        <div>
                          <h3 className="text-sm font-semibold text-[#202223] mb-1">
                            Evidence Collection
                          </h3>
                          <p className="text-sm text-[#6D7175] mb-2">
                            DisputeDesk automatically collects the selected evidence:
                          </p>
                          <ul className="text-sm text-[#6D7175] space-y-1 ml-4">
                            {selectedEvidence.slice(0, 4).map(id => {
                              const evidence = evidenceTypes.find(e => e.id === id);
                              return (
                                <li key={id} className="flex items-center gap-2">
                                  <CheckCircle2 className="w-3.5 h-3.5 text-[#22C55E]" />
                                  {evidence?.title}
                                </li>
                              );
                            })}
                            {selectedEvidence.length > 4 && (
                              <li className="text-xs text-[#6D7175] ml-5">
                                ...and {selectedEvidence.length - 4} more
                              </li>
                            )}
                          </ul>
                        </div>
                      </div>

                      <div className="flex items-start gap-4 p-4 bg-[#EFF6FF] border border-[#BFDBFE] rounded-lg">
                        <div className="w-8 h-8 rounded-full bg-[#1D4ED8] text-white flex items-center justify-center font-bold text-sm flex-shrink-0">
                          3
                        </div>
                        <div>
                          <h3 className="text-sm font-semibold text-[#202223] mb-1">
                            Evidence Pack Creation
                          </h3>
                          <p className="text-sm text-[#6D7175]">
                            All collected evidence is compiled into a ready-to-submit evidence pack. You can review and edit before submission.
                          </p>
                        </div>
                      </div>

                      <div className="flex items-start gap-4 p-4 bg-[#DCFCE7] border border-[#86EFAC] rounded-lg">
                        <div className="w-8 h-8 rounded-full bg-[#22C55E] text-white flex items-center justify-center font-bold text-sm flex-shrink-0">
                          4
                        </div>
                        <div>
                          <h3 className="text-sm font-semibold text-[#202223] mb-1">
                            Notification & Review
                          </h3>
                          <p className="text-sm text-[#6D7175]">
                            You'll be notified when the pack is ready. Review, make any final changes, and submit to Shopify with one click.
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Step 4: Activate */}
                {currentStep === 'activate' && (
                  <div>
                    <h2 className="text-lg font-bold text-[#0B1220] mb-2">
                      Activate template
                    </h2>
                    <p className="text-sm text-[#6D7175] mb-6">
                      Review your template configuration and activate it to start automating dispute responses.
                    </p>

                    <div className="space-y-6">
                      {/* Summary */}
                      <div className="border border-[#E1E3E5] rounded-lg p-4">
                        <h3 className="text-sm font-semibold text-[#202223] mb-4">
                          Template Summary
                        </h3>
                        <div className="grid grid-cols-2 gap-4 text-sm">
                          <div>
                            <span className="text-[#6D7175]">Template type:</span>
                            <p className="font-medium text-[#202223]">{getTemplateTypeName()}</p>
                          </div>
                          <div>
                            <span className="text-[#6D7175]">Evidence types:</span>
                            <p className="font-medium text-[#202223]">{selectedEvidence.length} selected</p>
                          </div>
                          <div>
                            <span className="text-[#6D7175]">Auto-collected:</span>
                            <p className="font-medium text-[#202223]">
                              {selectedEvidence.filter(id => evidenceTypes.find(e => e.id === id)?.autoCollected).length} types
                            </p>
                          </div>
                          <div>
                            <span className="text-[#6D7175]">Manual collection:</span>
                            <p className="font-medium text-[#202223]">
                              {selectedEvidence.filter(id => !evidenceTypes.find(e => e.id === id)?.autoCollected).length} types
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* Activation */}
                      <div className="border-2 border-[#22C55E] bg-[#F0FDF4] rounded-lg p-6">
                        <div className="flex items-start gap-4">
                          <CheckCircle2 className="w-6 h-6 text-[#22C55E] flex-shrink-0 mt-0.5" />
                          <div>
                            <h3 className="text-base font-semibold text-[#202223] mb-2">
                              Ready to activate
                            </h3>
                            <p className="text-sm text-[#6D7175] mb-4">
                              Once activated, this template will automatically process all new {getTemplateTypeName().toLowerCase()} disputes. You can pause or edit it at any time.
                            </p>
                            <button className="px-6 py-2.5 bg-[#22C55E] hover:bg-[#16A34A] text-white rounded-lg text-sm font-medium transition-colors">
                              Activate Template
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Navigation Footer */}
              <div className="flex items-center justify-between mt-6">
                <button
                  onClick={handleBack}
                  disabled={currentStepIndex === 0}
                  className="px-4 py-2 text-sm font-medium text-[#6D7175] hover:text-[#202223] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  Previous
                </button>
                <button
                  onClick={handleContinue}
                  className="px-6 py-2.5 bg-[#1D4ED8] hover:bg-[#1e40af] text-white rounded-lg text-sm font-medium transition-colors"
                >
                  {currentStep === 'activate' ? 'Complete Setup' : 'Continue'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}