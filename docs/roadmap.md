# DisputeDesk V1 Roadmap

> **Last updated:** 2026-03-01

## Progress

| Epic | Name | Status | Week | Doc |
|------|------|--------|------|-----|
| 0 | Foundations | DONE | 1 | [EPIC-0](epics/EPIC-0-foundations.md) |
| P0 | External Portal + Marketing | DONE | 0-1 | [EPIC-P0](epics/EPIC-P0-portal-marketing.md) |
| A1 | Automation Pipeline | In Progress | 1-3 | [EPIC-A1](epics/EPIC-A1-automation-pipeline.md) |
| 1 | Dispute Sync | DONE | 1-2 | [EPIC-1](epics/EPIC-1-dispute-sync.md) |
| 2 | Evidence Pack Builder | DONE | 2-3 | [EPIC-2](epics/EPIC-2-evidence-pack-builder.md) |
| 3 | PDF Rendering & Storage | DONE | 3 | [EPIC-3](epics/EPIC-3-pdf-rendering.md) |
| 4 | Governance & Review Queue | DONE | 3-4 | [EPIC-4](epics/EPIC-4-governance.md) |
| 5 | Save Evidence to Shopify | DONE | 4 | [EPIC-5](epics/EPIC-5-save-to-shopify.md) |
| 6 | Billing & Plan Limits | DONE | 5 | [EPIC-6](epics/EPIC-6-billing.md) |
| 7 | Hardening | DONE | 5-6 | [EPIC-7](epics/EPIC-7-hardening.md) |
| 8 | Internal Admin Panel | DONE | 6-7 | [EPIC-8](epics/EPIC-8-admin-panel.md) |
| 9 | Multi-Language (i18n) | DONE | 7-8 | [EPIC-9](epics/EPIC-9-i18n.md) |
| 10 | User Help System | DONE | 8 | [EPIC-10](epics/EPIC-10-help-system.md) |
| 10b | Interactive Help Guides | DONE | 8 | — |
| 11 | Setup Wizard & Onboarding | DONE | 9 | — |

## Dependency Chain

```mermaid
flowchart LR
  E0[EPIC0 Foundations] --> EA1[EPIC-A1 Automation]
  E0 --> EP0[EPIC-P0 Portal+Marketing]
  E0 --> E1[EPIC1 DisputeSync]
  EA1 --> E1
  EA1 --> E2[EPIC2 PackBuilder]
  EP0 -.->|portal mirrors| E1
  EP0 -.->|portal mirrors| E2
  E1 --> E2
  E2 --> E3[EPIC3 PdfStorage]
  E2 --> E4[EPIC4 Governance]
  E2 --> E5[EPIC5 SaveToShopify]
  E4 --> E6[EPIC6 Billing]
  E0 --> E7[EPIC7 Hardening]
  E1 --> E7
  E2 --> E7
  E3 --> E7
  E4 --> E7
  E5 --> E7
  E6 --> E7
  E0 --> E8[EPIC8 AdminPanel]
  E6 --> E8
  E7 --> E8
  E0 --> E9[EPIC9 i18n]
  E7 --> E9
  E9 --> E10[EPIC10 HelpSystem]
  E10 --> E10b[EPIC10b HelpGuides]
  E0 --> E11[EPIC11 SetupWizard]
  E9 --> E11
```

## Product Model

DisputeDesk is **automation-first**:

1. **Connect once** — install from Shopify App Store.
2. **Auto-build** — when a dispute appears, DisputeDesk generates an evidence
   pack automatically (order, tracking, policies, uploads).
3. **Auto-save** — when the pack passes rules (completeness score + no blockers),
   evidence is saved to Shopify via API.
4. **Submit in Shopify** — submission to the card network happens in Shopify
   Admin, or Shopify auto-submits on the due date.

DisputeDesk does NOT submit responses to card networks on behalf of merchants.

## Notes

- **EPIC A1** is the automation pivot: it adds the pipeline, settings, and
  completeness engine that all downstream epics build on.
- **EPIC P0** delivers the marketing + portal UI.
- Portal placeholder pages are wired to real data as each epic completes.
- Embedded app inside Shopify Admin remains the primary surface.
- **EPIC 10b** adds interactive guided tours on top of the static help articles.
- **EPIC 11** adds the 7-step setup wizard with dashboard checklist card,
  Evidence Sources V1 (Gorgias connect + sample files), and the onboarding
  state machine.
- **Shopify App Store:** App registered in Shopify Partners. OAuth installs
  working (cookieless state token). Dispute evidence write scopes
  (`read_shopify_payments_dispute_evidences`,
  `write_shopify_payments_dispute_evidences`) pending Shopify approval;
  portal uses "Open in Shopify Admin" + copy-to-clipboard workaround.
