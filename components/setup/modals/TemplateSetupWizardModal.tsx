"use client";

import { useState, useCallback } from "react";
import {
  Modal,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  Banner,
  ProgressBar,
  Checkbox,
} from "@shopify/polaris";
import { useTranslations } from "next-intl";
import {
  EVIDENCE_TYPES,
  EVIDENCE_SOURCES,
  type EvidenceType,
  type EvidenceSource,
} from "@/lib/setup/evidenceTypes";

type WizardStep = "evidence" | "sources" | "review" | "activate";

const STEP_ORDER: WizardStep[] = [
  "evidence",
  "sources",
  "review",
  "activate",
];

interface TemplateSetupWizardModalProps {
  open: boolean;
  onClose: () => void;
  onComplete: () => void;
  templateName: string;
  templateType: string;
}

export function TemplateSetupWizardModal({
  open,
  onClose,
  onComplete,
  templateName,
  templateType,
}: TemplateSetupWizardModalProps) {
  const t = useTranslations("setup.templateWizard");

  const [currentStep, setCurrentStep] = useState<WizardStep>("evidence");
  const [selectedEvidence, setSelectedEvidence] = useState<Set<string>>(
    () =>
      new Set(
        EVIDENCE_TYPES.filter((e) => e.recommended).map((e) => e.id)
      )
  );
  const [activating, setActivating] = useState(false);

  const stepIndex = STEP_ORDER.indexOf(currentStep);
  const progress = ((stepIndex + 1) / STEP_ORDER.length) * 100;

  const stepTitles: Record<WizardStep, string> = {
    evidence: t("stepEvidence"),
    sources: t("stepSources"),
    review: t("stepReview"),
    activate: t("stepActivate"),
  };

  const toggleEvidence = useCallback((id: string) => {
    setSelectedEvidence((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleContinue = useCallback(() => {
    if (stepIndex < STEP_ORDER.length - 1) {
      setCurrentStep(STEP_ORDER[stepIndex + 1]);
    }
  }, [stepIndex]);

  const handleBack = useCallback(() => {
    if (stepIndex > 0) {
      setCurrentStep(STEP_ORDER[stepIndex - 1]);
    }
  }, [stepIndex]);

  const handleActivate = useCallback(async () => {
    setActivating(true);
    try {
      onComplete();
    } finally {
      setActivating(false);
    }
  }, [onComplete]);

  const handleClose = useCallback(() => {
    setCurrentStep("evidence");
    setSelectedEvidence(
      new Set(EVIDENCE_TYPES.filter((e) => e.recommended).map((e) => e.id))
    );
    onClose();
  }, [onClose]);

  const isLastStep = currentStep === "activate";

  const primaryAction = isLastStep
    ? {
        content: t("activateBtn"),
        onAction: handleActivate,
        loading: activating,
      }
    : {
        content: t("continueBtn"),
        onAction: handleContinue,
        disabled: currentStep === "evidence" && selectedEvidence.size === 0,
      };

  const secondaryActions =
    stepIndex > 0
      ? [
          { content: t("backBtn"), onAction: handleBack },
          { content: t("cancelBtn"), onAction: handleClose },
        ]
      : [{ content: t("cancelBtn"), onAction: handleClose }];

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={`${templateName} — ${stepTitles[currentStep]}`}
      primaryAction={primaryAction}
      secondaryActions={secondaryActions}
    >
      <Modal.Section>
        <BlockStack gap="400">
          {/* Step indicator */}
          <InlineStack align="space-between" blockAlign="center">
            <Text as="p" variant="bodySm" tone="subdued">
              {t("stepOf", {
                current: stepIndex + 1,
                total: STEP_ORDER.length,
              })}
            </Text>
            <div style={{ width: 200 }}>
              <ProgressBar progress={progress} size="small" />
            </div>
          </InlineStack>

          {/* Step content */}
          {currentStep === "evidence" && (
            <EvidenceStep
              selectedEvidence={selectedEvidence}
              onToggle={toggleEvidence}
            />
          )}
          {currentStep === "sources" && (
            <SourcesStep selectedEvidence={selectedEvidence} />
          )}
          {currentStep === "review" && (
            <ReviewStep
              selectedEvidence={selectedEvidence}
              templateType={templateType}
            />
          )}
          {currentStep === "activate" && (
            <ActivateStep
              selectedEvidence={selectedEvidence}
              templateType={templateType}
            />
          )}
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/*  Step 1: Choose Evidence                                           */
/* ------------------------------------------------------------------ */

function EvidenceStep({
  selectedEvidence,
  onToggle,
}: {
  selectedEvidence: Set<string>;
  onToggle: (id: string) => void;
}) {
  const t = useTranslations("setup.templateWizard");

  const autoTypes = EVIDENCE_TYPES.filter((e) => e.autoCollected);
  const manualTypes = EVIDENCE_TYPES.filter((e) => !e.autoCollected);

  return (
    <BlockStack gap="500">
      <Text as="p" variant="bodyMd" tone="subdued">
        {t("evidenceDesc")}
      </Text>

      {/* Auto-collected */}
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h3" variant="headingSm">
            {t("autoCollectedTitle")}
          </Text>
          <Text as="span" variant="bodySm" tone="subdued">
            {autoTypes.filter((e) => selectedEvidence.has(e.id)).length}{" "}
            {t("selected")}
          </Text>
        </InlineStack>
        <Text as="p" variant="bodySm" tone="subdued">
          {t("autoCollectedDesc")}
        </Text>
        {autoTypes.map((ev) => (
          <EvidenceCard
            key={ev.id}
            evidence={ev}
            checked={selectedEvidence.has(ev.id)}
            onToggle={onToggle}
          />
        ))}
      </BlockStack>

      {/* Manual */}
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h3" variant="headingSm">
            {t("manualTitle")}
          </Text>
          <Text as="span" variant="bodySm" tone="subdued">
            {manualTypes.filter((e) => selectedEvidence.has(e.id)).length}{" "}
            {t("selected")}
          </Text>
        </InlineStack>
        <Text as="p" variant="bodySm" tone="subdued">
          {t("manualDesc")}
        </Text>
        {manualTypes.map((ev) => (
          <EvidenceCard
            key={ev.id}
            evidence={ev}
            checked={selectedEvidence.has(ev.id)}
            onToggle={onToggle}
          />
        ))}
      </BlockStack>
    </BlockStack>
  );
}

function EvidenceCard({
  evidence,
  checked,
  onToggle,
}: {
  evidence: EvidenceType;
  checked: boolean;
  onToggle: (id: string) => void;
}) {
  const t = useTranslations("setup.templateWizard");

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onToggle(evidence.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggle(evidence.id);
        }
      }}
      style={{
        padding: "12px 16px",
        border: `2px solid ${checked ? "#1D4ED8" : "#E1E3E5"}`,
        borderRadius: 8,
        background: checked ? "#EFF6FF" : "#FFFFFF",
        cursor: "pointer",
        transition: "border-color 150ms, background 150ms",
      }}
    >
      <InlineStack gap="300" blockAlign="start" wrap={false}>
        <div style={{ paddingTop: 2 }}>
          <Checkbox
            label=""
            labelHidden
            checked={checked}
            onChange={() => onToggle(evidence.id)}
          />
        </div>
        <BlockStack gap="100">
          <InlineStack gap="200" blockAlign="center">
            <Text as="span" variant="bodyMd" fontWeight="semibold">
              {t(`evidenceTypes.${evidence.id}.title` as never)}
            </Text>
            {evidence.recommended && (
              <Badge tone="warning">{t("recommended")}</Badge>
            )}
          </InlineStack>
          <Text as="p" variant="bodySm" tone="subdued">
            {t(`evidenceTypes.${evidence.id}.description` as never)}
          </Text>
        </BlockStack>
      </InlineStack>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Step 2: Set Sources                                               */
/* ------------------------------------------------------------------ */

function SourcesStep({
  selectedEvidence,
}: {
  selectedEvidence: Set<string>;
}) {
  const t = useTranslations("setup.templateWizard");

  return (
    <BlockStack gap="500">
      <BlockStack gap="200">
        <Text as="p" variant="bodyMd" tone="subdued">
          {t("sourcesDesc")}
        </Text>
        <Text as="p" variant="bodySm" tone="subdued">
          {t("sourcesNote")}
        </Text>
      </BlockStack>

      {Array.from(selectedEvidence).map((evidenceId) => {
        const ev = EVIDENCE_TYPES.find((e) => e.id === evidenceId);
        const sources: EvidenceSource[] =
          EVIDENCE_SOURCES[evidenceId] ?? [];
        if (!ev) return null;

        return (
          <BlockStack key={evidenceId} gap="200">
            <Text as="h3" variant="headingSm">
              {t(`evidenceTypes.${evidenceId}.title` as never)}
            </Text>
            {sources.map((src, idx) => (
              <div
                key={idx}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "10px 14px",
                  background: "#F7F8FA",
                  borderRadius: 8,
                }}
              >
                <BlockStack gap="050">
                  <Text as="span" variant="bodyMd" fontWeight="medium">
                    {t(`sourceLabels.${src.sourceKey}` as never)}
                  </Text>
                  <Text as="span" variant="bodySm" tone="subdued">
                    {src.type === "auto"
                      ? t("sourceAutomatic")
                      : t("sourceManual")}
                  </Text>
                </BlockStack>
                <SourceStatusBadge status={src.status} />
              </div>
            ))}
          </BlockStack>
        );
      })}
    </BlockStack>
  );
}

function SourceStatusBadge({
  status,
}: {
  status: EvidenceSource["status"];
}) {
  const t = useTranslations("setup.templateWizard");

  switch (status) {
    case "connected":
      return <Badge tone="success">{t("statusConnected")}</Badge>;
    case "requires-setup":
      return <Badge tone="warning">{t("statusSetupRequired")}</Badge>;
    case "not-configured":
      return <Badge tone="attention">{t("statusNotConfigured")}</Badge>;
    default:
      return <Badge>{t("statusAvailable")}</Badge>;
  }
}

/* ------------------------------------------------------------------ */
/*  Step 3: Review Automation                                         */
/* ------------------------------------------------------------------ */

function ReviewStep({
  selectedEvidence,
  templateType,
}: {
  selectedEvidence: Set<string>;
  templateType: string;
}) {
  const t = useTranslations("setup.templateWizard");

  const reviewSteps = [
    {
      num: 1,
      title: t("reviewDetectionTitle"),
      desc: t("reviewDetectionDesc", { templateType }),
    },
    {
      num: 2,
      title: t("reviewCollectionTitle"),
      desc: t("reviewCollectionDesc"),
    },
    {
      num: 3,
      title: t("reviewPackTitle"),
      desc: t("reviewPackDesc"),
    },
    {
      num: 4,
      title: t("reviewNotifyTitle"),
      desc: t("reviewNotifyDesc"),
    },
  ];

  return (
    <BlockStack gap="500">
      <Text as="p" variant="bodyMd" tone="subdued">
        {t("reviewIntro")}
      </Text>

      {reviewSteps.map((step) => (
        <div
          key={step.num}
          style={{
            display: "flex",
            gap: 14,
            padding: 16,
            background: step.num === 4 ? "#DCFCE7" : "#EFF6FF",
            borderRadius: 8,
            border: `1px solid ${step.num === 4 ? "#86EFAC" : "#BFDBFE"}`,
          }}
        >
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: "50%",
              background: step.num === 4 ? "#22C55E" : "#1D4ED8",
              color: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: 700,
              fontSize: 14,
              flexShrink: 0,
            }}
          >
            {step.num}
          </div>
          <BlockStack gap="100">
            <Text as="h3" variant="headingSm">
              {step.title}
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              {step.desc}
            </Text>
            {step.num === 2 && (
              <BlockStack gap="050">
                {Array.from(selectedEvidence)
                  .slice(0, 4)
                  .map((id) => {
                    const ev = EVIDENCE_TYPES.find((e) => e.id === id);
                    return ev ? (
                      <Text key={id} as="span" variant="bodySm">
                        ✓ {t(`evidenceTypes.${id}.title` as never)}
                      </Text>
                    ) : null;
                  })}
                {selectedEvidence.size > 4 && (
                  <Text as="span" variant="bodySm" tone="subdued">
                    ...{t("andMore", { count: selectedEvidence.size - 4 })}
                  </Text>
                )}
              </BlockStack>
            )}
          </BlockStack>
        </div>
      ))}
    </BlockStack>
  );
}

/* ------------------------------------------------------------------ */
/*  Step 4: Activate                                                  */
/* ------------------------------------------------------------------ */

function ActivateStep({
  selectedEvidence,
  templateType,
}: {
  selectedEvidence: Set<string>;
  templateType: string;
}) {
  const t = useTranslations("setup.templateWizard");

  const autoCount = Array.from(selectedEvidence).filter((id) =>
    EVIDENCE_TYPES.find((e) => e.id === id)?.autoCollected
  ).length;
  const manualCount = selectedEvidence.size - autoCount;

  return (
    <BlockStack gap="500">
      <Text as="p" variant="bodyMd" tone="subdued">
        {t("activateDesc")}
      </Text>

      {/* Summary */}
      <div
        style={{
          border: "1px solid #E1E3E5",
          borderRadius: 8,
          padding: 16,
        }}
      >
        <Text as="h3" variant="headingSm">
          {t("summaryTitle")}
        </Text>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 12,
            marginTop: 12,
          }}
        >
          <BlockStack gap="050">
            <Text as="span" variant="bodySm" tone="subdued">
              {t("summaryType")}
            </Text>
            <Text as="span" variant="bodyMd" fontWeight="semibold">
              {templateType}
            </Text>
          </BlockStack>
          <BlockStack gap="050">
            <Text as="span" variant="bodySm" tone="subdued">
              {t("summaryEvidenceCount")}
            </Text>
            <Text as="span" variant="bodyMd" fontWeight="semibold">
              {selectedEvidence.size} {t("selected")}
            </Text>
          </BlockStack>
          <BlockStack gap="050">
            <Text as="span" variant="bodySm" tone="subdued">
              {t("summaryAutoCollected")}
            </Text>
            <Text as="span" variant="bodyMd" fontWeight="semibold">
              {autoCount} {t("types")}
            </Text>
          </BlockStack>
          <BlockStack gap="050">
            <Text as="span" variant="bodySm" tone="subdued">
              {t("summaryManual")}
            </Text>
            <Text as="span" variant="bodyMd" fontWeight="semibold">
              {manualCount} {t("types")}
            </Text>
          </BlockStack>
        </div>
      </div>

      {/* Ready banner */}
      <Banner tone="success">
        <BlockStack gap="200">
          <Text as="p" variant="bodyMd" fontWeight="semibold">
            {t("readyTitle")}
          </Text>
          <Text as="p" variant="bodySm">
            {t("readyDesc", { templateType: templateType.toLowerCase() })}
          </Text>
        </BlockStack>
      </Banner>
    </BlockStack>
  );
}
