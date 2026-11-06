import assert from "node:assert/strict";

// Test phone normalisation logic directly
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

  if (digits.startsWith("00")) {
    digits = `+${digits.slice(2)}`;
  }

  const dialCode = COUNTRY_DIAL_CODES[country] || "233";

  if (digits.startsWith("+")) {
    return /^\+[1-9]\d{7,14}$/.test(digits) ? digits : "";
  }

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

console.log("Testing phone normalisation...");
assert.equal(normalizePhone("020 966 9000", "GH"), "+233209669000");
assert.equal(normalizePhone("+233 20 966 9000", "GH"), "+233209669000");
assert.equal(normalizePhone("233209669000", "GH"), "+233209669000");
assert.equal(normalizePhone("08012345678", "NG"), "+2348012345678");
assert.equal(normalizePhone("123", "GH"), "", "Short number rejected");
console.log("✓ Phone normalisation passed!");

