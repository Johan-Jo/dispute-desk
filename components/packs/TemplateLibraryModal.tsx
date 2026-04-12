"use client";

import { useTranslations } from "next-intl";
import { Modal } from "@/components/ui/modal";
import { TemplateLibraryContent } from "@/components/packs/TemplateLibraryContent";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  shopId: string;
  locale: string;
  onInstalled: (packId: string) => void;
  /** Pre-select a dispute-type filter (e.g. "FRAUD") when opening */
  initialCategory?: string;
}

export function TemplateLibraryModal({
  isOpen,
  onClose,
  shopId,
  locale,
  onInstalled,
  initialCategory,
}: Props) {
  const t = useTranslations("templateLibrary");

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t("title")}
      description={t("subtitle")}
      size="xl"
    >
      <TemplateLibraryContent
        shopId={shopId}
        locale={locale}
        onInstalled={onInstalled}
        onGoToPacks={onClose}
        isActive={isOpen}
        layoutMode="modal"
        initialCategory={initialCategory}
      />
    </Modal>
  );
}
