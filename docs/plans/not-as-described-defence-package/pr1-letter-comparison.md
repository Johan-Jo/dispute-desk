# Not-as-described — PR 1 letter comparison (release gate)

Run 2026-09-28 with `scripts/defence/compare-nad-letters.mts`: read-only prod inputs (each dispute's latest stored package facts and mode), the production model (`claude-sonnet-4-6`, temperature 0.2) via the staging pilot route, once on develop (`267ce7f9`) and once on the PR 1 branch. Only the prompts and validators differ. Validation = `validateNarrative` + `validateComposedDocument` over `composePdfBlocks`. All three cases are decided (never refiled). Tracking numbers redacted.

## Result

- Develop letters hedge in every section ("The available records indicate…", "The available evidence supports…", "The submitted evidence is consistent with…"); #89481 concedes "delivery alone does not resolve the question of conformity with the listing". PDF request line: "Based on the available evidence, the merchant respectfully requests review…".
- PR 1 letters state the record plainly and request reversal. **All 3 pass narrative and composed-document validation on the first draft.**
- The first PR 1 run surfaced two defects no validator caught — "no product listing or customer communication evidence has been submitted to support the buyer's assertion", "The buyer has not, on the available record, engaged a return or resolution process", and two fulfilment rows of one carrier event called "corroborated". Fixed in the family (bans + overlay: "stay on the record", one carrier event is one record) before this run; pinned as test cases.
- Cost: ~5.5k input / ~1.0k output tokens per letter on both versions (+~300 input tokens for the overlay), ≈ $0.03 uncached — no change in call count.
- Residual (not a blocker): letters still lead with delivery, because these packages hold only delivery + no-return facts; the listing arrives with PR 3. Letters say "the order record confirms the purchase" although no `order_record` fact was approved on these packages — true, but uncited.


### #100411 — lost, PayPal, narrow (product_not_as_described_narrow_fallback)

| | Develop (prompt 40, validator 15) | PR 1 (prompt 41, validator 16) |
|---|---|---|
| executiveSummary | The available records indicate that the order was fulfilled and the carrier confirmed delivery on 15 September 2026 (tracking [tracking]). No return has been recorded in Shopify for this order. The available evidence supports the merchant's position that the goods left the merchant and reached the buyer, and that no return or resolution process was subsequently initiated through the merchant's system. | The merchant disputes the buyer's not-as-described claim. The order record confirms the buyer's purchase, and the carrier confirmed delivery on 15 September 2026 (tracking [tracking]). No return has been recorded in Shopify for this order. |
| conclusion | The available evidence supports the merchant's position in this dispute. The carrier confirmed delivery on 15 September 2026 (tracking [tracking]), and no return has been recorded in Shopify for this order. The submitted evidence is consistent with the merchant having fulfilled its obligations under the transaction. | The carrier confirmed delivery on 15 September 2026 (tracking [tracking]). No return has been recorded in Shopify for this order. On the basis of these records, the merchant respectfully requests that the dispute be resolved in its favour. |
| PDF request line | Based on the available evidence, the merchant respectfully requests review of this chargeback. | The merchant respectfully requests reversal of the EUR 46.85 chargeback. |
| Narrative / composed validation | true / true | true / true |
| Tokens in / out | 5300 / 1057 | 5709 / 1013 |

### #98800 — won, PayPal, narrow (product_not_as_described_narrow_fallback)

| | Develop (prompt 40, validator 15) | PR 1 (prompt 41, validator 16) |
|---|---|---|
| executiveSummary | The available records indicate that the shipment was confirmed delivered by YunExpress (tracking [tracking]) on 5 September 2026, and no return has been recorded in Shopify for this order. The available evidence supports the merchant's position that the order was fulfilled and that no formal return process was initiated following the buyer's complaint. | The merchant disputes the buyer's not-as-described claim. The order record confirms a purchase was placed and fulfilled. YunExpress confirmed delivery on 5 September 2026 (tracking [tracking]). No return has been recorded in Shopify for this order. |
| conclusion | The available evidence supports the merchant's position in this dispute. YunExpress confirmed delivery on 5 September 2026 (tracking [tracking]), and no return has been recorded in Shopify for this order. The submitted evidence is consistent with a fulfilled transaction in which no formal return or resolution process was initiated by the buyer. | The carrier confirmed delivery on 5 September 2026 (YunExpress, tracking [tracking]). No return has been recorded in Shopify for this order. On the evidence available, the merchant fulfilled its obligation to dispatch and deliver the order to the buyer. |
| PDF request line | Based on the available evidence, the merchant respectfully requests review of this chargeback. | The merchant respectfully requests reversal of the EUR 37.90 chargeback. |
| Narrative / composed validation | true / true | true / true |
| Tokens in / out | 5061 / 1045 | 5470 / 1075 |

### #89481 — won, PayPal, narrow (product_not_as_described_narrow_fallback)

| | Develop (prompt 40, validator 15) | PR 1 (prompt 41, validator 16) |
|---|---|---|
| executiveSummary | The merchant respectfully submits this response to the buyer's not-as-described claim. The available records indicate that the order was dispatched and that YunExpress confirmed delivery on 15 July 2026 (tracking [tracking]). No return has been recorded in Shopify for this order. The available evidence is consistent with the merchant having fulfilled its obligations, and the merchant requests that the dispute be resolved in its favour. | The merchant disputes this not-as-described claim. The order record shows the buyer's purchase was fulfilled, and YunExpress confirmed delivery on 15 July 2026 (tracking [tracking]). No return has been recorded in Shopify for this order. |
| conclusion | The available evidence supports that the order was shipped via YunExpress and that delivery was confirmed on 15 July 2026 (tracking [tracking]). No return has been recorded in Shopify for this order. On the basis of the submitted evidence, the merchant respectfully requests that the dispute be resolved in its favour. | The carrier record confirms delivery on 15 July 2026 via YunExpress (tracking [tracking]). No return has been recorded in Shopify for this order. The merchant respectfully requests that this dispute be resolved in its favour on the basis of the submitted evidence. |
| PDF request line | Based on the available evidence, the merchant respectfully requests review of this chargeback. | The merchant respectfully requests reversal of the EUR 74.87 chargeback. |
| Narrative / composed validation | true / true | true / true |
| Tokens in / out | 5330 / 1149 | 5739 / 1070 |
