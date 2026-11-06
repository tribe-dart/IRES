import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";

const ROOT = process.cwd();
const htmlFiles = ["index.html", "privacy.html", "cookie-policy.html", "thank-you.html", "404.html"];

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
const financeMatches = indexContent.match(/class="finance-card/g) || [];
assert.equal(financeMatches.length, 4, `Expected exactly 4 finance cards, found ${financeMatches.length}`);
console.log(`✓ Exactly 4 finance options present on homepage.`);

// 3. Check canonical slugs present on index.html
const REQUIRED_SLUGS = [
  'id="about-ires"',
  'id="why-ires"',
  'id="how-we-create-value"',
  'id="what-we-build"',
  'id="ways-to-own"',
  'id="start"',
];

for (const slug of REQUIRED_SLUGS) {
  assert(indexContent.includes(slug), `Missing canonical slug: ${slug}`);
}
console.log("✓ All canonical section slugs are properly defined.");

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

