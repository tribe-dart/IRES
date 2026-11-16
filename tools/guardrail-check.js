import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";

const ROOT = process.cwd();
const htmlFiles = fs.readdirSync(ROOT).filter((file) => file.endsWith(".html"));

console.log("Running Content Guardrail Tests...\n");

// 1. Check banned phrases
const BANNED_PHRASES = [
  "solar-powered pump",
  "terms vary",
  "54, 5th Circular Road",
  "Cantonments, Accra",
];

let bannedFound = 0;
for (const file of htmlFiles) {
  const content = fs.readFileSync(path.join(ROOT, file), "utf8");
  for (const phrase of BANNED_PHRASES) {
    if (content.toLowerCase().includes(phrase.toLowerCase())) {
      console.error(`❌ Banned phrase "${phrase}" found in ${file}`);
      bannedFound++;
    }
  }
}
assert.equal(bannedFound, 0, "No banned phrases or street addresses should appear in public HTML files.");
console.log("✓ Zero banned phrases found.");

// 2. Check finance options count == 4
const indexContent = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const financeContent = fs.readFileSync(path.join(ROOT, "ways-to-own.html"), "utf8");
const financeMatches = financeContent.match(/class="finance-card/g) || [];
assert.equal(financeMatches.length, 4, `Expected exactly 4 finance cards, found ${financeMatches.length}`);
console.log(`✓ Exactly 4 finance options present on Ways to own page.`);

// 3. Check content lives on its standalone page.
const REQUIRED_PAGES = {
  "about.html": "about-ires",
  "why-ires.html": "why-ires",
  "how-we-create-value.html": "how-we-create-value",
  "what-we-build.html": "what-we-build",
  "ways-to-own.html": "ways-to-own",
  "contact.html": "start",
};
for (const [file, slug] of Object.entries(REQUIRED_PAGES)) {
  const content = fs.readFileSync(path.join(ROOT, file), "utf8");
  assert(content.includes(`id="${slug}"`), `Missing content on ${file}: ${slug}`);
  assert(!indexContent.includes(`id="${slug}"`), `Detailed content still on homepage: ${slug}`);
}
console.log("✓ All six sections are on their own pages.");

// 4. Check redirect map contains all old anchors
const REDIRECT_ANCHORS = [
  "#why-rammed-earth",
  "#solutions",
  "#who-we-build-for",
  "#finance",
  "#about",
  "#contact",
  "#top",
];

for (const anchor of REDIRECT_ANCHORS) {
  assert(indexContent.includes(anchor), `Missing redirect mapping/alias for anchor: ${anchor}`);
}
console.log("✓ All legacy anchor redirects are present in head script and anchor aliases.");

// 5. Check meta & compliance
assert(indexContent.includes('lang="en-GH"'), "Missing lang='en-GH'");
assert(indexContent.includes('rel="canonical"'), "Missing canonical link");
assert(indexContent.includes('"@type": "HomeAndConstructionBusiness"'), "Missing JSON-LD structured data");
console.log("✓ SEO, canonical, and structured data tags verified.");

console.log("\nAll Content Guardrail Checks Passed Successfully!");

