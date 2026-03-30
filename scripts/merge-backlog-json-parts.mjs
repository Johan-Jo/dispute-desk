/**
 * Merge scripts/b2-part-*.json (each file = JSON array) into scripts/backlog-import-batch2.json
 */
import { readFileSync, writeFileSync, readdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const files = readdirSync(__dirname)
  .filter((f) => /^b2-part-\d+\.json$/.test(f))
  .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));

if (files.length === 0) {
  console.error("No b2-part-*.json files in scripts/");
  process.exit(1);
}

const all = [];
for (const f of files) {
  const chunk = JSON.parse(readFileSync(join(__dirname, f), "utf8"));
  if (!Array.isArray(chunk)) {
    console.error(`${f} must be a JSON array`);
    process.exit(1);
  }
  all.push(...chunk);
}

const out = join(__dirname, "backlog-import-batch2.json");
writeFileSync(out, JSON.stringify(all, null, 2));
console.log(`Wrote ${out} (${all.length} items)`);
