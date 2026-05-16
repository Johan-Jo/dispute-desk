-- Demo-mode cleanup: legacy bank-rebuttal stack retired 2026-05-16.
--
-- The defence-package PDF is now the sole bank-facing artifact. The
-- legacy text-rebuttal engine (`lib/argument/responseEngine.ts`,
-- `generateRebuttal.ts`, `generateArgument.ts`, `rebuttalReason.ts`,
-- `evidenceDataFromPack.ts`) and its API routes
-- (`/api/disputes/[id]/rebuttal`, `/api/disputes/[id]/argument`) were
-- deleted in the same change. These tables stored their output:
--   - rebuttal_drafts — joined sections that became Shopify
--     uncategorizedText + 8 other text fields.
--   - argument_maps — counterclaim breakdown that drove the
--     legacy why-wins / risk surfaces.
--
-- Demo mode = no production data to backfill. Drop them outright.

drop table if exists rebuttal_drafts;
drop table if exists argument_maps;
