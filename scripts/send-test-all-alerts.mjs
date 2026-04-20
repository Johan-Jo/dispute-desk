import { config } from "dotenv";
import { join } from "path";

config({ path: join(process.cwd(), ".env.local") });

const SHOP_ID = "e5da0042-a3d4-48f4-88f3-33632a0e12d3";
const SHOP_DOMAIN = "surasvenne.myshopify.com";
const DISPUTE_ID = "39960467-4310-4943-a540-320050d9a4d6";
const TO = "hej@johan.com.br";

const common = {
  reason: "FRAUDULENT",
  phase: "chargeback",
  amount: 35.78,
  currencyCode: "USD",
  dueAt: "2026-04-26T23:00:00+00:00",
  orderName: "#1069",
};

// 1. sendDueReminder
{
  const { sendDueReminder } = await import("../lib/email/sendDueReminder.ts");
  await sendDueReminder({
    to: TO,
    locale: "en",
    shopName: SHOP_DOMAIN,
    shopDomain: SHOP_DOMAIN,
    disputeId: DISPUTE_ID,
    reason: common.reason,
    phase: common.phase,
    amount: common.amount,
    currencyCode: common.currencyCode,
    dueAt: common.dueAt,
    orderName: common.orderName,
    packStatus: "ready",
  });
  console.log("1/3 Due reminder dispatched.");
}

// 2. sendPackSavedAlert — reads shop/dispute from Supabase, only needs ids
{
  const { sendPackSavedAlert } = await import("../lib/email/sendPackSavedAlert.ts");
  await sendPackSavedAlert({
    shopId: SHOP_ID,
    disputeId: DISPUTE_ID,
    packId: "aebc5405-3c21-4d27-8219-e39fdc1e330d",
    reason: common.reason,
    amount: common.amount,
    currencyCode: common.currencyCode,
  });
  console.log("2/3 Pack saved alert dispatched.");
}

// 3. sendEvidenceNeededAlert
{
  const { sendEvidenceNeededAlert } = await import(
    "../lib/email/sendEvidenceNeededAlert.ts"
  );
  await sendEvidenceNeededAlert({
    to: TO,
    shopName: SHOP_DOMAIN,
    shopDomain: SHOP_DOMAIN,
    disputeId: DISPUTE_ID,
    disputeReason: common.reason,
    disputeAmount: String(common.amount),
    packId: "aebc5405-3c21-4d27-8219-e39fdc1e330d",
    digitalProof: "yes",
    deliveryProof: "always",
  });
  console.log("3/3 Evidence-needed alert dispatched.");
}

console.log("\nAll three merchant Admin-link alerts dispatched via Resend.");
