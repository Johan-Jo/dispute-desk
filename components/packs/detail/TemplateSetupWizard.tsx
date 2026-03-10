"use client";

import React, { useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  CheckCircle2,
  Circle,
  ArrowLeft,
  Upload,
  FileText,
  AlertCircle,
  HelpCircle,
  X,
  Check,
  ChevronRight,
  Download,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/components/ui/utils";

interface EvidenceType {
  id: string;
  titleKey: string;
  descKey: string;
  /** When set, shown instead of t(titleKey) — e.g. from pack checklist */
  title?: string;
  /** When set, shown instead of t(descKey) */
  description?: string;
  badge: "Required" | "Recommended" | "Optional";
  selected: boolean;
}

interface UploadedFile {
  id: string;
  name: string;
  size: string;
  status: "uploaded" | "uploading";
}

export interface TemplateSetupWizardPack {
  id?: string | null;
  name?: string | null;
  dispute_type?: string | null;
  created_at?: string | null;
  template_name?: string | null;
  evidence_items?: { id: string; label: string; type: string }[];
  /** When present, step 1 evidence list is built from this (template content). */
  checklist?: { field: string; label: string; required: boolean; present?: boolean }[] | null;
}

/** Default evidence config per dispute type (id, titleKey, descKey, badge). */
const DEFAULT_EVIDENCE: EvidenceType[] = [
  { id: "order-confirmation", titleKey: "evidenceOrderConfirmation", descKey: "evidenceOrderConfirmationDesc", badge: "Required", selected: true },
  { id: "tracking-info", titleKey: "evidenceTracking", descKey: "evidenceTrackingDesc", badge: "Required", selected: true },
  { id: "refund-policy", titleKey: "evidenceRefundPolicy", descKey: "evidenceRefundPolicyDesc", badge: "Recommended", selected: true },
  { id: "customer-comms", titleKey: "evidenceCustomerComms", descKey: "evidenceCustomerCommsDesc", badge: "Recommended", selected: true },
  { id: "product-description", titleKey: "evidenceProductDescription", descKey: "evidenceProductDescriptionDesc", badge: "Optional", selected: false },
  { id: "terms-of-service", titleKey: "evidenceTerms", descKey: "evidenceTermsDesc", badge: "Optional", selected: false },
];

const DISPUTE_EVIDENCE_DEFAULTS: Record<string, Omit<EvidenceType, "selected">[]> = {
  PRODUCT_NOT_RECEIVED: [
    { id: "order-confirmation", titleKey: "evidenceOrderConfirmation", descKey: "evidenceOrderConfirmationDesc", badge: "Required" },
    { id: "tracking-info", titleKey: "evidenceTracking", descKey: "evidenceTrackingDesc", badge: "Required" },
    { id: "billing-shipping", titleKey: "evidenceBillingShipping", descKey: "evidenceBillingShippingDesc", badge: "Recommended" },
    { id: "customer-comms", titleKey: "evidenceCustomerComms", descKey: "evidenceCustomerCommsDesc", badge: "Recommended" },
    { id: "refund-policy", titleKey: "evidenceRefundPolicy", descKey: "evidenceRefundPolicyDesc", badge: "Recommended" },
    { id: "store-policy", titleKey: "evidenceTerms", descKey: "evidenceTermsDesc", badge: "Optional" },
  ],
  PNR: [
    { id: "order-confirmation", titleKey: "evidenceOrderConfirmation", descKey: "evidenceOrderConfirmationDesc", badge: "Required" },
    { id: "tracking-info", titleKey: "evidenceTracking", descKey: "evidenceTrackingDesc", badge: "Required" },
    { id: "billing-shipping", titleKey: "evidenceBillingShipping", descKey: "evidenceBillingShippingDesc", badge: "Recommended" },
    { id: "customer-comms", titleKey: "evidenceCustomerComms", descKey: "evidenceCustomerCommsDesc", badge: "Recommended" },
    { id: "store-policy", titleKey: "evidenceTerms", descKey: "evidenceTermsDesc", badge: "Optional" },
  ],
  FRAUD: [
    { id: "order-confirmation", titleKey: "evidenceOrderConfirmation", descKey: "evidenceOrderConfirmationDesc", badge: "Required" },
    { id: "tracking-info", titleKey: "evidenceTracking", descKey: "evidenceTrackingDesc", badge: "Required" },
    { id: "billing-shipping", titleKey: "evidenceBillingShipping", descKey: "evidenceBillingShippingDesc", badge: "Required" },
    { id: "customer-comms", titleKey: "evidenceCustomerComms", descKey: "evidenceCustomerCommsDesc", badge: "Recommended" },
    { id: "store-policy", titleKey: "evidenceTerms", descKey: "evidenceTermsDesc", badge: "Recommended" },
    { id: "fraud-screening", titleKey: "evidenceFraudScreening", descKey: "evidenceFraudScreeningDesc", badge: "Recommended" },
    { id: "metadata", titleKey: "evidenceMetadata", descKey: "evidenceMetadataDesc", badge: "Optional" },
  ],
  FRAUDULENT: [
    { id: "order-confirmation", titleKey: "evidenceOrderConfirmation", descKey: "evidenceOrderConfirmationDesc", badge: "Required" },
    { id: "tracking-info", titleKey: "evidenceTracking", descKey: "evidenceTrackingDesc", badge: "Required" },
    { id: "billing-shipping", titleKey: "evidenceBillingShipping", descKey: "evidenceBillingShippingDesc", badge: "Required" },
    { id: "customer-comms", titleKey: "evidenceCustomerComms", descKey: "evidenceCustomerCommsDesc", badge: "Recommended" },
    { id: "store-policy", titleKey: "evidenceTerms", descKey: "evidenceTermsDesc", badge: "Recommended" },
    { id: "fraud-screening", titleKey: "evidenceFraudScreening", descKey: "evidenceFraudScreeningDesc", badge: "Recommended" },
    { id: "metadata", titleKey: "evidenceMetadata", descKey: "evidenceMetadataDesc", badge: "Optional" },
  ],
  NOT_AS_DESCRIBED: [
    { id: "order-confirmation", titleKey: "evidenceOrderConfirmation", descKey: "evidenceOrderConfirmationDesc", badge: "Required" },
    { id: "refund-policy", titleKey: "evidenceRefundPolicy", descKey: "evidenceRefundPolicyDesc", badge: "Recommended" },
    { id: "customer-comms", titleKey: "evidenceCustomerComms", descKey: "evidenceCustomerCommsDesc", badge: "Recommended" },
    { id: "product-description", titleKey: "evidenceProductDescription", descKey: "evidenceProductDescriptionDesc", badge: "Recommended" },
    { id: "store-policy", titleKey: "evidenceTerms", descKey: "evidenceTermsDesc", badge: "Optional" },
  ],
  REFUND: [
    { id: "order-confirmation", titleKey: "evidenceOrderConfirmation", descKey: "evidenceOrderConfirmationDesc", badge: "Required" },
    { id: "refund-policy", titleKey: "evidenceRefundPolicy", descKey: "evidenceRefundPolicyDesc", badge: "Required" },
    { id: "customer-comms", titleKey: "evidenceCustomerComms", descKey: "evidenceCustomerCommsDesc", badge: "Recommended" },
    { id: "store-policy", titleKey: "evidenceTerms", descKey: "evidenceTermsDesc", badge: "Optional" },
  ],
  SUBSCRIPTION: [
    { id: "order-confirmation", titleKey: "evidenceOrderConfirmation", descKey: "evidenceOrderConfirmationDesc", badge: "Required" },
    { id: "refund-policy", titleKey: "evidenceRefundPolicy", descKey: "evidenceRefundPolicyDesc", badge: "Recommended" },
    { id: "customer-comms", titleKey: "evidenceCustomerComms", descKey: "evidenceCustomerCommsDesc", badge: "Recommended" },
    { id: "store-policy", titleKey: "evidenceTerms", descKey: "evidenceTermsDesc", badge: "Optional" },
  ],
  DUPLICATE: [
    { id: "order-confirmation", titleKey: "evidenceOrderConfirmation", descKey: "evidenceOrderConfirmationDesc", badge: "Required" },
    { id: "billing-shipping", titleKey: "evidenceBillingShipping", descKey: "evidenceBillingShippingDesc", badge: "Recommended" },
    { id: "customer-comms", titleKey: "evidenceCustomerComms", descKey: "evidenceCustomerCommsDesc", badge: "Recommended" },
    { id: "store-policy", titleKey: "evidenceTerms", descKey: "evidenceTermsDesc", badge: "Optional" },
  ],
  GENERAL: [
    { id: "order-confirmation", titleKey: "evidenceOrderConfirmation", descKey: "evidenceOrderConfirmationDesc", badge: "Required" },
    { id: "tracking-info", titleKey: "evidenceTracking", descKey: "evidenceTrackingDesc", badge: "Recommended" },
    { id: "customer-comms", titleKey: "evidenceCustomerComms", descKey: "evidenceCustomerCommsDesc", badge: "Recommended" },
    { id: "refund-policy", titleKey: "evidenceRefundPolicy", descKey: "evidenceRefundPolicyDesc", badge: "Recommended" },
    { id: "store-policy", titleKey: "evidenceTerms", descKey: "evidenceTermsDesc", badge: "Optional" },
  ],
};

function buildInitialEvidenceTypes(
  pack: TemplateSetupWizardPack | null | undefined,
  disputeTypeKey: string
): EvidenceType[] {
  if (pack?.checklist && pack.checklist.length > 0) {
    return pack.checklist.map((c) => ({
      id: c.field,
      titleKey: "",
      descKey: "",
      title: c.label,
      description: "",
      badge: c.required ? ("Required" as const) : ("Recommended" as const),
      selected: true,
    }));
  }
  const defaults = DISPUTE_EVIDENCE_DEFAULTS[disputeTypeKey] ?? DEFAULT_EVIDENCE.map(({ selected: _, ...e }) => e);
  return defaults.map((e) => ({
    ...e,
    titleKey: e.titleKey,
    descKey: e.descKey,
    selected: e.badge !== "Optional",
  }));
}

interface TemplateSetupWizardProps {
  /** When provided, step 2 uploads go to this pack and we can prefill from pack.evidence_items */
  packId?: string;
  /** When provided, header and step 4 use pack name, dispute type, created date, template name */
  pack?: TemplateSetupWizardPack | null;
  /** Format created_at for display; default uses toLocaleDateString */
  formatDate?: (iso: string | null) => string;
  /** Translated dispute type label (e.g. "Product Not Received") */
  disputeTypeLabel?: string;
  /** Callback after upload so parent can refetch pack */
  onUploadSuccess?: () => void;
}

function defaultFormatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function TemplateSetupWizard({
  packId,
  pack,
  formatDate = defaultFormatDate,
  disputeTypeLabel: disputeTypeLabelProp,
  onUploadSuccess,
}: TemplateSetupWizardProps) {
  const t = useTranslations("templateCustomize");
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const disputeTypeLabel = disputeTypeLabelProp ?? pack?.dispute_type?.replace(/_/g, " ") ?? t("productNotReceived");
  const disputeTypeKey = (pack?.dispute_type ?? "PRODUCT_NOT_RECEIVED").toUpperCase().replace(/\s+/g, "_");
  const createdLabel = pack?.created_at ? formatDate(pack.created_at) : t("today");
  const templateName = pack?.template_name ?? pack?.name ?? null;

  const [currentStep, setCurrentStep] = React.useState(1);
  const [evidenceTypes, setEvidenceTypes] = React.useState<EvidenceType[]>(() =>
    buildInitialEvidenceTypes(pack, disputeTypeKey)
  );
  React.useEffect(() => {
    if (pack != null) {
      setEvidenceTypes(buildInitialEvidenceTypes(pack, disputeTypeKey));
    }
  }, [pack?.id, pack?.checklist?.length, disputeTypeKey]);
  const [uploadedFiles, setUploadedFiles] = React.useState<UploadedFile[]>(() => {
    if (pack?.evidence_items?.length) {
      return pack.evidence_items.map((item, i) => ({
        id: item.id,
        name: item.label || item.type || `File ${i + 1}`,
        size: "—",
        status: "uploaded" as const,
      }));
    }
    return [];
  });
  const [isDragging, setIsDragging] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);

  const steps = [
    { number: 1, titleKey: "step1Title" as const, completed: currentStep > 1 },
    { number: 2, titleKey: "step2Title" as const, completed: currentStep > 2 },
    { number: 3, titleKey: "step3Title" as const, completed: currentStep > 3 },
    { number: 4, titleKey: "step4Title" as const, completed: currentStep > 4 },
  ];

  const stepDescs: Record<number, string> = {
    1: t("step1Desc"),
    2: t("step2Desc"),
    3: t("step3Desc"),
    4: t("step4Desc"),
  };

  const selectedCount = evidenceTypes.filter((e) => e.selected).length;
  const requiredCount = evidenceTypes.filter((e) => e.badge === "Required" && e.selected).length;
  const totalRequired = evidenceTypes.filter((e) => e.badge === "Required").length;
  const progressPercentage = Math.round((currentStep / steps.length) * 100);

  const handleToggleEvidence = (id: string) => {
    setEvidenceTypes((prev) =>
      prev.map((e) => (e.id === id ? { ...e, selected: !e.selected } : e))
    );
  };

  const handleFileUpload = async (files: FileList | null) => {
    if (!files) return;
    if (packId) {
      setUploading(true);
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.append("file", file);
        form.append("label", file.name);
        const res = await fetch(`/api/packs/${packId}/upload`, { method: "POST", body: form });
        if (res.ok) {
          setUploadedFiles((prev) => [
            ...prev,
            {
              id: `file-${Date.now()}-${file.name}`,
              name: file.name,
              size: `${(file.size / 1024).toFixed(1)} KB`,
              status: "uploaded",
            },
          ]);
          onUploadSuccess?.();
        }
      }
      setUploading(false);
    } else {
      const newFiles: UploadedFile[] = Array.from(files).map((file, index) => ({
        id: `file-${Date.now()}-${index}`,
        name: file.name,
        size: `${(file.size / 1024).toFixed(1)} KB`,
        status: "uploaded" as const,
      }));
      setUploadedFiles((prev) => [...prev, ...newFiles]);
    }
  };

  const handleRemoveFile = (id: string) => {
    setUploadedFiles((prev) => prev.filter((f) => f.id !== id));
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    handleFileUpload(e.dataTransfer.files);
  };

  const getBadgeClasses = (badge: string) => {
    switch (badge) {
      case "Required":
        return "bg-[#FEF3F2] text-[#B42318] border-[#FECDCA]";
      case "Recommended":
        return "bg-[#EFF6FF] text-[#1D4ED8] border-[#BFDBFE]";
      default:
        return "bg-[#F6F8FB] text-[#667085] border-[#E5E7EB]";
    }
  };

  const badgeLabel = (b: string) => {
    if (b === "Required") return t("badgeRequired");
    if (b === "Recommended") return t("badgeRecommended");
    return t("badgeOptional");
  };

  const goToPacks = () => router.push("/portal/packs");

  return (
    <div className="min-h-screen bg-[#F6F8FB]">
      <div className="bg-gradient-to-r from-[#1D4ED8] to-[#4F46E5] text-white py-2 px-6 text-center text-sm font-medium">
        {t("banner")}
      </div>

      <div className="max-w-7xl mx-auto p-6">
        <div className="mb-6">
          <Link
            href="/portal/packs"
            className="flex items-center gap-2 text-[#667085] hover:text-[#0B1220] transition-colors mb-4 w-fit"
          >
            <ArrowLeft className="w-4 h-4" />
            {t("backToPacks")}
          </Link>

          <div className="bg-white rounded-lg border border-[#E5E7EB] p-6">
            <h1 className="text-2xl font-bold text-[#0B1220] mb-2">{t("title")}</h1>
            <p className="text-[#667085] mb-4">{t("description")}</p>
            <div className="flex flex-wrap gap-4 text-sm">
              <div className="flex items-center gap-2">
                <span className="text-[#667085]">{t("disputeType")}</span>
                <span className="font-medium text-[#0B1220]">{disputeTypeLabel}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[#667085]">{t("status")}</span>
                <Badge variant="default">{t("draft")}</Badge>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[#667085]">{t("created")}</span>
                <span className="text-[#0B1220]">{createdLabel}</span>
              </div>
            </div>
            {(templateName || pack) && (
              <div className="mt-4 bg-[#EFF6FF] border border-[#BFDBFE] rounded-lg p-3 flex items-start gap-2">
                <HelpCircle className="w-4 h-4 text-[#1D4ED8] flex-shrink-0 mt-0.5" />
                <p className="text-sm text-[#1D4ED8]">{t("templateSourceNote")}</p>
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white rounded-lg border border-[#E5E7EB] p-6">
              <div className="space-y-4">
                {steps.map((step, index) => (
                  <div key={step.number} className="relative">
                    <div className="flex items-start gap-4">
                      <div className="flex flex-col items-center">
                        <div
                          className={cn(
                            "w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0",
                            step.completed && "bg-[#22C55E] text-white",
                            !step.completed && currentStep === step.number && "bg-[#1D4ED8] text-white",
                            !step.completed && currentStep !== step.number && "bg-[#F6F8FB] text-[#667085] border-2 border-[#E5E7EB]"
                          )}
                        >
                          {step.completed ? (
                            <Check className="w-4 h-4" />
                          ) : (
                            <span className="text-sm font-semibold">{step.number}</span>
                          )}
                        </div>
                        {index < steps.length - 1 && (
                          <div
                            className={cn(
                              "w-0.5 h-12 mt-2",
                              (step.completed || currentStep > step.number) ? "bg-[#22C55E]" : "bg-[#E5E7EB]"
                            )}
                          />
                        )}
                      </div>
                      <div className="flex-1 pb-4">
                        <h3
                          className={cn(
                            "font-semibold mb-1",
                            currentStep === step.number ? "text-[#0B1220]" : "text-[#667085]"
                          )}
                        >
                          {t(step.titleKey)}
                        </h3>
                        {currentStep === step.number && (
                          <p className="text-sm text-[#667085]">{stepDescs[step.number]}</p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {currentStep === 1 && (
              <div className="bg-white rounded-lg border border-[#E5E7EB] p-6">
                <div className="mb-4">
                  <h2 className="text-lg font-semibold text-[#0B1220] mb-2">{t("chooseEvidenceHeading")}</h2>
                  <p className="text-sm text-[#667085]">{t("chooseEvidenceDesc")}</p>
                </div>
                <div className="space-y-3">
                  {evidenceTypes.map((evidence) => (
                    <button
                      key={evidence.id}
                      type="button"
                      onClick={() => handleToggleEvidence(evidence.id)}
                      className={cn(
                        "w-full text-left p-4 rounded-lg border-2 transition-all",
                        evidence.selected
                          ? "border-[#1D4ED8] bg-[#EFF6FF]"
                          : "border-[#E5E7EB] bg-white hover:border-[#1D4ED8]/30"
                      )}
                    >
                      <div className="flex items-start gap-3">
                        <div
                          className={cn(
                            "w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 mt-0.5",
                            evidence.selected ? "bg-[#1D4ED8] border-[#1D4ED8]" : "border-[#E5E7EB] bg-white"
                          )}
                        >
                          {evidence.selected && <Check className="w-3 h-3 text-white" />}
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <h3 className="font-medium text-[#0B1220]">
                              {evidence.title ?? (evidence.titleKey ? t(evidence.titleKey) : evidence.id)}
                            </h3>
                            <span className={cn("text-xs px-2 py-0.5 rounded border", getBadgeClasses(evidence.badge))}>
                              {badgeLabel(evidence.badge)}
                            </span>
                          </div>
                          <p className="text-sm text-[#667085]">
                            {evidence.description ?? (evidence.descKey ? t(evidence.descKey) : "")}
                          </p>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
                <div className="mt-6 flex items-center justify-between">
                  <p className="text-sm text-[#667085]">
                    {t("evidenceSelected", {
                      selected: selectedCount,
                      required: requiredCount,
                      total: totalRequired,
                    })}
                  </p>
                  <Button
                    variant="primary"
                    onClick={() => setCurrentStep(2)}
                    disabled={requiredCount < totalRequired}
                  >
                    {t("saveAndContinueFiles")}
                    <ChevronRight className="w-4 h-4 ml-2" />
                  </Button>
                </div>
                {requiredCount < totalRequired && (
                  <div className="mt-4 bg-[#FEF3F2] border border-[#FECDCA] rounded-lg p-3 flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-[#B42318] flex-shrink-0 mt-0.5" />
                    <p className="text-sm text-[#B42318]">{t("requiredError")}</p>
                  </div>
                )}
              </div>
            )}

            {currentStep === 2 && (
              <div className="bg-white rounded-lg border border-[#E5E7EB] p-6">
                <div className="mb-4">
                  <h2 className="text-lg font-semibold text-[#0B1220] mb-2">{t("addExampleFilesHeading")}</h2>
                  <p className="text-sm text-[#667085]">{t("addExampleFilesDesc")}</p>
                </div>
                <div
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  className={cn(
                    "border-2 border-dashed rounded-lg p-8 text-center transition-colors",
                    isDragging ? "border-[#1D4ED8] bg-[#EFF6FF]" : "border-[#E5E7EB] bg-[#F6F8FB]"
                  )}
                >
                  <Upload className="w-12 h-12 text-[#667085] mx-auto mb-4" />
                  <h3 className="font-medium text-[#0B1220] mb-2">{t("uploadExampleFiles")}</h3>
                  <p className="text-sm text-[#667085] mb-4">{t("uploadExampleDesc")}</p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    className="hidden"
                    id="file-upload-wizard"
                    onChange={(e) => handleFileUpload(e.target.files)}
                    disabled={uploading}
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                  >
                    {uploading ? "Uploading…" : t("chooseFiles")}
                  </Button>
                  <p className="text-xs text-[#667085] mt-2">{t("fileRestrictions")}</p>
                </div>
                {uploadedFiles.length > 0 && (
                  <div className="mt-4 space-y-2">
                    <h3 className="text-sm font-medium text-[#0B1220]">
                      {t("uploadedFiles", { count: uploadedFiles.length })}
                    </h3>
                    {uploadedFiles.map((file) => (
                      <div
                        key={file.id}
                        className="flex items-center justify-between p-3 bg-[#F6F8FB] rounded-lg"
                      >
                        <div className="flex items-center gap-3">
                          <FileText className="w-4 h-4 text-[#667085]" />
                          <div>
                            <p className="text-sm font-medium text-[#0B1220]">{file.name}</p>
                            <p className="text-xs text-[#667085]">{file.size}</p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleRemoveFile(file.id)}
                          className="text-[#667085] hover:text-[#B42318] transition-colors"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="mt-6 flex items-center justify-between">
                  <Button variant="ghost" onClick={() => setCurrentStep(1)}>
                    {t("back")}
                  </Button>
                  <div className="flex gap-3">
                    <Button variant="ghost" onClick={() => setCurrentStep(3)}>
                      {t("skipForNow")}
                    </Button>
                    <Button variant="primary" onClick={() => setCurrentStep(3)}>
                      {t("continueToReview")}
                      <ChevronRight className="w-4 h-4 ml-2" />
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {currentStep === 3 && (
              <div className="bg-white rounded-lg border border-[#E5E7EB] p-6">
                <div className="mb-6">
                  <h2 className="text-lg font-semibold text-[#0B1220] mb-2">{t("reviewHowWorksHeading")}</h2>
                  <p className="text-sm text-[#667085]">{t("reviewHowWorksDesc")}</p>
                </div>
                <div className="bg-[#F6F8FB] rounded-lg p-6 mb-6">
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div className="text-center">
                      <div className="w-12 h-12 bg-[#1D4ED8] rounded-lg flex items-center justify-center mx-auto mb-2">
                        <AlertCircle className="w-6 h-6 text-white" />
                      </div>
                      <h3 className="text-sm font-semibold text-[#0B1220] mb-1">{t("disputeAppears")}</h3>
                      <p className="text-xs text-[#667085]">{t("matchesTemplate")}</p>
                    </div>
                    <div className="flex items-center justify-center">
                      <ChevronRight className="w-5 h-5 text-[#667085]" />
                    </div>
                    <div className="text-center">
                      <div className="w-12 h-12 bg-[#1D4ED8] rounded-lg flex items-center justify-center mx-auto mb-2">
                        <FileText className="w-6 h-6 text-white" />
                      </div>
                      <h3 className="text-sm font-semibold text-[#0B1220] mb-1">{t("packPrepared")}</h3>
                      <p className="text-xs text-[#667085]">{t("disputeDeskBuildsDraft")}</p>
                    </div>
                    <div className="flex items-center justify-center">
                      <ChevronRight className="w-5 h-5 text-[#667085]" />
                    </div>
                    <div className="text-center">
                      <div className="w-12 h-12 bg-[#22C55E] rounded-lg flex items-center justify-center mx-auto mb-2">
                        <CheckCircle2 className="w-6 h-6 text-white" />
                      </div>
                      <h3 className="text-sm font-semibold text-[#0B1220] mb-1">{t("readyToReview")}</h3>
                      <p className="text-xs text-[#667085]">{t("evidenceSaved")}</p>
                    </div>
                  </div>
                </div>
                <div className="bg-[#FFFBEB] border border-[#FEF0C7] rounded-lg p-4 flex items-start gap-3 mb-6">
                  <HelpCircle className="w-5 h-5 text-[#F59E0B] flex-shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-[#92400E] mb-1">{t("importantToKnow")}</p>
                    <p className="text-sm text-[#92400E]">{t("importantNote")}</p>
                  </div>
                </div>
                <div className="border border-[#E5E7EB] rounded-lg p-4">
                  <h3 className="text-sm font-semibold text-[#0B1220] mb-3">{t("whatHappensAfter")}</h3>
                  <ul className="space-y-2">
                    <li className="flex items-start gap-2 text-sm text-[#667085]">
                      <CheckCircle2 className="w-4 h-4 text-[#22C55E] flex-shrink-0 mt-0.5" />
                      {t("afterItem1")}
                    </li>
                    <li className="flex items-start gap-2 text-sm text-[#667085]">
                      <CheckCircle2 className="w-4 h-4 text-[#22C55E] flex-shrink-0 mt-0.5" />
                      {t("afterItem2WithType", { type: disputeTypeLabel })}
                    </li>
                    <li className="flex items-start gap-2 text-sm text-[#667085]">
                      <CheckCircle2 className="w-4 h-4 text-[#22C55E] flex-shrink-0 mt-0.5" />
                      {t("afterItem3")}
                    </li>
                  </ul>
                </div>
                <div className="mt-6 flex items-center justify-between">
                  <Button variant="ghost" onClick={() => setCurrentStep(2)}>
                    {t("back")}
                  </Button>
                  <Button variant="primary" onClick={() => setCurrentStep(4)}>
                    {t("reviewAndActivate")}
                    <ChevronRight className="w-4 h-4 ml-2" />
                  </Button>
                </div>
              </div>
            )}

            {currentStep === 4 && (
              <div className="bg-white rounded-lg border border-[#E5E7EB] p-6">
                <div className="mb-6">
                  <h2 className="text-lg font-semibold text-[#0B1220] mb-2">{t("activateHeading")}</h2>
                  <p className="text-sm text-[#667085]">{t("activateDesc")}</p>
                </div>
                <div className="bg-[#DCFCE7] border border-[#BBF7D0] rounded-lg p-6 mb-6">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-12 h-12 bg-[#22C55E] rounded-lg flex items-center justify-center">
                      <CheckCircle2 className="w-6 h-6 text-white" />
                    </div>
                    <div>
                      <h3 className="text-lg font-semibold text-[#0B1220]">{t("templateReady")}</h3>
                      <p className="text-sm text-[#667085]">{t("allRequiredCompleted")}</p>
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4 mb-6">
                  <div className="border border-[#E5E7EB] rounded-lg p-4">
                    <p className="text-sm text-[#667085] mb-1">{t("evidenceTypes")}</p>
                    <p className="text-2xl font-bold text-[#0B1220]">{selectedCount}</p>
                    <p className="text-xs text-[#667085] mt-1">
                      {t("requiredOptional", {
                        required: requiredCount,
                        optional: selectedCount - requiredCount,
                      })}
                    </p>
                  </div>
                  <div className="border border-[#E5E7EB] rounded-lg p-4">
                    <p className="text-sm text-[#667085] mb-1">{t("exampleFiles")}</p>
                    <p className="text-2xl font-bold text-[#0B1220]">{uploadedFiles.length}</p>
                    <p className="text-xs text-[#667085] mt-1">
                      {uploadedFiles.length > 0 ? t("readyForUse") : t("noneAdded")}
                    </p>
                  </div>
                  <div className="border border-[#E5E7EB] rounded-lg p-4">
                    <p className="text-sm text-[#667085] mb-1">{t("disputeType")}</p>
                    <p className="font-semibold text-[#0B1220]">{disputeTypeLabel}</p>
                  </div>
                  <div className="border border-[#E5E7EB] rounded-lg p-4">
                    <p className="text-sm text-[#667085] mb-1">{t("source")}</p>
                    <p className="font-semibold text-[#0B1220]">{templateName ?? t("recommendedTemplate")}</p>
                  </div>
                </div>
                <div className="mt-6 flex items-center justify-between">
                  <Button variant="ghost" onClick={() => setCurrentStep(3)}>
                    {t("back")}
                  </Button>
                  <div className="flex gap-3">
                    <Button variant="secondary" onClick={goToPacks}>
                      {t("saveAsDraft")}
                    </Button>
                    <Button variant="primary" onClick={goToPacks}>
                      {t("activateTemplate")}
                      <Check className="w-4 h-4 ml-2" />
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="lg:col-span-1">
            <div className="bg-white rounded-lg border border-[#E5E7EB] p-6 sticky top-6">
              <div className="mb-6">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold text-[#0B1220]">{t("setupProgress")}</h3>
                  <span className="text-sm font-semibold text-[#1D4ED8]">{progressPercentage}%</span>
                </div>
                <div className="w-full bg-[#E5E7EB] rounded-full h-2 mb-4">
                  <div
                    className="bg-[#1D4ED8] h-2 rounded-full transition-all duration-300"
                    style={{ width: `${progressPercentage}%` }}
                  />
                </div>
                <div className="space-y-2">
                  {steps.map((step) => (
                    <div key={step.number} className="flex items-center gap-2 text-sm">
                      {step.completed ? (
                        <CheckCircle2 className="w-4 h-4 text-[#22C55E] flex-shrink-0" />
                      ) : currentStep === step.number ? (
                        <Circle className="w-4 h-4 text-[#1D4ED8] flex-shrink-0 fill-[#1D4ED8]" />
                      ) : (
                        <Circle className="w-4 h-4 text-[#E5E7EB] flex-shrink-0" />
                      )}
                      <span
                        className={cn(
                          step.completed && "text-[#22C55E] line-through",
                          !step.completed && currentStep === step.number && "text-[#0B1220] font-medium",
                          !step.completed && currentStep !== step.number && "text-[#667085]"
                        )}
                      >
                        {t(step.titleKey)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="mb-6 pb-6 border-b border-[#E5E7EB]">
                <p className="text-xs text-[#667085] mb-1">{t("templateStatus")}</p>
                <Badge variant={currentStep === 4 && requiredCount === totalRequired ? "success" : "default"} className="text-sm">
                  {currentStep === 4 && requiredCount === totalRequired ? t("ready") : t("inProgress")}
                </Badge>
              </div>
              <div className="space-y-2">
                <Link
                  href="/portal/packs"
                  className="flex items-center gap-2 text-sm text-[#667085] hover:text-[#1D4ED8] transition-colors py-2 w-full"
                >
                  <ArrowLeft className="w-4 h-4" />
                  {t("backToTemplates")}
                </Link>
                <button
                  type="button"
                  className="flex items-center gap-2 text-sm text-[#667085] hover:text-[#1D4ED8] transition-colors py-2 w-full"
                >
                  <Download className="w-4 h-4" />
                  {t("exportPdfCopy")}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
