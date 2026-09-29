"use client";

/**
 * Overview hero — the "Evidence" + "Decide what to do" toggle panel.
 *
 * Transcribes variant 2a ("Toggles") of `Dispute Page.dc.html` (Claude
 * Design project 903e8b95…). Two rows inside one white card, each a title +
 * hint on the left and a segmented control on the right, split by a 1px
 * rule:
 *
 *   Evidence                 [ Add missing evidence | Save anyway ]
 *   Decide what to do …      [ Submit on deadline | Hold for review | Don't respond ]
 *
 * Either row renders on its own when only one applies; the divider only
 * sits between two rows.
 *
 * The decision row is the persisted `review_state` (approve / hold /
 * concede via `/api/disputes/[id]/review`) — the highlighted segment is what
 * the server holds, never a local guess. The evidence row is a local choice:
 * "Add missing evidence" opens the upload modal, "Save anyway" keeps the
 * package as it is.
 */

import { useEffect, useRef, useState } from "react";
import { Modal } from "@shopify/polaris";
import { useTranslations } from "next-intl";
/** The generic manual-upload checklist row (`MANUAL_UPLOAD_FIELD` in
 *  lib/automation/completeness). Repeated here as a literal: client
 *  surfaces may not import a scoring module (CP-A invariant). */
export const MANUAL_UPLOAD_FIELD = "supporting_documents";

export type DecisionKey = "submit" | "hold" | "none";

const TEXT = "#0B1220";
const TEXT_SUBTLE = "#667085";
const TEXT_MUTED = "#64748B";
const PRIMARY = "#1D4ED8";
const HEADING = "#1E2A4A";
const DANGER = "#B91C1C";

const ACCEPT = ".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg";
const MAX_BYTES = 10 * 1024 * 1024;

interface SegmentOption<K extends string> {
  key: K;
  label: string;
  danger?: boolean;
}

function Segmented<K extends string>({
  options,
  selected,
  disabled,
  onPick,
}: {
  options: SegmentOption<K>[];
  selected: K | null;
  disabled?: boolean;
  onPick: (key: K) => void;
}) {
  return (
    <div
      role="radiogroup"
      style={{ display: "flex", background: "#EEF2FA", borderRadius: 8, padding: 3, gap: 2 }}
    >
      {options.map((o) => {
        const on = o.key === selected;
        return (
          <button
            key={o.key}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled}
            onClick={() => onPick(o.key)}
            style={{
              appearance: "none",
              border: 0,
              fontFamily: "inherit",
              whiteSpace: "nowrap",
              fontSize: 13,
              padding: "7px 12px",
              borderRadius: 6,
              cursor: disabled ? "default" : "pointer",
              background: on ? "#fff" : "transparent",
              color: on ? (o.danger ? DANGER : PRIMARY) : TEXT_SUBTLE,
              boxShadow: on ? "0 1px 2px rgba(11,18,32,.14)" : "none",
              fontWeight: on ? 600 : 500,
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function Row({
  title,
  body,
  hint,
  control,
}: {
  title: string;
  body?: string;
  hint: string;
  control: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0,1fr) auto",
        gap: 16,
        alignItems: "center",
        padding: 16,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: HEADING }}>{title}</div>
        {body ? (
          <>
            <div style={{ fontSize: 13, lineHeight: 1.55, color: TEXT_SUBTLE, textWrap: "pretty" } as React.CSSProperties}>
              {body}
            </div>
            <div style={{ fontSize: 12, color: TEXT_MUTED, marginTop: 4 }}>{hint}</div>
          </>
        ) : (
          <div style={{ fontSize: 13, color: TEXT_SUBTLE }}>{hint}</div>
        )}
      </div>
      {control}
    </div>
  );
}

export interface OverviewDecisionPanelProps {
  /** Render the Evidence row (the case is parked/held with limited evidence). */
  showEvidence: boolean;
  /** Evidence-row segment labels ("Add missing evidence" / "Save anyway"). */
  evidenceLabels: { add: string; save: string };
  /** Render the Decide row (approval gate, or a pending recorded decision). */
  showDecision: boolean;
  /** The persisted decision, mapped from `review_state`. */
  decision: DecisionKey | null;
  onDecide: (key: DecisionKey) => void;
  deciding: boolean;
  /** Short deadline ("Oct 11") or null. */
  deadlineShort: string | null;
  /** Product Not Received family — delivery-specific copy + checklist. */
  deliveryFamily: boolean;
  customerName: string | null;
  reasonLabel: string;
  /** Labels of the merchant-addable missing items (non-delivery families). */
  missingLabels: string[];
  /** When set, "Add missing evidence" is relabelled and routes to the
   *  cardholder-acknowledgement card instead of the upload modal. */
  acknowledgement: { label: string; ask: string; open: () => void } | null;
  upload: (field: string, files: File[]) => Promise<void>;
  uploading: boolean;
  uploadError: string | null;
}

export function OverviewDecisionPanel(props: OverviewDecisionPanelProps) {
  const t = useTranslations("disputes.overviewDecision");
  const tReview = useTranslations("disputes.overviewExtra.review");
  const [ev, setEv] = useState<"add" | "save">("add");
  const [uploadOpen, setUploadOpen] = useState(false);

  if (!props.showEvidence && !props.showDecision) return null;

  const evOptions: SegmentOption<"add" | "save">[] = [
    { key: "add", label: props.acknowledgement?.label ?? props.evidenceLabels.add },
    { key: "save", label: props.evidenceLabels.save },
  ];
  const evHint =
    ev === "save"
      ? t("evidence.saveHint")
      : props.acknowledgement
        ? props.acknowledgement.ask
        : props.deliveryFamily
          ? t("evidence.addHintDelivery")
          : t("evidence.addHint");

  const decOptions: SegmentOption<DecisionKey>[] = [
    { key: "submit", label: t("decision.submit") },
    { key: "hold", label: t("decision.hold") },
    { key: "none", label: t("decision.none"), danger: true },
  ];
  const decHint =
    props.decision === "submit"
      ? props.deadlineShort
        ? t("decision.submitHint", { date: props.deadlineShort })
        : t("decision.submitHintNoDate")
      : props.decision === "hold"
        ? t("decision.holdHint")
        : props.decision === "none"
          ? t("decision.noneHint")
          : "";

  const pickEvidence = (key: "add" | "save") => {
    setEv(key);
    if (key !== "add") return;
    if (props.acknowledgement) props.acknowledgement.open();
    else setUploadOpen(true);
  };

  return (
    <>
      <div
        style={{
          background: "#fff",
          border: "1px solid #DBE3F4",
          borderRadius: 10,
          display: "flex",
          flexDirection: "column",
        }}
      >
        {props.showEvidence && (
          <Row
            title={t("evidence.title")}
            hint={evHint}
            control={<Segmented options={evOptions} selected={ev} onPick={pickEvidence} />}
          />
        )}
        {props.showEvidence && props.showDecision && (
          <div style={{ height: 1, background: "#E6ECF7" }} />
        )}
        {props.showDecision && (
          <Row
            title={tReview("title")}
            body={tReview("prompt")}
            hint={decHint}
            control={
              <Segmented
                options={decOptions}
                selected={props.decision}
                disabled={props.deciding}
                onPick={(k) => {
                  if (k !== props.decision) props.onDecide(k);
                }}
              />
            }
          />
        )}
      </div>

      <UploadModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        deliveryFamily={props.deliveryFamily}
        customerName={props.customerName}
        deadlineShort={props.deadlineShort}
        reasonLabel={props.reasonLabel}
        missingLabels={props.missingLabels}
        upload={props.upload}
        uploading={props.uploading}
        uploadError={props.uploadError}
      />
    </>
  );
}

function UploadModal({
  open,
  onClose,
  deliveryFamily,
  customerName,
  deadlineShort,
  reasonLabel,
  missingLabels,
  upload,
  uploading,
  uploadError,
}: {
  open: boolean;
  onClose: () => void;
  deliveryFamily: boolean;
  customerName: string | null;
  deadlineShort: string | null;
  reasonLabel: string;
  missingLabels: string[];
  upload: (field: string, files: File[]) => Promise<void>;
  uploading: boolean;
  uploadError: string | null;
}) {
  const t = useTranslations("disputes.overviewDecision.upload");
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [tooLarge, setTooLarge] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const customer = customerName?.trim() || t("customerFallback");
  const description = deliveryFamily
    ? deadlineShort
      ? t("descriptionDelivery", { customer, date: deadlineShort })
      : t("descriptionDeliveryNoDate", { customer })
    : deadlineShort
      ? t("description", { date: deadlineShort })
      : t("descriptionNoDate");

  const helps = deliveryFamily
    ? [t("helps.trackingDelivered"), t("helps.signature"), t("helps.deliveryRecord"), t("helps.customerAck")]
    : missingLabels;

  const accept = (list: FileList | null) => {
    if (!list) return;
    const picked = Array.from(list);
    setTooLarge(picked.some((f) => f.size > MAX_BYTES));
    setFiles(picked.filter((f) => f.size <= MAX_BYTES));
  };

  const close = () => {
    setFiles([]);
    setTooLarge(false);
    setSubmitted(false);
    setSawUploading(false);
    onClose();
  };

  const add = async () => {
    if (files.length === 0) return;
    setSubmitted(true);
    // The generic manual-upload row: the file joins the package that is
    // filed with the response. Delivery rows are carrier-derived and not
    // merchant-writable (canMerchantUpload), so the upload is never used
    // to mark delivery as carrier-confirmed.
    await upload(MANUAL_UPLOAD_FIELD, files);
  };

  // Close once the batch finished without an error. `sawUploading` guards
  // the render between the click and the hook flipping `uploading` on.
  const [sawUploading, setSawUploading] = useState(false);
  useEffect(() => {
    if (submitted && uploading) setSawUploading(true);
  }, [submitted, uploading]);
  useEffect(() => {
    if (open && submitted && sawUploading && !uploading && !uploadError) {
      setSawUploading(false);
      close();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, submitted, sawUploading, uploading, uploadError]);

  return (
    <Modal open={open} onClose={close} title={t("title")}>
      <Modal.Section>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <p style={{ margin: 0, fontSize: 14, color: TEXT_SUBTLE, lineHeight: 1.5 }}>{description}</p>
          <div
            role="button"
            tabIndex={0}
            onClick={() => inputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              accept(e.dataTransfer.files);
            }}
            style={{
              border: "1.5px dashed #C7D2FE",
              background: "#F7F9FD",
              borderRadius: 10,
              padding: "28px 20px",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 8,
              textAlign: "center",
              cursor: "pointer",
            }}
          >
            <div
              style={{
                width: 40, height: 40, borderRadius: 8, background: "#E3E8F8", color: "#3B4A7A",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 16V4" />
                <path d="M7 9l5-5 5 5" />
                <path d="M4 16v3a1 1 0 001 1h14a1 1 0 001-1v-3" />
              </svg>
            </div>
            <div style={{ fontSize: 14, fontWeight: 600, color: HEADING }}>
              {t("drop")} <span style={{ color: PRIMARY }}>{t("browse")}</span>
            </div>
            <div style={{ fontSize: 12, color: TEXT_MUTED }}>{t("formats")}</div>
            {files.length > 0 && (
              <div style={{ fontSize: 13, color: TEXT, fontWeight: 500 }}>
                {files.map((f) => f.name).join(", ")}
              </div>
            )}
            <input
              ref={inputRef}
              type="file"
              multiple
              accept={ACCEPT}
              style={{ display: "none" }}
              onChange={(e) => accept(e.target.files)}
            />
          </div>
          {(tooLarge || (submitted && uploadError)) && (
            <p style={{ margin: 0, fontSize: 13, color: DANGER }}>
              {tooLarge ? t("tooLarge") : uploadError}
            </p>
          )}
          {helps.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: HEADING }}>
                {t("helpsTitle", { reason: reasonLabel })}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13, color: TEXT_SUBTLE }}>
                {helps.map((h) => (
                  <div key={h}>• {h}</div>
                ))}
              </div>
            </div>
          )}
          <div
            style={{
              display: "flex", justifyContent: "flex-end", gap: 8,
              borderTop: "1px solid #E5E7EB", paddingTop: 16,
            }}
          >
            <button type="button" onClick={close} style={modalButton(false)}>
              {t("cancel")}
            </button>
            <button
              type="button"
              onClick={() => void add()}
              disabled={files.length === 0 || uploading}
              style={modalButton(true, files.length === 0 || uploading)}
            >
              {t("add")}
            </button>
          </div>
        </div>
      </Modal.Section>
    </Modal>
  );
}

function modalButton(primary: boolean, disabled = false): React.CSSProperties {
  return {
    appearance: "none",
    fontFamily: "inherit",
    fontSize: 14,
    fontWeight: 600,
    height: 40,
    padding: "0 16px",
    borderRadius: 8,
    cursor: disabled ? "default" : "pointer",
    border: primary ? `1px solid ${PRIMARY}` : "1px solid #D0D5DD",
    background: primary ? PRIMARY : "#fff",
    color: primary ? "#fff" : TEXT,
    opacity: disabled ? 0.55 : 1,
  };
}
