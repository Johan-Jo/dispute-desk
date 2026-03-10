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
}

export function TemplateLibraryModal({
  isOpen,
  onClose,
  shopId,
  locale,
  onInstalled,
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
      />
    </Modal>
  );
}
