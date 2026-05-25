-- Swedish: drop the joining "s" from "Chargeback*" compounds in pack-template
-- i18n rows, e.g. "Chargebackspolicy" → "Chargebackpolicy",
-- "Chargebackshistorik" → "Chargebackhistorik". With the English loanword
-- "chargeback" the joining genitive s reads awkwardly and the merchant
-- prefers the unlinked form (the same way "Chargebackexponering" is
-- preferred over "Chargebacksexponering"). Real plurals
-- ("vinn fler chargebacks") are not touched because they don't appear in
-- template i18n payloads, but the REPLACE chains are scoped to exact
-- compound suffixes so they're safe regardless.
--
-- Follow-up to 20260525130000 (which did the broad
-- Återbetalning → Chargeback rename, producing the "Chargebacks*" forms
-- as a byproduct of Swedish compounding).

UPDATE pack_template_i18n
SET name              = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(name,
                          'Chargebackspolicy',   'Chargebackpolicy'),
                          'chargebackspolicy',   'chargebackpolicy'),
                          'Chargebackshistorik', 'Chargebackhistorik'),
                          'Chargebackshantering','Chargebackhantering'),
                          'Chargebackspost',     'Chargebackpost'),
                          'chargebackspost',     'chargebackpost'),
                          'Chargebacksstatus',   'Chargebackstatus'),
                          'chargebacksstatus',   'chargebackstatus'),
    short_description = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(short_description,
                          'Chargebackspolicy',   'Chargebackpolicy'),
                          'chargebackspolicy',   'chargebackpolicy'),
                          'Chargebackshistorik', 'Chargebackhistorik'),
                          'Chargebackshantering','Chargebackhantering'),
                          'Chargebackspost',     'Chargebackpost'),
                          'chargebackspost',     'chargebackpost'),
                          'Chargebacksstatus',   'Chargebackstatus'),
                          'chargebacksstatus',   'chargebackstatus'),
    works_best_for    = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(works_best_for,
                          'Chargebackspolicy',   'Chargebackpolicy'),
                          'chargebackspolicy',   'chargebackpolicy'),
                          'Chargebackshistorik', 'Chargebackhistorik'),
                          'Chargebackshantering','Chargebackhantering'),
                          'Chargebackspost',     'Chargebackpost'),
                          'chargebackspost',     'chargebackpost'),
                          'Chargebacksstatus',   'Chargebackstatus'),
                          'chargebacksstatus',   'chargebackstatus'),
    preview_note      = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(preview_note,
                          'Chargebackspolicy',   'Chargebackpolicy'),
                          'chargebackspolicy',   'chargebackpolicy'),
                          'Chargebackshistorik', 'Chargebackhistorik'),
                          'Chargebackshantering','Chargebackhantering'),
                          'Chargebackspost',     'Chargebackpost'),
                          'chargebackspost',     'chargebackpost'),
                          'Chargebacksstatus',   'Chargebackstatus'),
                          'chargebacksstatus',   'chargebackstatus')
WHERE locale = 'sv';

UPDATE pack_template_section_i18n
SET title = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(title,
              'Chargebackspolicy',   'Chargebackpolicy'),
              'chargebackspolicy',   'chargebackpolicy'),
              'Chargebackshistorik', 'Chargebackhistorik'),
              'Chargebackshantering','Chargebackhantering'),
              'Chargebackspost',     'Chargebackpost'),
              'chargebackspost',     'chargebackpost'),
              'Chargebacksstatus',   'Chargebackstatus'),
              'chargebacksstatus',   'chargebackstatus')
WHERE locale = 'sv';

UPDATE pack_template_item_i18n
SET label    = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(label,
                 'Chargebackspolicy',   'Chargebackpolicy'),
                 'chargebackspolicy',   'chargebackpolicy'),
                 'Chargebackshistorik', 'Chargebackhistorik'),
                 'Chargebackshantering','Chargebackhantering'),
                 'Chargebackspost',     'Chargebackpost'),
                 'chargebackspost',     'chargebackpost'),
                 'Chargebacksstatus',   'Chargebackstatus'),
                 'chargebacksstatus',   'chargebackstatus'),
    guidance = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(guidance,
                 'Chargebackspolicy',   'Chargebackpolicy'),
                 'chargebackspolicy',   'chargebackpolicy'),
                 'Chargebackshistorik', 'Chargebackhistorik'),
                 'Chargebackshantering','Chargebackhantering'),
                 'Chargebackspost',     'Chargebackpost'),
                 'chargebackspost',     'chargebackpost'),
                 'Chargebacksstatus',   'Chargebackstatus'),
                 'chargebacksstatus',   'chargebackstatus')
WHERE locale = 'sv';
