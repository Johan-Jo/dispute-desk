// One-shot: rename dashboard.recentActivity to
// "Automation & Submission Activity" across all locale files. Re-run
// is a no-op once the keys are updated.

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const NEW_VALUE = "Automation & Submission Activity";

const files = readdirSync("messages").filter((f) => f.endsWith(".json"));
for (const f of files) {
  const path = join("messages", f);
  const obj = JSON.parse(readFileSync(path, "utf8"));
  if (!obj.dashboard) continue;
  obj.dashboard.recentActivity = NEW_VALUE;
  writeFileSync(path, JSON.stringify(obj, null, 2) + "\n", "utf8");
  console.log(`  ${f}: dashboard.recentActivity updated`);
}
console.log("done");
