"use client";

import { useEffect } from "react";
import { X } from "lucide-react";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
}

const sizeClasses: Record<string, string> = {
  sm: "max-w-md",
  md: "max-w-xl",
  lg: "max-w-2xl",
  xl: "max-w-4xl",
};

export function Modal({
  isOpen,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
}: ModalProps) {
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "unset";
    }
    return () => {
      document.body.style.overflow = "unset";
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      <div
        className={`relative bg-white rounded-xl shadow-2xl w-full ${sizeClasses[size]} max-h-[90vh] flex flex-col animate-in fade-in zoom-in-95 duration-200`}
      >
        <div className="flex items-start justify-between p-6 border-b border-[#E5E7EB]">
          <div className="flex-1">
            <h2 className="text-xl font-bold text-[#0B1220] mb-1">{title}</h2>
            {description && (
              <p className="text-sm text-[#667085]">{description}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="ml-4 text-[#667085] hover:text-[#0B1220] transition-colors flex-shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">{children}</div>

        {footer && (
          <div className="flex items-center justify-end gap-3 p-6 border-t border-[#E5E7EB]">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
