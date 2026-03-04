#!/usr/bin/env node
/**
 * Seed the Convex waitlist table from the CSV export.
 * 
 * Usage: node scripts/seed-waitlist.mjs
 * 
 * Requires: CONVEX_URL env var or convex.json in the project root.
 * Uses the Convex CLI `convex run` to call the internal seedBatch mutation.
 */

import { readFileSync } from "fs";
import { execSync } from "child_process";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");

const csvPath = "/Users/me/Downloads/Broski Waitlist - Sheet1.csv";

// Parse CSV
const raw = readFileSync(csvPath, "utf-8").trim();
const lines = raw.split("\n");
const header = lines[0].split(",");

console.log(`CSV header: ${header.join(", ")}`);
console.log(`Total rows (excluding header): ${lines.length - 1}`);

const entries = [];
for (let i = 1; i < lines.length; i++) {
  const line = lines[i].trim();
  if (!line) continue;

  // Simple CSV parse (no commas in values for this dataset)
  const parts = line.split(",");
  const email = (parts[0] || "").trim().toLowerCase();
  const timestamp = (parts[1] || "").trim();
  const source = (parts[2] || "broski-website").trim();
  const country = (parts[3] || "").trim() || undefined;
  const city = (parts[4] || "").trim() || undefined;

  if (!email) continue;

  entries.push({ email, timestamp, source, country, city });
}

console.log(`Parsed ${entries.length} entries from CSV`);

// Convex has limits on mutation payload size, so batch in chunks of 50
const BATCH_SIZE = 50;
let totalInserted = 0;
let totalSkipped = 0;

for (let i = 0; i < entries.length; i += BATCH_SIZE) {
  const batch = entries.slice(i, i + BATCH_SIZE);
  const argsJson = JSON.stringify({ entries: batch });

  console.log(
    `\nSeeding batch ${Math.floor(i / BATCH_SIZE) + 1} (${batch.length} entries)...`
  );

  try {
    const result = execSync(
      `npx convex run waitlist:seedBatch '${argsJson.replace(/'/g, "'\\''")}'`,
      { cwd: projectRoot, encoding: "utf-8", timeout: 30000 }
    );
    console.log(`Result: ${result.trim()}`);

    // Try to parse the result to get counts
    try {
      const parsed = JSON.parse(result.trim());
      totalInserted += parsed.inserted || 0;
      totalSkipped += parsed.skipped || 0;
    } catch {
      // Result might not be JSON, that's fine
    }
  } catch (err) {
    console.error(`Error seeding batch: ${err.message}`);
    process.exit(1);
  }
}

console.log(`\n✅ Seeding complete!`);
console.log(`   Inserted: ${totalInserted}`);
console.log(`   Skipped (duplicates): ${totalSkipped}`);
