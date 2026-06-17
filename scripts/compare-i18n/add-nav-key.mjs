// One-off: insert `marketing.nav.compare` into every messages/<locale>.json,
// preserving CRLF and indentation by string-inserting after the nav.resources
// string entry. The top-level `resources` namespace is an object (`"resources": {`),
// so matching `"resources": "` targets only the nav label.
import { readFileSync, writeFileSync } from "node:fs";

const TR = { en: "Compare", de: "Vergleich", es: "Comparar", fr: "Comparer", pt: "Comparar", sv: "Jämför" };
const RE = /(\r?\n)([ \t]*)"resources": "([^"\\]*)"/;

for (const [loc, val] of Object.entries(TR)) {
  const f = `messages/${loc}.json`;
  let s = readFileSync(f, "utf8");
  const o = JSON.parse(s);
  if (o.marketing?.nav?.compare) {
    console.log(`${loc}: already present`);
    continue;
  }
  const m = s.match(RE);
  if (!m) {
    console.error(`${loc}: no nav.resources string match`);
    process.exit(1);
  }
  const [full, eol, indent] = m;
  s = s.replace(RE, `${full},${eol}${indent}"compare": ${JSON.stringify(val)}`);
  JSON.parse(s);
  writeFileSync(f, s, "utf8");
  console.log(`${loc}: inserted nav.compare = ${val}`);
}
