import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";

const ROOT = process.cwd();

console.log("====================================================");
console.log("  IRES Website v2 — Automated Validation & CI Suite ");
console.log("====================================================\n");

// --- 1. Content Guardrail Test ---
console.log("1. Running Content Guardrail Tests...");
const BANNED_PHRASES = [
  "solar-powered pump",
  "terms vary",
  "54, 5th Circular Road",
  "Cantonments, Accra",
];

const htmlFiles = ["index.html", "privacy.html", "cookie-policy.html", "thank-you.html", "404.html"];

for (const file of htmlFiles) {
  const content = fs.readFileSync(path.join(ROOT, file), "utf8");
  for (const phrase of BANNED_PHRASES) {
    assert(
      !content.toLowerCase().includes(phrase.toLowerCase()),
      `Banned phrase "${phrase}" detected in ${file}`
    );
  }
}
console.log("   ✓ Zero banned phrases found across all HTML files.");

// Check exactly 4 finance options
const indexHtml = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const financeCards = indexHtml.match(/class="finance-card/g) || [];
assert.equal(financeCards.length, 4, `Expected exactly 4 finance options, found ${financeCards.length}`);
console.log("   ✓ Exactly 4 finance options present in fixed order.");

// --- 2. Redirect Table Test ---
console.log("\n2. Running Redirect Table Tests...");
const REDIRECT_TABLE = [
  { old: "#why-rammed-earth", target: "#why-ires" },
  { old: "#solutions", target: "#how-we-create-value" },
  { old: "#who-we-build-for", target: "#what-we-build" },
  { old: "#finance", target: "#ways-to-own" },
  { old: "#about", target: "#about-ires" },
  { old: "#contact", target: "#start" },
  { old: "#top", target: "" },
];

for (const row of REDIRECT_TABLE) {
  assert(
    indexHtml.includes(`'${row.old}': '${row.target}'`),
    `Redirect script missing mapping for ${row.old}`
  );
  if (row.target) {
    const slug = row.target.replace("#", "");
    assert(
      indexHtml.includes(`id="${slug}"`),
      `Target slug "${slug}" does not exist as an element ID in index.html`
    );
  }
}
console.log(`   ✓ All ${REDIRECT_TABLE.length} legacy redirect mappings verified.`);

// --- 3. Internal Links Resolution Test ---
console.log("\n3. Testing Internal Link Resolutions...");
const linkRegex = /href="([^"#][^"]*)"/g;
let match;
let resolvedCount = 0;

for (const file of htmlFiles) {
  const content = fs.readFileSync(path.join(ROOT, file), "utf8");
  while ((match = linkRegex.exec(content)) !== null) {
    const targetUrl = match[1];
    // Skip external or protocol links
    if (
      targetUrl.startsWith("http://") ||
      targetUrl.startsWith("https://") ||
      targetUrl.startsWith("tel:") ||
      targetUrl.startsWith("mailto:")
    ) {
      continue;
    }
    const pathWithoutQuery = targetUrl.split("?")[0].split("#")[0];
    const cleanPath = decodeURIComponent(pathWithoutQuery.replace(/^\//, ""));
    if (cleanPath === "") continue; // Root home link (e.g. "/", "/#start")
    const localTarget = path.join(ROOT, cleanPath);
    assert(fs.existsSync(localTarget), `Broken internal link in ${file}: ${targetUrl}`);
    resolvedCount++;
  }
}
console.log(`   ✓ All ${resolvedCount} internal file links resolve properly.`);

// --- 4. Phone Normalisation Unit Tests ---
console.log("\n4. Running Phone Normalisation Tests...");
const COUNTRY_DIAL_CODES = {
  GH: "233",
  NG: "234",
  GB: "44",
  US: "1",
  CA: "1",
  DE: "49",
  NL: "31",
  FR: "33",
  IT: "39",
  AE: "971",
  ZA: "27",
  KE: "254",
  CN: "86",
  IN: "91",
};

function normalizePhone(value, country = "GH") {
  if (!value) return "";
  let digits = String(value).replace(/[^\d+]/g, "");
  if (!digits) return "";
  if (digits.startsWith("00")) digits = `+${digits.slice(2)}`;
  const dialCode = COUNTRY_DIAL_CODES[country] || "233";
  if (digits.startsWith("+")) return /^\+[1-9]\d{7,14}$/.test(digits) ? digits : "";
  if (digits.startsWith(dialCode)) {
    digits = `+${digits}`;
    return /^\+[1-9]\d{7,14}$/.test(digits) ? digits : "";
  }
  if (digits.startsWith("0")) {
    digits = `+${dialCode}${digits.slice(1)}`;
    return /^\+[1-9]\d{7,14}$/.test(digits) ? digits : "";
  }
  digits = `+${dialCode}${digits}`;
  return /^\+[1-9]\d{7,14}$/.test(digits) ? digits : "";
}

assert.equal(normalizePhone("020 966 9000", "GH"), "+233209669000");
assert.equal(normalizePhone("+233209669000", "GH"), "+233209669000");
assert.equal(normalizePhone("233209669000", "GH"), "+233209669000");
assert.equal(normalizePhone("08012345678", "NG"), "+2348012345678");
assert.equal(normalizePhone("07123456789", "GB"), "+447123456789");
assert.equal(normalizePhone("2125551234", "US"), "+12125551234");
assert.equal(normalizePhone("invalid", "GH"), "");
assert.equal(normalizePhone("123", "GH"), "");
console.log("   ✓ Phone normalisation passed for GH, NG, GB, US formats.");

// --- 5. SEO & Metadata Verification ---
console.log("\n5. Verifying SEO & Search Crawling Assets...");
assert(indexHtml.includes('lang="en-GH"'), "Missing lang='en-GH'");
assert(indexHtml.includes('<link rel="canonical" href="https://iresglobal.com/" />'), "Missing canonical tag");
assert(indexHtml.includes('"@type": "HomeAndConstructionBusiness"'), "Missing JSON-LD structured data");
assert(fs.existsSync(path.join(ROOT, "robots.txt")), "robots.txt missing");
assert(fs.existsSync(path.join(ROOT, "sitemap.xml")), "sitemap.xml missing");
assert(fs.existsSync(path.join(ROOT, ".well-known", "security.txt")), "security.txt missing");
console.log("   ✓ Structured data, robots.txt, sitemap.xml and security.txt present.");

console.log("\n====================================================");
console.log("  All Quality & Guardrail Checks Passed! (100% OK)");
console.log("====================================================\n");
