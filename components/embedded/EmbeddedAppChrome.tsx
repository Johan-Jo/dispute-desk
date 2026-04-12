"use client";

import styles from "./embedded-app-chrome.module.css";

export function EmbeddedAppChrome({ children }: { children: React.ReactNode }) {
  return <div className={styles.pageContent}>{children}</div>;
}
