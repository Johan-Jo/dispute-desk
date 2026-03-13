"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { InlineStack, Text } from "@shopify/polaris";

const NAV_ITEMS: { path: string; label: string }[] = [
  { path: "/app", label: "Dashboard" },
  { path: "/app/disputes", label: "Disputes" },
  { path: "/app/packs", label: "Evidence Packs" },
  { path: "/app/rules", label: "Rules" },
  { path: "/app/billing", label: "Plan" },
  { path: "/app/settings", label: "Settings" },
];

export function EmbeddedAppNav() {
  const pathname = usePathname();

  return (
    <nav
      style={{
        background: "var(--p-color-bg-surface)",
        borderBottom: "1px solid var(--p-color-border)",
        padding: "12px 24px",
      }}
    >
      <InlineStack gap="400" wrap={false} blockAlign="center">
        {NAV_ITEMS.map(({ path, label }) => {
          const isActive =
            path === "/app"
              ? pathname === "/app" || pathname === "/app/"
              : pathname.startsWith(path);
          return (
            <Link
              key={path}
              href={path}
              style={{
                padding: "6px 12px",
                borderRadius: "8px",
                fontSize: "14px",
                fontWeight: isActive ? 600 : 500,
                color: isActive ? "var(--p-color-bg-fill-info)" : "var(--p-color-text-secondary)",
                textDecoration: "none",
                background: isActive ? "var(--p-color-bg-fill-info-secondary)" : "transparent",
              }}
            >
              <Text as="span" variant="bodyMd">
                {label}
              </Text>
            </Link>
          );
        })}
      </InlineStack>
    </nav>
  );
}
