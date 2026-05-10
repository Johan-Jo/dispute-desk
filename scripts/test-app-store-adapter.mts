import { appStoreAdapter } from "../lib/signal-radar/sources/app-store";

const result = await appStoreAdapter.ingest();
console.log("items:", result.items.length, "errors:", result.errors.length);
console.log("errors:", result.errors);
console.log("\nFirst 5 items:");
for (const it of result.items.slice(0, 5)) {
  console.log("---");
  console.log("  externalId:", it.externalId);
  console.log("  app (subreddit):", it.subreddit);
  console.log("  postedAt:", it.postedAt);
  console.log("  title:", it.title);
  console.log("  body[0:250]:", it.content.slice(0, 250));
}
