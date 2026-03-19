import React from 'react';
import { Modal } from './ui/modal';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Globe, Loader2, Sparkles } from 'lucide-react';

interface PackBuilderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: () => void;
  packId?: string;
}

export function PackBuilderModal({ isOpen, onClose, onSave, packId }: PackBuilderModalProps) {
  const [activeTab, setActiveTab] = React.useState<'documents' | 'narrative' | 'rules'>('documents');
  const [packName, setPackName] = React.useState('Product Not Received — With Tracking');
  const [disputeType, setDisputeType] = React.useState('Product Not Received');
  const [status, setStatus] = React.useState<'draft' | 'active'>('draft');
  
  // Narrative settings
  const [includeEnglish, setIncludeEnglish] = React.useState(true);
  const [includeStoreLanguage, setIncludeStoreLanguage] = React.useState(true);
  const [storeLanguage, setStoreLanguage] = React.useState('fr');
  const [englishSummary, setEnglishSummary] = React.useState('');
  const [storeLanguageSummary, setStoreLanguageSummary] = React.useState('');
  const [attachTranslated, setAttachTranslated] = React.useState(false);
  const [isGenerating, setIsGenerating] = React.useState(false);

  const languages = [
    { value: 'fr', label: 'Français' },
    { value: 'es', label: 'Español' },
    { value: 'pt', label: 'Português' },
    { value: 'de', label: 'Deutsch' },
    { value: 'it', label: 'Italiano' },
    { value: 'nl', label: 'Nederlands' },
  ];

  const handleGenerateDraft = () => {
    setIsGenerating(true);
    // Simulate API call
    setTimeout(() => {
      setEnglishSummary(
        'Customer initiated a chargeback claiming non-receipt. We fulfilled the order on February 15, 2024 via FedEx. Tracking number 1Z999AA10123456784 shows delivery on February 18, 2024 to the address provided by the customer at 123 Main St, New York, NY 10001. Signature on file confirms receipt by "J. Smith".'
      );
      setStoreLanguageSummary(
        'Le client a initié une contestation de débit en prétendant ne pas avoir reçu la commande. Nous avons expédié la commande le 15 février 2024 via FedEx. Le numéro de suivi 1Z999AA10123456784 confirme la livraison le 18 février 2024 à l\'adresse fournie par le client au 123 Main St, New York, NY 10001. La signature au dossier confirme la réception par "J. Smith".'
      );
      setIsGenerating(false);
    }, 2000);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={packId ? 'Edit Evidence Pack' : 'Create Evidence Pack'}
      description="Configure documents, narratives, and automation rules"
      size="xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={onSave}>
            {status === 'draft' ? 'Save as Draft' : 'Save & Activate'}
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        {/* Pack Header */}
        <div className="space-y-4 pb-6 border-b border-[#E5E7EB]">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-[#0B1220] mb-2">
                Pack Name *
              </label>
              <input
                type="text"
                value={packName}
                onChange={(e) => setPackName(e.target.value)}
                className="w-full px-4 py-2.5 border border-[#E5E7EB] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1D4ED8] focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[#0B1220] mb-2">
                Dispute Type *
              </label>
              <select
                value={disputeType}
                onChange={(e) => setDisputeType(e.target.value)}
                className="w-full px-4 py-2.5 border border-[#E5E7EB] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1D4ED8] focus:border-transparent"
              >
                <option value="Fraudulent">Fraudulent Transaction</option>
                <option value="Product Not Received">Product Not Received</option>
                <option value="Product Unacceptable">Product Unacceptable</option>
                <option value="Subscription Canceled">Subscription Canceled</option>
                <option value="Credit Not Processed">Credit Not Processed</option>
                <option value="General">General</option>
              </select>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-sm text-[#667085]">Status:</span>
            <button
              onClick={() => setStatus('draft')}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                status === 'draft'
                  ? 'bg-[#F6F8FB] text-[#0B1220] border border-[#E5E7EB]'
                  : 'text-[#667085] hover:text-[#0B1220]'
              }`}
            >
              Draft
            </button>
            <button
              onClick={() => setStatus('active')}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                status === 'active'
                  ? 'bg-[#DCFCE7] text-[#166534] border border-[#BBF7D0]'
                  : 'text-[#667085] hover:text-[#0B1220]'
              }`}
            >
              Active
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="border-b border-[#E5E7EB]">
          <div className="flex gap-6">
            <button
              onClick={() => setActiveTab('documents')}
              className={`pb-3 px-1 border-b-2 transition-colors ${
                activeTab === 'documents'
                  ? 'border-[#1D4ED8] text-[#1D4ED8] font-medium'
                  : 'border-transparent text-[#667085] hover:text-[#0B1220]'
              }`}
            >
              Documents
            </button>
            <button
              onClick={() => setActiveTab('narrative')}
              className={`pb-3 px-1 border-b-2 transition-colors flex items-center gap-2 ${
                activeTab === 'narrative'
                  ? 'border-[#1D4ED8] text-[#1D4ED8] font-medium'
                  : 'border-transparent text-[#667085] hover:text-[#0B1220]'
              }`}
            >
              <Globe className="w-4 h-4" />
              Narrative
            </button>
            <button
              onClick={() => setActiveTab('rules')}
              className={`pb-3 px-1 border-b-2 transition-colors ${
                activeTab === 'rules'
                  ? 'border-[#1D4ED8] text-[#1D4ED8] font-medium'
                  : 'border-transparent text-[#667085] hover:text-[#0B1220]'
              }`}
            >
              Rules
            </button>
          </div>
        </div>

        {/* Tab Content */}
        <div className="min-h-[400px]">
          {activeTab === 'documents' && (
            <div className="space-y-4">
              <p className="text-sm text-[#667085]">
                Configure which documents are included in this evidence pack. Documents will be automatically gathered from order data.
              </p>
              <div className="bg-[#F6F8FB] border border-[#E5E7EB] rounded-lg p-6 text-center">
                <p className="text-sm text-[#667085]">Documents configuration placeholder</p>
              </div>
            </div>
          )}

          {activeTab === 'narrative' && (
            <div className="space-y-6">
              {/* Language Settings */}
              <div className="bg-[#F6F8FB] border border-[#E5E7EB] rounded-lg p-4 space-y-4">
                <h4 className="font-medium text-[#0B1220]">Reviewer Summary Language</h4>
                
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    id="includeEnglish"
                    checked={includeEnglish}
                    onChange={(e) => setIncludeEnglish(e.target.checked)}
                    className="w-4 h-4 text-[#1D4ED8] border-[#E5E7EB] rounded focus:ring-2 focus:ring-[#1D4ED8]"
                  />
                  <label htmlFor="includeEnglish" className="text-sm text-[#0B1220]">
                    Always include English summary
                  </label>
                  <Badge variant="default" className="text-xs">Recommended</Badge>
                </div>

                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    id="includeStoreLanguage"
                    checked={includeStoreLanguage}
                    onChange={(e) => setIncludeStoreLanguage(e.target.checked)}
                    className="w-4 h-4 text-[#1D4ED8] border-[#E5E7EB] rounded focus:ring-2 focus:ring-[#1D4ED8]"
                  />
                  <label htmlFor="includeStoreLanguage" className="text-sm text-[#0B1220]">
                    Also include store language summary
                  </label>
                </div>

                {includeStoreLanguage && (
                  <div>
                    <label className="block text-sm font-medium text-[#0B1220] mb-2">
                      Store Language
                    </label>
                    <select
                      value={storeLanguage}
                      onChange={(e) => setStoreLanguage(e.target.value)}
                      className="w-full px-4 py-2.5 border border-[#E5E7EB] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1D4ED8] focus:border-transparent bg-white"
                    >
                      {languages.map((lang) => (
                        <option key={lang.value} value={lang.value}>
                          {lang.label}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {/* Generate Button */}
              <div className="flex justify-center">
                <Button
                  variant="secondary"
                  onClick={handleGenerateDraft}
                  disabled={isGenerating}
                >
                  {isGenerating ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4 mr-2" />
                      Generate draft from order data
                    </>
                  )}
                </Button>
              </div>

              {/* Narrative Textareas */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* English Summary */}
                {includeEnglish && (
                  <div>
                    <label className="block text-sm font-medium text-[#0B1220] mb-2">
                      Bank-facing summary (English) *
                    </label>
                    <textarea
                      value={englishSummary}
                      onChange={(e) => setEnglishSummary(e.target.value)}
                      placeholder="Describe the evidence and timeline in English for the card network reviewers..."
                      rows={8}
                      className="w-full px-4 py-2.5 border border-[#E5E7EB] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1D4ED8] focus:border-transparent resize-none"
                    />
                  </div>
                )}

                {/* Store Language Summary */}
                {includeStoreLanguage && (
                  <div>
                    <label className="block text-sm font-medium text-[#0B1220] mb-2">
                      Merchant copy ({languages.find(l => l.value === storeLanguage)?.label})
                    </label>
                    <textarea
                      value={storeLanguageSummary}
                      onChange={(e) => setStoreLanguageSummary(e.target.value)}
                      placeholder={`Version traduite pour votre référence...`}
                      rows={8}
                      className="w-full px-4 py-2.5 border border-[#E5E7EB] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1D4ED8] focus:border-transparent resize-none"
                    />
                  </div>
                )}
              </div>

              {/* Translation Options */}
              <div className="bg-[#EFF6FF] border border-[#BFDBFE] rounded-lg p-4 space-y-3">
                <p className="text-sm text-[#1D4ED8]">
                  <strong>Translation policy:</strong> If we auto-translate customer messages, we keep the original alongside the translation.
                </p>
                
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    id="attachTranslated"
                    checked={attachTranslated}
                    onChange={(e) => setAttachTranslated(e.target.checked)}
                    className="w-4 h-4 text-[#1D4ED8] border-[#E5E7EB] rounded focus:ring-2 focus:ring-[#1D4ED8]"
                  />
                  <label htmlFor="attachTranslated" className="text-sm text-[#0B1220]">
                    Attach translated customer messages (EN)
                  </label>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'rules' && (
            <div className="space-y-4">
              <p className="text-sm text-[#667085]">
                Set up automation rules for when this pack should be applied automatically.
              </p>
              <div className="bg-[#F6F8FB] border border-[#E5E7EB] rounded-lg p-6 text-center">
                <p className="text-sm text-[#667085]">Rules configuration coming soon</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
