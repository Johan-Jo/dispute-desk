"use client";

import { useState } from "react";
import { cn } from "@/components/ui/utils";
import { InstallModal } from "./InstallModal";

interface InstallCTAProps {
  variant?: "topbar" | "floating" | "inline" | "primary";
  label?: string;
  className?: string;
}

const DEFAULT_LABELS: Record<NonNullable<InstallCTAProps["variant"]>, string> = {
  topbar: "Install DisputeDesk on your Shopify store →",
  floating: "Try this with your own disputes",
  inline: "Want DisputeDesk to prepare cases like this for your store? Install now",
  primary: "Install DisputeDesk on your Shopify store →",
};

export function InstallCTA({ variant = "primary", label, className }: InstallCTAProps) {
  const text = label ?? DEFAULT_LABELS[variant];
  const [modalOpen, setModalOpen] = useState(false);
  const open = () => setModalOpen(true);
  const base = "inline-flex items-center justify-center font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2";

  let trigger: React.ReactNode;
  if (variant === "topbar") {
    trigger = (
      <button
        type="button"
        onClick={open}
        className={cn(base, "h-9 px-4 rounded-lg text-sm bg-[#1D4ED8] text-white hover:bg-[#1E40AF] focus:ring-[#1D4ED8]", className)}
      >
        {text}
      </button>
    );
  } else if (variant === "floating") {
    trigger = (
      <button
        type="button"
        onClick={open}
        className={cn(
          base,
          "fixed bottom-6 right-6 z-40 h-12 px-5 rounded-full text-sm bg-[#0B1220] text-white shadow-lg hover:bg-[#1F2937] focus:ring-[#0B1220]",
          className,
        )}
      >
        {text}
      </button>
    );
  } else if (variant === "inline") {
    trigger = (
      <button
        type="button"
        onClick={open}
        className={cn(
          "block w-full rounded-lg border border-[#BFDBFE] bg-[#EFF6FF] p-4 text-center text-sm font-medium text-[#1E3A8A] hover:bg-[#DBEAFE] transition-colors",
          className,
        )}
      >
        {text}
      </button>
    );
  } else {
    trigger = (
      <button
        type="button"
        onClick={open}
        className={cn(
          base,
          "h-12 px-6 rounded-lg text-base bg-[#1D4ED8] text-white hover:bg-[#1E40AF] focus:ring-[#1D4ED8]",
          className,
        )}
      >
        {text}
      </button>
    );
  }

  return (
    <>
      {trigger}
      <InstallModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </>
  );
}
