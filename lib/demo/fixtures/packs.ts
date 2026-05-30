import type { DemoPackTemplate } from "./types";

export const DEMO_PACK_TEMPLATES: DemoPackTemplate[] = [
  { id: "pk-fraud", name: "Fraudulent — verified cardholder", reason: "Fraudulent", evidenceCount: 8, trackRecord: "Tested on 1,247 cases · 89% win rate" },
  { id: "pk-pnr", name: "Product not received — tracked delivery", reason: "Product not received", evidenceCount: 5, trackRecord: "Tested on 892 cases · 84% win rate" },
  { id: "pk-sub", name: "Subscription canceled — policy + history", reason: "Subscription canceled", evidenceCount: 5, trackRecord: "Tested on 311 cases · 81% win rate" },
  { id: "pk-dup", name: "Duplicate charge — payment reconciliation", reason: "Duplicate", evidenceCount: 4, trackRecord: "Tested on 156 cases · 92% win rate" },
  { id: "pk-cnp", name: "Credit not processed — refund timeline", reason: "Credit not processed", evidenceCount: 3, trackRecord: "Tested on 89 cases · 67% win rate" },
  { id: "pk-gen", name: "General — best-effort evidence pack", reason: "Other", evidenceCount: 6, trackRecord: "Tested on 412 cases · 71% win rate" },
];
