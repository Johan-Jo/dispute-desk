import { config } from "dotenv";
import { join } from "path";

config({ path: join(process.cwd(), ".env.local") });

const { sendNewDisputeAlert } = await import("../lib/email/sendNewDisputeAlert.ts");

const mode = process.argv[2] === "auto" ? "auto" : "review";

await sendNewDisputeAlert({
  shopId: "e5da0042-a3d4-48f4-88f3-33632a0e12d3",
  disputeId: "39960467-4310-4943-a540-320050d9a4d6",
  reason: "FRAUDULENT",
  phase: "chargeback",
  amount: 35.78,
  currencyCode: "USD",
  dueAt: "2026-04-26T23:00:00+00:00",
  orderName: "#1069",
  resolvedMode: mode,
});

console.log(`Test new-dispute alert (${mode}) dispatched via Resend.`);
