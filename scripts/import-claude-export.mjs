// One-time import of the claude.ai artifact database export.
// Usage: node scripts/import-claude-export.mjs <export-dir>
// Writes docs/words.json (shared word list) and docs/restore/<code>.json (owner's progress)
// and prints the restore code.
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

const dir = process.argv[2];
if (!dir) throw new Error("export dir required");

const words = readdirSync(join(dir, "words"))
  .filter(f => f.endsWith(".json"))
  .map(f => {
    const raw = JSON.parse(readFileSync(join(dir, "words", f), "utf8"));
    const d = raw.data || raw;
    const id = raw.id || f.replace(/\.json$/, "");
    const w = { id, en: d.en, ru: d.ru, tr: d.tr || "", src: d.src || "", added: d.added || 0 };
    if (d.ex) w.ex = d.ex;
    return w;
  })
  .filter(w => w.en && w.ru)
  .sort((a, b) => a.added - b.added || a.id.localeCompare(b.id));
writeFileSync("docs/words.json", JSON.stringify(words, null, 0).replace(/},{/g, "},\n{"));
console.log("words:", words.length);

const progDir = join(dir, "data", "users", "me");
const progress = {};
for (const f of readdirSync(progDir).filter(f => f.endsWith(".json"))) {
  const raw = JSON.parse(readFileSync(join(progDir, f), "utf8"));
  for (const [k, v] of Object.entries(raw.data || raw)) if (v && typeof v === "object") progress[k] = v;
}
mkdirSync("docs/restore", { recursive: true });
const code = randomBytes(12).toString("hex");
writeFileSync(join("docs/restore", code + ".json"), JSON.stringify(progress));
console.log("progress entries:", Object.keys(progress).length);
console.log("restore code:", code);
