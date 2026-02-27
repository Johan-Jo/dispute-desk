"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Modal,
  DropZone,
  BlockStack,
  Text,
  InlineStack,
  Button,
  Banner,
  Thumbnail,
  Icon,
} from "@shopify/polaris";
import { DeleteIcon } from "@shopify/polaris-icons";
import type { EvidenceFileRow } from "@/lib/setup/types";

interface UploadSampleFilesModalProps {
  open: boolean;
  onClose: () => void;
  onFilesChanged: () => void;
}

export function UploadSampleFilesModal({
  open,
  onClose,
  onFilesChanged,
}: UploadSampleFilesModalProps) {
  const [files, setFiles] = useState<EvidenceFileRow[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingFiles, setLoadingFiles] = useState(true);

  const fetchFiles = useCallback(async () => {
    setLoadingFiles(true);
    try {
      const res = await fetch("/api/files/samples");
      if (res.ok) {
        const data = await res.json();
        setFiles(data.files ?? []);
      }
    } finally {
      setLoadingFiles(false);
    }
  }, []);

  useEffect(() => {
    if (open) fetchFiles();
  }, [open, fetchFiles]);

  const handleDrop = useCallback(
    async (_droppedFiles: File[], acceptedFiles: File[]) => {
      if (acceptedFiles.length === 0) return;
      setUploading(true);
      setError(null);

      for (const file of acceptedFiles) {
        const formData = new FormData();
        formData.append("file", file);

        try {
          const res = await fetch("/api/files/samples", {
            method: "POST",
            body: formData,
          });
          if (!res.ok) {
            const data = await res.json();
            setError(data.error ?? "Upload failed");
          }
        } catch {
          setError("Network error during upload");
        }
      }

      await fetchFiles();
      onFilesChanged();
      setUploading(false);
    },
    [fetchFiles, onFilesChanged]
  );

  const handleDelete = useCallback(
    async (fileId: string) => {
      await fetch("/api/files/samples/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileId }),
      });
      await fetchFiles();
      onFilesChanged();
    },
    [fetchFiles, onFilesChanged]
  );

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Upload Sample Files"
      primaryAction={{ content: "Done", onAction: onClose }}
    >
      <Modal.Section>
        <BlockStack gap="400">
          <Text as="p" variant="bodyMd" tone="subdued">
            Upload sample evidence files (PDF, JPG, PNG). These help DisputeDesk
            understand your evidence format.
          </Text>

          {error && (
            <Banner title="Upload error" tone="critical" onDismiss={() => setError(null)}>
              <p>{error}</p>
            </Banner>
          )}

          <DropZone
            onDrop={handleDrop}
            accept=".pdf,.jpg,.jpeg,.png"
            type="file"
            allowMultiple
            disabled={uploading}
          >
            <DropZone.FileUpload
              actionTitle={uploading ? "Uploading..." : "Add files"}
              actionHint="Accepts PDF, JPG, PNG (max 10 MB)"
            />
          </DropZone>

          {files.length > 0 && (
            <BlockStack gap="200">
              <Text as="h3" variant="headingSm">
                Uploaded files ({files.length})
              </Text>
              {files.map((f) => (
                <div
                  key={f.id}
                  style={{
                    padding: 12,
                    border: "1px solid #E1E3E5",
                    borderRadius: 8,
                  }}
                >
                  <InlineStack align="space-between" blockAlign="center">
                    <InlineStack gap="300" blockAlign="center">
                      <Thumbnail
                        source={
                          f.mime_type.startsWith("image/")
                            ? ""
                            : ""
                        }
                        alt={f.filename}
                        size="small"
                      />
                      <BlockStack gap="050">
                        <Text as="span" variant="bodySm" fontWeight="semibold">
                          {f.filename}
                        </Text>
                        <Text as="span" variant="bodySm" tone="subdued">
                          {formatSize(f.size_bytes)}
                        </Text>
                      </BlockStack>
                    </InlineStack>
                    <Button
                      variant="plain"
                      tone="critical"
                      onClick={() => handleDelete(f.id)}
                      icon={DeleteIcon}
                      accessibilityLabel={`Delete ${f.filename}`}
                    />
                  </InlineStack>
                </div>
              ))}
            </BlockStack>
          )}
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}
