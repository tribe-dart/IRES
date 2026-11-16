import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import vm from "node:vm";

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

const htmlFiles = fs.readdirSync(ROOT).filter((file) => file.endsWith(".html"));

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
const financeHtml = fs.readFileSync(path.join(ROOT, "ways-to-own.html"), "utf8");
const financeCards = financeHtml.match(/class="finance-card/g) || [];
assert.equal(financeCards.length, 4, `Expected exactly 4 finance options, found ${financeCards.length}`);
console.log("   ✓ Exactly 4 finance options present in fixed order.");

// --- 2. Legacy bookmark redirects (execute the browser script) ---
console.log("\n2. Testing Legacy Bookmark Redirects...");
const REDIRECT_TABLE = {
  "#why-ires": "why-ires.html",
  "#how-we-create-value": "how-we-create-value.html",
  "#what-we-build": "what-we-build.html",
  "#ways-to-own": "ways-to-own.html",
  "#about-ires": "about.html",
  "#start": "contact.html",
  "#why-rammed-earth": "why-ires.html",
  "#solutions": "how-we-create-value.html",
  "#who-we-build-for": "what-we-build.html",
  "#finance": "ways-to-own.html",
  "#about": "about.html",
  "#our-philosophy": "about.html",
  "#contact": "contact.html",
  "#heritage": "about.html#heritage",
  "#ghana": "about.html#ghana",
  "#work": "what-we-build.html#work",
  "#process": "how-we-create-value.html#process",
  "#problems": "why-ires.html#problems",
  "#closing-summary": "why-ires.html#closing-summary",
  "#top": ""
};
const redirectScript = indexHtml.match(/<script id="legacy-navigation">([\s\S]*?)<\/script>/)?.[1];
assert(redirectScript, "Missing legacy bookmark handler");
for (const [hash, target] of Object.entries(REDIRECT_TABLE)) {
  let destination;
  const location = new URL(`https://iresglobal.com/?utm_source=bookmark${hash}`);
  location.replace = (url) => { destination = new URL(url, location); };
  const listeners = {};
  const window = {
    location,
    history: { replaceState: (_state, _title, url) => { destination = new URL(url, location); } },
    addEventListener: (name, handler) => { listeners[name] = handler; },
  };
  vm.runInNewContext(redirectScript, { window, URL });
  const expected = new URL(target || "/", location);
  expected.search = location.search;
  assert.equal(destination?.href, expected.href, `Incorrect redirect for ${hash}`);
  // Also exercise bookmarks entered after the page loads.
  destination = undefined;
  listeners.hashchange();
  assert.equal(destination?.href, expected.href, `Hash change failed for ${hash}`);
}
console.log(`   ✓ All ${Object.keys(REDIRECT_TABLE).length} bookmarks preserve campaign parameters and reach the correct page.`);

// --- 3. Page navigation and internal destinations ---
console.log("\n3. Testing Standalone Pages and Internal Links...");
const pageFiles = ["why-ires.html", "how-we-create-value.html", "what-we-build.html", "ways-to-own.html", "about.html", "contact.html"];
for (const file of ["index.html", ...pageFiles]) {
  const content = fs.readFileSync(path.join(ROOT, file), "utf8");
  const nav = content.match(/<nav class="site-nav"[^>]*>([\s\S]*?)<\/nav>/)?.[1];
  assert(nav, `Missing primary navigation in ${file}`);
  const navLinks = [...nav.matchAll(/href="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(navLinks, pageFiles, `Navigation should open all six pages in ${file}`);
  assert.equal((content.match(/<h1\b/g) || []).length, 1, `Expected one H1 in ${file}`);
  if (file !== "index.html") {
    assert(nav.includes(`href="${file}" aria-current="page"`), `Missing active page in ${file}`);
    assert(content.includes(`rel="canonical" href="https://iresglobal.com/${file}"`), `Incorrect canonical in ${file}`);
    const graph = JSON.parse(content.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
    const webpage = graph["@graph"].find((item) => item["@type"] === "WebPage");
    assert.equal(webpage.url, `https://iresglobal.com/${file}`, `Incorrect structured page URL in ${file}`);
  }
}
assert.equal((indexHtml.match(/<section\b/g) || []).length, 1, "Homepage should contain only the hero and core promises");
assert(!/<form\b[^>]*class="[^"]*\bcontact-form\b/.test(indexHtml), "Contact form must live on the contact page");
const contactHtml = fs.readFileSync(path.join(ROOT, "contact.html"), "utf8");
assert(/<form\b[^>]*class="[^"]*\bcontact-form\b/.test(contactHtml), "Contact form missing from its page");
assert(contactHtml.includes('id="f-name"'), "Contact form lost the name field");
const financeNames = [...financeHtml.matchAll(/<h3>([^<]+)<\/h3>/g)].map((match) => match[1]);
assert.deepEqual(financeNames, ["Developer finance", "Interest-free payment plans", "Milestone billing", "Mortgage with banking partners"]);
let resolvedCount = 0;
for (const file of htmlFiles) {
  const content = fs.readFileSync(path.join(ROOT, file), "utf8");
  for (const match of content.matchAll(/(?:href|src)="([^"]+)"/g)) {
    const targetUrl = match[1];
    if (/^(?:https?:|tel:|mailto:|data:)/.test(targetUrl)) continue;
    const url = new URL(targetUrl, `https://iresglobal.com/${file}`);
    const cleanPath = decodeURIComponent(url.pathname.replace(/^\//, "")) || "index.html";
    const localTarget = path.join(ROOT, cleanPath);
    assert(fs.existsSync(localTarget), `Broken internal link or asset in ${file}: ${targetUrl}`);
    if (url.hash && cleanPath.endsWith(".html")) {
      const target = fs.readFileSync(localTarget, "utf8");
      assert(target.includes(`id="${decodeURIComponent(url.hash.slice(1))}"`), `Missing anchor in ${file}: ${targetUrl}`);
    }
    resolvedCount++;
  }
}
const sitemap = fs.readFileSync(path.join(ROOT, "sitemap.xml"), "utf8");
for (const file of pageFiles) assert(sitemap.includes(`https://iresglobal.com/${file}`), `Missing sitemap page: ${file}`);
console.log(`   ✓ Six page destinations, active navigation, headings, form, finance order, sitemap and ${resolvedCount} internal links/assets verified.`);

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
