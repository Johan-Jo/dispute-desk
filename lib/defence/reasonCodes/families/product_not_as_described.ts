/**
 * Family: product not as described / defective (Visa 13.3, MC 4853).
 *
 * Bank-side claim: the goods/service did not match the description or
 * were defective. Cross-module strategy is to surface the listing as
 * advertised, what was actually delivered, and any resolution attempts.
 */

import type { ReasonCodeFamily } from "../../types";

export const product_not_as_described: ReasonCodeFamily = {
  key: "product_not_as_described",
  displayName: "Product not as described or defective",
  moduleKeys: ["product_unacceptable"],
  unmodeledCodes: [],
  fallbackModuleKey: "product_unacceptable",
  overlayPromptBody: "",
  familyAvoid: [],
  version: 1,
};
