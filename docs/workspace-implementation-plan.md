# Dispute Workspace — Implementation Blueprint v3

Core principle: **An argument supported by evidence, not a checklist.**

---

## 1. Route Structure

```
app/(embedded)/app/disputes/[id]/
├── page.tsx                          # Entry: useDisputeWorkspace → WorkspaceShell
├── workspace.module.css              # Layout styles
├── WorkspaceShell.tsx                # Persistent header + 3 Polaris Tabs
├── tabs/
│   ├── OverviewTab.tsx
│   ├── EvidenceTab.tsx
│   └── ReviewSubmitTab.tsx
├── components/
│   ├── CaseTypeHeader.tsx
│   ├── StatusDeadlineBar.tsx
│   ├── NextActionPanel.tsx
│   ├── CaseSummary.tsx
│   ├── CaseStrengthMeter.tsx
│   ├── EvidenceCompleteness.tsx
│   ├── ArgumentSummary.tsx
│   ├── ArgumentMap.tsx
│   ├── WhyThisCaseWins.tsx
│   ├── RebuttalEditor.tsx
│   ├── EvidenceCategoryCard.tsx
│   ├── EvidenceItemRow.tsx
│   ├── MissingEvidencePanel.tsx
│   ├── SubmissionPreview.tsx
│   ├── ReadinessCard.tsx
│   ├── RiskExplanation.tsx
│   ├── CaseImprovementSignal.tsx
│   ├── OverrideModal.tsx
│   ├── DecisionLog.tsx
│   └── types.ts
├── hooks/
│   ├── useDisputeWorkspace.ts
│   ├── useNextAction.ts
│   └── useCaseStrength.ts
└── lib/                              # Workspace-local logic (thin wrappers)
    └── evidenceContentRenderer.tsx   # Renders structured data per evidence type

lib/argument/                         # Backend argument engine
├── templates.ts                      # Reason → toWin + strongestEvidence + counterclaims
├── generateArgument.ts               # Build ArgumentMap from reason + evidence
├── generateRebuttal.ts               # Build RebuttalDraft from ArgumentMap
├── caseStrength.ts                   # Per-claim + overall strength
├── whyThisCaseWins.ts                # Strengths / weaknesses derivation
├── riskExplanation.ts                # Risk assessment for submit
├── nextAction.ts                     # Exact next step
└── types.ts                          # ArgumentMap, CounterclaimNode, etc.
```

### Removed routes

| Route | Disposition |
|-------|------------|
| `/app/packs/[packId]` (dispute packs) | Redirect to `/app/disputes/:disputeId?tab=1` |
| `/app/packs/[packId]` (library packs) | Kept as-is (template preview) |

---

## 2. Component Architecture

### WorkspaceShell

Renders:
1. Polaris `<Page>` with `backAction` to `/app/disputes`
2. Polaris `<Tabs>` — Overview | Evidence | Review & Submit
3. Active tab component

Tab state: `useState<0|1|2>`. Not URL-based (App Bridge re-renders on URL changes).

---

### Overview Tab — section by section

#### 1. CaseTypeHeader

```typescript
Props: {
  disputeType: string;           // "Fraud — Card not present"
  toWin: string[];               // ["Cardholder authorized the transaction", ...]
  strongestEvidence: string[];   // ["AVS/CVV match", "IP consistency", ...]
}
```

Content is looked up from `lib/argument/templates.ts` by dispute reason. Not hardcoded in the component.

```
┌──────────────────────────────────────────────────────────┐
│  Fraud — Card not present                                │
│                                                          │
│  To win this case, you must prove:                       │
│  • Cardholder authorized the transaction                 │
│  • Identity matches buyer behavior                       │
│  • Delivery was successful                               │
│                                                          │
│  Strongest evidence:                                     │
│  AVS/CVV match  •  IP consistency  •  Delivery confirm   │
└──────────────────────────────────────────────────────────┘
```

#### 2. StatusDeadlineBar

```typescript
Props: {
  normalizedStatus: string;
  deadline: string | null;
  urgent: boolean;
  primaryCta: { label: string; onAction: () => void } | null;
  isAutomated: boolean;
}
```

#### 3. NextActionPanel

```typescript
Props: {
  action: NextAction;
  onAction: () => void;
}

type NextAction = {
  label: string;              // "Add shipping tracking"
  description: string;       // "Tracking is the strongest evidence for..."
  targetTab?: 0 | 1 | 2;
  targetField?: string;
  severity: "info" | "warning" | "critical";
};
```

ONE instruction. Computed by `useNextAction` hook.

#### 4. CaseSummary

```typescript
Props: {
  orderName: string;
  amount: string;
  customerName: string;
  reason: string;
  phase: string;
  openedAt: string;
}
```

#### 5. CaseStrengthMeter

```typescript
Props: {
  strength: "strong" | "moderate" | "weak" | "insufficient";
  score: number;
  supportedClaims: number;
  totalClaims: number;
  improvementHint: string | null;
}
```

Updates dynamically when evidence changes.

#### 6. EvidenceCompleteness

```typescript
Props: {
  score: number;
  categories: Array<{ label: string; status: "complete" | "partial" | "missing" }>;
}
```

Horizontal badges: `✓ Order` `✓ Shipping` `⚠ Payment` `✗ Comms`

---

### Evidence Tab — section by section

#### A. ArgumentSummary

```typescript
Props: {
  summary: string;
  source: "generated" | "edited";
  onEdit: (text: string) => void;
  readOnly: boolean;
}
```

Short explanation of why the case should win. Editable inline.

#### B. ArgumentMap

```typescript
Props: {
  claims: CounterclaimNode[];
  onNavigateToEvidence: (field: string) => void;
}

type CounterclaimNode = {
  id: string;
  title: string;
  strength: "strong" | "moderate" | "weak";
  supporting: Array<{ field: string; label: string; status: "available" | "waived" }>;
  missing: Array<{ field: string; label: string; impact: "high" | "medium" | "low" }>;
};
```

**Click behavior (mandatory):** Clicking any evidence badge (supporting or missing) calls `onNavigateToEvidence(field)` which:
1. Finds which category contains that field
2. Expands that category (adds to `expandedCategories` set)
3. Sets `focusField` to that field
4. Scrolls to the item
5. Highlights it with pulse animation

This uses the same `focusField` + `setItemRef` pattern already implemented in the current EvidenceBuilderSection.

```
┌──────────────────────────────────────────────────────┐
│  Claim: Customer authorized the transaction          │
│  Strength: ●●●○ Strong                               │
│                                                      │
│  Supporting:                                         │
│  [✓ AVS match]  [✓ CVV match]  [✓ IP matches]        │  ← clickable
│                                                      │
│  Missing:                                            │
│  [⚠ No prior purchase history] (medium impact)       │  ← clickable
└──────────────────────────────────────────────────────┘
```

#### C. WhyThisCaseWins

```typescript
Props: {
  strengths: string[];
  weaknesses: string[];
  overall: "strong" | "moderate" | "weak";
}
```

Auto-generated from `lib/argument/whyThisCaseWins.ts`. Not editable.

```
┌──────────────────────────────────────────────────────┐
│  Why this case should win                            │
│                                                      │
│  This case is strong because:                        │
│  • AVS and CVV passed                                │
│  • Delivery confirmed by carrier                     │
│  • IP address matches billing region                 │
│                                                      │
│  Weakness:                                           │
│  • No prior purchase history on file                 │
│                                                      │
│  Overall: Strong case                                │
└──────────────────────────────────────────────────────┘
```

#### D. RebuttalEditor

```typescript
Props: {
  sections: RebuttalSection[];
  onChange: (sections: RebuttalSection[]) => void;
  readOnly: boolean;
  source: "generated" | "edited";
}

type RebuttalSection = {
  id: string;
  type: "summary" | "claim" | "conclusion";
  claimId?: string;
  text: string;
  evidenceRefs: string[];
};
```

Structured: summary → one section per claim → conclusion. Each section editable. Evidence refs shown as clickable badges (same navigate-to-evidence behavior).

#### E. EvidenceCategoryCard

```typescript
Props: {
  category: { key: string; label: string; fields: string[] };
  items: EvidenceItemWithStrength[];
  evidenceData: Map<string, EvidenceItemFull>;  // Actual data for content rendering
  relevance: "high" | "medium" | "low";
  expanded: boolean;
  onToggle: () => void;
  onUpload: (field: string, files: File[]) => Promise<void>;
  onWaive: (field: string, reason: WaiveReason) => void;
  onUnwaive: (field: string) => void;
  uploadingField: string | null;
  failedFields: Map<string, string>;
  readOnly: boolean;
}
```

Expandable card. Sorted by relevance to dispute reason (high first). Shows item count + relevance badge.

#### F. EvidenceItemRow (rebuilt)

```typescript
Props: {
  item: EvidenceItemWithStrength;
  whyText: string;
  contentPreview: React.ReactNode | null;
  onUpload: (field: string, files: File[]) => Promise<void>;
  onWaive: (field: string, reason: WaiveReason) => void;
  isUploading: boolean;
  errorMessage?: string;
  readOnly: boolean;
  highlighted: boolean;
  autoExpand: boolean;
}

type EvidenceItemWithStrength = ChecklistItemV2 & {
  strength: "strong" | "moderate" | "weak" | "none";
  impact: "critical" | "significant" | "minor" | "negligible";
  content: Record<string, unknown> | null;
};
```

**Content preview is mandatory.** The component renders actual structured data:

```typescript
// lib/evidenceContentRenderer.tsx
function renderEvidenceContent(field: string, data: Record<string, unknown>): React.ReactNode {
  switch (field) {
    case "shipping_tracking":
      return <TrackingPreview data={data} />;     // Carrier, tracking #, dates
    case "avs_cvv_match":
      return <AvsPreview data={data} />;          // AVS code, CVV code, gateway
    case "order_confirmation":
      return <OrderPreview data={data} />;        // Order #, line items, totals
    case "delivery_proof":
      return <DeliveryPreview data={data} />;     // Delivered at, signed by
    case "refund_policy":
    case "shipping_policy":
    case "cancellation_policy":
      return <PolicyPreview data={data} />;       // Policy type, text excerpt
    case "customer_communication":
      return <CommsPreview data={data} />;        // Timeline events, notes
    case "billing_address_match":
      return <AddressMatchPreview data={data} />; // Billing vs shipping match
    default:
      return <GenericPreview data={data} />;       // Key-value pairs
  }
}
```

Each preview renderer is a small Polaris-based component that renders the actual evidence data in a readable format. No JSON dumps. No placeholders.

Example for tracking:
```
┌─────────────────────────────────────────────────┐
│  ✓ Shipping Tracking                            │
│  Strength: Strong    Impact: Critical            │
│  Source: From Shopify                            │
│                                                 │
│  Shows the carrier confirmed shipment —         │
│  required to win 'item not received' disputes   │
│                                                 │
│  ┌─ Preview ──────────────────────────────────┐ │
│  │  Carrier: USPS                             │ │
│  │  Tracking: 1Z999AA10123456784              │ │
│  │  Shipped: Mar 1, 2026                      │ │
│  │  Delivered: Mar 3, 2026                    │ │
│  │  Status: Delivered                         │ │
│  └────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────┘
```

#### G. MissingEvidencePanel

```typescript
Props: {
  items: MissingItemWithContext[];
  onUpload: (field: string, files: File[]) => Promise<void>;
  onWaive: (field: string, reason: WaiveReason) => void;
}

type MissingItemWithContext = {
  field: string;
  label: string;
  priority: "critical" | "recommended" | "optional";
  impact: string;
  source: string;
  effort: "low" | "medium" | "high";
  recommendation: string;
};
```

---

### Review & Submit Tab — section by section

#### A. SubmissionPreview

```typescript
Props: {
  fields: SubmissionField[];
  onToggleField: (fieldName: string) => void;
  readOnly: boolean;
}

type SubmissionField = {
  shopifyFieldName: string;
  shopifyFieldLabel: string;
  content: string;
  contentPreview: string;
  source: string;
  included: boolean;
};
```

#### B. ReadinessCard

```typescript
Props: {
  readiness: SubmissionReadiness;
  completenessScore: number;
  warnings: string[];
  blockers: string[];
  argumentStrength: string | null;
}
```

#### C. RiskExplanation

```typescript
Props: {
  expectedOutcome: "strong" | "moderate" | "weak";
  risks: string[];
}
```

#### D. CaseImprovementSignal

```typescript
Props: {
  currentStrength: string;
  potentialStrength: string;
  action: string;
  field: string;
  onAction: () => void;  // Navigate to evidence tab + focus field
}
```

Only rendered when improvement exists.

#### E. OverrideModal

```typescript
Props: {
  open: boolean;
  warnings: string[];
  onConfirm: (reason: string, note?: string) => void;
  onCancel: () => void;
}
```

#### F. DecisionLog

```typescript
Props: {
  events: Array<{
    type: "waive" | "override" | "submission" | "rebuttal_edit";
    timestamp: string;
    actor: string;
    detail: string;
  }>;
}
```

Collapsible. Only governance events.

---

## 3. State Model

### Server Data

```typescript
interface WorkspaceData {
  dispute: {
    id: string;
    reason: string;
    reasonFamily: string;
    phase: "inquiry" | "chargeback";
    amount: number;
    currency: string;
    orderName: string;
    orderGid: string;
    customerName: string;
    shopDomain: string;
    disputeGid: string;
    disputeEvidenceGid: string;
    dueAt: string | null;
    openedAt: string;
    normalizedStatus: string;
    submissionState: string;
    finalOutcome: string | null;
  };

  pack: {
    id: string;
    status: string;
    completenessScore: number;
    submissionReadiness: SubmissionReadiness;
    checklistV2: ChecklistItemV2[];
    waivedItems: WaivedItemRecord[];
    evidenceItems: EvidenceItemFull[];
    auditEvents: AuditEvent[];
    pdfPath: string | null;
    savedToShopifyAt: string | null;
    activeBuildJob: { id: string; status: string } | null;
  } | null;

  argumentMap: {
    issuerClaim: { text: string; reasonCode: string };
    counterclaims: CounterclaimNode[];
    overallStrength: "strong" | "moderate" | "weak" | "insufficient";
  } | null;

  rebuttalDraft: {
    sections: RebuttalSection[];
    source: "generated" | "edited";
  } | null;

  submissionFields: SubmissionField[];

  caseTypeInfo: {
    disputeType: string;
    toWin: string[];
    strongestEvidence: string[];
  };
}
```

### Client State

```typescript
interface WorkspaceClientState {
  activeTab: 0 | 1 | 2;
  loading: boolean;

  // Evidence
  uploadingField: string | null;
  failedFields: Map<string, string>;
  completedFields: Set<string>;
  focusField: string | null;
  expandedCategories: Set<string>;

  // Submit
  excludedFields: Set<string>;
  showOverrideModal: boolean;
  saving: boolean;

  // Rebuttal
  rebuttalDirty: boolean;
}
```

### Derived State (computed every render)

```typescript
interface DerivedState {
  // Evidence with strength/impact annotations
  effectiveChecklist: EvidenceItemWithStrength[];

  // Evidence grouped by category, sorted by relevance
  categories: Array<{
    category: EvidenceCategory;
    items: EvidenceItemWithStrength[];
    relevance: "high" | "medium" | "low";
  }>;

  // Gaps
  missingItems: MissingItemWithContext[];

  // Readiness (recalculated with optimistic state)
  readiness: SubmissionReadiness;
  blockerCount: number;
  warningCount: number;

  // Case strength
  caseStrength: {
    overall: "strong" | "moderate" | "weak" | "insufficient";
    score: number;
    supportedClaims: number;
    totalClaims: number;
    improvementHint: string | null;
  };

  // Why wins
  whyWins: {
    strengths: string[];
    weaknesses: string[];
    overall: "strong" | "moderate" | "weak";
  };

  // Risk
  risk: {
    expectedOutcome: "strong" | "moderate" | "weak";
    risks: string[];
  };

  // Improvement
  improvement: {
    currentStrength: string;
    potentialStrength: string;
    action: string;
    field: string;
  } | null;

  // Next action
  nextAction: NextAction;

  // Flags
  isReadOnly: boolean;
  isBuilding: boolean;
}
```

### Central Hook: useDisputeWorkspace

```typescript
function useDisputeWorkspace(disputeId: string) {
  // 1. Fetch from GET /api/disputes/:id/workspace
  // 2. If pack exists but no argumentMap → auto-generate (POST /api/disputes/:id/argument)
  // 3. Compute derived state
  // 4. Poll while building (3s interval)
  // 5. Expose actions

  return {
    data: WorkspaceData;
    clientState: WorkspaceClientState;
    derived: DerivedState;
    actions: {
      generatePack: (templateId?: string) => Promise<void>;
      uploadEvidence: (field: string, files: File[]) => Promise<void>;
      waiveItem: (field: string, reason: WaiveReason) => void;
      unwaiveItem: (field: string) => void;
      saveRebuttal: (sections: RebuttalSection[]) => Promise<void>;
      toggleSubmissionField: (fieldName: string) => void;
      submitToShopify: (overrideReason?: string, overrideNote?: string) => Promise<void>;
      exportPdf: () => Promise<void>;
      downloadPdf: () => void;
      syncDispute: () => Promise<void>;
      setActiveTab: (tab: 0 | 1 | 2) => void;
      navigateToEvidence: (field: string) => void;  // Switch to Evidence tab + focus field
    };
  };
}
```

**Auto-generation rule:** When the hook loads workspace data and finds `pack !== null` but `argumentMap === null`, it immediately calls `POST /api/disputes/:id/argument` to generate the argument map and rebuttal. No manual trigger needed. The merchant sees the argument on first visit.

---

## 4. API Requirements

### Existing (reused)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/disputes/[id]` | GET | Dispute data |
| `/api/disputes/[id]/profile` | GET | Order + customer |
| `/api/disputes/[id]/sync` | POST | Sync from Shopify |
| `/api/packs/[packId]` | GET | Pack + checklist + evidence |
| `/api/packs/[packId]/upload` | POST | Upload evidence |
| `/api/packs/[packId]/waive` | POST/DELETE | Waive/unwaive |
| `/api/packs/[packId]/save-to-shopify` | POST | Submit |
| `/api/packs/[packId]/render-pdf` | POST | Generate PDF |
| `/api/packs/[packId]/download` | GET | Download PDF |

### New endpoints

#### `GET /api/disputes/[id]/workspace`

Returns all workspace data in one request. Joins: dispute, pack (latest for dispute), argument_map, rebuttal_draft, submission fields (computed), case type info (from templates), profile.

```typescript
Response: WorkspaceData
```

#### `POST /api/disputes/[id]/argument`

Generates argument map + rebuttal from dispute reason + pack evidence.

```typescript
Request: { packId: string; regenerate?: boolean }
Response: { argumentMap: ArgumentMap; rebuttalDraft: RebuttalDraft }
```

Logic:
1. Load dispute reason
2. Load checklist_v2 from pack
3. Look up counterclaim template from `lib/argument/templates.ts`
4. For each counterclaim, check which required evidence is present
5. Calculate per-claim strength
6. Generate rebuttal sections (one per claim + summary + conclusion)
7. Persist to `argument_maps` + `rebuttal_drafts`
8. Return both

#### `PUT /api/disputes/[id]/rebuttal`

Save merchant-edited rebuttal.

```typescript
Request: { packId: string; sections: RebuttalSection[] }
Response: { ok: true }
```

Updates `rebuttal_drafts` row, sets `source = "edited"`.

#### `GET /api/packs/[packId]/submission-preview`

Computes exact Shopify payload without submitting.

```typescript
Response: { fields: SubmissionField[] }
```

Runs field mapping from `lib/shopify/fieldMapping.ts` against pack evidence, includes rebuttal in `cancellationRebuttal` / `uncategorizedText` fields.

#### Updated: `POST /api/packs/[packId]/save-to-shopify`

New request fields:
```typescript
{
  confirmWarnings?: boolean;
  overrideReason?: string;
  overrideNote?: string;
  excludedFields?: string[];
}
```

Creates `submission_attempts` row with full context.

---

## 5. Data Model Changes

### New tables

```sql
create table argument_maps (
  id               uuid primary key default gen_random_uuid(),
  dispute_id       uuid not null references disputes(id),
  pack_id          uuid references evidence_packs(id),
  issuer_claim     jsonb not null,
  counterclaims    jsonb not null default '[]'::jsonb,
  overall_strength text not null default 'insufficient',
  generated_at     timestamptz not null default now(),
  edited_at        timestamptz,
  edited_by        text
);
create index idx_argmap_dispute on argument_maps(dispute_id);
alter table argument_maps enable row level security;

create table rebuttal_drafts (
  id          uuid primary key default gen_random_uuid(),
  pack_id     uuid not null references evidence_packs(id),
  locale      text not null default 'en-US',
  sections    jsonb,
  source      text not null default 'GENERATED',
  version     int not null default 1,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique(pack_id, locale)
);
create index idx_rebuttal_pack on rebuttal_drafts(pack_id);
alter table rebuttal_drafts enable row level security;

create table submission_attempts (
  id                 uuid primary key default gen_random_uuid(),
  pack_id            uuid not null references evidence_packs(id),
  dispute_id         uuid not null references disputes(id),
  shop_id            uuid not null references shops(id),
  method             text not null check (method in ('auto', 'manual')),
  readiness          text not null,
  completeness_score int,
  argument_strength  text,
  warnings           jsonb default '[]'::jsonb,
  excluded_fields    jsonb default '[]'::jsonb,
  override_reason    text,
  override_note      text,
  shopify_result     text,
  submitted_at       timestamptz not null default now(),
  actor_type         text not null,
  actor_id           text
);
create index idx_subatt_dispute on submission_attempts(dispute_id);
alter table submission_attempts enable row level security;
```

### New engine files

| File | Purpose |
|------|---------|
| `lib/argument/templates.ts` | Reason → { toWin, strongestEvidence, counterclaims[] } for all 6 reasons |
| `lib/argument/generateArgument.ts` | Build ArgumentMap from reason + checklist |
| `lib/argument/generateRebuttal.ts` | Build RebuttalDraft sections from ArgumentMap |
| `lib/argument/caseStrength.ts` | Per-claim + overall strength from evidence state |
| `lib/argument/whyThisCaseWins.ts` | Derive strengths[] and weaknesses[] |
| `lib/argument/riskExplanation.ts` | Derive risks[] for submit tab |
| `lib/argument/nextAction.ts` | Compute single NextAction |
| `lib/argument/types.ts` | ArgumentMap, CounterclaimNode, RebuttalSection, etc. |

---

## 6. Step-by-Step Rebuild Plan

### Phase 1: Argument Engine (backend, no UI)

**Goal:** Build the reasoning layer that powers the entire workspace.

1. Create `lib/argument/types.ts` — ArgumentMap, CounterclaimNode, RebuttalSection, NextAction, CaseStrength, WhyWins, RiskAssessment
2. Create `lib/argument/templates.ts` — all 6 reasons with toWin, strongestEvidence, counterclaims (required + supporting evidence per claim)
3. Create `lib/argument/generateArgument.ts` — input: reason + ChecklistItemV2[] → output: ArgumentMap (evaluates claims against evidence)
4. Create `lib/argument/generateRebuttal.ts` — input: ArgumentMap → output: RebuttalDraft (sections with evidence refs)
5. Create `lib/argument/caseStrength.ts` — input: ArgumentMap → output: { overall, score, per-claim, improvementHint }
6. Create `lib/argument/whyThisCaseWins.ts` — input: ArgumentMap + checklist → output: { strengths[], weaknesses[], overall }
7. Create `lib/argument/riskExplanation.ts` — input: ArgumentMap + checklist → output: { expectedOutcome, risks[] }
8. Create `lib/argument/nextAction.ts` — input: WorkspaceData + derived → output: NextAction
9. Migration: create `argument_maps`, `rebuttal_drafts`, `submission_attempts` tables
10. Create `POST /api/disputes/[id]/argument` endpoint
11. Create `PUT /api/disputes/[id]/rebuttal` endpoint
12. Create `GET /api/packs/[packId]/submission-preview` endpoint

**Verify:** Unit tests for argument generation. Each reason produces correct claims. Strength calculation works. Rebuttal sections generated.

### Phase 2: Workspace Shell + Data Hook

**Goal:** Replace dispute detail page with tabbed workspace loading all data.

1. Create `GET /api/disputes/[id]/workspace` — composite endpoint
2. Create `hooks/useDisputeWorkspace.ts` — fetches workspace data, auto-generates argument if missing, computes derived state, exposes actions
3. Create `hooks/useNextAction.ts` — thin wrapper calling `lib/argument/nextAction.ts` logic client-side
4. Create `hooks/useCaseStrength.ts` — thin wrapper calling strength logic client-side
5. Create `WorkspaceShell.tsx` — Polaris Page + Tabs
6. Create `workspace.module.css`
7. Create `types.ts` — workspace-specific interfaces
8. Replace `page.tsx` — mount WorkspaceShell
9. Create stub tabs: `OverviewTab.tsx`, `EvidenceTab.tsx`, `ReviewSubmitTab.tsx`

**Verify:** Workspace loads. Tabs switch. Data populates. Argument auto-generates on first load.

### Phase 3: Overview Tab

**Goal:** Fast triage with case type, next action, strength.

1. Create `CaseTypeHeader.tsx`
2. Create `StatusDeadlineBar.tsx`
3. Create `NextActionPanel.tsx`
4. Create `CaseSummary.tsx`
5. Create `CaseStrengthMeter.tsx`
6. Create `EvidenceCompleteness.tsx`
7. Wire into `OverviewTab.tsx`

**Verify:** Overview shows case type from templates, computed next action, dynamic strength meter.

### Phase 4: Evidence Tab

**Goal:** Argument-first evidence workspace with real content rendering.

1. Create `ArgumentSummary.tsx`
2. Create `ArgumentMap.tsx` — with click-to-navigate behavior
3. Create `WhyThisCaseWins.tsx`
4. Create `RebuttalEditor.tsx` — structured sections, editable
5. Create evidence content renderers in `lib/evidenceContentRenderer.tsx`:
   - `TrackingPreview` — carrier, tracking #, shipped/delivered dates
   - `AvsPreview` — AVS code, CVV code, gateway, card info
   - `OrderPreview` — order name, line items, totals
   - `DeliveryPreview` — delivery date, status
   - `PolicyPreview` — policy type, text excerpt, captured date
   - `CommsPreview` — timeline events, notes, summary counts
   - `AddressMatchPreview` — billing vs shipping comparison
   - `GenericPreview` — key-value fallback
6. Create `EvidenceCategoryCard.tsx`
7. Rebuild `EvidenceItemRow.tsx` — with strength, impact, content preview
8. Create `MissingEvidencePanel.tsx` — impact, source, effort, recommendation
9. Wire into `EvidenceTab.tsx`

**Verify:** Argument map renders with clickable evidence links. Clicking navigates to correct category + item. Evidence items show real structured data. Upload and waive work.

### Phase 5: Review & Submit Tab

**Goal:** Exact submission preview with risk assessment and override flow.

1. Create `SubmissionPreview.tsx`
2. Create `ReadinessCard.tsx`
3. Create `RiskExplanation.tsx`
4. Create `CaseImprovementSignal.tsx`
5. Create `OverrideModal.tsx`
6. Create `DecisionLog.tsx`
7. Update `save-to-shopify` route — accept excludedFields, log submission_attempt
8. Wire into `ReviewSubmitTab.tsx`

**Verify:** Submit tab shows exact Shopify payload. Risk explanation matches argument strength. Override logged.

### Phase 6: Polish + Integration

**Goal:** Single-fetch, PDF upgrade, redirects, i18n.

1. Optimize `GET /api/disputes/[id]/workspace` — ensure single DB round-trip where possible
2. Redirect `/app/packs/:packId` → `/app/disputes/:disputeId` for dispute packs
3. Update PDF to include argument summary + rebuttal sections
4. Add i18n keys for all new components (all 12 locale files)
5. Update `docs/technical.md`
6. Remove dead code from old dispute detail components (StatusHero, EvidencePackModule, KeyDisputeFacts, DetailsAndHistory)

**Verify:** Full end-to-end flow. One API call loads workspace. PDF includes argument. Old URLs redirect. Build passes.

---

## 7. Argument Templates

### FRAUDULENT
```typescript
{
  disputeType: "Fraud — Unauthorized transaction",
  toWin: [
    "Cardholder authorized the transaction",
    "Identity matches buyer behavior",
    "Delivery was successful",
  ],
  strongestEvidence: ["AVS/CVV match", "IP consistency", "Delivery confirmation"],
  counterclaims: [
    {
      id: "fraud-1",
      title: "Transaction was verified by payment processor",
      requiredEvidence: ["avs_cvv_match", "billing_address_match"],
      supportingEvidence: ["customer_ip", "risk_analysis"],
    },
    {
      id: "fraud-2",
      title: "Order was fulfilled to verified address",
      requiredEvidence: ["shipping_tracking", "delivery_proof"],
      supportingEvidence: ["billing_address_match"],
    },
    {
      id: "fraud-3",
      title: "Customer has legitimate purchase history",
      requiredEvidence: ["activity_log"],
      supportingEvidence: ["customer_communication"],
    },
  ],
}
```

### PRODUCT_NOT_RECEIVED
```typescript
{
  disputeType: "Item not received",
  toWin: [
    "Item was shipped with tracking",
    "Delivery was confirmed by carrier",
    "Shipping terms were disclosed",
  ],
  strongestEvidence: ["Tracking confirmation", "Delivery proof", "Shipping policy"],
  counterclaims: [
    {
      id: "pnr-1",
      title: "Order was shipped and delivered",
      requiredEvidence: ["shipping_tracking", "delivery_proof"],
      supportingEvidence: [],
    },
    {
      id: "pnr-2",
      title: "Customer was notified of shipment",
      requiredEvidence: ["customer_communication"],
      supportingEvidence: [],
    },
    {
      id: "pnr-3",
      title: "Shipping terms were disclosed at checkout",
      requiredEvidence: ["shipping_policy"],
      supportingEvidence: [],
    },
  ],
}
```

### PRODUCT_UNACCEPTABLE
```typescript
{
  disputeType: "Product not as described",
  toWin: [
    "Product matched its description",
    "Return/refund policy was disclosed",
    "Customer was contacted for resolution",
  ],
  strongestEvidence: ["Product description", "Refund policy", "Customer communication"],
  counterclaims: [
    {
      id: "pua-1",
      title: "Product matched advertised description",
      requiredEvidence: ["product_description"],
      supportingEvidence: ["supporting_documents"],
    },
    {
      id: "pua-2",
      title: "Return and refund policy was disclosed",
      requiredEvidence: ["refund_policy"],
      supportingEvidence: [],
    },
    {
      id: "pua-3",
      title: "Merchant attempted to resolve the issue",
      requiredEvidence: ["customer_communication"],
      supportingEvidence: [],
    },
  ],
}
```

### SUBSCRIPTION_CANCELED
```typescript
{
  disputeType: "Subscription canceled",
  toWin: [
    "Cancellation terms were disclosed",
    "Customer was notified of renewal",
    "Service was delivered during billing period",
  ],
  strongestEvidence: ["Cancellation policy", "Renewal notification", "Usage history"],
  counterclaims: [
    {
      id: "sub-1",
      title: "Cancellation terms were disclosed before purchase",
      requiredEvidence: ["cancellation_policy"],
      supportingEvidence: [],
    },
    {
      id: "sub-2",
      title: "Customer was notified of upcoming renewal",
      requiredEvidence: ["customer_communication"],
      supportingEvidence: [],
    },
    {
      id: "sub-3",
      title: "Service was delivered during the billing period",
      requiredEvidence: ["activity_log"],
      supportingEvidence: ["supporting_documents"],
    },
  ],
}
```

### DUPLICATE
```typescript
{
  disputeType: "Duplicate charge",
  toWin: [
    "Each charge corresponds to a distinct order",
    "Order details confirm separate transactions",
  ],
  strongestEvidence: ["Order confirmation", "Duplicate explanation"],
  counterclaims: [
    {
      id: "dup-1",
      title: "Each charge is for a separate order",
      requiredEvidence: ["order_confirmation", "duplicate_explanation"],
      supportingEvidence: ["supporting_documents"],
    },
  ],
}
```

### GENERAL
```typescript
{
  disputeType: "General dispute",
  toWin: [
    "Transaction was legitimate",
    "Order was fulfilled as described",
  ],
  strongestEvidence: ["Order confirmation", "Shipping tracking", "Customer communication"],
  counterclaims: [
    {
      id: "gen-1",
      title: "Transaction was legitimate and fulfilled",
      requiredEvidence: ["order_confirmation"],
      supportingEvidence: ["shipping_tracking", "customer_communication", "refund_policy"],
    },
  ],
}
```

---

## 8. Evidence Categories + Relevance

```typescript
const EVIDENCE_CATEGORIES = [
  { key: "order",         label: "Order Facts",                 fields: ["order_confirmation", "billing_address_match"] },
  { key: "payment",       label: "Payment Verification",        fields: ["avs_cvv_match"] },
  { key: "fulfillment",   label: "Fulfillment & Delivery",      fields: ["shipping_tracking", "delivery_proof"] },
  { key: "communication", label: "Customer Communication",      fields: ["customer_communication"] },
  { key: "policy",        label: "Policies & Disclosures",      fields: ["refund_policy", "shipping_policy", "cancellation_policy"] },
  { key: "identity",      label: "Customer Identity & History",  fields: ["activity_log", "customer_ip", "risk_analysis"] },
  { key: "merchant",      label: "Merchant Evidence",            fields: ["supporting_documents", "product_description", "duplicate_explanation"] },
];

const CATEGORY_RELEVANCE: Record<string, Record<string, "high"|"medium"|"low">> = {
  FRAUDULENT:            { order:"high", payment:"high", fulfillment:"medium", communication:"medium", policy:"low",    identity:"high",  merchant:"medium" },
  PRODUCT_NOT_RECEIVED:  { order:"high", payment:"low",  fulfillment:"high",   communication:"medium", policy:"medium", identity:"low",   merchant:"medium" },
  PRODUCT_UNACCEPTABLE:  { order:"high", payment:"low",  fulfillment:"medium", communication:"high",   policy:"high",   identity:"low",   merchant:"high" },
  SUBSCRIPTION_CANCELED: { order:"high", payment:"low",  fulfillment:"low",    communication:"high",   policy:"high",   identity:"low",   merchant:"medium" },
  DUPLICATE:             { order:"high", payment:"low",  fulfillment:"low",    communication:"low",    policy:"low",    identity:"low",   merchant:"high" },
  GENERAL:               { order:"high", payment:"low",  fulfillment:"medium", communication:"medium", policy:"medium", identity:"low",   merchant:"medium" },
};
```

Categories sorted by relevance (high first) when rendered for each dispute reason.

---

## 9. Next Action Engine

```typescript
function computeNextAction(data: WorkspaceData, derived: DerivedState): NextAction {
  if (!data.pack) {
    return { label: "Generate evidence pack", description: "Collect evidence from Shopify.", severity: "critical" };
  }
  if (data.pack.status === "building" || data.pack.status === "queued") {
    return { label: "Evidence pack is building", description: "Updates automatically.", severity: "info" };
  }

  // Highest-impact missing evidence, lowest effort first
  const critical = derived.missingItems
    .filter(i => i.priority === "critical")
    .sort((a, b) => {
      const effortOrder = { low: 0, medium: 1, high: 2 };
      return effortOrder[a.effort] - effortOrder[b.effort];
    });
  if (critical.length > 0) {
    return {
      label: `Add ${critical[0].label}`,
      description: critical[0].impact,
      targetTab: 1,
      targetField: critical[0].field,
      severity: "warning",
    };
  }

  // Ready to submit
  if (derived.readiness === "ready" || derived.readiness === "ready_with_warnings") {
    return { label: "Review & submit", description: "Case is ready.", targetTab: 2, severity: "info" };
  }

  return { label: "Case submitted", description: "Waiting for resolution.", severity: "info" };
}
```
